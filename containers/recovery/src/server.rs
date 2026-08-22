use axum::{
    body::Bytes,
    extract::{rejection::JsonRejection, DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use decryption_core::{
    detect, extract_hash, parse_rules, recover_shard, recovery_tier, split_keyspace,
    strip_with_key, DecryptError, ExtractError, Format, OoxmlAdapter, PdfAdapter, RecoveryJob,
    RecoveryTier, RuleSet, ZipAdapter,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use zeroize::Zeroize;

/// Ceiling on the raw file body `POST /extract-hash` and `POST /unlock` will read. The only caller
/// is the app worker over its service binding, which has already enforced the firm's own
/// inspectable-size cap, and a Cloudflare Worker cannot forward a request body larger than 100 MiB
/// anyway — so this is a backstop against a wedged or misconfigured caller, not the product limit.
/// It replaces axum's 2 MiB default, which would reject ordinary encrypted documents.
const FILE_BODY_LIMIT_BYTES: usize = 128 * 1024 * 1024;

/// Shared state loaded once at startup and shared across requests.
#[derive(Clone)]
pub struct AppState {
    /// The full wordlist, read once from `RECOVERY_WORDLIST_PATH` at startup.
    pub wordlist: Arc<Vec<String>>,
    /// The best64 rule set, read once from `RECOVERY_RULES_PATH` at startup.
    pub best64_rules: Arc<RuleSet>,
}

/// Build the recovery service router over the shared state. The binary serves it on :8080;
/// tests serve it on an ephemeral port.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/ready", get(ready))
        .route("/recover-shard", post(recover_shard_handler))
        .route(
            "/extract-hash",
            post(extract_hash_handler).layer(DefaultBodyLimit::max(FILE_BODY_LIMIT_BYTES)),
        )
        .route(
            "/unlock",
            post(unlock_handler).layer(DefaultBodyLimit::max(FILE_BODY_LIMIT_BYTES)),
        )
        .with_state(state)
}

async fn ready() -> &'static str {
    "ok"
}

/// The response body for a successful `POST /extract-hash`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractHashResponse {
    /// One of `"pdf"`, `"zip"`, or `"ooxml"`.
    format: &'static str,
    /// The cracker hash string, directly consumable by hashcat.
    hash: String,
    /// The hashcat mode matching `hash`.
    hashcat_mode: u32,
    /// `"cfCapable"` or `"gpuRequired"` — how hard this mode is to search. Returned alongside the
    /// hash because the classifier is a property of the extracted mode, and one round trip here
    /// saves the caller a second one for an answer this handler already holds.
    tier: &'static str,
}

/// The response body when the bytes are a valid request but yield no hash. This is a fact about the
/// submitted FILE, not about the service, so it is answered with a code the caller can turn into a
/// message for the person who uploaded it — never a 5xx, which the caller reads as "engine down".
#[derive(Serialize)]
struct ExtractHashRefusal {
    /// `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
    code: &'static str,
}

/// `POST /extract-hash` — read the encryption header of the raw file bytes in the request body and
/// return the recovery hash plus its tier. The bytes are held only for the duration of the call:
/// nothing is written to disk and nothing is logged.
///
/// Status codes are the contract, and the three are not interchangeable: 200 carries a hash, 422
/// carries a stable refusal code about the file, and any 5xx means this service could not answer at
/// all. The caller maps them to a result, a 400, and a retryable 503 respectively.
async fn extract_hash_handler(bytes: Bytes) -> Response {
    if bytes.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "the request body carried no file bytes",
        )
            .into_response();
    }

    // CPU-bound parsing of untrusted bytes — off the async executor, like the shard search.
    let parsed = tokio::task::spawn_blocking(move || extract_hash(&bytes)).await;

    let job = match parsed {
        Ok(Ok(job)) => job,
        Ok(Err(error)) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ExtractHashRefusal {
                    code: extract_error_code(&error),
                }),
            )
                .into_response();
        }
        Err(join_error) => {
            // A panic in the parser is a fault in this service, not a verdict on the file. The
            // message names the join failure only — never any part of the submitted bytes.
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("hash extraction task panicked: {join_error}"),
            )
                .into_response();
        }
    };

    let tier = match recovery_tier(job.format, job.hashcat_mode) {
        RecoveryTier::CfCapable => "cfCapable",
        RecoveryTier::GpuRequired => "gpuRequired",
    };
    Json(ExtractHashResponse {
        format: format_name(job.format),
        hash: job.hash,
        hashcat_mode: job.hashcat_mode,
        tier,
    })
    .into_response()
}

/// Map an extraction failure to the stable code the caller branches on. The variants' own messages
/// are deliberately dropped: they quote parser detail about the submitted file, and the caller
/// surfaces this to a member.
fn extract_error_code(error: &ExtractError) -> &'static str {
    match error {
        ExtractError::NotEncrypted => "notEncrypted",
        ExtractError::Unsupported(_) => "unsupported",
        ExtractError::Malformed(_) => "malformed",
    }
}

/// The wire spelling of a format. Matches the strings `build_recovery_job` accepts, so a hash this
/// handler emits can be handed straight back to `/recover-shard`.
fn format_name(format: Format) -> &'static str {
    match format {
        Format::Pdf => "pdf",
        Format::Zip => "zip",
        Format::Ooxml => "ooxml",
    }
}

/// How many leading bytes of a `POST /unlock` body carry the password length: a big-endian `u32`.
const UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES: usize = 4;

/// The response body for a successful `POST /unlock`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlockResponse {
    /// One of `"pdf"`, `"zip"`, or `"ooxml"` — what the plaintext was decrypted out of.
    format: &'static str,
    /// The decrypted bytes, base64-encoded. The caller returns this string verbatim, so nothing
    /// decodes and re-encodes a whole document to move it one hop.
    decrypted_base64: String,
    /// The name the encrypted container carried for its payload, where it carried one.
    filename_hint: Option<String>,
}

/// The response body when the bytes and the password are a valid request but yield no plaintext.
/// Like `ExtractHashRefusal` this is a fact about the submitted FILE (or about the password the
/// person typed), not about this service, so it is a 422 the caller turns into a message — never a
/// 5xx, which the caller reads as "engine down".
#[derive(Serialize)]
struct UnlockRefusal {
    /// `"wrongPassword"`, `"notEncrypted"`, `"unsupported"`, or `"malformed"`.
    code: &'static str,
}

/// `POST /unlock` — decrypt the password-protected file in the request body and return its
/// plaintext.
///
/// **The body carries a password, so its framing is deliberate.** The password is length-prefixed
/// into the body rather than sent as a header or a query parameter, because a body is the one part
/// of an HTTP request that no proxy, access log, or trace metadata records by default: a
/// `u32` big-endian byte length, the password's UTF-8 bytes, then the file. It is not JSON either —
/// a deserializer's error text quotes the input it choked on, and that input would be the password.
///
/// Nothing here logs, counts, or echoes the password: not the refusal codes, not the 400s, not the
/// panic path. The owned copy this handler makes lives in a `Zeroizing<String>` and the request
/// buffer is wiped before the handler returns; see `unlock_blocking` for what that can and cannot
/// reach.
///
/// Status codes are the contract, on exactly the terms `/extract-hash` sets: 200 carries plaintext,
/// 422 carries a stable refusal code, and any 5xx means this service could not answer at all.
async fn unlock_handler(bytes: Bytes) -> Response {
    // CPU-bound decryption of untrusted bytes — off the async executor, like the shard search. The
    // whole body moves into the closure so the password never outlives one blocking task.
    match tokio::task::spawn_blocking(move || unlock_blocking(bytes)).await {
        Ok(response) => response,
        Err(join_error) => {
            // A panic in the decryptor is a fault in this service, not a verdict on the file. The
            // message names the join failure only — never any part of the body, which holds the
            // password as well as the file.
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unlock task panicked: {join_error}"),
            )
                .into_response()
        }
    }
}

/// The blocking half of `POST /unlock`: split the framed body, decrypt, and wipe what it owns.
///
/// Three copies of the password exist while this runs and each is accounted for:
///
/// 1. `body` — the request buffer axum handed over. Wiped in place before returning when this task
///    holds the only reference to it (the common case: axum has dropped its own).
/// 2. `password` — the owned `String` this function builds to satisfy `strip_with_key`'s `&str`.
///    A `Zeroizing` wrapper wipes it on drop, including on the early-return paths.
/// 3. Whatever the format adapter copies internally. That is outside this crate's reach: `lopdf`'s
///    `Document::decrypt` builds its own sanitized `Vec<u8>` of the password and drops it without
///    wiping, and the `zip` crate copies the password into its cipher state the same way. Neither
///    retains it past the call, but neither zeroes it either — the allocation is returned to the
///    allocator still holding the bytes.
fn unlock_blocking(mut body: Bytes) -> Response {
    let framed = match split_unlock_body(&body) {
        Ok(framed) => framed,
        Err(message) => {
            // A framing complaint describes the LENGTHS ONLY. It never quotes the bytes, because
            // the bytes are a password followed by a member's document.
            return (StatusCode::BAD_REQUEST, message).into_response();
        }
    };

    let outcome = {
        let password = match String::from_utf8(framed.password.to_vec()) {
            Ok(text) => zeroize::Zeroizing::new(text),
            Err(_) => {
                wipe(&mut body);
                return (
                    StatusCode::BAD_REQUEST,
                    "the password bytes are not valid UTF-8",
                )
                    .into_response();
            }
        };
        let format = detect(framed.file);
        (format, strip_with_key(framed.file, &password))
    };

    // The password copy above is gone by here; the request buffer is the last place it lives.
    wipe(&mut body);

    match outcome {
        (Some(format), Ok(decrypted)) => Json(UnlockResponse {
            format: format_name(format),
            decrypted_base64: BASE64.encode(&decrypted.bytes),
            filename_hint: decrypted.filename_hint,
        })
        .into_response(),
        // `strip_with_key` dispatches on the same `detect` this handler called, so a success with no
        // detected format cannot happen. Report it as a fault rather than guessing a format onto a
        // document the caller will file.
        (None, Ok(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "decryption succeeded for a format detection did not recognise",
        )
            .into_response(),
        (_, Err(error)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(UnlockRefusal {
                code: decrypt_error_code(&error),
            }),
        )
            .into_response(),
    }
}

/// The two spans of a framed `POST /unlock` body.
struct UnlockBody<'a> {
    password: &'a [u8],
    file: &'a [u8],
}

/// Split `[u32 big-endian password length][password][file]`. Every error names lengths only.
fn split_unlock_body(body: &[u8]) -> Result<UnlockBody<'_>, String> {
    if body.len() < UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES {
        return Err(format!(
            "the request body is {} bytes, shorter than the {UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES}-byte password-length prefix",
            body.len()
        ));
    }
    let (prefix, rest) = body.split_at(UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES);
    let password_length = u32::from_be_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
    if password_length == 0 {
        return Err("the request body declared a zero-length password".to_owned());
    }
    if password_length > rest.len() {
        return Err(format!(
            "the request body declared a {password_length}-byte password but carries only {} bytes after the prefix",
            rest.len()
        ));
    }
    let (password, file) = rest.split_at(password_length);
    if file.is_empty() {
        return Err("the request body carried no file bytes after the password".to_owned());
    }
    Ok(UnlockBody { password, file })
}

/// Wipe a request buffer in place when this task holds the only reference to it.
///
/// `Bytes` is reference-counted, so this can only succeed while nothing else is looking at the
/// allocation — which is the ordinary case once axum has handed the body over and dropped its own
/// handle. When it does not succeed the buffer is simply dropped: the allocator gets it back with
/// the bytes still in it, exactly as it would have without this call, so there is nothing to fall
/// back to and nothing lost by trying.
fn wipe(body: &mut Bytes) {
    let taken = std::mem::take(body);
    if let Ok(mut owned) = taken.try_into_mut() {
        owned.as_mut().zeroize();
    }
}

/// Map a decryption failure to the stable code the caller branches on. As with
/// `extract_error_code`, the variants' own messages are dropped: they quote parser detail about the
/// submitted file, and the caller surfaces this to a member.
fn decrypt_error_code(error: &DecryptError) -> &'static str {
    match error {
        DecryptError::WrongPassword => "wrongPassword",
        DecryptError::NotEncrypted => "notEncrypted",
        DecryptError::Unsupported(_) => "unsupported",
        DecryptError::Malformed(_) => "malformed",
    }
}

/// The request body for `POST /recover-shard`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoverShardRequest {
    /// The cracker hash string (e.g. `$office$*2013*…`).
    hash: String,
    /// One of `"pdf"`, `"zip"`, or `"ooxml"` (case-insensitive).
    format: String,
    /// The hashcat mode matching the hash (e.g. 9600 for OOXML agile).
    hashcat_mode: u32,
    /// Which shard of the wordlist this request covers, in `0..shard_count`.
    shard_index: usize,
    /// How many shards to split the wordlist into. The container — not the
    /// caller — resolves `shard_index` into a concrete word range, since only
    /// the container knows how long its baked wordlist is.
    shard_count: usize,
    /// Which rule set to apply: `"best64"` or `"none"`.
    rule_set: String,
}

/// The response body for `POST /recover-shard`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoverShardResponse {
    /// The recovered password, or `null` if not found in this shard.
    found: Option<String>,
    /// How many candidates were submitted to the verifier.
    candidates_tried: usize,
}

async fn recover_shard_handler(
    State(state): State<AppState>,
    // Accept a `Result` so we can map deserialization/missing-field errors to 400 rather
    // than axum's default 422. The task contract specifies 400 for all malformed bodies.
    body: Result<Json<RecoverShardRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(json) => json,
        Err(rejection) => {
            return (StatusCode::BAD_REQUEST, rejection.body_text()).into_response();
        }
    };
    // Resolve format — dispatch on the format string.
    let job = match build_recovery_job(&request.format, &request.hash, request.hashcat_mode) {
        Ok(job) => job,
        Err(message) => {
            return (StatusCode::BAD_REQUEST, message).into_response();
        }
    };

    // Select the rule set.
    let rules: Arc<RuleSet> = match request.rule_set.as_str() {
        "best64" => Arc::clone(&state.best64_rules),
        "none" => {
            // A no-op rule set — each word passes through verbatim.
            match parse_rules(":") {
                Ok(noop) => Arc::new(noop),
                Err(error) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to build noop rule set: {error}"),
                    )
                        .into_response();
                }
            }
        }
        other => {
            return (
                StatusCode::BAD_REQUEST,
                format!("unknown ruleSet {other:?}; expected \"best64\" or \"none\""),
            )
                .into_response();
        }
    };

    // Guard the shard request itself before deriving a range from it.
    // `shard_count == 0` has no valid index; `shard_index >= shard_count` is
    // outside the caller's own declared range. Both are caller errors — reject
    // rather than silently running nothing, which could mask a coordinator bug.
    if request.shard_count == 0 || request.shard_index >= request.shard_count {
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "shardIndex ({}) must be less than a non-zero shardCount ({})",
                request.shard_index, request.shard_count
            ),
        )
            .into_response();
    }

    // Only the container knows how long its baked wordlist is, so it — not the
    // caller — resolves shardIndex into a concrete word range.
    let shards = split_keyspace(state.wordlist.len(), request.shard_count);
    let spec = match shards.get(request.shard_index) {
        Some(spec) => spec.clone(),
        None => {
            // shard_index is inside the caller's declared shard_count, but the
            // wordlist is shorter than shard_count, so split_keyspace dropped the
            // trailing empty shards (see decryption-core's shard module). This
            // shard legitimately covers zero words rather than being a caller
            // error, so report an empty result instead of erroring or panicking
            // on an out-of-bounds index.
            return Json(RecoverShardResponse {
                found: None,
                candidates_tried: 0,
            })
            .into_response();
        }
    };

    // Run the recovery on a blocking thread — `recover_shard` is CPU-bound (rayon).
    let wordlist = Arc::clone(&state.wordlist);
    let outcome =
        tokio::task::spawn_blocking(move || recover_shard(&job, &wordlist, &spec, &rules)).await;

    match outcome {
        Ok(result) => Json(RecoverShardResponse {
            found: result.found,
            candidates_tried: result.candidates_tried,
        })
        .into_response(),
        Err(join_error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("recovery task panicked: {join_error}"),
        )
            .into_response(),
    }
}

/// Parse the `hash` string for the given `format` into a `RecoveryJob`. Returns `Err` with a
/// human-readable message on any parse failure so the handler can emit a 400.
fn build_recovery_job(format: &str, hash: &str, hashcat_mode: u32) -> Result<RecoveryJob, String> {
    match format.to_lowercase().as_str() {
        "ooxml" => {
            let params = OoxmlAdapter::parse_hash(hash)
                .map_err(|error| format!("failed to parse ooxml hash: {error}"))?;
            Ok(RecoveryJob {
                format: Format::Ooxml,
                hash: hash.to_owned(),
                hashcat_mode,
                params,
            })
        }
        "pdf" => {
            let params = PdfAdapter::parse_hash(hash)
                .map_err(|error| format!("failed to parse pdf hash: {error}"))?;
            Ok(RecoveryJob {
                format: Format::Pdf,
                hash: hash.to_owned(),
                hashcat_mode,
                params,
            })
        }
        "zip" => {
            let params = ZipAdapter::parse_hash(hash)
                .map_err(|error| format!("failed to parse zip hash: {error}"))?;
            Ok(RecoveryJob {
                format: Format::Zip,
                hash: hash.to_owned(),
                hashcat_mode,
                params,
            })
        }
        other => Err(format!(
            "unknown format {other:?}; expected \"ooxml\", \"pdf\", or \"zip\""
        )),
    }
}

/// Load the wordlist from a file path, returning one word per non-empty line.
/// Called once at startup; any read error is fatal.
pub fn load_wordlist(path: &str) -> Vec<String> {
    let content = std::fs::read_to_string(path).unwrap_or_else(|error| {
        eprintln!(
            "FATAL: cannot read the wordlist at {path}: {error}. \
             The recovery container cannot run without a wordlist."
        );
        std::process::exit(1);
    });
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_owned)
        .collect()
}

/// Load and parse the best64 rule file from a path. Called once at startup; any error is fatal.
pub fn load_best64_rules(path: &str) -> RuleSet {
    let content = std::fs::read_to_string(path).unwrap_or_else(|error| {
        eprintln!(
            "FATAL: cannot read the best64 rule file at {path}: {error}. \
             The recovery container cannot run without the best64 rule set."
        );
        std::process::exit(1);
    });
    parse_rules(&content).unwrap_or_else(|error| {
        eprintln!(
            "FATAL: failed to parse the best64 rule file at {path}: {error}. \
             Fix the rule file and rebuild the image."
        );
        std::process::exit(1);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_recovery_job_rejects_unknown_format() {
        assert!(build_recovery_job("nope", "$office$*2013*x", 0).is_err());
    }

    #[test]
    fn build_recovery_job_rejects_malformed_ooxml_hash() {
        assert!(build_recovery_job("ooxml", "not-a-hash", 9600).is_err());
    }

    #[test]
    fn extract_error_maps_to_the_stable_codes_and_carries_no_parser_detail() {
        assert_eq!(
            extract_error_code(&ExtractError::NotEncrypted),
            "notEncrypted"
        );
        assert_eq!(
            extract_error_code(&ExtractError::Unsupported("some parser detail".into())),
            "unsupported"
        );
        assert_eq!(
            extract_error_code(&ExtractError::Malformed("offset 4919 of the file".into())),
            "malformed"
        );
    }

    #[test]
    fn decrypt_error_maps_to_the_stable_codes_and_carries_no_parser_detail() {
        assert_eq!(
            decrypt_error_code(&DecryptError::WrongPassword),
            "wrongPassword"
        );
        assert_eq!(
            decrypt_error_code(&DecryptError::NotEncrypted),
            "notEncrypted"
        );
        assert_eq!(
            decrypt_error_code(&DecryptError::Unsupported("some parser detail".into())),
            "unsupported"
        );
        assert_eq!(
            decrypt_error_code(&DecryptError::Malformed("offset 4919 of the file".into())),
            "malformed"
        );
    }

    #[test]
    fn unlock_body_splits_at_the_declared_password_length() {
        let mut body = Vec::new();
        body.extend_from_slice(&6u32.to_be_bytes());
        body.extend_from_slice(b"hunter");
        body.extend_from_slice(b"%PDF-1.7 file bytes");
        let framed = split_unlock_body(&body).expect("a well-formed body must split");
        assert_eq!(framed.password, b"hunter");
        assert_eq!(framed.file, b"%PDF-1.7 file bytes");
    }

    #[test]
    fn a_framing_complaint_never_quotes_the_body() {
        // Every rejection reason is read by a caller that may log it, and the bytes it would be
        // quoting are a password followed by a member's document.
        let password = b"correct-horse-battery-staple";
        let mut truncated = Vec::new();
        truncated.extend_from_slice(&(password.len() as u32 + 40).to_be_bytes());
        truncated.extend_from_slice(password);
        // `UnlockBody` deliberately has no `Debug`, so a rejection is unwrapped by hand rather than
        // through `unwrap_err` — a derived formatter over a password field is the very thing this
        // test exists to keep out of the service.
        let refusal = |body: &[u8]| match split_unlock_body(body) {
            Ok(_) => panic!("this body must not split"),
            Err(message) => message,
        };
        let cases = [
            refusal(&[0u8; 2]),
            refusal(&0u32.to_be_bytes()),
            refusal(&truncated),
            refusal(&[&(password.len() as u32).to_be_bytes()[..], password].concat()),
        ];
        for message in cases {
            assert!(
                !message.contains("correct")
                    && !message.contains("horse")
                    && !message.contains("PDF"),
                "a framing complaint quoted the body: {message}"
            );
        }
    }

    #[test]
    fn format_names_round_trip_through_build_recovery_job() {
        // The strings extract-hash emits must be the strings /recover-shard accepts, or a hash this
        // service produced could not be handed back to it.
        for format in [Format::Pdf, Format::Zip, Format::Ooxml] {
            let name = format_name(format);
            let rejected_for_the_hash_not_the_format =
                build_recovery_job(name, "not-a-hash", 0).unwrap_err();
            assert!(
                !rejected_for_the_hash_not_the_format.starts_with("unknown format"),
                "format_name emitted {name:?}, which build_recovery_job does not accept"
            );
        }
    }
}
