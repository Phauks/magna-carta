// Bates numbering — additive overlay: the label model (formatting, glyph-width
// measurement, PDF literal escaping), rotation-aware per-page stamping (non-destructive
// resource merge + content append), and document/set continuous numbering.
// A Bates stamp is an ADDITIVE OVERLAY; it never removes or modifies existing page content.

use lopdf::{dictionary, Object};

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
///
/// Called by `stamp_document` to derive a per-page label from `BatesOptions` before
/// passing it to `stamp_page`.
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
// Per-page stamping — placement, resource merge, content append
// ---------------------------------------------------------------------------

/// The text matrix `Tm = [a b c d e f]` (text space → user space) that places an
/// upright Bates label at displayed bottom-left-frame origin `(dx, dy)` on a page
/// whose effective MediaBox is `[llx lly urx ury]` under normalized rotation `r`.
///
/// The linear part counter-rotates the glyphs so they read upright on the displayed
/// page; the translation maps the displayed origin back into unrotated user space.
/// `w = urx - llx` and `h = ury - lly` are the unrotated MediaBox dimensions.
fn text_matrix(rotation: i64, llx: f32, lly: f32, w: f32, h: f32, dx: f32, dy: f32) -> [f32; 6] {
    match rotation {
        90 => [0.0, 1.0, -1.0, 0.0, llx + h - dy, lly + dx],
        180 => [-1.0, 0.0, 0.0, -1.0, llx + w - dx, lly + h - dy],
        270 => [0.0, -1.0, 1.0, 0.0, llx + dy, lly + w - dx],
        // 0 and any unexpected value fall through to the unrotated frame.
        _ => [1.0, 0.0, 0.0, 1.0, llx + dx, lly + dy],
    }
}

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
/// /Helvetica >>` object already added to `doc`. `stamp_document` adds the object
/// once per document and passes its id to every call on that document, so the
/// document contains exactly one stamp font object shared by all stamped pages.
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
    let width = label_width_pt(label, size);

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
        text_matrix(rotation, llx, lly, page_width, page_height, dx, dy);

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
    let escaped = escape_pdf_literal(label);
    let stream_content = format!(
        "q BT /MagnaCartaBates {size:.2} Tf 0 g {tm_a:.4} {tm_b:.4} {tm_c:.4} {tm_d:.4} {tm_e:.4} {tm_f:.4} Tm ({escaped}) Tj ET Q"
    );
    let stamp_stream = lopdf::Stream::new(dictionary! {}, stream_content.into_bytes());
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
/// A single Helvetica font dictionary is added to the document and shared by every
/// stamped page (`/MagnaCartaBates`), so the document contains exactly one new font
/// object regardless of page count.
///
/// Page order is determined by the 1-based page numbers in `doc.get_pages()`, which
/// matches the reading order viewers present to users.
pub fn stamp_document(
    bytes: &[u8],
    opts: &BatesOptions,
    start: u64,
) -> Result<(Vec<u8>, BatesRange), BatesError> {
    let mut doc = lopdf::Document::load_mem(bytes).map_err(|_| BatesError::Parse)?;

    // Collect page ObjectIds in reading order (sorted by 1-based page number).
    let mut pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();
    if pages.is_empty() {
        return Err(BatesError::NoPages);
    }
    pages.sort_by_key(|(page_number, _)| *page_number);

    let page_count = pages.len();

    // Add the shared stamp font object once per document; every page references it.
    let font_id = doc.add_object(dictionary! {
        b"Type" => Object::Name(b"Font".to_vec()),
        b"Subtype" => Object::Name(b"Type1".to_vec()),
        b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
    });

    for (index, (_, page_id)) in pages.into_iter().enumerate() {
        let label = format_label(&opts.prefix, start + index as u64, opts.padding);
        stamp_page(&mut doc, page_id, font_id, &label, opts)?;
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| BatesError::Reassemble)?;

    let range = BatesRange {
        start,
        end: start + page_count as u64 - 1,
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
        // A multi-page stamped document must contain exactly one font object with
        // /BaseFont /Helvetica and /Subtype /Type1 added by stamping, and all stamped
        // pages must reference the same ObjectId under /MagnaCartaBates.
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
}
