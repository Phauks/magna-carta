//! Safe redaction: flatten each affected page to a black-boxed image and
//! verify (via text extraction) that no redacted text survives.

/// A rectangle in rendered-page display points, bottom-left origin
/// (the same space `page_size`/`render_page` use).
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// One region to redact on one page (0-based page index).
#[derive(Debug, Clone)]
pub struct RedactionRegion {
    pub page: usize,
    pub rect: Rect,
    pub reason: Option<String>,
}

/// Knobs for a redaction run.
#[derive(Debug, Clone)]
pub struct RedactionOptions {
    /// Raster resolution for the flattened pages. The legal-production standard is 300.
    pub dpi: f32,
    /// If supplied, the gate also asserts these strings are absent document-wide.
    pub redacted_text: Vec<String>,
}

impl Default for RedactionOptions {
    fn default() -> Self {
        Self { dpi: 300.0, redacted_text: Vec::new() }
    }
}

#[derive(Debug, Clone)]
pub struct RedactionReport {
    pub pages_redacted: Vec<usize>,
    pub region_count: usize,
}

#[derive(Debug)]
pub struct RedactionOutcome {
    pub pdf: Vec<u8>,
    pub report: RedactionReport,
}

/// What redaction can fail at. `GateFailed` means text survived — no PDF is emitted.
#[derive(Debug)]
pub enum RedactError {
    Parse,
    PageOutOfRange,
    Render,
    Reassemble,
    GateFailed { detail: String },
}

use lopdf::{Dictionary, Object, Stream};

use crate::Document;

// Called by the redact orchestration layer; allow until that module is wired.
#[allow(dead_code)]
pub(crate) fn reassemble_page(
    doc: &mut lopdf::Document,
    page_id: lopdf::ObjectId,
    rgb: &[u8],
    px_w: u32,
    px_h: u32,
    page_w_pt: f32,
    page_h_pt: f32,
) -> Result<(), RedactError> {
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", Object::Name(b"XObject".to_vec()));
    img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    img_dict.set("Width", Object::Integer(px_w as i64));
    img_dict.set("Height", Object::Integer(px_h as i64));
    img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    img_dict.set("BitsPerComponent", Object::Integer(8));
    let mut img_stream = Stream::new(img_dict, rgb.to_vec());
    img_stream.compress().map_err(|_| RedactError::Reassemble)?; // FlateDecode (lossless)
    let img_id = doc.add_object(img_stream);

    // Draw the image across the full MediaBox.
    let content = format!("q {page_w_pt} 0 0 {page_h_pt} 0 0 cm /Im0 Do Q");
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));

    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", Object::Reference(img_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));

    let page = doc.get_dictionary_mut(page_id).map_err(|_| RedactError::Reassemble)?;
    page.set("Contents", Object::Reference(content_id));
    page.set("Resources", Object::Dictionary(resources));
    page.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(page_w_pt),
            Object::Real(page_h_pt),
        ]),
    );
    page.set("Rotate", Object::Integer(0));
    page.remove(b"Annots");
    Ok(())
}

// Called by the page-reassembly layer; allow until that module is wired.
#[allow(dead_code)]
pub(crate) fn render_redacted_page(
    doc: &Document,
    page: usize,
    rects: &[Rect],
    dpi: f32,
) -> Result<(Vec<u8>, u32, u32), RedactError> {
    let size = doc.page_size(page).map_err(|_| RedactError::PageOutOfRange)?;
    let rendered = doc.render_page(page, dpi, false).map_err(|_| RedactError::Render)?;
    let (w, h) = (rendered.width, rendered.height);
    let mut rgba = rendered.data; // RGBA8, row-major

    for r in rects {
        let (x0, y0, x1, y1) = rect_to_pixels(r, size.width_pt, size.height_pt, w, h);
        for y in y0..y1 {
            for x in x0..x1 {
                let i = ((y * w + x) * 4) as usize;
                rgba[i] = 0;
                rgba[i + 1] = 0;
                rgba[i + 2] = 0;
                rgba[i + 3] = 255;
            }
        }
    }

    // Composite over a white background and pack to RGB8 for a DeviceRGB image XObject.
    // The renderer returns straight RGBA8; pages with no background content are transparent
    // (alpha=0). Compositing alpha-over-white gives the correct white-page appearance and
    // ensures redaction boxes (alpha=255, RGB=0) stay fully black.
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for px in rgba.chunks_exact(4) {
        let a = px[3] as f32 / 255.0;
        let composite = |channel: u8| -> u8 {
            // Porter-Duff over white: out = src_alpha * src + (1 - src_alpha) * 255
            ((a * channel as f32) + ((1.0 - a) * 255.0)).round() as u8
        };
        rgb.push(composite(px[0]));
        rgb.push(composite(px[1]));
        rgb.push(composite(px[2]));
    }
    Ok((rgb, w, h))
}

/// Map a display-point rect to a pixel rect on the rendered raster, applying the
/// y-flip (PDF y-up, bottom-left → image y-down, top-left), corner ordering, and clamping.
pub fn rect_to_pixels(r: &Rect, page_w_pt: f32, page_h_pt: f32, px_w: u32, px_h: u32) -> (u32, u32, u32, u32) {
    let sx = px_w as f32 / page_w_pt;
    let sy = px_h as f32 / page_h_pt;
    let clamp_x = |v: f32| v.clamp(0.0, px_w as f32);
    let clamp_y = |v: f32| v.clamp(0.0, px_h as f32);
    let x0 = clamp_x((r.x0.min(r.x1) * sx).floor()) as u32;
    let x1 = clamp_x((r.x0.max(r.x1) * sx).ceil()) as u32;
    // y-flip: a high PDF-y (near the top) is a low image row.
    let y0 = clamp_y(((page_h_pt - r.y0.max(r.y1)) * sy).floor()) as u32;
    let y1 = clamp_y(((page_h_pt - r.y0.min(r.y1)) * sy).ceil()) as u32;
    (x0, y0, x1, y1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_doc() -> crate::Document {
        crate::Document::load(include_bytes!("../tests/fixtures/blank.pdf").to_vec()).unwrap()
    }

    #[test]
    fn burns_an_opaque_black_box() {
        let doc = blank_doc();
        // 100x100 pt box near the bottom-left of a 612x792 page, at 72 dpi (1 px/pt).
        let rects = [Rect { x0: 100.0, y0: 100.0, x1: 200.0, y1: 200.0 }];
        let (rgb, w, h) = render_redacted_page(&doc, 0, &rects, 72.0).unwrap();
        assert_eq!((w, h), (612, 792));
        assert_eq!(rgb.len(), (w * h * 3) as usize);
        // A pixel inside the box is black; a corner pixel (outside) is not.
        let at = |x: u32, y: u32| {
            let i = ((y * w + x) * 3) as usize;
            (rgb[i], rgb[i + 1], rgb[i + 2])
        };
        // box pixel: x in [100,200], image-row in [792-200,792-100] = [592,692]
        assert_eq!(at(150, 640), (0, 0, 0));
        assert_ne!(at(5, 5), (0, 0, 0)); // blank page corner is white
    }

    #[test]
    fn maps_rect_with_y_flip() {
        // A 612x792 pt page rendered at 1 px/pt (px == pt for the math).
        // Rect at the page's bottom-left corner (PDF y-up) maps to the
        // raster's BOTTOM (image y-down).
        let r = Rect { x0: 0.0, y0: 0.0, x1: 100.0, y1: 50.0 };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 612.0, 792.0, 612, 792);
        assert_eq!((x0, x1), (0, 100));
        // y-up [0,50] -> image rows [792-50, 792-0] = [742, 792]
        assert_eq!((y0, y1), (742, 792));
    }

    #[test]
    fn scales_by_resolution_and_orders_corners() {
        // 2 px/pt; corners given unordered.
        let r = Rect { x0: 100.0, y0: 100.0, x1: 50.0, y1: 50.0 };
        let (x0, y0, x1, y1) = rect_to_pixels(&r, 100.0, 100.0, 200, 200);
        assert_eq!((x0, x1), (100, 200)); // 50..100 pt * 2
        assert_eq!((y0, y1), (0, 100)); // y-up 50..100 -> top of a 200px raster
    }

    fn hello_bytes() -> Vec<u8> {
        include_bytes!("../tests/fixtures/hello.pdf").to_vec()
    }

    #[test]
    fn reassemble_removes_text_and_places_image() {
        let mut lo = lopdf::Document::load_mem(&hello_bytes()).unwrap();
        // sanity: the original page 1 has extractable text
        assert!(lo.extract_text(&[1]).unwrap_or_default().contains("Hello"));

        let page_id = *lo.get_pages().get(&1).unwrap();
        let rgb = vec![0u8; (10 * 10 * 3) as usize]; // a tiny dummy raster
        reassemble_page(&mut lo, page_id, &rgb, 10, 10, 200.0, 200.0).unwrap();

        let mut out = Vec::new();
        lo.save_to(&mut out).unwrap();
        let reloaded = lopdf::Document::load_mem(&out).unwrap();
        // the page is now an image — no extractable text survives
        assert!(reloaded.extract_text(&[1]).unwrap_or_default().trim().is_empty());
    }
}
