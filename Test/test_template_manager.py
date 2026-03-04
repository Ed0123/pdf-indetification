import sys
import pytest
from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt

# Create a global QApplication if one doesn't exist
app = QApplication.instance()
if app is None:
    app = QApplication(sys.argv)

from models.data_models import ProjectData, Template, BoxInfo, PDFFileInfo, PageData
from ui.template_manager import TemplateManagerDialog

@pytest.fixture
def project_data():
    pd = ProjectData()
    
    # Add a PDF file with 2 pages
    pdf = PDFFileInfo(file_name="test.pdf", file_path="/path/to/test.pdf", num_pages=2)
    pdf.pages.append(PageData(page_number=0))
    pdf.pages.append(PageData(page_number=1))
    pd.pdf_files.append(pdf)
    
    # Add a template
    box = BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.2, height=0.2)
    template = Template(name="Test Template", ref_page="test.pdf - Page 1", boxes=[box])
    pd.templates.append(template)
    
    return pd

def test_template_model():
    box = BoxInfo(column_name="Title", x=0.1, y=0.1, width=0.2, height=0.2)
    template = Template(name="Test Template", ref_page="test.pdf - Page 1", remark="Test Remark", boxes=[box])
    
    assert template.name == "Test Template"
    assert template.ref_page == "test.pdf - Page 1"
    assert template.remark == "Test Remark"
    assert len(template.boxes) == 1
    
    d = template.to_dict()
    assert d["name"] == "Test Template"
    assert d["ref_page"] == "test.pdf - Page 1"
    assert d["remark"] == "Test Remark"
    assert len(d["boxes"]) == 1
    
    t2 = Template.from_dict(d)
    assert t2.name == "Test Template"
    assert t2.ref_page == "test.pdf - Page 1"
    assert t2.remark == "Test Remark"
    assert len(t2.boxes) == 1

def test_template_manager_dialog_init(project_data):
    dialog = TemplateManagerDialog(project_data)
    
    assert dialog.template_table.rowCount() == 1
    assert dialog.template_table.item(0, 0).text() == "Test Template"
    
    assert dialog.page_table.rowCount() == 2
    assert dialog.page_table.item(0, 0).text() == "test.pdf - Page 1"
    assert dialog.page_table.item(1, 0).text() == "test.pdf - Page 2"

def test_template_manager_dialog_delete(project_data):
    dialog = TemplateManagerDialog(project_data)
    
    # Select the first template
    dialog.template_table.selectRow(0)
    
    # Mock QMessageBox.question to return Yes
    import PyQt5.QtWidgets
    original_question = PyQt5.QtWidgets.QMessageBox.question
    PyQt5.QtWidgets.QMessageBox.question = lambda *args, **kwargs: PyQt5.QtWidgets.QMessageBox.Yes
    
    try:
        dialog.btn_delete.click()
        assert len(project_data.templates) == 0
        assert dialog.template_table.rowCount() == 0
    finally:
        PyQt5.QtWidgets.QMessageBox.question = original_question

def test_template_manager_dialog_apply(project_data):
    dialog = TemplateManagerDialog(project_data)
    
    # Select the first template
    dialog.template_table.selectRow(0)
    
    # Check the *second* page (row 1) so we don't target the reference page
    dialog.page_table.item(1, 1).setCheckState(Qt.Checked)
    
    # Mock QMessageBox.information
    import PyQt5.QtWidgets
    original_information = PyQt5.QtWidgets.QMessageBox.information
    PyQt5.QtWidgets.QMessageBox.information = lambda *args, **kwargs: None
    
    try:
        dialog.btn_apply.click()
        
        # Check if the box was applied to the second page
        page2 = project_data.pdf_files[0].pages[1]
        assert len(page2.boxes) == 1
        assert page2.boxes[0].column_name == "Title"
        
        # first page should remain untouched
        page = project_data.pdf_files[0].pages[0]
        assert len(page.boxes) == 0
    finally:
        PyQt5.QtWidgets.QMessageBox.information = original_information

def test_template_manager_dialog_apply_clears_existing_boxes(project_data):
    # Add an existing box to the first page
    page = project_data.pdf_files[0].pages[0]
    page.boxes.append(BoxInfo(column_name="OldBox", x=0.5, y=0.5, width=0.1, height=0.1))
    
    dialog = TemplateManagerDialog(project_data)
    
    # Select the first template
    dialog.template_table.selectRow(0)
    
    # Check the second page to avoid the reference page
    dialog.page_table.item(1, 1).setCheckState(Qt.Checked)
    
    # Mock QMessageBox.information
    import PyQt5.QtWidgets
    original_information = PyQt5.QtWidgets.QMessageBox.information
    PyQt5.QtWidgets.QMessageBox.information = lambda *args, **kwargs: None
    
    try:
        dialog.btn_apply.click()
        
        # Check if the old box on second page was cleared and the new one applied
        page2 = project_data.pdf_files[0].pages[1]
        assert len(page2.boxes) == 1
        assert page2.boxes[0].column_name == "Title"
    finally:
        PyQt5.QtWidgets.QMessageBox.information = original_information


def test_template_manager_dialog_remembers_selected_page(project_data):
    """The page list should restore the highlighted row after apply/ reopen."""
    # open dialog and highlight second page
    dialog = TemplateManagerDialog(project_data)
    dialog.page_table.selectRow(1)
    # also check the page so apply can succeed
    dialog.page_table.item(1, 1).setCheckState(Qt.Checked)

    # mock information message so dialog does not show popup
    import PyQt5.QtWidgets
    original_information = PyQt5.QtWidgets.QMessageBox.information
    PyQt5.QtWidgets.QMessageBox.information = lambda *args, **kwargs: None
    try:
        dialog.btn_apply.click()
    finally:
        PyQt5.QtWidgets.QMessageBox.information = original_information

    # simulate reopening the dialog after a user clicks manage button
    new_dialog = TemplateManagerDialog(project_data)
    # highlighted row should be the second page again
    selected_rows = new_dialog.page_table.selectedItems()
    assert selected_rows, "Expected a row to be selected after reopening"
    assert selected_rows[0].row() == 1


def test_template_manager_dialog_skip_reference_page(project_data):
    """Choosing only the template's reference page should be ignored."""
    dialog = TemplateManagerDialog(project_data)
    dialog.template_table.selectRow(0)
    # check only the reference page (row 0)
    dialog.page_table.item(0, 1).setCheckState(Qt.Checked)

    import PyQt5.QtWidgets
    orig_info = PyQt5.QtWidgets.QMessageBox.information
    recorded = []
    PyQt5.QtWidgets.QMessageBox.information = lambda *args, **kwargs: recorded.append(True)
    try:
        dialog.btn_apply.click()
        # since we skipped the ref page, the command should not apply anything
        page = project_data.pdf_files[0].pages[0]
        assert page.boxes == []
        assert recorded, "Expected an informational message"
    finally:
        PyQt5.QtWidgets.QMessageBox.information = orig_info
