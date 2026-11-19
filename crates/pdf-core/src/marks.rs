//! Marks drawn into boxes on existing pages: the signatures, initials, names, dates and ticks a
//! signer gave, placed where the sender put each field. Like the watermark it is ADDITIVE: it
//! draws on top and removes nothing.
//!
//! A mark's box is in displayed page points from the displayed page's bottom-left corner, the
//! frame a reader sees and the frame the PDF Editor records a field in. A page turned with
//! `/Rotate` is drawn through the same display-to-user frame the Bates stamp uses
//! (`surgery::text_matrix`), so a mark lands where its field was drawn whatever the page's turn.
//!
//! The same picture placed in several boxes (one adopted signature, many signature fields) is
//! embedded once and drawn from each box, so a document with forty initials carries one image.

use std::collections::HashMap;

use crate::bates::{label_width_pt, win_ansi_literal, BatesFont};
use crate::generate::GenerateError;
use crate::surgery::{resolve_inherited_resources, resolve_mediabox, resolve_rotate, text_matrix};
use crate::watermark::{append_content, image_xobject, sub_dict};
use lopdf::{dictionary, Document, Object, ObjectId};

/// One mark: what to draw, and the box it fills.
pub struct Mark {
    /// The page, counted from 1.
    pub page: usize,
    /// Left, bottom, right, top, in displayed page points from the displayed bottom-left corner.
    pub rect: [f32; 4],
    pub content: MarkContent,
}

/// One page's share of the work: the drawing, and the pictures and fonts it names.
#[derive(Default)]
struct PageDrawing {
    content: Vec<u8>,
    xobjects: Vec<(String, ObjectId)>,
    fonts: Vec<(String, ObjectId)>,
}

/// What a mark draws.
pub enum MarkContent {
    /// A PNG or JPEG, scaled to fit inside the box without stretching and centred in it.
    Image(Vec<u8>),
    /// One line of text in a standard font, sized to the box and set from its left edge, centred
    /// on the box's height. Windows-1252 only; any other character is refused.
    Text { text: String, font: BatesFont },
    /// A tick, drawn as two strokes inside the box.
    Check,
}

/// The most marks one call takes. A real request has tens; this bounds an adversarial list.
pub const MAX_MARKS: usize = 5_000;

/// The share of a box's height a line of text is set at, so ascenders and descenders fit.
const TEXT_HEIGHT_SHARE: f32 = 0.7;
/// The smallest text drawn. Below this a name is not legible, and the box was too small.
const MIN_TEXT_SIZE_PT: f32 = 4.0;
/// The inset kept between a box's edge and what is drawn in it.
const INSET_PT: f32 = 1.5;

/// Draw `marks` onto the document, returning the new bytes.
pub fn place_marks(bytes: &[u8], marks: &[Mark]) -> Result<Vec<u8>, GenerateError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| GenerateError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    if crate::guard::is_locked(&doc) {
        return Err(GenerateError::Encrypted);
    }
    if marks.len() > MAX_MARKS {
        return Err(GenerateError::Rejected);
    }
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    if pages.is_empty() {
        return Err(GenerateError::NoPages);
    }
    // Every box is checked before anything is written, so a bad mark changes nothing.
    for mark in marks {
        if mark.page == 0 || mark.page > pages.len() {
            return Err(GenerateError::PageOutOfRange);
        }
        let [left, bottom, right, top] = mark.rect;
        if ![left, bottom, right, top]
            .iter()
            .all(|value| value.is_finite())
            || right <= left
            || top <= bottom
        {
            return Err(GenerateError::PageOutOfRange);
        }
        if let MarkContent::Text { text, .. } = &mark.content {
            win_ansi_literal(text).map_err(|_| GenerateError::UnsupportedCharacter)?;
        }
    }

    let mut images: HashMap<&[u8], (ObjectId, f32, f32)> = HashMap::new();
    let mut fonts: HashMap<&'static str, ObjectId> = HashMap::new();
    let mut drawings: Vec<PageDrawing> = (0..pages.len()).map(|_| PageDrawing::default()).collect();

    for mark in marks {
        let index = mark.page - 1;
        let [left, bottom, right, top] = mark.rect;
        let (box_left, box_bottom) = (left + INSET_PT, bottom + INSET_PT);
        let box_width = (right - left - 2.0 * INSET_PT).max(0.0);
        let box_height = (top - bottom - 2.0 * INSET_PT).max(0.0);
        let PageDrawing {
            content,
            xobjects,
            fonts: font_names,
        } = &mut drawings[index];
        match &mark.content {
            MarkContent::Image(data) => {
                let (image_id, pixel_width, pixel_height) = match images.get(data.as_slice()) {
                    Some(found) => *found,
                    None => {
                        let made = image_xobject(&mut doc, data)?;
                        images.insert(data.as_slice(), made);
                        made
                    }
                };
                let name = format!("MagnaCartaMark{}", image_id.0);
                if !xobjects.iter().any(|(existing, _)| *existing == name) {
                    xobjects.push((name.clone(), image_id));
                }
                let scale = (box_width / pixel_width).min(box_height / pixel_height);
                let (width, height) = (pixel_width * scale, pixel_height * scale);
                let x = box_left + (box_width - width) / 2.0;
                let y = box_bottom + (box_height - height) / 2.0;
                content.extend_from_slice(
                    format!("q {width:.3} 0 0 {height:.3} {x:.3} {y:.3} cm /{name} Do Q ")
                        .as_bytes(),
                );
            }
            MarkContent::Text { text, font } => {
                let postscript = font.postscript_name();
                let font_id = match fonts.get(postscript) {
                    Some(id) => *id,
                    None => {
                        let id = doc.add_object(dictionary! {
                            b"Type" => Object::Name(b"Font".to_vec()),
                            b"Subtype" => Object::Name(b"Type1".to_vec()),
                            b"BaseFont" => Object::Name(postscript.as_bytes().to_vec()),
                            b"Encoding" => Object::Name(b"WinAnsiEncoding".to_vec()),
                        });
                        fonts.insert(postscript, id);
                        id
                    }
                };
                let name = format!("MagnaCartaMarkFont{}", font_id.0);
                if !font_names.iter().any(|(existing, _)| *existing == name) {
                    font_names.push((name.clone(), font_id));
                }
                let width_at_one = label_width_pt(*font, text, 1.0);
                let mut size = box_height * TEXT_HEIGHT_SHARE;
                if width_at_one > 0.0 {
                    size = size.min(box_width / width_at_one);
                }
                let size = size.max(MIN_TEXT_SIZE_PT);
                let baseline = box_bottom + (box_height - size) / 2.0 + size * 0.2;
                let literal =
                    win_ansi_literal(text).map_err(|_| GenerateError::UnsupportedCharacter)?;
                content.extend_from_slice(
                    format!("BT /{name} {size:.2} Tf 0 g {box_left:.3} {baseline:.3} Td (")
                        .as_bytes(),
                );
                content.extend_from_slice(&literal);
                content.extend_from_slice(b") Tj ET ");
            }
            MarkContent::Check => {
                let side = box_width.min(box_height);
                let x = box_left + (box_width - side) / 2.0;
                let y = box_bottom + (box_height - side) / 2.0;
                let line = (side * 0.12).max(0.75);
                let (x1, y1) = (x + side * 0.15, y + side * 0.5);
                let (x2, y2) = (x + side * 0.4, y + side * 0.2);
                let (x3, y3) = (x + side * 0.85, y + side * 0.85);
                content.extend_from_slice(
                    format!(
                        "q 0 G {line:.3} w 1 J 1 j {x1:.3} {y1:.3} m {x2:.3} {y2:.3} l \
                         {x3:.3} {y3:.3} l S Q "
                    )
                    .as_bytes(),
                );
            }
        }
    }

    for (index, drawing) in drawings.into_iter().enumerate() {
        let PageDrawing {
            content,
            xobjects,
            fonts: font_names,
        } = drawing;
        if content.is_empty() {
            continue;
        }
        let page = pages[index];
        let [llx, lly, urx, ury] = resolve_mediabox(&doc, page).ok_or(GenerateError::Parse)?;
        let rotation = resolve_rotate(&doc, page).rem_euclid(360);
        let [a, b, c, d, e, f] = text_matrix(rotation, llx, lly, urx - llx, ury - lly, 0.0, 0.0);

        let mut resources = resolve_inherited_resources(&doc, page)
            .cloned()
            .unwrap_or_default();
        if !xobjects.is_empty() {
            let mut entries = sub_dict(&doc, &resources, b"XObject");
            for (name, id) in xobjects {
                entries.set(name.into_bytes(), Object::Reference(id));
            }
            resources.set("XObject", Object::Dictionary(entries));
        }
        if !font_names.is_empty() {
            let mut entries = sub_dict(&doc, &resources, b"Font");
            for (name, id) in font_names {
                entries.set(name.into_bytes(), Object::Reference(id));
            }
            resources.set("Font", Object::Dictionary(entries));
        }
        if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page) {
            page_dict.set("Resources", Object::Dictionary(resources));
        }

        // The page's own drawing may leave the graphics state anywhere, so the marks start from
        // a clean one: the existing streams are wrapped in q/Q by the leading stream below.
        let mut stream = format!("q {a:.5} {b:.5} {c:.5} {d:.5} {e:.3} {f:.3} cm ").into_bytes();
        stream.extend_from_slice(&content);
        stream.push(b'Q');
        wrap_existing(&mut doc, page)?;
        append_content(&mut doc, page, stream)?;
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|_| GenerateError::Reassemble)?;
    Ok(out)
}

/// Put the page's existing content between `q` and `Q`, so a transform it leaves standing (a
/// stream that ends without restoring its state is legal and common) cannot move the marks.
fn wrap_existing(doc: &mut Document, page: ObjectId) -> Result<(), GenerateError> {
    let existing = doc
        .get_dictionary(page)
        .ok()
        .and_then(|dict| dict.get(b"Contents").ok().cloned());
    let mut streams = match existing {
        Some(Object::Reference(id)) => vec![Object::Reference(id)],
        Some(Object::Array(entries)) => entries,
        _ => return Ok(()),
    };
    let open = doc.add_object(Object::Stream(lopdf::Stream::new(
        lopdf::Dictionary::new(),
        b"q\n".to_vec(),
    )));
    let close = doc.add_object(Object::Stream(lopdf::Stream::new(
        lopdf::Dictionary::new(),
        b"\nQ".to_vec(),
    )));
    streams.insert(0, Object::Reference(open));
    streams.push(Object::Reference(close));
    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page) {
        page_dict.set("Contents", Object::Array(streams));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream;

    fn page_document(rotation: i64) -> Vec<u8> {
        sized_page_document([612, 792], rotation)
    }

    fn sized_page_document(size: [i64; 2], rotation: i64) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        // A stream that leaves a scale standing, as real producers do.
        let content_id = doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"2 0 0 2 0 0 cm 0 0 1 rg 10 10 50 50 re f".to_vec(),
        )));
        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(size[0]), Object::Integer(size[1]),
            ]),
            b"Rotate" => Object::Integer(rotation),
            b"Contents" => Object::Reference(content_id),
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                b"Type" => Object::Name(b"Pages".to_vec()),
                b"Kids" => Object::Array(vec![Object::Reference(page_id)]),
                b"Count" => Object::Integer(1),
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Catalog".to_vec()),
            b"Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set(b"Root", Object::Reference(catalog_id));
        let mut out = Vec::new();
        doc.save_to(&mut out).expect("serialise");
        out
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode png");
        out.into_inner()
    }

    fn page_text(bytes: &[u8]) -> String {
        let doc = Document::load_mem(bytes).expect("reload");
        let page = *doc.get_pages().values().next().expect("a page");
        String::from_utf8_lossy(&doc.get_page_content(page)).into_owned()
    }

    fn image_count(bytes: &[u8]) -> usize {
        let doc = Document::load_mem(bytes).expect("reload");
        doc.objects
            .values()
            .filter(|object| match object {
                Object::Stream(stream) => stream
                    .dict
                    .get(b"Subtype")
                    .map(|value| value == &Object::Name(b"Image".to_vec()))
                    .unwrap_or(false),
                _ => false,
            })
            .count()
    }

    #[test]
    fn draws_each_kind_and_embeds_a_repeated_picture_once() {
        let signature = png(300, 100);
        let marks = vec![
            Mark {
                page: 1,
                rect: [72.0, 100.0, 252.0, 130.0],
                content: MarkContent::Image(signature.clone()),
            },
            Mark {
                page: 1,
                rect: [72.0, 300.0, 252.0, 330.0],
                content: MarkContent::Image(signature),
            },
            Mark {
                page: 1,
                rect: [300.0, 100.0, 450.0, 120.0],
                content: MarkContent::Text {
                    text: "Zoë Müller".to_string(),
                    font: BatesFont::Helvetica,
                },
            },
            Mark {
                page: 1,
                rect: [72.0, 400.0, 86.0, 414.0],
                content: MarkContent::Check,
            },
        ];
        let out = place_marks(&page_document(0), &marks).expect("placed");
        assert_eq!(image_count(&out), 1, "one picture, drawn twice");
        let text = page_text(&out);
        assert_eq!(text.matches(" Do Q").count(), 2);
        assert!(text.contains(" Tj ET"));
        assert!(text.contains(" l S Q"));
        // The original drawing is closed off before the marks start.
        assert!(text.starts_with("q\n"));
    }

    #[test]
    fn a_picture_keeps_its_shape_and_sits_centred_in_its_box() {
        // A 3:1 picture in a 180 x 30 box (27 tall inside the inset) is 81 wide, centred.
        let marks = vec![Mark {
            page: 1,
            rect: [72.0, 100.0, 252.0, 130.0],
            content: MarkContent::Image(png(300, 100)),
        }];
        let text = page_text(&place_marks(&page_document(0), &marks).expect("placed"));
        assert!(
            text.contains("81.000 0 0 27.000 121.500 101.500 cm"),
            "{text}"
        );
    }

    #[test]
    fn a_turned_page_draws_through_the_display_frame() {
        let marks = vec![Mark {
            page: 1,
            rect: [10.0, 10.0, 100.0, 40.0],
            content: MarkContent::Check,
        }];
        let text = page_text(&place_marks(&page_document(90), &marks).expect("placed"));
        assert!(
            text.contains("q 0.00000 1.00000 -1.00000 0.00000 612.000 0.000 cm"),
            "{text}"
        );
    }

    /// Where a name drawn into the same displayed box lands, read back by the page reader.
    fn name_centre(size: [i64; 2], rotation: i64) -> (f64, f64) {
        let marks = vec![Mark {
            page: 1,
            rect: [100.0, 50.0, 300.0, 80.0],
            content: MarkContent::Text {
                text: "Jordan Smith".to_string(),
                font: BatesFont::Helvetica,
            },
        }];
        let out = place_marks(&sized_page_document(size, rotation), &marks).expect("placed");
        let pdf = hayro::hayro_syntax::Pdf::new(out).expect("hayro parses");
        let observed = crate::textpos::observe_page(&pdf, 0).expect("observe");
        let centres: Vec<kurbo::Point> = observed
            .glyphs
            .iter()
            .filter(|glyph| !glyph.text.is_empty())
            .map(|glyph| glyph.bbox.center())
            .collect();
        assert!(
            !centres.is_empty(),
            "the name must be drawn at r={rotation}"
        );
        let count = centres.len() as f64;
        (
            centres.iter().map(|point| point.x).sum::<f64>() / count,
            centres.iter().map(|point| point.y).sum::<f64>() / count,
        )
    }

    #[test]
    fn a_mark_lands_in_the_same_displayed_box_whatever_the_turn() {
        // A landscape page drawn flat, and a portrait page turned to display at the same size.
        let flat = name_centre([792, 612], 0);
        assert!(
            flat.0 > 100.0 && flat.0 < 300.0,
            "the name sits inside its box: {flat:?}"
        );
        for rotation in [90, 180, 270] {
            let size = if rotation == 180 {
                [792, 612]
            } else {
                [612, 792]
            };
            let turned = name_centre(size, rotation);
            assert!(
                (turned.0 - flat.0).abs() < 3.0 && (turned.1 - flat.1).abs() < 3.0,
                "r={rotation}: flat={flat:?} turned={turned:?}"
            );
        }
    }

    #[test]
    fn refuses_a_bad_mark_before_writing_anything() {
        let source = page_document(0);
        let past_the_end = Mark {
            page: 2,
            rect: [0.0, 0.0, 10.0, 10.0],
            content: MarkContent::Check,
        };
        assert_eq!(
            place_marks(&source, &[past_the_end]).err(),
            Some(GenerateError::PageOutOfRange)
        );
        let inside_out = Mark {
            page: 1,
            rect: [10.0, 10.0, 0.0, 0.0],
            content: MarkContent::Check,
        };
        assert_eq!(
            place_marks(&source, &[inside_out]).err(),
            Some(GenerateError::PageOutOfRange)
        );
        let undrawable = Mark {
            page: 1,
            rect: [0.0, 0.0, 100.0, 20.0],
            content: MarkContent::Text {
                text: "\u{4e2d}".to_string(),
                font: BatesFont::Helvetica,
            },
        };
        assert_eq!(
            place_marks(&source, &[undrawable]).err(),
            Some(GenerateError::UnsupportedCharacter)
        );
        let not_a_picture = Mark {
            page: 1,
            rect: [0.0, 0.0, 100.0, 20.0],
            content: MarkContent::Image(b"not a picture".to_vec()),
        };
        assert_eq!(
            place_marks(&source, &[not_a_picture]).err(),
            Some(GenerateError::Image)
        );
    }
}
