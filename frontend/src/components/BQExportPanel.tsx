/**
 * BQExportPanel — Summary view and export panel for BQ data.
 *
 * Excel-like spreadsheet table with:
 * - Arrow key navigation between cells
 * - Enter to move down, Tab to move right, Shift+Tab left
 * - Double-click or F2 or type to start editing
 * - Shift+Arrow to extend selection (blue highlight)
 * - Ctrl+C to copy, Ctrl+V to paste (multi-cell from Excel)
 * - Delete/Backspace to clear selected cells
 * - Inline editing with auto-calculate total from rate × qty
 * - Export to Excel, JSON, PDF
 */
import React, { useState, useMemo, useCallback, useRef } from "react";
import type { BQRow, BQPageData } from "../types";
import { exportAnnotatedPdf, type TextAnnotation } from "../api/client";

interface BQExportPanelProps {
  bqPageData: Record<string, BQPageData>;
  onRowEdit: (pageKey: string, rowId: number, field: keyof BQRow, value: any) => void;
  onDeleteRow: (pageKey: string, rowId: number) => void;
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
  // Focused cell (for keyboard nav, highlighted but not editing)
  const [focusedCell, setFocusedCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  // Selection range for copy
  const [selectionStart, setSelectionStart] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
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

  // Calculate page totals
  const pageTotals = useMemo(() => {
    const totals: Record<string, {
      pageKey: string; pageLabel: string; pageNumber: number; fileId: string;
      total: number; itemCount: number;
      collectionBox?: { x0: number; y0: number; x1: number; y1: number };
      pageWidth?: number; pageHeight?: number;
    }> = {};
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      let pageTotal = 0, itemCount = 0, pageLabel = "";
      for (const row of pageData.rows) {
        if (row.type === "item" && row.total !== null) { pageTotal += row.total; itemCount++; }
        if (!pageLabel && row.page_label) pageLabel = row.page_label;
      }
      const collectionBox = pageData.boxes["Collection"];
      const firstRow = pageData.rows[0];
      totals[pageKey] = {
        pageKey, pageLabel, pageNumber: pageData.page_number, fileId: pageData.file_id,
        total: pageTotal, itemCount,
        collectionBox: collectionBox ? {
          x0: collectionBox.x * (firstRow?.page_width ?? 1),
          y0: collectionBox.y * (firstRow?.page_height ?? 1),
          x1: (collectionBox.x + collectionBox.width) * (firstRow?.page_width ?? 1),
          y1: (collectionBox.y + collectionBox.height) * (firstRow?.page_height ?? 1),
        } : undefined,
        pageWidth: firstRow?.page_width, pageHeight: firstRow?.page_height,
      };
    }
    return totals;
  }, [bqPageData]);

  const grandTotal = useMemo(() => Object.values(pageTotals).reduce((sum, pt) => sum + pt.total, 0), [pageTotals]);

  const uniquePages = useMemo(() => {
    const pages = new Set<string>();
    allRows.forEach(({ row }) => { if (row.page_label) pages.add(row.page_label); });
    return Array.from(pages).sort();
  }, [allRows]);

  const uniqueRevisions = useMemo(() => {
    const revs = new Set<string>();
    allRows.forEach(({ row }) => { if (row.revision) revs.add(row.revision); });
    return Array.from(revs).sort();
  }, [allRows]);

  const parseBillPage = (pageLabel: string) => {
    const match = pageLabel.match(/^([^/]+)\/(.+)$/);
    return match ? { bill: match[1], page: match[2] } : { bill: "", page: pageLabel };
  };

  const buildRef = (row: BQRow) => {
    const { bill, page } = parseBillPage(row.page_label || "");
    return (bill && page && row.item_no) ? `${bill}/${page}/${row.item_no}` : "";
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Editable columns definition (order = arrow-key nav order)
  // ──────────────────────────────────────────────────────────────────────────
  const EDITABLE_COLS = ["item_no", "description", "quantity", "unit", "rate", "total"] as const;
  type EditCol = typeof EDITABLE_COLS[number];

  const getCellValue = useCallback((row: BQRow, field: EditCol): string => {
    switch (field) {
      case "item_no": return row.item_no || "";
      case "description": return row.description || "";
      case "quantity": return row.quantity != null ? String(row.quantity) : "";
      case "unit": return row.unit || "";
      case "rate": return row.rate != null ? String(row.rate) : "";
      case "total": return row.total != null ? String(row.total) : "";
      default: return "";
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Cell editing
  // ──────────────────────────────────────────────────────────────────────────

  const handleStartEdit = useCallback((pageKey: string, rowId: number, field: string, currentValue: any, row: BQRow) => {
    setEditingCell({ pageKey, rowId, field });
    setEditValue(String(currentValue ?? ""));
    if (onNavigateToRow && row.file_id) {
      const bbox = (row.bbox_x0 !== undefined && row.bbox_y0 !== undefined &&
                    row.bbox_x1 !== undefined && row.bbox_y1 !== undefined)
        ? { x0: row.bbox_x0, y0: row.bbox_y0, x1: row.bbox_x1, y1: row.bbox_y1 } : null;
      const pageSize = (row.page_width && row.page_height) ? { width: row.page_width, height: row.page_height } : null;
      onNavigateToRow(row.file_id, row.page_number, bbox, pageSize);
    }
  }, [onNavigateToRow]);

  const handleSaveEdit = useCallback(() => {
    if (!editingCell) return;
    const { pageKey, rowId, field } = editingCell;
    let value: any = editValue;
    if (["quantity", "rate", "total"].includes(field)) {
      value = editValue ? parseFloat(editValue) : null;
    }
    const currentRowEntry = allRows.find(r => r.pageKey === pageKey && r.row.id === rowId);
    const currentRow = currentRowEntry?.row;
    if (currentRow && ["quantity", "rate", "total"].includes(field)) {
      const userEdited = currentRow.user_edited || {};
      onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, { ...userEdited, [field]: true });
    }
    onRowEdit(pageKey, rowId, field as keyof BQRow, value);
    if (currentRow && (field === "rate" || field === "quantity")) {
      const newQty = field === "quantity" ? value : currentRow.quantity;
      const newRate = field === "rate" ? value : currentRow.rate;
      if (newQty !== null && newRate !== null) {
        onRowEdit(pageKey, rowId, "total", newQty * newRate);
      }
    }
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, allRows, onRowEdit]);

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Excel-like navigation
  // ──────────────────────────────────────────────────────────────────────────

  const focusCell = useCallback((rowIdx: number, colIdx: number, startEdit = false) => {
    if (rowIdx < 0 || rowIdx >= filteredRows.length) return;
    if (colIdx < 0 || colIdx >= EDITABLE_COLS.length) return;
    setFocusedCell({ rowIdx, colIdx });
    setSelectionStart({ rowIdx, colIdx });
    setSelectionEnd({ rowIdx, colIdx });
    if (startEdit) {
      const { pageKey, row } = filteredRows[rowIdx];
      const field = EDITABLE_COLS[colIdx];
      handleStartEdit(pageKey, row.id, field, getCellValue(row, field), row);
    }
  }, [filteredRows, handleStartEdit, getCellValue]);

  const saveAndMove = useCallback((dRow: number, dCol: number) => {
    handleSaveEdit();
    if (!focusedCell) return;
    let newRow = focusedCell.rowIdx + dRow;
    let newCol = focusedCell.colIdx + dCol;
    if (newCol >= EDITABLE_COLS.length) { newRow++; newCol = 0; }
    if (newCol < 0) { newRow--; newCol = EDITABLE_COLS.length - 1; }
    setTimeout(() => focusCell(newRow, newCol), 0);
  }, [focusedCell, handleSaveEdit, focusCell]);

  const selectionRect = useMemo(() => {
    if (!selectionStart || !selectionEnd) return null;
    return {
      minRow: Math.min(selectionStart.rowIdx, selectionEnd.rowIdx),
      maxRow: Math.max(selectionStart.rowIdx, selectionEnd.rowIdx),
      minCol: Math.min(selectionStart.colIdx, selectionEnd.colIdx),
      maxCol: Math.max(selectionStart.colIdx, selectionEnd.colIdx),
    };
  }, [selectionStart, selectionEnd]);

  const isCellSelected = useCallback((rowIdx: number, colIdx: number) => {
    if (!selectionRect) return false;
    return rowIdx >= selectionRect.minRow && rowIdx <= selectionRect.maxRow &&
           colIdx >= selectionRect.minCol && colIdx <= selectionRect.maxCol;
  }, [selectionRect]);

  const isCellFocused = useCallback((rowIdx: number, colIdx: number) => {
    return focusedCell?.rowIdx === rowIdx && focusedCell?.colIdx === colIdx;
  }, [focusedCell]);

  // ──────────────────────────────────────────────────────────────────────────
  // Copy / Paste
  // ──────────────────────────────────────────────────────────────────────────

  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (!selectionRect || editingCell) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = selectionRect.minRow; r <= selectionRect.maxRow; r++) {
      const cells: string[] = [];
      for (let c = selectionRect.minCol; c <= selectionRect.maxCol; c++) {
        cells.push(getCellValue(filteredRows[r].row, EDITABLE_COLS[c]));
      }
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
  }, [selectionRect, editingCell, filteredRows, getCellValue]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!focusedCell || editingCell) return;
    e.preventDefault();
    const clipData = e.clipboardData.getData("text/plain");
    if (!clipData) return;
    const lines = clipData.split(/\r?\n/).filter(l => l.length > 0);
    for (let dr = 0; dr < lines.length; dr++) {
      const rowIdx = focusedCell.rowIdx + dr;
      if (rowIdx >= filteredRows.length) break;
      const cols = lines[dr].split("\t");
      const { pageKey, row } = filteredRows[rowIdx];
      for (let dc = 0; dc < cols.length; dc++) {
        const colIdx = focusedCell.colIdx + dc;
        if (colIdx >= EDITABLE_COLS.length) break;
        const field = EDITABLE_COLS[colIdx];
        let value: any = cols[dc];
        if (["quantity", "rate", "total"].includes(field)) {
          const num = parseFloat(value);
          value = isNaN(num) ? null : num;
          onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, { ...(row.user_edited || {}), [field]: true });
        }
        onRowEdit(pageKey, row.id, field as keyof BQRow, value);
      }
    }
    setSelectionEnd({
      rowIdx: Math.min(focusedCell.rowIdx + lines.length - 1, filteredRows.length - 1),
      colIdx: Math.min(focusedCell.colIdx + (lines[0]?.split("\t").length ?? 1) - 1, EDITABLE_COLS.length - 1),
    });
  }, [focusedCell, editingCell, filteredRows, onRowEdit]);

  // ──────────────────────────────────────────────────────────────────────────
  // Global keyboard handler
  // ──────────────────────────────────────────────────────────────────────────

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!focusedCell) return;

    // When editing
    if (editingCell) {
      if (e.key === "Escape") { handleCancelEdit(); return; }
      if (e.key === "Enter" && editingCell.field === "description" && !e.ctrlKey) return; // allow newline
      if (e.key === "Enter") { e.preventDefault(); saveAndMove(1, 0); return; }
      if (e.key === "Tab") { e.preventDefault(); saveAndMove(0, e.shiftKey ? -1 : 1); return; }
      return;
    }

    // Navigation mode
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (e.shiftKey && selectionStart) {
          setSelectionEnd(prev => ({ rowIdx: Math.max(0, (prev?.rowIdx ?? focusedCell.rowIdx) - 1), colIdx: prev?.colIdx ?? focusedCell.colIdx }));
        } else { focusCell(focusedCell.rowIdx - 1, focusedCell.colIdx); }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (e.shiftKey && selectionStart) {
          setSelectionEnd(prev => ({ rowIdx: Math.min(filteredRows.length - 1, (prev?.rowIdx ?? focusedCell.rowIdx) + 1), colIdx: prev?.colIdx ?? focusedCell.colIdx }));
        } else { focusCell(focusedCell.rowIdx + 1, focusedCell.colIdx); }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey && selectionStart) {
          setSelectionEnd(prev => ({ rowIdx: prev?.rowIdx ?? focusedCell.rowIdx, colIdx: Math.max(0, (prev?.colIdx ?? focusedCell.colIdx) - 1) }));
        } else { focusCell(focusedCell.rowIdx, focusedCell.colIdx - 1); }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey && selectionStart) {
          setSelectionEnd(prev => ({ rowIdx: prev?.rowIdx ?? focusedCell.rowIdx, colIdx: Math.min(EDITABLE_COLS.length - 1, (prev?.colIdx ?? focusedCell.colIdx) + 1) }));
        } else { focusCell(focusedCell.rowIdx, focusedCell.colIdx + 1); }
        break;
      case "Enter":
      case "F2":
        e.preventDefault();
        focusCell(focusedCell.rowIdx, focusedCell.colIdx, true);
        break;
      case "Tab":
        e.preventDefault();
        focusCell(focusedCell.rowIdx, focusedCell.colIdx + (e.shiftKey ? -1 : 1));
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (selectionRect) {
          for (let r = selectionRect.minRow; r <= selectionRect.maxRow; r++) {
            const { pageKey: pk, row: rw } = filteredRows[r];
            for (let c = selectionRect.minCol; c <= selectionRect.maxCol; c++) {
              const fld = EDITABLE_COLS[c];
              onRowEdit(pk, rw.id, fld as keyof BQRow, ["quantity", "rate", "total"].includes(fld) ? null : "");
            }
          }
        }
        break;
      default:
        // Start editing on any printable character
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const { pageKey: pk, row: rw } = filteredRows[focusedCell.rowIdx];
          const fld = EDITABLE_COLS[focusedCell.colIdx];
          handleStartEdit(pk, rw.id, fld, "", rw);
          setEditValue(e.key);
        }
        break;
    }
  }, [focusedCell, editingCell, filteredRows, selectionStart, selectionRect,
      handleCancelEdit, saveAndMove, focusCell, handleStartEdit, onRowEdit]);

  const handleCellClick = useCallback((rowIdx: number, colIdx: number, e: React.MouseEvent) => {
    if (e.shiftKey && focusedCell) {
      setSelectionEnd({ rowIdx, colIdx });
    } else {
      focusCell(rowIdx, colIdx);
    }
  }, [focusedCell, focusCell]);

  const handleCellDoubleClick = useCallback((rowIdx: number, colIdx: number) => {
    focusCell(rowIdx, colIdx, true);
  }, [focusCell]);

  // ──────────────────────────────────────────────────────────────────────────
  // Export helpers (same logic as before, abbreviated for space)
  // ──────────────────────────────────────────────────────────────────────────

  const getFilteredExportRows = () => {
    return allRows.filter(({ row }) => {
      if (exportFilterPage !== "all" && row.page_label !== exportFilterPage) return false;
      if (exportFilterRev !== "all" && row.revision !== exportFilterRev) return false;
      if (exportFilterType !== "all" && row.type !== exportFilterType) return false;
      return true;
    });
  };

  const buildExportData = (pid: string) => {
    return getFilteredExportRows().map(({ row }, idx) => {
      const { bill, page } = parseBillPage(row.page_label || "");
      const ref = buildRef(row);
      const isItem = row.type === "item";
      return {
        id: idx + 1, project_id: pid,
        Type: row.type === "item" ? "Item" : row.type === "notes" ? "Notes" : row.type,
        bill, page, item: row.item_no, revision: row.revision, ref,
        data_detail: row.description,
        data_X1: row.bbox_x0?.toString() ?? "", data_X2: row.bbox_x1?.toString() ?? "",
        data_Y1: row.bbox_y0?.toString() ?? "", data_Y2: row.bbox_y1?.toString() ?? "",
        page_width: row.page_width?.toString() ?? "", page_height: row.page_height?.toString() ?? "",
        ...(isItem ? {
          qty: row.quantity?.toString() ?? "", unit: row.unit,
          rate: row.rate?.toString() ?? "",
          total: (row.quantity && row.rate) ? (row.quantity * row.rate).toString() : (row.total?.toString() ?? ""),
        } : {}),
      };
    });
  };

  const buildColumnRanges = () => {
    const columnRanges: Record<string, { x1: number; x2: number; y1: number; y2: number }> = {};
    for (const [, pageData] of Object.entries(bqPageData)) {
      for (const [columnName, box] of Object.entries(pageData.boxes)) {
        if (!["Item", "Description", "Qty", "Unit", "Rate", "Total", "DataRange"].includes(columnName)) continue;
        const firstRow = pageData.rows[0];
        const pw = firstRow?.page_width ?? 1, ph = firstRow?.page_height ?? 1;
        if (!columnRanges[columnName]) {
          columnRanges[columnName] = { x1: box.x * pw, x2: (box.x + box.width) * pw, y1: box.y * ph, y2: (box.y + box.height) * ph };
        }
      }
    }
    return columnRanges;
  };

  const handleExportJSON = () => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) { setExportError("No data to export (check filters)"); return; }
    const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
    const exportData = buildExportData(pid);
    const columnRanges = buildColumnRanges();
    const pageInfos = Object.values(pageTotals).map(pt => ({
      page_id: pt.pageKey, page_name: pt.pageLabel, page_number: pt.pageNumber, file_id: pt.fileId,
      page_total: pt.total, item_count: pt.itemCount,
      page_total_x1: pt.collectionBox?.x0?.toString() ?? "", page_total_x2: pt.collectionBox?.x1?.toString() ?? "",
      page_total_y1: pt.collectionBox?.y0?.toString() ?? "", page_total_y2: pt.collectionBox?.y1?.toString() ?? "",
      page_width: pt.pageWidth?.toString() ?? "", page_height: pt.pageHeight?.toString() ?? "",
    }));

    // Build annotations from all pages
    const allAnnotations: Array<Record<string, any>> = [];
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      const storedPositions = pageData.annotation_positions || {};
      const rateBox = pageData.boxes["Rate"];
      const qtyBox = pageData.boxes["Qty"];
      const totalBox = pageData.boxes["Total"];
      const collectionBox = pageData.boxes["Collection"];
      for (const row of pageData.rows) {
        if (row.type !== "item" || !row.user_edited) continue;
        const pw = row.page_width ?? 1;
        if (row.user_edited.quantity && row.quantity !== null && qtyBox) {
          const annId = `auto-qty-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: row.quantity.toString(), x: stored?.x ?? (qtyBox.x * pw + 5), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
        }
        if (row.user_edited.rate && row.rate !== null && rateBox) {
          const annId = `auto-rate-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: row.rate.toFixed(2), x: stored?.x ?? (rateBox.x * pw + 5), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
        }
        if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && row.total !== null && totalBox) {
          const annId = `auto-total-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: row.total.toFixed(2), x: stored?.x ?? (totalBox.x * pw + 5), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
        }
      }
      if (collectionBox && pageData.rows.length > 0) {
        let pageTotal = 0;
        for (const row of pageData.rows) { if (row.type === "item" && row.total !== null) pageTotal += row.total; }
        if (pageTotal > 0) {
          const fr = pageData.rows[0];
          const pw = fr?.page_width ?? 1, ph = fr?.page_height ?? 1;
          const annId = `auto-pagetotal-${pageKey}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: `$${pageTotal.toFixed(2)}`, x: stored?.x ?? (collectionBox.x * pw + 5), y: stored?.y ?? ((collectionBox.y + collectionBox.height * 0.5) * ph), font_size: 10, color: "#008000", bold: true });
        }
      }
    }
    const allPositions: Record<string, Record<string, { x: number; y: number }>> = {};
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      if (pageData.annotation_positions && Object.keys(pageData.annotation_positions).length > 0) allPositions[pageKey] = pageData.annotation_positions;
    }

    const fullExport = {
      project_info: { project_id: pid, export_date: new Date().toISOString(), total_rows: exportData.length, grand_total: grandTotal, column_ranges: columnRanges, pages: pageInfos },
      data: exportData, annotations: allAnnotations, annotation_positions: allPositions,
    };
    const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${pid}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  const handleExportExcel = async () => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) { setExportError("No data to export"); return; }
    setExporting(true); setExportError(null);
    try {
      const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
      const exportData = buildExportData(pid);
      const headers = ["ID", "Project", "Type", "Bill", "Page", "Item", "Revision", "Ref", "Description", "Qty", "Unit", "Rate", "Total"];
      const rows = exportData.map(d => [d.id, d.project_id, d.Type, d.bill, d.page, d.item, d.revision, d.ref, d.data_detail, d.qty ?? "", d.unit ?? "", d.rate ?? "", d.total ?? ""]);
      const esc = (v: any) => { const s = String(v ?? ""); return (s.includes("\n") || s.includes(",") || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${pid}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err: any) { setExportError(err.message || "Export failed"); }
    finally { setExporting(false); }
  };

  const handleExportPageTotals = async () => {
    if (Object.keys(pageTotals).length === 0) { setExportError("No page data"); return; }
    try {
      const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
      const sorted = Object.values(pageTotals).sort((a, b) => a.fileId !== b.fileId ? a.fileId.localeCompare(b.fileId) : a.pageNumber - b.pageNumber);
      const headers = ["Project", "Bill", "Page", "Page_Label", "Item_Count", "Page_Total"];
      const rows: any[][] = sorted.map(pt => [pid, pt.fileId, pt.pageNumber, pt.pageLabel, pt.itemCount, pt.total.toFixed(2)]);
      rows.push([pid, "TOTAL", "", "", rows.reduce((s, r) => s + Number(r[4]), 0), grandTotal.toFixed(2)]);
      const esc = (v: any) => { const s = String(v ?? ""); return (s.includes("\n") || s.includes(",") || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${pid}_page_totals.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err: any) { setExportError(err.message || "Export failed"); }
  };

  const handleExportPDF = async (includeAnnotations: boolean) => {
    const filteredForExport = getFilteredExportRows();
    if (filteredForExport.length === 0) { setExportError("No data to export"); return; }
    setExporting(true); setExportError(null);
    try {
      const pid = projectId.trim() || `BQ_${new Date().toISOString().slice(0, 10)}`;
      const uniquePagesMap = new Map<string, { file_id: string; page_number: number; page_label: string }>();
      for (const { row } of filteredForExport) {
        const key = `${row.file_id}-${row.page_number}`;
        if (!uniquePagesMap.has(key)) uniquePagesMap.set(key, { file_id: row.file_id, page_number: row.page_number, page_label: row.page_label || `page_${row.page_number + 1}` });
      }
      const pages = Array.from(uniquePagesMap.values()).map(p => ({ file_id: p.file_id, page_number: p.page_number, filename: `${pid}_${p.page_label.replace(/\//g, "-")}.pdf` }));
      const annotations: TextAnnotation[] = [];
      if (includeAnnotations) {
        for (const { row, pageKey } of filteredForExport) {
          if (row.type === "item" && row.user_edited) {
            const pageData = bqPageData[pageKey]; if (!pageData) continue;
            const sp = pageData.annotation_positions || {};
            const pw = row.page_width ?? 1;
            const rateBox = pageData.boxes["Rate"], qtyBox = pageData.boxes["Qty"], totalBox = pageData.boxes["Total"];
            if (row.user_edited.quantity && row.quantity !== null && qtyBox) {
              const id = `auto-qty-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: row.quantity.toString(), x: s?.x ?? (qtyBox.x * pw + 5), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
            }
            if (row.user_edited.rate && row.rate !== null && rateBox) {
              const id = `auto-rate-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: row.rate.toFixed(2), x: s?.x ?? (rateBox.x * pw + 5), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
            }
            if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && row.total !== null && totalBox) {
              const id = `auto-total-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: row.total.toFixed(2), x: s?.x ?? (totalBox.x * pw + 5), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF" });
            }
          }
        }
        for (const [pageKey, pt] of Object.entries(pageTotals)) {
          if (pt.total > 0 && pt.collectionBox) {
            const pd = bqPageData[pageKey]; const sp = pd?.annotation_positions || {};
            const id = `auto-pagetotal-${pageKey}`; const s = sp[id];
            annotations.push({ file_id: pt.fileId, page_number: pt.pageNumber, text: `$${pt.total.toFixed(2)}`, x: s?.x ?? (pt.collectionBox.x0 + 5), y: s?.y ?? (pt.collectionBox.y0 + 12), font_size: 10, color: "#008000", bold: true });
          }
        }
      }
      const outputFilename = includeAnnotations ? `${pid}_annotated.pdf` : `${pid}.pdf`;
      await exportAnnotatedPdf(pages, annotations, includeAnnotations, outputFilename, true);
      setShowExportModal(false);
    } catch (err: any) { setExportError(err.message || "PDF export failed"); }
    finally { setExporting(false); }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────

  if (allRows.length === 0) {
    return (
      <div style={container}>
        <div style={headerBar}><span style={{ fontWeight: 700, fontSize: 14 }}>📊 BQ Export</span></div>
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
          <select style={filterSelect} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types ({stats.total})</option>
            <option value="item">Items ({stats.itemCount})</option>
            <option value="notes">Notes ({stats.notesCount})</option>
            <option value="heading1">Heading 1 ({stats.heading1Count})</option>
            <option value="heading2">Heading 2 ({stats.heading2Count})</option>
          </select>
          <button style={exportBtn} onClick={() => setShowExportModal(true)} disabled={exporting || allRows.length === 0}>📥 Export</button>
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
        {grandTotal > 0 && <span style={{ ...statItem, fontWeight: 700, color: "#27ae60" }}>💰 Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
      </div>

      {/* Keyboard hints */}
      <div style={{ display: "flex", gap: 12, padding: "3px 12px", background: "#fafafa", borderBottom: "1px solid #eee", fontSize: 10, color: "#999" }}>
        <span>⬆⬇⬅➡ 移動</span>
        <span>Enter/F2 編輯</span>
        <span>Tab 下一格</span>
        <span>Shift+方向鍵 選取</span>
        <span>Ctrl+C 複製</span>
        <span>Ctrl+V 貼上</span>
        <span>Del 清除</span>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Export BQ Data</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Project ID (optional)</label>
              <input type="text" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder={`BQ_${new Date().toISOString().slice(0, 10)}`} style={{ padding: "6px 10px", width: "100%", border: "1px solid #ddd", borderRadius: 4 }} />
            </div>
            <div style={{ marginBottom: 16, padding: 12, background: "#f8f9fa", borderRadius: 4 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8, fontWeight: 600 }}>Filter Export Data</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select value={exportFilterPage} onChange={(e) => setExportFilterPage(e.target.value)} style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}>
                  <option value="all">All Pages</option>
                  {uniquePages.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={exportFilterRev} onChange={(e) => setExportFilterRev(e.target.value)} style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}>
                  <option value="all">All Revisions</option>
                  {uniqueRevisions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={exportFilterType} onChange={(e) => setExportFilterType(e.target.value)} style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 }}>
                  <option value="all">All Types</option><option value="item">Items</option><option value="notes">Notes</option><option value="heading1">Heading 1</option><option value="heading2">Heading 2</option>
                </select>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{getFilteredExportRows().length} of {allRows.length} rows will be exported</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button style={{ ...modalBtn, background: "#95a5a6" }} onClick={() => setShowExportModal(false)}>Cancel</button>
              <button style={{ ...modalBtn, background: "#3498db" }} onClick={handleExportJSON}>📄 JSON</button>
              <button style={{ ...modalBtn, background: "#2ecc71" }} onClick={handleExportExcel} disabled={exporting}>{exporting ? "⏳..." : "📊 Excel (CSV)"}</button>
              <button style={{ ...modalBtn, background: "#16a085" }} onClick={handleExportPageTotals} disabled={exporting}>{exporting ? "⏳..." : "📋 Page Totals"}</button>
              <button style={{ ...modalBtn, background: "#e74c3c" }} onClick={() => handleExportPDF(false)} disabled={exporting}>{exporting ? "⏳..." : "📄 PDF (原版)"}</button>
              <button style={{ ...modalBtn, background: "#9b59b6" }} onClick={() => handleExportPDF(true)} disabled={exporting}>{exporting ? "⏳..." : "📝 PDF (含用戶輸入)"}</button>
            </div>
          </div>
        </div>
      )}

      {exportError && (
        <div style={errorStyle}>⚠️ {exportError}<button style={dismissBtn} onClick={() => setExportError(null)}>✕</button></div>
      )}

      {/* ─── Excel-like Data Table ─── */}
      <div
        ref={tableRef}
        style={tableContainer}
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
      >
        <table style={table}>
          <thead>
            <tr style={headerRow}>
              <th style={th}>#</th>
              <th style={th}>Page</th>
              <th style={th}>Rev</th>
              <th style={th}>Type</th>
              <th style={thEditCol}>Item</th>
              <th style={thEditColWide}>Description</th>
              <th style={thEditCol}>Qty</th>
              <th style={thEditCol}>Unit</th>
              <th style={thEditCol}>Rate</th>
              <th style={thEditCol}>Total</th>
              <th style={th}>🗑️</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ pageKey, row }, rowIdx) => {
              const isEditing = editingCell?.pageKey === pageKey && editingCell?.rowId === row.id;
              const rowBg = row.type === "heading1" ? "#fef5f5" : row.type === "heading2" ? "#fef8e7" : row.type === "notes" ? "#f5f5f5" : "#fff";

              return (
                <tr key={`${pageKey}-${row.id}`} style={{ background: rowBg, fontWeight: row.type === "heading1" ? 600 : row.type === "heading2" ? 500 : 400, fontStyle: row.type === "notes" ? "italic" : "normal" }}>
                  <td style={{ ...td, color: "#aaa", fontSize: 9, textAlign: "center", width: 28 }}>{rowIdx + 1}</td>
                  <td style={td}>{row.page_label || `P${row.page_number + 1}`}</td>
                  <td style={td} title={row.revision}>{row.revision?.slice(0, 10) || ""}</td>
                  <td style={td}>
                    <span style={{ ...typeTag, background: row.type === "heading1" ? "#e74c3c" : row.type === "heading2" ? "#f39c12" : row.type === "notes" ? "#95a5a6" : "#2ecc71" }}>
                      {row.type === "heading1" ? "H1" : row.type === "heading2" ? "H2" : row.type === "notes" ? "Note" : "Item"}
                    </span>
                  </td>
                  {EDITABLE_COLS.map((field, colIdx) => {
                    const focused = isCellFocused(rowIdx, colIdx);
                    const selected = isCellSelected(rowIdx, colIdx);
                    const editing = isEditing && editingCell!.field === field;
                    const isWide = field === "description";
                    const isNum = ["quantity", "rate", "total"].includes(field);
                    const cellVal = getCellValue(row, field);
                    const isUserEdited = row.user_edited && (row.user_edited as any)[field];

                    const cellStyle: React.CSSProperties = {
                      padding: "1px 2px",
                      borderBottom: "1px solid #e0e0e0",
                      borderRight: "1px solid #eee",
                      whiteSpace: isWide ? "normal" : "nowrap",
                      minWidth: isWide ? 180 : isNum ? 65 : 50,
                      maxWidth: isWide ? 320 : undefined,
                      position: "relative",
                      background: editing ? "#fff" : focused ? "#d4e6fc" : selected ? "#e8f0fe" : "inherit",
                      outline: focused ? "2px solid #1a73e8" : selected ? "1px solid #a8c7fa" : "none",
                      outlineOffset: focused ? "-2px" : "-1px",
                      cursor: "cell",
                      textAlign: isNum ? "right" : "left",
                      color: isUserEdited ? "#1a73e8" : "inherit",
                      fontWeight: isUserEdited ? 600 : "inherit",
                    };

                    return (
                      <td key={field} style={cellStyle} onClick={(e) => handleCellClick(rowIdx, colIdx, e)} onDoubleClick={() => handleCellDoubleClick(rowIdx, colIdx)}>
                        {editing ? (
                          field === "description" ? (
                            <textarea
                              style={editInputStyle}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={handleSaveEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") { e.stopPropagation(); handleCancelEdit(); }
                                if (e.key === "Enter" && e.ctrlKey) { e.stopPropagation(); e.preventDefault(); saveAndMove(1, 0); }
                                if (e.key === "Tab") { e.stopPropagation(); e.preventDefault(); saveAndMove(0, e.shiftKey ? -1 : 1); }
                              }}
                              autoFocus
                              rows={3}
                            />
                          ) : (
                            <input
                              style={{ ...editInputStyle, textAlign: isNum ? "right" : "left" }}
                              type={isNum ? "number" : "text"}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={handleSaveEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") { e.stopPropagation(); handleCancelEdit(); }
                                if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); saveAndMove(1, 0); }
                                if (e.key === "Tab") { e.stopPropagation(); e.preventDefault(); saveAndMove(0, e.shiftKey ? -1 : 1); }
                              }}
                              autoFocus
                            />
                          )
                        ) : (
                          <div style={{ padding: "3px 4px", minHeight: 18, overflow: "hidden", textOverflow: "ellipsis" }} title={cellVal}>
                            {cellVal || <span style={{ color: "#ccc" }}>-</span>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "center" }}>
                    <button style={deleteBtn} onClick={() => onDeleteRow(pageKey, row.id)} title="Delete">🗑️</button>
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
  display: "flex", flexDirection: "column", height: "100%", background: "#fff", overflow: "hidden",
};

const headerBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "8px 12px", background: "#f0f0f0", borderBottom: "1px solid #e0e0e0", flexWrap: "wrap", gap: 8,
};

const filterSelect: React.CSSProperties = { padding: "4px 8px", fontSize: 11, border: "1px solid #ddd", borderRadius: 4 };

const exportBtn: React.CSSProperties = {
  padding: "6px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 4, background: "#2ecc71", color: "#fff", cursor: "pointer",
};

const statsBar: React.CSSProperties = {
  display: "flex", gap: 16, padding: "8px 12px", background: "#fafafa", borderBottom: "1px solid #eee", fontSize: 11,
};

const statItem: React.CSSProperties = { color: "#666" };

const emptyState: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 14,
};

const errorStyle: React.CSSProperties = {
  margin: "8px 12px", padding: "8px 10px", background: "#fff3cd", border: "1px solid #ffeeba",
  borderRadius: 4, fontSize: 12, color: "#856404", display: "flex", justifyContent: "space-between", alignItems: "center",
};

const dismissBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#856404" };

const tableContainer: React.CSSProperties = { flex: 1, overflow: "auto", outline: "none" };

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "auto" };

const headerRow: React.CSSProperties = { background: "#f5f5f5", position: "sticky", top: 0, zIndex: 2 };

const th: React.CSSProperties = {
  padding: "6px 6px", textAlign: "left", borderBottom: "2px solid #ccc", borderRight: "1px solid #e0e0e0",
  fontWeight: 600, whiteSpace: "nowrap", fontSize: 10, color: "#555", background: "#f0f0f0", userSelect: "none",
};

const thEditCol: React.CSSProperties = { ...th, background: "#e8f0fe", color: "#1a73e8" };

const thEditColWide: React.CSSProperties = { ...thEditCol, minWidth: 180 };

const td: React.CSSProperties = {
  padding: "3px 6px", borderBottom: "1px solid #e0e0e0", borderRight: "1px solid #eee", whiteSpace: "nowrap", fontSize: 11,
};

const editInputStyle: React.CSSProperties = {
  width: "100%", padding: "2px 4px", fontSize: 11, border: "2px solid #1a73e8", borderRadius: 0,
  outline: "none", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" as any, lineHeight: 1.4, resize: "vertical" as any,
};

const typeTag: React.CSSProperties = { padding: "2px 6px", borderRadius: 3, color: "#fff", fontSize: 9, fontWeight: 600 };

const deleteBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 12, opacity: 0.6 };

const modalOverlay: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
};

const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 24, minWidth: 320, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
};

const modalBtn: React.CSSProperties = {
  padding: "8px 16px", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500,
};