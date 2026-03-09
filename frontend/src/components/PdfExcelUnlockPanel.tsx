/**
 * PdfExcelUnlockPanel — Client-side PDF & Excel unlock tools.
 *
 * 100% local processing, no server calls. Uses pdf-lib for PDF unlock
 * and SheetJS (xlsx) for Excel sheet protection removal.
 */
import React, { useState, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { ModuleInstructionPanel } from "./ModuleInstructionPanel";

interface PdfExcelUnlockPanelProps {
  isAdmin: boolean;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PdfExcelUnlockPanel({ isAdmin, onBusyChange }: PdfExcelUnlockPanelProps) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string>("");
  const [excelStatus, setExcelStatus] = useState<string>("");
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUnlock = async () => {
    if (!pdfFile) return;
    onBusyChange?.(true, "正在解鎖 PDF ...");
    setPdfStatus("處理中...");
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const pdfBytes = await pdfDoc.save();
      downloadBlob(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), `unlocked-${pdfFile.name}`);
      setPdfStatus("✅ 解鎖完成，已下載");
    } catch (err: any) {
      setPdfStatus(`❌ 解鎖失敗：${err.message || err}`);
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleExcelUnlock = async () => {
    if (!excelFile) return;
    onBusyChange?.(true, "正在解鎖 Excel ...");
    setExcelStatus("處理中...");
    try {
      const arrayBuffer = await excelFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      // Remove sheet protection from all sheets
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          delete (sheet as any)["!protect"];
        }
      }
      const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      downloadBlob(
        new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `unlocked-${excelFile.name}`
      );
      setExcelStatus("✅ 解鎖完成，已下載");
    } catch (err: any) {
      setExcelStatus(`❌ 解鎖失敗：${err.message || err}`);
    } finally {
      onBusyChange?.(false);
    }
  };

  return (
    <div style={container}>
      <h3 style={heading}>🔓 PDF & Excel 解鎖</h3>
      <ModuleInstructionPanel moduleId="pdf_excel_unlock" isAdmin={isAdmin} />

      <p style={subtitle}>
        100% 本機處理，檔案不會上傳至伺服器。
      </p>

      {/* PDF Section */}
      <section style={card}>
        <h4 style={sectionTitle}>PDF 解鎖</h4>
        <p style={desc}>移除 PDF 密碼保護，讓您可以自由編輯和列印。</p>
        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { setPdfFile(f); setPdfStatus(""); }
          }}
        />
        <div style={row}>
          <button style={btn} onClick={() => pdfInputRef.current?.click()}>
            📂 選擇 PDF 檔案
          </button>
          {pdfFile && <span style={fileLabel}>{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</span>}
        </div>
        <div style={row}>
          <button style={btnPrimary} onClick={handlePdfUnlock} disabled={!pdfFile}>
            🔓 解鎖 PDF
          </button>
        </div>
        {pdfStatus && <div style={statusText}>{pdfStatus}</div>}
      </section>

      {/* Excel Section */}
      <section style={card}>
        <h4 style={sectionTitle}>Excel 解鎖</h4>
        <p style={desc}>移除工作表保護，讓您可以編輯受保護的儲存格。</p>
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { setExcelFile(f); setExcelStatus(""); }
          }}
        />
        <div style={row}>
          <button style={btn} onClick={() => excelInputRef.current?.click()}>
            📂 選擇 Excel 檔案
          </button>
          {excelFile && <span style={fileLabel}>{excelFile.name} ({(excelFile.size / 1024).toFixed(0)} KB)</span>}
        </div>
        <div style={row}>
          <button style={btnPrimary} onClick={handleExcelUnlock} disabled={!excelFile}>
            🔓 解鎖 Excel
          </button>
        </div>
        {excelStatus && <div style={statusText}>{excelStatus}</div>}
      </section>
    </div>
  );
}

const container: React.CSSProperties = {
  padding: 20,
  height: "100%",
  overflow: "auto",
  background: "linear-gradient(135deg, #f2f2f5 0%, #ffffff 100%)",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
};

const heading: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 20,
  fontWeight: 700,
  color: "#223648",
};

const subtitle: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 13,
  color: "#6c7788",
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dbe5f0",
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 15,
  fontWeight: 600,
  color: "#334155",
};

const desc: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 13,
  color: "#64748b",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
};

const btn: React.CSSProperties = {
  border: "1px solid #cfd8e6",
  borderRadius: 6,
  padding: "6px 12px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  border: "1px solid #2f7de1",
  background: "#2f7de1",
  color: "#fff",
};

const fileLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#5d6a7e",
};

const statusText: React.CSSProperties = {
  fontSize: 13,
  marginTop: 4,
  color: "#334155",
};
