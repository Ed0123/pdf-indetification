import copy
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QTableWidget,
    QTableWidgetItem, QHeaderView, QAbstractItemView, QMessageBox,
    QLabel, QSplitter, QWidget, QMenu, QAction
)
from PyQt5.QtCore import Qt
from models.data_models import ProjectData, Template

from PyQt5 import uic
import os

class TemplateManagerDialog(QDialog):
    def __init__(self, project_data: ProjectData, parent=None):
        super().__init__(parent)
        ui_path = os.path.join(os.path.dirname(__file__), "template_manager.ui")
        uic.loadUi(ui_path, self)
        
        self.project_data = project_data
        
        self.template_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.template_table.itemChanged.connect(self._on_template_item_changed)
        
        self.btn_new.clicked.connect(self._on_new)
        self.btn_delete.clicked.connect(self._on_delete)
        
        self.page_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.page_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.page_table.customContextMenuRequested.connect(self._show_context_menu)
        
        self.btn_apply.clicked.connect(self._on_apply)
        
        self.splitter.setSizes([400, 400])
        
        self._load_data()

    def _load_data(self):
        # Disconnect signal to avoid triggering it while loading
        self.template_table.blockSignals(True)
        
        # Load templates
        self.template_table.setRowCount(len(self.project_data.templates))
        for row, template in enumerate(self.project_data.templates):
            self.template_table.setItem(row, 0, QTableWidgetItem(template.name))
            self.template_table.setItem(row, 1, QTableWidgetItem(template.ref_page))
            self.template_table.setItem(row, 2, QTableWidgetItem(template.remark))
            
        self.template_table.blockSignals(False)
            
        # Load pages
        pages = []
        for pdf_file in self.project_data.pdf_files:
            for page in pdf_file.pages:
                pages.append((pdf_file.file_path, page.page_number, f"{pdf_file.file_name} - Page {page.page_number + 1}"))
                
        self.page_table.setRowCount(len(pages))
        for row, (file_path, page_num, display_name) in enumerate(pages):
            item = QTableWidgetItem(display_name)
            item.setData(Qt.UserRole, (file_path, page_num))
            self.page_table.setItem(row, 0, item)
            
            chk_item = QTableWidgetItem()
            chk_item.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk_item.setCheckState(Qt.Unchecked)
            self.page_table.setItem(row, 1, chk_item)

        # if we have a previously selected page, re-select its row so the user
        # sees where they left off (especially after reopen)
        last_sel = getattr(self.project_data, "last_template_manager_page", ("", -1))
        if last_sel and last_sel[0] and last_sel[1] >= 0:
            for row in range(self.page_table.rowCount()):
                data = self.page_table.item(row, 0).data(Qt.UserRole)
                if data == last_sel:
                    self.page_table.selectRow(row)
                    break

    def _on_template_item_changed(self, item):
        row = item.row()
        col = item.column()
        if row < len(self.project_data.templates):
            template = self.project_data.templates[row]
            if col == 0:
                template.name = item.text()
            elif col == 1:
                template.ref_page = item.text()
            elif col == 2:
                template.remark = item.text()

    def _on_new(self):
        new_template = Template(name="New Template", ref_page="", remark="")
        self.project_data.templates.append(new_template)
        self._load_data()
        
        # Select the newly added row
        row = self.template_table.rowCount() - 1
        self.template_table.selectRow(row)
        self.template_table.editItem(self.template_table.item(row, 0))

    def _on_delete(self):
        selected_rows = self.template_table.selectedItems()
        if not selected_rows:
            QMessageBox.warning(self, "Warning", "Please select a template to delete.")
            return
            
        row = selected_rows[0].row()
        template_name = self.template_table.item(row, 0).text()
        
        reply = QMessageBox.question(
            self, "Confirm Delete",
            f"Are you sure you want to delete template '{template_name}'?",
            QMessageBox.Yes | QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self.project_data.templates.pop(row)
            self._load_data()

    def _show_context_menu(self, pos):
        menu = QMenu(self)
        
        check_action = QAction("Check Selected", self)
        check_action.triggered.connect(lambda: self._set_checked_state(Qt.Checked))
        menu.addAction(check_action)
        
        uncheck_action = QAction("Uncheck Selected", self)
        uncheck_action.triggered.connect(lambda: self._set_checked_state(Qt.Unchecked))
        menu.addAction(uncheck_action)
        
        menu.exec_(self.page_table.mapToGlobal(pos))

    def _set_checked_state(self, state):
        selected_items = self.page_table.selectedItems()
        # Get unique rows from selected items
        rows = set(item.row() for item in selected_items)
        for row in rows:
            self.page_table.item(row, 1).setCheckState(state)

    def _on_apply(self):
        selected_template_rows = self.template_table.selectedItems()
        if not selected_template_rows:
            QMessageBox.warning(self, "Warning", "Please select a template to apply.")
            return
            
        template_row = selected_template_rows[0].row()
        template = self.project_data.templates[template_row]
        
        # Get selected pages (only by checkbox)
        selected_pages = []
        
        # Check checkboxes
        for row in range(self.page_table.rowCount()):
            if self.page_table.item(row, 1).checkState() == Qt.Checked:
                selected_pages.append(self.page_table.item(row, 0).data(Qt.UserRole))
                    
        if not selected_pages:
            QMessageBox.warning(self, "Warning", "Please check at least one page to apply the template to.")
            return

        # Determine the reference page (if parseable) so we can skip it
        ref_file = None
        ref_page_num = None
        if template.ref_page and " - Page " in template.ref_page:
            parts = template.ref_page.rsplit(" - Page ", 1)
            if len(parts) == 2:
                ref_file = parts[0]
                try:
                    ref_page_num = int(parts[1]) - 1
                except ValueError:
                    ref_page_num = None

        # discard any selected page that matches the ref page
        filtered = []
        for file_path, pn in selected_pages:
            if (
                ref_file
                and os.path.basename(file_path) == ref_file
                and ref_page_num == pn
            ):
                continue
            filtered.append((file_path, pn))
        if not filtered:
            QMessageBox.information(
                self, "Info",
                "Template was not applied because only the reference page was selected."
            )
            return
        selected_pages = filtered

        # before closing keep the last highlighted page so we can restore it
        selected_rows = self.page_table.selectedItems()
        if selected_rows:
            r = selected_rows[0].row()
            sel = self.page_table.item(r, 0).data(Qt.UserRole)
            self.project_data.last_template_manager_page = sel

        # Apply template to selected pages
        for file_path, page_num in selected_pages:
            pdf_file = self.project_data.get_file_by_path(file_path)
            if pdf_file:
                page = pdf_file.get_page(page_num)
                if page:
                    # Clear all existing boxes first
                    page.boxes.clear()
                    
                    # Apply boxes from template
                    for box in template.boxes:
                        new_box = copy.deepcopy(box)
                        new_box.extracted_text = "" # Clear extracted text
                        page.set_box_for_column(new_box)
                        
        QMessageBox.information(self, "Success", f"Template '{template.name}' applied to {len(selected_pages)} pages.")
        self.accept()
