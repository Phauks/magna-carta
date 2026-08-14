//! The wire shapes of the four engine operations.
//!
//! These mirror `packages/search/src/port.ts` — the `SearchIndexPort` the app Worker calls through and
//! the adapter in `apps/worker/src/search/search-engine.ts` marshals. The field names are the port's,
//! in camelCase, so the two files can be read side by side; a field renamed on one side and not the
//! other fails deserialization here rather than silently arriving as a default.
//!
//! Nothing in this module carries firm content back out. A hit is the pointers needed to hydrate a
//! passage through the data-access layer — never its text, which the app Worker re-reads from storage
//! under its own authorization.

use serde::{Deserialize, Serialize};

use crate::object_client::ObjectAccess;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub chunk_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRequest {
    pub document_id: String,
    /// Where the built split is written. Derived by the caller from the document version, so a retried
    /// index overwrites its own object instead of orphaning one — which is why the engine is told the
    /// key rather than choosing it.
    pub object_key: String,
    pub passages: Vec<Passage>,
    pub object_access: ObjectAccess,
}

/// One split a query or a merge reads, and the document ids it must not return from THAT split. Per
/// split, never per query: the same document is legitimately live at a newer version in another split,
/// so excluding it everywhere would hide the current text along with the stale text.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitTarget {
    pub object_key: String,
    pub exclude_document_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub text: String,
    pub limit: usize,
    pub splits: Vec<SplitTarget>,
    pub object_access: ObjectAccess,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactRequest {
    pub sources: Vec<SplitTarget>,
    pub object_key: String,
    pub object_access: ObjectAccess,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedSplit {
    pub object_key: String,
    pub document_count: u64,
    pub size_bytes: u64,
    pub schema_generation: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompactedSplit {
    pub object_key: String,
    pub document_count: u64,
    pub size_bytes: u64,
    pub schema_generation: u32,
    /// What the merge actually dropped, out of what it was asked to drop. A compaction and a re-index
    /// can legitimately race, so a difference is reported rather than treated as a fault — but it is
    /// reported, so a pass that silently dropped nothing is visible.
    pub excluded_document_ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub document_id: String,
    pub chunk_id: String,
    pub score: f32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub hits: Vec<Hit>,
    /// Ranged reads this query issued across every split it touched. Each one is an object-store range
    /// GET in a deployment, so this is the query's transferred-operation count — the figure the
    /// benchmark reports, carried on the response so the deployed number and the measured number can
    /// actually be compared rather than assumed equal.
    pub ranged_reads: usize,
}
