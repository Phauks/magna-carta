//! Thin JS marshalling edge — compiled only for wasm32. No listing logic here; everything delegates
//! to the crate root.
//!
//! Sizes and offsets cross as `f64` because that is what a JavaScript number is. An object big
//! enough to lose precision there (8 PiB) is not one this platform stores.
use crate::{
    extract, list, ArchiveRange, ExtractError, ExtractLimits, ExtractOutcome, ListError,
    ListLimits, ListOutcome, SevenZipEntry,
};
use wasm_bindgen::prelude::*;

fn set(target: &js_sys::Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(target, &key.into(), value)
        .map(|_| ())
        .map_err(|_| JsError::new("malformed"))
}

/// A non-negative size or offset, or a refusal. Guards the cast rather than saturating it: a caller
/// passing NaN or a negative length has a bug, and answering it with 0 would hide that.
fn size(value: f64, field: &str) -> Result<u64, JsError> {
    if !value.is_finite() || value < 0.0 || value > (u64::MAX as f64) {
        return Err(JsError::new(&format!("invalidArgument: {field}")));
    }
    Ok(value as u64)
}

fn entry_to_js(entry: &SevenZipEntry) -> Result<JsValue, JsError> {
    let object = js_sys::Object::new();
    set(&object, "path", &JsValue::from_str(&entry.path))?;
    set(
        &object,
        "isDirectory",
        &JsValue::from_bool(entry.is_directory),
    )?;
    set(
        &object,
        "compressedSizeBytes",
        &JsValue::from_f64(entry.compressed_size_bytes as f64),
    )?;
    set(
        &object,
        "uncompressedSizeBytes",
        &JsValue::from_f64(entry.uncompressed_size_bytes as f64),
    )?;
    set(
        &object,
        "modifiedAtEpochMillis",
        &match entry.modified_at_epoch_millis {
            Some(millis) => JsValue::from_f64(millis as f64),
            None => JsValue::NULL,
        },
    )?;
    set(&object, "encrypted", &JsValue::from_bool(entry.encrypted))?;
    Ok(object.into())
}

/// List a 7z from the byte ranges fetched so far.
///
/// `rangeOffsets[i]` is where `rangeBytes[i]` begins in the archive. Returns either
/// `{ status: "listing", entries, truncated }` or `{ status: "needRange", offset, length }` — fetch
/// that range, append it, and call again. Three calls is the most a well-formed archive needs.
///
/// Throws with a stable error code string: `"notSevenZip"`, `"unsupportedVersion"`,
/// `"headerEncrypted"`, `"tooLarge"`, `"unsupportedCoder"`, `"malformed"`, or `"rangeMismatch"`.
/// The message never contains archive content.
#[wasm_bindgen(js_name = listRanges)]
#[allow(clippy::too_many_arguments)]
pub fn list_ranges(
    archive_size: f64,
    range_offsets: Vec<f64>,
    range_bytes: Vec<js_sys::Uint8Array>,
    max_entries: f64,
    max_header_bytes: f64,
    max_decoded_header_bytes: f64,
    max_dictionary_bytes: f64,
) -> Result<JsValue, JsError> {
    if range_offsets.len() != range_bytes.len() {
        return Err(JsError::new("invalidArgument: rangeOffsets/rangeBytes"));
    }
    let mut ranges = Vec::with_capacity(range_offsets.len());
    for (offset, bytes) in range_offsets.iter().zip(range_bytes.iter()) {
        ranges.push(ArchiveRange::new(
            size(*offset, "rangeOffset")?,
            bytes.to_vec(),
        ));
    }

    let limits = ListLimits {
        max_entries: usize::try_from(size(max_entries, "maxEntries")?)
            .map_err(|_| JsError::new("invalidArgument: maxEntries"))?,
        max_header_bytes: size(max_header_bytes, "maxHeaderBytes")?,
        max_decoded_header_bytes: size(max_decoded_header_bytes, "maxDecodedHeaderBytes")?,
        max_dictionary_bytes: size(max_dictionary_bytes, "maxDictionaryBytes")?,
    };

    let outcome = list(size(archive_size, "archiveSize")?, &ranges, &limits)
        .map_err(|error: ListError| JsError::new(&error.to_string()))?;

    let result = js_sys::Object::new();
    match outcome {
        ListOutcome::Listing(listing) => {
            set(&result, "status", &JsValue::from_str("listing"))?;
            let entries = js_sys::Array::new();
            for entry in &listing.entries {
                entries.push(&entry_to_js(entry)?);
            }
            set(&result, "entries", &entries)?;
            set(&result, "truncated", &JsValue::from_bool(listing.truncated))?;
        }
        ListOutcome::NeedRange { offset, length } => {
            set(&result, "status", &JsValue::from_str("needRange"))?;
            set(&result, "offset", &JsValue::from_f64(offset as f64))?;
            set(&result, "length", &JsValue::from_f64(length as f64))?;
        }
    }
    Ok(result.into())
}

/// Take one member's content out of a 7z, from the byte ranges fetched so far.
///
/// Same range protocol as `listRanges`: returns either `{ status: "member", bytes }` or
/// `{ status: "needRange", offset, length }`. At most four ranges — the three a listing reads, plus
/// the one block the member lives in.
///
/// `memberIndex` is the member's position in the listing THIS crate produced. The two halves read
/// the same header, so an index from `listRanges` addresses the same member here.
///
/// Throws with a stable error code string: every code `listRanges` throws, plus `"memberNotFound"`,
/// `"notAFile"`, `"memberEncrypted"`, and `"corrupt"`. The message never contains archive content.
#[wasm_bindgen(js_name = extractRanges)]
#[allow(clippy::too_many_arguments)]
pub fn extract_ranges(
    archive_size: f64,
    range_offsets: Vec<f64>,
    range_bytes: Vec<js_sys::Uint8Array>,
    member_index: f64,
    max_member_bytes: f64,
    max_block_bytes: f64,
    max_header_bytes: f64,
    max_decoded_header_bytes: f64,
    max_dictionary_bytes: f64,
) -> Result<JsValue, JsError> {
    if range_offsets.len() != range_bytes.len() {
        return Err(JsError::new("invalidArgument: rangeOffsets/rangeBytes"));
    }
    let mut ranges = Vec::with_capacity(range_offsets.len());
    for (offset, bytes) in range_offsets.iter().zip(range_bytes.iter()) {
        ranges.push(ArchiveRange::new(
            size(*offset, "rangeOffset")?,
            bytes.to_vec(),
        ));
    }

    let limits = ExtractLimits {
        list: ListLimits {
            // Extraction names one member; the entry cap bounds a listing's answer and has nothing
            // to bound here, so it is set past any archive rather than left to truncate the file
            // table the member index points into.
            max_entries: usize::MAX,
            max_header_bytes: size(max_header_bytes, "maxHeaderBytes")?,
            max_decoded_header_bytes: size(max_decoded_header_bytes, "maxDecodedHeaderBytes")?,
            max_dictionary_bytes: size(max_dictionary_bytes, "maxDictionaryBytes")?,
        },
        max_member_bytes: size(max_member_bytes, "maxMemberBytes")?,
        max_block_bytes: size(max_block_bytes, "maxBlockBytes")?,
    };
    let member_index = usize::try_from(size(member_index, "memberIndex")?)
        .map_err(|_| JsError::new("invalidArgument: memberIndex"))?;

    let outcome = extract(
        size(archive_size, "archiveSize")?,
        &ranges,
        member_index,
        &limits,
    )
    .map_err(|error: ExtractError| JsError::new(&error.to_string()))?;

    let result = js_sys::Object::new();
    match outcome {
        ExtractOutcome::Member(bytes) => {
            set(&result, "status", &JsValue::from_str("member"))?;
            set(
                &result,
                "bytes",
                &js_sys::Uint8Array::from(bytes.as_slice()).into(),
            )?;
        }
        ExtractOutcome::NeedRange { offset, length } => {
            set(&result, "status", &JsValue::from_str("needRange"))?;
            set(&result, "offset", &JsValue::from_f64(offset as f64))?;
            set(&result, "length", &JsValue::from_f64(length as f64))?;
        }
    }
    Ok(result.into())
}
