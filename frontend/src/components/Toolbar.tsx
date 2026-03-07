import React from "react";

interface ToolbarProps {
  onImport: () => void;
  onExportExcel: () => void;
  onRecognizeText: () => void;
  onManageTemplates: () => void;
  onExportPdf: () => void;
  onCloudProjects?: () => void;
  disabled: boolean;
}

const btn: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #c8d6e5",
  borderRadius: 8,
  background: "#ffffff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const btnHover: React.CSSProperties = { background: "#f3f8ff" };

function Btn({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      style={{ ...btn, ...(hovered ? btnHover : {}), opacity: disabled ? 0.5 : 1 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </button>
  );
}

export function Toolbar({
  onImport,
  onExportExcel,
  onRecognizeText,
  onManageTemplates,
  onExportPdf,
  onCloudProjects,
  disabled,
}: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 12px",
        background: "linear-gradient(90deg, #f6fbff 0%, #fbfffa 100%)",
        borderBottom: "1px solid #d9e6f2",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
        <div style={{ fontSize: 18 }}>📄</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#243447" }}>PDF 工作台</div>
          <div style={{ fontSize: 11, color: "#607388" }}>Local-first: 先本機快照，再智慧同步雲端</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Btn label="📂 匯入 PDF" onClick={onImport} title="Upload PDF files from your device" />
        {onCloudProjects && (
          <Btn label="☁ 雲端專案" onClick={onCloudProjects} title="切換到雲端儲存 / 管理雲端專案" />
        )}
      </div>
    </div>
  );
}
