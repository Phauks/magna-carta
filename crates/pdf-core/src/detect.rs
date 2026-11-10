//! The bad-redaction detector: geometric detectors over an observed page, plus
//! structural detectors over the object model, assembled into a ranked report.

use std::collections::BTreeSet;

use lopdf::{Object, ObjectId};

use crate::textpos::{CoverMark, GlyphMark, PageObservation};
use crate::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    CoveredText,
    InvisibleText,
    WhiteoutText,
    RemovableAnnotation,
    HiddenLayer,
    MetadataLeak,
    OrphanedText,
}

#[derive(Debug, Clone)]
pub struct Finding {
    pub category: Category,
    pub severity: Severity,
    pub page: Option<usize>,
    /// Page-space region in display points, bottom-left origin (the redaction `Rect` frame).
    pub region: Option<Rect>,
    pub recovered_text: String,
    pub detail: String,
}

/// Convert a kurbo device-space bbox (top-left origin) to a display-point rect
/// (bottom-left origin), matching `page_size`/the redaction `Rect`.
pub(crate) fn to_display_rect(kbox: kurbo::Rect, page_height_pt: f32) -> Rect {
    let h = page_height_pt as f64;
    Rect {
        x0: kbox.x0 as f32,
        y0: (h - kbox.y1) as f32,
        x1: kbox.x1 as f32,
        y1: (h - kbox.y0) as f32,
    }
}

const OPAQUE: u8 = 250;

fn color_matches(a: [u8; 4], b: [u8; 4]) -> bool {
    let close = |x: u8, y: u8| (x as i16 - y as i16).abs() <= 8;
    close(a[0], b[0]) && close(a[1], b[1]) && close(a[2], b[2])
}

/// True when a color is a near-light/background color (e.g. white-page concealment).
/// Whiteout concealment means text hidden by a light-colored fill matching the page
/// background — the glyph color and the cover color are both near-white.
fn is_light_color(rgba: [u8; 4]) -> bool {
    rgba[0] >= 200 && rgba[1] >= 200 && rgba[2] >= 200
}

/// The opaque cover (if any) painted after this glyph, over its center.
/// Selects the topmost (highest paint-order) qualifying cover, because that is
/// what the viewer actually sees — an earlier cover may be completely occluded
/// by a later one, and classifying by it would misidentify the concealment kind.
fn covering<'a>(glyph: &GlyphMark, covers: &'a [CoverMark]) -> Option<&'a CoverMark> {
    let center = glyph.bbox.center();
    covers
        .iter()
        .filter(|c| c.order > glyph.order && c.rgba[3] >= OPAQUE && c.bbox.contains(center))
        .max_by_key(|c| c.order)
}

pub(crate) fn page_geometric_findings(
    obs: &PageObservation,
    page: usize,
    claimed: &std::collections::BTreeSet<usize>,
) -> Vec<Finding> {
    // Group covered glyphs by the cover that hides them (identified by paint order).
    // This keeps the per-glyph detail for invisible text while producing one coherent
    // finding per cover region — so the recovered text reads as a contiguous run rather
    // than a series of single-character findings.
    use std::collections::BTreeMap;

    let mut findings = Vec::new();
    // (cover_order, is_whiteout) -> (accumulated_text, cover_bbox, first_glyph_bbox)
    let mut covered_groups: BTreeMap<(usize, bool), (String, kurbo::Rect, kurbo::Rect)> =
        BTreeMap::new();

    for (i, g) in obs.glyphs.iter().enumerate() {
        if g.text.trim().is_empty() {
            continue;
        }

        if g.invisible {
            // Invisible text is its own category and fires regardless of annotation claims.
            let region = Some(to_display_rect(g.bbox, obs.height_pt));
            findings.push(Finding {
                category: Category::InvisibleText,
                severity: Severity::High,
                page: Some(page),
                region,
                recovered_text: g.text.clone(),
                detail: "Text drawn in an invisible render mode but extractable.".into(),
            });
            continue;
        }

        if claimed.contains(&i) {
            // This glyph is already reported under a RemovableAnnotation; skip the
            // covered/whiteout determination to avoid double-reporting.
            continue;
        }

        if let Some(cover) = covering(g, &obs.covers) {
            // Same-color light cover (e.g. white text under a white fill) ⇒ whiteout
            // concealment; a differently-colored or dark opaque fill ⇒ covered text.
            let is_whiteout = color_matches(g.rgba, cover.rgba) && is_light_color(cover.rgba);
            let key = (cover.order, is_whiteout);
            let entry = covered_groups
                .entry(key)
                .or_insert_with(|| (String::new(), cover.bbox, g.bbox));
            entry.0.push_str(&g.text);
        }
    }

    for ((_, is_whiteout), (text, cover_bbox, _)) in covered_groups {
        let region = Some(to_display_rect(cover_bbox, obs.height_pt));
        if is_whiteout {
            findings.push(Finding {
                category: Category::WhiteoutText,
                severity: Severity::High,
                page: Some(page),
                region,
                recovered_text: text,
                detail: "Text painted the same color as the fill covering it.".into(),
            });
        } else {
            findings.push(Finding {
                category: Category::CoveredText,
                severity: Severity::Critical,
                page: Some(page),
                region,
                recovered_text: text,
                detail: "Extractable text sits under an opaque fill that hides it from view."
                    .into(),
            });
        }
    }

    findings
}

fn catalog_ref(doc: &lopdf::Document, key: &[u8]) -> Option<lopdf::ObjectId> {
    doc.catalog()
        .ok()
        .and_then(|c| c.get(key).ok())
        .and_then(|o| o.as_reference().ok())
}

fn push_metadata_finding(
    findings: &mut Vec<Finding>,
    text: String,
    detail: &str,
    needle_min_len: usize,
) {
    let text = text.trim().to_string();
    if text.len() >= needle_min_len {
        findings.push(Finding {
            category: Category::MetadataLeak,
            severity: Severity::Medium,
            page: None,
            region: None,
            recovered_text: text,
            detail: detail.into(),
        });
    }
}

fn object_strings(obj: &Object, out: &mut String) {
    match obj {
        Object::String(bytes, _) => {
            out.push_str(&String::from_utf8_lossy(bytes));
            out.push('\n');
        }
        Object::Array(items) => items.iter().for_each(|o| object_strings(o, out)),
        Object::Dictionary(d) => d.iter().for_each(|(_, o)| object_strings(o, out)),
        Object::Stream(s) => {
            if let Ok(decoded) = s.decompressed_content() {
                out.push_str(&String::from_utf8_lossy(&decoded));
                out.push('\n');
            } else {
                out.push_str(&String::from_utf8_lossy(&s.content));
                out.push('\n');
            }
        }
        _ => {}
    }
}

pub(crate) fn structural_findings(
    doc: &mut lopdf::Document,
    needle_min_len: usize,
) -> Vec<Finding> {
    let mut findings = Vec::new();

    // MetadataLeak — the Info dictionary's human-readable string values.
    let info_id = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok());
    if let Some(info_id) = info_id {
        if let Ok(info) = doc.get_object(info_id).and_then(|o| o.as_dict()) {
            let mut text = String::new();
            for (_, v) in info.iter() {
                object_strings(v, &mut text);
            }
            push_metadata_finding(
                &mut findings,
                text,
                "Document information dictionary carries identifying metadata.",
                needle_min_len,
            );
        }
    }

    // XMP metadata stream.
    if let Some(meta_id) = catalog_ref(doc, b"Metadata") {
        if let Ok(stream) = doc.get_object(meta_id).and_then(|o| o.as_stream()) {
            let text = stream
                .decompressed_content()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_else(|_| String::from_utf8_lossy(&stream.content).into_owned());
            push_metadata_finding(
                &mut findings,
                text,
                "XMP metadata stream carries identifying text.",
                needle_min_len,
            );
        }
    }

    // Bookmark (/Outlines) titles — walk the outline tree via /First and /Next.
    if let Some(outlines_id) = catalog_ref(doc, b"Outlines") {
        let mut titles = String::new();
        let mut stack = vec![outlines_id];
        let mut seen = std::collections::BTreeSet::new();
        while let Some(id) = stack.pop() {
            if !seen.insert(id) {
                continue;
            }
            if let Ok(item) = doc.get_object(id).and_then(|o| o.as_dict()) {
                if let Ok(title) = item.get(b"Title") {
                    object_strings(title, &mut titles);
                }
                for key in [b"First".as_slice(), b"Next".as_slice()] {
                    if let Some(next) = item.get(key).ok().and_then(|o| o.as_reference().ok()) {
                        stack.push(next);
                    }
                }
            }
        }
        push_metadata_finding(
            &mut findings,
            titles,
            "Bookmark titles carry identifying text.",
            needle_min_len,
        );
    }

    // AcroForm field values (/V).
    let mut values = String::new();
    for id in crate::scrub::collect_field_ids(doc) {
        if let Ok(field) = doc.get_object(id).and_then(|o| o.as_dict()) {
            if let Ok(value) = field.get(b"V") {
                object_strings(value, &mut values);
            }
        }
    }
    push_metadata_finding(
        &mut findings,
        values,
        "AcroForm field values carry entered data.",
        needle_min_len,
    );

    // OrphanedText — objects not reachable from the trailer that carry text.
    let reachable: std::collections::BTreeSet<ObjectId> =
        doc.traverse_objects(|_| {}).into_iter().collect();
    let orphan_ids: Vec<ObjectId> = doc
        .objects
        .keys()
        .copied()
        .filter(|id| !reachable.contains(id))
        .collect();
    for id in orphan_ids {
        if let Some(obj) = doc.objects.get(&id) {
            let mut text = String::new();
            object_strings(obj, &mut text);
            let text = text.trim().to_string();
            if text.len() >= needle_min_len {
                findings.push(Finding {
                    category: Category::OrphanedText,
                    severity: Severity::High,
                    page: None,
                    region: None,
                    recovered_text: text,
                    detail: "Text present in an object that no page references — recoverable from the file bytes.".into(),
                });
            }
        }
    }

    findings
}

/// Annotation subtypes that paint over page content (and can be deleted to
/// reveal it). `Redact` is the highest-signal: an unapplied redaction mark.
const OBSCURING_ANNOTATIONS: &[&[u8]] = &[
    b"Redact",
    b"Square",
    b"Circle",
    b"Polygon",
    b"FreeText",
    b"Stamp",
    b"Highlight",
    b"Ink",
];

fn page_annot_rects(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> Vec<Rect> {
    let mut rects = Vec::new();
    for entry in crate::annotations::page_annotation_entries(doc, page_id) {
        let Some(dict) = entry
            .as_reference()
            .ok()
            .and_then(|id| doc.get_object(id).ok())
            .and_then(|o| o.as_dict().ok())
        else {
            continue;
        };
        let obscuring = dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .map(|s| OBSCURING_ANNOTATIONS.contains(&s))
            .unwrap_or(false);
        if !obscuring {
            continue;
        }
        if let Some(rect) = crate::annotations::annotation_rect(dict) {
            rects.push(rect);
        }
    }
    rects
}

pub(crate) fn rect_contains(r: &Rect, x: f32, y: f32) -> bool {
    x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

/// Whether two axis-aligned rectangles overlap: neither is fully to the left, right,
/// above, or below the other. Corners are normalised first, so a rectangle given with
/// its corners in either order tests the same. Touching edges do not overlap — a
/// rectangle that merely abuts another shares no area with it.
pub(crate) fn rects_intersect(a: &Rect, b: &Rect) -> bool {
    let (ax0, ax1) = (a.x0.min(a.x1), a.x0.max(a.x1));
    let (ay0, ay1) = (a.y0.min(a.y1), a.y0.max(a.y1));
    let (bx0, bx1) = (b.x0.min(b.x1), b.x0.max(b.x1));
    let (by0, by1) = (b.y0.min(b.y1), b.y0.max(b.y1));
    !(bx1 <= ax0 || bx0 >= ax1 || by1 <= ay0 || by0 >= ay1)
}

pub(crate) fn annotation_findings(
    obs: &PageObservation,
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    page: usize,
) -> (Vec<Finding>, BTreeSet<usize>) {
    let rects = page_annot_rects(doc, page_id);
    let mut findings = Vec::new();
    let mut claimed = BTreeSet::new();
    for rect in &rects {
        let mut recovered = String::new();
        for (i, g) in obs.glyphs.iter().enumerate() {
            if g.invisible || g.text.trim().is_empty() {
                continue;
            }
            let display = to_display_rect(g.bbox, obs.height_pt);
            let cx = (display.x0 + display.x1) / 2.0;
            let cy = (display.y0 + display.y1) / 2.0;
            if rect_contains(rect, cx, cy) {
                recovered.push_str(&g.text);
                claimed.insert(i);
            }
        }
        if !recovered.is_empty() {
            findings.push(Finding {
                category: Category::RemovableAnnotation,
                severity: Severity::Critical,
                page: Some(page),
                region: Some(*rect),
                recovered_text: recovered,
                detail:
                    "Extractable text sits under an annotation that can be deleted to reveal it."
                        .into(),
            });
        }
    }
    (findings, claimed)
}

fn inactive_ocgs(doc: &lopdf::Document) -> Vec<lopdf::ObjectId> {
    doc.catalog()
        .ok()
        .and_then(|c| c.get(b"OCProperties").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|ocp| ocp.get(b"D").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"OFF").ok())
        .and_then(|o| o.as_array().ok())
        .map(|arr| arr.iter().filter_map(|o| o.as_reference().ok()).collect())
        .unwrap_or_default()
}

fn property_ocg(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    name: &[u8],
) -> Option<lopdf::ObjectId> {
    let page = doc.get_object(page_id).ok()?.as_dict().ok()?;
    let resources = crate::surgery::resolve_dict(doc, page.get(b"Resources").ok()?)?;
    let properties = crate::surgery::resolve_dict(doc, resources.get(b"Properties").ok()?)?;
    properties.get(name).ok()?.as_reference().ok()
}

pub(crate) fn hidden_layer_findings(doc: &lopdf::Document) -> Vec<Finding> {
    let off = inactive_ocgs(doc);
    if off.is_empty() {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for (page_number, page_id) in doc.get_pages() {
        let content = match doc.get_and_decode_page_content(page_id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let mut hidden_depth: u32 = 0;
        let mut recovered = String::new();
        for op in &content.operations {
            match op.operator.as_str() {
                "BDC" | "BMC" => {
                    // The /OC group is identified by a /Properties name here; an
                    // inline optional-content dictionary as the BDC operand is not
                    // resolved (a rare encoding) and is not flagged.
                    let is_hidden = op.operands.first().and_then(|o| o.as_name().ok())
                        == Some(b"OC")
                        && op
                            .operands
                            .get(1)
                            .and_then(|o| o.as_name().ok())
                            .and_then(|name| property_ocg(doc, page_id, name))
                            .map(|ocg| off.contains(&ocg))
                            .unwrap_or(false);
                    if is_hidden || hidden_depth > 0 {
                        hidden_depth += 1;
                    }
                }
                "EMC" => hidden_depth = hidden_depth.saturating_sub(1),
                "Tj" if hidden_depth > 0 => {
                    if let Some(s) = op.operands.first().and_then(|o| o.as_str().ok()) {
                        recovered.push_str(&String::from_utf8_lossy(s));
                    }
                }
                "TJ" if hidden_depth > 0 => {
                    if let Some(arr) = op.operands.first().and_then(|o| o.as_array().ok()) {
                        for item in arr {
                            if let Ok(s) = item.as_str() {
                                recovered.push_str(&String::from_utf8_lossy(s));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let recovered = recovered.trim().to_string();
        if !recovered.is_empty() {
            findings.push(Finding {
                category: Category::HiddenLayer,
                severity: Severity::High,
                page: Some((page_number - 1) as usize),
                region: None,
                recovered_text: recovered,
                detail: "Text drawn on an optional-content layer that the default view hides."
                    .into(),
            });
        }
    }
    findings
}

#[derive(Debug, Clone, Default)]
pub struct SeveritySummary {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

#[derive(Debug, Clone)]
pub struct DetectionReport {
    pub findings: Vec<Finding>,
    pub summary: SeveritySummary,
    pub pages_scanned: usize,
    pub glyphs_examined: usize,
    /// Page indices (0-based) that could not be examined (the renderer failed to
    /// interpret them). An empty `findings` list does NOT clear these pages.
    pub pages_unreadable: Vec<usize>,
}

#[derive(Debug)]
pub enum DetectError {
    Parse,
    /// The input exceeds the size cap or contains a decompression bomb.
    Rejected,
}

fn severity_rank(s: Severity) -> u8 {
    match s {
        Severity::Critical => 0,
        Severity::High => 1,
        Severity::Medium => 2,
        Severity::Low => 3,
        Severity::Info => 4,
    }
}

pub fn detect(bytes: Vec<u8>) -> Result<DetectionReport, DetectError> {
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| DetectError::Rejected)?;
    let pdf = hayro::hayro_syntax::Pdf::new(bytes.clone()).map_err(|_| DetectError::Parse)?;
    let page_count = pdf.pages().len();

    // Load the lopdf document once for the per-page annotation pass and the
    // hidden-layer pass (both read-only). structural_findings runs on a separate
    // pristine copy below — deliberately, not as an unmerged optimization: its
    // `traverse_objects` call takes `&mut`, so a shared copy could perturb the
    // read-only passes' view, and a separate copy also keeps finding emission order
    // stable.
    let lo = lopdf::Document::load_mem(&bytes).ok();
    let page_ids: std::collections::BTreeMap<usize, lopdf::ObjectId> = lo
        .as_ref()
        .map(|doc| {
            doc.get_pages()
                .into_iter()
                .map(|(n, id)| ((n - 1) as usize, id))
                .collect()
        })
        .unwrap_or_default();

    let mut findings = Vec::new();
    let mut glyphs_examined = 0;
    let mut pages_unreadable = Vec::new();
    for page in 0..page_count {
        match crate::textpos::observe_page(&pdf, page) {
            Some(obs) => {
                glyphs_examined += obs.glyphs.len();
                let (annot_findings, claimed) = match (lo.as_ref(), page_ids.get(&page)) {
                    (Some(doc), Some(&page_id)) => annotation_findings(&obs, doc, page_id, page),
                    _ => (Vec::new(), BTreeSet::new()),
                };
                findings.extend(annot_findings);
                findings.extend(page_geometric_findings(&obs, page, &claimed));
            }
            None => pages_unreadable.push(page),
        }
    }

    // Structural pass: runs on its own pristine mutable copy (see the load comment
    // above); the hidden-layer pass reuses the shared immutable reference.
    if let Some(doc) = lo.as_ref() {
        let mut doc_mut = lopdf::Document::load_mem(&bytes).unwrap_or_else(|_| doc.clone());
        findings.extend(structural_findings(&mut doc_mut, 3));
        findings.extend(hidden_layer_findings(doc));
    }

    findings.sort_by_key(|f| severity_rank(f.severity));

    let mut summary = SeveritySummary::default();
    for f in &findings {
        match f.severity {
            Severity::Critical => summary.critical += 1,
            Severity::High => summary.high += 1,
            Severity::Medium => summary.medium += 1,
            Severity::Low => summary.low += 1,
            Severity::Info => summary.info += 1,
        }
    }

    Ok(DetectionReport {
        findings,
        summary,
        pages_scanned: page_count,
        glyphs_examined,
        pages_unreadable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::textpos::{CoverMark, GlyphMark, PageObservation};

    #[test]
    fn detect_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(detect(big), Err(DetectError::Rejected)));
    }

    #[test]
    fn detect_flags_a_bad_redaction_and_recovers_text() {
        // hello.pdf with an opaque black box appended over the text — the classic failure.
        let mut doc = lopdf::Document::load_mem(&corpus_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let cover_id = doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::new(),
            b"q 0 0 0 rg 0 0 1000 1000 re f Q".to_vec(),
        ));
        let mut contents: Vec<lopdf::Object> =
            match doc.get_dictionary(page_id).unwrap().get(b"Contents") {
                Ok(lopdf::Object::Array(a)) => a.clone(),
                Ok(lopdf::Object::Reference(r)) => vec![lopdf::Object::Reference(*r)],
                _ => vec![],
            };
        contents.push(lopdf::Object::Reference(cover_id));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Contents", lopdf::Object::Array(contents));
        let mut bad = Vec::new();
        doc.save_to(&mut bad).unwrap();

        let report = detect(bad).expect("detect");
        let covered: Vec<_> = report
            .findings
            .iter()
            .filter(|f| matches!(f.category, Category::CoveredText))
            .collect();
        assert!(!covered.is_empty(), "expected covered-text findings");
        assert!(covered.iter().any(|f| f.recovered_text.contains("Hello")));
        assert!(report.findings.first().map(|f| f.severity).unwrap() == Severity::Critical);
        // ranked
    }

    #[test]
    fn detect_finds_nothing_in_a_properly_redacted_document() {
        // The reciprocal of the redaction gate: a flattened-image redaction has no
        // extractable text, so the detector must find zero covered/invisible/whiteout text.
        let regions = [crate::RedactionRegion {
            page: 0,
            rect: crate::Rect {
                x0: 0.0,
                y0: 0.0,
                x1: 1000.0,
                y1: 1000.0,
            },
            reason: None,
        }];
        let outcome = crate::redact(
            corpus_bytes(),
            &regions,
            &crate::RedactionOptions::default(),
        )
        .unwrap();
        let report = detect(outcome.pdf).expect("detect");
        let page_text: Vec<_> = report
            .findings
            .iter()
            .filter(|f| {
                matches!(
                    f.category,
                    Category::CoveredText | Category::InvisibleText | Category::WhiteoutText
                )
            })
            .collect();
        assert!(
            page_text.is_empty(),
            "a redacted document must yield no recoverable page text, got {page_text:?}"
        );
    }

    #[test]
    fn report_lists_no_unreadable_pages_for_a_normal_document() {
        let report = detect(corpus_bytes()).expect("detect");
        assert!(report.pages_unreadable.is_empty());
        assert_eq!(report.pages_scanned, 1);
    }

    fn corpus_bytes() -> Vec<u8> {
        include_bytes!("../tests/fixtures/hello.pdf").to_vec()
    }

    fn glyph(
        text: &str,
        x: f64,
        y: f64,
        order: usize,
        invisible: bool,
        rgba: [u8; 4],
    ) -> GlyphMark {
        GlyphMark {
            text: text.into(),
            bbox: kurbo::Rect::new(x, y, x + 5.0, y + 8.0),
            order,
            invisible,
            rgba,
            advance_span: None,
            baseline: y + 8.0,
        }
    }

    #[test]
    fn flags_covered_text_and_recovers_it() {
        let obs = PageObservation {
            glyphs: vec![
                glyph("S", 10.0, 10.0, 1, false, [0, 0, 0, 255]),
                glyph("X", 500.0, 500.0, 2, false, [0, 0, 0, 255]),
            ],
            // an opaque cover painted AFTER glyph "S", over its location
            covers: vec![CoverMark {
                bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0),
                order: 3,
                rgba: [0, 0, 0, 255],
                is_image: false,
            }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0, &BTreeSet::new());
        let covered: Vec<_> = findings
            .iter()
            .filter(|f| matches!(f.category, Category::CoveredText))
            .collect();
        assert_eq!(covered.len(), 1);
        assert_eq!(covered[0].recovered_text, "S");
        assert!(matches!(covered[0].severity, Severity::Critical));
        assert_eq!(covered[0].page, Some(0));
        // "X" is not under the cover → not flagged.
    }

    #[test]
    fn flags_invisible_text() {
        let obs = PageObservation {
            glyphs: vec![glyph("hidden", 10.0, 10.0, 1, true, [0, 0, 0, 255])],
            covers: vec![],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0, &BTreeSet::new());
        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::InvisibleText)
                    && f.recovered_text == "hidden")
        );
    }

    #[test]
    fn flags_whiteout_text_under_same_color_fill() {
        // White text (255,255,255) over a white opaque cover → same-color concealment.
        let obs = PageObservation {
            glyphs: vec![glyph("white", 10.0, 10.0, 1, false, [255, 255, 255, 255])],
            covers: vec![CoverMark {
                bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0),
                order: 2,
                rgba: [255, 255, 255, 255],
                is_image: false,
            }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0, &BTreeSet::new());
        assert!(findings
            .iter()
            .any(|f| matches!(f.category, Category::WhiteoutText) && f.recovered_text == "white"));
    }

    #[test]
    fn flags_all_metadata_sources_and_orphaned_text() {
        use lopdf::{Dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(catalog);
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![]));
        pages.set("Count", Object::Integer(0));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        doc.trailer.set("Root", Object::Reference(catalog_id));

        // Info dictionary with an author.
        let info_id = doc.add_object(Object::Dictionary({
            let mut d = Dictionary::new();
            d.set("Author", Object::string_literal("Privileged Author"));
            d
        }));
        doc.trailer.set("Info", Object::Reference(info_id));

        // XMP metadata stream with identifying content.
        let xmp_content =
            b"<xmpmeta><rdf:Description rdf:about=''>XMP Author Name</rdf:Description></xmpmeta>"
                .to_vec();
        let meta_stream_id = doc.add_object(Stream::new(Dictionary::new(), xmp_content));
        doc.catalog_mut()
            .unwrap()
            .set("Metadata", Object::Reference(meta_stream_id));

        // /Outlines tree: a root dict pointing via /First to a bookmark item with a /Title.
        let mut bookmark_item = Dictionary::new();
        bookmark_item.set("Title", Object::string_literal("Secret Bookmark"));
        let bookmark_item_id = doc.add_object(Object::Dictionary(bookmark_item));
        let mut outlines_root = Dictionary::new();
        outlines_root.set("Type", Object::Name(b"Outlines".to_vec()));
        outlines_root.set("First", Object::Reference(bookmark_item_id));
        let outlines_root_id = doc.add_object(Object::Dictionary(outlines_root));
        doc.catalog_mut()
            .unwrap()
            .set("Outlines", Object::Reference(outlines_root_id));

        // AcroForm with a field whose /V carries entered data.
        let mut field = Dictionary::new();
        field.set("T", Object::string_literal("secret_field"));
        field.set("V", Object::string_literal("Form Secret Value"));
        let field_id = doc.add_object(Object::Dictionary(field));
        let mut acroform = Dictionary::new();
        acroform.set("Fields", Object::Array(vec![Object::Reference(field_id)]));
        let acroform_id = doc.add_object(Object::Dictionary(acroform));
        doc.catalog_mut()
            .unwrap()
            .set("AcroForm", Object::Reference(acroform_id));

        // Orphaned text: a stream object referenced by nothing.
        doc.add_object(Stream::new(
            Dictionary::new(),
            b"(orphan secret) Tj".to_vec(),
        ));

        let findings = structural_findings(&mut doc, 3);

        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::MetadataLeak)
                    && f.recovered_text.contains("Privileged Author")),
            "expected Info-dict MetadataLeak finding"
        );
        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::MetadataLeak)
                    && f.recovered_text.contains("XMP Author Name")),
            "expected XMP MetadataLeak finding"
        );
        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::MetadataLeak)
                    && f.recovered_text.contains("Secret Bookmark")),
            "expected bookmark-title MetadataLeak finding"
        );
        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::MetadataLeak)
                    && f.recovered_text.contains("Form Secret Value")),
            "expected AcroForm-value MetadataLeak finding"
        );
        assert!(
            findings
                .iter()
                .any(|f| matches!(f.category, Category::OrphanedText)
                    && f.recovered_text.contains("orphan secret")),
            "expected OrphanedText finding"
        );
    }

    #[test]
    fn flags_text_hidden_in_an_inactive_optional_content_layer() {
        use lopdf::{dictionary, Dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let ocg_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"OCG".to_vec()),
            "Name" => Object::string_literal("Secret Layer"),
        });
        let content = b"/OC /MC0 BDC BT /F1 12 Tf 72 700 Td (hidden layer text) Tj ET EMC".to_vec();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
        let mut properties = Dictionary::new();
        properties.set("MC0", Object::Reference(ocg_id));
        let mut resources = Dictionary::new();
        resources.set("Properties", Object::Dictionary(properties));
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("Contents", Object::Reference(content_id));
        page.set("Resources", Object::Dictionary(resources));
        page.set(
            "MediaBox",
            Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
        );
        let page_id = doc.add_object(Object::Dictionary(page));
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let oc_properties = dictionary! {
            "OCGs" => Object::Array(vec![Object::Reference(ocg_id)]),
            "D" => Object::Dictionary(dictionary! {
                "OFF" => Object::Array(vec![Object::Reference(ocg_id)]),
                "ON" => Object::Array(vec![]),
            }),
        };
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
            "OCProperties" => Object::Dictionary(oc_properties),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));

        let findings = hidden_layer_findings(&doc);
        assert!(findings
            .iter()
            .any(|f| matches!(f.category, Category::HiddenLayer)
                && matches!(f.severity, Severity::High)
                && f.recovered_text.contains("hidden layer text")
                && f.page == Some(0)));
    }

    fn page_with_annot(subtype: &[u8]) -> (lopdf::Document, lopdf::ObjectId) {
        use lopdf::{dictionary, Dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), b"BT ET".to_vec()));
        let annot_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Annot".to_vec()),
            "Subtype" => Object::Name(subtype.to_vec()),
            "Rect" => Object::Array(vec![60.into(), 690.into(), 300.into(), 720.into()]),
        });
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("Contents", Object::Reference(content_id));
        page.set(
            "MediaBox",
            Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
        );
        page.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        let page_id = doc.add_object(Object::Dictionary(page));
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        (doc, page_id)
    }

    fn obs_with_glyph_at(
        text: &str,
        display_x: f64,
        display_y: f64,
        page_height: f32,
    ) -> PageObservation {
        // Place a glyph whose DISPLAY-point center is (display_x, display_y); textpos
        // stores device-space (top-left) bboxes, so invert the y-flip used by to_display_rect.
        let dev_y = page_height as f64 - display_y;
        PageObservation {
            glyphs: vec![GlyphMark {
                text: text.into(),
                bbox: kurbo::Rect::new(display_x - 2.0, dev_y - 2.0, display_x + 2.0, dev_y + 2.0),
                order: 1,
                invisible: false,
                rgba: [0, 0, 0, 255],
                advance_span: None,
                baseline: dev_y + 2.0,
            }],
            covers: vec![],
            width_pt: 612.0,
            height_pt: page_height,
        }
    }

    #[test]
    fn flags_text_under_an_obscuring_annotation_and_claims_the_glyph() {
        let (doc, page_id) = page_with_annot(b"Square");
        let obs = obs_with_glyph_at("confidential", 72.0, 700.0, 792.0); // inside [60,690,300,720]
        let (findings, claimed) = annotation_findings(&obs, &doc, page_id, 0);
        assert_eq!(findings.len(), 1);
        assert!(matches!(
            findings[0].category,
            Category::RemovableAnnotation
        ));
        assert!(matches!(findings[0].severity, Severity::Critical));
        assert!(findings[0].recovered_text.contains("confidential"));
        assert!(claimed.contains(&0));
    }

    #[test]
    fn ignores_a_benign_link_annotation() {
        let (doc, page_id) = page_with_annot(b"Link");
        let obs = obs_with_glyph_at("visible", 72.0, 700.0, 792.0);
        let (findings, claimed) = annotation_findings(&obs, &doc, page_id, 0);
        assert!(findings.is_empty());
        assert!(claimed.is_empty());
    }

    #[test]
    fn flags_hidden_layer_when_resources_is_an_indirect_reference() {
        // Same setup as the inline test above, but /Resources on the page is stored
        // as an indirect object reference — the common PDF producer pattern when a
        // Resources dictionary is shared across pages.  The fix to resolve_dict is
        // what makes this reachable; without it property_ocg returns None and the
        // hidden text is silently missed.
        use lopdf::{dictionary, Dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let ocg_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"OCG".to_vec()),
            "Name" => Object::string_literal("Secret Layer"),
        });
        let content =
            b"/OC /MC0 BDC BT /F1 12 Tf 72 700 Td (indirect resources hidden text) Tj ET EMC"
                .to_vec();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), content));

        // Store the Resources dictionary as an indirect object.
        let mut properties = Dictionary::new();
        properties.set("MC0", Object::Reference(ocg_id));
        let mut resources = Dictionary::new();
        resources.set("Properties", Object::Dictionary(properties));
        let resources_id = doc.add_object(Object::Dictionary(resources));

        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("Contents", Object::Reference(content_id));
        // /Resources is now an indirect reference, not an inline dictionary.
        page.set("Resources", Object::Reference(resources_id));
        page.set(
            "MediaBox",
            Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
        );
        let page_id = doc.add_object(Object::Dictionary(page));

        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));

        let oc_properties = dictionary! {
            "OCGs" => Object::Array(vec![Object::Reference(ocg_id)]),
            "D" => Object::Dictionary(dictionary! {
                "OFF" => Object::Array(vec![Object::Reference(ocg_id)]),
                "ON" => Object::Array(vec![]),
            }),
        };
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
            "OCProperties" => Object::Dictionary(oc_properties),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));

        let findings = hidden_layer_findings(&doc);
        assert!(
            findings.iter().any(|f| matches!(f.category, Category::HiddenLayer)
                && matches!(f.severity, Severity::High)
                && f.recovered_text.contains("indirect resources hidden text")
                && f.page == Some(0)),
            "expected HiddenLayer finding when /Resources is an indirect reference, got {findings:?}"
        );
    }

    #[test]
    fn text_under_an_annotation_is_reported_once_as_removable_annotation() {
        // hello.pdf with a Square annotation over the text region: the detector must
        // report RemovableAnnotation, not (also) CoveredText, for that text.
        use lopdf::dictionary;
        let mut doc = lopdf::Document::load_mem(&corpus_bytes()).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let annot_id = doc.add_object(dictionary! {
            "Type" => lopdf::Object::Name(b"Annot".to_vec()),
            "Subtype" => lopdf::Object::Name(b"Square".to_vec()),
            "Rect" => lopdf::Object::Array(vec![0.into(), 0.into(), 1000.into(), 1000.into()]),
        });
        let page = doc.get_dictionary_mut(page_id).unwrap();
        page.set(
            "Annots",
            lopdf::Object::Array(vec![lopdf::Object::Reference(annot_id)]),
        );
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();

        let report = detect(bytes).expect("detect");
        let removable = report
            .findings
            .iter()
            .filter(|f| matches!(f.category, Category::RemovableAnnotation))
            .count();
        let covered = report
            .findings
            .iter()
            .filter(|f| matches!(f.category, Category::CoveredText))
            .count();
        assert!(removable >= 1, "expected a RemovableAnnotation finding");
        assert_eq!(
            covered, 0,
            "covered text under the annotation must not be double-reported"
        );
    }
}
