//! The container's HTTP surface: `GET /ready` and `POST /convert`.
//!
//! `/convert` matches the raster engine's wire shape exactly — source bytes as the body, formats and
//! recipe as headers, converted bytes and a canonical media type back — so the convert worker's
//! forwarding proxy stays engine-agnostic and needs no arm for this container.
//!
//! `x-engine-id` arrives on every request because that proxy forwards headers verbatim, and is
//! deliberately never read: dispatch is on the format pair. That is what lets more than one engine
//! identifier share this container.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;

use crate::dispatch::recipe_for;
use crate::package::JobPackage;
use crate::pool::{Pool, PoolError};
use crate::protocol::UnconvertibleCode;

/// The `/convert` body cap: 256 mebibytes, the same value and the same reasoning as the raster
/// engine's. The body is buffered before any guard can run, and office documents are far smaller
/// than the pipeline's general ingest cap, so the two caps are deliberately different.
pub const MAX_CONVERT_BODY_BYTES: usize = 256 * 1024 * 1024;

/// What the HTTP surface needs beyond the pool.
#[derive(Clone)]
pub struct ServiceConfiguration {
    pub pool: Arc<Pool>,
    /// Where job packages are materialised. On disk, never a tmpfs, so a large document consumes
    /// disk budget rather than the memory budget the workers are sized against.
    pub spool_directory: std::path::PathBuf,
}

async fn handle_ready(State(configuration): State<ServiceConfiguration>) -> Response {
    // Honest by construction: 200 only once a worker has completed suite initialisation. This
    // matters more here than anywhere else in the repository — initialisation takes tens of seconds,
    // and a container that reports ready before it can convert hands that whole delay to the first
    // user request as an unexplained stall.
    if !configuration.pool.is_ready() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ready":false}"#.to_owned(),
        )
            .into_response();
    }
    let suite_version = configuration.pool.suite_version().await;
    // The suite version travels with readiness so a document converted before and after an upgrade
    // is explainably different rather than mysteriously so.
    let body = match suite_version {
        Some(version) => {
            let quoted = serde_json::to_string(&version).unwrap_or_else(|_| "null".to_owned());
            format!(r#"{{"ready":true,"suiteVersion":{quoted}}}"#)
        }
        None => r#"{"ready":true,"suiteVersion":null}"#.to_owned(),
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response()
}

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

async fn handle_convert(
    State(configuration): State<ServiceConfiguration>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let (Some(source_format), Some(target_format), Some(recipe_reference)) = (
        header_value(&headers, "x-source-format"),
        header_value(&headers, "x-target-format"),
        header_value(&headers, "x-recipe"),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // A format pair this container does not serve. Refused before a worker is touched, so an
    // unserved pair can never occupy the pool.
    let Some(recipe) = recipe_for(&source_format, &target_format, &recipe_reference) else {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    };

    if body.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    // The package is held across the conversion; dropping it removes the job directory, so the
    // deadline path, the fault path, and the success path all clean up without remembering to.
    let package = match JobPackage::create(&configuration.spool_directory, &body, &recipe) {
        Ok(package) => package,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    match configuration.pool.convert(&package).await {
        Ok(()) => match package.read_output() {
            Ok(Some(bytes)) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, recipe.media_type)],
                bytes,
            )
                .into_response(),
            // The worker reported success and there is nothing to return. There is never a 200 with
            // empty bytes: a caller about to file something cannot be left unable to distinguish an
            // empty document from a failed conversion.
            Ok(None) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        // A document that reached the suite and could not be converted, including one that is
        // password-protected. We never attempt a password: an encrypted document is a deterministic
        // fact, the same stance the scan engine takes.
        Err(PoolError::Unconvertible(code)) => unconvertible_status(code).into_response(),
        // Retryable: no worker could be acquired, or one died in a way that says nothing about the
        // document.
        Err(PoolError::NoWorkerAvailable) | Err(PoolError::WorkerFault(_)) => {
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(PoolError::ConversionDeadline) => StatusCode::GATEWAY_TIMEOUT.into_response(),
    }
}

fn unconvertible_status(_code: UnconvertibleCode) -> StatusCode {
    // Every unconvertible reason is a deterministic fact about the document rather than a transient
    // fault, so they share one status. The reason is not returned to the caller: the response body
    // for a failure carries no document-derived content.
    StatusCode::UNPROCESSABLE_ENTITY
}

/// The container's routes.
///
/// Note the divergence from the shared container host skeleton: this container defines its own
/// `/ready` rather than taking `engine_host::host::ready_app`'s. That helper answers a static 200,
/// which is exactly the lie this container must not tell while the pool is still warming. The
/// skeleton's other rules are kept — the panic net, the `0.0.0.0:8080` bind, and an explicit body
/// cap — see `crates/engine-host/src/host.rs` and `docs/conventions/engine-host-seam.md`.
pub fn router(configuration: ServiceConfiguration) -> Router {
    Router::new()
        .route("/ready", get(handle_ready))
        .route(
            "/convert",
            post(handle_convert).layer(DefaultBodyLimit::max(MAX_CONVERT_BODY_BYTES)),
        )
        .with_state(configuration)
}
