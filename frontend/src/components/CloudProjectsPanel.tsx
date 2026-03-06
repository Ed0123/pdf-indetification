/**
 * CloudProjectsPanel — Modal for managing cloud-saved projects.
 *
 * Features:
 *  - List existing cloud projects (name, size, date, expiry)
 *  - Save current project to cloud (JSON + PDFs)
 *  - Load a cloud project (restores PDFs into backend _STORE)
 *  - Rename / delete cloud projects
 *  - Toggle permanent vs auto-delete (14-day TTL)
 */
import React, { useState, useEffect } from "react";
import {
  listCloudProjects,
  createCloudProject,
  uploadCloudProjectFull,
  loadCloudProjectFull,
  renameCloudProject,
  deleteCloudProject,
  toggleCloudProjectPermanent,
} from "../api/client";
import type { CloudProjectItem } from "../api/client";

interface Props {
  projectPayload: () => any; // function that returns current project JSON
  onLoad: (data: any) => void; // callback when user loads a project
  onClose: () => void;
  onError: (msg: string) => void;
  onMsg: (msg: string) => void;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

export function CloudProjectsPanel({ projectPayload, onLoad, onClose, onError, onMsg, onBusyChange }: Props) {
  const [projects, setProjects] = useState<CloudProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refresh = async () => {
    try {
      setLoading(true);
      const list = await listCloudProjects();
      setProjects(list);
    } catch (err: any) {
      onError(`載入雲端專案列表失敗：${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSave = async () => {
    const name = newName.trim() || `Project ${new Date().toLocaleDateString()}`;
    setSaving(true);
    onBusyChange?.(true, "Saving project to cloud...");
    try {
      const created = await createCloudProject(name);
      const payload = projectPayload();
      await uploadCloudProjectFull(created.id, payload);
      onMsg(`已保存至雲端（含 PDF）：${name}`);
      setNewName("");
      await refresh();
    } catch (err: any) {
      onError(`雲端保存失敗：${err.message || err}`);
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  const handleOverwrite = async (proj: CloudProjectItem) => {
    if (!window.confirm(`確定要覆蓋「${proj.name}」嗎？所有 PDF 和資料將會更新。`)) return;
    setSaving(true);
    onBusyChange?.(true, "Overwriting cloud project...");
    try {
      const payload = projectPayload();
      await uploadCloudProjectFull(proj.id, payload);
      onMsg(`已覆蓋：${proj.name}`);
      await refresh();
    } catch (err: any) {
      onError(`覆蓋失敗：${err.message || err}`);
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  const handleLoad = async (proj: CloudProjectItem) => {
    onBusyChange?.(true, `Loading cloud project: ${proj.name}...`);
    try {
      onMsg(`正在從雲端載入「${proj.name}」（含 PDF 還原）…`);
      const data = await loadCloudProjectFull(proj.id);
      // Show warnings if any PDFs were missing
      if (data._warnings?.length) {
        onError(data._warnings.join("\n"));
        delete data._warnings;
      }
      onLoad(data);
      onMsg(`已載入雲端專案：${proj.name}`);
      onClose();
    } catch (err: any) {
      onError(`載入失敗：${err.message || err}`);
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleRename = async (proj: CloudProjectItem) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameCloudProject(proj.id, name);
      setRenamingId(null);
      await refresh();
    } catch (err: any) {
      onError(`重命名失敗：${err.message || err}`);
    }
  };

  const handleDelete = async (proj: CloudProjectItem) => {
    if (!window.confirm(`確定要刪除「${proj.name}」嗎？此操作無法復原，所有 PDF 和資料將永久刪除。`)) return;
    try {
      await deleteCloudProject(proj.id);
      onMsg(`已刪除：${proj.name}`);
      await refresh();
    } catch (err: any) {
      onError(`刪除失敗：${err.message || err}`);
    }
  };

  const handleTogglePermanent = async (proj: CloudProjectItem) => {
    try {
      await toggleCloudProjectPermanent(proj.id, !proj.permanent);
      await refresh();
      onMsg(proj.permanent ? `「${proj.name}」已改為自動刪除（14天）` : `「${proj.name}」已設為永久保存`);
    } catch (err: any) {
      onError(`設定失敗：${err.message || err}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatExpiry = (proj: CloudProjectItem) => {
    if (proj.permanent) return "♾ 永久保存";
    if (!proj.expires_at) return "—";
    const exp = new Date(proj.expires_at);
    const now = new Date();
    const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return "⚠ 即將刪除";
    if (daysLeft <= 3) return `⚠ ${daysLeft} 天後刪除`;
    return `${daysLeft} 天後刪除`;
  };

  const expiryColor = (proj: CloudProjectItem) => {
    if (proj.permanent) return "#27ae60";
    if (!proj.expires_at) return "#999";
    const exp = new Date(proj.expires_at);
    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 3) return "#e74c3c";
    if (daysLeft <= 7) return "#f39c12";
    return "#888";
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        {/* Title bar */}
        <div style={titleBar}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>☁ 雲端專案管理</span>
          <button style={btnSmall} onClick={onClose}>✕ 關閉</button>
        </div>

        {/* Info banner */}
        <div style={{ padding: "8px 16px", background: "#eaf4fc", borderBottom: "1px solid #d5e8f5", fontSize: 12, color: "#2471a3" }}>
          💡 雲端儲存會同時保存 PDF 原檔與專案資料。非永久保存的專案將在最後更新後 14 天自動刪除。
        </div>

        {/* Save new */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={{ flex: 1, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }}
            placeholder="專案名稱（留空則使用日期）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <button
            style={{ ...btnAction, background: "#2980b9", color: "#fff", border: "1px solid #2471a3" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "💾 保存當前專案（含 PDF）"}
          </button>
        </div>

        {/* Project list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 24, color: "#999" }}>載入中...</div>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: "#999" }}>
              尚無雲端專案。點擊上方「保存當前專案」開始使用。
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["名稱", "檔案數", "頁數", "大小", "更新時間", "到期", "操作"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>
                      {renamingId === p.id ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <input
                            style={{ flex: 1, padding: "2px 6px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12 }}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleRename(p)}
                            autoFocus
                          />
                          <button style={miniBtn} onClick={() => handleRename(p)}>✓</button>
                          <button style={miniBtn} onClick={() => setRenamingId(null)}>✕</button>
                        </div>
                      ) : (
                        <span
                          style={{ cursor: "pointer", color: "#2980b9" }}
                          title="點擊重命名"
                          onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                        >
                          {p.name}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{p.pdf_count}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{p.page_count}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{formatSize(p.size_bytes)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 11 }}>
                      {p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 11, color: expiryColor(p) }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>{formatExpiry(p)}</span>
                        <button
                          style={{ ...miniBtn, fontSize: 10, padding: "1px 4px" }}
                          onClick={() => handleTogglePermanent(p)}
                          title={p.permanent ? "改為自動刪除（14天）" : "設為永久保存"}
                        >
                          {p.permanent ? "🔓" : "🔒"}
                        </button>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button style={miniBtn} onClick={() => handleLoad(p)} title="載入此專案（含 PDF 還原）">📂 載入</button>
                        <button style={miniBtn} onClick={() => handleOverwrite(p)} disabled={saving} title="用當前專案覆蓋（含 PDF）">💾 覆蓋</button>
                        <button style={{ ...miniBtn, color: "#e74c3c" }} onClick={() => handleDelete(p)} title="刪除">🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 6, display: "flex", flexDirection: "column",
  width: "85vw", maxWidth: 900, height: "75vh",
  boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
};
const titleBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 16px", background: "#f0f0f0", borderBottom: "1px solid #ddd",
  borderRadius: "6px 6px 0 0",
};
const thStyle: React.CSSProperties = {
  padding: "6px 8px", borderBottom: "2px solid #ddd", textAlign: "left", fontSize: 12, color: "#555",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 8px", borderBottom: "1px solid #eee", verticalAlign: "middle",
};
const btnSmall: React.CSSProperties = {
  padding: "4px 10px", border: "1px solid #ccc", borderRadius: 3,
  background: "#f5f5f5", cursor: "pointer", fontSize: 12,
};
const btnAction: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 500,
};
const miniBtn: React.CSSProperties = {
  padding: "2px 8px", border: "1px solid #ccc", borderRadius: 3,
  background: "#f9f9f9", cursor: "pointer", fontSize: 12,
};
