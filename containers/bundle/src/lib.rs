use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;

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
        .with_state(state)
}
