//! The discovery keyword-search engine, as a service.
//!
//! The engine itself is `crates/search-core` — pure Rust, no knowledge of firms, buckets, or workers.
//! This crate is the thin shell that gives it a request surface and real storage: it deserializes one
//! of four operations, binds the crate's `RangeReader` seam to actual object reads
//! (`object_client.rs`), runs the engine, and returns the crate's own results.
//!
//! Three properties are deliberate and worth keeping:
//!
//! **It holds no firm state between calls.** No split cache, no open searchers carried across
//! requests. That costs the second query against a split its warm open, and it is the right trade for
//! now: a cached searcher answers from bytes whose authorization was checked on a previous call, which
//! moves the per-read authorization off the read path. Residency is a measured question — how much of a
//! working set an instance should hold, and under what re-check — and it belongs to the slice that has
//! a real corpus resident to measure. Within a single call the split IS held open across the query,
//! which is where the multi-hit saving actually is.
//!
//! **It never chooses a key.** Both the splits it reads and the key it writes come from the caller,
//! which is the side that owns the per-firm catalog and firm scoping.
//!
//! **The heavy work runs off the async executor.** Building, merging, and querying a Tantivy index are
//! CPU- and disk-bound and use blocking IO for their ranged reads, so each runs on a blocking task; an
//! engine operation must never occupy the reactor other requests are waiting on.

pub mod dto;
pub mod object_client;

use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use axum::extract::Json;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Router;
use search_core::{
    build_split, merge_splits_over_readers, query_searchers, IndexDocument, RangeReader,
    SplitSearcher, SCHEMA_GENERATION,
};

use crate::dto::{
    CompactRequest, CompactedSplit, Hit, IndexRequest, PublishedSplit, QueryRequest, QueryResponse,
    SplitTarget,
};
use crate::object_client::{put_object, HttpRangeReader, ObjectAccess};

pub fn router() -> Router {
    Router::new()
        .route("/ready", get(ready))
        .route("/index", post(index))
        .route("/query", post(query))
        .route("/remove", post(remove))
        .route("/compact", post(compact))
}

async fn ready() -> StatusCode {
    StatusCode::OK
}

// An engine failure is a status and a short reason, never a stack or a key. The caller maps a non-2xx
// to an adapter error and logs it under its own correlated error id; a message from here that named an
// object key would put a firm's handle in a log this process does not own.
type EngineResult<T> = Result<Json<T>, (StatusCode, String)>;

fn engine_failure(context: &'static str, error: impl std::fmt::Display) -> (StatusCode, String) {
    // The display of a search-core error is engine vocabulary (a malformed split, a query parse), and
    // of an IO error a transport condition. Neither includes caller content.
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{context}: {error}"),
    )
}

async fn index(Json(request): Json<IndexRequest>) -> EngineResult<PublishedSplit> {
    let published = tokio::task::spawn_blocking(move || build_and_publish(request))
        .await
        .map_err(|error| engine_failure("index task", error))??;
    Ok(Json(published))
}

fn build_and_publish(request: IndexRequest) -> Result<PublishedSplit, (StatusCode, String)> {
    // One passage is one indexed document in the engine's schema: the passage is the unit a hit points
    // at, and the unit the semantic half embeds, so the two halves address the same thing.
    let documents: Vec<IndexDocument> = request
        .passages
        .into_iter()
        .map(|passage| IndexDocument {
            document_id: request.document_id.clone(),
            chunk_id: passage.chunk_id,
            body: passage.text,
        })
        .collect();
    let document_count = documents.len() as u64;
    let bytes = build_split(&documents).map_err(|error| engine_failure("build split", error))?;
    let size_bytes = bytes.len() as u64;
    put_object(&request.object_access, &request.object_key, bytes)
        .map_err(|error| engine_failure("publish split", error))?;
    Ok(PublishedSplit {
        object_key: request.object_key,
        document_count,
        size_bytes,
        schema_generation: SCHEMA_GENERATION,
    })
}

async fn query(Json(request): Json<QueryRequest>) -> EngineResult<QueryResponse> {
    let response = tokio::task::spawn_blocking(move || run_query(request))
        .await
        .map_err(|error| engine_failure("query task", error))??;
    Ok(Json(response))
}

fn run_query(request: QueryRequest) -> Result<QueryResponse, (StatusCode, String)> {
    // One counter across every split the query touches: the total is what a deployment bills for this
    // one question, which is the number worth reporting.
    let reads = Arc::new(AtomicUsize::new(0));
    let mut searchers: Vec<SplitSearcher> = Vec::with_capacity(request.splits.len());
    for split in &request.splits {
        let reader = open_reader(&request.object_access, split, reads.clone())?;
        searchers.push(
            SplitSearcher::over_reader(reader)
                .map_err(|error| engine_failure("open split", error))?
                .excluding_documents(&split.exclude_document_ids),
        );
    }
    let hits = query_searchers(&searchers, &request.text, request.limit)
        .map_err(|error| engine_failure("query splits", error))?;
    Ok(QueryResponse {
        hits: hits
            .into_iter()
            .map(|hit| Hit {
                document_id: hit.document_id,
                chunk_id: hit.chunk_id,
                score: hit.score,
            })
            .collect(),
        ranged_reads: reads.load(std::sync::atomic::Ordering::Relaxed),
    })
}

// Removing a document from the keyword half is a CATALOG act, not an engine act. Splits are immutable,
// so nothing here can be edited: the app Worker stops the document's split from being enumerated and
// marks its passages superseded, the next query excludes them per split, and the next compaction
// repacks them out of the published bytes. Answering "done" is therefore correct rather than a stub —
// there is genuinely nothing for the engine to do, and a failure here would report a removal as broken
// when it has already happened.
async fn remove() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn compact(Json(request): Json<CompactRequest>) -> EngineResult<CompactedSplit> {
    let merged = tokio::task::spawn_blocking(move || run_compaction(request))
        .await
        .map_err(|error| engine_failure("compact task", error))??;
    Ok(Json(merged))
}

fn run_compaction(request: CompactRequest) -> Result<CompactedSplit, (StatusCode, String)> {
    let reads = Arc::new(AtomicUsize::new(0));
    let mut readers: Vec<Arc<dyn RangeReader>> = Vec::with_capacity(request.sources.len());
    let mut exclusions: Vec<String> = Vec::new();
    for source in &request.sources {
        readers.push(open_reader(&request.object_access, source, reads.clone())?);
        exclusions.extend(source.exclude_document_ids.iter().cloned());
    }
    let merged = merge_splits_over_readers(&readers, &exclusions)
        .map_err(|error| engine_failure("merge splits", error))?;
    let size_bytes = merged.bytes.len() as u64;
    put_object(&request.object_access, &request.object_key, merged.bytes)
        .map_err(|error| engine_failure("publish merged split", error))?;
    Ok(CompactedSplit {
        object_key: request.object_key,
        document_count: merged.document_count,
        size_bytes,
        schema_generation: SCHEMA_GENERATION,
        excluded_document_ids: merged.excluded,
    })
}

fn open_reader(
    access: &ObjectAccess,
    split: &SplitTarget,
    reads: Arc<AtomicUsize>,
) -> Result<Arc<dyn RangeReader>, (StatusCode, String)> {
    HttpRangeReader::open(access, &split.object_key, reads)
        .map(|reader| Arc::new(reader) as Arc<dyn RangeReader>)
        .map_err(|error| engine_failure("open split object", error))
}
