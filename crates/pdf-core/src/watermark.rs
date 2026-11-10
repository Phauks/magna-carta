//! Watermark overlay — a centred or tiled text/image mark on every page, at a chosen
//! opacity and rotation. Like Bates numbering it is ADDITIVE: it draws on top and removes
//! nothing. Use `redact`/`sanitize` to remove content. The overlay reuses the Bates font
//! machinery (text) and the redaction image-XObject pattern (image).

use crate::bates::{label_width_pt, win_ansi_literal, BatesFont};
use crate::generate::GenerateError;
use crate::surgery::{resolve_dict, resolve_inherited_resources, resolve_mediabox, resolve_rotate};
use image::GenericImageView;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

/// How to watermark a document.
pub struct WatermarkOptions {
    pub content: WatermarkContent,
    /// Fill/stroke alpha, 0..1. Clamped.
    pub opacity: f32,
    /// Clockwise rotation of the mark, in degrees (45 is the diagonal staple).
    pub rotation_deg: f32,
    pub placement: WatermarkPlacement,
}

/// The mark itself — text or an image/logo.
pub enum WatermarkContent {
    Text {
        text: String,
        font: BatesFont,
        font_size_pt: f32,
        color: [f32; 3],
    },
    /// A PNG or JPEG logo. `scale` is the mark width as a fraction of the page width.
    Image { bytes: Vec<u8>, scale: f32 },
}

/// A single centred mark, or the mark repeated on a grid covering the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatermarkPlacement {
    Center,
    Tiled,
}

/// Stamp a watermark onto every page, returning the new document bytes.
pub fn watermark(bytes: &[u8], opts: &WatermarkOptions) -> Result<Vec<u8>, GenerateError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| GenerateError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|_| GenerateError::Parse)?;
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    if pages.is_empty() {
        return Err(GenerateError::NoPages);
    }
    let opacity = opts.opacity.clamp(0.0, 1.0);

    // One shared graphics-state object carries the opacity for every page.
    let gs_id = doc.add_object(dictionary! {
        b"Type" => Object::Name(b"ExtGState".to_vec()),
        b"ca" => Object::Real(opacity),
        b"CA" => Object::Real(opacity),
    });

    match &opts.content {
        WatermarkContent::Text {
            text,
            font,
            font_size_pt,
            color,
        } => {
            let font_id = doc.add_object(dictionary! {
                b"Type" => Object::Name(b"Font".to_vec()),
                b"Subtype" => Object::Name(b"Type1".to_vec()),
                b"BaseFont" => Object::Name(font.postscript_name().as_bytes().to_vec()),
                b"Encoding" => Object::Name(b"WinAnsiEncoding".to_vec()),
            });
            for &page in &pages {
                let content = text_overlay_content(
                    &doc,
                    page,
                    text,
                    *font,
                    *font_size_pt,
                    *color,
                    opts.rotation_deg,
                    opts.placement,
                )?;
                merge_overlay_resources(&mut doc, page, Some(font_id), None, gs_id)?;
                append_content(&mut doc, page, content)?;
            }
        }
        WatermarkContent::Image { bytes, scale } => {
            let (image_id, img_w, img_h) = image_xobject(&mut doc, bytes)?;
            for &page in &pages {
                let content = image_overlay_content(
                    &doc,
                    page,
                    img_w,
                    img_h,
                    *scale,
                    opts.rotation_deg,
                    opts.placement,
                )?;
                merge_overlay_resources(&mut doc, page, None, Some(image_id), gs_id)?;
                append_content(&mut doc, page, content.into_bytes())?;
            }
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|_| GenerateError::Reassemble)?;
    Ok(out)
}

/// The centre points where the mark is drawn for the page's effective box.
fn placement_centers(
    placement: WatermarkPlacement,
    llx: f32,
    lly: f32,
    page_width: f32,
    page_height: f32,
    mark_width: f32,
    mark_height: f32,
) -> Vec<(f32, f32)> {
    match placement {
        WatermarkPlacement::Center => vec![(llx + page_width / 2.0, lly + page_height / 2.0)],
        WatermarkPlacement::Tiled => {
            // Cap the tile count so an adversarial (huge) /MediaBox cannot drive the loop
            // and the centre vector unbounded.
            const MAX_TILES: usize = 2000;
            let step = (mark_width.max(mark_height * 4.0) + 40.0).max(80.0);
            let mut centers = Vec::new();
            let mut y = lly + step / 2.0;
            'outer: while y < lly + page_height {
                let mut x = llx + step / 2.0;
                while x < llx + page_width {
                    centers.push((x, y));
                    if centers.len() >= MAX_TILES {
                        break 'outer;
                    }
                    x += step;
                }
                y += step;
            }
            if centers.is_empty() {
                centers.push((llx + page_width / 2.0, lly + page_height / 2.0));
            }
            centers
        }
    }
}

/// Build the text-overlay content stream for one page.
#[allow(clippy::too_many_arguments)]
fn text_overlay_content(
    doc: &Document,
    page: ObjectId,
    text: &str,
    font: BatesFont,
    size: f32,
    color: [f32; 3],
    rotation_deg: f32,
    placement: WatermarkPlacement,
) -> Result<Vec<u8>, GenerateError> {
    let [llx, lly, urx, ury] = resolve_mediabox(doc, page).ok_or(GenerateError::Parse)?;
    let (page_width, page_height) = (urx - llx, ury - lly);
    let mark_width = label_width_pt(font, text, size);
    // Pre-compensate the page's display rotation so the mark appears at `rotation_deg`
    // regardless of `/Rotate` (the page centre maps to the displayed centre under any
    // quarter-turn, so only the angle needs adjusting).
    let page_rotate = resolve_rotate(doc, page).rem_euclid(360) as f32;
    let theta = (rotation_deg + page_rotate).to_radians();
    let (cos, sin) = (theta.cos(), theta.sin());
    let ascent = size * 0.35; // vertical centring offset for the baseline
    let escaped = win_ansi_literal(text).map_err(|_| GenerateError::UnsupportedCharacter)?;
    let [r, g, b] = color;

    let mut content = b"q /MagnaCartaWmGs gs ".to_vec();
    for (cx, cy) in placement_centers(
        placement,
        llx,
        lly,
        page_width,
        page_height,
        mark_width,
        size,
    ) {
        // Tm = translate(cx,cy) · rotate(theta) · translate(-mark_width/2, -ascent).
        let e = cx - (cos * mark_width / 2.0 - sin * ascent);
        let f = cy - (sin * mark_width / 2.0 + cos * ascent);
        let (c, d) = (-sin, cos);
        content.extend_from_slice(
            format!(
                "BT /MagnaCartaWmFont {size:.2} Tf {r:.3} {g:.3} {b:.3} rg \
                 {cos:.5} {sin:.5} {c:.5} {d:.5} {e:.3} {f:.3} Tm ("
            )
            .as_bytes(),
        );
        content.extend_from_slice(&escaped);
        content.extend_from_slice(b") Tj ET ");
    }
    content.push(b'Q');
    Ok(content)
}

/// Build the image-overlay content stream for one page.
fn image_overlay_content(
    doc: &Document,
    page: ObjectId,
    img_w: f32,
    img_h: f32,
    scale: f32,
    rotation_deg: f32,
    placement: WatermarkPlacement,
) -> Result<String, GenerateError> {
    let [llx, lly, urx, ury] = resolve_mediabox(doc, page).ok_or(GenerateError::Parse)?;
    let (page_width, page_height) = (urx - llx, ury - lly);
    let disp_w = (scale.clamp(0.0, 1.0)) * page_width;
    let disp_h = if img_w > 0.0 {
        disp_w * (img_h / img_w)
    } else {
        disp_w
    };
    let page_rotate = resolve_rotate(doc, page).rem_euclid(360) as f32;
    let theta = (rotation_deg + page_rotate).to_radians();
    let (cos, sin) = (theta.cos(), theta.sin());

    let mut content = String::from("q /MagnaCartaWmGs gs ");
    for (cx, cy) in placement_centers(placement, llx, lly, page_width, page_height, disp_w, disp_h)
    {
        // cm = translate(cx,cy) · rotate(theta) · centre · scale(disp_w, disp_h).
        let a = cos * disp_w;
        let b = sin * disp_w;
        let c = -sin * disp_h;
        let d = cos * disp_h;
        let e = cx - cos * disp_w / 2.0 + sin * disp_h / 2.0;
        let f = cy - sin * disp_w / 2.0 - cos * disp_h / 2.0;
        content.push_str(&format!(
            "q {a:.5} {b:.5} {c:.5} {d:.5} {e:.3} {f:.3} cm /MagnaCartaWmImg Do Q "
        ));
    }
    content.push('Q');
    Ok(content)
}

/// The largest watermark image accepted, in pixels. Generous for a logo while bounding
/// the post-decode allocation (a watermark image is decoded into uncompressed samples).
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

/// Decode an image and add it as an image XObject, returning its id and pixel size.
///
/// An RGB or grayscale JPEG is embedded verbatim via `/DCTDecode` with the matching
/// colorspace; any other format (PNG, or a CMYK JPEG the `image` crate normalises) is
/// decoded to RGB and stored (Flate-compressed), with an `/SMask` carrying the alpha
/// channel when the source is not fully opaque.
fn image_xobject(doc: &mut Document, data: &[u8]) -> Result<(ObjectId, f32, f32), GenerateError> {
    let is_jpeg = data.starts_with(&[0xFF, 0xD8, 0xFF]);
    let decoded = image::load_from_memory(data).map_err(|_| GenerateError::Image)?;
    let (w, h) = decoded.dimensions();
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_IMAGE_PIXELS {
        return Err(GenerateError::Image);
    }
    let pixels = w as usize * h as usize;

    // A JPEG may embed verbatim only when its declared colorspace will match its actual
    // component count — 1 (gray) or 3 (RGB). A CMYK (4-component) JPEG must not embed
    // verbatim as DeviceRGB; it falls through to the decode-and-Flate path below.
    if is_jpeg {
        if let Some(colorspace) = match jpeg_components(data) {
            Some(1) => Some(b"DeviceGray".as_slice()),
            Some(3) => Some(b"DeviceRGB".as_slice()),
            _ => None,
        } {
            let dict = dictionary! {
                b"Type" => Object::Name(b"XObject".to_vec()),
                b"Subtype" => Object::Name(b"Image".to_vec()),
                b"Width" => Object::Integer(w as i64),
                b"Height" => Object::Integer(h as i64),
                b"ColorSpace" => Object::Name(colorspace.to_vec()),
                b"BitsPerComponent" => Object::Integer(8),
                b"Filter" => Object::Name(b"DCTDecode".to_vec()),
            };
            let id = doc.add_object(Object::Stream(Stream::new(dict, data.to_vec())));
            return Ok((id, w as f32, h as f32));
        }
    }

    let rgba = decoded.to_rgba8();
    let mut rgb = Vec::with_capacity(pixels * 3);
    let mut alpha = Vec::with_capacity(pixels);
    let mut has_alpha = false;
    for pixel in rgba.pixels() {
        rgb.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
        alpha.push(pixel[3]);
        if pixel[3] != 255 {
            has_alpha = true;
        }
    }

    let smask = if has_alpha {
        let smask_dict = dictionary! {
            b"Type" => Object::Name(b"XObject".to_vec()),
            b"Subtype" => Object::Name(b"Image".to_vec()),
            b"Width" => Object::Integer(w as i64),
            b"Height" => Object::Integer(h as i64),
            b"ColorSpace" => Object::Name(b"DeviceGray".to_vec()),
            b"BitsPerComponent" => Object::Integer(8),
        };
        let mut stream = Stream::new(smask_dict, alpha);
        stream.compress().map_err(|_| GenerateError::Reassemble)?;
        Some(doc.add_object(Object::Stream(stream)))
    } else {
        None
    };

    let mut dict = dictionary! {
        b"Type" => Object::Name(b"XObject".to_vec()),
        b"Subtype" => Object::Name(b"Image".to_vec()),
        b"Width" => Object::Integer(w as i64),
        b"Height" => Object::Integer(h as i64),
        b"ColorSpace" => Object::Name(b"DeviceRGB".to_vec()),
        b"BitsPerComponent" => Object::Integer(8),
    };
    if let Some(smask_id) = smask {
        dict.set("SMask", Object::Reference(smask_id));
    }
    let mut stream = Stream::new(dict, rgb);
    stream.compress().map_err(|_| GenerateError::Reassemble)?;
    let id = doc.add_object(Object::Stream(stream));
    Ok((id, w as f32, h as f32))
}

/// The component count (`Nf`) from a JPEG's frame header (SOF marker), or `None`.
/// 1 = grayscale, 3 = YCbCr/RGB, 4 = CMYK/YCCK.
fn jpeg_components(data: &[u8]) -> Option<u8> {
    let mut i = 2; // skip the SOI marker (FF D8)
    while i + 4 <= data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = data[i + 1];
        // Standalone markers carry no length segment.
        if (0xD0..=0xD9).contains(&marker) || marker == 0x01 {
            i += 2;
            continue;
        }
        let segment_len = ((data[i + 2] as usize) << 8) | (data[i + 3] as usize);
        // Start-Of-Frame markers (but not DHT/JPG/DAC): … precision(1) height(2) width(2) Nf(1).
        let is_sof = matches!(
            marker,
            0xC0 | 0xC1
                | 0xC2
                | 0xC3
                | 0xC5
                | 0xC6
                | 0xC7
                | 0xC9
                | 0xCA
                | 0xCB
                | 0xCD
                | 0xCE
                | 0xCF
        );
        if is_sof {
            return data.get(i + 9).copied();
        }
        i += 2 + segment_len;
    }
    None
}

/// Merge the watermark font / image XObject / graphics-state into the page `/Resources`
/// non-destructively (no existing resource is dropped), writing the result onto the page.
fn merge_overlay_resources(
    doc: &mut Document,
    page: ObjectId,
    font_id: Option<ObjectId>,
    image_id: Option<ObjectId>,
    gs_id: ObjectId,
) -> Result<(), GenerateError> {
    let mut merged = resolve_inherited_resources(doc, page)
        .cloned()
        .unwrap_or_default();

    let mut gs = sub_dict(doc, &merged, b"ExtGState");
    gs.set("MagnaCartaWmGs", Object::Reference(gs_id));
    merged.set("ExtGState", Object::Dictionary(gs));

    if let Some(id) = font_id {
        let mut fonts = sub_dict(doc, &merged, b"Font");
        fonts.set("MagnaCartaWmFont", Object::Reference(id));
        merged.set("Font", Object::Dictionary(fonts));
    }
    if let Some(id) = image_id {
        let mut xobjects = sub_dict(doc, &merged, b"XObject");
        xobjects.set("MagnaCartaWmImg", Object::Reference(id));
        merged.set("XObject", Object::Dictionary(xobjects));
    }

    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page) {
        page_dict.set("Resources", Object::Dictionary(merged));
    }
    Ok(())
}

/// Clone a resource sub-dictionary (resolving an indirect ref), or an empty one.
fn sub_dict(doc: &Document, resources: &Dictionary, key: &[u8]) -> Dictionary {
    match resources.get(key) {
        Ok(obj) => resolve_dict(doc, obj).cloned().unwrap_or_default(),
        Err(_) => Dictionary::new(),
    }
}

/// Append a content stream to a page so it draws last (on top).
fn append_content(
    doc: &mut Document,
    page: ObjectId,
    content: Vec<u8>,
) -> Result<(), GenerateError> {
    let stream_id = doc.add_object(Object::Stream(Stream::new(Dictionary::new(), content)));
    let existing = doc
        .get_dictionary(page)
        .ok()
        .and_then(|d| d.get(b"Contents").ok().cloned());
    let new_contents = match existing {
        Some(Object::Reference(old)) => {
            Object::Array(vec![Object::Reference(old), Object::Reference(stream_id)])
        }
        Some(Object::Array(mut arr)) => {
            arr.push(Object::Reference(stream_id));
            Object::Array(arr)
        }
        _ => Object::Reference(stream_id),
    };
    if let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page) {
        page_dict.set("Contents", new_contents);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream as LopStream;
    use std::io::Cursor;

    fn one_page_doc() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Object::Stream(LopStream::new(
            dictionary! {},
            b"q 0 0 1 rg 10 10 100 100 re f Q".to_vec(),
        )));
        let page_id = doc.add_object(dictionary! {
            b"Type" => Object::Name(b"Page".to_vec()),
            b"Parent" => Object::Reference(pages_id),
            b"MediaBox" => Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]),
            b"Contents" => Object::Reference(content_id),
            b"Resources" => Object::Dictionary(dictionary! { b"Font" => Object::Dictionary(dictionary! {}) }),
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
        doc.save_to(&mut out).expect("serialise one-page doc");
        out
    }

    fn text_opts(text: &str, placement: WatermarkPlacement) -> WatermarkOptions {
        WatermarkOptions {
            content: WatermarkContent::Text {
                text: text.to_string(),
                font: BatesFont::Helvetica,
                font_size_pt: 48.0,
                color: [0.5, 0.5, 0.5],
            },
            opacity: 0.3,
            rotation_deg: 45.0,
            placement,
        }
    }

    /// The decompressed bytes of every content stream referenced by page 0.
    fn page_content(bytes: &[u8]) -> Vec<u8> {
        let doc = Document::load_mem(bytes).unwrap();
        let page = doc.get_pages().into_values().next().unwrap();
        let mut all = Vec::new();
        let contents = doc.get_dictionary(page).unwrap().get(b"Contents").unwrap();
        let ids: Vec<ObjectId> = match contents {
            Object::Reference(id) => vec![*id],
            Object::Array(arr) => arr.iter().filter_map(|o| o.as_reference().ok()).collect(),
            _ => vec![],
        };
        for id in ids {
            if let Ok(Object::Stream(s)) = doc.get_object(id) {
                all.extend(
                    s.decompressed_content()
                        .unwrap_or_else(|_| s.content.clone()),
                );
            }
        }
        all
    }

    #[test]
    fn text_watermark_is_additive_and_renders() {
        let original = one_page_doc();
        let before = Document::load_mem(&original).unwrap().objects.len();
        let out = watermark(
            &original,
            &text_opts("CONFIDENTIAL", WatermarkPlacement::Center),
        )
        .unwrap();
        // Page count unchanged; objects added (font + gs + overlay stream); the original
        // rectangle content survives; the watermark text is present.
        assert_eq!(page_count(&out), 1);
        assert!(Document::load_mem(&out).unwrap().objects.len() > before);
        let content = page_content(&out);
        assert!(content.windows(2).any(|w| w == b"re")); // original rectangle op survives
        assert!(content.windows(12).any(|w| w == b"CONFIDENTIAL"));
        // Valid, renderable output.
        assert_eq!(crate::Document::load(out).unwrap().page_count(), 1);
    }

    #[test]
    fn text_watermark_sets_extgstate_alpha() {
        let out = watermark(
            &one_page_doc(),
            &text_opts("DRAFT", WatermarkPlacement::Center),
        )
        .unwrap();
        let doc = Document::load_mem(&out).unwrap();
        let found = doc.objects.values().any(|o| {
            if let Object::Dictionary(d) = o {
                matches!(d.get(b"Type"), Ok(Object::Name(n)) if n == b"ExtGState")
                    && matches!(d.get(b"ca"), Ok(Object::Real(a)) if (*a - 0.3).abs() < 1e-4)
            } else {
                false
            }
        });
        assert!(found, "expected an ExtGState with /ca 0.3");
    }

    #[test]
    fn text_watermark_tiled_repeats() {
        let out = watermark(
            &one_page_doc(),
            &text_opts("COPY", WatermarkPlacement::Tiled),
        )
        .unwrap();
        let content = page_content(&out);
        let occurrences = content.windows(4).filter(|w| *w == b"COPY").count();
        assert!(
            occurrences > 1,
            "tiled watermark should repeat, saw {occurrences}"
        );
    }

    fn page_count(bytes: &[u8]) -> usize {
        Document::load_mem(bytes).unwrap().get_pages().len()
    }

    fn tiny_png() -> Vec<u8> {
        let mut img = image::RgbaImage::new(2, 2);
        img.put_pixel(0, 0, image::Rgba([255, 0, 0, 128])); // semi-transparent → SMask
        img.put_pixel(1, 1, image::Rgba([0, 0, 255, 255]));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    fn tiny_jpeg() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb([10, 20, 30]));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .unwrap();
        out.into_inner()
    }

    fn image_opts(bytes: Vec<u8>) -> WatermarkOptions {
        WatermarkOptions {
            content: WatermarkContent::Image { bytes, scale: 0.3 },
            opacity: 0.5,
            rotation_deg: 0.0,
            placement: WatermarkPlacement::Center,
        }
    }

    #[test]
    fn image_watermark_embeds_xobject_with_smask() {
        let out = watermark(&one_page_doc(), &image_opts(tiny_png())).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        // An image XObject with an /SMask exists, and the overlay draws it with Do.
        let has_image_with_smask = doc.objects.values().any(|o| {
            if let Object::Stream(s) = o {
                matches!(s.dict.get(b"Subtype"), Ok(Object::Name(n)) if n == b"Image")
                    && s.dict.get(b"SMask").is_ok()
            } else {
                false
            }
        });
        assert!(
            has_image_with_smask,
            "expected an image XObject with /SMask"
        );
        assert!(page_content(&out).windows(2).any(|w| w == b"Do"));
        assert_eq!(page_count(&out), 1);
    }

    #[test]
    fn image_watermark_jpeg_uses_dctdecode() {
        let out = watermark(&one_page_doc(), &image_opts(tiny_jpeg())).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        let dct = doc.objects.values().any(|o| {
            if let Object::Stream(s) = o {
                matches!(s.dict.get(b"Filter"), Ok(Object::Name(n)) if n == b"DCTDecode")
            } else {
                false
            }
        });
        assert!(dct, "expected the JPEG embedded with /DCTDecode");
        assert_eq!(crate::Document::load(out).unwrap().page_count(), 1);
    }

    #[test]
    fn image_watermark_bad_bytes_errs() {
        assert_eq!(
            watermark(&one_page_doc(), &image_opts(b"not an image".to_vec())),
            Err(GenerateError::Image)
        );
    }

    #[test]
    fn jpeg_components_reads_grayscale_and_rgb() {
        // SOI, SOF0(len=8, precision=8, height=1, width=1, Nf), …
        let grayscale = [
            0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
        ];
        let rgb = [
            0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03,
        ];
        let cmyk = [
            0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x04,
        ];
        assert_eq!(super::jpeg_components(&grayscale), Some(1));
        assert_eq!(super::jpeg_components(&rgb), Some(3));
        assert_eq!(super::jpeg_components(&cmyk), Some(4));
        assert_eq!(super::jpeg_components(b"not a jpeg"), None);
    }

    #[test]
    fn watermark_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        // `text_opts(..)` is the existing WatermarkOptions test helper in this module.
        let opts = text_opts("x", WatermarkPlacement::Center);
        assert_eq!(watermark(&big, &opts), Err(crate::GenerateError::Rejected));
    }

    #[test]
    fn watermark_on_rotated_page_is_valid() {
        // A page rotated 90° still produces a loadable watermarked document (the overlay
        // pre-compensates the page rotation).
        let rotated = crate::rotate(
            &one_page_doc(),
            crate::Rotation::Cw90,
            &crate::PageSelection::All,
        )
        .unwrap();
        let out = watermark(
            &rotated,
            &text_opts("CONFIDENTIAL", WatermarkPlacement::Center),
        )
        .unwrap();
        assert_eq!(crate::Document::load(out).unwrap().page_count(), 1);
    }
}
