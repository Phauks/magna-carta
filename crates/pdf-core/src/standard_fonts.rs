//! Standard-14 PDF font advance-width resolver.
//!
//! The 14 fonts built in to every PDF viewer ship without an embedded `/Widths`
//! array. This module maps those font dictionaries to a per-code advance-width
//! table using the baked-in metrics in `standard_fonts_data`.
//!
//! Width values are in glyph-space thousandths (the PDF `/Widths` unit), as
//! `f32`. The caller divides by 1000 and multiplies by the font size to get a
//! text-space advance.

use std::collections::BTreeMap;

use lopdf::Object;

use crate::standard_fonts_data as data;

// ── Canonical-font selector ───────────────────────────────────────────────────

/// Which of the 14 canonical fonts a `/BaseFont` name resolved to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CanonicalFont {
    Helvetica,
    HelveticaBold,
    HelveticaOblique,
    HelveticaBoldOblique,
    TimesRoman,
    TimesBold,
    TimesItalic,
    TimesBoldItalic,
    Courier,
    CourierBold,
    CourierOblique,
    CourierBoldOblique,
    Symbol,
    ZapfDingbats,
}

impl CanonicalFont {
    /// The width slice for this font from `standard_fonts_data`.
    fn width_slice(self) -> &'static [(&'static str, i16)] {
        match self {
            Self::Helvetica => data::HELVETICA,
            Self::HelveticaBold => data::HELVETICA_BOLD,
            Self::HelveticaOblique => data::HELVETICA_OBLIQUE,
            Self::HelveticaBoldOblique => data::HELVETICA_BOLDOBLIQUE,
            Self::TimesRoman => data::TIMES_ROMAN,
            Self::TimesBold => data::TIMES_BOLD,
            Self::TimesItalic => data::TIMES_ITALIC,
            Self::TimesBoldItalic => data::TIMES_BOLDITALIC,
            Self::Courier => data::COURIER,
            Self::CourierBold => data::COURIER_BOLD,
            Self::CourierOblique => data::COURIER_OBLIQUE,
            Self::CourierBoldOblique => data::COURIER_BOLDOBLIQUE,
            Self::Symbol => data::SYMBOL,
            Self::ZapfDingbats => data::ZAPFDINGBATS,
        }
    }

    /// True for the two symbolic fonts whose encoding is never overridden by a
    /// `/Encoding` Name (only `/Differences` can adjust them).
    fn is_symbolic(self) -> bool {
        matches!(self, Self::Symbol | Self::ZapfDingbats)
    }
}

// ── Base-font normalization ───────────────────────────────────────────────────

/// Style flags detected from the normalized base-font name.
struct StyleFlags {
    bold: bool,
    italic_or_oblique: bool,
}

impl StyleFlags {
    fn from_name(name: &str) -> Self {
        let lower = name.to_lowercase();
        let bold = lower.contains("bold");
        let italic_or_oblique = lower.contains("italic") || lower.contains("oblique");
        StyleFlags {
            bold,
            italic_or_oblique,
        }
    }
}

/// Strip a six-uppercase-letter subset prefix (e.g. `ABCDEF+Helvetica` →
/// `Helvetica`) and the portion after the first comma, if present.
fn normalize_base_font(raw: &str) -> (&str, &str) {
    // Strip subset prefix: ^[A-Z]{6}\+
    let stripped = if raw.len() > 7
        && raw.as_bytes()[6] == b'+'
        && raw[..6].bytes().all(|b| b.is_ascii_uppercase())
    {
        &raw[7..]
    } else {
        raw
    };

    // Split on the first comma to separate the base name from an optional style suffix.
    match stripped.find(',') {
        Some(pos) => (&stripped[..pos], &stripped[pos + 1..]),
        None => (stripped, ""),
    }
}

/// Match a normalized base name (case-insensitive, ignoring `-` and spaces)
/// plus detected style flags to one of the 14 canonical fonts.
///
/// Returns `None` when the name is not recognized as a standard-14 font.
fn match_canonical(base: &str, style_suffix: &str) -> Option<CanonicalFont> {
    // Collapse separators and lowercase for matching.
    let collapsed: String = base
        .chars()
        .filter(|c| *c != '-' && *c != ' ')
        .map(|c| c.to_ascii_lowercase())
        .collect();

    // Collect style flags from both the base name and the comma suffix.
    let combined = format!("{} {}", base, style_suffix);
    let style = StyleFlags::from_name(&combined);

    match collapsed.as_str() {
        // ── Helvetica family (and Arial aliases) ──────────────────────────────
        "helvetica" | "arial" | "arialmt" => Some(match (style.bold, style.italic_or_oblique) {
            (true, true) => CanonicalFont::HelveticaBoldOblique,
            (true, false) => CanonicalFont::HelveticaBold,
            (false, true) => CanonicalFont::HelveticaOblique,
            (false, false) => CanonicalFont::Helvetica,
        }),
        "helveticabold" => Some(match style.italic_or_oblique {
            true => CanonicalFont::HelveticaBoldOblique,
            false => CanonicalFont::HelveticaBold,
        }),
        "helveticaoblique" | "helveticaitalic" => Some(match style.bold {
            true => CanonicalFont::HelveticaBoldOblique,
            false => CanonicalFont::HelveticaOblique,
        }),
        "helveticaboldoblique" | "helveticabolditalic" => Some(CanonicalFont::HelveticaBoldOblique),

        // ── Times family ──────────────────────────────────────────────────────
        "times" | "timesnewroman" | "timesnewromanpsmt" => {
            Some(match (style.bold, style.italic_or_oblique) {
                (true, true) => CanonicalFont::TimesBoldItalic,
                (true, false) => CanonicalFont::TimesBold,
                (false, true) => CanonicalFont::TimesItalic,
                (false, false) => CanonicalFont::TimesRoman,
            })
        }
        // "Times-Roman" collapses the dash → "timesroman"
        "timesroman" => Some(match (style.bold, style.italic_or_oblique) {
            (true, true) => CanonicalFont::TimesBoldItalic,
            (true, false) => CanonicalFont::TimesBold,
            (false, true) => CanonicalFont::TimesItalic,
            (false, false) => CanonicalFont::TimesRoman,
        }),
        "timesbold" => Some(match style.italic_or_oblique {
            true => CanonicalFont::TimesBoldItalic,
            false => CanonicalFont::TimesBold,
        }),
        "timesitalic" | "timesoblique" => Some(match style.bold {
            true => CanonicalFont::TimesBoldItalic,
            false => CanonicalFont::TimesItalic,
        }),
        "timesbolditalic" | "timesboldoblique" => Some(CanonicalFont::TimesBoldItalic),

        // ── Courier family ────────────────────────────────────────────────────
        "courier" | "couriernew" | "couriernewpsmt" => {
            Some(match (style.bold, style.italic_or_oblique) {
                (true, true) => CanonicalFont::CourierBoldOblique,
                (true, false) => CanonicalFont::CourierBold,
                (false, true) => CanonicalFont::CourierOblique,
                (false, false) => CanonicalFont::Courier,
            })
        }
        "courierbold" => Some(match style.italic_or_oblique {
            true => CanonicalFont::CourierBoldOblique,
            false => CanonicalFont::CourierBold,
        }),
        "courieroblique" | "courieritalic" => Some(match style.bold {
            true => CanonicalFont::CourierBoldOblique,
            false => CanonicalFont::CourierOblique,
        }),
        "courierboldoblique" | "courierbolditalic" => Some(CanonicalFont::CourierBoldOblique),

        // ── Symbolic fonts ────────────────────────────────────────────────────
        "symbol" => Some(CanonicalFont::Symbol),
        "zapfdingbats" | "dingbats" => Some(CanonicalFont::ZapfDingbats),

        _ => None,
    }
}

// ── Encoding resolution ───────────────────────────────────────────────────────

/// Resolve a reference-or-inline lopdf `Object` to the actual object, following
/// at most one indirect reference.
fn resolve_object<'a>(doc: &'a lopdf::Document, obj: &'a Object) -> &'a Object {
    match obj {
        Object::Reference(id) => doc.get_object(*id).unwrap_or(obj),
        other => other,
    }
}

/// The resolved encoding for a font: a base code-to-glyph-name table (baked
/// `&'static str` entries from the standard encoding arrays) plus an ordered
/// list of per-code overrides with owned `String` glyph names coming from the
/// PDF's `/Differences` array.
///
/// Using owned strings for differences means that any valid UTF-8 glyph name
/// supplied by the PDF is preserved without requiring it to appear in any static
/// table, eliminating the previous silent-drop when a name was absent from the
/// partial static lookup.
struct ResolvedEncoding {
    base: [&'static str; 256],
    differences: Vec<(u8, String)>,
}

impl ResolvedEncoding {
    /// Return the effective glyph name for `code` — the differences override if
    /// one exists, otherwise the base table entry.
    fn glyph_name_for(&self, code: u8) -> &str {
        for (diff_code, name) in &self.differences {
            if *diff_code == code {
                return name.as_str();
            }
        }
        self.base[code as usize]
    }
}

/// Build the code-to-glyph-name table from the font's `/Encoding` entry.
///
/// For symbolic fonts (`canonical.is_symbolic()`) the base table is always the
/// font's own encoding; `/Encoding` can only add `/Differences` on top.
///
/// For text fonts the `/Encoding` Name or dict selects a base encoding, and
/// `/Differences` patches it. Absent `/Encoding` defaults to Standard Encoding.
fn resolve_encoding(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
    canonical: CanonicalFont,
) -> ResolvedEncoding {
    if canonical.is_symbolic() {
        // Symbolic fonts: start from the font's own encoding table.
        let base = if canonical == CanonicalFont::Symbol {
            data::SYMBOL_ENCODING
        } else {
            data::ZAPF_DINGBATS_ENCODING
        };

        // Apply `/Differences` if the encoding entry is a dictionary that carries one.
        let differences = if let Ok(enc_obj) = font_dict.get(b"Encoding") {
            let resolved = resolve_object(doc, enc_obj);
            if let Object::Dictionary(enc_dict) = resolved {
                collect_differences(doc, enc_dict)
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        return ResolvedEncoding { base, differences };
    }

    // Text fonts: default base is Standard Encoding.
    match font_dict.get(b"Encoding").ok() {
        None => ResolvedEncoding {
            base: data::STANDARD_ENCODING,
            differences: Vec::new(),
        },
        Some(enc_obj) => {
            let resolved = resolve_object(doc, enc_obj);
            match resolved {
                Object::Name(name) => ResolvedEncoding {
                    base: encoding_table_for_name(name),
                    differences: Vec::new(),
                },
                Object::Dictionary(enc_dict) => {
                    // Base encoding from `/BaseEncoding`; default Standard.
                    let base = enc_dict
                        .get(b"BaseEncoding")
                        .ok()
                        .and_then(|obj| {
                            let resolved_base = resolve_object(doc, obj);
                            if let Object::Name(n) = resolved_base {
                                Some(encoding_table_for_name(n))
                            } else {
                                None
                            }
                        })
                        .unwrap_or(data::STANDARD_ENCODING);
                    let differences = collect_differences(doc, enc_dict);
                    ResolvedEncoding { base, differences }
                }
                _ => ResolvedEncoding {
                    base: data::STANDARD_ENCODING,
                    differences: Vec::new(),
                },
            }
        }
    }
}

/// Pick the standard encoding table for a Name object value.
fn encoding_table_for_name(name: &[u8]) -> [&'static str; 256] {
    match name {
        b"WinAnsiEncoding" => data::WIN_ANSI_ENCODING,
        b"MacRomanEncoding" => data::MAC_ROMAN_ENCODING,
        b"StandardEncoding" => data::STANDARD_ENCODING,
        _ => data::STANDARD_ENCODING,
    }
}

/// Walk the `/Differences` array of an encoding dictionary and collect the
/// per-code overrides as owned `(code, glyph_name)` pairs.
///
/// The array alternates between integers (new current code) and Names (glyph
/// names assigned to successive codes starting at the current code):
///   `[32 /space /exclam 65 /A /B]`
/// → code 32 → "space", 33 → "exclam", 65 → "A", 66 → "B".
///
/// Unknown entry types are skipped; invalid codes (> 255) are silently dropped.
/// Glyph names are stored as owned `String` values, so any name that is valid
/// UTF-8 is preserved exactly — regardless of whether it appears in any standard
/// encoding table or width slice.
fn collect_differences(doc: &lopdf::Document, enc_dict: &lopdf::Dictionary) -> Vec<(u8, String)> {
    let differences = match enc_dict.get(b"Differences").ok() {
        Some(obj) => {
            let resolved = resolve_object(doc, obj);
            match resolved {
                Object::Array(arr) => arr,
                _ => return Vec::new(),
            }
        }
        None => return Vec::new(),
    };

    let mut result: Vec<(u8, String)> = Vec::new();
    let mut current_code: usize = 0;

    for entry in differences.iter() {
        match entry {
            Object::Integer(n) => {
                current_code = *n as usize;
            }
            Object::Name(glyph_name_bytes) => {
                if current_code < 256 {
                    let name = String::from_utf8_lossy(glyph_name_bytes).into_owned();
                    result.push((current_code as u8, name));
                }
                current_code = current_code.saturating_add(1);
            }
            _ => {}
        }
    }

    result
}

// ── Width lookup ──────────────────────────────────────────────────────────────

/// Binary-search the width slice (sorted by glyph name) for `glyph_name`.
/// Returns the width as `f32` or `None` when not found.
fn lookup_width(slice: &[(&str, i16)], glyph_name: &str) -> Option<f32> {
    slice
        .binary_search_by_key(&glyph_name, |&(n, _)| n)
        .ok()
        .map(|pos| slice[pos].1 as f32)
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Resolve a standard-14 font dictionary to a per-code advance-width map.
///
/// Returns a `(widths, default_width)` pair where:
/// - `widths` maps code values `0..=255` to their advance width in glyph-space
///   thousandths (the PDF `/Widths` unit).
/// - `default_width` is `0.0` (standard-14 fonts do not carry `/MissingWidth`).
///
/// Returns `None` when `font_dict` does not carry a `/BaseFont` that resolves to
/// one of the 14 canonical PDF fonts. A recognized font with partially unmapped
/// codes still returns `Some`; the caller supplies `default_width` for any code
/// absent from the map.
pub(crate) fn standard_font_widths(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<(BTreeMap<u32, f32>, f32)> {
    // Step 1: read and normalize /BaseFont.
    let base_font_name_bytes = font_dict.get(b"BaseFont").ok()?.as_name().ok()?;
    let base_font_str = std::str::from_utf8(base_font_name_bytes).ok()?;
    let (base_name, style_suffix) = normalize_base_font(base_font_str);

    // Step 2: match to a canonical font.
    let canonical = match_canonical(base_name, style_suffix)?;

    // Step 3: resolve the encoding (code → glyph name).
    let encoding = resolve_encoding(doc, font_dict, canonical);

    // Step 4: build the code → width map.
    let width_slice = canonical.width_slice();
    let mut widths: BTreeMap<u32, f32> = BTreeMap::new();

    for code in 0u8..=255 {
        let glyph_name = encoding.glyph_name_for(code);
        if glyph_name.is_empty() {
            continue;
        }
        if let Some(width) = lookup_width(width_slice, glyph_name) {
            widths.insert(code as u32, width);
        }
    }

    Some((widths, 0.0))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    /// Build a minimal lopdf `Document` containing a single font object and
    /// return both the document and the font dictionary so tests can call
    /// `standard_font_widths` directly on the dictionary.
    fn doc_with_font_dict(font: lopdf::Dictionary) -> (Document, lopdf::Dictionary) {
        let mut doc = Document::with_version("1.5");
        doc.add_object(font.clone());
        (doc, font)
    }

    // ── Helvetica + WinAnsiEncoding ───────────────────────────────────────────

    #[test]
    fn helvetica_win_ansi_a_and_space() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, default_width) =
            standard_font_widths(&doc, &font_dict).expect("Helvetica should resolve");

        // WinAnsiEncoding: code 65 = 'A', code 32 = 'space'
        assert_eq!(widths.get(&65), Some(&667.0), "Helvetica 'A' width");
        assert_eq!(widths.get(&32), Some(&278.0), "Helvetica 'space' width");
        assert_eq!(default_width, 0.0);
    }

    // ── Helvetica with no /Encoding (defaults to Standard Encoding) ───────────

    #[test]
    fn helvetica_no_encoding_defaults_standard() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("Helvetica should resolve without explicit encoding");

        // Standard Encoding also maps code 65 → 'A'.
        assert_eq!(widths.get(&65), Some(&667.0), "Helvetica 'A' via Standard");
    }

    // ── Courier-Bold: every mapped code should be 600.0 ──────────────────────

    #[test]
    fn courier_bold_fixed_width() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier-Bold",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) =
            standard_font_widths(&doc, &font_dict).expect("Courier-Bold should resolve");

        // Courier-Bold is fixed-width; all glyphs are 600.
        for &width in widths.values() {
            assert_eq!(width, 600.0, "all Courier-Bold widths should be 600");
        }
        // At least some codes must be mapped.
        assert!(!widths.is_empty());
    }

    // ── Times-Roman + WinAnsi: 'A' → 722.0 ───────────────────────────────────

    #[test]
    fn times_roman_win_ansi_a() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Times-Roman",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) =
            standard_font_widths(&doc, &font_dict).expect("Times-Roman should resolve");

        assert_eq!(widths.get(&65), Some(&722.0), "Times-Roman 'A' width");
    }

    // ── Subset prefix stripped ────────────────────────────────────────────────

    #[test]
    fn subset_prefix_is_stripped() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "ABCDEF+Helvetica",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("subset-prefixed Helvetica should resolve");
        assert_eq!(widths.get(&65), Some(&667.0));
    }

    // ── Arial alias resolves to Helvetica ─────────────────────────────────────

    #[test]
    fn arial_alias_resolves_to_helvetica() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "TrueType",
            "BaseFont" => "Arial",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) =
            standard_font_widths(&doc, &font_dict).expect("Arial should resolve to Helvetica");
        assert_eq!(widths.get(&65), Some(&667.0), "Arial → Helvetica 'A'");
    }

    // ── Arial,Bold resolves to HelveticaBold ('A' → 722.0) ───────────────────

    #[test]
    fn arial_bold_comma_style() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "TrueType",
            "BaseFont" => "Arial,Bold",
            "Encoding" => "WinAnsiEncoding",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("Arial,Bold should resolve to HelveticaBold");
        assert_eq!(
            widths.get(&65),
            Some(&722.0),
            "Arial,Bold → HelveticaBold 'A'"
        );
    }

    // ── /Differences override ─────────────────────────────────────────────────

    #[test]
    fn differences_override_wins_over_base_encoding() {
        // Base = WinAnsiEncoding (code 65 → "A", width 667)
        // Differences: [65 /space] → code 65 → "space" (width 278)
        let mut doc = Document::with_version("1.5");
        let enc = doc.add_object(dictionary! {
            "Type" => "Encoding",
            "BaseEncoding" => "WinAnsiEncoding",
            "Differences" => vec![
                Object::Integer(65),
                Object::Name(b"space".to_vec()),
            ],
        });
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => Object::Reference(enc),
        };
        let font_id = doc.add_object(font.clone());
        // Re-retrieve so we have the dict.
        let font_dict = match doc.get_object(font_id).unwrap() {
            Object::Dictionary(d) => d.clone(),
            _ => panic!("expected dict"),
        };

        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("Helvetica with Differences should resolve");

        // Code 65 now maps to "space" (width 278), not "A" (width 667).
        assert_eq!(
            widths.get(&65),
            Some(&278.0),
            "/Differences [65 /space] should make code 65 = space width"
        );
    }

    // ── /Differences with a name absent from the standard encoding tables ────

    #[test]
    fn differences_resolves_name_absent_from_standard_encodings() {
        // Base = WinAnsiEncoding.  /Differences remaps code 65 to /Amacron.
        // "Amacron" is present in the HELVETICA width slice (667) but is NOT
        // listed in WIN_ANSI_ENCODING or STANDARD_ENCODING.  The correct width
        // must be returned regardless of whether the name appears in any
        // standard encoding table.
        let mut doc = Document::with_version("1.5");
        let enc = doc.add_object(dictionary! {
            "Type" => "Encoding",
            "BaseEncoding" => "WinAnsiEncoding",
            "Differences" => vec![
                Object::Integer(65),
                Object::Name(b"Amacron".to_vec()),
            ],
        });
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => Object::Reference(enc),
        };
        let font_id = doc.add_object(font.clone());
        let font_dict = match doc.get_object(font_id).unwrap() {
            Object::Dictionary(d) => d.clone(),
            _ => panic!("expected dict"),
        };

        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("Helvetica with Amacron difference should resolve");

        assert_eq!(
            widths.get(&65),
            Some(&667.0),
            "/Differences [65 /Amacron] should yield Helvetica Amacron width 667"
        );
    }

    // ── Times-Italic: /Differences with Amacron yields that font's width ─────

    #[test]
    fn differences_resolves_name_for_non_base_font_variant() {
        // Times-Italic has "Amacron" at width 611, which differs from Times-Roman
        // (722).  A /Differences entry naming /Amacron must resolve using the
        // active font's own width slice, not any other font's metrics.
        let mut doc = Document::with_version("1.5");
        let enc = doc.add_object(dictionary! {
            "Type" => "Encoding",
            "BaseEncoding" => "WinAnsiEncoding",
            "Differences" => vec![
                Object::Integer(65),
                Object::Name(b"Amacron".to_vec()),
            ],
        });
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Times-Italic",
            "Encoding" => Object::Reference(enc),
        };
        let font_id = doc.add_object(font.clone());
        let font_dict = match doc.get_object(font_id).unwrap() {
            Object::Dictionary(d) => d.clone(),
            _ => panic!("expected dict"),
        };

        let (widths, _) = standard_font_widths(&doc, &font_dict)
            .expect("Times-Italic with Amacron difference should resolve");

        assert_eq!(
            widths.get(&65),
            Some(&611.0),
            "/Differences [65 /Amacron] on Times-Italic should yield 611"
        );
    }

    // ── Unknown base font returns None ────────────────────────────────────────

    #[test]
    fn unknown_base_font_returns_none() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "FooBar",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        assert!(
            standard_font_widths(&doc, &font_dict).is_none(),
            "unrecognized font should return None"
        );
    }

    // ── Symbol font ───────────────────────────────────────────────────────────

    #[test]
    fn symbol_font_resolves_with_known_code() {
        let font = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Symbol",
        };
        let (doc, font_dict) = doc_with_font_dict(font);
        let result = standard_font_widths(&doc, &font_dict);

        assert!(result.is_some(), "Symbol should return Some");
        let (widths, _) = result.unwrap();

        // SYMBOL_ENCODING[32] = "space"; SYMBOL["space"] = 250.
        assert_eq!(
            widths.get(&32),
            Some(&250.0),
            "Symbol code 32 = space = 250"
        );
    }
}
