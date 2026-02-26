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
