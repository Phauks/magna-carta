// Bates numbering — additive overlay: the label model (formatting, glyph-width
// measurement, PDF literal escaping), rotation-aware per-page stamping (non-destructive
// resource merge + content append), and document/set continuous numbering.
// A Bates stamp is an ADDITIVE OVERLAY; it never removes or modifies existing page content.

use lopdf::{dictionary, Object};

use crate::standard_fonts_data::{
    COURIER, COURIER_BOLD, COURIER_BOLDOBLIQUE, COURIER_OBLIQUE, HELVETICA, HELVETICA_BOLD,
    HELVETICA_BOLDOBLIQUE, HELVETICA_OBLIQUE, TIMES_BOLD, TIMES_BOLDITALIC, TIMES_ITALIC,
    TIMES_ROMAN, WIN_ANSI_ENCODING,
};

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

/// One of the twelve standard PDF Type 1 text fonts available for Bates labels.
///
/// All twelve are PDF standard fonts that do not require font embedding — every
/// conforming viewer is required to supply them. They cover three typeface families
/// (Helvetica, Times, Courier), each in four style variants.
#[derive(Debug, Clone, Copy, Default)]
pub enum BatesFont {
    /// Helvetica regular (sans-serif).
    #[default]
    Helvetica,
    /// Helvetica bold.
    HelveticaBold,
    /// Helvetica oblique (slanted).
    HelveticaOblique,
    /// Helvetica bold oblique.
    HelveticaBoldOblique,
    /// Times Roman (serif regular).
    TimesRoman,
    /// Times bold.
    TimesBold,
    /// Times italic.
    TimesItalic,
    /// Times bold italic.
    TimesBoldItalic,
    /// Courier (monospace regular).
    Courier,
    /// Courier bold.
    CourierBold,
    /// Courier oblique.
    CourierOblique,
    /// Courier bold oblique.
    CourierBoldOblique,
}

impl BatesFont {
    /// The PostScript name for this font as required in a PDF `/BaseFont` entry.
    pub(crate) fn postscript_name(self) -> &'static str {
        match self {
            BatesFont::Helvetica => "Helvetica",
            BatesFont::HelveticaBold => "Helvetica-Bold",
            BatesFont::HelveticaOblique => "Helvetica-Oblique",
            BatesFont::HelveticaBoldOblique => "Helvetica-BoldOblique",
            BatesFont::TimesRoman => "Times-Roman",
            BatesFont::TimesBold => "Times-Bold",
            BatesFont::TimesItalic => "Times-Italic",
            BatesFont::TimesBoldItalic => "Times-BoldItalic",
            BatesFont::Courier => "Courier",
            BatesFont::CourierBold => "Courier-Bold",
            BatesFont::CourierOblique => "Courier-Oblique",
            BatesFont::CourierBoldOblique => "Courier-BoldOblique",
        }
    }

    /// The glyph-advance-width table for this font, sorted by glyph name for binary search.
    ///
    /// Values are in glyph-space units (1000 units = 1 em). All twelve fonts use the
    /// WinAnsi code-to-glyph-name mapping via `WIN_ANSI_ENCODING`.
    pub(crate) fn width_table(self) -> &'static [(&'static str, i16)] {
        match self {
            BatesFont::Helvetica => HELVETICA,
            BatesFont::HelveticaBold => HELVETICA_BOLD,
            BatesFont::HelveticaOblique => HELVETICA_OBLIQUE,
            BatesFont::HelveticaBoldOblique => HELVETICA_BOLDOBLIQUE,
            BatesFont::TimesRoman => TIMES_ROMAN,
            BatesFont::TimesBold => TIMES_BOLD,
            BatesFont::TimesItalic => TIMES_ITALIC,
            BatesFont::TimesBoldItalic => TIMES_BOLDITALIC,
            BatesFont::Courier => COURIER,
            BatesFont::CourierBold => COURIER_BOLD,
            BatesFont::CourierOblique => COURIER_OBLIQUE,
            BatesFont::CourierBoldOblique => COURIER_BOLDOBLIQUE,
        }
    }
}

/// Options controlling Bates stamp appearance and placement.
pub struct BatesOptions {
    /// Text prefix prepended before the zero-padded number (e.g. `"SMITH-"`).
    pub prefix: String,
    /// Text suffix appended after the zero-padded number (e.g. `"-CONF"`).
    pub suffix: String,
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
    /// Typeface used for the stamp label.
    pub font: BatesFont,
    /// Inclusive upper bound on the last Bates number that may be stamped.
    ///
    /// When `Some(stop)`, `stamp_document` returns `Err(BatesError::RangeExceeded)`
    /// if stamping the document would assign any number greater than `stop`. The
    /// check occurs before any page is modified.
    pub stop_number: Option<u64>,
}

impl Default for BatesOptions {
    fn default() -> Self {
        Self {
            prefix: String::new(),
            suffix: String::new(),
            start_number: 1,
            padding: 6,
            position: BatesPosition::BottomRight,
            margin_pt: 18.0,
            font_size_pt: 8.0,
            font: BatesFont::Helvetica,
            stop_number: None,
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
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
    /// The input bytes could not be parsed as a PDF.
    Parse,
    /// The document contains no pages and cannot be stamped.
    NoPages,
    /// The stamped document could not be serialised back to bytes.
    Reassemble,
    /// Stamping the document would assign a number beyond `BatesOptions::stop_number`.
    RangeExceeded,
    /// The prefix or suffix holds a character the stamp's font cannot draw (anything
    /// outside Windows-1252). Refused, because the alternative is a stamp that prints as
    /// something other than what was asked for on every page of a production.
    UnsupportedCharacter,
}

// ---------------------------------------------------------------------------
// Label model — pure computation, no I/O, no logging
// ---------------------------------------------------------------------------

/// Formats a Bates label: `prefix` followed by `number` zero-padded to at least
/// `padding` digits, then `suffix`. When `number` is wider than `padding`, no
/// truncation occurs.
///
/// Called by `stamp_document` to derive a per-page label from `BatesOptions` before
/// passing it to `stamp_page`.
pub(crate) fn format_label(prefix: &str, number: u64, padding: u8, suffix: &str) -> String {
    format!("{prefix}{number:0width$}{suffix}", width = padding as usize)
}

/// The characters Windows-1252 keeps where Latin-1 has control codes, by code 0x80 to 0x9F.
/// `None` marks the five codes the encoding leaves undefined.
const WIN_ANSI_HIGH: [Option<char>; 32] = [
    Some('\u{20AC}'),
    None,
    Some('\u{201A}'),
    Some('\u{0192}'),
    Some('\u{201E}'),
    Some('\u{2026}'),
    Some('\u{2020}'),
    Some('\u{2021}'),
    Some('\u{02C6}'),
    Some('\u{2030}'),
    Some('\u{0160}'),
    Some('\u{2039}'),
    Some('\u{0152}'),
    None,
    Some('\u{017D}'),
    None,
    None,
    Some('\u{2018}'),
    Some('\u{2019}'),
    Some('\u{201C}'),
    Some('\u{201D}'),
    Some('\u{2022}'),
    Some('\u{2013}'),
    Some('\u{2014}'),
    Some('\u{02DC}'),
    Some('\u{2122}'),
    Some('\u{0161}'),
    Some('\u{203A}'),
    Some('\u{0153}'),
    None,
    Some('\u{017E}'),
    Some('\u{0178}'),
];

/// The byte that stands for `ch` in a font whose `/Encoding` is `/WinAnsiEncoding`, or
/// `None` when the encoding has no place for it.
///
/// A PDF string drawn with one of the standard fonts is a run of single bytes, each read
/// through the font's encoding. It is not UTF-8: writing "é" as its two UTF-8 bytes draws
/// two unrelated glyphs. Windows-1252 covers the Western European alphabets, the euro sign
/// and typographic quotation marks and dashes, which is what a stamp, a watermark or a
/// name on a form holds in this product's markets.
pub(crate) fn win_ansi_code(ch: char) -> Option<u8> {
    let code = ch as u32;
    match code {
        0x20..=0x7E | 0xA0..=0xFF => u8::try_from(code).ok(),
        _ => WIN_ANSI_HIGH
            .iter()
            .position(|slot| *slot == Some(ch))
            .and_then(|index| u8::try_from(0x80 + index).ok()),
    }
}

/// `text` as the body of a PDF literal string for a `/WinAnsiEncoding` font: one byte per
/// character, with the three bytes a literal string reserves escaped. Fails with the first
/// character the encoding cannot hold.
pub(crate) fn win_ansi_literal(text: &str) -> Result<Vec<u8>, char> {
    let mut bytes = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let code = win_ansi_code(ch).ok_or(ch)?;
        if matches!(code, b'\\' | b'(' | b')') {
            bytes.push(b'\\');
        }
        bytes.push(code);
    }
    Ok(bytes)
}

/// [`win_ansi_literal`] for text that must be drawn whatever it holds: a character the
/// encoding cannot hold becomes a question mark.
pub(crate) fn win_ansi_literal_lossy(text: &str) -> Vec<u8> {
    let replaced: String = text
        .chars()
        .map(|ch| if win_ansi_code(ch).is_some() { ch } else { '?' })
        .collect();
    win_ansi_literal(&replaced).unwrap_or_default()
}

/// Returns the glyph advance width (in glyph-space units, 1000 = 1 em) for `ch`
/// rendered in `font` via the WinAnsi encoding.
///
/// The lookup path is: `ch` → WinAnsi code → glyph name → binary search in the sorted
/// metrics table for `font`. Returns `0.0` for a character the encoding cannot hold or
/// whose glyph name is absent from the metrics.
pub(crate) fn font_advance(font: BatesFont, ch: char) -> f32 {
    let Some(code) = win_ansi_code(ch) else {
        return 0.0;
    };
    let name = WIN_ANSI_ENCODING[usize::from(code)];
    if name.is_empty() {
        return 0.0;
    }
    let table = font.width_table();
    // Each font table is sorted by glyph name — binary search is correct and O(log n).
    match table.binary_search_by_key(&name, |&(n, _)| n) {
        Ok(index) => table[index].1 as f32,
        Err(_) => 0.0,
    }
}

/// Returns the width in points of `label` rendered in `font` at `font_size_pt`.
///
/// Each glyph's advance in glyph-space (1000 units/em) is divided by 1000 and
/// scaled by the font size to yield device points.
pub(crate) fn label_width_pt(font: BatesFont, label: &str, font_size_pt: f32) -> f32 {
    let glyph_units: f32 = label.chars().map(|ch| font_advance(font, ch)).sum();
    (glyph_units / 1000.0) * font_size_pt
}

// ---------------------------------------------------------------------------
// Per-page stamping — placement, resource merge, content append
// ---------------------------------------------------------------------------

/// Stamp a single page in place with `label`.
///
/// The stamp is an ADDITIVE OVERLAY: existing content and resources are preserved.
/// The label is placed in the requested corner of the *displayed* page (after the
/// viewer applies `/Rotate` and the MediaBox origin) and reads upright. A
/// self-contained `/Resources` dictionary is written onto the page that merges the
/// page's effective resources with the shared stamp font object (`font_id`) under
/// the name `MagnaCartaBates`, so a page that inherited its resources keeps every
/// inherited entry.
///
/// `font_id` must be the `ObjectId` of a `<< /Type /Font /Subtype /Type1 /BaseFont
/// /… >>` object already added to `doc`. `stamp_document` adds the object once per
/// document and passes its id to every call on that document, so the document
/// contains exactly one stamp font object shared by all stamped pages.
///
/// Returns `BatesError::Parse` only when the page has no resolvable MediaBox.
pub(crate) fn stamp_page(
    doc: &mut lopdf::Document,
    page_id: lopdf::ObjectId,
    font_id: lopdf::ObjectId,
    label: &str,
    opts: &BatesOptions,
) -> Result<(), BatesError> {
    // ── Geometry ──────────────────────────────────────────────────────────────
    let [llx, lly, urx, ury] =
        crate::surgery::resolve_mediabox(doc, page_id).ok_or(BatesError::Parse)?;
    let rotation = crate::surgery::resolve_rotate(doc, page_id).rem_euclid(360);
    let page_width = urx - llx;
    let page_height = ury - lly;

    // ── Placement → text origin (dx, dy) in the displayed bottom-left frame ─────
    // Displayed dimensions swap for the quarter-turn rotations.
    let (displayed_width, displayed_height) = if rotation == 90 || rotation == 270 {
        (page_height, page_width)
    } else {
        (page_width, page_height)
    };
    let margin = opts.margin_pt;
    let size = opts.font_size_pt;
    let width = label_width_pt(opts.font, label, size);

    let (dx, dy) = match opts.position {
        BatesPosition::BottomLeft => (margin, margin),
        BatesPosition::BottomRight => (displayed_width - margin - width, margin),
        BatesPosition::BottomCenter => ((displayed_width - width) / 2.0, margin),
        BatesPosition::TopLeft => (margin, displayed_height - margin - size),
        BatesPosition::TopRight => (
            displayed_width - margin - width,
            displayed_height - margin - size,
        ),
        BatesPosition::TopCenter => (
            (displayed_width - width) / 2.0,
            displayed_height - margin - size,
        ),
    };

    let [tm_a, tm_b, tm_c, tm_d, tm_e, tm_f] =
        crate::surgery::text_matrix(rotation, llx, lly, page_width, page_height, dx, dy);

    // ── Resource merge (non-destructive) ────────────────────────────────────────
    // Resolve the page's effective resources (may be inherited or an indirect ref).
    let existing_resources: lopdf::Dictionary =
        crate::surgery::resolve_inherited_resources(doc, page_id)
            .cloned()
            .unwrap_or_default();

    // Clone the existing /Font subdictionary (resolving an indirect ref) so no
    // existing font resource is dropped.
    let mut font_dict: lopdf::Dictionary = match existing_resources.get(b"Font") {
        Ok(font_obj) => crate::surgery::resolve_dict(doc, font_obj)
            .cloned()
            .unwrap_or_default(),
        Err(_) => lopdf::Dictionary::new(),
    };

    // Reference the shared stamp font object under a distinctive name that will not
    // clobber an existing /Font resource. The caller (stamp_document) creates this
    // object once per document and passes its id so all pages share it.
    font_dict.set(b"MagnaCartaBates", Object::Reference(font_id));

    // Build the merged resources: every existing entry, with /Font replaced by the
    // merged font dict. Write it onto the PAGE dict so the page is self-contained.
    let mut merged_resources = existing_resources;
    merged_resources.set(b"Font", Object::Dictionary(font_dict));
    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
        page_dict.set(b"Resources", Object::Dictionary(merged_resources));
    }

    // ── Content append ──────────────────────────────────────────────────────────
    // The stamp is drawn LAST so it paints on top of existing content. `0 g` selects
    // black fill; `q … Q` isolates the graphics state from the rest of the page.
    let mut stream_content = format!(
        "q BT /MagnaCartaBates {size:.2} Tf 0 g {tm_a:.4} {tm_b:.4} {tm_c:.4} {tm_d:.4} {tm_e:.4} {tm_f:.4} Tm ("
    )
    .into_bytes();
    stream_content.extend(win_ansi_literal(label).map_err(|_| BatesError::UnsupportedCharacter)?);
    stream_content.extend_from_slice(b") Tj ET Q");
    let stamp_stream = lopdf::Stream::new(dictionary! {}, stream_content);
    let stamp_id = doc.add_object(Object::Stream(stamp_stream));

    let contents_obj = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|dict| dict.get(b"Contents").ok().cloned());

    match contents_obj {
        Some(Object::Reference(old_id)) => {
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(
                    b"Contents",
                    Object::Array(vec![Object::Reference(old_id), Object::Reference(stamp_id)]),
                );
            }
        }
        Some(Object::Array(mut arr)) => {
            arr.push(Object::Reference(stamp_id));
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Contents", Object::Array(arr));
            }
        }
        _ => {
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Contents", Object::Reference(stamp_id));
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Document and set stamping — continuous Bates numbering
// ---------------------------------------------------------------------------

/// Stamps every page of the PDF `bytes` with a sequential Bates label, starting at
/// `start`. Returns the serialised output bytes and the inclusive range stamped.
///
/// A single font dictionary (the typeface selected in `opts.font`) is added to the
/// document and shared by every stamped page (`/MagnaCartaBates`), so the document
/// contains exactly one new font object regardless of page count.
///
/// If `opts.stop_number` is `Some(stop)` and the last page would receive a number
/// greater than `stop`, returns `Err(BatesError::RangeExceeded)` before any page
/// is modified.
///
/// Page order is determined by the 1-based page numbers in `doc.get_pages()`, which
/// matches the reading order viewers present to users.
pub fn stamp_document(
    bytes: &[u8],
    opts: &BatesOptions,
    start: u64,
) -> Result<(Vec<u8>, BatesRange), BatesError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| BatesError::Rejected)?;
    let mut doc = lopdf::Document::load_mem(bytes).map_err(|_| BatesError::Parse)?;

    // Collect page ObjectIds in reading order (sorted by 1-based page number).
    let mut pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();
    if pages.is_empty() {
        return Err(BatesError::NoPages);
    }
    pages.sort_by_key(|(page_number, _)| *page_number);

    let page_count = pages.len();
    let end = start + page_count as u64 - 1;

    // Enforce the stop-number ceiling before any page is touched.
    if let Some(stop) = opts.stop_number {
        if end > stop {
            return Err(BatesError::RangeExceeded);
        }
    }

    // Add the shared stamp font object once per document; every page references it.
    let base_font_name = opts.font.postscript_name();
    let font_id = doc.add_object(dictionary! {
        b"Type" => Object::Name(b"Font".to_vec()),
        b"Subtype" => Object::Name(b"Type1".to_vec()),
        b"BaseFont" => Object::Name(base_font_name.as_bytes().to_vec()),
        b"Encoding" => Object::Name(b"WinAnsiEncoding".to_vec()),
    });

    for (index, (_, page_id)) in pages.into_iter().enumerate() {
        let label = format_label(
            &opts.prefix,
            start + index as u64,
            opts.padding,
            &opts.suffix,
        );
        stamp_page(&mut doc, page_id, font_id, &label, opts)?;
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| BatesError::Reassemble)?;

    let range = BatesRange {
        start,
        end,
        page_count,
    };
    Ok((output, range))
}

/// Stamps each document in `docs` with sequential Bates labels, threading the
/// counter from one document to the next. The first document starts at
/// `opts.start_number`; each subsequent document continues from where the
/// previous one left off.
///
/// Returns a `Vec` of `(stamped_bytes, range)` in the same order as `docs`.
pub fn stamp_set(
    docs: &[Vec<u8>],
    opts: &BatesOptions,
) -> Result<Vec<(Vec<u8>, BatesRange)>, BatesError> {
    let mut results = Vec::with_capacity(docs.len());
    let mut next = opts.start_number;
    for document in docs {
        let (stamped, range) = stamp_document(document, opts, next)?;
        next = range.end + 1;
        results.push((stamped, range));
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use hayro::hayro_syntax::Pdf;
    use lopdf::{Document, Stream};

    // ── Stamping test helpers ──────────────────────────────────────────────────

    /// Build a minimal single-page document and return it with its page id. The
    /// page has an empty content stream and an inline `/Resources` with an empty
    /// `/Font` dict; `mediabox` is `[llx lly urx ury]`.
    fn page_doc(mediabox: [i64; 4]) -> (Document, lopdf::ObjectId) {
        let mut doc = Document::with_version("1.5");

        let pages_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![]),
            b"Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));

        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));

        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(mediabox[0]),
                Object::Integer(mediabox[1]),
                Object::Integer(mediabox[2]),
                Object::Integer(mediabox[3]),
            ]),
            b"Contents" => Object::Reference(content_id),
            b"Resources" => Object::Dictionary(dictionary! {
                b"Font" => Object::Dictionary(dictionary! {}),
            }),
        });

        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set(b"Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages_dict.set(b"Count", Object::Integer(1));
        }

        (doc, page_id)
    }

    /// Serialize a document and parse it back with hayro for rendering/observation.
    fn render(doc: &mut Document) -> Pdf {
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize stamped document");
        Pdf::new(bytes).expect("hayro parses the stamped document")
    }

    #[test]
    fn stamp_page_preserves_existing_fonts_under_inherited_resources() {
        // The page's /Resources is an INDIRECT REFERENCE to a dict carrying a font.
        // After stamping, the page must keep that font AND gain MagnaCartaBates.
        let (mut doc, page_id) = page_doc([0, 0, 612, 792]);

        let resources_id = doc.add_object(dictionary! {
            b"Font" => Object::Dictionary(dictionary! {
                b"ExistingFont" => Object::Dictionary(dictionary! {
                    b"Type" => Object::Name(b"Font".to_vec()),
                    b"Subtype" => Object::Name(b"Type1".to_vec()),
                    b"BaseFont" => Object::Name(b"Times-Roman".to_vec()),
                }),
            }),
        });
        if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
            page_dict.set(b"Resources", Object::Reference(resources_id));
        }

        let font_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Font".to_vec()),
            b"Subtype" => Object::Name(b"Type1".to_vec()),
            b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        stamp_page(
            &mut doc,
            page_id,
            font_id,
            "SMITH-000001",
            &BatesOptions::default(),
        )
        .unwrap();

        // Resolve the page's /Resources → /Font and assert both fonts are present.
        let resources = crate::surgery::resolve_inherited_resources(&doc, page_id)
            .expect("page resources resolve after stamping");
        let font_obj = resources.get(b"Font").expect("/Font present");
        let font_dict =
            crate::surgery::resolve_dict(&doc, font_obj).expect("/Font is a dictionary");
        assert!(
            font_dict.has(b"ExistingFont"),
            "the inherited ExistingFont must survive the resource merge"
        );
        assert!(
            font_dict.has(b"MagnaCartaBates"),
            "the stamp font MagnaCartaBates must be added"
        );
    }

    #[test]
    fn stamped_label_renders_at_bottom_right() {
        let (mut doc, page_id) = page_doc([0, 0, 612, 792]);
        let label = "ACME-000042";
        let font_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Font".to_vec()),
            b"Subtype" => Object::Name(b"Type1".to_vec()),
            b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        stamp_page(&mut doc, page_id, font_id, label, &BatesOptions::default()).unwrap();

        let pdf = render(&mut doc);
        let obs = crate::textpos::observe_page(&pdf, 0).expect("observe stamped page");

        let recovered: String = obs.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            recovered.contains(label),
            "recovered text {recovered:?} must contain the label {label:?}"
        );

        // hayro device space has a top-left origin: bottom of the page = large y.
        assert!(
            obs.glyphs
                .iter()
                .any(|g| g.bbox.center().x > obs.width_pt as f64 / 2.0),
            "a label glyph must land in the right half of the rendered page"
        );
        assert!(
            obs.glyphs
                .iter()
                .any(|g| g.bbox.center().y > obs.height_pt as f64 * 0.75),
            "a label glyph must land in the bottom band of the rendered page"
        );
    }

    #[test]
    fn stamped_label_correct_corner_each_rotation() {
        for rotation in [90_i64, 180, 270] {
            let (mut doc, page_id) = page_doc([0, 0, 612, 792]);
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Rotate", Object::Integer(rotation));
            }
            let label = "ROT-000007";
            let font_id = doc.add_object(dictionary! {
                b"Type" => Object::Name(b"Font".to_vec()),
                b"Subtype" => Object::Name(b"Type1".to_vec()),
                b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
            });
            stamp_page(&mut doc, page_id, font_id, label, &BatesOptions::default()).unwrap();

            let pdf = render(&mut doc);
            let obs = crate::textpos::observe_page(&pdf, 0)
                .unwrap_or_else(|| panic!("observe rotated page r={rotation}"));

            // Collect the label glyphs (every glyph here belongs to the label).
            let centers: Vec<kurbo::Point> = obs
                .glyphs
                .iter()
                .filter(|g| !g.text.is_empty())
                .map(|g| g.bbox.center())
                .collect();
            assert!(
                !centers.is_empty(),
                "label glyphs must render for r={rotation}"
            );
            let count = centers.len() as f64;
            let centroid_x = centers.iter().map(|p| p.x).sum::<f64>() / count;
            let centroid_y = centers.iter().map(|p| p.y).sum::<f64>() / count;

            // Bottom-right of the RENDERED (rotation-applied) image: hayro top-left origin.
            assert!(
                centroid_x > obs.width_pt as f64 / 2.0,
                "r={rotation}: label centroid x {centroid_x} must be in the right half (width {})",
                obs.width_pt
            );
            assert!(
                centroid_y > obs.height_pt as f64 * 2.0 / 3.0,
                "r={rotation}: label centroid y {centroid_y} must be in the bottom third (height {})",
                obs.height_pt
            );
        }
    }

    /// Stamp the default (bottom-right) label on a page and return the rendered label centroid, in
    /// hayro's render frame (rotation applied).
    fn stamp_centroid(mediabox: [i64; 4], rotation: i64) -> (f64, f64) {
        let (mut doc, page_id) = page_doc(mediabox);
        if rotation != 0 {
            if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
                page_dict.set(b"Rotate", Object::Integer(rotation));
            }
        }
        let font_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Font".to_vec()),
            b"Subtype" => Object::Name(b"Type1".to_vec()),
            b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        stamp_page(
            &mut doc,
            page_id,
            font_id,
            "ROT-000042",
            &BatesOptions::default(),
        )
        .unwrap();
        let pdf = render(&mut doc);
        let obs = crate::textpos::observe_page(&pdf, 0).expect("observe stamped page");
        let centers: Vec<kurbo::Point> = obs
            .glyphs
            .iter()
            .filter(|g| !g.text.is_empty())
            .map(|g| g.bbox.center())
            .collect();
        assert!(
            !centers.is_empty(),
            "the label must render for r={rotation}"
        );
        let n = centers.len() as f64;
        (
            centers.iter().map(|p| p.x).sum::<f64>() / n,
            centers.iter().map(|p| p.y).sum::<f64>() / n,
        )
    }

    #[test]
    fn stamp_lands_at_the_same_displayed_corner_regardless_of_rotation() {
        // A non-square displayed frame (792 wide x 612 tall) reached two ways: a page already that
        // size unrotated, and a portrait page turned a quarter-turn to display at that size. The
        // bottom-right stamp must land at the same displayed corner both ways. The earlier
        // width/height swap in the rotation matrix displaced the quarter-turn stamp by the 180 pt
        // width-height difference; the coarse "right half, bottom band" corner test could not see
        // that, so this precise invariant is what guards the fix.
        let flat = stamp_centroid([0, 0, 792, 612], 0);
        for rotation in [90, 270] {
            let rotated = stamp_centroid([0, 0, 612, 792], rotation);
            assert!(
                (rotated.0 - flat.0).abs() < 6.0 && (rotated.1 - flat.1).abs() < 6.0,
                "r={rotation}: stamp must land where the unrotated stamp does; \
                 flat={flat:?} rotated={rotated:?}"
            );
        }
    }

    #[test]
    fn stamp_appends_not_replaces_content() {
        // A page that already shows "Hello" via a Helvetica resource. After stamping,
        // both the original glyphs and the label glyphs must render.
        let (mut doc, page_id) = page_doc([0, 0, 612, 792]);

        let existing_font_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Font".to_vec()),
            b"Subtype" => Object::Name(b"Type1".to_vec()),
            b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
            page_dict.set(
                b"Resources",
                Object::Dictionary(dictionary! {
                    b"Font" => Object::Dictionary(dictionary! {
                        b"F1" => Object::Reference(existing_font_id),
                    }),
                }),
            );
        }
        let existing_stream = Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 1 0 0 1 100 400 Tm (Hello) Tj ET".to_vec(),
        );
        let existing_content_id = doc.add_object(Object::Stream(existing_stream));
        if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) {
            page_dict.set(b"Contents", Object::Reference(existing_content_id));
        }

        let label = "DOC-000123";
        let stamp_font_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Font".to_vec()),
            b"Subtype" => Object::Name(b"Type1".to_vec()),
            b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
        });
        stamp_page(
            &mut doc,
            page_id,
            stamp_font_id,
            label,
            &BatesOptions::default(),
        )
        .unwrap();

        let pdf = render(&mut doc);
        let obs = crate::textpos::observe_page(&pdf, 0).expect("observe stamped page");
        let recovered: String = obs.glyphs.iter().map(|g| g.text.as_str()).collect();

        assert!(
            recovered.contains("Hello"),
            "original text must survive stamping; recovered {recovered:?}"
        );
        assert!(
            recovered.contains(label),
            "label must be added; recovered {recovered:?}"
        );
        assert!(
            obs.glyphs.len() >= "Hello".len() + label.len(),
            "expected at least {} glyphs, got {}",
            "Hello".len() + label.len(),
            obs.glyphs.len()
        );
    }

    #[test]
    fn formats_padded_label() {
        assert_eq!(format_label("SMITH-", 42, 6, ""), "SMITH-000042");
        assert_eq!(format_label("", 7, 4, ""), "0007");
        assert_eq!(format_label("X", 12345, 3, ""), "X12345"); // wider than padding — no truncation
    }

    #[test]
    fn helvetica_widths_match_metrics() {
        // Confirmed against standard_fonts_data::HELVETICA and WIN_ANSI_ENCODING:
        // 'A' (code 65)  → glyph "A"      → 667
        // ' ' (code 32)  → glyph "space"  → 278
        // '0' (code 48)  → glyph "zero"   → 556
        // '-' (code 45)  → glyph "hyphen" → 333
        assert_eq!(font_advance(BatesFont::Helvetica, 'A'), 667.0);
        assert_eq!(font_advance(BatesFont::Helvetica, ' '), 278.0);
        assert_eq!(font_advance(BatesFont::Helvetica, '0'), 556.0);
        assert_eq!(font_advance(BatesFont::Helvetica, '-'), 333.0);
    }

    #[test]
    fn label_width_scales_with_size() {
        // "00" = 2 × 556 = 1112 glyph units; at 10 pt → 1112/1000 × 10 = 11.12 pt
        assert!((label_width_pt(BatesFont::Helvetica, "00", 10.0) - 11.12).abs() < 0.01);
    }

    #[test]
    fn escapes_pdf_literal_specials() {
        assert_eq!(win_ansi_literal(r"a(b)c\d").unwrap(), br"a\(b\)c\\d");
    }

    // ── Document and set stamping helpers ─────────────────────────────────────

    /// Build a minimal multi-page PDF document and return it as bytes.
    ///
    /// Each page is blank (empty content stream, inline resources). All pages share
    /// a single `/Pages` node. `mediabox` is `[llx lly urx ury]` applied to all pages.
    fn multi_page_pdf_bytes(page_count: usize, mediabox: [i64; 4]) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");

        let pages_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![]),
            b"Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));

        let mut kid_refs = Vec::with_capacity(page_count);
        for _ in 0..page_count {
            let content_id =
                doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
            let page_id = doc.add_object(dictionary! {
                b"Type" => Object::Name(b"Page".to_vec()),
                b"Parent" => Object::Reference(pages_id),
                b"MediaBox" => Object::Array(vec![
                    Object::Integer(mediabox[0]),
                    Object::Integer(mediabox[1]),
                    Object::Integer(mediabox[2]),
                    Object::Integer(mediabox[3]),
                ]),
                b"Contents" => Object::Reference(content_id),
                b"Resources" => Object::Dictionary(dictionary! {
                    b"Font" => Object::Dictionary(dictionary! {}),
                }),
            });
            kid_refs.push(Object::Reference(page_id));
        }

        if let Ok(Object::Dictionary(pages_dict)) = doc.get_object_mut(pages_id) {
            pages_dict.set(b"Kids", Object::Array(kid_refs));
            pages_dict.set(b"Count", Object::Integer(page_count as i64));
        }

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize multi-page doc");
        bytes
    }

    // ── Document and set stamping tests ───────────────────────────────────────

    #[test]
    fn stamp_document_numbers_every_page() {
        // A 2-page document stamped from 5 must produce a BatesRange {5, 6, 2} and
        // each page must render the correct label.
        let bytes = multi_page_pdf_bytes(2, [0, 0, 612, 792]);
        let opts = BatesOptions {
            prefix: String::new(),
            start_number: 5,
            ..BatesOptions::default()
        };

        let (stamped, range) = stamp_document(&bytes, &opts, 5).expect("stamp_document succeeds");

        assert_eq!(
            range,
            BatesRange {
                start: 5,
                end: 6,
                page_count: 2
            },
            "range must span the two stamped pages"
        );

        let pdf = Pdf::new(stamped).expect("hayro parses stamped document");

        let obs0 = crate::textpos::observe_page(&pdf, 0).expect("observe page 0");
        let text0: String = obs0.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            text0.contains("000005"),
            "page 0 must show label ending in 000005; got {text0:?}"
        );

        let obs1 = crate::textpos::observe_page(&pdf, 1).expect("observe page 1");
        let text1: String = obs1.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            text1.contains("000006"),
            "page 1 must show label ending in 000006; got {text1:?}"
        );
    }

    #[test]
    fn stamp_set_numbers_continuously() {
        // Two docs (2 pages, 3 pages) from start 1 → ranges {1,2,2} and {3,5,3}.
        let doc_a = multi_page_pdf_bytes(2, [0, 0, 612, 792]);
        let doc_b = multi_page_pdf_bytes(3, [0, 0, 612, 792]);
        let opts = BatesOptions::default(); // start_number = 1

        let results = stamp_set(&[doc_a, doc_b], &opts).expect("stamp_set succeeds");

        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].1,
            BatesRange {
                start: 1,
                end: 2,
                page_count: 2
            },
            "first document range"
        );
        assert_eq!(
            results[1].1,
            BatesRange {
                start: 3,
                end: 5,
                page_count: 3
            },
            "second document range"
        );
    }

    #[test]
    fn empty_document_errors() {
        // A document with no pages must produce BatesError::NoPages.
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Pages".to_vec()),
            b"Kids" => Object::Array(vec![]),
            b"Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialize empty doc");

        let result = stamp_document(&bytes, &BatesOptions::default(), 1);
        assert!(
            matches!(result, Err(BatesError::NoPages)),
            "empty document must return BatesError::NoPages; got {result:?}"
        );
    }

    #[test]
    fn shared_stamp_font_deduped() {
        // Using the default options (Helvetica), a multi-page stamped document must
        // contain exactly one font object with /Subtype /Type1 added by stamping (the
        // shared stamp font), and all stamped pages must reference the same ObjectId
        // under /MagnaCartaBates.
        let bytes = multi_page_pdf_bytes(3, [0, 0, 612, 792]);
        let (stamped, _) =
            stamp_document(&bytes, &BatesOptions::default(), 1).expect("stamp_document succeeds");

        let doc = lopdf::Document::load_mem(&stamped).expect("parse stamped document");

        // Count how many objects in the document match the stamp font signature.
        let stamp_font_count = doc
            .objects
            .values()
            .filter(|obj| {
                if let lopdf::Object::Dictionary(dict) = obj {
                    dict.get(b"Subtype")
                        .ok()
                        .and_then(|v| v.as_name().ok())
                        .is_some_and(|n| n == b"Type1")
                        && dict
                            .get(b"BaseFont")
                            .ok()
                            .and_then(|v| v.as_name().ok())
                            .is_some_and(|n| n == b"Helvetica")
                } else {
                    false
                }
            })
            .count();

        // Exactly ONE Helvetica/Type1 object should exist (the shared stamp font).
        // The blank test pages have no pre-existing fonts, so any Helvetica/Type1 is ours.
        assert_eq!(
            stamp_font_count, 1,
            "the stamped document must contain exactly one Helvetica/Type1 font object, found {stamp_font_count}"
        );

        // Additionally assert that all pages' /MagnaCartaBates resolve to the same ObjectId.
        let mut pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();
        pages.sort_by_key(|(n, _)| *n);

        let font_object_ids: Vec<lopdf::ObjectId> = pages
            .iter()
            .filter_map(|(_, page_id)| {
                let page_dict = doc.get_dictionary(*page_id).ok()?;
                let resources = page_dict.get(b"Resources").ok()?;
                let res_dict = crate::surgery::resolve_dict(&doc, resources)?;
                let font_obj = res_dict.get(b"Font").ok()?;
                let font_dict = crate::surgery::resolve_dict(&doc, font_obj)?;
                match font_dict.get(b"MagnaCartaBates").ok()? {
                    lopdf::Object::Reference(id) => Some(*id),
                    _ => None,
                }
            })
            .collect();

        assert_eq!(
            font_object_ids.len(),
            3,
            "all 3 pages must have /MagnaCartaBates; found {}",
            font_object_ids.len()
        );
        assert!(
            font_object_ids.windows(2).all(|w| w[0] == w[1]),
            "all pages must reference the same stamp font ObjectId; got {font_object_ids:?}"
        );
    }

    // ── New configurability tests ─────────────────────────────────────────────

    #[test]
    fn font_advance_varies_by_font() {
        // Confirmed against standard_fonts_data: glyph "A" (WinAnsi code 65).
        // Courier is monospace: all glyphs are 600 units wide.
        // Times-Roman "A" = 722 units.
        // Helvetica "A" = 667 units.
        assert_eq!(font_advance(BatesFont::Courier, 'A'), 600.0);
        assert_eq!(font_advance(BatesFont::TimesRoman, 'A'), 722.0);
        assert_eq!(font_advance(BatesFont::Helvetica, 'A'), 667.0);
    }

    #[test]
    fn postscript_names_are_standard() {
        assert_eq!(BatesFont::Helvetica.postscript_name(), "Helvetica");
        assert_eq!(BatesFont::HelveticaBold.postscript_name(), "Helvetica-Bold");
        assert_eq!(
            BatesFont::HelveticaOblique.postscript_name(),
            "Helvetica-Oblique"
        );
        assert_eq!(
            BatesFont::HelveticaBoldOblique.postscript_name(),
            "Helvetica-BoldOblique"
        );
        assert_eq!(BatesFont::TimesRoman.postscript_name(), "Times-Roman");
        assert_eq!(BatesFont::TimesBold.postscript_name(), "Times-Bold");
        assert_eq!(BatesFont::TimesItalic.postscript_name(), "Times-Italic");
        assert_eq!(
            BatesFont::TimesBoldItalic.postscript_name(),
            "Times-BoldItalic"
        );
        assert_eq!(BatesFont::Courier.postscript_name(), "Courier");
        assert_eq!(BatesFont::CourierBold.postscript_name(), "Courier-Bold");
        assert_eq!(
            BatesFont::CourierOblique.postscript_name(),
            "Courier-Oblique"
        );
        assert_eq!(
            BatesFont::CourierBoldOblique.postscript_name(),
            "Courier-BoldOblique"
        );
    }

    #[test]
    fn format_label_with_suffix() {
        assert_eq!(format_label("ACME-", 42, 6, "-CONF"), "ACME-000042-CONF");
        // Empty suffix must produce the same result as before the suffix field existed.
        assert_eq!(format_label("SMITH-", 1, 6, ""), "SMITH-000001");
    }

    #[test]
    fn stamp_document_uses_chosen_font() {
        // When BatesOptions::font is Courier, the shared font object's /BaseFont must
        // be /Courier, and the rendered page must contain the label text.
        let bytes = multi_page_pdf_bytes(1, [0, 0, 612, 792]);
        let opts = BatesOptions {
            font: BatesFont::Courier,
            ..BatesOptions::default()
        };
        let (stamped, _) = stamp_document(&bytes, &opts, 1).expect("stamp succeeds");

        let doc = lopdf::Document::load_mem(&stamped).expect("parse stamped document");

        // Verify that the shared font object carries /BaseFont /Courier.
        let courier_font_count = doc
            .objects
            .values()
            .filter(|obj| {
                if let lopdf::Object::Dictionary(dict) = obj {
                    dict.get(b"Subtype")
                        .ok()
                        .and_then(|v| v.as_name().ok())
                        .is_some_and(|n| n == b"Type1")
                        && dict
                            .get(b"BaseFont")
                            .ok()
                            .and_then(|v| v.as_name().ok())
                            .is_some_and(|n| n == b"Courier")
                } else {
                    false
                }
            })
            .count();

        assert_eq!(
            courier_font_count, 1,
            "stamped document must contain exactly one Courier/Type1 font object"
        );

        // Render and confirm the label text is present.
        let pdf = Pdf::new(stamped).expect("hayro parses stamped document");
        let obs = crate::textpos::observe_page(&pdf, 0).expect("observe stamped page");
        let recovered: String = obs.glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            recovered.contains("000001"),
            "rendered page must contain the label; got {recovered:?}"
        );
    }

    #[test]
    fn stamp_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            stamp_document(&big, &BatesOptions::default(), 1),
            Err(BatesError::Rejected)
        ));
    }

    #[test]
    fn stop_number_blocks_overflow() {
        // A 3-page document starting at 1 would produce end=3.
        // stop_number Some(2) is too tight → RangeExceeded before any page is modified.
        // stop_number Some(3) is exact → Ok.
        let bytes = multi_page_pdf_bytes(3, [0, 0, 612, 792]);

        let opts_tight = BatesOptions {
            stop_number: Some(2),
            ..BatesOptions::default()
        };
        let result_tight = stamp_document(&bytes, &opts_tight, 1);
        assert!(
            matches!(result_tight, Err(BatesError::RangeExceeded)),
            "stop_number=2 with 3 pages from 1 must return RangeExceeded; got {result_tight:?}"
        );

        let opts_exact = BatesOptions {
            stop_number: Some(3),
            ..BatesOptions::default()
        };
        let result_exact = stamp_document(&bytes, &opts_exact, 1);
        assert!(
            result_exact.is_ok(),
            "stop_number=3 with 3 pages from 1 must succeed; got {result_exact:?}"
        );
    }
}
