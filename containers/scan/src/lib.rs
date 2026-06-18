use axum::{
    body::Bytes,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

/// Builds the scan service router. The binary serves it on :8080; tests serve it on an ephemeral port.
pub fn app() -> Router {
    Router::new()
        .route("/ready", get(ready))
        .route("/scan", post(scan))
}

async fn ready() -> &'static str {
    "ok"
}

// The stub verdict until the engines land — a body that reaches here is "unscanned/no-engine", never
// silently clean (the adapter treats a missing engine as not-scanned, the safe default).
async fn scan(_body: Bytes) -> Json<serde_json::Value> {
    Json(json!({ "verdict": "unscanned", "reason": "no-engine", "engineVersion": null }))
}
