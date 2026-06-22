//! The bad-redaction detector: geometric detectors over an observed page, plus
//! structural detectors over the object model, assembled into a ranked report.

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
#[allow(dead_code)]
fn to_display_rect(kbox: kurbo::Rect, page_height_pt: f32) -> Rect {
    let h = page_height_pt as f64;
    Rect {
        x0: kbox.x0 as f32,
        y0: (h - kbox.y1) as f32,
        x1: kbox.x1 as f32,
        y1: (h - kbox.y0) as f32,
    }
}

const OPAQUE: u8 = 250;

#[allow(dead_code)]
fn color_matches(a: [u8; 4], b: [u8; 4]) -> bool {
    let close = |x: u8, y: u8| (x as i16 - y as i16).abs() <= 8;
    close(a[0], b[0]) && close(a[1], b[1]) && close(a[2], b[2])
}

/// True when a color is a near-light/background color (e.g. white-page concealment).
/// Whiteout concealment means text hidden by a light-colored fill matching the page
/// background — the glyph color and the cover color are both near-white.
#[allow(dead_code)]
fn is_light_color(rgba: [u8; 4]) -> bool {
    rgba[0] >= 200 && rgba[1] >= 200 && rgba[2] >= 200
}

/// The opaque cover (if any) painted after this glyph, over its center.
/// Selects the topmost (highest paint-order) qualifying cover, because that is
/// what the viewer actually sees — an earlier cover may be completely occluded
/// by a later one, and classifying by it would misidentify the concealment kind.
#[allow(dead_code)]
fn covering<'a>(glyph: &GlyphMark, covers: &'a [CoverMark]) -> Option<&'a CoverMark> {
    let center = glyph.bbox.center();
    covers
        .iter()
        .filter(|c| c.order > glyph.order && c.rgba[3] >= OPAQUE && c.bbox.contains(center))
        .max_by_key(|c| c.order)
}

#[allow(dead_code)]
pub(crate) fn page_geometric_findings(obs: &PageObservation, page: usize) -> Vec<Finding> {
    let mut findings = Vec::new();
    for g in &obs.glyphs {
        if g.text.trim().is_empty() {
            continue;
        }
        let region = Some(to_display_rect(g.bbox, obs.height_pt));

        if g.invisible {
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
        if let Some(cover) = covering(g, &obs.covers) {
            // Same-color light cover (e.g. white text under a white fill) ⇒ whiteout
            // concealment; a differently-colored or dark opaque fill ⇒ covered text.
            if color_matches(g.rgba, cover.rgba) && is_light_color(cover.rgba) {
                findings.push(Finding {
                    category: Category::WhiteoutText,
                    severity: Severity::High,
                    page: Some(page),
                    region,
                    recovered_text: g.text.clone(),
                    detail: "Text painted the same color as the fill covering it.".into(),
                });
            } else {
                findings.push(Finding {
                    category: Category::CoveredText,
                    severity: Severity::Critical,
                    page: Some(page),
                    region,
                    recovered_text: g.text.clone(),
                    detail: "Extractable text sits under an opaque fill that hides it from view.".into(),
                });
            }
        }
    }
    findings
}

use lopdf::{Object, ObjectId};

#[allow(dead_code)]
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

#[allow(dead_code)]
pub(crate) fn structural_findings(doc: &mut lopdf::Document, needle_min_len: usize) -> Vec<Finding> {
    let mut findings = Vec::new();

    // MetadataLeak — the Info dictionary's human-readable string values.
    let info_id = doc.trailer.get(b"Info").ok().and_then(|o| o.as_reference().ok());
    if let Some(info_id) = info_id {
        if let Ok(info) = doc.get_object(info_id).and_then(|o| o.as_dict()) {
            let mut text = String::new();
            for (_, v) in info.iter() {
                object_strings(v, &mut text);
            }
            let text = text.trim().to_string();
            if text.len() >= needle_min_len {
                findings.push(Finding {
                    category: Category::MetadataLeak,
                    severity: Severity::Medium,
                    page: None,
                    region: None,
                    recovered_text: text,
                    detail: "Document information dictionary carries identifying metadata.".into(),
                });
            }
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::textpos::{CoverMark, GlyphMark, PageObservation};

    fn glyph(text: &str, x: f64, y: f64, order: usize, invisible: bool, rgba: [u8; 4]) -> GlyphMark {
        GlyphMark { text: text.into(), bbox: kurbo::Rect::new(x, y, x + 5.0, y + 8.0), order, invisible, rgba }
    }

    #[test]
    fn flags_covered_text_and_recovers_it() {
        let obs = PageObservation {
            glyphs: vec![glyph("S", 10.0, 10.0, 1, false, [0, 0, 0, 255]), glyph("X", 500.0, 500.0, 2, false, [0, 0, 0, 255])],
            // an opaque cover painted AFTER glyph "S", over its location
            covers: vec![CoverMark { bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0), order: 3, rgba: [0, 0, 0, 255] }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0);
        let covered: Vec<_> = findings.iter().filter(|f| matches!(f.category, Category::CoveredText)).collect();
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
        let findings = page_geometric_findings(&obs, 0);
        assert!(findings.iter().any(|f| matches!(f.category, Category::InvisibleText) && f.recovered_text == "hidden"));
    }

    #[test]
    fn flags_whiteout_text_under_same_color_fill() {
        // White text (255,255,255) over a white opaque cover → same-color concealment.
        let obs = PageObservation {
            glyphs: vec![glyph("white", 10.0, 10.0, 1, false, [255, 255, 255, 255])],
            covers: vec![CoverMark { bbox: kurbo::Rect::new(0.0, 0.0, 100.0, 100.0), order: 2, rgba: [255, 255, 255, 255] }],
            width_pt: 600.0,
            height_pt: 800.0,
        };
        let findings = page_geometric_findings(&obs, 0);
        assert!(findings.iter().any(|f| matches!(f.category, Category::WhiteoutText) && f.recovered_text == "white"));
    }

    #[test]
    fn flags_metadata_and_orphaned_text() {
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
        // Metadata leak: an Info dictionary with an author.
        let info_id = doc.add_object(Object::Dictionary({
            let mut d = Dictionary::new();
            d.set("Author", Object::string_literal("Privileged Author"));
            d
        }));
        doc.trailer.set("Info", Object::Reference(info_id));
        // Orphaned text: a stream object referenced by nothing.
        doc.add_object(Stream::new(Dictionary::new(), b"(orphan secret) Tj".to_vec()));

        let findings = structural_findings(&mut doc, 3);
        assert!(findings.iter().any(|f| matches!(f.category, Category::MetadataLeak)
            && f.recovered_text.contains("Privileged Author")));
        assert!(findings.iter().any(|f| matches!(f.category, Category::OrphanedText)
            && f.recovered_text.contains("orphan secret")));
    }
}
