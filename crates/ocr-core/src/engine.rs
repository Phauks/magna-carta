//! The concrete engine: PaddleOCR PP-OCR detection and recognition models, run as
//! ONNX through `oar-ocr`. Sessions are pinned single-threaded and sequential so a
//! given container reproduces its own output exactly -- which is the property that
//! matters when a production has to be re-run and must come out the same.

use std::path::PathBuf;
use std::sync::Arc;

use image::RgbImage;
use oar_ocr::core::config::{OrtGraphOptimizationLevel, OrtSessionConfig};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};

use crate::dictionary::character_dictionary_from_inference_yaml;
use crate::facts::{Provenance, Quad, TextLine};
use crate::{OcrError, Recognizer};

/// The pinned, baked-in model artifacts. Each model is an `inference.onnx` beside the
/// `inference.yml` it was published with.
#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub detection_onnx: PathBuf,
    pub recognition_onnx: PathBuf,
    pub recognition_yaml: PathBuf,
    /// Identifies the exact artifact set, e.g. `PP-OCRv6_medium@6132380`.
    pub model_version: String,
}

#[derive(Debug)]
pub struct PaddleRecognizer {
    pipeline: Arc<OAROCR>,
    model_version: String,
}

impl PaddleRecognizer {
    pub fn load(models: ModelPaths) -> Result<Self, OcrError> {
        let yaml = std::fs::read_to_string(&models.recognition_yaml)
            .map_err(|_| OcrError::ModelDictionaryUnreadable)?;
        let dictionary = character_dictionary_from_inference_yaml(&yaml)?;

        // Single-threaded and sequential: ONNX Runtime's thread count and execution mode
        // are the run-to-run sources of divergence on one machine, and a re-run of a
        // production must reproduce its own earlier output exactly.
        let session = OrtSessionConfig::default()
            .with_intra_threads(1)
            .with_inter_threads(1)
            .with_parallel_execution(false)
            .with_optimization_level(OrtGraphOptimizationLevel::Level3);

        let pipeline = OAROCRBuilder::new(
            models.detection_onnx.clone(),
            models.recognition_onnx.clone(),
            // Ignored: character_dict_content takes precedence, and the dictionary
            // travels with the model rather than as a separate file.
            models.recognition_yaml.clone(),
        )
        .character_dict_content(dictionary)
        .ort_session(session)
        .return_word_box(true)
        .build()
        .map_err(|_| OcrError::ModelLoadFailed)?;

        Ok(Self {
            pipeline: Arc::new(pipeline),
            model_version: models.model_version,
        })
    }
}

fn to_quad(bounding_box: &oar_ocr::processors::BoundingBox) -> Quad {
    // Detection returns a four-point polygon. If a future model returns more points,
    // fall back to the axis-aligned bounds rather than silently dropping vertices.
    let points = &bounding_box.points;
    if points.len() == 4 {
        let corner = |index: usize| (points[index].x, points[index].y);
        Quad {
            points: [corner(0), corner(1), corner(2), corner(3)],
        }
    } else {
        let (x0, y0, x1, y1) = bounding_box.aabb();
        Quad {
            points: [(x0, y0), (x1, y0), (x1, y1), (x0, y1)],
        }
    }
}

impl Recognizer for PaddleRecognizer {
    fn recognize(&self, image: &RgbImage) -> Result<Vec<TextLine>, OcrError> {
        let results = self
            .pipeline
            .predict(vec![image.clone()])
            .map_err(|_| OcrError::InferenceFailed)?;
        let Some(page) = results.into_iter().next() else {
            return Ok(Vec::new());
        };

        Ok(page
            .text_regions
            .iter()
            .filter_map(|region| {
                let (text, confidence) = region.text_with_confidence()?;
                Some(TextLine {
                    text: text.to_string(),
                    confidence,
                    quad: to_quad(&region.bounding_box),
                    orientation_degrees: region.orientation_angle,
                    word_quads: region
                        .word_boxes
                        .as_ref()
                        .map(|boxes| boxes.iter().map(to_quad).collect())
                        .unwrap_or_default(),
                })
            })
            .collect())
    }

    fn page_orientation(&self, _image: &RgbImage) -> Option<f32> {
        // The document-orientation classifier is a separate model, not yet baked in.
        // Reporting None is honest; reporting 0.0 would claim a measurement never made.
        None
    }

    fn provenance(&self) -> Provenance {
        Provenance::new(self.model_version.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The models are large and are baked into the container image, not committed. The
    /// tests that need them are `#[ignore]`d: `cargo test` reports them as ignored rather
    /// than as passed, so a green suite can never mean "the models were never present".
    /// The container CI job runs them with `--ignored` and `MAGNA_CARTA_OCR_MODELS` set.
    fn models() -> ModelPaths {
        let root = PathBuf::from(
            std::env::var("MAGNA_CARTA_OCR_MODELS")
                .expect("MAGNA_CARTA_OCR_MODELS must point at the model directory"),
        );
        ModelPaths {
            detection_onnx: root.join("detection/inference.onnx"),
            recognition_onnx: root.join("recognition/inference.onnx"),
            recognition_yaml: root.join("recognition/inference.yml"),
            model_version: "test".to_string(),
        }
    }

    #[test]
    fn a_missing_model_file_fails_loudly() {
        let models = ModelPaths {
            detection_onnx: PathBuf::from("/nonexistent/detection.onnx"),
            recognition_onnx: PathBuf::from("/nonexistent/recognition.onnx"),
            recognition_yaml: PathBuf::from("/nonexistent/inference.yml"),
            model_version: "absent".to_string(),
        };
        let error = PaddleRecognizer::load(models).unwrap_err();
        // The dictionary is read first, so an entirely absent model set reports that.
        assert_eq!(error.code(), "model-dictionary-unreadable");
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn provenance_reports_the_configured_model_version() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        assert_eq!(engine.provenance().model_version, "test");
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn recognizes_rendered_text() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        // A white page with the word INVOICE drawn in black, 300 DPI-ish scale.
        let image = crate::engine::tests::render_word("INVOICE");
        let lines = engine.recognize(&image).unwrap();
        let joined: String = lines.iter().map(|line| line.text.as_str()).collect();
        assert!(joined.to_uppercase().contains("INVOICE"), "got {joined:?}");
        assert!(lines[0].confidence > 0.5);
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn the_same_image_recognizes_identically_twice() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        let image = crate::engine::tests::render_word("INVOICE");
        assert_eq!(
            engine.recognize(&image).unwrap(),
            engine.recognize(&image).unwrap()
        );
    }

    /// Draw `word` in black on white using a blocky 5x7 bitmap font scaled up. Keeps the
    /// test self-contained: no font file, no fixture image, no network.
    pub(super) fn render_word(word: &str) -> RgbImage {
        use image::Rgb;
        // 5x7 glyphs for the letters used by the tests, row-major, 1 = ink.
        const GLYPHS: &[(char, [u8; 7])] = &[
            (
                'I',
                [
                    0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
                ],
            ),
            (
                'N',
                [
                    0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
                ],
            ),
            (
                'V',
                [
                    0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100,
                ],
            ),
            (
                'O',
                [
                    0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
                ],
            ),
            (
                'C',
                [
                    0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
                ],
            ),
            (
                'E',
                [
                    0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
                ],
            ),
        ];
        let scale = 12u32;
        let advance = 6u32 * scale;
        let mut image = RgbImage::from_pixel(
            advance * word.len() as u32 + 2 * advance,
            7 * scale + 2 * advance,
            Rgb([255, 255, 255]),
        );
        for (index, character) in word.chars().enumerate() {
            let Some((_, rows)) = GLYPHS.iter().find(|(glyph, _)| *glyph == character) else {
                continue;
            };
            for (row_index, row) in rows.iter().enumerate() {
                for column in 0..5u32 {
                    if row & (1 << (4 - column)) != 0 {
                        let x0 = advance + index as u32 * advance + column * scale;
                        let y0 = advance + row_index as u32 * scale;
                        for x in x0..x0 + scale {
                            for y in y0..y0 + scale {
                                image.put_pixel(x, y, Rgb([0, 0, 0]));
                            }
                        }
                    }
                }
            }
        }
        image
    }
}
