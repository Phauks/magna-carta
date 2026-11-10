//! Content-stream surgery: font-metric resolution and glyph-level editing tools.
//!
//! A page's font resources are resolved to `FontMetrics` so that each code unit
//! in a text operator can be mapped to an advance width. Those widths drive both
//! glyph-position enumeration (later tasks) and advance-preserving excision.
//!
//! Width values are stored in glyph-space thousandths, matching the PDF `/Widths`
//! unit. The caller divides by 1000 and multiplies by the font size (Tfs) to get
//! a text-space advance.

use std::collections::{BTreeMap, BTreeSet};

use kurbo::Affine;
use lopdf::{content::Content, Object, ObjectId};

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

/// Resolve an `Object` to the array it represents, whether it is stored inline
/// or behind an indirect reference. Writers are free to store any array either
/// way, so a caller that accepts only the inline form silently reads a
/// referenced `/Fields` or `/Kids` as empty.
pub(crate) fn resolve_array<'a>(
    doc: &'a lopdf::Document,
    obj: &'a Object,
) -> Option<&'a Vec<Object>> {
    match doc.dereference(obj).ok()?.1 {
        Object::Array(items) => Some(items),
        _ => None,
    }
}

/// Resolve an object through indirection, following reference chains to the
/// underlying direct object. A non-reference passes through unchanged; a
/// dangling reference yields `None`. Values like `/Widths` and `/FirstChar` are
/// routinely stored as indirect references, so callers that only accept a
/// concrete `Array`/number must resolve first or they misread the reference as
/// unsupported.
fn resolve_object<'a>(doc: &'a lopdf::Document, obj: &'a Object) -> Option<&'a Object> {
    doc.dereference(obj).ok().map(|(_, resolved)| resolved)
}

// ── Width array parsers ───────────────────────────────────────────────────────

/// The largest character identifier a width table may describe. Entries past it are
/// ignored rather than stored.
const MAX_CHARACTER_IDENTIFIER: u32 = 0xFFFF;

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
                    let Some(cid) = u32::try_from(offset)
                        .ok()
                        .and_then(|offset| first_cid.checked_add(offset))
                        .filter(|cid| *cid <= MAX_CHARACTER_IDENTIFIER)
                    else {
                        break;
                    };
                    if let Some(width) = number_value(width_obj) {
                        widths.insert(cid, width);
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

                // Both bounds come from the file. A character identifier is at most two
                // bytes in every encoding this module reads, so a range reaching past
                // 65,535 describes no glyph that can be shown, and looping over it as
                // declared lets one entry ask for billions of insertions.
                let last_cid = last_cid.min(MAX_CHARACTER_IDENTIFIER);
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

/// Walk up the page-tree parent chain to find the nearest `/Resources` dictionary.
///
/// The PDF specification makes `/Resources` inheritable: a page that does not
/// declare its own `/Resources` entry inherits from the nearest ancestor `/Pages`
/// node that does. This helper follows the `/Parent` reference chain until it
/// finds an object with a `/Resources` key, or exhausts the tree.
///
/// The walk is bounded to 64 iterations so a cyclic `/Parent` chain in malformed
/// input cannot loop forever.
pub(crate) fn resolve_inherited_resources(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
) -> Option<&lopdf::Dictionary> {
    let mut current_id = page_id;
    for _ in 0..64 {
        let dict = doc.get_dictionary(current_id).ok()?;
        if let Ok(resources_obj) = dict.get(b"Resources") {
            return resolve_dict(doc, resources_obj);
        }
        // No /Resources here; walk to parent.
        let parent_ref = dict.get(b"Parent").ok()?;
        match parent_ref {
            Object::Reference(id) => current_id = *id,
            _ => return None,
        }
    }
    // Depth limit reached — treat as unresolvable.
    None
}

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

    let resources_dict = match resolve_inherited_resources(doc, page_id) {
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
/// `bytes_per_code` is always 1. Widths come from `/FirstChar` + `/Widths` when
/// present; for standard-14 fonts that omit `/Widths`, the built-in advance-width
/// tables are consulted instead. `default_width` is read from `/FontDescriptor`'s
/// `/MissingWidth`, else 0.
fn resolve_simple_font_metrics(
    doc: &lopdf::Document,
    font_dict: &lopdf::Dictionary,
) -> Option<FontMetrics> {
    // When the font carries an explicit `/Widths` array, use it directly.
    // `/Widths` and `/FirstChar` (and each width element) are frequently stored
    // as indirect references — including on base-14-named fonts — so resolve
    // each through indirection before reading it. A present-but-indirect
    // `/Widths` read without dereferencing would look like a non-array and be
    // mistaken for an unsupported font. Standard-14 fonts omit `/Widths`; for
    // those, fall through to the standard_font_widths resolver below.
    if let Ok(widths_obj) = font_dict.get(b"Widths") {
        let first_char = font_dict
            .get(b"FirstChar")
            .ok()
            .and_then(|obj| resolve_object(doc, obj))
            .and_then(integer_value)? as u32;

        let width_objects = match resolve_object(doc, widths_obj)? {
            Object::Array(arr) => arr,
            _ => return None,
        };

        let widths: BTreeMap<u32, f32> = width_objects
            .iter()
            .enumerate()
            .filter_map(|(offset, obj)| {
                resolve_object(doc, obj)
                    .and_then(number_value)
                    .map(|w| (first_char + offset as u32, w))
            })
            .collect();

        // `/MissingWidth` lives in the `/FontDescriptor` subdictionary.
        let default_width = font_dict
            .get(b"FontDescriptor")
            .ok()
            .and_then(|obj| resolve_dict(doc, obj))
            .and_then(|desc| desc.get(b"MissingWidth").ok())
            .and_then(number_value)
            .unwrap_or(0.0);

        return Some(FontMetrics::Supported {
            bytes_per_code: 1,
            widths,
            default_width,
        });
    }

    // No `/Widths` array: check whether this is a standard-14 font whose
    // metrics can be resolved from the built-in advance-width tables.
    crate::standard_fonts::standard_font_widths(doc, font_dict).map(|(widths, default_width)| {
        FontMetrics::Supported {
            bytes_per_code: 1,
            widths,
            default_width,
        }
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

// ── Glyph slot ────────────────────────────────────────────────────────────────

/// The position and identity of a single decoded glyph from a page's content stream.
///
/// Coordinates `cx`/`cy` are in display points (bottom-left origin, same frame as
/// `Rect`). They approximate the glyph's visual centre, which is sufficient for
/// membership tests against redaction rectangles; the outcome gate is the safety net
/// for any approximation error.
#[derive(Debug, Clone)]
pub(crate) struct GlyphSlot {
    /// Index into `Content.operations` of the show operator that produced this glyph.
    pub op: usize,
    /// `Some(i)` = the `i`-th element of a `TJ` array operand; `None` for `Tj`/`'`/`"`.
    pub elem: Option<usize>,
    /// Byte offset of this code unit within the string operand bytes.
    pub byte_off: usize,
    /// Byte length of this code unit (1 for simple fonts, 2 for Type0 Identity).
    pub byte_len: usize,
    /// Raw glyph code / CID decoded from the string bytes.
    pub code: u32,
    /// Display-point horizontal centre.
    pub cx: f32,
    /// Display-point vertical centre.
    pub cy: f32,
    /// Active font resource name at the time this glyph was shown.
    pub font: Vec<u8>,
    /// Font size (`Tfs`) in effect at the time this glyph was shown.
    pub font_size: f32,
    /// Character spacing (`Tc`) in effect.
    pub char_spacing: f32,
    /// Word spacing (`Tw`) in effect.
    pub word_spacing: f32,
}

// ── Text-state machine ────────────────────────────────────────────────────────

/// Walk a decoded content stream, tracking graphics state (CTM stack) and PDF text
/// state, and emit a `GlyphSlot` for every decoded glyph code.
///
/// `initial_ctm` seeds the CTM stack. Pass `Affine::IDENTITY` for pages where the
/// lower-left corner is already at the origin; pass
/// `Affine::translate((-llx as f64, -lly as f64))` when the page's MediaBox
/// lower-left is not at (0, 0) so that display-point coordinates are relative to
/// the page's own lower-left corner.
///
/// Returns `Err(())` if the page uses a font or encoding the walk cannot reconstruct:
/// - A show operator (`Tj`, `TJ`, `'`, `"`) is reached while the active font is
///   `FontMetrics::Unsupported` or absent from `fonts`.
/// - The graphics-state stack underflows (unbalanced `Q` with no matching `q`).
/// - The active font has no metrics at all for any code in the operand.
///
/// Unknown operators that do not produce glyphs are silently ignored; this keeps the
/// walk compatible with PDF extensions (marked content, optional content, etc.).
pub(crate) fn enumerate_page_glyphs(
    content: &Content,
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    initial_ctm: kurbo::Affine,
) -> Result<Vec<GlyphSlot>, ()> {
    // ── Graphics state ────────────────────────────────────────────────────────
    // The CTM stack starts with initial_ctm. `q` pushes a copy; `Q` pops.
    // `cm` pre-multiplies the top element.
    let mut ctm_stack: Vec<Affine> = vec![initial_ctm];

    // ── Text state ────────────────────────────────────────────────────────────
    // `in_text` is true between BT and ET. The line matrix and text matrix are
    // reset to identity on BT.
    let mut in_text = false;
    let mut text_matrix = Affine::IDENTITY;
    let mut line_matrix = Affine::IDENTITY;

    // PDF text-state parameters carried across show-text operators.
    let mut active_font: Option<Vec<u8>> = None;
    let mut font_size: f32 = 0.0;
    let mut char_spacing: f32 = 0.0;
    let mut word_spacing: f32 = 0.0;
    let mut horiz_scale: f32 = 1.0; // Tz/100
    let mut leading: f32 = 0.0;
    let mut rise: f32 = 0.0;

    let mut slots: Vec<GlyphSlot> = Vec::new();

    for (op_index, operation) in content.operations.iter().enumerate() {
        let operator = operation.operator.as_str();
        let operands = &operation.operands;

        match operator {
            // ── Graphics state operators ──────────────────────────────────────
            "q" => {
                let current = *ctm_stack.last().ok_or(())?;
                ctm_stack.push(current);
            }
            "Q" => {
                if ctm_stack.len() <= 1 {
                    // Unbalanced Q — the CTM stack should never go below the
                    // initial identity entry.
                    return Err(());
                }
                ctm_stack.pop();
            }
            "cm" => {
                // Pre-multiply the current CTM by the new matrix.
                let matrix = affine_from_operands(operands).unwrap_or(Affine::IDENTITY);
                let top = ctm_stack.last_mut().ok_or(())?;
                *top *= matrix;
            }

            // ── Text object delimiters ────────────────────────────────────────
            "BT" => {
                in_text = true;
                text_matrix = Affine::IDENTITY;
                line_matrix = Affine::IDENTITY;
            }
            "ET" => {
                in_text = false;
            }

            // ── Text state parameter operators ───────────────────────────────
            "Tc" => {
                char_spacing = number_from_operand(operands, 0).unwrap_or(char_spacing);
            }
            "Tw" => {
                word_spacing = number_from_operand(operands, 0).unwrap_or(word_spacing);
            }
            "Tz" => {
                let tz = number_from_operand(operands, 0).unwrap_or(100.0);
                horiz_scale = tz / 100.0;
            }
            "TL" => {
                leading = number_from_operand(operands, 0).unwrap_or(leading);
            }
            "Ts" => {
                rise = number_from_operand(operands, 0).unwrap_or(rise);
            }
            "Tr" => {
                // Text rendering mode — no position effect; consumed and ignored.
            }
            "Tf" => {
                if let Some(Object::Name(name)) = operands.first() {
                    active_font = Some(name.clone());
                }
                font_size = number_from_operand(operands, 1).unwrap_or(font_size);
            }

            // ── Text positioning operators ────────────────────────────────────
            "Td" => {
                if in_text {
                    let tx = number_from_operand(operands, 0).unwrap_or(0.0) as f64;
                    let ty = number_from_operand(operands, 1).unwrap_or(0.0) as f64;
                    line_matrix *= Affine::translate((tx, ty));
                    text_matrix = line_matrix;
                }
            }
            "TD" => {
                if in_text {
                    let tx = number_from_operand(operands, 0).unwrap_or(0.0) as f64;
                    let ty = number_from_operand(operands, 1).unwrap_or(0.0);
                    leading = -ty;
                    let ty = ty as f64;
                    line_matrix *= Affine::translate((tx, ty));
                    text_matrix = line_matrix;
                }
            }
            "T*" => {
                if in_text {
                    let ty = -(leading as f64);
                    line_matrix *= Affine::translate((0.0, ty));
                    text_matrix = line_matrix;
                }
            }
            "Tm" => {
                if in_text {
                    let matrix = affine_from_operands(operands).unwrap_or(Affine::IDENTITY);
                    text_matrix = matrix;
                    line_matrix = matrix;
                }
            }

            // ── Text show operators ───────────────────────────────────────────
            "Tj" => {
                if in_text {
                    let font_name = active_font.clone().ok_or(())?;
                    let metrics = fonts.get(&font_name).ok_or(())?;
                    let bytes = string_bytes_from_operand(operands, 0).ok_or(())?;
                    emit_glyphs_from_string(
                        bytes,
                        None,
                        op_index,
                        metrics,
                        &font_name,
                        font_size,
                        char_spacing,
                        word_spacing,
                        horiz_scale,
                        rise,
                        &ctm_stack,
                        &mut text_matrix,
                        &mut slots,
                    )?;
                }
            }
            "TJ" => {
                if in_text {
                    let font_name = active_font.clone().ok_or(())?;
                    let metrics = fonts.get(&font_name).ok_or(())?;
                    let array = match operands.first() {
                        Some(Object::Array(arr)) => arr,
                        _ => return Err(()),
                    };
                    for (element_index, element) in array.iter().enumerate() {
                        match element {
                            Object::String(bytes, _) => {
                                emit_glyphs_from_string(
                                    bytes,
                                    Some(element_index),
                                    op_index,
                                    metrics,
                                    &font_name,
                                    font_size,
                                    char_spacing,
                                    word_spacing,
                                    horiz_scale,
                                    rise,
                                    &ctm_stack,
                                    &mut text_matrix,
                                    &mut slots,
                                )?;
                            }
                            _ => {
                                // Numeric kerning adjustment: shift Tm before the next glyph.
                                if let Some(n) = number_value(element) {
                                    let shift = -(n / 1000.0 * font_size * horiz_scale) as f64;
                                    text_matrix *= Affine::translate((shift, 0.0));
                                }
                            }
                        }
                    }
                }
            }
            "'" => {
                if in_text {
                    // Line advance then show.
                    let ty = -(leading as f64);
                    line_matrix *= Affine::translate((0.0, ty));
                    text_matrix = line_matrix;

                    let font_name = active_font.clone().ok_or(())?;
                    let metrics = fonts.get(&font_name).ok_or(())?;
                    let bytes = string_bytes_from_operand(operands, 0).ok_or(())?;
                    emit_glyphs_from_string(
                        bytes,
                        None,
                        op_index,
                        metrics,
                        &font_name,
                        font_size,
                        char_spacing,
                        word_spacing,
                        horiz_scale,
                        rise,
                        &ctm_stack,
                        &mut text_matrix,
                        &mut slots,
                    )?;
                }
            }
            "\"" if in_text => {
                // `" aw ac string` — set Tw, Tc, then T*-equivalent then show.
                word_spacing = number_from_operand(operands, 0).unwrap_or(word_spacing);
                char_spacing = number_from_operand(operands, 1).unwrap_or(char_spacing);

                let ty = -(leading as f64);
                line_matrix *= Affine::translate((0.0, ty));
                text_matrix = line_matrix;

                let font_name = active_font.clone().ok_or(())?;
                let metrics = fonts.get(&font_name).ok_or(())?;
                let bytes = string_bytes_from_operand(operands, 2).ok_or(())?;
                emit_glyphs_from_string(
                    bytes,
                    None,
                    op_index,
                    metrics,
                    &font_name,
                    font_size,
                    char_spacing,
                    word_spacing,
                    horiz_scale,
                    rise,
                    &ctm_stack,
                    &mut text_matrix,
                    &mut slots,
                )?;
            }

            // All other operators are silently ignored — they do not affect the
            // text position or produce glyphs.
            _ => {}
        }
    }

    Ok(slots)
}

// ── State-machine helpers ─────────────────────────────────────────────────────

/// Decode a run of glyph codes from `bytes` using `metrics.bytes_per_code`, compute
/// each glyph's display-point centre, and append `GlyphSlot` entries to `slots`.
///
/// `text_matrix` is updated in-place after each glyph's advance.
///
/// Coordinates are in PDF user space (bottom-left origin), the same frame as the
/// redaction `Rect`. No y-flip is applied here: that conversion is only needed
/// when the source is a top-left-origin rendering device (hayro/kurbo output),
/// not when walking the PDF content stream directly.
#[allow(clippy::too_many_arguments)]
fn emit_glyphs_from_string(
    bytes: &[u8],
    element_index: Option<usize>,
    op_index: usize,
    metrics: &FontMetrics,
    font_name: &[u8],
    font_size: f32,
    char_spacing: f32,
    word_spacing: f32,
    horiz_scale: f32,
    rise: f32,
    ctm_stack: &[Affine],
    text_matrix: &mut Affine,
    slots: &mut Vec<GlyphSlot>,
) -> Result<(), ()> {
    let (bytes_per_code, widths, default_width) = match metrics {
        FontMetrics::Supported {
            bytes_per_code,
            widths,
            default_width,
        } => (*bytes_per_code, widths, *default_width),
        FontMetrics::Unsupported => return Err(()),
    };

    let ctm = *ctm_stack.last().ok_or(())?;

    let mut byte_offset = 0usize;
    while byte_offset + bytes_per_code <= bytes.len() {
        let code = if bytes_per_code == 1 {
            bytes[byte_offset] as u32
        } else {
            // bytes_per_code == 2: big-endian two-byte code (Identity-H/V)
            ((bytes[byte_offset] as u32) << 8) | (bytes[byte_offset + 1] as u32)
        };

        let glyph_width = widths.get(&code).copied().unwrap_or(default_width);

        // Horizontal advance in text space (before horiz_scale).
        let advance = glyph_width / 1000.0 * font_size
            + char_spacing
            + if bytes_per_code == 1 && code == 32 {
                word_spacing
            } else {
                0.0
            };

        // Centre approximation: half the glyph's advance horizontally from
        // the glyph origin, and a cap-height estimate (font_size * 0.35) above
        // the baseline. Both are computed by transforming offset points through
        // the text matrix (Tm: text space → PDF user space) and then the CTM
        // (graphics state: PDF user space → display space).
        //
        // PDF user space uses a bottom-left origin (y increases upward), which
        // is the same frame as the redaction `Rect`. No y-flip is applied here;
        // the flip in `to_display_rect` serves a different source — hayro's
        // top-left-origin rendering device.
        let half_advance_text =
            kurbo::Point::new((advance * horiz_scale / 2.0) as f64, rise as f64);
        let centre_text_v = kurbo::Point::new(0.0, (rise + font_size * 0.35) as f64);

        // text space → PDF user space (Tm), then → display space (CTM).
        let user_half_adv = ctm * (*text_matrix * half_advance_text);
        let user_centre_v = ctm * (*text_matrix * centre_text_v);

        let cx = user_half_adv.x as f32;
        let cy = user_centre_v.y as f32;

        // Record the slot before advancing Tm.
        slots.push(GlyphSlot {
            op: op_index,
            elem: element_index,
            byte_off: byte_offset,
            byte_len: bytes_per_code,
            code,
            cx,
            cy,
            font: font_name.to_vec(),
            font_size,
            char_spacing,
            word_spacing,
        });

        // Advance the text matrix by the glyph's width (scaled by horiz_scale).
        let advance_scaled = (advance * horiz_scale) as f64;
        *text_matrix *= Affine::translate((advance_scaled, 0.0));

        byte_offset += bytes_per_code;
    }

    Ok(())
}

/// Build a `kurbo::Affine` from the 6 numbers of a `cm`/`Tm` operand list.
/// The PDF matrix `[a b c d e f]` maps to kurbo's column-major `[a b c d e f]`
/// (note: PDF uses row vectors; kurbo uses column vectors but the element order
/// for `Affine::new` is `[a, b, c, d, e, f]` matching PDF `Tm` / `cm` literally).
fn affine_from_operands(operands: &[Object]) -> Option<Affine> {
    if operands.len() < 6 {
        return None;
    }
    let a = number_value(&operands[0])? as f64;
    let b = number_value(&operands[1])? as f64;
    let c = number_value(&operands[2])? as f64;
    let d = number_value(&operands[3])? as f64;
    let e = number_value(&operands[4])? as f64;
    let f = number_value(&operands[5])? as f64;
    Some(Affine::new([a, b, c, d, e, f]))
}

/// Extract the n-th operand as an f32, accepting both `Integer` and `Real`.
fn number_from_operand(operands: &[Object], index: usize) -> Option<f32> {
    operands.get(index).and_then(number_value)
}

/// Extract the raw bytes of a string operand at `index` (covers both literal and hex strings).
fn string_bytes_from_operand(operands: &[Object], index: usize) -> Option<&[u8]> {
    match operands.get(index)? {
        Object::String(bytes, _) => Some(bytes),
        _ => None,
    }
}

// ── Marking ──────────────────────────────────────────────────────────────────

/// Return the indices of slots whose display-point centre `(cx, cy)` falls inside
/// at least one of the supplied redaction rectangles.
///
/// Uses `crate::detect::rect_contains` for the membership test, which is corner-order
/// tolerant (the `Rect` fields may be un-normalised). An empty `rects` slice returns
/// an empty index list.
pub(crate) fn mark_in_rects(slots: &[GlyphSlot], rects: &[Rect]) -> Vec<usize> {
    slots
        .iter()
        .enumerate()
        .filter(|(_, slot)| {
            rects
                .iter()
                .any(|rect| crate::detect::rect_contains(rect, slot.cx, slot.cy))
        })
        .map(|(index, _)| index)
        .collect()
}

// ── Excision ──────────────────────────────────────────────────────────────────

/// Working state for one text-show operation that needs to be rewritten into a `TJ`.
/// Built inside `apply_excision` and consumed by `rebuild_tj_array`.
struct OpRewrite {
    /// All slot indices for this operation (marked and kept), used to reconstruct the operand.
    all_slots: Vec<usize>,
    /// The original operator string (`"Tj"`, `"TJ"`, `"'"`, `"\""`), for `'`/`"` detection.
    original_operator: String,
    /// For `TJ` operations: the original operand array (to preserve existing numeric elements).
    original_array: Option<Vec<Object>>,
    /// For `Tj`/`'`/`"` operations: the single string bytes from the operand.
    single_string_bytes: Option<Vec<u8>>,
}

/// Rewrite every text-show operation that contains at least one marked glyph into an
/// equivalent `TJ` array, dropping the marked codes and inserting a single numeric
/// advance-compensation element for each contiguous run of dropped codes so that
/// following glyphs remain correctly positioned.
///
/// The compensation value `n` is:
///   `n = -(Σ over dropped glyphs of (w + (char_spacing + word_spacing_term) * 1000 / font_size))`
/// where `w` is the glyph-space width (from the `fonts` map), and `word_spacing_term`
/// applies only for 1-byte code 32.
///
/// The `fonts` parameter is required because `GlyphSlot` does not carry per-glyph
/// advance widths (only position and metadata); widths must be resolved at call time.
///
/// After rewriting all affected operations, one opaque black redaction box is appended
/// per rectangle in `rects`, drawn using `q … re f Q` in the page's coordinate space.
///
/// `'` and `"` operators that contain marked glyphs are replaced by a preceding `T*`
/// operation (which carries their implicit line-advance semantics) followed by the
/// rebuilt `TJ`. The replacement is done by rebuilding `content.operations` rather
/// than mutating the slice in place, so indices in `marked` remain valid.
pub(crate) fn apply_excision(
    content: &mut Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    rects: &[Rect],
) {
    if marked.is_empty() && rects.is_empty() {
        return;
    }

    let replacements = op_replacements(content, slots, marked, fonts);

    // Rebuild content.operations, splicing in the replacement ops (T* + TJ) for
    // each affected operation and keeping everything else as-is.
    let original_operations = std::mem::take(&mut content.operations);
    let mut new_operations: Vec<lopdf::content::Operation> =
        Vec::with_capacity(original_operations.len() + replacements.len());

    for (op_index, op) in original_operations.into_iter().enumerate() {
        match replacements.get(&op_index) {
            Some(repl) => new_operations.extend(repl.iter().cloned()),
            None => new_operations.push(op),
        }
    }

    new_operations.extend(fill_box_operations(rects));
    content.operations = new_operations;
}

/// Encode a small operation list to content-stream bytes.
fn encode_operations(ops: &[lopdf::content::Operation]) -> Option<Vec<u8>> {
    let content = Content {
        operations: ops.to_vec(),
    };
    content.encode().ok()
}

/// Produce edited content bytes by copying `raw` verbatim and re-encoding only the
/// operators named in `replacements`, splicing them over their raw byte spans. The
/// whole-stream re-encode is never run, so inline images and every untouched operator
/// stay byte-identical. Returns `None` if the raw tokenization disagrees with
/// `operations` (a desync) — the caller then falls back to flatten.
pub(crate) fn build_byte_splice(
    raw: &[u8],
    operations: &[lopdf::content::Operation],
    replacements: &BTreeMap<usize, Vec<lopdf::content::Operation>>,
    boxes: &[lopdf::content::Operation],
) -> Option<Vec<u8>> {
    let tokens = crate::content_tokens::tokenize(raw)?;
    // Self-check: token count and operator names must match the decoded operation list.
    if tokens.len() != operations.len() {
        return None;
    }
    for (token, op) in tokens.iter().zip(operations.iter()) {
        if token.operator.as_slice() != op.operator.as_bytes() {
            return None;
        }
    }

    // Apply splices right-to-left so earlier offsets stay valid. `replacements`
    // is a `BTreeMap`, so `.keys()` already yields ascending order; `.rev()`
    // walks it right-to-left without a separate sort.
    let mut out = raw.to_vec();
    for op_index in replacements.keys().rev() {
        if *op_index >= tokens.len() {
            return None;
        }
        let token = &tokens[*op_index];
        let repl_ops = &replacements[op_index];
        let encoded = encode_operations(repl_ops)?;
        let mut padded = Vec::with_capacity(encoded.len() + 2);
        padded.push(b' ');
        padded.extend_from_slice(&encoded);
        padded.push(b' ');
        out.splice(token.start..token.end, padded);
    }

    if !boxes.is_empty() {
        let encoded = encode_operations(boxes)?;
        out.push(b' ');
        out.extend_from_slice(&encoded);
    }
    Some(out)
}

/// For each text-show operation containing a marked glyph, the operations that replace
/// it: a rebuilt `TJ` (marked glyphs dropped, each contiguous dropped run collapsed to a
/// numeric advance-compensation so following glyphs keep position), preceded by a `T*`
/// when the original operator was `'` or `"` (whose implicit line-advance must be preserved).
pub(crate) fn op_replacements(
    content: &Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
) -> BTreeMap<usize, Vec<lopdf::content::Operation>> {
    // Build a set of marked slot indices for O(log n) lookup.
    let marked_set: BTreeSet<usize> = marked.iter().copied().collect();

    // Group marked slot indices by op_index so we know which operations need rewriting.
    let mut ops_with_marked: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for &slot_index in marked {
        let op_index = slots[slot_index].op;
        ops_with_marked
            .entry(op_index)
            .or_default()
            .push(slot_index);
    }

    // Collect all slots for each affected operation (including non-marked ones in
    // the same operand, so we know what to keep).
    let mut replacements: BTreeMap<usize, Vec<lopdf::content::Operation>> = BTreeMap::new();
    for &op_index in ops_with_marked.keys() {
        // Gather all slots that belong to this op_index.
        let all_slots_for_op: Vec<usize> = slots
            .iter()
            .enumerate()
            .filter(|(_, s)| s.op == op_index)
            .map(|(i, _)| i)
            .collect();

        let op = &content.operations[op_index];
        let original_operator = op.operator.clone();

        let (original_array, single_string_bytes) = match original_operator.as_str() {
            "TJ" => {
                let array = match op.operands.first() {
                    Some(Object::Array(arr)) => Some(arr.clone()),
                    _ => None,
                };
                (array, None)
            }
            "Tj" | "'" | "\"" => {
                // For Tj/'/", the string operand index differs: Tj uses 0, ' uses 0, " uses 2.
                let str_operand_index = if original_operator == "\"" { 2 } else { 0 };
                let bytes = match op.operands.get(str_operand_index) {
                    Some(Object::String(b, _)) => Some(b.clone()),
                    _ => None,
                };
                (None, bytes)
            }
            _ => (None, None),
        };

        let rewrite = OpRewrite {
            all_slots: all_slots_for_op,
            original_operator: original_operator.clone(),
            original_array,
            single_string_bytes,
        };
        let rebuilt_array = rebuild_tj_array(&rewrite, slots, &marked_set, fonts);

        let mut ops = Vec::new();
        if original_operator == "'" || original_operator == "\"" {
            // Emit T* first to carry the line advance the original operator implied.
            ops.push(lopdf::content::Operation::new("T*", vec![]));
        }
        ops.push(lopdf::content::Operation::new(
            "TJ",
            vec![Object::Array(rebuilt_array)],
        ));
        replacements.insert(op_index, ops);
    }
    replacements
}

/// One opaque black redaction box per rect, as `q rg re f Q` operations in page space.
/// Corners are normalised so width/height are positive regardless of caller order.
pub(crate) fn fill_box_operations(rects: &[Rect]) -> Vec<lopdf::content::Operation> {
    let mut ops = Vec::new();
    for rect in rects {
        let x0 = rect.x0.min(rect.x1);
        let y0 = rect.y0.min(rect.y1);
        let x1 = rect.x0.max(rect.x1);
        let y1 = rect.y0.max(rect.y1);

        ops.push(lopdf::content::Operation::new("q", vec![]));
        ops.push(lopdf::content::Operation::new(
            "rg",
            vec![Object::Integer(0), Object::Integer(0), Object::Integer(0)],
        ));
        ops.push(lopdf::content::Operation::new(
            "re",
            vec![
                Object::Real(x0),
                Object::Real(y0),
                Object::Real(x1 - x0),
                Object::Real(y1 - y0),
            ],
        ));
        ops.push(lopdf::content::Operation::new("f", vec![]));
        ops.push(lopdf::content::Operation::new("Q", vec![]));
    }
    ops
}

/// Rebuild the TJ array for one affected operation.
///
/// For TJ-style operands the existing numeric elements (kerning) that are not part
/// of a dropped run are preserved in their original positions. For Tj/'/"-style operands
/// there is a single string to reconstruct.
///
/// Within each string element the codes are walked in order using the slots' `byte_off`
/// / `byte_len` fields. Kept codes accumulate into a growing `Vec<u8>` fragment; when a
/// marked code is encountered the current fragment is flushed as an `Object::String`,
/// then the contiguous run of dropped codes accumulates a compensation sum, which is
/// emitted as a single `Object::Real(n)` when the run ends. `n` is negative so the
/// renderer advances by the amount the dropped glyphs would have contributed.
fn rebuild_tj_array(
    rewrite: &OpRewrite,
    slots: &[GlyphSlot],
    marked_set: &BTreeSet<usize>,
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
) -> Vec<Object> {
    // Collect all elements that belong to this operation.
    // For TJ: walk the original array; for each Object::String element, find the
    // matching slots and rebuild; preserve non-String elements if not part of a dropped run.
    // For Tj/'/": there is one implicit string element (elem = None).

    match &rewrite.original_operator[..] {
        "TJ" => {
            let Some(original_array) = &rewrite.original_array else {
                return vec![];
            };

            let mut result: Vec<Object> = Vec::new();

            for (element_index, element) in original_array.iter().enumerate() {
                match element {
                    Object::String(bytes, _) => {
                        // Find all slots for this (op, elem) pair, in byte-offset order.
                        let mut element_slots: Vec<usize> = rewrite
                            .all_slots
                            .iter()
                            .copied()
                            .filter(|&si| slots[si].elem == Some(element_index))
                            .collect();
                        element_slots.sort_by_key(|&si| slots[si].byte_off);

                        let rebuilt =
                            rebuild_string_element(bytes, &element_slots, slots, marked_set, fonts);
                        result.extend(rebuilt);
                    }
                    Object::Integer(_) | Object::Real(_) => {
                        // Preserve existing kerning adjustments verbatim — they belong to
                        // the inter-element gaps, not to any single dropped code's run.
                        result.push(element.clone());
                    }
                    _ => {}
                }
            }

            result
        }
        "Tj" | "'" | "\"" => {
            let Some(bytes) = &rewrite.single_string_bytes else {
                return vec![];
            };

            // All slots for this op have elem = None.
            let mut element_slots: Vec<usize> = rewrite
                .all_slots
                .iter()
                .copied()
                .filter(|&si| slots[si].elem.is_none())
                .collect();
            element_slots.sort_by_key(|&si| slots[si].byte_off);

            rebuild_string_element(bytes, &element_slots, slots, marked_set, fonts)
        }
        _ => vec![],
    }
}

/// Reconstruct one string element's contribution to the TJ array.
///
/// Walks the codes described by `element_slots` (sorted by `byte_off`). Kept codes
/// are accumulated into a byte buffer; when a marked code is encountered:
///   1. The current buffer is flushed as an `Object::String` (if non-empty).
///   2. The contiguous dropped run's advance sum is accumulated.
///   3. When the run ends (a kept code or the end of the element is reached), the
///      accumulated sum is emitted as `Object::Real(n)` where `n` is negative.
///
/// This ensures that the reader's text position after the TJ array matches what it
/// would have been had the dropped glyphs been present but invisible.
fn rebuild_string_element(
    source_bytes: &[u8],
    element_slots: &[usize],
    slots: &[GlyphSlot],
    marked_set: &BTreeSet<usize>,
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
) -> Vec<Object> {
    let mut result: Vec<Object> = Vec::new();
    let mut kept_bytes: Vec<u8> = Vec::new();
    // Accumulates the compensation sum (positive units) for a contiguous dropped run.
    let mut dropped_advance_sum: f32 = 0.0;
    let mut in_dropped_run = false;

    for &slot_index in element_slots {
        let slot = &slots[slot_index];

        if marked_set.contains(&slot_index) {
            // This code is dropped.  Flush any accumulated kept bytes first.
            if !kept_bytes.is_empty() {
                result.push(Object::String(
                    std::mem::take(&mut kept_bytes),
                    lopdf::StringFormat::Literal,
                ));
            }

            // Accumulate the advance for this dropped glyph.
            let glyph_width = glyph_width_from_metrics(slot, fonts);
            let word_spacing_term = if slot.byte_len == 1 && slot.code == 32 {
                slot.word_spacing
            } else {
                0.0
            };
            // Advance contribution in TJ units (glyph-space thousandths):
            //   n formula: -(w + (Tc + Tw_term) * 1000 / font_size)
            // where w is the glyph-space width from the widths map (in thousandths).
            let contribution = glyph_width
                + (slot.char_spacing + word_spacing_term) * 1000.0
                    / slot.font_size.max(f32::EPSILON);
            dropped_advance_sum += contribution;
            in_dropped_run = true;
        } else {
            // This code is kept.  If we were in a dropped run, flush the compensation.
            if in_dropped_run {
                result.push(Object::Real(-dropped_advance_sum));
                dropped_advance_sum = 0.0;
                in_dropped_run = false;
            }

            // Append this code's bytes to the kept buffer, using the slot's
            // byte_off/byte_len as the authoritative source of which bytes this code occupies.
            let slot_bytes_end = (slot.byte_off + slot.byte_len).min(source_bytes.len());
            kept_bytes.extend_from_slice(&source_bytes[slot.byte_off..slot_bytes_end]);
        }
    }

    // Flush any remaining kept bytes.
    if !kept_bytes.is_empty() {
        result.push(Object::String(kept_bytes, lopdf::StringFormat::Literal));
    }

    // Flush any remaining dropped run (trailing dropped codes).
    if in_dropped_run && dropped_advance_sum != 0.0 {
        result.push(Object::Real(-dropped_advance_sum));
    }

    result
}

/// Look up the glyph-space width (PDF `/Widths` thousandths) for the code in `slot`.
///
/// Falls back to `default_width` if the font is found but has no entry for the code,
/// and to `0.0` if the font is absent or unsupported (so the advance is not over-compensated).
fn glyph_width_from_metrics(slot: &GlyphSlot, fonts: &BTreeMap<Vec<u8>, FontMetrics>) -> f32 {
    match fonts.get(&slot.font) {
        Some(FontMetrics::Supported {
            widths,
            default_width,
            ..
        }) => widths.get(&slot.code).copied().unwrap_or(*default_width),
        _ => 0.0,
    }
}

// ── Single-page surgery builder ───────────────────────────────────────────────

/// Walk up the page-tree parent chain to find a MediaBox array, returning the
/// four corner coordinates `[llx, lly, urx, ury]` as f32.
///
/// The PDF specification requires MediaBox to be inherited from ancestor nodes
/// when absent from the page dictionary itself. This helper follows the
/// `/Parent` reference chain until it finds the key or exhausts the tree.
///
/// The walk is bounded to 64 iterations: a cyclic `/Parent` chain in malformed
/// or adversarial input would otherwise loop forever and lock the thread.
pub(crate) fn resolve_mediabox(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
) -> Option<[f32; 4]> {
    let mut current_id = page_id;
    for _ in 0..64 {
        let dict = doc.get_dictionary(current_id).ok()?;
        if let Ok(Object::Array(arr)) = dict.get(b"MediaBox") {
            if arr.len() >= 4 {
                let coords: Vec<f32> = arr.iter().filter_map(number_value).collect();
                if coords.len() >= 4 {
                    return Some([coords[0], coords[1], coords[2], coords[3]]);
                }
            }
        }
        // Walk up to the parent Pages node.
        let parent_ref = dict.get(b"Parent").ok()?;
        match parent_ref {
            Object::Reference(id) => current_id = *id,
            _ => return None,
        }
    }
    // Depth limit reached without finding MediaBox — treat as unresolvable.
    None
}

/// Resolve the `/Rotate` value for a page, walking up the parent chain for
/// inheritance. Returns 0 when the key is absent at all levels.
///
/// The PDF specification allows page rotation to be inherited from ancestor
/// Pages nodes; this mirrors the inheritance walk used for MediaBox.
///
/// The walk is bounded to 64 iterations: a cyclic `/Parent` chain in malformed
/// or adversarial input would otherwise loop forever and lock the thread.
pub(crate) fn resolve_rotate(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> i64 {
    let mut current_id = page_id;
    for _ in 0..64 {
        let dict = match doc.get_dictionary(current_id).ok() {
            Some(d) => d,
            None => return 0,
        };
        if let Ok(value) = dict.get(b"Rotate") {
            if let Some(n) = integer_value(value) {
                return n;
            }
        }
        let parent_ref = match dict.get(b"Parent").ok() {
            Some(r) => r,
            None => return 0,
        };
        match parent_ref {
            Object::Reference(id) => current_id = *id,
            _ => return 0,
        }
    }
    // Depth limit reached without finding Rotate — default to 0 (no rotation).
    0
}

/// The text matrix `Tm = [a b c d e f]` (text space -> user space) that places upright text
/// at displayed-bottom-left-frame origin `(dx, dy)` on a page whose unrotated MediaBox is
/// `[llx lly urx ury]` under normalized rotation `r` (0/90/180/270).
///
/// The linear part counter-rotates the glyphs so they read upright on the *displayed* page
/// (after the viewer applies `/Rotate`); the translation maps the displayed origin back into
/// unrotated user space, where content is actually drawn. `w = urx - llx` and `h = ury - lly`
/// are the unrotated MediaBox dimensions. The linear part carries no scale — the caller sets
/// glyph size through the font size (`Tf`), so a text run keeps its size operator separate.
///
/// This is the one home for the display->user coordinate frame: both the Bates stamp and the
/// searchable-text-layer writer place displayed-frame text on rotated pages through it.
pub(crate) fn text_matrix(
    rotation: i64,
    llx: f32,
    lly: f32,
    w: f32,
    h: f32,
    dx: f32,
    dy: f32,
) -> [f32; 6] {
    // For the quarter turns the displayed frame swaps axes: /Rotate 90/270 shows a `w`-wide,
    // `h`-tall page as `h` wide and `w` tall. A viewer rotates /Rotate 90 a quarter-turn clockwise,
    // so a displayed origin `(dx, dy)` maps to unrotated user `(llx + w - dy, lly + dx)` — the
    // translation along the unrotated x-axis is bounded by the page WIDTH `w`, not its height. (270
    // is the mirror: its y-translation is bounded by `h`.) Getting these swapped places text a
    // `(h - w)` offset off a non-square page — invisible on a square page, off-page on a portrait one.
    match rotation {
        90 => [0.0, 1.0, -1.0, 0.0, llx + w - dy, lly + dx],
        180 => [-1.0, 0.0, 0.0, -1.0, llx + w - dx, lly + h - dy],
        270 => [0.0, -1.0, 1.0, 0.0, llx + dy, lly + h - dx],
        // 0 and any unexpected value fall through to the unrotated frame.
        _ => [1.0, 0.0, 0.0, 1.0, llx + dx, lly + dy],
    }
}

/// Whether lopdf can faithfully re-encode this content stream: encode, then re-decode,
/// and the operation count is preserved. A re-encode that fails to re-decode counts as
/// non-round-tripping. This is the production decision for op-path (round-trips) vs
/// byte-path (does not).
fn content_roundtrips(content: &Content) -> bool {
    content
        .encode()
        .ok()
        .and_then(|enc| Content::decode(&enc).ok())
        .map(|c| c.operations.len() == content.operations.len())
        .unwrap_or(false)
}

/// Attempt to surgically redact `rects` from the content stream of `page_id`.
///
/// Returns `Some(bytes)` when the page's content stream can be decoded and its glyphs
/// enumerated. Whether the stream then round-trips through lopdf whole picks the path:
/// when it does, the operation list is rewritten and the whole stream re-encoded; when
/// it does not (e.g. an inline image lopdf cannot faithfully re-encode), the original
/// bytes are copied and only the edited operators are re-encoded and spliced in, so the
/// unrepresentable parts pass through byte-identical. Returns `None` when the page
/// structure prevents reliable surgery either way — for example when:
/// - The content stream cannot be decoded, or a font/encoding it uses is not supported
///   by the glyph-position walker.
/// - The page's MediaBox cannot be resolved from the page tree.
/// - The page carries a non-zero `/Rotate` value (rotated pages require
///   coordinate-frame adjustments that are handled by a flatten fallback).
///
/// Returning `Some` does not guarantee that all glyphs within `rects` were
/// removed — an outcome gate in the caller verifies that. This function only
/// refuses pages it structurally cannot handle.
pub(crate) fn try_build_surgery(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    rects: &[crate::redact::Rect],
) -> Option<Vec<u8>> {
    // Obtain and decode the content stream. `get_page_content` is infallible — a page
    // with no resolvable content stream yields an empty buffer, which `Content::decode`
    // then reads as an empty operator list.
    let raw = doc.get_page_content(page_id);
    let content = lopdf::content::Content::decode(&raw).ok()?;

    // Resolve page geometry and fonts.
    let fonts = page_fonts(doc, page_id);
    let [llx, lly, _urx, _ury] = resolve_mediabox(doc, page_id)?;
    let initial_ctm = kurbo::Affine::translate((-llx as f64, -lly as f64));

    // Non-zero rotation needs a coordinate-frame adjustment not handled here.
    if resolve_rotate(doc, page_id).rem_euclid(360) != 0 {
        return None;
    }

    // Locate glyphs and mark those inside the rectangles. This runs before the
    // round-trip guard: a stream lopdf cannot re-encode (inline images) may still have
    // perfectly analyzable text, and the byte-path below rewrites it without a re-encode.
    let slots = enumerate_page_glyphs(&content, &fonts, initial_ctm).ok()?;
    let marked = mark_in_rects(&slots, rects);

    // Round-trip guard: can lopdf faithfully re-encode this whole stream? A re-encode
    // that fails to re-decode counts as "does not round-trip", same as a differing
    // operation count — both mean lopdf cannot faithfully represent this stream whole.
    if content_roundtrips(&content) {
        // Op-path: rewrite the operation list and re-encode the whole stream.
        op_path_write(&content, &slots, &marked, &fonts, rects)
    } else {
        // Byte-path: copy the original bytes and re-encode only the edited operators,
        // so inline images and exotic constructs pass through byte-identical.
        byte_path_write(&raw, &content, &slots, &marked, &fonts, rects)
    }
}

/// Run the op-path writer (whole-stream re-encode) on one page, ignoring the round-trip
/// guard. Returns the surgered bytes, or None if it cannot produce a stream.
fn op_path_write(
    content: &Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    rects: &[Rect],
) -> Option<Vec<u8>> {
    let mut edited = content.clone();
    apply_excision(&mut edited, slots, marked, fonts, rects);
    edited.encode().ok()
}

/// Run the byte-path writer on one page. Returns the spliced bytes, or None on desync.
fn byte_path_write(
    raw: &[u8],
    content: &Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    rects: &[Rect],
) -> Option<Vec<u8>> {
    let replacements = op_replacements(content, slots, marked, fonts);
    let boxes = fill_box_operations(rects);
    build_byte_splice(raw, &content.operations, &replacements, &boxes)
}

/// Whether one writer's candidate stream ended up preserving live text/vectors
/// (`Surgered`) or had to be treated as unusable by the caller (`Flattened`). Used
/// only by the diagnostic below — production redaction falls back to a real raster
/// flatten, this enum just names the two outcomes for comparison purposes.
///
/// Diagnostic-only, not a supported engine type: eval-harness internal, hidden from docs.
#[derive(Debug, Clone, Copy, PartialEq)]
#[doc(hidden)]
pub enum SurgeryDisposition {
    Surgered,
    Flattened,
}

/// The op-path and byte-path writers' dispositions for one page, run independently
/// of each other and of production `redact`'s single chosen path.
///
/// Diagnostic-only, not a supported engine type: eval-harness internal, hidden from docs.
#[doc(hidden)]
pub struct SurgeryPathComparison {
    pub op_path: SurgeryDisposition,
    pub byte_path: SurgeryDisposition,
}

/// Diagnostic: run BOTH writers on one page and report whether each produced a
/// gate-passing stream. The op-path/byte-path recovery comparison and the
/// full-replacement-safety decision are read off the aggregate of these across a
/// corpus. `Surgered` = the writer produced a stream that passes the surgery outcome
/// gate; otherwise `Flattened`. Returns `None` if the page cannot be loaded or
/// enumerated at all (not a disposition — no comparison to make).
///
/// Scope of what a green comparison actually proves: it rests on (a) gate-pass
/// equivalence per page, checked independently for each writer, and (b) the fact
/// that surviving-glyph layout is identical BY CONSTRUCTION whenever both writers
/// surger the same page — both call the shared `op_replacements` to build the
/// replacement operators, so a kept glyph ends up at the position that same
/// replacement data dictates in the op-path and in the byte-spliced output alike.
/// This function does not independently diff surviving-glyph positions between the
/// two outputs. A `Surgered`/`Surgered` or `Flattened`/`Surgered` verdict means
/// "the byte-path gate-passes wherever the op-path does, and shares the rewrite" —
/// not "pixel-diffed equivalent."
///
/// Diagnostic-only, not a supported engine type: eval-harness internal, hidden from docs.
#[doc(hidden)]
pub fn compare_surgery_paths(
    pdf_bytes: &[u8],
    page: usize,
    rects: &[Rect],
) -> Option<SurgeryPathComparison> {
    let doc = lopdf::Document::load_mem(pdf_bytes).ok()?;
    let page_id = *doc.get_pages().get(&((page + 1) as u32))?;
    let raw = doc.get_page_content(page_id);
    let content = lopdf::content::Content::decode(&raw).ok()?;
    let fonts = page_fonts(&doc, page_id);
    let [llx, lly, _, _] = resolve_mediabox(&doc, page_id)?;
    if resolve_rotate(&doc, page_id).rem_euclid(360) != 0 {
        return None;
    }
    let slots = enumerate_page_glyphs(
        &content,
        &fonts,
        kurbo::Affine::translate((-llx as f64, -lly as f64)),
    )
    .ok()?;
    let marked = mark_in_rects(&slots, rects);

    // Assemble a hayro probe by installing `candidate` as the page's content stream.
    let build_probe = |candidate: &[u8]| -> Option<hayro::hayro_syntax::Pdf> {
        let mut probe_doc = doc.clone(); // lopdf Document::clone is deep
        let content_id = probe_doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::new(),
            candidate.to_vec(),
        ));
        probe_doc
            .get_dictionary_mut(page_id)
            .ok()?
            .set("Contents", lopdf::Object::Reference(content_id));
        let mut bytes = Vec::new();
        probe_doc.save_to(&mut bytes).ok()?;
        hayro::hayro_syntax::Pdf::new(bytes).ok()
    };
    let disposition = |candidate: Option<Vec<u8>>| -> SurgeryDisposition {
        match candidate.as_deref().and_then(build_probe) {
            Some(probe) if crate::redact::surgery_candidate_passes_gate(&probe, page, rects) => {
                SurgeryDisposition::Surgered
            }
            _ => SurgeryDisposition::Flattened,
        }
    };
    // Production only ever runs the op-path when the round-trip guard passes; on a
    // guard-failing page it never runs the op-path at all (byte_path_write handles it
    // instead). Mirror that here: a guard failure forces op_path to Flattened rather
    // than gating whatever op_path_write happens to produce, so a stream lopdf silently
    // truncated (and which the gate then can't see past) doesn't get misreported as
    // Surgered.
    let op_path = if content_roundtrips(&content) {
        disposition(op_path_write(&content, &slots, &marked, &fonts, rects))
    } else {
        SurgeryDisposition::Flattened
    };
    Some(SurgeryPathComparison {
        op_path,
        byte_path: disposition(byte_path_write(
            &raw, &content, &slots, &marked, &fonts, rects,
        )),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{
        content::{Content, Operation},
        dictionary, Document, Object,
    };

    fn doc_with_font(font: lopdf::Dictionary) -> (Document, lopdf::ObjectId) {
        let mut d = Document::with_version("1.5");
        let fid = d.add_object(font);
        let fonts = dictionary! { "F0" => Object::Reference(fid) };
        let res = dictionary! { "Font" => fonts };
        let page = d.add_object(dictionary! { "Type" => "Page", "Resources" => res });
        (d, page)
    }

    #[test]
    fn a_width_range_past_the_last_character_identifier_is_capped() {
        // One entry declaring four billion identifiers must cost at most 65,536 insertions.
        let widths = parse_cid_widths(&[
            Object::Integer(0),
            Object::Integer(i64::from(u32::MAX)),
            Object::Integer(500),
        ]);
        assert_eq!(widths.len(), 0x1_0000);
        assert_eq!(widths.get(&0xFFFF), Some(&500.0));

        // The per-identifier form stops at the same ceiling instead of wrapping around.
        let widths = parse_cid_widths(&[
            Object::Integer(0xFFFF),
            Object::Array(vec![Object::Integer(1), Object::Integer(2)]),
        ]);
        assert_eq!(widths.len(), 1);
        assert_eq!(widths.get(&0xFFFF), Some(&1.0));
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
    fn simple_font_indirect_widths_are_resolved() {
        // `/Widths` and `/FirstChar` as indirect references (the common real-world
        // form, seen on non-embedded TrueType and base-14-named fonts). Reading
        // `/Widths` without dereferencing would misclassify the font as unsupported.
        let mut d = Document::with_version("1.5");
        let widths_id = d.add_object(Object::Array(vec![
            Object::Integer(500),
            Object::Integer(600),
        ]));
        let first_char_id = d.add_object(Object::Integer(65));
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "TrueType", "BaseFont" => "TimesNewRomanPSMT",
            "FirstChar" => Object::Reference(first_char_id),
            "Widths" => Object::Reference(widths_id),
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
                ..
            } => {
                assert_eq!(*bytes_per_code, 1);
                assert_eq!(widths.get(&65), Some(&500.0));
                assert_eq!(widths.get(&66), Some(&600.0));
            }
            _ => panic!("expected Supported for indirect /Widths"),
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

    /// A non-standard simple font whose `/Widths` key is absent must resolve to
    /// `FontMetrics::Unsupported`. Standard-14 fonts without `/Widths` are handled by the
    /// built-in advance-width resolver; fonts with unrecognized `/BaseFont` names have no
    /// fallback and cannot have their advance widths resolved.
    #[test]
    fn non_standard_simple_font_without_widths_is_unsupported() {
        // A non-standard Type1 font with no `/Widths` and no recognizable
        // standard-14 `/BaseFont` name cannot have its advance widths resolved,
        // so it must remain Unsupported.
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1",
            "BaseFont" => "CustomProprietaryFont",
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

    // ── Glyph enumeration tests ───────────────────────────────────────────────

    fn simple_fonts() -> BTreeMap<Vec<u8>, FontMetrics> {
        let mut map = BTreeMap::new();
        let mut widths = BTreeMap::new();
        widths.insert(b'A' as u32, 500.0f32);
        widths.insert(b'B' as u32, 500.0f32);
        map.insert(
            b"F0".to_vec(),
            FontMetrics::Supported {
                bytes_per_code: 1,
                widths,
                default_width: 0.0,
            },
        );
        map
    }

    #[test]
    fn enumerates_two_glyphs_with_positions() {
        // BT /F0 10 Tf 100 700 Td (AB) Tj ET  on a 792-pt-tall page.
        let ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
            Operation::new("Td", vec![100.into(), 700.into()]),
            Operation::new("Tj", vec![Object::string_literal("AB")]),
            Operation::new("ET", vec![]),
        ];
        let content = Content { operations: ops };
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].code, b'A' as u32);
        assert_eq!(slots[0].byte_off, 0);
        assert_eq!(slots[1].byte_off, 1);
        // 'A' origin x = 100; centre = origin + half-advance(2.5) = 102.5
        assert!((slots[0].cx - (100.0 + 2.5)).abs() < 0.6);
        // 'B' origin x = 100 + advance(5.0) = 105; centre = 107.5
        assert!((slots[1].cx - (105.0 + 2.5)).abs() < 0.6);
        // display y (bottom-left origin): text position 700; cy ≈ 700 + font_size*0.35 = 703.5
        assert!((slots[0].cy - (700.0 + 3.5)).abs() < 1.0);
    }

    #[test]
    fn tj_kerning_advances_following_glyph() {
        // [(A) -100 (B)] TJ : the -100 adds +1.0 pt (100/1000*10) before B.
        let ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
            Operation::new("Td", vec![0.into(), 0.into()]),
            Operation::new(
                "TJ",
                vec![Object::Array(vec![
                    Object::string_literal("A"),
                    Object::Integer(-100),
                    Object::string_literal("B"),
                ])],
            ),
            Operation::new("ET", vec![]),
        ];
        let slots = enumerate_page_glyphs(
            &Content { operations: ops },
            &simple_fonts(),
            kurbo::Affine::IDENTITY,
        )
        .unwrap();
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[1].elem, Some(2));
        // B origin = A origin(0) + advance(5.0) + kern(1.0) = 6.0; centre +2.5
        assert!((slots[1].cx - (6.0 + 2.5)).abs() < 0.6);
    }

    #[test]
    fn unsupported_font_showing_text_errors() {
        let mut fonts = simple_fonts();
        fonts.insert(b"F9".to_vec(), FontMetrics::Unsupported);
        let ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F9".to_vec()), 10.into()]),
            Operation::new("Tj", vec![Object::string_literal("A")]),
            Operation::new("ET", vec![]),
        ];
        assert!(enumerate_page_glyphs(
            &Content { operations: ops },
            &fonts,
            kurbo::Affine::IDENTITY
        )
        .is_err());
    }

    #[test]
    fn cm_scaling_moves_positions() {
        // 2x scale via cm before the text: origin x doubles.
        let ops = vec![
            Operation::new(
                "cm",
                vec![2.into(), 0.into(), 0.into(), 2.into(), 0.into(), 0.into()],
            ),
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
            Operation::new("Td", vec![50.into(), 100.into()]),
            Operation::new("Tj", vec![Object::string_literal("A")]),
            Operation::new("ET", vec![]),
        ];
        let slots = enumerate_page_glyphs(
            &Content { operations: ops },
            &simple_fonts(),
            kurbo::Affine::IDENTITY,
        )
        .unwrap();
        // origin 50*2=100; advance also scaled: half-advance = 2.5*2=5.0
        assert!((slots[0].cx - (100.0 + 2.5 * 2.0)).abs() < 1.0);
    }

    // ── Marking, excision, and redaction boxes ────────────────────────────────

    /// Accept `Object::Integer` or `Object::Real` and compare the numeric value to
    /// `expected` within a small epsilon. Used to verify TJ compensation values without
    /// caring about which variant lopdf chose.
    fn real_eq(obj: &Object, expected: f32) -> bool {
        match obj {
            Object::Integer(n) => (*n as f32 - expected).abs() < 0.1,
            Object::Real(r) => (*r - expected).abs() < 0.1,
            _ => false,
        }
    }

    /// Build the standard content stream: BT /F0 10 Tf 0 0 Td (AB) Tj ET.
    /// Used across several marking and excision tests.
    fn ab_content() -> Content {
        Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
                Operation::new("Td", vec![0.into(), 0.into()]),
                Operation::new("Tj", vec![Object::string_literal("AB")]),
                Operation::new("ET", vec![]),
            ],
        }
    }

    #[test]
    fn mark_in_rects_returns_indices_inside_rect() {
        // Slots at cx=10,cy=10 and cx=50,cy=50.  Rect covers only the second.
        let mut widths = BTreeMap::new();
        widths.insert(b'A' as u32, 500.0f32);
        widths.insert(b'B' as u32, 500.0f32);
        let fonts = simple_fonts();
        let content = ab_content();
        let slots = enumerate_page_glyphs(&content, &fonts, kurbo::Affine::IDENTITY).unwrap();
        // A large rect that covers all glyphs (they're near x=2.5/7.5 y=3.5 in text space).
        let rects = vec![crate::Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 100.0,
            y1: 100.0,
        }];
        let marked = mark_in_rects(&slots, &rects);
        assert_eq!(marked, vec![0, 1]);
    }

    #[test]
    fn mark_in_rects_empty_rects_returns_empty() {
        let content = ab_content();
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        assert!(mark_in_rects(&slots, &[]).is_empty());
    }

    #[test]
    fn excise_first_of_two_inserts_compensating_advance() {
        // "(AB) Tj", drop A (width 500, Tc=Tw=0). Expect TJ [ -500.0 (B) ].
        let mut content = ab_content();
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        // Mark slot 0 = 'A'.
        apply_excision(&mut content, &slots, &[0], &simple_fonts(), &[]);
        // Find the rebuilt TJ.
        let tj = content
            .operations
            .iter()
            .find(|o| o.operator == "TJ")
            .expect("expected a TJ operation");
        if let Object::Array(arr) = &tj.operands[0] {
            // First element: the compensation advance for 'A' = -500.0.
            assert!(
                real_eq(&arr[0], -500.0),
                "expected compensation -500.0, got {:?}",
                arr[0]
            );
            // Second element: the kept byte 'B'.
            assert!(
                matches!(&arr[1], Object::String(s, _) if s.as_slice() == b"B"),
                "expected kept 'B', got {:?}",
                arr[1]
            );
        } else {
            panic!("expected TJ array operand, got {:?}", tj.operands);
        }
    }

    #[test]
    fn excise_last_of_two_keeps_first_with_trailing_compensation() {
        // "(AB) Tj", drop B. Expect TJ [ (A) -500.0 ].
        let mut content = ab_content();
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        apply_excision(&mut content, &slots, &[1], &simple_fonts(), &[]);
        let tj = content
            .operations
            .iter()
            .find(|o| o.operator == "TJ")
            .expect("expected a TJ operation");
        if let Object::Array(arr) = &tj.operands[0] {
            assert!(
                matches!(&arr[0], Object::String(s, _) if s.as_slice() == b"A"),
                "expected kept 'A', got {:?}",
                arr[0]
            );
            assert!(
                real_eq(&arr[1], -500.0),
                "expected trailing compensation -500.0, got {:?}",
                arr[1]
            );
        } else {
            panic!("expected TJ array operand");
        }
    }

    #[test]
    fn excise_both_leaves_only_compensation() {
        // "(AB) Tj", drop both. Expect TJ [ -1000.0 ] (one contiguous run).
        let mut content = ab_content();
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        apply_excision(&mut content, &slots, &[0, 1], &simple_fonts(), &[]);
        let tj = content
            .operations
            .iter()
            .find(|o| o.operator == "TJ")
            .expect("expected a TJ operation");
        if let Object::Array(arr) = &tj.operands[0] {
            assert_eq!(arr.len(), 1, "expected a single compensation element");
            assert!(
                real_eq(&arr[0], -1000.0),
                "expected -1000.0, got {:?}",
                arr[0]
            );
        } else {
            panic!("expected TJ array operand");
        }
    }

    #[test]
    fn op_replacements_and_boxes_match_apply_excision() {
        // Building a Content two ways — via the factored helpers vs. apply_excision —
        // must yield identical operations. This pins that the refactor is behavior-preserving.
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/surgery_simple.pdf");
        let doc = lopdf::Document::load(&fixture).unwrap();
        let page_id = *doc.get_pages().values().next().unwrap();
        let raw = doc.get_page_content(page_id);
        let content = lopdf::content::Content::decode(&raw).unwrap();
        let fonts = page_fonts(&doc, page_id);
        let [llx, lly, _, _] = resolve_mediabox(&doc, page_id).unwrap();
        let slots = enumerate_page_glyphs(
            &content,
            &fonts,
            kurbo::Affine::translate((-llx as f64, -lly as f64)),
        )
        .unwrap();
        let rects = [Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 200.0,
            y1: 50.0,
        }];
        let marked = mark_in_rects(&slots, &rects);

        // Path A: apply_excision on a clone.
        let mut via_excision = content.clone();
        apply_excision(&mut via_excision, &slots, &marked, &fonts, &rects);

        // Path B: rebuild from the factored helpers.
        let replacements = op_replacements(&content, &slots, &marked, &fonts);
        let mut rebuilt = Vec::new();
        for (idx, op) in content.operations.iter().enumerate() {
            if let Some(repl) = replacements.get(&idx) {
                rebuilt.extend(repl.iter().cloned());
            } else {
                rebuilt.push(op.clone());
            }
        }
        rebuilt.extend(fill_box_operations(&rects));

        assert_eq!(via_excision.operations.len(), rebuilt.len());
        for (a, b) in via_excision.operations.iter().zip(rebuilt.iter()) {
            assert_eq!(a.operator, b.operator);
            assert_eq!(a.operands, b.operands);
        }
    }

    #[test]
    fn excise_draws_redaction_box() {
        // Empty content + one rect: verify q, rg, re (correct dimensions), f, Q appended.
        let mut content = Content { operations: vec![] };
        apply_excision(
            &mut content,
            &[],
            &[],
            &simple_fonts(),
            &[crate::Rect {
                x0: 10.0,
                y0: 20.0,
                x1: 110.0,
                y1: 70.0,
            }],
        );
        // Must have an `re` with x=10, y=20, w=100, h=50.
        assert!(
            content.operations.iter().any(|o| {
                o.operator == "re"
                    && matches!(
                        o.operands.as_slice(),
                        [a, b, c, d]
                            if real_eq(a, 10.0) && real_eq(b, 20.0)
                               && real_eq(c, 100.0) && real_eq(d, 50.0)
                    )
            }),
            "expected re 10 20 100 50, operations: {:?}",
            content.operations
        );
        assert!(
            content.operations.iter().any(|o| o.operator == "f"),
            "expected fill operator"
        );
        assert!(
            content.operations.iter().any(|o| o.operator == "q"),
            "expected save-state q"
        );
        assert!(
            content.operations.iter().any(|o| o.operator == "Q"),
            "expected restore-state Q"
        );
    }

    #[test]
    fn excise_with_no_marked_and_no_rects_is_identity() {
        // When nothing is marked and no rects are given, apply_excision must not alter
        // the content stream at all (early-return path).
        let ops_before = ab_content().operations;
        let mut content = ab_content();
        apply_excision(&mut content, &[], &[], &simple_fonts(), &[]);
        assert_eq!(
            content.operations.len(),
            ops_before.len(),
            "expected identical operation count"
        );
    }

    #[test]
    fn excise_prime_operator_inserts_t_star_then_tj() {
        // A "'" (single-quote) operator: excise its only glyph and verify a T* is
        // emitted before the TJ (carrying the line-advance semantics of "'").
        let mut content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
                Operation::new("Td", vec![0.into(), 0.into()]),
                Operation::new("'", vec![Object::string_literal("A")]),
                Operation::new("ET", vec![]),
            ],
        };
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        assert_eq!(slots.len(), 1);
        apply_excision(&mut content, &slots, &[0], &simple_fonts(), &[]);
        // Verify that T* appears immediately before TJ in the output stream.
        let positions: Vec<(usize, &str)> = content
            .operations
            .iter()
            .enumerate()
            .filter(|(_, o)| o.operator == "T*" || o.operator == "TJ")
            .map(|(i, o)| (i, o.operator.as_str()))
            .collect();
        assert_eq!(positions.len(), 2, "expected exactly one T* and one TJ");
        assert_eq!(positions[0].1, "T*");
        assert_eq!(positions[1].1, "TJ");
        assert_eq!(
            positions[1].0,
            positions[0].0 + 1,
            "T* must immediately precede TJ"
        );
    }

    // ── Hardening: TJ kerning and asymmetric CTM ────────────────────────────────

    /// Dropping the first glyph from `[(A) -100 (B)] TJ` must preserve the
    /// original -100 kerning element AND insert a -500 compensation for 'A'.
    ///
    /// The expected output array is: [-500.0, -100, (B)].
    /// The compensation for the dropped 'A' (-500) comes first so the reader's
    /// text position is advanced correctly before the kerning adjustment between
    /// 'A' and 'B' is applied.
    #[test]
    fn tj_kerning_preserved_after_drop() {
        let ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
            Operation::new("Td", vec![0.into(), 0.into()]),
            Operation::new(
                "TJ",
                vec![Object::Array(vec![
                    Object::string_literal("A"),
                    Object::Integer(-100),
                    Object::string_literal("B"),
                ])],
            ),
            Operation::new("ET", vec![]),
        ];
        let mut content = Content { operations: ops };
        let slots =
            enumerate_page_glyphs(&content, &simple_fonts(), kurbo::Affine::IDENTITY).unwrap();
        assert_eq!(slots.len(), 2);

        // Drop only slot 0 = 'A'.
        apply_excision(&mut content, &slots, &[0], &simple_fonts(), &[]);

        let tj = content
            .operations
            .iter()
            .find(|o| o.operator == "TJ")
            .expect("expected a TJ operation after excision");

        if let Object::Array(arr) = &tj.operands[0] {
            // The compensation for the dropped 'A' must appear first.
            assert!(
                real_eq(&arr[0], -500.0),
                "expected compensation -500.0 at index 0, got {:?}",
                arr[0]
            );
            // The original -100 kerning between 'A' and 'B' must be preserved.
            assert!(
                real_eq(&arr[1], -100.0),
                "expected original -100 kerning at index 1, got {:?}",
                arr[1]
            );
            // The kept 'B' string follows.
            assert!(
                matches!(&arr[2], Object::String(s, _) if s.as_slice() == b"B"),
                "expected kept 'B' at index 2, got {:?}",
                arr[2]
            );
            assert_eq!(
                arr.len(),
                3,
                "expected exactly 3 elements in rebuilt TJ array"
            );
        } else {
            panic!("expected TJ array operand, got {:?}", tj.operands);
        }
    }

    /// Verify glyph-centre computation against an asymmetric CTM matrix.
    ///
    /// Using `cm [2 0 0 3 5 7]` (x-scale=2, y-scale=3, translation 5,7) catches
    /// transposition errors that a symmetric scale matrix would hide.
    ///
    /// Hand-computed expected values for font F0 size 10, glyph 'A' (width 500),
    /// text position Td(10, 20):
    ///
    ///   half-advance in text space: (500/1000 * 10) / 2 = 2.5
    ///   Text matrix after BT+Td: translate(10, 20)
    ///   Tm * (2.5, 0) = (12.5, 20)
    ///   CTM * (12.5, 20) = (2*12.5 + 5, 3*20 + 7) = (30.0, 67.0)
    ///   cx = x-component only = 30.0  (the y-component 67.0 is discarded for cx)
    ///
    ///   vertical centre in text space: (0, font_size * 0.35) = (0, 3.5)
    ///   Tm * (0, 3.5) = (10, 23.5)
    ///   CTM * (10, 23.5) = (2*10 + 5, 3*23.5 + 7) = (25.0, 77.5)
    ///   cy = y-component only = 77.5  (the x-component 25.0 is discarded for cy)
    #[test]
    fn asymmetric_cm_matrix_computes_correct_cx_and_cy() {
        let ops = vec![
            Operation::new(
                "cm",
                vec![2.into(), 0.into(), 0.into(), 3.into(), 5.into(), 7.into()],
            ),
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
            Operation::new("Td", vec![10.into(), 20.into()]),
            Operation::new("Tj", vec![Object::string_literal("A")]),
            Operation::new("ET", vec![]),
        ];
        let slots = enumerate_page_glyphs(
            &Content { operations: ops },
            &simple_fonts(),
            kurbo::Affine::IDENTITY,
        )
        .unwrap();
        assert_eq!(slots.len(), 1);
        assert!(
            (slots[0].cx - 30.0).abs() < 1.0,
            "expected cx ≈ 30.0, got {}",
            slots[0].cx
        );
        assert!(
            (slots[0].cy - 77.5).abs() < 1.0,
            "expected cy ≈ 77.5, got {}",
            slots[0].cy
        );
    }

    // ── Integration test: surgery_simple.pdf fixture ─────────────────────────

    /// Build surgery on a real PDF fixture and verify:
    ///   1. A rect covering the whole page returns Some and the edited stream
    ///      parses as valid lopdf content that differs from the original
    ///      (excision did something).
    ///   2. A rect covering nothing (far corner) returns Some, the stream
    ///      decodes without error (structure intact), and the original text
    ///      bytes are still present (non-destruction is explicit).
    ///
    /// surgery_simple.pdf has MediaBox [0 0 200 50] and contains "Hello".
    #[test]
    fn try_build_surgery_simple_pdf() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/surgery_simple.pdf");
        let doc = lopdf::Document::load(&fixture).expect("surgery_simple.pdf must load");

        let page_id = *doc
            .get_pages()
            .values()
            .next()
            .expect("surgery_simple.pdf must have at least one page");

        // A rect that covers the entire page (MediaBox is [0 0 200 50]).
        let full_page_rect = crate::Rect {
            x0: 0.0,
            y0: 0.0,
            x1: 200.0,
            y1: 50.0,
        };

        let surgery_result = try_build_surgery(&doc, page_id, &[full_page_rect]);
        assert!(
            surgery_result.is_some(),
            "try_build_surgery must return Some for surgery_simple.pdf with a full-page rect"
        );
        let stream_bytes = surgery_result.unwrap();

        // The returned bytes must round-trip through lopdf content parsing.
        let reparsed = lopdf::content::Content::decode(&stream_bytes)
            .expect("returned stream bytes must decode as valid lopdf content");
        assert!(
            !reparsed.operations.is_empty(),
            "decoded content must have at least one operation"
        );

        // Verify that the stream differs from the original (excision appended
        // redaction boxes and rewrote at least the content structure).
        let original_raw = doc.get_page_content(page_id);
        assert_ne!(
            stream_bytes, original_raw,
            "a full-page rect must produce a stream that differs from the original"
        );

        // A rect that is far from any text (near the top-right corner, one point square)
        // should return Some and not corrupt the stream structure.
        let empty_rect = crate::Rect {
            x0: 199.0,
            y0: 49.0,
            x1: 200.0,
            y1: 50.0,
        };
        let no_hit_result = try_build_surgery(&doc, page_id, &[empty_rect]);
        assert!(
            no_hit_result.is_some(),
            "try_build_surgery must return Some for surgery_simple.pdf with a non-hitting rect"
        );
        let no_hit_bytes = no_hit_result.unwrap();
        let _no_hit_parsed = lopdf::content::Content::decode(&no_hit_bytes)
            .expect("no-hit surgery stream must decode as valid lopdf content");
        // The original text bytes must still be present in the non-hitting stream —
        // a no-hit rect must not destroy content.
        assert!(
            no_hit_bytes.windows(5).any(|w| w == b"Hello"),
            "no-hit surgery must preserve the original text bytes"
        );
    }

    /// A page with no `/Resources` in its own dict must still resolve fonts when the
    /// parent `/Pages` node carries `/Resources` with a `/Font` dict.
    #[test]
    fn page_fonts_resolves_inherited_resources_from_parent() {
        let mut d = Document::with_version("1.5");
        // Build a font object.
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1",
            "FirstChar" => 65i64,
            "Widths" => vec![Object::Integer(500)],
        };
        let fid = d.add_object(font);
        // Build a /Resources dict on the parent /Pages node.
        let resources = dictionary! {
            "Font" => dictionary! { "F0" => Object::Reference(fid) }
        };
        // The /Pages node carries /Resources but the page does NOT.
        let pages = d.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![],   // placeholder; updated below
            "Count" => 1i64,
            "Resources" => resources,
        });
        let page = d.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages),
            // NO /Resources here — must inherit from parent
        });
        // Wire the parent's Kids to point to this page (not strictly needed for the
        // test but keeps the document consistent).
        d.get_dictionary_mut(pages)
            .unwrap()
            .set("Kids", Object::Array(vec![Object::Reference(page)]));

        let fonts = page_fonts(&d, page);
        assert!(
            !fonts.is_empty(),
            "page_fonts must resolve inherited /Resources from the parent /Pages node"
        );
        match fonts.get(b"F0".as_ref()) {
            Some(FontMetrics::Supported { widths, .. }) => {
                assert_eq!(widths.get(&65), Some(&500.0));
            }
            other => panic!("expected FontMetrics::Supported for F0, got {other:?}"),
        }
    }

    /// A self-referential `/Parent` chain must not loop: `page_fonts` must return
    /// an empty map rather than hanging.
    #[test]
    fn page_fonts_cyclic_parent_returns_empty() {
        let mut d = Document::with_version("1.5");
        // Create a page object with /Parent pointing to itself — a cycle.
        // We need the object ID before building the dict, so we add a placeholder
        // then replace it.
        let placeholder = d.add_object(dictionary! { "Type" => "Page" });
        // Now overwrite with a self-referential /Parent.
        d.objects.insert(
            placeholder,
            Object::Dictionary(dictionary! {
                "Type" => "Page",
                "Parent" => Object::Reference(placeholder),
                // No /Resources — the walk must hit the cycle guard
            }),
        );
        let fonts = page_fonts(&d, placeholder);
        // The cycle guard fires at 64 iterations; the result is an empty map, not a hang.
        assert!(
            fonts.is_empty(),
            "page_fonts must return an empty map for a cyclic /Parent chain"
        );
    }

    // ── Byte-level splice ────────────────────────────────────────────────────

    /// Build a one-page document whose page content stream is exactly `content_bytes`,
    /// with a single standard-14 font resource named `F1`. Returns the doc and page id.
    pub(super) fn doc_with_content(
        content_bytes: &[u8],
        base_font: &str,
    ) -> (lopdf::Document, lopdf::ObjectId) {
        use lopdf::{dictionary, Object, Stream};
        let mut doc = lopdf::Document::with_version("1.5");
        let font_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Font".to_vec()),
            "Subtype" => Object::Name(b"Type1".to_vec()),
            "BaseFont" => Object::Name(base_font.as_bytes().to_vec()),
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_bytes.to_vec()));
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => pages_id,
            "Contents" => content_id,
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), 200.into(), 200.into()]),
            "Resources" => resources_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => Object::Name(b"Pages".to_vec()),
                "Kids" => Object::Array(vec![page_id.into()]),
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        (doc, page_id)
    }

    #[test]
    fn byte_splice_preserves_inline_image_and_removes_text() {
        // A page with text followed by an inline image whose colorspace lopdf drops on
        // decode (tripping the round-trip guard). The byte splice must remove the text,
        // keep the inline-image bytes byte-identical, and still parse.
        let raw: &[u8] =
            b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
        // Build a tiny doc whose page content is `raw`, with an F1 standard-14 font.
        let (doc, page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");
        let content = lopdf::content::Content::decode(raw).unwrap();

        // Pin the premise this test relies on: the fixture must actually trip the
        // round-trip guard (encode-then-decode losing operations, or failing outright —
        // `try_build_surgery`'s guard treats a decode failure the same as a count
        // mismatch), otherwise it stops exercising the byte-splice path and silently
        // degrades to testing nothing new.
        let reencoded = content.encode().unwrap();
        let after = lopdf::content::Content::decode(&reencoded)
            .ok()
            .map(|c| c.operations.len());
        assert_ne!(
            after,
            Some(content.operations.len()),
            "fixture must trip the round-trip guard (else it is not exercising the byte path)"
        );

        let fonts = page_fonts(&doc, page_id);
        let slots = enumerate_page_glyphs(&content, &fonts, kurbo::Affine::IDENTITY).unwrap();
        let rects = [Rect {
            x0: -1.0,
            y0: -1.0,
            x1: 1000.0,
            y1: 1000.0,
        }];
        let marked = mark_in_rects(&slots, &rects);
        assert!(!marked.is_empty(), "the text must be inside the rect");

        let replacements = op_replacements(&content, &slots, &marked, &fonts);
        let boxes = fill_box_operations(&rects);
        let out = build_byte_splice(raw, &content.operations, &replacements, &boxes)
            .expect("byte splice must succeed");

        // Inline-image bytes survive verbatim.
        assert!(
            out.windows(4).any(|w| w == b"\x01\x02\x03\x04"),
            "inline image data must be preserved"
        );
        assert!(out.windows(2).any(|w| w == b"BI"), "BI operator preserved");
        assert!(
            out.windows(2).any(|w| w == b"EI"),
            "EI terminator preserved"
        );
        // The literal "Hello" no longer appears as a shown string.
        assert!(
            !out.windows(5).any(|w| w == b"Hello"),
            "marked text must be gone"
        );
        // Output still decodes.
        lopdf::content::Content::decode(&out).expect("spliced stream must decode");
    }

    #[test]
    fn byte_splice_self_check_flattens_on_operator_desync() {
        // If the operations list disagrees with the raw bytes, the splice must refuse.
        let raw: &[u8] = b"BT (Hi) Tj ET";
        let mut bogus = lopdf::content::Content::decode(raw).unwrap().operations;
        bogus.push(lopdf::content::Operation::new("Tj", vec![])); // extra op, not in raw
        let out = build_byte_splice(raw, &bogus, &BTreeMap::new(), &[]);
        assert!(out.is_none(), "count mismatch must return None");
    }

    #[test]
    fn byte_splice_self_check_flattens_on_operator_name_desync() {
        // Same operation COUNT as `raw` (so the count check alone would pass), but one
        // operator's name has been changed from what the tokenizer sees in `raw` — the
        // per-index operator-name comparison must catch this desync on its own.
        let raw: &[u8] = b"BT (Hi) Tj ET";
        let mut mutated = lopdf::content::Content::decode(raw).unwrap().operations;
        let tj_index = mutated
            .iter()
            .position(|op| op.operator == "Tj")
            .expect("raw must contain a Tj operator");
        mutated[tj_index].operator = "TJ".to_string();

        let out = build_byte_splice(raw, &mutated, &BTreeMap::new(), &[]);
        assert!(
            out.is_none(),
            "operator-name mismatch at equal length must return None"
        );
    }

    #[test]
    fn byte_splice_boxes_only_appends_without_replacements() {
        // No glyph marked (empty replacements), but a redaction box must still be
        // drawn — the path used when a rect covers no text (e.g. an image region).
        let raw: &[u8] = b"BT (Hi) Tj ET";
        let content = lopdf::content::Content::decode(raw).unwrap();
        let rects = [Rect {
            x0: 10.0,
            y0: 10.0,
            x1: 20.0,
            y1: 20.0,
        }];
        let boxes = fill_box_operations(&rects);
        let encoded_boxes = encode_operations(&boxes).unwrap();

        let out = build_byte_splice(raw, &content.operations, &BTreeMap::new(), &boxes)
            .expect("byte splice must succeed with no replacements");

        let mut expected = raw.to_vec();
        expected.push(b' ');
        expected.extend_from_slice(&encoded_boxes);
        assert_eq!(
            out, expected,
            "output must equal raw bytes plus the encoded boxes appended"
        );

        lopdf::content::Content::decode(&out).expect("spliced stream must decode");
    }

    #[test]
    fn inline_image_page_surgers_via_byte_path() {
        // The same inline-image page as the byte-splice test above, end-to-end through
        // try_build_surgery. Previously this flattened (round-trip guard); now it must
        // return Some via the byte-path branch.
        let raw: &[u8] =
            b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
        let (doc, page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");

        // Confirm the round-trip guard would have tripped (precondition for the byte-path).
        // This fixture's re-encoded bytes fail to re-decode outright (not merely a
        // differing operation count), which content_roundtrips treats as non-round-tripping.
        let content = lopdf::content::Content::decode(raw).unwrap();
        assert!(
            !content_roundtrips(&content),
            "guard must trip for this fixture"
        );

        let rects = [Rect {
            x0: -1.0,
            y0: -1.0,
            x1: 1000.0,
            y1: 1000.0,
        }];
        let out = try_build_surgery(&doc, page_id, &rects).expect("byte-path must surger");
        assert!(
            out.windows(4).any(|w| w == b"\x01\x02\x03\x04"),
            "inline image preserved"
        );
        assert!(!out.windows(5).any(|w| w == b"Hello"), "text removed");
    }

    #[test]
    fn compare_surgery_paths_reports_both_writers() {
        // Same inline-image fixture as the byte-splice tests above, redacted with a
        // full-page rect so the image also falls inside the redaction target.
        //
        // The round-trip guard fails for this fixture (lopdf's whole-stream
        // `Content::encode()` cannot faithfully re-serialize this inline image), so
        // production would never run the op-path here — it forces a raster flatten
        // instead. The diagnostic now mirrors that: op_path is reported as Flattened
        // rather than gating whatever `op_path_write` happens to produce (which, left
        // ungated, silently collapses the inline image to a bare `BI` operator that
        // hayro's reader can't parse past — a truncation, not a safe removal — and
        // could otherwise be misread by the gate as a clean, "Surgered" page).
        //
        // byte_path == Flattened: the byte-splice faithfully preserves the inline
        // image untouched, so the surgered candidate still has a real image sitting
        // under the redaction box. The outcome gate's image-cover check correctly
        // rejects this as recoverable (the pixels survive; deleting the box would
        // reveal them), so byte_path legitimately fails the gate here.
        //
        // Net result: an inline image inside the redaction rect has no safe surgical
        // path — both writers correctly fall back to Flattened, matching production's
        // raster-flatten behavior for this page.
        let raw: &[u8] =
            b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
        let (doc, _page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");
        let mut pdf = Vec::new();
        {
            let mut d = doc;
            d.save_to(&mut pdf).unwrap();
        }
        let rects = [Rect {
            x0: -1.0,
            y0: -1.0,
            x1: 1000.0,
            y1: 1000.0,
        }];
        let cmp = crate::surgery::compare_surgery_paths(&pdf, 0, &rects).unwrap();
        assert_eq!(cmp.op_path, crate::surgery::SurgeryDisposition::Flattened);
        assert_eq!(cmp.byte_path, crate::surgery::SurgeryDisposition::Flattened);
    }

    #[test]
    fn compare_surgery_paths_recovers_when_image_is_outside_the_target() {
        // The realistic case where the byte-path recovers a page the op-path would
        // flatten: redact only a name-sized region of text; an
        // unrelated inline image lives elsewhere on the page (translated away from the
        // target via `cm`), so it is neither excised nor covered by the redaction box.
        //
        // The round-trip guard still fails for this fixture (same inline image lopdf
        // cannot faithfully re-encode), so op_path == Flattened — production would
        // never run the op-path here either. But the byte-path surgers cleanly: text
        // in the rect is removed, the unrelated image outside the rect is preserved
        // byte-identical, and the gate passes because nothing covering the redaction
        // rect survives. This is the real `byte_path_recovers` case the byte-splice
        // exists for — a page that used to force a full-page raster flatten (because
        // ANY inline image tripped the round-trip guard) now keeps its live text and
        // its unrelated image intact via the byte-path alone.
        let raw: &[u8] =
            b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq 1 0 0 1 300 300 cm BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
        let (doc, _page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");
        let mut pdf = Vec::new();
        {
            let mut d = doc;
            d.save_to(&mut pdf).unwrap();
        }
        // Cover only the "Hello" text near the origin; well clear of the image at (300,300).
        let rects = [Rect {
            x0: -1.0,
            y0: -1.0,
            x1: 50.0,
            y1: 20.0,
        }];
        let cmp = crate::surgery::compare_surgery_paths(&pdf, 0, &rects).unwrap();
        assert_eq!(cmp.op_path, crate::surgery::SurgeryDisposition::Flattened);
        assert_eq!(cmp.byte_path, crate::surgery::SurgeryDisposition::Surgered);
    }
}
