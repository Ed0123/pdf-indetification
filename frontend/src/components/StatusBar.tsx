import React from "react";
import type { StatusInfo } from "../types";

interface StatusBarProps {
  status: StatusInfo;
  fileCount: number;
  pageCount: number;
  usagePages?: number;
  usageLimit?: number; // -1 = unlimited
}

export function StatusBar({ status, fileCount, pageCount, usagePages, usageLimit }: StatusBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "3px 12px",
        background: "#f5f5f5",
        borderTop: "1px solid #ddd",
        fontSize: 12,
        color: "#555",
        flexShrink: 0,
      }}
    >
      {/* Message */}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {status.message}
      </span>

      {/* Progress bar */}
      {status.progress !== null && (
        <div style={{ width: 160, height: 8, background: "#ddd", borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              width: `${status.progress}%`,
              height: "100%",
              background: "#2980b9",
              transition: "width 0.2s",
            }}
          />
        </div>
      )}

      {/* Counts */}
      <span style={{ whiteSpace: "nowrap" }}>
        Files: <strong>{fileCount}</strong> &nbsp; Pages: <strong>{pageCount}</strong>
      </span>

      {/* Usage remaining */}
      {usagePages != null && usageLimit != null && (
        <span style={{ whiteSpace: "nowrap", color: "#777" }}>
          OCR: <strong>{usagePages}</strong> / {usageLimit === -1 ? "∞" : usageLimit}
        </span>
      )}

      {/* OCR indicator */}
      <span
        style={{
          padding: "1px 8px",
          borderRadius: 10,
          background: status.ocr_available ? "#27ae60" : "#c0392b",
          color: "#fff",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        OCR: {status.ocr_available ? "on" : "off"}
      </span>
    </div>
  );
}
