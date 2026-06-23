//! Content-stream surgery: font-metric resolution and glyph-level editing tools.
//!
//! A page's font resources are resolved to `FontMetrics` so that each code unit
//! in a text operator can be mapped to an advance width. Those widths drive both
//! glyph-position enumeration (later tasks) and advance-preserving excision.
//!
//! Width values are stored in glyph-space thousandths, matching the PDF `/Widths`
//! unit. The caller divides by 1000 and multiplies by the font size (Tfs) to get
//! a text-space advance.

use std::collections::BTreeMap;

use lopdf::{Object, ObjectId};

use crate::redact::Rect;

// ── Font metrics ─────────────────────────────────────────────────────────────

/// Per-glyph advance widths and code-unit size for one font resource on a page.
///
/// Widths are in glyph-space thousandths (the PDF `/Widths` unit).
/// `bytes_per_code` is 1 for simple fonts and 2 for Type0 with Identity encoding.
#[derive(Debug, Clone)]
pub(crate) enum FontMetrics {
    Supported {
        bytes_per_code: usize,
        widths: BTreeMap<u32, f32>,
        default_width: f32,
    },
    Unsupported,
}

// ── Reference resolution ─────────────────────────────────────────────────────

/// Resolve an `Object` to the dictionary it represents, following at most one
/// indirect reference. Accepts `Dictionary`, `Stream` (via its dict), and
/// `Reference`. Returns `None` for any other variant or a broken reference.
pub(crate) fn resolve_dict<'a>(
    doc: &'a lopdf::Document,
    obj: &'a Object,
) -> Option<&'a lopdf::Dictionary> {
    match obj {
        Object::Dictionary(dict) => Some(dict),
        Object::Stream(stream) => Some(&stream.dict),
        Object::Reference(id) => match doc.get_object(*id).ok()? {
            Object::Dictionary(dict) => Some(dict),
            Object::Stream(stream) => Some(&stream.dict),
            _ => None,
        },
        _ => None,
    }
}

// ── Width array parsers ───────────────────────────────────────────────────────

/// Parse the `/W` array of a CIDFont descendant into a CID → width map.
///
/// The `/W` array mixes two forms:
///   - `c [w1 w2 …]`     — consecutive CIDs starting at `c` get individual widths
///   - `c_first c_last w` — every CID in [c_first, c_last] gets the same width
///
/// Any malformed entry is skipped rather than aborting the parse.
fn parse_cid_widths(width_array: &[Object]) -> BTreeMap<u32, f32> {
    let mut widths = BTreeMap::new();
    let mut index = 0;

    while index < width_array.len() {
        let first_cid = match integer_value(&width_array[index]) {
            Some(n) => n as u32,
            None => {
                index += 1;
                continue;
            }
        };
        index += 1;

        if index >= width_array.len() {
            break;
        }

        match &width_array[index] {
            Object::Array(individual_widths) => {
                // Form: c [w1 w2 …]
                for (offset, width_obj) in individual_widths.iter().enumerate() {
                    if let Some(width) = number_value(width_obj) {
                        widths.insert(first_cid + offset as u32, width);
                    }
                }
                index += 1;
            }
            _ => {
                // Form: c_first c_last w — need two more values
                let last_cid = match integer_value(&width_array[index]) {
                    Some(n) => n as u32,
                    None => {
                        index += 1;
                        continue;
                    }
                };
                index += 1;

                if index >= width_array.len() {
                    break;
                }

                let shared_width = match number_value(&width_array[index]) {
                    Some(w) => w,
                    None => {
                        index += 1;
                        continue;
                    }
                };
                index += 1;

                for cid in first_cid..=last_cid {
                    widths.insert(cid, shared_width);
                }
            }
        }
    }

    widths
}

/// Extract an integer value from an `Object::Integer` or `Object::Real`.
fn integer_value(obj: &Object) -> Option<i64> {
    match obj {
        Object::Integer(n) => Some(*n),
        Object::Real(r) => Some(*r as i64),
        _ => None,
    }
}

/// Extract a numeric value (as f32) from `Object::Integer` or `Object::Real`.
fn number_value(obj: &Object) -> Option<f32> {
    match obj {
        Object::Integer(n) => Some(*n as f32),
        Object::Real(r) => Some(*r),
        _ => None,
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Resolve every font resource on `page_id` to its `FontMetrics`.
///
/// Missing resources (broken references, empty font dicts) produce
/// `FontMetrics::Unsupported` for that resource name rather than an error,
/// so a partial result is always returned.
pub(crate) fn page_fonts(
    doc: &lopdf::Document,
    page_id: ObjectId,
) -> BTreeMap<Vec<u8>, FontMetrics> {
    let mut metrics = BTreeMap::new();

    let page_dict = match doc.get_dictionary(page_id).ok() {
        Some(dict) => dict,
        None => return metrics,
    };

    let resources_dict = match page_dict
        .get(b"Resources")
        .ok()
        .and_then(|obj| resolve_dict(doc, obj))
    {
        Some(dict) => dict,
        None => return metrics,
    };

    let font_dict = match resources_dict
        .get(b"Font")
        .ok()
        .and_then(|obj| resolve_dict(doc, obj))
    {
        Some(dict) => dict,
        None => return metrics,
    };

    for (name, font_obj) in font_dict.iter() {
        let font_metrics =
            match resolve_dict(doc, font_obj).and_then(|dict| resolve_font_metrics(doc, dict)) {
                Some(m) => m,
                None => FontMetrics::Unsupported,
            };
        metrics.insert(name.clone(), font_metrics);
    }

    metrics
}

/// Resolve a font dictionary to `FontMetrics`. Returns `None` to signal
/// `FontMetrics::Unsupported` for the caller to map.
fn resolve_font_metrics(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<FontMetrics> {
    let subtype = font_dict.get(b"Subtype").ok()?.as_name().ok()?;

    match subtype {
        b"Type1" | b"TrueType" | b"MMType1" => resolve_simple_font_metrics(doc, font_dict),
        b"Type0" => resolve_type0_font_metrics(doc, font_dict),
        // Type3 and all other subtypes are not supported.
        _ => None,
    }
}

/// Resolve metrics for a simple font (Type1, TrueType, MMType1).
/// `bytes_per_code` is always 1. Widths come from `/FirstChar` + `/Widths`.
/// `default_width` is read from `/FontDescriptor`'s `/MissingWidth`, else 0.
fn resolve_simple_font_metrics(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<FontMetrics> {
    let first_char = font_dict.get(b"FirstChar").ok().and_then(integer_value)? as u32;

    let width_objects = match font_dict.get(b"Widths").ok()? {
        Object::Array(arr) => arr,
        _ => return None,
    };

    let widths: BTreeMap<u32, f32> = width_objects
        .iter()
        .enumerate()
        .filter_map(|(offset, obj)| number_value(obj).map(|w| (first_char + offset as u32, w)))
        .collect();

    // `/MissingWidth` lives in the `/FontDescriptor` subdictionary.
    let default_width = font_dict
        .get(b"FontDescriptor")
        .ok()
        .and_then(|obj| resolve_dict(doc, obj))
        .and_then(|desc| desc.get(b"MissingWidth").ok())
        .and_then(number_value)
        .unwrap_or(0.0);

    Some(FontMetrics::Supported {
        bytes_per_code: 1,
        widths,
        default_width,
    })
}

/// Resolve metrics for a Type0 (composite) font.
/// Only Identity-H and Identity-V encodings are supported (`bytes_per_code = 2`).
/// Widths come from the first `/DescendantFonts` entry's `/W` array; default from `/DW`.
fn resolve_type0_font_metrics(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<FontMetrics> {
    // Only Identity-H / Identity-V encodings can be decoded with a fixed 2-byte code.
    let encoding = font_dict.get(b"Encoding").ok()?.as_name().ok()?;
    if encoding != b"Identity-H" && encoding != b"Identity-V" {
        return None;
    }

    // Resolve the first descendant CIDFont.
    let descendant_obj = font_dict.get(b"DescendantFonts").ok()?;
    let descendant_dict = match descendant_obj {
        Object::Array(arr) => arr.first().and_then(|obj| resolve_dict(doc, obj))?,
        other => resolve_dict(doc, other)?,
    };

    let default_width = descendant_dict
        .get(b"DW")
        .ok()
        .and_then(number_value)
        .unwrap_or(1000.0);

    let widths = descendant_dict
        .get(b"W")
        .ok()
        .and_then(|obj| match obj {
            Object::Array(arr) => Some(parse_cid_widths(arr)),
            _ => None,
        })
        .unwrap_or_default();

    Some(FontMetrics::Supported {
        bytes_per_code: 2,
        widths,
        default_width,
    })
}

// ── Placeholder stubs for interfaces produced by later tasks ─────────────────
// These are declared here so the module compiles and the cross-task interface
// references in the implementation plan can be checked. Each will be replaced
// by a full implementation in the corresponding later task.

/// A single glyph occurrence located within a content-stream text operator.
#[allow(dead_code)]
pub(crate) struct GlyphSlot {
    /// Index into `Content.operations`.
    pub op: usize,
    /// `Some(i)` for the i-th element of a TJ array; `None` for Tj / `'` / `"` operands.
    pub elem: Option<usize>,
    /// Byte offset of this code unit within the operand string bytes.
    pub byte_off: usize,
    /// Byte length of this code unit: 1 for simple fonts, 2 for Type0 Identity.
    pub byte_len: usize,
    /// Glyph code (character code for simple fonts, CID for Type0).
    pub code: u32,
    /// Display-point centre, x coordinate (bottom-left origin).
    pub cx: f32,
    /// Display-point centre, y coordinate (bottom-left origin).
    pub cy: f32,
    /// Active font resource name at the time this glyph was shown.
    pub font: Vec<u8>,
    /// Font size (Tfs) in effect.
    pub font_size: f32,
    /// Character spacing (Tc) in effect.
    pub char_spacing: f32,
    /// Word spacing (Tw) in effect.
    pub word_spacing: f32,
}

/// Walk the content stream and enumerate every glyph with its display-point
/// position and byte location within the operator stream.
///
/// Returns `Err(())` when the page uses a font or operator combination that
/// the walker cannot reconstruct — the caller should fall back to flattening.
#[allow(dead_code)]
pub(crate) fn enumerate_page_glyphs(
    _content: &lopdf::content::Content,
    _fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    _page_height_pt: f32,
) -> Result<Vec<GlyphSlot>, ()> {
    // Full implementation is Task 2.
    Err(())
}

/// Return the indices (into `slots`) of glyphs whose display-point centre falls
/// inside any of the given redaction rectangles.
#[allow(dead_code)]
pub(crate) fn mark_in_rects(slots: &[GlyphSlot], rects: &[Rect]) -> Vec<usize> {
    let _ = (slots, rects);
    Vec::new()
}

/// Rewrite the content stream to remove the marked glyphs, inserting
/// advance-preserving TJ adjustments so surrounding text does not reflow,
/// then append opaque redaction boxes for each rect.
#[allow(dead_code)]
pub(crate) fn apply_excision(
    _content: &mut lopdf::content::Content,
    _slots: &[GlyphSlot],
    _marked: &[usize],
    _rects: &[Rect],
) {
    // Full implementation is Task 3.
}

/// Attempt to build a surgically-edited content stream for one page.
///
/// Returns `None` when the page cannot be edited structurally (undecodable
/// content, unsupported font mix, round-trip mismatch). Returning `Some` does
/// not prove removal — an outcome gate in the caller confirms it.
#[allow(dead_code)]
pub(crate) fn try_build_surgery(
    _doc: &lopdf::Document,
    _page_id: ObjectId,
    _rects: &[Rect],
    _page_height_pt: f32,
) -> Option<Vec<u8>> {
    // Full implementation is Task 4.
    None
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    fn doc_with_font(font: lopdf::Dictionary) -> (Document, lopdf::ObjectId) {
        let mut d = Document::with_version("1.5");
        let fid = d.add_object(font);
        let fonts = dictionary! { "F0" => Object::Reference(fid) };
        let res = dictionary! { "Font" => fonts };
        let page = d.add_object(dictionary! { "Type" => "Page", "Resources" => res });
        (d, page)
    }

    #[test]
    fn simple_font_widths_by_code() {
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1",
            "FirstChar" => 65i64, "Widths" => vec![Object::Integer(500), Object::Integer(600)],
        };
        let (d, page) = doc_with_font(font);
        let fonts = page_fonts(&d, page);
        match fonts.get(b"F0".as_ref()).unwrap() {
            FontMetrics::Supported {
                bytes_per_code,
                widths,
                default_width,
            } => {
                assert_eq!(*bytes_per_code, 1);
                assert_eq!(widths.get(&65), Some(&500.0));
                assert_eq!(widths.get(&66), Some(&600.0));
                assert_eq!(*default_width, 0.0);
                assert_eq!(widths.get(&67), None);
            }
            _ => panic!("expected Supported"),
        }
    }

    #[test]
    fn type0_identity_widths_and_two_byte_codes() {
        // Descendant CIDFont with W = [1 [500 600]] and DW 1000.
        let mut d = Document::with_version("1.5");
        let desc = d.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "DW" => 1000i64,
            "W" => vec![Object::Integer(1), Object::Array(vec![Object::Integer(500), Object::Integer(600)])],
        });
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "Encoding" => "Identity-H",
            "DescendantFonts" => vec![Object::Reference(desc)],
        };
        let fid = d.add_object(font);
        let page = d.add_object(dictionary! {
            "Type" => "Page",
            "Resources" => dictionary! { "Font" => dictionary! { "F0" => Object::Reference(fid) } },
        });
        match page_fonts(&d, page).get(b"F0".as_ref()).unwrap() {
            FontMetrics::Supported {
                bytes_per_code,
                widths,
                default_width,
            } => {
                assert_eq!(*bytes_per_code, 2);
                assert_eq!(widths.get(&1), Some(&500.0));
                assert_eq!(widths.get(&2), Some(&600.0));
                assert_eq!(*default_width, 1000.0);
            }
            _ => panic!("expected Supported"),
        }
    }

    #[test]
    fn type0_nonidentity_encoding_is_unsupported() {
        let mut d = Document::with_version("1.5");
        let desc = d.add_object(dictionary! { "Type" => "Font", "Subtype" => "CIDFontType0" });
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "Encoding" => "GBK-EUC-H",
            "DescendantFonts" => vec![Object::Reference(desc)],
        };
        let fid = d.add_object(font);
        let page = d.add_object(dictionary! {
            "Type" => "Page",
            "Resources" => dictionary! { "Font" => dictionary! { "F0" => Object::Reference(fid) } },
        });
        assert!(matches!(
            page_fonts(&d, page).get(b"F0".as_ref()).unwrap(),
            FontMetrics::Unsupported
        ));
    }

    #[test]
    fn type3_is_unsupported() {
        let font = dictionary! { "Type" => "Font", "Subtype" => "Type3" };
        let (d, page) = doc_with_font(font);
        assert!(matches!(
            page_fonts(&d, page).get(b"F0".as_ref()).unwrap(),
            FontMetrics::Unsupported
        ));
    }
}
