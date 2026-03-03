/**
 * ExcelExportPanel — Excel export panel with data preview and editing.
 * 
 * Shows a DataTable-like view with all extracted data and an export button.
 * Used when clicking "Excel" in ActivityBar.
 */
import React, { useState, useCallback, useMemo } from "react";
import type { PDFFileInfo, ExtractedDataColumn } from "../types";
import { PageSelectorModal, type SelectedPage } from "./PageSelectorModal";

interface ExcelExportPanelProps {
  files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  selectedFileId: string | null;
  selectedPage: number;
  onSelectPage: (fileId: string, page: number) => void;
  onCellEdit: (fileId: string, page: number, column: string, text: string) => void;
  onExport: () => void;
}

type SortDir = "asc" | "desc" | null;

type Row = {
  fileId: string;
  fileName: string;
  pageNum: number;
  extracted: Record<string, string>;
  template: string;
};

export function ExcelExportPanel({
  files,
  columns,
  selectedFileId,
  selectedPage,
  onSelectPage,
  onCellEdit,
  onExport,
}: ExcelExportPanelProps) {
  const [sortKey, setSortKey] = useState<string>("file_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterText, setFilterText] = useState("");
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(columns.filter((c) => c.visible).map((c) => c.name))
  );

  // Flatten all pages
  const rows: Row[] = useMemo(() => 
    files.flatMap((f) =>
      f.pages.map((p) => ({
        fileId: f.file_id,
        fileName: f.file_name,
        pageNum: p.page_number,
        extracted: p.extracted_data,
        template: p.applied_template ?? "",
      }))
    ), [files]
  );

  // Filter
  const filtered = useMemo(() => 
    rows.filter((r) => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      return (
        r.fileName.toLowerCase().includes(q) ||
        Object.values(r.extracted).some((v) => v.toLowerCase().includes(q)) ||
        r.template.toLowerCase().includes(q)
      );
    }), [rows, filterText]
  );

  // Sort
  const sorted = useMemo(() => 
    [...filtered].sort((a, b) => {
      let va = sortKey === "file_name" ? a.fileName : sortKey === "page" ? String(a.pageNum) : sortKey === "template" ? a.template : (a.extracted[sortKey] ?? "");
      let vb = sortKey === "file_name" ? b.fileName : sortKey === "page" ? String(b.pageNum) : sortKey === "template" ? b.template : (b.extracted[sortKey] ?? "");
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }), [filtered, sortKey, sortDir]
  );

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleCol = (name: string) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visibleColumns = columns.filter((c) => visibleCols.has(c.name));

  // Statistics
  const totalPages = rows.length;
  const pagesWithData = rows.filter((r) => Object.values(r.extracted).some((v) => v.trim())).length;
  const pagesWithTemplate = rows.filter((r) => r.template).length;

  return (
    <div style={container}>
      {/* Title bar */}
      <div style={titleBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📊 Excel Export</span>
          <span style={{ fontSize: 11, color: "#666" }}>
            {totalPages} pages | {pagesWithData} with data | {pagesWithTemplate} with template
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={exportBtn}
            onClick={onExport}
            disabled={files.length === 0}
          >
            📥 Export to Excel
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={filterBar}>
        <input
          style={filterInput}
          placeholder="Filter by filename, content, or template..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <button style={smBtn} onClick={() => setShowColMenu((v) => !v)} title="Show/hide columns">
          Columns ▾
        </button>
      </div>

      {/* Column visibility menu */}
      {showColMenu && (
        <div style={colMenuStyle}>
          {columns.map((c) => (
            <label key={c.name} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
              <input type="checkbox" checked={visibleCols.has(c.name)} onChange={() => toggleCol(c.name)} />
              {c.name}
            </label>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={tableContainer}>
        {files.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
            <div>No PDF files loaded</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Import PDF files to preview and export data</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f0f0f0", position: "sticky", top: 0, zIndex: 1 }}>
                {["file_name", "page", "template", ...visibleColumns.map((c) => c.name)].map((h) => (
                  <th
                    key={h}
                    style={th}
                    onClick={() => handleSort(h)}
                    title={`Sort by ${h}`}
                  >
                    {h === "file_name" ? "File Name" : h === "page" ? "Page" : h === "template" ? "Template" : h}
                    {sortKey === h ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={3 + visibleColumns.length} style={{ textAlign: "center", padding: 20, color: "#999" }}>
                    No data matches the filter
                  </td>
                </tr>
              )}
              {sorted.map((row) => {
                const isRowSelected = row.fileId === selectedFileId && row.pageNum === selectedPage;
                return (
                  <tr
                    key={`${row.fileId}-${row.pageNum}`}
                    style={{ background: isRowSelected ? "#eaf4fb" : "transparent", cursor: "pointer" }}
                    onClick={() => onSelectPage(row.fileId, row.pageNum)}
                  >
                    <td style={td}>{row.fileName}</td>
                    <td style={{ ...td, textAlign: "center" }}>{row.pageNum + 1}</td>
                    <td style={{ ...td, color: row.template ? "#2471a3" : "#bbb", fontStyle: row.template ? "normal" : "italic", whiteSpace: "nowrap" }}>
                      {row.template || "—"}
                    </td>
                    {visibleColumns.map((col) => {
                      const cellKey = `${row.fileId}-${row.pageNum}-${col.name}`;
                      const isEditing = editingCell === cellKey;
                      return (
                        <td
                          key={col.name}
                          style={{
                            ...td,
                            outline: isRowSelected ? "1px solid #2980b9" : undefined,
                          }}
                          onDoubleClick={() => setEditingCell(cellKey)}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              style={{ width: "100%", border: "none", fontSize: 12, padding: "2px 4px" }}
                              defaultValue={row.extracted[col.name] ?? ""}
                              onBlur={(e) => {
                                onCellEdit(row.fileId, row.pageNum, col.name, e.target.value);
                                setEditingCell(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                          ) : (
                            row.extracted[col.name] ?? ""
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Stats bar */}
      <div style={statsBar}>
        <span>Showing {sorted.length} of {totalPages} rows</span>
        <span>Double-click cell to edit</span>
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
  background: "#27ae60",
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

const colMenuStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#fff",
  borderBottom: "1px solid #ddd",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
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
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
  userSelect: "none",
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
