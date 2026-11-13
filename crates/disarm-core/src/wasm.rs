//! Thin JS marshalling edge, compiled only for wasm32. Everything delegates to the crate; this file
//! reshapes the result into a JavaScript object with camelCase keys. A failure crosses the edge as
//! its stable code, never as document content.

use engine_host::wasm_edge::{bytes_out, to_js_error, ObjectBuilder};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

/// What the bytes are, as `disarm` would treat them, or `undefined` when they are not disarmed.
#[wasm_bindgen]
pub fn identify(bytes: &[u8]) -> Option<String> {
    crate::identify(bytes).map(|kind| kind.code().to_owned())
}

/// Disarm a document. Returns `{ bytes, kind, outputExtension, removals: [{ kind, count }] }`, and
/// throws a stable code (`"unsupported"`, `"encrypted"`, `"limitExceeded"`, `"malformed"`,
/// `"write"`, `"verificationFailed"`) when no copy can be offered.
#[wasm_bindgen]
pub fn disarm(bytes: &[u8]) -> Result<js_sys::Object, JsError> {
    let disarmed = crate::disarm(bytes).map_err(|error| to_js_error(&error))?;
    let removals = js_sys::Array::new();
    for removal in disarmed.report.removals() {
        let entry = ObjectBuilder::new()
            .set("kind", &JsValue::from_str(removal.kind.code()))
            .set("count", &JsValue::from_f64(f64::from(removal.count)))
            .into_value();
        removals.push(&entry);
    }
    let output_extension = disarmed
        .output_extension
        .map(JsValue::from_str)
        .unwrap_or(JsValue::NULL);
    Ok(ObjectBuilder::new()
        .set("bytes", &bytes_out(&disarmed.bytes))
        .set("kind", &JsValue::from_str(disarmed.kind.code()))
        .set("outputExtension", &output_extension)
        .set("removals", &removals)
        .into_value()
        .unchecked_into())
}
