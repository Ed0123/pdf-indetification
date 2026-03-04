"""
Test cases for UI components.

Tests basic instantiation and behavior of UI widgets where possible
without a full QApplication event loop.

Tests:
- DataTable: column management, cell updates
- PDFTreeView: population, selection
- PDFViewer: zoom, image setting
"""

import os
import sys
import pytest

# We need a QApplication for widget tests
from PyQt5.QtWidgets import QApplication
from PyQt5.QtGui import QColor
from PyQt5.QtCore import Qt, QPointF

# Create a global QApplication if one doesn't exist
app = QApplication.instance()
if app is None:
    app = QApplication(sys.argv)

from models.data_models import ProjectData, PDFFileInfo, PageData, BoxInfo
from ui.pdf_tree_view import PDFTreeView
from ui.data_table import DataTable
from ui.pdf_viewer import PDFViewer


@pytest.fixture
def project_with_data():
    """Create a sample project for UI tests."""
    project = ProjectData()
    project.add_column("Title")
    project.add_column("Page")
    
    file1 = PDFFileInfo(
        file_name="test.pdf",
        file_path="C:/test/test.pdf",
        num_pages=2,
        file_size=1000,
    )
    p1 = PageData(page_number=0)
    p1.extracted_data = {"Title": "Hello", "Page": "1"}
    p2 = PageData(page_number=1)
    p2.extracted_data = {"Title": "World", "Page": "2"}
    file1.pages = [p1, p2]
    
    project.pdf_files = [file1]
    return project


class TestPDFTreeView:
    """Tests for the PDF Tree View widget."""
    
    def test_create(self):
        """Test creating the tree view widget."""
        tree = PDFTreeView()
        assert tree is not None
    
    def test_populate(self, project_with_data):
        """Test populating the tree with project data."""
        tree = PDFTreeView()
        tree.populate(project_with_data)
        assert tree.tree.topLevelItemCount() == 1
    
    def test_populate_pages(self, project_with_data):
        """Test that pages are added as children."""
        tree = PDFTreeView()
        tree.populate(project_with_data)
        file_item = tree.tree.topLevelItem(0)
        assert file_item.childCount() == 2

    def test_page_column_sorts_numerically(self):
        """Ensure the `Page #` column sorts by integer value, not string."""
        from models.data_models import PDFFileInfo, PageData

        project = ProjectData()
        # Create a file with pages in order: 1, 10, 2 (displayed)
        file = PDFFileInfo(file_name="s.pdf", file_path="C:/s.pdf", num_pages=3, file_size=0)
        # page_number is zero-based internally
        p1 = PageData(page_number=0)   # displays '1'
        p2 = PageData(page_number=9)   # displays '10'
        p3 = PageData(page_number=1)   # displays '2'
        file.pages = [p1, p2, p3]
        project.pdf_files = [file]

        table = DataTable()
        table.set_project_data(project)

        # Trigger ascending sort on Page # column
        table.table.sortItems(table.COL_PAGE_NUM, Qt.AscendingOrder)

        # Collect displayed page numbers after sort
        displayed = [int(table.table.item(r, table.COL_PAGE_NUM).text()) for r in range(table.table.rowCount())]
        assert displayed == [1, 2, 10]  # numeric sort order

    
    def test_get_selected_pages_empty(self):
        """Test getting selections when nothing is selected."""
        tree = PDFTreeView()
        assert tree.get_selected_pages() == []
    
    def test_get_current_page_none(self):
        """Test getting current page when nothing is selected."""
        tree = PDFTreeView()
        assert tree.get_current_page() is None
    
    def test_populate_clear_and_repopulate(self, project_with_data):
        """Test that re-populating clears old data."""
        tree = PDFTreeView()
        tree.populate(project_with_data)
        assert tree.tree.topLevelItemCount() == 1
        
        # Add another file
        from models.data_models import PDFFileInfo, PageData
        file2 = PDFFileInfo(file_name="b.pdf", file_path="/b.pdf", num_pages=1)
        file2.pages = [PageData(page_number=0)]
        project_with_data.pdf_files.append(file2)
        
        tree.populate(project_with_data)
        assert tree.tree.topLevelItemCount() == 2

    def test_expand_collapse_buttons(self, project_with_data):
        """Buttons should collapse and expand the file entries in the tree."""
        tree = PDFTreeView()
        tree.populate(project_with_data)

        # Populate expands top-level files by default
        file_item = tree.tree.topLevelItem(0)
        assert file_item.isExpanded() is True

        # Collapse all via button
        tree.btn_collapse_all.click()
        assert file_item.isExpanded() is False

        # Expand all via button
        tree.btn_expand_all.click()
        assert file_item.isExpanded() is True

    def test_delete_button_emits_signal(self, project_with_data):
        """Clicking the delete header button should emit file_delete_requested."""
        tree = PDFTreeView()
        tree.populate(project_with_data)

        captured = []
        tree.file_delete_requested.connect(lambda paths: captured.append(paths))

        # select the file-level item
        file_item = tree.tree.topLevelItem(0)
        tree.tree.setCurrentItem(file_item)
        tree.tree.setItemSelected(file_item, True)

        tree.btn_delete_file.click()
        assert captured == [[project_with_data.pdf_files[0].file_path]]

    def test_double_click_emits_page_selected(self, project_with_data):
        """Double-clicking a page (or file) should emit page_selected for viewing."""
        tree = PDFTreeView()
        tree.populate(project_with_data)

        file_item = tree.tree.topLevelItem(0)
        page_item = file_item.child(0)

        captured = []
        tree.page_selected.connect(lambda fp, pn: captured.append((fp, pn)))

        # simulate double-click on page
        tree._on_item_double_clicked(page_item, 0)
        assert captured == [("C:/test/test.pdf", 0)]

        # simulate double-click on file (should select first page)
        captured.clear()
        tree._on_item_double_clicked(file_item, 0)
        assert captured == [("C:/test/test.pdf", 0)]

    def test_single_click_does_not_emit_page_selected(self, project_with_data):
        """Single-click should change selection only and must NOT emit page_selected."""
        tree = PDFTreeView()
        tree.populate(project_with_data)

        file_item = tree.tree.topLevelItem(0)
        page_item = file_item.child(0)

        captured = []
        tree.page_selected.connect(lambda fp, pn: captured.append((fp, pn)))

        tree._on_item_clicked(page_item, 0)
        assert captured == []


class TestDataTable:
    """Tests for the Data Table widget."""
    
    def test_create(self):
        """Test creating the data table."""
        table = DataTable()
        assert table is not None
    
    def test_set_project_data(self, project_with_data):
        """Test setting project data populates the table."""
        table = DataTable()
        table.set_project_data(project_with_data)
        assert table.table.rowCount() == 2  # 2 pages
    
    def test_column_count(self, project_with_data):
        """Test that column count includes fixed + custom columns."""
        table = DataTable()
        table.set_project_data(project_with_data)
        # 3 fixed (File Name, File Path, Page #) + 2 custom (Title, Page)
        assert table.table.columnCount() == 5
    
    def test_cell_values(self, project_with_data):
        """Test that cell values are populated correctly."""
        table = DataTable()
        table.set_project_data(project_with_data)
        # First row, File Name column
        item = table.table.item(0, 0)
        assert item.text() == "test.pdf"
    
    def test_refresh(self, project_with_data):
        """Test refreshing the table."""
        table = DataTable()
        table.set_project_data(project_with_data)
        
        # Modify data
        project_with_data.pdf_files[0].pages[0].extracted_data["Title"] = "Modified"
        table.refresh()
        
        # Check updated value (Title is at column index 3)
        item = table.table.item(0, 3)
        assert item.text() == "Modified"
    
    def test_update_cell_value(self, project_with_data):
        """Test updating a specific cell value."""
        table = DataTable()
        table.set_project_data(project_with_data)
        table.update_cell_value("C:/test/test.pdf", 0, "Title", "Updated Title")
        
        item = table.table.item(0, 3)
        assert item.text() == "Updated Title"

    def test_highlight_persistence_on_update(self, project_with_data):
        """Highlight should persist for the same page after updating a cell."""
        table = DataTable()
        table.set_project_data(project_with_data)

        # Highlight first page
        table.highlight_row_for_page("C:/test/test.pdf", 0)
        # Ensure highlight applied
        fn_item = table.table.item(0, 0)
        assert fn_item.background().color().name() == QColor("#D6EAF8").name()

        # Update a cell on the same page and ensure the highlight remains on that page
        table.update_cell_value("C:/test/test.pdf", 0, "Title", "Updated")

        # Find the row for that page and verify background is still highlight color
        found_row = None
        for r in range(table.table.rowCount()):
            it = table.table.item(r, table.COL_FILE_NAME)
            if it and it.data(Qt.UserRole) == "C:/test/test.pdf" and it.data(Qt.UserRole + 1) == 0:
                found_row = r
                break
        assert found_row is not None
        assert table.table.item(found_row, 0).background().color().name() == QColor("#D6EAF8").name()

    def test_refresh_preserves_last_selection_highlight(self, project_with_data):
        """If project remembers last selection, refresh should reapply the highlight."""
        table = DataTable()
        # Set project data and simulate last selection stored in model
        project_with_data.last_selected_file = "C:/test/test.pdf"
        project_with_data.last_selected_page = 1
        table.set_project_data(project_with_data)

        # After set_project_data/refresh the highlight should be applied to page 1
        found_row = None
        for r in range(table.table.rowCount()):
            it = table.table.item(r, table.COL_FILE_NAME)
            if it and it.data(Qt.UserRole) == "C:/test/test.pdf" and it.data(Qt.UserRole + 1) == 1:
                found_row = r
                break
        assert found_row is not None
        assert table.table.item(found_row, 0).background().color().name() == QColor("#D6EAF8").name()


class TestPDFViewer:
    """Tests for the PDF Viewer widget."""
    
    def test_create(self):
        """Test creating the PDF viewer."""
        viewer = PDFViewer()
        assert viewer is not None
    
    def test_set_zoom(self):
        """Test setting zoom level."""
        viewer = PDFViewer()
        viewer.set_zoom(200)
        assert viewer.spin_zoom.value() == 200
    
    def test_set_active_column(self):
        """Test setting the active column for drawing."""
        viewer = PDFViewer()
        viewer.set_active_column("Title")
        assert viewer.canvas._active_column == "Title"
    
    def test_set_boxes(self):
        """Test setting boxes to display."""
        viewer = PDFViewer()
        boxes = [
            BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.3, height=0.05),
            BoxInfo(column_name="Page", x=0.5, y=0.5, width=0.2, height=0.03),
        ]
        viewer.set_boxes(boxes)
        assert len(viewer.get_boxes()) == 2
    
    def test_highlight_box(self):
        """Test highlighting a box by column name."""
        viewer = PDFViewer()
        boxes = [
            BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.3, height=0.05),
            BoxInfo(column_name="Page", x=0.5, y=0.5, width=0.2, height=0.03),
        ]
        viewer.set_boxes(boxes)
        viewer.highlight_box("Title")
        
        drawing_boxes = viewer.get_boxes()
        title_box = [b for b in drawing_boxes if b.column_name == "Title"][0]
        page_box = [b for b in drawing_boxes if b.column_name == "Page"][0]
        assert title_box.selected is True
        assert page_box.selected is False
    
    def test_center_image_resets_pan(self):
        """Centering should reset any pan offset on the canvas."""
        viewer = PDFViewer()
        # simulate pan offset
        viewer.canvas._pan_offset = QPointF(42.5, -13.0)
        assert viewer.canvas._pan_offset != QPointF(0, 0)
        viewer.center_image()
        assert viewer.canvas._pan_offset == QPointF(0, 0)
    
    def test_center_button_click(self):
        """Clicking the 'Centre' button should call center_image()."""
        viewer = PDFViewer()
        viewer.canvas._pan_offset = QPointF(10, 20)
        viewer.btn_center.click()
        assert viewer.canvas._pan_offset == QPointF(0, 0)

    def test_center_on_box_scrolls_to_box(self):
        """Centering on an existing box should move scrollbars so the box is visible."""
        viewer = PDFViewer()
        # create a synthetic pixmap so display params are non-zero
        from PyQt5.QtGui import QPixmap, QColor
        pix = QPixmap(800, 600)
        pix.fill(QColor("white"))
        viewer.canvas._pixmap = pix
        viewer.canvas._update_size()
        # add a box near the bottom-right quadrant
        boxes = [BoxInfo(column_name="Title", x=0.75, y=0.6, width=0.1, height=0.1)]
        viewer.set_boxes(boxes)

        # ensure viewport is smaller than image so scrollbars are present
        assert viewer.canvas._pixmap.width() > 0

        # call center_on_box and verify scrollbars moved
        viewer.center_on_box("Title")
        hbar = viewer.scroll_area.horizontalScrollBar()
        vbar = viewer.scroll_area.verticalScrollBar()

        # Compute expected center and compare (allow some tolerance)
        ox, oy, iw, ih = viewer.canvas._get_image_display_params()
        rect = viewer.get_boxes()[0].get_display_rect(ox, oy, iw, ih)
        expected_left = int(rect.center().x() - viewer.scroll_area.viewport().width() / 2)
        expected_top = int(rect.center().y() - viewer.scroll_area.viewport().height() / 2)

        assert abs(hbar.value() - expected_left) <= 2
        assert abs(vbar.value() - expected_top) <= 2

    def test_table_cell_click_centres_box(self, project_with_data):
        """Clicking a data cell should cause the PDF viewer to focus the drawn box."""
        # Add a box to the first page for column 'Title'
        pdf_file = project_with_data.pdf_files[0]
        page = pdf_file.pages[0]
        page.boxes.append(BoxInfo(column_name="Title", x=0.6, y=0.4, width=0.15, height=0.1))

        # Create main window and populate UI from project
        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # Pretend the page is already loaded so _on_table_cell_selected won't re-render
        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page.page_number

        # Put a pixmap on the viewer and set boxes
        from PyQt5.QtGui import QPixmap, QColor
        pix = QPixmap(1000, 800)
        pix.fill(QColor("white"))
        mw.pdf_viewer.canvas._pixmap = pix
        mw.pdf_viewer.canvas._update_size()
        mw.pdf_viewer.set_boxes(page.boxes)

        # Emit the table cell_selected signal as if user clicked the 'Title' cell
        mw.data_table.cell_selected.emit(pdf_file.file_path, page.page_number, "Title")

        # After handling, viewer should have scrolled so the box centre is visible
        hbar = mw.pdf_viewer.scroll_area.horizontalScrollBar()
        vbar = mw.pdf_viewer.scroll_area.verticalScrollBar()
        ox, oy, iw, ih = mw.pdf_viewer.canvas._get_image_display_params()
        rect = mw.pdf_viewer.get_boxes()[0].get_display_rect(ox, oy, iw, ih)

        expected_left = int(rect.center().x() - mw.pdf_viewer.scroll_area.viewport().width() / 2)
        expected_top = int(rect.center().y() - mw.pdf_viewer.scroll_area.viewport().height() / 2)

        # Accept either scrollbar movement (when present) OR a pan offset change
        if hbar.maximum() > 0 or vbar.maximum() > 0:
            assert abs(hbar.value() - expected_left) <= 4
            assert abs(vbar.value() - expected_top) <= 4
        else:
            # ensure canvas pan offset changed so the box is centered inside viewport
            pan = mw.pdf_viewer.canvas._pan_offset
            assert pan != QPointF(0, 0)

    def test_clear_image(self):
        """Test clearing the image."""
        viewer = PDFViewer()
        viewer.clear_image()
        assert viewer.canvas._pixmap is None

    def test_main_window_shows_ocr_status(self):
        """Main window should expose an OCR status label in the status bar."""
        from ui.main_window import MainWindow

        window = MainWindow()
        assert hasattr(window, "ocr_label")
        # Label should start with the 'OCR:' prefix so UI shows the debug state
        assert window.ocr_label.text().startswith("OCR:")
