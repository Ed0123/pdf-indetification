"""
PDF Tree View widget (1st column).

Displays a tree hierarchy of imported PDF files and their pages.
Supports multi-selection of files and pages for batch operations.

Signals:
    page_selected: Emitted when a page is selected (file_path, page_number).
    selection_changed: Emitted when the selection changes.
"""

from PyQt5.QtWidgets import (
    QTreeWidget,
    QTreeWidgetItem,
    QWidget,
    QVBoxLayout,
    QLabel,
    QAbstractItemView,
)
from PyQt5.QtCore import pyqtSignal, Qt
from PyQt5.QtGui import QIcon, QFont
from typing import List, Tuple, Optional

from models.data_models import ProjectData, PDFFileInfo


class PDFTreeView(QWidget):
    """
    Tree view widget showing the list of imported PDF files and their pages.
    
    The tree has two levels:
    - Level 0: PDF files (showing file name)
    - Level 1: PDF pages (showing "Page X")
    
    Signals:
        page_selected(str, int): Emitted with (file_path, page_number) when
            a page is double-clicked.
        selection_changed(): Emitted when the selection state changes.
        file_delete_requested(list): Emitted with a list of file paths when the
            user clicks the delete button in the header.
    """
    
    page_selected = pyqtSignal(str, int)
    selection_changed = pyqtSignal()
    file_delete_requested = pyqtSignal(list)
    
    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self._setup_ui()
    
    def _setup_ui(self):
        """Initialize the UI layout and tree widget."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Header + action buttons
        from PyQt5.QtWidgets import QHBoxLayout, QPushButton

        header_layout = QHBoxLayout()
        header_layout.setContentsMargins(0, 0, 0, 0)

        header = QLabel("PDF Page List")
        header.setFont(QFont("Segoe UI", 10, QFont.Bold))
        header.setStyleSheet("padding: 6px; background-color: #f0f0f0; border-bottom: 1px solid #ccc;")
        header_layout.addWidget(header)
        header_layout.addStretch()

        # Expand / Collapse buttons
        self.btn_expand_all = QPushButton("Expand All")
        self.btn_expand_all.setFixedWidth(90)
        self.btn_expand_all.setToolTip("Expand all PDF files to show pages")
        self.btn_expand_all.clicked.connect(self.expand_all)
        header_layout.addWidget(self.btn_expand_all)

        self.btn_collapse_all = QPushButton("Collapse All")
        self.btn_collapse_all.setFixedWidth(90)
        self.btn_collapse_all.setToolTip("Collapse all PDF files")
        self.btn_collapse_all.clicked.connect(self.collapse_all)
        header_layout.addWidget(self.btn_collapse_all)

        # delete button - acts on currently-selected file(s)
        self.btn_delete_file = QPushButton("Delete")
        self.btn_delete_file.setFixedWidth(60)
        self.btn_delete_file.setToolTip("Delete selected PDF file(s)")
        self.btn_delete_file.clicked.connect(self._on_delete_files)
        header_layout.addWidget(self.btn_delete_file)

        layout.addLayout(header_layout)
        
        # Tree widget
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.tree.setAnimated(True)
        self.tree.setIndentation(20)
        # Single-click should only change selection so the user can multi-select
        # without changing the currently displayed page. Viewing happens on double-click.
        self.tree.itemClicked.connect(self._on_item_clicked)
        self.tree.itemDoubleClicked.connect(self._on_item_double_clicked)
        self.tree.itemSelectionChanged.connect(self._on_selection_changed)
        
        layout.addWidget(self.tree)

    def _on_delete_files(self):
        """Emit request for deletion of currently selected file paths."""
        paths = self.get_selected_file_paths()
        if paths:
            self.file_delete_requested.emit(paths)
    
    def populate(self, project_data: ProjectData) -> None:
        """
        Populate the tree with PDF files and pages from the project data.
        
        Args:
            project_data: The project data containing PDF file information.
        """
        self.tree.clear()
        
        for pdf_file in project_data.pdf_files:
            file_item = QTreeWidgetItem(self.tree)
            file_item.setText(0, pdf_file.file_name)
            file_item.setToolTip(0, pdf_file.file_path)
            file_item.setData(0, Qt.UserRole, pdf_file.file_path)
            file_item.setData(0, Qt.UserRole + 1, -1)  # -1 means file level
            
            for page in pdf_file.pages:
                page_item = QTreeWidgetItem(file_item)
                page_item.setText(0, f"Page {page.page_number + 1}")
                page_item.setData(0, Qt.UserRole, pdf_file.file_path)
                page_item.setData(0, Qt.UserRole + 1, page.page_number)
            
            file_item.setExpanded(True)
    
    def select_page(self, file_path: str, page_number: int) -> None:
        """
        Programmatically select a specific page in the tree.
        
        Args:
            file_path: Path of the PDF file.
            page_number: Zero-based page number.
        """
        for i in range(self.tree.topLevelItemCount()):
            file_item = self.tree.topLevelItem(i)
            if file_item.data(0, Qt.UserRole) == file_path:
                for j in range(file_item.childCount()):
                    page_item = file_item.child(j)
                    if page_item.data(0, Qt.UserRole + 1) == page_number:
                        self.tree.setCurrentItem(page_item)
                        return
    
    def get_selected_pages(self) -> List[Tuple[str, int]]:
        """
        Get all currently selected pages.
        
        If a file-level item is selected, all its pages are included.
        
        Returns:
            List of (file_path, page_number) tuples.
        """
        selected = []
        for item in self.tree.selectedItems():
            file_path = item.data(0, Qt.UserRole)
            page_num = item.data(0, Qt.UserRole + 1)
            
            if page_num == -1:
                # File-level: select all pages
                for j in range(item.childCount()):
                    child = item.child(j)
                    selected.append((
                        child.data(0, Qt.UserRole),
                        child.data(0, Qt.UserRole + 1),
                    ))
            else:
                selected.append((file_path, page_num))
        
        # Remove duplicates while maintaining order
        seen = set()
        unique = []
        for entry in selected:
            if entry not in seen:
                seen.add(entry)
                unique.append(entry)
        return unique
    
    def get_selected_file_paths(self) -> List[str]:
        """
        Get unique file paths of selected items.
        
        Returns:
            List of unique file paths.
        """
        paths = set()
        for item in self.tree.selectedItems():
            paths.add(item.data(0, Qt.UserRole))
        return list(paths)
    
    def get_current_page(self) -> Optional[Tuple[str, int]]:
        """
        Get the currently focused page.
        
        Returns:
            Tuple of (file_path, page_number), or None if no page is focused.
        """
        item = self.tree.currentItem()
        if item is None:
            return None
        
        file_path = item.data(0, Qt.UserRole)
        page_num = item.data(0, Qt.UserRole + 1)
        
        if page_num == -1:
            # File level - get first page
            if item.childCount() > 0:
                child = item.child(0)
                return (child.data(0, Qt.UserRole), child.data(0, Qt.UserRole + 1))
            return None
        
        return (file_path, page_num)


    def _on_item_clicked(self, item: QTreeWidgetItem, column: int) -> None:
        """Handle single-click selection without emitting page_selected."""
        # Intentionally no-op: single click updates selection state via QTreeWidget
        # and should not trigger page display changes.
        return None


    def _on_item_double_clicked(self, item: QTreeWidgetItem, column: int) -> None:
        """Handle double-click to emit page_selected for viewing the page."""
        file_path = item.data(0, Qt.UserRole)
        page_num = item.data(0, Qt.UserRole + 1)

        if page_num == -1:
            # Double-clicked on file - select first page
            if item.childCount() > 0:
                child = item.child(0)
                self.page_selected.emit(
                    child.data(0, Qt.UserRole),
                    child.data(0, Qt.UserRole + 1),
                )
        else:
            self.page_selected.emit(file_path, page_num)
    
    def _on_selection_changed(self) -> None:
        """Handle selection changes."""
        self.selection_changed.emit()
    
    def highlight_page(self, file_path: str, page_number: int) -> None:
        """
        Visually highlight a specific page item with a bold font.
        
        Args:
            file_path: Path of the PDF file.
            page_number: Zero-based page number.
        """
        # Reset all items
        self._reset_highlights()
        
        for i in range(self.tree.topLevelItemCount()):
            file_item = self.tree.topLevelItem(i)
            if file_item.data(0, Qt.UserRole) == file_path:
                for j in range(file_item.childCount()):
                    page_item = file_item.child(j)
                    if page_item.data(0, Qt.UserRole + 1) == page_number:
                        font = page_item.font(0)
                        font.setBold(True)
                        page_item.setFont(0, font)
                        return
    
    def _reset_highlights(self) -> None:
        """Reset font to normal for all items."""
        for i in range(self.tree.topLevelItemCount()):
            file_item = self.tree.topLevelItem(i)
            for j in range(file_item.childCount()):
                page_item = file_item.child(j)
                font = page_item.font(0)
                font.setBold(False)
                page_item.setFont(0, font)

    # --- Expand / Collapse helpers -------------------------------------------------
    def expand_all(self) -> None:
        """Expand all file-level items so pages are visible."""
        self.tree.expandAll()

    def collapse_all(self) -> None:
        """Collapse all file-level items to hide pages."""
        self.tree.collapseAll()
