/**
 * LoginPage — Shown when user is not signed in.
 * Single button: "Sign in with Google".
 */
import React, { useState } from "react";

interface LoginPageProps {
  onGoogleSignIn: () => Promise<void>;
}

export function LoginPage({ onGoogleSignIn }: LoginPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      await onGoogleSignIn();
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={container}>
      <div style={card}>
        {/* Simple header with features list */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, color: "#1e2f3d" }}>Tools for QS</h1>
          <p style={{ margin: "12px 0 24px", color: "#5f7387", fontSize: 16, lineHeight: 1.4 }}>
            BQ-OCR、抄標、PDF OCR 等工具
          </p>
          {/* simplified features list to match Apple minimal aesthetic */}
          <ul style={{ textAlign: "left", padding: "0 20px", margin: 0, listStyleType: "none", color: "#5f7387", fontSize: 14, lineHeight: 1.6 }}>
            <li>BQ 工程量表 OCR 與編輯</li>
            <li>快速抄標功能</li>
            <li>一般 PDF OCR 及文件處理</li>
          </ul>
        </div>

        {/* Google button */}
        <button
          style={{
            ...googleBtn,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "wait" : "pointer",
          }}
          onClick={handleClick}
          disabled={loading}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 10, flexShrink: 0 }}>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "登入中..." : "使用 Google 登入"}
        </button>

        {error && <p style={{ color: "#c0392b", fontSize: 12, marginTop: 12, textAlign: "center" }}>{error}</p>}

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: "#aaa" }}>
          登入代表你同意服務條款與資料使用政策。
        </p>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "linear-gradient(135deg, #f2f2f5 0%, #ffffff 100%)",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
};

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: "48px 40px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
  width: 360,
  maxWidth: "90vw",
  textAlign: "center",
};

const googleBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "14px 18px",
  border: "1px solid #c7d8e8",
  borderRadius: 12,
  background: "#fff",
  fontSize: 16,
  fontWeight: 700,
  color: "#223648",
  transition: "opacity 0.2s ease",
};
