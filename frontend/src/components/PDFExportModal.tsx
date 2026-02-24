/**
 * PDFExportModal — Select pages and configure per-page output filenames,
 * then trigger a ZIP download of individually-named PDF pages.
 *
 * Steps:
 *  1. Select pages (PageSelectorModal)
 *  2. Configure naming:
 *       Box 1 column dropdown  (optional)
 *       Box 2 column dropdown  (optional)
 *       Notes suffix           (optional free text)
 *       Fully editable per-row filename override
 *  3. Confirm → call onExport
 */
import React, { useState, useMemo, useEffect } from "react";
import type { PDFFileInfo, ExtractedDataColumn, PageData } from "../types";
import { PageSelectorModal, type SelectedPage } from "./PageSelectorModal";

export interface NamingConfig {
  box1Column: string | null;
  box2Column: string | null;
  notes: string;
}

export interface ExportPageEntry {
  file_id: string;
  page_number: number;
  filename: string;
}

interface PDFExportModalProps {
  files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  onExport: (entries: ExportPageEntry[]) => void;
  onCancel: () => void;
}

// Replace characters invalid in Windows filenames
function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").trim() || "page";
}

function buildFilename(
  file: PDFFileInfo,
  pageNum: number,
  config: NamingConfig
): string {
  // Use .find() to safely locate the correct page regardless of array order
  const page: PageData | undefined = file.pages.find((p) => p.page_number === pageNum) ?? file.pages[pageNum];
  const get = (col: string | null): string => {
    if (!col) return "";
    // Check extracted data first for ALL columns including "Page Name"
    const val = page?.extracted_data[col];
    if (val) return sanitize(String(val));
    // "Page Name" / "Page" fallback → page number when no extracted text
    if (col === "Page Name" || col === "Page") return String(pageNum + 1);
    return "";
  };
  const parts = [get(config.box1Column), get(config.box2Column), sanitize(config.notes)].filter(
    (s) => s !== "" && s !== "page"
  );
  const base = parts.length ? parts.join("-") : `page${pageNum + 1}`;
  return `${base}.pdf`;
}

/** Add (1), (2) suffixes for duplicate filenames within the same batch */
function deduplicateFilenames(entries: ExportPageEntry[]): ExportPageEntry[] {
  const seen: Record<string, number> = {};
  return entries.map((e) => {
    const key = e.filename.toLowerCase();
    if (!(key in seen)) {
      seen[key] = 0;
      return e;
    }
    seen[key] += 1;
    const dotIdx = e.filename.lastIndexOf(".");
    const name = dotIdx >= 0 ? e.filename.slice(0, dotIdx) : e.filename;
    const ext = dotIdx >= 0 ? e.filename.slice(dotIdx) : "";
    return { ...e, filename: `${name} (${seen[key]})${ext}` };
  });
}

type Step = "select" | "configure";

export function PDFExportModal({ files, columns, onExport, onCancel }: PDFExportModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [selectedPages, setSelectedPages] = useState<SelectedPage[]>([]);
  const [config, setConfig] = useState<NamingConfig>({
    box1Column: null,
    box2Column: null,
    notes: "",
  });
  // Editable per-row filenames (keyed by index)
  const [editableFilenames, setEditableFilenames] = useState<string[]>([]);

  const fileMap = useMemo(() => {
    const m: Record<string, PDFFileInfo> = {};
    files.forEach((f) => (m[f.file_id] = f));
    return m;
  }, [files]);

  // Recompute base entries whenever config or pages change
  const computedEntries = useMemo<ExportPageEntry[]>(() => {
    const raw = selectedPages.map((sp) => {
      const file = fileMap[sp.file_id];
      return {
        file_id: sp.file_id,
        page_number: sp.page_number,
        filename: file ? buildFilename(file, sp.page_number, config) : `page${sp.page_number + 1}.pdf`,
      };
    });
    return deduplicateFilenames(raw);
  }, [selectedPages, config, fileMap]);

  // Sync computed → editable whenever computed changes (config or pages changed)
  useEffect(() => {
    setEditableFilenames(computedEntries.map((e) => e.filename));
  }, [computedEntries]);

  const handlePagesConfirm = (pages: SelectedPage[]) => {
    setSelectedPages(pages);
    setStep("configure");
  };

  const handleFilenameChange = (idx: number, value: string) => {
    setEditableFilenames((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const handleExport = () => {
    const finalEntries = computedEntries.map((e, i) => ({
      ...e,
      filename: editableFilenames[i] ?? e.filename,
    }));
    onExport(finalEntries);
  };

  // Show ALL columns (including "Page Name" which auto-fills page number)
  const allColumns = columns;

  // ─── Step 1 ───────────────────────────────────────────────────────────────
  if (step === "select") {
    return (
      <PageSelectorModal
        files={files}
        title="Export PDF Pages — Select Pages"
        confirmLabel="Next: Configure Names →"
        onConfirm={handlePagesConfirm}
        onCancel={onCancel}
      />
    );
  }

  // ─── Step 2 ───────────────────────────────────────────────────────────────
  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={titleBar}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>📄 Export PDF Pages — Configure Names</span>
          <div style={{ fontSize: 12, color: "#555" }}>{selectedPages.length} page(s) selected</div>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: 16 }}>
          {/* Naming pattern controls */}
          <div style={section}>
            <div style={sectionTitle}>Output Filename Pattern</div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 12px", alignItems: "center", fontSize: 13 }}>
              <label>Box 1 column:</label>
              <select
                style={selectStyle}
                value={config.box1Column ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, box1Column: e.target.value || null }))}
              >
                <option value="">(none)</option>
                {allColumns.map((col) => (
                  <option key={col.name} value={col.name}>{col.name}{(col.name === "Page Name" || col.name === "Page") ? " (page number)" : ""}</option>
                ))}
              </select>

              <label>Box 2 column:</label>
              <select
                style={selectStyle}
                value={config.box2Column ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, box2Column: e.target.value || null }))}
              >
                <option value="">(none)</option>
                {allColumns.map((col) => (
                  <option key={col.name} value={col.name}>{col.name}{(col.name === "Page Name" || col.name === "Page") ? " (page number)" : ""}</option>
                ))}
              </select>

              <label>Notes suffix:</label>
              <input
                style={inputStyle}
                value={config.notes}
                onChange={(e) => setConfig((c) => ({ ...c, notes: e.target.value }))}
                placeholder="e.g. 2025Q1"
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>
              Pattern: <code>[box1]-[box2]-[notes].pdf</code> — invalid chars → <code>-</code>.
              You can also edit each filename directly in the table below.
            </div>
          </div>

          {/* Preview / edit table */}
          <div style={section}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={sectionTitle}>Preview &amp; Edit ({computedEntries.length} files)</span>
              <button
                style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #ccc", borderRadius: 3, background: "#f5f5f5", cursor: "pointer" }}
                onClick={() => setEditableFilenames(computedEntries.map((e) => e.filename))}
                title="Reset all filenames to auto-generated values"
              >
                ↺ Reset all
              </button>
            </div>
            <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f0f0f0", position: "sticky", top: 0 }}>
                    <th style={thStyle}>Source File</th>
                    <th style={thStyle}>Page</th>
                    <th style={thStyle}>Output Filename (editable)</th>
                  </tr>
                </thead>
                <tbody>
                  {computedEntries.map((e, idx) => {
                    const file = fileMap[e.file_id];
                    return (
                      <tr key={idx} style={{ background: idx % 2 ? "#fafafa" : "#fff" }}>
                        <td style={tdStyle}>{file?.file_name ?? e.file_id.slice(0, 8)}</td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>{e.page_number + 1}</td>
                        <td style={tdStyle}>
                          <input
                            style={{
                              width: "100%",
                              fontFamily: "monospace",
                              fontSize: 12,
                              padding: "2px 4px",
                              border: "1px solid #ccc",
                              borderRadius: 2,
                              boxSizing: "border-box",
                            }}
                            value={editableFilenames[idx] ?? e.filename}
                            onChange={(ev) => handleFilenameChange(idx, ev.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={footer}>
          <button style={btnSecondary} onClick={() => setStep("select")}>← Back</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnSecondary} onClick={onCancel}>Cancel</button>
            <button
              style={btnPrimary}
              onClick={handleExport}
              disabled={computedEntries.length === 0}
            >
              ⬇ Export {computedEntries.length} PDF{computedEntries.length !== 1 ? "s" : ""} as ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 6, display: "flex", flexDirection: "column",
  width: "80vw", maxWidth: 820, maxHeight: "88vh",
  boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
};
const titleBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 16px", background: "#f0f0f0", borderBottom: "1px solid #ddd",
  borderRadius: "6px 6px 0 0",
};
const section: React.CSSProperties = {
  marginBottom: 16, padding: 12, background: "#fafafa",
  border: "1px solid #eee", borderRadius: 4,
};
const sectionTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 0, fontSize: 13 };
const footer: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 16px", borderTop: "1px solid #ddd",
};
const thStyle: React.CSSProperties = { padding: "5px 8px", border: "1px solid #ddd", textAlign: "left", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "4px 8px", border: "1px solid #eee" };
const selectStyle: React.CSSProperties = { padding: "4px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12 };
const inputStyle: React.CSSProperties = { padding: "4px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12 };
const btnPrimary: React.CSSProperties = {
  padding: "6px 16px", background: "#2980b9", color: "#fff",
  border: "1px solid #2471a3", borderRadius: 4, cursor: "pointer", fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 16px", background: "#f5f5f5", color: "#333",
  border: "1px solid #ccc", borderRadius: 4, cursor: "pointer",
};

