/**
 * PdfExcelUnlockPanel — Client-side PDF & Excel unlock tools.
 *
 * 100% local processing, no server calls. Uses pdf-lib for PDF unlock
 * and JSZip for Excel sheet protection removal.
 * Supports multiple files at once — each file is processed sequentially.
 */
import React, { useState, useRef } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { ModuleInstructionPanel } from "./ModuleInstructionPanel";

interface PdfExcelUnlockPanelProps {
  isAdmin: boolean;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

interface FileStatus {
  file: File;
  status: "pending" | "processing" | "done" | "error";
  message: string;
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
  const [pdfFiles, setPdfFiles] = useState<FileStatus[]>([]);
  const [excelFiles, setExcelFiles] = useState<FileStatus[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUnlock = async () => {
    const pending = pdfFiles.filter(f => f.status === "pending" || f.status === "error");
    if (pending.length === 0) return;
    setPdfBusy(true);
    onBusyChange?.(true, `正在解鎖 ${pending.length} 個 PDF ...`);
    for (const entry of pending) {
      setPdfFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "processing", message: "處理中..." } : f));
      try {
        const arrayBuffer = await entry.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const pdfBytes = await pdfDoc.save();
        downloadBlob(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), `unlocked-${entry.file.name}`);
        setPdfFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "done", message: "✅ 已下載" } : f));
      } catch (err: any) {
        setPdfFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "error", message: `❌ ${err.message || err}` } : f));
      }
    }
    setPdfBusy(false);
    onBusyChange?.(false);
  };

  const handleExcelUnlock = async () => {
    const pending = excelFiles.filter(f => f.status === "pending" || f.status === "error");
    if (pending.length === 0) return;
    setExcelBusy(true);
    onBusyChange?.(true, `正在解鎖 ${pending.length} 個 Excel ...`);
    for (const entry of pending) {
      setExcelFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "processing", message: "處理中..." } : f));
      try {
        const arrayBuffer = await entry.file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const sheetPattern = /^xl\/worksheets\/.*\.xml$/;
        for (const [path, file] of Object.entries(zip.files)) {
          if (sheetPattern.test(path) && !file.dir) {
            let xml = await file.async("string");
            xml = xml.replace(/<sheetProtection[^/>]*\/>/g, "");
            xml = xml.replace(/<sheetProtection[^>]*>.*?<\/sheetProtection>/gs, "");
            zip.file(path, xml);
          }
        }
        const wbFile = zip.file("xl/workbook.xml");
        if (wbFile) {
          let wbXml = await wbFile.async("string");
          wbXml = wbXml.replace(/<workbookProtection[^/>]*\/>/g, "");
          wbXml = wbXml.replace(/<workbookProtection[^>]*>.*?<\/workbookProtection>/gs, "");
          zip.file("xl/workbook.xml", wbXml);
        }
        const output = await zip.generateAsync({ type: "blob" });
        downloadBlob(output, `unlocked-${entry.file.name}`);
        setExcelFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "done", message: "✅ 已下載" } : f));
      } catch (err: any) {
        setExcelFiles(prev => prev.map(f => f.file === entry.file ? { ...f, status: "error", message: `❌ ${err.message || err}` } : f));
      }
    }
    setExcelBusy(false);
    onBusyChange?.(false);
  };

  return (
    <div style={container}>
      <h3 style={heading}>🔓 PDF & Excel 解鎖</h3>
      <ModuleInstructionPanel moduleId="pdf_excel_unlock" isAdmin={isAdmin} />

      <p style={subtitle}>
        100% 本機處理，檔案不會上傳至伺服器。可同時選擇多個檔案。
      </p>

      {/* PDF Section */}
      <section style={card}>
        <h4 style={sectionTitle}>PDF 解鎖</h4>
        <p style={desc}>移除 PDF 密碼保護，讓您可以自由編輯和列印。</p>
        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) {
              setPdfFiles(prev => [
                ...prev,
                ...files.map(f => ({ file: f, status: "pending" as const, message: "待處理" })),
              ]);
            }
            e.target.value = "";
          }}
        />
        <div style={row}>
          <button style={btn} onClick={() => pdfInputRef.current?.click()}>
            📂 選擇 PDF 檔案（可多選）
          </button>
          {pdfFiles.length > 0 && (
            <button style={btn} onClick={() => setPdfFiles([])}>🗑 清除列表</button>
          )}
        </div>
        {pdfFiles.length > 0 && (
          <div style={fileListBox}>
            {pdfFiles.map((f, i) => (
              <div key={i} style={fileRow}>
                <span style={fileName}>{f.file.name}</span>
                <span style={fileSize}>({(f.file.size / 1024).toFixed(0)} KB)</span>
                <span style={statusBadge(f.status)}>{f.message}</span>
              </div>
            ))}
          </div>
        )}
        <div style={row}>
          <button style={btnPrimary} onClick={handlePdfUnlock} disabled={pdfFiles.length === 0 || pdfBusy}>
            🔓 解鎖 PDF {pdfFiles.filter(f => f.status === "pending" || f.status === "error").length > 0 &&
              `(${pdfFiles.filter(f => f.status === "pending" || f.status === "error").length} 個)`}
          </button>
        </div>
      </section>

      {/* Excel Section */}
      <section style={card}>
        <h4 style={sectionTitle}>Excel 解鎖</h4>
        <p style={desc}>移除工作表保護，讓您可以編輯受保護的儲存格。</p>
        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) {
              setExcelFiles(prev => [
                ...prev,
                ...files.map(f => ({ file: f, status: "pending" as const, message: "待處理" })),
              ]);
            }
            e.target.value = "";
          }}
        />
        <div style={row}>
          <button style={btn} onClick={() => excelInputRef.current?.click()}>
            📂 選擇 Excel 檔案（可多選）
          </button>
          {excelFiles.length > 0 && (
            <button style={btn} onClick={() => setExcelFiles([])}>🗑 清除列表</button>
          )}
        </div>
        {excelFiles.length > 0 && (
          <div style={fileListBox}>
            {excelFiles.map((f, i) => (
              <div key={i} style={fileRow}>
                <span style={fileName}>{f.file.name}</span>
                <span style={fileSize}>({(f.file.size / 1024).toFixed(0)} KB)</span>
                <span style={statusBadge(f.status)}>{f.message}</span>
              </div>
            ))}
          </div>
        )}
        <div style={row}>
          <button style={btnPrimary} onClick={handleExcelUnlock} disabled={excelFiles.length === 0 || excelBusy}>
            🔓 解鎖 Excel {excelFiles.filter(f => f.status === "pending" || f.status === "error").length > 0 &&
              `(${excelFiles.filter(f => f.status === "pending" || f.status === "error").length} 個)`}
          </button>
        </div>
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

const fileListBox: React.CSSProperties = {
  border: "1px solid #e3ecf5",
  borderRadius: 8,
  padding: 8,
  marginBottom: 8,
  maxHeight: 200,
  overflow: "auto",
  background: "#fafbfd",
};

const fileRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
  borderBottom: "1px solid #f0f4f8",
  fontSize: 12,
};

const fileName: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#334155",
};

const fileSize: React.CSSProperties = {
  color: "#94a3b8",
  whiteSpace: "nowrap",
  fontSize: 11,
};

const statusBadge = (status: string): React.CSSProperties => ({
  fontSize: 11,
  whiteSpace: "nowrap",
  color: status === "done" ? "#16a34a" : status === "error" ? "#dc2626" : status === "processing" ? "#2563eb" : "#94a3b8",
  fontWeight: status === "processing" ? 600 : 400,
});
