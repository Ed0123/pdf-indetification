/**
 * MyAccountPage — Profile editing, usage stats, "Buy me a coffee" placeholder.
 *
 * First login flow: user MUST fill required fields (name, salutation, email, whatsapp).
 * Pending / Suspended users stay on this page.
 */
import React, { useState, useEffect } from "react";
import type { UserProfile, MemberTier, AccountStatus } from "../types/user";
import { TIER_LABELS, STATUS_LABELS } from "../types/user";

interface MyAccountPageProps {
  profile: UserProfile | null;
  /** True if profile has never been saved (first login). */
  isNewUser: boolean;
  /** Dynamic usage limit from API (-1 = unlimited). */
  usageLimit: number;
  /** Dynamic tier labels from API (overrides TIER_LABELS fallback). */
  tierLabels: Record<string, string>;
  onSave: (updated: Partial<UserProfile>) => Promise<void>;
  onGoHome: () => void;
  onSignOut: () => void;
  onOpenAdmin: () => void;
}

export function MyAccountPage({
  profile,
  isNewUser,
  usageLimit,
  tierLabels,
  onSave,
  onGoHome,
  onSignOut,
  onOpenAdmin,
}: MyAccountPageProps) {
  const [name, setName] = useState(profile?.display_name ?? "");
  const [salutation, setSalutation] = useState(profile?.salutation ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [msgBody, setMsgBody] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [msgSuccess, setMsgSuccess] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name);
    setSalutation(profile.salutation);
    setEmail(profile.email);
    setWhatsapp(profile.whatsapp);
  }, [profile]);

  const canGoHome = profile && profile.status === "active" && !isNewUser;
  const isAdmin = profile?.tier === "admin";

  const handleSave = async () => {
    if (!name.trim() || !salutation.trim() || !email.trim() || !whatsapp.trim()) {
      setError("所有 * 欄位為必填");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await onSave({
        display_name: name.trim(),
        salutation: salutation.trim(),
        email: email.trim(),
        whatsapp: whatsapp.trim(),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // handle contact-admin
  const handleSendMessage = async () => {
    if (!msgBody.trim()) return;
    setMsgSending(true);
    setMsgError(null);
    setMsgSuccess(false);
    try {
      const { sendUserMessage } = await import("../api/client");
      await sendUserMessage(msgBody.trim());
      setMsgSuccess(true);
      setMsgBody("");
    } catch (err: any) {
      setMsgError(err?.message || "送出失敗");
    } finally {
      setMsgSending(false);
    }
  };

  // Compute usage display
  const usedPages = profile?.usage_pages ?? 0;
  const limit = usageLimit === -1 ? Infinity : usageLimit;
  const limitStr = limit === Infinity ? "無限" : String(limit);
  const remaining = limit === Infinity ? "∞" : String(Math.max(0, limit - usedPages));

  // Resolve tier label: prefer dynamic tierLabels, fallback to TIER_LABELS
  const resolveTierLabel = (tier: string) => tierLabels[tier] || TIER_LABELS[tier] || tier;

  return (
    <div style={container}>
      <div style={card}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>👤 My Account</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {isAdmin && (
              <button style={linkBtn} onClick={onOpenAdmin}>⚙ 管理頁面</button>
            )}
            {canGoHome && (
              <button style={linkBtn} onClick={onGoHome}>← 回到主頁</button>
            )}
            <button style={{ ...linkBtn, color: "#c0392b" }} onClick={onSignOut}>登出</button>
          </div>
        </div>
        {/* contact admin button */}
        <div style={{ marginTop: 8 }}>
          <button
            style={{ ...linkBtn, fontSize: 13 }}
            onClick={() => setShowContact(!showContact)}
          >聯絡管理員</button>
        </div>

        {/* Status banner */}
        {profile && profile.status !== "active" && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 6,
            marginBottom: 16,
            background: profile.status === "pending" ? "#fef9e7" : "#fdedec",
            border: `1px solid ${profile.status === "pending" ? "#f9e79f" : "#f5b7b1"}`,
            fontSize: 13,
          }}>
            {profile.status === "pending"
              ? "⏳ 你的帳號正在審批中，審批通過後即可使用。"
              : "🚫 你的帳號已被停權，請聯絡管理員。"}
          </div>
        )}

        {isNewUser && (
          <div style={{
            padding: "10px 14px", borderRadius: 6, marginBottom: 16,
            background: "#eaf7ea", border: "1px solid #82e0aa", fontSize: 13,
          }}>
            🎉 歡迎！請填寫以下基本資料以完成註冊。
          </div>
        )}

        {/* Form */}
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 12px", alignItems: "center", fontSize: 13 }}>
          <label>姓名 *</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />

          <label>稱為 *</label>
          <input style={input} value={salutation} onChange={(e) => setSalutation(e.target.value)} placeholder="Mr. / Ms. / Dr." />

          <label>電郵 *</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" type="email" />

          <label>WhatsApp *</label>
          <input style={input} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+852 1234 5678" />
        </div>

        {error && <p style={{ color: "#c0392b", fontSize: 12, marginTop: 10 }}>{error}</p>}
        {success && <p style={{ color: "#27ae60", fontSize: 12, marginTop: 10 }}>已儲存 ✓</p>}

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "儲存中…" : isNewUser ? "完成註冊" : "💾 儲存"}
          </button>
        </div>

        {/* contact admin panel */}
        {showContact && (
          <div style={{ marginTop: 20, padding: 14, border: "1px solid #007acc", borderRadius: 6, background: "#f0f8ff" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>📨 給管理員的訊息</h3>
            <textarea
              style={{ width: "100%", height: 80, padding: 8 }}
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              placeholder="在此輸入你的訊息"
            />
            <p style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
              備註：系統會在 7 天後自動刪除這些訊息，請儘速查看回覆。
            </p>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                style={primaryBtn}
                disabled={msgSending || !msgBody.trim()}
                onClick={handleSendMessage}
              >{msgSending ? "送出中…" : "送出"}</button>
              {msgError && <span style={{ color: "#c0392b" }}>{msgError}</span>}
              {msgSuccess && <span style={{ color: "#27ae60" }}>已送出</span>}
            </div>
          </div>
        )}

        {/* Usage / membership info (only show after first save) */}
        {profile && !isNewUser && (
          <div style={{ marginTop: 24, padding: 14, background: "#f7f9fc", borderRadius: 6, border: "1px solid #eee" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>📊 會員資訊</h3>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 10px", fontSize: 13 }}>
              <span style={label}>會員類別:</span>
              <span>{resolveTierLabel(profile.tier ?? "basic")}</span>

              <span style={label}>會員狀態:</span>
              <span>{STATUS_LABELS[(profile.status ?? "pending") as AccountStatus]}</span>

              <span style={label}>群組:</span>
              <span>{profile.group || "個人"}</span>

              <span style={label}>本月使用量:</span>
              <span>{usedPages} / {limitStr} 頁</span>

              <span style={label}>餘下可用頁數:</span>
              <span style={{ fontWeight: 600, color: remaining === "0" ? "#c0392b" : "#27ae60" }}>{remaining}</span>

              <span style={label}>加入日期:</span>
              <span>{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}</span>
            </div>
          </div>
        )}

        {/* Buy me a coffee */}
        <div style={{ marginTop: 24, padding: 14, background: "#fffde7", borderRadius: 6, border: "1px solid #fff59d", textAlign: "center" }}>
          <a
            href="https://buymeacoffee.com/mcqshk"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none", color: "#333" }}
          >
            <img
              src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
              alt="Buy Me A Coffee"
              style={{ height: 40 }}
            />
          </a>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#888" }}>
            如果這個工具對你有幫助，請請我喝杯咖啡 ☕
          </p>
        </div>

        {/* Photo */}
        {profile?.photo_url && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <img src={profile.photo_url} alt="avatar" style={{ width: 48, height: 48, borderRadius: 24, border: "2px solid #ddd" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  minHeight: "100vh", background: "#f0f2f5", padding: 16,
};
const card: React.CSSProperties = {
  background: "#fff", borderRadius: 10, padding: "32px 36px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)", width: 520, maxWidth: "95vw",
};
const input: React.CSSProperties = {
  padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13,
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 24px", background: "#2980b9", color: "#fff",
  border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600, fontSize: 14,
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 13, color: "#2980b9", textDecoration: "underline", padding: 0,
};
const label: React.CSSProperties = { color: "#777" };
