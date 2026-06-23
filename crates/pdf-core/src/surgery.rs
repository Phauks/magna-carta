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

use kurbo::Affine;
use lopdf::{content::Content, Object, ObjectId};

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
    // page_height_pt is accepted for interface consistency with the display-point
    // coordinate frame contract. Content-stream coordinates are already in
    // PDF user space (bottom-left origin); no y-flip is performed here.
    _page_height_pt: f32,
) -> Result<Vec<GlyphSlot>, ()> {
    // ── Graphics state ────────────────────────────────────────────────────────
    // The CTM stack starts with the identity transform. `q` pushes a copy; `Q`
    // pops. `cm` pre-multiplies the top element.
    let mut ctm_stack: Vec<Affine> = vec![Affine::IDENTITY];

    // ── Text state ────────────────────────────────────────────────────────────
    // `in_text` is true between BT and ET. The line matrix and text matrix are
    // reset to identity on BT.
    let mut in_text = false;
    let mut text_matrix = Affine::IDENTITY;
    let mut line_matrix = Affine::IDENTITY;

    // Text state parameters (PDF §9.3).
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
                                if let Some(n) = number_from_object(element) {
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
            "\"" => {
                if in_text {
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
    let a = number_from_object(&operands[0])? as f64;
    let b = number_from_object(&operands[1])? as f64;
    let c = number_from_object(&operands[2])? as f64;
    let d = number_from_object(&operands[3])? as f64;
    let e = number_from_object(&operands[4])? as f64;
    let f = number_from_object(&operands[5])? as f64;
    Some(Affine::new([a, b, c, d, e, f]))
}

/// Extract the n-th operand as an f32, accepting both `Integer` and `Real`.
fn number_from_operand(operands: &[Object], index: usize) -> Option<f32> {
    operands.get(index).and_then(number_from_object)
}

/// Extract a number from any `Object` that carries one.
fn number_from_object(obj: &Object) -> Option<f32> {
    match obj {
        Object::Integer(n) => Some(*n as f32),
        Object::Real(r) => Some(*r),
        _ => None,
    }
}

/// Extract the raw bytes of a string operand at `index` (covers both literal and hex strings).
fn string_bytes_from_operand(operands: &[Object], index: usize) -> Option<&[u8]> {
    match operands.get(index)? {
        Object::String(bytes, _) => Some(bytes),
        _ => None,
    }
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

    // ── Task 2: glyph enumeration tests ──────────────────────────────────────

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
        let slots = enumerate_page_glyphs(&content, &simple_fonts(), 792.0).unwrap();
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
        let slots =
            enumerate_page_glyphs(&Content { operations: ops }, &simple_fonts(), 792.0).unwrap();
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
        assert!(enumerate_page_glyphs(&Content { operations: ops }, &fonts, 792.0).is_err());
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
        let slots =
            enumerate_page_glyphs(&Content { operations: ops }, &simple_fonts(), 792.0).unwrap();
        // origin 50*2=100; advance also scaled: half-advance = 2.5*2=5.0
        assert!((slots[0].cx - (100.0 + 2.5 * 2.0)).abs() < 1.0);
    }
}
