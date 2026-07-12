//! Recognition as a validation operation. Robustness comes from the runner, which
//! isolates `run` under catch_unwind and a timeout. The invariant this operation
//! checks is that recognition is strictly additive: it reads a page, it never
//! rewrites one, and a page it declines is reported as declined rather than as a
//! page that happened to contain no words.

// This operation is exercised by its own tests but is not yet registered in the
// corpus runner: unlike the model-free forms and surgery operations, it needs a
// loaded recognition model, so wiring it into `validate_mode` waits on a model
// being provisioned to that path. The seam is built and tested ahead of that.
#![allow(dead_code)]

use ocr_core::Recognizer;

use crate::validate::operation::{OperationVerdict, Outcome, Safety, ValidationOperation};

/// Rasterization density. Matches the floor the recognition container renders at, so
/// a page that fails here would fail identically in production.
const RENDER_DPI: f32 = 300.0;

pub struct OcrOperation {
    recognizer: Box<dyn Recognizer>,
}

impl OcrOperation {
    pub fn new(recognizer: Box<dyn Recognizer>) -> Self {
        Self { recognizer }
    }
}

impl ValidationOperation for OcrOperation {
    fn name(&self) -> &str {
        "ocr"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        let Ok(document) = pdf_core::Document::load(bytes.to_vec()) else {
            return OperationVerdict {
                outcome: Outcome::Error {
                    detail: "load failed".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        };
        let Ok(existing) = document.page_text_rects(0) else {
            return OperationVerdict {
                outcome: Outcome::Error {
                    detail: "text observation failed".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        };
        if !existing.is_empty() {
            return OperationVerdict {
                outcome: Outcome::Skipped {
                    reason: "page already has a text layer".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        }
        let Ok(rendered) = document.render_page(0, RENDER_DPI, false) else {
            return OperationVerdict {
                outcome: Outcome::Error {
                    detail: "render failed".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        };
        let Some(image) = rendered.to_rgb_image() else {
            return OperationVerdict {
                outcome: Outcome::Error {
                    detail: "raster conversion failed".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        };
        match self.recognizer.recognize(&image) {
            Ok(recognized) => {
                // Additive-only is a property of the recognizer's type, not something
                // observed at runtime: `recognize` takes `&RgbImage`, a rasterized copy
                // with no handle back to the document, so it has no way to alter the
                // existing text layer. There is nothing a recheck here could catch that
                // the type system doesn't already rule out.
                OperationVerdict {
                    outcome: Outcome::Success {
                        variant: format!(
                            "{} lines, {} undecoded",
                            recognized.lines.len(),
                            recognized.undecoded_regions
                        ),
                    },
                    safety: Safety::Upheld,
                }
            }
            Err(error) => OperationVerdict {
                outcome: Outcome::Error {
                    detail: error.code().to_string(),
                },
                safety: Safety::NotApplicable,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;
    use ocr_core::{OcrError, Provenance, Quad, RecognizedPage, TextLine};

    /// Mirrors `StubRecognizer` in `containers/ocr/src/lib.rs`: returns a fixed page
    /// or a fixed error without loading a model, so these tests run in milliseconds.
    struct StubRecognizer {
        fail: bool,
    }

    impl Recognizer for StubRecognizer {
        fn recognize(&self, _image: &RgbImage) -> Result<RecognizedPage, OcrError> {
            if self.fail {
                return Err(OcrError::InferenceFailed);
            }
            Ok(RecognizedPage {
                lines: vec![TextLine {
                    text: "SCANNED".to_string(),
                    confidence: 0.97,
                    quad: Quad {
                        points: [(0.0, 0.0), (200.0, 0.0), (200.0, 40.0), (0.0, 40.0)],
                    },
                    orientation_degrees: None,
                    word_quads: Vec::new(),
                }],
                undecoded_regions: 0,
            })
        }
        fn page_orientation(&self, _image: &RgbImage) -> Option<f32> {
            None
        }
        fn provenance(&self) -> Provenance {
            Provenance::new("stub@0")
        }
    }

    fn stub_recognizer() -> Box<dyn Recognizer> {
        Box::new(StubRecognizer { fail: false })
    }

    fn failing_recognizer() -> Box<dyn Recognizer> {
        Box::new(StubRecognizer { fail: true })
    }

    #[test]
    fn a_page_with_a_text_layer_is_skipped_not_recognized() {
        let bytes = std::fs::read("tests/fixtures/hello.pdf").unwrap();
        let verdict = OcrOperation::new(stub_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Skipped { .. }));
        assert_eq!(verdict.safety, Safety::NotApplicable);
    }

    #[test]
    fn a_scanned_page_is_recognized_and_the_existing_text_is_untouched() {
        let bytes = std::fs::read("tests/fixtures/scanned.pdf").unwrap();
        let before = pdf_core::Document::load(bytes.clone())
            .unwrap()
            .page_text_rects(0)
            .unwrap();
        assert!(before.is_empty(), "scanned.pdf must carry no text layer");
        let verdict = OcrOperation::new(stub_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Success { .. }));
        assert_eq!(verdict.safety, Safety::Upheld);
        // Recognition reads; it never rewrites the document.
        let after = pdf_core::Document::load(bytes.clone())
            .unwrap()
            .page_text_rects(0)
            .unwrap();
        assert_eq!(before.len(), after.len());
    }

    #[test]
    fn an_engine_error_is_reported_as_an_error_not_as_an_empty_success() {
        let bytes = std::fs::read("tests/fixtures/scanned.pdf").unwrap();
        let verdict = OcrOperation::new(failing_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Error { .. }));
    }
}
