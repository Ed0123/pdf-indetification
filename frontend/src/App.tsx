import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Toolbar } from "./components/Toolbar";
import { PDFTreeView } from "./components/PDFTreeView";
import { DataTable } from "./components/DataTable";
import { PDFViewer } from "./components/PDFViewer";
import { StatusBar } from "./components/StatusBar";
import { TemplateModal } from "./components/TemplateModal";
import { PDFExportModal } from "./components/PDFExportModal";
import { PageSelectorModal } from "./components/PageSelectorModal";
import { SinglePageDataTable } from "./components/SinglePageDataTable";
import { LoginPage } from "./components/LoginPage";
import { MyAccountPage } from "./components/MyAccountPage";
import { AdminPanel } from "./components/AdminPanel";
import { CloudProjectsPanel } from "./components/CloudProjectsPanel";
import { ActivityBar, type ModuleId } from "./components/ActivityBar";
import { BQOCRPanel } from "./components/BQOCRPanel";
import { BQExportPanel } from "./components/BQExportPanel";
import { TemplateManagerPanel } from "./components/TemplateManagerPanel";
import { ExcelExportPanel } from "./components/ExcelExportPanel";
import { PDFExportPanel } from "./components/PDFExportPanel";
import { HomePanel } from "./components/HomePanel";
import { FeedbackButton } from "./components/FeedbackButton";
import type { SelectedPage } from "./components/PageSelectorModal";
import { useProject } from "./hooks/useProject";
import { useAuth } from "./hooks/useAuth";
import { saveDraft } from "./storage/localDraft";
import type { DraftPayload } from "./storage/localDraft";
import type { PDFFileInfo, PageData, StatusInfo, Template, TemplateBox, BoxInfo, BQPageData, BQRow, BQTemplate } from "./types";
import type { UserProfile } from "./types/user";
import type { ExportPageEntry } from "./components/PDFExportModal";
import {
  uploadPDFs,
  exportExcel,
  exportPdfPages,
  extractText,
  getOcrStatus,
  installTokenProvider,
  getMyProfile,
  updateMyProfile,
  listAllUsers,
  adminUpdateUser,
  adminResetUsage,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  recordUsage,
  listCloudTemplates,
  installMissingFileHandler,
  restoreMissingPdfFromCurrentWorkspace,
  getWorkspaceStartup,
  ensureCurrentWorkspaceProject,
  loadCurrentWorkspaceProject,
  backupCurrentWorkspace,
  backupCurrentWorkspaceDiff,
  resetCurrentWorkspace,
  listSystemUpdates,
  createSystemUpdate,
  deleteSystemUpdate,
  createCloudTemplate,
  updateCloudTemplate,
  deleteCloudTemplate,
  uploadTemplatePageImage,
  uploadBQTemplatePageImage,
  renderPage,
  listBQTemplates,
  createBQTemplate,
  updateBQTemplate,
  deleteBQTemplate,
} from "./api/client";
import type { GroupItem, TierItem, ServerFileInfo, CloudTemplate, BQTemplateAPI, CloudProjectItem, SystemUpdateItem, WorkspaceBackupDiffPatch } from "./api/client";

// Route views
type AppView = "login" | "account" | "admin" | "main";
type BackupMode = "manual" | "smart" | "aggressive";

const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const formatMoney = (value: number): string => round2(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatQuantity = (value: number): string => value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function App() {
  const project = useProject();
  const { state } = project;
  const auth = useAuth();

  // App routing — in DEV_MODE, skip straight to "main"
  const [view, setView] = useState<AppView>(IS_DEV_MODE ? "main" : "login");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [adminUsers, setAdminUsers] = useState<UserProfile[]>([]);
  const [adminGroups, setAdminGroups] = useState<GroupItem[]>([]);
  const [adminTiers, setAdminTiers] = useState<TierItem[]>([]);

  // Usage tracking
  const [usagePages, setUsagePages] = useState(0);
  const [usageLimit, setUsageLimit] = useState<number>(-1);
  const [systemUpdates, setSystemUpdates] = useState<SystemUpdateItem[]>([]);
  const [startupCurrent, setStartupCurrent] = useState<CloudProjectItem | null>(null);
  const [hasCurrentData, setHasCurrentData] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [backupMode, setBackupMode] = useState<BackupMode>("smart");
  const [backupStatus, setBackupStatus] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [backupWrites, setBackupWrites] = useState(0);
  const [backupSkips, setBackupSkips] = useState(0);
  const [localSnapshotAt, setLocalSnapshotAt] = useState<string | null>(null);
  const lastBackupSignatureRef = useRef<string>("");
  const lastBackedPayloadRef = useRef<any | null>(null);

  // Global error toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 6000);
  }, []);

  // Profile loading gate
  const [profileLoading, setProfileLoading] = useState(false);

  // reset blob cache when user logs out
  useEffect(() => {
    if (!auth.user) {
      pdfBlobsRef.current = {};
    }
  }, [auth.user]);

  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusInfo>({ message: "Ready", progress: null, ocr_available: false });
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showRecognizeSelector, setShowRecognizeSelector] = useState(false);
  const [showCloudProjects, setShowCloudProjects] = useState(false);

  // Collapsible panels
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [dataTableCollapsed, setDataTableCollapsed] = useState(false);

  // Resizable panels
  const [dataTableHeight, setDataTableHeight] = useState(50); // percentage
  const [contentWidth, setContentWidth] = useState(48); // percentage

  // Activity bar module selection
  const [activeModule, setActiveModuleRaw] = useState<ModuleId>("home");
  // Reset drawing state when switching modules
  const setActiveModule = useCallback((m: ModuleId) => {
    setActiveModuleRaw(m);
    setSelectedColumn(null);
    setHighlightBox(null);
  }, []);

  // BQ (Bill of Quantities) state
  const [bqPageData, setBqPageData] = useState<Record<string, BQPageData>>({});
  const [bqTemplates, setBqTemplates] = useState<BQTemplate[]>([]);
  
  // Highlight box for BQ row navigation (absolute PDF coords)
  const [highlightBox, setHighlightBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // PDF page dimensions for coordinate conversion
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  // Show/hide BQ text overlays on PDF viewer
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [globalBusy, setGlobalBusy] = useState<{ active: boolean; message: string }>({
    active: false,
    message: "Processing...",
  });
  const busyCountRef = useRef(0);

  const beginGlobalBusy = useCallback((message: string) => {
    busyCountRef.current += 1;
    setGlobalBusy({ active: true, message });
  }, []);

  const endGlobalBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1);
    if (busyCountRef.current === 0) {
      setGlobalBusy((prev) => ({ ...prev, active: false }));
    }
  }, []);

  const handleChildBusyChange = useCallback((busy: boolean, message?: string) => {
    if (busy) {
      setGlobalBusy({ active: true, message: message || "Processing..." });
      return;
    }
    if (busyCountRef.current === 0) {
      setGlobalBusy((prev) => ({ ...prev, active: false }));
    }
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // map from server file_id → original File (for draft persistence/restore)
  const pdfBlobsRef = useRef<Record<string, File>>({});

  // --------------------------------------------------------------------------
  // Auth flow — consolidated into a single effect to avoid race conditions
  // --------------------------------------------------------------------------

  // Install token providers into API client (once) and register expiry callback
  useEffect(() => {
    if (IS_DEV_MODE) return;
    const handleAuthExpired = () => {
      // silent sign‑out on backend session expiry
      showError("登入已過期，請重新登入。");
      auth.signOut().catch(() => {});
      setView("login");
    };
    installTokenProvider(auth.getToken, auth.getTokenFresh, handleAuthExpired);

    // missing-file handler will attempt to re-upload using cached blob
    installMissingFileHandler(async (oldId) => {
      const blob = pdfBlobsRef.current[oldId];
      if (blob) {
        try {
          const infos = await uploadPDFs([blob]);
          if (infos && infos[0]) {
            const newInfo = serverInfoToFileInfo(infos[0]);
            // merge old page data
            const oldFile = project.state.pdf_files.find((f) => f.file_id === oldId);
            if (oldFile) {
              newInfo.pages = newInfo.pages.map((p, idx) => {
                const oldPage = oldFile.pages[idx];
                return oldPage ? { ...p, extracted_data: oldPage.extracted_data, boxes: oldPage.boxes } : p;
              });
            }
            project.replaceFile(oldId, newInfo);
            // keep blob under new id too
            pdfBlobsRef.current[infos[0].file_id] = blob;
            delete pdfBlobsRef.current[oldId];
            return infos[0].file_id;
          }
        } catch (err) {
          console.warn("reupload failed for", oldId, err);
        }
      }

      // Fallback: recover from current cloud workspace backup.
      try {
        const restored = await restoreMissingPdfFromCurrentWorkspace(oldId);
        if (restored?.file_id) {
          const newInfo = serverInfoToFileInfo(restored);
          const oldFile = project.state.pdf_files.find((f) => f.file_id === oldId);
          if (oldFile) {
            newInfo.pages = newInfo.pages.map((p, idx) => {
              const oldPage = oldFile.pages[idx];
              return oldPage ? { ...p, extracted_data: oldPage.extracted_data, boxes: oldPage.boxes } : p;
            });
          }
          project.replaceFile(oldId, newInfo);
          return restored.file_id;
        }
      } catch (err) {
        console.warn("cloud restore failed for", oldId, err);
      }
      return null;
    });
  }, [auth.getToken, auth.getTokenFresh, auth, showError]);

  // After auth state resolves, fetch profile (single consolidated effect)
  useEffect(() => {
    if (IS_DEV_MODE) return;
    if (auth.loading) return;
    if (!auth.user) {
      setView("login");
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    // Profile fetch — guaranteed token is fresh via installTokenProvider
    setProfileLoading(true);
    getMyProfile()
      .then((p) => {
        setProfile(p);
        setUsagePages(p.usage_pages ?? 0);
        const firstTime = !p.salutation && !p.whatsapp;
        setIsNewUser(firstTime);
        if (firstTime || p.status !== "active") {
          setView("account");
        } else {
          setView("main");
          setActiveModuleRaw("home");
        }
        // Fetch usage limit (quota check with 0 pages)
        recordUsage(0)
          .then((r) => { setUsagePages(r.usage_pages); setUsageLimit(r.limit); })
          .catch(() => {});
      })
      .catch((err) => {
        showError(`載入個人資料失敗：${err.message || err}`);
        setView("account");
      })
      .finally(() => setProfileLoading(false));
  }, [auth.user, auth.loading]);

  // Check OCR on mount
  useEffect(() => {
    getOcrStatus()
      .then((available) => setStatus((s) => ({ ...s, ocr_available: available })))
      .catch((err) => {
        console.warn("OCR status check failed:", err);
        setStatus((s) => ({ ...s, ocr_available: false }));
      });
  }, []);

  // ------------------------------------------------------------------------
  // Keep‑alive & idle‑logout
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!auth.user) return;

    // periodic ping to keep Firebase token fresh even if tab is backgrounded
    const keepalive = setInterval(() => {
      // use the light recordUsage call so we also refresh quota
      recordUsage(0).catch(() => {});
    }, 30 * 60 * 1000); // every 30 minutes

    // idle logout after 6 hours of no interaction
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        showError("閒置超過 6 小時，請重新登入。");
        auth.signOut().catch(() => {});
        setView("login");
      }, 6 * 60 * 60 * 1000); // 6h
    };
    const events = ["mousemove", "keydown", "mousedown", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, scheduleIdle));
    scheduleIdle();

    return () => {
      clearInterval(keepalive);
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, scheduleIdle));
    };
  }, [auth.user, showError, auth]);

  // --------------------------------------------------------------------------
  // IndexedDB autosave — debounced, saves every 5 seconds of inactivity
  // --------------------------------------------------------------------------

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const backupPrefsKey = auth.user ? `backupPrefs:${auth.user.uid}` : null;
  const backupStatsKey = auth.user ? `backupStats:${auth.user.uid}` : null;
  const localSnapshotKey = auth.user ? `localSnapshot:${auth.user.uid}` : null;

  useEffect(() => {
    const uid = auth.user?.uid;
    if (!uid || state.pdf_files.length === 0) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const payload: DraftPayload = {
        pdf_files: state.pdf_files.map((f) => ({
          ...f,
          pages: f.pages.map((p) => ({
            ...p,
            boxes: Object.values(p.boxes),
          })),
        })),
        columns: state.columns,
        templates: state.templates,
        last_selected_file: state.selected_file_id ?? "",
        last_selected_page: state.selected_page,
        pdf_blobs: { ...pdfBlobsRef.current },
        bq_page_data: bqPageData,
        bq_templates: bqTemplates,
      };
      saveDraft(uid, payload).catch(() => {});
    }, 5000);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [state.pdf_files, state.columns, state.templates, state.selected_file_id, state.selected_page, auth.user, bqPageData, bqTemplates]);

  // Startup workflow data for Home (current session + update feed)
  useEffect(() => {
    if (IS_DEV_MODE) return;
    if (!auth.user || view !== "main") return;

    getWorkspaceStartup()
      .then((info) => {
        setStartupCurrent(info.current_project ?? null);
        setHasCurrentData(Boolean(info.has_current_data));
        if (info.current_project?.last_backup_at) {
          setBackupAt(info.current_project.last_backup_at);
        }
        if (info.current_project?.backup_status) {
          setBackupStatus(info.current_project.backup_status);
        }
      })
      .catch((err) => {
        console.warn("Failed to load startup workspace info", err);
      });

    listSystemUpdates()
      .then((items) => setSystemUpdates(items))
      .catch((err) => console.warn("Failed to load system updates", err));
  }, [view, auth.user]);

  // --------------------------------------------------------------------------
  // Cloud template sync — load from Firestore on login
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (IS_DEV_MODE) return;
    if (view !== "main" || !auth.user) return;
    loadCloudTemplates();
    loadCloudBQTemplates();
  }, [view, auth.user]);

  const loadCloudTemplates = async () => {
    try {
      const cloudList = await listCloudTemplates();
      const localTemplates: Template[] = cloudList.map(cloudToLocal);
      project.saveTemplates(localTemplates);
    } catch (err) {
      console.warn("Failed to load cloud templates:", err);
    }
  };

  const loadCloudBQTemplates = async () => {
    try {
      const cloudList = await listBQTemplates();
      const localBQTemplates: BQTemplate[] = cloudList.map(bqCloudToLocal);
      setBqTemplates(localBQTemplates);
    } catch (err) {
      console.warn("Failed to load cloud BQ templates:", err);
    }
  };

  /** Convert Cloud BQ Template → local BQTemplate type */
  const bqCloudToLocal = (ct: BQTemplateAPI): BQTemplate => ({
    id: ct.id,
    name: ct.name,
    boxes: (ct.boxes ?? []).map((b) => ({
      column_name: b.column_name,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: b.color || "#2980b9",
    })),
    notes: "",
    preview_file_id: ct.preview_file_id ?? null,
    preview_page: ct.preview_page ?? 0,
    owner_uid: ct.owner_uid,
    permission: ct.permission,
    group: ct.group,
    // store path even though UI doesn't use it directly
    // (could be useful for debugging)
    page_image_path: ct.page_image_path ?? null as any,
  });

  /** Convert Cloud → local Template type */
  const cloudToLocal = (ct: CloudTemplate): Template => ({
    id: ct.id,
    name: ct.name,
    boxes: (ct.boxes ?? []).map((b) => ({
      column_name: b.column_name,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: b.color || "#2980b9",
    })),
    notes: ct.notes ?? "",
    preview_file_id: null,
    preview_page: 0,
    owner_uid: ct.owner_uid,
    owner_name: ct.owner_uid === auth.user?.uid ? "我" : "他人",
  });

  /** Render current PDF page to base64 and upload to Cloud Storage for a template. */
  const uploadCurrentPageImageForTemplate = async (templateId: string) => {
    if (!state.selected_file_id) return;
    try {
      const b64 = await renderPage(state.selected_file_id, state.selected_page, 1.5);
      await uploadTemplatePageImage(templateId, b64);
    } catch (err) {
      console.warn("Failed to upload page image for template:", err);
    }
  };

  /** Same as above but for BQ templates. */
  const uploadCurrentPageImageForBQTemplate = async (templateId: string) => {
    if (!state.selected_file_id) return;
    try {
      const b64 = await renderPage(state.selected_file_id, state.selected_page, 1.5);
      await uploadBQTemplatePageImage(templateId, b64);
    } catch (err) {
      console.warn("Failed to upload page image for BQ template:", err);
    }
  };

  const setMsg = (message: string, progress: number | null = null) =>
    setStatus((s) => ({ ...s, message, progress }));

  // --------------------------------------------------------------------------
  // Auth handlers
  // --------------------------------------------------------------------------

  const handleGoogleSignIn = async () => {
    try {
      await auth.signInWithGoogle();
    } catch (err: any) {
      // User closed the popup or other error
      if (err?.code !== "auth/popup-closed-by-user") {
        showError(`登入失敗：${err.message || err}`);
      }
    }
  };

  const handleSignOut = async () => {
    if (state.pdf_files.length > 0) {
      const ok = window.confirm("您有未儲存的工作，確定要登出嗎？");
      if (!ok) return;
    }
    await auth.signOut();
    setProfile(null);
    setView("login");
  };

  const handleSaveProfile = async (updates: Partial<UserProfile>) => {
    try {
      const updated = await updateMyProfile(updates as any);
      setProfile(updated);
      setIsNewUser(false);
      // If status is now active, allow going to main
      if (updated.status === "active") {
        setView("main");
        setActiveModuleRaw("home");
      }
    } catch (err: any) {
      showError(`儲存個人資料失敗：${err.message || err}`);
    }
  };

  const handleOpenAdmin = async () => {
    try {
      const [users, groups, tiers] = await Promise.all([listAllUsers(), listGroups(), listTiers()]);
      setAdminUsers(users);
      setAdminGroups(groups);
      setAdminTiers(tiers);
      setView("admin");
    } catch (err: any) {
      showError(`載入管理員面板失敗：${err.message || err}`);
    }
  };

  const handleAdminUpdateUser = async (uid: string, changes: Partial<UserProfile>) => {
    try {
      await adminUpdateUser(uid, changes as any);
      const users = await listAllUsers();
      setAdminUsers(users);
    } catch (err: any) {
      showError(`更新用戶失敗：${err.message || err}`);
    }
  };

  const handleAdminResetUsage = async (uid: string) => {
    try {
      await adminResetUsage(uid);
      const users = await listAllUsers();
      setAdminUsers(users);
    } catch (err: any) {
      showError(`重置用量失敗：${err.message || err}`);
    }
  };

  const refreshAdminData = async () => {
    const [users, groups, tiers] = await Promise.all([listAllUsers(), listGroups(), listTiers()]);
    setAdminUsers(users);
    setAdminGroups(groups);
    setAdminTiers(tiers);
  };

  const handleCreateGroup = async (name: string) => {
    try {
      await createGroup(name);
      await refreshAdminData();
    } catch (err: any) {
      showError(`建立群組失敗：${err.message || err}`);
    }
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    try {
      await renameGroup(groupId, name);
      await refreshAdminData();
    } catch (err: any) {
      showError(`重命名群組失敗：${err.message || err}`);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteGroup(groupId);
      await refreshAdminData();
    } catch (err: any) {
      showError(`刪除群組失敗：${err.message || err}`);
    }
  };

  const handleCreateTier = async (data: { name: string; label: string; quota: number; storage_quota_mb?: number; project_size_mb?: number; features?: Record<string, boolean> }) => {
    try {
      await createTier(data);
      await refreshAdminData();
    } catch (err: any) {
      showError(`建立類別失敗：${err.message || err}`);
    }
  };

  const handleUpdateTier = async (tierId: string, data: { name?: string; label?: string; quota?: number; storage_quota_mb?: number; project_size_mb?: number; features?: Record<string, boolean> }) => {
    try {
      await updateTier(tierId, data);
      await refreshAdminData();
    } catch (err: any) {
      showError(`更新類別失敗：${err.message || err}`);
    }
  };

  const handleDeleteTier = async (tierId: string) => {
    try {
      await deleteTier(tierId);
      await refreshAdminData();
    } catch (err: any) {
      showError(`刪除類別失敗：${err.message || err}`);
    }
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  const buildProjectPayload = useCallback(() => ({
    pdf_files: state.pdf_files.map((f) => ({
      ...f,
      pages: f.pages.map((p) => ({
        ...p,
        boxes: Object.values(p.boxes),
      })),
    })),
    columns: state.columns,
    templates: state.templates,
    last_selected_file: state.selected_file_id ?? "",
    last_selected_page: state.selected_page,
    // BQ OCR state — persisted for cloud restore
    bq_page_data: bqPageData,
    bq_templates: bqTemplates,
  }), [state.pdf_files, state.columns, state.templates, state.selected_file_id, state.selected_page, bqPageData, bqTemplates]);

  const buildBackupDiffPatch = useCallback((prevPayload: any, nextPayload: any): WorkspaceBackupDiffPatch | null => {
    const asStr = (v: any) => JSON.stringify(v ?? null);
    const patch: WorkspaceBackupDiffPatch = {};

    const setFields: Record<string, any> = {};
    const scalarOrSmallKeys = [
      "columns",
      "templates",
      "last_selected_file",
      "last_selected_page",
      "bq_templates",
    ];
    for (const key of scalarOrSmallKeys) {
      if (asStr(prevPayload?.[key]) !== asStr(nextPayload?.[key])) {
        setFields[key] = nextPayload?.[key];
      }
    }
    if (Object.keys(setFields).length > 0) {
      patch.set_fields = setFields;
    }

    const prevFiles: Map<string, any> = new Map((prevPayload?.pdf_files ?? []).map((f: any) => [f.file_id, f]));
    const nextFiles: Map<string, any> = new Map((nextPayload?.pdf_files ?? []).map((f: any) => [f.file_id, f]));

    const removeFileIds: string[] = [];
    prevFiles.forEach((_, fid) => {
      if (!nextFiles.has(fid)) removeFileIds.push(fid);
    });
    if (removeFileIds.length > 0) {
      patch.remove_file_ids = removeFileIds;
    }

    const upsertFiles: any[] = [];
    const upsertPages: Array<{ file_id: string; page_number: number; page: any }> = [];

    nextFiles.forEach((nextFile, fid) => {
      const prevFile = prevFiles.get(fid);
      if (!prevFile) {
        upsertFiles.push(nextFile);
        return;
      }

      const nextMeta = {
        file_id: nextFile.file_id,
        file_name: nextFile.file_name,
        num_pages: nextFile.num_pages,
        file_size: nextFile.file_size,
      };
      const prevMeta = {
        file_id: prevFile.file_id,
        file_name: prevFile.file_name,
        num_pages: prevFile.num_pages,
        file_size: prevFile.file_size,
      };

      if (asStr(nextMeta) !== asStr(prevMeta)) {
        upsertFiles.push(nextFile);
        return;
      }

      const prevPages = new Map((prevFile.pages ?? []).map((p: any) => [p.page_number, p]));
      const nextPages = nextFile.pages ?? [];
      if ((prevFile.pages ?? []).length !== nextPages.length) {
        upsertFiles.push(nextFile);
        return;
      }

      let changedPageCount = 0;
      for (const page of nextPages) {
        const oldPage = prevPages.get(page.page_number);
        if (!oldPage || asStr(oldPage) !== asStr(page)) {
          upsertPages.push({ file_id: fid, page_number: page.page_number, page });
          changedPageCount += 1;
        }
      }

      // If many pages changed in the same file, replacing file payload is cheaper.
      if (changedPageCount > 0 && changedPageCount >= Math.ceil(nextPages.length / 2)) {
        upsertFiles.push(nextFile);
      }
    });

    if (upsertFiles.length > 0) {
      patch.upsert_files = upsertFiles;
    }

    if (upsertPages.length > 0) {
      const fullReplaceIds = new Set((patch.upsert_files ?? []).map((f: any) => f.file_id));
      patch.upsert_pages = upsertPages.filter((p) => !fullReplaceIds.has(p.file_id));
      if ((patch.upsert_pages ?? []).length === 0) {
        delete patch.upsert_pages;
      }
    }

    const prevBq = prevPayload?.bq_page_data ?? {};
    const nextBq = nextPayload?.bq_page_data ?? {};
    const bqUpsert: Record<string, any> = {};
    const bqRemove: string[] = [];

    for (const key of Object.keys(nextBq)) {
      if (asStr(prevBq[key]) !== asStr(nextBq[key])) {
        bqUpsert[key] = nextBq[key];
      }
    }
    for (const key of Object.keys(prevBq)) {
      if (!(key in nextBq)) {
        bqRemove.push(key);
      }
    }

    if (Object.keys(bqUpsert).length > 0) {
      patch.bq_page_data_upsert = bqUpsert;
    }
    if (bqRemove.length > 0) {
      patch.bq_page_data_remove = bqRemove;
    }

    const hasData =
      (patch.set_fields && Object.keys(patch.set_fields).length > 0) ||
      (patch.upsert_files && patch.upsert_files.length > 0) ||
      (patch.remove_file_ids && patch.remove_file_ids.length > 0) ||
      (patch.upsert_pages && patch.upsert_pages.length > 0) ||
      (patch.bq_page_data_upsert && Object.keys(patch.bq_page_data_upsert).length > 0) ||
      (patch.bq_page_data_remove && patch.bq_page_data_remove.length > 0);

    return hasData ? patch : null;
  }, []);

  const localSnapshotSizeBytes = useMemo(() => {
    try {
      return new Blob([JSON.stringify(buildProjectPayload())]).size;
    } catch {
      return 0;
    }
  }, [buildProjectPayload]);

  const refreshHomeData = useCallback(async () => {
    try {
      const info = await getWorkspaceStartup();
      setStartupCurrent(info.current_project ?? null);
      setHasCurrentData(Boolean(info.has_current_data));
      if (info.current_project?.backup_status) setBackupStatus(info.current_project.backup_status);
      if (info.current_project?.last_backup_at) setBackupAt(info.current_project.last_backup_at);
    } catch (err) {
      console.warn("refreshHomeData failed", err);
    }
    try {
      const items = await listSystemUpdates();
      setSystemUpdates(items);
    } catch (err) {
      console.warn("listSystemUpdates failed", err);
    }
  }, []);

  const handleCreateSystemUpdate = useCallback(async (heading: string, content: string) => {
    await createSystemUpdate(heading, content);
    await refreshHomeData();
  }, [refreshHomeData]);

  const handleDeleteSystemUpdate = useCallback(async (id: string) => {
    await deleteSystemUpdate(id);
    await refreshHomeData();
  }, [refreshHomeData]);

  const handleResumeLastSession = useCallback(async () => {
    beginGlobalBusy("正在載入上次工作階段...");
    try {
      const data = await loadCurrentWorkspaceProject();
      if (data?.empty) {
        setMsg("沒有可恢復的上次工作階段");
        return;
      }
      project.loadProject(data);
      setBqPageData(data.bq_page_data ?? {});
      setBqTemplates(data.bq_templates ?? []);
      setHighlightBox(null);
      setPdfPageSize(null);
      lastBackedPayloadRef.current = null;
      setMsg("已回到上次工作階段");
      setActiveModuleRaw("singlepage");
    } catch (err: any) {
      showError(`載入上次工作階段失敗：${err.message || err}`);
    } finally {
      endGlobalBusy();
    }
  }, [beginGlobalBusy, endGlobalBusy, project, showError]);

  const handleStartNewSession = useCallback(async () => {
    const ok = window.confirm("要開新工作嗎？目前畫面資料會清空，並建立新的 Current Project。");
    if (!ok) return;
    beginGlobalBusy("正在建立新工作階段...");
    try {
      await resetCurrentWorkspace(`Current Project ${new Date().toLocaleDateString()}`);
      project.loadProject({
        pdf_files: [],
        columns: [{ name: "Title", visible: true }, { name: "Page Name", visible: true }],
        templates: [],
        selected_file_id: null,
        selected_page: 0,
      } as any);
      setBqPageData({});
      setBqTemplates([]);
      lastBackedPayloadRef.current = null;
      setMsg("已開啟新工作");
      await refreshHomeData();
    } catch (err: any) {
      showError(`建立新工作失敗：${err.message || err}`);
    } finally {
      endGlobalBusy();
    }
  }, [beginGlobalBusy, endGlobalBusy, project, refreshHomeData, showError]);

  const runAutoBackup = useCallback(async (reason: string) => {
    if (!auth.user) return;
    if (!backupEnabled) return;
    if ((profile?.tier_features?.auto_backup ?? false) !== true) return;
    if (backupMode === "manual" && reason !== "manual") return;
    if (backupMode === "smart" && reason === "upload") return;

    const payload = buildProjectPayload();
    const signature = JSON.stringify({
      files: payload.pdf_files.map((f: any) => ({ id: f.file_id, size: f.file_size, pages: f.pages.length })),
      columns: payload.columns,
      templates: payload.templates,
      bq_page_data: payload.bq_page_data,
      bq_templates: payload.bq_templates,
    });

    if (signature === lastBackupSignatureRef.current) {
      setBackupSkips((prev) => prev + 1);
      return;
    }

    setBackupStatus("running");
    try {
      await ensureCurrentWorkspaceProject();
      const prevPayload = lastBackedPayloadRef.current;
      let saved: CloudProjectItem;
      if (prevPayload) {
        const patch = buildBackupDiffPatch(prevPayload, payload);
        if (patch) {
          try {
            saved = await backupCurrentWorkspaceDiff(patch);
          } catch (err: any) {
            // Fallback for transient/API mismatch cases.
            console.warn("diff backup failed, fallback to full backup", err);
            saved = await backupCurrentWorkspace(payload);
          }
        } else {
          setBackupSkips((prev) => prev + 1);
          setBackupStatus("ok");
          return;
        }
      } else {
        saved = await backupCurrentWorkspace(payload);
      }
      lastBackupSignatureRef.current = signature;
      lastBackedPayloadRef.current = payload;
      setBackupWrites((prev) => prev + 1);
      setBackupStatus("ok");
      setBackupAt(saved.last_backup_at || new Date().toISOString());
      setStartupCurrent(saved);
      setHasCurrentData(Boolean(saved.project_json_path));
      setMsg(reason === "timer" ? "已自動備份工作階段" : "已更新 Current Project");
    } catch (err: any) {
      setBackupStatus("error");
      console.warn("auto backup failed", err);
    }
  }, [auth.user, backupEnabled, profile?.tier_features, buildProjectPayload, backupMode, buildBackupDiffPatch]);

  const saveLocalSnapshot = useCallback(() => {
    if (!localSnapshotKey) return;
    const payload = buildProjectPayload();
    const savedAt = new Date().toISOString();
    try {
      localStorage.setItem(localSnapshotKey, JSON.stringify({ ...payload, saved_at: savedAt }));
      setLocalSnapshotAt(savedAt);
    } catch (err: any) {
      showError(`本機快照儲存失敗：${err?.message || err}`);
    }
  }, [buildProjectPayload, localSnapshotKey, showError]);

  const handleManualBackup = useCallback(async () => {
    await runAutoBackup("manual");
  }, [runAutoBackup]);

  const handleRestoreLocalSnapshot = useCallback(() => {
    if (!localSnapshotKey) return;
    const raw = localStorage.getItem(localSnapshotKey);
    if (!raw) {
      setMsg("沒有可恢復的本機快照");
      return;
    }
    try {
      const data = JSON.parse(raw);
      project.loadProject(data);
      setBqPageData(data.bq_page_data ?? {});
      setBqTemplates(data.bq_templates ?? []);
      setHighlightBox(null);
      setPdfPageSize(null);
      setMsg("已從本機快照恢復");
      setActiveModuleRaw("singlepage");
    } catch (err: any) {
      showError(`本機快照格式錯誤：${err?.message || err}`);
    }
  }, [localSnapshotKey, project, showError]);

  useEffect(() => {
    if (!backupPrefsKey) return;
    const raw = localStorage.getItem(backupPrefsKey);
    if (!raw) return;
    try {
      const prefs = JSON.parse(raw) as { enabled?: boolean; mode?: BackupMode };
      if (typeof prefs.enabled === "boolean") setBackupEnabled(prefs.enabled);
      if (prefs.mode === "manual" || prefs.mode === "smart" || prefs.mode === "aggressive") {
        setBackupMode(prefs.mode);
      }
    } catch {
      // ignore malformed local preference
    }
  }, [backupPrefsKey]);

  useEffect(() => {
    if (!backupPrefsKey) return;
    localStorage.setItem(backupPrefsKey, JSON.stringify({ enabled: backupEnabled, mode: backupMode }));
  }, [backupEnabled, backupMode, backupPrefsKey]);

  useEffect(() => {
    if (!backupStatsKey) return;
    const raw = localStorage.getItem(backupStatsKey);
    if (!raw) return;
    try {
      const stats = JSON.parse(raw) as { writes?: number; skips?: number; localSnapshotAt?: string | null };
      if (typeof stats.writes === "number") setBackupWrites(stats.writes);
      if (typeof stats.skips === "number") setBackupSkips(stats.skips);
      if (typeof stats.localSnapshotAt === "string") setLocalSnapshotAt(stats.localSnapshotAt);
    } catch {
      // ignore malformed local stats
    }
  }, [backupStatsKey]);

  useEffect(() => {
    if (!backupStatsKey) return;
    localStorage.setItem(
      backupStatsKey,
      JSON.stringify({ writes: backupWrites, skips: backupSkips, localSnapshotAt: localSnapshotAt ?? null })
    );
  }, [backupStatsKey, backupWrites, backupSkips, localSnapshotAt]);

  useEffect(() => {
    if (view !== "main" || !auth.user) return;
    if (backupMode === "manual") return;
    const intervalMs = backupMode === "aggressive" ? 5 * 60 * 1000 : 15 * 60 * 1000;
    const timer = setInterval(() => {
      runAutoBackup("timer").catch(() => {});
    }, intervalMs);
    return () => clearInterval(timer);
  }, [view, auth.user, runAutoBackup, backupMode]);

  useEffect(() => {
    if (view !== "main" || !auth.user) return;
    const timer = setInterval(() => {
      saveLocalSnapshot();
    }, 3 * 60 * 1000);
    return () => clearInterval(timer);
  }, [view, auth.user, saveLocalSnapshot]);

  useEffect(() => {
    const onBeforeUnload = () => {
      saveLocalSnapshot();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveLocalSnapshot]);

  const serverInfoToFileInfo = (info: ServerFileInfo): PDFFileInfo => ({
    file_id: info.file_id,
    file_name: info.file_name,
    num_pages: info.num_pages,
    file_size: info.file_size,
    pages: info.pages.map((p) => ({
      page_number: p.page_number,
      extracted_data: Object.fromEntries(state.columns.map((c) => [c.name, ""])),
      boxes: {},
    })) as PageData[],
  });

  const totalPages = state.pdf_files.reduce((s, f) => s + f.pages.length, 0);

  // --------------------------------------------------------------------------
  // Toolbar handlers
  // --------------------------------------------------------------------------

  const handleImport = () => fileInputRef.current?.click();

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.name.endsWith(".pdf"));
    if (!files.length) return;

    const projectLimitMb = profile?.project_size_mb ?? 200;
    if (projectLimitMb !== -1) {
      const currentBytes = state.pdf_files.reduce((sum, f) => sum + (f.file_size || 0), 0);
      const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
      const limitBytes = projectLimitMb * 1024 * 1024;
      if (currentBytes + incomingBytes > limitBytes) {
        showError(`超過每專案大小上限（${projectLimitMb} MB），請減少上傳檔案或開新工作。`);
        e.target.value = "";
        return;
      }
    }

    setMsg("Uploading PDFs...", 10);
    beginGlobalBusy("Uploading PDF files...");
    try {
      const infos = await uploadPDFs(files);
      const fileInfos = infos.map(serverInfoToFileInfo);
      project.addFiles(fileInfos);
      // remember the original blobs so we can persist them in drafts
      infos.forEach((info, idx) => {
        pdfBlobsRef.current[info.file_id] = files[idx];
      });
      setMsg(`Imported ${fileInfos.length} file(s)`, null);
      saveLocalSnapshot();
      await runAutoBackup("upload");
    } catch (err) {
      setMsg(`Import error: ${err}`, null);
    } finally {
      endGlobalBusy();
    }
    e.target.value = "";
  };


  // file deletion is triggered from the PDF tree view now
  const handleDeleteFile = (fileId: string) => {
    // Purge per-file transient data so viewer/export state does not leak
    // into the next imported PDF session.
    setBqPageData((prev) => {
      const next: Record<string, BQPageData> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(`${fileId}-`)) next[k] = v;
      }
      return next;
    });
    delete pdfBlobsRef.current[fileId];
    setHighlightBox(null);
    setPdfPageSize(null);
    project.deleteFiles([fileId]);
    setMsg("File deleted");
  };

  const handleExportExcel = async () => {
    setMsg("Exporting to Excel...", 50);
    beginGlobalBusy("Exporting to Excel...");
    try {
      await exportExcel(buildProjectPayload());
      setMsg("Exported successfully");
    } catch (err) {
      setMsg(`Export error: ${err}`);
    } finally {
      endGlobalBusy();
    }
  };

  // Switch to templates module when clicking toolbar Templates button
  const handleManageTemplates = () => setActiveModule("templates");

  const handleExportPdf = () => {
    if (!state.pdf_files.length) return;
    setShowExportModal(true);
  };

  const handleTemplateSave = async (templates: Template[]) => {
    if (IS_DEV_MODE) {
      project.saveTemplates(templates);
      return;
    }

    const prev = state.templates;
    const prevIds = new Set(prev.map((t) => t.id));
    const nextIds = new Set(templates.map((t) => t.id));

    // ── Deletions: in prev but not in next ──
    const deletePromises = prev
      .filter((old) => !nextIds.has(old.id))
      .map((old) =>
        deleteCloudTemplate(old.id).catch((err) =>
          console.warn("Cloud delete failed:", old.id, err)
        )
      );
    await Promise.all(deletePromises);

    // ── Additions + updates ──
    // We'll build a final list, replacing temp IDs with cloud IDs for new templates.
    const finalTemplates = [...templates];

    for (let i = 0; i < finalTemplates.length; i++) {
      const t = finalTemplates[i];
      if (!prevIds.has(t.id)) {
        // New → create in cloud + upload page image
        try {
          const created = await createCloudTemplate({
            name: t.name,
            boxes: t.boxes,
            notes: t.notes ?? "",
          });
          // Replace temp ID with cloud ID
          finalTemplates[i] = { ...t, id: created.id };
          // Upload page image
          await uploadCurrentPageImageForTemplate(created.id);
          console.log("Cloud template created:", created.id, t.name);
        } catch (err) {
          console.warn("Cloud create failed for template:", t.name, err);
          setMsg(`Cloud sync failed for "${t.name}": ${err}`);
        }
      } else {
        // Existing → update in cloud if changed
        const prevT = prev.find((p) => p.id === t.id);
        const changed =
          prevT?.name !== t.name ||
          JSON.stringify(prevT?.boxes) !== JSON.stringify(t.boxes) ||
          prevT?.notes !== t.notes;
        if (changed) {
          try {
            await updateCloudTemplate(t.id, {
              name: t.name,
              boxes: t.boxes,
              notes: t.notes ?? "",
            });
            console.log("Cloud template updated:", t.id, t.name);
          } catch (err) {
            console.warn("Cloud update failed:", t.id, err);
          }
        }
      }
    }

    project.saveTemplates(finalTemplates);
  };

  const handleTemplateApply = (template: Template, pages: SelectedPage[]) => {
    // Task 6: Ensure all template columns exist in the project
    const existingCols = new Set(state.columns.map((c) => c.name));
    template.boxes.forEach((b: TemplateBox) => {
      if (!existingCols.has(b.column_name)) {
        project.addColumn(b.column_name);
        existingCols.add(b.column_name);
      }
    });

    const targets = pages.map((p) => ({ file_id: p.file_id, page: p.page_number }));
    targets.forEach(({ file_id, page }) => {
      template.boxes.forEach((b: TemplateBox) => {
        project.setBox(file_id, page, { column_name: b.column_name, x: b.x, y: b.y, width: b.width, height: b.height });
      });
      project.setAppliedTemplate(file_id, page, template.name);
    });
    setMsg(`Applied template "${template.name}" to ${targets.length} page(s)`);
    setShowTemplateModal(false);
  };

  const handleExportPdfConfirm = async (entries: ExportPageEntry[]) => {
    setShowExportModal(false);
    setMsg(`Exporting ${entries.length} page(s) as ZIP...`, 20);
    beginGlobalBusy(`Exporting ${entries.length} page(s) to PDF...`);
    try {
      await exportPdfPages(entries);
      setMsg(`Exported ${entries.length} PDF(s)`, null);
    } catch (err) {
      setMsg(`Export error: ${err}`);
    } finally {
      endGlobalBusy();
    }
  };

  const handleRecognizeText = () => {
    if (!state.pdf_files.length) return;
    setShowRecognizeSelector(true);
  };

  const handleRecognizeConfirm = async (pages: SelectedPage[]) => {
    setShowRecognizeSelector(false);
    if (!pages.length) return;

    beginGlobalBusy("Recognizing selected pages...");

    try {

      let done = 0;
      let failures = 0;
      const total = pages.reduce((sum, sp) => {
        const file = state.pdf_files.find((f) => f.file_id === sp.file_id);
        const page = file?.pages.find((p) => p.page_number === sp.page_number);
        return sum + Object.keys(page?.boxes ?? {}).length;
      }, 0);

      if (total === 0) { setMsg("No boxes drawn on selected pages"); return; }

      // Check usage limit before starting
      try {
        const usageCheck = await recordUsage(0); // check without adding
        if (usageCheck.over_limit) {
          showError("⚠ 本月 OCR 頁數已達上限，請升級方案。");
          return;
        }
      } catch (err: any) {
        // If 401 or auth error, stop; otherwise proceed
        if (err?.message?.includes("401") || err?.message?.includes("登入")) {
          showError(err.message);
          return;
        }
        console.warn("Usage check unavailable, proceeding:", err);
      }

      setMsg(`Recognizing text (0/${total})...`, 0);

      for (const sp of pages) {
        const file = state.pdf_files.find((f) => f.file_id === sp.file_id);
        const page = file?.pages.find((p) => p.page_number === sp.page_number);
        if (!page) continue;
        for (const box of Object.values(page.boxes)) {
          try {
            const text = await extractText(sp.file_id, sp.page_number, box, status.ocr_available);
            project.setCell(sp.file_id, sp.page_number, box.column_name, text);
          } catch (err: any) {
            failures++;
            // If auth expired mid-batch, abort remaining
            if (err?.message?.includes("401") || err?.message?.includes("登入")) {
              showError("認證已過期，請重新登入後再試。");
              return;
            }
            console.warn(`OCR failed for ${sp.file_id} p${sp.page_number} box ${box.column_name}:`, err);
          }
          done++;
          setMsg(`Recognizing text (${done}/${total})...`, Math.round((done / total) * 100));
        }
      }

      // Record usage
      try {
        const ocrPages = pages.length;
        const result = await recordUsage(ocrPages);
        setUsagePages(result.usage_pages);
        setUsageLimit(result.limit);
      } catch (err: any) {
        console.warn("Usage recording failed:", err);
      }

      const suffix = failures > 0 ? `（${failures} 個框辨識失敗）` : "";
      setMsg(`Text recognition complete${suffix}`, null);
    } finally {
      endGlobalBusy();
    }
  };

  // Single-page recognize (from SinglePageDataTable)
  const handleRecognizeSinglePage = async () => {
    if (!state.selected_file_id) return;
    const file = state.pdf_files.find((f) => f.file_id === state.selected_file_id);
    const sp = { file_id: state.selected_file_id, page_number: state.selected_page, file_name: file?.file_name ?? "" };
    await handleRecognizeConfirm([sp]);
  };

  // SinglePageDataTable template handlers
  const handleSingleSaveNewTemplate = async (name: string) => {
    const currentBoxes = project.currentPageData?.boxes ?? {};
    const boxes: TemplateBox[] = Object.values(currentBoxes).map((b, i) => ({
      column_name: b.column_name,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: ["#e74c3c","#2980b9","#27ae60","#f39c12"][i % 4],
    }));

    // Save locally first with temp ID
    const tempId = crypto.randomUUID();
    const newTemplate: Template = {
      id: tempId,
      name,
      boxes,
      notes: "",
      preview_file_id: state.selected_file_id,
      preview_page: state.selected_page,
    };
    project.saveTemplates([...state.templates, newTemplate]);
    setMsg(`Saving template "${name}" to cloud...`);

    // Sync to cloud
    try {
      const created = await createCloudTemplate({ name, boxes, notes: "" });
      await uploadCurrentPageImageForTemplate(created.id);
      // Replace temp ID with cloud ID
      const updatedTemplates = [...state.templates, newTemplate].map((t) =>
        t.id === tempId ? { ...t, id: created.id } : t
      );
      project.saveTemplates(updatedTemplates);
      setMsg(`Saved template "${name}" ☁`);
    } catch (err) {
      setMsg(`Saved locally, cloud sync failed: ${err}`);
    }
  };

  const handleSingleUpdateTemplate = async (name: string) => {
    const currentBoxes = project.currentPageData?.boxes ?? {};
    const boxes: TemplateBox[] = Object.values(currentBoxes).map((b, i) => ({
      column_name: b.column_name,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: ["#e74c3c","#2980b9","#27ae60","#f39c12"][i % 4],
    }));
    const updated = state.templates.map((t) =>
      t.name === name ? { ...t, boxes } : t
    );
    project.saveTemplates(updated);

    // Auto-apply to all pages using this template
    state.pdf_files.forEach((f) => {
      f.pages.forEach((p) => {
        if (p.applied_template === name) {
          boxes.forEach((b) => {
            project.setBox(f.file_id, p.page_number, {
              column_name: b.column_name, x: b.x, y: b.y, width: b.width, height: b.height,
            });
          });
        }
      });
    });

    // Sync update to cloud
    const tpl = updated.find((t) => t.name === name);
    if (tpl) {
      try {
        await updateCloudTemplate(tpl.id, { name, boxes, notes: tpl.notes ?? "" });
        await uploadCurrentPageImageForTemplate(tpl.id);
        setMsg(`Updated template "${name}" ☁`);
      } catch (err) {
        setMsg(`Updated locally, cloud sync failed: ${err}`);
      }
    } else {
      setMsg(`Updated template "${name}" and re-applied to all using pages`);
    }
  };

  const handleSingleApplyTemplate = (name: string) => {
    const t = state.templates.find((tpl) => tpl.name === name);
    if (!t || !state.selected_file_id) return;
    // Task 6: Ensure all template columns exist
    const existingCols = new Set(state.columns.map((c) => c.name));
    t.boxes.forEach((b) => {
      if (!existingCols.has(b.column_name)) {
        project.addColumn(b.column_name);
        existingCols.add(b.column_name);
      }
    });
    t.boxes.forEach((b) => {
      project.setBox(state.selected_file_id!, state.selected_page, {
        column_name: b.column_name, x: b.x, y: b.y, width: b.width, height: b.height,
      });
    });
    project.setAppliedTemplate(state.selected_file_id, state.selected_page, name);
    setMsg(`Applied template "${name}"`);
  };

  // --------------------------------------------------------------------------
  // Cell selection → column selection
  // --------------------------------------------------------------------------

  const handleSelectCell = (fileId: string, page: number, column: string) => {
    project.selectPage(fileId, page);
    setSelectedColumn(column);
  };

  // --------------------------------------------------------------------------
  // Box drawing from viewer
  // --------------------------------------------------------------------------

  const handleDrawBox = useCallback(
    (box: import("./types").BoxInfo) => {
      if (!state.selected_file_id) return;
      project.setBox(state.selected_file_id, state.selected_page, box);
    },
    [state.selected_file_id, state.selected_page, project]
  );

  // --------------------------------------------------------------------------
  // BQ (Bill of Quantities) handlers
  // --------------------------------------------------------------------------

  // Get current BQ boxes for the selected page
  const currentBQBoxes = useMemo(() => {
    if (!state.selected_file_id) return {};
    const pageKey = `${state.selected_file_id}-${state.selected_page}`;
    return bqPageData[pageKey]?.boxes ?? {};
  }, [state.selected_file_id, state.selected_page, bqPageData]);

  // Handle BQ boxes change (from BQOCRPanel)
  const handleBQBoxesChange = useCallback((boxes: Record<string, BoxInfo>) => {
    if (!state.selected_file_id) return;
    const pageKey = `${state.selected_file_id}-${state.selected_page}`;
    setBqPageData((prev) => ({
      ...prev,
      [pageKey]: {
        ...prev[pageKey],
        file_id: state.selected_file_id!,
        page_number: state.selected_page,
        boxes,
        rows: prev[pageKey]?.rows ?? [],
      },
    }));
  }, [state.selected_file_id, state.selected_page]);

  // Handle BQ data change (after OCR extraction)
  const handleBQDataChange = useCallback((pageKey: string, data: BQPageData) => {
    setBqPageData((prev) => ({
      ...prev,
      [pageKey]: data,
    }));
  }, []);

  // Handle moving annotation to a new position (drag & drop)
  const handleAnnotationMove = useCallback((annotationId: string, newX: number, newY: number) => {
    const pageKey = `${state.selected_file_id}-${state.selected_page}`;
    setBqPageData((prev) => {
      const existing = prev[pageKey];
      if (!existing) return prev;
      return {
        ...prev,
        [pageKey]: {
          ...existing,
          annotation_positions: {
            ...(existing.annotation_positions || {}),
            [annotationId]: { x: newX, y: newY },
          },
        },
      };
    });
  }, [state.selected_file_id, state.selected_page]);

  // Auto-derive pdfPageSize from BQ row data so annotations render without needing to click a row
  useEffect(() => {
    const pageKey = `${state.selected_file_id}-${state.selected_page}`;
    const pageData = bqPageData[pageKey];
    const firstRow = pageData?.rows?.[0];
    if (firstRow?.page_width && firstRow?.page_height) {
      setPdfPageSize({ width: firstRow.page_width, height: firstRow.page_height });
    }
  }, [state.selected_file_id, state.selected_page, bqPageData]);

  // Get current page annotations (auto-generated from BQ edits, with stored position overrides)
  const currentAnnotations = useMemo(() => {
    if (!showAnnotations) return [];
    
    const pageKey = `${state.selected_file_id}-${state.selected_page}`;
    const pageData = bqPageData[pageKey];
    if (!pageData) return [];
    
    const storedPositions = pageData.annotation_positions || {};
    const autoAnnotations: import("./types").TextAnnotation[] = [];
    const pageIsCollection = pageData.page_is_collection || pageData.rows.some((r) => r.page_is_collection);

    const computePageTotal = () => {
      let total = 0;
      for (const r of pageData.rows) {
        if (pageIsCollection) {
          if ((r.type === "collection_entry" || r.type === "item") && r.total !== null) total += r.total;
        } else {
          if (r.type === "item" && r.total !== null) total += r.total;
        }
      }
      return round2(total);
    };
    
    for (const row of pageData.rows) {
      if (row.type !== "item" || !row.user_edited) continue;
      
      const pageWidth = row.page_width ?? 1;
      
      // Get column boxes for positioning
      const rateBox = pageData.boxes["Rate"];
      const qtyBox = pageData.boxes["Qty"];
      const totalBox = pageData.boxes["Total"];
      
      // Quantity annotation — right-aligned at right edge of Qty box
      if (row.user_edited.quantity && row.quantity !== null && qtyBox) {
        const annId = `auto-qty-${row.id}`;
        const stored = storedPositions[annId];
        autoAnnotations.push({
          id: annId,
          text: formatQuantity(row.quantity),
          x: stored?.x ?? ((qtyBox.x + qtyBox.width) * pageWidth),
          y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12),
          font_size: 9,
          color: "#0000FF",
          align: "right" as const,
        });
      }
      
      // Rate annotation — right-aligned at right edge of Rate box
      if (row.user_edited.rate && row.rate !== null && rateBox) {
        const annId = `auto-rate-${row.id}`;
        const stored = storedPositions[annId];
        autoAnnotations.push({
          id: annId,
          text: formatMoney(row.rate),
          x: stored?.x ?? ((rateBox.x + rateBox.width) * pageWidth),
          y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12),
          font_size: 9,
          color: "#0000FF",
          align: "right" as const,
        });
      }
      
      // Total annotation — right-aligned at right edge of Total box
      if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && 
          row.total !== null && totalBox) {
        const annId = `auto-total-${row.id}`;
        const stored = storedPositions[annId];
        autoAnnotations.push({
          id: annId,
          text: formatMoney(row.total),
          x: stored?.x ?? ((totalBox.x + totalBox.width) * pageWidth),
          y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12),
          font_size: 9,
          color: "#0000FF",
          align: "right" as const,
        });
      }
    }

    // Collection entry total annotation — align to Total column for collection page rows
    const totalBox = pageData.boxes["Total"];
    if (totalBox) {
      for (const row of pageData.rows) {
        if (row.type !== "collection_entry" || row.total === null || row.total <= 0) continue;
        const pageWidth = row.page_width ?? 1;
        const annId = `auto-coll-total-${row.id}`;
        const stored = storedPositions[annId];
        autoAnnotations.push({
          id: annId,
          text: formatMoney(row.total),
          x: stored?.x ?? ((totalBox.x + totalBox.width) * pageWidth),
          y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12),
          font_size: 9,
          color: "#0000FF",
          align: "right" as const,
        });
      }
    }
    
    // Page total annotation (shown in Collection box area)
    if (pageData.rows.length > 0) {
      const collectionBox = pageData.boxes["Collection"];
      if (collectionBox) {
        const pageTotal = computePageTotal();
        if (pageTotal > 0) {
          const firstRow = pageData.rows[0];
          const pw = firstRow?.page_width ?? 1;
          const ph = firstRow?.page_height ?? 1;
          const annId = `auto-pagetotal-${pageKey}`;
          const stored = storedPositions[annId];
          autoAnnotations.push({
            id: annId,
            text: `$${pageTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            x: stored?.x ?? ((collectionBox.x + collectionBox.width / 2) * pw),
            y: stored?.y ?? ((collectionBox.y + collectionBox.height * 0.5) * ph),
            font_size: 10,
            color: "#008000",
            bold: true,
            align: "center" as const,
          });
        }
      }
    }
    
    return autoAnnotations;
  }, [state.selected_file_id, state.selected_page, bqPageData, showAnnotations]);

  // Save BQ template to cloud
  const handleSaveBQTemplate = useCallback(async (name: string, boxes: BoxInfo[]) => {
    try {
      const apiBoxes = boxes.map((b, i) => ({
        column_name: b.column_name,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        color: ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f39c12", "#1abc9c"][i % 6],
      }));
      // Include current file/page for preview
      const created = await createBQTemplate(
        name, 
        apiBoxes, 
        "personal", 
        undefined, 
        state.selected_file_id, 
        state.selected_page
      );
      // upload thumbnail image as well
      await uploadCurrentPageImageForBQTemplate(created.id);
      const localTemplate = bqCloudToLocal(created);
      setBqTemplates((prev) => [...prev, localTemplate]);
      setMsg(`Saved BQ template "${name}" to cloud`);
    } catch (err: any) {
      console.error("Failed to save BQ template:", err);
      setMsg(`Failed to save BQ template: ${err.message}`);
    }
  }, [state.selected_file_id, state.selected_page]);

  // Apply BQ template
  const handleApplyBQTemplate = useCallback((templateId: string) => {
    const template = bqTemplates.find((t) => t.id === templateId);
    if (!template || !state.selected_file_id) return;
    
    const boxes: Record<string, BoxInfo> = {};
    template.boxes.forEach((b) => {
      boxes[b.column_name] = {
        column_name: b.column_name,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        color: b.color,  // Preserve template color
      };
    });
    handleBQBoxesChange(boxes);
    setMsg(`Applied BQ template "${template.name}"`);
  }, [bqTemplates, state.selected_file_id, handleBQBoxesChange]);

  // Update existing BQ template with new boxes
  const handleUpdateBQTemplate = useCallback(async (templateId: string, boxes: BoxInfo[]) => {
    const template = bqTemplates.find((t) => t.id === templateId);
    if (!template) return;
    
    try {
      const boxesAPI = boxes.map(b => ({
        column_name: b.column_name,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        color: "#2980b9",
      }));
      
      await updateBQTemplate(templateId, { boxes: boxesAPI });
      
      // Update local state with TemplateBox[] format
      const templateBoxes = boxes.map(b => ({
        column_name: b.column_name,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        color: "#2980b9",
      }));
      
      setBqTemplates(prev => prev.map(t => 
        t.id === templateId 
          ? { ...t, boxes: templateBoxes } 
          : t
      ));
      
      setMsg(`Updated BQ template "${template.name}"`);
    } catch (err) {
      console.error("Failed to update BQ template:", err);
      setMsg(`Error updating template: ${err}`);
    }
  }, [bqTemplates]);

  // Save/update all BQ templates (used by TemplateManagerPanel)
  const handleSaveBQTemplates = useCallback(async (templates: BQTemplate[]) => {
    if (IS_DEV_MODE) {
      setBqTemplates(templates);
      return;
    }

    const prev = bqTemplates;
    const prevIds = new Set(prev.map((t) => t.id));
    const nextIds = new Set(templates.map((t) => t.id));

    // Deletions
    for (const old of prev) {
      if (!nextIds.has(old.id)) {
        try {
          await deleteBQTemplate(old.id);
        } catch (err) {
          console.warn("Failed to delete BQ template:", err);
        }
      }
    }

    // Additions/updates
    const finalTemplates = [...templates];
    for (let i = 0; i < finalTemplates.length; i++) {
      const t = finalTemplates[i];
      if (!prevIds.has(t.id)) {
        // New template: create in cloud and upload image
        try {
          const created = await createBQTemplate(
            t.name,
            t.boxes.map((b) => ({
              column_name: b.column_name,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              color: b.color || "#2980b9",
            })),
            "personal",
            undefined,
            t.preview_file_id,
            t.preview_page
          );
          finalTemplates[i] = { ...t, id: created.id };
          await uploadCurrentPageImageForBQTemplate(created.id);
        } catch (err) {
          console.warn("Cloud create failed for BQ template:", err);
        }
      } else {
        // existing → update if changed
        const prevT = prev.find((p) => p.id === t.id);
        const changed =
          prevT?.name !== t.name ||
          JSON.stringify(prevT?.boxes) !== JSON.stringify(t.boxes);
        if (changed) {
          try {
            await updateBQTemplate(t.id, {
              name: t.name,
              boxes: t.boxes.map((b) => ({
                column_name: b.column_name,
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
                color: b.color || "#2980b9",
              })),
            });
          } catch (err) {
            console.warn("Failed to update BQ template:", err);
          }
        }
      }
    }

    setBqTemplates(finalTemplates);
    setMsg(`Saved ${templates.length} BQ template(s)`);
  }, [bqTemplates, state.selected_file_id, state.selected_page]);

  // Edit BQ row
  const handleBQRowEdit = useCallback((pageKey: string, rowId: number, field: keyof BQRow, value: any) => {
    setBqPageData((prev) => {
      const pageData = prev[pageKey];
      if (!pageData) return prev;
      return {
        ...prev,
        [pageKey]: {
          ...pageData,
          rows: pageData.rows.map((row) =>
            row.id === rowId ? { ...row, [field]: value } : row
          ),
        },
      };
    });
  }, []);

  // Delete BQ row
  const handleBQRowDelete = useCallback((pageKey: string, rowId: number) => {
    setBqPageData((prev) => {
      const pageData = prev[pageKey];
      if (!pageData) return prev;
      return {
        ...prev,
        [pageKey]: {
          ...pageData,
          rows: pageData.rows.filter((row) => row.id !== rowId),
        },
      };
    });
  }, []);

  // Batch recalculate totals (for the recalculate button)
  const handleBQBatchRecalculate = useCallback((updates: Array<{ pageKey: string; rowId: number; total: number }>) => {
    setBqPageData((prev) => {
      const next = { ...prev };
      for (const { pageKey, rowId, total } of updates) {
        const pageData = next[pageKey];
        if (!pageData) continue;
        next[pageKey] = {
          ...pageData,
          rows: pageData.rows.map((row) =>
            row.id === rowId
              ? { ...row, total, user_edited: { ...(row.user_edited || {}), total: true } }
              : row
          ),
        };
      }
      return next;
    });
  }, []);

  // Insert a new BQ row after a given row
  const handleBQRowInsert = useCallback((pageKey: string, afterRowId: number) => {
    setBqPageData((prev) => {
      const pageData = prev[pageKey];
      if (!pageData) return prev;
      const idx = pageData.rows.findIndex((r) => r.id === afterRowId);
      if (idx === -1) return prev;
      const refRow = pageData.rows[idx];
      const maxId = pageData.rows.reduce((m, r) => Math.max(m, r.id), 0);

      const isCollectionPage = !!(pageData.page_is_collection || refRow.page_is_collection);
      let defaultType: BQRow["type"] = "item";
      if (isCollectionPage) {
        defaultType = refRow.type.startsWith("collection")
          ? refRow.type
          : "collection_entry";
      } else if (refRow.type === "notes") {
        defaultType = "item";
      }

      const newRow: BQRow = {
        id: maxId + 1,
        file_id: refRow.file_id,
        page_number: refRow.page_number,
        page_label: refRow.page_label,
        revision: refRow.revision,
        bill_name: refRow.bill_name,
        collection: refRow.collection,
        page_is_collection: refRow.page_is_collection,
        type: defaultType,
        item_no: "",
        description: "",
        quantity: null,
        unit: "",
        rate: null,
        total: null,
        parent_id: null,
        bbox_x0: refRow.bbox_x0,
        bbox_y0: refRow.bbox_y0,
        bbox_x1: refRow.bbox_x1,
        bbox_y1: refRow.bbox_y1,
        page_width: refRow.page_width,
        page_height: refRow.page_height,
        user_edited: {},
      };
      const newRows = [...pageData.rows];
      newRows.splice(idx + 1, 0, newRow);
      return {
        ...prev,
        [pageKey]: { ...pageData, rows: newRows },
      };
    });
  }, []);

  // Navigate to PDF page and highlight BQ row
  const handleNavigateToRow = useCallback((
    fileId: string, 
    pageNum: number, 
    bbox: { x0: number; y0: number; x1: number; y1: number } | null,
    pageSize?: { width: number; height: number } | null
  ) => {
    // Navigate to the page
    project.selectPage(fileId, pageNum);
    // Set highlight box and page size for coordinate conversion
    setHighlightBox(bbox);
    setPdfPageSize(pageSize || null);
    // Clear highlight after 5 seconds
    if (bbox) {
      setTimeout(() => setHighlightBox(null), 5000);
    }
  }, [project]);

  // Handle box drawing in BQ mode - route to BQ boxes instead of regular boxes
  // BQ column/zone colors
  const BQ_BOX_COLORS: Record<string, string> = {
    Item: "#e74c3c",
    Description: "#3498db",
    Qty: "#2ecc71",
    Unit: "#9b59b6",
    Rate: "#f39c12",
    Total: "#1abc9c",
    DataRange: "#34495e",
    Collection: "#7f8c8d",
    PageNo: "#95a5a6",
    Revision: "#e67e22",
    BillName: "#16a085",
  };
  
  const handleDrawBoxBQ = useCallback(
    (box: BoxInfo) => {
      if (!state.selected_file_id) return;
      handleBQBoxesChange({
        ...currentBQBoxes,
        [box.column_name]: {
          ...box,
          color: BQ_BOX_COLORS[box.column_name] || "#2980b9",
        },
      });
    },
    [state.selected_file_id, currentBQBoxes, handleBQBoxesChange]
  );

  // --------------------------------------------------------------------------
  // Render — route-based
  // --------------------------------------------------------------------------

  // Login screen
  // Login screen (skip in dev mode)
  if (!IS_DEV_MODE && (view === "login" || (!auth.user && !auth.loading))) {
    return <LoginPage onGoogleSignIn={handleGoogleSignIn} />;
  }

  // Loading auth state or profile (skip in dev mode)
  if (!IS_DEV_MODE && (auth.loading || profileLoading)) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f0f2f5" }}>
        <p>Loading...</p>
      </div>
    );
  }

  // Toast wrapper for early-return views
  const wrapWithToast = (el: React.ReactNode) => (
    <>
      {el}
      {toastMsg && (
        <div
          onClick={() => { setToastMsg(null); if (toastTimer.current) clearTimeout(toastTimer.current); }}
          style={{
            position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
            background: "#d32f2f", color: "#fff", padding: "10px 24px",
            borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            fontSize: 14, zIndex: 99999, cursor: "pointer", maxWidth: "80vw",
            wordBreak: "break-word",
          }}
        >
          {toastMsg}
        </div>
      )}
    </>
  );

  // My Account page
  if (view === "account") {
    return wrapWithToast(
      <MyAccountPage
        profile={profile}
        isNewUser={isNewUser}
        usageLimit={usageLimit}
        tierLabels={Object.fromEntries(adminTiers.map((t) => [t.name, t.label]))}
        onSave={handleSaveProfile}
        onGoHome={() => {
          if (profile?.status === "active") {
            setView("main");
            setActiveModuleRaw("home");
          }
        }}
        onSignOut={handleSignOut}
        onOpenAdmin={handleOpenAdmin}
      />
    );
  }

  // Admin panel
  if (view === "admin") {
    return wrapWithToast(
      <AdminPanel
        users={adminUsers}
        groups={adminGroups}
        tiers={adminTiers}
        onUpdateUser={handleAdminUpdateUser}
        onResetUsage={handleAdminResetUsage}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onCreateTier={handleCreateTier}
        onUpdateTier={handleUpdateTier}
        onDeleteTier={handleDeleteTier}
        onGoHome={() => {
          setView("main");
          setActiveModuleRaw("home");
        }}
      />
    );
  }

  // --------------------------------------------------------------------------
  // Main app view
  // --------------------------------------------------------------------------

  const currentBoxes = project.currentPageData?.boxes ?? {};
  const isHomeModule = activeModule === "home";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={onFilesSelected} />

      {/* Top toolbar */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Toolbar
            onImport={handleImport}
            onExportExcel={handleExportExcel}
            onRecognizeText={handleRecognizeText}
            onManageTemplates={handleManageTemplates}
            onExportPdf={handleExportPdf}
            onCloudProjects={() => setShowCloudProjects(true)}
            disabled={state.pdf_files.length === 0}
          />
        </div>
        {/* User info / My Account button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0 }}>
          {/* Show/Hide BQ text overlays toggle (only for BQ modules) */}
          {(activeModule === "bq_ocr" || activeModule === "bq_export") && (
            <>
              <button
                onClick={() => setShowAnnotations((prev) => !prev)}
                style={{
                  background: showAnnotations ? "#27ae60" : "none",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: showAnnotations ? "#fff" : "#333",
                }}
                title="Toggle visibility of BQ rate/qty/total text overlays on PDF"
              >
                {showAnnotations ? "👁 顯示標價" : "👁‍🗨 隱藏標價"}
              </button>
              {activeModule === "bq_export" && Object.keys(bqPageData).length > 0 && (
                <button
                  onClick={() => {
                    // Trigger recalculate via a custom event that BQExportPanel listens to
                    window.dispatchEvent(new CustomEvent("bq-recalculate"));
                  }}
                  style={{
                    background: "none",
                    border: "1px solid #f39c12",
                    borderRadius: 4,
                    padding: "3px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#f39c12",
                  }}
                  title="重新計算所有 rate×qty→total、page totals、collection totals"
                >
                  🔄 重新計算
                </button>
              )}
            </>
          )}
          {profile?.photo_url && (
            <img src={profile.photo_url} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
          )}
          <FeedbackButton />
          <button
            onClick={() => setView("account")}
            style={{
              background: "none", border: "1px solid #ccc", borderRadius: 4,
              padding: "3px 10px", cursor: "pointer", fontSize: 12, color: "#333",
            }}
          >
            👤 My Account
          </button>
        </div>
      </div>

      {/* Template Manager Modal */}
      {showTemplateModal && (
        <TemplateModal
          templates={state.templates}
          files={state.pdf_files}
          currentBoxes={Object.values(currentBoxes).map((b, i) => ({ ...b, color: ["#e74c3c","#2980b9","#27ae60","#f39c12"][i % 4] }))}
          currentFileId={state.selected_file_id}
          currentPage={state.selected_page}
          currentUserUid={auth.user?.uid}
          onSave={handleTemplateSave}
          onApply={handleTemplateApply}
          onClose={() => setShowTemplateModal(false)}
        />
      )}

      {/* PDF Export Modal */}
      {showExportModal && (
        <PDFExportModal
          files={state.pdf_files}
          columns={state.columns}
          onExport={handleExportPdfConfirm}
          onCancel={() => setShowExportModal(false)}
        />
      )}

      {/* Recognize Text page selector */}
      {showRecognizeSelector && (
        <PageSelectorModal
          files={state.pdf_files}
          title="Recognize Text — Select Pages"
          confirmLabel="Recognize Text"
          onConfirm={handleRecognizeConfirm}
          onCancel={() => setShowRecognizeSelector(false)}
        />
      )}

      {/* Cloud Projects Panel */}
      {showCloudProjects && (
        <CloudProjectsPanel
          projectPayload={buildProjectPayload}
          onLoad={(data) => {
            project.loadProject(data);
            // Restore BQ OCR state if present
            // Always replace (including empty) to avoid stale data leakage
            // from previously opened projects.
            setBqPageData(data.bq_page_data ?? {});
            setBqTemplates(data.bq_templates ?? []);
            setHighlightBox(null);
            setPdfPageSize(null);
            lastBackedPayloadRef.current = null;
            setMsg("已載入雲端專案");
            refreshHomeData().catch(() => {});
          }}
          onClose={() => setShowCloudProjects(false)}
          onError={showError}
          onMsg={(m) => setMsg(m)}
          onBusyChange={handleChildBusyChange}
        />
      )}

      {/* Main area: ActivityBar | Tree | Module Content | PDFViewer */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Column 0: Activity Bar */}
        <ActivityBar
          activeModule={activeModule}
          onModuleChange={setActiveModule}
          userTier={profile?.tier ?? "basic"}
          userFeatures={profile?.tier_features}
        />

        {isHomeModule && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <HomePanel
              profile={profile}
              usagePages={usagePages}
              usageLimit={usageLimit}
              updates={systemUpdates}
              startupCurrent={startupCurrent}
              hasCurrentData={hasCurrentData}
              backupEnabled={backupEnabled}
              backupMode={backupMode}
              backupStatus={backupStatus}
              backupAt={backupAt}
              backupWrites={backupWrites}
              backupSkips={backupSkips}
              localSnapshotAt={localSnapshotAt}
              localSnapshotSizeBytes={localSnapshotSizeBytes}
              onSetBackupEnabled={setBackupEnabled}
              onSetBackupMode={setBackupMode}
              onManualBackup={handleManualBackup}
              onSaveLocalSnapshot={saveLocalSnapshot}
              onRestoreLocalSnapshot={handleRestoreLocalSnapshot}
              onResumeLastSession={handleResumeLastSession}
              onStartNewSession={handleStartNewSession}
              onOpenCloudProjects={() => setShowCloudProjects(true)}
              onCreateUpdate={handleCreateSystemUpdate}
              onDeleteUpdate={handleDeleteSystemUpdate}
            />
          </div>
        )}

        {!isHomeModule && (
          <>

        {/* Column 1: PDF Tree (collapsible) */}
        <div style={{
          width: treeCollapsed ? 28 : 220,
          minWidth: treeCollapsed ? 28 : 160,
          transition: "width 0.2s",
          borderRight: "1px solid #ddd",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          flexShrink: 0,
        }}>
          <button
            onClick={() => setTreeCollapsed(!treeCollapsed)}
            style={{
              border: "none", background: "#f5f5f5", borderBottom: "1px solid #ddd",
              cursor: "pointer", padding: "4px 0", fontSize: 11, color: "#888",
            }}
            title={treeCollapsed ? "Expand PDF tree" : "Collapse PDF tree"}
          >
            {treeCollapsed ? "▶" : "◀ PDF Files"}
          </button>
          {!treeCollapsed && (
            <PDFTreeView
              files={state.pdf_files}
              selectedFileId={state.selected_file_id}
              selectedPage={state.selected_page}
              onSelectPage={project.selectPage}
              onDeleteFile={handleDeleteFile}
            />
          )}
        </div>

        {/* Column 2: Module Content (switches based on activeModule) - resizable */}
        <div style={{
          flex: `0 0 ${contentWidth}%`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}>
          {activeModule === "singlepage" && (
            <>
              {/* Resizable DataTable */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                height: dataTableCollapsed ? 28 : `${dataTableHeight}%`,
                minHeight: 28,
                overflow: "hidden",
                borderBottom: "1px solid #ddd",
              }}>
                <button
                  onClick={() => setDataTableCollapsed(!dataTableCollapsed)}
                  style={{
                    border: "none", background: "#f5f5f5", borderBottom: "1px solid #ddd",
                    cursor: "pointer", padding: "4px 8px", fontSize: 11, color: "#888",
                    textAlign: "left",
                  }}
                  title={dataTableCollapsed ? "Expand data table" : "Collapse data table"}
                >
                  {dataTableCollapsed ? "▼ Data Table" : "▲ Data Table"}
                </button>
                {!dataTableCollapsed && (
                  <DataTable
                    files={state.pdf_files}
                    columns={state.columns}
                    selectedFileId={state.selected_file_id}
                    selectedPage={state.selected_page}
                    selectedColumn={selectedColumn}
                    onSelectCell={handleSelectCell}
                    onCellEdit={(fid, pg, col, text) => project.setCell(fid, pg, col, text)}
                    onAddColumn={project.addColumn}
                    onRemoveColumn={project.removeColumn}
                    onToggleColumn={project.toggleColumn}
                    onExportExcel={handleExportExcel}
                    onRecognizeText={handleRecognizeText}
                    onManageTemplates={handleManageTemplates}
                    onExportPdf={handleExportPdf}
                    disabled={state.pdf_files.length === 0}
                  />
                )}
              </div>

              {/* Vertical resize handle */}
              {!dataTableCollapsed && (
                <div
                  style={{
                    height: 6, cursor: "row-resize", background: "#e0e0e0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderBottom: "1px solid #ccc",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const startHeight = dataTableHeight;
                    const container = e.currentTarget.parentElement;
                    const containerHeight = container?.clientHeight || 600;
                    
                    const onMove = (ev: MouseEvent) => {
                      const delta = ev.clientY - startY;
                      const newHeight = startHeight + (delta / containerHeight) * 100;
                      setDataTableHeight(Math.min(80, Math.max(15, newHeight)));
                    };
                    const onUp = () => {
                      document.removeEventListener("mousemove", onMove);
                      document.removeEventListener("mouseup", onUp);
                    };
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                  }}
                >
                  <div style={{ width: 40, height: 2, background: "#aaa", borderRadius: 1 }} />
                </div>
              )}

              {/* SinglePageDataTable (always visible below) */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                <SinglePageDataTable
                  files={state.pdf_files}
                  columns={state.columns}
                  selectedFileId={state.selected_file_id}
                  selectedPage={state.selected_page}
                  selectedColumn={selectedColumn}
                  templates={state.templates}
                  onSelectPage={project.selectPage}
                  onSelectCell={handleSelectCell}
                  onCellEdit={(fid, pg, col, text) => project.setCell(fid, pg, col, text)}
                  onAddColumn={project.addColumn}
                  onRemoveColumn={project.removeColumn}
                  onRecognizePage={handleRecognizeSinglePage}
                  onSaveNewTemplate={handleSingleSaveNewTemplate}
                  onUpdateTemplate={handleSingleUpdateTemplate}
                  onApplyTemplate={handleSingleApplyTemplate}
                />
              </div>
            </>
          )}

          {activeModule === "bq_ocr" && (
            <BQOCRPanel
              files={state.pdf_files}
              templates={state.templates}
              bqTemplates={bqTemplates}
              selectedFileId={state.selected_file_id}
              selectedPage={state.selected_page}
              selectedColumn={selectedColumn}
              currentBoxes={currentBQBoxes}
              bqPageData={bqPageData}
              onSelectPage={project.selectPage}
              onSelectColumn={setSelectedColumn}
              onBoxesChange={handleBQBoxesChange}
              onBQDataChange={handleBQDataChange}
              onSaveBQTemplate={handleSaveBQTemplate}
              onApplyBQTemplate={handleApplyBQTemplate}
              onUpdateBQTemplate={handleUpdateBQTemplate}
              usagePages={usagePages}
              usageLimit={usageLimit}
              onBusyChange={handleChildBusyChange}
            />
          )}

          {activeModule === "bq_export" && (
            <BQExportPanel
              bqPageData={bqPageData}
              onRowEdit={handleBQRowEdit}
              onDeleteRow={handleBQRowDelete}
              onInsertRow={handleBQRowInsert}
              onNavigateToRow={handleNavigateToRow}
              onBatchRecalculate={handleBQBatchRecalculate}
              canExport={profile?.tier_features?.bq_export !== false}
              onBusyChange={handleChildBusyChange}
            />
          )}

          {activeModule === "templates" && (
            <TemplateManagerPanel
              templates={state.templates}
              bqTemplates={bqTemplates}
              files={state.pdf_files}
              currentBoxes={Object.values(currentBoxes).map((b, i) => ({
                ...b,
                color: ["#e74c3c", "#2980b9", "#27ae60", "#f39c12"][i % 4],
              }))}
              currentBQBoxes={Object.values(currentBQBoxes)}
              currentFileId={state.selected_file_id}
              currentPage={state.selected_page}
              currentUserUid={auth.user?.uid}
              onSaveTemplates={handleTemplateSave}
              onApplyTemplate={handleTemplateApply}
              onSaveBQTemplates={handleSaveBQTemplates}
              onApplyBQTemplate={handleApplyBQTemplate}
            />
          )}

          {activeModule === "exportexcel" && (
            <ExcelExportPanel
              files={state.pdf_files}
              columns={state.columns}
              selectedFileId={state.selected_file_id}
              selectedPage={state.selected_page}
              onSelectPage={project.selectPage}
              onCellEdit={(fid, pg, col, text) => project.setCell(fid, pg, col, text)}
              onExport={handleExportExcel}
            />
          )}

          {activeModule === "exportpdf" && (
            <PDFExportPanel
              files={state.pdf_files}
              columns={state.columns}
              onExport={handleExportPdfConfirm}
            />
          )}
        </div>

        {/* Horizontal resize handle between content and PDF viewer */}
        <div
          style={{
            width: 6, cursor: "col-resize", background: "#e0e0e0",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderLeft: "1px solid #ccc", borderRight: "1px solid #ccc",
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = contentWidth;
            const container = e.currentTarget.parentElement;
            const containerWidth = container?.clientWidth || 1200;
            
            const onMove = (ev: MouseEvent) => {
              const delta = ev.clientX - startX;
              const newWidth = startWidth + (delta / containerWidth) * 100;
              setContentWidth(Math.min(75, Math.max(25, newWidth)));
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        >
          <div style={{ width: 2, height: 40, background: "#aaa", borderRadius: 1 }} />
        </div>

        {/* Column 3: PDF Viewer */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <PDFViewer
            fileId={state.selected_file_id}
            pageNum={state.selected_page}
            boxes={activeModule === "bq_ocr" ? currentBQBoxes : currentBoxes}
            selectedColumn={selectedColumn}
            onDrawBox={activeModule === "bq_ocr" ? handleDrawBoxBQ : handleDrawBox}
            highlightBox={highlightBox}
            pdfPageSize={pdfPageSize}
            annotations={currentAnnotations}
            onAnnotationMove={handleAnnotationMove}
          />
        </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        fileCount={state.pdf_files.length}
        pageCount={totalPages}
        usagePages={usagePages}
        usageLimit={usageLimit}
        backupEnabled={backupEnabled}
        backupSupported={(profile?.tier_features?.auto_backup ?? false) === true}
        backupMode={backupMode}
        backupStatus={backupStatus}
        backupAt={backupAt}
        backupWrites={backupWrites}
        backupSkips={backupSkips}
        onToggleBackup={setBackupEnabled}
        onManualBackup={handleManualBackup}
      />

      {/* Error toast overlay */}
      {toastMsg && (
        <div
          onClick={() => { setToastMsg(null); if (toastTimer.current) clearTimeout(toastTimer.current); }}
          style={{
            position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
            background: "#d32f2f", color: "#fff", padding: "10px 24px",
            borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            fontSize: 14, zIndex: 99999, cursor: "pointer", maxWidth: "80vw",
            wordBreak: "break-word",
          }}
        >
          {toastMsg}
        </div>
      )}

      {globalBusy.active && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100000,
          }}
        >
          <div
            style={{
              minWidth: 320,
              maxWidth: "80vw",
              background: "#fff",
              borderRadius: 10,
              padding: "16px 20px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Please wait</div>
            <div style={{ fontSize: 13, color: "#444" }}>{globalBusy.message}</div>
          </div>
        </div>
      )}
    </div>
  );
}
