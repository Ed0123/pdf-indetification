/**
 * TemplateModal — Manage named extraction templates.
 *
 * Layout:
 *   Left  : scrollable table of all templates
 *   Right : detail panel for the selected template
 *            – editable name + notes
 *            – colored column list
 *            – PDF thumbnail with box overlay
 *            – Edit / Update / Delete / Apply / Close
 */
import React, { useState, useEffect, useRef } from "react";
import type { Template, TemplateBox, PDFFileInfo } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageSelectorModal, type SelectedPage } from "./PageSelectorModal";
import { renderPage } from "../api/client";

// Fixed color palette for boxes
export const BOX_COLORS = [
  "#e74c3c", "#2980b9", "#27ae60", "#f39c12",
  "#8e44ad", "#16a085", "#d35400", "#2c3e50",
];

export function assignColors(boxes: Omit<TemplateBox, "color">[]): TemplateBox[] {
  return boxes.map((b, i) => ({ ...b, color: BOX_COLORS[i % BOX_COLORS.length] }));
}

interface TemplateModalProps {
  templates: Template[];
  files: PDFFileInfo[];
  /** Boxes from the currently viewed page (for "New from current" button) */
  currentBoxes: TemplateBox[];
  currentFileId: string | null;
  currentPage: number;
  onSave: (templates: Template[]) => void;
  onApply: (template: Template, pages: SelectedPage[]) => void;
  onClose: () => void;
}

type EditorMode = "view" | "edit";

export function TemplateModal({
  templates: initialTemplates,
  files,
  currentBoxes,
  currentFileId,
  currentPage,
  onSave,
  onApply,
  onClose,
}: TemplateModalProps) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTemplates[0]?.id ?? null
  );
  const [mode, setMode] = useState<EditorMode>("view");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showPageSelector, setShowPageSelector] = useState(false);

  // Editable fields for detail panel
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBoxes, setEditBoxes] = useState<TemplateBox[]>([]);

  // Thumbnail
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  // Populate edit fields when selection changes
  useEffect(() => {
    if (!selected) return;
    setEditName(selected.name);
    setEditNotes(selected.notes);
    setEditBoxes(selected.boxes.map((b) => ({ ...b })));
    setMode("view");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load thumbnail when selection changes
  useEffect(() => {
    if (!selected?.preview_file_id) { setThumbSrc(null); return; }
    renderPage(selected.preview_file_id, selected.preview_page, 1.0)
      .then((b64) => setThumbSrc(`data:image/png;base64,${b64}`))
      .catch(() => setThumbSrc(null));
  }, [selected?.preview_file_id, selected?.preview_page]);

  // Draw boxes on canvas whenever thumbnail or boxes change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const boxes = mode === "edit" ? editBoxes : (selected?.boxes ?? []);
      boxes.forEach((box) => {
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          box.x * canvas.width,
          box.y * canvas.height,
          box.width * canvas.width,
          box.height * canvas.height
        );
        ctx.fillStyle = box.color;
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(box.column_name, box.x * canvas.width + 2, box.y * canvas.height - 3);
      });
    };
    if (thumbSrc) img.src = thumbSrc;
  }, [thumbSrc, selected?.boxes, editBoxes, mode]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const createFromCurrent = () => {
    const id = crypto.randomUUID();
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
    onSave(updated);
    setSelectedId(id);
  };

  const handleUpdate = () => {
    const updated = templates.map((t) =>
      t.id === selectedId
        ? { ...t, name: editName, notes: editNotes, boxes: editBoxes }
        : t
    );
    setTemplates(updated);
    onSave(updated);
    setMode("view");
  };

  const handleDelete = () => {
    const updated = templates.filter((t) => t.id !== selectedId);
    setTemplates(updated);
    onSave(updated);
    setSelectedId(updated[0]?.id ?? null);
    setShowConfirmDelete(false);
  };

  const handleApplyConfirm = (pages: SelectedPage[]) => {
    if (!selected) return;
    onApply(selected, pages);
    setShowPageSelector(false);
  };

  const shortId = (id: string) => id.slice(0, 8).toUpperCase();

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={overlay}>
        <div style={modal}>
          {/* ── Title bar ── */}
          <div style={titleBar}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>📋 Template Manager</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={btnSmall}
                onClick={createFromCurrent}
                disabled={currentBoxes.length === 0}
                title={currentBoxes.length === 0 ? "Draw boxes on a page first" : "Save current page boxes as a new template"}
              >
                + New from current boxes
              </button>
              <button style={btnSmall} onClick={onClose}>✕ Close</button>
            </div>
          </div>

          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* ── Left: template list ── */}
            <div style={leftPanel}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f0f0f0" }}>
                    {["ID", "Name", "Columns", "Notes"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {templates.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: 16, color: "#999" }}>
                      No templates yet. Draw boxes on a page and click "+ New from current boxes".
                    </td></tr>
                  )}
                  {templates.map((t) => (
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
                      <td style={{ ...tdStyle, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Right: detail panel ── */}
            <div style={rightPanel}>
              {!selected ? (
                <div style={{ padding: 32, color: "#999", textAlign: "center" }}>
                  Select a template from the list
                </div>
              ) : (
                <>
                  {/* ID + Name */}
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 11, color: "#888" }}>Template ID: {shortId(selected.id)}</div>
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

                  {/* Columns with colors */}
                  <div style={{ borderBottom: "1px solid #eee", padding: "6px 12px" }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Columns</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {(mode === "edit" ? editBoxes : selected.boxes).map((box, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: box.color, flexShrink: 0 }} />
                          {mode === "edit" ? (
                            <>
                              <input
                                style={{ ...inputStyle, flex: 1 }}
                                value={box.column_name}
                                onChange={(e) => {
                                  const next = [...editBoxes];
                                  next[i] = { ...next[i], column_name: e.target.value };
                                  setEditBoxes(next);
                                }}
                              />
                              <button
                                style={{ ...btnSmall, padding: "1px 6px", color: "#e74c3c" }}
                                onClick={() => setEditBoxes((prev) => prev.filter((_, j) => j !== i))}
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <span>{box.column_name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* PDF Thumbnail */}
                  <div style={{ borderBottom: "1px solid #eee", padding: 8, display: "flex", justifyContent: "center", background: "#888", minHeight: 120, alignItems: "center" }}>
                    {thumbSrc ? (
                      <div style={{ position: "relative", maxWidth: "100%" }}>
                        <canvas
                          ref={canvasRef}
                          style={{ maxWidth: "100%", maxHeight: 200, display: "block" }}
                        />
                      </div>
                    ) : (
                      <span style={{ color: "#ccc", fontSize: 12 }}>No preview available</span>
                    )}
                  </div>

                  {/* Notes */}
                  <div style={{ padding: "6px 12px", borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Notes</div>
                    <textarea
                      style={{ width: "100%", minHeight: 48, fontSize: 12, border: "1px solid #ccc", borderRadius: 3, padding: 4, resize: "vertical", boxSizing: "border-box" }}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      disabled={mode === "view"}
                    />
                  </div>

                  {/* Action buttons */}
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={btnAction} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
                        {mode === "edit" ? "Cancel Edit" : "✏ Edit"}
                      </button>
                      <button style={btnAction} onClick={handleUpdate} disabled={mode === "view"}>
                        💾 Update
                      </button>
                      <button style={{ ...btnAction, color: "#e74c3c" }} onClick={() => setShowConfirmDelete(true)}>
                        🗑 Delete
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={{ ...btnAction, background: "#2980b9", color: "#fff", border: "1px solid #2471a3" }} onClick={() => setShowPageSelector(true)}>
                        ▶ Apply to Pages…
                      </button>
                      <button style={btnAction} onClick={onClose}>Close</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
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

      {/* Page selector */}
      {showPageSelector && (
        <PageSelectorModal
          files={files}
          title={`Apply "${selected?.name}" to pages`}
          confirmLabel="Apply"
          onConfirm={handleApplyConfirm}
          onCancel={() => setShowPageSelector(false)}
        />
      )}
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 6, display: "flex", flexDirection: "column",
  width: "90vw", maxWidth: 960, height: "85vh",
  boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
};
const titleBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 16px", background: "#f0f0f0", borderBottom: "1px solid #ddd",
  borderRadius: "6px 6px 0 0",
};
const leftPanel: React.CSSProperties = {
  flex: "0 0 55%", overflowY: "auto", borderRight: "1px solid #ddd",
};
const rightPanel: React.CSSProperties = {
  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
};
const thStyle: React.CSSProperties = {
  padding: "5px 8px", border: "1px solid #ddd", fontWeight: 600, textAlign: "left",
};
const tdStyle: React.CSSProperties = {
  padding: "4px 8px", border: "1px solid #eee",
};
const inputStyle: React.CSSProperties = {
  padding: "3px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12, flex: 1,
};
const btnSmall: React.CSSProperties = {
  padding: "4px 10px", border: "1px solid #ccc", borderRadius: 3,
  background: "#f5f5f5", cursor: "pointer", fontSize: 12,
};
const btnAction: React.CSSProperties = {
  flex: 1, padding: "5px 8px", border: "1px solid #ccc", borderRadius: 4,
  background: "#f5f5f5", cursor: "pointer", fontSize: 12, fontWeight: 500,
};
