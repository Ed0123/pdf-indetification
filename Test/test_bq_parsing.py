"""Unit tests for BQ text-block splitting helpers."""
import pytest
from backend.routers.bq import (
    _normalize_fontname,
    _should_split_block,
    _detect_underlines,
    _is_word_underlined,
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
               fontname="Arial", size=12.0, underline=False):
    return {
        'x0': x0, 'x1': x1,
        'y_top': y_top, 'y_bottom': y_bottom,
        'fontname': fontname, 'size': size,
        'underline': underline,
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
        a = _make_line(x0=100, x1=300, y_bottom=10)
        b = _make_line(x0=200, x1=400, y_top=12)  # 100px shift
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'indent'

    def test_small_x_shift_no_split(self):
        a = _make_line(x0=100, x1=300, y_bottom=10)
        b = _make_line(x0=105, x1=305, y_top=12)  # 5px — within threshold
        split, _ = _should_split_block(a, b, self.para)
        assert not split

    # ── gap splits ────────────────────────────────────────────────────

    def test_large_gap_splits(self):
        a = _make_line(y_bottom=10)
        b = _make_line(y_top=50)  # gap=40 > para=20
        split, reason = _should_split_block(a, b, self.para)
        assert split
        assert reason == 'gap'

    def test_small_gap_no_split(self):
        a = _make_line(y_bottom=10)
        b = _make_line(y_top=15)  # gap=5 < para=20
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
