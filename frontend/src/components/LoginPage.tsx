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
        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>PDF Text Extraction</h1>
          <p style={{ margin: "8px 0 0", color: "#888", fontSize: 13 }}>
            Sign in to continue
          </p>
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
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>

        {error && <p style={{ color: "#c0392b", fontSize: 12, marginTop: 12, textAlign: "center" }}>{error}</p>}

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: "#aaa" }}>
          By signing in you agree to our Terms of Service.
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
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
};

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "48px 40px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  width: 380,
  maxWidth: "90vw",
};

const googleBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "12px 16px",
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#fff",
  fontSize: 15,
  fontWeight: 500,
  color: "#333",
};
