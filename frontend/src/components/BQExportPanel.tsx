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
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { BQRow, BQPageData, BQItemType } from "../types";
import { exportAnnotatedPdf, type TextAnnotation } from "../api/client";

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const parseNumericInput = (raw: string): number | null => {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const formatMoney = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "";
  return round2(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatQuantity = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/** Available BQ row types that a user can pick from. */
const ROW_TYPE_OPTIONS: { value: BQItemType; label: string }[] = [
  { value: "item",  label: "Item" },
  { value: "notes", label: "Notes" },
  { value: "collection_entry", label: "Collection Entry" },
  { value: "collection_cf", label: "Carry/Brought Fwd" },
  { value: "collection_total", label: "Collection Total" },
];

interface BQExportPanelProps {
  bqPageData: Record<string, BQPageData>;
  onRowEdit: (pageKey: string, rowId: number, field: keyof BQRow, value: any) => void;
  onDeleteRow: (pageKey: string, rowId: number) => void;
  onInsertRow: (pageKey: string, afterRowId: number) => void;
  onNavigateToRow?: (
    fileId: string,
    pageNum: number,
    bbox: { x0: number; y0: number; x1: number; y1: number } | null,
    pageSize?: { width: number; height: number } | null
  ) => void;
  /**
   * Callback to batch-update multiple rows' totals (for recalculate).
   * If not provided, recalculate will use onRowEdit in a loop.
   */
  onBatchRecalculate?: (updates: Array<{ pageKey: string; rowId: number; total: number }>) => void;
  /**
   * When true the user is permitted to download/export in all formats.
   * When false we still show the panel and allow the JSON export, but the
   * other buttons (Excel/CSV/PDF/etc.) will be disabled and a warning shown
   * so the user understands their tier doesn't include full export access.
   */
  canExport?: boolean;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

export function BQExportPanel({
  bqPageData,
  onRowEdit,
  onDeleteRow,
  onInsertRow,
  onNavigateToRow,
  onBatchRecalculate,
  canExport = true,
  onBusyChange,
}: BQExportPanelProps) {
  const buildRowToken = useCallback((row: BQRow): string => {
    return [
      row.file_id,
      row.page_number,
      row.id,
      row.type,
      row.item_no,
      row.description,
      row.bbox_x0 ?? "",
      row.bbox_y0 ?? "",
      row.bbox_x1 ?? "",
      row.bbox_y1 ?? "",
    ].join("|");
  }, []);

  // `canExport` really means "can export formats beyond JSON"; when false we
  // still show the panel and let JSON work, but every other export button will
  // be disabled and the user will see a warning message.
  const limitedExport = !canExport;
  const [filterType, setFilterType] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ pageKey: string; rowId: number; field: string; rowToken: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  // Focused cell (for keyboard nav, highlighted but not editing)
  const [focusedCell, setFocusedCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  // Selection range for copy
  const [selectionStart, setSelectionStart] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    if (!onBusyChange) return;
    if (exporting) {
      onBusyChange(true, "Exporting BQ data...");
    } else {
      onBusyChange(false);
    }
  }, [exporting, onBusyChange]);

  // Export filter state
  const [exportFilterPage, setExportFilterPage] = useState<string>("all");
  const [exportFilterRev, setExportFilterRev] = useState<string>("all");
  const [exportFilterType, setExportFilterType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<{
    key: "page" | "revision" | "type" | "item_no" | "description" | "quantity" | "unit" | "rate" | "total";
    direction: "asc" | "desc";
  } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({
    page: "",
    revision: "",
    type: "",
    item_no: "",
    description: "",
    quantity: "",
    unit: "",
    rate: "",
    total: "",
  });

  // Flatten all rows from all pages, always kept in page order
  const allRows = useMemo(() => {
    const rows: Array<{ pageKey: string; row: BQRow; rowIndex: number }> = [];
    for (const pageData of Object.values(bqPageData)) {
      for (let rowIndex = 0; rowIndex < pageData.rows.length; rowIndex++) {
        const row = pageData.rows[rowIndex];
        const pageKey = `${pageData.file_id}-${pageData.page_number}`;
        rows.push({ pageKey, row, rowIndex });
      }
    }
    // Keep row order exactly as it appears in each page to support insert-below behavior.
    rows.sort((a, b) => {
      if (a.row.file_id !== b.row.file_id) return a.row.file_id.localeCompare(b.row.file_id);
      if (a.row.page_number !== b.row.page_number) return a.row.page_number - b.row.page_number;
      return a.rowIndex - b.rowIndex;
    });
    return rows;
  }, [bqPageData]);

  // Apply filter
  const filteredRows = useMemo(() => {
    const hasText = (v: string | null | undefined, q: string) => (v || "").toLowerCase().includes(q.toLowerCase());

    let rows = allRows;
    if (filterType === "collection") {
      rows = rows.filter(({ row }) => row.page_is_collection);
    } else if (filterType === "collection_entry") {
      rows = rows.filter(({ row }) => row.type === "collection_entry" || row.type === "collection_cf" || row.type === "collection_total");
    } else if (filterType !== "all") {
      rows = rows.filter(({ row }) => row.type === filterType);
    }

    rows = rows.filter(({ row }) => {
      if (columnFilters.page && !hasText(row.page_label, columnFilters.page)) return false;
      if (columnFilters.revision && !hasText(row.revision, columnFilters.revision)) return false;
      if (columnFilters.type && !hasText(row.type, columnFilters.type)) return false;
      if (columnFilters.item_no && !hasText(row.item_no, columnFilters.item_no)) return false;
      if (columnFilters.description && !hasText(row.description, columnFilters.description)) return false;
      if (columnFilters.unit && !hasText(row.unit, columnFilters.unit)) return false;
      if (columnFilters.quantity && !formatQuantity(row.quantity).includes(columnFilters.quantity)) return false;
      if (columnFilters.rate && !formatMoney(row.rate).includes(columnFilters.rate)) return false;
      if (columnFilters.total && !formatMoney(row.total).includes(columnFilters.total)) return false;
      return true;
    });

    if (!sortBy) return rows;
    const sorted = [...rows];
    const getSortValue = (row: BQRow) => {
      switch (sortBy.key) {
        case "page": return row.page_number;
        case "revision": return row.revision || "";
        case "type": return row.type || "";
        case "item_no": return row.item_no || "";
        case "description": return row.description || "";
        case "quantity": return row.quantity ?? Number.NEGATIVE_INFINITY;
        case "unit": return row.unit || "";
        case "rate": return row.rate ?? Number.NEGATIVE_INFINITY;
        case "total": return row.total ?? Number.NEGATIVE_INFINITY;
        default: return "";
      }
    };
    sorted.sort((a, b) => {
      const av = getSortValue(a.row);
      const bv = getSortValue(b.row);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      }
      if (cmp === 0) {
        if (a.row.file_id !== b.row.file_id) return a.row.file_id.localeCompare(b.row.file_id);
        if (a.row.page_number !== b.row.page_number) return a.row.page_number - b.row.page_number;
        return a.rowIndex - b.rowIndex;
      }
      return sortBy.direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [allRows, filterType, columnFilters, sortBy]);

  // Statistics
  const stats = useMemo(() => {
    const itemCount = allRows.filter(r => r.row.type === "item").length;
    const notesCount = allRows.filter(r => r.row.type === "notes").length;
    const collectionEntryCount = allRows.filter(r => r.row.type === "collection_entry" || r.row.type === "collection_cf" || r.row.type === "collection_total").length;
    const pagesWithData = new Set(allRows.map(r => r.pageKey)).size;
    const collectionPages = new Set(allRows.filter(r => r.row.page_is_collection).map(r => r.pageKey)).size;
    return { itemCount, notesCount, collectionEntryCount, total: allRows.length, pagesWithData, collectionPages };
  }, [allRows]);

  // Calculate page totals
  const pageTotals = useMemo(() => {
    const totals: Record<string, {
      pageKey: string; pageLabel: string; pageNumber: number; fileId: string;
      total: number; itemCount: number; isCollection: boolean;
      collectionBox?: { x0: number; y0: number; x1: number; y1: number };
      pageWidth?: number; pageHeight?: number;
    }> = {};
    for (const [pageKey, pageData] of Object.entries(bqPageData)) {
      let itemCount = 0, pageLabel = "";
      const isCollection = pageData.page_is_collection || pageData.rows.some(r => r.page_is_collection);
      for (const row of pageData.rows) {
        if (row.type === "item" && row.total !== null) itemCount++;
        if (!pageLabel && row.page_label) pageLabel = row.page_label;
      }
      let pageTotal = 0;
      for (const row of pageData.rows) {
        if (isCollection) {
          if ((row.type === "collection_entry" || row.type === "item") && row.total !== null) pageTotal += row.total;
        } else {
          if (row.type === "item" && row.total !== null) pageTotal += row.total;
        }
      }
      const collectionBox = pageData.boxes["Collection"];
      const firstRow = pageData.rows[0];
      totals[pageKey] = {
        pageKey, pageLabel, pageNumber: pageData.page_number, fileId: pageData.file_id,
        total: pageTotal, itemCount, isCollection,
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

  // Grand total excludes collection pages to avoid double-counting
  const grandTotal = useMemo(() => Object.values(pageTotals).filter(pt => !pt.isCollection).reduce((sum, pt) => sum + pt.total, 0), [pageTotals]);

  // Build page label lookup for collection page reference mapping
  const pageLabelLookup = useMemo(() => {
    const lookup: Record<string, { pageKey: string; total: number }> = {};
    for (const pt of Object.values(pageTotals)) {
      if (!pt.isCollection && pt.pageLabel) {
        lookup[pt.pageLabel] = { pageKey: pt.pageKey, total: pt.total };
      }
    }
    return lookup;
  }, [pageTotals]);

  // Fuzzy page label match: find a matching page label for a given reference string.
  // Tries exact match first, then checks if ref is contained in any label or vice versa.
  const findPageLabel = useCallback((ref: string): string | null => {
    if (!ref) return null;
    if (pageLabelLookup[ref]) return ref;

    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const refNorm = normalize(ref);

    for (const label of Object.keys(pageLabelLookup)) {
      if (normalize(label) === refNorm) return label;
    }

    // Try substring match: e.g. ref="4.5/1" matches label="Page No.4.5/1"
    for (const label of Object.keys(pageLabelLookup)) {
      if (label.includes(ref) || ref.includes(label)) return label;
    }

    if (refNorm) {
      for (const label of Object.keys(pageLabelLookup)) {
        const labelNorm = normalize(label);
        if (labelNorm && (labelNorm.includes(refNorm) || refNorm.includes(labelNorm))) return label;
      }
    }

    return null;
  }, [pageLabelLookup]);

  // Available page labels for collection entry dropdown
  const availablePageOptions = useMemo(() => {
    return Object.values(pageTotals)
      .filter((pt) => !pt.isCollection && pt.pageLabel)
      .sort((a, b) => {
        if (a.fileId !== b.fileId) return a.fileId.localeCompare(b.fileId);
        return a.pageNumber - b.pageNumber;
      })
      .map((pt) => ({
        value: pt.pageLabel,
        label: `Page ${pt.pageNumber + 1} (${pt.pageLabel})`,
      }));
  }, [pageTotals]);

  // ──────────────────────────────────────────────────────────────────────────
  // Recalculate: rate × qty → total for all items, then page totals,
  // then collection page totals
  // ──────────────────────────────────────────────────────────────────────────
  const handleRecalculate = useCallback(() => {
    const updates: Array<{ pageKey: string; rowId: number; total: number }> = [];

    // Step 1: Recalculate rate × qty → total for all items
    for (const { pageKey, row } of allRows) {
      if (row.type === "item" && row.quantity != null && row.rate != null) {
        const newTotal = round2(row.quantity * row.rate);
        if (row.total !== newTotal) {
          updates.push({ pageKey, rowId: row.id, total: newTotal });
        }
      }
    }

    // Step 2: For collection_entry rows, map referenced page total (with fuzzy matching)
    for (const { pageKey, row } of allRows) {
      if (row.type === "collection_entry" && row.item_no) {
        const matchedLabel = findPageLabel(row.item_no);
        const refData = matchedLabel ? pageLabelLookup[matchedLabel] : null;
        if (refData) {
          // Auto-fix item_no to the matched label if different
          if (matchedLabel !== row.item_no) {
            onRowEdit(pageKey, row.id, "item_no", matchedLabel);
          }
          // Use the page total of the referenced page
          // (recalculated page total, not the OCR one)
          let recalcPageTotal = 0;
          const refPageData = bqPageData[refData.pageKey];
          if (refPageData) {
            for (const r of refPageData.rows) {
              if (r.type === "item" && r.total != null) {
                // Check if this row has a pending update
                const upd = updates.find(u => u.pageKey === refData.pageKey && u.rowId === r.id);
                recalcPageTotal += upd ? upd.total : r.total;
              }
            }
          }
          recalcPageTotal = round2(recalcPageTotal);
          if (row.total !== recalcPageTotal) {
            updates.push({ pageKey, rowId: row.id, total: recalcPageTotal });
          }
        }
      }
    }

    // Apply updates
    if (onBatchRecalculate) {
      onBatchRecalculate(updates);
    } else {
      for (const { pageKey, rowId, total } of updates) {
        onRowEdit(pageKey, rowId, "total", total);
        onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, { total: true });
      }
    }
  }, [allRows, pageLabelLookup, findPageLabel, bqPageData, onBatchRecalculate, onRowEdit]);

  // Listen for external recalculate trigger (from toolbar button)
  useEffect(() => {
    const handler = () => handleRecalculate();
    window.addEventListener("bq-recalculate", handler);
    return () => window.removeEventListener("bq-recalculate", handler);
  }, [handleRecalculate]);

  // Handle collection entry page ref change (dropdown)
  const handleCollectionRefChange = useCallback((pageKey: string, rowId: number, newRef: string) => {
    onRowEdit(pageKey, rowId, "item_no", newRef);
    // Auto-fill total from referenced page
    const refData = pageLabelLookup[newRef];
    if (refData) {
      onRowEdit(pageKey, rowId, "total", round2(refData.total));
      onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, { total: true });
    }
  }, [onRowEdit, pageLabelLookup]);

  const tryAutoMatchCollectionEntry = useCallback((pageKey: string, row: BQRow) => {
    const candidates = [row.item_no, row.description, row.page_label].filter(Boolean) as string[];
    for (const c of candidates) {
      const matched = findPageLabel(c);
      if (matched) {
        handleCollectionRefChange(pageKey, row.id, matched);
        onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, {
          ...(row.user_edited || {}),
          item_no: true,
          total: true,
          type: true,
        });
        return;
      }
    }
  }, [findPageLabel, handleCollectionRefChange, onRowEdit]);

  const handleTypeChange = useCallback((pageKey: string, row: BQRow, newType: BQItemType) => {
    onRowEdit(pageKey, row.id, "type", newType);
    onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, { ...(row.user_edited || {}), type: true });

    if (newType !== "collection_entry") return;

    const pageData = bqPageData[pageKey];
    if (!pageData) {
      tryAutoMatchCollectionEntry(pageKey, row);
      return;
    }

    const pageIsCollection = pageData.page_is_collection || row.page_is_collection;
    if (pageIsCollection) {
      for (const target of pageData.rows) {
        if (["item", "notes", "collection_entry"].includes(target.type)) {
          onRowEdit(pageKey, target.id, "type", "collection_entry");
          onRowEdit(pageKey, target.id, "user_edited" as keyof BQRow, {
            ...(target.user_edited || {}),
            type: true,
          });
          tryAutoMatchCollectionEntry(pageKey, { ...target, type: "collection_entry" });
        }
      }
      return;
    }

    tryAutoMatchCollectionEntry(pageKey, { ...row, type: "collection_entry" });
  }, [onRowEdit, bqPageData, tryAutoMatchCollectionEntry]);

  const handleSortToggle = useCallback((key: NonNullable<typeof sortBy>["key"]) => {
    setSortBy((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }, []);

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
    setEditingCell({ pageKey, rowId, field, rowToken: buildRowToken(row) });
    setEditValue(String(currentValue ?? ""));
    if (onNavigateToRow && row.file_id) {
      const bbox = (row.bbox_x0 !== undefined && row.bbox_y0 !== undefined &&
                    row.bbox_x1 !== undefined && row.bbox_y1 !== undefined)
        ? { x0: row.bbox_x0, y0: row.bbox_y0, x1: row.bbox_x1, y1: row.bbox_y1 } : null;
      const pageSize = (row.page_width && row.page_height) ? { width: row.page_width, height: row.page_height } : null;
      onNavigateToRow(row.file_id, row.page_number, bbox, pageSize);
    }
  }, [onNavigateToRow, buildRowToken]);

  // If data got replaced (e.g. re-OCR same page), cancel stale edit mode so
  // old input cannot be committed onto newly extracted rows.
  useEffect(() => {
    if (!editingCell) return;
    const entry = allRows.find((r) => r.pageKey === editingCell.pageKey && r.row.id === editingCell.rowId);
    if (!entry) {
      setEditingCell(null);
      setEditValue("");
      return;
    }
    const currentToken = buildRowToken(entry.row);
    if (currentToken !== editingCell.rowToken) {
      setEditingCell(null);
      setEditValue("");
    }
  }, [editingCell, allRows, buildRowToken]);

  const handleSaveEdit = useCallback(() => {
    if (!editingCell) return;
    const { pageKey, rowId, field } = editingCell;
    let value: any = editValue;
    if (["quantity", "rate", "total"].includes(field)) {
      value = parseNumericInput(editValue);
      if (field === "rate" || field === "total") {
        value = value == null ? null : round2(value);
      }
    }
    const currentRowEntry = allRows.find(r => r.pageKey === pageKey && r.row.id === rowId);
    if (!currentRowEntry) {
      setEditingCell(null);
      setEditValue("");
      setTimeout(() => tableRef.current?.focus(), 0);
      return;
    }

    if (currentRowEntry && buildRowToken(currentRowEntry.row) !== editingCell.rowToken) {
      setEditingCell(null);
      setEditValue("");
      setTimeout(() => tableRef.current?.focus(), 0);
      return;
    }

    const currentRow = currentRowEntry?.row;
    const newQty = field === "quantity" ? value : currentRow?.quantity;
    const newRate = field === "rate" ? value : currentRow?.rate;
    const autoCalcTotal = (field === "rate" || field === "quantity") && newQty != null && newRate != null;
    if (currentRow && ["quantity", "rate", "total"].includes(field)) {
      const userEdited = currentRow.user_edited || {};
      // Also mark total as user_edited when it's auto-calculated from rate×qty
      onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, {
        ...userEdited,
        [field]: true,
        ...(autoCalcTotal ? { total: true } : {}),
      });
    }
    onRowEdit(pageKey, rowId, field as keyof BQRow, value);
    if (autoCalcTotal) {
      onRowEdit(pageKey, rowId, "total", round2(newQty! * newRate!));
    }

    if (field === "total" && value != null && currentRow) {
      const currentRate = currentRow.rate;
      const currentQty = currentRow.quantity;
      if (currentRate != null && currentRate > 0) {
        const nextQty = Math.max(1, Math.round(Math.ceil(value / currentRate)));
        const nextTotal = round2(currentRate * nextQty);
        onRowEdit(pageKey, rowId, "quantity", nextQty);
        onRowEdit(pageKey, rowId, "total", nextTotal);
        onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, {
          ...(currentRow.user_edited || {}),
          quantity: true,
          total: true,
        });
      } else if (currentQty != null && currentQty > 0) {
        const nextRate = round2(value / currentQty);
        const nextTotal = round2(nextRate * currentQty);
        onRowEdit(pageKey, rowId, "rate", nextRate);
        onRowEdit(pageKey, rowId, "total", nextTotal);
        onRowEdit(pageKey, rowId, "user_edited" as keyof BQRow, {
          ...(currentRow.user_edited || {}),
          rate: true,
          total: true,
        });
      }
    }
    setEditingCell(null);
    setEditValue("");
    // Restore keyboard focus to the table so arrow-key navigation keeps working
    setTimeout(() => tableRef.current?.focus(), 0);
  }, [editingCell, editValue, allRows, onRowEdit, tableRef, buildRowToken]);

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
    setTimeout(() => tableRef.current?.focus(), 0);
  }, [tableRef]);

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
    } else {
      // Ensure table container has keyboard focus so arrow keys work, not the scrollbar
      setTimeout(() => tableRef.current?.focus(), 0);
    }
  }, [filteredRows, handleStartEdit, getCellValue, tableRef]);

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

      // Track what values are pasted in this row for auto-total calculation
      let rowPastedRate: number | null | undefined = undefined;
      let rowPastedQty: number | null | undefined = undefined;
      let rowPastedTotal: number | null | undefined = undefined;

      for (let dc = 0; dc < cols.length; dc++) {
        const colIdx = focusedCell.colIdx + dc;
        if (colIdx >= EDITABLE_COLS.length) break;
        const field = EDITABLE_COLS[colIdx];
        let value: any = cols[dc];
        if (["quantity", "rate", "total"].includes(field)) {
          const num = parseNumericInput(value);
          value = num == null ? null : num;
          if (field === "rate" || field === "total") {
            value = value == null ? null : round2(value);
          }
          onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, { ...(row.user_edited || {}), [field]: true });
          if (field === "rate") rowPastedRate = value;
          if (field === "quantity") rowPastedQty = value;
          if (field === "total") rowPastedTotal = value;
        }
        onRowEdit(pageKey, row.id, field as keyof BQRow, value);
      }

      // Auto-calculate total when rate or qty was pasted and the other value is available
      const effectiveRate = rowPastedRate !== undefined ? rowPastedRate : row.rate;
      const effectiveQty  = rowPastedQty  !== undefined ? rowPastedQty  : row.quantity;
      const shouldAutoCalc = (rowPastedRate !== undefined || rowPastedQty !== undefined)
                            && effectiveRate != null && effectiveQty != null;
      if (shouldAutoCalc) {
        onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, {
          ...(row.user_edited || {}),
          ...(rowPastedRate !== undefined ? { rate: true } : {}),
          ...(rowPastedQty  !== undefined ? { quantity: true } : {}),
          total: true,
        });
        onRowEdit(pageKey, row.id, "total", round2(effectiveQty! * effectiveRate!));
      } else if (rowPastedTotal != null) {
        const effectiveRateFromRow = rowPastedRate !== undefined ? rowPastedRate : row.rate;
        const effectiveQtyFromRow = rowPastedQty !== undefined ? rowPastedQty : row.quantity;
        if (effectiveRateFromRow != null && effectiveRateFromRow > 0) {
          const nextQty = Math.max(1, Math.round(Math.ceil(rowPastedTotal / effectiveRateFromRow)));
          const nextTotal = round2(effectiveRateFromRow * nextQty);
          onRowEdit(pageKey, row.id, "quantity", nextQty);
          onRowEdit(pageKey, row.id, "total", nextTotal);
          onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, {
            ...(row.user_edited || {}),
            quantity: true,
            total: true,
          });
        } else if (effectiveQtyFromRow != null && effectiveQtyFromRow > 0) {
          const nextRate = round2(rowPastedTotal / effectiveQtyFromRow);
          const nextTotal = round2(nextRate * effectiveQtyFromRow);
          onRowEdit(pageKey, row.id, "rate", nextRate);
          onRowEdit(pageKey, row.id, "total", nextTotal);
          onRowEdit(pageKey, row.id, "user_edited" as keyof BQRow, {
            ...(row.user_edited || {}),
            rate: true,
            total: true,
          });
        }
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
      case "Insert":
        e.preventDefault();
        {
          const { pageKey: pk, row: rw } = filteredRows[focusedCell.rowIdx];
          onInsertRow(pk, rw.id);
          // Move focus to the newly inserted row (next row, description col)
          setTimeout(() => focusCell(focusedCell.rowIdx + 1, 1), 50);
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
      handleCancelEdit, saveAndMove, focusCell, handleStartEdit, onRowEdit, onInsertRow]);

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
    const filtered = allRows.filter(({ row }) => {
      if (exportFilterPage !== "all" && row.page_label !== exportFilterPage) return false;
      if (exportFilterRev !== "all" && row.revision !== exportFilterRev) return false;
      if (exportFilterType !== "all" && row.type !== exportFilterType) return false;
      return true;
    });
    // always export in page order (and by file if multiple PDFs)
    return filtered.sort((a, b) => {
      if (a.row.file_id !== b.row.file_id) return a.row.file_id.localeCompare(b.row.file_id);
      if (a.row.page_number !== b.row.page_number) return a.row.page_number - b.row.page_number;
      const pageA = bqPageData[`${a.row.file_id}-${a.row.page_number}`];
      const pageB = bqPageData[`${b.row.file_id}-${b.row.page_number}`];
      const idxA = pageA ? pageA.rows.findIndex((r) => r.id === a.row.id) : 0;
      const idxB = pageB ? pageB.rows.findIndex((r) => r.id === b.row.id) : 0;
      return idxA - idxB;
    });
  };

  const buildExportData = (pid: string) => {
    return getFilteredExportRows().map(({ row }, idx) => {
      const { bill, page } = parseBillPage(row.page_label || "");
      const ref = buildRef(row);
      const hasQty = row.type === "item";
      const typeLabel = row.type === "item" ? "Item" : row.type === "notes" ? "Notes" : row.type;
      return {
        id: idx + 1, project_id: pid,
        Type: typeLabel,
        bill, page, item: row.item_no, revision: row.revision, ref,
        data_detail: row.description,
        data_X1: row.bbox_x0?.toString() ?? "", data_X2: row.bbox_x1?.toString() ?? "",
        data_Y1: row.bbox_y0?.toString() ?? "", data_Y2: row.bbox_y1?.toString() ?? "",
        page_width: row.page_width?.toString() ?? "", page_height: row.page_height?.toString() ?? "",
        ...(hasQty ? {
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
        if (row.type === "item" && row.user_edited) {
        const pw = row.page_width ?? 1;
        if (row.user_edited.quantity && row.quantity !== null && qtyBox) {
          const annId = `auto-qty-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: formatQuantity(row.quantity), x: stored?.x ?? ((qtyBox.x + qtyBox.width) * pw), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" });
        }
        if (row.user_edited.rate && row.rate !== null && rateBox) {
          const annId = `auto-rate-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: formatMoney(row.rate), x: stored?.x ?? ((rateBox.x + rateBox.width) * pw), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" });
        }
        if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && row.total !== null && totalBox) {
          const annId = `auto-total-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: formatMoney(row.total), x: stored?.x ?? ((totalBox.x + totalBox.width) * pw), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" });
        }
        }
        // Collection entry totals
        if (row.type === "collection_entry" && row.total != null && row.total > 0 && totalBox) {
          const pw = row.page_width ?? 1;
          const annId = `auto-coll-total-${row.id}`;
          const stored = storedPositions[annId];
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: formatMoney(row.total), x: stored?.x ?? ((totalBox.x + totalBox.width) * pw), y: stored?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" });
        }
      }
      if (collectionBox && pageData.rows.length > 0) {
        const pageTotal = pageTotals[pageKey]?.total ?? 0;
        if (pageTotal > 0) {
          const fr = pageData.rows[0];
          const pw = fr?.page_width ?? 1, ph = fr?.page_height ?? 1;
          const annId = `auto-pagetotal-${pageKey}`;
          const stored = storedPositions[annId];
          // Center in the collection box
          allAnnotations.push({ page_key: pageKey, file_id: pageData.file_id, page_number: pageData.page_number, id: annId, text: `$${pageTotal.toFixed(2)}`, x: stored?.x ?? ((collectionBox.x + collectionBox.width / 2) * pw), y: stored?.y ?? ((collectionBox.y + collectionBox.height * 0.5) * ph), font_size: 10, color: "#008000", bold: true, align: "center" });
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
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: formatQuantity(row.quantity), x: s?.x ?? ((qtyBox.x + qtyBox.width) * pw), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" as const });
            }
            if (row.user_edited.rate && row.rate !== null && rateBox) {
              const id = `auto-rate-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: formatMoney(row.rate), x: s?.x ?? ((rateBox.x + rateBox.width) * pw), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" as const });
            }
            if ((row.user_edited.total || (row.user_edited.rate && row.user_edited.quantity)) && row.total !== null && totalBox) {
              const id = `auto-total-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: formatMoney(row.total), x: s?.x ?? ((totalBox.x + totalBox.width) * pw), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" as const });
            }
          }
          // Collection entry rows: stamp total next to the row on the collection page
          if (row.type === "collection_entry" && row.total != null && row.total > 0) {
            const pageData = bqPageData[pageKey]; if (!pageData) continue;
            const sp = pageData.annotation_positions || {};
            const totalBox = pageData.boxes["Total"];
            const pw = row.page_width ?? 1;
            if (totalBox) {
              const id = `auto-coll-total-${row.id}`; const s = sp[id];
              annotations.push({ file_id: row.file_id, page_number: row.page_number, text: formatMoney(row.total), x: s?.x ?? ((totalBox.x + totalBox.width) * pw), y: s?.y ?? ((row.bbox_y0 ?? 0) + 12), font_size: 9, color: "#0000FF", align: "right" as const });
            }
          }
        }
        for (const [pageKey, pt] of Object.entries(pageTotals)) {
          if (pt.total > 0 && pt.collectionBox) {
            const pd = bqPageData[pageKey]; const sp = pd?.annotation_positions || {};
            const id = `auto-pagetotal-${pageKey}`; const s = sp[id];
            // Center in the collection box
            const cx = (pt.collectionBox.x0 + pt.collectionBox.x1) / 2;
            const cy = (pt.collectionBox.y0 + pt.collectionBox.y1) / 2;
            annotations.push({ file_id: pt.fileId, page_number: pt.pageNumber, text: `$${pt.total.toFixed(2)}`, x: s?.x ?? cx, y: s?.y ?? cy, font_size: 10, color: "#008000", bold: true, align: "center" as const });
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
            <option value="collection">Collection pages ({stats.collectionPages})</option>
            {stats.collectionEntryCount > 0 && <option value="collection_entry">Collection entries ({stats.collectionEntryCount})</option>}
          </select>
          <button
            style={exportBtn}
            onClick={() => setShowExportModal(true)}
            disabled={exporting || allRows.length === 0}
            title="Export data"
          >
            📥 Export
          </button>
          {limitedExport && (
            <span style={{ marginLeft: 8, fontSize: 10, color: "#e74c3c" }}>JSON only</span>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div style={statsBar}>
        <span style={statItem}>📄 {stats.pagesWithData} pages</span>
        <span style={statItem}>📋 {stats.total} rows</span>
        <span style={statItem}>🟢 {stats.itemCount} items</span>
        <span style={statItem}>📝 {stats.notesCount} notes</span>
        <span style={statItem}>📦 {stats.collectionPages} coll.pages</span>
        {grandTotal > 0 && (
          <span style={{ ...statItem, fontWeight: 700, color: "#27ae60" }} title="Excludes collection pages to avoid double-counting">
            💰 Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {stats.collectionPages > 0 && <span style={{ fontSize: 9, fontWeight: 400, color: "#888", marginLeft: 4 }}>(excl. collection)</span>}
          </span>
        )}
        <button
          onClick={handleRecalculate}
          style={{
            marginLeft: "auto",
            background: "#3498db",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "3px 10px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
          title="Recalculate: rate × qty → total for all items, then update page totals and collection page totals"
        >
          🔄 重新計算
        </button>
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
        <span>Insert 插入列</span>
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
            {limitedExport && (
              <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", border: "1px solid #ffeeba", borderRadius: 4, color: "#856404", fontSize: 12 }}>
                ⚠️ 您的會員等級目前只允許導出 JSON，其他格式已被禁用。
              </div>
            )}
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
                  <option value="all">All Types</option><option value="item">Items</option><option value="notes">Notes</option>
                </select>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{getFilteredExportRows().length} of {allRows.length} rows will be exported</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button style={{ ...modalBtn, background: "#95a5a6" }} onClick={() => setShowExportModal(false)}>Cancel</button>
              <button style={{ ...modalBtn, background: "#3498db" }} onClick={handleExportJSON}>📄 JSON</button>
              <button
                style={{ ...modalBtn, background: "#2ecc71" }}
                onClick={handleExportExcel}
                disabled={exporting || limitedExport}
                title={limitedExport ? "只有 JSON 可用；升級以解鎖其他格式" : undefined}
              >
                {exporting ? "⏳..." : "📊 Excel (CSV)"}
              </button>
              <button
                style={{ ...modalBtn, background: "#16a085" }}
                onClick={handleExportPageTotals}
                disabled={exporting || limitedExport}
                title={limitedExport ? "只有 JSON 可用；升級以解鎖其他格式" : undefined}
              >
                {exporting ? "⏳..." : "📋 Page Totals"}
              </button>
              <button
                style={{ ...modalBtn, background: "#e74c3c" }}
                onClick={() => handleExportPDF(false)}
                disabled={exporting || limitedExport}
                title={limitedExport ? "只有 JSON 可用；升級以解鎖其他格式" : undefined}
              >
                {exporting ? "⏳..." : "📄 PDF (原版)"}
              </button>
              <button
                style={{ ...modalBtn, background: "#9b59b6" }}
                onClick={() => handleExportPDF(true)}
                disabled={exporting || limitedExport}
                title={limitedExport ? "只有 JSON 可用；升級以解鎖其他格式" : undefined}
              >
                {exporting ? "⏳..." : "📝 PDF (含用戶輸入)"}
              </button>
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
              <th style={thSortable} onClick={() => handleSortToggle("page")} title="Sort by page">Page {sortBy?.key === "page" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thSortable} onClick={() => handleSortToggle("revision")} title="Sort by revision">Rev {sortBy?.key === "revision" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thSortable} onClick={() => handleSortToggle("type")} title="Sort by type">Type {sortBy?.key === "type" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditSortable} onClick={() => handleSortToggle("item_no")} title="Sort by item no">Item {sortBy?.key === "item_no" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditWideSortable} onClick={() => handleSortToggle("description")} title="Sort by description">Description {sortBy?.key === "description" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditSortable} onClick={() => handleSortToggle("quantity")} title="Sort by quantity">Qty {sortBy?.key === "quantity" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditSortable} onClick={() => handleSortToggle("unit")} title="Sort by unit">Unit {sortBy?.key === "unit" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditSortable} onClick={() => handleSortToggle("rate")} title="Sort by rate">Rate {sortBy?.key === "rate" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={thEditSortable} onClick={() => handleSortToggle("total")} title="Sort by total">Total {sortBy?.key === "total" ? (sortBy.direction === "asc" ? "▲" : "▼") : "↕"}</th>
              <th style={th}>Action</th>
            </tr>
            <tr style={filterRowStyle}>
              <th style={thFilterCell}></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.page} onChange={(e) => setColumnFilters((p) => ({ ...p, page: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.revision} onChange={(e) => setColumnFilters((p) => ({ ...p, revision: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.type} onChange={(e) => setColumnFilters((p) => ({ ...p, type: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.item_no} onChange={(e) => setColumnFilters((p) => ({ ...p, item_no: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.description} onChange={(e) => setColumnFilters((p) => ({ ...p, description: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.quantity} onChange={(e) => setColumnFilters((p) => ({ ...p, quantity: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.unit} onChange={(e) => setColumnFilters((p) => ({ ...p, unit: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.rate} onChange={(e) => setColumnFilters((p) => ({ ...p, rate: e.target.value }))} /></th>
              <th style={thFilterCell}><input style={headerFilterInput} placeholder="filter" value={columnFilters.total} onChange={(e) => setColumnFilters((p) => ({ ...p, total: e.target.value }))} /></th>
              <th style={thFilterCell}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ pageKey, row }, rowIdx) => {
              const isEditing = editingCell?.pageKey === pageKey && editingCell?.rowId === row.id;
              const isCollectionRow = row.type === "collection_entry" || row.type === "collection_cf" || row.type === "collection_total";
              const rowBg = row.type === "notes" ? "#f5f5f5" : isCollectionRow ? "#f0f5ff" : "#fff";

              const getTypeColor = () => {
                switch (row.type) {
                  case "notes": return "#95a5a6";
                  case "collection_entry": return "#3498db";
                  case "collection_cf": return "#8e44ad";
                  case "collection_total": return "#2c3e50";
                  default: return "#2ecc71";
                }
              };

              return (
                <tr key={`${pageKey}-${row.id}`} style={{ background: rowBg, fontStyle: row.type === "notes" ? "italic" : "normal" }}>
                  <td style={{ ...td, color: "#aaa", fontSize: 9, textAlign: "center", width: 28 }}>{rowIdx + 1}</td>
                  <td style={td}>{row.page_label || `P${row.page_number + 1}`}</td>
                  <td style={td} title={row.revision}>{row.revision?.slice(0, 10) || ""}</td>
                  <td style={td}>
                    <select
                      value={row.type}
                      onChange={(e) => {
                                    handleTypeChange(pageKey, row, e.target.value as BQItemType);
                      }}
                      style={{
                        ...typeTag,
                        background: getTypeColor(),
                        border: "none",
                        cursor: "pointer",
                        appearance: "none",
                        WebkitAppearance: "none",
                        paddingRight: 12,
                      }}
                      title="點擊更改類型"
                    >
                      {ROW_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
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

                    // Special rendering for collection_entry item_no: dropdown with page refs
                    const isCollectionItemField = isCollectionRow && field === "item_no";

                    return (
                      <td key={field} style={cellStyle} onClick={(e) => handleCellClick(rowIdx, colIdx, e)} onDoubleClick={() => handleCellDoubleClick(rowIdx, colIdx)}>
                        {isCollectionItemField ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "1px 2px" }}>
                            <select
                              value={row.item_no || ""}
                              onChange={(e) => handleCollectionRefChange(pageKey, row.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              style={{
                                flex: 1,
                                padding: "2px 4px",
                                fontSize: 11,
                                border: "1px solid #a8c7fa",
                                borderRadius: 3,
                                background: "#f0f5ff",
                                cursor: "pointer",
                                minWidth: 80,
                              }}
                              title="Select referenced page"
                            >
                              <option value="">-- 選擇頁面 --</option>
                              {availablePageOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                              {/* If current value not in list, still show it */}
                              {row.item_no && !availablePageOptions.some((o) => o.value === row.item_no) && (
                                <option value={row.item_no}>{row.item_no} (unmatched)</option>
                              )}
                            </select>
                          </div>
                        ) : editing ? (
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
                              type="text"
                              inputMode={isNum ? "decimal" : "text"}
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
                            {(isNum ? (field === "quantity" ? formatQuantity(row.quantity) : formatMoney((row as any)[field])) : cellVal) || <span style={{ color: "#ccc" }}>-</span>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "center" }}>
                    <button style={addBtn} onClick={() => onInsertRow(pageKey, row.id)} title="Insert a row below">➕</button>
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

const thSortable: React.CSSProperties = { ...th, cursor: "pointer" };
const thEditSortable: React.CSSProperties = { ...thEditCol, cursor: "pointer" };
const thEditWideSortable: React.CSSProperties = { ...thEditColWide, cursor: "pointer" };
const filterRowStyle: React.CSSProperties = { background: "#fafafa", position: "sticky", top: 28, zIndex: 2 };
const thFilterCell: React.CSSProperties = {
  padding: "3px 4px",
  borderBottom: "1px solid #ddd",
  borderRight: "1px solid #e0e0e0",
  background: "#fafafa",
};
const headerFilterInput: React.CSSProperties = {
  width: "100%",
  padding: "2px 4px",
  fontSize: 10,
  border: "1px solid #d8d8d8",
  borderRadius: 3,
  boxSizing: "border-box",
};

const td: React.CSSProperties = {
  padding: "3px 6px", borderBottom: "1px solid #e0e0e0", borderRight: "1px solid #eee", whiteSpace: "nowrap", fontSize: 11,
};

const editInputStyle: React.CSSProperties = {
  width: "100%", padding: "2px 4px", fontSize: 11, border: "2px solid #1a73e8", borderRadius: 0,
  outline: "none", background: "#fff", fontFamily: "inherit", boxSizing: "border-box" as any, lineHeight: 1.4, resize: "vertical" as any,
};

const typeTag: React.CSSProperties = { padding: "2px 6px", borderRadius: 3, color: "#fff", fontSize: 9, fontWeight: 600 };

const deleteBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 12, opacity: 0.6 };
const addBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 12, opacity: 0.8, marginRight: 4 };

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