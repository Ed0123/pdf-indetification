/**
 * SinglePageDataTable — shows extraction data for the currently selected page
 * in a vertical Column | Text layout.
 *
 * Includes:
 *  - Page dropdown + Previous / Next navigation
 *  - Template dropdown + Save New / Update buttons
 *  - Recognize button (for current page only)
 *  - Collapsible via the parent component's toggle
 */
import React, { useState, useMemo } from "react";
import type { PDFFileInfo, ExtractedDataColumn, Template } from "../types";

interface SinglePageDataTableProps {
  files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  selectedFileId: string | null;
  selectedPage: number;
  selectedColumn: string | null;
  templates: Template[];
  onSelectPage: (fileId: string, page: number) => void;
  onSelectCell: (fileId: string, page: number, column: string) => void;
  onCellEdit: (fileId: string, page: number, column: string, text: string) => void;
  onAddColumn: (name: string) => void;
  onRemoveColumn: (name: string) => void;
  onRecognizePage: () => void;
  onSaveNewTemplate: (name: string) => void;
  onUpdateTemplate: (name: string) => void;
  onApplyTemplate: (templateName: string) => void;
}

export function SinglePageDataTable({
  files,
  columns,
  selectedFileId,
  selectedPage,
  selectedColumn,
  templates,
  onSelectPage,
  onSelectCell,
  onCellEdit,
  onAddColumn,
  onRemoveColumn,
  onRecognizePage,
  onSaveNewTemplate,
  onUpdateTemplate,
  onApplyTemplate,
}: SinglePageDataTableProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [newTplName, setNewTplName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [removeColName, setRemoveColName] = useState("");

  // Current file/page data
  const file = files.find((f) => f.file_id === selectedFileId);
  const pageData = file?.pages.find((p) => p.page_number === selectedPage);
  const visibleCols = columns.filter((c) => c.visible);

  // All pages flattened for navigation
  const allPages = useMemo(() => {
    return files.flatMap((f) =>
      f.pages.map((p) => ({ file_id: f.file_id, page_number: p.page_number, file_name: f.file_name }))
    );
  }, [files]);

  const currentIdx = allPages.findIndex(
    (p) => p.file_id === selectedFileId && p.page_number === selectedPage
  );

  const handlePrev = () => {
    if (currentIdx > 0) {
      const p = allPages[currentIdx - 1];
      onSelectPage(p.file_id, p.page_number);
    }
  };

  const handleNext = () => {
    if (currentIdx < allPages.length - 1) {
      const p = allPages[currentIdx + 1];
      onSelectPage(p.file_id, p.page_number);
    }
  };

  const handlePageDropdown = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    if (!isNaN(idx) && allPages[idx]) {
      onSelectPage(allPages[idx].file_id, allPages[idx].page_number);
    }
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setSelectedTemplate(name);
    if (name) {
      onApplyTemplate(name);
    }
  };

  const handleSaveNew = () => {
    if (!newTplName.trim()) return;
    onSaveNewTemplate(newTplName.trim());
    setSelectedTemplate(newTplName.trim());
    setNewTplName("");
    setShowNewInput(false);
  };

  const handleUpdate = () => {
    if (selectedTemplate) {
      onUpdateTemplate(selectedTemplate);
    }
  };

  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    onAddColumn(name);
    setNewColName("");
  };

  const handleRemoveColumn = () => {
    if (!removeColName) return;
    onRemoveColumn(removeColName);
    setRemoveColName("");
  };

  const handleSelectColumn = (columnName: string) => {
    if (!selectedFileId) return;
    onSelectCell(selectedFileId, selectedPage, columnName);
  };

  // Auto-select applied template
  const appliedTemplate = pageData?.applied_template ?? "";
  React.useEffect(() => {
    if (appliedTemplate) setSelectedTemplate(appliedTemplate);
  }, [appliedTemplate]);

  if (!file || !pageData) {
    return (
      <div style={container}>
        <div style={{ padding: 12, color: "#888", fontSize: 13 }}>
          No page selected
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      {/* Navigation Row */}
      <div style={navRow}>
        {/* Page dropdown */}
        <select style={selectStyle} value={currentIdx} onChange={handlePageDropdown}>
          {allPages.map((p, i) => (
            <option key={`${p.file_id}-${p.page_number}`} value={i}>
              {p.file_name} — P{p.page_number}
            </option>
          ))}
        </select>

        <button
          style={navBtn}
          disabled={currentIdx <= 0}
          onClick={handlePrev}
          title="Previous page"
        >
          ◀ Prev
        </button>
        <button
          style={navBtn}
          disabled={currentIdx >= allPages.length - 1}
          onClick={handleNext}
          title="Next page"
        >
          Next ▶
        </button>
        <button style={{ ...navBtn, background: "#2980b9", color: "#fff" }} onClick={onRecognizePage}>
          🔍 Recognize
        </button>
      </div>

      {/* Template Row */}
      <div style={navRow}>
        <span style={{ fontSize: 12, color: "#555", marginRight: 4 }}>Template:</span>
        <select style={{ ...selectStyle, flex: 1 }} value={selectedTemplate} onChange={handleTemplateChange}>
          <option value="">— None —</option>
          {templates.map((t) => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>

        {selectedTemplate && (
          <button style={navBtn} onClick={handleUpdate} title="Update selected template with current boxes">
            💾 Update
          </button>
        )}

        {!showNewInput ? (
          <button style={navBtn} onClick={() => setShowNewInput(true)} title="Save current boxes as a new template">
            ➕ New
          </button>
        ) : (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              style={{ ...selectStyle, width: 100 }}
              value={newTplName}
              onChange={(e) => setNewTplName(e.target.value)}
              placeholder="Template name"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSaveNew()}
            />
            <button style={navBtn} onClick={handleSaveNew}>✓</button>
            <button style={navBtn} onClick={() => { setShowNewInput(false); setNewTplName(""); }}>✕</button>
          </div>
        )}
      </div>

      {/* Column tools row */}
      <div style={navRow}>
        <span style={{ fontSize: 12, color: "#555", marginRight: 4 }}>Columns:</span>
        <input
          style={{ ...selectStyle, width: 130 }}
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          placeholder="New column name"
          onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
        />
        <button style={navBtn} onClick={handleAddColumn}>+ Add</button>

        <select
          style={{ ...selectStyle, minWidth: 120 }}
          value={removeColName}
          onChange={(e) => setRemoveColName(e.target.value)}
        >
          <option value="">Select column</option>
          {columns.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button style={navBtn} onClick={handleRemoveColumn} disabled={!removeColName}>− Delete</button>
      </div>

      {/* Data Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Column</th>
              <th style={thStyle}>Text</th>
            </tr>
          </thead>
          <tbody>
            {visibleCols.map((col) => {
              const isSelected = selectedColumn === col.name;
              return (
              <tr key={col.name}>
                <td
                  style={{
                    ...tdStyle,
                    fontWeight: 600,
                    width: 120,
                    color: "#555",
                    cursor: "pointer",
                    background: isSelected ? "#d6eaf8" : "transparent",
                    outline: isSelected ? "2px solid #2980b9" : undefined,
                  }}
                  onClick={() => handleSelectColumn(col.name)}
                >
                  {col.name}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    background: isSelected ? "#d6eaf8" : "transparent",
                    outline: isSelected ? "2px solid #2980b9" : undefined,
                  }}
                  onClick={() => handleSelectColumn(col.name)}
                >
                  <input
                    style={cellInput}
                    value={pageData.extracted_data[col.name] ?? ""}
                    onFocus={() => handleSelectColumn(col.name)}
                    onChange={(e) =>
                      onCellEdit(selectedFileId!, selectedPage, col.name, e.target.value)
                    }
                  />
                </td>
              </tr>
            )})}
            {visibleCols.length === 0 && (
              <tr>
                <td colSpan={2} style={{ ...tdStyle, textAlign: "center", color: "#aaa" }}>
                  No columns defined
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#fff",
  borderTop: "1px solid #ddd",
  fontSize: 13,
};

const navRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderBottom: "1px solid #eee",
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  padding: "4px 6px",
  border: "1px solid #ccc",
  borderRadius: 3,
  fontSize: 12,
};

const navBtn: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: React.CSSProperties = {
  borderBottom: "2px solid #ddd",
  padding: "6px 8px",
  textAlign: "left",
  fontSize: 12,
  color: "#555",
  position: "sticky",
  top: 0,
  background: "#fafafa",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "5px 8px",
};

const cellInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid transparent",
  padding: "3px 4px",
  fontSize: 12,
  borderRadius: 2,
  outline: "none",
  background: "transparent",
};
