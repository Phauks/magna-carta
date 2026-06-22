use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

// The prefilter (`atoms` extracts sound fixed-byte anchors from the ClamAV signature database;
// `prefilter` matches them to clear files without clamd) is built and tested but is deliberately NOT
// wired into the scan path. A prefilter can only clear a file by ruling out EVERY applicable signature,
// and ClamAV's set contains irreducible any-type signatures (logical/byte-compare rules with no
// necessary literal) that force every file through to clamd regardless — so a sound prefilter buys no
// speedup over clamd's matcher. It is kept as a tested, self-maintaining foundation (the DB-derived
// `tests/differential.rs` gate); scan throughput scales horizontally and via the per-firm content-dedup
// cache instead.
pub mod atoms;
pub mod clamav;
pub mod heuristics;
pub mod prefilter;
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
                // The clamd await is done; move the spooled body (its mmap is `Send`) into the engine
                // stage, which owns it for the scan and drops it — removing the scratch file — after.
                finish(state, params.content_type, clam, spooled).await
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
                finish(state, params.content_type, clam, bytes).await
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

// Owns the body bytes for the engine stage so they can be moved (`'static + Send`) onto a blocking
// thread. On Linux it is the spooled, memory-mapped scratch file (no heap copy; its `Drop` removes the
// file); elsewhere it is the collected INSTREAM buffer. Either way `bytes()` lends the body to the
// in-process engines, and dropping it after the scan releases the backing resource.
trait BodyBytes: Send + 'static {
    fn bytes(&self) -> &[u8];
}

#[cfg(unix)]
impl BodyBytes for spool::Spooled {
    fn bytes(&self) -> &[u8] {
        spool::Spooled::bytes(self)
    }
}

#[cfg(not(unix))]
impl BodyBytes for axum::body::Bytes {
    fn bytes(&self) -> &[u8] {
        self.as_ref()
    }
}

// The combined result of the in-process engines, or `None` if an engine panicked (a parser bug or a
// pathological input). A panic is isolated to a retryable fault below, never a clean verdict.
struct EngineOutput {
    yara_matches: Vec<String>,
    heuristic: heuristics::Heuristic,
}

// Runs yara and the structural heuristics on a blocking thread (they are CPU-bound — keep them off the
// async reactor), combines them with the clamd verdict, and renders the response — a 200 verdict, or a
// 503 when clamd is the only signal and it is unavailable, or a 503 when an engine panicked.
//
// PANIC ISOLATION: the engine work is wrapped in `catch_unwind`. An ordinary parser panic (yara or a
// heuristic on a hostile input) is caught and mapped to the same retryable SERVICE_UNAVAILABLE as a
// clamd fault — NEVER a dropped connection (which axum would surface as a 500/closed socket the consumer
// might not retry safely) and NEVER a clean verdict. A panic does not poison anything: the blocking
// thread is the unwind boundary, and `state`/`rules` are behind `Arc` (no locks held across the work).
// An abort (e.g. a stack overflow `catch_unwind` cannot catch) is guarded upstream in the engines
// themselves — see `heuristics::pdf` for the pre-parse nesting-depth bail.
async fn finish(
    state: AppState,
    content_type: Option<String>,
    clam: clamav::ClamVerdict,
    body: impl BodyBytes,
) -> Response {
    let engine_state = state.clone();
    let output = tokio::task::spawn_blocking(move || {
        // The body is owned by this closure; `body.bytes()` borrows it for the duration of the scan.
        isolate_engines(|| {
            let bytes = body.bytes();
            EngineOutput {
                yara_matches: yara::yara_scan(&engine_state.rules, bytes),
                heuristic: heuristics::inspect(bytes, content_type.as_deref(), &engine_state.caps),
            }
        })
    })
    .await;

    // A `JoinError` (the blocking thread panicked despite the catch, or was cancelled) and a caught panic
    // (`Ok(None)`) both collapse to the same retryable fault — the in-process engines could not produce a
    // sound result, so the file must be re-scanned, never recorded as clean.
    let output = match output {
        Ok(Some(output)) => output,
        Ok(None) | Err(_) => return engines_unavailable(),
    };

    match verdict::combine(
        &clam,
        &output.yara_matches,
        output.heuristic,
        state.engine_version.to_string(),
    ) {
        CombineOutcome::Verdict(result) => Json(result).into_response(),
        CombineOutcome::SignatureEngineUnavailable => signature_engine_unavailable(),
    }
}

fn signature_engine_unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "signature engine unavailable; retry",
    )
        .into_response()
}

fn engines_unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "scan engine unavailable; retry",
    )
        .into_response()
}

// Runs the in-process engine work under `catch_unwind`: an ordinary parser panic (yara or a structural
// heuristic on a hostile input) is caught and returned as `None` — never propagated — so `finish` maps
// it to a retryable 503 rather than a dropped connection or, worse, a clean verdict. Pure and
// synchronous so it is unit-testable on every host; `finish` calls it inside `spawn_blocking` to also
// keep the CPU-bound work off the async reactor. (A stack-overflow abort, which `catch_unwind` cannot
// catch, is prevented upstream — see `heuristics::pdf`'s nesting-depth pre-check.)
fn isolate_engines(work: impl FnOnce() -> EngineOutput) -> Option<EngineOutput> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolate_engines_catches_a_panic_as_none() {
        // A parser/engine panic on a hostile file MUST be caught here, not propagated — the caller maps
        // `None` to a retryable 503 (never a dropped connection, never a clean verdict).
        let caught = isolate_engines(|| panic!("induced engine panic"));
        assert!(
            caught.is_none(),
            "a panicking engine run must be caught as None"
        );
    }

    #[test]
    fn isolate_engines_passes_a_normal_result_through() {
        let output = isolate_engines(|| EngineOutput {
            yara_matches: Vec::new(),
            heuristic: heuristics::Heuristic::Clean,
        });
        assert!(output.is_some());
    }

    #[test]
    fn an_engine_fault_renders_a_retryable_503_never_a_clean_200() {
        // The arm `finish` takes when `isolate_engines` yields `None` (a caught panic) or the blocking
        // task errors: a retryable SERVICE_UNAVAILABLE, so the ingest consumer re-scans — it must never
        // be a 200 clean verdict.
        assert_eq!(
            engines_unavailable().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
