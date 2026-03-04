/**
 * AdminPanel — User management table for admin users.
 *
 * Displays all registered users with:
 *  - Filter by name / email
 *  - Inline edit: status dropdown, tier dropdown, group assignment, notes textarea
 *  - Usage statistics per user
 */
import React, { useState, useMemo } from "react";
import type { UserProfile, MemberTier, AccountStatus } from "../types/user";
import { TIER_LABELS, STATUS_LABELS, TIER_FEATURES } from "../types/user";
import type { GroupItem, TierItem } from "../api/client";
import { fetchAllMessages, replyToMessage } from "../api/client";
import { AdminMessagesPanel } from "./AdminMessagesPanel";

interface AdminPanelProps {
  users: UserProfile[];
  groups: GroupItem[];
  tiers: TierItem[];
  onUpdateUser: (uid: string, changes: Partial<UserProfile>) => Promise<void>;
  onResetUsage: (uid: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onCreateTier: (data: { name: string; label: string; quota: number; storage_quota_mb?: number; features?: Record<string, boolean> }) => Promise<void>;
  onUpdateTier: (tierId: string, data: { name?: string; label?: string; quota?: number; storage_quota_mb?: number; features?: Record<string, boolean> }) => Promise<void>;
  onDeleteTier: (tierId: string) => Promise<void>;
  onGoHome: () => void;
}

const STATUS_OPTIONS: AccountStatus[] = ["pending", "active", "suspended"];

export function AdminPanel({
  users,
  groups,
  tiers,
  onGoHome,
  onUpdateUser,
  onResetUsage,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateTier,
  onUpdateTier,
  onDeleteTier,
}: AdminPanelProps) {
  const [filter, setFilter] = useState("");
  const [showMessages, setShowMessages] = useState(false);
  const [editingNotes, setEditingNotes] = useState<{ uid: string; value: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [renameGroupName, setRenameGroupName] = useState("");

  // Tier management state
  const [newTierName, setNewTierName] = useState("");
  const [newTierLabel, setNewTierLabel] = useState("");
  const [newTierQuota, setNewTierQuota] = useState("100");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [editTierLabel, setEditTierLabel] = useState("");
  const [editTierQuota, setEditTierQuota] = useState("");

  // Build tier label lookup (dynamic tiers override static TIER_LABELS)
  const tierLabelMap = useMemo(() => {
    const m: Record<string, string> = { ...TIER_LABELS };
    tiers.forEach((t) => { m[t.name] = t.label; });
    return m;
  }, [tiers]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return users;
    const q = filter.toLowerCase();
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.whatsapp || "").toLowerCase().includes(q)
    );
  }, [users, filter]);

  const handleChange = async (uid: string, changes: Partial<UserProfile>) => {
    setSaving(uid);
    try {
      await onUpdateUser(uid, changes);
    } catch {
      /* ignore */
    } finally {
      setSaving(null);
    }
  };

  const saveNotes = async () => {
    if (!editingNotes) return;
    await handleChange(editingNotes.uid, { notes: editingNotes.value });
    setEditingNotes(null);
  };

  const handleResetUsage = async (uid: string) => {
    setSaving(uid);
    try {
      await onResetUsage(uid);
    } catch {
      /* ignore */
    } finally {
      setSaving(null);
    }
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await onCreateGroup(name);
    setNewGroupName("");
  };

  const handleRenameGroup = async () => {
    const name = renameGroupName.trim();
    if (!selectedGroupId || !name) return;
    await onRenameGroup(selectedGroupId, name);
    setRenameGroupName("");
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupId) return;
    await onDeleteGroup(selectedGroupId);
    setSelectedGroupId("");
    setRenameGroupName("");
  };

  const handleCreateTier = async () => {
    const name = newTierName.trim().toLowerCase();
    const label = newTierLabel.trim();
    const quota = parseInt(newTierQuota, 10);
    if (!name || !label || isNaN(quota)) return;
    await onCreateTier({ name, label, quota });
    setNewTierName("");
    setNewTierLabel("");
    setNewTierQuota("100");
  };

  const handleUpdateTier = async () => {
    if (!selectedTierId) return;
    const changes: { label?: string; quota?: number } = {};
    if (editTierLabel.trim()) changes.label = editTierLabel.trim();
    const q = parseInt(editTierQuota, 10);
    if (!isNaN(q)) changes.quota = q;
    if (Object.keys(changes).length === 0) return;
    await onUpdateTier(selectedTierId, changes);
  };

  const handleDeleteTier = async () => {
    if (!selectedTierId) return;
    await onDeleteTier(selectedTierId);
    setSelectedTierId("");
    setEditTierLabel("");
    setEditTierQuota("");
  };

  return (
    <div style={container}>
      <div style={panel}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>⚙ 管理員面板</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={linkBtn} onClick={() => setShowMessages(!showMessages)}>
              {showMessages ? "👥 使用者" : "✉ 訊息"}
            </button>
            <button style={linkBtn} onClick={onGoHome}>← 回到主頁</button>
          </div>
        </div>

        {showMessages ? (
          <AdminMessagesPanel
            fetchAllMessages={fetchAllMessages}
            replyToMessage={replyToMessage}
          />
        ) : (
          <>
            {/* existing user management UI continues below */}
          </>
        )}

        {!showMessages && (
          <>
            {/* Filter */}
            <input
          style={{ ...inputStyle, width: 280, marginBottom: 14 }}
          placeholder="🔍 搜尋姓名 / 電郵 / WhatsApp"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
          共 {filtered.length} / {users.length} 位用戶
        </div>

        {/* Group management */}
        <div style={{
          marginBottom: 14,
          padding: "10px 12px",
          border: "1px solid #e6e6e6",
          borderRadius: 6,
          background: "#fafafa",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>群組管理</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...inputStyle, width: 140 }}
              placeholder="新群組名稱"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            />
            <button style={miniBtn} onClick={handleCreateGroup}>新增</button>

            <select
              style={{ ...selectStyle, minWidth: 140 }}
              value={selectedGroupId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedGroupId(id);
                const g = groups.find((x) => x.id === id);
                setRenameGroupName(g?.name ?? "");
              }}
            >
              <option value="">選擇群組</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>

            <input
              style={{ ...inputStyle, width: 140 }}
              placeholder="重新命名"
              value={renameGroupName}
              onChange={(e) => setRenameGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameGroup()}
            />
            <button style={miniBtn} onClick={handleRenameGroup} disabled={!selectedGroupId || !renameGroupName.trim()}>重新命名</button>
            <button style={miniBtn} onClick={handleDeleteGroup} disabled={!selectedGroupId}>刪除</button>
          </div>
        </div>

        {/* Tier / Quota management */}
        <div style={{
          marginBottom: 14,
          padding: "10px 12px",
          border: "1px solid #e6e6e6",
          borderRadius: 6,
          background: "#fafafa",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>會員類別 / 配額管理</div>

          {/* Current tiers list */}
          <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tiers.map((t) => (
              <span key={t.id} style={{
                display: "inline-block", padding: "3px 8px", fontSize: 11,
                background: t.name === "admin" ? "#fdebd0" : "#d5f5e3",
                borderRadius: 4, border: "1px solid #ddd",
              }}>
                <strong>{t.label}</strong> ({t.name}) — {t.quota === -1 ? "無限" : `${t.quota}頁/月`}
              </span>
            ))}
          </div>

          {/* Create new tier */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <input
              style={{ ...inputStyle, width: 100 }}
              placeholder="名稱 (英文)"
              value={newTierName}
              onChange={(e) => setNewTierName(e.target.value)}
            />
            <input
              style={{ ...inputStyle, width: 100 }}
              placeholder="顯示名稱"
              value={newTierLabel}
              onChange={(e) => setNewTierLabel(e.target.value)}
            />
            <input
              style={{ ...inputStyle, width: 80 }}
              placeholder="配額"
              value={newTierQuota}
              onChange={(e) => setNewTierQuota(e.target.value)}
              type="number"
              title="-1 = 無限"
            />
            <button style={miniBtn} onClick={handleCreateTier}>新增類別</button>
          </div>

          {/* Edit existing tier */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select
              style={{ ...selectStyle, minWidth: 140 }}
              value={selectedTierId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedTierId(id);
                const t = tiers.find((x) => x.id === id);
                setEditTierLabel(t?.label ?? "");
                setEditTierQuota(t?.quota !== undefined ? String(t.quota) : "");
              }}
            >
              <option value="">選擇類別</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>{t.label} ({t.name})</option>
              ))}
            </select>
            <input
              style={{ ...inputStyle, width: 100 }}
              placeholder="顯示名稱"
              value={editTierLabel}
              onChange={(e) => setEditTierLabel(e.target.value)}
            />
            <input
              style={{ ...inputStyle, width: 80 }}
              placeholder="配額"
              value={editTierQuota}
              onChange={(e) => setEditTierQuota(e.target.value)}
              type="number"
              title="-1 = 無限"
            />
            <button style={miniBtn} onClick={handleUpdateTier} disabled={!selectedTierId}>更新</button>
            <button style={miniBtn} onClick={handleDeleteTier} disabled={!selectedTierId}>刪除</button>
          </div>

          {/* Feature matrix */}
          {tiers.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>功能矩陣</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ ...thFeature, textAlign: "left" }}>功能</th>
                      {tiers.map((t) => (
                        <th key={t.id} style={thFeature}>{t.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TIER_FEATURES.map((feat) => (
                      <tr key={feat.key}>
                        <td style={tdFeature}>{feat.label}</td>
                        {tiers.map((t) => {
                          const enabled = t.features?.[feat.key] ?? false;
                          return (
                            <td key={t.id} style={{ ...tdFeature, textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => {
                                  const newFeatures = { ...(t.features || {}), [feat.key]: !enabled };
                                  onUpdateTier(t.id, { features: newFeatures });
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td style={tdFeature}>雲端儲存 (MB)</td>
                      {tiers.map((t) => (
                        <td key={t.id} style={{ ...tdFeature, textAlign: "center" }}>
                          <input
                            type="number"
                            style={{ width: 50, fontSize: 11, border: "1px solid #ccc", borderRadius: 2, textAlign: "center" }}
                            value={t.storage_quota_mb ?? 0}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val)) onUpdateTier(t.id, { storage_quota_mb: val });
                            }}
                            title="-1 = 無限, 0 = 無"
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                {["#", "姓名", "電郵", "WhatsApp", "用量", "雲端用量", "類別", "群組", "加入日期", "最後登入", "狀態", "備註"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const isSaving = saving === u.uid;
                return (
                  <tr key={u.uid} style={{ opacity: isSaving ? 0.5 : 1, background: i % 2 === 0 ? "#fafafa" : "#fff" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{u.display_name}</td>
                    <td style={td}>{u.email}</td>
                    <td style={td}>{u.whatsapp || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <span>{u.usage_pages ?? 0}</span>
                        <button
                          style={miniBtn}
                          onClick={() => handleResetUsage(u.uid)}
                          disabled={isSaving}
                          title="重置此用戶的本月用量"
                        >
                          重置
                        </button>
                      </div>
                    </td>

                    {/* Cloud storage used */}
                    <td style={{ ...td, textAlign: "center", fontSize: 11, whiteSpace: "nowrap" }}>
                      {u.storage_used_bytes
                        ? u.storage_used_bytes < 1024 * 1024
                          ? `${(u.storage_used_bytes / 1024).toFixed(1)} KB`
                          : `${(u.storage_used_bytes / (1024 * 1024)).toFixed(1)} MB`
                        : "0"}
                    </td>

                    {/* Tier dropdown */}
                    <td style={td}>
                      <select
                        style={selectStyle}
                        value={u.tier}
                        onChange={(e) => handleChange(u.uid, { tier: e.target.value as MemberTier })}
                      >
                        {tiers.map((t) => (
                          <option key={t.id} value={t.name}>{t.label}</option>
                        ))}
                      </select>
                    </td>

                    {/* Group dropdown */}
                    <td style={td}>
                      <select
                        style={selectStyle}
                        value={u.group || groups[0]?.name || ""}
                        onChange={(e) => handleChange(u.uid, { group: e.target.value })}
                      >
                        {groups.map((g) => (
                          <option key={g.id} value={g.name}>{g.name}</option>
                        ))}
                      </select>
                    </td>

                    <td style={{ ...td, fontSize: 11, whiteSpace: "nowrap" }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ ...td, fontSize: 11, whiteSpace: "nowrap" }}>
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : "—"}
                    </td>

                    {/* Status dropdown */}
                    <td style={td}>
                      <select
                        style={{
                          ...selectStyle,
                          color: u.status === "active" ? "#27ae60" : u.status === "pending" ? "#f39c12" : "#c0392b",
                          fontWeight: 600,
                        }}
                        value={u.status}
                        onChange={(e) => handleChange(u.uid, { status: e.target.value as AccountStatus })}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>

                    {/* Notes */}
                    <td style={td}>
                      {editingNotes?.uid === u.uid ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <textarea
                            style={{ ...inputStyle, width: 140, height: 40, resize: "vertical" }}
                            value={editingNotes.value}
                            onChange={(e) => setEditingNotes({ uid: u.uid, value: e.target.value })}
                            autoFocus
                          />
                          <button style={miniBtn} onClick={saveNotes}>✓</button>
                          <button style={miniBtn} onClick={() => setEditingNotes(null)}>✕</button>
                        </div>
                      ) : (
                        <span
                          style={{ cursor: "pointer", color: u.notes ? "#333" : "#bbb", fontSize: 12 }}
                          title="Click to edit"
                          onClick={() => setEditingNotes({ uid: u.uid, value: u.notes || "" })}
                        >
                          {u.notes || "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ ...td, textAlign: "center", color: "#aaa" }}>
                    沒有符合條件的用戶
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    )}
    </div>
  </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex", justifyContent: "center",
  minHeight: "100vh", background: "#f0f2f5", padding: 20,
};
const panel: React.CSSProperties = {
  background: "#fff", borderRadius: 10, padding: "28px 30px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)", width: 1100, maxWidth: "98vw",
};
const table: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 13,
};
const th: React.CSSProperties = {
  borderBottom: "2px solid #ddd", padding: "8px 6px", textAlign: "left",
  fontSize: 12, color: "#555", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  borderBottom: "1px solid #eee", padding: "7px 6px", verticalAlign: "middle",
};
const inputStyle: React.CSSProperties = {
  padding: "5px 8px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  padding: "3px 4px", border: "1px solid #ccc", borderRadius: 3, fontSize: 12,
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 13, color: "#2980b9", textDecoration: "underline", padding: 0,
};
const miniBtn: React.CSSProperties = {
  padding: "2px 8px", border: "1px solid #ccc", borderRadius: 3,
  background: "#f9f9f9", cursor: "pointer", fontSize: 12,
};
const thFeature: React.CSSProperties = {
  padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "center", fontSize: 11, whiteSpace: "nowrap",
};
const tdFeature: React.CSSProperties = {
  padding: "3px 8px", borderBottom: "1px solid #eee", fontSize: 11,
};
