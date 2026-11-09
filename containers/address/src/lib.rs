//! The United States address engine, as a service.
//!
//! The index is `crates/address-core`. This crate gives it a request surface, storage and a build loop,
//! and is one image run as two Container classes by `apps/address-worker`: the query class calls
//! `/suggestions` and `/units`, the build class calls `/builds`. Nothing picks a mode; a class simply
//! never calls the other's routes.
//!
//! **Unlike `containers/search`, this engine keeps state between requests,** deliberately. A discovery
//! split is one firm's privileged content, so that engine re-reads under each call's authorization and
//! keeps nothing. This index is public reference data, identical for every firm, so holding the four
//! partitions open and caching the byte ranges already read is a cache and nothing more: no firm's
//! authorization can be carried past its request, because no firm's data is here.
//!
//! What it still never does: log or return a query or an address in an error, or name an object key in
//! one. Error bodies are a single fixed word.
//!
//! **The heavy work runs off the async executor.** Opening partitions, answering, and building all do
//! blocking I/O, so each runs on a blocking task or the build's own thread.

pub mod build_job;
pub mod clock;
pub mod current_index;
pub mod object_client;
pub mod pointer;
pub mod source_client;
pub mod wire;

use std::path::PathBuf;
use std::sync::Arc;

use address_core::BuildOptions;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::build_job::{BuildRunner, BuildSettings, PART_SIZE};
use crate::current_index::{HolderIntervals, IndexHolder};
use crate::object_client::{ObjectStore, RangeCache, CACHE_BUDGET_BYTES, OBJECT_HOST};
use crate::source_client::SOURCE_HOST;
use crate::wire::Refusal;

/// Everything the service is configured with. Production values come from [`Settings::production`];
/// tests point the hosts at local fakes and shrink the intervals and part size.
#[derive(Clone, Debug)]
pub struct Settings {
    pub object_base_url: String,
    pub source_base_url: String,
    pub cache_budget_bytes: usize,
    pub intervals: HolderIntervals,
    pub part_size: usize,
    pub build_options: BuildOptions,
    pub scratch_root: PathBuf,
}

impl Settings {
    pub fn production() -> Self {
        Self {
            object_base_url: OBJECT_HOST.to_owned(),
            source_base_url: SOURCE_HOST.to_owned(),
            cache_budget_bytes: CACHE_BUDGET_BYTES,
            intervals: HolderIntervals::default(),
            part_size: PART_SIZE,
            build_options: BuildOptions::default(),
            scratch_root: std::env::temp_dir(),
        }
    }
}

/// The shared state behind the routes.
#[derive(Clone, Debug)]
pub struct Service {
    pub index: Arc<IndexHolder>,
    pub builds: Arc<BuildRunner>,
}

impl Service {
    pub fn new(settings: &Settings) -> Self {
        let index = Arc::new(IndexHolder::new(
            ObjectStore::new(&settings.object_base_url),
            RangeCache::new(settings.cache_budget_bytes),
            settings.intervals,
        ));
        let builds = BuildRunner::new(BuildSettings {
            object_base_url: settings.object_base_url.clone(),
            source_base_url: settings.source_base_url.clone(),
            part_size: settings.part_size,
            options: settings.build_options,
            scratch_root: settings.scratch_root.clone(),
        });
        Self { index, builds }
    }
}

pub fn router(service: Service) -> Router {
    Router::new()
        .route("/ready", get(ready))
        .route("/suggestions", post(suggestions))
        .route("/units", post(units))
        .route("/builds", post(start_build).get(build_status))
        .with_state(service)
}

async fn ready() -> StatusCode {
    StatusCode::NO_CONTENT
}

fn refused(refusal: Refusal) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": refusal.0 }))).into_response()
}

fn outcome(word: &str) -> Response {
    Json(json!({ "outcome": word })).into_response()
}

fn task_failed() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "engine-failure" })),
    )
        .into_response()
}

async fn suggestions(State(service): State<Service>, body: Bytes) -> Response {
    let request = match wire::suggestion_request(&body) {
        Ok(request) => request,
        Err(refusal) => return refused(refusal),
    };
    if !request.covered {
        return outcome("no-coverage");
    }
    let answered = tokio::task::spawn_blocking(move || {
        let index = service.index.current()?;
        match index
            .engine
            .suggest(&request.query, request.limit, request.near.as_deref())
        {
            Ok(offers) => Some(offers),
            Err(error) => {
                // The engine's own words: a read or a format failure, never the query.
                eprintln!("address: a suggestion could not be answered: {error}");
                None
            }
        }
    })
    .await;
    match answered {
        Ok(Some(offers)) => {
            Json(json!({ "outcome": "suggestions", "offers": offers })).into_response()
        }
        Ok(None) => outcome("unavailable"),
        Err(_) => task_failed(),
    }
}

async fn units(State(service): State<Service>, body: Bytes) -> Response {
    let request = match wire::units_request(&body) {
        Ok(request) => request,
        Err(refusal) => return refused(refusal),
    };
    if !request.covered {
        return outcome("no-coverage");
    }
    let answered = tokio::task::spawn_blocking(move || {
        let index = service.index.current()?;
        match index.engine.units(&request.building) {
            Ok(addresses) => Some(addresses),
            Err(error) => {
                eprintln!("address: units could not be answered: {error}");
                None
            }
        }
    })
    .await;
    match answered {
        Ok(Some(addresses)) => {
            Json(json!({ "outcome": "units", "addresses": addresses })).into_response()
        }
        Ok(None) => outcome("unavailable"),
        Err(_) => task_failed(),
    }
}

async fn start_build(State(service): State<Service>, body: Bytes) -> Response {
    match wire::build_request(&body) {
        Err(refusal) => refused(refusal),
        Ok(false) => refused(Refusal("no-coverage")),
        Ok(true) => {
            if service.builds.start() {
                (StatusCode::ACCEPTED, Json(json!({ "build": "started" }))).into_response()
            } else {
                (StatusCode::CONFLICT, Json(json!({ "build": "running" }))).into_response()
            }
        }
    }
}

async fn build_status(State(service): State<Service>) -> Response {
    Json(service.builds.status()).into_response()
}
