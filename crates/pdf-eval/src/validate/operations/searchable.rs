//! Writing an invisible OCR text layer as a validation operation. The invariant is
//! that the writer is strictly additive: after it runs, the recognized text is
//! extractable from the page, and nothing a human eye can see has changed. Robustness
//! comes from the runner, which isolates `run` under catch_unwind and a timeout.

// Like the OCR operation, this needs a loaded recognition model to drive it, so it is
// built and tested ahead of being wired into the corpus runner.
#![allow(dead_code)]

use ocr_core::Recognizer;
use pdf_core::{PageTextLayer, TextRun};

use crate::validate::operation::{OperationVerdict, Outcome, Safety, ValidationOperation};

/// Matches the recognition container's rasterization density, so a page behaves here as
/// it would in production.
const RENDER_DPI: f32 = 300.0;

pub struct SearchableOperation {
    recognizer: Box<dyn Recognizer>,
}

impl SearchableOperation {
    pub fn new(recognizer: Box<dyn Recognizer>) -> Self {
        Self { recognizer }
    }
}

impl ValidationOperation for SearchableOperation {
    fn name(&self) -> &str {
        "searchable"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        let Ok(document) = pdf_core::Document::load(bytes.to_vec()) else {
            return error("load failed");
        };
        let Ok(existing) = document.page_text_rects(0) else {
            return error("text observation failed");
        };
        // A page that already carries text needs no layer; writing one is not the case
        // this operation exists to measure.
        if !existing.is_empty() {
            return skipped("page already has a text layer");
        }
        let Ok(before_visible) = document.page_visible_text_coverage(0) else {
            return error("visible-coverage read failed");
        };
        let Ok(size) = document.page_size(0) else {
            return error("page size read failed");
        };
        let Ok(rendered) = document.render_page(0, RENDER_DPI, false) else {
            return error("render failed");
        };
        let Some(image) = rendered.to_rgb_image() else {
            return error("raster conversion failed");
        };
        let recognized = match self.recognizer.recognize(&image) {
            Ok(recognized) => recognized,
            Err(engine_error) => return error(engine_error.code()),
        };

        // Map each recognized line from render-pixel space into PDF user space (the origin
        // flips from top-left to bottom-left), the frame the writer places text in.
        let scale = 72.0 / RENDER_DPI;
        let runs: Vec<TextRun> = recognized
            .lines
            .iter()
            .filter(|line| !line.text.trim().is_empty())
            .map(|line| TextRun {
                text: line.text.clone(),
                quad: line
                    .quad
                    .points
                    .map(|(x, y)| (x * scale, size.height_pt - y * scale)),
            })
            .collect();
        if runs.is_empty() {
            return skipped("recognition produced no text to write");
        }
        // Whitespace-free, because the observer that reads the result drops whitespace
        // glyphs — comparing against the same shape keeps the check honest.
        let expected: String = runs
            .iter()
            .flat_map(|run| run.text.split_whitespace())
            .collect();

        let layer = PageTextLayer {
            page_index: 0,
            runs,
        };
        let Ok(output) = pdf_core::write_searchable_text_layer(bytes.to_vec(), &[layer]) else {
            return error("write failed");
        };

        // Re-read the written document and check both halves of the invariant.
        let Ok(reread) = pdf_core::Document::load(output) else {
            return error("written document did not reload");
        };
        let Ok(after_visible) = reread.page_visible_text_coverage(0) else {
            return error("visible-coverage recheck failed");
        };
        let Ok(glyphs) = reread.page_text_glyphs(0) else {
            return error("written-text observation failed");
        };
        let extracted: String = glyphs.iter().map(|glyph| glyph.text.as_str()).collect();

        // Extractable: the recognized text is now present in the page's text layer.
        if !extracted.contains(&expected) {
            return OperationVerdict {
                outcome: Outcome::Error {
                    detail: "written text is not extractable".to_string(),
                },
                safety: Safety::NotApplicable,
            };
        }

        // Additive: the layer added nothing a human eye can see.
        let visible_delta = (after_visible - before_visible).abs();
        let safety = if visible_delta < 0.001 {
            Safety::Upheld
        } else {
            Safety::Violated {
                detail: format!("visible text coverage changed by {visible_delta}"),
            }
        };
        OperationVerdict {
            outcome: Outcome::Success {
                variant: format!("{} run(s) written", recognized.lines.len()),
            },
            safety,
        }
    }
}

fn error(detail: impl Into<String>) -> OperationVerdict {
    OperationVerdict {
        outcome: Outcome::Error {
            detail: detail.into(),
        },
        safety: Safety::NotApplicable,
    }
}

fn skipped(reason: impl Into<String>) -> OperationVerdict {
    OperationVerdict {
        outcome: Outcome::Skipped {
            reason: reason.into(),
        },
        safety: Safety::NotApplicable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;
    use ocr_core::{OcrError, Provenance, Quad, RecognizedPage, TextLine};

    /// Returns a fixed recognized page (or a fixed error) without loading a model, so
    /// these tests run in milliseconds. Mirrors the stub in `containers/ocr`.
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

    /// A valid, lopdf-writable single-page PDF with no text layer. The stub recognizer
    /// ignores the rendered pixels, so a blank page is a faithful stand-in for a scan the
    /// writer must add a layer to. (The committed `scanned.pdf` fixture is a hayro-only
    /// minimal file the lopdf writer cannot round-trip.)
    fn scanned_page() -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![]),
            "Count" => Object::Integer(0),
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let content_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"".to_vec())));
        let page_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]),
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Dictionary(dictionary! {}),
        });
        if let Ok(Object::Dictionary(pages)) = doc.get_object_mut(pages_id) {
            pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
            pages.set("Count", Object::Integer(1));
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn a_scanned_page_becomes_searchable_without_changing_what_is_visible() {
        let bytes = scanned_page();
        let verdict = SearchableOperation::new(stub_recognizer()).run(&bytes);
        assert!(
            matches!(verdict.outcome, Outcome::Success { .. }),
            "got {:?}",
            verdict.outcome
        );
        // Additive: nothing a human eye can see changed.
        assert_eq!(verdict.safety, Safety::Upheld);
    }

    #[test]
    fn a_page_that_already_has_text_is_skipped() {
        let bytes = std::fs::read("tests/fixtures/hello.pdf").unwrap();
        let verdict = SearchableOperation::new(stub_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Skipped { .. }));
    }

    #[test]
    fn an_engine_error_is_reported_as_an_error_not_an_empty_success() {
        let bytes = std::fs::read("tests/fixtures/scanned.pdf").unwrap();
        let verdict = SearchableOperation::new(failing_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Error { .. }));
    }
}
