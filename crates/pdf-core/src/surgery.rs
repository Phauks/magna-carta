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
/// `/DescendantFonts` must be an array; a non-array value is malformed and returns
/// `Unsupported`. Widths come from the first entry's `/W` array; default from `/DW`.
fn resolve_type0_font_metrics(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<FontMetrics> {
    // Only Identity-H / Identity-V encodings can be decoded with a fixed 2-byte code.
    let encoding = font_dict.get(b"Encoding").ok()?.as_name().ok()?;
    if encoding != b"Identity-H" && encoding != b"Identity-V" {
        return None;
    }

    // Resolve the first descendant CIDFont. `/DescendantFonts` must be an array per
    // the PDF specification; any other form is malformed, so we return Unsupported.
    let descendant_obj = font_dict.get(b"DescendantFonts").ok()?;
    let descendant_dict = match descendant_obj {
        Object::Array(arr) => arr.first().and_then(|obj| resolve_dict(doc, obj))?,
        _ => return None,
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

    /// `/W` range form: `c_first c_last w` assigns one shared width to every CID in the range.
    /// Verify that CIDs inside the range get the shared width and one outside falls to
    /// `default_width` (DW).
    #[test]
    fn cid_width_range_form_assigns_shared_width() {
        // W = [10 20 750] — CIDs 10..=20 each get width 750.0.
        let mut d = Document::with_version("1.5");
        let desc = d.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "DW" => 500i64,
            "W" => vec![
                Object::Integer(10),
                Object::Integer(20),
                Object::Integer(750),
            ],
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
                widths,
                default_width,
                ..
            } => {
                // CIDs inside the range get the shared width.
                assert_eq!(widths.get(&10), Some(&750.0));
                assert_eq!(widths.get(&15), Some(&750.0));
                assert_eq!(widths.get(&20), Some(&750.0));
                // A CID outside the range falls back to DW.
                assert_eq!(widths.get(&21), None);
                assert!((*default_width - 500.0).abs() < f32::EPSILON);
            }
            _ => panic!("expected Supported"),
        }
    }

    /// A simple font whose `/Widths` key is absent must resolve to `FontMetrics::Unsupported`.
    /// The PDF spec requires `/Widths` for Type1/TrueType/MMType1 outside the standard 14;
    /// without it we cannot map code units to advance widths.
    #[test]
    fn simple_font_without_widths_is_unsupported() {
        // No `/Widths` key — only `/FirstChar` present.
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1",
            "FirstChar" => 65i64,
        };
        let (d, page) = doc_with_font(font);
        assert!(matches!(
            page_fonts(&d, page).get(b"F0".as_ref()).unwrap(),
            FontMetrics::Unsupported
        ));
    }

    /// A simple font whose `/FontDescriptor` carries `/MissingWidth` must use that value
    /// as `default_width` rather than falling back to 0.0.
    #[test]
    fn simple_font_missing_width_from_descriptor() {
        let mut d = Document::with_version("1.5");
        let descriptor = d.add_object(dictionary! {
            "Type" => "FontDescriptor",
            "FontName" => "TestFont",
            "MissingWidth" => 250i64,
        });
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "TrueType",
            "FirstChar" => 32i64,
            "Widths" => vec![Object::Integer(600)],
            "FontDescriptor" => Object::Reference(descriptor),
        };
        let fid = d.add_object(font);
        let fonts = dictionary! { "F0" => Object::Reference(fid) };
        let res = dictionary! { "Font" => fonts };
        let page = d.add_object(dictionary! { "Type" => "Page", "Resources" => res });
        match page_fonts(&d, page).get(b"F0".as_ref()).unwrap() {
            FontMetrics::Supported { default_width, .. } => {
                assert!((*default_width - 250.0).abs() < f32::EPSILON);
            }
            _ => panic!("expected Supported"),
        }
    }
}
