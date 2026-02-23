import React, { useRef, useEffect, useCallback, useState } from "react";
import type { BoxInfo } from "../types";
import { renderPage } from "../api/client";

interface PDFViewerProps {
  fileId: string | null;
  pageNum: number;
  boxes: Record<string, BoxInfo>;
  selectedColumn: string | null;
  onDrawBox: (box: BoxInfo) => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4.0;
const ZOOM_STEP = 0.05;

export function PDFViewer({ fileId, pageNum, boxes, selectedColumn, onDrawBox }: PDFViewerProps) {
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

  // Redraw canvas boxes whenever boxes / selectedColumn / zoom / imgNatural change
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
      drawBox(box, isSelected ? "#e74c3c" : "#2980b9", isSelected ? 2.5 : 1.5);
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
  }, [boxes, selectedColumn, zoom, imgNatural, drawing]);

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

    // Left-button: box drawing on canvas
    if (e.button !== 0 || !selectedColumn || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawing({ startX: x, startY: y, curX: x, curY: y });
  }, [pan, selectedColumn]);

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
          {selectedColumn ? `Drawing box for: "${selectedColumn}"` : "Click a table cell to select a column"}
        </span>
      </div>

      {/* Page viewport */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: selectedColumn ? "crosshair" : "default" }}
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
