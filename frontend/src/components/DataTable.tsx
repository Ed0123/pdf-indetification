import React, { useState } from "react";
import type { PDFFileInfo, ExtractedDataColumn } from "../types";

interface DataTableProps {
  files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  selectedFileId: string | null;
  selectedPage: number;
  selectedColumn: string | null;
  onSelectCell: (fileId: string, page: number, column: string) => void;
  onCellEdit: (fileId: string, page: number, column: string, text: string) => void;
  onAddColumn: (name: string) => void;
  onRemoveColumn: (name: string) => void;
  onToggleColumn: (name: string) => void;
  // actions formerly in the top toolbar
  onExportExcel: () => void;
  onRecognizeText: () => void;
  onManageTemplates: () => void;
  onExportPdf: () => void;
  disabled: boolean;
}

type SortDir = "asc" | "desc" | null;

export function DataTable({
  files,
  columns,
  selectedFileId,
  selectedPage,
  selectedColumn,
  onSelectCell,
  onCellEdit,
  onAddColumn,
  onRemoveColumn,
  onToggleColumn,
  onExportExcel,
  onRecognizeText,
  onManageTemplates,
  onExportPdf,
  disabled,
}: DataTableProps) {
  const [sortKey, setSortKey] = useState<string>("file_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterText, setFilterText] = useState("");
  const [editingCell, setEditingCell] = useState<string | null>(null); // `${fileId}-${page}-${col}`
  const [showColMenu, setShowColMenu] = useState(false);
  const [newColName, setNewColName] = useState("");

  const visibleCols = columns.filter((c) => c.visible);

  // Flatten all pages
  type Row = {
    fileId: string;
    fileName: string;
    pageNum: number;
    extracted: Record<string, string>;
    template: string;
  };

  const rows: Row[] = files.flatMap((f) =>
    f.pages.map((p) => ({
      fileId: f.file_id,
      fileName: f.file_name,
      pageNum: p.page_number,
      extracted: p.extracted_data,
      template: p.applied_template ?? "",
    }))
  );

  // Filter
  const filtered = rows.filter((r) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      r.fileName.toLowerCase().includes(q) ||
      Object.values(r.extracted).some((v) => v.toLowerCase().includes(q))
    );
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let va = sortKey === "file_name" ? a.fileName : sortKey === "page" ? String(a.pageNum) : sortKey === "template" ? a.template : (a.extracted[sortKey] ?? "");
    let vb = sortKey === "file_name" ? b.fileName : sortKey === "page" ? String(b.pageNum) : sortKey === "template" ? b.template : (b.extracted[sortKey] ?? "");
    return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    onAddColumn(name);
    setNewColName("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Action bar moved from top toolbar */}
      <div style={{ display: "flex", gap: 6, padding: "4px 8px", borderBottom: "1px solid #ddd", background: "#fafafa" }}>
        <button style={smBtn} onClick={onExportExcel} disabled={disabled} title="Export to Excel">
          📊 Export Excel
        </button>
        <button style={smBtn} onClick={onRecognizeText} disabled={disabled} title="Run text recognition">
          🔍 Recognize Text
        </button>
        <button style={smBtn} onClick={onManageTemplates} title="Manage templates">
          🗂 Templates
        </button>
        <button style={smBtn} onClick={onExportPdf} disabled={disabled} title="Export selected pages as PDFs">
          📄 Export PDF
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 6, padding: "4px 8px", borderBottom: "1px solid #ddd", background: "#fafafa" }}>
        <input
          style={{ flex: 1, padding: "3px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12 }}
          placeholder="Filter..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <button style={smBtn} onClick={() => setShowColMenu((v) => !v)} title="Show/hide columns">
          Columns ▾
        </button>
      </div>

      {/* Column visibility menu */}
      {showColMenu && (
        <div style={{ padding: "6px 10px", background: "#fff", borderBottom: "1px solid #ddd", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {columns.map((c) => (
            <label key={c.name} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 3 }}>
              <input type="checkbox" checked={c.visible} onChange={() => onToggleColumn(c.name)} />
              {c.name}
            </label>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f0f0f0", position: "sticky", top: 0, zIndex: 1 }}>
              {["file_name", "page", "template", ...visibleCols.map((c) => c.name)].map((h) => (
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
            {sorted.map((row) => {
              const isRowSelected = row.fileId === selectedFileId && row.pageNum === selectedPage;
              return (
                <tr
                  key={`${row.fileId}-${row.pageNum}`}
                  style={{ background: isRowSelected ? "#eaf4fb" : "transparent" }}
                >
                  <td style={td}>{row.fileName}</td>
                  <td style={{ ...td, textAlign: "center" }}>{row.pageNum + 1}</td>
                  <td style={{ ...td, color: row.template ? "#2471a3" : "#bbb", fontStyle: row.template ? "normal" : "italic", whiteSpace: "nowrap" }}>
                    {row.template || "—"}
                  </td>
                  {visibleCols.map((col) => {
                    const cellKey = `${row.fileId}-${row.pageNum}-${col.name}`;
                    const isSelected = isRowSelected && selectedColumn === col.name;
                    const isEditing = editingCell === cellKey;
                    return (
                      <td
                        key={col.name}
                        style={{
                          ...td,
                          background: isSelected ? "#d6eaf8" : "transparent",
                          outline: isSelected ? "2px solid #2980b9" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => onSelectCell(row.fileId, row.pageNum, col.name)}
                        onDoubleClick={() => setEditingCell(cellKey)}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            style={{ width: "100%", border: "none", fontSize: 12 }}
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
      </div>

      {/* Bottom bar */}
      <div style={{ display: "flex", gap: 6, padding: "4px 8px", borderTop: "1px solid #ddd", background: "#fafafa", alignItems: "center" }}>
        <input
          style={{ padding: "3px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12, width: 130 }}
          placeholder="New column name"
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
        />
        <button style={smBtn} onClick={handleAddColumn}>+ Add</button>
        <button
          style={smBtn}
          onClick={() => selectedColumn && onRemoveColumn(selectedColumn)}
          disabled={!selectedColumn}
        >
          − Remove "{selectedColumn}"
        </button>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid #ddd",
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
  userSelect: "none",
};

const td: React.CSSProperties = {
  padding: "3px 8px",
  border: "1px solid #eee",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const smBtn: React.CSSProperties = {
  padding: "3px 8px",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 12,
};
