use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

pub mod clamav;
pub mod heuristics;
#[cfg(unix)]
pub mod spool;
pub mod verdict;
pub mod yara;

use heuristics::ArchiveCaps;
use verdict::CombineOutcome;

/// The service's shared state: the compiled YARA rules (Send + Sync, shared by `Arc`), the clamd
/// address, the archive caps, and the engine-version string. Cloned cheaply per request (Arc clones).
#[derive(Clone)]
pub struct AppState {
    pub rules: Arc<yara_x::Rules>,
    pub clamd_address: Arc<str>,
    pub caps: ArchiveCaps,
    pub engine_version: Arc<str>,
}

/// The maximum `/scan` request body, aligned with the ingest pipeline's 2 GiB inspectable-size cap
/// (`fileManager.inspectableSizeCapBytes`); oversize is gated upstream, so this is the matching ceiling.
/// The handler streams the raw body rather than using axum's `Bytes` extractor (which would both impose
/// its own 2 MiB default and force a full heap copy), so this cap is enforced by hand as the bytes
/// arrive — a raw body stream bypasses the extractor body limit.
const MAX_SCAN_BODY_BYTES: usize = 2 * 1024 * 1024 * 1024;

/// Builds the scan service router over the shared state. The binary serves it on :8080; tests serve it
/// on an ephemeral port.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/ready", get(ready))
        .route("/scan", post(scan))
        .with_state(state)
}

async fn ready() -> &'static str {
    "ok"
}

#[derive(serde::Deserialize)]
struct ScanParams {
    // The sniffed content-type metadata the port provides; a hint for the heuristic dispatch. `size`
    // is also sent but unused here — the ingest pipeline decides oversize before calling the engine.
    #[serde(rename = "contentType", default)]
    content_type: Option<String>,
}

// Runs the three engines over the request body and returns the combined verdict: clamd + yara look for
// signatures, the structural heuristics for active content / encryption / archive attacks. The body is
// streamed (not buffered whole): on Linux straight to clamd's scratch file, which clamd scans by path
// and the in-process engines read back through a memory map; on other hosts (the dev/test build) it is
// collected and streamed over INSTREAM. A body that reaches here is within the inspectable-size cap (the
// pipeline gates oversize upstream). A clamd fault with no other signal is NOT a verdict — it is a 503
// so the ingest consumer re-queues the file rather than committing a never-virus-scanned object as
// usable. `body` must be the last argument: extracting it consumes the request.
async fn scan(
    State(state): State<AppState>,
    Query(params): Query<ScanParams>,
    body: Body,
) -> Response {
    #[cfg(unix)]
    {
        match spool::spool_body(body, MAX_SCAN_BODY_BYTES).await {
            Ok(spooled) => {
                let clam = clamav::scan_file_path(spooled.path(), &state.clamd_address).await;
                finish(
                    &state,
                    params.content_type.as_deref(),
                    clam,
                    spooled.bytes(),
                )
            }
            Err(spool::SpoolError::TooLarge) => too_large(),
            // A scratch-write failure (e.g. the disk filled) is a transient engine fault, not a verdict.
            Err(spool::SpoolError::Io(_)) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "scan spool unavailable; retry",
            )
                .into_response(),
        }
    }
    #[cfg(not(unix))]
    {
        match axum::body::to_bytes(body, MAX_SCAN_BODY_BYTES).await {
            Ok(bytes) => {
                let clam = clamav::scan_buffer(&bytes, &state.clamd_address).await;
                finish(&state, params.content_type.as_deref(), clam, &bytes)
            }
            Err(_) => too_large(),
        }
    }
}

fn too_large() -> Response {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        "body exceeds the inspectable-size cap",
    )
        .into_response()
}

// Runs yara and the structural heuristics over the body bytes, combines them with the clamd verdict, and
// renders the response — a 200 verdict, or a 503 when clamd is the only signal and it is unavailable.
fn finish(
    state: &AppState,
    content_type: Option<&str>,
    clam: clamav::ClamVerdict,
    bytes: &[u8],
) -> Response {
    let yara_matches = yara::yara_scan(&state.rules, bytes);
    let heuristic = heuristics::inspect(bytes, content_type, &state.caps);
    match verdict::combine(
        &clam,
        &yara_matches,
        heuristic,
        state.engine_version.to_string(),
    ) {
        CombineOutcome::Verdict(result) => Json(result).into_response(),
        CombineOutcome::SignatureEngineUnavailable => (
            StatusCode::SERVICE_UNAVAILABLE,
            "signature engine unavailable; retry",
        )
            .into_response(),
    }
}
