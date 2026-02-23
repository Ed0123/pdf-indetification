"""
PDF Processing module for text extraction.

This module handles all PDF-related operations including:
- Opening and reading PDF files
- Rendering PDF pages to images
- Extracting text from specific regions using vector text or OCR
- Walking directories to find PDF files

Uses PyMuPDF (fitz) for PDF operations and falls back to OCR
via pytesseract when vector text is not available.
"""

import os
import fitz  # PyMuPDF
from typing import List, Optional, Tuple
from PIL import Image
import io
import unicodedata

def regularize_text(text: str) -> str:
    """
    Regularize extracted text by normalizing characters.
    
    Operations:
    - Normalizes full-width characters to half-width (NFKC normalization).
    - Replaces em-dashes and other dash-likes with standard hyphen.
    - Strips leading/trailing whitespace.
    """
    if not text:
        return ""
    
    # Normalize unicode characters (handles full-width to half-width conversion)
    text = unicodedata.normalize('NFKC', text)
    
    # Specific replacements for common OCR/normalization issues.
    # TODO: Review carefully before modifying, as these mappings affect downstream text processing.
    replacements = {
        "—": "-",  # Em dash to hyphen
        "–": "-",  # En dash to hyphen
        "−": "-",  # Minus sign to hyphen
        "O0": "0",  # Common OCR misread of 'O' as '0'
        "OO": "0",  # Common OCR misread of 'OO' as '0'
        "0O": "0",  # Common OCR misread of '0O' as '0'
        "/": "_",  # Slash to underscore (optional, depending on use case)
    }
    
    for old, new in replacements.items():
        text = text.replace(old, new)
        
    return text.strip()


def find_pdf_files(directory: str) -> List[str]:
    """
    Walk through a directory and all subdirectories to find PDF files.
    
    Args:
        directory: The root directory to search in.
        
    Returns:
        A sorted list of absolute paths to PDF files found.
        
    Example:
        >>> files = find_pdf_files("C:/Documents/PDFs")
        >>> for f in files:
        ...     print(f)
    """
    pdf_files = []
    for root, dirs, files in os.walk(directory):
        for file_name in files:
            if file_name.lower().endswith(".pdf"):
                full_path = os.path.join(root, file_name)
                pdf_files.append(os.path.normpath(full_path))
    return sorted(pdf_files)


def get_pdf_info(file_path: str) -> dict:
    """
    Get basic information about a PDF file.
    
    Args:
        file_path: Path to the PDF file.
        
    Returns:
        Dictionary with keys: file_name, file_path, num_pages, file_size.
        
    Raises:
        FileNotFoundError: If the file does not exist.
        RuntimeError: If the file cannot be opened as a PDF.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"PDF file not found: {file_path}")
    
    file_size = os.path.getsize(file_path)
    file_name = os.path.basename(file_path)
    
    try:
        doc = fitz.open(file_path)
        num_pages = len(doc)
        doc.close()
    except Exception as e:
        raise RuntimeError(f"Cannot open PDF file '{file_path}': {e}")
    
    return {
        "file_name": file_name,
        "file_path": os.path.normpath(file_path),
        "num_pages": num_pages,
        "file_size": file_size,
    }


def render_pdf_page(
    file_path: str,
    page_number: int,
    zoom: float = 1.0,
) -> Optional[bytes]:
    """
    Render a PDF page to a PNG image bytes.
    
    Args:
        file_path: Path to the PDF file.
        page_number: Zero-based page index.
        zoom: Zoom factor (1.0 = 100%, 2.0 = 200%).
        
    Returns:
        PNG image data as bytes, or None if rendering fails.
    """
    try:
        doc = fitz.open(file_path)
        if page_number < 0 or page_number >= len(doc):
            doc.close()
            return None
        page = doc[page_number]
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img_data = pix.tobytes("png")
        doc.close()
        return img_data
    except Exception:
        return None


def get_page_dimensions(file_path: str, page_number: int) -> Optional[Tuple[float, float]]:
    """
    Get the dimensions of a PDF page.
    
    Args:
        file_path: Path to the PDF file.
        page_number: Zero-based page index.
        
    Returns:
        Tuple of (width, height) in points, or None if it fails.
    """
    try:
        doc = fitz.open(file_path)
        if page_number < 0 or page_number >= len(doc):
            doc.close()
            return None
        page = doc[page_number]
        rect = page.rect
        w, h = rect.width, rect.height
        doc.close()
        return (w, h)
    except Exception:
        return None


def extract_text_from_region(
    file_path: str,
    page_number: int,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    use_ocr_fallback: bool = True,
) -> str:
    """
    Extract text from a specific region of a PDF page.
    
    First attempts to extract vector-based text using PyMuPDF's built-in
    text extraction. If no text is found and use_ocr_fallback is True,
    falls back to OCR using pytesseract.
    
    Args:
        file_path: Path to the PDF file.
        page_number: Zero-based page index. 
        x1, y1: Top-left corner of the region in points.
        x2, y2: Bottom-right corner of the region in points.
        use_ocr_fallback: Whether to use OCR if vector text extraction fails.
        
    Returns:
        Extracted text string, or empty string if extraction fails.
    """
    try:
        doc = fitz.open(file_path)
        if page_number < 0 or page_number >= len(doc):
            doc.close()
            return ""
        
        page = doc[page_number]
        rect = fitz.Rect(x1, y1, x2, y2)
        
        # Try vector text extraction first
        text = page.get_text("text", clip=rect).strip()
        
        if text:
            doc.close()
            return regularize_text(text)
        
        # Fall back to OCR if no vector text found
        if use_ocr_fallback:
            text = _ocr_region(page, rect)
            doc.close()
            return regularize_text(text)
        
        doc.close()
        return ""
    except Exception:
        return ""


def extract_text_from_relative_region(
    file_path: str,
    page_number: int,
    rel_x: float,
    rel_y: float,
    rel_w: float,
    rel_h: float,
    use_ocr_fallback: bool = True,
) -> str:
    """
    Extract text from a region specified by relative coordinates.
    
    Args:
        file_path: Path to the PDF file. 
        page_number: Zero-based page index.
        rel_x: Relative x of top-left (0.0 to 1.0).
        rel_y: Relative y of top-left (0.0 to 1.0).
        rel_w: Relative width (0.0 to 1.0).
        rel_h: Relative height (0.0 to 1.0).
        use_ocr_fallback: Whether to use OCR if vector text fails.
        
    Returns:
        Extracted text string.
    """
    dims = get_page_dimensions(file_path, page_number)
    if dims is None:
        return ""
    
    page_w, page_h = dims
    x1 = rel_x * page_w
    y1 = rel_y * page_h
    x2 = (rel_x + rel_w) * page_w
    y2 = (rel_y + rel_h) * page_h
    
    return extract_text_from_region(
        file_path, page_number, x1, y1, x2, y2, use_ocr_fallback
    )


def _ocr_region(page, rect: fitz.Rect) -> str:
    """
    Perform OCR on a specific region of a PDF page.
    
    Renders the region at high resolution and uses pytesseract for OCR.
    
    Args:
        page: A fitz.Page object.
        rect: The region to OCR.
        
    Returns:
        OCR extracted text, or empty string on failure.
    """
    try:
        import pytesseract  # type: ignore
        
        # Render the region at high resolution for better OCR
        zoom = 3.0  # 300 DPI equivalent
        mat = fitz.Matrix(zoom, zoom)
        clip = rect
        pix = page.get_pixmap(matrix=mat, clip=clip)
        
        img_data = pix.tobytes("png")
        image = Image.open(io.BytesIO(img_data))
        
        text = pytesseract.image_to_string(image).strip()
        return text
    except Exception:
        # pytesseract missing or error (e.g. Tesseract executable not found)
        # Fall back to PyMuPDF's built-in OCR if available
        try:
            # PyMuPDF >= 1.19.0 supports built-in OCR via Tesseract
            if hasattr(page, "get_textpage_ocr"):
                tp = page.get_textpage_ocr(flags=0, full=False)
                text = page.get_text("text", clip=rect, textpage=tp).strip()
                return text
        except Exception:
            pass
        return ""


def check_page_has_text(file_path: str, page_number: int) -> bool:
    """
    Check if a PDF page contains any vector-based (extractable) text.
    
    Args:
        file_path: Path to the PDF file.
        page_number: Zero-based page index.
        
    Returns:
        True if the page has extractable text, False otherwise.
    """
    try:
        doc = fitz.open(file_path)
        if page_number < 0 or page_number >= len(doc):
            doc.close()
            return False
        page = doc[page_number]
        text = page.get_text("text").strip()
        doc.close()
        return len(text) > 0
    except Exception:
        return False


def is_ocr_available() -> bool:
    """Return True if an OCR engine is available for fallback.

    The function checks for an installed `pytesseract` package and accessible binary. 
    If that's not present it will fall back to checking whether the installed
    PyMuPDF exposes the `get_textpage_ocr` API (PyMuPDF >= 1.19.0) and verify it works.

    Returns:
        True if OCR is usable, False otherwise.
    """
    try:
        import pytesseract  # type: ignore
        # Just importing isn't enough; check if the executable is found
        try:
            pytesseract.get_tesseract_version()
            return True
        except Exception:
            pass  # Fall through to check PyMuPDF
    except ImportError:
        pass

    # If pytesseract isn't available/working, check for PyMuPDF's OCR API
    try:
        # Check if API exists
        if not hasattr(fitz.Page, "get_textpage_ocr"):
            return False
            
        # Try a minimal OCR operation to verify Tesseract is actually present/linked
        doc = fitz.open()
        page = doc.new_page()
        try:
            # Attempt a tiny OCR operation
            page.get_textpage_ocr(flags=0, full=False)
            return True
        except Exception:
            return False
        finally:
            doc.close()
    except Exception:
        return False
