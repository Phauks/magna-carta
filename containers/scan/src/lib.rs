use axum::{
    body::Bytes,
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use std::sync::Arc;

pub mod clamav;
pub mod heuristics;
pub mod verdict;
pub mod yara;

use heuristics::ArchiveCaps;
use verdict::ScanResult;

/// The service's shared state: the compiled YARA rules (Send + Sync, shared by `Arc`), the clamd
/// address, the archive caps, and the engine-version string. Cloned cheaply per request (Arc clones).
#[derive(Clone)]
pub struct AppState {
    pub rules: Arc<yara_x::Rules>,
    pub clamd_address: Arc<str>,
    pub caps: ArchiveCaps,
    pub engine_version: Arc<str>,
}

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
// signatures, the structural heuristics for active content / encryption / archive attacks. A body that
// reaches here is within the inspectable-size cap (the pipeline gates oversize upstream), so buffering
// it is bounded.
async fn scan(
    State(state): State<AppState>,
    Query(params): Query<ScanParams>,
    body: Bytes,
) -> Json<ScanResult> {
    let clam = clamav::clamav_scan(&body, &state.clamd_address).await;
    let yara_matches = yara::yara_scan(&state.rules, &body);
    let heuristic = heuristics::inspect(&body, params.content_type.as_deref(), &state.caps);
    Json(verdict::combine(
        &clam,
        &yara_matches,
        heuristic,
        state.engine_version.to_string(),
    ))
}
