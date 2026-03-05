"""Unit tests for BQ text-block splitting helpers."""
import pytest
from backend.routers.bq import (
    _normalize_fontname,
    _should_split_block,
    _detect_underlines,
    _is_word_underlined,
    _has_subitem_prefix,
    _is_bold_font,
    _classify_line_type,
)


# ── _normalize_fontname ────────────────────────────────────────────────

class TestNormalizeFontname:
    def test_strips_subset_prefix(self):
        assert _normalize_fontname("BCDEEE+Arial-Bold") == "Arial-Bold"

    def test_keeps_name_without_prefix(self):
        assert _normalize_fontname("Arial-Bold") == "Arial-Bold"

    def test_none_passthrough(self):
        assert _normalize_fontname(None) is None

    def test_empty_string(self):
        assert _normalize_fontname("") == ""

    def test_short_name(self):
        assert _normalize_fontname("AB+X") == "AB+X"

    def test_non_alpha_prefix(self):
        # '12AB34+Font' should NOT be stripped (prefix not purely alpha)
        assert _normalize_fontname("12AB34+Font") == "12AB34+Font"


# ── _should_split_block ───────────────────────────────────────────────

def _make_line(*, x0=100, x1=300, y_top=0, y_bottom=10,
               fontname="Arial", size=12.0, underline=False,
               text="Some text"):
    return {
        'x0': x0, 'x1': x1,
        'y_top': y_top, 'y_bottom': y_bottom,
        'y_center': (y_top + y_bottom) / 2,
        'fontname': fontname, 'size': size,
        'underline': underline,
        'text': text,
    }


class TestShouldSplitBlock:
    para = 20  # default paragraph threshold

    # ── style splits ──────────────────────────────────────────────────

    def test_same_style_no_split(self):
        a = _make_line(fontname="Arial", size=12, y_bottom=10)
        b = _make_line(fontname="Arial", size=12, y_top=12)
        split, reason = _should_split_block(a, b, self.para)
        assert not split
        assert reason == ''

    def test_different_fontname_splits(self):
        a = _make_line(fontname="Arial", size=12, y_bottom=10)
        b = _make_line(fontname="Arial-Bold", size=12, y_top=12)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'style'

    def test_same_font_after_prefix_strip_no_split(self):
        """Two subset-prefixed names with same base font should NOT split."""
        a = _make_line(fontname="ABCDEF+Arial", size=12, y_bottom=10)
        b = _make_line(fontname="GHIJKL+Arial", size=12, y_top=12)
        split, reason = _should_split_block(a, b, self.para)
        assert not split

    def test_size_difference_splits(self):
        a = _make_line(size=12.0, y_bottom=10)
        b = _make_line(size=14.0, y_top=12)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'style'

    def test_small_size_diff_no_split(self):
        a = _make_line(size=12.0, y_bottom=10)
        b = _make_line(size=12.3, y_top=12)
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    def test_none_fontnames_no_split(self):
        """When both fonts are None, skip style comparison."""
        a = _make_line(fontname=None, size=12, y_bottom=10)
        b = _make_line(fontname=None, size=12, y_top=12)
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    def test_one_none_fontname_no_split(self):
        """If one font is None we can't compare meaningfully; don't split."""
        a = _make_line(fontname="Arial", size=12, y_bottom=10)
        b = _make_line(fontname=None, size=12, y_top=12)
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    # ── indent splits ─────────────────────────────────────────────────

    def test_large_x_shift_splits(self):
        # shift greatly exceeds 1.5×previous line height (height 10 ⇒ threshold 15)
        a = _make_line(x0=100, x1=300, y_bottom=10)
        b = _make_line(x0=200, x1=400, y_top=12)  # 100px shift
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'indent'

    def test_small_x_shift_no_split(self):
        # shift smaller than height-based threshold
        a = _make_line(x0=100, x1=300, y_bottom=10)
        b = _make_line(x0=105, x1=305, y_top=12)  # 5px shift
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    def test_height_based_indent_threshold(self):
        # just above the height-derived threshold should split
        # give both lines a positive height (y_bottom > y_top)
        a = _make_line(x0=100, x1=300, y_top=0, y_bottom=10)
        b = _make_line(x0=116, x1=316, y_top=12, y_bottom=22)  # 16px shift > 15
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'indent'

    def test_height_based_indent_no_split(self):
        a = _make_line(x0=100, x1=300, y_top=0, y_bottom=10)
        # 8px shift < 1.0 * height (10) → no sub_indent, < 1.5 * height → no indent
        b = _make_line(x0=108, x1=308, y_top=12, y_bottom=22)
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    # ── gap splits ────────────────────────────────────────────────────

    def test_large_gap_splits(self):
        # this is a very large gap; regardless of height logic it should split
        a = _make_line(y_bottom=10)
        b = _make_line(y_top=50)  # gap=40
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'gap'

    def test_small_gap_no_split(self):
        # gap equal to typical threshold (avg height 10 ⇒ threshold 5)
        a = _make_line(y_bottom=10)
        b = _make_line(y_top=15)  # gap=5
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    def test_gap_just_above_height_threshold_splits(self):
        # gap slightly above half the average line height should trigger
        a = _make_line(y_top=0, y_bottom=10)
        b = _make_line(y_top=16, y_bottom=26)  # gap=6, threshold=5
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'gap'

    def test_gap_equal_to_threshold_no_split(self):
        a = _make_line(y_top=0, y_bottom=10)
        b = _make_line(y_top=15, y_bottom=25)  # gap=5 == threshold
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    # ── priority: style beats indent beats gap ────────────────────────

    def test_style_has_priority_over_indent(self):
        a = _make_line(x0=100, fontname="Arial", y_bottom=10)
        b = _make_line(x0=200, fontname="Arial-Bold", y_top=12)
        _, reason = _should_split_block(a, b, self.para)
        assert reason == 'style'

    def test_indent_has_priority_over_gap(self):
        a = _make_line(x0=100, x1=300, y_bottom=10)
        b = _make_line(x0=200, x1=400, y_top=50)
        _, reason = _should_split_block(a, b, self.para)
        assert reason == 'indent'

    # ── underline splits ──────────────────────────────────────────────

    def test_underline_mismatch_splits(self):
        a = _make_line(underline=True, y_bottom=10)
        b = _make_line(underline=False, y_top=12)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'style'

    def test_underline_match_no_split(self):
        a = _make_line(underline=True, y_bottom=10)
        b = _make_line(underline=True, y_top=12)
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    def test_both_not_underlined_no_split(self):
        a = _make_line(underline=False, y_bottom=10)
        b = _make_line(underline=False, y_top=12)
        split, _ = _should_split_block(a, b, self.para)
        assert not split


# ── _is_word_underlined ───────────────────────────────────────────────

class TestIsWordUnderlined:
    def test_word_with_underline_below(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        underlines = [{'x0': 100, 'x1': 200, 'y': 51}]
        assert _is_word_underlined(word, underlines)


# ---------------------------------------------------------------------------
# _extract_text_from_box page OCR trimming tests
# ---------------------------------------------------------------------------

class DummyRect:
    x0 = 0
    y0 = 0
    width = 100
    height = 100

class DummyPage:
    def __init__(self, text: str):
        self.rect = DummyRect()
        self._text = text

    def get_text(self, kind, clip=None, textpage=None):
        # ignore all args, return the stored text (possibly padded)
        return self._text

    def get_textpage_ocr(self, flags=0, full=False):
        # simply return a dummy object, our get_text ignores it
        return object()

class DummyDoc:
    def __init__(self, page):
        self.pages = [page]

    def __getitem__(self, index):
        return self.pages[index]

    def __len__(self):
        return len(self.pages)

    def close(self):
        pass


def test_extract_text_from_box_page_ocr_strips(monkeypatch):
    """When using the ``page_ocr`` engine, whitespace around OCR output is
    trimmed before returning."""
    from backend.routers.bq import _extract_text_from_box, BoxDefinition
    import fitz as fitz_module

    # patch global fitz.open so that any future imports use the dummy
    dummy_page = DummyPage("   padded result   ")
    monkeypatch.setattr(fitz_module, "open", lambda path: DummyDoc(dummy_page))

    box = BoxDefinition(column_name="X", x=0, y=0, width=1, height=1)
    text = _extract_text_from_box("dummy.pdf", 0, box, engine="page_ocr")
    assert text == "padded result"


def test_list_bq_engines_includes_page_ocr(monkeypatch):
    """The engine list should advertise the page_ocr option when OCR works."""
    from backend.routers.bq import list_bq_engines
    # ensure OCR availability check returns True by patching the util module
    import utils.pdf_processing as pdfproc
    monkeypatch.setattr(pdfproc, "is_ocr_available", lambda: True)
    import asyncio
    engines = asyncio.get_event_loop().run_until_complete(list_bq_engines())
    ids = [e.id for e in engines]
    assert "page_ocr" in ids
    # ensure corresponding entry reports available
    entry = next(e for e in engines if e.id == "page_ocr")
    assert entry.available is True

    def test_word_without_underline(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        underlines = [{'x0': 400, 'x1': 500, 'y': 51}]  # far away
        assert not _is_word_underlined(word, underlines)

    def test_underline_too_far_below(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        underlines = [{'x0': 100, 'x1': 200, 'y': 60}]  # 10pt below
        assert not _is_word_underlined(word, underlines)

    def test_partial_overlap_sufficient(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        # Underline covers 60% of word width
        underlines = [{'x0': 100, 'x1': 160, 'y': 51}]
        assert _is_word_underlined(word, underlines)

    def test_partial_overlap_insufficient(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        # Underline covers only 40% of word width
        underlines = [{'x0': 100, 'x1': 140, 'y': 51}]
        assert not _is_word_underlined(word, underlines)

    def test_empty_underlines(self):
        word = {'x0': 100, 'x1': 200, 'bottom': 50}
        assert not _is_word_underlined(word, [])

    def test_zero_width_word(self):
        word = {'x0': 100, 'x1': 100, 'bottom': 50}
        underlines = [{'x0': 100, 'x1': 200, 'y': 51}]
        assert not _is_word_underlined(word, underlines)

# ── collection page detection ─────────────────────────────────────────────

def make_word(text: str, x0=0, x1=1, top=0, bottom=1) -> dict:
    return {'text': text, 'x0': x0, 'x1': x1, 'top': top, 'bottom': bottom}


def test_detect_collection_positive_keywords():
    from backend.routers.bq import _is_collection_page
    words = [make_word('TOTAL'), make_word('Grand Total'), make_word('1000')]
    is_coll, conf = _is_collection_page(words, page_width=800, page_height=1100)
    assert is_coll
    assert conf > 0.6


def test_detect_collection_negative_item_page():
    from backend.routers.bq import _is_collection_page
    words = [make_word('Item'), make_word('Brickwork'), make_word('100 m2')]
    is_coll, conf = _is_collection_page(words, page_width=800, page_height=1100)
    assert not is_coll
    assert conf < 0.6


def test_detect_collection_fuzzy_keyword():
    """A slight OCR error should still match a positive keyword."""
    from backend.routers.bq import _is_collection_page
    words = [make_word('ToTAl')]  # case/spacing fuzziness
    is_coll, conf = _is_collection_page(words, page_width=800, page_height=1100)
    assert is_coll
    assert conf > 0.6


def test_parse_bq_rows_marks_collections(monkeypatch):
    """When the page contains summary keywords the returned rows carry the flag."""
    from backend.routers.bq import _parse_bq_rows, BoxDefinition

    # fake pdfplumber page that returns one word 'Total'
    class FakePage:
        width = 100
        height = 200
        def within_bbox(self, bbox):
            return self
        def extract_words(self, **kwargs):
            return [{
                'text': 'Total', 'x0': 10, 'x1': 50,
                'top': 10, 'bottom': 20,
                'fontname': None, 'size': 10
            }]
        # underline detection expects page.lines and page.rects
        @property
        def lines(self):
            return []
        @property
        def rects(self):
            return []
    class FakeDoc:
        def __init__(self, page):
            self.pages = [page]
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def __len__(self):
            return 1
        def __getitem__(self, i):
            return self.pages[i]

    import pdfplumber
    monkeypatch.setattr(pdfplumber, 'open', lambda path: FakeDoc(FakePage()))
    # ensure existence check passes
    import os
    monkeypatch.setattr(os.path, 'exists', lambda path: True)

    # minimal boxes: DataRange and Description (so words are assigned)
    boxes = [
        BoxDefinition(column_name='DataRange', x=0, y=0, width=1, height=1),
        BoxDefinition(column_name='Description', x=0, y=0, width=0.5, height=1),
    ]

    rows, debug = _parse_bq_rows('fake', 0, boxes, 'pdfplumber', 'dummy.pdf')
    assert debug.get('collection_page', {}).get('is_collection') is True
    assert all(getattr(r, 'page_is_collection', False) for r in rows)


# ── _has_subitem_prefix ──────────────────────────────────────────────

class TestHasSubitemPrefix:
    def test_asterisk(self):
        assert _has_subitem_prefix("* some text")

    def test_dash(self):
        assert _has_subitem_prefix("- bullet item")

    def test_letter_dot(self):
        assert _has_subitem_prefix("A. first item")
        assert _has_subitem_prefix("B item")  # B followed by space

    def test_number_dot(self):
        assert _has_subitem_prefix("1. first")
        assert _has_subitem_prefix("12. twelfth")

    def test_parenthesised(self):
        assert _has_subitem_prefix("(a) sub part")
        assert _has_subitem_prefix("(i) roman")
        assert _has_subitem_prefix("(3) number")

    def test_no_prefix(self):
        assert not _has_subitem_prefix("Some normal text")
        assert not _has_subitem_prefix("Description of work")

    def test_empty(self):
        assert not _has_subitem_prefix("")


# ── _is_bold_font ────────────────────────────────────────────────────

class TestIsBoldFont:
    def test_bold_in_name(self):
        assert _is_bold_font("Arial-Bold")
        assert _is_bold_font("TimesNewRoman-BoldItalic")

    def test_not_bold(self):
        assert not _is_bold_font("Arial")
        assert not _is_bold_font("Helvetica-Italic")

    def test_none(self):
        assert not _is_bold_font(None)


# ── _classify_line_type ──────────────────────────────────────────────

class TestClassifyLineType:
    """After simplification, _classify_line_type always returns 'item'."""
    def _line(self, *, text="Some text", bold=False, underline=False, size=10):
        return {
            'text': text,
            'fontname': 'Arial-Bold' if bold else 'Arial',
            'underline': underline,
            'size': size,
            'x0': 50, 'x1': 200,
            'y_top': 100, 'y_bottom': 110,
            'y_center': 105,
        }

    def test_heading1_bold_underline(self):
        line = self._line(bold=True, underline=True, size=10)
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_heading1_large_bold(self):
        line = self._line(bold=True, size=16)
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_heading2_bold_short(self):
        line = self._line(bold=True, text="SHORT")
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_heading2_underline_short(self):
        line = self._line(underline=True, text="Title")
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_subitem_prefix(self):
        line = self._line(text="* bullet point here")
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_normal_item(self):
        line = self._line(text="Normal description text that is long enough")
        assert _classify_line_type(line, median_size=10) == 'item'

    def test_no_median_size(self):
        line = self._line(bold=True, size=16)
        result = _classify_line_type(line, median_size=None)
        assert result == 'item'


# ── _should_split_block: subitem / sub_indent reasons ─────────────

class TestShouldSplitBlockSubitem:
    para = 20

    def test_subitem_prefix_splits(self):
        a = _make_line(text="Normal text line")
        b = _make_line(text="* Bullet sub-item", y_top=12, y_bottom=22)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'subitem'

    def test_subitem_dash_splits(self):
        a = _make_line(text="Main item description")
        b = _make_line(text="- Another point", y_top=12, y_bottom=22)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'subitem'

    def test_sub_indent_splits(self):
        # x0 shift of 15 with height 10 → 1.5×height > 1.0 threshold, rightward
        a = _make_line(x0=100, x1=300, y_top=0, y_bottom=10)
        b = _make_line(x0=115, x1=315, y_top=12, y_bottom=22)
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason in ('sub_indent', 'indent')
