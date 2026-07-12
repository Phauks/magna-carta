//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here:
//! everything delegates to `crate::parse`, `crate::parse_mbox`, and
//! `crate::extract_part`, and this file only reshapes the `ParsedMessage` record
//! into JavaScript objects with camelCase keys. Every failure crosses the edge as a
//! stable `&'static str` code (via `to_js_error`), never as file content.

use crate::{
    Address, Disposition, EmailError, IntegrityFacts, MessageIdentifier, ParsedMessage,
    PartDescriptor, PartLocator, SourceFormat,
};
use engine_host::wasm_edge::{bytes_out, to_js_error, EdgeError, ObjectBuilder};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

/// Parse one single-message email (`.eml` or `.msg`) and return the record as a JS
/// object. Throws a stable error code (`"malformed"`, `"unsupported"`,
/// `"limitExceeded"`, `"partNotFound"`) on failure; the message never carries file
/// content.
#[wasm_bindgen]
pub fn parse(bytes: &[u8]) -> Result<js_sys::Object, JsError> {
    let message = crate::parse(bytes).map_err(|error| to_js_error(&error))?;
    Ok(message_to_object(&message))
}

/// Parse an mbox, which is many messages, not one. Framing is total: a malformed
/// member never discards a well-formed one, so this returns
/// `{ messages: [...], failures: [{ index, byteStart, byteEnd, error }] }` rather
/// than throwing on a bad member. A failure's `byteStart`/`byteEnd` span that
/// member inside the input buffer (correct here — an mbox member genuinely is a
/// span of the input), and `error` is the stable code. The `Result` wrapper exists
/// only for a would-be allocation failure; the normal path is always `Ok`.
#[wasm_bindgen(js_name = parseMbox)]
pub fn parse_mbox(bytes: &[u8]) -> Result<js_sys::Object, JsError> {
    let outcome = crate::parse_mbox(bytes);

    let messages = js_sys::Array::new();
    for message in &outcome.messages {
        messages.push(&message_to_object(message));
    }

    let failures = js_sys::Array::new();
    for failure in &outcome.failures {
        let entry = ObjectBuilder::new()
            .set("index", &usize_to_value(failure.index))
            .set("byteStart", &usize_to_value(failure.byte_range.start))
            .set("byteEnd", &usize_to_value(failure.byte_range.end))
            .set("error", &JsValue::from_str(failure.error.code()))
            .into_value();
        failures.push(&entry);
    }

    let object = ObjectBuilder::new()
        .set("messages", &messages)
        .set("failures", &failures)
        .into_value()
        .unchecked_into();
    Ok(object)
}

/// Materialize one part's bytes by index. The caller passes the part's position in
/// `message.parts`, not a locator: a `.msg` part is located by a compound-file
/// stream name, which cannot be reconstructed from two integers, and trusting a
/// caller-supplied offset or stream name would let a forged locator drive the
/// extractor. So this re-parses the original bytes — parsing is stateless and
/// cheap relative to trusting untrusted input — bounds-checks the index against the
/// parts this input actually produced, and extracts only from the descriptor the
/// engine itself built. Throws a stable error code on failure.
#[wasm_bindgen(js_name = extractPart)]
pub fn extract_part(bytes: &[u8], part_index: usize) -> Result<js_sys::Uint8Array, JsError> {
    let message = crate::parse(bytes).map_err(|error| to_js_error(&error))?;
    let descriptor = message
        .parts
        .get(part_index)
        .ok_or_else(|| to_js_error(&EmailError::PartNotFound))?;
    let part = crate::extract_part(bytes, descriptor).map_err(|error| to_js_error(&error))?;
    Ok(bytes_out(&part))
}

/// Reshape a `ParsedMessage` into the JS object the TypeScript wrapper consumes.
fn message_to_object(message: &ParsedMessage) -> js_sys::Object {
    ObjectBuilder::new()
        .set(
            "messageIdentifier",
            &message_identifier_value(&message.message_identifier),
        )
        .set(
            "inReplyTo",
            &optional_string(message.in_reply_to.as_deref()),
        )
        .set("references", &string_array(&message.references))
        .set("subject", &optional_string(message.subject.as_deref()))
        .set("dateRaw", &optional_string(message.date_raw.as_deref()))
        .set("from", &address_array(&message.from))
        .set("to", &address_array(&message.to))
        .set("cc", &address_array(&message.cc))
        .set("bcc", &address_array(&message.bcc))
        .set("rawHeaders", &raw_headers_array(&message.raw_headers))
        .set("textBodies", &string_array(&message.text_bodies))
        .set("htmlBodies", &string_array(&message.html_bodies))
        .set("rtfBody", &optional_string(message.rtf_body.as_deref()))
        .set("parts", &parts_array(&message.parts))
        .set("integrity", &integrity_value(&message.integrity))
        .set(
            "sourceFormat",
            &JsValue::from_str(source_format_code(message.source_format)),
        )
        .set(
            "referencesRemoteContent",
            &JsValue::from_bool(message.references_remote_content),
        )
        .into_value()
        .unchecked_into()
}

/// `{ value: string | null, provenance: "header" | "mapi" | "absent" }`. The
/// provenance must survive to JS: downstream dedup distinguishes a header-sourced
/// identifier from one synthesized out of MAPI properties, and collapsing the two
/// would silently merge distinct messages.
fn message_identifier_value(identifier: &MessageIdentifier) -> JsValue {
    let (value, provenance) = match identifier {
        MessageIdentifier::FromHeader(value) => (JsValue::from_str(value), "header"),
        MessageIdentifier::FromMapi(value) => (JsValue::from_str(value), "mapi"),
        MessageIdentifier::Absent => (JsValue::NULL, "absent"),
    };
    ObjectBuilder::new()
        .set("value", &value)
        .set("provenance", &JsValue::from_str(provenance))
        .into_value()
}

fn address_array(addresses: &[Address]) -> JsValue {
    let array = js_sys::Array::new();
    for address in addresses {
        let entry = ObjectBuilder::new()
            .set(
                "displayName",
                &optional_string(address.display_name.as_deref()),
            )
            .set("address", &optional_string(address.address.as_deref()))
            .into_value();
        array.push(&entry);
    }
    array.into()
}

fn raw_headers_array(headers: &[(String, String)]) -> JsValue {
    let array = js_sys::Array::new();
    for (name, value) in headers {
        let entry = ObjectBuilder::new()
            .set("name", &JsValue::from_str(name))
            .set("value", &JsValue::from_str(value))
            .into_value();
        array.push(&entry);
    }
    array.into()
}

fn parts_array(parts: &[PartDescriptor]) -> JsValue {
    let array = js_sys::Array::new();
    for part in parts {
        let entry = ObjectBuilder::new()
            .set("filename", &optional_string(part.filename.as_deref()))
            .set("mediaType", &optional_string(part.media_type.as_deref()))
            .set(
                "contentIdentifier",
                &optional_string(part.content_identifier.as_deref()),
            )
            .set(
                "disposition",
                &JsValue::from_str(disposition_code(part.disposition)),
            )
            .set("size", &usize_to_value(part.size))
            .set("locator", &locator_value(&part.locator))
            .set(
                "isEmbeddedMessage",
                &JsValue::from_bool(part.is_embedded_message),
            )
            .into_value();
        array.push(&entry);
    }
    array.into()
}

/// A tagged object, never a flattened range: `{ kind: "inputRange", start, end }`
/// for an `.eml`/mbox span, or `{ kind: "mapiStream", name }` for a `.msg` stream.
/// Flattening a stream name into a fake byte range would reintroduce exactly the
/// confusion the `PartLocator` enum exists to prevent.
fn locator_value(locator: &PartLocator) -> JsValue {
    match locator {
        PartLocator::InputRange(range) => ObjectBuilder::new()
            .set("kind", &JsValue::from_str("inputRange"))
            .set("start", &usize_to_value(range.start))
            .set("end", &usize_to_value(range.end))
            .into_value(),
        PartLocator::MapiStream { name } => ObjectBuilder::new()
            .set("kind", &JsValue::from_str("mapiStream"))
            .set("name", &JsValue::from_str(name))
            .into_value(),
    }
}

fn integrity_value(integrity: &IntegrityFacts) -> JsValue {
    ObjectBuilder::new()
        .set("dkimSignatures", &string_array(&integrity.dkim_signatures))
        .set(
            "authenticationResults",
            &string_array(&integrity.authentication_results),
        )
        .set("receivedChain", &string_array(&integrity.received_chain))
        .into_value()
}

fn string_array(values: &[String]) -> JsValue {
    let array = js_sys::Array::new();
    for value in values {
        array.push(&JsValue::from_str(value));
    }
    array.into()
}

fn optional_string(value: Option<&str>) -> JsValue {
    match value {
        Some(value) => JsValue::from_str(value),
        None => JsValue::NULL,
    }
}

/// Byte counts and indices marshal as JS numbers. A `usize` is widened through
/// `f64`, which represents every value these offsets reach (well under 2^53)
/// exactly.
fn usize_to_value(value: usize) -> JsValue {
    JsValue::from_f64(value as f64)
}

fn source_format_code(format: SourceFormat) -> &'static str {
    match format {
        SourceFormat::Eml => "eml",
        SourceFormat::Msg => "msg",
        SourceFormat::MboxMember => "mboxMember",
    }
}

fn disposition_code(disposition: Disposition) -> &'static str {
    match disposition {
        Disposition::Attachment => "attachment",
        Disposition::Inline => "inline",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    // Reach into a JS object/array through the same reflection the edge writes with,
    // so the tests assert on what a JS caller actually sees.
    fn get(value: &JsValue, key: &str) -> JsValue {
        js_sys::Reflect::get(value, &JsValue::from_str(key)).unwrap()
    }

    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    // A minimal headerless `.msg` whose only property is PidTagInternetMessageId
    // (0x1035, Unicode 0x001F). With no transport header block, the identifier is
    // recovered from MAPI and must be tagged as such.
    fn msg_with_mapi_identifier(message_id: &str) -> Vec<u8> {
        use std::io::{Cursor, Write};
        let mut compound = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        compound
            .create_stream("/__substg1.0_1035001F")
            .unwrap()
            .write_all(&utf16le(message_id))
            .unwrap();
        compound.flush().unwrap();
        compound.into_inner().into_inner()
    }

    #[wasm_bindgen_test]
    fn parse_marshals_an_eml_record() {
        const SIMPLE: &[u8] = include_bytes!("../tests/fixtures/simple.eml");
        let object: JsValue = parse(SIMPLE).expect("the .eml fixture parses").into();

        assert_eq!(
            get(&object, "subject").as_string().as_deref(),
            Some("Retainer")
        );
        assert_eq!(
            get(&object, "sourceFormat").as_string().as_deref(),
            Some("eml")
        );

        let identifier = get(&object, "messageIdentifier");
        assert_eq!(
            get(&identifier, "provenance").as_string().as_deref(),
            Some("header")
        );
        assert_eq!(
            get(&identifier, "value").as_string().as_deref(),
            Some("first@example.test")
        );
    }

    #[wasm_bindgen_test]
    fn parse_tags_an_attachment_part_with_an_input_range_locator() {
        const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");
        let object: JsValue = parse(WITH_ATTACHMENT).expect("fixture parses").into();

        let parts: js_sys::Array = get(&object, "parts").dyn_into().unwrap();
        let first = parts.get(0);
        let locator = get(&first, "locator");
        // An `.eml` part is a span of the input, so its locator is a range, never a
        // MAPI stream name.
        assert_eq!(
            get(&locator, "kind").as_string().as_deref(),
            Some("inputRange")
        );
        assert!(get(&locator, "start").as_f64().is_some());
        assert!(get(&locator, "end").as_f64().is_some());
    }

    #[wasm_bindgen_test]
    fn extract_part_returns_the_attachment_bytes_by_index() {
        const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");
        let bytes = extract_part(WITH_ATTACHMENT, 0).expect("part extracts");
        // The same base64 span the native extractor returns for this fixture.
        assert_eq!(bytes.to_vec(), b"JVBERi0xLjQKJeLjz9MK\r\n".to_vec());
    }

    #[wasm_bindgen_test]
    fn extract_part_out_of_range_is_part_not_found() {
        const SIMPLE: &[u8] = include_bytes!("../tests/fixtures/simple.eml");
        let error: JsValue = extract_part(SIMPLE, 999).unwrap_err().into();
        let error: js_sys::Error = error.dyn_into().unwrap();
        assert_eq!(String::from(error.message()), "partNotFound");
    }

    #[wasm_bindgen_test]
    fn a_mapi_identifier_serializes_with_mapi_provenance() {
        let bytes = msg_with_mapi_identifier("<mapi-synthesized@example.test>");
        let object: JsValue = parse(&bytes).expect("a headerless .msg parses").into();

        assert_eq!(
            get(&object, "sourceFormat").as_string().as_deref(),
            Some("msg")
        );
        let identifier = get(&object, "messageIdentifier");
        // The provenance must read "mapi", never "header": downstream dedup depends
        // on the distinction.
        assert_eq!(
            get(&identifier, "provenance").as_string().as_deref(),
            Some("mapi")
        );
        assert_eq!(
            get(&identifier, "value").as_string().as_deref(),
            Some("<mapi-synthesized@example.test>")
        );
    }
}
