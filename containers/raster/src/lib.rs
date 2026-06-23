use axum::{http::StatusCode, routing::get, Router};

pub fn router() -> Router {
    Router::new().route("/ready", get(|| async { StatusCode::OK }))
}
