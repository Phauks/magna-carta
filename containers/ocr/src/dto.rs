//! The container's wire shape. Serde only -- these types byte-match the TypeScript
//! type the worker validates. Every string label is a `&'static str` literal: no
//! document content ever reaches the wire except the recognized text itself.

use ocr_core::{PageFacts, Provenance, Quad, SkipReason, TextLine};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadDto {
    pub points: [[f32; 2]; 4],
}

impl From<Quad> for QuadDto {
    fn from(quad: Quad) -> Self {
        Self {
            points: quad.points.map(|(x, y)| [x, y]),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLineDto {
    pub text: String,
    pub confidence: f32,
    pub quad: QuadDto,
    pub orientation_degrees: Option<f32>,
    pub word_quads: Vec<QuadDto>,
}

impl From<TextLine> for TextLineDto {
    fn from(line: TextLine) -> Self {
        Self {
            text: line.text,
            confidence: line.confidence,
            quad: line.quad.into(),
            orientation_degrees: line.orientation_degrees,
            word_quads: line.word_quads.into_iter().map(QuadDto::from).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub page_index: usize,
    pub lines: Vec<TextLineDto>,
    /// Regions detection found but recognition could not read. A page of unreadable
    /// text must not reach a caller looking like a page that had no text on it.
    pub undecoded_regions: usize,
    /// Present only when the page was not recognized, naming why.
    pub skipped: Option<&'static str>,
    pub orientation_degrees: Option<f32>,
}

/// The wire label for a skip reason. A `match` (rather than a constant label applied
/// to any `Some`) means a future `SkipReason` variant fails to compile here instead of
/// silently inheriting the wrong label.
fn skip_reason_label(reason: SkipReason) -> &'static str {
    match reason {
        SkipReason::AlreadyHasTextLayer => "already-has-text-layer",
    }
}

impl From<PageFacts> for PageDto {
    fn from(facts: PageFacts) -> Self {
        Self {
            page_index: facts.page_index,
            lines: facts.lines.into_iter().map(TextLineDto::from).collect(),
            undecoded_regions: facts.undecoded_regions,
            skipped: facts.skipped.map(skip_reason_label),
            orientation_degrees: facts.orientation_degrees,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceDto {
    pub engine_version: String,
    pub model_version: String,
    pub platform: String,
}

impl From<Provenance> for ProvenanceDto {
    fn from(provenance: Provenance) -> Self {
        Self {
            engine_version: provenance.engine_version,
            model_version: provenance.model_version,
            platform: provenance.platform,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResultDto {
    pub pages: Vec<PageDto>,
    /// How many pages the document has in all, which is more than `pages` holds when the
    /// request asked for one window of a long document.
    pub page_count: usize,
    pub provenance: ProvenanceDto,
}
