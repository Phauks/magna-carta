use axum::{http::StatusCode, routing::get, Router};

pub mod convert;
pub use convert::{convert, ConvertError};

pub fn router() -> Router {
    Router::new().route("/ready", get(|| async { StatusCode::OK }))
}
