//! What the engine reports. Raw facts only: no judgment about whether a page is
//! "good", no derived text layer, no document-level conclusion.

use serde::Serialize;

/// A detected quadrilateral. Detection returns a four-point polygon, not an
/// axis-aligned box: text on a page fed crooked through a scanner is a rotated
/// quad, and squaring it off before the caller sees it loses the skew.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Quad {
    pub points: [(f32, f32); 4],
}

impl Quad {
    /// The axis-aligned bounds, as `(x_min, y_min, x_max, y_max)`.
    pub fn bounds(&self) -> (f32, f32, f32, f32) {
        let xs = self.points.map(|p| p.0);
        let ys = self.points.map(|p| p.1);
        (
            xs.iter().copied().fold(f32::INFINITY, f32::min),
            ys.iter().copied().fold(f32::INFINITY, f32::min),
            xs.iter().copied().fold(f32::NEG_INFINITY, f32::max),
            ys.iter().copied().fold(f32::NEG_INFINITY, f32::max),
        )
    }
}

/// One recognized line of text.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextLine {
    pub text: String,
    pub confidence: f32,
    pub quad: Quad,
    /// Per-line orientation in degrees, when the text-line orientation classifier ran.
    pub orientation_degrees: Option<f32>,
    /// Per-word quads, when word-box reporting is enabled.
    pub word_quads: Vec<Quad>,
}

/// One page's recognition output: the lines that decoded, and a count of the
/// regions that did not. Detection can find a text region that recognition then
/// fails to read; reporting only the decoded lines would make a page of unreadable
/// text indistinguishable from a blank one.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecognizedPage {
    pub lines: Vec<TextLine>,
    /// Regions detection found but recognition could not decode.
    pub undecoded_regions: usize,
}

/// Why a page was not recognized. A skipped page is never reported as an empty
/// page: the caller cannot otherwise tell "no words here" from "we gave up".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    /// The page already carries a real, visible text layer.
    AlreadyHasTextLayer,
}

/// Which code, which model, and which machine produced a result. Three separable
/// fields: an engine change, a model change, and an architecture change each mean
/// something different, and collapsing them makes a stale result indistinguishable
/// from a fresh one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Provenance {
    pub engine_version: String,
    pub model_version: String,
    pub platform: String,
}

impl Provenance {
    pub fn new(model_version: impl Into<String>) -> Self {
        Self {
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            model_version: model_version.into(),
            platform: format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS),
        }
    }
}

/// One page's worth of facts: either recognized lines, or a reason it was skipped.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageFacts {
    pub page_index: usize,
    pub lines: Vec<TextLine>,
    pub skipped: Option<SkipReason>,
    /// Whole-page orientation in degrees, when the document orientation classifier ran.
    pub orientation_degrees: Option<f32>,
    /// Regions detection found but recognition could not decode.
    pub undecoded_regions: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quad_bounds_cover_a_rotated_quad() {
        let quad = Quad {
            points: [(10.0, 0.0), (20.0, 10.0), (10.0, 20.0), (0.0, 10.0)],
        };
        assert_eq!(quad.bounds(), (0.0, 0.0, 20.0, 20.0));
    }

    #[test]
    fn a_page_of_undecoded_regions_is_not_the_same_as_a_blank_page() {
        let blank = RecognizedPage {
            lines: Vec::new(),
            undecoded_regions: 0,
        };
        let unreadable = RecognizedPage {
            lines: Vec::new(),
            undecoded_regions: 20,
        };
        // Both report zero decoded lines, but only one of them means "no text here".
        assert_eq!(blank.lines, unreadable.lines);
        assert_ne!(
            blank, unreadable,
            "a page where detection found regions recognition could not read must not equal a genuinely blank page"
        );
        assert_eq!(blank.undecoded_regions, 0);
        assert_eq!(unreadable.undecoded_regions, 20);
    }

    #[test]
    fn provenance_carries_three_independent_fields() {
        let provenance = Provenance::new("PP-OCRv6_medium@abc123");
        assert_eq!(provenance.engine_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(provenance.model_version, "PP-OCRv6_medium@abc123");
        assert!(provenance.platform.contains(std::env::consts::ARCH));
        // No field may be derived from another.
        assert_ne!(provenance.engine_version, provenance.model_version);
    }
}
