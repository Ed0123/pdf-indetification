/**
 * FeedbackButton — Standalone "Contact Admin" / bug report button.
 * Shows a small popup form for sending messages to administrators.
 */
import React, { useState, useRef, useEffect } from "react";
import { sendUserMessage } from "../api/client";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  const handleSend = async () => {
    if (!msgBody.trim()) return;
    setSending(true);
    setError(null);
    setSuccess(false);
    try {
      await sendUserMessage(msgBody.trim());
      setSuccess(true);
      setMsgBody("");
    } catch (err: any) {
      setError(err?.message || "送出失敗");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: "relative" }} ref={popupRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none",
          border: "1px solid #ccc",
          borderRadius: 4,
          padding: "3px 10px",
          cursor: "pointer",
          fontSize: 12,
          color: "#333",
        }}
        title="回報問題 / 聯絡管理員"
      >
        📨 回報問題
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            width: 340,
            background: "#fff",
            border: "1px solid #007acc",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>📨 回報問題 / 聯絡管理員</h4>
          <textarea
            style={{
              width: "100%",
              height: 90,
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
            }}
            value={msgBody}
            onChange={(e) => setMsgBody(e.target.value)}
            placeholder="描述你遇到的問題或建議…"
          />
          <p style={{ fontSize: 11, color: "#888", margin: "6px 0" }}>
            系統會在 7 天後自動刪除訊息，請儘速查看回覆。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              style={{
                background: "#007acc",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                padding: "5px 16px",
                cursor: "pointer",
                fontSize: 13,
                opacity: sending || !msgBody.trim() ? 0.5 : 1,
              }}
              disabled={sending || !msgBody.trim()}
              onClick={handleSend}
            >
              {sending ? "送出中…" : "送出"}
            </button>
            {error && <span style={{ color: "#c0392b", fontSize: 12 }}>{error}</span>}
            {success && <span style={{ color: "#27ae60", fontSize: 12 }}>✓ 已送出</span>}
          </div>
        </div>
      )}
    </div>
  );
}
