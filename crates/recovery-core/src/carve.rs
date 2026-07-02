//! The carving fallback pillar: format-agnostic extraction of embedded known-type
//! files from any blob. Scans a header/footer signature table, bounds each
//! candidate, validates it, and returns the found files with an honest,
//! never-complete loss manifest. A separate entry point — NOT part of the
//! detect()-keyed repair/diagnose dispatch.

mod signatures;

pub use signatures::{Signature, SIGNATURES};
