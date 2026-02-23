/**
 * useProject – central state management for the PDF extraction application.
 * Uses useReducer so all state transitions are explicit and traceable.
 */

import { useReducer, useCallback } from "react";
import type { ProjectState, PDFFileInfo, PageData, BoxInfo, ExtractedDataColumn, Template } from "../types";

// --------------------------------------------------------------------------
// Initial state
// --------------------------------------------------------------------------

const INITIAL: ProjectState = {
  pdf_files: [],
  columns: [
    { name: "Title", visible: true },
    { name: "Page Name", visible: true },
  ],
  templates: [],
  selected_file_id: null,
  selected_page: 0,
};

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

type Action =
  | { type: "ADD_FILES"; files: PDFFileInfo[] }
  | { type: "DELETE_FILES"; file_ids: string[] }
  | { type: "SELECT_PAGE"; file_id: string; page: number }
  | { type: "ADD_COLUMN"; name: string }
  | { type: "REMOVE_COLUMN"; name: string }
  | { type: "TOGGLE_COLUMN_VISIBILITY"; name: string }
  | { type: "SET_BOX"; file_id: string; page: number; box: BoxInfo }
  | { type: "CLEAR_BOXES"; file_id: string; page: number }
  | { type: "SET_CELL"; file_id: string; page: number; column: string; text: string }
  | { type: "CLEAR_PAGE_DATA"; file_id: string; page: number }
  | { type: "APPLY_BOXES_TO_PAGES"; source_file_id: string; source_page: number; target_pages: { file_id: string; page: number }[] }
  | { type: "SAVE_TEMPLATES"; templates: Template[] }
  | { type: "SET_APPLIED_TEMPLATE"; file_id: string; page: number; template_name: string }
  | { type: "LOAD_PROJECT"; state: ProjectState };

// --------------------------------------------------------------------------
// Reducer
// --------------------------------------------------------------------------

function mutateFile(
  files: PDFFileInfo[],
  file_id: string,
  fn: (f: PDFFileInfo) => PDFFileInfo
): PDFFileInfo[] {
  return files.map((f) => (f.file_id === file_id ? fn(f) : f));
}

function mutatePage(
  files: PDFFileInfo[],
  file_id: string,
  page: number,
  fn: (p: PageData) => PageData
): PDFFileInfo[] {
  return mutateFile(files, file_id, (f) => ({
    ...f,
    pages: f.pages.map((p2) => (p2.page_number === page ? fn(p2) : p2)),
  }));
}

function reducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "ADD_FILES":
      return {
        ...state,
        pdf_files: [...state.pdf_files, ...action.files],
        selected_file_id: state.selected_file_id ?? action.files[0]?.file_id ?? null,
        selected_page: 0,
      };

    case "DELETE_FILES":
      return {
        ...state,
        pdf_files: state.pdf_files.filter((f) => !action.file_ids.includes(f.file_id)),
        selected_file_id: null,
      };

    case "SELECT_PAGE":
      return { ...state, selected_file_id: action.file_id, selected_page: action.page };

    case "ADD_COLUMN": {
      if (state.columns.some((c) => c.name === action.name)) return state;
      const newCol: ExtractedDataColumn = { name: action.name, visible: true };
      // Add empty data for all existing pages
      const newFiles = state.pdf_files.map((f) => ({
        ...f,
        pages: f.pages.map((p) => ({
          ...p,
          extracted_data: { ...p.extracted_data, [action.name]: "" },
        })),
      }));
      return { ...state, columns: [...state.columns, newCol], pdf_files: newFiles };
    }

    case "REMOVE_COLUMN":
      return {
        ...state,
        columns: state.columns.filter((c) => c.name !== action.name),
        pdf_files: state.pdf_files.map((f) => ({
          ...f,
          pages: f.pages.map((p) => {
            const { [action.name]: _removed, ...rest } = p.extracted_data;
            const { [action.name]: _box, ...restBoxes } = p.boxes;
            return { ...p, extracted_data: rest, boxes: restBoxes };
          }),
        })),
      };

    case "TOGGLE_COLUMN_VISIBILITY":
      return {
        ...state,
        columns: state.columns.map((c) =>
          c.name === action.name ? { ...c, visible: !c.visible } : c
        ),
      };

    case "SET_BOX":
      return {
        ...state,
        pdf_files: mutatePage(state.pdf_files, action.file_id, action.page, (p) => ({
          ...p,
          boxes: { ...p.boxes, [action.box.column_name]: action.box },
        })),
      };

    case "CLEAR_BOXES":
      return {
        ...state,
        pdf_files: mutatePage(state.pdf_files, action.file_id, action.page, (p) => ({
          ...p,
          boxes: {},
        })),
      };

    case "SET_CELL":
      return {
        ...state,
        pdf_files: mutatePage(state.pdf_files, action.file_id, action.page, (p) => ({
          ...p,
          extracted_data: { ...p.extracted_data, [action.column]: action.text },
        })),
      };

    case "CLEAR_PAGE_DATA":
      return {
        ...state,
        pdf_files: mutatePage(state.pdf_files, action.file_id, action.page, (p) => ({
          ...p,
          extracted_data: Object.fromEntries(
            Object.keys(p.extracted_data).map((k) => [k, ""])
          ),
          boxes: {},
        })),
      };

    case "APPLY_BOXES_TO_PAGES": {
      const srcFile = state.pdf_files.find((f) => f.file_id === action.source_file_id);
      const srcPage = srcFile?.pages.find((p) => p.page_number === action.source_page);
      if (!srcPage) return state;
      const srcBoxes = srcPage.boxes;

      let files = state.pdf_files;
      for (const target of action.target_pages) {
        files = mutatePage(files, target.file_id, target.page, (p) => ({
          ...p,
          boxes: { ...p.boxes, ...srcBoxes },
        }));
      }
      return { ...state, pdf_files: files };
    }

    case "SAVE_TEMPLATES":
      return { ...state, templates: action.templates };

    case "SET_APPLIED_TEMPLATE":
      return {
        ...state,
        pdf_files: mutatePage(state.pdf_files, action.file_id, action.page, (p) => ({
          ...p,
          applied_template: action.template_name,
        })),
      };

    case "LOAD_PROJECT":
      return { ...action.state, templates: action.state.templates ?? [] };

    default:
      return state;
  }
}

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

export function useProject() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const addFiles = useCallback((files: PDFFileInfo[]) => dispatch({ type: "ADD_FILES", files }), []);
  const deleteFiles = useCallback((ids: string[]) => dispatch({ type: "DELETE_FILES", file_ids: ids }), []);
  const selectPage = useCallback((file_id: string, page: number) => dispatch({ type: "SELECT_PAGE", file_id, page }), []);
  const addColumn = useCallback((name: string) => dispatch({ type: "ADD_COLUMN", name }), []);
  const removeColumn = useCallback((name: string) => dispatch({ type: "REMOVE_COLUMN", name }), []);
  const toggleColumn = useCallback((name: string) => dispatch({ type: "TOGGLE_COLUMN_VISIBILITY", name }), []);
  const setBox = useCallback((file_id: string, page: number, box: BoxInfo) => dispatch({ type: "SET_BOX", file_id, page, box }), []);
  const clearBoxes = useCallback((file_id: string, page: number) => dispatch({ type: "CLEAR_BOXES", file_id, page }), []);
  const setCell = useCallback((file_id: string, page: number, column: string, text: string) => dispatch({ type: "SET_CELL", file_id, page, column, text }), []);
  const clearPageData = useCallback((file_id: string, page: number) => dispatch({ type: "CLEAR_PAGE_DATA", file_id, page }), []);
  const applyBoxesToPages = useCallback(
    (source_file_id: string, source_page: number, target_pages: { file_id: string; page: number }[]) =>
      dispatch({ type: "APPLY_BOXES_TO_PAGES", source_file_id, source_page, target_pages }),
    []
  );
  const loadProject = useCallback((s: ProjectState) => dispatch({ type: "LOAD_PROJECT", state: s }), []);
  const saveTemplates = useCallback((templates: Template[]) => dispatch({ type: "SAVE_TEMPLATES", templates }), []);
  const setAppliedTemplate = useCallback(
    (file_id: string, page: number, template_name: string) =>
      dispatch({ type: "SET_APPLIED_TEMPLATE", file_id, page, template_name }),
    []
  );

  /** Current file object */
  const currentFile = state.pdf_files.find((f) => f.file_id === state.selected_file_id) ?? null;
  /** Current page object */
  const currentPageData = currentFile?.pages.find((p) => p.page_number === state.selected_page) ?? null;

  return {
    state,
    currentFile,
    currentPageData,
    addFiles,
    deleteFiles,
    selectPage,
    addColumn,
    removeColumn,
    toggleColumn,
    setBox,
    clearBoxes,
    setCell,
    clearPageData,
    applyBoxesToPages,
    loadProject,
    saveTemplates,
    setAppliedTemplate,
  };
}
