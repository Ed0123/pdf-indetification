import React, { useState } from "react";
import type { PDFFileInfo } from "../types";

interface PDFTreeViewProps {
  files: PDFFileInfo[];
  selectedFileId: string | null;
  selectedPage: number;
  onSelectPage: (fileId: string, page: number) => void;
}

export function PDFTreeView({
  files,
  selectedFileId,
  selectedPage,
  onSelectPage,
}: PDFTreeViewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Auto-expand newly added files
  React.useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      files.forEach((f) => {
        if (!(f.file_id in next)) next[f.file_id] = true;
      });
      return next;
    });
  }, [files]);

  const toggleAll = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    files.forEach((f) => (next[f.file_id] = expand));
    setExpanded(next);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid #ddd",
        background: "#fafafa",
        minWidth: 220,
        maxWidth: 260,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          background: "#f0f0f0",
          borderBottom: "1px solid #ccc",
          gap: 4,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>PDF Pages</span>
        <button
          style={headerBtn}
          onClick={() => toggleAll(true)}
          title="Expand all"
        >
          ⊞
        </button>
        <button
          style={headerBtn}
          onClick={() => toggleAll(false)}
          title="Collapse all"
        >
          ⊟
        </button>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
        {files.length === 0 && (
          <div style={{ padding: 12, color: "#999", textAlign: "center" }}>
            No PDFs imported
          </div>
        )}
        {files.map((file) => (
          <div key={file.file_id}>
            {/* File node */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "5px 8px",
                cursor: "pointer",
                fontWeight: 600,
                color: "#333",
                borderBottom: "1px solid #eee",
              }}
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [file.file_id]: !prev[file.file_id] }))
              }
            >
              <span style={{ marginRight: 6, fontSize: 11 }}>
                {expanded[file.file_id] ? "▼" : "▶"}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={file.file_name}
              >
                📄 {file.file_name}
              </span>
            </div>

            {/* Page nodes */}
            {expanded[file.file_id] &&
              file.pages.map((page) => {
                const isSelected =
                  selectedFileId === file.file_id &&
                  selectedPage === page.page_number;
                return (
                  <div
                    key={page.page_number}
                    style={{
                      padding: "4px 8px 4px 28px",
                      cursor: "pointer",
                      background: isSelected ? "#d6eaf8" : "transparent",
                      color: isSelected ? "#1a5276" : "#555",
                      fontWeight: isSelected ? 600 : 400,
                      borderBottom: "1px solid #f5f5f5",
                    }}
                    onClick={() => onSelectPage(file.file_id, page.page_number)}
                  >
                    Page {page.page_number + 1}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

const headerBtn: React.CSSProperties = {
  padding: "1px 6px",
  border: "1px solid #ccc",
  borderRadius: 3,
  background: "white",
  cursor: "pointer",
  fontSize: 14,
};
