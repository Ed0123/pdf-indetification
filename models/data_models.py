"""
Data models for the PDF Text Extraction application.

This module defines dataclass-based models for:
- BoxInfo: Represents a drawn box on a PDF page for text extraction.
- ExtractedDataColumn: Represents a user-defined data column.
- PageData: Represents a single PDF page with its extracted data and boxes.
- PDFFileInfo: Represents a PDF file with its pages.
- ProjectData: Represents the entire project state for save/load.
"""

import os
import json
import tempfile
from datetime import datetime, timezone
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# D2: Schema version — bump when the saved format changes in a breaking way
_SCHEMA_VERSION = 1


@dataclass
class BoxInfo:
    """
    Represents a drawn box on a PDF page for text extraction.
    
    The coordinates are stored as relative values (0.0 to 1.0) of the page
    dimensions, allowing boxes to be applied across pages of different sizes.
    
    Attributes:
        column_name: Name of the extracted data column this box is associated with.
        x: Relative x-coordinate of the top-left corner (0.0 to 1.0).
        y: Relative y-coordinate of the top-left corner (0.0 to 1.0).
        width: Relative width of the box (0.0 to 1.0).
        height: Relative height of the box (0.0 to 1.0).
        extracted_text: The text extracted from this box region.
    """
    column_name: str
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0
    extracted_text: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "column_name": self.column_name,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "extracted_text": self.extracted_text,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BoxInfo":
        """Create a BoxInfo instance from a dictionary."""
        return cls(
            column_name=data.get("column_name", ""),
            x=data.get("x", 0.0),
            y=data.get("y", 0.0),
            width=data.get("width", 0.0),
            height=data.get("height", 0.0),
            extracted_text=data.get("extracted_text", ""),
        )

    def get_absolute_rect(self, page_width: float, page_height: float) -> tuple:
        """
        Convert relative coordinates to absolute pixel coordinates.
        
        Args:
            page_width: The width of the page in pixels.
            page_height: The height of the page in pixels.
            
        Returns:
            Tuple of (x, y, x2, y2) in absolute coordinates.
        """
        abs_x = self.x * page_width
        abs_y = self.y * page_height
        abs_w = self.width * page_width
        abs_h = self.height * page_height
        return (abs_x, abs_y, abs_x + abs_w, abs_y + abs_h)

    @classmethod
    def from_absolute_rect(
        cls,
        column_name: str,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        page_width: float,
        page_height: float,
    ) -> "BoxInfo":
        """
        Create a BoxInfo from absolute pixel coordinates.
        
        Args:
            column_name: Name of the column this box is for.
            x1, y1: Top-left corner in absolute coords.
            x2, y2: Bottom-right corner in absolute coords.
            page_width: Page width in pixels.
            page_height: Page height in pixels.
            
        Returns:
            A BoxInfo with relative coordinates.
        """
        rel_x = min(x1, x2) / page_width
        rel_y = min(y1, y2) / page_height
        rel_w = abs(x2 - x1) / page_width
        rel_h = abs(y2 - y1) / page_height
        return cls(
            column_name=column_name,
            x=rel_x,
            y=rel_y,
            width=rel_w,
            height=rel_h,
        )


@dataclass
class ExtractedDataColumn:
    """
    Represents a user-defined data extraction column.
    
    Attributes:
        name: The name of the column (e.g., "Page", "Title", "Date").
        visible: Whether this column is visible in the table.
    """
    name: str
    visible: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "visible": self.visible,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExtractedDataColumn":
        """Create an ExtractedDataColumn from a dictionary."""
        return cls(
            name=data.get("name", ""),
            visible=data.get("visible", True),
        )


@dataclass
class PageData:
    """
    Represents a single PDF page with its extracted data and box annotations.
    
    Attributes:
        page_number: Zero-based page index in the PDF file.
        extracted_data: Dictionary mapping column names to extracted text values.
        boxes: List of BoxInfo objects representing drawn boxes on this page.
    """
    page_number: int = 0
    extracted_data: Dict[str, str] = field(default_factory=dict)
    boxes: List[BoxInfo] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "page_number": self.page_number,
            "extracted_data": dict(self.extracted_data),
            "boxes": [box.to_dict() for box in self.boxes],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PageData":
        """Create a PageData from a dictionary."""
        return cls(
            page_number=data.get("page_number", 0),
            extracted_data=data.get("extracted_data", {}),
            boxes=[BoxInfo.from_dict(b) for b in data.get("boxes", [])],
        )

    def get_box_for_column(self, column_name: str) -> Optional[BoxInfo]:
        """
        Get the box associated with a specific column.
        
        Args:
            column_name: The column name to search for.
            
        Returns:
            The BoxInfo if found, None otherwise.
        """
        for box in self.boxes:
            if box.column_name == column_name:
                return box
        return None

    def set_box_for_column(self, box: BoxInfo) -> None:
        """
        Set or replace the box for a specific column.
        
        Args:
            box: The BoxInfo to set. If a box with the same column_name
                 already exists, it will be replaced.
        """
        for i, existing_box in enumerate(self.boxes):
            if existing_box.column_name == box.column_name:
                self.boxes[i] = box
                return
        self.boxes.append(box)

    def remove_box_for_column(self, column_name: str) -> None:
        """Remove the box associated with a specific column."""
        self.boxes = [b for b in self.boxes if b.column_name != column_name]

    def clear_all_data(self) -> None:
        """Clear all extracted data and boxes for this page."""
        self.extracted_data.clear()
        self.boxes.clear()


@dataclass
class PDFFileInfo:
    """
    Represents a PDF file with its pages and metadata.
    
    Attributes:
        file_name: Name of the PDF file.
        file_path: Full path to the PDF file.
        num_pages: Total number of pages in the PDF.
        file_size: File size in bytes.
        pages: List of PageData for each page.
    """
    file_name: str = ""
    file_path: str = ""
    num_pages: int = 0
    file_size: int = 0
    pages: List[PageData] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "file_name": self.file_name,
            "file_path": self.file_path,
            "num_pages": self.num_pages,
            "file_size": self.file_size,
            "pages": [page.to_dict() for page in self.pages],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PDFFileInfo":
        """Create a PDFFileInfo from a dictionary."""
        return cls(
            file_name=data.get("file_name", ""),
            file_path=data.get("file_path", ""),
            num_pages=data.get("num_pages", 0),
            file_size=data.get("file_size", 0),
            pages=[PageData.from_dict(p) for p in data.get("pages", [])],
        )

    def get_page(self, page_number: int) -> Optional[PageData]:
        """
        Get PageData by page number.
        
        Args:
            page_number: The zero-based page number.
            
        Returns:
            The PageData if found, None otherwise.
        """
        for page in self.pages:
            if page.page_number == page_number:
                return page
        return None


@dataclass
class Template:
    """
    Represents a template of boxes that can be applied to pages.
    
    Attributes:
        name: Name of the template.
        ref_page: Reference page information (e.g., "File Name - Page 1").
        remark: Optional remark or description.
        boxes: List of BoxInfo objects defining the template.
    """
    name: str
    ref_page: str
    remark: str = ""
    boxes: List[BoxInfo] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "ref_page": self.ref_page,
            "remark": self.remark,
            "boxes": [box.to_dict() for box in self.boxes],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Template":
        """Create a Template from a dictionary."""
        return cls(
            name=data.get("name", ""),
            ref_page=data.get("ref_page", ""),
            remark=data.get("remark", ""),
            boxes=[BoxInfo.from_dict(b) for b in data.get("boxes", [])],
        )


@dataclass
class ProjectData:
    """
    Represents the entire project state for save/load.
    
    Attributes:
        pdf_files: List of PDFFileInfo objects.
        columns: List of ExtractedDataColumn objects.
        last_saved_time: ISO timestamp of last save.
        last_selected_file: Path of the last selected PDF file.
        last_selected_page: Page number of the last selected page.
    """
    pdf_files: List[PDFFileInfo] = field(default_factory=list)
    columns: List[ExtractedDataColumn] = field(default_factory=list)
    templates: List[Template] = field(default_factory=list)
    # name of the template most recently chosen in the main window combo box
    last_selected_template: str = ""
    last_saved_time: str = ""
    last_selected_file: str = ""
    last_selected_page: int = -1
    # remember which page (if any) was highlighted in the template manager dialog
    # stored as a tuple (file_path, page_number)
    last_template_manager_page: tuple = field(default_factory=lambda: ("", -1))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization.
        
        D2: Includes a ``version`` field so that future readers can detect
        format incompatibilities and migrate gracefully.
        """
        return {
            "version": _SCHEMA_VERSION,
            "pdf_files": [f.to_dict() for f in self.pdf_files],
            "columns": [c.to_dict() for c in self.columns],
            "templates": [t.to_dict() for t in self.templates],
            "last_selected_template": self.last_selected_template,
            "last_saved_time": self.last_saved_time,
            "last_selected_file": self.last_selected_file,
            "last_selected_page": self.last_selected_page,
            "last_template_manager_page": list(self.last_template_manager_page),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProjectData":
        """Create a ProjectData from a dictionary.
        
        D2: Checks the ``version`` field and raises ``ValueError`` if the saved
        file was written by a newer (incompatible) version of the application.
        Missing version is treated as version 1 for backward compatibility.
        """
        saved_version = data.get("version", 1)
        if saved_version > _SCHEMA_VERSION:
            raise ValueError(
                f"Project file was saved with a newer version of this application "
                f"(file version {saved_version}, current version {_SCHEMA_VERSION}). "
                "Please upgrade the application to open this file."
            )
        return cls(
            pdf_files=[PDFFileInfo.from_dict(f) for f in data.get("pdf_files", [])],
            columns=[
                ExtractedDataColumn.from_dict(c) for c in data.get("columns", [])
            ],
            templates=[Template.from_dict(t) for t in data.get("templates", [])],
            last_selected_template=data.get("last_selected_template", ""),
            last_saved_time=data.get("last_saved_time", ""),
            last_selected_file=data.get("last_selected_file", ""),
            last_selected_page=data.get("last_selected_page", -1),
            last_template_manager_page=tuple(data.get("last_template_manager_page", ["", -1])),
        )

    def save_to_json(self, file_path: str) -> None:
        """
        Save the project data to a JSON file.
        
        D1: Uses an atomic write pattern (write to a temp file in the same
        directory, then ``os.replace``) so that a crash mid-write never leaves
        a corrupted project file.  The original file is only replaced once the
        new content is fully flushed to disk.
        
        D5: Timestamp is stored as UTC ISO-8601 with a ``Z`` suffix for
        unambiguous time-zone representation.
        
        Args:
            file_path: Path where the JSON file will be saved.
        """
        # D5: UTC ISO-8601 timestamp
        self.last_saved_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # D1: Atomic write — write to a sibling temp file then replace
        target_dir = os.path.dirname(os.path.abspath(file_path))
        fd, tmp_path = tempfile.mkstemp(dir=target_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, file_path)
        except Exception:
            # Clean up the temp file if anything went wrong
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    @classmethod
    def load_from_json(cls, file_path: str) -> "ProjectData":
        """
        Load project data from a JSON file.
        
        Args:
            file_path: Path to the JSON file to load.
            
        Returns:
            A ProjectData instance with the loaded data.
            
        Raises:
            FileNotFoundError: If the file does not exist.
            json.JSONDecodeError: If the file contains invalid JSON.
            ValueError: If the file was saved by a newer incompatible version.
        """
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    def get_file_by_path(self, file_path: str) -> Optional[PDFFileInfo]:
        """
        Find a PDFFileInfo by its file path.
        
        Args:
            file_path: The file path to search for.
            
        Returns:
            The PDFFileInfo if found, None otherwise.
        """
        for pdf_file in self.pdf_files:
            if pdf_file.file_path == file_path:
                return pdf_file
        return None

    def get_column_names(self) -> List[str]:
        """Return a list of all column names."""
        return [col.name for col in self.columns]

    def add_column(self, name: str) -> ExtractedDataColumn:
        """
        Add a new extracted data column.
        
        Args:
            name: The name of the new column.
            
        Returns:
            The created ExtractedDataColumn.
            
        Raises:
            ValueError: If a column with this name already exists.
        """
        for col in self.columns:
            if col.name == name:
                raise ValueError(f"Column '{name}' already exists.")
        new_col = ExtractedDataColumn(name=name)
        self.columns.append(new_col)
        return new_col

    def remove_column(self, name: str) -> None:
        """
        Remove an extracted data column and all associated data/boxes.
        
        Args:
            name: The name of the column to remove.
        """
        self.columns = [c for c in self.columns if c.name != name]
        # Remove associated data and boxes from all pages
        for pdf_file in self.pdf_files:
            for page in pdf_file.pages:
                page.extracted_data.pop(name, None)
                page.remove_box_for_column(name)

    def remove_pdf_file(self, file_path: str) -> None:
        """
        Remove a PDF file and all its data.
        
        Args:
            file_path: Path of the file to remove.
        """
        self.pdf_files = [f for f in self.pdf_files if f.file_path != file_path]
