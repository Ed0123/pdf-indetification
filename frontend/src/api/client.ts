/// <reference types="vite/client" />
/**
 * API client – thin fetch wrappers around the FastAPI backend.
 * In production, set VITE_API_URL to your Cloud Run URL.
 * During local dev, Vite proxies /api → localhost:8000.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Stored auth token — set via setAuthToken() after Firebase sign-in. */
let _authToken: string | null = null;
export function setAuthToken(token: string | null) {
  _authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (_authToken) {
    headers["Authorization"] = `Bearer ${_authToken}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// --------------------------------------------------------------------------
// PDF
// --------------------------------------------------------------------------

export interface ServerFileInfo {
  file_id: string;
  file_name: string;
  num_pages: number;
  file_size: number;
  pages: { page_number: number }[];
}

/** Upload one or more PDF files; returns server metadata array. */
export async function uploadPDFs(files: File[]): Promise<ServerFileInfo[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request<ServerFileInfo[]>("/api/pdf/upload", { method: "POST", body: form });
}

/** Fetch a page rendered as base64 PNG. */
export async function renderPage(
  fileId: string,
  pageNum: number,
  zoom = 1.5
): Promise<string> {
  const data = await request<{ image: string }>(
    `/api/pdf/${fileId}/page/${pageNum}/render?zoom=${zoom}`
  );
  return data.image;
}

/** Extract text from a relative bounding box region. */
export async function extractText(
  fileId: string,
  pageNum: number,
  box: { x: number; y: number; width: number; height: number },
  useOcr = true
): Promise<string> {
  const data = await request<{ text: string }>(
    `/api/pdf/${fileId}/page/${pageNum}/extract`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...box, use_ocr: useOcr }),
    }
  );
  return data.text;
}

// --------------------------------------------------------------------------
// OCR Status
// --------------------------------------------------------------------------

export async function getOcrStatus(): Promise<boolean> {
  const data = await request<{ available: boolean }>("/api/ocr/status");
  return data.available;
}

// --------------------------------------------------------------------------
// Project save / load
// --------------------------------------------------------------------------

/** Download the current project as a .json file. */
export async function saveProject(payload: object): Promise<void> {
  const res = await fetch(`${BASE}/api/project/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Save failed");
  const blob = await res.blob();
  triggerDownload(blob, "project.json");
}

/** Upload a .json file and receive back the parsed project data. */
export async function loadProject(file: File): Promise<object> {
  const form = new FormData();
  form.append("file", file);
  return request<object>("/api/project/load", { method: "POST", body: form });
}

// --------------------------------------------------------------------------
// Export
// --------------------------------------------------------------------------

/** Export PDF pages as a ZIP of individually named PDFs. */
export async function exportPdfPages(
  pages: { file_id: string; page_number: number; filename: string }[]
): Promise<void> {
  const res = await fetch(`${BASE}/api/pdf/export-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
  const blob = await res.blob();
  triggerDownload(blob, "exported_pages.zip");
}

/** Export project data to Excel and trigger a file download. */
export async function exportExcel(payload: object): Promise<void> {
  const res = await fetch(`${BASE}/api/export/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  triggerDownload(blob, "export.xlsx");
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------
// User / Auth
// --------------------------------------------------------------------------

import type { UserProfile } from "../types/user";

export interface GroupItem {
  id: string;
  name: string;
}

/** Fetch the current user's profile (creates one on first login). */
export async function getMyProfile(): Promise<UserProfile> {
  return request<UserProfile>("/api/users/me");
}

/** Update the current user's own profile fields. */
export async function updateMyProfile(
  fields: Partial<Pick<UserProfile, "display_name" | "salutation" | "email" | "whatsapp">>
): Promise<UserProfile> {
  return request<UserProfile>("/api/users/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

// --------------------------------------------------------------------------
// Admin
// --------------------------------------------------------------------------

/** List all users (admin only). */
export async function listAllUsers(): Promise<UserProfile[]> {
  return request<UserProfile[]>("/api/users/");
}

/** Admin: update another user's status/tier/group/notes. */
export async function adminUpdateUser(
  uid: string,
  changes: Partial<Pick<UserProfile, "status" | "tier" | "group" | "notes">>
): Promise<UserProfile> {
  return request<UserProfile>(`/api/users/${uid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

/** Admin: reset a user's monthly usage counter to 0. */
export async function adminResetUsage(uid: string): Promise<UserProfile> {
  return request<UserProfile>(`/api/users/${uid}/usage/reset`, {
    method: "POST",
  });
}

/** Admin: list available groups. */
export async function listGroups(): Promise<GroupItem[]> {
  return request<GroupItem[]>("/api/users/groups");
}

/** Admin: create a new group. */
export async function createGroup(name: string): Promise<GroupItem> {
  return request<GroupItem>("/api/users/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Admin: rename an existing group. */
export async function renameGroup(groupId: string, name: string): Promise<GroupItem> {
  return request<GroupItem>(`/api/users/groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Admin: delete an existing group. */
export async function deleteGroup(groupId: string): Promise<{ deleted: string; fallback_group: string }> {
  return request<{ deleted: string; fallback_group: string }>(`/api/users/groups/${groupId}`, {
    method: "DELETE",
  });
}

// --------------------------------------------------------------------------
// Usage tracking
// --------------------------------------------------------------------------

export interface UsageResult {
  usage_pages: number;
  limit: number; // -1 = unlimited
  over_limit: boolean;
}

/** Record OCR page usage and return updated counts. */
export async function recordUsage(pages: number): Promise<UsageResult> {
  return request<UsageResult>("/api/users/usage/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages }),
  });
}

// --------------------------------------------------------------------------
// Cloud Templates
// --------------------------------------------------------------------------

export interface CloudTemplateBox {
  column_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface CloudTemplate {
  id: string;
  owner_uid: string;
  name: string;
  boxes: CloudTemplateBox[];
  notes: string;
  permission: "personal" | "public" | "group";
  preview_image: string;
  page_image_path: string;
  group: string;
  created_at: string;
  updated_at: string;
}

/** List all templates visible to the current user. */
export async function listCloudTemplates(): Promise<CloudTemplate[]> {
  return request<CloudTemplate[]>("/api/templates/");
}

/** Create a new cloud template. */
export async function createCloudTemplate(
  data: {
    name: string;
    boxes: CloudTemplateBox[];
    notes?: string;
    permission?: string;
    preview_image?: string;
    group?: string;
  }
): Promise<CloudTemplate> {
  return request<CloudTemplate>("/api/templates/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Update an existing cloud template. */
export async function updateCloudTemplate(
  id: string,
  data: {
    name?: string;
    boxes?: CloudTemplateBox[];
    notes?: string;
    permission?: string;
    preview_image?: string;
    group?: string;
  }
): Promise<CloudTemplate> {
  return request<CloudTemplate>(`/api/templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Delete a cloud template. */
export async function deleteCloudTemplate(id: string): Promise<void> {
  await request<{ deleted: string }>(`/api/templates/${id}`, { method: "DELETE" });
}

/** Upload a page image (base64 PNG) for a template to Cloud Storage. */
export async function uploadTemplatePageImage(
  templateId: string,
  base64Png: string
): Promise<{ path: string; template_id: string }> {
  return request<{ path: string; template_id: string }>(
    `/api/templates/${templateId}/page-image-b64`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Png }),
    }
  );
}

/** Get a (signed) URL for the page image of a template. */
export async function getTemplatePageImageUrl(
  templateId: string
): Promise<{ url: string; source: string }> {
  return request<{ url: string; source: string }>(
    `/api/templates/${templateId}/page-image`
  );
}
