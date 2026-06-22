//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here.
use crate::{redact, Document, PdfError, Rect, RedactionOptions, RedactionRegion};
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

impl From<crate::RedactError> for JsError {
    fn from(e: crate::RedactError) -> Self {
        match e {
            crate::RedactError::Parse => JsError::new("failed to parse PDF"),
            crate::RedactError::PageOutOfRange => JsError::new("page index out of range"),
            crate::RedactError::Render => JsError::new("failed to render page"),
            crate::RedactError::Reassemble => JsError::new("failed to reassemble PDF"),
            crate::RedactError::GateFailed { detail } => {
                JsError::new(&format!("redaction verification failed: {detail}"))
            }
        }
    }
}

#[wasm_bindgen(js_name = redactDocument)]
pub fn redact_document(
    bytes: Vec<u8>,
    regions: JsValue,
    opts: JsValue,
) -> Result<JsValue, JsError> {
    #[derive(serde::Deserialize)]
    struct JsRect {
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
    }
    #[derive(serde::Deserialize)]
    struct JsRegion {
        page: usize,
        rect: JsRect,
        #[serde(default)]
        reason: Option<String>,
    }
    #[derive(serde::Deserialize, Default)]
    struct JsOpts {
        dpi: Option<f32>,
        #[serde(rename = "redactedText", default)]
        redacted_text: Vec<String>,
    }

    let js_regions: Vec<JsRegion> = serde_wasm_bindgen::from_value(regions)?;
    let js_opts: JsOpts = if opts.is_undefined() || opts.is_null() {
        JsOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts)?
    };

    let regions: Vec<RedactionRegion> = js_regions
        .into_iter()
        .map(|r| RedactionRegion {
            page: r.page,
            rect: Rect {
                x0: r.rect.x0,
                y0: r.rect.y0,
                x1: r.rect.x1,
                y1: r.rect.y1,
            },
            reason: r.reason,
        })
        .collect();
    let options = RedactionOptions {
        dpi: js_opts.dpi.unwrap_or(300.0),
        redacted_text: js_opts.redacted_text,
    };

    let outcome = redact(bytes, &regions, &options)?;

    let result = js_sys::Object::new();
    js_sys::Reflect::set(
        &result,
        &"pdf".into(),
        &js_sys::Uint8Array::from(&outcome.pdf[..]),
    )
    .map_err(|e| JsError::new(&format!("{e:?}")))?;
    let pages = js_sys::Array::new();
    for p in outcome.report.pages_redacted {
        pages.push(&JsValue::from(p as u32));
    }
    js_sys::Reflect::set(&result, &"pagesRedacted".into(), &pages)
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}
