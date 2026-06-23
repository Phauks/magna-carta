// Bates numbering — label model: formatting, glyph-width measurement, PDF literal escaping.
// A Bates stamp is an ADDITIVE OVERLAY; it never removes or modifies existing page content.
// Placement, resource merge, content append, and document/set stamping are built in later steps.

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
// Consumed by the document-level stamping entry point (built next), which derives a
// per-page label from BatesOptions before handing it to stamp_page.
#[allow(dead_code)]
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
/// page's effective resources with one new stamp font named `MagnaCartaBates`, so a
/// page that inherited its resources keeps every inherited entry.
///
/// Returns `BatesError::Parse` only when the page has no resolvable MediaBox.
// Consumed by the document- and set-level stamping entry points built in the next
// step; until that caller lands this seam has no in-crate use site. The annotation
// also keeps its placement/escape helpers (label_width_pt, text_matrix,
// escape_pdf_literal, helvetica_advance) live for the same reason.
#[allow(dead_code)]
pub(crate) fn stamp_page(
    doc: &mut lopdf::Document,
    page_id: lopdf::ObjectId,
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

    // Add the stamp font and reference it under a distinctive name that will not
    // clobber an existing /Font resource.
    let stamp_font_id = doc.add_object(dictionary! {
        b"Type" => Object::Name(b"Font".to_vec()),
        b"Subtype" => Object::Name(b"Type1".to_vec()),
        b"BaseFont" => Object::Name(b"Helvetica".to_vec()),
    });
    font_dict.set(b"MagnaCartaBates", Object::Reference(stamp_font_id));

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

        stamp_page(&mut doc, page_id, "SMITH-000001", &BatesOptions::default()).unwrap();

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
        stamp_page(&mut doc, page_id, label, &BatesOptions::default()).unwrap();

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
            stamp_page(&mut doc, page_id, label, &BatesOptions::default()).unwrap();

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
        stamp_page(&mut doc, page_id, label, &BatesOptions::default()).unwrap();

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
}
