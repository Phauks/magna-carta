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
#[derive(Debug)]
pub enum OcrError {
    ModelDictionaryMissing,
    ModelDictionaryUnreadable,
    ModelLoadFailed,
    InferenceFailed,
}

impl OcrError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ModelDictionaryMissing => "model-dictionary-missing",
            Self::ModelDictionaryUnreadable => "model-dictionary-unreadable",
            Self::ModelLoadFailed => "model-load-failed",
            Self::InferenceFailed => "inference-failed",
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
