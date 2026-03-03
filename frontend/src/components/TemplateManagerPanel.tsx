/**
 * TemplateManagerPanel — Embedded template manager (not a modal).
 * 
 * Shows the same content as TemplateModal but inline in the main panel.
 * Used when clicking "Tmpl" in ActivityBar.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Template, TemplateBox, PDFFileInfo, BQTemplate, BoxInfo } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageSelectorModal, type SelectedPage } from "./PageSelectorModal";
import { renderPage, getTemplatePageImageUrl } from "../api/client";

// Fixed color palette for boxes
const BOX_COLORS = [
  "#e74c3c", "#2980b9", "#27ae60", "#f39c12",
  "#8e44ad", "#16a085", "#d35400", "#2c3e50",
];

type TemplateKind = "page" | "bq";

interface TemplateManagerPanelProps {
  templates: Template[];
  bqTemplates: BQTemplate[];
  files: PDFFileInfo[];
  currentBoxes: TemplateBox[];
  currentBQBoxes: BoxInfo[];
  currentFileId: string | null;
  currentPage: number;
  currentUserUid?: string;
  onSaveTemplates: (templates: Template[]) => void;
  onApplyTemplate: (template: Template, pages: SelectedPage[]) => void;
  onSaveBQTemplates: (templates: BQTemplate[]) => void;
  onApplyBQTemplate: (templateId: string) => void;
}

type EditorMode = "view" | "edit";

export function TemplateManagerPanel({
  templates: initialTemplates,
  bqTemplates: initialBQTemplates,
  files,
  currentBoxes,
  currentBQBoxes,
  currentFileId,
  currentPage,
  currentUserUid,
  onSaveTemplates,
  onApplyTemplate,
  onSaveBQTemplates,
  onApplyBQTemplate,
}: TemplateManagerPanelProps) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [bqTemplates, setBqTemplates] = useState<BQTemplate[]>(initialBQTemplates);
  const [activeTab, setActiveTab] = useState<TemplateKind>("page");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("view");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showPageSelector, setShowPageSelector] = useState(false);
  const [filterText, setFilterText] = useState("");

  // Editable fields
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBoxes, setEditBoxes] = useState<TemplateBox[]>([]);

  // Thumbnail
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);

  // Sync with props
  useEffect(() => {
    setTemplates(initialTemplates);
  }, [initialTemplates]);

  useEffect(() => {
    setBqTemplates(initialBQTemplates);
  }, [initialBQTemplates]);

  // Current selected template
  const selected = activeTab === "page"
    ? templates.find((t) => t.id === selectedId) ?? null
    : bqTemplates.find((t) => t.id === selectedId) ?? null;

  // Filter templates
  const filteredTemplates = activeTab === "page"
    ? templates.filter((t) => {
        if (!filterText.trim()) return true;
        const q = filterText.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.boxes.some((b) => b.column_name.toLowerCase().includes(q)) ||
          (t.notes ?? "").toLowerCase().includes(q)
        );
      })
    : bqTemplates.filter((t) => {
        if (!filterText.trim()) return true;
        const q = filterText.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.boxes.some((b) => b.column_name.toLowerCase().includes(q)) ||
          (t.notes ?? "").toLowerCase().includes(q)
        );
      });

  // Update edit fields when selection changes
  useEffect(() => {
    if (!selected) {
      setEditName("");
      setEditNotes("");
      setEditBoxes([]);
      return;
    }
    setEditName(selected.name);
    setEditNotes(selected.notes ?? "");
    setEditBoxes(selected.boxes.map((b) => ({
      column_name: b.column_name,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: b.color || BOX_COLORS[0],
    })));
    setMode("view");
  }, [selectedId, selected]);

  // Load thumbnail
  useEffect(() => {
    if (!selected) {
      setThumbSrc(null);
      return;
    }
    if (selected.preview_file_id) {
      renderPage(selected.preview_file_id, selected.preview_page ?? 0, 1.0)
        .then((b64) => setThumbSrc(`data:image/png;base64,${b64}`))
        .catch(() => tryCloudImage());
    } else {
      tryCloudImage();
    }
    function tryCloudImage() {
      if (activeTab === "page") {
        getTemplatePageImageUrl(selected!.id)
          .then((res) => res.url ? setThumbSrc(res.url) : setThumbSrc(null))
          .catch(() => setThumbSrc(null));
      } else {
        setThumbSrc(null);
      }
    }
  }, [selected?.id, selected?.preview_file_id, activeTab]);

  // Draw boxes on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbSrc) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const boxes = mode === "edit" ? editBoxes : (selected?.boxes ?? []);
      boxes.forEach((box) => {
        ctx.strokeStyle = box.color || "#2980b9";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          box.x * canvas.width,
          box.y * canvas.height,
          box.width * canvas.width,
          box.height * canvas.height
        );
        ctx.fillStyle = box.color || "#2980b9";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(box.column_name, box.x * canvas.width + 2, box.y * canvas.height - 3);
      });
    };
    img.src = thumbSrc;
  }, [thumbSrc, selected?.boxes, editBoxes, mode]);

  // Create new template from current boxes
  const createFromCurrent = useCallback(() => {
    const id = crypto.randomUUID();
    if (activeTab === "page") {
      const newT: Template = {
        id,
        name: `Template ${templates.length + 1}`,
        boxes: currentBoxes.map((b, i) => ({ ...b, color: BOX_COLORS[i % BOX_COLORS.length] })),
        notes: "",
        preview_file_id: currentFileId,
        preview_page: currentPage,
      };
      const updated = [...templates, newT];
      setTemplates(updated);
      onSaveTemplates(updated);
      setSelectedId(id);
    } else {
      const newT: BQTemplate = {
        id,
        name: `BQ Template ${bqTemplates.length + 1}`,
        boxes: Object.values(currentBQBoxes).map((b, i) => ({
          ...b,
          color: BOX_COLORS[i % BOX_COLORS.length],
        })),
        notes: "",
        preview_file_id: currentFileId,
        preview_page: currentPage,
        owner_uid: currentUserUid,
      };
      const updated = [...bqTemplates, newT];
      setBqTemplates(updated);
      onSaveBQTemplates(updated);
      setSelectedId(id);
    }
  }, [activeTab, templates, bqTemplates, currentBoxes, currentBQBoxes, currentFileId, currentPage, onSaveTemplates, onSaveBQTemplates, currentUserUid]);

  const handleUpdate = useCallback(() => {
    if (activeTab === "page") {
      const updated = templates.map((t) =>
        t.id === selectedId
          ? { ...t, name: editName, notes: editNotes, boxes: editBoxes }
          : t
      );
      setTemplates(updated);
      onSaveTemplates(updated);
    } else {
      const updated = bqTemplates.map((t) =>
        t.id === selectedId
          ? { ...t, name: editName, notes: editNotes, boxes: editBoxes }
          : t
      );
      setBqTemplates(updated);
      onSaveBQTemplates(updated);
    }
    setMode("view");
  }, [activeTab, selectedId, editName, editNotes, editBoxes, templates, bqTemplates, onSaveTemplates, onSaveBQTemplates]);

  const handleDelete = useCallback(() => {
    if (activeTab === "page") {
      const updated = templates.filter((t) => t.id !== selectedId);
      setTemplates(updated);
      onSaveTemplates(updated);
      setSelectedId(updated[0]?.id ?? null);
    } else {
      const updated = bqTemplates.filter((t) => t.id !== selectedId);
      setBqTemplates(updated);
      onSaveBQTemplates(updated);
      setSelectedId(updated[0]?.id ?? null);
    }
    setShowConfirmDelete(false);
  }, [activeTab, selectedId, templates, bqTemplates, onSaveTemplates, onSaveBQTemplates]);

  const handleApplyConfirm = useCallback((pages: SelectedPage[]) => {
    if (!selected || activeTab !== "page") return;
    onApplyTemplate(selected as Template, pages);
    setShowPageSelector(false);
  }, [selected, activeTab, onApplyTemplate]);

  const handleApplyBQ = useCallback(() => {
    if (!selected || activeTab !== "bq") return;
    onApplyBQTemplate(selected.id);
  }, [selected, activeTab, onApplyBQTemplate]);

  const shortId = (id: string) => id.slice(0, 8).toUpperCase();

  const hasCurrentBoxes = activeTab === "page" 
    ? currentBoxes.length > 0 
    : Object.keys(currentBQBoxes).length > 0;

  return (
    <div style={container}>
      {/* Title bar with tabs */}
      <div style={titleBar}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📋 Template Manager</span>
          <div style={tabsContainer}>
            <button
              style={{ ...tabBtn, ...(activeTab === "page" ? activeTabBtn : {}) }}
              onClick={() => { setActiveTab("page"); setSelectedId(templates[0]?.id ?? null); }}
            >
              Page Templates ({templates.length})
            </button>
            <button
              style={{ ...tabBtn, ...(activeTab === "bq" ? activeTabBtn : {}) }}
              onClick={() => { setActiveTab("bq"); setSelectedId(bqTemplates[0]?.id ?? null); }}
            >
              BQ Templates ({bqTemplates.length})
            </button>
          </div>
        </div>
        <button
          style={btnSmall}
          onClick={createFromCurrent}
          disabled={!hasCurrentBoxes}
          title={hasCurrentBoxes ? "Save current page boxes as a new template" : "Draw boxes on a page first"}
        >
          + New from current boxes
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: template list */}
        <div style={leftPanel}>
          {/* Filter */}
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #eee" }}>
            <input
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              placeholder="🔍 搜尋模板名稱 / 欄位 / 備註"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f0f0f0", position: "sticky", top: 0, zIndex: 1 }}>
                  {["ID", "Name", "Columns", "Notes"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "#999" }}>
                    {(activeTab === "page" ? templates : bqTemplates).length === 0
                      ? 'No templates yet. Draw boxes in the viewer and click "+ New from current boxes".'
                      : "No templates match the filter."}
                  </td></tr>
                )}
                {filteredTemplates.map((t) => (
                  <tr
                    key={t.id}
                    style={{
                      background: t.id === selectedId ? "#d6eaf8" : "transparent",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td style={tdStyle}>{shortId(t.id)}</td>
                    <td style={tdStyle}>{t.name}</td>
                    <td style={tdStyle}>{t.boxes.map((b) => b.column_name).join(", ")}</td>
                    <td style={{ ...tdStyle, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: detail panel */}
        <div style={rightPanel}>
          {!selected ? (
            <div style={{ padding: 32, color: "#999", textAlign: "center" }}>
              Select a template from the list
            </div>
          ) : (
            <>
              {/* Name */}
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {activeTab === "page" ? "Page" : "BQ"} Template ID: {shortId(selected.id)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: "#555", minWidth: 50 }}>Name:</span>
                  <input
                    style={inputStyle}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={mode === "view"}
                  />
                </div>
              </div>

              {/* Columns */}
              <div style={{ borderBottom: "1px solid #eee", padding: "6px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Columns ({editBoxes.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(mode === "edit" ? editBoxes : selected.boxes).map((box, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: box.color || "#888", flexShrink: 0 }} />
                      <span style={{ padding: "2px 6px", background: "#f5f5f5", borderRadius: 3 }}>{box.column_name}</span>
                      {mode === "edit" && (
                        <button
                          style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 10 }}
                          onClick={() => setEditBoxes((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Thumbnail */}
              <div style={{ borderBottom: "1px solid #eee", padding: 8, display: "flex", justifyContent: "center", background: "#888", minHeight: 100, alignItems: "center" }}>
                {thumbSrc ? (
                  <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: 160, display: "block" }} />
                ) : (
                  <span style={{ color: "#ccc", fontSize: 12 }}>No preview available</span>
                )}
              </div>

              {/* Notes */}
              <div style={{ padding: "6px 12px", borderBottom: "1px solid #eee" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Notes</div>
                <textarea
                  style={{ width: "100%", minHeight: 40, fontSize: 12, border: "1px solid #ccc", borderRadius: 3, padding: 4, resize: "vertical", boxSizing: "border-box" }}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  disabled={mode === "view"}
                />
              </div>

              {/* Actions */}
              <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={btnAction} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
                    {mode === "edit" ? "Cancel" : "✏ Edit"}
                  </button>
                  <button style={btnAction} onClick={handleUpdate} disabled={mode === "view"}>
                    💾 Save
                  </button>
                  <button style={{ ...btnAction, color: "#e74c3c" }} onClick={() => setShowConfirmDelete(true)}>
                    🗑 Delete
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {activeTab === "page" ? (
                    <button
                      style={{ ...btnAction, background: "#2980b9", color: "#fff", border: "1px solid #2471a3" }}
                      onClick={() => setShowPageSelector(true)}
                    >
                      ▶ Apply to Pages…
                    </button>
                  ) : (
                    <button
                      style={{ ...btnAction, background: "#9b59b6", color: "#fff", border: "1px solid #8e44ad" }}
                      onClick={handleApplyBQ}
                    >
                      ▶ Apply to Current Page
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirm delete */}
      {showConfirmDelete && (
        <ConfirmDialog
          message={`Delete template "${selected?.name}"?`}
          detail="This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowConfirmDelete(false)}
        />
      )}

      {/* Page selector - only for page templates */}
      {showPageSelector && activeTab === "page" && (
        <PageSelectorModal
          files={files}
          title={`Apply "${selected?.name}" to pages`}
          confirmLabel="Apply"
          onConfirm={handleApplyConfirm}
          onCancel={() => setShowPageSelector(false)}
        />
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#fff",
  overflow: "hidden",
};

const titleBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  background: "#f0f0f0",
  borderBottom: "1px solid #ddd",
  flexWrap: "wrap",
  gap: 8,
};

const tabsContainer: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginLeft: 12,
};

const tabBtn: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: "4px 4px 0 0",
  background: "#fff",
  cursor: "pointer",
  color: "#666",
};

const activeTabBtn: React.CSSProperties = {
  background: "#fff",
  borderBottom: "1px solid #fff",
  color: "#2980b9",
  fontWeight: 600,
};

const leftPanel: React.CSSProperties = {
  flex: "0 0 50%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRight: "1px solid #ddd",
};

const rightPanel: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
};

const thStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid #ddd",
  fontWeight: 600,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #eee",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  padding: "3px 6px",
  border: "1px solid #ccc",
  borderRadius: 3,
  fontSize: 12,
  flex: 1,
};

const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 11,
};

const btnAction: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
};
