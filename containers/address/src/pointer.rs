//! The published-index pointer and the attribution manifest, and the keys they live under.
//!
//! Writing the pointer is the publish: a query container reads it on wake and every ten minutes and
//! reopens when its build id changes. Everything it names is written before it.

use std::collections::BTreeMap;

use address_core::Partition;
use serde::{Deserialize, Serialize};

/// The country this engine indexes. Keys are under it, so another country's index is a sibling.
pub const COUNTRY_PREFIX: &str = "us";

pub fn pointer_key() -> String {
    format!("{COUNTRY_PREFIX}/current.json")
}

pub fn split_key(build: &str, partition: Partition) -> String {
    format!("{COUNTRY_PREFIX}/{build}/{}.split", partition.name())
}

pub fn attribution_key(build: &str) -> String {
    format!("{COUNTRY_PREFIX}/{build}/attribution.json")
}

/// `us/current.json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pointer {
    pub build: String,
    pub built_at: String,
    pub document_count: u64,
    /// Partition name -> split key.
    pub partitions: BTreeMap<String, String>,
    pub attribution: String,
}

/// One source the build included.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IncludedSource {
    pub source: String,
    pub layer: String,
    pub name: String,
    pub job: u64,
}

/// One source the licence policy kept out, with why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExcludedSource {
    pub source: String,
    pub name: String,
    pub reason: String,
}

/// `us/<build>/attribution.json`: every source in the build, so the platform can credit them, and the
/// build before this one, so the build after it knows which one to delete.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributionManifest {
    pub build: String,
    pub built_at: String,
    #[serde(default)]
    pub previous_build: Option<String>,
    pub sources: Vec<IncludedSource>,
    #[serde(default)]
    pub excluded: Vec<ExcludedSource>,
}
