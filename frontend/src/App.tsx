import React, { useState, useEffect, useRef, useCallback } from "react";
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
import type { SelectedPage } from "./components/PageSelectorModal";
import { useProject } from "./hooks/useProject";
import { useAuth } from "./hooks/useAuth";
import type { PDFFileInfo, PageData, StatusInfo, Template, TemplateBox } from "./types";
import type { UserProfile } from "./types/user";
import type { ExportPageEntry } from "./components/PDFExportModal";
import {
  uploadPDFs,
  saveProject,
  loadProject,
  exportExcel,
  exportPdfPages,
  extractText,
  getOcrStatus,
  setAuthToken,
  getMyProfile,
  updateMyProfile,
  listAllUsers,
  adminUpdateUser,
  adminResetUsage,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  recordUsage,
  listCloudTemplates,
  createCloudTemplate,
  updateCloudTemplate,
  deleteCloudTemplate,
  uploadTemplatePageImage,
  renderPage,
} from "./api/client";
import type { GroupItem, ServerFileInfo, CloudTemplate } from "./api/client";

// Route views
type AppView = "login" | "account" | "admin" | "main";

const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

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

  // Usage tracking
  const [usagePages, setUsagePages] = useState(0);
  const [usageLimit, setUsageLimit] = useState<number>(-1);

  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusInfo>({ message: "Ready", progress: null, ocr_available: false });
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showRecognizeSelector, setShowRecognizeSelector] = useState(false);

  // Collapsible panels
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [dataTableCollapsed, setDataTableCollapsed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  // --------------------------------------------------------------------------
  // Auth flow
  // --------------------------------------------------------------------------

  // Keep auth token in sync with API client
  useEffect(() => {
    if (IS_DEV_MODE) return;          // skip in dev mode
    if (auth.user) {
      auth.getToken().then((t) => setAuthToken(t));
    } else {
      setAuthToken(null);
    }
  }, [auth.user]);

  // After auth state resolves, fetch profile
  useEffect(() => {
    if (IS_DEV_MODE) return;          // skip in dev mode
    if (auth.loading) return;
    if (!auth.user) {
      setView("login");
      setProfile(null);
      return;
    }
    // Fetch profile
    auth.getToken().then((token) => {
      if (!token) return;
      setAuthToken(token);
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
          }
        })
        .catch(() => setView("account"));
    });
  }, [auth.user, auth.loading]);

  // Check OCR on mount
  useEffect(() => {
    getOcrStatus()
      .then((available) => setStatus((s) => ({ ...s, ocr_available: available })))
      .catch(() => {});
  }, []);

  // --------------------------------------------------------------------------
  // Cloud template sync — load from Firestore on login
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (IS_DEV_MODE) return;
    if (view !== "main" || !auth.user) return;
    loadCloudTemplates();
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
    preview_file_id: null,   // page image is in cloud, not local file
    preview_page: 0,
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

  const setMsg = (message: string, progress: number | null = null) =>
    setStatus((s) => ({ ...s, message, progress }));

  // --------------------------------------------------------------------------
  // Auth handlers
  // --------------------------------------------------------------------------

  const handleGoogleSignIn = async () => {
    await auth.signInWithGoogle();
  };

  const handleSignOut = async () => {
    await auth.signOut();
    setProfile(null);
    setView("login");
  };

  const handleSaveProfile = async (updates: Partial<UserProfile>) => {
    const updated = await updateMyProfile(updates as any);
    setProfile(updated);
    setIsNewUser(false);
    // If status is now active, allow going to main
    if (updated.status === "active") {
      setView("main");
    }
  };

  const handleOpenAdmin = async () => {
    const [users, groups] = await Promise.all([listAllUsers(), listGroups()]);
    setAdminUsers(users);
    setAdminGroups(groups);
    setView("admin");
  };

  const handleAdminUpdateUser = async (uid: string, changes: Partial<UserProfile>) => {
    await adminUpdateUser(uid, changes as any);
    // Refresh list
    const users = await listAllUsers();
    setAdminUsers(users);
  };

  const handleAdminResetUsage = async (uid: string) => {
    await adminResetUsage(uid);
    const users = await listAllUsers();
    setAdminUsers(users);
  };

  const refreshAdminData = async () => {
    const [users, groups] = await Promise.all([listAllUsers(), listGroups()]);
    setAdminUsers(users);
    setAdminGroups(groups);
  };

  const handleCreateGroup = async (name: string) => {
    await createGroup(name);
    await refreshAdminData();
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    await renameGroup(groupId, name);
    await refreshAdminData();
  };

  const handleDeleteGroup = async (groupId: string) => {
    await deleteGroup(groupId);
    await refreshAdminData();
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  const buildProjectPayload = () => ({
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
  });

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
    setMsg("Uploading PDFs...", 10);
    try {
      const infos = await uploadPDFs(files);
      const fileInfos = infos.map(serverInfoToFileInfo);
      project.addFiles(fileInfos);
      setMsg(`Imported ${fileInfos.length} file(s)`, null);
    } catch (err) {
      setMsg(`Import error: ${err}`, null);
    }
    e.target.value = "";
  };

  const handleSave = async () => {
    setMsg("Saving...", 50);
    try {
      await saveProject(buildProjectPayload());
      setMsg("Saved successfully");
    } catch (err) {
      setMsg(`Save error: ${err}`);
    }
  };

  const handleLoad = () => loadInputRef.current?.click();

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("Loading project...", 30);
    try {
      const data = await loadProject(file) as ReturnType<typeof buildProjectPayload>;
      const migrateColumnName = (name: string) => (name === "Page" ? "Page Name" : name);

      const migratedColumns = (data.columns ?? []).map((c: any) => ({
        ...c,
        name: migrateColumnName(c.name),
      }));

      const files: PDFFileInfo[] = (data.pdf_files ?? []).map((f: any) => ({
        ...f,
        pages: (f.pages ?? []).map((p: any) => ({
          ...p,
          extracted_data: Object.fromEntries(
            Object.entries(p.extracted_data ?? {}).map(([k, v]) => [migrateColumnName(k), v])
          ),
          boxes: Object.fromEntries(
            (Array.isArray(p.boxes) ? p.boxes : Object.values(p.boxes ?? {})).map((b: any) => {
              const migratedName = migrateColumnName(b.column_name);
              return [migratedName, { ...b, column_name: migratedName }];
            })
          ),
        })),
      }));

      const migratedTemplates = (data.templates ?? []).map((t: any) => ({
        ...t,
        boxes: (t.boxes ?? []).map((b: any) => ({
          ...b,
          column_name: migrateColumnName(b.column_name),
        })),
      }));

      project.loadProject({
        pdf_files: files,
        columns: migratedColumns,
        templates: migratedTemplates,
        selected_file_id: data.last_selected_file || null,
        selected_page: data.last_selected_page ?? 0,
      });
      setMsg("Project loaded");
    } catch (err) {
      setMsg(`Load error: ${err}`);
    }
    e.target.value = "";
  };

  const handleClearData = () => {
    if (!state.selected_file_id) return;
    project.clearPageData(state.selected_file_id, state.selected_page);
    setMsg("Cleared extracted data for current page");
  };

  const handleDeleteFiles = () => {
    if (!state.selected_file_id) return;
    project.deleteFiles([state.selected_file_id]);
    setMsg("File deleted");
  };

  const handleExportExcel = async () => {
    setMsg("Exporting to Excel...", 50);
    try {
      await exportExcel(buildProjectPayload());
      setMsg("Exported successfully");
    } catch (err) {
      setMsg(`Export error: ${err}`);
    }
  };

  const handleManageTemplates = () => setShowTemplateModal(true);

  const handleExportPdf = () => {
    if (!state.pdf_files.length) return;
    setShowExportModal(true);
  };

  const handleTemplateSave = async (templates: Template[]) => {
    // Detect additions/updates/deletions vs previous state
    const prev = state.templates;
    const prevIds = new Set(prev.map((t) => t.id));
    const nextIds = new Set(templates.map((t) => t.id));

    // Deletions: in prev but not in next
    for (const old of prev) {
      if (!nextIds.has(old.id)) {
        deleteCloudTemplate(old.id).catch(() => {});
      }
    }

    // Additions + updates
    for (const t of templates) {
      if (!prevIds.has(t.id)) {
        // New → create in cloud
        createCloudTemplate({
          name: t.name,
          boxes: t.boxes,
          notes: t.notes ?? "",
        })
          .then(async (created) => {
            // Upload page image if we have a preview file loaded
            await uploadCurrentPageImageForTemplate(created.id);
            // Update local ID to match cloud
            const updated = state.templates.map((lt) =>
              lt.id === t.id ? { ...lt, id: created.id } : lt
            );
            project.saveTemplates(updated);
          })
          .catch(() => {});
      } else {
        // Existing → update in cloud
        const prevT = prev.find((p) => p.id === t.id);
        const changed =
          prevT?.name !== t.name ||
          JSON.stringify(prevT?.boxes) !== JSON.stringify(t.boxes) ||
          prevT?.notes !== t.notes;
        if (changed) {
          updateCloudTemplate(t.id, {
            name: t.name,
            boxes: t.boxes,
            notes: t.notes ?? "",
          }).catch(() => {});
        }
      }
    }

    project.saveTemplates(templates);
  };

  const handleTemplateApply = (template: Template, pages: SelectedPage[]) => {
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
    try {
      await exportPdfPages(entries);
      setMsg(`Exported ${entries.length} PDF(s)`, null);
    } catch (err) {
      setMsg(`Export error: ${err}`);
    }
  };

  const handleRecognizeText = () => {
    if (!state.pdf_files.length) return;
    setShowRecognizeSelector(true);
  };

  const handleRecognizeConfirm = async (pages: SelectedPage[]) => {
    setShowRecognizeSelector(false);
    if (!pages.length) return;

    let done = 0;
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
        setMsg("⚠ Monthly OCR page limit reached. Upgrade your plan.");
        return;
      }
    } catch { /* proceed if usage service unavailable */ }

    setMsg(`Recognizing text (0/${total})...`, 0);

    for (const sp of pages) {
      const file = state.pdf_files.find((f) => f.file_id === sp.file_id);
      const page = file?.pages.find((p) => p.page_number === sp.page_number);
      if (!page) continue;
      for (const box of Object.values(page.boxes)) {
        try {
          const text = await extractText(sp.file_id, sp.page_number, box, status.ocr_available);
          project.setCell(sp.file_id, sp.page_number, box.column_name, text);
        } catch { /* ignore individual failure */ }
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
    } catch { /* non-fatal */ }

    setMsg("Text recognition complete", null);
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
  // Render — route-based
  // --------------------------------------------------------------------------

  // Login screen
  // Login screen (skip in dev mode)
  if (!IS_DEV_MODE && (view === "login" || (!auth.user && !auth.loading))) {
    return <LoginPage onGoogleSignIn={handleGoogleSignIn} />;
  }

  // Loading auth state (skip in dev mode)
  if (!IS_DEV_MODE && auth.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f0f2f5" }}>
        <p>Loading...</p>
      </div>
    );
  }

  // My Account page
  if (view === "account") {
    return (
      <MyAccountPage
        profile={profile}
        isNewUser={isNewUser}
        onSave={handleSaveProfile}
        onGoHome={() => {
          if (profile?.status === "active") setView("main");
        }}
        onSignOut={handleSignOut}
        onOpenAdmin={handleOpenAdmin}
      />
    );
  }

  // Admin panel
  if (view === "admin") {
    return (
      <AdminPanel
        users={adminUsers}
        groups={adminGroups}
        onUpdateUser={handleAdminUpdateUser}
        onResetUsage={handleAdminResetUsage}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onGoHome={() => setView("main")}
      />
    );
  }

  // --------------------------------------------------------------------------
  // Main app view
  // --------------------------------------------------------------------------

  const currentBoxes = project.currentPageData?.boxes ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={onFilesSelected} />
      <input ref={loadInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={onLoadFile} />

      {/* Top toolbar */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Toolbar
            onImport={handleImport}
            onSave={handleSave}
            onLoad={handleLoad}
            onClearData={handleClearData}
            onDeleteFiles={handleDeleteFiles}
            onExportExcel={handleExportExcel}
            onRecognizeText={handleRecognizeText}
            onManageTemplates={handleManageTemplates}
            onExportPdf={handleExportPdf}
            disabled={state.pdf_files.length === 0}
          />
        </div>
        {/* User info / My Account button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0 }}>
          {profile?.photo_url && (
            <img src={profile.photo_url} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
          )}
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

      {/* Main area: Tree | (DataTable + SinglePageDataTable) | PDFViewer */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

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
            />
          )}
        </div>

        {/* Column 2: DataTable (collapsible) + SinglePageDataTable */}
        <div style={{
          flex: "0 0 48%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #ddd",
          overflow: "hidden",
        }}>
          {/* Collapsible DataTable */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            flex: dataTableCollapsed ? "0 0 28px" : "1 1 50%",
            overflow: "hidden",
            borderBottom: "1px solid #ddd",
            transition: "flex 0.2s",
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
              />
            )}
          </div>

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
        </div>

        {/* Column 3: PDF Viewer */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <PDFViewer
            fileId={state.selected_file_id}
            pageNum={state.selected_page}
            boxes={currentBoxes}
            selectedColumn={selectedColumn}
            onDrawBox={handleDrawBox}
          />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        fileCount={state.pdf_files.length}
        pageCount={totalPages}
        usagePages={usagePages}
        usageLimit={usageLimit}
      />
    </div>
  );
}
