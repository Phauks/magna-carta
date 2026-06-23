// Bates numbering — label model: formatting, glyph-width measurement, PDF literal escaping.
// A Bates stamp is an ADDITIVE OVERLAY; it never removes or modifies existing page content.
// Placement, resource merge, content append, and document/set stamping are built in later steps.

use crate::standard_fonts_data::{HELVETICA, WIN_ANSI_ENCODING};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Where on the page the Bates label is placed.
#[derive(Debug, Clone, Copy, Default)]
pub enum BatesPosition {
    BottomLeft,
    #[default]
    BottomRight,
    BottomCenter,
    TopLeft,
    TopRight,
    TopCenter,
}

/// Options controlling Bates stamp appearance and placement.
pub struct BatesOptions {
    /// Text prefix prepended before the zero-padded number (e.g. `"SMITH-"`).
    pub prefix: String,
    /// The number assigned to the first page.
    pub start_number: u64,
    /// Minimum digit width; shorter numbers are zero-padded.
    pub padding: u8,
    /// Corner or edge where the label is drawn.
    pub position: BatesPosition,
    /// Distance in points from the page edge to the label.
    pub margin_pt: f32,
    /// Font size in points for the stamp text.
    pub font_size_pt: f32,
}

impl Default for BatesOptions {
    fn default() -> Self {
        Self {
            prefix: String::new(),
            start_number: 1,
            padding: 6,
            position: BatesPosition::BottomRight,
            margin_pt: 18.0,
            font_size_pt: 8.0,
        }
    }
}

/// Inclusive Bates range stamped onto one document.
#[derive(Debug, Clone, PartialEq)]
pub struct BatesRange {
    /// First Bates number stamped.
    pub start: u64,
    /// Last Bates number stamped (inclusive).
    pub end: u64,
    /// Number of pages stamped.
    pub page_count: usize,
}

/// Errors that can occur during stamping.
#[derive(Debug)]
pub enum BatesError {
    /// The input bytes could not be parsed as a PDF.
    Parse,
    /// The document contains no pages and cannot be stamped.
    NoPages,
    /// The stamped document could not be serialised back to bytes.
    Reassemble,
}

// ---------------------------------------------------------------------------
// Label model — pure computation, no I/O, no logging
// ---------------------------------------------------------------------------

/// Formats a Bates label: `prefix` followed by `number` zero-padded to at least
/// `padding` digits. When `number` is wider than `padding`, no truncation occurs.
pub(crate) fn format_label(prefix: &str, number: u64, padding: u8) -> String {
    format!("{prefix}{number:0width$}", width = padding as usize)
}

/// Returns the glyph advance width (in glyph-space units, 1000 = 1 em) for `ch`
/// rendered in Helvetica via the WinAnsi encoding.
///
/// The lookup path is: `ch as u32` → WinAnsi code-point → glyph name →
/// binary search in the sorted `HELVETICA` metrics slice. Returns `0.0` for
/// any character whose code-point is ≥ 256, whose WinAnsi slot is empty, or
/// whose glyph name is absent from the metrics.
pub(crate) fn helvetica_advance(ch: char) -> f32 {
    let code = ch as u32;
    if code >= 256 {
        return 0.0;
    }
    let name = WIN_ANSI_ENCODING[code as usize];
    if name.is_empty() {
        return 0.0;
    }
    // HELVETICA is sorted by glyph name — binary search is correct and O(log n).
    match HELVETICA.binary_search_by_key(&name, |&(n, _)| n) {
        Ok(index) => HELVETICA[index].1 as f32,
        Err(_) => 0.0,
    }
}

/// Returns the width in points of `label` rendered in Helvetica at `font_size_pt`.
///
/// Each glyph's advance in glyph-space (1000 units/em) is divided by 1000 and
/// scaled by the font size to yield device points.
pub(crate) fn label_width_pt(label: &str, font_size_pt: f32) -> f32 {
    let glyph_units: f32 = label.chars().map(helvetica_advance).sum();
    (glyph_units / 1000.0) * font_size_pt
}

/// Escapes a string for use inside a PDF literal string `(…)`.
///
/// Replacement order is intentional: backslash must be doubled before
/// parentheses are escaped, otherwise the newly inserted backslashes would
/// be incorrectly re-escaped.
pub(crate) fn escape_pdf_literal(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_padded_label() {
        assert_eq!(format_label("SMITH-", 42, 6), "SMITH-000042");
        assert_eq!(format_label("", 7, 4), "0007");
        assert_eq!(format_label("X", 12345, 3), "X12345"); // wider than padding — no truncation
    }

    #[test]
    fn helvetica_widths_match_metrics() {
        // Confirmed against standard_fonts_data::HELVETICA and WIN_ANSI_ENCODING:
        // 'A' (code 65)  → glyph "A"      → 667
        // ' ' (code 32)  → glyph "space"  → 278
        // '0' (code 48)  → glyph "zero"   → 556
        // '-' (code 45)  → glyph "hyphen" → 333
        assert_eq!(helvetica_advance('A'), 667.0);
        assert_eq!(helvetica_advance(' '), 278.0);
        assert_eq!(helvetica_advance('0'), 556.0);
        assert_eq!(helvetica_advance('-'), 333.0);
    }

    #[test]
    fn label_width_scales_with_size() {
        // "00" = 2 × 556 = 1112 glyph units; at 10 pt → 1112/1000 × 10 = 11.12 pt
        assert!((label_width_pt("00", 10.0) - 11.12).abs() < 0.01);
    }

    #[test]
    fn escapes_pdf_literal_specials() {
        assert_eq!(escape_pdf_literal(r"a(b)c\d"), r"a\(b\)c\\d");
    }
}
