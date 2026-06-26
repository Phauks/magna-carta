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

impl From<crate::bates::BatesError> for JsError {
    fn from(e: crate::bates::BatesError) -> Self {
        JsError::new(match e {
            crate::bates::BatesError::Parse => "failed to parse PDF",
            crate::bates::BatesError::NoPages => "document has no pages",
            crate::bates::BatesError::Reassemble => "failed to reassemble PDF",
            crate::bates::BatesError::RangeExceeded => {
                "bates numbering exceeds the configured stop number"
            }
        })
    }
}

#[derive(serde::Deserialize, Default)]
struct JsBatesOpts {
    prefix: Option<String>,
    suffix: Option<String>,
    #[serde(rename = "startNumber")]
    start_number: Option<u64>,
    /// Read as f64 so a plain JavaScript number like `4` is always accepted.
    /// `u64` in serde-wasm-bindgen 0.6 expects BigInt on the serialization path;
    /// reading via f64 avoids any mismatch when the caller passes a regular number.
    #[serde(rename = "stopNumber")]
    stop_number: Option<f64>,
    padding: Option<u8>,
    position: Option<String>,
    font: Option<String>,
    #[serde(rename = "marginPt")]
    margin_pt: Option<f32>,
    #[serde(rename = "fontSizePt")]
    font_size_pt: Option<f32>,
}

impl From<crate::FormError> for JsError {
    fn from(e: crate::FormError) -> Self {
        JsError::new(match e {
            crate::FormError::Parse(_) => "failed to parse PDF",
            crate::FormError::Reassemble(_) => "failed to reassemble PDF",
            crate::FormError::NoAcroForm => "document has no interactive form",
        })
    }
}

fn field_kind_str(k: crate::FieldKind) -> &'static str {
    match k {
        crate::FieldKind::Text => "text",
        crate::FieldKind::Checkbox => "checkbox",
        crate::FieldKind::Radio => "radio",
        crate::FieldKind::Choice => "choice",
        crate::FieldKind::PushButton => "pushButton",
        crate::FieldKind::Signature => "signature",
        crate::FieldKind::Unknown => "unknown",
    }
}

/// Enumerate all interactive form fields in a PDF.
///
/// Returns an array of field objects, each with: `name` (string), `kind`
/// (string — one of `"text"`, `"checkbox"`, `"radio"`, `"choice"`,
/// `"pushButton"`, `"signature"`, `"unknown"`), `value` (string | boolean |
/// null), `options` (string[]), `readOnly` (boolean), `page` (number | null),
/// `rect` ([number,number,number,number] | null).
///
/// **Forms are not redaction.** This function reads field metadata only; no
/// content is removed or modified. Use `redactDocument`/`sanitizeDocument` to
/// remove content.
#[wasm_bindgen(js_name = readForm)]
pub fn read_form_edge(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let fields = crate::read_form(&bytes)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };
    let arr = js_sys::Array::new();
    for f in &fields {
        let o = js_sys::Object::new();
        set(&o, "name", &f.name.as_str().into());
        set(&o, "kind", &field_kind_str(f.kind).into());
        let value_js = match &f.value {
            Some(crate::FieldValue::Text(s)) => JsValue::from_str(s),
            Some(crate::FieldValue::Choice(s)) => JsValue::from_str(s),
            Some(crate::FieldValue::Bool(b)) => JsValue::from(*b),
            None => JsValue::NULL,
        };
        set(&o, "value", &value_js);
        let options_arr = js_sys::Array::new();
        for opt in &f.options {
            options_arr.push(&JsValue::from_str(opt));
        }
        set(&o, "options", &options_arr);
        set(&o, "readOnly", &JsValue::from(f.read_only));
        set(
            &o,
            "page",
            &f.page.map(|p| JsValue::from(p)).unwrap_or(JsValue::NULL),
        );
        let rect_js = match f.rect {
            Some(r) => {
                let ra = js_sys::Array::new();
                for v in &r {
                    ra.push(&JsValue::from(*v));
                }
                ra.into()
            }
            None => JsValue::NULL,
        };
        set(&o, "rect", &rect_js);
        arr.push(&o);
    }
    Ok(arr.into())
}

/// Fill interactive form fields by name and optionally flatten the form.
///
/// `values` is a plain JS object mapping field names to fill values: pass a
/// string for text, choice, and radio fields; pass a boolean for checkboxes.
/// Extra keys that do not match a field are silently ignored.
///
/// `options.flatten` (default `false`): when `true`, widget appearances are
/// baked into page content and the AcroForm dictionary is dropped, producing a
/// flat static PDF. When `false`, the form remains interactive.
///
/// **Forms are not redaction.** Filling sets visible field values. Flattening
/// makes those values permanent static content. Neither operation removes hidden
/// content, metadata, or other surfaces — use `redactDocument`/`sanitizeDocument`
/// for that.
///
/// Returns `{ pdf: Uint8Array }`.
#[wasm_bindgen(js_name = fillForm)]
pub fn fill_form_edge(
    bytes: Vec<u8>,
    values: JsValue,
    options: JsValue,
) -> Result<JsValue, JsError> {
    let mut map = std::collections::BTreeMap::<String, crate::FieldValue>::new();
    if !values.is_undefined() && !values.is_null() {
        if let Some(obj) = values.dyn_ref::<js_sys::Object>() {
            let entries = js_sys::Object::entries(obj);
            for i in 0..entries.length() {
                let pair = js_sys::Array::from(&entries.get(i));
                let key = pair.get(0).as_string().unwrap_or_default();
                let val = pair.get(1);
                if let Some(s) = val.as_string() {
                    // Every JS string is mapped to FieldValue::Choice so that
                    // text fields, choice/list fields, and radio groups are all
                    // filled uniformly from a bare string — the engine's fill
                    // logic treats Text and Choice identically for appearance
                    // generation, and Radio requires Choice(on_state).
                    map.insert(key, crate::FieldValue::Choice(s));
                } else if let Some(b) = val.as_bool() {
                    map.insert(key, crate::FieldValue::Bool(b));
                }
            }
        }
    }
    #[derive(serde::Deserialize, Default)]
    struct JsFormFillOpts {
        flatten: Option<bool>,
    }
    let js_opts: JsFormFillOpts = if options.is_undefined() || options.is_null() {
        JsFormFillOpts::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    let opts = crate::FormFillOptions {
        flatten: js_opts.flatten.unwrap_or(false),
    };
    let pdf = crate::fill_form(&bytes, &map, &opts)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&pdf[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

/// Flatten all interactive form fields into static page content.
///
/// Each widget's current appearance is drawn into the page via a `Do` operator,
/// page resources are merged non-destructively, widget annotations are removed,
/// and the `/AcroForm` dictionary is dropped. The result is permanent static
/// content renderable by any PDF viewer without form support.
///
/// **Forms are not redaction.** Flattening bakes visible form values into page
/// content. It does not remove hidden content, metadata, or other surfaces — use
/// `redactDocument`/`sanitizeDocument` for that.
///
/// Returns `{ pdf: Uint8Array }`.
#[wasm_bindgen(js_name = flattenForm)]
pub fn flatten_form_edge(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let pdf = crate::flatten_form(&bytes)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&pdf[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

/// Stamps sequential Bates labels onto every page of a PDF.
///
/// The stamp is an ADDITIVE OVERLAY: all existing page content is preserved.
/// A new text stream carrying the label is appended last so it renders on top.
/// Nothing is removed, flattened, or redacted.
///
/// Returns `{ pdf: Uint8Array, start: number, end: number, pageCount: number }`.
#[wasm_bindgen(js_name = stampBates)]
pub fn stamp_bates(bytes: Vec<u8>, opts: JsValue) -> Result<JsValue, JsError> {
    let js_opts: JsBatesOpts = if opts.is_undefined() || opts.is_null() {
        JsBatesOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts)?
    };

    let position = match js_opts.position.as_deref() {
        Some("bottomLeft") => crate::bates::BatesPosition::BottomLeft,
        Some("bottomCenter") => crate::bates::BatesPosition::BottomCenter,
        Some("topRight") => crate::bates::BatesPosition::TopRight,
        Some("topLeft") => crate::bates::BatesPosition::TopLeft,
        Some("topCenter") => crate::bates::BatesPosition::TopCenter,
        _ => crate::bates::BatesPosition::BottomRight,
    };

    let font = match js_opts.font.as_deref() {
        Some("helvetica-bold") => crate::bates::BatesFont::HelveticaBold,
        Some("helvetica-oblique") => crate::bates::BatesFont::HelveticaOblique,
        Some("helvetica-boldoblique") => crate::bates::BatesFont::HelveticaBoldOblique,
        Some("times-roman") => crate::bates::BatesFont::TimesRoman,
        Some("times-bold") => crate::bates::BatesFont::TimesBold,
        Some("times-italic") => crate::bates::BatesFont::TimesItalic,
        Some("times-bolditalic") => crate::bates::BatesFont::TimesBoldItalic,
        Some("courier") => crate::bates::BatesFont::Courier,
        Some("courier-bold") => crate::bates::BatesFont::CourierBold,
        Some("courier-oblique") => crate::bates::BatesFont::CourierOblique,
        Some("courier-boldoblique") => crate::bates::BatesFont::CourierBoldOblique,
        // "helvetica", unknown values, and absent all default to Helvetica.
        _ => crate::bates::BatesFont::Helvetica,
    };

    let defaults = crate::bates::BatesOptions::default();
    let bates_opts = crate::bates::BatesOptions {
        prefix: js_opts.prefix.unwrap_or(defaults.prefix),
        suffix: js_opts.suffix.unwrap_or(defaults.suffix),
        start_number: js_opts.start_number.unwrap_or(defaults.start_number),
        stop_number: js_opts.stop_number.and_then(|n| {
            if n.is_finite() && n >= 0.0 {
                Some(n as u64)
            } else {
                None
            }
        }),
        padding: js_opts.padding.unwrap_or(defaults.padding),
        position,
        font,
        margin_pt: js_opts.margin_pt.unwrap_or(defaults.margin_pt),
        font_size_pt: js_opts.font_size_pt.unwrap_or(defaults.font_size_pt),
    };

    let start = bates_opts.start_number;
    let (pdf_bytes, range) = crate::bates::stamp_document(&bytes, &bates_opts, start)?;

    let result = js_sys::Object::new();
    js_sys::Reflect::set(
        &result,
        &"pdf".into(),
        &js_sys::Uint8Array::from(&pdf_bytes[..]),
    )
    .map_err(|e| JsError::new(&format!("{e:?}")))?;
    js_sys::Reflect::set(&result, &"start".into(), &JsValue::from(range.start as f64))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    js_sys::Reflect::set(&result, &"end".into(), &JsValue::from(range.end as f64))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    js_sys::Reflect::set(
        &result,
        &"pageCount".into(),
        &JsValue::from(range.page_count as u32),
    )
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
