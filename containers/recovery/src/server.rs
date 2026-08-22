use axum::{
    body::Bytes,
    extract::{rejection::JsonRejection, DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use decryption_core::{
    extract_hash, parse_rules, recover_shard, recovery_tier, split_keyspace, ExtractError, Format,
    OoxmlAdapter, PdfAdapter, RecoveryJob, RecoveryTier, RuleSet, ZipAdapter,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Ceiling on the raw file body `POST /extract-hash` will read. The only caller is the app worker
/// over its service binding, which has already enforced the firm's own inspectable-size cap, and a
/// Cloudflare Worker cannot forward a request body larger than 100 MiB anyway — so this is a
/// backstop against a wedged or misconfigured caller, not the product limit. It replaces axum's
/// 2 MiB default, which would reject ordinary encrypted documents.
const EXTRACT_HASH_BODY_LIMIT_BYTES: usize = 128 * 1024 * 1024;

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
            post(extract_hash_handler).layer(DefaultBodyLimit::max(EXTRACT_HASH_BODY_LIMIT_BYTES)),
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
