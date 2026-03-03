/**
 * BQOCRPanel — BQ (Bill of Quantities) OCR extraction panel.
 *
 * Features:
 * - Column header buttons (Item, Description, Qty, Unit, Rate, Total)
 * - Zone buttons (DataRange, Collection, PageNo, Revision, BillName)
 * - Page navigation with dropdown and prev/next buttons
 * - Template management (save/load/apply)
 * - OCR result preview for current page
 * - Multiple OCR engine options
 * - Works with PDFViewer for box drawing
 */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import type { PDFFileInfo, Template, BoxInfo, BQRow, BQPageData, BQTemplate } from "../types";
import { listBQEngines, extractBQ, type BQEngineInfo, type BQRowAPI } from "../api/client";
import { PageSelectorModal, type SelectedPage } from "./PageSelectorModal";

// BQ-specific column definitions
const BQ_COLUMNS = [
  { name: "Item", label: "Item", color: "#e74c3c" },
  { name: "Description", label: "Description", color: "#3498db" },
  { name: "Qty", label: "Qty", color: "#2ecc71" },
  { name: "Unit", label: "Unit", color: "#9b59b6" },
  { name: "Rate", label: "Rate", color: "#f39c12" },
  { name: "Total", label: "Total", color: "#1abc9c" },
];

// Zone definitions (required for extraction)
const BQ_ZONES = [
  { name: "DataRange", label: "Data Range", color: "#34495e", required: true, description: "Main table content area (required)" },
  { name: "Collection", label: "Collection", color: "#7f8c8d", required: false, description: "Collection/Summary info" },
  { name: "PageNo", label: "Page No", color: "#95a5a6", required: false, description: "Page number area (e.g., 4.4/4)" },
  { name: "Revision", label: "Revision", color: "#e67e22", required: false, description: "Revision info (e.g., Addendum No. 2)" },
  { name: "BillName", label: "Bill Name", color: "#16a085", required: false, description: "Bill name/number area" },
];

interface BQOCRPanelProps {
  files: PDFFileInfo[];
  templates: Template[];
  bqTemplates: BQTemplate[];
  selectedFileId: string | null;
  selectedPage: number;
  selectedColumn: string | null;
  currentBoxes: Record<string, BoxInfo>;
  bqPageData: Record<string, BQPageData>;  // key: `${fileId}-${pageNum}`
  onSelectPage: (fileId: string, page: number) => void;
  onSelectColumn: (column: string | null) => void;
  onBoxesChange: (boxes: Record<string, BoxInfo>) => void;
  onBQDataChange: (pageKey: string, data: BQPageData) => void;
  onSaveBQTemplate: (name: string, boxes: BoxInfo[]) => void;
  onApplyBQTemplate: (templateId: string) => void;
  onUpdateBQTemplate?: (templateId: string, boxes: BoxInfo[]) => void;
}

export function BQOCRPanel({
  files,
  templates,
  bqTemplates,
  selectedFileId,
  selectedPage,
  selectedColumn,
  currentBoxes,
  bqPageData,
  onSelectPage,
  onSelectColumn,
  onBoxesChange,
  onBQDataChange,
  onSaveBQTemplate,
  onApplyBQTemplate,
  onUpdateBQTemplate,
}: BQOCRPanelProps) {
  // Engine list
  const [engines, setEngines] = useState<BQEngineInfo[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(true);
  const [selectedEngine, setSelectedEngine] = useState("pdfplumber");

  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExtractInfo, setLastExtractInfo] = useState<{ rows: number; engine: string; cost: number } | null>(null);

  // Template state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [newTplName, setNewTplName] = useState("");
  const [showNewTplInput, setShowNewTplInput] = useState(false);
  const [templateBoxesSnapshot, setTemplateBoxesSnapshot] = useState<string>("");  // JSON snapshot of applied template boxes
  const [autoApplyTemplate, setAutoApplyTemplate] = useState<boolean>(true); // Auto-apply selected template on page change

  // Page selector for batch extract
  const [showBatchSelector, setShowBatchSelector] = useState(false);

  // Inline editing state
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Current file/page data
  const file = files.find((f) => f.file_id === selectedFileId);
  const pageKey = selectedFileId ? `${selectedFileId}-${selectedPage}` : "";
  const currentPageBQData = pageKey ? bqPageData[pageKey] : null;

  // Load engines on mount
  useEffect(() => {
    let mounted = true;
    setEnginesLoading(true);
    listBQEngines()
      .then((list) => {
        if (mounted) {
          setEngines(list);
          // Default to first available engine
          const available = list.find(e => e.available);
          if (available) setSelectedEngine(available.id);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || "Failed to load engines");
      })
      .finally(() => {
        if (mounted) setEnginesLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  // Auto-apply template when page changes
  const prevPageRef = React.useRef<string | null>(null);
  useEffect(() => {
    const currentPageKey = selectedFileId ? `${selectedFileId}-${selectedPage}` : null;
    // Only apply if page actually changed and we have a template selected
    if (autoApplyTemplate && selectedTemplateId && currentPageKey && currentPageKey !== prevPageRef.current) {
      // Check if the page already has boxes drawn
      const hasExistingBoxes = Object.keys(currentBoxes).length > 0;
      if (!hasExistingBoxes) {
        // Auto-apply the template to empty pages
        onApplyBQTemplate(selectedTemplateId);
      }
    }
    prevPageRef.current = currentPageKey;
  }, [selectedFileId, selectedPage, autoApplyTemplate, selectedTemplateId, currentBoxes, onApplyBQTemplate]);

  // All pages flattened for navigation
  const allPages = useMemo(() => {
    return files.flatMap((f) =>
      f.pages.map((p) => ({ file_id: f.file_id, page_number: p.page_number, file_name: f.file_name }))
    );
  }, [files]);

  const currentIdx = allPages.findIndex(
    (p) => p.file_id === selectedFileId && p.page_number === selectedPage
  );

  const handlePrev = () => {
    if (currentIdx > 0) {
      const p = allPages[currentIdx - 1];
      onSelectPage(p.file_id, p.page_number);
    }
  };

  const handleNext = () => {
    if (currentIdx < allPages.length - 1) {
      const p = allPages[currentIdx + 1];
      onSelectPage(p.file_id, p.page_number);
    }
  };

  const handlePageDropdown = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    if (!isNaN(idx) && allPages[idx]) {
      onSelectPage(allPages[idx].file_id, allPages[idx].page_number);
    }
  };

  // Handle column/zone selection for box drawing
  const handleSelectColumn = (columnName: string) => {
    if (selectedColumn === columnName) {
      onSelectColumn(null); // Deselect
    } else {
      onSelectColumn(columnName);
    }
  };

  // Check required boxes
  const hasDataRange = !!currentBoxes["DataRange"];
  const boxCount = Object.keys(currentBoxes).length;
  
  // Check column boxes
  const columnBoxNames = ["Item", "Description", "Qty", "Unit", "Rate", "Total"];
  const drawnColumns = columnBoxNames.filter((c) => !!currentBoxes[c]);
  const hasColumnBoxes = drawnColumns.length >= 2; // At least Item + Description or similar

  // Handle inline cell edit start
  const handleCellClick = useCallback((rowId: number, field: string, currentValue: string) => {
    setEditingRowId(rowId);
    setEditingField(field);
    setEditValue(currentValue);
  }, []);

  // Handle inline cell edit save
  const handleCellSave = useCallback(() => {
    if (editingRowId === null || editingField === null || !pageKey || !currentPageBQData) return;
    
    const updatedRows = currentPageBQData.rows.map((row) => {
      if (row.id === editingRowId) {
        const updatedRow = { ...row };
        if (editingField === "description") {
          updatedRow.description = editValue;
        } else if (editingField === "item_no") {
          updatedRow.item_no = editValue;
        } else if (editingField === "unit") {
          updatedRow.unit = editValue;
        } else if (editingField === "quantity") {
          const num = parseFloat(editValue);
          updatedRow.quantity = isNaN(num) ? null : num;
        } else if (editingField === "rate") {
          const num = parseFloat(editValue);
          updatedRow.rate = isNaN(num) ? null : num;
        } else if (editingField === "total") {
          const num = parseFloat(editValue);
          updatedRow.total = isNaN(num) ? null : num;
        }
        return updatedRow;
      }
      return row;
    });
    
    // Update bqPageData via the parent's update function
    const updatedData = { ...currentPageBQData, rows: updatedRows };
    onBQDataChange(pageKey, updatedData);
    
    // Clear editing state
    setEditingRowId(null);
    setEditingField(null);
    setEditValue("");
  }, [editingRowId, editingField, editValue, pageKey, currentPageBQData, onBQDataChange]);

  // Handle inline cell edit cancel
  const handleCellCancel = useCallback(() => {
    setEditingRowId(null);
    setEditingField(null);
    setEditValue("");
  }, []);

  // Handle OCR extraction
  const handleExtract = useCallback(async () => {
    if (!selectedFileId || !hasDataRange) {
      setError("Please draw the Data Range box first");
      return;
    }
    
    if (!hasColumnBoxes) {
      setError("Please draw column header boxes (Item, Description, Qty, Unit etc.) to define column positions");
      return;
    }

    setExtracting(true);
    setError(null);
    setLastExtractInfo(null);

    try {
      const boxes = Object.values(currentBoxes).map((box) => ({
        column_name: box.column_name,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      }));

      const result = await extractBQ({
        file_id: selectedFileId,
        pages: [selectedPage],
        boxes,
        engine: selectedEngine,
      });

      // Convert API rows to BQRow type
      const rows: BQRow[] = result.rows.map((r: BQRowAPI) => ({
        id: r.id,
        file_id: r.file_id,
        page_number: r.page_number,
        page_label: r.page_label,
        revision: r.revision,
        bill_name: r.bill_name,
        collection: r.collection,
        type: r.type as "heading1" | "heading2" | "item",
        item_no: r.item_no,
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        rate: r.rate,
        total: r.total,
        // Bbox for UI highlighting
        bbox_x0: r.bbox_x0,
        bbox_y0: r.bbox_y0,
        bbox_x1: r.bbox_x1,
        bbox_y1: r.bbox_y1,
        page_width: r.page_width,
        page_height: r.page_height,
      }));

      // Update BQ page data
      const newPageData: BQPageData = {
        file_id: selectedFileId,
        page_number: selectedPage,
        boxes: { ...currentBoxes },
        rows,
        applied_template: selectedTemplateId || undefined,
      };
      onBQDataChange(pageKey, newPageData);

      setLastExtractInfo({
        rows: result.rows.length,
        engine: result.engine,
        cost: result.quota_cost,
      });

      if (result.warnings.length > 0) {
        setError(`Warnings: ${result.warnings.join(", ")}`);
      }
      
      // Log debug info if available
      if ((result as any).debug_info) {
        console.log("BQ Extract debug info:", (result as any).debug_info);
      }
    } catch (err: any) {
      setError(err.message || "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [selectedFileId, selectedPage, currentBoxes, selectedEngine, hasDataRange, hasColumnBoxes, pageKey, selectedTemplateId, onBQDataChange]);

  // Show batch page selector
  const handleShowBatchSelector = useCallback(() => {
    if (!hasDataRange) {
      setError("Please draw boxes on this page first, then use batch to apply to selected pages");
      return;
    }
    if (!hasColumnBoxes) {
      setError("Please draw column header boxes (Item, Description, Qty, Unit etc.) before batch processing");
      return;
    }
    setShowBatchSelector(true);
  }, [hasDataRange, hasColumnBoxes]);

  // Handle batch OCR (selected pages)
  const handleBatchExtract = useCallback(async (selectedPages: SelectedPage[]) => {
    if (selectedPages.length === 0) {
      setShowBatchSelector(false);
      return;
    }

    setShowBatchSelector(false);
    setExtracting(true);
    setError(null);
    setLastExtractInfo(null);

    try {
      const boxes = Object.values(currentBoxes).map((box) => ({
        column_name: box.column_name,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      }));

      // Process selected pages
      let totalRows = 0;
      let totalCost = 0;
      let failures = 0;

      for (const sp of selectedPages) {
        try {
          const result = await extractBQ({
            file_id: sp.file_id,
            pages: [sp.page_number],
            boxes,
            engine: selectedEngine,
          });

          const rows: BQRow[] = result.rows.map((r: BQRowAPI) => ({
            id: r.id,
            file_id: r.file_id,
            page_number: r.page_number,
            page_label: r.page_label,
            revision: r.revision,
            bill_name: r.bill_name,
            collection: r.collection,
            type: r.type as "heading1" | "heading2" | "item",
            item_no: r.item_no,
            description: r.description,
            quantity: r.quantity,
            unit: r.unit,
            rate: r.rate,
            total: r.total,
            // Bbox for UI highlighting
            bbox_x0: r.bbox_x0,
            bbox_y0: r.bbox_y0,
            bbox_x1: r.bbox_x1,
            bbox_y1: r.bbox_y1,
            page_width: r.page_width,
            page_height: r.page_height,
          }));

          const key = `${sp.file_id}-${sp.page_number}`;
          const newPageData: BQPageData = {
            file_id: sp.file_id,
            page_number: sp.page_number,
            boxes: { ...currentBoxes },
            rows,
          };
          onBQDataChange(key, newPageData);

          totalRows += result.rows.length;
          totalCost += result.quota_cost;
        } catch (err) {
          // Continue processing other pages
          failures++;
          console.warn(`Failed to process ${sp.file_name} page ${sp.page_number + 1}:`, err);
        }
      }

      const suffix = failures > 0 ? ` (${failures} failed)` : "";
      setLastExtractInfo({
        rows: totalRows,
        engine: selectedEngine,
        cost: totalCost,
      });
      if (failures > 0) {
        setError(`Processed ${selectedPages.length - failures} of ${selectedPages.length} pages${suffix}`);
      }
    } catch (err: any) {
      setError(err.message || "Batch extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [currentBoxes, selectedEngine, onBQDataChange]);

  // Handle template save
  const handleSaveTemplate = () => {
    if (!newTplName.trim()) return;
    const boxes = Object.values(currentBoxes);
    if (boxes.length === 0) {
      setError("Draw some boxes first before saving as template");
      return;
    }
    onSaveBQTemplate(newTplName.trim(), boxes);
    setNewTplName("");
    setShowNewTplInput(false);
  };

  // Handle template apply
  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      onApplyBQTemplate(templateId);
      // Save snapshot of applied boxes for tracking modifications
      const template = bqTemplates.find(t => t.id === templateId);
      if (template && template.boxes) {
        setTemplateBoxesSnapshot(JSON.stringify(template.boxes));
      }
    } else {
      setTemplateBoxesSnapshot("");
    }
  };

  // Check if boxes have been modified since template was applied
  const boxesModified = useMemo(() => {
    if (!selectedTemplateId || !templateBoxesSnapshot) return false;
    const currentBoxesStr = JSON.stringify(Object.values(currentBoxes));
    return currentBoxesStr !== templateBoxesSnapshot;
  }, [selectedTemplateId, templateBoxesSnapshot, currentBoxes]);

  // Handle update template
  const handleUpdateTemplate = () => {
    if (selectedTemplateId && onUpdateBQTemplate) {
      onUpdateBQTemplate(selectedTemplateId, Object.values(currentBoxes));
      // Update snapshot to current boxes
      setTemplateBoxesSnapshot(JSON.stringify(Object.values(currentBoxes)));
    }
  };

  // Clear boxes
  const handleClearBoxes = () => {
    onBoxesChange({});
    setSelectedTemplateId("");
  };

  // Empty state
  if (files.length === 0) {
    return (
      <div style={container}>
        <div style={titleBar}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📋 BQ OCR</span>
        </div>
        <div style={emptyState}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <div>No PDF files loaded</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Import PDF files to extract BQ data</div>
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      {/* Title bar with page navigation */}
      <div style={titleBar}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>📋 BQ OCR</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select style={pageSelect} value={currentIdx} onChange={handlePageDropdown}>
            {allPages.map((p, idx) => (
              <option key={`${p.file_id}-${p.page_number}`} value={idx}>
                {p.file_name} — P{p.page_number + 1}
              </option>
            ))}
          </select>
          <button style={navBtn} onClick={handlePrev} disabled={currentIdx <= 0}>◀ Prev</button>
          <button style={navBtn} onClick={handleNext} disabled={currentIdx >= allPages.length - 1}>Next ▶</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Column header buttons */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Column Headers</div>
          <div style={sectionDesc}>Click a column, then draw a box on the PDF to define the column area</div>
          <div style={buttonGrid}>
            {BQ_COLUMNS.map((col) => {
              const hasBox = !!currentBoxes[col.name];
              const isSelected = selectedColumn === col.name;
              return (
                <button
                  key={col.name}
                  style={{
                    ...columnBtn,
                    background: isSelected ? col.color : hasBox ? `${col.color}33` : "#f5f5f5",
                    color: isSelected ? "#fff" : hasBox ? col.color : "#666",
                    borderColor: col.color,
                  }}
                  onClick={() => handleSelectColumn(col.name)}
                  title={hasBox ? `${col.label} (box defined)` : `Click to draw ${col.label} box`}
                >
                  {col.label}
                  {hasBox && <span style={checkMark}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Zone buttons */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Zones</div>
          <div style={sectionDesc}>Define the main data area and optional zones</div>
          <div style={buttonGrid}>
            {BQ_ZONES.map((zone) => {
              const hasBox = !!currentBoxes[zone.name];
              const isSelected = selectedColumn === zone.name;
              return (
                <button
                  key={zone.name}
                  style={{
                    ...zoneBtn,
                    background: isSelected ? zone.color : hasBox ? `${zone.color}33` : "#f5f5f5",
                    color: isSelected ? "#fff" : hasBox ? zone.color : "#666",
                    borderColor: zone.color,
                    border: zone.required ? `2px solid ${zone.color}` : `1px solid ${zone.color}`,
                  }}
                  onClick={() => handleSelectColumn(zone.name)}
                  title={zone.description}
                >
                  {zone.label}
                  {zone.required && !hasBox && <span style={{ color: "#e74c3c", marginLeft: 2 }}>*</span>}
                  {hasBox && <span style={checkMark}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Current boxes summary */}
        <div style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={sectionTitle}>Current Page Boxes ({boxCount})</div>
            {boxCount > 0 && (
              <button style={clearBtn} onClick={handleClearBoxes}>Clear All</button>
            )}
          </div>
          <div style={boxSummary}>
            {boxCount === 0 ? (
              <span style={{ color: "#999" }}>No boxes drawn. Select a column above and draw on the PDF.</span>
            ) : (
              Object.entries(currentBoxes).map(([name]) => {
                const col = [...BQ_COLUMNS, ...BQ_ZONES].find((c) => c.name === name);
                return (
                  <span
                    key={name}
                    style={{
                      ...boxTag,
                      background: col?.color || "#888",
                    }}
                  >
                    {name}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {/* Template management */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Templates</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              style={templateSelect}
              value={selectedTemplateId}
              onChange={(e) => handleApplyTemplate(e.target.value)}
            >
              <option value="">-- Select template --</option>
              {bqTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoApplyTemplate}
                onChange={(e) => setAutoApplyTemplate(e.target.checked)}
              />
              Auto-apply on page change
            </label>
            {showNewTplInput ? (
              <>
                <input
                  type="text"
                  style={templateInput}
                  placeholder="Template name"
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveTemplate()}
                />
                <button style={saveBtn} onClick={handleSaveTemplate} disabled={!newTplName.trim()}>Save</button>
                <button style={cancelBtn} onClick={() => { setShowNewTplInput(false); setNewTplName(""); }}>Cancel</button>
              </>
            ) : (
              <>
                <button
                  style={newTplBtn}
                  onClick={() => setShowNewTplInput(true)}
                  disabled={boxCount === 0}
                  title={boxCount === 0 ? "Draw boxes first" : "Save current boxes as template"}
                >
                  + Save as Template
                </button>
                {selectedTemplateId && onUpdateBQTemplate && (
                  <button
                    style={{
                      ...saveBtn,
                      opacity: boxesModified ? 1 : 0.5,
                      cursor: boxesModified ? "pointer" : "not-allowed",
                    }}
                    onClick={handleUpdateTemplate}
                    disabled={!boxesModified}
                    title={boxesModified ? "Update template with current boxes" : "No changes to save"}
                  >
                    Update Template
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Error/Success display */}
        {error && (
          <div style={errorStyle}>
            ⚠️ {error}
            <button style={dismissBtn} onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {lastExtractInfo && (
          <div style={successStyle}>
            ✅ Extracted {lastExtractInfo.rows} rows using {lastExtractInfo.engine} (-{lastExtractInfo.cost} pt)
          </div>
        )}

        {/* OCR Results Preview */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Extraction Results</div>
          {currentPageBQData && currentPageBQData.rows.length > 0 ? (
            <div style={resultsContainer}>
              <div style={resultsHeader}>
                <span>Found {currentPageBQData.rows.length} rows</span>
              </div>
              <div style={resultsTable}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f5" }}>
                      <th style={thStyle}>ID</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Item</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Qty</th>
                      <th style={thStyle}>Unit</th>
                      <th style={thStyle}>Rate</th>
                      <th style={thStyle}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageBQData.rows.map((row) => (
                      <tr key={row.id} style={row.type !== "item" ? { background: "#fafafa", fontWeight: 500 } : {}}>
                        <td style={tdStyle}>{row.id}</td>
                        <td style={tdStyle}>
                          <span style={{
                            ...typeTag,
                            background: row.type === "heading1" ? "#e74c3c" : row.type === "heading2" ? "#f39c12" : "#2ecc71"
                          }}>
                            {row.type}
                          </span>
                        </td>
                        <td style={tdStyle}>{row.item_no}</td>
                        <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={row.description}>
                          {row.description}
                        </td>
                        <td style={tdStyle}>{row.quantity ?? ""}</td>
                        <td style={tdStyle}>{row.unit}</td>
                        <td style={tdStyle}>{row.rate ?? ""}</td>
                        <td style={tdStyle}>{row.total ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Zone info */}
              {(currentPageBQData.rows[0]?.page_label || currentPageBQData.rows[0]?.revision) && (
                <div style={zoneInfoBox}>
                  {currentPageBQData.rows[0]?.page_label && (
                    <span style={zoneInfoItem}>📄 Page: {currentPageBQData.rows[0].page_label}</span>
                  )}
                  {currentPageBQData.rows[0]?.revision && (
                    <span style={zoneInfoItem}>🔄 Revision: {currentPageBQData.rows[0].revision}</span>
                  )}
                  {currentPageBQData.rows[0]?.bill_name && (
                    <span style={zoneInfoItem}>📋 Bill: {currentPageBQData.rows[0].bill_name}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>
              No data extracted for this page yet. Draw boxes and click "Extract" below.
            </div>
          )}
        </div>
      </div>

      {/* Engine selection and Extract buttons - fixed at bottom */}
      <div style={engineSection}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={sectionTitle}>OCR Engine</div>
          <select
            style={engineSelect}
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value)}
            disabled={extracting}
          >
            {engines.filter(e => e.available).map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name} ({eng.quota_cost} pt/page)
              </option>
            ))}
          </select>
        </div>
        <div style={engineBtnGrid}>
          <button
            style={{
              ...extractBtn,
              opacity: !hasDataRange ? 0.5 : 1,
              cursor: !hasDataRange ? "not-allowed" : "pointer",
            }}
            disabled={!hasDataRange || extracting}
            onClick={handleExtract}
          >
            {extracting ? "⏳ Extracting..." : "🔍 Extract This Page"}
          </button>
          <button
            style={{
              ...batchExtractBtn,
              opacity: !hasDataRange ? 0.5 : 1,
              cursor: !hasDataRange ? "not-allowed" : "pointer",
            }}
            disabled={!hasDataRange || extracting}
            onClick={handleShowBatchSelector}
            title="Select pages and apply current boxes to extract"
          >
            {extracting ? "⏳ Processing..." : `📚 Batch Extract...`}
          </button>
        </div>
        {!hasDataRange && (
          <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 4 }}>
            ⚠️ Draw the Data Range box first to enable extraction
          </div>
        )}
      </div>

      {/* Batch Page Selector Modal */}
      {showBatchSelector && (
        <PageSelectorModal
          files={files}
          title="Batch Extract — Select Pages"
          confirmLabel="Extract Selected Pages"
          onConfirm={handleBatchExtract}
          onCancel={() => setShowBatchSelector(false)}
        />
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#fff",
  overflow: "hidden",
};

const titleBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 12px",
  background: "#f0f0f0",
  borderBottom: "1px solid #e0e0e0",
  flexWrap: "wrap",
  gap: 8,
};

const pageSelect: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid #ddd",
  borderRadius: 4,
  maxWidth: 200,
};

const navBtn: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#fff",
  cursor: "pointer",
};

const emptyState: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#aaa",
  fontSize: 14,
};

const sectionStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  marginBottom: 4,
  color: "#333",
};

const sectionDesc: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  marginBottom: 8,
};

const buttonGrid: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const columnBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 600,
  border: "2px solid",
  borderRadius: 4,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
  transition: "all 0.15s ease",
};

const zoneBtn: React.CSSProperties = {
  ...columnBtn,
  padding: "8px 14px",
  minWidth: 80,
};

const checkMark: React.CSSProperties = {
  fontSize: 10,
  marginLeft: 2,
};

const boxSummary: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  fontSize: 11,
  marginTop: 4,
};

const boxTag: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 3,
  color: "#fff",
  fontSize: 10,
  fontWeight: 600,
};

const clearBtn: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 10,
  border: "1px solid #ddd",
  borderRadius: 3,
  background: "#fff",
  cursor: "pointer",
  color: "#e74c3c",
};

const templateSelect: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
  minWidth: 150,
};

const templateInput: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
  width: 120,
};

const newTplBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  border: "1px solid #3498db",
  borderRadius: 4,
  background: "#fff",
  color: "#3498db",
  cursor: "pointer",
};

const saveBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  border: "none",
  borderRadius: 4,
  background: "#2ecc71",
  color: "#fff",
  cursor: "pointer",
};

const cancelBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#fff",
  color: "#666",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  margin: "8px 12px",
  padding: "8px 10px",
  background: "#fff3cd",
  border: "1px solid #ffeeba",
  borderRadius: 4,
  fontSize: 12,
  color: "#856404",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const dismissBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  color: "#856404",
};

const successStyle: React.CSSProperties = {
  margin: "8px 12px",
  padding: "8px 10px",
  background: "#d4edda",
  border: "1px solid #c3e6cb",
  borderRadius: 4,
  fontSize: 12,
  color: "#155724",
};

const resultsContainer: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 4,
  overflow: "hidden",
};

const resultsHeader: React.CSSProperties = {
  padding: "6px 10px",
  background: "#f5f5f5",
  fontSize: 11,
  fontWeight: 600,
  borderBottom: "1px solid #eee",
};

const resultsTable: React.CSSProperties = {
  maxHeight: 200,
  overflowY: "auto",
};

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const typeTag: React.CSSProperties = {
  padding: "1px 6px",
  borderRadius: 3,
  color: "#fff",
  fontSize: 9,
  fontWeight: 600,
};

const zoneInfoBox: React.CSSProperties = {
  padding: "8px 10px",
  background: "#f9f9f9",
  borderTop: "1px solid #eee",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  fontSize: 11,
};

const zoneInfoItem: React.CSSProperties = {
  color: "#555",
};

const engineSection: React.CSSProperties = {
  borderTop: "1px solid #e0e0e0",
  padding: 12,
  background: "#fafafa",
};

const engineSelect: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
};

const engineBtnGrid: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const extractBtn: React.CSSProperties = {
  flex: 1,
  padding: "10px 16px",
  fontSize: 12,
  fontWeight: 600,
  border: "none",
  borderRadius: 6,
  background: "#3498db",
  color: "#fff",
  cursor: "pointer",
};

const batchExtractBtn: React.CSSProperties = {
  flex: 1,
  padding: "10px 16px",
  fontSize: 12,
  fontWeight: 600,
  border: "none",
  borderRadius: 6,
  background: "#9b59b6",
  color: "#fff",
  cursor: "pointer",
};
