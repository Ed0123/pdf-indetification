/**
 * PageSelectorModal — Reusable modal for selecting PDF pages across all files.
 * Supports checkbox per page, Shift-click range, Ctrl-click toggle,
 * and Select All / Deselect All.
 */
import React, { useState, useRef } from "react";
import type { PDFFileInfo } from "../types";

export interface SelectedPage {
  file_id: string;
  page_number: number;
  file_name: string;
}

interface PageSelectorModalProps {
  files: PDFFileInfo[];
  title: string;
  confirmLabel?: string;
  /** Pre-selected pages */
  initialSelected?: { file_id: string; page_number: number }[];
  onConfirm: (pages: SelectedPage[]) => void;
  onCancel: () => void;
}

export function PageSelectorModal({
  files,
  title,
  confirmLabel = "Apply",
  initialSelected,
  onConfirm,
  onCancel,
}: PageSelectorModalProps) {
  // Flatten all pages into a list
  const allRows: SelectedPage[] = files.flatMap((f) =>
    f.pages.map((p) => ({
      file_id: f.file_id,
      page_number: p.page_number,
      file_name: f.file_name,
    }))
  );

  const initSet = new Set(
    (initialSelected ?? []).map((s) => `${s.file_id}::${s.page_number}`)
  );

  const [selected, setSelected] = useState<Set<string>>(initSet);
  const lastClickedIdx = useRef<number | null>(null);

  const key = (r: SelectedPage) => `${r.file_id}::${r.page_number}`;

  const toggle = (idx: number, e: React.MouseEvent) => {
    const row = allRows[idx];
    const k = key(row);

    if (e.shiftKey && lastClickedIdx.current !== null) {
      // Range-select
      const lo = Math.min(lastClickedIdx.current, idx);
      const hi = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(key(allRows[i]));
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
      });
    } else {
      // Single select via checkbox — already handled by onChange
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleConfirm = () => {
    onConfirm(allRows.filter((r) => selected.has(key(r))));
  };

  const selectAll = () => setSelected(new Set(allRows.map(key)));
  const deselectAll = () => setSelected(new Set());

  return (
    <div style={overlay}>
      <div style={modal}>
        {/* Header */}
        <div style={header}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <span style={{ color: "#888", fontSize: 12 }}>
            {selected.size} / {allRows.length} selected
          </span>
        </div>

        {/* Quick-select buttons */}
        <div style={{ display: "flex", gap: 8, padding: "6px 12px", borderBottom: "1px solid #ddd" }}>
          <button style={smBtn} onClick={selectAll}>Select All</button>
          <button style={smBtn} onClick={deselectAll}>Deselect All</button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#999", alignSelf: "center" }}>
            Ctrl+click to toggle • Shift+click to range-select
          </span>
        </div>

        {/* Page list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {allRows.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#999" }}>No pages available</div>
          )}
          {files.map((file) => (
            <div key={file.file_id}>
              {/* File group header */}
              <div style={fileHeader}>
                <span style={{ fontWeight: 600 }}>📄 {file.file_name}</span>
                <span style={{ color: "#999", fontSize: 11 }}>{file.pages.length} pages</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "6px 12px 8px 20px" }}>
                {file.pages.map((page) => {
                  const r: SelectedPage = { file_id: file.file_id, page_number: page.page_number, file_name: file.file_name };
                  const k = key(r);
                  const idx = allRows.findIndex((x) => key(x) === k);
                  const isSelected = selected.has(k);
                  return (
                    <div
                      key={page.page_number}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                        background: isSelected ? "#d6eaf8" : "#f5f5f5",
                        border: `1px solid ${isSelected ? "#2980b9" : "#ddd"}`,
                        fontSize: 12, userSelect: "none",
                      }}
                      onClick={(e) => toggle(idx, e)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        style={{ cursor: "pointer" }}
                      />
                      Page {page.page_number + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={footer}>
          <button style={btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={btnPrimary} onClick={handleConfirm} disabled={selected.size === 0}>
            {confirmLabel} ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 6, display: "flex", flexDirection: "column",
  width: 560, maxHeight: "80vh", boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};
const header: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "12px 16px", borderBottom: "1px solid #ddd", background: "#f7f7f7",
  borderRadius: "6px 6px 0 0",
};
const fileHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "6px 12px 2px", background: "#f0f0f0", borderBottom: "1px solid #e8e8e8",
};
const footer: React.CSSProperties = {
  display: "flex", gap: 8, justifyContent: "flex-end",
  padding: "10px 16px", borderTop: "1px solid #ddd",
};
const btnBase: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 4, cursor: "pointer", fontSize: 13,
  fontWeight: 500, border: "1px solid #ccc",
};
const btnSecondary = { ...btnBase, background: "#f5f5f5" };
const btnPrimary = { ...btnBase, background: "#2980b9", color: "#fff", border: "1px solid #2471a3" };
const smBtn: React.CSSProperties = {
  padding: "3px 10px", border: "1px solid #ccc", borderRadius: 3,
  background: "#f5f5f5", cursor: "pointer", fontSize: 12,
};
