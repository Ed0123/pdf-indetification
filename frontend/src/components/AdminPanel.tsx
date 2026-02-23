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
import { TIER_LABELS, STATUS_LABELS } from "../types/user";
import type { GroupItem } from "../api/client";

interface AdminPanelProps {
  users: UserProfile[];
  groups: GroupItem[];
  onUpdateUser: (uid: string, changes: Partial<UserProfile>) => Promise<void>;
  onResetUsage: (uid: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onGoHome: () => void;
}

const STATUS_OPTIONS: AccountStatus[] = ["pending", "active", "suspended"];
const TIER_OPTIONS: MemberTier[] = ["basic", "sponsor", "premium", "admin"];

export function AdminPanel({
  users,
  groups,
  onGoHome,
  onUpdateUser,
  onResetUsage,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: AdminPanelProps) {
  const [filter, setFilter] = useState("");
  const [editingNotes, setEditingNotes] = useState<{ uid: string; value: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [renameGroupName, setRenameGroupName] = useState("");

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

  return (
    <div style={container}>
      <div style={panel}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>⚙ 管理員面板</h2>
          <button style={linkBtn} onClick={onGoHome}>← 回到主頁</button>
        </div>

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

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                {["#", "姓名", "電郵", "WhatsApp", "用量", "類別", "群組", "加入日期", "最後登入", "狀態", "備註"].map((h) => (
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

                    {/* Tier dropdown */}
                    <td style={td}>
                      <select
                        style={selectStyle}
                        value={u.tier}
                        onChange={(e) => handleChange(u.uid, { tier: e.target.value as MemberTier })}
                      >
                        {TIER_OPTIONS.map((t) => (
                          <option key={t} value={t}>{TIER_LABELS[t]}</option>
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
                  <td colSpan={11} style={{ ...td, textAlign: "center", color: "#aaa" }}>
                    沒有符合條件的用戶
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
