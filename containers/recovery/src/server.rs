use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use decryption_core::{
    parse_rules, recover_shard, Format, OoxmlAdapter, PdfAdapter, RecoveryJob, RuleSet, ShardSpec,
    ZipAdapter,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
        .with_state(state)
}

async fn ready() -> &'static str {
    "ok"
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
    /// Inclusive start index into the loaded wordlist.
    word_start: usize,
    /// Exclusive end index into the loaded wordlist.
    word_end: usize,
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

    // Guard the shard range. Clamp both ends to the wordlist length, then check
    // that the (possibly clamped) start <= end so the range is non-inverted.
    // An inverted range after clamping (word_start > word_end before clamping
    // resolves it, e.g. word_start=5 word_end=2) is a caller error → 400.
    let wordlist_len = state.wordlist.len();
    let word_start = request.word_start.min(wordlist_len);
    let word_end = request.word_end.min(wordlist_len);

    if request.word_start > request.word_end {
        // The caller sent an inverted range — reject rather than silently running
        // nothing, which could mask a coordinator bug.
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "wordStart ({}) must not exceed wordEnd ({})",
                request.word_start, request.word_end
            ),
        )
            .into_response();
    }

    let spec = ShardSpec {
        word_start,
        word_end,
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
}
