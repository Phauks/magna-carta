#[cfg(target_arch = "wasm32")]
mod wasm;

mod guard;
mod standard_fonts;
mod standard_fonts_data;

mod forms;
pub use forms::{
    fill_form, flatten_form, read_form, FieldKind, FieldValue, FormError, FormField,
    FormFillOptions,
};

mod bates;
pub use bates::{
    stamp_document, stamp_set, BatesError, BatesFont, BatesOptions, BatesPosition, BatesRange,
};

mod redact;
pub use redact::*;

mod scrub;
pub use scrub::*;

mod textpos;

mod detect;
pub use detect::*;

mod decrypt;
pub use decrypt::{
    decrypt, inspect_security, Algorithm, Handler, Permissions, SecureError, SecurityInfo,
};

mod secure;
pub use secure::{secure, SecureOptions, WriteAlgorithm};

mod surgery;
pub use surgery::{compare_surgery_paths, SurgeryDisposition, SurgeryPathComparison};

mod content_tokens;

mod generate;
pub use generate::{merge, rotate, split, GenerateError, PageRange, PageSelection, Rotation};

mod watermark;
pub use watermark::{watermark, WatermarkContent, WatermarkOptions, WatermarkPlacement};

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};

/// What a PDF operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    Parse,
    PageOutOfRange,
    Render,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
}

/// A parsed PDF held in memory.
pub struct Document {
    pdf: Pdf,
}

impl Document {
    /// Parse without the bomb guard. Callers that already ran `guard_input` on the
    /// same bytes use this to avoid scanning twice.
    pub(crate) fn load_unguarded(bytes: Vec<u8>) -> Result<Self, PdfError> {
        Pdf::new(bytes)
            .map(|pdf| Document { pdf })
            .map_err(|_| PdfError::Parse)
    }

    pub fn load(bytes: Vec<u8>) -> Result<Self, PdfError> {
        crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
            .map_err(|_| PdfError::Rejected)?;
        Self::load_unguarded(bytes)
    }

    /// Load a possibly-encrypted PDF, decrypting with `password` first so the render
    /// path sees plaintext. An unencrypted input loads normally; a wrong password
    /// yields [`SecureError::WrongPassword`].
    pub fn load_protected(bytes: Vec<u8>, password: &str) -> Result<Self, SecureError> {
        crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
            .map_err(|_| SecureError::Rejected)?;
        match crate::decrypt::decrypt_unguarded(&bytes, password) {
            Ok(plain) => {
                // `plain` is different bytes than the (already-guarded) ciphertext, so
                // re-guard the decrypted output before the render parser inflates it.
                crate::guard::guard_input(&plain, &crate::guard::GuardLimits::default())
                    .map_err(|_| SecureError::Rejected)?;
                Self::load_unguarded(plain).map_err(|_| SecureError::Parse)
            }
            // The model parser could not read it at all — it may still be a valid
            // unencrypted document the render parser accepts. Try it directly.
            Err(SecureError::Parse) => Self::load_unguarded(bytes).map_err(|_| SecureError::Parse),
            Err(other) => Err(other),
        }
    }

    pub fn page_count(&self) -> usize {
        self.pdf.pages().len()
    }
}

#[derive(Debug, PartialEq)]
pub struct PageSize {
    pub width_pt: f32,
    pub height_pt: f32,
}

/// Rendered raster. `data` is RGBA8 (row-major, 4 bytes/pixel) unless `png`.
pub struct RenderedPage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub png: bool,
}

impl RenderedPage {
    /// Composite this page's straight-alpha RGBA8 over a white background and return
    /// RGB8. The renderer leaves pages with no background content fully transparent, so
    /// discarding alpha instead of compositing would turn a blank page black. Returns
    /// `None` for a PNG-encoded buffer (which is not raw pixels) or a truncated one.
    pub fn to_rgb_image(&self) -> Option<image::RgbImage> {
        if self.png {
            return None;
        }
        let pixels = (self.width as usize).checked_mul(self.height as usize)?;
        if self.data.len() < pixels.checked_mul(4)? {
            return None;
        }
        let mut rgb = Vec::with_capacity(pixels * 3);
        for pixel in self.data.chunks_exact(4) {
            let alpha = pixel[3] as f32 / 255.0;
            // Porter-Duff over white: out = src_alpha * src + (1 - src_alpha) * 255
            let composite =
                |channel: u8| ((alpha * channel as f32) + ((1.0 - alpha) * 255.0)).round() as u8;
            rgb.push(composite(pixel[0]));
            rgb.push(composite(pixel[1]));
            rgb.push(composite(pixel[2]));
        }
        image::RgbImage::from_raw(self.width, self.height, rgb)
    }
}

impl Document {
    pub fn page_size(&self, index: usize) -> Result<PageSize, PdfError> {
        let pages = self.pdf.pages();
        let page = pages.get(index).ok_or(PdfError::PageOutOfRange)?;
        let (width_pt, height_pt) = page.render_dimensions();
        Ok(PageSize {
            width_pt,
            height_pt,
        })
    }

    pub fn render_page(
        &self,
        index: usize,
        dpi: f32,
        encode_png: bool,
    ) -> Result<RenderedPage, PdfError> {
        let pages = self.pdf.pages();
        let page = pages.get(index).ok_or(PdfError::PageOutOfRange)?;
        let scale = dpi / 72.0;
        let settings = RenderSettings {
            x_scale: scale,
            y_scale: scale,
            ..Default::default()
        };
        let png = render(
            page,
            &RenderCache::new(),
            &InterpreterSettings::default(),
            &settings,
        )
        .into_png()
        .map_err(|_| PdfError::Render)?;
        if encode_png {
            // dimensions come from decoding the header cheaply
            let dims = image::load_from_memory(&png).map_err(|_| PdfError::Render)?;
            return Ok(RenderedPage {
                width: dims.width(),
                height: dims.height(),
                data: png,
                png: true,
            });
        }
        // OPTIMIZATION SEAM: this round-trips through PNG to get *straight* RGBA8.
        // Direct access exists (pixmap.width()/height()/data_as_u8_slice(), vello_common
        // Pixmap) but yields PREMULTIPLIED RGBA (PremulRgba8) — a canvas wants straight
        // alpha, so the direct path must un-premultiply first. The PNG round-trip already
        // returns straight RGBA; keep it until the un-premultiply path is benchmarked.
        let img = image::load_from_memory(&png)
            .map_err(|_| PdfError::Render)?
            .to_rgba8();
        let (width, height) = (img.width(), img.height());
        Ok(RenderedPage {
            data: img.into_raw(),
            width,
            height,
            png: false,
        })
    }

    /// The bounding rectangle of every non-whitespace text glyph rendered on page
    /// `index`, in redaction [`Rect`] coordinates (PDF user space, bottom-left
    /// origin). Observation runs through the same path as the redaction outcome
    /// gate, so the rectangles reflect what a viewer actually sees — text drawn
    /// directly on the page, by Form XObjects, and by annotation appearance
    /// streams alike. Whitespace glyphs are excluded (they carry no visible ink).
    /// Returns an empty vector for a page with no visible text; `PageOutOfRange`
    /// if the page cannot be observed. Locates text to redact or inspect.
    pub fn page_text_rects(&self, index: usize) -> Result<Vec<Rect>, PdfError> {
        let obs = crate::textpos::observe_page(&self.pdf, index).ok_or(PdfError::PageOutOfRange)?;
        Ok(obs
            .glyphs
            .iter()
            .filter(|g| !crate::redact::is_whitespace_glyph(&g.text))
            .map(|g| crate::detect::to_display_rect(g.bbox, obs.height_pt))
            .collect())
    }

    /// Every non-whitespace text glyph on page `index`, carrying both its recognized
    /// text and its bounding rectangle, in paint order. The same observation
    /// `page_text_rects` already runs -- this attaches the text `page_text_rects`
    /// discards, so a caller with a born-digital document can use its own text layer
    /// as ground truth without re-deriving glyph positions from scratch.
    /// Returns an empty vector for a page with no visible text; `PageOutOfRange`
    /// if the page cannot be observed.
    pub fn page_text_glyphs(&self, index: usize) -> Result<Vec<TextGlyph>, PdfError> {
        let obs = crate::textpos::observe_page(&self.pdf, index).ok_or(PdfError::PageOutOfRange)?;
        Ok(obs
            .glyphs
            .iter()
            .filter(|g| !crate::redact::is_whitespace_glyph(&g.text))
            .map(|g| TextGlyph {
                text: g.text.clone(),
                rect: crate::detect::to_display_rect(g.bbox, obs.height_pt),
            })
            .collect())
    }
}

/// One glyph's recognized text and its bounding rectangle, as returned by
/// [`Document::page_text_glyphs`].
#[derive(Debug, Clone)]
pub struct TextGlyph {
    pub text: String,
    pub rect: Rect,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> Vec<u8> {
        include_bytes!("../tests/fixtures/blank.pdf").to_vec()
    }

    #[test]
    fn loads_and_counts_one_page() {
        let doc = Document::load(blank()).expect("loads");
        assert_eq!(doc.page_count(), 1);
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            Document::load(b"not a pdf".to_vec()),
            Err(PdfError::Parse)
        ));
    }

    #[test]
    fn reports_letter_page_size() {
        let doc = Document::load(blank()).unwrap();
        let size = doc.page_size(0).unwrap();
        assert!((size.width_pt - 612.0).abs() < 1.0);
        assert!((size.height_pt - 792.0).abs() < 1.0);
        assert_eq!(doc.page_size(5), Err(PdfError::PageOutOfRange));
    }

    #[test]
    fn page_text_rects_locates_visible_text() {
        let doc = Document::load(include_bytes!("../tests/fixtures/hello.pdf").to_vec()).unwrap();
        let rects = doc.page_text_rects(0).unwrap();
        assert!(!rects.is_empty(), "hello.pdf page 0 has visible text");
    }

    #[test]
    fn page_text_rects_empty_for_blank_page() {
        let doc = Document::load(blank()).unwrap();
        assert!(doc.page_text_rects(0).unwrap().is_empty());
    }

    #[test]
    fn page_text_glyphs_recovers_the_visible_text_and_a_rect_per_glyph() {
        let doc = Document::load(include_bytes!("../tests/fixtures/hello.pdf").to_vec()).unwrap();
        let glyphs = doc.page_text_glyphs(0).unwrap();
        assert!(!glyphs.is_empty(), "hello.pdf page 0 has visible text");
        let recovered: String = glyphs.iter().map(|g| g.text.as_str()).collect();
        assert!(
            recovered.contains("Hello"),
            "recovered text was {recovered:?}"
        );
        // Every glyph carries a non-degenerate rect in the same frame page_text_rects uses.
        assert!(glyphs
            .iter()
            .any(|g| g.rect.x1 > g.rect.x0 && g.rect.y1 > g.rect.y0));
    }

    #[test]
    fn page_text_glyphs_empty_for_blank_page() {
        let doc = Document::load(blank()).unwrap();
        assert!(doc.page_text_glyphs(0).unwrap().is_empty());
    }

    #[test]
    fn renders_rgba_at_dpi() {
        let doc = Document::load(blank()).unwrap();
        let page = doc.render_page(0, 72.0, false).unwrap();
        assert!(!page.png);
        assert_eq!(page.width, 612);
        assert_eq!(page.height, 792);
        // RGBA8 == 4 bytes per pixel
        assert_eq!(page.data.len(), (page.width * page.height * 4) as usize);
    }

    #[test]
    fn renders_png_when_asked() {
        let doc = Document::load(blank()).unwrap();
        let page = doc.render_page(0, 72.0, true).unwrap();
        assert!(page.png);
        assert_eq!(&page.data[1..4], b"PNG");
    }

    #[test]
    fn load_rejects_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        // Document doesn't implement PartialEq/Debug (it wraps an opaque parser type),
        // so use matches! as the existing tests do for this result shape.
        assert!(matches!(Document::load(big), Err(PdfError::Rejected)));
    }

    #[test]
    fn load_protected_rejects_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        // Document doesn't implement PartialEq/Debug (it wraps an opaque parser type),
        // so use matches! rather than assert_eq! — same pattern as load_rejects_oversize_input.
        assert!(matches!(
            Document::load_protected(big, "pw"),
            Err(SecureError::Rejected)
        ));
    }

    #[test]
    fn load_protected_opens_an_unencrypted_document() {
        // blank.pdf renders in hayro but is not loadable by the model parser, so this
        // also exercises load_protected's fallback to the plain render-path load.
        let doc = Document::load_protected(blank(), "").expect("loads unencrypted via protected");
        assert_eq!(doc.page_count(), 1);
    }

    #[test]
    fn to_rgb_image_composites_transparent_pixels_over_white() {
        // Straight alpha: a fully transparent pixel carries RGB 0. Dropping alpha would
        // render it black; compositing over white renders it white, which is what a blank
        // region of a page actually looks like.
        let page = RenderedPage {
            data: vec![0, 0, 0, 0],
            width: 1,
            height: 1,
            png: false,
        };
        let image = page.to_rgb_image().unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn to_rgb_image_preserves_opaque_pixels() {
        let page = RenderedPage {
            data: vec![10, 20, 30, 255],
            width: 1,
            height: 1,
            png: false,
        };
        assert_eq!(page.to_rgb_image().unwrap().get_pixel(0, 0).0, [10, 20, 30]);
    }

    #[test]
    fn to_rgb_image_composites_a_half_transparent_pixel() {
        // out = alpha * src + (1 - alpha) * 255, with alpha = 128/255.
        let page = RenderedPage {
            data: vec![0, 0, 0, 128],
            width: 1,
            height: 1,
            png: false,
        };
        let value = page.to_rgb_image().unwrap().get_pixel(0, 0).0[0];
        assert!(
            (126..=128).contains(&value),
            "expected mid-grey, got {value}"
        );
    }

    #[test]
    fn to_rgb_image_rejects_a_png_buffer_rather_than_reinterpreting_it() {
        let page = RenderedPage {
            data: vec![0x89, b'P', b'N', b'G'],
            width: 1,
            height: 1,
            png: true,
        };
        assert!(page.to_rgb_image().is_none());
    }

    #[test]
    fn to_rgb_image_rejects_a_truncated_buffer() {
        let page = RenderedPage {
            data: vec![10, 20, 30],
            width: 2,
            height: 1,
            png: false,
        };
        assert!(page.to_rgb_image().is_none());
    }
}
