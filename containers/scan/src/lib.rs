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
pub mod forge;
pub mod heuristics;
pub mod identify;
pub mod prefilter;
pub mod raw;
#[cfg(unix)]
pub mod spool;
pub mod yara;

use heuristics::ArchiveCaps;
use raw::{EngineTimings, RawScanResult};

/// The service's shared state: the compiled YARA rules (Send + Sync, shared by `Arc`), the per-rule
/// side-map that enriches a bare yara match into a policy fact, the clamd address, the archive caps, and
/// the engine-version string. Cloned cheaply per request (Arc clones).
#[derive(Clone)]
pub struct AppState {
    pub rules: Arc<yara_x::Rules>,
    pub side_map: Arc<yara::SideMap>,
    pub clamd_address: Arc<str>,
    pub caps: ArchiveCaps,
    pub engine_version: Arc<str>,
    /// The Magika content-type identification engine (embedded model), shared behind an `Arc` and used by
    /// the `/identify` route. Built once at boot (`main`), like the rule corpus.
    pub magika: Arc<identify::IdentifyEngine>,
}

/// Composes the three separable engine-version components into the canonical composite string.
///
/// Format: `engine/<code>+yara-rules/<rules>+clamav-db/<db>`
///
/// The `yara-rules` component is the baked YARA Forge release tag (e.g. `20260621`), or `none` when no
/// rules are loaded. A tag changes only when Forge actually publishes a new release, so the fleet
/// re-scans on a real rules change — not on every nightly image rebuild (which re-resolves the same tag).
///
/// Any component changing changes the whole string, which drives re-scan staleness across the fleet.
/// Split on `+` then `/` to decompose back to the individual components.
pub fn compose_engine_version(engine_code: u32, yara_rules: &str, clamav_db: &str) -> String {
    format!("engine/{engine_code}+yara-rules/{yara_rules}+clamav-db/{clamav_db}")
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
        .route("/identify", post(identify))
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

// Runs the three engines over the request body and returns the RAW facts: clamd + yara look for
// signatures, the structural heuristics for active content / encryption / archive attacks. clamd and the
// in-process engines run CONCURRENTLY (clamd over the socket while yara + heuristics run on a blocking
// thread). The container does not decide a verdict — it reports facts (`clam`, `heuristic`, `matches`)
// and the app maps them to the firm's policy. The body is streamed (not buffered whole): on Linux
// straight to clamd's scratch file, which clamd scans by path and the in-process engines read back
// through a memory map; on other hosts (the dev/test build) it is collected and streamed over INSTREAM.
// A body that reaches here is within the inspectable-size cap (the pipeline gates oversize upstream).
// A clamd-unavailable is reported honestly as `clam: unavailable` with a 200 — the app decides retry —
// NOT a 503. The only 503 the scan path raises is an in-process engine panic (a true container fault).
// `body` must be the last argument: extracting it consumes the request.
async fn scan(
    State(state): State<AppState>,
    Query(params): Query<ScanParams>,
    body: Body,
) -> Response {
    #[cfg(unix)]
    {
        match spool::spool_body(body, MAX_SCAN_BODY_BYTES).await {
            Ok(spooled) => {
                // clamd scans the scratch file by PATH; capture an owned path + address so the clamd
                // future does not borrow the spooled body, which moves into the concurrent engine stage.
                let path = spooled.path().to_owned();
                let clamd_address = state.clamd_address.clone();
                let clam_future =
                    async move { clamav::scan_file_path(&path, &clamd_address).await };
                finish(state, params.content_type, clam_future, spooled).await
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
                // INSTREAM needs the bytes too; clone the (refcounted) buffer for clamd so the original
                // moves into the concurrent engine stage.
                let buffer = bytes.clone();
                let clamd_address = state.clamd_address.clone();
                let clam_future =
                    async move { clamav::scan_buffer(&buffer, &clamd_address).await };
                finish(state, params.content_type, clam_future, bytes).await
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

// Runs Magika over the request body and returns the RAW identification facts (label, score, group,
// engine/model versions) as a 200 — no verdict, no extension recommendation: the app decides whether the
// content type matches the claimed extension. The body is collected within the same cap as `/scan`;
// inference is CPU-bound, so it runs on a blocking thread (off the async reactor), and a panic there
// surfaces as a `JoinError` mapped to a retryable 503 (`engines_unavailable`) — never a fabricated
// identification. An over-cap body is the same `too_large()` 413 as `/scan`. `body` must be last: the
// extractor consumes the request.
async fn identify(State(state): State<AppState>, body: Body) -> Response {
    match axum::body::to_bytes(body, MAX_SCAN_BODY_BYTES).await {
        Ok(bytes) => {
            let engine = state.magika.clone();
            match tokio::task::spawn_blocking(move || identify::identify_bytes(&engine, &bytes))
                .await
            {
                Ok(raw) => Json(raw).into_response(),
                Err(_) => engines_unavailable(),
            }
        }
        Err(_) => too_large(),
    }
}

// Owns the body bytes for the engine stage. On Linux it is the spooled, memory-mapped scratch file (no
// heap copy; its `Drop` removes the file); elsewhere it is the collected INSTREAM buffer. Either way
// `bytes()` lends the body to the in-process engines. Shared via `Arc` between the async handler (which
// holds it across the clamd/yara join, keeping the Linux scratch file alive while clamd reads it by
// path) and the blocking engine thread — hence `Sync`, so the last `Arc` to drop after the join releases
// the backing resource. Both backing types are `Sync` (an `Mmap` + `PathBuf`, or a refcounted `Bytes`).
trait BodyBytes: Send + Sync + 'static {
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

// The result of the in-process engines (enriched yara matches + the structural-heuristic verdict), or
// `None` if an engine panicked (a parser bug or a pathological input). A panic is isolated to a retryable
// fault below, never a fabricated clean.
struct EngineOutput {
    matches: Vec<yara::RuleMatch>,
    heuristic: heuristics::Heuristic,
}

// Runs clamd and the in-process engines CONCURRENTLY and renders the raw scan facts as a 200 — or a 503
// when an in-process engine panicked. clamd runs over its socket (by scratch-file path on Linux, over
// INSTREAM elsewhere) while yara + the structural heuristics run on a blocking thread (they are
// CPU-bound — keep them off the async reactor); `tokio::join!` awaits both. The container reports facts,
// not a verdict: a clamd-unavailable becomes `clam: unavailable` in the body (a 200 the app decides to
// retry), NOT a 503.
//
// BODY OWNERSHIP across the join: the body is wrapped in an `Arc` the async handler holds until AFTER the
// join. The blocking engine thread holds a second `Arc` clone for `bytes()`. On Linux clamd reads the
// scratch file by path concurrently; the file is removed only when the last `Arc` drops — which is after
// the join, so clamd never races the engine thread's `Drop` removing the file mid-scan.
//
// PANIC ISOLATION: the engine work is wrapped in `catch_unwind`. An ordinary parser panic (yara or a
// heuristic on a hostile input) is caught and mapped to a retryable SERVICE_UNAVAILABLE — NEVER a dropped
// connection (which axum would surface as a 500/closed socket the consumer might not retry safely) and
// NEVER a fabricated clean. A panic does not poison anything: the blocking thread is the unwind boundary,
// and `state`/`rules`/`side_map` are behind `Arc` (no locks held across the work). An abort (e.g. a stack
// overflow `catch_unwind` cannot catch) is guarded upstream in the engines themselves — see
// `heuristics::pdf` for the pre-parse nesting-depth bail.
async fn finish<B, F>(
    state: AppState,
    content_type: Option<String>,
    clam_future: F,
    body: B,
) -> Response
where
    B: BodyBytes,
    F: std::future::Future<Output = clamav::ClamVerdict> + Send,
{
    // The handler retains this `Arc` across the join below; the engine thread takes a clone. On Linux
    // that keeps the scratch file alive while clamd reads it by path.
    let body = Arc::new(body);
    let body_for_engines = Arc::clone(&body);

    let clamd_started = std::time::Instant::now();
    let timed_clam = async move {
        let verdict = clam_future.await;
        (verdict, clamd_started.elapsed().as_millis() as u64)
    };

    let engine_state = state.clone();
    let engine_task = tokio::task::spawn_blocking(move || {
        let started = std::time::Instant::now();
        // The Arc clone is owned by this closure; `bytes()` borrows it for the duration of the scan.
        let output = isolate_engines(|| {
            let bytes = body_for_engines.bytes();
            // A yara fault (a scan timeout or internal error) is a retryable engine fault, NOT a silent
            // no-match: surface it as `None` so `finish` returns a 503 and the file is re-scanned, the
            // same as an engine panic. With a loaded corpus, swallowing a yara fault as empty matches
            // would drop the detection layer for that file and could commit it clean — forbidden.
            let ids = match yara::yara_scan(&engine_state.rules, bytes) {
                Ok(ids) => ids,
                Err(fault) => {
                    eprintln!("yara scan fault (retryable): {}", fault.0);
                    return None;
                }
            };
            Some(EngineOutput {
                matches: yara::enrich_matches(ids, &engine_state.side_map),
                heuristic: heuristics::inspect(bytes, content_type.as_deref(), &engine_state.caps),
            })
        });
        (output, started.elapsed().as_millis() as u64)
    });

    let (clam, engine_join) = tokio::join!(timed_clam, engine_task);
    // The handler's `Arc` is dropped at the end of this function — after the join — so the scratch file
    // outlived clamd's path read above.
    let (clam_verdict, clamd_ms) = clam;

    // A `JoinError` (the blocking thread panicked despite the catch, or was cancelled) and a caught panic
    // (`Ok((None, _))`) both collapse to the same retryable fault — the in-process engines could not
    // produce a sound result, so the file must be re-scanned, never recorded as clean.
    let (engine_output, yara_ms) = match engine_join {
        Ok((Some(output), yara_ms)) => (output, yara_ms),
        Ok((None, _)) | Err(_) => return engines_unavailable(),
    };

    let raw = RawScanResult {
        engine_version: state.engine_version.to_string(),
        clam: raw::clam_fact(&clam_verdict),
        heuristic: raw::heuristic_fact(engine_output.heuristic),
        matches: engine_output.matches,
        timings: EngineTimings { clamd_ms, yara_ms },
    };
    Json(raw).into_response()
}

fn engines_unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "scan engine unavailable; retry",
    )
        .into_response()
}

// Runs the in-process engine work under `catch_unwind`, yielding `None` on any fault so `finish` maps it
// to a retryable 503 rather than a dropped connection or, worse, a clean verdict. Two fault sources both
// collapse to `None`: (1) an ordinary parser panic (yara or a structural heuristic on a hostile input),
// caught by `catch_unwind`; and (2) a deliberate `None` the work returns for a non-panic engine fault (a
// yara scan timeout/error). Pure and synchronous so it is unit-testable on every host; `finish` calls it
// inside `spawn_blocking` to also keep the CPU-bound work off the async reactor. (A stack-overflow abort,
// which `catch_unwind` cannot catch, is prevented upstream — see `heuristics::pdf`'s nesting-depth pre-check.)
fn isolate_engines(work: impl FnOnce() -> Option<EngineOutput>) -> Option<EngineOutput> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_engine_version_produces_the_canonical_composite_format() {
        // The composite must be decomposable by splitting on `+` then `/`.
        assert_eq!(
            compose_engine_version(1, "20260621", "27268"),
            "engine/1+yara-rules/20260621+clamav-db/27268"
        );
        // No rules loaded reads as `yara-rules/none`.
        assert_eq!(
            compose_engine_version(1, "none", "27268"),
            "engine/1+yara-rules/none+clamav-db/27268"
        );
    }

    #[test]
    fn compose_engine_version_any_component_change_changes_the_whole_string() {
        // Changing any one component must produce a different string — this is the staleness gate.
        let base = compose_engine_version(1, "20260621", "27268");
        assert_ne!(compose_engine_version(2, "20260621", "27268"), base); // engine bump
        assert_ne!(compose_engine_version(1, "20260628", "27268"), base); // new Forge release
        assert_ne!(compose_engine_version(1, "20260621", "27269"), base); // daily sig refresh
    }

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
    fn isolate_engines_propagates_a_non_panic_engine_fault_as_none() {
        // A yara scan timeout/error returns `None` from the work closure (not a panic); isolate_engines
        // must surface it as `None` too, so `finish` maps it to a retryable 503 — never a clean result.
        let caught = isolate_engines(|| None);
        assert!(
            caught.is_none(),
            "a non-panic engine fault (work returned None) must stay None"
        );
    }

    #[test]
    fn isolate_engines_passes_a_normal_result_through() {
        let output = isolate_engines(|| {
            Some(EngineOutput {
                matches: Vec::new(),
                heuristic: heuristics::Heuristic::Clean,
            })
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
