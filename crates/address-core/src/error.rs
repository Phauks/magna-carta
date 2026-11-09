//! The crate's error type. Every message is engine vocabulary: none carries a query, an address, or an
//! object key, so a caller may log or return one without redacting it first.

use std::fmt;

use search_core::SearchError;

#[derive(Debug)]
pub enum AddressError {
    /// The split could not be read as a split (footer, generation, file table).
    Split(SearchError),
    /// The split opened but is not an address partition, or not one this build understands.
    IncompatibleIndex(&'static str),
    /// The search engine failed while building or answering.
    Engine(tantivy::TantivyError),
    /// Reading or writing build scratch, or the output stream, failed.
    Io(std::io::Error),
    /// The split footer could not be encoded.
    Footer(serde_json::Error),
    /// A worker thread fetching rows or searching a partition stopped without an answer.
    WorkerStopped,
}

impl fmt::Display for AddressError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AddressError::Split(error) => write!(formatter, "address split unreadable: {error}"),
            AddressError::IncompatibleIndex(why) => {
                write!(formatter, "not a readable address index: {why}")
            }
            AddressError::Engine(error) => write!(formatter, "address engine error: {error}"),
            AddressError::Io(error) => write!(formatter, "address index i/o error: {error}"),
            AddressError::Footer(error) => write!(formatter, "address split footer error: {error}"),
            AddressError::WorkerStopped => write!(formatter, "an address worker thread stopped"),
        }
    }
}

impl std::error::Error for AddressError {}

impl From<SearchError> for AddressError {
    fn from(error: SearchError) -> Self {
        AddressError::Split(error)
    }
}

impl From<tantivy::TantivyError> for AddressError {
    fn from(error: tantivy::TantivyError) -> Self {
        AddressError::Engine(error)
    }
}

impl From<std::io::Error> for AddressError {
    fn from(error: std::io::Error) -> Self {
        AddressError::Io(error)
    }
}

impl From<serde_json::Error> for AddressError {
    fn from(error: serde_json::Error) -> Self {
        AddressError::Footer(error)
    }
}

impl From<tantivy::directory::error::OpenDirectoryError> for AddressError {
    fn from(error: tantivy::directory::error::OpenDirectoryError) -> Self {
        AddressError::Engine(error.into())
    }
}
