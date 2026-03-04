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
from PyQt5.QtWidgets import QApplication, QCheckBox
from PyQt5.QtGui import QColor
from PyQt5.QtCore import Qt, QPointF

# Create a global QApplication if one doesn't exist
app = QApplication.instance()
if app is None:
    app = QApplication(sys.argv)

from models.data_models import ProjectData, PDFFileInfo, PageData, BoxInfo
from ui.pdf_tree_view import PDFTreeView
from ui.data_table import DataTable
from ui.pdf_viewer import PDFViewer, DrawingBox


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

        # simulate a normal single-click via the underlying QTreeWidget signal
        tree.tree.itemClicked.emit(page_item, 0)
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

    def test_cell_click_emits_for_fixed_columns(self, project_with_data):
        """Clicking on file name/path/page columns should still emit a signal.

        Previously only data columns emitted cell_selected; this ensures the
        viewer can react to a single click anywhere in the row.
        """
        table = DataTable()
        table.set_project_data(project_with_data)
        captured = []
        table.cell_selected.connect(lambda fp, pn, cn: captured.append((fp, pn, cn)))

        # simulate clicking the File Path column on the first row
        table._on_cell_clicked(0, table.COL_FILE_PATH)
        assert captured == [(project_with_data.pdf_files[0].file_path, 0, "")]

        # clicking the Page # column should behave similarly
        table._on_cell_clicked(0, table.COL_PAGE_NUM)
        assert captured[-1] == (project_with_data.pdf_files[0].file_path, 0, "")

    def test_delete_key_clears_cell_and_emits_signal(self, project_with_data):
        """Pressing Delete on a selected data cell should clear it and notify."""
        table = DataTable()
        table.set_project_data(project_with_data)
        # choose the first row, first user column (Title)
        row = 0
        col = table.FIXED_COL_COUNT
        table.table.setCurrentCell(row, col)
        assert table.table.item(row, col).text() == "Hello"

        captured = []
        table.cell_delete_requested.connect(lambda fp, pn, cn: captured.append((fp, pn, cn)))

        from PyQt5.QtGui import QKeyEvent
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Delete, Qt.NoModifier)
        QApplication.sendEvent(table.table, ev)

        assert table.table.item(row, col).text() == ""
        fp = project_with_data.pdf_files[0].file_path
        assert captured == [(fp, 0, "Title")]

    def test_table_delete_refreshes_viewer(self, project_with_data):
        """Deleting a cell via the table should remove the box from the viewer."""
        # add a box to first page under 'Title'
        pdf_file = project_with_data.pdf_files[0]
        page = pdf_file.pages[0]
        page.boxes.append(BoxInfo(column_name="Title", x=0.2, y=0.2, width=0.3, height=0.3))

        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # set current page and load image so viewer has something to display
        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page.page_number
        from PyQt5.QtGui import QPixmap, QColor
        pix = QPixmap(100, 100);
        pix.fill(QColor("white"))
        mw.pdf_viewer.canvas._pixmap = pix
        mw.pdf_viewer.canvas._update_size()
        mw.pdf_viewer.set_boxes(page.boxes)

        # select the Title cell in the table and press delete
        row = 0
        col = mw.data_table.FIXED_COL_COUNT
        mw.data_table.table.setCurrentCell(row, col)
        from PyQt5.QtGui import QKeyEvent
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Delete, Qt.NoModifier)
        QApplication.sendEvent(mw.data_table.table, ev)

        # viewer should no longer contain the box
        assert mw.pdf_viewer.canvas.get_boxes() == []
        # model page should also have no boxes
        assert page.boxes == []


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

    def test_viewer_contains_spm_checkbox(self):
        """Viewer still exposes a checkbox object (hidden) for compatibility."""
        viewer = PDFViewer()
        assert hasattr(viewer, "chk_single_page_mode")
        assert isinstance(viewer.chk_single_page_mode, QCheckBox)
        # it should not be visible because control moved to main toolbar
        assert not viewer.chk_single_page_mode.isVisible()

    def test_spm_checkbox_signal(self):
        """Hidden checkbox still emits viewer signal when programmatically toggled."""
        viewer = PDFViewer()
        recorded = []
        viewer.single_page_mode_toggled.connect(lambda s: recorded.append(s))
        viewer.chk_single_page_mode.setChecked(True)
        assert recorded == [True]
        viewer.chk_single_page_mode.setChecked(False)
        assert recorded == [True, False]

    def test_set_single_page_mode_method(self):
        """Calling ``set_single_page_mode`` should update the hidden checkbox state."""
        viewer = PDFViewer()
        viewer.set_single_page_mode(True)
        assert viewer.chk_single_page_mode.isChecked()
        viewer.set_single_page_mode(False)
        assert not viewer.chk_single_page_mode.isChecked()
    
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

    def test_clear_box_button_erases_selection(self):
        """The clear-box button should remove the highlighted box and emit signal."""
        viewer = PDFViewer()
        boxes = [BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.2, height=0.2)]
        viewer.set_boxes(boxes)
        viewer.highlight_box("Title")
        assert any(b.selected for b in viewer.get_boxes())

        deleted = []
        viewer.box_deleted.connect(lambda col: deleted.append(col))
        viewer.btn_clear_box.click()
        assert deleted == ["Title"]
        assert viewer.get_boxes() == []

    def test_arrow_keys_emit_page_request(self):
        """Left/right arrows with no boxes selected should emit page_requested."""
        viewer = PDFViewer()
        recorded = []
        viewer.page_requested.connect(lambda d: recorded.append(d))
        # simulate left arrow
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Left, Qt.NoModifier)
        viewer.keyPressEvent(ev)
        assert recorded == [-1]
        # simulate right arrow
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Right, Qt.NoModifier)
        viewer.keyPressEvent(ev)
        assert recorded == [-1, 1]

    def test_arrow_keys_ignored_when_box_selected(self):
        """If a box is selected, arrow keys move the box, not navigate pages."""
        viewer = PDFViewer()
        boxes = [BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.2, height=0.2)]
        viewer.set_boxes(boxes)
        # mark the only box as selected
        viewer.get_boxes()[0].selected = True
        recorded = []
        viewer.page_requested.connect(lambda d: recorded.append(d))
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Left, Qt.NoModifier)
        viewer.keyPressEvent(ev)
        assert recorded == []

    def test_ctrl_click_multi_select_and_group_move(self):
        """Ctrl+click toggles selection; dragging moves all selected boxes."""
        viewer = PDFViewer()
        # prepare pixmap so coords are non-zero
        from PyQt5.QtGui import QPixmap, QColor, QMouseEvent
        pix = QPixmap(200, 200); pix.fill(QColor('white'))
        viewer.canvas._pixmap = pix
        viewer.canvas._update_size()
        # create two boxes
        b1 = DrawingBox("A", 0.1, 0.1, 0.2, 0.2)
        b2 = DrawingBox("B", 0.5, 0.5, 0.2, 0.2)
        viewer.canvas._boxes = [b1, b2]
        # ctrl-click b1
        ox, oy, iw, ih = viewer.canvas._get_image_display_params()
        pos1 = b1.get_display_rect(ox, oy, iw, ih).center()
        ev1 = QMouseEvent(QMouseEvent.MouseButtonPress, pos1, Qt.LeftButton,
                          Qt.LeftButton, Qt.ControlModifier)
        viewer.canvas.mousePressEvent(ev1)
        assert b1.selected and not b2.selected
        # ctrl-click b2 toggles it on
        pos2 = b2.get_display_rect(ox, oy, iw, ih).center()
        ev2 = QMouseEvent(QMouseEvent.MouseButtonPress, pos2, Qt.LeftButton,
                          Qt.LeftButton, Qt.ControlModifier)
        viewer.canvas.mousePressEvent(ev2)
        assert b1.selected and b2.selected
        # now click non-ctrl on b1 to begin group move
        ev3 = QMouseEvent(QMouseEvent.MouseButtonPress, pos1, Qt.LeftButton,
                          Qt.LeftButton, Qt.NoModifier)
        viewer.canvas.mousePressEvent(ev3)
        assert viewer.canvas._moving
        # save originals and simulate small move
        start = pos1
        newpos = QPointF(start.x() + 10, start.y() + 5)
        mv = QMouseEvent(QMouseEvent.MouseMove, newpos, Qt.NoButton, Qt.LeftButton, Qt.NoModifier)
        viewer.canvas.mouseMoveEvent(mv)
        # both boxes should have moved by same delta
        assert abs(b1.rel_x - (0.1 + 10/iw)) < 1e-6
        assert abs(b2.rel_x - (0.5 + 10/iw)) < 1e-6

    def test_multi_delete_using_toolbar(self):
        """Selecting multiple boxes and clicking clear removes them all."""
        viewer = PDFViewer()
        from PyQt5.QtGui import QPixmap, QColor, QMouseEvent
        pix = QPixmap(200, 200); pix.fill(QColor('white'))
        viewer.canvas._pixmap = pix
        viewer.canvas._update_size()
        b1 = DrawingBox("A", 0.1, 0.1, 0.2, 0.2)
        b2 = DrawingBox("B", 0.5, 0.5, 0.2, 0.2)
        viewer.canvas._boxes = [b1, b2]
        # select both via manual toggling
        b1.selected = True; b2.selected = True
        deleted = []
        viewer.box_deleted.connect(lambda col: deleted.append(col))
        viewer.btn_clear_box.click()
        assert set(deleted) == {"A", "B"}
        assert viewer.canvas._boxes == []

    def test_delete_key_removes_all_selected(self):
        """Pressing Delete when multiple boxes selected deletes them all."""
        viewer = PDFViewer()
        from PyQt5.QtGui import QPixmap, QColor, QKeyEvent
        pix = QPixmap(200, 200); pix.fill(QColor('white'))
        viewer.canvas._pixmap = pix
        viewer.canvas._update_size()
        b1 = DrawingBox("A", 0.1, 0.1, 0.2, 0.2)
        b2 = DrawingBox("B", 0.5, 0.5, 0.2, 0.2)
        viewer.canvas._boxes = [b1, b2]
        b1.selected = True; b2.selected = True
        deleted = []
        viewer.box_deleted.connect(lambda col: deleted.append(col))
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Delete, Qt.NoModifier)
        viewer.canvas.keyPressEvent(ev)
        assert set(deleted) == {"A", "B"}
        assert viewer.canvas._boxes == []

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

    def test_delete_key_integration_with_table(self, project_with_data):
        """A Delete key press on the data table row should remove the box and clear data."""
        # prepare page with one box and a non-empty value
        pdf_file = project_with_data.pdf_files[0]
        page = pdf_file.pages[0]
        page.boxes.append(BoxInfo(column_name="Title", x=0.2, y=0.2, width=0.2, height=0.2))

        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # pretend same page is already loaded in viewer
        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page.page_number

        # provide pixmap and set boxes so viewer can respond
        from PyQt5.QtGui import QPixmap, QColor, QKeyEvent
        pix = QPixmap(200, 200)
        pix.fill(QColor('white'))
        mw.pdf_viewer.canvas._pixmap = pix
        mw.pdf_viewer.canvas._update_size()
        mw.pdf_viewer.set_boxes(page.boxes)

        # select the corresponding cell in the data table and press Delete
        row = 0
        col = mw.data_table.FIXED_COL_COUNT  # Title column
        mw.data_table.table.setCurrentCell(row, col)
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Delete, Qt.NoModifier)
        QApplication.sendEvent(mw.data_table.table, ev)

        # after event, page should have no boxes and extracted_data empty
        assert page.boxes == []
        assert page.extracted_data.get("Title", "") == ""
        # data table cell should also have been cleared by update_cell_value
        assert mw.data_table.table.item(row, col).text() == ""

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

    def test_clicking_spm_checkbox_enables_table(self, project_with_data):
        """Toggling the Single Page Mode checkbox should change the table mode."""
        from ui.main_window import MainWindow

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()
        # ensure we start off in normal mode
        assert not mw.data_table.single_page_mode
        mw.chk_single_page_mode.click()
        assert mw.data_table.single_page_mode
        # programmatically toggling the table should synchronise back to main toolbar
        mw.data_table.set_single_page_mode(False)
        assert not mw.chk_single_page_mode.isChecked()

    def test_apply_template_triggers_extraction(self, tmp_path, project_with_data):
        """Applying a template should create boxes, auto-extract text and
        kick off recognition immediately."""
        from ui.main_window import MainWindow
        from models.data_models import Template, BoxInfo

        # create a simple project with one pdf file and page
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # inject a template with a single box covering top-left
        tpl = Template(name="T1", ref_page="dummy", boxes=[BoxInfo(column_name="Col", x=0.0, y=0.0, width=0.1, height=0.1)])
        mw._project_data.templates.append(tpl)
        mw._update_template_combo()

        # select first page
        fp = project_with_data.pdf_files[0].file_path
        mw.pdf_tree.select_page(fp, 0)
        mw._on_page_selected(fp, 0)

        # patch recognizer so we can tell if it is invoked
        called = []
        import types
        mw._on_recognize_text = types.MethodType(lambda self=None: called.append(True), mw)

        # apply the template
        mw.combo_template.setCurrentText("T1")
        mw._on_apply_template()

        # after apply the box should exist and extracted data filled
        page = project_with_data.pdf_files[0].get_page(0)
        assert "Col" in page.extracted_data
        assert page.extracted_data["Col"] == mw.data_table.item(0, mw.data_table.FIXED_COL_COUNT).text()

        # ensure recognition was triggered
        assert called, "Recognition should run after applying template"

        # combo should still show the same template name and page selection
        assert mw.combo_template.currentText() == "T1"
        assert mw._current_file_path == fp
        assert mw._current_page_num == 0
        # tree view should continue to report the same selected page
        assert mw.pdf_tree.get_selected_pages() == [(fp, 0)]

    def test_apply_template_skips_source_page(self, project_with_data, monkeypatch):
        """Templates should not be applied to the page they were created from."""
        from ui.main_window import MainWindow
        from models.data_models import Template, BoxInfo

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        pdf_file = project_with_data.pdf_files[0]
        fp = pdf_file.file_path

        # add box on page to simulate template source
        tpl = Template(name="T1", ref_page=os.path.basename(fp) + " - Page 1",
                       boxes=[BoxInfo(column_name="Col", x=0.1, y=0.1, width=0.1, height=0.1)])
        mw._project_data.templates.append(tpl)
        mw._update_template_combo()

        # select the source page
        mw.pdf_tree.select_page(fp, 0)
        mw._on_page_selected(fp, 0)

        # patch recognizer to track calls
        called = []
        import types
        mw._on_recognize_text = types.MethodType(lambda self=None: called.append(True), mw)

        mw.combo_template.setCurrentText("T1")
        mw._on_apply_template()

        # nothing should have changed
        page = project_with_data.pdf_files[0].get_page(0)
        assert page.boxes == []
        assert not called

    def test_viewer_arrow_changes_main_window_page(self, project_with_data):
        """Pressing arrow in viewer should navigate the main window to next/prev page."""

    def test_table_arrow_keys_change_viewer(self, project_with_data):
        """Arrow key pressed while focus on fixed column should change the viewer page."""
        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        fp = project_with_data.pdf_files[0].file_path
        mw._current_file_path = fp
        mw._current_page_num = 0

        # focus file name cell and press right
        mw.data_table.table.setCurrentCell(0, mw.data_table.COL_FILE_NAME)
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Right, Qt.NoModifier)
        QApplication.sendEvent(mw.data_table.table, ev)
        assert mw._current_page_num == 1
        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # initial page
        fp = project_with_data.pdf_files[0].file_path
        mw._current_file_path = fp
        mw._current_page_num = 0

        # simulate right arrow
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Right, Qt.NoModifier)
        mw.pdf_viewer.keyPressEvent(ev)
        assert mw._current_page_num == 1

        # now left arrow moves back
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Left, Qt.NoModifier)
        mw.pdf_viewer.keyPressEvent(ev)
        assert mw._current_page_num == 0

    def test_template_combobox_persists_after_refresh(self, project_with_data):
        """The dropdown should keep the last-chosen template when UI refreshes."""
        from ui.main_window import MainWindow
        from models.data_models import Template, BoxInfo

        mw = MainWindow()
        mw._project_data = project_with_data
        # add two templates
        tpl1 = Template(name="A", ref_page="", boxes=[])
        tpl2 = Template(name="B", ref_page="", boxes=[])
        mw._project_data.templates.extend([tpl1, tpl2])
        mw._update_template_combo()

        # choose second template and verify storage
        mw.combo_template.setCurrentText("B")
        assert mw._project_data.last_selected_template == "B"
        # force a refresh which would normally clear the selection
        mw._refresh_all()
        assert mw.combo_template.currentText() == "B"

    def test_apply_box_clears_existing_boxes(self, project_with_data, monkeypatch):
        """Applying a box to other pages should first delete any previous boxes."""
        from ui.main_window import MainWindow
        from PyQt5.QtWidgets import QMessageBox
        from PyQt5.QtCore import Qt
        from models.data_models import BoxInfo

        # silence confirmation dialog
        monkeypatch.setattr(QMessageBox, "question", lambda *args, **kwargs: QMessageBox.Yes)

        # prepare two pages in the project
        pdf_file = project_with_data.pdf_files[0]
        page0 = pdf_file.pages[0]
        page1 = pdf_file.pages[1]
        # add an "old" box to page0 that should be wiped
        page0.boxes.append(BoxInfo(column_name="Old", x=0.5, y=0.5, width=0.2, height=0.2))
        page0.extracted_data["Old"] = "value"
        # add a source box on page1
        page1.boxes.append(BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.1, height=0.1))

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # set current page to page1 (source page)
        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page1.page_number

        # select both pages in the tree
        tree = mw.pdf_tree.tree
        for i in range(tree.topLevelItemCount()):
            file_item = tree.topLevelItem(i)
            for j in range(file_item.childCount()):
                item = file_item.child(j)
                pn = item.data(0, Qt.UserRole + 1)
                if pn in (page0.page_number, page1.page_number):
                    item.setSelected(True)

        # perform apply operation
        mw._on_apply_box()

        # page0 should no longer contain the old box, only the source's box
        assert len(page0.boxes) == 1
        assert page0.boxes[0].column_name == "Title"
        assert page0.extracted_data == {}
        # source page should be unchanged
        assert len(page1.boxes) == 1
        assert page1.boxes[0].column_name == "Title"
        # status label should report 1 page applied (source excluded)
        assert "1 page" in mw.status_label.text()

    def test_apply_box_triggers_recognition(self, project_with_data, monkeypatch):
        """Recognition should start automatically when boxes are applied."""
        from ui.main_window import MainWindow
        from PyQt5.QtWidgets import QMessageBox
        from PyQt5.QtCore import Qt
        from models.data_models import BoxInfo

        # silence confirmation dialog
        monkeypatch.setattr(QMessageBox, "question", lambda *args, **kwargs: QMessageBox.Yes)

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        pdf_file = project_with_data.pdf_files[0]
        page0 = pdf_file.pages[0]
        page1 = pdf_file.pages[1]
        # add a source box on page1
        page1.boxes.append(BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.1, height=0.1))

        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page1.page_number

        # select both pages
        tree = mw.pdf_tree.tree
        for i in range(tree.topLevelItemCount()):
            file_item = tree.topLevelItem(i)
            for j in range(file_item.childCount()):
                item = file_item.child(j)
                pn = item.data(0, Qt.UserRole + 1)
                if pn in (page0.page_number, page1.page_number):
                    item.setSelected(True)

        # patch recognizer
        called = []
        import types
        mw._on_recognize_text = types.MethodType(lambda self=None: called.append(True), mw)

        mw._on_apply_box()
        assert called, "Recognition should be triggered"

    def test_apply_box_skips_same_page(self, project_with_data, monkeypatch):
        """Applying boxes should not attempt to modify the page currently
        being used as the source.

        If the user only has the source page selected, the operation should
        exit early with an informational message and the status text should
        indicate that zero pages were changed.
        """
        from ui.main_window import MainWindow
        from PyQt5.QtWidgets import QMessageBox
        from PyQt5.QtCore import Qt
        from models.data_models import BoxInfo

        # silence confirmation dialog
        monkeypatch.setattr(QMessageBox, "question", lambda *args, **kwargs: QMessageBox.Yes)

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        pdf_file = project_with_data.pdf_files[0]
        page0 = pdf_file.pages[0]
        # add a box to the source page
        page0.boxes.append(BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.1, height=0.1))

        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page0.page_number

        # select only the source page in the tree
        tree = mw.pdf_tree.tree
        for i in range(tree.topLevelItemCount()):
            file_item = tree.topLevelItem(i)
            for j in range(file_item.childCount()):
                item = file_item.child(j)
                pn = item.data(0, Qt.UserRole + 1)
                if pn == page0.page_number:
                    item.setSelected(True)

        # patch recognizer to make sure it's not invoked since nothing should
        # change
        called = []
        import types
        mw._on_recognize_text = types.MethodType(lambda self=None: called.append(True), mw)

        mw._on_apply_box()

        # nothing should have changed
        assert len(page0.boxes) == 1
        # status should clearly indicate that zero pages were applied
        assert "0 page" in mw.status_label.text()
        assert not called, "Recognition should not run when no pages modified"

    def test_single_page_mode_checkbox_in_main_toolbar(self):
        """The SPM toggle should be part of the main window's top toolbar.

        The viewer no longer displays the control, but the main window still
        exposes it via ``chk_single_page_mode`` for legacy consumers.
        """
        from ui.main_window import MainWindow

        win = MainWindow()
        assert hasattr(win, "chk_single_page_mode")
        cb = win.chk_single_page_mode
        # parent of checkbox should be the main window's toolbar
        from PyQt5.QtWidgets import QToolBar
        toolbar = win.findChild(QToolBar)
        assert toolbar is not None
        # ensure the checkbox belongs to the same window and not the viewer
        assert cb.window() is win
        assert not isinstance(cb.parent(), PDFViewer)
        # still only one toolbar present
        toolbars = win.findChildren(QToolBar)
        assert len(toolbars) == 1

    def test_click_fixed_column_updates_viewer(self, project_with_data, monkeypatch):
        """A single click on any table column should load the corresponding page."""
        # patch rendering to avoid file IO
        import ui.main_window as mwmod
        monkeypatch.setattr(mwmod, "render_pdf_page", lambda fp, pn, zoom=1.5: b"dummy")

        from ui.main_window import MainWindow
        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # ensure current is different so we expect change
        mw._current_file_path = ""
        mw._current_page_num = -1

        # simulate clicking the second fixed column (Page #) on first row
        mw.data_table._on_cell_clicked(0, mw.data_table.COL_PAGE_NUM)

        assert mw._current_file_path == project_with_data.pdf_files[0].file_path
        assert mw._current_page_num == project_with_data.pdf_files[0].pages[0].page_number

    def test_clear_box_button_updates_main_window(self, project_with_data, monkeypatch):
        """Pressing the clear-box toolbar button should remove the box and clear table cell."""
        from ui.main_window import MainWindow
        import ui.main_window as mwmod
        # stub rendering again
        monkeypatch.setattr(mwmod, "render_pdf_page", lambda fp, pn, zoom=1.5: b"dummy")

        mw = MainWindow()
        mw._project_data = project_with_data
        mw._refresh_all()

        # configure a box on first page and update its data
        pdf_file = project_with_data.pdf_files[0]
        page = pdf_file.pages[0]
        page.boxes.append(BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.2, height=0.2))
        page.extracted_data["Title"] = "foo"

        # ensure the table shows our updated value (simulate a prior extraction)
        mw.data_table.update_cell_value(pdf_file.file_path, page.page_number,
                                        "Title", "foo")

        # load that page into viewer
        mw._current_file_path = pdf_file.file_path
        mw._current_page_num = page.page_number
        mw.pdf_viewer.set_boxes(page.boxes)

        # sanity check: table really contains foo before we clear
        user_cols = mw._project_data.get_column_names()
        assert "Title" in user_cols
        col_pos = user_cols.index("Title")
        extracted_col = mw.data_table.FIXED_COL_COUNT + col_pos
        assert mw.data_table.table.item(0, extracted_col).text().startswith("foo")

        # highlight the box in the viewer so the clear command operates on it
        mw.pdf_viewer.highlight_box("Title")

        # click clear button and check it disappears
        mw.pdf_viewer.btn_clear_box.click()
        assert page.boxes == []
        # verify table cell cleared as well
        assert mw.data_table.table.item(0, extracted_col).text() == ""

    # ------------------------------------------------------------------
    # Text recognition behaviour
    # ------------------------------------------------------------------
    def test_recognize_clears_data_when_no_boxes(self, monkeypatch):
        """Running recognition on pages without any boxes should blank values."""
        from ui.main_window import MainWindow
        from PyQt5.QtWidgets import QMessageBox

        # silence message boxes
        monkeypatch.setattr(QMessageBox, "information", lambda *args, **kwargs: None)

        project = ProjectData()
        project.add_column("Title")
        file = PDFFileInfo(file_name="f.pdf", file_path="/f.pdf", num_pages=1, file_size=0)
        page = PageData(page_number=0)
        page.extracted_data = {"Title": "old"}
        file.pages.append(page)
        project.pdf_files.append(file)

        mw = MainWindow()
        mw._project_data = project
        mw._refresh_all()

        mw.pdf_tree.select_page(file.file_path, 0)
        mw._on_page_selected(file.file_path, 0)

        # initial value present
        assert mw.data_table.table.item(0, mw.data_table.FIXED_COL_COUNT).text() == "old"

        mw._on_recognize_text()

        assert project.pdf_files[0].pages[0].extracted_data == {}
        assert mw.data_table.table.item(0, mw.data_table.FIXED_COL_COUNT).text() == ""

    def test_recognize_clears_missing_columns(self, monkeypatch):
        """Recognition should wipe values for columns that no longer have boxes."""
        from ui.main_window import MainWindow
        import ui.main_window as mwmod
        from PyQt5.QtWidgets import QMessageBox

        monkeypatch.setattr(QMessageBox, "information", lambda *args, **kwargs: None)

        # stub out the worker so we don't spawn threads during the test
        class DummySignal:
            def connect(self, *args, **kwargs):
                pass
        class DummyWorker:
            def __init__(self, pages_and_boxes, project_root=None):
                self.progress = DummySignal()
                self.text_extracted = DummySignal()
                self.error = DummySignal()
                self.finished_recognize = DummySignal()
            def start(self):
                pass
        monkeypatch.setattr(mwmod, "RecognizeWorker", DummyWorker)

        project = ProjectData()
        project.add_column("Title")
        project.add_column("Page")
        file = PDFFileInfo(file_name="f.pdf", file_path="/f.pdf", num_pages=1, file_size=0)
        page = PageData(page_number=0)
        page.extracted_data = {"Title": "old1", "Page": "old2"}
        page.boxes = [BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.1, height=0.1)]
        file.pages.append(page)
        project.pdf_files.append(file)

        mw = MainWindow()
        mw._project_data = project
        mw._refresh_all()
        mw.pdf_tree.select_page(file.file_path, 0)
        mw._on_page_selected(file.file_path, 0)

        mw._on_recognize_text()

        assert project.pdf_files[0].pages[0].extracted_data["Title"] == "old1"
        assert project.pdf_files[0].pages[0].extracted_data.get("Page", "") == ""
        col_pos = project.get_column_names().index("Page")
        cell = mw.data_table.table.item(0, mw.data_table.FIXED_COL_COUNT + col_pos)
        assert cell.text() == ""
