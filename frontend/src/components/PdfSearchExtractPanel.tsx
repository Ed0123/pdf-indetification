/**
 * PdfSearchExtractPanel — Client-side PDF keyword search, highlight & extract.
 *
 * 100% local processing using pdf.js for text extraction and pdf-lib for output.
 *
 * User workflow:
 * 1. Upload a PDF
 * 2. Add keyword rules (keyword, exclude list, highlight color)
 * 3. Optional: set global whitelist / blacklist
 * 4. Trial Run to preview which pages match
 * 5. Download combined PDF with highlighted keywords
 */
import React, { useState, useRef, useCallback } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import { ModuleInstructionPanel } from "./ModuleInstructionPanel";

// ---------------------------------------------------------------------------
// pdf.js setup — dynamic import to handle worker
// ---------------------------------------------------------------------------
let pdfjsLib: any = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  pdfjsLib = pdfjs;
  return pdfjs;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeywordRule {
  id: number;
  selected: boolean;
  keywords: string;      // comma-separated
  exclude: string;       // comma-separated blacklist for this rule
  color: string;         // highlight color (hex), empty = transparent/no highlight
  opacity: number;       // 0-1
}

interface PageResult {
  pageNum: number;
  included: boolean;
  matchedKeywords: string[];
  excludedBy: string[];
  textSnippet: string;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PdfSearchExtractPanelProps {
  isAdmin: boolean;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

let nextId = 1;

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

function parseList(s: string): string[] {
  return s.split(",").map(k => k.trim()).filter(Boolean);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

export function PdfSearchExtractPanel({ isAdmin, onBusyChange }: PdfSearchExtractPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<KeywordRule[]>([
    { id: nextId++, selected: true, keywords: "", exclude: "", color: "#FFFF00", opacity: 0.4 },
  ]);
  const [globalWhitelist, setGlobalWhitelist] = useState("");
  const [globalWhiteColor, setGlobalWhiteColor] = useState("#FFFF00");
  const [globalBlacklist, setGlobalBlacklist] = useState("");
  const [results, setResults] = useState<PageResult[]>([]);
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addRule = () => {
    setRules(prev => [...prev, { id: nextId++, selected: true, keywords: "", exclude: "", color: "#00FF00", opacity: 0.4 }]);
  };

  const removeRule = (id: number) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const updateRule = (id: number, field: keyof KeywordRule, value: any) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // --------------------------------------------------------------------------
  // Core: extract text from all pages
  // --------------------------------------------------------------------------
  const extractAllText = useCallback(async (fileData: ArrayBuffer) => {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fileData) }).promise;
    const pages: { pageNum: number; text: string; items: TextItem[] }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: TextItem[] = content.items
        .filter((it: any) => it.str)
        .map((it: any) => ({
          str: it.str,
          transform: it.transform,
          width: it.width,
          height: it.height || (it.transform ? Math.abs(it.transform[3]) : 12),
        }));
      const fullText = items.map(it => it.str).join(" ");
      pages.push({ pageNum: i, text: fullText, items });
    }
    return { pages, numPages: doc.numPages };
  }, []);

  // --------------------------------------------------------------------------
  // Trial Run — determine which pages match
  // --------------------------------------------------------------------------
  const handleTrialRun = useCallback(async () => {
    if (!file) return;
    setRunning(true);
    onBusyChange?.(true, "正在分析 PDF 頁面...");
    setStatusMsg("正在讀取 PDF...");
    try {
      const data = await file.arrayBuffer();
      const { pages } = await extractAllText(data);

      const gwl = parseList(globalWhitelist);
      const gbl = parseList(globalBlacklist);
      const activeRules = rules.filter(r => r.selected && r.keywords.trim());

      const pageResults: PageResult[] = pages.map(p => {
        const textLower = p.text.toLowerCase();
        let included = true;
        const matchedKeywords: string[] = [];
        const excludedBy: string[] = [];

        // Step 1: Global whitelist — page must contain ALL global whitelist keywords
        if (gwl.length > 0) {
          for (const kw of gwl) {
            if (textLower.includes(kw.toLowerCase())) {
              matchedKeywords.push(kw);
            } else {
              included = false;
            }
          }
        }

        // Step 2: Global blacklist — if page has ANY blacklist keyword, skip it
        if (included && gbl.length > 0) {
          for (const bl of gbl) {
            if (textLower.includes(bl.toLowerCase())) {
              included = false;
              excludedBy.push(`全域黑名單: ${bl}`);
            }
          }
        }

        // Step 3: Per-rule keywords & excludes
        if (included && activeRules.length > 0) {
          let anyRuleMatched = false;
          for (const rule of activeRules) {
            const kws = parseList(rule.keywords);
            const excl = parseList(rule.exclude);
            let ruleMatched = false;
            for (const kw of kws) {
              if (textLower.includes(kw.toLowerCase())) {
                ruleMatched = true;
                matchedKeywords.push(kw);
              }
            }
            // Check exclude for this rule
            if (ruleMatched) {
              for (const ex of excl) {
                if (textLower.includes(ex.toLowerCase())) {
                  ruleMatched = false;
                  excludedBy.push(`規則排除: ${ex}`);
                }
              }
            }
            if (ruleMatched) anyRuleMatched = true;
          }
          // If we have rules defined, at least one rule must match for inclusion
          if (!anyRuleMatched && activeRules.length > 0) {
            included = false;
          }
        } else if (included && activeRules.length === 0 && gwl.length === 0) {
          // No rules and no whitelist = include all
          included = true;
        }

        return {
          pageNum: p.pageNum,
          included,
          matchedKeywords: [...new Set(matchedKeywords)],
          excludedBy,
          textSnippet: p.text.substring(0, 120),
        };
      });

      setResults(pageResults);
      const includedCount = pageResults.filter(r => r.included).length;
      setStatusMsg(`分析完成：${includedCount} / ${pageResults.length} 頁符合條件`);
    } catch (err: any) {
      setStatusMsg(`❌ 分析失敗：${err.message || err}`);
    } finally {
      setRunning(false);
      onBusyChange?.(false);
    }
  }, [file, rules, globalWhitelist, globalBlacklist, extractAllText, onBusyChange]);

  // --------------------------------------------------------------------------
  // Download — extract matching pages with highlights
  // --------------------------------------------------------------------------
  const handleDownload = useCallback(async () => {
    if (!file || results.length === 0) return;
    const includedPages = results.filter(r => r.included);
    if (includedPages.length === 0) {
      setStatusMsg("沒有符合條件的頁面可匯出");
      return;
    }

    onBusyChange?.(true, `正在匯出 ${includedPages.length} 頁 PDF...`);
    setStatusMsg("正在生成 PDF...");

    try {
      const data = await file.arrayBuffer();
      const sourcePdf = await PDFDocument.load(data, { ignoreEncryption: true });
      const outputPdf = await PDFDocument.create();

      // Also extract text items for highlighting
      const { pages: textPages } = await extractAllText(data);

      // Build sets of keywords and their colors for highlighting
      const gwl = parseList(globalWhitelist);
      const activeRules = rules.filter(r => r.selected && r.keywords.trim());

      for (const pr of includedPages) {
        const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pr.pageNum - 1]);
        outputPdf.addPage(copiedPage);

        // Draw highlights
        const tp = textPages.find(p => p.pageNum === pr.pageNum);
        if (!tp) continue;

        const pageObj = outputPdf.getPages()[outputPdf.getPageCount() - 1];
        const { height: pageHeight } = pageObj.getSize();

        // Collect all keyword→color mappings
        const highlights: { keyword: string; color: string; opacity: number }[] = [];
        for (const kw of gwl) {
          highlights.push({ keyword: kw, color: globalWhiteColor, opacity: 0.4 });
        }
        for (const rule of activeRules) {
          const kws = parseList(rule.keywords);
          const excl = parseList(rule.exclude);
          for (const kw of kws) {
            // Skip excluded ones
            const isExcluded = excl.some(ex => kw.toLowerCase().includes(ex.toLowerCase()));
            if (!isExcluded && rule.color) {
              highlights.push({ keyword: kw, color: rule.color, opacity: rule.opacity });
            }
          }
        }

        // Draw rectangle highlights on matching text items
        for (const item of tp.items) {
          const textLower = item.str.toLowerCase();
          for (const hl of highlights) {
            if (textLower.includes(hl.keyword.toLowerCase()) && hl.color) {
              const { r, g, b } = hexToRgb(hl.color);
              const x = item.transform[4];
              const y = item.transform[5];
              const w = item.width;
              const h = item.height;
              pageObj.drawRectangle({
                x,
                y: y - 1,
                width: w,
                height: h + 2,
                color: rgb(r, g, b),
                opacity: hl.opacity,
              });
            }
          }
        }
      }

      const pdfBytes = await outputPdf.save();
      downloadBlob(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), `search-result-${file.name}`);
      setStatusMsg(`✅ 已匯出 ${includedPages.length} 頁`);
    } catch (err: any) {
      setStatusMsg(`❌ 匯出失敗：${err.message || err}`);
    } finally {
      onBusyChange?.(false);
    }
  }, [file, results, rules, globalWhitelist, globalWhiteColor, extractAllText, onBusyChange]);

  return (
    <div style={container}>
      <h3 style={headingStyle}>🔍 PDF 搜尋 & 擷取</h3>
      <ModuleInstructionPanel moduleId="pdf_search" isAdmin={isAdmin} />

      <p style={subtitleStyle}>
        100% 本機處理。搜尋關鍵字、標記顏色、匯出符合條件的頁面。
      </p>

      {/* Top action row */}
      <div style={topRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { setFile(f); setResults([]); setStatusMsg(""); }
          }}
        />
        <button style={btnStyle} onClick={() => fileInputRef.current?.click()}>
          📂 上傳 PDF
        </button>
        {file && <span style={fileLabelStyle}>{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>}
        <button style={btnStyle} onClick={handleTrialRun} disabled={!file || running}>
          ▶ Trial Run
        </button>
        <button style={btnStyle} onClick={addRule}>
          ＋ 新增規則
        </button>
      </div>

      {/* Global whitelist / blacklist */}
      <div style={globalSection}>
        <div style={globalRow}>
          <label style={labelStyle}>全域白名單：</label>
          <input
            style={inputStyle}
            value={globalWhitelist}
            onChange={(e) => setGlobalWhitelist(e.target.value)}
            placeholder="頁面必須包含的關鍵字（逗號分隔）"
          />
          <label style={{ ...labelStyle, marginLeft: 8 }}>顏色：</label>
          <input
            type="color"
            value={globalWhiteColor}
            onChange={(e) => setGlobalWhiteColor(e.target.value)}
            style={{ width: 30, height: 26, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
          />
        </div>
        <div style={globalRow}>
          <label style={labelStyle}>全域黑名單：</label>
          <input
            style={inputStyle}
            value={globalBlacklist}
            onChange={(e) => setGlobalBlacklist(e.target.value)}
            placeholder="頁面不可包含的關鍵字（逗號分隔）"
          />
        </div>
      </div>

      {/* Keyword rules table */}
      <div style={rulesContainer}>
        {rules.map((rule) => (
          <div key={rule.id} style={ruleRow}>
            <input
              type="checkbox"
              checked={rule.selected}
              onChange={(e) => updateRule(rule.id, "selected", e.target.checked)}
              title="啟用此規則"
            />
            <div style={fieldGroup}>
              <label style={smallLabel}>Keywords:</label>
              <input
                style={ruleInput}
                value={rule.keywords}
                onChange={(e) => updateRule(rule.id, "keywords", e.target.value)}
                placeholder="關鍵字（逗號分隔）"
              />
            </div>
            <div style={fieldGroup}>
              <label style={smallLabel}>Exclude:</label>
              <input
                style={ruleInput}
                value={rule.exclude}
                onChange={(e) => updateRule(rule.id, "exclude", e.target.value)}
                placeholder="排除名單（逗號分隔）"
              />
            </div>
            <div style={fieldGroup}>
              <label style={smallLabel}>Color:</label>
              <input
                type="color"
                value={rule.color || "#FFFF00"}
                onChange={(e) => updateRule(rule.id, "color", e.target.value)}
                style={{ width: 30, height: 26, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                type="range"
                min="0" max="1" step="0.1"
                value={rule.opacity}
                onChange={(e) => updateRule(rule.id, "opacity", parseFloat(e.target.value))}
                style={{ width: 60 }}
                title={`透明度: ${Math.round(rule.opacity * 100)}%`}
              />
            </div>
            <button
              style={deleteBtnStyle}
              onClick={() => removeRule(rule.id)}
              title="刪除此規則"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Results preview */}
      {results.length > 0 && (
        <div style={resultsSection}>
          <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
            頁面結果預覽 ({results.filter(r => r.included).length} / {results.length} 頁符合)
          </h4>
          <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid #e3ecf5", borderRadius: 8, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fbff" }}>
                  <th style={th}>頁碼</th>
                  <th style={th}>狀態</th>
                  <th style={th}>命中關鍵字</th>
                  <th style={th}>排除原因</th>
                  <th style={th}>文字預覽</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.pageNum} style={{ background: r.included ? "#eaffea" : "#fff5f5" }}>
                    <td style={td}>{r.pageNum}</td>
                    <td style={td}>{r.included ? "✅ 包含" : "❌ 排除"}</td>
                    <td style={td}>{r.matchedKeywords.join(", ") || "-"}</td>
                    <td style={td}>{r.excludedBy.join("; ") || "-"}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.textSnippet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div style={bottomBar}>
        {statusMsg && <span style={{ fontSize: 13, color: "#334155" }}>{statusMsg}</span>}
        <div style={{ flex: 1 }} />
        <button style={btnStyle} onClick={handleTrialRun} disabled={!file || running}>
          ▶ Trial Run
        </button>
        <button
          style={btnPrimaryStyle}
          onClick={handleDownload}
          disabled={!file || results.filter(r => r.included).length === 0}
        >
          ⬇ Download
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const container: React.CSSProperties = {
  padding: 20,
  height: "100%",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  background: "linear-gradient(135deg, #f2f2f5 0%, #ffffff 100%)",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
};

const headingStyle: React.CSSProperties = {
  margin: 0, fontSize: 20, fontWeight: 700, color: "#223648",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0, fontSize: 13, color: "#6c7788",
};

const topRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
};

const globalSection: React.CSSProperties = {
  background: "#fff", border: "1px solid #dbe5f0", borderRadius: 10,
  padding: 12, display: "grid", gap: 8,
};

const globalRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#334155", whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 180, border: "1px solid #cfd8e6", borderRadius: 6,
  padding: "5px 8px", fontSize: 13,
};

const rulesContainer: React.CSSProperties = {
  display: "grid", gap: 6,
};

const ruleRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
  background: "#fff", border: "1px solid #dbe5f0", borderRadius: 8,
  padding: "8px 10px",
};

const fieldGroup: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 120,
};

const smallLabel: React.CSSProperties = {
  fontSize: 11, color: "#666", whiteSpace: "nowrap",
};

const ruleInput: React.CSSProperties = {
  flex: 1, minWidth: 80, border: "1px solid #cfd8e6", borderRadius: 4,
  padding: "4px 6px", fontSize: 12,
};

const resultsSection: React.CSSProperties = {
  marginTop: 4,
};

const th: React.CSSProperties = {
  padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #e3ecf5",
  fontWeight: 600, fontSize: 11, color: "#5d6a7e",
};

const td: React.CSSProperties = {
  padding: "5px 8px", borderBottom: "1px solid #f0f4f8",
};

const bottomBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, marginTop: "auto",
  padding: "12px 0 0", borderTop: "1px solid #e3ecf5",
};

const btnStyle: React.CSSProperties = {
  border: "1px solid #cfd8e6", borderRadius: 6,
  padding: "6px 12px", background: "#fff",
  cursor: "pointer", fontSize: 13,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  border: "1px solid #2f7de1", background: "#2f7de1", color: "#fff",
};

const deleteBtnStyle: React.CSSProperties = {
  border: "none", background: "none", cursor: "pointer",
  color: "#c0392b", fontSize: 16, padding: "2px 6px",
};

const fileLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "#5d6a7e",
};
