//! The wasm32 JS-marshalling edge. MARSHALLING ONLY — every export here delegates straight into the
//! engine and reshapes the answer into a JS object with camelCase keys. No engine logic lives in
//! this file, because logic that lives only on one target is logic the native build never runs and
//! the desktop client therefore never gets.
//!
//! Every failure crosses the edge as one of the fixed `DISCOVERY_ERROR_CODES` — a `&'static str`
//! that cannot carry a byte of the document behind it.

use wasm_bindgen::prelude::*;

use engine_host::wasm_edge::{to_js_error, ObjectBuilder};

use crate::error::DiscoveryError;
use crate::limits::Limits;
use crate::{DocumentReading, ExtractionOutcome};

/// Identify a document from its bytes. Total — every input has an answer — so this returns a value
/// rather than a result.
#[wasm_bindgen(js_name = identifyFormat)]
pub fn identify_format(bytes: &[u8]) -> JsValue {
    let identification = crate::identify(bytes);
    ObjectBuilder::new()
        .set("format", &JsValue::from_str(identification.format.label()))
        .set(
            "confidence",
            &JsValue::from_str(identification.confidence.label()),
        )
        .set(
            "charset",
            &identification
                .charset
                .map(JsValue::from_str)
                .unwrap_or(JsValue::NULL),
        )
        .into_value()
}

/// Whether a file's name agrees with what its bytes turned out to be. The bytes are identified here
/// and the name is only ever COMPARED against the result — the name cannot reach the identification,
/// which is the property that keeps a renamed file from being routed by its lie.
#[wasm_bindgen(js_name = nameAgreement)]
pub fn name_agreement(bytes: &[u8], file_name: &str) -> String {
    let identified = crate::identify(bytes).format;
    match crate::name_agreement(identified, file_name) {
        crate::NameAgreement::Agrees => "agrees".to_owned(),
        crate::NameAgreement::Disagrees => "disagrees".to_owned(),
        crate::NameAgreement::NoOpinion => "noOpinion".to_owned(),
    }
}

/// The five-algorithm digest set over a buffer.
#[wasm_bindgen(js_name = digestAll)]
pub fn digest_all(bytes: &[u8]) -> JsValue {
    let digests = crate::digest_all(bytes);
    ObjectBuilder::new()
        .set("md5", &JsValue::from_str(&digests.md5))
        .set("sha1", &JsValue::from_str(&digests.sha1))
        .set("sha256", &JsValue::from_str(&digests.sha256))
        .set("sha384", &JsValue::from_str(&digests.sha384))
        .set("sha512", &JsValue::from_str(&digests.sha512))
        .set("sizeBytes", &JsValue::from_f64(digests.size_bytes as f64))
        .into_value()
}

/// The near-duplicate fingerprint of already-normalized text, as a hex string — 64 bits does not
/// survive a round trip through a JS number.
#[wasm_bindgen(js_name = textFingerprint)]
pub fn text_fingerprint(normalized_text: &str) -> String {
    format!("{:016x}", crate::text_fingerprint(normalized_text))
}

/// Normalize text into the canonical form everything derived is derived from.
#[wasm_bindgen(js_name = normalizeText)]
pub fn normalize_text(text: &str) -> String {
    crate::normalize(text)
}

/// Read a document end to end. The passages come back as an array of objects, the derived scalars
/// beside them, and a document that reaches conversion or expansion says so rather than pretending
/// to have been read.
#[wasm_bindgen(js_name = readDocument)]
pub fn read_document(bytes: &[u8]) -> Result<JsValue, JsError> {
    match crate::read_document(bytes, &Limits::default()) {
        Ok(DocumentReading::Read(read)) => {
            let crate::DocumentRead {
                identification,
                document,
                passages,
                fingerprint,
                digests,
            } = *read;
            let passage_array = js_sys::Array::new();
            for passage in &passages {
                passage_array.push(
                    &ObjectBuilder::new()
                        .set("chunkId", &JsValue::from_str(&passage.chunk_id))
                        .set("text", &JsValue::from_str(&passage.text))
                        .set("page", &JsValue::from_f64(passage.page as f64))
                        .into_value(),
                );
            }
            let recognition = js_sys::Array::new();
            for page in &document.pages_needing_recognition {
                recognition.push(&JsValue::from_f64(*page as f64));
            }
            Ok(ObjectBuilder::new()
                .set("outcome", &JsValue::from_str("read"))
                .set("format", &JsValue::from_str(identification.format.label()))
                .set(
                    "confidence",
                    &JsValue::from_str(identification.confidence.label()),
                )
                .set(
                    "charset",
                    &document
                        .charset
                        .map(JsValue::from_str)
                        .unwrap_or(JsValue::NULL),
                )
                .set("passages", &passage_array)
                .set(
                    "pageCount",
                    &document
                        .page_count
                        .map(|count| JsValue::from_f64(count as f64))
                        .unwrap_or(JsValue::NULL),
                )
                .set(
                    "documentDate",
                    &document
                        .document_date
                        .as_ref()
                        .map(|date| {
                            ObjectBuilder::new()
                                .set("value", &JsValue::from_str(&date.value))
                                .set("source", &JsValue::from_str(date.source.label()))
                                .into_value()
                        })
                        .unwrap_or(JsValue::NULL),
                )
                .set("pagesNeedingRecognition", &recognition)
                .set(
                    "textFingerprint",
                    &JsValue::from_str(&format!("{fingerprint:016x}")),
                )
                .set("sha256", &JsValue::from_str(&digests.sha256))
                .into_value())
        }
        Ok(DocumentReading::NeedsConversion { format, .. }) => Ok(ObjectBuilder::new()
            .set("outcome", &JsValue::from_str("needsConversion"))
            .set("format", &JsValue::from_str(format.label()))
            .into_value()),
        Ok(DocumentReading::NeedsExpansion { format, .. }) => Ok(ObjectBuilder::new()
            .set("outcome", &JsValue::from_str("needsExpansion"))
            .set("format", &JsValue::from_str(format.label()))
            .into_value()),
        Err(error) => Err(to_js_error(&error)),
    }
}

/// List an archive's entries without decompressing any of them.
#[wasm_bindgen(js_name = enumerateArchive)]
pub fn enumerate_archive(bytes: &[u8]) -> Result<JsValue, JsError> {
    let entries =
        crate::enumerate(bytes, &Limits::default()).map_err(|error| to_js_error(&error))?;
    let array = js_sys::Array::new();
    for entry in &entries {
        array.push(
            &ObjectBuilder::new()
                .set("path", &JsValue::from_str(&entry.path))
                .set(
                    "compressedSize",
                    &JsValue::from_f64(entry.compressed_size as f64),
                )
                .set(
                    "declaredSize",
                    &JsValue::from_f64(entry.declared_size as f64),
                )
                .set("encrypted", &JsValue::from_bool(entry.encrypted))
                .set("isDirectory", &JsValue::from_bool(entry.is_directory))
                .set("isTraversal", &JsValue::from_bool(entry.is_traversal()))
                .into_value(),
        );
    }
    Ok(array.into())
}

/// Kept so the edge's error mapping is the engine's, never an ad-hoc string built here.
const _: fn(&DiscoveryError) -> JsError = to_js_error::<DiscoveryError>;

/// Kept so the extraction outcome's variants are visible to this module and a new one stops
/// compiling here rather than silently marshalling as nothing.
const _: fn(ExtractionOutcome) -> bool = |outcome| {
    matches!(
        outcome,
        ExtractionOutcome::Extracted(_)
            | ExtractionOutcome::NeedsConversion { .. }
            | ExtractionOutcome::NeedsExpansion { .. }
    )
};
