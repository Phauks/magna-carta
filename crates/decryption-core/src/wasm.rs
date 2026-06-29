//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here;
//! everything delegates to the format adapters and the top-level helpers.
use crate::{
    recovery_tier, DecryptError, ExtractError, Format, OoxmlAdapter, PdfAdapter, RecoveryJob,
    RecoveryTier, ZipAdapter,
};
use wasm_bindgen::prelude::*;

fn str_to_format(format: &str) -> Option<Format> {
    match format {
        "pdf" => Some(Format::Pdf),
        "zip" => Some(Format::Zip),
        "ooxml" => Some(Format::Ooxml),
        _ => None,
    }
}

fn format_to_str(format: Format) -> &'static str {
    match format {
        Format::Pdf => "pdf",
        Format::Zip => "zip",
        Format::Ooxml => "ooxml",
    }
}

fn decrypt_error_code(error: &DecryptError) -> &'static str {
    match error {
        DecryptError::WrongPassword => "wrongPassword",
        DecryptError::NotEncrypted => "notEncrypted",
        DecryptError::Unsupported(_) => "unsupported",
        DecryptError::Malformed(_) => "malformed",
    }
}

fn extract_error_code(error: &ExtractError) -> &'static str {
    match error {
        ExtractError::NotEncrypted => "notEncrypted",
        ExtractError::Unsupported(_) => "unsupported",
        ExtractError::Malformed(_) => "malformed",
    }
}

/// Detect the format of `bytes` by its magic bytes.
/// Returns `"pdf"`, `"zip"`, or `"ooxml"`, or `null` when the format is not recognised.
#[wasm_bindgen]
pub fn detect(bytes: &[u8]) -> Option<String> {
    crate::detect(bytes).map(|format| format_to_str(format).to_owned())
}

/// Decrypt a password-protected file and return `{ bytes: Uint8Array, filenameHint?: string }`.
///
/// Throws with a stable error code string on failure:
/// `"wrongPassword"`, `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
/// The error message never contains file content.
#[wasm_bindgen(js_name = stripWithKey)]
pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<JsValue, JsError> {
    let file = crate::strip_with_key(bytes, password)
        .map_err(|error| JsError::new(decrypt_error_code(&error)))?;

    let result = js_sys::Object::new();
    js_sys::Reflect::set(
        &result,
        &"bytes".into(),
        &js_sys::Uint8Array::from(file.bytes.as_slice()),
    )
    .map_err(|error| JsError::new(&format!("{error:?}")))?;

    if let Some(hint) = file.filename_hint {
        js_sys::Reflect::set(&result, &"filenameHint".into(), &JsValue::from_str(&hint))
            .map_err(|error| JsError::new(&format!("{error:?}")))?;
    }

    Ok(result.into())
}

/// Extract the password-recovery hash from an encrypted file and return
/// `{ format: string, hash: string, hashcatMode: number }`.
///
/// Throws with a stable error code string on failure:
/// `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
#[wasm_bindgen(js_name = extractHash)]
pub fn extract_hash(bytes: &[u8]) -> Result<JsValue, JsError> {
    let job =
        crate::extract_hash(bytes).map_err(|error| JsError::new(extract_error_code(&error)))?;

    let result = js_sys::Object::new();
    let set = |key: &str, value: &JsValue| -> Result<(), JsError> {
        js_sys::Reflect::set(&result, &key.into(), value)
            .map(|_| ())
            .map_err(|error| JsError::new(&format!("{error:?}")))
    };
    set("format", &JsValue::from_str(format_to_str(job.format)))?;
    set("hash", &JsValue::from_str(&job.hash))?;
    set("hashcatMode", &JsValue::from(job.hashcat_mode))?;

    Ok(result.into())
}

/// Classify a hashcat mode into a recovery tier.
///
/// `format` must be `"pdf"`, `"zip"`, or `"ooxml"` (unrecognised values are treated
/// as `"pdf"` for mode resolution — mode is the primary signal, not format).
/// Returns `"cfCapable"` or `"gpuRequired"`.
#[wasm_bindgen(js_name = recoveryTier)]
pub fn recovery_tier_wasm(format: &str, hashcat_mode: u32) -> String {
    let fmt = str_to_format(format).unwrap_or(Format::Pdf);
    match recovery_tier(fmt, hashcat_mode) {
        RecoveryTier::CfCapable => "cfCapable".to_owned(),
        RecoveryTier::GpuRequired => "gpuRequired".to_owned(),
    }
}

/// Test a single candidate password against a hash string without touching the original file.
///
/// `format` must be `"pdf"`, `"zip"`, or `"ooxml"`.
/// Returns `false` on any parse failure, unrecognised format, or bad parameters —
/// never panics.
#[wasm_bindgen(js_name = verifyGuess)]
pub fn verify_guess(hash: &str, format: &str, candidate: &str) -> bool {
    match format {
        "pdf" => {
            let params = match PdfAdapter::parse_hash(hash) {
                Ok(params) => params,
                Err(_) => return false,
            };
            let job = RecoveryJob {
                format: Format::Pdf,
                hash: hash.to_owned(),
                hashcat_mode: 0,
                params,
            };
            PdfAdapter::verify_guess(&job, candidate)
        }
        "zip" => {
            let params = match ZipAdapter::parse_hash(hash) {
                Ok(params) => params,
                Err(_) => return false,
            };
            let job = RecoveryJob {
                format: Format::Zip,
                hash: hash.to_owned(),
                hashcat_mode: 0,
                params,
            };
            ZipAdapter::verify_guess(&job, candidate)
        }
        "ooxml" => {
            let params = match OoxmlAdapter::parse_hash(hash) {
                Ok(params) => params,
                Err(_) => return false,
            };
            let job = RecoveryJob {
                format: Format::Ooxml,
                hash: hash.to_owned(),
                hashcat_mode: 0,
                params,
            };
            OoxmlAdapter::verify_guess(&job, candidate)
        }
        _ => false,
    }
}
