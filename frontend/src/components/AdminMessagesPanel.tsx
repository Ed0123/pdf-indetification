import React, { useState, useEffect } from "react";
import type { UserMessage } from "../types";

interface AdminMessagesPanelProps {
  fetchAllMessages: () => Promise<UserMessage[]>;
  replyToMessage: (id: string, reply: string) => Promise<void>;
}

export function AdminMessagesPanel({ fetchAllMessages, replyToMessage }: AdminMessagesPanelProps) {
  const [messages, setMessages] = useState<UserMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const msgs = await fetchAllMessages();
      setMessages(msgs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleReply = async (id: string) => {
    if (!editing || editing.id !== id) return;
    const text = editing.text.trim();
    if (!text) return;
    setSavingId(id);
    try {
      await replyToMessage(id, text);
      await load();
      setEditing(null);
    } catch {
      // ignore
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>✉️ 用戶訊息</h3>
      {loading && <p>讀取中…</p>}
      {!loading && messages.length === 0 && <p>目前沒有訊息。</p>}
      {!loading && messages.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>發信者</th>
              <th style={th}>時間</th>
              <th style={th}>內容</th>
              <th style={th}>回覆</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={td}>{m.user_name}<br/><small>{m.user_email}</small></td>
                <td style={td}>{new Date(m.created_at).toLocaleString()}</td>
                <td style={td}>{m.body}</td>
                <td style={td}>
                  {m.reply ? (
                    <div style={{ fontSize: 13 }}>
                      {m.reply}
                      <br/><small>（{m.replied_at ? new Date(m.replied_at).toLocaleString() : ""}）</small>
                    </div>
                  ) : (
                    <div>
                      <textarea
                        style={{ width: "100%", height: 60 }}
                        value={editing?.id === m.id ? editing.text : ""}
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                      />
                      <button
                        style={{ marginTop: 4 }}
                        disabled={savingId === m.id}
                        onClick={() => handleReply(m.id)}
                      >{savingId === m.id ? "送出中…" : "送出"}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  background: "#f5f5f5",
  fontSize: 13,
};
const td: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 13,
  verticalAlign: "top",
};
