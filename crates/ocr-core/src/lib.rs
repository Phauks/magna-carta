//! The OCR engine: pixels in, facts out. No HTTP, no filesystem beyond loading its
//! own pinned models, no knowledge of PDFs or firms. The container that hosts this
//! owns every wire concern.

pub mod dictionary;
pub mod engine;
pub mod facts;

use image::RgbImage;

pub use facts::{PageFacts, Provenance, Quad, RecognizedPage, SkipReason, TextLine};

/// Engine failures. `code` is a stable, content-free label safe to log and to put
/// on the wire — it never carries a fragment of the document.
///
/// `DocumentUnreadable` and `DocumentRejected` are the caller's problem: the document
/// itself is permanently bad, and retrying with the same bytes will not help. Every
/// other variant is ours — a transient or environmental fault worth retrying.
#[derive(Debug)]
pub enum OcrError {
    ModelDictionaryMissing,
    ModelDictionaryUnreadable,
    ModelLoadFailed,
    InferenceFailed,
    /// The document could not be parsed, or its declared text layer could not be
    /// read back to check for existing text. Not retryable with the same bytes.
    DocumentUnreadable,
    /// The document was refused by the decompression-bomb guard before parsing.
    /// Not retryable with the same bytes.
    DocumentRejected,
}

impl OcrError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ModelDictionaryMissing => "model-dictionary-missing",
            Self::ModelDictionaryUnreadable => "model-dictionary-unreadable",
            Self::ModelLoadFailed => "model-load-failed",
            Self::InferenceFailed => "inference-failed",
            Self::DocumentUnreadable => "document-unreadable",
            Self::DocumentRejected => "document-rejected",
        }
    }
}

impl std::fmt::Display for OcrError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for OcrError {}

/// Recognize text in one rasterized page. The container depends on this trait, not
/// on the concrete engine, so its page-walking and wire logic are testable without
/// loading a 139 MB model.
pub trait Recognizer: Send + Sync {
    fn recognize(&self, image: &RgbImage) -> Result<RecognizedPage, OcrError>;
    /// Whole-page orientation, when a classifier is configured.
    fn page_orientation(&self, image: &RgbImage) -> Option<f32>;
    fn provenance(&self) -> Provenance;
}
