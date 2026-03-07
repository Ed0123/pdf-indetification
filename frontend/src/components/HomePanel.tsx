import React, { useMemo, useState } from "react";
import type { UserProfile } from "../types/user";
import { TIER_FEATURES } from "../types/user";
import type { CloudProjectItem, SystemUpdateItem } from "../api/client";

interface HomePanelProps {
  profile: UserProfile | null;
  usagePages: number;
  usageLimit: number;
  updates: SystemUpdateItem[];
  startupCurrent: CloudProjectItem | null;
  hasCurrentData: boolean;
  backupEnabled: boolean;
  backupMode: "manual" | "smart" | "aggressive";
  backupStatus: "idle" | "running" | "ok" | "error";
  backupAt: string | null;
  backupWrites: number;
  backupSkips: number;
  localSnapshotAt: string | null;
  localSnapshotSizeBytes: number;
  onSetBackupEnabled: (enabled: boolean) => void;
  onSetBackupMode: (mode: "manual" | "smart" | "aggressive") => void;
  onManualBackup: () => Promise<void>;
  onSaveLocalSnapshot: () => void;
  onRestoreLocalSnapshot: () => void;
  onResumeLastSession: () => void;
  onStartNewSession: () => void;
  onOpenCloudProjects: () => void;
  onCreateUpdate: (heading: string, content: string) => Promise<void>;
  onDeleteUpdate: (id: string) => Promise<void>;
}

const formatFeatureLabel = (key: string): string => {
  const fromCatalog = TIER_FEATURES.find((f) => f.key === key)?.label;
  if (fromCatalog) return fromCatalog;
  return key;
};

const backupStatusText = (status: "idle" | "running" | "ok" | "error"): string => {
  if (status === "running") return "備份中";
  if (status === "ok") return "備份完成";
  if (status === "error") return "備份失敗";
  return "待機";
};

export function HomePanel({
  profile,
  usagePages,
  usageLimit,
  updates,
  startupCurrent,
  hasCurrentData,
  backupEnabled,
  backupMode,
  backupStatus,
  backupAt,
  backupWrites,
  backupSkips,
  localSnapshotAt,
  localSnapshotSizeBytes,
  onSetBackupEnabled,
  onSetBackupMode,
  onManualBackup,
  onSaveLocalSnapshot,
  onRestoreLocalSnapshot,
  onResumeLastSession,
  onStartNewSession,
  onOpenCloudProjects,
  onCreateUpdate,
  onDeleteUpdate,
}: HomePanelProps) {
  const [newHeading, setNewHeading] = useState("系統更新");
  const [newContent, setNewContent] = useState("");
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [manualBackupBusy, setManualBackupBusy] = useState(false);

  const isAdmin = profile?.tier === "admin";
  const entries = Object.entries(profile?.tier_features ?? {});
  const enabled = entries.filter(([, value]) => value === true);
  const disabled = entries.filter(([, value]) => value === false);
  const backupSupported = (profile?.tier_features?.auto_backup ?? false) === true;

  const backupText = useMemo(() => {
    const when = backupAt ? `（${new Date(backupAt).toLocaleString()}）` : "";
    return `${backupStatusText(backupStatus)} ${when}`.trim();
  }, [backupAt, backupStatus]);

  const localSizeText = useMemo(() => {
    if (localSnapshotSizeBytes < 1024) return `${localSnapshotSizeBytes} B`;
    if (localSnapshotSizeBytes < 1024 * 1024) return `${(localSnapshotSizeBytes / 1024).toFixed(1)} KB`;
    return `${(localSnapshotSizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  }, [localSnapshotSizeBytes]);

  const handleCreateUpdate = async () => {
    const heading = newHeading.trim() || "系統更新";
    const content = newContent.trim();
    if (!content) return;
    setSavingUpdate(true);
    try {
      await onCreateUpdate(heading, content);
      setNewContent("");
      setNewHeading("系統更新");
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleManualBackup = async () => {
    setManualBackupBusy(true);
    try {
      await onManualBackup();
    } finally {
      setManualBackupBusy(false);
    }
  };

  return (
    <div style={container}>
      <h2 style={{ margin: 0, fontSize: 20 }}>主頁</h2>
      <p style={{ margin: "6px 0 0", color: "#4d5b70", fontSize: 13 }}>
        歡迎回來，{profile?.salutation || profile?.display_name || "使用者"}。
      </p>

      <div style={grid}>
        <section style={card}>
          <h3 style={title}>工作階段</h3>
          <div style={{ fontSize: 13, color: "#3e4a5b", marginBottom: 8 }}>
            {hasCurrentData
              ? "偵測到你的上次工作階段，可直接繼續。"
              : "目前沒有可恢復的上次工作階段。"}
          </div>
          <div style={kvRow}><span style={k}>Current Project</span><span>{startupCurrent?.name || "Current Project"}</span></div>
          <div style={kvRow}><span style={k}>最後更新</span><span>{startupCurrent?.updated_at ? new Date(startupCurrent.updated_at).toLocaleString() : "-"}</span></div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={btnPrimary} onClick={onResumeLastSession} disabled={!hasCurrentData}>回到上次工作</button>
            <button style={btn} onClick={onStartNewSession}>開新工作</button>
            <button style={btn} onClick={onOpenCloudProjects}>Cloud Projects</button>
          </div>
        </section>

        <section style={card}>
          <h3 style={title}>帳號與配額</h3>
          <div style={kvRow}><span style={k}>帳號</span><span>{profile?.email || "-"}</span></div>
          <div style={kvRow}><span style={k}>會員層級</span><span>{profile?.tier || "basic"}</span></div>
          <div style={kvRow}><span style={k}>本月 OCR 用量</span><span>{usagePages} / {usageLimit === -1 ? "∞" : usageLimit}</span></div>
          <div style={kvRow}><span style={k}>每專案大小上限</span><span>{profile?.project_size_mb === -1 ? "∞" : `${profile?.project_size_mb ?? 200} MB`}</span></div>
          <div style={kvRow}><span style={k}>備份狀態</span><span>{backupText}</span></div>
          <div style={kvRow}><span style={k}>備份模式</span><span>{backupMode === "manual" ? "手動" : backupMode === "smart" ? "智慧省成本" : "即時保險"}</span></div>
          <div style={kvRow}><span style={k}>雲端寫入次數</span><span>{backupWrites}</span></div>
          <div style={kvRow}><span style={k}>已省下寫入</span><span>{backupSkips}</span></div>
          <div style={kvRow}><span style={k}>本機快照大小</span><span>{localSizeText}</span></div>
          <div style={kvRow}><span style={k}>本機快照時間</span><span>{localSnapshotAt ? new Date(localSnapshotAt).toLocaleString() : "-"}</span></div>

          <label style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", fontSize: 13, color: backupSupported ? "#3e4a5b" : "#999" }}>
            <input
              type="checkbox"
              checked={backupEnabled}
              disabled={!backupSupported}
              onChange={(e) => onSetBackupEnabled(e.target.checked)}
            />
            啟用自動備份（每 15 分鐘）
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <select
              value={backupMode}
              onChange={(e) => onSetBackupMode(e.target.value as "manual" | "smart" | "aggressive")}
              style={{ ...input, maxWidth: 180, padding: "6px 8px" }}
              disabled={!backupSupported}
            >
              <option value="manual">手動（最省雲端）</option>
              <option value="smart">智慧（建議）</option>
              <option value="aggressive">即時（高保護）</option>
            </select>
            <button style={btn} onClick={onSaveLocalSnapshot}>儲存本機快照</button>
            <button style={btn} onClick={onRestoreLocalSnapshot}>恢復本機快照</button>
            <button style={btnPrimary} onClick={handleManualBackup} disabled={manualBackupBusy || !backupSupported}>
              {manualBackupBusy ? "備份中..." : "立即雲端備份"}
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6c7788" }}>
            建議用「智慧」模式：先寫本機快照，只在定時或內容變更時寫雲端，可顯著降低後端與 Storage 成本。
          </p>
        </section>

        <section style={card}>
          <h3 style={title}>功能權限</h3>
          {entries.length === 0 && (
            <p style={{ margin: 0, color: "#6c7788", fontSize: 13 }}>
              尚未取得權限清單，請稍後再試。
            </p>
          )}
          {enabled.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={subTitle}>已開啟</div>
              <div style={chipWrap}>
                {enabled.map(([key]) => (
                  <span key={key} style={{ ...chip, ...chipOn }}>{formatFeatureLabel(key)}</span>
                ))}
              </div>
            </div>
          )}
          {disabled.length > 0 && (
            <div>
              <div style={subTitle}>未開啟</div>
              <div style={chipWrap}>
                {disabled.map(([key]) => (
                  <span key={key} style={{ ...chip, ...chipOff }}>{formatFeatureLabel(key)}</span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <section style={card}>
        <h3 style={title}>系統更新與功能日誌</h3>

        {isAdmin && (
          <div style={{ display: "grid", gap: 8, marginBottom: 12, padding: 10, border: "1px solid #e3ecf5", borderRadius: 8, background: "#f8fbff" }}>
            <input
              style={input}
              value={newHeading}
              onChange={(e) => setNewHeading(e.target.value)}
              placeholder="標題（例：系統更新）"
            />
            <textarea
              style={{ ...input, minHeight: 72, resize: "vertical" }}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="請用一般使用者容易理解的中文描述更新內容"
            />
            <div>
              <button style={btnPrimary} disabled={savingUpdate || !newContent.trim()} onClick={handleCreateUpdate}>
                {savingUpdate ? "發佈中..." : "發佈更新"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {updates.map((item) => (
            <div key={item.id} style={timelineItem}>
              <div style={timelineDate}>{new Date(item.created_at).toLocaleDateString()}</div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{item.heading}</div>
                  {isAdmin && (
                    <button style={btnDelete} onClick={() => onDeleteUpdate(item.id)}>刪除</button>
                  )}
                </div>
                <div style={{ color: "#4e5a6b", fontSize: 13, whiteSpace: "pre-wrap" }}>{item.content}</div>
              </div>
            </div>
          ))}
          {updates.length === 0 && (
            <div style={{ fontSize: 13, color: "#778399" }}>目前尚無更新日誌。</div>
          )}
        </div>
      </section>
    </div>
  );
}

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 14,
  height: "100%",
  overflow: "auto",
  background: "linear-gradient(180deg, #f8fbff 0%, #f3f8f4 100%)",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dbe5f0",
  borderRadius: 10,
  padding: 12,
};

const title: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 15,
};

const kvRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 13,
  padding: "5px 0",
  borderBottom: "1px dashed #e6edf7",
};

const k: React.CSSProperties = {
  color: "#5d6a7e",
};

const subTitle: React.CSSProperties = {
  fontSize: 12,
  color: "#627086",
  marginBottom: 6,
};

const chipWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const chip: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid transparent",
};

const chipOn: React.CSSProperties = {
  color: "#1f6b42",
  background: "#eaf8ef",
  borderColor: "#b5e2c4",
};

const chipOff: React.CSSProperties = {
  color: "#8a4e1f",
  background: "#fff4e8",
  borderColor: "#f4d6b8",
};

const timelineItem: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid #eef3f8",
};

const timelineDate: React.CSSProperties = {
  fontSize: 12,
  color: "#6c7990",
  fontWeight: 700,
};

const btn: React.CSSProperties = {
  border: "1px solid #cfd8e6",
  borderRadius: 6,
  padding: "6px 10px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  border: "1px solid #2f7de1",
  background: "#2f7de1",
  color: "#fff",
};

const btnDelete: React.CSSProperties = {
  border: "1px solid #ebc7c7",
  borderRadius: 6,
  padding: "2px 8px",
  background: "#fff7f7",
  color: "#b94444",
  cursor: "pointer",
  fontSize: 12,
};

const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cfd8e6",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  boxSizing: "border-box",
};
