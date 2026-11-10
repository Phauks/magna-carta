#[cfg(target_arch = "wasm32")]
mod wasm;

mod annotations;
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

mod textextract;
pub use textextract::{
    needs_recognition, PageTextFacts, TextLayerLine, MAX_TEXT_EXTRACTION_PAGES,
    SCANNED_PAGE_RASTER_COVERAGE, TEXT_LAYER_COVERAGE,
};

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

mod searchable;
pub use searchable::{write_searchable_text_layer, PageTextLayer, TextRun};

mod sign;
pub use sign::{
    embed_signature, prepare_signature, signed_bytes, PreparedSignature, SignError,
    SignatureOptions,
};

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};

/// What a PDF operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    /// The document is locked with a password and was not opened: nothing in it can be
    /// read, so there is nothing to work on until [`crate::decrypt`] has unlocked it.
    Encrypted,
    Parse,
    PageOutOfRange,
    Render,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb), or a page
    /// whose rasterized size exceeds [`MAX_RENDER_PIXELS`].
    Rejected,
}

/// The most pixels any single page may rasterize to. A page's dimensions are declared
/// in the file and are wholly attacker-controlled, while the raster is allocated eagerly
/// at 4 bytes per pixel and then round-tripped through two more full-size buffers: a
/// kilobyte of PDF declaring a 200-inch page would otherwise ask for gigabytes. The
/// input bomb guard cannot see this — it bounds input bytes and stream inflation, never
/// page geometry — so the ceiling belongs here, at the allocation.
///
/// 80 million pixels is ~320 MB of RGBA. It clears a 36x48in E-size engineering exhibit
/// at 215 DPI and a US-Letter page at well over 600 DPI, so no real document is refused;
/// what it refuses is the declared-geometry bomb. Callers that would rather degrade than
/// fail should scale their DPI to fit this budget (the OCR container does).
pub const MAX_RENDER_PIXELS: u64 = 80_000_000;

/// How many pixels a page of `width_pt` x `height_pt` rasterizes to at `dpi`. Saturating:
/// a page declaring absurd dimensions must report an absurd pixel count, never wrap around
/// or collapse to a small one and slip under a cap.
///
/// An *infinite* or NaN dimension reports [`u64::MAX`], not zero — the renderer does not
/// treat it as nothing, it saturates it to 65535 pixels on that axis, so "unmeasurable"
/// has to mean "refuse", not "allow". A zero or negative dimension is genuinely nothing:
/// the renderer floors it at a single pixel, and no allocation of consequence follows.
pub fn rendered_pixels(width_pt: f32, height_pt: f32, dpi: f32) -> u64 {
    let axis = |points: f32| -> u64 {
        if points.is_nan() || points.is_infinite() || dpi.is_nan() || dpi.is_infinite() {
            return u64::MAX;
        }
        let pixels = (points * (dpi / 72.0)).ceil();
        if !pixels.is_finite() {
            return u64::MAX;
        }
        if pixels <= 0.0 {
            return 0;
        }
        // `as` saturates at u64::MAX past the range; NaN and infinity are handled above.
        pixels as u64
    };
    axis(width_pt).saturating_mul(axis(height_pt))
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
        // Refuse the allocation before making it. `render_dimensions` is the page's own
        // declared geometry, so this is the first point at which the raster's true cost
        // is known and the last at which it can still be declined.
        let (width_pt, height_pt) = page.render_dimensions();
        if rendered_pixels(width_pt, height_pt, dpi) > MAX_RENDER_PIXELS {
            return Err(PdfError::Rejected);
        }
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

    /// The share of page `index` -- from 0.0 to 1.0 -- covered by text a human eye can
    /// actually see: the summed area of every non-whitespace glyph box drawn in a
    /// *visible* render mode, over the page's own area.
    ///
    /// This deliberately answers a different question than [`Document::page_text_rects`],
    /// which reports invisible glyphs too because hidden-but-extractable text is exactly
    /// what redaction exists to find. A caller asking "does a person reading this page
    /// see words?" -- an OCR gate deciding whether a page still needs recognizing -- must
    /// not be answered "yes" by an invisible text layer, nor by a Bates stamp: a single
    /// stamp in the corner of a scanned page is real, visible text, and treating its
    /// presence as a text layer would silently discard the entire page's content. A
    /// coverage ratio separates the two; mere presence cannot.
    ///
    /// Glyph boxes may overlap, so the sum is clamped to 1.0 rather than pretending to
    /// be an exact union. Returns `PageOutOfRange` if the page cannot be observed.
    ///
    /// A caller that also wants the page's raster share or its text should ask
    /// [`Document::page_text_facts`] instead — it answers all three from one observation,
    /// and observing the page is the expensive part.
    pub fn page_visible_text_coverage(&self, index: usize) -> Result<f32, PdfError> {
        let obs = crate::textpos::observe_page(&self.pdf, index).ok_or(PdfError::PageOutOfRange)?;
        Ok(crate::textextract::coverages(&obs).text)
    }

    /// The share of page `index` -- from 0.0 to 1.0 -- covered by raster images. A
    /// scanned page *is* an image: this is what tells a page whose content is pixels
    /// (and therefore has something to recognize) from one drawn as text and vectors
    /// (which has nothing an OCR pass could add). Vector fills are not counted -- only
    /// image XObjects, the thing a scanner produces.
    ///
    /// Boxes may overlap, so the sum is clamped to 1.0. Returns `PageOutOfRange` if the
    /// page cannot be observed.
    pub fn page_raster_coverage(&self, index: usize) -> Result<f32, PdfError> {
        let obs = crate::textpos::observe_page(&self.pdf, index).ok_or(PdfError::PageOutOfRange)?;
        Ok(crate::textextract::coverages(&obs).raster)
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
    fn a_render_past_the_pixel_ceiling_is_refused_before_it_is_allocated() {
        // The page's dimensions are declared in the file and wholly attacker-controlled,
        // while the raster is allocated eagerly at 4 bytes a pixel. A US Letter page asked
        // for at an absurd density is the same allocation as an absurd page at an ordinary
        // one, and neither may be attempted.
        let doc = Document::load(blank()).unwrap();
        let dpi = 20_000.0; // 612x792pt at 20k DPI is ~37 billion pixels
        assert!(matches!(
            doc.render_page(0, dpi, false),
            Err(PdfError::Rejected)
        ));
    }

    #[test]
    fn rendered_pixels_saturates_rather_than_wrapping() {
        // A page declaring nonsense must report an absurd pixel count -- never wrap around
        // to a small one and slip under the ceiling.
        assert!(rendered_pixels(f32::MAX, f32::MAX, 300.0) > MAX_RENDER_PIXELS);
        // Unmeasurable is not the same as empty. The renderer saturates an infinite axis to
        // 65535 pixels rather than skipping it, so reporting zero here would hand a
        // multi-gigabyte allocation a clean bill of health.
        assert!(rendered_pixels(f32::INFINITY, 792.0, 300.0) > MAX_RENDER_PIXELS);
        assert!(rendered_pixels(f32::NAN, 792.0, 300.0) > MAX_RENDER_PIXELS);
        assert!(rendered_pixels(612.0, 792.0, f32::INFINITY) > MAX_RENDER_PIXELS);
        // A degenerate or negative page is genuinely nothing: the renderer floors it at one
        // pixel, so it is not a negative count cast into a huge one either.
        assert_eq!(rendered_pixels(-612.0, 792.0, 300.0), 0);
        // The ordinary case still computes exactly.
        assert_eq!(rendered_pixels(612.0, 792.0, 72.0), 612 * 792);
    }

    #[test]
    fn visible_text_coverage_measures_how_much_of_the_page_is_text() {
        // hello.pdf is a 200x50pt card carrying 20pt bold text: the text is most of what
        // is on it, and the measure says so. A page whose text is a mark in the corner --
        // a Bates stamp on a scan -- lands orders of magnitude below this, which is the
        // separation the measure exists to make.
        let doc = Document::load(include_bytes!("../tests/fixtures/hello.pdf").to_vec()).unwrap();
        let coverage = doc.page_visible_text_coverage(0).unwrap();
        assert!(
            coverage > 0.05,
            "a page that is mostly text should measure as mostly text, got {coverage}"
        );
        assert!(coverage <= 1.0, "coverage is a ratio, got {coverage}");
        assert_eq!(
            Document::load(blank())
                .unwrap()
                .page_visible_text_coverage(0)
                .unwrap(),
            0.0
        );
    }

    #[test]
    fn raster_coverage_is_zero_for_a_page_drawn_as_text() {
        // hello.pdf is born-digital: no scanner ever touched it, so there is no image on
        // it -- which is what tells an OCR gate the page has nothing to recognize.
        let doc = Document::load(include_bytes!("../tests/fixtures/hello.pdf").to_vec()).unwrap();
        assert_eq!(doc.page_raster_coverage(0).unwrap(), 0.0);
        assert_eq!(
            Document::load(blank())
                .unwrap()
                .page_raster_coverage(0)
                .unwrap(),
            0.0
        );
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
