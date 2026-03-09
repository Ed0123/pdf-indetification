/**
 * ModuleInstructionPanel — Shows module instruction (HTML) as a popup modal.
 *
 * All modules embed this component. A small "說明" button triggers a modal overlay.
 * Admins see an "Edit" button inside the modal to modify the HTML content.
 */
import React, { useState, useEffect } from "react";
import { getModuleInstruction, updateModuleInstruction } from "../api/client";

interface ModuleInstructionPanelProps {
  moduleId: string;
  isAdmin: boolean;
}

export function ModuleInstructionPanel({ moduleId, isAdmin }: ModuleInstructionPanelProps) {
  const [html, setHtml] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getModuleInstruction(moduleId).then((data) => {
      if (!cancelled) {
        setHtml(data.content_html || "");
        setLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [moduleId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateModuleInstruction(moduleId, draft);
      setHtml(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none", border: "1px solid #d0dbe8", cursor: "pointer",
          fontSize: 12, color: "#2e8ecb", padding: "3px 10px", borderRadius: 6,
          marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        <span>📖</span>
        <span>說明</span>
      </button>

      {open && (
        <div
          onClick={() => { if (!editing) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 50000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              width: "90vw", maxWidth: 700, maxHeight: "80vh",
              overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#223648" }}>模組說明</h3>
              <button
                onClick={() => { setOpen(false); setEditing(false); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 18, color: "#999", padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>

            {editing ? (
              <div style={{ display: "grid", gap: 8 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={{
                    width: "100%", minHeight: 200, fontSize: 13,
                    fontFamily: "monospace", border: "1px solid #cfd8e6",
                    borderRadius: 6, padding: 8, boxSizing: "border-box",
                    resize: "vertical",
                  }}
                  placeholder="輸入 HTML 格式的說明內容..."
                />
                <div style={{ fontSize: 11, color: "#888" }}>
                  支援 HTML 格式（包括 &lt;iframe&gt; 嵌入 YouTube 影片）
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      border: "1px solid #2f7de1", borderRadius: 6,
                      padding: "6px 16px", background: "#2f7de1",
                      color: "#fff", cursor: "pointer", fontSize: 13,
                    }}
                  >
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    style={{
                      border: "1px solid #cfd8e6", borderRadius: 6,
                      padding: "6px 16px", background: "#fff",
                      cursor: "pointer", fontSize: 13,
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {html ? (
                  <div
                    style={{ fontSize: 14, color: "#4e5a6b", lineHeight: 1.7 }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: "#aaa" }}>尚未設定說明內容。</div>
                )}
                {isAdmin && (
                  <button
                    onClick={() => { setDraft(html); setEditing(true); }}
                    style={{
                      marginTop: 12, border: "1px solid #cfd8e6", borderRadius: 6,
                      padding: "5px 14px", background: "#fff",
                      cursor: "pointer", fontSize: 12, color: "#2e8ecb",
                    }}
                  >
                    ✏ 編輯說明
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
