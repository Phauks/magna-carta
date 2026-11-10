//! `address-core` — the United States address autocomplete index, engine-side and port-free.
//!
//! A pure-Rust core over Tantivy that knows addresses and bytes and nothing about workers, buckets or
//! HTTP. It cleans OpenAddresses rows ([`cleaning`], [`openaddresses`]), builds one single-segment
//! index per census-region [`Partition`] and streams it out in `search-core`'s split format
//! ([`build`]), and answers typed text with addresses and groups of units ([`engine`]) over splits read
//! by range through `search-core`'s `SplitDirectory`, unchanged.
//!
//! The container in `containers/address` binds the range reader to object storage, holds the
//! partitions open across requests, and runs builds; everything it decides about the index lives here.

pub mod address;
pub mod build;
pub mod cleaning;
pub mod engine;
mod error;
pub mod openaddresses;
pub mod partition;
pub mod query;
mod schema;

pub use address::{format_label, natural_order, Address, Building, Offer};
pub use build::{build_partition_split, BuildOptions, BuiltPartition, PartitionBuilder};
pub use cleaning::{clean, duplicate_key, Deduplicator, SourceRow};
pub use engine::{
    AddressEngine, PartitionIndex, DEFAULT_LIMIT, HITS_PER_PARTITION, MAXIMUM_LIMIT, MAXIMUM_UNITS,
};
pub use error::AddressError;
pub use openaddresses::{parse_feature_line, state_of_source};
pub use partition::{is_region_code, Partition};
pub use query::{parse_query, ParsedQuery, MAXIMUM_QUERY_CHARACTERS, MAXIMUM_QUERY_WORDS};
pub use schema::{
    AddressSchema, ADDRESS_INDEX_GENERATION, MAXIMUM_PREFIX_CHARACTERS, MINIMUM_PREFIX_CHARACTERS,
};
