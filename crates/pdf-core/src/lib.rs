#[cfg(target_arch = "wasm32")]
mod wasm;

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render, RenderCache, RenderSettings};

/// What a PDF operation can fail at. No logging here — the caller owns that.
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    Parse,
    PageOutOfRange,
    Render,
}

/// A parsed PDF held in memory.
pub struct Document {
    pdf: Pdf,
}

impl Document {
    pub fn load(bytes: Vec<u8>) -> Result<Self, PdfError> {
        Pdf::new(bytes)
            .map(|pdf| Document { pdf })
            .map_err(|_| PdfError::Parse)
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
}
