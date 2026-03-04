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
  padding: "5px 12px",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#f5f5f5",
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const btnHover: React.CSSProperties = { background: "#e0e0e0" };

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
        gap: 6,
        padding: "6px 10px",
        background: "#f5f5f5",
        borderBottom: "1px solid #ddd",
        flexWrap: "wrap",
      }}
    >
      <Btn label="📂 Import PDF" onClick={onImport} title="Upload PDF files from your device" />
      {onCloudProjects && (
        <Btn label="☁ 雲端儲存" onClick={onCloudProjects} title="切換到雲端儲存 / 管理雲端專案" />
      )}
    </div>
  );
}
