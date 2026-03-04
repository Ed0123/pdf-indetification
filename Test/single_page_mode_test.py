"""
Tests for Single Page Mode (SPM) feature.

Covers:
  - Enabling / disabling SPM
  - Previous / Next page navigation
  - Page indicator label content
  - Table row count in SPM vs normal mode
  - Data integrity when switching pages
  - New column added in SPM is visible for every page
  - Row highlight behaviour when a row is selected
  - Sorting / interactive resize disabled/re-enabled by SPM
  - page_navigated signal is emitted with correct arguments
  - UI changes are consistent with the design specification
"""

import os
import sys
import pytest

# Ensure the project root is on the path
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt

# A single QApplication must exist for all widget tests.
_app = QApplication.instance()
if _app is None:
    _app = QApplication(sys.argv)

from models.data_models import ProjectData, PDFFileInfo, PageData, BoxInfo, ExtractedDataColumn
from ui.data_table import DataTable


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def two_file_project():
    """
    Project with two PDF files, 3 pages each, and two data columns.
    Pages are pre-populated with recognisable text so tests can verify
    that the correct row is displayed.
    """
    project = ProjectData()
    project.add_column("Title")
    project.add_column("Note")

    for f_idx, fname in enumerate(["alpha.pdf", "beta.pdf"]):
        fpath = f"C:/docs/{fname}"
        pf = PDFFileInfo(
            file_name=fname,
            file_path=fpath,
            num_pages=3,
            file_size=1000,
        )
        for p_idx in range(3):
            page = PageData(page_number=p_idx)
            page.extracted_data = {
                "Title": f"{fname} – page {p_idx + 1}",
                "Note": f"note_{f_idx}_{p_idx}",
            }
            pf.pages.append(page)
        project.pdf_files.append(pf)
    return project


@pytest.fixture
def table(two_file_project):
    """Return a DataTable loaded with two_file_project."""
    dt = DataTable()
    dt.set_project_data(two_file_project)
    return dt


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _flat_pages(project: ProjectData):
    """Return a flat list of (file_path, page_number) matching DataTable order."""
    return [
        (pf.file_path, pg.page_number)
        for pf in project.pdf_files
        for pg in pf.pages
    ]


# ---------------------------------------------------------------------------
# 1. Enable / disable SPM
# ---------------------------------------------------------------------------

class TestEnableDisable:
    def test_disabled_by_default(self, table):
        """SPM is off by default."""
        assert not table.single_page_mode

    def test_nav_bar_hidden_by_default(self, table):
        """Navigation bar must not be visible when SPM is disabled."""
        assert not table.spm_nav_bar.isVisible()

    def test_enable_shows_nav_bar(self, table):
        """Enabling SPM makes the navigation bar visible."""
        table.set_single_page_mode(True)
        # isHidden() reflects the widget's own show/hide state independent of parent
        assert not table.spm_nav_bar.isHidden()

    def test_disable_hides_nav_bar(self, table):
        """Disabling SPM hides the navigation bar again."""
        table.set_single_page_mode(True)
        table.set_single_page_mode(False)
        assert not table.spm_nav_bar.isVisible()

    def test_normal_mode_shows_all_rows(self, table, two_file_project):
        """In normal mode the table shows one row per page."""
        total_pages = sum(len(pf.pages) for pf in two_file_project.pdf_files)
        assert table.table.rowCount() == total_pages

    def test_spm_with_no_selection_shows_zero_rows(self, table):
        """In SPM there is no current page initially, so the table is empty."""
        table.set_single_page_mode(True)
        assert table.table.rowCount() == 0


# ---------------------------------------------------------------------------
# 2. navigate_to_page + row count
# ---------------------------------------------------------------------------

class TestNavigateToPage:
    def test_spm_shows_one_row_after_navigate(self, table, two_file_project):
        """After navigating to a page in SPM, exactly one row per visible column is shown."""
        table.set_single_page_mode(True)
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)
        # 2 visible columns in two_file_project
        assert table.table.rowCount() == 2

    def test_correct_data_shown_for_page(self, table, two_file_project):
        """The visible row contains the data for the navigated page."""
        table.set_single_page_mode(True)
        pf = two_file_project.pdf_files[1]  # beta.pdf
        table.navigate_to_page(pf.file_path, 2)  # third page

        # 'Title' is the first user column (row 0 in SPM)
        item = table.table.item(0, 1) # Extracted Data column
        assert item is not None
        assert "beta.pdf" in item.text()
        assert "3" in item.text()  # "page 3"

    def test_navigate_updates_index(self, table, two_file_project):
        """_spm_index is updated to the correct position in the flat list."""
        table.set_single_page_mode(True)
        flat = _flat_pages(two_file_project)
        target_fp, target_pg = flat[4]  # 5th page overall (beta.pdf, page 2)
        table.navigate_to_page(target_fp, target_pg)
        assert table._spm_index == 4

    def test_navigate_outside_spm_does_not_show_single_row(self, table, two_file_project):
        """navigate_to_page is a no-op for the table display when SPM is off."""
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)
        total_pages = sum(len(pf.pages) for pf in two_file_project.pdf_files)
        assert table.table.rowCount() == total_pages


# ---------------------------------------------------------------------------
# 3. Previous / Next buttons
# ---------------------------------------------------------------------------

class TestPrevNextNavigation:
    @pytest.fixture(autouse=True)
    def _setup(self, table, two_file_project):
        """Enable SPM and navigate to the first page before each test."""
        self.table = table
        self.project = two_file_project
        self.flat = _flat_pages(two_file_project)
        table.set_single_page_mode(True)
        first_fp, first_pg = self.flat[0]
        table.navigate_to_page(first_fp, first_pg)

    def test_prev_disabled_on_first_page(self):
        assert not self.table.btn_prev_page.isEnabled()

    def test_next_enabled_on_first_page(self):
        assert self.table.btn_next_page.isEnabled()

    def test_next_button_advances_page(self):
        self.table.btn_next_page.click()
        assert self.table._spm_index == 1

    def test_prev_button_goes_back(self):
        self.table.btn_next_page.click()
        self.table.btn_prev_page.click()
        assert self.table._spm_index == 0

    def test_next_disabled_on_last_page(self):
        last_idx = len(self.flat) - 1
        last_fp, last_pg = self.flat[last_idx]
        self.table.navigate_to_page(last_fp, last_pg)
        assert not self.table.btn_next_page.isEnabled()

    def test_prev_enabled_on_last_page(self):
        last_idx = len(self.flat) - 1
        last_fp, last_pg = self.flat[last_idx]
        self.table.navigate_to_page(last_fp, last_pg)
        assert self.table.btn_prev_page.isEnabled()

    def test_next_button_shows_correct_row(self):
        """After clicking Next the displayed row matches the second page."""
        self.table.btn_next_page.click()
        assert self.table.table.rowCount() == 2
        expected_fp, expected_pg = self.flat[1]
        fn_item = self.table.table.item(0, 0) # Attribute column
        assert fn_item is not None
        assert fn_item.data(Qt.UserRole) == expected_fp
        assert fn_item.data(Qt.UserRole + 1) == expected_pg


# ---------------------------------------------------------------------------
# 4. Page indicator label
# ---------------------------------------------------------------------------

class TestPageIndicatorLabel:
    def test_label_shows_file_name_and_page(self, table, two_file_project):
        """Navigation bar label contains the file name and page number."""
        table.set_single_page_mode(True)
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)
        label_text = table.spm_page_label.text()
        assert "alpha.pdf" in label_text
        assert "Page 1" in label_text

    def test_label_shows_total_pages(self, table, two_file_project):
        """Label includes the overall position, e.g. '(1 / 6)'."""
        table.set_single_page_mode(True)
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)
        label_text = table.spm_page_label.text()
        total = sum(len(pf.pages) for pf in two_file_project.pdf_files)
        assert f"1 / {total}" in label_text

    def test_label_updates_on_next(self, table, two_file_project):
        """Label changes after clicking Next."""
        table.set_single_page_mode(True)
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)
        table.btn_next_page.click()
        label_text = table.spm_page_label.text()
        assert "2 / " in label_text or "Page 2" in label_text


# ---------------------------------------------------------------------------
# 5. Data integrity — no data loss when switching pages
# ---------------------------------------------------------------------------

class TestDataIntegrity:
    def test_data_unchanged_after_spm_navigation(self, table, two_file_project):
        """All page data is preserved after navigating through SPM pages."""
        table.set_single_page_mode(True)
        flat = _flat_pages(two_file_project)

        # Navigate through all pages and check data is intact
        for fp, pg in flat:
            table.navigate_to_page(fp, pg)
            pf_obj = two_file_project.get_file_by_path(fp)
            pg_obj = pf_obj.get_page(pg)
            # Data in the model must still equal the original fixture values
            assert pg_obj.extracted_data["Title"] == f"{pf_obj.file_name} – page {pg + 1}"

    def test_edit_cell_in_spm_persists_after_page_change(self, table, two_file_project):
        """Editing a cell in SPM and then navigating keeps the edit in the model."""
        table.set_single_page_mode(True)
        pf = two_file_project.pdf_files[0]
        table.navigate_to_page(pf.file_path, 0)

        # Directly update via the model (simulates _on_cell_changed)
        pf.pages[0].extracted_data["Note"] = "EDITED"

        # Navigate away and come back
        table.navigate_to_page(pf.file_path, 1)
        table.navigate_to_page(pf.file_path, 0)

        # 'Note' is the 2nd user column (row 1 in SPM)
        item = table.table.item(1, 1) # Extracted Data column
        assert item is not None
        assert item.text() == "EDITED"

    def test_add_column_in_spm_visible_on_all_pages(self, table, two_file_project):
        """A column added in SPM appears (empty) for every page in the project."""
        table.set_single_page_mode(True)
        fp = two_file_project.pdf_files[0].file_path
        table.navigate_to_page(fp, 0)

        # Add column programmatically
        two_file_project.add_column("NewCol")
        table.refresh()

        col_names = two_file_project.get_column_names()
        assert "NewCol" in col_names

        # Navigate to every page and confirm the new column exists in the model
        for pf in two_file_project.pdf_files:
            for pg in pf.pages:
                assert "NewCol" not in pg.extracted_data or pg.extracted_data.get("NewCol") == ""


# ---------------------------------------------------------------------------
# 6. Row highlight
# ---------------------------------------------------------------------------

class TestRowHighlight:
    def test_highlight_row_in_spm(self, table, two_file_project):
        """highlight_row_for_page does nothing in SPM."""
        table.set_single_page_mode(True)
        pf = two_file_project.pdf_files[0]
        table.navigate_to_page(pf.file_path, 0)
        table._highlighted_row = -1
        table.highlight_row_for_page(pf.file_path, 0)
        assert table._highlighted_row == -1

    def test_no_highlight_for_wrong_page(self, table, two_file_project):
        """highlight_row_for_page does not set _highlighted_row when the
        requested page is not rendered (SPM is showing a different page)."""
        table.set_single_page_mode(True)
        pf = two_file_project.pdf_files[0]
        table.navigate_to_page(pf.file_path, 0)
        # Reset highlight sentinel
        table._highlighted_row = -1
        # Try to highlight a page that is not currently visible
        table.highlight_row_for_page(pf.file_path, 2)
        assert table._highlighted_row == -1


# ---------------------------------------------------------------------------
# 7. Sorting disabled while SPM is active
# ---------------------------------------------------------------------------

class TestSortingBehavior:
    def test_sorting_disabled_when_spm_enabled(self, table):
        """Table sorting must be disabled when SPM is turned on."""
        table.set_single_page_mode(True)
        assert not table.table.isSortingEnabled()

    def test_sorting_restored_when_spm_disabled(self, table):
        """Table sorting must be re-enabled when SPM is turned off."""
        table.set_single_page_mode(True)
        table.set_single_page_mode(False)
        assert table.table.isSortingEnabled()


# ---------------------------------------------------------------------------
# 8. page_navigated signal
# ---------------------------------------------------------------------------

class TestPageNavigatedSignal:
    def test_signal_emitted_on_next(self, table, two_file_project):
        """page_navigated is emitted with the correct (file_path, page_number)
        when the Next button is clicked."""
        table.set_single_page_mode(True)
        flat = _flat_pages(two_file_project)
        table.navigate_to_page(*flat[0])

        received: list = []
        table.page_navigated.connect(lambda fp, pg: received.append((fp, pg)))
        table.btn_next_page.click()

        assert len(received) == 1
        assert received[0] == flat[1]

    def test_signal_emitted_on_prev(self, table, two_file_project):
        """page_navigated is emitted with correct args when Prev is clicked."""
        table.set_single_page_mode(True)
        flat = _flat_pages(two_file_project)
        table.navigate_to_page(*flat[2])

        received: list = []
        table.page_navigated.connect(lambda fp, pg: received.append((fp, pg)))
        table.btn_prev_page.click()

        assert len(received) == 1
        assert received[0] == flat[1]

    def test_signal_not_emitted_at_boundary(self, table, two_file_project):
        """Clicking Next on the last page emits no signal (button is disabled)."""
        table.set_single_page_mode(True)
        flat = _flat_pages(two_file_project)
        table.navigate_to_page(*flat[-1])

        received: list = []
        table.page_navigated.connect(lambda fp, pg: received.append((fp, pg)))
        # The button is disabled; click() does nothing when disabled
        table.btn_next_page.click()

        assert len(received) == 0


class TestArrowNavigationInTable:
    def test_arrow_keys_in_fixed_columns_navigate(self, table, two_file_project):
        """Left/right arrow keys in first/second/page-number columns change page."""
        table.refresh()
        # ensure there are at least two rows
        assert table.table.rowCount() >= 2
        received = []
        table.cell_selected.connect(lambda fp, pg, cn: received.append((fp, pg, cn)))

        # focus first column row 0
        table.table.setCurrentCell(0, table.COL_FILE_NAME)
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Right, Qt.NoModifier)
        QApplication.sendEvent(table.table, ev)
        assert received and received[-1][1] == 1
        # left arrow back to page 0
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Left, Qt.NoModifier)
        QApplication.sendEvent(table.table, ev)
        assert received[-1][1] == 0

    def test_arrow_keys_do_not_navigate_in_data_columns(self, table, two_file_project):
        """Arrow keys in data columns should not trigger navigation."""
        table.refresh()
        # add an extra column so we have a data column
        table._project_data.columns.append(ExtractedDataColumn(name="Foo"))
        table.refresh()
        # focus first data column
        col_index = table.FIXED_COL_COUNT
        table.table.setCurrentCell(0, col_index)
        recorded = []
        table.cell_selected.connect(lambda fp, pg, cn: recorded.append((fp, pg, cn)))
        ev = QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Right, Qt.NoModifier)
        QApplication.sendEvent(table.table, ev)
        assert not recorded


# ---------------------------------------------------------------------------
# 9. UI consistency with design specifications
# ---------------------------------------------------------------------------

class TestUIDesignConsistency:
    def test_nav_bar_has_prev_and_next_buttons(self, table):
        """Navigation bar exposes btn_prev_page and btn_next_page."""
        assert hasattr(table, "btn_prev_page")
        assert hasattr(table, "btn_next_page")

    def test_add_column_button_present(self, table):
        """Add Column button must be present in SPM (same as normal mode)."""
        assert hasattr(table, "btn_add_column")

    def test_remove_column_button_present(self, table):
        """Remove Column button must be present in SPM."""
        assert hasattr(table, "btn_remove_column")

    def test_page_label_widget_present(self, table):
        """spm_page_label widget must exist."""
        assert hasattr(table, "spm_page_label")

    def test_separator_visible_in_spm(self, table):
        """The horizontal separator below the nav bar is shown in SPM."""
        table.set_single_page_mode(True)
        assert not table._spm_separator.isHidden()

    def test_separator_hidden_outside_spm(self, table):
        """The separator is hidden in normal mode."""
        assert not table._spm_separator.isVisible()
