import React from "react";

interface ToolbarProps {
  onImport: () => void;
  onClearData: () => void;
  onDeleteFiles: () => void;
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
  onClearData,
  onDeleteFiles,
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
      <div style={{ width: 1, height: 24, background: "#ddd", margin: "0 2px" }} />
      <Btn label="🗑 Clear Data" onClick={onClearData} disabled={disabled} title="Clear extracted data for selected pages" />
      <Btn label="✖ Delete Files" onClick={onDeleteFiles} disabled={disabled} title="Remove selected PDF files from project" />
      <div style={{ width: 1, height: 24, background: "#ddd", margin: "0 2px" }} />
      <Btn label="📊 Export Excel" onClick={onExportExcel} disabled={disabled} title="Export to Excel" />
      <div style={{ width: 1, height: 24, background: "#ddd", margin: "0 2px" }} />
      <Btn label="🔍 Recognize Text" onClick={onRecognizeText} disabled={disabled} title="Run text extraction on selected pages" />
      <div style={{ width: 1, height: 24, background: "#ddd", margin: "0 2px" }} />
      <Btn label="🗂 Templates" onClick={onManageTemplates} title="Manage extraction box templates" />
      <Btn label="📄 Export PDF" onClick={onExportPdf} disabled={disabled} title="Export selected pages as individual PDFs in a ZIP" />
    </div>
  );
}
