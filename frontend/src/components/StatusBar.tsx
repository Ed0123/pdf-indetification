import React from "react";
import type { StatusInfo } from "../types";

interface StatusBarProps {
  status: StatusInfo;
  fileCount: number;
  pageCount: number;
  usagePages?: number;
  usageLimit?: number; // -1 = unlimited
  backupEnabled?: boolean;
  backupSupported?: boolean;
  backupMode?: "manual" | "smart" | "aggressive";
  backupStatus?: "idle" | "running" | "ok" | "error";
  backupAt?: string | null;
  backupWrites?: number;
  backupSkips?: number;
  onToggleBackup?: (enabled: boolean) => void;
  onManualBackup?: () => void;
}

export function StatusBar({
  status,
  fileCount,
  pageCount,
  usagePages,
  usageLimit,
  backupEnabled,
  backupSupported,
  backupMode,
  backupStatus,
  backupAt,
  backupWrites,
  backupSkips,
  onToggleBackup,
  onManualBackup,
}: StatusBarProps) {
  const backupLabel = backupStatus === "running"
    ? "備份中"
    : backupStatus === "ok"
      ? "備份完成"
      : backupStatus === "error"
        ? "備份失敗"
        : "待機";

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

      {/* Auto backup status */}
      {backupStatus && (
        <span style={{ whiteSpace: "nowrap", color: backupStatus === "error" ? "#c0392b" : "#666" }}>
          備份: <strong>{backupLabel}</strong>
          {backupAt ? ` (${new Date(backupAt).toLocaleTimeString()})` : ""}
        </span>
      )}

      {backupMode && (
        <span style={{ whiteSpace: "nowrap", color: "#666" }}>
          模式: <strong>{backupMode === "manual" ? "手動" : backupMode === "smart" ? "智慧" : "即時"}</strong>
        </span>
      )}

      {(backupWrites != null || backupSkips != null) && (
        <span style={{ whiteSpace: "nowrap", color: "#666" }}>
          Cloud 寫入: <strong>{backupWrites ?? 0}</strong> / 省下 <strong>{backupSkips ?? 0}</strong>
        </span>
      )}

      {/* Backup toggle */}
      {onToggleBackup && (
        <label style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, color: backupSupported ? "#666" : "#aaa" }}>
          <input
            type="checkbox"
            checked={backupEnabled === true}
            disabled={!backupSupported}
            onChange={(e) => onToggleBackup(e.target.checked)}
          />
          自動備份
        </label>
      )}

      {onManualBackup && (
        <button
          onClick={onManualBackup}
          style={{
            border: "1px solid #cfd8e6",
            borderRadius: 4,
            padding: "2px 8px",
            background: "#fff",
            color: "#2c3e50",
            fontSize: 11,
            cursor: "pointer",
          }}
          title="手動觸發一次雲端備份"
        >
          立即備份
        </button>
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
