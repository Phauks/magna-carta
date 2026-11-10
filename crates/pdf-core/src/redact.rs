//! Safe redaction: flatten each affected page to a black-boxed image and
//! verify (via text extraction) that no redacted text survives.

/// A rectangle in rendered-page display points, bottom-left origin
/// (the same space `page_size`/`render_page` use).
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// One region to redact on one page (0-based page index).
#[derive(Debug, Clone)]
pub struct RedactionRegion {
    pub page: usize,
    pub rect: Rect,
    pub reason: Option<String>,
}

/// How a page's content is removed.
///
/// `Flatten` rasterizes the page to an image, replacing all vectors and text
/// with pixels — the strongest guarantee. `Surgery` rewrites the content stream
/// to excise only the glyphs that fall inside the redaction rectangles, keeping
/// the remainder as live text; an outcome gate verifies each surgered page and
/// falls back to `Flatten` for any page that does not pass.
///
/// Neither route leaves the page's annotations over a redaction rectangle: an
/// annotation is not part of the content stream, and can hold a second copy of what
/// the rectangle covers. `Flatten` drops every annotation on the page it rasterizes;
/// `Surgery` drops those standing over a rectangle, and the markup thread bound to
/// them, keeping the rest of the page's annotations live.
#[derive(Debug, Clone, Copy, Default)]
pub enum RedactionMode {
    #[default]
    Flatten,
    Surgery,
}

/// Knobs for a redaction run.
#[derive(Debug, Clone)]
pub struct RedactionOptions {
    /// Raster resolution for the flattened pages. The legal-production standard is 300.
    pub dpi: f32,
    /// If supplied, the gate also asserts these strings are absent document-wide.
    pub redacted_text: Vec<String>,
    /// Which document-level surfaces to scrub. Defaults to all (sanitized-by-default).
    pub scrub: crate::ScrubOptions,
    /// How pages are redacted. Defaults to `Flatten`.
    pub mode: RedactionMode,
}

impl Default for RedactionOptions {
    fn default() -> Self {
        Self {
            dpi: 300.0,
            redacted_text: Vec::new(),
            scrub: crate::ScrubOptions::default(),
            mode: RedactionMode::Flatten,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RedactionReport {
    pub pages_redacted: Vec<usize>,
    pub region_count: usize,
    /// Pages redacted by content-stream surgery (text preserved outside the redaction rects).
    pub pages_surgered: Vec<usize>,
    /// Pages redacted by full-page raster flatten.
    pub pages_flattened: Vec<usize>,
}

#[derive(Debug)]
pub struct RedactionOutcome {
    pub pdf: Vec<u8>,
    pub report: RedactionReport,
}

/// What redaction can fail at. `GateFailed` means text survived — no PDF is emitted.
#[derive(Debug)]
pub enum RedactError {
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
    Parse,
    PageOutOfRange,
    Render,
    Reassemble,
    GateFailed {
        detail: String,
    },
}

use std::collections::{BTreeMap, BTreeSet};

use lopdf::{Dictionary, Object, ObjectId, Stream};

use crate::Document;

/// Annotation keys that bind one annotation to another: the popup window that displays a
/// markup annotation's text, the markup annotation a popup belongs to, and the annotation
/// a reply is in reply to. Each of the two annotations shows the same words, so removing
/// one without the other leaves the text in the file.
const ANNOTATION_THREAD_KEYS: &[&[u8]] = &[b"Popup", b"Parent", b"IRT"];

/// Replace each object with null, so nothing it carried survives in the file and every
/// stream only it referenced — an appearance stream, most of all — becomes unreferenced
/// for the caller's prune to drop.
///
/// Blanking rather than deleting outright is deliberate: an annotation can be referenced
/// from outside the page too (an AcroForm `/Fields` entry names a widget), and those
/// references then point at a well-formed nothing rather than at a missing object.
fn blank_objects(doc: &mut lopdf::Document, ids: &BTreeSet<ObjectId>) {
    for &id in ids {
        if doc.objects.contains_key(&id) {
            doc.objects.insert(id, Object::Null);
        }
    }
}

/// The annotations on `page_id` that a redaction covering `rects` must not leave behind.
///
/// A redaction rewrites what the page *draws*, and annotations are not part of that: a
/// sticky note's `/Contents`, a FreeText caption, a link's URI, and any of their
/// appearance streams sit beside the content stream and survive a rewrite of it
/// untouched — so the words a rectangle was drawn to remove can stay in the file, shown
/// by any viewer that draws annotations. Every annotation whose rectangle meets a
/// redaction rectangle therefore goes, and so does any annotation on the page bound to it
/// through the markup thread, which repeats its text.
///
/// An annotation whose `/Rect` cannot be read goes too: one that cannot be proven clear
/// of the rectangles is treated as inside them, the same way every other decision on this
/// path resolves an unknown against the document rather than against confidentiality.
fn annotations_over_rects(
    doc: &lopdf::Document,
    page_id: ObjectId,
    rects: &[Rect],
) -> BTreeSet<ObjectId> {
    let on_page: Vec<ObjectId> = crate::annotations::page_annotation_entries(doc, page_id)
        .iter()
        .filter_map(|entry| entry.as_reference().ok())
        .collect();
    let meets_rects = |id: ObjectId| match doc.get_dictionary(id) {
        Ok(dict) => match crate::annotations::annotation_rect(dict) {
            Some(rect) => rects
                .iter()
                .any(|r| crate::detect::rects_intersect(&rect, r)),
            None => true,
        },
        // A broken reference resolves to no annotation, so there is nothing to remove.
        Err(_) => false,
    };
    let mut doomed: BTreeSet<ObjectId> = on_page
        .iter()
        .copied()
        .filter(|&id| meets_rects(id))
        .collect();

    // Walk the markup thread until it stops growing. Only annotations listed on this page
    // join the set: a widget's `/Parent` is its form field, which other pages' widgets can
    // share, and blanking that would reach outside the page being redacted.
    let linked = |id: ObjectId| -> Vec<ObjectId> {
        let Ok(dict) = doc.get_dictionary(id) else {
            return Vec::new();
        };
        ANNOTATION_THREAD_KEYS
            .iter()
            .filter_map(|key| dict.get(key).ok()?.as_reference().ok())
            .collect()
    };
    loop {
        let mut grew = false;
        for &id in &on_page {
            let bound = linked(id).iter().any(|target| doomed.contains(target))
                || doomed
                    .iter()
                    .any(|&doomed_id| linked(doomed_id).contains(&id));
            if bound && doomed.insert(id) {
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }
    doomed
}

/// Remove from `page_id` the annotations a redaction covering `rects` must not leave
/// behind, blanking their objects so their appearance streams go with them.
fn purge_annotations_over_rects(doc: &mut lopdf::Document, page_id: ObjectId, rects: &[Rect]) {
    let entries = crate::annotations::page_annotation_entries(doc, page_id);
    if entries.is_empty() {
        return;
    }
    let doomed = annotations_over_rects(doc, page_id, rects);
    let mut survivors = Vec::with_capacity(entries.len());
    for entry in entries {
        let keep = match entry.as_reference() {
            Ok(id) => !doomed.contains(&id),
            // An annotation written straight into the array has no object of its own to
            // blank, so it is kept only when it is provably clear of the rectangles; the
            // rest of its bytes go with the array rewrite below.
            Err(_) => crate::surgery::resolve_dict(doc, &entry)
                .and_then(crate::annotations::annotation_rect)
                .map(|rect| {
                    !rects
                        .iter()
                        .any(|r| crate::detect::rects_intersect(&rect, r))
                })
                .unwrap_or(false),
        };
        if keep {
            survivors.push(entry);
        }
    }
    crate::annotations::set_page_annotations(doc, page_id, survivors);
    blank_objects(doc, &doomed);
}

/// Remove every annotation on `page_id`: the page is being replaced by pixels, so nothing
/// that sat beside its content stream may stay behind it.
fn purge_all_annotations(doc: &mut lopdf::Document, page_id: ObjectId) {
    let annotations: BTreeSet<ObjectId> = crate::annotations::page_annotation_entries(doc, page_id)
        .iter()
        .filter_map(|entry| entry.as_reference().ok())
        .collect();
    crate::annotations::set_page_annotations(doc, page_id, Vec::new());
    blank_objects(doc, &annotations);
}

pub(crate) fn reassemble_page(
    doc: &mut lopdf::Document,
    page_id: ObjectId,
    rgb: &[u8],
    px_w: u32,
    px_h: u32,
    page_w_pt: f32,
    page_h_pt: f32,
) -> Result<(), RedactError> {
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", Object::Name(b"XObject".to_vec()));
    img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    img_dict.set("Width", Object::Integer(px_w as i64));
    img_dict.set("Height", Object::Integer(px_h as i64));
    img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    img_dict.set("BitsPerComponent", Object::Integer(8));

    purge_all_annotations(doc, page_id);

    let mut img_stream = Stream::new(img_dict, rgb.to_vec());
    img_stream.compress().map_err(|_| RedactError::Reassemble)?; // FlateDecode (lossless)
    let img_id = doc.add_object(img_stream);

    // Draw the image across the full MediaBox.
    let content = format!("q {page_w_pt} 0 0 {page_h_pt} 0 0 cm /Im0 Do Q");
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));

    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", Object::Reference(img_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));

    // The page is rebuilt from the keys a picture of a page needs and nothing else. Keeping
    // the old dictionary and overwriting four entries left everything else it carried
    // pointing at the page as it was before: `/Thumb`, a small rendering of the unredacted
    // page; `/PieceInfo` and `/Metadata`, an authoring tool's private copy of its content;
    // `/B` and `/StructParents`, links into the article threads and the structure tree that
    // quote its text; `/AA`, actions; and `/CropBox` and its siblings, which are in the old
    // page's coordinates and would crop the new image wrongly. Dropping the keys is what
    // removes them: the objects they named become unreferenced and are pruned with the
    // original content streams.
    let page = doc
        .get_dictionary_mut(page_id)
        .map_err(|_| RedactError::Reassemble)?;
    let parent = page.get(b"Parent").ok().cloned();
    let mut rebuilt = Dictionary::new();
    rebuilt.set("Type", Object::Name(b"Page".to_vec()));
    if let Some(parent) = parent {
        rebuilt.set("Parent", parent);
    }
    rebuilt.set("Contents", Object::Reference(content_id));
    rebuilt.set("Resources", Object::Dictionary(resources));
    rebuilt.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(page_w_pt),
            Object::Real(page_h_pt),
        ]),
    );
    rebuilt.set("Rotate", Object::Integer(0));
    *page = rebuilt;
    Ok(())
}

pub(crate) fn render_redacted_page(
    doc: &Document,
    page: usize,
    rects: &[Rect],
    dpi: f32,
) -> Result<(Vec<u8>, u32, u32), RedactError> {
    let size = doc
        .page_size(page)
        .map_err(|_| RedactError::PageOutOfRange)?;
    let rendered = doc
        .render_page(page, dpi, false)
        .map_err(|_| RedactError::Render)?;
    let (w, h) = (rendered.width, rendered.height);
    let mut rgba = rendered.data; // RGBA8, row-major

    for r in rects {
        let (x0, y0, x1, y1) = rect_to_pixels(r, size.width_pt, size.height_pt, w, h);
        for y in y0..y1 {
            for x in x0..x1 {
                let i = ((y * w + x) * 4) as usize;
                rgba[i] = 0;
                rgba[i + 1] = 0;
                rgba[i + 2] = 0;
                rgba[i + 3] = 255;
            }
        }
    }

    // Composite over a white background and pack to RGB8 for a DeviceRGB image XObject.
    // The renderer returns straight RGBA8; pages with no background content are transparent
    // (alpha=0). Compositing alpha-over-white gives the correct white-page appearance and
    // ensures redaction boxes (alpha=255, RGB=0) stay fully black.
    let boxed = crate::RenderedPage {
        data: rgba,
        width: w,
        height: h,
        png: false,
    };
    let rgb = boxed.to_rgb_image().ok_or(RedactError::Render)?.into_raw();
    Ok((rgb, w, h))
}

fn match_in_bytes(bytes: &[u8], needles: &[String]) -> Option<String> {
    needles
        .iter()
        .find(|s| !s.is_empty() && bytes.windows(s.len()).any(|w| w == s.as_bytes()))
        .cloned()
}

fn match_in_object(obj: &Object, needles: &[String]) -> Option<String> {
    match obj {
        Object::String(bytes, _) => match_in_bytes(bytes, needles),
        Object::Name(bytes) => match_in_bytes(bytes, needles),
        Object::Array(items) => items.iter().find_map(|o| match_in_object(o, needles)),
        Object::Dictionary(dict) => dict.iter().find_map(|(_, o)| match_in_object(o, needles)),
        Object::Stream(stream) => {
            if let Some(hit) = stream
                .dict
                .iter()
                .find_map(|(_, o)| match_in_object(o, needles))
            {
                return Some(hit);
            }
            if let Some(hit) = match_in_bytes(&stream.content, needles) {
                return Some(hit);
            }
            if let Ok(decoded) = stream.decompressed_content() {
                if let Some(hit) = match_in_bytes(&decoded, needles) {
                    return Some(hit);
                }
            }
            None
        }
        _ => None,
    }
}

/// Scan the document's *logical* content — every decoded string/name and every
/// decompressed stream — for any supplied needle. Immune to how bytes are stored
/// (Flate, object streams, cross-reference streams). Returns the first survivor.
pub(crate) fn scan_logical_content(doc: &lopdf::Document, needles: &[String]) -> Option<String> {
    if needles.is_empty() {
        return None;
    }
    doc.trailer
        .iter()
        .find_map(|(_, o)| match_in_object(o, needles))
        .or_else(|| {
            doc.objects
                .values()
                .find_map(|o| match_in_object(o, needles))
        })
}

/// Return the first supplied string that still appears as raw bytes in the emitted
/// PDF. Pruning removes orphaned text objects; this catches any uncompressed
/// plaintext that nonetheless survived. Text rasterized into the (compressed) page
/// image is not plaintext and is intentionally not matched.
fn first_surviving_text(pdf: &[u8], redacted_text: &[String]) -> Option<String> {
    redacted_text
        .iter()
        .find(|s| !s.is_empty() && pdf.windows(s.len()).any(|w| w == s.as_bytes()))
        .cloned()
}

/// Whether an observed glyph is whitespace-only, and therefore not redactable
/// content the outcome gate should reject. Text that is entirely whitespace (a
/// space, tab, etc.) draws no ink and encodes nothing sensitive. Empty text is
/// deliberately excluded: a glyph with no ToUnicode mapping may be visible ink,
/// so it is treated as redactable and stays subject to the gate.
pub(crate) fn is_whitespace_glyph(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_whitespace())
}

pub(crate) fn verify_gate(
    doc: &lopdf::Document,
    flattened_pages_1based: &[u32],
    redacted_text: &[String],
) -> Result<(), RedactError> {
    // Structural: each flattened page must now be text-free (it is an image-only page).
    // Surgered pages retain live text intentionally and are not checked here.
    for &p in flattened_pages_1based {
        match doc.extract_text(&[p]) {
            Ok(text) => {
                if !text.trim().is_empty() {
                    return Err(RedactError::GateFailed {
                        detail: format!("page {p} still has extractable text"),
                    });
                }
            }
            // A reassembled page is image-only and extracts as Ok(""); an extraction
            // error here is anomalous, so refuse rather than assume the page is clean.
            Err(_) => {
                return Err(RedactError::GateFailed {
                    detail: format!("page {p} text extraction failed; cannot verify removal"),
                });
            }
        }
    }
    // Content: supplied strings must be absent document-wide.
    if !redacted_text.is_empty() {
        let all: Vec<u32> = doc.get_pages().keys().copied().collect();
        let whole = doc.extract_text(&all).unwrap_or_default();
        for s in redacted_text {
            if !s.is_empty() && whole.contains(s.as_str()) {
                return Err(RedactError::GateFailed {
                    detail: format!("redacted text still present: {s}"),
                });
            }
        }
    }
    if let Some(hit) = scan_logical_content(doc, redacted_text) {
        return Err(RedactError::GateFailed {
            detail: format!("redacted text present in document content: {hit}"),
        });
    }
    Ok(())
}

/// The surgery outcome gate for one candidate page: re-observe `probe` at `page` via
/// hayro and return true iff no non-whitespace glyph centre lands inside any rect and no
/// image cover intersects any rect. Extracted so both `redact` and `compare_surgery_paths`
/// share one gate.
pub(crate) fn surgery_candidate_passes_gate(
    probe: &hayro::hayro_syntax::Pdf,
    page: usize,
    rects: &[Rect],
) -> bool {
    let observation = crate::textpos::observe_page(probe, page);
    match observation {
        None => false, // Cannot observe page — conservatively fail the gate.
        Some(obs) => {
            let mut any_inside = false;
            'glyph_loop: for glyph in &obs.glyphs {
                // A whitespace-only glyph carries no redactable ink: a
                // surviving space is not sensitive text and must not fail
                // the gate (it would otherwise force an unnecessary raster
                // flatten of an otherwise text-preservable page). Glyphs
                // with empty text — no ToUnicode mapping, possibly visible
                // ink — are deliberately NOT skipped; they stay checked.
                if is_whitespace_glyph(&glyph.text) {
                    continue;
                }
                let display_rect = crate::detect::to_display_rect(glyph.bbox, obs.height_pt);
                let cx = (display_rect.x0 + display_rect.x1) / 2.0;
                let cy = (display_rect.y0 + display_rect.y1) / 2.0;
                for rect in rects {
                    if crate::detect::rect_contains(rect, cx, cy) {
                        any_inside = true;
                        break 'glyph_loop;
                    }
                }
            }

            // A surgery stream replaces targeted glyphs with a vector path fill
            // (`draw_path`, is_image=false).  An image XObject already present on
            // the page is emitted as `draw_image` (is_image=true).  If a raster
            // image cover intersects a redaction rectangle the vector box drawn by
            // surgery sits *on top of* the image but does not destroy its pixels;
            // the image is recoverable by removing the box.  Reject any such page
            // so it falls back to the full-raster flatten, which overwrites the
            // pixels entirely.
            //
            if !any_inside {
                'image_loop: for cover in &obs.covers {
                    if !cover.is_image {
                        continue;
                    }
                    let image_rect = crate::detect::to_display_rect(cover.bbox, obs.height_pt);
                    for rect in rects {
                        if crate::detect::rects_intersect(&image_rect, rect) {
                            any_inside = true;
                            break 'image_loop;
                        }
                    }
                }
            }

            !any_inside
        }
    }
}

/// How thick a straight line may be, in points, and still be read as a rule: an underline,
/// a table border, a form's box.
const RULE_THICKNESS: f32 = 2.0;

/// How many rules may cross one redaction rectangle before the page is flattened. A table
/// cell has four borders. A barcode is also thin straight lines, and it has dozens.
const MAXIMUM_RULES_UNDER_A_RECTANGLE: usize = 4;

/// Whether the page draws something under a rectangle that a black box laid over it would
/// hide and not remove.
///
/// Surgery takes the text out of a rectangle and draws a box. Whatever else the page drew
/// there is still in the file under the box, one deleted operator away. For most drawing
/// that matters: a signature, a diagram, a stamp, and text converted to outlines are all
/// paths. So a page with drawn content under a rectangle is flattened instead, which
/// replaces everything with pixels.
///
/// Three kinds of drawing say nothing a box does not already say, and are let through so
/// that an ordinary page keeps its selectable text: a straight-edged fill that covers the
/// whole rectangle (a page background, a shaded table cell), and up to
/// [`MAXIMUM_RULES_UNDER_A_RECTANGLE`] thin straight rules crossing it. Everything else,
/// including a shape this cannot classify, flattens.
pub(crate) fn draws_under_rectangles(
    source: &hayro::hayro_syntax::Pdf,
    page: usize,
    rects: &[Rect],
) -> bool {
    let Some(observation) = crate::textpos::observe_page_content(source, page) else {
        // A page that cannot be observed cannot be shown to be clear.
        return true;
    };
    for rect in rects {
        let (x0, x1) = (rect.x0.min(rect.x1), rect.x0.max(rect.x1));
        let (y0, y1) = (rect.y0.min(rect.y1), rect.y0.max(rect.y1));
        // Half a point in from each edge, so a border the rectangle merely touches is not
        // counted as under it. A rectangle thinner than that is tested as it stands.
        let inset = if x1 - x0 > 1.0 && y1 - y0 > 1.0 {
            0.5
        } else {
            0.0
        };
        let inner = Rect {
            x0: x0 + inset,
            y0: y0 + inset,
            x1: x1 - inset,
            y1: y1 - inset,
        };
        let mut rules = 0;
        for shape in &observation.shapes {
            let drawn = crate::detect::to_display_rect(shape.bbox, observation.height_pt);
            if !crate::detect::rects_intersect(&drawn, &inner) {
                continue;
            }
            if !shape.axis_aligned {
                return true;
            }
            let covers_it = drawn.x0 <= inner.x0
                && drawn.x1 >= inner.x1
                && drawn.y0 <= inner.y0
                && drawn.y1 >= inner.y1;
            if covers_it {
                continue;
            }
            let thickness = (drawn.x1 - drawn.x0).min(drawn.y1 - drawn.y0);
            if thickness > RULE_THICKNESS {
                return true;
            }
            rules += 1;
            if rules > MAXIMUM_RULES_UNDER_A_RECTANGLE {
                return true;
            }
        }
    }
    false
}

fn map_scrub_err(e: crate::ScrubError) -> RedactError {
    match e {
        crate::ScrubError::Rejected => RedactError::Rejected,
        crate::ScrubError::Parse => RedactError::Parse,
        crate::ScrubError::Reassemble => RedactError::Reassemble,
        crate::ScrubError::GateFailed { detail } => RedactError::GateFailed { detail },
    }
}

pub fn redact(
    bytes: Vec<u8>,
    regions: &[RedactionRegion],
    opts: &RedactionOptions,
) -> Result<RedactionOutcome, RedactError> {
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| RedactError::Rejected)?;
    // Group regions by 0-based page index.
    let mut by_page: BTreeMap<usize, Vec<Rect>> = BTreeMap::new();
    for region in regions {
        by_page.entry(region.page).or_default().push(region.rect);
    }

    let render_doc = Document::load_unguarded(bytes.clone()).map_err(|_| RedactError::Parse)?; // hayro, for rendering
    let mut lo = lopdf::Document::load_mem(&bytes).map_err(|_| RedactError::Parse)?;
    let pages = lo.get_pages(); // 1-based number -> ObjectId

    let mut all_affected: Vec<usize> = Vec::new();
    let mut flattened: Vec<usize> = Vec::new();

    // Surgery candidates: (0-based page index, page ObjectId, rects for that page).
    // Populated only in Surgery mode for pages where try_build_surgery returns Some.
    struct SurgeryCandidate {
        page: usize,
        page_id: lopdf::ObjectId,
        rects: Vec<Rect>,
    }
    let mut surgery_candidates: Vec<SurgeryCandidate> = Vec::new();

    for (&page, rects) in &by_page {
        let page_id = *pages
            .get(&((page + 1) as u32))
            .ok_or(RedactError::PageOutOfRange)?;
        all_affected.push(page);

        match opts.mode {
            RedactionMode::Flatten => {
                let size = render_doc
                    .page_size(page)
                    .map_err(|_| RedactError::PageOutOfRange)?;
                let (rgb, w, h) = render_redacted_page(&render_doc, page, rects, opts.dpi)?;
                reassemble_page(&mut lo, page_id, &rgb, w, h, size.width_pt, size.height_pt)?;
                flattened.push(page);
            }
            RedactionMode::Surgery => {
                // Asked of the page as it arrived, before surgery adds boxes of its own.
                let surgery = if draws_under_rectangles(&render_doc.pdf, page, rects) {
                    None
                } else {
                    crate::surgery::try_build_surgery(&lo, page_id, rects)
                };
                match surgery {
                    Some(stream_bytes) => {
                        // Install the surgery stream as the page's content.
                        let content_id = lo
                            .add_object(lopdf::Stream::new(lopdf::Dictionary::new(), stream_bytes));
                        let page_dict = lo
                            .get_dictionary_mut(page_id)
                            .map_err(|_| RedactError::Reassemble)?;
                        page_dict.set("Contents", lopdf::Object::Reference(content_id));
                        // The surgery stream is only the page's content. Annotations over
                        // the same region are a second copy of what the rectangles cover,
                        // and no rewrite of the content stream reaches them.
                        purge_annotations_over_rects(&mut lo, page_id, rects);
                        surgery_candidates.push(SurgeryCandidate {
                            page,
                            page_id,
                            rects: rects.clone(),
                        });
                    }
                    None => {
                        // Surgery cannot handle this page — fall through to flatten.
                        let size = render_doc
                            .page_size(page)
                            .map_err(|_| RedactError::PageOutOfRange)?;
                        let (rgb, w, h) = render_redacted_page(&render_doc, page, rects, opts.dpi)?;
                        reassemble_page(
                            &mut lo,
                            page_id,
                            &rgb,
                            w,
                            h,
                            size.width_pt,
                            size.height_pt,
                        )?;
                        flattened.push(page);
                    }
                }
            }
        }
    }

    // Outcome gate for surgery candidates: serialize a probe, reload it through
    // hayro, and verify that no glyph centre lands inside a redaction rectangle.
    // Any candidate that fails the gate is flattened from the original render_doc.
    let mut surgered: Vec<usize> = Vec::new();

    if !surgery_candidates.is_empty() {
        // Serialize a throwaway probe to test the surgery result.
        let mut probe = Vec::new();
        lo.save_to(&mut probe)
            .map_err(|_| RedactError::Reassemble)?;
        let probe_pdf = hayro::hayro_syntax::Pdf::new(probe).map_err(|_| RedactError::Parse)?;

        for candidate in surgery_candidates {
            // Two independent conditions, either of which sends the page to flatten: no
            // glyph or image the page draws may remain inside a rectangle, and no
            // annotation may still stand over one. The second is checked against the
            // model rather than the render because an annotation carries text a viewer
            // never draws — a note's body, a link's URI — which no observation can see.
            let passes_gate =
                surgery_candidate_passes_gate(&probe_pdf, candidate.page, &candidate.rects)
                    && annotations_over_rects(&lo, candidate.page_id, &candidate.rects).is_empty();

            if passes_gate {
                surgered.push(candidate.page);
            } else {
                // Gate failed — flatten this page from the original source.
                let size = render_doc
                    .page_size(candidate.page)
                    .map_err(|_| RedactError::PageOutOfRange)?;
                let (rgb, w, h) =
                    render_redacted_page(&render_doc, candidate.page, &candidate.rects, opts.dpi)?;
                reassemble_page(
                    &mut lo,
                    candidate.page_id,
                    &rgb,
                    w,
                    h,
                    size.width_pt,
                    size.height_pt,
                )?;
                flattened.push(candidate.page);
            }
        }
    }

    // Remove document-level surfaces where redacted content can hide (metadata,
    // attachments, form values, structure tree, outlines, optional-content),
    // then physically drop every now-unreferenced object — the original content
    // streams plus the scrubbed surfaces — so nothing survives in the output.
    crate::sanitize_document(&mut lo, &opts.scrub).map_err(map_scrub_err)?;
    lo.prune_objects();
    crate::verify_scrub_absence(&lo, &opts.scrub).map_err(map_scrub_err)?;

    // verify_gate checks the text-free assertion only for flattened pages (image-only).
    // Surgered pages legitimately retain text outside the redaction rects.
    let flattened_1based: Vec<u32> = flattened.iter().map(|p| (*p + 1) as u32).collect();
    verify_gate(&lo, &flattened_1based, &opts.redacted_text)?;

    let mut pdf = Vec::new();
    lo.save_to(&mut pdf).map_err(|_| RedactError::Reassemble)?;
    if let Some(surviving) = first_surviving_text(&pdf, &opts.redacted_text) {
        return Err(RedactError::GateFailed {
            detail: format!("redacted text present in output bytes: {surviving}"),
        });
    }

    surgered.sort_unstable();
    flattened.sort_unstable();
    all_affected.sort_unstable();

    Ok(RedactionOutcome {
        report: RedactionReport {
            pages_redacted: all_affected,
            region_count: regions.len(),
            pages_surgered: surgered,
            pages_flattened: flattened,
        },
        pdf,
    })
}

/// Map a display-point rect to a pixel rect on the rendered raster, applying the
/// y-flip (PDF y-up, bottom-left → image y-down, top-left), corner ordering, and clamping.
pub fn rect_to_pixels(
    r: &Rect,
    page_w_pt: f32,
    page_h_pt: f32,
    px_w: u32,
    px_h: u32,
) -> (u32, u32, u32, u32) {
    let sx = px_w as f32 / page_w_pt;
    let sy = px_h as f32 / page_h_pt;
    let clamp_x = |v: f32| v.clamp(0.0, px_w as f32);
    let clamp_y = |v: f32| v.clamp(0.0, px_h as f32);
    let x0 = clamp_x((r.x0.min(r.x1) * sx).floor()) as u32;
    let x1 = clamp_x((r.x0.max(r.x1) * sx).ceil()) as u32;
    // y-flip: a high PDF-y (near the top) is a low image row.
    let y0 = clamp_y(((page_h_pt - r.y0.max(r.y1)) * sy).floor()) as u32;
    let y1 = clamp_y(((page_h_pt - r.y0.min(r.y1)) * sy).ceil()) as u32;
    (x0, y0, x1, y1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_doc() -> crate::Document {
        crate::Document::load(include_bytes!("../tests/fixtures/blank.pdf").to_vec()).unwrap()
    }

    #[test]
    fn burns_an_opaque_black_box() {
        let doc = blank_doc();
        // 100x100 pt box near the bottom-left of a 612x792 page, at 72 dpi (1 px/pt).
        let rects = [Rect {
            x0: 100.0,
            y0: 100.0,
            x1: 200.0,
            y1: 200.0,
        }];
        let (rgb, w, h) = render_redacted_page(&doc, 0, &rects, 72.0).unwrap();
        assert_eq!((w, h), (612, 792));
        assert_eq!(rgb.len(), (w * h * 3) as usize);
        // A pixel inside the box is black; a corner pixel (outside) is not.
        let at = |x: u32, y: u32| {
            let i = ((y * w + x) * 3) as usize;
            (rgb[i], rgb[i + 1], rgb[i + 2])
        };
        // box pixel: x in [100,200], image-row in [792-200,792-100] = [592,692]
        assert_eq!(at(150, 640), (0, 0, 0));
        assert_ne!(at(5, 5), (0, 0, 0)); // blank page corner is white
    }

    #[test]
    fn maps_rect_with_y_flip() {
        // A 612x792 pt page rendered at 1 px/pt (px == pt for the math).
        // Rect at the page's bottom-left corner (PDF y-up) maps to the
        // raster's BOTTOM (image y-down).
        let r = Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 100.0,
            y1: 50.0,
        };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 612.0, 792.0, 612, 792);
        assert_eq!((x0, x1), (0, 100));
        // y-up [0,50] -> image rows [792-50, 792-0] = [742, 792]
        assert_eq!((y0, y1), (742, 792));
    }

    #[test]
    fn scales_by_resolution_and_orders_corners() {
        // 2 px/pt; corners given unordered.
        let r = Rect {
            x0: 100.0,
            y0: 100.0,
            x1: 50.0,
            y1: 50.0,
        };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 100.0, 100.0, 200, 200);
        assert_eq!((x0, x1), (100, 200)); // 50..100 pt * 2
        assert_eq!((y0, y1), (0, 100)); // y-up 50..100 -> top of a 200px raster
    }

    fn hello_bytes() -> Vec<u8> {
        include_bytes!("../tests/fixtures/hello.pdf").to_vec()
    }

    #[test]
    fn redact_removes_target_text_and_passes_gate() {
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            }, // cover the whole page
            reason: Some("PII".into()),
        }];
        let opts = RedactionOptions {
            dpi: 150.0,
            redacted_text: vec!["Hello".into()],
            scrub: crate::ScrubOptions::default(),
            mode: RedactionMode::Flatten,
        };
        let outcome = redact(hello_bytes(), &regions, &opts).expect("redaction succeeds");
        assert_eq!(outcome.report.pages_redacted, vec![0]);
        // the redacted text is gone from the emitted PDF
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        assert!(!reloaded
            .extract_text(&[1])
            .unwrap_or_default()
            .contains("Hello"));
    }

    #[test]
    fn whitespace_glyph_classification() {
        // Whitespace-only text is not redactable content: a surviving space must
        // not fail the outcome gate.
        assert!(is_whitespace_glyph(" "));
        assert!(is_whitespace_glyph("   "));
        assert!(is_whitespace_glyph("\t"));
        // U+00A0 non-breaking space is whitespace.
        assert!(is_whitespace_glyph("\u{00A0}"));
        // Visible ink is redactable and must still be gated.
        assert!(!is_whitespace_glyph("a"));
        assert!(!is_whitespace_glyph("A "));
        // Empty text (no ToUnicode) is conservatively treated as possible ink.
        assert!(!is_whitespace_glyph(""));
    }

    #[test]
    fn surgery_flattens_when_text_is_only_in_a_form_xobject() {
        // Move hello.pdf's page content into a Form XObject invoked by `Do`, so the
        // only page-0 text ("Hello") lives inside the XObject — which the content-
        // stream surgery walk does not recurse into. The outcome gate observes
        // rendered XObject text and must fall back to flatten rather than emit a page
        // that still visibly shows it. This guards the confidentiality invariant that
        // surgery's non-recursion into XObjects can never leak text past the gate.
        let mut doc = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = doc.get_page_content(page_id);
        let page_resources = doc
            .get_dictionary(page_id)
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .clone();

        // Form XObject reusing the page's own resources (fonts) and its content.
        let mut form_dict = Dictionary::new();
        form_dict.set("Type", Object::Name(b"XObject".to_vec()));
        form_dict.set("Subtype", Object::Name(b"Form".to_vec()));
        form_dict.set(
            "BBox",
            Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(612),
                Object::Integer(792),
            ]),
        );
        form_dict.set("Resources", page_resources);
        let form_id = doc.add_object(Stream::new(form_dict, content));

        // The page now holds ONLY a `Do` invoking the XObject; its resources point
        // at the form and no longer expose the fonts directly.
        let mut xobject_res = Dictionary::new();
        xobject_res.set("X0", Object::Reference(form_id));
        let mut new_res = Dictionary::new();
        new_res.set("XObject", Object::Dictionary(xobject_res));
        let do_id = doc.add_object(Stream::new(Dictionary::new(), b"q /X0 Do Q".to_vec()));
        {
            let page = doc.get_dictionary_mut(page_id).unwrap();
            page.set("Contents", Object::Reference(do_id));
            page.set("Resources", Object::Dictionary(new_res));
        }

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();

        let region = RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        };
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            dpi: 150.0,
            ..RedactionOptions::default()
        };
        let outcome = redact(bytes, std::slice::from_ref(&region), &opts).unwrap();
        assert!(
            outcome.report.pages_flattened.contains(&0),
            "text only inside a Form XObject must flatten, not surger"
        );
        assert!(!outcome.report.pages_surgered.contains(&0));
    }

    #[test]
    fn gate_fails_when_text_survives() {
        // The gate run against a doc that STILL has the text must fail — proving
        // the gate is not a no-op.
        let lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let result = verify_gate(&lo, &[1], &["Hello".into()]);
        assert!(matches!(result, Err(RedactError::GateFailed { .. })));
    }

    #[test]
    fn redact_purges_orphaned_text_bytes() {
        // The original page draws "(Hello World) Tj" in an UNCOMPRESSED content
        // stream, so the literal bytes are present in the input file. After
        // redaction the page is an image and the original stream is orphaned;
        // pruning must physically remove it, so the literal bytes must be GONE
        // from the emitted file — not merely unreachable via text extraction.
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let outcome = redact(hello_bytes(), &regions, &RedactionOptions::default()).unwrap();
        assert!(
            !outcome.pdf.windows(5).any(|w| w == b"Hello"),
            "orphaned original text bytes survived in the output"
        );
    }

    #[test]
    fn logical_scan_finds_string_in_a_compressed_stream() {
        // A string hidden in a Flate-compressed stream is invisible to a raw-byte
        // scan but must be found by the logical-content scan.
        // The payload is repeated so lopdf's size guard (compressed+19 < original) fires
        // and compression is actually applied.
        let mut doc = lopdf::Document::with_version("1.5");
        let content: Vec<u8> = b"top-secret-payload "
            .iter()
            .cycle()
            .take(200)
            .cloned()
            .collect();
        let mut stream = lopdf::Stream::new(lopdf::Dictionary::new(), content);
        stream.compress().unwrap(); // FlateDecode — bytes no longer literal
        let id = doc.add_object(stream);
        let _ = id;
        // The literal must NOT survive in the serialized bytes...
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert!(!bytes.windows(6).any(|w| w == b"secret"));
        // ...but the logical scan decompresses and finds it.
        assert_eq!(
            scan_logical_content(&doc, &["secret".to_string()]),
            Some("secret".to_string())
        );
        // A string that is absent returns None (the scan is not a no-op the other way).
        assert_eq!(scan_logical_content(&doc, &["absent".to_string()]), None);
        // Empty needles are ignored.
        assert_eq!(scan_logical_content(&doc, &[]), None);
    }

    #[test]
    fn redact_scrubs_metadata_by_default() {
        // The hello fixture, given an Info dictionary, must come back scrubbed after redaction.
        let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let info_id = lo.add_object(lopdf::Object::Dictionary({
            let mut d = lopdf::Dictionary::new();
            d.set("Author", lopdf::Object::string_literal("Jane Doe"));
            d
        }));
        lo.trailer.set("Info", lopdf::Object::Reference(info_id));
        let mut seeded = Vec::new();
        lo.save_to(&mut seeded).unwrap();

        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let outcome = redact(seeded, &regions, &RedactionOptions::default()).unwrap();

        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        assert!(!reloaded.trailer.has(b"Info"));
        assert!(!outcome.pdf.windows(8).any(|w| w == b"Jane Doe"));
    }

    #[test]
    fn output_byte_scan_detects_surviving_plaintext() {
        let pdf = b"prefix (Secret) Tj suffix".to_vec();
        assert_eq!(
            first_surviving_text(&pdf, &["Secret".into()]),
            Some("Secret".into())
        );
        assert_eq!(first_surviving_text(&pdf, &["Absent".into()]), None);
        // empty strings are ignored, never reported as surviving
        assert_eq!(first_surviving_text(&pdf, &[String::new()]), None);
        // first match wins when several survive
        assert_eq!(
            first_surviving_text(&pdf, &["Secret".into(), "suffix".into()]),
            Some("Secret".into())
        );
    }

    #[test]
    fn reassemble_removes_text_and_places_image() {
        let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        // sanity: the original page 1 has extractable text
        assert!(lo.extract_text(&[1]).unwrap_or_default().contains("Hello"));

        let page_id = *lo.get_pages().get(&1).unwrap();
        let rgb = vec![0u8; (10 * 10 * 3) as usize]; // a tiny dummy raster
        reassemble_page(&mut lo, page_id, &rgb, 10, 10, 200.0, 200.0).unwrap();

        let mut out = Vec::new();
        lo.save_to(&mut out).unwrap();
        let reloaded = lopdf::Document::load_mem(&out).unwrap();
        // the page is now an image — no extractable text survives
        assert!(reloaded
            .extract_text(&[1])
            .unwrap_or_default()
            .trim()
            .is_empty());
    }

    #[test]
    fn redact_strips_metadata_string_supplied_as_redacted_text() {
        // The sensitive string lives in the Info dictionary (a scrubbed surface) AND
        // is supplied as redacted_text. Scrub removes /Info; the logical-content gate
        // would catch it if it survived. Redaction must succeed and the string be gone.
        let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let info_id = lo.add_object(lopdf::Object::Dictionary({
            let mut d = lopdf::Dictionary::new();
            d.set(
                "Author",
                lopdf::Object::string_literal("Sensitive McSecret"),
            );
            d
        }));
        lo.trailer.set("Info", lopdf::Object::Reference(info_id));
        let mut seeded = Vec::new();
        lo.save_to(&mut seeded).unwrap();

        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            redacted_text: vec!["Sensitive McSecret".into()],
            ..RedactionOptions::default()
        };
        let outcome = redact(seeded, &regions, &opts).expect("redaction succeeds");
        assert!(!outcome.pdf.windows(9).any(|w| w == b"Sensitive"));
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        assert!(!reloaded.trailer.has(b"Info"));
    }

    fn surgery_simple_bytes() -> Vec<u8> {
        include_bytes!("../tests/fixtures/surgery_simple.pdf").to_vec()
    }

    #[test]
    fn surgery_mode_preserves_nontarget_text() {
        // Redact a tiny corner region where no text lives in surgery_simple.pdf.
        // If surgery succeeds the page lands in pages_surgered and still has extractable text.
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 195.0,
                y0: 45.0,
                x1: 200.0,
                y1: 50.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        let outcome =
            redact(surgery_simple_bytes(), &regions, &opts).expect("surgery redaction succeeds");
        if outcome.report.pages_surgered.contains(&0) {
            let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
            let text = reloaded.extract_text(&[1]).unwrap_or_default();
            assert!(
                !text.trim().is_empty(),
                "surgered page must still have extractable text"
            );
        }
        assert!(
            outcome.report.pages_surgered.contains(&0)
                || outcome.report.pages_flattened.contains(&0),
            "page 0 must appear in either pages_surgered or pages_flattened"
        );
    }

    #[test]
    fn surgery_mode_removes_target_text() {
        // Redact the full page to guarantee all text (including "Hello") is covered.
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 200.0,
                y1: 50.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            redacted_text: vec!["Hello".into()],
            ..RedactionOptions::default()
        };
        let outcome = redact(surgery_simple_bytes(), &regions, &opts)
            .expect("surgery redaction with Hello must succeed");
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        let text = reloaded.extract_text(&[1]).unwrap_or_default();
        assert!(
            !text.contains("Hello"),
            "target word Hello must be absent after surgery"
        );
        let detect_report = crate::detect(outcome.pdf).expect("detect must succeed");
        assert!(
            !detect_report
                .findings
                .iter()
                .any(|f| f.recovered_text.contains("Hello")),
            "detector must not find Hello in the surgered output"
        );
    }

    #[test]
    fn surgery_falls_back_to_flatten_for_rotated_page() {
        // A page with /Rotate 90 is genuinely unsupported by surgery: coordinate-frame
        // adjustment for non-zero rotation is not implemented in the content-stream walker,
        // so try_build_surgery returns None and the page falls back to flatten.
        // Build the test PDF programmatically: load hello.pdf and set /Rotate 90 on page 1.
        let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let page_id = *lo.get_pages().get(&1).unwrap();
        lo.get_dictionary_mut(page_id)
            .unwrap()
            .set("Rotate", lopdf::Object::Integer(90));
        let mut rotated_bytes = Vec::new();
        lo.save_to(&mut rotated_bytes).unwrap();

        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            redacted_text: vec!["Hello".into()],
            ..RedactionOptions::default()
        };
        let outcome = redact(rotated_bytes, &regions, &opts)
            .expect("fallback to flatten must succeed for a rotated page");
        assert!(
            outcome.report.pages_flattened.contains(&0),
            "rotated page must be in pages_flattened"
        );
        assert!(
            outcome.report.pages_surgered.is_empty(),
            "no pages should be surgered for a rotated page"
        );
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        assert!(
            !reloaded
                .extract_text(&[1])
                .unwrap_or_default()
                .contains("Hello"),
            "target text must be absent after fallback flatten"
        );
    }

    #[test]
    fn surgery_handles_standard_14_font_without_widths() {
        // hello.pdf uses Helvetica (a standard-14 font) with no embedded /Widths array.
        // After wiring the standard-font width resolver into surgery, the page can be
        // surgered rather than falling back to flatten.
        // Redact a full-page rect: the page must be in pages_surgered (not flattened),
        // and the target text must be gone from the output.
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            redacted_text: vec!["Hello".into()],
            ..RedactionOptions::default()
        };
        let outcome = redact(hello_bytes(), &regions, &opts)
            .expect("surgery on a standard-14 font page must succeed");
        assert!(
            outcome.report.pages_surgered.contains(&0),
            "hello.pdf page 0 must be in pages_surgered after standard-14 width support; \
             report: surgered={:?} flattened={:?}",
            outcome.report.pages_surgered,
            outcome.report.pages_flattened,
        );
        assert!(
            outcome.report.pages_flattened.is_empty(),
            "no pages should be flattened when standard-14 surgery succeeds"
        );
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        assert!(
            !reloaded
                .extract_text(&[1])
                .unwrap_or_default()
                .contains("Hello"),
            "target text must be absent after surgery"
        );
    }

    /// `hello.pdf` with a markup annotation added to page 1: its `/Contents` note, its
    /// popup's note, and its appearance stream each carry a distinct string, and its
    /// rectangle sits over `rect`. Nothing here is part of the page's content stream, so
    /// a content-stream rewrite leaves all of it untouched.
    fn hello_with_annotation_over(rect: [i64; 4]) -> Vec<u8> {
        let mut doc = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();

        // An appearance stream that draws a plain filled box — no glyphs, so the page
        // still qualifies for surgery and the leak is not masked by a flatten fallback.
        let mut appearance_dict = Dictionary::new();
        appearance_dict.set("Type", Object::Name(b"XObject".to_vec()));
        appearance_dict.set("Subtype", Object::Name(b"Form".to_vec()));
        appearance_dict.set(
            "BBox",
            Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(rect[2] - rect[0]),
                Object::Integer(rect[3] - rect[1]),
            ]),
        );
        let appearance_id = doc.add_object(Stream::new(
            appearance_dict,
            b"% AnnotationAppearanceSecret\n0 0 1 rg 0 0 4 4 re f".to_vec(),
        ));

        let popup_id = doc.add_object(Object::Dictionary({
            let mut popup = Dictionary::new();
            popup.set("Type", Object::Name(b"Annot".to_vec()));
            popup.set("Subtype", Object::Name(b"Popup".to_vec()));
            // Deliberately off to the side: the popup is bound to a doomed annotation,
            // not standing over the rectangle itself.
            popup.set(
                "Rect",
                Object::Array(vec![
                    Object::Integer(500),
                    Object::Integer(700),
                    Object::Integer(560),
                    Object::Integer(760),
                ]),
            );
            popup.set("P", Object::Reference(page_id));
            popup.set("Contents", Object::string_literal("AnnotationPopupSecret"));
            popup
        }));
        let annotation_id = doc.add_object(Object::Dictionary({
            let mut annotation = Dictionary::new();
            annotation.set("Type", Object::Name(b"Annot".to_vec()));
            annotation.set("Subtype", Object::Name(b"FreeText".to_vec()));
            annotation.set(
                "Rect",
                Object::Array(rect.iter().map(|&v| Object::Integer(v)).collect()),
            );
            annotation.set("P", Object::Reference(page_id));
            annotation.set(
                "Contents",
                Object::string_literal("AnnotationContentsSecret"),
            );
            annotation.set("Popup", Object::Reference(popup_id));
            annotation.set(
                "AP",
                Object::Dictionary({
                    let mut ap = Dictionary::new();
                    ap.set("N", Object::Reference(appearance_id));
                    ap
                }),
            );
            annotation
        }));
        doc.get_dictionary_mut(popup_id)
            .unwrap()
            .set("Parent", Object::Reference(annotation_id));
        doc.get_dictionary_mut(page_id).unwrap().set(
            "Annots",
            Object::Array(vec![
                Object::Reference(annotation_id),
                Object::Reference(popup_id),
            ]),
        );

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn surgery_removes_annotation_text_standing_over_a_redaction() {
        // Content-stream surgery rewrites what the page draws. An annotation is not in
        // that stream: its note, its popup's note, and its appearance stream all survive
        // the rewrite, so a page redacted this way could still carry the redacted words in
        // full, plainly readable in the bytes and shown by any viewer that draws
        // annotations. Redacting the region the annotation stands over must take it.
        let bytes = hello_with_annotation_over([0, 0, 200, 100]);
        assert!(
            contains(&bytes, b"AnnotationContentsSecret"),
            "fixture must actually carry the annotation text"
        );

        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        let outcome = redact(bytes, &regions, &opts).expect("surgery redaction succeeds");
        assert!(
            outcome.report.pages_surgered.contains(&0),
            "the page must be surgered, so the annotation path is what is under test; \
             report: surgered={:?} flattened={:?}",
            outcome.report.pages_surgered,
            outcome.report.pages_flattened,
        );
        for secret in [
            b"AnnotationContentsSecret".as_slice(),
            b"AnnotationPopupSecret",
            b"AnnotationAppearanceSecret",
        ] {
            assert!(
                !contains(&outcome.pdf, secret),
                "annotation content survived surgery redaction: {}",
                String::from_utf8_lossy(secret)
            );
        }
        // The page itself is still a live, text-preserving page.
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        let page_id = *reloaded.get_pages().get(&1).unwrap();
        assert!(crate::annotations::page_annotation_entries(&reloaded, page_id).is_empty());
    }

    #[test]
    fn surgery_keeps_annotations_clear_of_the_redaction() {
        // The removal is bounded by the rectangles: an annotation elsewhere on the page is
        // untouched, so a redaction does not quietly strip a document's whole markup.
        let bytes = hello_with_annotation_over([150, 150, 190, 190]);
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 40.0,
                y1: 40.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        let outcome = redact(bytes, &regions, &opts).expect("surgery redaction succeeds");
        assert!(outcome.report.pages_surgered.contains(&0));
        assert!(
            contains(&outcome.pdf, b"AnnotationContentsSecret"),
            "an annotation clear of every rectangle must be kept"
        );
    }

    #[test]
    fn flatten_removes_annotation_text_from_the_page_it_rasterizes() {
        // A rasterized page keeps nothing but pixels, and unlinking `/Annots` alone does
        // not achieve that: an annotation named from elsewhere in the file (an AcroForm
        // field entry) is still reachable, so pruning keeps it and its text.
        let bytes = hello_with_annotation_over([0, 0, 200, 100]);
        let mut doc = lopdf::Document::load_mem(&bytes).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let annotation = crate::annotations::page_annotation_entries(&doc, page_id)[0]
            .as_reference()
            .unwrap();
        let acroform_id = doc.add_object(Object::Dictionary({
            let mut acroform = Dictionary::new();
            acroform.set("Fields", Object::Array(vec![Object::Reference(annotation)]));
            acroform
        }));
        doc.catalog_mut()
            .unwrap()
            .set("AcroForm", Object::Reference(acroform_id));
        let mut seeded = Vec::new();
        doc.save_to(&mut seeded).unwrap();

        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let outcome = redact(seeded, &regions, &RedactionOptions::default()).unwrap();
        assert!(outcome.report.pages_flattened.contains(&0));
        assert!(
            !contains(&outcome.pdf, b"AnnotationContentsSecret"),
            "annotation content survived a flatten redaction"
        );
        assert!(!contains(&outcome.pdf, b"AnnotationAppearanceSecret"));
    }

    /// Build a minimal one-page PDF whose sole content is a raster image XObject that
    /// covers the full page.  Returns (bytes, page_width_pt, page_height_pt).
    fn image_only_pdf() -> Vec<u8> {
        use lopdf::{Dictionary, Document, Object, Stream};

        let mut doc = Document::with_version("1.5");

        // A 3×3 px DeviceRGB image — 27 bytes, trivially compressible.
        let pixel_data: Vec<u8> = vec![
            0xAB, 0x12, 0x34, // row 0
            0x56, 0x78, 0x9A, //
            0xBC, 0xDE, 0xF0, //
            0x11, 0x22, 0x33, // row 1
            0x44, 0x55, 0x66, //
            0x77, 0x88, 0x99, //
            0xAA, 0xBB, 0xCC, // row 2
            0xDD, 0xEE, 0xFF, //
            0x00, 0x0F, 0x1F, //
        ];
        let mut img_dict = Dictionary::new();
        img_dict.set("Type", Object::Name(b"XObject".to_vec()));
        img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
        img_dict.set("Width", Object::Integer(3));
        img_dict.set("Height", Object::Integer(3));
        img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        img_dict.set("BitsPerComponent", Object::Integer(8));
        let img_stream = Stream::new(img_dict, pixel_data);
        let img_id = doc.add_object(img_stream);

        // Content: scale-to-page cm, then /Im0 Do.
        // Page is 200×200 pt.
        let content_bytes = b"q 200 0 0 200 0 0 cm /Im0 Do Q".to_vec();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content_bytes));

        let mut xobjects = Dictionary::new();
        xobjects.set("Im0", Object::Reference(img_id));
        let mut resources = Dictionary::new();
        resources.set("XObject", Object::Dictionary(xobjects));

        // Pages node.
        let pages_id = doc.new_object_id();

        // Page dictionary.
        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set(
            "MediaBox",
            Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(200),
                Object::Integer(200),
            ]),
        );
        page_dict.set("Contents", Object::Reference(content_id));
        page_dict.set("Resources", Object::Dictionary(resources));
        let page_id = doc.add_object(Object::Dictionary(page_dict));

        // Pages node.
        let mut pages_dict = Dictionary::new();
        pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
        pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages_dict.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        // Catalog.
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));

        let mut out = Vec::new();
        doc.save_to(&mut out).expect("image_only_pdf serialize");
        out
    }

    #[test]
    fn surgery_falls_back_when_rect_overlaps_image() {
        // A page whose content is entirely a raster image XObject must never be
        // "surgered" — the surgery stream draws only a vector black box over the image,
        // but the underlying pixels remain recoverable by deleting that box.  The
        // outcome gate must detect the image-cover overlap and force a flatten instead.
        let bytes = image_only_pdf();
        let regions = [RedactionRegion {
            page: 0,
            // A rect that overlaps the centre of the 200×200 pt image.
            rect: Rect {
                x0: 50.0,
                y0: 50.0,
                x1: 150.0,
                y1: 150.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        let outcome = redact(bytes, &regions, &opts).expect("image-page surgery must not error");
        assert!(
            outcome.report.pages_flattened.contains(&0),
            "image-page must be in pages_flattened, not surgered; \
             report: surgered={:?} flattened={:?}",
            outcome.report.pages_surgered,
            outcome.report.pages_flattened,
        );
        assert!(
            !outcome.report.pages_surgered.contains(&0),
            "image-page must NOT be in pages_surgered"
        );
    }

    #[test]
    fn flatten_mode_unchanged() {
        // Default options (Flatten mode) must behave exactly as before.
        // pages_surgered must be empty; existing behavior preserved.
        let regions = [RedactionRegion {
            page: 0,
            rect: Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let opts = RedactionOptions {
            redacted_text: vec!["Hello".into()],
            ..RedactionOptions::default()
        };
        let outcome = redact(hello_bytes(), &regions, &opts).expect("flatten mode must succeed");
        assert!(
            outcome.report.pages_surgered.is_empty(),
            "Flatten mode must have empty pages_surgered"
        );
        assert!(
            outcome.report.pages_flattened.contains(&0),
            "page 0 must be in pages_flattened"
        );
        assert_eq!(outcome.report.pages_redacted, vec![0]);
    }

    /// `hello.pdf` with `operators` added to the end of its page's content.
    fn hello_with_drawing(operators: &str) -> Vec<u8> {
        let mut doc = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let mut content = doc.get_page_content(page_id);
        content.extend_from_slice(b"\n");
        content.extend_from_slice(operators.as_bytes());
        doc.change_page_content(page_id, content).unwrap();
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn surgery_report(bytes: Vec<u8>, rect: Rect) -> RedactionReport {
        let regions = [RedactionRegion {
            page: 0,
            rect,
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        redact(bytes, &regions, &opts)
            .expect("redaction succeeds")
            .report
    }

    const WHOLE_PAGE: Rect = Rect {
        x0: 0.0,
        y0: 0.0,
        x1: 1000.0,
        y1: 1000.0,
    };

    #[test]
    fn surgery_keeps_a_plain_page_as_text() {
        // The control for the tests below: with nothing drawn, this page is surgered.
        let report = surgery_report(hello_with_drawing(""), WHOLE_PAGE);
        assert_eq!(report.pages_surgered, vec![0]);
    }

    #[test]
    fn a_curve_under_a_redaction_flattens_the_page() {
        // A signature, a diagram and text converted to outlines are all curved paths. A
        // box drawn over one hides it and leaves it in the file.
        let report = surgery_report(
            hello_with_drawing("20 20 m 30 60 50 60 60 20 c S"),
            WHOLE_PAGE,
        );
        assert_eq!(report.pages_flattened, vec![0]);
        assert!(report.pages_surgered.is_empty());
    }

    #[test]
    fn the_flattened_page_no_longer_carries_the_drawing() {
        let bytes = hello_with_drawing("20 20 m 30 60 50 60 60 20 c S");
        let regions = [RedactionRegion {
            page: 0,
            rect: WHOLE_PAGE,
            reason: None,
        }];
        let opts = RedactionOptions {
            mode: RedactionMode::Surgery,
            ..RedactionOptions::default()
        };
        let outcome = redact(bytes, &regions, &opts).unwrap();
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        let page_id = *reloaded.get_pages().get(&1).unwrap();
        let content = reloaded.get_page_content(page_id);
        assert!(
            !contains(&content, b" c S"),
            "{}",
            String::from_utf8_lossy(&content)
        );
    }

    #[test]
    fn a_slanted_line_under_a_redaction_flattens_the_page() {
        let report = surgery_report(hello_with_drawing("2 w 20 20 m 80 70 l S"), WHOLE_PAGE);
        assert_eq!(report.pages_flattened, vec![0]);
    }

    #[test]
    fn a_block_partly_under_a_redaction_flattens_the_page() {
        // A filled block that does not cover the whole rectangle is a shape of its own: a
        // bar of a chart, a highlight over one word.
        let report = surgery_report(hello_with_drawing("0 0 1 rg 20 20 30 30 re f"), WHOLE_PAGE);
        assert_eq!(report.pages_flattened, vec![0]);
    }

    #[test]
    fn a_background_and_a_few_rules_do_not_cost_the_page_its_text() {
        // A fill that covers the rectangle entirely says nothing a black box does not, and
        // neither do the borders of a table cell.
        let report = surgery_report(
            hello_with_drawing(
                "1 1 0.9 rg -500 -500 3000 3000 re f \
                 0.5 w 10 30 m 190 30 l S 10 60 m 190 60 l S 40 10 m 40 90 l S",
            ),
            WHOLE_PAGE,
        );
        assert_eq!(report.pages_surgered, vec![0]);
    }

    #[test]
    fn many_thin_bars_under_a_redaction_flatten_the_page() {
        // Thin straight lines are also what a barcode is made of.
        let bars: String = (0..12)
            .map(|bar| format!("{} 20 1 40 re f ", 20 + bar * 3))
            .collect();
        let report = surgery_report(hello_with_drawing(&bars), WHOLE_PAGE);
        assert_eq!(report.pages_flattened, vec![0]);
    }

    #[test]
    fn a_drawing_clear_of_the_redaction_does_not_flatten_the_page() {
        let report = surgery_report(
            hello_with_drawing("150 20 m 160 60 170 60 180 20 c S"),
            Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 100.0,
                y1: 1000.0,
            },
        );
        assert_eq!(report.pages_surgered, vec![0]);
    }

    #[test]
    fn a_flattened_page_keeps_nothing_of_the_page_it_replaced() {
        // A thumbnail is a small rendering of the page as it was, and a producer's private
        // data can hold its text. Neither is content, so neither was replaced when only
        // the content was.
        let mut doc = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let thumbnail = doc.add_object(Stream::new(
            Dictionary::new(),
            b"ThumbnailOfTheUnredactedPage".to_vec(),
        ));
        let private = doc.add_object(Stream::new(
            Dictionary::new(),
            b"ProducerCopyOfTheUnredactedPage".to_vec(),
        ));
        let mut piece_info = Dictionary::new();
        piece_info.set("Producer", Object::Reference(private));
        let page = doc.get_dictionary_mut(page_id).unwrap();
        page.set("Thumb", Object::Reference(thumbnail));
        page.set("PieceInfo", Object::Dictionary(piece_info));
        page.set(
            "CropBox",
            Object::Array(vec![10.into(), 10.into(), 50.into(), 50.into()]),
        );
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert!(contains(&bytes, b"ThumbnailOfTheUnredactedPage"));

        let regions = [RedactionRegion {
            page: 0,
            rect: WHOLE_PAGE,
            reason: None,
        }];
        let outcome = redact(bytes, &regions, &RedactionOptions::default()).unwrap();
        assert!(!contains(&outcome.pdf, b"ThumbnailOfTheUnredactedPage"));
        assert!(!contains(&outcome.pdf, b"ProducerCopyOfTheUnredactedPage"));
        let reloaded = lopdf::Document::load_mem(&outcome.pdf).unwrap();
        let page_id = *reloaded.get_pages().get(&1).unwrap();
        let page = reloaded.get_dictionary(page_id).unwrap();
        let mut keys: Vec<String> = page
            .iter()
            .map(|(key, _)| String::from_utf8_lossy(key).to_string())
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "Contents",
                "MediaBox",
                "Parent",
                "Resources",
                "Rotate",
                "Type"
            ]
        );
    }

    #[test]
    fn redact_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            redact(big, &[], &RedactionOptions::default()),
            Err(RedactError::Rejected)
        ));
    }
}
