"""
PDF Text Extraction Tool - Main Entry Point

This application extracts text data from PDF files using a combination
of vector-based text extraction and OCR, with an interactive graphical
user interface built with PyQt5.

Usage:
    python main.py

Requirements:
    - Python 3.8+
    - PyQt5, PyMuPDF, openpyxl, Pillow, pytesseract
    
See requirements.txt for exact version requirements.
"""

import sys
import os

# Add the project root to the Python path
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Use offscreen Qt backend automatically in headless environments
if (
    "QT_QPA_PLATFORM" not in os.environ
    and not os.environ.get("DISPLAY")
    and not os.environ.get("WAYLAND_DISPLAY")
):
    os.environ["QT_QPA_PLATFORM"] = "offscreen"

from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont

from ui.main_window import MainWindow


def main():
    """Launch the PDF Text Extraction application."""
    # Enable High DPI scaling
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
    
    app = QApplication(sys.argv)
    app.setApplicationName("PDF Text Extraction Tool")
    app.setStyle("Fusion")
    
    # Set default font
    font = QFont("Segoe UI", 9)
    app.setFont(font)
    
    # Apply stylesheet for consistent look
    app.setStyleSheet("""
        QMainWindow {
            background-color: #FAFAFA;
        }
        QToolBar {
            background-color: #F5F5F5;
            border-bottom: 1px solid #DDD;
            spacing: 4px;
            padding: 4px;
        }
        QToolBar QToolButton {
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid transparent;
        }0
        QToolBar QToolButton:hover {
            background-color: #E0E0E0;
            border: 1px solid #CCC;
        }
        QToolBar QToolButton:pressed {
            background-color: #D0D0D0;
        }
        QStatusBar {
            background-color: #F5F5F5;
            border-top: 1px solid #DDD;
        }
        QTreeWidget {
            border: none;
            font-size: 9pt;
        }
        QTreeWidget::item {
            padding: 3px 0px;
        }
        QTreeWidget::item:selected {
            background-color: #D6EAF8;
            color: black;
        }
        QTableWidget {
            border: none;
            gridline-color: #E0E0E0;
            font-size: 9pt;
        }
        QTableWidget::item:selected {
            background-color: #D6EAF8;
            color: black;
        }
        QHeaderView::section {
            background-color: #F0F0F0;
            padding: 4px 8px;
            border: 1px solid #DDD;
            font-weight: bold;
        }
        QPushButton {
            padding: 4px 12px;
            border-radius: 3px;
            border: 1px solid #CCC;
            background-color: #F5F5F5;
        }
        QPushButton:hover {
            background-color: #E0E0E0;
        }
        QPushButton:pressed {
            background-color: #D0D0D0;
        }
        QSpinBox {
            padding: 2px 4px;
            border: 1px solid #CCC;
            border-radius: 3px;
        }
        QSplitter::handle {
            background-color: #DDD;
            width: 3px;
        }
        QSplitter::handle:hover {
            background-color: #4472C4;
        }
        QScrollBar:vertical {
            width: 10px;
        }
        QScrollBar:horizontal {
            height: 10px;
        }
    """)
    
    window = MainWindow()
    window.show()
    
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
