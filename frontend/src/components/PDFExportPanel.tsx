/**
 * PDFExportPanel — PDF export panel for exporting selected pages.
 * 
 * Shows a page list with checkboxes for selection and label editing.
 * Used when clicking "PDF" in ActivityBar.
 */
import React, { useState, useCallback, useMemo } from "react";
import type { PDFFileInfo, ExtractedDataColumn } from "../types";
import type { ExportPageEntry } from "./PDFExportModal";

interface PDFExportPanelProps {
  files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  onExport: (entries: ExportPageEntry[]) => void;
}

export function PDFExportPanel({
  files,
  columns,
  onExport,
}: PDFExportPanelProps) {
  // Build flat list of pages
  const allPages = useMemo(() => {
    return files.flatMap((f) =>
      f.pages.map((p) => ({
        file_id: f.file_id,
        file_name: f.file_name,
        page_number: p.page_number,
        extracted: p.extracted_data,
        template: p.applied_template ?? "",
      }))
    );
  }, [files]);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set(allPages.map((p) => `${p.file_id}-${p.page_number}`)));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [filterText, setFilterText] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);

  // Filter
  const filtered = useMemo(() => 
    allPages.filter((p) => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      const label = labels[`${p.file_id}-${p.page_number}`] ?? "";
      return (
        p.file_name.toLowerCase().includes(q) ||
        label.toLowerCase().includes(q) ||
        p.template.toLowerCase().includes(q)
      );
    }), [allPages, filterText, labels]
  );

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => `${p.file_id}-${p.page_number}`)));
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = () => {
    const entries: ExportPageEntry[] = filtered
      .filter((p) => selected.has(`${p.file_id}-${p.page_number}`))
      .map((p) => ({
        file_id: p.file_id,
        page_number: p.page_number,
        filename: labels[`${p.file_id}-${p.page_number}`] || `${p.file_name.replace(/\.pdf$/i, "")}_P${p.page_number + 1}`,
      }));
    onExport(entries);
  };

  const selectedCount = filtered.filter((p) => selected.has(`${p.file_id}-${p.page_number}`)).length;

  return (
    <div style={container}>
      {/* Title bar */}
      <div style={titleBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📄 PDF Export</span>
          <span style={{ fontSize: 11, color: "#666" }}>
            {selectedCount} of {filtered.length} pages selected
          </span>
        </div>
        <button
          style={exportBtn}
          onClick={handleExport}
          disabled={selectedCount === 0}
        >
          📥 Export {selectedCount} PDF(s) as ZIP
        </button>
      </div>

      {/* Filter bar */}
      <div style={filterBar}>
        <input
          style={filterInput}
          placeholder="Filter by filename or label..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <button style={smBtn} onClick={toggleAll}>
          {selected.size === filtered.length ? "Deselect All" : "Select All"}
        </button>
      </div>

      {/* Table */}
      <div style={tableContainer}>
        {files.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
            <div>No PDF files loaded</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Import PDF files to export pages</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f0f0f0", position: "sticky", top: 0, zIndex: 1 }}>
                <th style={{ ...th, width: 30 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th style={th}>File Name</th>
                <th style={{ ...th, width: 60 }}>Page</th>
                <th style={th}>Template</th>
                <th style={th}>Export Label (filename)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 20, color: "#999" }}>
                    No pages match the filter
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const key = `${p.file_id}-${p.page_number}`;
                const isSelected = selected.has(key);
                const isEditing = editingLabel === key;
                const label = labels[key] ?? "";
                const defaultLabel = `${p.file_name.replace(/\.pdf$/i, "")}_P${p.page_number + 1}`;
                return (
                  <tr
                    key={key}
                    style={{ background: isSelected ? "#eaf4fb" : "transparent", cursor: "pointer" }}
                    onClick={() => toggle(key)}
                  >
                    <td style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(key)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td style={td}>{p.file_name}</td>
                    <td style={{ ...td, textAlign: "center" }}>{p.page_number + 1}</td>
                    <td style={{ ...td, color: p.template ? "#2471a3" : "#bbb", fontStyle: p.template ? "normal" : "italic" }}>
                      {p.template || "—"}
                    </td>
                    <td
                      style={td}
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(key); }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          style={{ width: "100%", border: "none", fontSize: 12, padding: "2px 4px" }}
                          defaultValue={label || defaultLabel}
                          onBlur={(e) => {
                            setLabels((prev) => ({ ...prev, [key]: e.target.value }));
                            setEditingLabel(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span style={{ color: label ? "#333" : "#999" }}>
                          {label || defaultLabel}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Stats bar */}
      <div style={statsBar}>
        <span>Double-click label to customize export filename</span>
        <span>Pages will be exported as individual PDFs in a ZIP file</span>
      </div>
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

const exportBtn: React.CSSProperties = {
  padding: "6px 16px",
  fontSize: 12,
  fontWeight: 600,
  border: "none",
  borderRadius: 4,
  background: "#e74c3c",
  color: "#fff",
  cursor: "pointer",
};

const filterBar: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "6px 8px",
  borderBottom: "1px solid #ddd",
  background: "#fafafa",
};

const filterInput: React.CSSProperties = {
  flex: 1,
  padding: "4px 8px",
  border: "1px solid #ccc",
  borderRadius: 3,
  fontSize: 12,
};

const smBtn: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 11,
};

const tableContainer: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "auto",
};

const emptyState: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#aaa",
  fontSize: 14,
};

const th: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ddd",
  fontWeight: 600,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #eee",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const statsBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "4px 12px",
  background: "#f5f5f5",
  borderTop: "1px solid #ddd",
  fontSize: 11,
  color: "#666",
};
