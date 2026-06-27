use axum::{routing::get, Router};
use std::sync::Arc;

pub mod contract;
pub mod encode;
pub mod r2;
pub mod split;

// `build` (the POST /build handler) lands in a later task; its route is registered then.

/// Shared service state: the R2 base URL every entry GET / volume PUT is resolved against, and a reused
/// HTTP client. Cloned cheaply per request.
#[derive(Clone)]
pub struct AppState {
    pub r2_base_url: Arc<str>,
    pub http: reqwest::Client,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/ready", get(|| async { "ok" }))
        .with_state(state)
}
