"""
Data Table widget (2nd column).

Displays extracted data in a table format with sortable/filterable columns.
Supports:
- Default columns: File Name, File Path (hidden by default)
- User-defined extracted data columns
- Adding/removing columns
- Showing/hiding columns
- Manual cell editing
- Highlighting the row for the currently selected PDF page

Signals:
    cell_selected: Emitted when a cell in a data column is clicked (file_path, page_number, column_name).
    data_edited: Emitted when cell data is manually edited (file_path, page_number, column_name, new_value).
"""

from PyQt5.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QPushButton,
    QInputDialog,
    QMenu,
    QAction,
    QLabel,
    QAbstractItemView,
    QMessageBox,
    QFrame,
)
from PyQt5.QtCore import pyqtSignal, Qt
from PyQt5.QtGui import QFont, QColor, QBrush
from typing import Optional, List, Tuple

from models.data_models import ProjectData


from PyQt5 import uic
import os

# QTableWidgetItem subclass that supports a separate sort key (used for numeric sorting)
class SortableTableWidgetItem(QTableWidgetItem):
    """Table item that will compare using an explicit sort-key when present.

    - Store the sort key in a dedicated custom item data role (Qt.UserRole + 3)
    - __lt__ will prefer that key for comparison so numeric columns sort
      numerically while still displaying formatted text.
    """
    SORT_KEY_ROLE = Qt.UserRole + 3

    def __init__(self, text: str = "", sort_key=None):
        super().__init__(text)
        if sort_key is not None:
            self.setData(self.SORT_KEY_ROLE, sort_key)

    def __lt__(self, other: QTableWidgetItem) -> bool:  # type: ignore[override]
        a = self.data(self.SORT_KEY_ROLE)
        b = other.data(self.SORT_KEY_ROLE)
        if a is not None and b is not None:
            try:
                return a < b
            except Exception:
                pass
        return super().__lt__(other)


class DataTable(QWidget):
    """
    Table widget for displaying and editing extracted data.
    
    Columns:
    - File Name (always present, visible by default)
    - File Path (always present, hidden by default)
    - User-defined extracted data columns
    
    Signals:
        cell_selected(str, int, str): Emitted with (file_path, page_number, column_name).
        data_edited(str, int, str, str): Emitted with (file_path, page_number, column_name, new_value).
    """
    
    cell_selected = pyqtSignal(str, int, str)
    # emitted when the user presses the Delete key while a data cell is selected.
    # parameters are (file_path, page_number, column_name)
    cell_delete_requested = pyqtSignal(str, int, str)
    data_edited = pyqtSignal(str, int, str, str)
    page_navigated = pyqtSignal(str, int)  # Emitted when SPM prev/next navigation changes page
    single_page_mode_changed = pyqtSignal(bool)  # signal when SPM state is toggled
    
    # Fixed columns
    COL_FILE_NAME = 0
    COL_FILE_PATH = 1
    COL_PAGE_NUM = 2
    FIXED_COL_COUNT = 3
    
    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self._project_data: Optional[ProjectData] = None
        self._editing = False
        self._highlighted_row = -1

        # Single Page Mode state
        self._single_page_mode: bool = False
        self._spm_pages_flat: List[Tuple[str, int]] = []  # (file_path, page_number)
        self._spm_index: int = -1  # index into _spm_pages_flat

        ui_path = os.path.join(os.path.dirname(__file__), "data_table.ui")
        uic.loadUi(ui_path, self)
        
        self.spm_nav_bar.setVisible(False)
        self._spm_separator.setVisible(False)
        
        self.btn_prev_page.clicked.connect(self._on_prev_page)
        self.btn_next_page.clicked.connect(self._on_next_page)
        self.table.cellClicked.connect(self._on_cell_clicked)
        self.table.cellChanged.connect(self._on_cell_changed)
        self.btn_add_column.clicked.connect(self._on_add_column)
        self.btn_remove_column.clicked.connect(self._on_remove_column)
        self.btn_columns_visibility.clicked.connect(self._on_columns_visibility)

        # allow catching key presses (delete) on the table
        self.table.installEventFilter(self)
    
    def set_project_data(self, project_data: ProjectData) -> None:
        """
        Set the project data and refresh the table.
        
        Args:
            project_data: The ProjectData to display.
        """
        self._project_data = project_data
        self.refresh()
    
    def refresh(self) -> None:
        """Rebuild the table from the current project data."""
        if self._project_data is None:
            return

        # ---- Rebuild the flat pages list used by Single Page Mode navigation ----
        self._spm_pages_flat = [
            (pdf_file.file_path, page.page_number)
            for pdf_file in self._project_data.pdf_files
            for page in pdf_file.pages
        ]

        # Clamp / invalidate the SPM index if the project data changed
        if self._spm_index >= len(self._spm_pages_flat):
            self._spm_index = len(self._spm_pages_flat) - 1

        # Temporarily disable sorting to avoid row reordering mid-update
        _sorting_was_enabled = self.table.isSortingEnabled()
        self.table.setSortingEnabled(False)
        
        self._editing = True  # Suppress cellChanged during rebuild
        
        # Build column headers
        column_names = self._project_data.get_column_names()
        headers = ["File Name", "File Path", "Page #"] + column_names

        # Decide which (file, page) pairs to render
        if self._single_page_mode:
            if self._spm_index >= 0:
                spm_file, spm_page = self._spm_pages_flat[self._spm_index]
                pairs_to_render = [
                    (pdf_file, page)
                    for pdf_file in self._project_data.pdf_files
                    for page in pdf_file.pages
                    if pdf_file.file_path == spm_file and page.page_number == spm_page
                ]
            else:
                # SPM active but no page selected yet — show empty table
                pairs_to_render = []
                
            # In Single Page Mode, we show Attribute | Extracted Data
            headers = ["Attribute", "Extracted Data"]
            self.table.setColumnCount(len(headers))
            self.table.setHorizontalHeaderLabels(headers)
            
            if not pairs_to_render:
                self.table.setRowCount(0)
            else:
                pdf_file, page = pairs_to_render[0]
                
                # Filter visible columns
                visible_columns = [col for col in self._project_data.columns if col.visible]
                self.table.setRowCount(len(visible_columns))
                
                for row, col in enumerate(visible_columns):
                    # Attribute (read-only)
                    item_attr = QTableWidgetItem(col.name)
                    item_attr.setFlags(item_attr.flags() & ~Qt.ItemIsEditable)
                    item_attr.setData(Qt.UserRole, pdf_file.file_path)
                    item_attr.setData(Qt.UserRole + 1, page.page_number)
                    item_attr.setData(Qt.UserRole + 2, col.name)
                    self.table.setItem(row, 0, item_attr)
                    
                    # Extracted Data (editable)
                    value = page.extracted_data.get(col.name, "")
                    item_val = QTableWidgetItem(str(value))
                    item_val.setData(Qt.UserRole, pdf_file.file_path)
                    item_val.setData(Qt.UserRole + 1, page.page_number)
                    item_val.setData(Qt.UserRole + 2, col.name)
                    self.table.setItem(row, 1, item_val)
                    
            # Show all columns in SPM (since there are only 2)
            for i in range(self.table.columnCount()):
                self.table.setColumnHidden(i, False)
                
        else:
            pairs_to_render = [
                (pdf_file, page)
                for pdf_file in self._project_data.pdf_files
                for page in pdf_file.pages
            ]

            total_rows = len(pairs_to_render)
            
            self.table.setColumnCount(len(headers))
            self.table.setRowCount(total_rows)
            self.table.setHorizontalHeaderLabels(headers)
            
            # Hide File Path column by default
            self.table.setColumnHidden(self.COL_FILE_PATH, True)
            
            # Apply column visibility settings
            for idx, col in enumerate(self._project_data.columns):
                col_index = self.FIXED_COL_COUNT + idx
                if col_index < self.table.columnCount():
                    self.table.setColumnHidden(col_index, not col.visible)
            
            # Populate rows
            for row, (pdf_file, page) in enumerate(pairs_to_render):
                    # File Name (read-only)
                    item_fn = QTableWidgetItem(pdf_file.file_name)
                    item_fn.setFlags(item_fn.flags() & ~Qt.ItemIsEditable)
                    item_fn.setData(Qt.UserRole, pdf_file.file_path)
                    item_fn.setData(Qt.UserRole + 1, page.page_number)
                    self.table.setItem(row, self.COL_FILE_NAME, item_fn)
                    
                    # File Path (read-only)
                    item_fp = QTableWidgetItem(pdf_file.file_path)
                    item_fp.setFlags(item_fp.flags() & ~Qt.ItemIsEditable)
                    item_fp.setData(Qt.UserRole, pdf_file.file_path)
                    item_fp.setData(Qt.UserRole + 1, page.page_number)
                    self.table.setItem(row, self.COL_FILE_PATH, item_fp)
                    
                    # Page Number (read-only) — use SortableTableWidgetItem so sorting is numeric
                    item_pn = SortableTableWidgetItem(str(page.page_number + 1), sort_key=(page.page_number + 1))
                    item_pn.setFlags(item_pn.flags() & ~Qt.ItemIsEditable)
                    item_pn.setData(Qt.UserRole, pdf_file.file_path)
                    item_pn.setData(Qt.UserRole + 1, page.page_number)
                    self.table.setItem(row, self.COL_PAGE_NUM, item_pn)
                    
                    # Extracted data columns (editable)
                    for col_idx, col_name in enumerate(column_names):
                        value = page.extracted_data.get(col_name, "")
                        item = QTableWidgetItem(str(value))
                        item.setData(Qt.UserRole, pdf_file.file_path)
                        item.setData(Qt.UserRole + 1, page.page_number)
                        item.setData(Qt.UserRole + 2, col_name)
                        self.table.setItem(row, self.FIXED_COL_COUNT + col_idx, item)
        
        # Resize columns to content
        self.table.resizeColumnsToContents()
        
        self._editing = False
        # Restore sorting state
        self.table.setSortingEnabled(_sorting_was_enabled)
        
        # Update SPM navigation bar
        self._update_spm_nav()

        # If project remembers last selection, restore highlight for that page
        try:
            last_file = getattr(self._project_data, "last_selected_file", "")
            last_page = getattr(self._project_data, "last_selected_page", -1)
            if last_file and last_page >= 0:
                self.highlight_row_for_page(last_file, last_page)
        except Exception:
            pass
    
    def highlight_row_for_page(self, file_path: str, page_number: int) -> None:
        """
        Highlight the table row corresponding to a specific PDF page.
        
        Args:
            file_path: Path of the PDF file.
            page_number: Zero-based page number.
        """
        if self._single_page_mode:
            # In SPM, the whole table is for the selected page, so we don't highlight a specific row
            # unless we want to highlight the selected column. For now, just return.
            return
            
        highlight_color = QBrush(QColor("#D6EAF8"))
        default_color1 = QBrush(QColor("#FFFFFF"))
        default_color2 = QBrush(QColor("#F5F5F5"))
        
        for row in range(self.table.rowCount()):
            item = self.table.item(row, self.COL_FILE_NAME)
            if item is None:
                continue
            
            row_file = item.data(Qt.UserRole)
            row_page = item.data(Qt.UserRole + 1)
            
            if row_file == file_path and row_page == page_number:
                color = highlight_color
                self._highlighted_row = row
            else:
                color = default_color1 if row % 2 == 0 else default_color2
            
            for col in range(self.table.columnCount()):
                cell = self.table.item(row, col)
                if cell:
                    cell.setBackground(color)

    # ===== Single Page Mode =====

    def set_single_page_mode(self, enabled: bool) -> None:
        """
        Enable or disable Single Page Mode.

        In Single Page Mode only the row for the currently selected page is
        shown in the table, with Previous / Next navigation buttons to switch
        between pages.

        Args:
            enabled: True to enable, False to disable.
        """
        self._single_page_mode = enabled
        # notify any listeners so external widgets (e.g. MainWindow) can
        # remain in sync
        self.single_page_mode_changed.emit(enabled)
        self.spm_nav_bar.setVisible(enabled)
        self._spm_separator.setVisible(enabled)

        # In SPM, sorting / interactive resizing must stay disabled while the
        # nav bar is active so the user does not accidentally reorder the
        # single visible row.
        self.table.setSortingEnabled(not enabled)
        
        if enabled:
            self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        else:
            self.table.setSelectionBehavior(QAbstractItemView.SelectItems)

        self.refresh()

    @property
    def single_page_mode(self) -> bool:
        """Return True if Single Page Mode is currently enabled."""
        return self._single_page_mode

    def navigate_to_page(self, file_path: str, page_number: int) -> None:
        """
        Update the Single Page Mode view to show *file_path / page_number*.

        Called by MainWindow whenever the user selects a page in the tree or
        clicks a cell in the table.  Has no effect when SPM is disabled.

        Args:
            file_path: Absolute path of the PDF file.
            page_number: Zero-based page number.
        """
        # Rebuild flat list if it is stale (e.g. called before first refresh)
        if not self._spm_pages_flat and self._project_data:
            self._spm_pages_flat = [
                (f.file_path, p.page_number)
                for f in self._project_data.pdf_files
                for p in f.pages
            ]

        try:
            self._spm_index = self._spm_pages_flat.index((file_path, page_number))
        except ValueError:
            # Page not found in the flat list — keep the current index
            pass

        if self._single_page_mode:
            self.refresh()

    def _update_spm_nav(self) -> None:
        """Refresh the navigation bar label and button states."""
        total = len(self._spm_pages_flat)

        if not self._single_page_mode or total == 0:
            self.spm_page_label.setText("No page selected")
            self.btn_prev_page.setEnabled(False)
            self.btn_next_page.setEnabled(False)
            return

        if self._spm_index < 0:
            self.spm_page_label.setText("No page selected")
            self.btn_prev_page.setEnabled(False)
            self.btn_next_page.setEnabled(False)
            return

        file_path, page_number = self._spm_pages_flat[self._spm_index]
        import os as _os
        file_name = _os.path.basename(file_path)
        self.spm_page_label.setText(
            f"{file_name}  |  Page {page_number + 1}  ({self._spm_index + 1} / {total})"
        )
        self.btn_prev_page.setEnabled(self._spm_index > 0)
        self.btn_next_page.setEnabled(self._spm_index < total - 1)

    def _on_prev_page(self) -> None:
        """Navigate to the previous page in Single Page Mode."""
        if self._spm_index > 0:
            self._spm_index -= 1
            file_path, page_number = self._spm_pages_flat[self._spm_index]
            self.refresh()
            self.page_navigated.emit(file_path, page_number)

    def _on_next_page(self) -> None:
        """Navigate to the next page in Single Page Mode."""
        if self._spm_index < len(self._spm_pages_flat) - 1:
            self._spm_index += 1
            file_path, page_number = self._spm_pages_flat[self._spm_index]
            self.refresh()
            self.page_navigated.emit(file_path, page_number)

    def get_selected_cell_info(self) -> Optional[Tuple[str, int, str]]:
        """
        Get the info of the currently selected cell.
        
        Returns:
            Tuple of (file_path, page_number, column_name), or None.
        """
        item = self.table.currentItem()
        if item is None:
            return None
        
        file_path = item.data(Qt.UserRole)
        page_number = item.data(Qt.UserRole + 1)
        column_name = item.data(Qt.UserRole + 2)
        
        if file_path is None or page_number is None:
            return None
        
        return (file_path, page_number, column_name or "")
    
    def _on_cell_clicked(self, row: int, column: int) -> None:
        """Handle cell click to emit cell_selected signal.

        Previously the signal was only emitted for "data columns" (user-defined
        extracted fields). A click on the fixed File Name / File Path / Page #
        columns was ignored. To satisfy the requirement that clicking anywhere on
        a row should immediately switch the PDF viewer, we now emit the signal for
        any cell.  If the column has no associated name the third argument will be
        an empty string.
        """
        item = self.table.item(row, column)
        if item is None:
            return

        file_path = item.data(Qt.UserRole)
        page_number = item.data(Qt.UserRole + 1)
        column_name = item.data(Qt.UserRole + 2) or ""

        # Only emit when we at least have a valid file/page pair.  The column
        # name may be empty for fixed columns.
        if file_path and page_number is not None:
            self.cell_selected.emit(file_path, page_number, column_name)
    
    def _on_cell_changed(self, row: int, column: int) -> None:
        """Handle cell edit to emit data_edited signal and update model."""
        if self._editing:
            return
        
        item = self.table.item(row, column)
        if item is None:
            return
        
        file_path = item.data(Qt.UserRole)
        page_number = item.data(Qt.UserRole + 1)
        column_name = item.data(Qt.UserRole + 2)
        
        if file_path and page_number is not None and column_name:
            new_value = item.text()
            # Update the model
            if self._project_data:
                pdf_file = self._project_data.get_file_by_path(file_path)
                if pdf_file:
                    page = pdf_file.get_page(page_number)
                    if page:
                        page.extracted_data[column_name] = new_value
            self.data_edited.emit(file_path, page_number, column_name, new_value)
    
    def _on_add_column(self) -> None:
        """Show dialog to add a new extracted data column."""
        if self._project_data is None:
            return
        
        name, ok = QInputDialog.getText(
            self, "Add Column", "Enter column name:"
        )
        if ok and name.strip():
            name = name.strip()
            try:
                self._project_data.add_column(name)
                self.refresh()
            except ValueError as e:
                QMessageBox.warning(self, "Error", str(e))
    
    def _on_remove_column(self) -> None:
        """Show dialog to remove an extracted data column."""
        if self._project_data is None:
            return
        
        column_names = self._project_data.get_column_names()
        if not column_names:
            QMessageBox.information(self, "Info", "No columns to remove.")
            return
        
        name, ok = QInputDialog.getItem(
            self, "Remove Column", "Select column to remove:",
            column_names, 0, False
        )
        if ok and name:
            reply = QMessageBox.question(
                self, "Confirm",
                f"Remove column '{name}' and all its data?",
                QMessageBox.Yes | QMessageBox.No,
            )
            if reply == QMessageBox.Yes:
                self._project_data.remove_column(name)
                self.refresh()
    
    def eventFilter(self, obj, event):
        """Catch key presses on the underlying QTableWidget.

        We override the event filter rather than subclassing QTableWidget so we
        can intercept the Delete key when the table has focus.  When Delete is
        pressed and a data cell is selected we clear the cell, emit the normal
        :signal:`data_edited` event (via the cellChanged handling) and also
        notify listeners with :signal:`cell_delete_requested` so the main
        window can remove any corresponding box in the viewer.
        """
        from PyQt5.QtCore import QEvent

        if obj is self.table and event.type() == QEvent.KeyPress:
            key = event.key()
            if key == Qt.Key_Delete:
                info = self.get_selected_cell_info()
                if info is not None:
                    file_path, page_number, column_name = info
                    # only react for data columns (column_name non-empty)
                    if column_name:
                        # clear the cell text; this will trigger cellChanged ->
                        # model update and emit data_edited automatically
                        item = self.table.currentItem()
                        if item is not None:
                            item.setText("")
                        # notify any listeners so external components (main
                        # window) can delete the box
                        self.cell_delete_requested.emit(file_path, page_number, column_name)
                        # eat the event so default behaviour (if any) stops
                        return True
            # navigation via left/right when in first two fixed columns
            if key in (Qt.Key_Left, Qt.Key_Right):
                current = self.table.currentItem()
                if current is not None:
                    col = self.table.currentColumn()
                    if col in (self.COL_FILE_NAME, self.COL_FILE_PATH, self.COL_PAGE_NUM):
                        info = self.get_selected_cell_info()
                        if info is not None:
                            file_path, page_number, _ = info
                            pdf_file = self._project_data.get_file_by_path(file_path)
                            if pdf_file:
                                if key == Qt.Key_Left and page_number > 0:
                                    new_page = page_number - 1
                                elif key == Qt.Key_Right and page_number < len(pdf_file.pages) - 1:
                                    new_page = page_number + 1
                                else:
                                    new_page = None
                                if new_page is not None:
                                    # emit same as a click so main window will load
                                    self.cell_selected.emit(file_path, new_page, "")
                                    return True
        return super().eventFilter(obj, event)
        return super().eventFilter(obj, event)

    def _on_columns_visibility(self) -> None:
        """Show a pop-up menu to toggle column visibility."""
        menu = QMenu(self)
        
        if not self._single_page_mode:
            # File Name
            action_fn = QAction("File Name", menu)
            action_fn.setCheckable(True)
            action_fn.setChecked(not self.table.isColumnHidden(self.COL_FILE_NAME))
            action_fn.triggered.connect(
                lambda checked: self.table.setColumnHidden(self.COL_FILE_NAME, not checked)
            )
            menu.addAction(action_fn)
            
            # File Path
            action_fp = QAction("File Path", menu)
            action_fp.setCheckable(True)
            action_fp.setChecked(not self.table.isColumnHidden(self.COL_FILE_PATH))
            action_fp.triggered.connect(
                lambda checked: self.table.setColumnHidden(self.COL_FILE_PATH, not checked)
            )
            menu.addAction(action_fp)
            
            # Page Number
            action_pn = QAction("Page #", menu)
            action_pn.setCheckable(True)
            action_pn.setChecked(not self.table.isColumnHidden(self.COL_PAGE_NUM))
            action_pn.triggered.connect(
                lambda checked: self.table.setColumnHidden(self.COL_PAGE_NUM, not checked)
            )
            menu.addAction(action_pn)
            
            menu.addSeparator()
        
        # User-defined columns
        if self._project_data:
            for idx, col in enumerate(self._project_data.columns):
                col_index = self.FIXED_COL_COUNT + idx
                action = QAction(col.name, menu)
                action.setCheckable(True)
                action.setChecked(col.visible)
                
                def toggle_col(checked, ci=col_index, c=col):
                    c.visible = checked
                    if self._single_page_mode:
                        self.refresh()
                    else:
                        self.table.setColumnHidden(ci, not checked)
                
                action.triggered.connect(toggle_col)
                menu.addAction(action)
        
        menu.exec_(self.btn_columns_visibility.mapToGlobal(
            self.btn_columns_visibility.rect().bottomLeft()
        ))
    
    def update_cell_value(self, file_path: str, page_number: int, column_name: str, value: str) -> None:
        """
        Update a specific cell value in the table.
        
        Args:
            file_path: Path of the PDF file.
            page_number: Zero-based page number.
            column_name: Name of the data column.
            value: New value to set.
        """
        # Disable sorting while updating a single cell to avoid row reordering
        _sorting_was_enabled = self.table.isSortingEnabled()
        self.table.setSortingEnabled(False)

        self._editing = True
        
        if self._single_page_mode:
            # In SPM, rows are columns
            for row in range(self.table.rowCount()):
                item = self.table.item(row, 0) # Attribute column
                if item is None:
                    continue
                if item.data(Qt.UserRole) == file_path and item.data(Qt.UserRole + 1) == page_number and item.data(Qt.UserRole + 2) == column_name:
                    cell = self.table.item(row, 1) # Extracted Data column
                    if cell:
                        cell.setText(value)
                    break
        else:
            for row in range(self.table.rowCount()):
                item = self.table.item(row, self.COL_FILE_NAME)
                if item is None:
                    continue
                if item.data(Qt.UserRole) == file_path and item.data(Qt.UserRole + 1) == page_number:
                    # Find the column
                    if self._project_data:
                        col_names = self._project_data.get_column_names()
                        if column_name in col_names:
                            col_idx = self.FIXED_COL_COUNT + col_names.index(column_name)
                            cell = self.table.item(row, col_idx)
                            if cell:
                                cell.setText(value)
                    break
                    
        self._editing = False

        # Restore sorting and reapply highlight for the updated page so the visual state stays correct
        self.table.setSortingEnabled(_sorting_was_enabled)
        try:
            self.highlight_row_for_page(file_path, page_number)
        except Exception:
            pass
