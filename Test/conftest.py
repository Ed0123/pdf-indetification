"""
Pytest configuration and shared fixtures for the PDF Text Extraction tests.
"""

import sys
import os
import json
import tempfile
import pytest

# Ensure DEV_MODE so backend uses in-memory fake Firestore
os.environ.setdefault("DEV_MODE", "1")

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


@pytest.fixture
def temp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_project_data():
    """Provide a sample ProjectData instance for testing."""
    from models.data_models import ProjectData, PDFFileInfo, PageData, BoxInfo, ExtractedDataColumn
    
    project = ProjectData()
    project.add_column("Title")
    project.add_column("Page")
    
    pdf_file = PDFFileInfo(
        file_name="test.pdf",
        file_path="C:/test/test.pdf",
        num_pages=3,
        file_size=12345,
    )
    
    for i in range(3):
        page = PageData(page_number=i)
        page.extracted_data = {"Title": f"Title Page {i+1}", "Page": str(i+1)}
        if i == 0:
            page.boxes.append(BoxInfo(
                column_name="Title",
                x=0.1, y=0.1, width=0.4, height=0.05,
                extracted_text=f"Title Page {i+1}",
            ))
        pdf_file.pages.append(page)
    
    project.pdf_files.append(pdf_file)
    return project


@pytest.fixture
def sample_json_path(temp_dir, sample_project_data):
    """Provide a path to a saved JSON project file."""
    path = os.path.join(temp_dir, "test_project.json")
    sample_project_data.save_to_json(path)
    return path
