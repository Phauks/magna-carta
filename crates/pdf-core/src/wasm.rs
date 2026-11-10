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
            PdfError::Rejected => "decompression-bomb",
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
            crate::RedactError::Rejected => JsError::new("decompression-bomb"),
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
            crate::ScrubError::Rejected => JsError::new("decompression-bomb"),
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
            crate::bates::BatesError::Rejected => "decompression-bomb",
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
            crate::FormError::Rejected => "decompression-bomb",
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
/// null), `options` (string[]), `readOnly` (boolean), `required` (boolean),
/// `page` (number | null), `rect` ([number,number,number,number] | null).
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
        set(&o, "required", &JsValue::from(f.required));
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
            crate::DetectError::Rejected => JsError::new("decompression-bomb"),
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

// ── Security: inspect / decrypt / secure ────────────────────────────────────────
//
// A password NEVER appears in an error: every `SecureError` maps to a static token.
// `decryptDocument` throws the token `"wrong-password"` so a caller can re-prompt
// rather than treat a bad password as a corrupt file.

impl From<crate::SecureError> for JsError {
    fn from(e: crate::SecureError) -> Self {
        JsError::new(match e {
            crate::SecureError::Parse => "failed to parse PDF",
            crate::SecureError::WrongPassword => "wrong-password",
            crate::SecureError::UnsupportedHandler => "unsupported-encryption",
            crate::SecureError::AlreadyEncrypted => "already-encrypted",
            crate::SecureError::Reassemble => "failed to reassemble PDF",
            crate::SecureError::Rejected => "decompression-bomb",
        })
    }
}

fn handler_str(h: crate::Handler) -> &'static str {
    match h {
        crate::Handler::Standard => "standard",
        crate::Handler::PublicKey => "publicKey",
        crate::Handler::None => "none",
    }
}

fn algorithm_str(a: crate::Algorithm) -> &'static str {
    match a {
        crate::Algorithm::Rc4 => "rc4",
        crate::Algorithm::Aes128 => "aes128",
        crate::Algorithm::Aes256 => "aes256",
        crate::Algorithm::Unknown => "unknown",
        crate::Algorithm::None => "none",
    }
}

/// Classify a PDF's security without a password.
///
/// Returns `{ encrypted: boolean, handler: "standard"|"publicKey"|"none",
/// algorithm: "rc4"|"aes128"|"aes256"|"unknown"|"none", hasUserPassword: boolean,
/// permissions: { print, printHighRes, copy, modify, annotate, fillForms, assemble,
/// accessibilityCopy } | null }`. `permissions` is `null` when the policy cannot be
/// read (a document opened by the empty password).
#[wasm_bindgen(js_name = inspectSecurity)]
pub fn inspect_security_edge(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let info = crate::inspect_security(&bytes)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };
    let o = js_sys::Object::new();
    set(&o, "encrypted", &JsValue::from(info.encrypted));
    set(&o, "handler", &handler_str(info.handler).into());
    set(&o, "algorithm", &algorithm_str(info.algorithm).into());
    set(
        &o,
        "hasUserPassword",
        &JsValue::from(info.has_user_password),
    );
    let permissions = match info.permissions {
        Some(p) => {
            let po = js_sys::Object::new();
            set(&po, "print", &JsValue::from(p.print));
            set(&po, "printHighRes", &JsValue::from(p.print_high_res));
            set(&po, "copy", &JsValue::from(p.copy));
            set(&po, "modify", &JsValue::from(p.modify));
            set(&po, "annotate", &JsValue::from(p.annotate));
            set(&po, "fillForms", &JsValue::from(p.fill_forms));
            set(&po, "assemble", &JsValue::from(p.assemble));
            set(
                &po,
                "accessibilityCopy",
                &JsValue::from(p.accessibility_copy),
            );
            po.into()
        }
        None => JsValue::NULL,
    };
    set(&o, "permissions", &permissions);
    Ok(o.into())
}

/// Unlock a password-protected PDF, returning `{ pdf: Uint8Array }` of plaintext.
///
/// Throws `"wrong-password"` for a bad password (distinct from a parse failure). An
/// unencrypted input is returned unchanged. The password is never echoed in an error.
#[wasm_bindgen(js_name = decryptDocument)]
pub fn decrypt_document(bytes: Vec<u8>, password: String) -> Result<JsValue, JsError> {
    let pdf = crate::decrypt(&bytes, &password)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&pdf[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

#[derive(serde::Deserialize, Default)]
struct JsSecurePermissions {
    print: Option<bool>,
    #[serde(rename = "printHighRes")]
    print_high_res: Option<bool>,
    copy: Option<bool>,
    modify: Option<bool>,
    annotate: Option<bool>,
    #[serde(rename = "fillForms")]
    fill_forms: Option<bool>,
    assemble: Option<bool>,
    #[serde(rename = "accessibilityCopy")]
    accessibility_copy: Option<bool>,
}

#[derive(serde::Deserialize, Default)]
struct JsSecureOpts {
    #[serde(rename = "ownerPassword")]
    owner_password: Option<String>,
    #[serde(rename = "userPassword")]
    user_password: Option<String>,
    permissions: Option<JsSecurePermissions>,
    #[serde(rename = "encryptMetadata")]
    encrypt_metadata: Option<bool>,
    algorithm: Option<String>,
}

/// Protect a PDF, returning `{ pdf: Uint8Array }`.
///
/// `options`: `{ ownerPassword: string, userPassword?: string,
/// permissions?: Partial<{...eight booleans...}>, encryptMetadata?: boolean,
/// algorithm?: "aes256"|"aes128" }`. Writes AES-256 by default; never RC4. An omitted
/// permission bit defaults to allowed; an empty `userPassword` means no open password.
#[wasm_bindgen(js_name = secureDocument)]
pub fn secure_document(bytes: Vec<u8>, options: JsValue) -> Result<JsValue, JsError> {
    let js: JsSecureOpts = serde_wasm_bindgen::from_value(options)?;
    let owner_password = js.owner_password.unwrap_or_default();
    if owner_password.is_empty() {
        return Err(JsError::new("owner-password-required"));
    }
    let permissions = match js.permissions {
        Some(p) => crate::Permissions {
            print: p.print.unwrap_or(true),
            print_high_res: p.print_high_res.unwrap_or(true),
            copy: p.copy.unwrap_or(true),
            modify: p.modify.unwrap_or(true),
            annotate: p.annotate.unwrap_or(true),
            fill_forms: p.fill_forms.unwrap_or(true),
            assemble: p.assemble.unwrap_or(true),
            accessibility_copy: p.accessibility_copy.unwrap_or(true),
        },
        None => crate::Permissions::all_allowed(),
    };
    let algorithm = match js.algorithm.as_deref() {
        Some("aes128") => crate::WriteAlgorithm::Aes128,
        _ => crate::WriteAlgorithm::Aes256,
    };
    let options = crate::SecureOptions {
        owner_password,
        // An empty open password is treated as "no open password".
        user_password: js.user_password.filter(|s| !s.is_empty()),
        permissions,
        encrypt_metadata: js.encrypt_metadata.unwrap_or(true),
        algorithm,
    };
    let pdf = crate::secure(&bytes, &options)?;
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(&pdf[..]))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

// ── Generate primitives: merge / split / rotate / watermark ─────────────────────

impl From<crate::GenerateError> for JsError {
    fn from(e: crate::GenerateError) -> Self {
        JsError::new(match e {
            crate::GenerateError::Parse => "failed to parse PDF",
            crate::GenerateError::NoPages => "document has no pages",
            crate::GenerateError::PageOutOfRange => "page index out of range",
            crate::GenerateError::EmptyInput => "no documents provided",
            crate::GenerateError::Reassemble => "failed to reassemble PDF",
            crate::GenerateError::Image => "could not decode the watermark image",
            crate::GenerateError::Rejected => "decompression-bomb",
        })
    }
}

/// Build the `{ pdf: Uint8Array }` result object.
fn pdf_result(pdf: &[u8]) -> Result<JsValue, JsError> {
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdf".into(), &js_sys::Uint8Array::from(pdf))
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

/// Combine the pages of several PDFs into one. `documents` is an array of `Uint8Array`.
/// Returns `{ pdf: Uint8Array }`. Carries each input's outlines, form fields, and named
/// destinations across.
#[wasm_bindgen(js_name = mergeDocuments)]
pub fn merge_documents(documents: JsValue) -> Result<JsValue, JsError> {
    let array = js_sys::Array::from(&documents);
    let docs: Vec<Vec<u8>> = (0..array.length())
        .map(|i| js_sys::Uint8Array::new(&array.get(i)).to_vec())
        .collect();
    let refs: Vec<&[u8]> = docs.iter().map(|d| d.as_slice()).collect();
    let pdf = crate::merge(&refs)?;
    pdf_result(&pdf)
}

/// Split a PDF into one document per page range. `ranges` is an array of
/// `{ start, end }` (inclusive, 0-based). Returns `{ pdfs: Uint8Array[] }`.
#[wasm_bindgen(js_name = splitDocument)]
pub fn split_document(bytes: Vec<u8>, ranges: JsValue) -> Result<JsValue, JsError> {
    #[derive(serde::Deserialize)]
    struct JsRange {
        start: usize,
        end: usize,
    }
    let js_ranges: Vec<JsRange> = serde_wasm_bindgen::from_value(ranges)?;
    let ranges: Vec<crate::PageRange> = js_ranges
        .into_iter()
        .map(|r| crate::PageRange {
            start: r.start,
            end: r.end,
        })
        .collect();
    let pdfs = crate::split(&bytes, &ranges)?;
    let array = js_sys::Array::new();
    for pdf in pdfs {
        array.push(&js_sys::Uint8Array::from(&pdf[..]));
    }
    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"pdfs".into(), &array)
        .map_err(|e| JsError::new(&format!("{e:?}")))?;
    Ok(result.into())
}

/// Rotate pages clockwise by `rotation` (90/180/270) degrees, relative to each page's
/// existing rotation. `pages` is an array of 0-based indices, or undefined for all pages.
/// Returns `{ pdf: Uint8Array }`.
#[wasm_bindgen(js_name = rotatePages)]
pub fn rotate_pages(bytes: Vec<u8>, rotation: i32, pages: JsValue) -> Result<JsValue, JsError> {
    let rot = match rotation {
        90 => crate::Rotation::Cw90,
        180 => crate::Rotation::Cw180,
        270 => crate::Rotation::Cw270,
        _ => return Err(JsError::new("rotation must be 90, 180, or 270")),
    };
    let selection = if pages.is_undefined() || pages.is_null() {
        crate::PageSelection::All
    } else {
        let indices: Vec<usize> = serde_wasm_bindgen::from_value(pages)?;
        crate::PageSelection::Pages(indices)
    };
    let pdf = crate::rotate(&bytes, rot, &selection)?;
    pdf_result(&pdf)
}

fn watermark_font_from_str(name: Option<&str>) -> crate::bates::BatesFont {
    use crate::bates::BatesFont;
    match name {
        Some("helvetica-bold") => BatesFont::HelveticaBold,
        Some("helvetica-oblique") => BatesFont::HelveticaOblique,
        Some("helvetica-boldoblique") => BatesFont::HelveticaBoldOblique,
        Some("times-roman") => BatesFont::TimesRoman,
        Some("times-bold") => BatesFont::TimesBold,
        Some("times-italic") => BatesFont::TimesItalic,
        Some("times-bolditalic") => BatesFont::TimesBoldItalic,
        Some("courier") => BatesFont::Courier,
        Some("courier-bold") => BatesFont::CourierBold,
        Some("courier-oblique") => BatesFont::CourierOblique,
        Some("courier-boldoblique") => BatesFont::CourierBoldOblique,
        _ => BatesFont::Helvetica,
    }
}

/// Stamp an additive watermark onto every page. `options`:
/// `{ content: { kind: "text", text, font?, fontSizePt?, color? } |
///    { kind: "image", bytes, scale? }, opacity?, rotationDeg?, placement? }`.
/// Returns `{ pdf: Uint8Array }`.
#[wasm_bindgen(js_name = watermarkDocument)]
pub fn watermark_document(bytes: Vec<u8>, options: JsValue) -> Result<JsValue, JsError> {
    let get = |target: &JsValue, key: &str| js_sys::Reflect::get(target, &key.into()).ok();
    // Non-finite JS numbers (NaN/Infinity) would format as malformed PDF operators, so
    // they fall back to the default.
    let num = |target: &JsValue, key: &str, default: f32| {
        get(target, key)
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .map(|v| v as f32)
            .unwrap_or(default)
    };

    let opacity = num(&options, "opacity", 0.3);
    let rotation_deg = num(&options, "rotationDeg", 45.0);
    let placement = match get(&options, "placement")
        .and_then(|v| v.as_string())
        .as_deref()
    {
        Some("tiled") => crate::WatermarkPlacement::Tiled,
        _ => crate::WatermarkPlacement::Center,
    };

    let content_val =
        get(&options, "content").ok_or_else(|| JsError::new("watermark content is required"))?;
    let kind = get(&content_val, "kind").and_then(|v| v.as_string());
    let content = match kind.as_deref() {
        Some("image") => {
            let image_bytes = get(&content_val, "bytes")
                .ok_or_else(|| JsError::new("image watermark requires bytes"))?;
            let bytes = js_sys::Uint8Array::new(&image_bytes).to_vec();
            crate::WatermarkContent::Image {
                bytes,
                scale: num(&content_val, "scale", 0.3),
            }
        }
        _ => {
            let text = get(&content_val, "text")
                .and_then(|v| v.as_string())
                .unwrap_or_default();
            let font = watermark_font_from_str(
                get(&content_val, "font")
                    .and_then(|v| v.as_string())
                    .as_deref(),
            );
            let color = match get(&content_val, "color") {
                Some(v) if v.is_object() => {
                    let arr = js_sys::Array::from(&v);
                    let c = |i: u32, d: f32| {
                        arr.get(i)
                            .as_f64()
                            .filter(|x| x.is_finite())
                            .map(|x| x as f32)
                            .unwrap_or(d)
                    };
                    [c(0, 0.5), c(1, 0.5), c(2, 0.5)]
                }
                _ => [0.5, 0.5, 0.5],
            };
            crate::WatermarkContent::Text {
                text,
                font,
                font_size_pt: num(&content_val, "fontSizePt", 48.0),
                color,
            }
        }
    };

    let opts = crate::WatermarkOptions {
        content,
        opacity,
        rotation_deg,
        placement,
    };
    let pdf = crate::watermark(&bytes, &opts)?;
    pdf_result(&pdf)
}

// ── PAdES seal: prepare / signed-bytes / embed ──────────────────────────────────
//
// The engine owns the PDF structure end to end; the CMS is opaque here. `prepareSignature`
// appends the signature dictionary as a prefix-preserving incremental update and reserves
// `/Contents`; the host signs `signedBytesForSeal` (never in this engine); `embedSignature`
// splices the CMS into the reservation. The prepared state crosses the boundary as plain data
// (document + byteRange + contentsSpan), so it can be carried between the two host-side steps.

impl From<crate::SignError> for JsError {
    fn from(e: crate::SignError) -> Self {
        JsError::new(match e {
            crate::SignError::Parse => "failed to parse PDF",
            crate::SignError::Rejected => "decompression-bomb",
            crate::SignError::NoPages => "document has no pages",
            crate::SignError::MissingCatalog => "document has no catalog",
            crate::SignError::Malformed => "document structure is not signable",
            crate::SignError::CapacityExceeded => "signature exceeds the reserved capacity",
            crate::SignError::InvalidRange => "byte range lies outside the document",
        })
    }
}

#[derive(serde::Deserialize, Default)]
struct JsSignOpts {
    name: Option<String>,
    reason: Option<String>,
    location: Option<String>,
    #[serde(rename = "contactInfo")]
    contact_info: Option<String>,
    #[serde(rename = "signingTime")]
    signing_time: Option<String>,
    /// Read as f64 so a plain JavaScript number is accepted (see `JsBatesOpts::stop_number`).
    #[serde(rename = "contentsCapacity")]
    contents_capacity: Option<f64>,
}

/// Read a JS array of four non-negative numbers into a `/ByteRange`.
fn byte_range_from_js(value: JsValue) -> Result<[usize; 4], JsError> {
    let parts: Vec<f64> = serde_wasm_bindgen::from_value(value)?;
    if parts.len() != 4 || parts.iter().any(|n| !n.is_finite() || *n < 0.0) {
        return Err(JsError::new("byteRange must be four non-negative numbers"));
    }
    Ok([
        parts[0] as usize,
        parts[1] as usize,
        parts[2] as usize,
        parts[3] as usize,
    ])
}

/// Read a JS array of two non-negative numbers into a `[start, end)` span.
fn span_from_js(value: JsValue) -> Result<(usize, usize), JsError> {
    let parts: Vec<f64> = serde_wasm_bindgen::from_value(value)?;
    if parts.len() != 2 || parts.iter().any(|n| !n.is_finite() || *n < 0.0) {
        return Err(JsError::new(
            "contentsSpan must be two non-negative numbers",
        ));
    }
    Ok((parts[0] as usize, parts[1] as usize))
}

/// Prepare a PDF for signing: append the signature structure as an incremental update, reserving
/// `/Contents` and writing an exact `/ByteRange`. `options`:
/// `{ name?, reason?, location?, contactInfo?, signingTime?, contentsCapacity? }`. Returns
/// `{ document: Uint8Array, byteRange: [number,number,number,number], contentsSpan: [number,number] }`.
/// The input is preserved as the literal prefix of `document`. No cryptography happens here.
#[wasm_bindgen(js_name = prepareSignature)]
pub fn prepare_signature_edge(bytes: Vec<u8>, options: JsValue) -> Result<JsValue, JsError> {
    let js: JsSignOpts = if options.is_undefined() || options.is_null() {
        JsSignOpts::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    let opts = crate::SignatureOptions {
        name: js.name,
        reason: js.reason,
        location: js.location,
        contact_info: js.contact_info,
        signing_time: js.signing_time,
        contents_capacity: js
            .contents_capacity
            .filter(|n| n.is_finite() && *n >= 0.0)
            .map(|n| n as usize)
            .unwrap_or(0),
    };
    let prepared = crate::prepare_signature(&bytes, &opts)?;

    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };
    let result = js_sys::Object::new();
    set(
        &result,
        "document",
        &js_sys::Uint8Array::from(&prepared.document[..]).into(),
    );
    let range = js_sys::Array::new();
    for v in prepared.byte_range {
        range.push(&JsValue::from(v as f64));
    }
    set(&result, "byteRange", &range.into());
    let span = js_sys::Array::new();
    span.push(&JsValue::from(prepared.contents_span.0 as f64));
    span.push(&JsValue::from(prepared.contents_span.1 as f64));
    set(&result, "contentsSpan", &span.into());
    Ok(result.into())
}

/// The bytes a signer must digest for a prepared document: the two `/ByteRange` spans, concatenated.
/// `byteRange` is the array returned by `prepareSignature`.
#[wasm_bindgen(js_name = signedBytesForSeal)]
pub fn signed_bytes_edge(document: Vec<u8>, byte_range: JsValue) -> Result<Vec<u8>, JsError> {
    let range = byte_range_from_js(byte_range)?;
    // `signed_bytes` reads only the document and the range; the span is irrelevant here.
    let prepared = crate::PreparedSignature {
        document,
        byte_range: range,
        contents_span: (0, 0),
    };
    Ok(crate::signed_bytes(&prepared)?)
}

/// Splice a detached CMS (DER) into the reserved `/Contents` gap, returning the sealed PDF.
/// `contentsSpan` is the array returned by `prepareSignature`. Throws
/// `"signature exceeds the reserved capacity"` if the CMS does not fit.
#[wasm_bindgen(js_name = embedSignature)]
pub fn embed_signature_edge(
    document: Vec<u8>,
    contents_span: JsValue,
    cms: Vec<u8>,
) -> Result<Vec<u8>, JsError> {
    let span = span_from_js(contents_span)?;
    // `embed_signature` reads only the document and the span; the range is irrelevant here.
    let prepared = crate::PreparedSignature {
        document,
        byte_range: [0, span.0, span.1, 0],
        contents_span: span,
    };
    Ok(crate::embed_signature(&prepared, &cms)?)
}

/// Read a PDF's own text layer, page by page, and report which pages still need recognizing.
///
/// Returns `{ pages: [{ pageIndex, lines: [{ text }], needsRecognition, textCoverage,
/// rasterCoverage }] }`, zero-based `pageIndex`, in page order. A page whose words exist only
/// as pixels comes back with no lines and `needsRecognition: true`: this edge reads what is
/// there and never guesses at what is not.
#[wasm_bindgen(js_name = extractPdfText)]
pub fn extract_pdf_text_edge(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let document = Document::load(bytes)?;
    // Named apart from the guard's refusal: a long document is not a decompression bomb, and a
    // caller told it was one would report the wrong reason for a document it could not read.
    if document.page_count() > crate::MAX_TEXT_EXTRACTION_PAGES {
        return Err(JsError::new("document has too many pages"));
    }
    let facts = document.document_text_facts(crate::MAX_TEXT_EXTRACTION_PAGES)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(o, &k.into(), v);
    };

    let pages = js_sys::Array::new();
    for page in &facts {
        let lines = js_sys::Array::new();
        for line in &page.lines {
            let line_object = js_sys::Object::new();
            set(&line_object, "text", &line.text.as_str().into());
            lines.push(&line_object);
        }
        let page_object = js_sys::Object::new();
        set(
            &page_object,
            "pageIndex",
            &JsValue::from(page.page_index as u32),
        );
        set(&page_object, "lines", &lines.into());
        set(
            &page_object,
            "needsRecognition",
            &JsValue::from(page.needs_recognition),
        );
        set(
            &page_object,
            "textCoverage",
            &JsValue::from(page.text_coverage),
        );
        set(
            &page_object,
            "rasterCoverage",
            &JsValue::from(page.raster_coverage),
        );
        pages.push(&page_object);
    }

    let result = js_sys::Object::new();
    set(&result, "pages", &pages.into());
    Ok(result.into())
}
