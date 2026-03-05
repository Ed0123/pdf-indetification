/// <reference types="vite/client" />
/**
 * API client – thin fetch wrappers around the FastAPI backend.
 *
 * Design:
 *  - Every request calls _getToken() for a fresh Firebase ID token.
 *  - On 401, automatically force-refreshes and retries once.
 *  - AbortController timeout (default 30s, OCR 120s).
 *  - File-size validation before upload (max 1000 MB).
 *  - All errors surface as thrown Error objects — never silently swallowed.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

// Max upload size: 1000 MB
const MAX_UPLOAD_SIZE_BYTES = 1000 * 1024 * 1024;

// Default request timeout (ms)
const DEFAULT_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 120_000; // for OCR / export operations

// ───────────── Token provider (set by App on auth change) ─────────────────

type TokenProvider = () => Promise<string | null>;
type TokenFreshProvider = () => Promise<string | null>;

let _getToken: TokenProvider = async () => null;
let _getTokenFresh: TokenFreshProvider = async () => null;

// optional handler invoked when even a refreshed token yields 401
// (session expired or revoked).  Installed by App so it can force logout.
export type AuthExpiredHandler = () => void;
let _onAuthExpired: AuthExpiredHandler = () => {};

// optional handler invoked when a file_id is missing on the server.  The
// handler may choose to re-upload the original blob and return a new ID
// (or return null to indicate no recovery is possible).
export type MissingFileHandler = (oldFileId: string) => Promise<string | null>;
let _onFileMissing: MissingFileHandler | null = null;

export function installMissingFileHandler(fn: MissingFileHandler) {
  _onFileMissing = fn;
}

/**
 * Install token providers. Called once from App.tsx with useAuth()'s
 * getToken / getTokenFresh callbacks.
 */
export function installTokenProvider(
  getToken: TokenProvider,
  getTokenFresh: TokenFreshProvider,
  onAuthExpired?: AuthExpiredHandler,
) {
  _getToken = getToken;
  _getTokenFresh = getTokenFresh;
  if (onAuthExpired) {
    _onAuthExpired = onAuthExpired;
  }
}

/** @deprecated — kept for backward compat; prefer installTokenProvider. */
export function setAuthToken(_token: string | null) {
  // no-op — token is now fetched fresh per request
}

// ───────────── Core request helper ────────────────────────────────────────

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const token = await _getToken();

  const doFetch = async (authToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const controller = new AbortController();
    const timer = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      return await fetch(`${BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let res = await doFetch(token);

  // 401 → force-refresh token and retry once
  if (res.status === 401) {
    const freshToken = await _getTokenFresh();
    if (freshToken) {
      res = await doFetch(freshToken);
    }
    if (res.status === 401) {
      // notify host (App) that the session is dead so it can log out
      _onAuthExpired();
      throw new Error("登入已過期，請重新登入。");
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * request variant for blob downloads (project save, excel export, pdf export).
 * Includes auth headers + 401 retry.
 */
async function requestBlob(
  path: string,
  init?: RequestInit,
  timeoutMs = LONG_TIMEOUT_MS,
): Promise<Blob> {
  const token = await _getToken();

  const doFetch = async (authToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const controller = new AbortController();
    const timer = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      return await fetch(`${BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let res = await doFetch(token);

  if (res.status === 401) {
    const freshToken = await _getTokenFresh();
    if (freshToken) {
      res = await doFetch(freshToken);
    }
    if (res.status === 401) {
      _onAuthExpired();
      throw new Error("登入已過期，請重新登入。");
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.blob();
}

// --------------------------------------------------------------------------
// Messaging
// --------------------------------------------------------------------------

export async function sendUserMessage(message: string): Promise<void> {
  await request("/api/users/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
}

export async function fetchMyMessages(): Promise<any[]> {
  return request("/api/users/message");
}

export async function fetchAllMessages(): Promise<any[]> {
  return request("/api/messages/");
}

export async function replyToMessage(id: string, reply: string): Promise<void> {
  await request(`/api/messages/${id}/reply`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) });
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

/** Upload one or more PDF files; returns server metadata array.
 *  Validates file size ≤ 1000 MB before uploading. */
export async function uploadPDFs(files: File[]): Promise<ServerFileInfo[]> {
  // Client-side size validation
  for (const f of files) {
    if (f.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(
        `檔案 "${f.name}" 太大（${(f.size / 1024 / 1024).toFixed(0)} MB）。上限為 1000 MB。`
      );
    }
  }
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return request<ServerFileInfo[]>("/api/pdf/upload", { method: "POST", body: form }, LONG_TIMEOUT_MS);
}

/** Fetch a page rendered as base64 PNG. */
export async function renderPage(
  fileId: string,
  pageNum: number,
  zoom = 1.5
): Promise<string> {
  const path = `/api/pdf/${fileId}/page/${pageNum}/render?zoom=${zoom}`;
  try {
    const data = await request<{ image: string }>(path);
    return data.image;
  } catch (err: any) {
    if (_onFileMissing && err.message?.includes("404")) {
      const newId = await _onFileMissing(fileId);
      if (newId && newId !== fileId) {
        const data = await request<{ image: string }>(
          `/api/pdf/${newId}/page/${pageNum}/render?zoom=${zoom}`
        );
        return data.image;
      }
    }
    throw err;
  }
}

/** Extract text from a relative bounding box region. */
export async function extractText(
  fileId: string,
  pageNum: number,
  box: { x: number; y: number; width: number; height: number },
  useOcr = true
): Promise<string> {
  const path = `/api/pdf/${fileId}/page/${pageNum}/extract`;
  const body = { ...box, use_ocr: useOcr };
  try {
    const data = await request<{ text: string }>(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      LONG_TIMEOUT_MS,
    );
    return data.text;
  } catch (err: any) {
    if (_onFileMissing && err.message?.includes("404")) {
      const newId = await _onFileMissing(fileId);
      if (newId && newId !== fileId) {
        const data = await request<{ text: string }>(
          `/api/pdf/${newId}/page/${pageNum}/extract`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          LONG_TIMEOUT_MS,
        );
        return data.text;
      }
    }
    throw err;
  }
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
  const blob = await requestBlob("/api/project/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  const blob = await requestBlob("/api/pdf/export-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages }),
  });
  triggerDownload(blob, "exported_pages.zip");
}

/** Text annotation for PDF overlay */
export interface TextAnnotation {
  file_id: string;
  page_number: number;
  text: string;
  x: number;
  y: number;
  font_size?: number;
  color?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
}

/** Export PDF pages with text annotations as merged PDF or ZIP. */
export async function exportAnnotatedPdf(
  pages: { file_id: string; page_number: number; filename: string }[],
  annotations: TextAnnotation[] = [],
  includeAnnotations: boolean = true,
  outputFilename: string = "annotated.pdf",
  merge: boolean = true
): Promise<void> {
  const blob = await requestBlob("/api/pdf/export-annotated", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      pages, 
      annotations,
      include_annotations: includeAnnotations,
      merge,
      output_filename: outputFilename
    }),
  });
  // Download filename based on merge setting
  const downloadName = merge 
    ? outputFilename 
    : (includeAnnotations ? "annotated_pages.zip" : "exported_pages.zip");
  triggerDownload(blob, downloadName);
}

/** Export project data to Excel and trigger a file download. */
export async function exportExcel(payload: object): Promise<void> {
  const blob = await requestBlob("/api/export/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
// Tier management
// --------------------------------------------------------------------------

export interface TierItem {
  id: string;
  name: string;
  label: string;
  quota: number; // -1 = unlimited
  storage_quota_mb: number; // cloud storage MB, 0 = none, -1 = unlimited
  features: Record<string, boolean>; // feature flags
}

/** Admin: list all tiers. */
export async function listTiers(): Promise<TierItem[]> {
  return request<TierItem[]>("/api/users/tiers");
}

/** Admin: create a new tier. */
export async function createTier(
  data: { name: string; label: string; quota: number; storage_quota_mb?: number; features?: Record<string, boolean> }
): Promise<TierItem> {
  return request<TierItem>("/api/users/tiers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storage_quota_mb: 0, features: {}, ...data }),
  });
}

/** Admin: update a tier. */
export async function updateTier(
  tierId: string,
  data: { name?: string; label?: string; quota?: number; storage_quota_mb?: number; features?: Record<string, boolean> }
): Promise<TierItem> {
  return request<TierItem>(`/api/users/tiers/${tierId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Admin: delete a tier. */
export async function deleteTier(tierId: string): Promise<{ deleted: string; fallback_tier: string }> {
  return request<{ deleted: string; fallback_tier: string }>(`/api/users/tiers/${tierId}`, {
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

// --------------------------------------------------------------------------
// Cloud Project Management
// --------------------------------------------------------------------------

export interface CloudProjectItem {
  id: string;
  name: string;
  owner_uid: string;
  size_bytes: number;
  pdf_count: number;
  page_count: number;
  permanent: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/** List current user's cloud projects. */
export async function listCloudProjects(): Promise<CloudProjectItem[]> {
  return request<CloudProjectItem[]>("/api/projects/cloud/");
}

/** Create a new cloud project. */
export async function createCloudProject(name: string): Promise<CloudProjectItem> {
  return request<CloudProjectItem>("/api/projects/cloud/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Upload project JSON to an existing cloud project. */
export async function uploadCloudProjectJson(
  projectId: string,
  jsonBlob: Blob
): Promise<CloudProjectItem> {
  const token = await _getToken();
  const form = new FormData();
  form.append("file", jsonBlob, "project.json");
  const res = await fetch(`${BASE}/api/projects/cloud/${projectId}/upload-json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Upload project JSON + all PDFs to cloud storage.
 * The backend reads PDFs from its in-memory _STORE and uploads them alongside the JSON.
 */
export async function uploadCloudProjectFull(
  projectId: string,
  payload: any,
): Promise<CloudProjectItem> {
  return request<CloudProjectItem>(
    `/api/projects/cloud/${projectId}/upload-full`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    LONG_TIMEOUT_MS,
  );
}

/**
 * Load a cloud project including restoring all PDFs into the backend _STORE.
 * Returns the project JSON with file_ids remapped to new working IDs.
 */
export async function loadCloudProjectFull(
  projectId: string,
): Promise<any> {
  return request<any>(`/api/projects/cloud/${projectId}/load-full`, undefined, LONG_TIMEOUT_MS);
}

/** Load a cloud project's JSON data. */
export async function loadCloudProjectJson(projectId: string): Promise<any> {
  return request<any>(`/api/projects/cloud/${projectId}/load`);
}

/** Rename a cloud project. */
export async function renameCloudProject(
  projectId: string,
  name: string,
  permanent?: boolean,
): Promise<CloudProjectItem> {
  const body: Record<string, any> = { name };
  if (permanent !== undefined) body.permanent = permanent;
  return request<CloudProjectItem>(`/api/projects/cloud/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Toggle permanent flag on a cloud project. */
export async function toggleCloudProjectPermanent(
  projectId: string,
  permanent: boolean,
): Promise<CloudProjectItem> {
  return request<CloudProjectItem>(`/api/projects/cloud/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permanent }),
  });
}

/** Delete a cloud project. */
export async function deleteCloudProject(
  projectId: string
): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/api/projects/cloud/${projectId}`, {
    method: "DELETE",
  });
}

// ─── BQ (Bill of Quantities) API ─────────────────────────────────────────────

/** BQ engine info */
export interface BQEngineInfo {
  id: string;
  name: string;
  quota_cost: number;
  available: boolean;
  description?: string;
}

/** BQ extracted row */
export interface BQRowAPI {
  id: number;
  file_id: string;
  page_number: number;
  page_label: string;
  revision: string;
  bill_name: string;
  collection: string;
  page_is_collection?: boolean;
  type: string;
  item_no: string;
  description: string;
  quantity: number | null;
  unit: string;
  rate: number | null;
  total: number | null;
  parent_id?: number | null;
  // Bounding box for UI highlighting (absolute PDF coordinates)
  bbox_x0?: number;
  bbox_y0?: number;
  bbox_x1?: number;
  bbox_y1?: number;
  // Page dimensions for coordinate conversion
  page_width?: number;
  page_height?: number;
}

/** BQ extraction request */
export interface BQExtractRequest {
  file_id: string;
  pages: number[];
  boxes: Array<{
    column_name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  engine?: string;
}

/** BQ extraction response */
export interface BQExtractResponse {
  success: boolean;
  rows: BQRowAPI[];
  warnings: string[];
  engine: string;
  pages_processed: number;
  quota_cost: number;
}

/** List available BQ OCR engines. */
export async function listBQEngines(): Promise<BQEngineInfo[]> {
  return request<BQEngineInfo[]>("/api/bq/engines");
}

/** Extract BQ data from PDF pages. */
export async function extractBQ(
  params: BQExtractRequest
): Promise<BQExtractResponse> {
  return request<BQExtractResponse>(
    "/api/bq/extract",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    LONG_TIMEOUT_MS
  );
}

/** Collection integration request */
export interface CollectionIntegrateRequest {
  page_totals: Array<{
    page_key: string;
    page_label: string;
    page_number: number;
    file_id: string;
    page_total: number;
    item_count: number;
    is_collection: boolean;
  }>;
}

/** Collection integration response */
export interface CollectionIntegrateResponse {
  success: boolean;
  collection_rows: Array<{
    page_key: string;
    row_id: number;
    entry_type: string;
    description: string;
    page_ref: string;
    matched_page_key: string;
    total: number | null;
    original_total: number | null;
    mismatch_warning: string;
  }>;
  grand_total: number;
  non_collection_total: number;
  warnings: string[];
}

/** Integrate page totals into collection pages. */
export async function integrateCollection(
  params: CollectionIntegrateRequest
): Promise<CollectionIntegrateResponse> {
  return request<CollectionIntegrateResponse>(
    "/api/bq/integrate-collection",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    LONG_TIMEOUT_MS
  );
}

// ─── BQ Templates API ────────────────────────────────────────────────────────

/** BQ template box definition */
export interface BQTemplateBoxAPI {
  column_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** BQ template response from API */
export interface BQTemplateAPI {
  id: string;
  owner_uid: string;
  name: string;
  boxes: BQTemplateBoxAPI[];
  permission: string;
  group: string;
  preview_file_id?: string | null;
  preview_page?: number;
  page_image_path?: string | null;
  created_at: string;
  updated_at: string;
}

/** List all BQ templates visible to current user. */
export async function listBQTemplates(): Promise<BQTemplateAPI[]> {
  return request<BQTemplateAPI[]>("/api/bq/templates/");
}

/** Upload a page image (base64 PNG) for a BQ template to Cloud Storage. */
export async function uploadBQTemplatePageImage(
  templateId: string,
  base64Png: string
): Promise<{ path: string; template_id: string }> {
  return request<{ path: string; template_id: string }>(
    `/api/bq/templates/${templateId}/page-image-b64`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Png }),
    }
  );
}

/** Get a (signed) URL for the page image of a BQ template. */
export async function getBQTemplatePageImageUrl(
  templateId: string
): Promise<{ url: string; source: string }> {
  return request<{ url: string; source: string }>(
    `/api/bq/templates/${templateId}/page-image`
  );
}

/** Create a new BQ template. */
export async function createBQTemplate(
  name: string,
  boxes: BQTemplateBoxAPI[],
  permission: string = "personal",
  group?: string,
  previewFileId?: string | null,
  previewPage?: number
): Promise<BQTemplateAPI> {
  return request<BQTemplateAPI>("/api/bq/templates/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      name, 
      boxes, 
      permission, 
      group,
      preview_file_id: previewFileId,
      preview_page: previewPage ?? 0,
    }),
  });
}

/** Update a BQ template. */
export async function updateBQTemplate(
  templateId: string,
  data: {
    name?: string;
    boxes?: BQTemplateBoxAPI[];
    permission?: string;
    group?: string;
    preview_file_id?: string | null;
    preview_page?: number;
  }
): Promise<BQTemplateAPI> {
  return request<BQTemplateAPI>(`/api/bq/templates/${templateId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Delete a BQ template. */
export async function deleteBQTemplate(
  templateId: string
): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/api/bq/templates/${templateId}`, {
    method: "DELETE",
  });
}
