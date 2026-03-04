"""
PDF Viewer widget (3rd column).

Displays a rendered PDF page image with:
- Zoom in/out (keyboard shortcut: Ctrl+Mouse Wheel)
- Fit to width/height
- Zoom percentage spin box (5% increments)
- Pan (Middle mouse button press and drag)
- Box drawing for data extraction regions
- Box selection, move, resize, and delete

Signals:
    box_drawn(str, float, float, float, float): column_name, rel_x, rel_y, rel_w, rel_h
    box_changed(str, float, float, float, float): column_name, rel_x, rel_y, rel_w, rel_h
    box_deleted(str): column_name
"""

from PyQt5.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QSpinBox,
    QPushButton,
    QCheckBox,
    QSizePolicy,
    QApplication,
)
from PyQt5.QtCore import pyqtSignal, Qt, QRect, QRectF, QPoint, QPointF, QSize
from PyQt5.QtGui import (
    QPixmap,
    QPainter,
    QPen,
    QColor,
    QBrush,
    QFont,
    QImage,
    QCursor,
    QWheelEvent,
    QMouseEvent,
    QKeyEvent,
)
from typing import Optional, List, Dict, Tuple
import math

from models.data_models import BoxInfo


from PyQt5 import uic
import os

class DrawingBox:
    """
    Represents a drawn selection box on the PDF viewer.
    
    Stores both relative (0-1) and display coordinates.
    """
    
    # Resize handle size
    HANDLE_SIZE = 8
    
    def __init__(self, column_name: str, rel_x: float, rel_y: float,
                 rel_w: float, rel_h: float):
        self.column_name = column_name
        self.rel_x = rel_x
        self.rel_y = rel_y
        self.rel_w = rel_w
        self.rel_h = rel_h
        self.selected = False
        self.color = QColor(0, 120, 215, 80)
        self.border_color = QColor(0, 120, 215)
        self.selected_color = QColor(255, 165, 0, 80)
        self.selected_border = QColor(255, 165, 0)
    
    def get_display_rect(self, img_offset_x: float, img_offset_y: float,
                         img_display_w: float, img_display_h: float) -> QRectF:
        """Get the rectangle in display/widget coordinates."""
        x = img_offset_x + self.rel_x * img_display_w
        y = img_offset_y + self.rel_y * img_display_h
        w = self.rel_w * img_display_w
        h = self.rel_h * img_display_h
        return QRectF(x, y, w, h)
    
    def contains_point(self, point: QPointF, img_offset_x: float, img_offset_y: float,
                       img_display_w: float, img_display_h: float) -> bool:
        """Check if a point is inside this box."""
        rect = self.get_display_rect(img_offset_x, img_offset_y, img_display_w, img_display_h)
        return rect.contains(point)
    
    def get_resize_handle(self, point: QPointF, img_offset_x: float, img_offset_y: float,
                          img_display_w: float, img_display_h: float) -> Optional[str]:
        """
        Check if point is on a resize handle.
        
        Returns: One of 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r', or None.
        """
        rect = self.get_display_rect(img_offset_x, img_offset_y, img_display_w, img_display_h)
        hs = self.HANDLE_SIZE
        
        corners = {
            'tl': QRectF(rect.left() - hs/2, rect.top() - hs/2, hs, hs),
            'tr': QRectF(rect.right() - hs/2, rect.top() - hs/2, hs, hs),
            'bl': QRectF(rect.left() - hs/2, rect.bottom() - hs/2, hs, hs),
            'br': QRectF(rect.right() - hs/2, rect.bottom() - hs/2, hs, hs),
            't': QRectF(rect.center().x() - hs/2, rect.top() - hs/2, hs, hs),
            'b': QRectF(rect.center().x() - hs/2, rect.bottom() - hs/2, hs, hs),
            'l': QRectF(rect.left() - hs/2, rect.center().y() - hs/2, hs, hs),
            'r': QRectF(rect.right() - hs/2, rect.center().y() - hs/2, hs, hs),
        }
        
        for handle_name, handle_rect in corners.items():
            if handle_rect.contains(point):
                return handle_name
        return None
    
    def to_box_info(self) -> BoxInfo:
        """Convert to a BoxInfo data model object."""
        return BoxInfo(
            column_name=self.column_name,
            x=self.rel_x,
            y=self.rel_y,
            width=self.rel_w,
            height=self.rel_h,
        )


class PDFViewerCanvas(QWidget):
    """
    Custom widget that renders the PDF page image and drawn boxes.
    
    Handles painting, mouse interaction for box drawing/editing, and zoom/pan.
    """
    
    box_drawn = pyqtSignal(str, float, float, float, float)
    box_changed = pyqtSignal(str, float, float, float, float)
    box_deleted = pyqtSignal(str)
    box_selected_signal = pyqtSignal(str)  # column_name
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        
        self._pixmap: Optional[QPixmap] = None
        self._zoom: float = 1.0
        self._pan_offset = QPointF(0, 0)
        self._boxes: List[DrawingBox] = []
        
        # Interaction state
        self._drawing = False
        self._draw_start: Optional[QPointF] = None
        self._draw_current: Optional[QPointF] = None
        self._moving = False
        self._move_box: Optional[DrawingBox] = None
        self._move_start: Optional[QPointF] = None
        self._resizing = False
        self._resize_box: Optional[DrawingBox] = None
        self._resize_handle: Optional[str] = None
        self._resize_start: Optional[QPointF] = None
        self._panning = False
        self._pan_start: Optional[QPointF] = None
        self._pan_start_offset = QPointF(0, 0)
        
        # Active column for drawing
        self._active_column: str = ""
        
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
    
    def set_image(self, image_data: bytes) -> None:
        """Set the PDF page image from PNG bytes."""
        pixmap = QPixmap()
        pixmap.loadFromData(image_data)
        self._pixmap = pixmap
        self._update_size()
        self.update()
    
    def clear_image(self) -> None:
        """Clear the displayed image."""
        self._pixmap = None
        self._boxes.clear()
        self.update()
    
    def set_zoom(self, zoom: float) -> None:
        """Set the zoom level (1.0 = 100%)."""
        self._zoom = max(0.1, min(10.0, zoom))
        self._update_size()
        self.update()
    
    def get_zoom(self) -> float:
        """Get the current zoom level."""
        return self._zoom
    
    def set_active_column(self, column_name: str) -> None:
        """Set the column name for the next box to be drawn."""
        self._active_column = column_name
    
    def set_boxes(self, boxes: List[BoxInfo]) -> None:
        """Set the drawn boxes from BoxInfo list."""
        self._boxes.clear()
        for box_info in boxes:
            db = DrawingBox(
                box_info.column_name,
                box_info.x, box_info.y,
                box_info.width, box_info.height,
            )
            self._boxes.append(db)
        self.update()
    
    def highlight_box(self, column_name: str) -> None:
        """Highlight an existing box by column name."""
        for box in self._boxes:
            box.selected = (box.column_name == column_name)
        self.update()
    
    def get_boxes(self) -> List[DrawingBox]:
        """Return the current list of drawing boxes."""
        return list(self._boxes)
    
    def _get_image_display_params(self) -> Tuple[float, float, float, float]:
        """
        Get the display parameters for the current image.
        
        Returns:
            (img_offset_x, img_offset_y, img_display_w, img_display_h)
        """
        if self._pixmap is None:
            return (0, 0, 0, 0)
        
        img_w = self._pixmap.width() * self._zoom
        img_h = self._pixmap.height() * self._zoom
        
        # Center the image in the widget
        offset_x = max(0, (self.width() - img_w) / 2) + self._pan_offset.x()
        offset_y = max(0, (self.height() - img_h) / 2) + self._pan_offset.y()
        
        return (offset_x, offset_y, img_w, img_h)
    
    def _point_to_relative(self, point: QPointF) -> Optional[QPointF]:
        """Convert a widget point to relative image coordinates (0-1)."""
        ox, oy, iw, ih = self._get_image_display_params()
        if iw <= 0 or ih <= 0:
            return None
        
        rel_x = (point.x() - ox) / iw
        rel_y = (point.y() - oy) / ih
        
        # Clamp to image bounds
        rel_x = max(0, min(1, rel_x))
        rel_y = max(0, min(1, rel_y))
        
        return QPointF(rel_x, rel_y)
    
    def _update_size(self) -> None:
        """Update the widget minimum size based on image and zoom."""
        if self._pixmap:
            w = int(self._pixmap.width() * self._zoom)
            h = int(self._pixmap.height() * self._zoom)
            self.setMinimumSize(w, h)
        else:
            self.setMinimumSize(200, 200)
    
    def _find_box_at_point(self, point: QPointF) -> Optional[DrawingBox]:
        """Find the topmost box that contains the given point."""
        ox, oy, iw, ih = self._get_image_display_params()
        for box in reversed(self._boxes):
            if box.contains_point(point, ox, oy, iw, ih):
                return box
        return None
    
    def _find_resize_handle(self, point: QPointF) -> Optional[Tuple[DrawingBox, str]]:
        """Find if the point is on any box's resize handle."""
        ox, oy, iw, ih = self._get_image_display_params()
        for box in reversed(self._boxes):
            if box.selected:
                handle = box.get_resize_handle(point, ox, oy, iw, ih)
                if handle:
                    return (box, handle)
        return None
    
    def paintEvent(self, event):
        """Paint the image and all drawn boxes."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setRenderHint(QPainter.SmoothPixmapTransform)
        
        # Fill background
        painter.fillRect(self.rect(), QColor("#E0E0E0"))
        
        if self._pixmap is None:
            painter.setPen(QColor("#888888"))
            painter.setFont(QFont("Segoe UI", 12))
            painter.drawText(self.rect(), Qt.AlignCenter, "No PDF page selected")
            painter.end()
            return
        
        ox, oy, iw, ih = self._get_image_display_params()
        
        # Draw the page image
        target = QRectF(ox, oy, iw, ih)
        source = QRectF(0, 0, self._pixmap.width(), self._pixmap.height())
        painter.drawPixmap(target, self._pixmap, source)
        
        # Draw existing boxes
        for box in self._boxes:
            rect = box.get_display_rect(ox, oy, iw, ih)
            
            if box.selected:
                painter.setPen(QPen(box.selected_border, 2, Qt.SolidLine))
                painter.setBrush(QBrush(box.selected_color))
            else:
                painter.setPen(QPen(box.border_color, 2, Qt.SolidLine))
                painter.setBrush(QBrush(box.color))
            
            painter.drawRect(rect)
            
            # Draw column name label
            painter.setPen(QPen(Qt.black))
            painter.setFont(QFont("Segoe UI", 8))
            label_rect = QRectF(rect.x(), rect.y() - 16, rect.width(), 16)
            painter.drawText(label_rect, Qt.AlignLeft | Qt.AlignBottom, box.column_name)
            
            # Draw resize handles if selected
            if box.selected:
                hs = DrawingBox.HANDLE_SIZE
                handle_color = QColor(0, 120, 215)
                painter.setBrush(QBrush(handle_color))
                painter.setPen(QPen(Qt.white, 1))
                
                for hx, hy in [
                    (rect.left(), rect.top()),
                    (rect.right(), rect.top()),
                    (rect.left(), rect.bottom()),
                    (rect.right(), rect.bottom()),
                    (rect.center().x(), rect.top()),
                    (rect.center().x(), rect.bottom()),
                    (rect.left(), rect.center().y()),
                    (rect.right(), rect.center().y()),
                ]:
                    painter.drawRect(QRectF(hx - hs/2, hy - hs/2, hs, hs))
        
        # Draw current drawing rectangle
        if self._drawing and self._draw_start and self._draw_current:
            painter.setPen(QPen(QColor(0, 120, 215), 2, Qt.DashLine))
            painter.setBrush(QBrush(QColor(0, 120, 215, 40)))
            draw_rect = QRectF(self._draw_start, self._draw_current).normalized()
            painter.drawRect(draw_rect)
        
        painter.end()
    
    def mousePressEvent(self, event: QMouseEvent):
        """Handle mouse press for drawing, moving, resizing, or panning."""
        pos = QPointF(event.pos())
        
        # Middle button = Pan
        if event.button() == Qt.MiddleButton:
            self._panning = True
            self._pan_start = pos
            self._pan_start_offset = QPointF(self._pan_offset)
            self.setCursor(QCursor(Qt.ClosedHandCursor))
            return
        
        if event.button() != Qt.LeftButton:
            return
        
        # Check for resize handle on selected box
        handle_result = self._find_resize_handle(pos)
        if handle_result:
            box, handle = handle_result
            self._resizing = True
            self._resize_box = box
            self._resize_handle = handle
            self._resize_start = pos
            return
        
        # Check if clicking on an existing box
        clicked_box = self._find_box_at_point(pos)
        if clicked_box:
            # Ctrl+click toggles selection, no move initiated
            if event.modifiers() & Qt.ControlModifier:
                clicked_box.selected = not clicked_box.selected
                # emit selection for the clicked box
                if clicked_box.selected:
                    self.box_selected_signal.emit(clicked_box.column_name)
                self.update()
                return

            # Without Ctrl, begin move; preserve existing selection when
            # user clicks one of already-selected boxes (to move group).
            if not clicked_box.selected:
                # clear others if the clicked one wasn't already selected
                for b in self._boxes:
                    b.selected = False
                clicked_box.selected = True
            # mark all currently selected boxes for potential grouped move
            self._moving = True
            self._move_box = clicked_box
            self._move_start = pos
            self.box_selected_signal.emit(clicked_box.column_name)
            self.update()
            return
        
        # Deselect all boxes
        for b in self._boxes:
            b.selected = False
        
        # Start drawing a new box
        if self._active_column:
            self._drawing = True
            self._draw_start = pos
            self._draw_current = pos
        
        self.update()
    
    def mouseMoveEvent(self, event: QMouseEvent):
        """Handle mouse move for drawing, moving, resizing, or panning."""
        pos = QPointF(event.pos())
        
        if self._panning and self._pan_start:
            delta = pos - self._pan_start
            self._pan_offset = self._pan_start_offset + delta
            self.update()
            return
        
        if self._drawing:
            self._draw_current = pos
            self.update()
            return
        
        if self._moving and self._move_box and self._move_start:
            ox, oy, iw, ih = self._get_image_display_params()
            if iw > 0 and ih > 0:
                delta_x = (pos.x() - self._move_start.x()) / iw
                delta_y = (pos.y() - self._move_start.y()) / ih
                # shift every selected box while enforcing bounds
                for box in self._boxes:
                    if box.selected:
                        new_x = max(0, min(1 - box.rel_w, box.rel_x + delta_x))
                        new_y = max(0, min(1 - box.rel_h, box.rel_y + delta_y))
                        box.rel_x = new_x
                        box.rel_y = new_y
                self._move_start = pos
                self.update()
            return
        
        if self._resizing and self._resize_box and self._resize_start:
            ox, oy, iw, ih = self._get_image_display_params()
            if iw > 0 and ih > 0:
                delta_x = (pos.x() - self._resize_start.x()) / iw
                delta_y = (pos.y() - self._resize_start.y()) / ih
                
                box = self._resize_box
                handle = self._resize_handle
                
                if handle in ('tl', 't', 'tr'):
                    new_y = box.rel_y + delta_y
                    new_h = box.rel_h - delta_y
                    if new_h > 0.01 and new_y >= 0:
                        box.rel_y = new_y
                        box.rel_h = new_h
                
                if handle in ('bl', 'b', 'br'):
                    new_h = box.rel_h + delta_y
                    if new_h > 0.01 and box.rel_y + new_h <= 1:
                        box.rel_h = new_h
                
                if handle in ('tl', 'l', 'bl'):
                    new_x = box.rel_x + delta_x
                    new_w = box.rel_w - delta_x
                    if new_w > 0.01 and new_x >= 0:
                        box.rel_x = new_x
                        box.rel_w = new_w
                
                if handle in ('tr', 'r', 'br'):
                    new_w = box.rel_w + delta_x
                    if new_w > 0.01 and box.rel_x + new_w <= 1:
                        box.rel_w = new_w
                
                self._resize_start = pos
                self.update()
            return
        
        # Update cursor based on hover
        handle_result = self._find_resize_handle(pos)
        if handle_result:
            _, handle = handle_result
            cursors = {
                'tl': Qt.SizeFDiagCursor, 'br': Qt.SizeFDiagCursor,
                'tr': Qt.SizeBDiagCursor, 'bl': Qt.SizeBDiagCursor,
                't': Qt.SizeVerCursor, 'b': Qt.SizeVerCursor,
                'l': Qt.SizeHorCursor, 'r': Qt.SizeHorCursor,
            }
            self.setCursor(QCursor(cursors.get(handle, Qt.ArrowCursor)))
        elif self._find_box_at_point(pos):
            self.setCursor(QCursor(Qt.SizeAllCursor))
        else:
            self.setCursor(QCursor(Qt.CrossCursor) if self._active_column else QCursor(Qt.ArrowCursor))
    
    def mouseReleaseEvent(self, event: QMouseEvent):
        """Handle mouse release to finalize box drawing/moving/resizing."""
        if self._panning:
            self._panning = False
            self.setCursor(QCursor(Qt.ArrowCursor))
            return
        
        if self._drawing and self._draw_start and self._draw_current:
            self._drawing = False
            
            # Convert to relative coordinates
            start_rel = self._point_to_relative(self._draw_start)
            end_rel = self._point_to_relative(self._draw_current)
            
            if start_rel and end_rel:
                rel_x = min(start_rel.x(), end_rel.x())
                rel_y = min(start_rel.y(), end_rel.y())
                rel_w = abs(end_rel.x() - start_rel.x())
                rel_h = abs(end_rel.y() - start_rel.y())
                
                # Only create box if it has meaningful size
                if rel_w > 0.005 and rel_h > 0.005:
                    # Remove existing box for this column
                    self._boxes = [b for b in self._boxes if b.column_name != self._active_column]
                    
                    new_box = DrawingBox(self._active_column, rel_x, rel_y, rel_w, rel_h)
                    new_box.selected = True
                    self._boxes.append(new_box)
                    self.box_drawn.emit(self._active_column, rel_x, rel_y, rel_w, rel_h)
            
            self._draw_start = None
            self._draw_current = None
            self.update()
            return
        
        if self._moving and self._move_box:
            self._moving = False
            box = self._move_box
            self.box_changed.emit(box.column_name, box.rel_x, box.rel_y, box.rel_w, box.rel_h)
            self._move_box = None
            self._move_start = None
            return
        
        if self._resizing and self._resize_box:
            self._resizing = False
            box = self._resize_box
            self.box_changed.emit(box.column_name, box.rel_x, box.rel_y, box.rel_w, box.rel_h)
            self._resize_box = None
            self._resize_handle = None
            self._resize_start = None
            return
    
    def wheelEvent(self, event: QWheelEvent):
        """Handle Ctrl+Mouse Wheel for zooming.
        
        L4: Use integer-percentage steps (5%) to stay consistent with the spin
        box, avoiding accumulated float truncation drift.
        """
        if event.modifiers() & Qt.ControlModifier:
            delta = event.angleDelta().y()
            # Work in integer percent to stay in sync with the QSpinBox (5% steps)
            current_pct = round(self._zoom * 100)
            if delta > 0:
                new_pct = min(1000, current_pct + 5)
            else:
                new_pct = max(10, current_pct - 5)
            self._zoom = new_pct / 100.0
            self._update_size()
            self.update()
            # Emit zoom changed (parent will handle)
            if self.parent():
                parent = self.parent()
                while parent and not isinstance(parent, PDFViewer):
                    parent = parent.parent()
                if parent and isinstance(parent, PDFViewer):
                    parent._sync_zoom_spinbox()
        else:
            super().wheelEvent(event)
    
    def keyPressEvent(self, event: QKeyEvent):
        """Handle Delete key to delete selected box and Arrow keys to move it."""
        if event.key() == Qt.Key_Delete:
            # delete all selected boxes (not just first)
            removed = []
            for box in list(self._boxes):
                if box.selected:
                    removed.append(box.column_name)
                    self._boxes.remove(box)
            for col in removed:
                self.box_deleted.emit(col)
            if removed:
                self.update()
            return
        elif event.key() in (Qt.Key_Up, Qt.Key_Down, Qt.Key_Left, Qt.Key_Right):
            # if any box is selected we treat arrows as box-move commands
            selected_box = any(box.selected for box in self._boxes)
            if selected_box:
                for box in self._boxes:
                    if box.selected:
                        ox, oy, iw, ih = self._get_image_display_params()
                        if iw > 0 and ih > 0:
                            # Move by 1 pixel in display coordinates, or 10 pixels if Shift is held
                            step = 10 if event.modifiers() & Qt.ShiftModifier else 1
                            delta_x = step / iw
                            delta_y = step / ih
                            
                            if event.key() == Qt.Key_Up:
                                box.rel_y = max(0.0, box.rel_y - delta_y)
                            elif event.key() == Qt.Key_Down:
                                box.rel_y = min(1.0 - box.rel_h, box.rel_y + delta_y)
                            elif event.key() == Qt.Key_Left:
                                box.rel_x = max(0.0, box.rel_x - delta_x)
                            elif event.key() == Qt.Key_Right:
                                box.rel_x = min(1.0 - box.rel_w, box.rel_x + delta_x)
                            
                            self.update()
                        break
            else:
                # no box selected, arrow keys requested navigation
                if event.key() == Qt.Key_Left:
                    self.page_requested.emit(-1)
                    return
                elif event.key() == Qt.Key_Right:
                    self.page_requested.emit(1)
                    return
        super().keyPressEvent(event)

    def keyReleaseEvent(self, event: QKeyEvent):
        """Emit box_changed when arrow key is released."""
        if event.isAutoRepeat():
            super().keyReleaseEvent(event)
            return
            
        if event.key() in (Qt.Key_Up, Qt.Key_Down, Qt.Key_Left, Qt.Key_Right):
            for box in self._boxes:
                if box.selected:
                    self.box_changed.emit(box.column_name, box.rel_x, box.rel_y, box.rel_w, box.rel_h)
                    break
        super().keyReleaseEvent(event)

    def delete_selected_box(self) -> None:
        """Remove all selected boxes and emit deletion signals individually."""
        removed = []
        for box in list(self._boxes):
            if box.selected:
                removed.append(box.column_name)
                self._boxes.remove(box)
        for col in removed:
            self.box_deleted.emit(col)
        if removed:
            self.update()


class PDFViewer(QWidget):
    """
    PDF Page Viewer widget with zoom, pan, and box drawing capabilities.
    
    Contains a scrollable canvas that displays the PDF page image and
    allows interactive box drawing for data extraction regions.
    
    Signals:
        box_drawn(str, float, float, float, float): New box drawn.
        box_changed(str, float, float, float, float): Box moved/resized. 
        box_deleted(str): Box deleted.
        box_selected(str): Box selected by clicking.
        zoom_changed(float): Zoom level changed.
        single_page_mode_toggled(bool): User clicked the toggle in the toolbar.
    """
    
    box_drawn = pyqtSignal(str, float, float, float, float)
    box_changed = pyqtSignal(str, float, float, float, float)
    box_deleted = pyqtSignal(str)
    box_selected = pyqtSignal(str)
    zoom_changed = pyqtSignal(float)
    single_page_mode_toggled = pyqtSignal(bool)
    # emitted when the user presses left/right while no box is selected; value
    # is -1 for previous or +1 for next page.  The main window listens and
    # updates the tree/viewer accordingly.
    page_requested = pyqtSignal(int)
    
    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        ui_path = os.path.join(os.path.dirname(__file__), "pdf_viewer.ui")
        uic.loadUi(ui_path, self)
        
        self.btn_zoom_out.clicked.connect(self._zoom_out)
        self.spin_zoom.valueChanged.connect(self._on_zoom_spin_changed)
        self.btn_zoom_in.clicked.connect(self._zoom_in)
        self.btn_fit_width.clicked.connect(self._fit_width)
        self.btn_fit_height.clicked.connect(self._fit_height)
        self.btn_center.clicked.connect(self.center_image)
        self.btn_clear_box.clicked.connect(self._on_clear_box_clicked)
        
        # maintain a hidden checkbox object for compatibility; it is not
        # placed in the UI, but we keep the signal and set_single_page_mode
        # method working for legacy code and tests.
        self.chk_single_page_mode = QCheckBox()
        self.chk_single_page_mode.setVisible(False)
        self.chk_single_page_mode.toggled.connect(self.single_page_mode_toggled)
        
        self.canvas = PDFViewerCanvas()
        self.canvas.box_drawn.connect(self.box_drawn.emit)
        self.canvas.box_changed.connect(self.box_changed.emit)
        self.canvas.box_deleted.connect(self.box_deleted.emit)
        self.canvas.box_selected_signal.connect(self.box_selected.emit)
        
        self.scroll_area.setWidget(self.canvas)
    
    def set_image(self, image_data: bytes) -> None:
        """Set the PDF page image."""
        self.canvas.set_image(image_data)

    def delete_selected_box(self) -> None:
        """Delete the currently highlighted box (if any).

        Emits the normal ``box_deleted`` signal so callers can update the
        model/UI accordingly.
        """
        self.canvas.delete_selected_box()

    def set_single_page_mode(self, enabled: bool) -> None:
        """Update the state of the single–page toggle checkbox.

        Main window will call this when the toolbar checkbox changes; the
        viewer keeps an internal hidden checkbox so that any existing code
        which inspects ``viewer.chk_single_page_mode`` continues to work.
        """
        self.chk_single_page_mode.setChecked(enabled)
    
    def clear_image(self) -> None:
        """Clear the displayed image."""
        self.canvas.clear_image()
    
    def set_zoom(self, zoom_percent: int) -> None:
        """Set zoom by percentage (100 = 100%)."""
        self.canvas.set_zoom(zoom_percent / 100.0)
        self.spin_zoom.blockSignals(True)
        self.spin_zoom.setValue(zoom_percent)
        self.spin_zoom.blockSignals(False)

    def _on_clear_box_clicked(self) -> None:
        """Slot for the clear-box toolbar button."""
        self.delete_selected_box()
    
    def set_active_column(self, column_name: str) -> None:
        """Set the active column for box drawing."""
        self.canvas.set_active_column(column_name)
    
    def set_boxes(self, boxes: List[BoxInfo]) -> None:
        """Set the boxes to display."""
        self.canvas.set_boxes(boxes)
    
    def highlight_box(self, column_name: str) -> None:
        """Highlight a specific box by column name."""
        self.canvas.highlight_box(column_name)
    
    def center_on_box(self, column_name: str) -> None:
        """Center the view on the drawn box with the given column name.

        Behavior:
        - If image/box not present, do nothing.
        - Reset any canvas pan (so centring is consistent), then scroll the
          viewport so the box center is placed near the viewport center.
        """
        # Find the drawing box
        boxes = self.canvas.get_boxes()
        target_box = None
        for b in boxes:
            if b.column_name == column_name:
                target_box = b
                break
        if target_box is None:
            return

        if self.canvas._pixmap is None:
            return

        # Reset pan so calculations are consistent
        self.canvas._pan_offset = QPointF(0, 0)
        self.canvas.update()

        # Compute display co-ordinates for the box center
        ox, oy, iw, ih = self.canvas._get_image_display_params()
        if iw <= 0 or ih <= 0:
            return

        rect = target_box.get_display_rect(ox, oy, iw, ih)
        center_x = rect.center().x()
        center_y = rect.center().y()

        # Viewport size
        vp = self.scroll_area.viewport()
        vp_w = vp.width()
        vp_h = vp.height()

        hbar = self.scroll_area.horizontalScrollBar()
        vbar = self.scroll_area.verticalScrollBar()

        # If scrollbars are available (image larger than viewport) use them.
        # Otherwise adjust canvas pan offset so the image (and box center)
        # move within the widget to align with the viewport center.
        target_left = int(center_x - (vp_w / 2))
        target_top = int(center_y - (vp_h / 2))

        if hbar.maximum() > 0 or vbar.maximum() > 0:
            # Clamp and apply to scrollbars
            hbar.setValue(max(hbar.minimum(), min(hbar.maximum(), target_left)))
            vbar.setValue(max(vbar.minimum(), min(vbar.maximum(), target_top)))
        else:
            # Compute pan offset so image moves inside canvas to centre the box
            # img_offset_no_pan = max(0, (canvas_width - img_w) / 2)
            canvas_w = self.canvas.width()
            canvas_h = self.canvas.height()
            img_offset_x_no_pan = max(0, (canvas_w - iw) / 2)
            img_offset_y_no_pan = max(0, (canvas_h - ih) / 2)

            # Desired pan to move the box center to viewport center (viewport origin is 0)
            desired_pan_x = (vp_w / 2) - (img_offset_x_no_pan + rect.center().x() - ox)
            desired_pan_y = (vp_h / 2) - (img_offset_y_no_pan + rect.center().y() - oy)

            # Apply pan offset (clamp to reasonable values so image isn't lost)
            # Allow pan to shift image but not beyond image size
            max_pan_x = max(0, canvas_w)
            max_pan_y = max(0, canvas_h)
            clamped_pan_x = max(-max_pan_x, min(max_pan_x, desired_pan_x))
            clamped_pan_y = max(-max_pan_y, min(max_pan_y, desired_pan_y))

            self.canvas._pan_offset = QPointF(clamped_pan_x, clamped_pan_y)

        self.canvas.update()
    
    def get_boxes(self) -> List[DrawingBox]:
        """Get current drawing boxes."""
        return self.canvas.get_boxes()
    
    def _sync_zoom_spinbox(self) -> None:
        """Sync the zoom spin box with canvas zoom."""
        zoom_pct = int(self.canvas.get_zoom() * 100)
        self.spin_zoom.blockSignals(True)
        self.spin_zoom.setValue(zoom_pct)
        self.spin_zoom.blockSignals(False)
        self.zoom_changed.emit(self.canvas.get_zoom())
    
    def _zoom_in(self) -> None:
        """Zoom in by 5%."""
        current = self.spin_zoom.value()
        self.set_zoom(current + 5)
    
    def _zoom_out(self) -> None:
        """Zoom out by 5%."""
        current = self.spin_zoom.value()
        self.set_zoom(max(10, current - 5))
    
    def _on_zoom_spin_changed(self, value: int) -> None:
        """Handle zoom spin box value change."""
        self.canvas.set_zoom(value / 100.0)
        self.zoom_changed.emit(value / 100.0)
    
    def _fit_width(self) -> None:
        """Fit the image to the viewer width."""
        if self.canvas._pixmap is None:
            return
        available_w = self.scroll_area.viewport().width() - 20
        img_w = self.canvas._pixmap.width()
        if img_w > 0:
            zoom = available_w / img_w
            self.canvas.set_zoom(zoom)
            self._sync_zoom_spinbox()
    
    def _fit_height(self) -> None:
        """Fit the image to the viewer height."""
        if self.canvas._pixmap is None:
            return
        available_h = self.scroll_area.viewport().height() - 20
        img_h = self.canvas._pixmap.height()
        if img_h > 0:
            zoom = available_h / img_h
            self.canvas.set_zoom(zoom)
            self._sync_zoom_spinbox()
    
    def center_image(self) -> None:
        """Center the PDF in the viewer by resetting pan offset.

        This resets the canvas pan offset even if no image is currently set
        (helps unit tests and consistent behavior when user wants to re-center).
        """
        # Reset pan offset used by the canvas so the image returns to centered position
        self.canvas._pan_offset = QPointF(0, 0)
        # Also move scrollbars to the middle (helps when image is larger than viewport)
        try:
            hbar = self.scroll_area.horizontalScrollBar()
            vbar = self.scroll_area.verticalScrollBar()
            hbar.setValue((hbar.minimum() + hbar.maximum()) // 2)
            vbar.setValue((vbar.minimum() + vbar.maximum()) // 2)
        except Exception:
            pass
        self.canvas.update()
