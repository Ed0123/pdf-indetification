/** Relative bounding box (0-1) for a text extraction region on a PDF page. */
export interface BoxInfo {
  column_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-page state: extracted text and drawn boxes, keyed by column name. */
export interface PageData {
  page_number: number;
  extracted_data: Record<string, string>;
  boxes: Record<string, BoxInfo>;
  applied_template?: string;   // name of the last applied template (display only)
}

/** A single imported PDF file with all its pages. */
export interface PDFFileInfo {
  file_id: string;   // Temporary server-side ID
  file_name: string;
  num_pages: number;
  file_size: number;
  pages: PageData[];
}

/** A user-defined extracted data column. */
export interface ExtractedDataColumn {
  name: string;
  visible: boolean;
}

/** A single extraction box inside a template (includes display color). */
export interface TemplateBox {
  column_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;         // CSS hex color for visual differentiation
}

/** A named template: a saved set of extraction boxes. */
export interface Template {
  id: string;            // UUID
  name: string;
  boxes: TemplateBox[];
  notes: string;
  preview_file_id: string | null;   // PDF file used for thumbnail preview
  preview_page: number;             // Page index for thumbnail
  owner_uid?: string;               // Owner's user ID (from cloud templates)
  owner_name?: string;              // Display name: "我" for self, uid prefix for others
}

/** Full application state (serialised to JSON for Save/Load). */
export interface ProjectState {
  pdf_files: PDFFileInfo[];
  columns: ExtractedDataColumn[];
  templates: Template[];
  selected_file_id: string | null;
  selected_page: number;
}

/** Status/progress info for the status bar. */
export interface StatusInfo {
  message: string;
  progress: number | null;   // 0-100, or null = no progress bar
  ocr_available: boolean;
}

// ─── BQ (Bill of Quantities) Types ────────────────────────────────────────────

/** BQ item types for hierarchical classification */
export type BQItemType = "heading1" | "heading2" | "item" | "notes";

/** A single BQ row extracted from a PDF page */
export interface BQRow {
  id: number;                    // Unique row ID
  file_id: string;              // Source PDF file
  page_number: number;          // Source page (0-based)
  page_label: string;           // e.g. "4.4/4" from PageNo zone
  revision: string;             // e.g. "Addendum No. 2" from Revision zone
  bill_name: string;            // e.g. "BILL NO. 4 - BASEMENT" from BillName zone
  collection: string;           // e.g. "CARRIED TO COLLECTION $" from Collection zone
  type: BQItemType;             // heading1, heading2, item, or notes
  item_no: string;              // Item number (e.g. "1", "2", etc.)
  description: string;          // Item description
  quantity: number | null;      // Quantity
  unit: string;                 // Unit (e.g. "Set", "Nr", etc.)
  rate: number | null;          // Unit rate
  total: number | null;         // Total amount
  // Bounding box for UI highlighting (absolute PDF coordinates)
  bbox_x0?: number;
  bbox_y0?: number;
  bbox_x1?: number;
  bbox_y1?: number;
  // Page dimensions for coordinate conversion
  page_width?: number;
  page_height?: number;
  // User edit tracking - stores original values before user edit
  user_edited?: {
    quantity?: boolean;
    rate?: boolean;
    total?: boolean;
  };
}

/** BQ page data - stores boxes and extracted rows for a single page */
export interface BQPageData {
  file_id: string;
  page_number: number;
  boxes: Record<string, BoxInfo>;      // Column/zone boxes
  rows: BQRow[];                       // Extracted BQ rows for this page
  applied_template?: string;           // Last applied BQ template name
  // Page totals for collection calculation
  page_total?: number;                 // Sum of all item totals on this page
  collection_box?: {                   // Collection zone box coordinates
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

/** BQ Template - saved box configuration for BQ extraction */
export interface BQTemplate {
  id: string;
  name: string;
  boxes: TemplateBox[];              // Column and zone positions
  notes: string;
  preview_file_id: string | null;
  preview_page: number;
  owner_uid?: string;
  owner_name?: string;
  permission?: string;               // "personal" | "public" | "group"
  group?: string;                    // Group name for group-level sharing
}

/** Available BQ OCR engines */
export interface BQEngineInfo {
  id: string;
  name: string;
  quota_cost: number;
  available: boolean;
  description?: string;
}
