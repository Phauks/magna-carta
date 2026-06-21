//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here.
use crate::{Document, PdfError};
use wasm_bindgen::prelude::*;

impl From<PdfError> for JsError {
    fn from(e: PdfError) -> Self {
        JsError::new(match e {
            PdfError::Parse => "failed to parse PDF",
            PdfError::PageOutOfRange => "page index out of range",
            PdfError::Render => "failed to render page",
        })
    }
}

#[wasm_bindgen]
pub struct PdfDocument {
    inner: Document,
}

#[wasm_bindgen]
pub struct PageSize {
    #[wasm_bindgen(js_name = widthPt, readonly)]
    pub width_pt: f32,
    #[wasm_bindgen(js_name = heightPt, readonly)]
    pub height_pt: f32,
}

#[wasm_bindgen]
pub struct RenderedPage {
    data: Vec<u8>,
    #[wasm_bindgen(readonly)]
    pub width: u32,
    #[wasm_bindgen(readonly)]
    pub height: u32,
    #[wasm_bindgen(readonly)]
    pub png: bool,
}

#[wasm_bindgen]
impl RenderedPage {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }
}

#[wasm_bindgen]
impl PdfDocument {
    pub fn load(bytes: Vec<u8>) -> Result<PdfDocument, JsError> {
        Ok(PdfDocument {
            inner: Document::load(bytes)?,
        })
    }

    #[wasm_bindgen(getter, js_name = pageCount)]
    pub fn page_count(&self) -> usize {
        self.inner.page_count()
    }

    #[wasm_bindgen(js_name = pageSize)]
    pub fn page_size(&self, index: usize) -> Result<PageSize, JsError> {
        let s = self.inner.page_size(index)?;
        Ok(PageSize {
            width_pt: s.width_pt,
            height_pt: s.height_pt,
        })
    }

    #[wasm_bindgen(js_name = renderPage)]
    pub fn render_page(
        &self,
        index: usize,
        dpi: f32,
        encode_png: bool,
    ) -> Result<RenderedPage, JsError> {
        let p = self.inner.render_page(index, dpi, encode_png)?;
        Ok(RenderedPage {
            data: p.data,
            width: p.width,
            height: p.height,
            png: p.png,
        })
    }
}
