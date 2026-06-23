//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here.
use crate::{
    detect, redact, sanitize, Category, Document, PdfError, Rect, RedactionMode, RedactionOptions,
    RedactionRegion, ScrubOptions, Severity,
};
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
        #[serde(default)]
        mode: Option<String>,
    }

    let js_regions: Vec<JsRegion> = serde_wasm_bindgen::from_value(regions)?;
    // Read the optional `scrub` sub-object before `opts` is consumed below.
    let scrub_value = if opts.is_undefined() || opts.is_null() {
        JsValue::UNDEFINED
    } else {
        js_sys::Reflect::get(&opts, &"scrub".into()).unwrap_or(JsValue::UNDEFINED)
    };
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
    let mode = match js_opts.mode.as_deref() {
        Some("surgery") => RedactionMode::Surgery,
        _ => RedactionMode::Flatten,
    };
    let options = RedactionOptions {
        dpi: js_opts.dpi.unwrap_or(300.0),
        redacted_text: js_opts.redacted_text,
        scrub: scrub_options_from_js(&scrub_value)?,
        mode,
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
    let pages_surgered = js_sys::Array::new();
    for p in outcome.report.pages_surgered {
        pages_surgered.push(&JsValue::from(p as u32));
    }
    js_sys::Reflect::set(&result, &"pagesSurgered".into(), &pages_surgered)
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    let pages_flattened = js_sys::Array::new();
    for p in outcome.report.pages_flattened {
        pages_flattened.push(&JsValue::from(p as u32));
    }
    js_sys::Reflect::set(&result, &"pagesFlattened".into(), &pages_flattened)
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

impl From<crate::ScrubError> for JsError {
    fn from(e: crate::ScrubError) -> Self {
        match e {
            crate::ScrubError::Parse => JsError::new("failed to parse PDF"),
            crate::ScrubError::Reassemble => JsError::new("failed to reassemble PDF"),
            crate::ScrubError::GateFailed { detail } => {
                JsError::new(&format!("sanitize verification failed: {detail}"))
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct JsScrubOptions {
    metadata: Option<bool>,
    attachments: Option<bool>,
    xfa: Option<bool>,
    #[serde(rename = "formFieldValues")]
    form_field_values: Option<bool>,
    #[serde(rename = "structureTree")]
    structure_tree: Option<bool>,
    outlines: Option<bool>,
    #[serde(rename = "optionalContent")]
    optional_content: Option<bool>,
}

fn scrub_options_from_js(value: &JsValue) -> Result<ScrubOptions, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(ScrubOptions::default());
    }
    let js: JsScrubOptions = serde_wasm_bindgen::from_value(value.clone())?;
    let d = ScrubOptions::default();
    Ok(ScrubOptions {
        metadata: js.metadata.unwrap_or(d.metadata),
        attachments: js.attachments.unwrap_or(d.attachments),
        xfa: js.xfa.unwrap_or(d.xfa),
        form_field_values: js.form_field_values.unwrap_or(d.form_field_values),
        structure_tree: js.structure_tree.unwrap_or(d.structure_tree),
        outlines: js.outlines.unwrap_or(d.outlines),
        optional_content: js.optional_content.unwrap_or(d.optional_content),
    })
}

#[wasm_bindgen(js_name = sanitizeDocument)]
pub fn sanitize_document_edge(bytes: Vec<u8>, opts: JsValue) -> Result<JsValue, JsError> {
    let options = scrub_options_from_js(&opts)?;
    let out = sanitize(bytes, &options)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&out[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

impl From<crate::DetectError> for JsError {
    fn from(e: crate::DetectError) -> Self {
        match e {
            crate::DetectError::Parse => JsError::new("failed to parse PDF"),
        }
    }
}

fn category_str(c: Category) -> &'static str {
    match c {
        Category::CoveredText => "coveredText",
        Category::InvisibleText => "invisibleText",
        Category::WhiteoutText => "whiteoutText",
        Category::RemovableAnnotation => "removableAnnotation",
        Category::HiddenLayer => "hiddenLayer",
        Category::MetadataLeak => "metadataLeak",
        Category::OrphanedText => "orphanedText",
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "critical",
        Severity::High => "high",
        Severity::Medium => "medium",
        Severity::Low => "low",
        Severity::Info => "info",
    }
}

#[wasm_bindgen(js_name = detectDocument)]
pub fn detect_document(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let report = detect(bytes)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };

    let findings = js_sys::Array::new();
    for f in &report.findings {
        let o = js_sys::Object::new();
        set(&o, "category", &category_str(f.category).into());
        set(&o, "severity", &severity_str(f.severity).into());
        set(
            &o,
            "page",
            &f.page
                .map(|p| JsValue::from(p as u32))
                .unwrap_or(JsValue::NULL),
        );
        match &f.region {
            Some(r) => {
                let ro = js_sys::Object::new();
                set(&ro, "x0", &JsValue::from(r.x0));
                set(&ro, "y0", &JsValue::from(r.y0));
                set(&ro, "x1", &JsValue::from(r.x1));
                set(&ro, "y1", &JsValue::from(r.y1));
                set(&o, "region", &ro.into());
            }
            None => set(&o, "region", &JsValue::NULL),
        }
        set(&o, "recoveredText", &f.recovered_text.as_str().into());
        set(&o, "detail", &f.detail.as_str().into());
        findings.push(&o);
    }

    let summary = js_sys::Object::new();
    set(
        &summary,
        "critical",
        &JsValue::from(report.summary.critical as u32),
    );
    set(&summary, "high", &JsValue::from(report.summary.high as u32));
    set(
        &summary,
        "medium",
        &JsValue::from(report.summary.medium as u32),
    );
    set(&summary, "low", &JsValue::from(report.summary.low as u32));
    set(&summary, "info", &JsValue::from(report.summary.info as u32));

    let result = js_sys::Object::new();
    set(&result, "findings", &findings);
    set(&result, "summary", &summary);
    set(
        &result,
        "pagesScanned",
        &JsValue::from(report.pages_scanned as u32),
    );
    set(
        &result,
        "glyphsExamined",
        &JsValue::from(report.glyphs_examined as u32),
    );
    let pages_unreadable = js_sys::Array::new();
    for p in &report.pages_unreadable {
        pages_unreadable.push(&JsValue::from(*p as u32));
    }
    set(&result, "pagesUnreadable", &pages_unreadable);
    Ok(result.into())
}
