/**
 * BQExportPanel — Summary view and export panel for BQ data.
 *
 * Shows all extracted BQ rows from all pages with:
 * - Filtering by type (heading1, heading2, item, notes)
 * - Inline editing
 * - Export to Excel (.xlsx)
 * - Export to JSON
 * - Export to PDF (with/without annotations)
 * - Summary statistics
 */
import React, { useState, useMemo } from "react";
import type { BQRow, BQPageData } from "../types";
import { exportAnnotatedPdf, type TextAnnotation } from "../api/client";

interface BQExportPanelProps {
  bqPageData: Record<string, BQPageData>;  // key: `${fileId}-${pageNum}`
  onRowEdit: (pageKey: string, rowId: number, field: keyof BQRow, value: any) => void;
  onDeleteRow: (pageKey: string, rowId: number) => void;
  /** Called when user clicks to edit a row - navigate to PDF page and highlight */
  onNavigateToRow?: (
    fileId: string, 
    pageNum: number, 
    bbox: { x0: number; y0: number; x1: number; y1: number } | null,
    pageSize?: { width: number; height: number } | null
  ) => void;
}

export function BQExportPanel({
  bqPageData,
  onRowEdit,
  onDeleteRow,
  onNavigateToRow,
}: BQExportPanelProps) {
  const [filterType, setFilterType] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ pageKey: string; rowId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [projectId, setProjectId] = useState("");
  
  // Export filter state
  const [exportFilterPage, setExportFilterPage] = useState<string>("all");
  const [exportFilterRev, setExportFilterRev] = useState<string>("all");
  const [exportFilterType, setExportFilterType] = useState<string>("all");

  // Flatten all rows from all pages
  const allRows = useMemo(() => {
    const rows: Array<{ pageKey: string; row: BQRow }> = [];
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      for (const row of pageData.rows) {
        rows.push({ pageKey, row });
      }
    }
    return rows;
  }, [bqPageData]);

  // Apply filter
  const filteredRows = useMemo(() => {
    if (filterType === "all") return allRows;
    return allRows.filter(({ row }) => row.type === filterType);
  }, [allRows, filterType]);

  // Statistics
  const stats = useMemo(() => {
    const heading1Count = allRows.filter(r => r.row.type === "heading1").length;
    const heading2Count = allRows.filter(r => r.row.type === "heading2").length;
    const itemCount = allRows.filter(r => r.row.type === "item").length;
    const notesCount = allRows.filter(r => r.row.type === "notes").length;
    const pagesWithData = new Set(allRows.map(r => r.pageKey)).size;
    return { heading1Count, heading2Count, itemCount, notesCount, total: allRows.length, pagesWithData };
  }, [allRows]);

  // Calculate page totals (sum of all item totals per page)
  const pageTotals = useMemo(() => {
    const totals: Record<string, { 
      pageKey: string;
      pageLabel: string;
      pageNumber: number;
      fileId: string;
      total: number;
      itemCount: number;
      collectionBox?: { x0: number; y0: number; x1: number; y1: number };
      pageWidth?: number;
      pageHeight?: number;
    }> = {};
    
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      let pageTotal = 0;
      let itemCount = 0;
      let pageLabel = "";
      
      for (const row of pageData.rows) {
        if (row.type === "item" && row.total !== null) {
          pageTotal += row.total;
          itemCount++;
        }
        if (!pageLabel && row.page_label) {
          pageLabel = row.page_label;
        }
      }
      
      // Get collection box coordinates if available
      const collectionBox = pageData.boxes["Collection"];
      const firstRow = pageData.rows[0];
      
      totals[pageKey] = {
        pageKey,
        pageLabel,
        pageNumber: pageData.page_number,
        fileId: pageData.file_id,
        total: pageTotal,
        itemCount,
        collectionBox: collectionBox ? {
          x0: collectionBox.x * (firstRow?.page_width ?? 1),
          y0: collectionBox.y * (firstRow?.page_height ?? 1),
          x1: (collectionBox.x + collectionBox.width) * (firstRow?.page_width ?? 1),
          y1: (collectionBox.y + collectionBox.height) * (firstRow?.page_height ?? 1),
        } : undefined,
        pageWidth: firstRow?.page_width,
        pageHeight: firstRow?.page_height,
      };
    }
    
    return totals;
  }, [bqPageData]);

  // Grand total across all pages
  const grandTotal = useMemo(() => {
    return Object.values(pageTotals).reduce((sum, pt) => sum + pt.total, 0);
  }, [pageTotals]);

  // Unique pages and revisions for export filters
  const uniquePages = useMemo(() => {
    const pages = new Set<string>();
    allRows.forEach(({ row }) => {
      if (row.page_label) pages.add(row.page_label);
    });
    return Array.from(pages).sort();
  }, [allRows]);

  const uniqueRevisions = useMemo(() => {
    const revs = new Set<string>();
    allRows.forEach(({ row }) => {
      if (row.revision) revs.add(row.revision);
    });
    return Array.from(revs).sort();
  }, [allRows]);

  // Parse bill/page from page_label (format: AA/BB where AA=bill, BB=page)
  const parseBillPage = (pageLabel: string) => {
    const match = pageLabel.match(/^([^/]+)\/(.+)$/);
    if (match) {
      return { bill: match[1], page: match[2] };
    }
    return { bill: "", page: pageLabel };
  };

  // Build ref from bill/page/item
  const buildRef = (row: BQRow) => {
    const { bill, page } = parseBillPage(row.page_label || "");
    if (bill && page && row.item_no) {
      return `${bill}/${page}/${row.item_no}`;
    }
    return "";
  };

  // Handle cell edit - also navigate to PDF and highlight
  const handleStartEdit = (pageKey: string, rowId: number, field: string, currentValue: any, row: BQRow) => {
    setEditingCell({ pageKey, rowId, field });
    setEditValue(String(currentValue ?? ""));
    
    // Navigate to PDF page and highlight the row
    if (onNavigateToRow && row.file_id) {
      const bbox = (row.bbox_x0 !== undefined && row.bbox_y0 !== undefined && 
                    row.bbox_x1 !== undefined && row.bbox_y1 !== undefined)
        ? { x0: row.bbox_x0, y0: row.bbox_y0, x1: row.bbox_x1, y1: row.bbox_y1 }
        : null;
      const pageSize = (row.page_width && row.page_height)
        ? { width: row.page_width, height: row.page_height }
        : null;
      onNavigateToRow(row.file_id, row.page_number, bbox, pageSize);
    }
  };

  const handleSaveEdit = () => {
    if (!editingCell) return;
    const { pageKey, rowId, field } = editingCell;
    let value: any = editValue;
    
    // Convert numbers
    if (["quantity", "rate", "total"].includes(field)) {
      value = editValue ? parseFloat(editValue) : null;
    }
    
    // Find the current row to get existing values for auto-calculation
    const currentRowEntry = allRows.find(r => r.pageKey === pageKey && r.row.id === rowId);
    const currentRow = currentRowEntry?.row;
    
    // Mark the field as user edited
    if (currentRow && ["quantity", "rate", "total"].includes(field)) {
      const userEdited = currentRow.user_edited || {};
      onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, { ...userEdited, [field]: true });
    }
    
    // Save the edited value
    onRowEdit(pageKey, rowId, field as keyof BQRow, value);
    
    // Auto-calculate total when rate or quantity changes
    if (currentRow && (field === "rate" || field === "quantity")) {
      const newQty = field === "quantity" ? value : currentRow.quantity;
      const newRate = field === "rate" ? value : currentRow.rate;
      
      if (newQty !== null && newRate !== null) {
        const calculatedTotal = newQty * newRate;
        onRowEdit(pageKey, rowId, "total", calculatedTotal);
        // Mark total as auto-calculated (not directly edited by user)
        const userEdited = currentRow.user_edited || {};
        if (!userEdited.total) {
          // Only auto-update if user hasn't manually edited total
        }
      }
    }
    
    setEditingCell(null);
    setEditValue("");
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  // Get filtered rows for export
  const getFilteredExportRows = () => {
    return allRows.filter(({ row }) => {
      if (exportFilterPage !== "all" && row.page_label !== exportFilterPage) return false;
      if (exportFilterRev !== "all" && row.revision !== exportFilterRev) return false;
      if (exportFilterType !== "all" && row.type !== exportFilterType) return false;
      return true;
    });
  };

  // Build export data in JSON format
  const buildExportData = (pid: string) => {
    const rowsToExport = getFilteredExportRows();
    return rowsToExport.map(({ row }, idx) => {
      const { bill, page } = parseBillPage(row.page_label || "");
      const ref = buildRef(row);
      const isItem = row.type === "item";
      
      return {
        id: idx + 1,
        project_id: pid,
        Type: row.type === "item" ? "Item" : row.type === "notes" ? "Notes" : row.type,
        bill,
        page,
        item: row.item_no,
        revision: row.revision,
        ref,
        data_detail: row.description,
        // Bounding box coordinates for data detail (PDF absolute coordinates)
        data_X1: row.bbox_x0?.toString() ?? "",
        data_X2: row.bbox_x1?.toString() ?? "",
        data_Y1: row.bbox_y0?.toString() ?? "",
        data_Y2: row.bbox_y1?.toString() ?? "",
        // Page dimensions for coordinate conversion
        page_width: row.page_width?.toString() ?? "",
        page_height: row.page_height?.toString() ?? "",
        ...(isItem ? {
          qty: row.quantity?.toString() ?? "",
          unit: row.unit,
          rate: row.rate?.toString() ?? "",
          total: (row.quantity && row.rate) ? (row.quantity * row.rate).toString() : (row.total?.toString() ?? ""),
        } : {}),
      };
    });
  };

  // Build column range info from boxes (relative 0-1 coordinates)
  const buildColumnRanges = () => {
    const columnRanges: Record<string, { x1: number; x2: number; y1: number; y2: number }> = {};
    
    // Get boxes from all pages and aggregate
    for (const [_pageKey, pageData] of Object.entries(bqPageData)) {
      for (const [columnName, box] of Object.entries(pageData.boxes)) {
        // Skip if not a column header box
        if (!["Item", "Description", "Qty", "Unit", "Rate", "Total", "DataRange"].includes(columnName)) {
          continue;
        }
        
        // Store the relative coordinates (0-1)
        // Convert to absolute using first page's dimensions if available
        const firstRow = pageData.rows[0];
        const pageWidth = firstRow?.page_width ?? 1;
        const pageHeight = firstRow?.page_height ?? 1;
        
        const absX1 = box.x * pageWidth;
        const absX2 = (box.x + box.width) * pageWidth;
        const absY1 = box.y * pageHeight;
        const absY2 = (box.y + box.height) * pageHeight;
        
        // Only update if not already set (use first occurrence)
        if (!columnRanges[columnName]) {
          columnRanges[columnName] = {
            x1: absX1,
            x2: absX2,
            y1: absY1,
            y2: absY2
          };
        }
      }
    }
    
    return columnRanges;
  };

  // Handle JSON export
  const handleExportJSON = () => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) {
      setExportError("No data to export (check filters)");
      return;
    }
    
    const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
    const exportData = buildExportData(pid);
    const columnRanges = buildColumnRanges();
    
    // Build page totals info for JSON export
    const pageInfos = Object.values(pageTotals).map(pt => ({
      page_id: pt.pageKey,
      page_name: pt.pageLabel,
      page_number: pt.pageNumber,
      file_id: pt.fileId,
      page_total: pt.total,
      item_count: pt.itemCount,
      page_total_x1: pt.collectionBox?.x0?.toString() ?? "",
      page_total_x2: pt.collectionBox?.x1?.toString() ?? "",
      page_total_y1: pt.collectionBox?.y0?.toString() ?? "",
      page_total_y2: pt.collectionBox?.y1?.toString() ?? "",
      page_width: pt.pageWidth?.toString() ?? "",
      page_height: pt.pageHeight?.toString() ?? "",
    }));
    
    // Build full export structure with project info 
    const fullExport = {
      project_info: {
        project_id: pid,
        export_date: new Date().toISOString(),
        total_rows: exportData.length,
        grand_total: grandTotal,
        column_ranges: columnRanges,
        pages: pageInfos
      },
      data: exportData
    };
    
    const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pid}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  // Handle Excel export
  const handleExportExcel = async () => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) {
      setExportError("No data to export (check filters)");
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
      const exportData = buildExportData(pid);
      
      // Convert to Excel-friendly format
      const headers = ["ID", "Project", "Type", "Bill", "Page", "Item", "Revision", "Ref", "Description", "Qty", "Unit", "Rate", "Total", "Data_X1", "Data_X2", "Data_Y1", "Data_Y2", "Page_Width", "Page_Height"];
      const rows = exportData.map(d => [
        d.id,
        d.project_id,
        d.Type,
        d.bill,
        d.page,
        d.item,
        d.revision,
        d.ref,
        d.data_detail,
        d.qty ?? "",
        d.unit ?? "",
        d.rate ?? "",
        d.total ?? "",
        d.data_X1 ?? "",
        d.data_X2 ?? "",
        d.data_Y1 ?? "",
        d.data_Y2 ?? "",
        d.page_width ?? "",
        d.page_height ?? "",
      ]);

      // Create CSV with proper escaping for Excel
      const escapeCell = (val: any) => {
        const str = String(val ?? "");
        // If contains newline, comma, or quote, wrap in quotes and escape inner quotes
        if (str.includes("\n") || str.includes(",") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvContent = [
        headers.map(escapeCell).join(","),
        ...rows.map(row => row.map(escapeCell).join(","))
      ].join("\r\n");

      // Download as Excel-compatible CSV
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pid}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err: any) {
      setExportError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Handle PDF export with annotations
  const handleExportPDF = async (includeAnnotations: boolean) => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) {
      setExportError("No data to export (check filters)");
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
      
      // Collect unique pages to export
      const uniquePages = new Map<string, { file_id: string; page_number: number; page_label: string }>();
      for (const { row } of filteredForExport) {
        const key = `${row.file_id}-${row.page_number}`;
        if (!uniquePages.has(key)) {
          uniquePages.set(key, {
            file_id: row.file_id,
            page_number: row.page_number,
            page_label: row.page_label || `page_${row.page_number + 1}`,
          });
        }
      }

      // Build page entries for export
      const pages = Array.from(uniquePages.values()).map(p => ({
        file_id: p.file_id,
        page_number: p.page_number,
        filename: `${pid}_${p.page_label.replace(/\//g, "-")}.pdf`,
      }));

      // Build annotations from user-edited fields
      const annotations: TextAnnotation[] = [];
      
      if (includeAnnotations) {
        for (const { row, pageKey } of filteredForExport) {
          // Only add annotations for items with user edits
          if (row.type === "item" && row.user_edited) {
            const pageData = bqPageData[pageKey];
            if (!pageData) continue;
            
            const pageWidth = row.page_width ?? 1;
            const pageHeight = row.page_height ?? 1;
            
            // Get column boxes for positioning
            const rateBox = pageData.boxes["Rate"];
            const qtyBox = pageData.boxes["Qty"];
            const totalBox = pageData.boxes["Total"];
            
            // Add quantity annotation
            if (row.user_edited.quantity && row.quantity !== null && qtyBox) {
              const x = qtyBox.x * pageWidth + 5;
              const y = (row.bbox_y0 ?? 0) + 12;  // Slight offset from top of row
              annotations.push({
                file_id: row.file_id,
                page_number: row.page_number,
                text: row.quantity.toString(),
                x,
                y,
                font_size: 9,
                color: "#0000FF",  // Blue for user edits
              });
            }
            
            // Add rate annotation
            if (row.user_edited.rate && row.rate !== null && rateBox) {
              const x = rateBox.x * pageWidth + 5;
              const y = (row.bbox_y0 ?? 0) + 12;
              annotations.push({
                file_id: row.file_id,
                page_number: row.page_number,
                text: row.rate.toFixed(2),
                x,
                y,
                font_size: 9,
                color: "#0000FF",
              });
            }
            
            // Add total annotation (auto-calculated or user-entered)
            if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && 
                row.total !== null && totalBox) {
              const x = totalBox.x * pageWidth + 5;
              const y = (row.bbox_y0 ?? 0) + 12;
              annotations.push({
                file_id: row.file_id,
                page_number: row.page_number,
                text: row.total.toFixed(2),
                x,
                y,
                font_size: 9,
                color: "#0000FF",
              });
            }
          }
        }
        
        // Add page totals to collection boxes
        for (const [pageKey, pt] of Object.entries(pageTotals)) {
          if (pt.total > 0 && pt.collectionBox) {
            annotations.push({
              file_id: pt.fileId,
              page_number: pt.pageNumber,
              text: `$${pt.total.toFixed(2)}`,
              x: pt.collectionBox.x0 + 5,
              y: pt.collectionBox.y0 + 12,
              font_size: 10,
              color: "#008000",  // Green for totals
              bold: true,
            });
          }
        }
      }

      await exportAnnotatedPdf(pages, annotations, includeAnnotations);
      setShowExportModal(false);
    } catch (err: any) {
      setExportError(err.message || "PDF export failed");
    } finally {
      setExporting(false);
    }
  };

  // Empty state
  if (allRows.length === 0) {
    return (
      <div style={container}>
        <div style={headerBar}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📊 BQ Export</span>
        </div>
        <div style={emptyState}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
          <div>No BQ data extracted yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Go to BQ OCR to extract data from PDF pages</div>
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      {/* Header */}
      <div style={headerBar}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>📊 BQ Export</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            style={filterSelect}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Types ({stats.total})</option>
            <option value="item">Items ({stats.itemCount})</option>
            <option value="notes">Notes ({stats.notesCount})</option>
            <option value="heading1">Heading 1 ({stats.heading1Count})</option>
            <option value="heading2">Heading 2 ({stats.heading2Count})</option>
          </select>
          <button
            style={exportBtn}
            onClick={() => setShowExportModal(true)}
            disabled={exporting || allRows.length === 0}
          >
            📥 Export
          </button>
        </div>
      </div>

      {/* Statistics */}
      <div style={statsBar}>
        <span style={statItem}>📄 {stats.pagesWithData} pages</span>
        <span style={statItem}>📋 {stats.total} rows</span>
        <span style={statItem}>🟢 {stats.itemCount} items</span>
        <span style={statItem}>📝 {stats.notesCount} notes</span>
        <span style={statItem}>🔵 {stats.heading1Count} H1</span>
        <span style={statItem}>🟡 {stats.heading2Count} H2</span>
        {grandTotal > 0 && (
          <span style={{ ...statItem, fontWeight: 700, color: "#27ae60" }}>
            💰 Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Export BQ Data</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>
                Project ID (optional, used as filename)
              </label>
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder={`BQ_${new Date().toISOString().slice(0, 10)}`}
                style={{ padding: "6px 10px", width: "100%", border: "1px solid #ddd", borderRadius: 4 }}
              />
            </div>
            
            {/* Export Filters */}
            <div style={{ marginBottom: 16, padding: "12px", background: "#f8f9fa", borderRadius: 4 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8, fontWeight: 600 }}>
                Filter Export Data
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={exportFilterPage}
                  onChange={(e) => setExportFilterPage(e.target.value)}
                  style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}
                >
                  <option value="all">All Pages</option>
                  {uniquePages.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                  value={exportFilterRev}
                  onChange={(e) => setExportFilterRev(e.target.value)}
                  style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}
                >
                  <option value="all">All Revisions</option>
                  {uniqueRevisions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select
                  value={exportFilterType}
                  onChange={(e) => setExportFilterType(e.target.value)}
                  style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}
                >
                  <option value="all">All Types</option>
                  <option value="item">Items</option>
                  <option value="notes">Notes</option>
                  <option value="heading1">Heading 1</option>
                  <option value="heading2">Heading 2</option>
                </select>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                {getFilteredExportRows().length} of {allRows.length} rows will be exported
              </div>
            </div>
            
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                style={{ ...modalBtn, background: "#95a5a6" }}
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                style={{ ...modalBtn, background: "#3498db" }}
                onClick={handleExportJSON}
              >
                📄 JSON
              </button>
              <button
                style={{ ...modalBtn, background: "#2ecc71" }}
                onClick={handleExportExcel}
                disabled={exporting}
              >
                {exporting ? "⏳..." : "📊 Excel (CSV)"}
              </button>
              <button
                style={{ ...modalBtn, background: "#e74c3c" }}
                onClick={() => handleExportPDF(false)}
                disabled={exporting}
              >
                {exporting ? "⏳..." : "📄 PDF (原版)"}
              </button>
              <button
                style={{ ...modalBtn, background: "#9b59b6" }}
                onClick={() => handleExportPDF(true)}
                disabled={exporting}
              >
                {exporting ? "⏳..." : "📝 PDF (含用戶輸入)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {exportError && (
        <div style={errorStyle}>
          ⚠️ {exportError}
          <button style={dismissBtn} onClick={() => setExportError(null)}>✕</button>
        </div>
      )}

      {/* Data table */}
      <div style={tableContainer}>
        <table style={table}>
          <thead>
            <tr style={headerRow}>
              <th style={th}>Page</th>
              <th style={th}>Rev</th>
              <th style={th}>Type</th>
              <th style={th}>Item</th>
              <th style={thWide}>Description</th>
              <th style={th}>Qty</th>
              <th style={th}>Unit</th>
              <th style={th}>Rate</th>
              <th style={th}>Total</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ pageKey, row }, idx) => {
              const isEditing = editingCell?.pageKey === pageKey && editingCell?.rowId === row.id;
              const rowStyle = row.type === "heading1" ? h1Row : row.type === "heading2" ? h2Row : row.type === "notes" ? notesRow : itemRow;
              
              return (
                <tr key={`${pageKey}-${row.id}`} style={rowStyle}>
                  <td style={td}>{row.page_label || `P${row.page_number + 1}`}</td>
                  <td style={td} title={row.revision}>{row.revision?.slice(0, 10) || ""}</td>
                  <td style={td}>
                    <span style={{
                      ...typeTag,
                      background: row.type === "heading1" ? "#e74c3c" : row.type === "heading2" ? "#f39c12" : row.type === "notes" ? "#95a5a6" : "#2ecc71"
                    }}>
                      {row.type === "heading1" ? "H1" : row.type === "heading2" ? "H2" : row.type === "notes" ? "Note" : "Item"}
                    </span>
                  </td>
                  <td style={td}>
                    {isEditing && editingCell.field === "item_no" ? (
                      <input
                        style={editInput}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => e.key === "Enter" ? handleSaveEdit() : e.key === "Escape" && handleCancelEdit()}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={editableCell}
                        onClick={() => handleStartEdit(pageKey, row.id, "item_no", row.item_no, row)}
                      >
                        {row.item_no || "-"}
                      </span>
                    )}
                  </td>
                  <td style={tdWide}>
                    {isEditing && editingCell.field === "description" ? (
                      <textarea
                        style={{ 
                          ...editInput, 
                          width: "100%", 
                          minHeight: 80,
                          resize: "vertical",
                          fontFamily: "inherit",
                          lineHeight: 1.4
                        }}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") handleCancelEdit();
                          // Ctrl+Enter to save (allow plain Enter for newlines)
                          if (e.key === "Enter" && e.ctrlKey) handleSaveEdit();
                        }}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={{ ...editableCell, display: "block", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}
                        onClick={() => handleStartEdit(pageKey, row.id, "description", row.description, row)}
                        title={row.description}
                      >
                        {row.description || "-"}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {isEditing && editingCell.field === "quantity" ? (
                      <input
                        style={editInput}
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => e.key === "Enter" ? handleSaveEdit() : e.key === "Escape" && handleCancelEdit()}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={editableCell}
                        onClick={() => handleStartEdit(pageKey, row.id, "quantity", row.quantity, row)}
                      >
                        {row.quantity ?? "-"}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {isEditing && editingCell.field === "unit" ? (
                      <input
                        style={editInput}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => e.key === "Enter" ? handleSaveEdit() : e.key === "Escape" && handleCancelEdit()}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={editableCell}
                        onClick={() => handleStartEdit(pageKey, row.id, "unit", row.unit, row)}
                      >
                        {row.unit || "-"}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {isEditing && editingCell.field === "rate" ? (
                      <input
                        style={editInput}
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => e.key === "Enter" ? handleSaveEdit() : e.key === "Escape" && handleCancelEdit()}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={editableCell}
                        onClick={() => handleStartEdit(pageKey, row.id, "rate", row.rate, row)}
                      >
                        {row.rate ?? "-"}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {isEditing && editingCell.field === "total" ? (
                      <input
                        style={editInput}
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => e.key === "Enter" ? handleSaveEdit() : e.key === "Escape" && handleCancelEdit()}
                        autoFocus
                      />
                    ) : (
                      <span
                        style={editableCell}
                        onClick={() => handleStartEdit(pageKey, row.id, "total", row.total, row)}
                      >
                        {row.total ?? "-"}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    <button
                      style={deleteBtn}
                      onClick={() => onDeleteRow(pageKey, row.id)}
                      title="Delete this row"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

const headerBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  background: "#f0f0f0",
  borderBottom: "1px solid #e0e0e0",
  flexWrap: "wrap",
  gap: 8,
};

const filterSelect: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  border: "1px solid #ddd",
  borderRadius: 4,
};

const exportBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 600,
  border: "none",
  borderRadius: 4,
  background: "#2ecc71",
  color: "#fff",
  cursor: "pointer",
};

const statsBar: React.CSSProperties = {
  display: "flex",
  gap: 16,
  padding: "8px 12px",
  background: "#fafafa",
  borderBottom: "1px solid #eee",
  fontSize: 11,
};

const statItem: React.CSSProperties = {
  color: "#666",
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

const tableContainer: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11,
};

const headerRow: React.CSSProperties = {
  background: "#f5f5f5",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const th: React.CSSProperties = {
  padding: "8px 6px",
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const thWide: React.CSSProperties = {
  ...th,
  minWidth: 200,
};

const td: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const tdWide: React.CSSProperties = {
  ...td,
  whiteSpace: "normal",
};

const h1Row: React.CSSProperties = {
  background: "#fef5f5",
  fontWeight: 600,
};

const h2Row: React.CSSProperties = {
  background: "#fef8e7",
  fontWeight: 500,
};

const itemRow: React.CSSProperties = {
  background: "#fff",
};

const typeTag: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 3,
  color: "#fff",
  fontSize: 9,
  fontWeight: 600,
};

const editableCell: React.CSSProperties = {
  cursor: "pointer",
  padding: "2px 4px",
  borderRadius: 2,
  transition: "background 0.15s",
};

const editInput: React.CSSProperties = {
  padding: "2px 4px",
  fontSize: 11,
  border: "1px solid #3498db",
  borderRadius: 2,
  width: 60,
};

const deleteBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  opacity: 0.6,
  transition: "opacity 0.15s",
};

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const modalBox: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  minWidth: 320,
  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
};

const modalBtn: React.CSSProperties = {
  padding: "8px 16px",
  border: "none",
  borderRadius: 4,
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};

const notesRow: React.CSSProperties = {
  background: "#f5f5f5",
  fontStyle: "italic",
};
