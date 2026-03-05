"""Unit tests for BQ collection page integration features."""
import pytest
from backend.routers.bq import (
    _parse_collection_entries,
    _is_collection_page,
    _CARRY_FORWARD_RE,
    _BROUGHT_FORWARD_RE,
    _PAGE_REF_RE,
)


# ── Regex Pattern Tests ──────────────────────────────────────────────

class TestCarryForwardRegex:
    def test_carried_forward(self):
        assert _CARRY_FORWARD_RE.search("Carried Forward")

    def test_carry_forward(self):
        assert _CARRY_FORWARD_RE.search("Carry Forward")

    def test_cf_abbreviation(self):
        assert _CARRY_FORWARD_RE.search("C/F")

    def test_carried_to(self):
        assert _CARRY_FORWARD_RE.search("Carried to summary")

    def test_no_match(self):
        assert not _CARRY_FORWARD_RE.search("Page Total")


class TestBroughtForwardRegex:
    def test_brought_forward(self):
        assert _BROUGHT_FORWARD_RE.search("Brought Forward")

    def test_bf_abbreviation(self):
        assert _BROUGHT_FORWARD_RE.search("B/F")

    def test_from_previous(self):
        assert _BROUGHT_FORWARD_RE.search("From Previous Page")

    def test_no_match(self):
        assert not _BROUGHT_FORWARD_RE.search("Page Total")


class TestPageRefRegex:
    def test_modbq_format(self):
        m = _PAGE_REF_RE.search("Page No. MODBQ.15/1")
        assert m
        assert m.group(1) == "MODBQ.15/1"

    def test_bq_format(self):
        m = _PAGE_REF_RE.search("BQ.4/2")
        assert m
        assert m.group(1) == "BQ.4/2"

    def test_page_number(self):
        m = _PAGE_REF_RE.search("Page 5")
        assert m
        assert m.group(2) == "5"

    def test_page_no_format(self):
        m = _PAGE_REF_RE.search("Page No. 3")
        assert m
        assert m.group(2) == "3"

    def test_no_match(self):
        assert not _PAGE_REF_RE.search("Some random text")


# ── Helper: build desc_lines ─────────────────────────────────────────

def _make_desc_line(text, y_center=100, y_top=95, y_bottom=105,
                    x0=50, x1=400, fontname="Arial", size=12.0):
    return {
        'text': text,
        'y_center': y_center,
        'y_top': y_top,
        'y_bottom': y_bottom,
        'x0': x0,
        'x1': x1,
        'fontname': fontname,
        'size': size,
        'underline': False,
    }


def _make_total_line(text, y, x0=500, x1=600):
    return {'text': text, 'y': y, 'y_top': y - 5, 'y_bottom': y + 5,
            'x0': x0, 'x1': x1}


# ── _parse_collection_entries ─────────────────────────────────────────

class TestParseCollectionEntries:
    def test_basic_page_ref(self):
        desc_lines = [
            _make_desc_line("Page No. MODBQ.15/1 ......", y_center=100),
        ]
        total_lines = [
            _make_total_line("10,000.00", y=100),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 1
        assert entries[0]['entry_type'] == 'page_ref'
        assert entries[0]['page_ref'] == 'MODBQ.15/1'
        assert entries[0]['total'] == 10000.0

    def test_multiple_page_refs(self):
        desc_lines = [
            _make_desc_line("Page No. MODBQ.15/1 ......", y_center=100),
            _make_desc_line("Page No. MODBQ.15/2 ......", y_center=120),
            _make_desc_line("Page No. MODBQ.15/3 ......", y_center=140),
        ]
        total_lines = [
            _make_total_line("5,000.00", y=100),
            _make_total_line("3,000.00", y=120),
            _make_total_line("2,000.00", y=140),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 3
        assert all(e['entry_type'] == 'page_ref' for e in entries)
        assert entries[0]['page_ref'] == 'MODBQ.15/1'
        assert entries[1]['page_ref'] == 'MODBQ.15/2'
        assert entries[2]['page_ref'] == 'MODBQ.15/3'
        assert entries[0]['total'] == 5000.0
        assert entries[1]['total'] == 3000.0
        assert entries[2]['total'] == 2000.0

    def test_carry_forward_entry(self):
        desc_lines = [
            _make_desc_line("Carried Forward", y_center=400),
        ]
        total_lines = [
            _make_total_line("15,000.00", y=400),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 1
        assert entries[0]['entry_type'] == 'carry_forward'
        assert entries[0]['total'] == 15000.0

    def test_brought_forward_entry(self):
        desc_lines = [
            _make_desc_line("Brought Forward", y_center=50),
        ]
        total_lines = [
            _make_total_line("8,000.00", y=50),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 1
        assert entries[0]['entry_type'] == 'brought_forward'
        assert entries[0]['total'] == 8000.0

    def test_grand_total_entry(self):
        desc_lines = [
            _make_desc_line("Grand Total", y_center=500),
        ]
        total_lines = [
            _make_total_line("100,000.00", y=500),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 1
        assert entries[0]['entry_type'] == 'grand_total'
        assert entries[0]['total'] == 100000.0

    def test_no_total_column_fallback_to_inline(self):
        """When no total column data, extract number from description."""
        desc_lines = [
            _make_desc_line("Page No. MODBQ.15/1 ...... $5,000.00", y_center=100),
        ]
        entries = _parse_collection_entries(desc_lines, [])
        assert len(entries) == 1
        assert entries[0]['total'] == 5000.0

    def test_mixed_entries(self):
        """Collection page with BF, page refs, CF."""
        desc_lines = [
            _make_desc_line("Brought Forward", y_center=50),
            _make_desc_line("Page No. BQ.4/1 ......", y_center=100),
            _make_desc_line("Page No. BQ.4/2 ......", y_center=120),
            _make_desc_line("Carried Forward", y_center=400),
        ]
        total_lines = [
            _make_total_line("20,000.00", y=50),
            _make_total_line("5,000.00", y=100),
            _make_total_line("3,000.00", y=120),
            _make_total_line("28,000.00", y=400),
        ]
        entries = _parse_collection_entries(desc_lines, total_lines)
        assert len(entries) == 4
        assert entries[0]['entry_type'] == 'brought_forward'
        assert entries[1]['entry_type'] == 'page_ref'
        assert entries[2]['entry_type'] == 'page_ref'
        assert entries[3]['entry_type'] == 'carry_forward'

    def test_heading_lines_classified_as_other(self):
        desc_lines = [
            _make_desc_line("COLLECTION", y_center=30, fontname="Arial-Bold"),
        ]
        entries = _parse_collection_entries(desc_lines, [])
        assert len(entries) == 1
        assert entries[0]['entry_type'] == 'other'


# ── _is_collection_page detection ────────────────────────────────────

class TestIsCollectionPage:
    def test_collection_page_with_keywords(self):
        words = [
            {'text': 'Collection', 'top': 50, 'bottom': 60, 'x0': 100, 'x1': 200},
            {'text': 'Summary', 'top': 70, 'bottom': 80, 'x0': 100, 'x1': 200},
            {'text': 'Total', 'top': 400, 'bottom': 410, 'x0': 100, 'x1': 200},
            {'text': '10,000.00', 'top': 400, 'bottom': 410, 'x0': 300, 'x1': 400},
        ]
        is_coll, conf = _is_collection_page(words, 600, 800)
        assert is_coll
        assert conf > 0.6

    def test_item_page_not_collection(self):
        words = [
            {'text': 'Item', 'top': 50, 'bottom': 60, 'x0': 50, 'x1': 100},
            {'text': 'Description', 'top': 50, 'bottom': 60, 'x0': 100, 'x1': 250},
            {'text': 'Qty', 'top': 50, 'bottom': 60, 'x0': 250, 'x1': 300},
            {'text': 'Unit', 'top': 50, 'bottom': 60, 'x0': 300, 'x1': 350},
            {'text': 'Rate', 'top': 50, 'bottom': 60, 'x0': 350, 'x1': 400},
            {'text': 'Amount', 'top': 50, 'bottom': 60, 'x0': 400, 'x1': 500},
            {'text': 'Concrete', 'top': 100, 'bottom': 110, 'x0': 100, 'x1': 250},
            {'text': '10', 'top': 100, 'bottom': 110, 'x0': 250, 'x1': 300},
            {'text': 'm3', 'top': 100, 'bottom': 110, 'x0': 300, 'x1': 350},
        ]
        is_coll, conf = _is_collection_page(words, 600, 800)
        assert not is_coll

    def test_empty_words(self):
        is_coll, conf = _is_collection_page([], 600, 800)
        assert not is_coll
        assert conf == 0.0
