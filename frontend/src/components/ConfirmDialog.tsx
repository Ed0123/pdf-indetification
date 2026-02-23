import React from "react";

interface ConfirmDialogProps {
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  message,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div style={overlay}>
      <div style={dialog}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{message}</div>
        {detail && <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>{detail}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={onCancel}>{cancelLabel}</button>
          <button style={danger ? btnDanger : btnPrimary} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const dialog: React.CSSProperties = {
  background: "#fff", borderRadius: 6, padding: "24px 28px", minWidth: 320,
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};
const btnBase: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 4, border: "1px solid #ccc",
  cursor: "pointer", fontSize: 13, fontWeight: 500,
};
const btnSecondary = { ...btnBase, background: "#f5f5f5" };
const btnPrimary = { ...btnBase, background: "#2980b9", color: "#fff", border: "1px solid #2471a3" };
const btnDanger = { ...btnBase, background: "#e74c3c", color: "#fff", border: "1px solid #c0392b" };
