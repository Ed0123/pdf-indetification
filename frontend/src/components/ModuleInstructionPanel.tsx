/**
 * ModuleInstructionPanel — Shows module instruction (HTML) with admin edit capability.
 *
 * All modules embed this component to display a collapsible "說明" section.
 * Admins see an "Edit" button to modify the HTML content in-place.
 */
import React, { useState, useEffect } from "react";
import { getModuleInstruction, updateModuleInstruction } from "../api/client";

interface ModuleInstructionPanelProps {
  moduleId: string;
  isAdmin: boolean;
}

export function ModuleInstructionPanel({ moduleId, isAdmin }: ModuleInstructionPanelProps) {
  const [html, setHtml] = useState("");
  const [expanded, setExpanded] = useState(false);
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
    <div style={{ borderBottom: "1px solid #e3ecf5", marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 12, color: "#2e8ecb", padding: "4px 0",
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>說明</span>
        {isAdmin && <span style={{ fontSize: 10, color: "#999" }}>(admin 可編輯)</span>}
      </button>

      {expanded && (
        <div style={{ padding: "8px 0 12px" }}>
          {editing ? (
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{
                  width: "100%", minHeight: 150, fontSize: 13,
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
                    padding: "4px 12px", background: "#2f7de1",
                    color: "#fff", cursor: "pointer", fontSize: 12,
                  }}
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    border: "1px solid #cfd8e6", borderRadius: 6,
                    padding: "4px 12px", background: "#fff",
                    cursor: "pointer", fontSize: 12,
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
                  style={{ fontSize: 13, color: "#4e5a6b", lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <div style={{ fontSize: 13, color: "#aaa" }}>尚未設定說明內容。</div>
              )}
              {isAdmin && (
                <button
                  onClick={() => { setDraft(html); setEditing(true); }}
                  style={{
                    marginTop: 6, border: "1px solid #cfd8e6", borderRadius: 6,
                    padding: "3px 10px", background: "#fff",
                    cursor: "pointer", fontSize: 11, color: "#2e8ecb",
                  }}
                >
                  ✏ 編輯說明
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
