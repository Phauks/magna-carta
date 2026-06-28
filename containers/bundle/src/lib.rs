use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use std::sync::Arc;

/// The `/build` manifest body cap. The manifest is metadata (R2 keys) plus an optional inline CONTENTS
/// file, so it stays well under this; the limit (far above axum's 2 MiB default) keeps a large bundle's
/// many-entry manifest or a sizable CONTENTS listing from being rejected before it reaches the handler.
const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;

pub mod build;
pub mod contract;
pub mod encode;
pub mod r2;
pub mod split;

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
        .route("/build", post(build::build_handler))
        .layer(DefaultBodyLimit::max(MAX_MANIFEST_BYTES))
        .with_state(state)
}
