//! What a filled text field looks like: measuring Helvetica, fitting text to a widget's box,
//! and writing the appearance stream a viewer draws.

use super::*;

// ── Helvetica glyph-width measurement ─────────────────────────────────────────

/// Advance width in glyph-space units (1000 = 1 em) for `ch` in Helvetica via
/// the WinAnsi code-to-glyph-name mapping.
///
/// Returns 0.0 for code-points ≥ 256, slots with no glyph name assigned, and
/// glyph names absent from the Helvetica metrics table.
fn helvetica_advance(ch: char) -> f32 {
    // A character the encoding cannot hold is drawn as a question mark, so it is measured
    // as one.
    crate::bates::font_advance(
        crate::bates::BatesFont::Helvetica,
        if crate::bates::win_ansi_code(ch).is_some() {
            ch
        } else {
            '?'
        },
    )
}

/// Width in points of `text` rendered in Helvetica at `size_pt`.
///
/// Each character is looked up via the WinAnsi encoding. Characters outside the
/// WinAnsi range or absent from the metrics table contribute 0.0.
pub(crate) fn helvetica_text_width(text: &str, size_pt: f32) -> f32 {
    let glyph_units: f32 = text.chars().map(helvetica_advance).sum();
    (glyph_units / 1000.0) * size_pt
}

// ── Appearance stream generation ───────────────────────────────────────────────

/// Space kept between a field's edge and its text, in points.
pub(super) const FIELD_PADDING: f32 = 2.0;
/// The smallest size text is shrunk to when a field sizes its own text. Below this it is
/// not legible on paper, so the text is clipped by the box instead.
pub(super) const MINIMUM_AUTOMATIC_SIZE: f32 = 4.0;
/// The size a field that sizes its own text starts from when it holds several lines.
pub(super) const MULTILINE_AUTOMATIC_SIZE: f32 = 12.0;
/// Distance between baselines, as a multiple of the font size.
pub(super) const LINE_SPACING: f32 = 1.15;
/// How far below the top of its line Helvetica's baseline sits, as a multiple of the size.
pub(super) const ASCENT: f32 = 0.8;

fn alignment_offset(quadding: i64, box_width: f32, text_width: f32) -> f32 {
    match quadding {
        1 => ((box_width - text_width) / 2.0).max(FIELD_PADDING),
        2 => (box_width - text_width - FIELD_PADDING).max(FIELD_PADDING),
        _ => FIELD_PADDING,
    }
}

fn appearance_stream(
    doc: &mut Document,
    width: f32,
    height: f32,
    font_id: ObjectId,
    content: Vec<u8>,
) -> ObjectId {
    let font_resources = dictionary! {
        "MagnaCartaFormFont" => Object::Reference(font_id),
    };
    let resources = dictionary! {
        "Font" => Object::Dictionary(font_resources),
    };
    let stream_dict = dictionary! {
        "Type" => Object::Name(b"XObject".to_vec()),
        "Subtype" => Object::Name(b"Form".to_vec()),
        "FormType" => Object::Integer(1),
        "BBox" => Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(width),
            Object::Real(height),
        ]),
        "Resources" => Object::Dictionary(resources),
    };
    doc.add_object(Object::Stream(Stream::new(stream_dict, content)))
}

/// Build a Form XObject appearance stream for a text field.
///
/// The returned `ObjectId` references a `/Type /XObject /Subtype /Form` stream
/// whose content paints `value` horizontally aligned per `quadding`:
/// 0 = left, 1 = centre, 2 = right.
///
/// `da_size` is the font size from the field's `/DA` entry; pass `0.0` to let
/// the function derive the size from the widget height (clamped to [6, 12] pt)
/// and then shrink it until the value fits the widget's width, which is what a
/// size of zero asks a viewer to do. A fixed size is never changed: text wider
/// than the box is clipped by it, as a viewer clips it.
/// `font_id` must be the `ObjectId` of a Type 1 font object already added to
/// `doc` — the caller creates this once per document and passes it here so all
/// appearance streams can share it.
pub(crate) fn text_appearance(
    doc: &mut Document,
    rect: [f32; 4],
    da_size: f32,
    quadding: i64,
    font_id: ObjectId,
    value: &str,
) -> ObjectId {
    let w = rect[2] - rect[0];
    let h = rect[3] - rect[1];
    let size = if da_size > 0.0 {
        da_size
    } else {
        let by_height = (h * 0.6).clamp(6.0, 12.0);
        let room = w - 2.0 * FIELD_PADDING;
        let needed = helvetica_text_width(value, by_height);
        if needed > room && room > 0.0 {
            (by_height * room / needed).max(MINIMUM_AUTOMATIC_SIZE)
        } else {
            by_height
        }
    };

    let text_width = helvetica_text_width(value, size);
    let tx = alignment_offset(quadding, w, text_width);
    let ty = ((h - size) / 2.0 + size * 0.2).max(2.0);

    // The field's value keeps every character it was given; only this drawn appearance is
    // limited to what the font's encoding holds, with a question mark for the rest.
    let mut content =
        format!("/Tx BMC q BT /MagnaCartaFormFont {size:.2} Tf 0 g {tx:.2} {ty:.2} Td (")
            .into_bytes();
    content.extend(crate::bates::win_ansi_literal_lossy(value));
    content.extend_from_slice(b") Tj ET Q EMC");
    appearance_stream(doc, w, h, font_id, content)
}

/// Break `value` into the lines it is drawn as in a box `room` points wide: at each line
/// break the value itself holds, and between words where a line would run past the edge. A
/// single word wider than the box is broken between characters, so nothing is lost off the
/// side.
pub(crate) fn wrap_lines(value: &str, size: f32, room: f32) -> Vec<String> {
    let mut lines = Vec::new();
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    for paragraph in normalized.split('\n') {
        let mut line = String::new();
        for word in paragraph.split(' ') {
            let candidate = if line.is_empty() {
                word.to_string()
            } else {
                format!("{line} {word}")
            };
            if helvetica_text_width(&candidate, size) <= room {
                line = candidate;
                continue;
            }
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            for character in word.chars() {
                let mut longer = line.clone();
                longer.push(character);
                if !line.is_empty() && helvetica_text_width(&longer, size) > room {
                    lines.push(std::mem::replace(&mut line, character.to_string()));
                } else {
                    line = longer;
                }
            }
        }
        lines.push(line);
    }
    lines
}

/// Build the appearance of a text field that holds several lines: the value wrapped to the
/// box's width and set from the top down.
///
/// A `da_size` of zero lets the field size its own text: it starts at 12 points and shrinks
/// until every line fits the box's height or the smallest legible size is reached. Lines
/// that still do not fit are clipped by the box, as a viewer shows them until the field is
/// scrolled; the field's value keeps all of them.
pub(crate) fn multiline_text_appearance(
    doc: &mut Document,
    rect: [f32; 4],
    da_size: f32,
    quadding: i64,
    font_id: ObjectId,
    value: &str,
) -> ObjectId {
    let w = rect[2] - rect[0];
    let h = rect[3] - rect[1];
    let room = (w - 2.0 * FIELD_PADDING).max(1.0);
    let height_needed =
        |size: f32, lines: usize| 2.0 * FIELD_PADDING + lines as f32 * size * LINE_SPACING;

    let (size, lines) = if da_size > 0.0 {
        (da_size, wrap_lines(value, da_size, room))
    } else {
        let mut size = MULTILINE_AUTOMATIC_SIZE;
        loop {
            let lines = wrap_lines(value, size, room);
            if height_needed(size, lines.len()) <= h || size <= MINIMUM_AUTOMATIC_SIZE {
                break (size, lines);
            }
            size = (size - 0.5).max(MINIMUM_AUTOMATIC_SIZE);
        }
    };

    let mut content = format!("/Tx BMC q BT /MagnaCartaFormFont {size:.2} Tf 0 g\n").into_bytes();
    for (index, line) in lines.iter().enumerate() {
        let baseline = h - FIELD_PADDING - size * ASCENT - index as f32 * size * LINE_SPACING;
        if baseline + size < 0.0 {
            // Wholly below the box: it would be clipped away, so it is not written.
            break;
        }
        if line.is_empty() {
            continue;
        }
        let x = alignment_offset(quadding, w, helvetica_text_width(line, size));
        content.extend(format!("1 0 0 1 {x:.2} {baseline:.2} Tm (").into_bytes());
        content.extend(crate::bates::win_ansi_literal_lossy(line));
        content.extend_from_slice(b") Tj\n");
    }
    content.extend_from_slice(b"ET Q EMC");
    appearance_stream(doc, w, h, font_id, content)
}
