//! The crate's error type. Port-free, like the rest of `search-core`: it names failures in search
//! terms, never in a caller's or Cloudflare's terms. The Container adapter maps these onto the
//! `SearchIndexPort`'s `Dispatch` errors.

use std::fmt;

#[derive(Debug)]
pub enum SearchError {
    /// A split's bytes do not match the format (too short, footer length out of range, a file range
    /// past the end). Carries a static reason for the log; never echoes split bytes.
    MalformedSplit(&'static str),
    /// The split was built with a schema generation this build does not understand. A re-index against
    /// the current generation is the recovery, never a best-effort open of an incompatible layout.
    IncompatibleGeneration { split: u32, reader: u32 },
    /// A query string the parser could not read. Carries the parser's message.
    QueryParse(String),
    /// The underlying Tantivy engine failed.
    Tantivy(tantivy::TantivyError),
    /// Reading or writing the build scratch failed.
    Io(std::io::Error),
    /// The footer could not be encoded or decoded.
    Footer(serde_json::Error),
}

impl fmt::Display for SearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SearchError::MalformedSplit(why) => write!(f, "malformed split: {why}"),
            SearchError::IncompatibleGeneration { split, reader } => write!(
                f,
                "split schema generation {split} is not readable by generation {reader}; re-index"
            ),
            SearchError::QueryParse(message) => write!(f, "could not parse the query: {message}"),
            SearchError::Tantivy(error) => write!(f, "search engine error: {error}"),
            SearchError::Io(error) => write!(f, "index scratch i/o error: {error}"),
            SearchError::Footer(error) => write!(f, "split footer codec error: {error}"),
        }
    }
}

impl std::error::Error for SearchError {}

impl From<tantivy::TantivyError> for SearchError {
    fn from(error: tantivy::TantivyError) -> Self {
        SearchError::Tantivy(error)
    }
}

impl From<std::io::Error> for SearchError {
    fn from(error: std::io::Error) -> Self {
        SearchError::Io(error)
    }
}

impl From<serde_json::Error> for SearchError {
    fn from(error: serde_json::Error) -> Self {
        SearchError::Footer(error)
    }
}

impl From<tantivy::directory::error::OpenWriteError> for SearchError {
    fn from(error: tantivy::directory::error::OpenWriteError) -> Self {
        SearchError::Tantivy(error.into())
    }
}
