import React, { useRef, useEffect, useCallback, useState } from "react";
import type { BoxInfo, TextAnnotation } from "../types";
import { renderPage } from "../api/client";

interface PDFViewerProps {
  fileId: string | null;
  pageNum: number;
  boxes: Record<string, BoxInfo>;
  selectedColumn: string | null;
  onDrawBox: (box: BoxInfo) => void;
  /** Optional highlight box (absolute PDF coords) for BQ row navigation */
  highlightBox?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** PDF page dimensions needed to convert absolute coords to relative */
  pdfPageSize?: { width: number; height: number } | null;
  /** Text annotations to display on the PDF */
  annotations?: TextAnnotation[];
  /** Callback when user adds a new annotation */
  onAddAnnotation?: (annotation: TextAnnotation) => void;
  /** Callback when user deletes an annotation */
  onDeleteAnnotation?: (annotationId: string) => void;
  /** Whether annotation mode is enabled */
  annotationMode?: boolean;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4.0;
const ZOOM_STEP = 0.05;

export function PDFViewer({ 
  fileId, 
  pageNum, 
  boxes, 
  selectedColumn, 
  onDrawBox, 
  highlightBox, 
  pdfPageSize,
  annotations = [],
  onAddAnnotation,
  onDeleteAnnotation,
  annotationMode = false 
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  
  // Annotation input state
  const [annotationInput, setAnnotationInput] = useState<{ x: number; y: number; absX: number; absY: number } | null>(null);
  const [annotationText, setAnnotationText] = useState("");
  const annotationInputRef = useRef<HTMLInputElement>(null);

  // Fetch page image whenever file/page changes
  useEffect(() => {
    if (!fileId) { setImgSrc(null); return; }
    setLoading(true);
    setError(null);
    setPan({ x: 0, y: 0 });
    renderPage(fileId, pageNum, 2.0)
      .then((b64) => { setImgSrc(`data:image/png;base64,${b64}`); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [fileId, pageNum]);

  // Redraw canvas boxes whenever boxes / selectedColumn / zoom / imgNatural / highlightBox change
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || imgNatural.w === 0) return;

    const displayW = imgNatural.w * zoom;
    const displayH = imgNatural.h * zoom;
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, displayW, displayH);

    const drawBox = (box: BoxInfo, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.strokeRect(box.x * displayW, box.y * displayH, box.width * displayW, box.height * displayH);
      // Label
      ctx.fillStyle = color;
      ctx.font = `${Math.max(11, 13 * zoom)}px sans-serif`;
      ctx.fillText(box.column_name, box.x * displayW + 2, box.y * displayH - 3);
    };

    // Draw all boxes
    Object.values(boxes).forEach((box) => {
      const isSelected = box.column_name === selectedColumn;
      const boxColor = box.color || "#2980b9";
      drawBox(box, isSelected ? "#e74c3c" : boxColor, isSelected ? 2.5 : 1.5);
    });

    // Draw in-progress box
    if (drawing) {
      const x = Math.min(drawing.startX, drawing.curX);
      const y = Math.min(drawing.startY, drawing.curY);
      const w = Math.abs(drawing.curX - drawing.startX);
      const h = Math.abs(drawing.curY - drawing.startY);
      ctx.strokeStyle = "#e74c3c";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, w, h);
    }

    // Draw highlight box for BQ row navigation (absolute PDF coords → relative)
    if (highlightBox && pdfPageSize && pdfPageSize.width > 0 && pdfPageSize.height > 0) {
      // Convert absolute PDF coordinates to relative 0-1
      const rx = highlightBox.x0 / pdfPageSize.width;
      const ry = highlightBox.y0 / pdfPageSize.height;
      const rw = (highlightBox.x1 - highlightBox.x0) / pdfPageSize.width;
      const rh = (highlightBox.y1 - highlightBox.y0) / pdfPageSize.height;
      
      // Draw highlight with orange/yellow color and thicker line
      ctx.strokeStyle = "#f39c12";
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(rx * displayW, ry * displayH, rw * displayW, rh * displayH);
      
      // Semi-transparent fill
      ctx.fillStyle = "rgba(243, 156, 18, 0.15)";
      ctx.fillRect(rx * displayW, ry * displayH, rw * displayW, rh * displayH);
    }

    // Draw text annotations
    if (annotations.length > 0 && pdfPageSize && pdfPageSize.width > 0 && pdfPageSize.height > 0) {
      for (const ann of annotations) {
        // Convert absolute PDF coordinates to display coordinates
        // The image render scale is 2.0, so we need to account for that
        const renderScale = 2.0;
        const absToDisplayX = (absX: number) => (absX / pdfPageSize.width) * imgNatural.w * zoom / renderScale;
        const absToDisplayY = (absY: number) => (absY / pdfPageSize.height) * imgNatural.h * zoom / renderScale;
        
        const x = absToDisplayX(ann.x);
        const y = absToDisplayY(ann.y);
        const fontSize = (ann.font_size ?? 10) * zoom;
        
        // Draw text
        ctx.fillStyle = ann.color ?? "#000000";
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillText(ann.text, x, y);
        
        // Draw small indicator if annotation mode is on
        if (annotationMode) {
          ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
          ctx.beginPath();
          ctx.arc(x - 4, y - fontSize/3, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [boxes, selectedColumn, zoom, imgNatural, drawing, highlightBox, pdfPageSize, annotations, annotationMode]);

  // Ctrl+Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parseFloat((z + delta * 4).toFixed(2)))));
  }, []);

  // Middle-mouse pan
  const pandStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      pandStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      return;
    }

    // Left-button in annotation mode: add annotation
    if (e.button === 0 && annotationMode && canvasRef.current && pdfPageSize && onAddAnnotation) {
      const rect = canvasRef.current.getBoundingClientRect();
      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;
      
      // Convert display coordinates to absolute PDF coordinates
      // Account for zoom and render scale (2.0)
      const renderScale = 2.0;
      const absX = (displayX / (imgNatural.w * zoom)) * pdfPageSize.width * renderScale;
      const absY = (displayY / (imgNatural.h * zoom)) * pdfPageSize.height * renderScale;
      
      // Show input at clicked position
      setAnnotationInput({ x: displayX, y: displayY, absX, absY });
      setAnnotationText("");
      setTimeout(() => annotationInputRef.current?.focus(), 50);
      return;
    }

    // Left-button: box drawing on canvas
    if (e.button !== 0 || !selectedColumn || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawing({ startX: x, startY: y, curX: x, curY: y });
  }, [pan, selectedColumn, annotationMode, pdfPageSize, onAddAnnotation, imgNatural, zoom]);

  // Save annotation when pressing Enter
  const handleSaveAnnotation = useCallback(() => {
    if (!annotationInput || !annotationText.trim() || !onAddAnnotation) {
      setAnnotationInput(null);
      setAnnotationText("");
      return;
    }
    
    const newAnnotation: TextAnnotation = {
      id: `ann-${Date.now()}`,
      text: annotationText.trim(),
      x: annotationInput.absX,
      y: annotationInput.absY,
      font_size: 10,
      color: "#000000",
      created_at: new Date().toISOString(),
    };
    
    onAddAnnotation(newAnnotation);
    setAnnotationInput(null);
    setAnnotationText("");
  }, [annotationInput, annotationText, onAddAnnotation]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Pan
    if (pandStartRef.current) {
      const dx = e.clientX - pandStartRef.current.mx;
      const dy = e.clientY - pandStartRef.current.my;
      setPan({ x: pandStartRef.current.px + dx, y: pandStartRef.current.py + dy });
      return;
    }

    // Draw
    if (!drawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawing((prev) => prev ? { ...prev, curX: x, curY: y } : null);
  }, [drawing]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (pandStartRef.current) {
      pandStartRef.current = null;
      return;
    }

    if (!drawing || !canvasRef.current || !selectedColumn) {
      setDrawing(null);
      return;
    }

    const displayW = canvasRef.current.width;
    const displayH = canvasRef.current.height;
    if (displayW === 0 || displayH === 0) { setDrawing(null); return; }

    const x1 = Math.min(drawing.startX, drawing.curX) / displayW;
    const y1 = Math.min(drawing.startY, drawing.curY) / displayH;
    const w = Math.abs(drawing.curX - drawing.startX) / displayW;
    const h = Math.abs(drawing.curY - drawing.startY) / displayH;

    if (w > 0.005 && h > 0.005) {
      onDrawBox({ column_name: selectedColumn, x: x1, y: y1, width: w, height: h });
    }
    setDrawing(null);
  }, [drawing, selectedColumn, onDrawBox]);

  const imgLoaded = () => {
    if (imgRef.current) setImgNatural({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  const displayW = imgNatural.w * zoom;
  const displayH = imgNatural.h * zoom;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#888" }}>
      {/* Zoom bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#555", color: "#fff", fontSize: 12 }}>
        <button style={iconBtn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, parseFloat((z - 0.1).toFixed(2))))} title="Zoom out">−</button>
        <input
          type="number"
          style={{ width: 56, textAlign: "center", fontSize: 12, padding: "1px 2px" }}
          value={Math.round(zoom * 100)}
          min={Math.round(MIN_ZOOM * 100)}
          max={Math.round(MAX_ZOOM * 100)}
          step={5}
          onChange={(e) => setZoom(parseFloat(e.target.value) / 100)}
        />
        <span>%</span>
        <button style={iconBtn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, parseFloat((z + 0.1).toFixed(2))))} title="Zoom in">+</button>
        <button style={iconBtn} onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }} title="Reset">↺</button>
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>
          {annotationMode 
            ? `✏️ Click to add text annotation (${annotations.length} on page)` 
            : selectedColumn 
              ? `Drawing box for: "${selectedColumn}"` 
              : "Click a table cell to select a column"}
        </span>
      </div>

      {/* Page viewport */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: annotationMode ? "text" : selectedColumn ? "crosshair" : "default" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDrawing(null); pandStartRef.current = null; }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {loading && (
          <div style={centeredOverlay}>Loading page...</div>
        )}
        {error && (
          <div style={{ ...centeredOverlay, color: "#f55" }}>{error}</div>
        )}
        {!loading && !imgSrc && !error && (
          <div style={centeredOverlay}>Select a page from the tree to view it here</div>
        )}

        {imgSrc && (
          <div
            style={{
              position: "absolute",
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: "top left",
              userSelect: "none",
            }}
          >
            {/* Page image */}
            <img
              ref={imgRef}
              src={imgSrc}
              alt="PDF page"
              width={displayW}
              height={displayH}
              onLoad={imgLoaded}
              draggable={false}
              style={{ display: "block" }}
            />
            {/* Box overlay canvas */}
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                width: displayW,
                height: displayH,
              }}
            />
            {/* Annotation text input */}
            {annotationInput && (
              <div
                style={{
                  position: "absolute",
                  left: annotationInput.x,
                  top: annotationInput.y,
                  zIndex: 100,
                }}
              >
                <input
                  ref={annotationInputRef}
                  type="text"
                  value={annotationText}
                  onChange={(e) => setAnnotationText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveAnnotation();
                    } else if (e.key === "Escape") {
                      setAnnotationInput(null);
                      setAnnotationText("");
                    }
                  }}
                  onBlur={handleSaveAnnotation}
                  placeholder="Type text..."
                  style={{
                    padding: "2px 4px",
                    border: "1px solid #333",
                    borderRadius: 2,
                    fontSize: 12,
                    minWidth: 100,
                    background: "rgba(255,255,255,0.95)",
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  padding: "1px 8px",
  border: "1px solid #888",
  borderRadius: 3,
  background: "#666",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

const centeredOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 14,
};
