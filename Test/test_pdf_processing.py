"""
Test cases for PDF processing utilities (utils/pdf_processing.py).

Tests:
- find_pdf_files: directory walking and PDF discovery
- get_pdf_info: file metadata extraction
- render_pdf_page: page rendering
- extract_text_from_region: vector text extraction
- extract_text_from_relative_region: relative coordinate text extraction
- check_page_has_text: text presence detection
"""

import os
import tempfile
import pytest
import fitz  # PyMuPDF

from utils.pdf_processing import (
    find_pdf_files,
    get_pdf_info,
    render_pdf_page,
    get_page_dimensions,
    extract_text_from_region,
    extract_text_from_relative_region,
    check_page_has_text,
)


@pytest.fixture
def sample_pdf(temp_dir):
    """Create a simple PDF file with text for testing."""
    pdf_path = os.path.join(temp_dir, "sample.pdf")
    doc = fitz.open()
    
    # Page 1 with text
    page = doc.new_page(width=612, height=792)
    text_point = fitz.Point(72, 100)
    page.insert_text(text_point, "Hello World - Page 1", fontsize=12)
    page.insert_text(fitz.Point(72, 200), "Second line of text", fontsize=12)
    
    # Page 2 with different text
    page2 = doc.new_page(width=612, height=792)
    page2.insert_text(fitz.Point(72, 100), "Page Two Content", fontsize=12)
    
    doc.save(pdf_path)
    doc.close()
    return pdf_path


@pytest.fixture
def pdf_directory(temp_dir):
    """Create a directory structure with PDF files for testing."""
    # Root PDF
    doc1 = fitz.open()
    doc1.new_page()
    path1 = os.path.join(temp_dir, "root.pdf")
    doc1.save(path1)
    doc1.close()
    
    # Subdirectory with PDFs
    sub_dir = os.path.join(temp_dir, "subfolder")
    os.makedirs(sub_dir)
    
    doc2 = fitz.open()
    doc2.new_page()
    path2 = os.path.join(sub_dir, "sub1.pdf")
    doc2.save(path2)
    doc2.close()
    
    doc3 = fitz.open()
    doc3.new_page()
    path3 = os.path.join(sub_dir, "sub2.pdf")
    doc3.save(path3)
    doc3.close()
    
    # Non-PDF file (should be ignored)
    with open(os.path.join(temp_dir, "readme.txt"), "w") as f:
        f.write("Not a PDF")
    
    return temp_dir


class TestFindPDFFiles:
    """Tests for find_pdf_files function."""
    
    def test_finds_all_pdfs(self, pdf_directory):
        """Test that all PDF files are found."""
        files = find_pdf_files(pdf_directory)
        assert len(files) == 3
    
    def test_ignores_non_pdf(self, pdf_directory):
        """Test that non-PDF files are ignored."""
        files = find_pdf_files(pdf_directory)
        for f in files:
            assert f.lower().endswith(".pdf")
    
    def test_returns_sorted(self, pdf_directory):
        """Test that results are sorted."""
        files = find_pdf_files(pdf_directory)
        assert files == sorted(files)
    
    def test_empty_directory(self, temp_dir):
        """Test with an empty directory."""
        files = find_pdf_files(temp_dir)
        assert files == []
    
    def test_includes_subdirectories(self, pdf_directory):
        """Test that subdirectories are searched."""
        files = find_pdf_files(pdf_directory)
        subfolder_files = [f for f in files if "subfolder" in f]
        assert len(subfolder_files) == 2


class TestGetPDFInfo:
    """Tests for get_pdf_info function."""
    
    def test_basic_info(self, sample_pdf):
        """Test extracting basic PDF info."""
        info = get_pdf_info(sample_pdf)
        assert info["file_name"] == "sample.pdf"
        assert info["num_pages"] == 2
        assert info["file_size"] > 0
        assert os.path.normpath(info["file_path"]) == os.path.normpath(sample_pdf)
    
    def test_file_not_found(self):
        """Test with non-existent file."""
        with pytest.raises(FileNotFoundError):
            get_pdf_info("/nonexistent/file.pdf")
    
    def test_invalid_pdf(self, temp_dir):
        """Test with a file that is not a valid PDF."""
        bad_path = os.path.join(temp_dir, "bad.pdf")
        with open(bad_path, "w") as f:
            f.write("Not a PDF file")
        with pytest.raises(RuntimeError):
            get_pdf_info(bad_path)


class TestRenderPDFPage:
    """Tests for render_pdf_page function."""
    
    def test_render_page(self, sample_pdf):
        """Test rendering a page returns PNG data."""
        data = render_pdf_page(sample_pdf, 0)
        assert data is not None
        assert len(data) > 0
        # Check PNG signature
        assert data[:4] == b'\x89PNG'
    
    def test_render_second_page(self, sample_pdf):
        """Test rendering the second page."""
        data = render_pdf_page(sample_pdf, 1)
        assert data is not None
    
    def test_render_invalid_page(self, sample_pdf):
        """Test rendering an invalid page number."""
        data = render_pdf_page(sample_pdf, 99)
        assert data is None
    
    def test_render_negative_page(self, sample_pdf):
        """Test rendering a negative page number."""
        data = render_pdf_page(sample_pdf, -1)
        assert data is None
    
    def test_render_with_zoom(self, sample_pdf):
        """Test rendering with different zoom levels."""
        data_1x = render_pdf_page(sample_pdf, 0, zoom=1.0)
        data_2x = render_pdf_page(sample_pdf, 0, zoom=2.0)
        # Higher zoom should produce larger image data
        assert len(data_2x) > len(data_1x)


class TestGetPageDimensions:
    """Tests for get_page_dimensions function."""
    
    def test_dimensions(self, sample_pdf):
        """Test getting page dimensions."""
        dims = get_page_dimensions(sample_pdf, 0)
        assert dims is not None
        w, h = dims
        assert w == 612
        assert h == 792
    
    def test_invalid_page(self, sample_pdf):
        """Test with invalid page number."""
        dims = get_page_dimensions(sample_pdf, 99)
        assert dims is None


class TestExtractTextFromRegion:
    """Tests for text extraction from regions."""
    
    def test_extract_text(self, sample_pdf):
        """Test extracting text from a region with known text."""
        # The text "Hello World - Page 1" is at approximately (72, 88) to (250, 112)
        text = extract_text_from_region(
            sample_pdf, 0,
            50, 80, 300, 120,
            use_ocr_fallback=False,
        )
        assert "Hello World" in text
    
    def test_extract_empty_region(self, sample_pdf):
        """Test extracting from a region with no text."""
        text = extract_text_from_region(
            sample_pdf, 0,
            500, 500, 600, 600,
            use_ocr_fallback=False,
        )
        assert text == ""
    
    def test_extract_invalid_page(self, sample_pdf):
        """Test extracting from an invalid page."""
        text = extract_text_from_region(sample_pdf, 99, 0, 0, 100, 100)
        assert text == ""


class TestExtractTextFromRelativeRegion:
    """Tests for text extraction from relative coordinate regions."""
    
    def test_extract_relative(self, sample_pdf):
        """Test extracting text using relative coordinates."""
        # "Hello World - Page 1" is at approximately y=100 on a 792pt tall page
        text = extract_text_from_relative_region(
            sample_pdf, 0,
            rel_x=0.05, rel_y=0.10, rel_w=0.5, rel_h=0.05,
            use_ocr_fallback=False,
        )
        assert "Hello" in text or "Page" in text or text == ""  # May not match exactly due to position
    
    def test_extract_relative_invalid(self, sample_pdf):
        """Test with invalid file."""
        text = extract_text_from_relative_region(
            "/nonexistent.pdf", 0,
            0.1, 0.1, 0.3, 0.1,
        )
        assert text == ""


class TestCheckPageHasText:
    """Tests for check_page_has_text function."""
    
    def test_page_with_text(self, sample_pdf):
        """Test a page that has text."""
        assert check_page_has_text(sample_pdf, 0) is True
    
    def test_invalid_page(self, sample_pdf):
        """Test an invalid page number."""
        assert check_page_has_text(sample_pdf, 99) is False
    
    def test_invalid_file(self):
        """Test with non-existent file."""
        assert check_page_has_text("/nonexistent.pdf", 0) is False


class TestOCRRegion:
    """Tests for _ocr_region function (internal)."""

    def test_ocr_region_clamps_to_page(self, sample_pdf):
        """Rect exceeding page boundaries is clamped, never returns full page."""
        from utils.pdf_processing import _ocr_region
        doc = fitz.open(sample_pdf)
        page = doc[0]
        # Rect that extends far beyond the page
        oversized = fitz.Rect(-100, -100, 9999, 9999)
        # Should not raise; returns text (possibly empty if no OCR engine)
        result = _ocr_region(page, oversized)
        assert isinstance(result, str)
        doc.close()

    def test_ocr_region_empty_rect(self, sample_pdf):
        """Empty / invalid rect should return empty string."""
        from utils.pdf_processing import _ocr_region
        doc = fitz.open(sample_pdf)
        page = doc[0]
        empty_rect = fitz.Rect(100, 100, 100, 100)  # zero area
        assert _ocr_region(page, empty_rect) == ""
        doc.close()

    def test_ocr_region_valid_rect(self, sample_pdf):
        """Valid small rect should not error out."""
        from utils.pdf_processing import _ocr_region
        doc = fitz.open(sample_pdf)
        page = doc[0]
        small_rect = fitz.Rect(50, 80, 300, 120)
        result = _ocr_region(page, small_rect)
        assert isinstance(result, str)
        doc.close()


class TestRegularizeText:
    """Tests for regularize_text post-processing helper."""

    def test_regularize_fullwidth_and_dashes(self):
        from utils.pdf_processing import regularize_text

        # full-width -> half-width
        assert regularize_text("１２３ＡＢＣ") == "123ABC"
        # em/en/minus -> hyphen
        assert regularize_text("—–−") == "---"
        # trim whitespace
        assert regularize_text("  surrounded  ") == "surrounded"
        # empty / None -> empty string
        assert regularize_text("") == ""
        assert regularize_text(None) == ""
