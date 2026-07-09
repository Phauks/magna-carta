//! The OCR container's HTTP surface: one POST route that takes an image or a PDF and
//! returns per-page raw facts. The engine stays pure; every wire concern lives here.
//! The standard `/ready` probe and body cap come from `engine_host::host::ready_app`.

pub mod dto;
pub mod pages;

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};

use ocr_core::{OcrError, PageFacts, Recognizer, SkipReason};

use dto::{OcrResultDto, PageDto};

#[derive(Clone)]
pub struct AppState {
    pub recognizer: Arc<dyn Recognizer>,
}

/// Recognize an image or every scanned page of a PDF.
async fn ocr(State(state): State<AppState>, body: Bytes) -> Response {
    if body.is_empty() {
        return error(StatusCode::UNPROCESSABLE_ENTITY, "empty-body");
    }
    let result = if body.starts_with(b"%PDF") {
        recognize_pdf(&state, &body)
    } else {
        recognize_image(&state, &body)
    };
    match result {
        Ok(pages) => (
            StatusCode::OK,
            Json(OcrResultDto {
                pages: pages.into_iter().map(PageDto::from).collect(),
                provenance: state.recognizer.provenance().into(),
            }),
        )
            .into_response(),
        // An inference fault is retryable and must never look like a page with no words.
        Err(OcrError::InferenceFailed) => {
            error(StatusCode::SERVICE_UNAVAILABLE, "inference-failed")
        }
        Err(other) => error(StatusCode::UNPROCESSABLE_ENTITY, other.code()),
    }
}

fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(serde_json::json!({ "code": code }))).into_response()
}

fn recognize_image(state: &AppState, bytes: &[u8]) -> Result<Vec<PageFacts>, OcrError> {
    // Decode under explicit limits: an image is untrusted input, and a decompression
    // bomb must be refused rather than allocated.
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| OcrError::InferenceFailed)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| OcrError::InferenceFailed)?
        .to_rgb8();

    let page = state.recognizer.recognize(&image)?;
    Ok(vec![PageFacts {
        page_index: 0,
        lines: page.lines,
        undecoded_regions: page.undecoded_regions,
        skipped: None,
        orientation_degrees: state.recognizer.page_orientation(&image),
    }])
}

fn recognize_pdf(state: &AppState, bytes: &[u8]) -> Result<Vec<PageFacts>, OcrError> {
    // `Document::load` takes ownership of the buffer (it feeds the bomb guard before the
    // parser touches it), so the borrowed request body is copied once here.
    let document =
        pdf_core::Document::load(bytes.to_vec()).map_err(|_| OcrError::InferenceFailed)?;
    let mut pages = Vec::new();
    for page_index in 0..document.page_count() {
        // A page that already carries visible glyphs already has a text layer. Skipping
        // it is the difference between recognizing a whole production and recognizing
        // the handful of scanned pages inside it.
        let existing = document.page_text_rects(page_index).unwrap_or_default();
        if !existing.is_empty() {
            pages.push(PageFacts {
                page_index,
                lines: Vec::new(),
                undecoded_regions: 0,
                skipped: Some(SkipReason::AlreadyHasTextLayer),
                orientation_degrees: None,
            });
            continue;
        }
        let rendered = document
            .render_page(page_index, pages::RENDER_DPI, false)
            .map_err(|_| OcrError::InferenceFailed)?;
        // Composite over white rather than discarding alpha: a page with no background
        // content is fully transparent, and dropping alpha would hand the engine a black page.
        let image = rendered.to_rgb_image().ok_or(OcrError::InferenceFailed)?;
        let page_height_points = document
            .page_size(page_index)
            .map_err(|_| OcrError::InferenceFailed)?
            .height_pt;

        let recognized = state.recognizer.recognize(&image)?;
        let lines = recognized
            .lines
            .into_iter()
            .map(|mut line| {
                line.quad = pages::to_user_space(line.quad, page_height_points);
                line.word_quads = line
                    .word_quads
                    .into_iter()
                    .map(|quad| pages::to_user_space(quad, page_height_points))
                    .collect();
                line
            })
            .collect();
        pages.push(PageFacts {
            page_index,
            lines,
            // Detection found these regions; recognition could not read them. Carrying the
            // count is what stops a page of unreadable text looking like a blank page.
            undecoded_regions: recognized.undecoded_regions,
            skipped: None,
            orientation_degrees: state.recognizer.page_orientation(&image),
        });
    }
    Ok(pages)
}

/// The engine's work routes. Compose with `engine_host::host::ready_app` and
/// `with_panic_net` for the full container service.
pub fn router(state: AppState) -> Router {
    Router::new().route("/ocr", post(ocr)).with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;
    use ocr_core::{Provenance, Quad, RecognizedPage, TextLine};

    /// A recognizer that returns one fixed line, or fails, without loading a model.
    /// The container's page walking and wire mapping are testable in milliseconds.
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
                    text: "INVOICE".to_string(),
                    confidence: 0.99,
                    quad: Quad {
                        points: [(0.0, 0.0), (300.0, 0.0), (300.0, 60.0), (0.0, 60.0)],
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

    async fn spawn(fail: bool) -> String {
        let state = AppState {
            recognizer: Arc::new(StubRecognizer { fail }),
        };
        let app = engine_host::host::ready_app(router(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn png_bytes() -> Vec<u8> {
        let image = RgbImage::from_pixel(64, 32, image::Rgb([255, 255, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    async fn post(base: &str, body: Vec<u8>) -> (reqwest::StatusCode, serde_json::Value) {
        let response = reqwest::Client::new()
            .post(format!("{base}/ocr"))
            .body(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        (status, response.json().await.unwrap())
    }

    #[tokio::test]
    async fn ready_probe_returns_ok() {
        let base = spawn(false).await;
        let body = reqwest::get(format!("{base}/ready"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "ok");
    }

    #[tokio::test]
    async fn an_image_returns_one_page_of_lines_with_provenance() {
        let base = spawn(false).await;
        let (status, json) = post(&base, png_bytes()).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["pages"][0]["lines"][0]["text"], "INVOICE");
        assert_eq!(json["pages"][0]["pageIndex"], 0);
        assert_eq!(json["provenance"]["modelVersion"], "stub@0");
        // Three separable provenance fields, always present.
        assert!(json["provenance"]["engineVersion"].is_string());
        assert!(json["provenance"]["platform"].is_string());
    }

    #[tokio::test]
    async fn a_page_reports_its_undecoded_region_count_on_the_wire() {
        let base = spawn(false).await;
        let (_, json) = post(&base, png_bytes()).await;
        // A caller must be able to tell a page with no text from a page whose text could
        // not be read. The count travels; it is not an internal detail.
        assert_eq!(json["pages"][0]["undecodedRegions"], 0);
    }

    #[tokio::test]
    async fn an_inference_fault_is_a_retryable_503_not_an_empty_page() {
        let base = spawn(true).await;
        let (status, json) = post(&base, png_bytes()).await;
        assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(json["code"], "inference-failed");
        assert!(
            json.get("pages").is_none(),
            "a fault must not present as pages: {json}"
        );
    }

    #[tokio::test]
    async fn an_empty_body_is_rejected() {
        let base = spawn(false).await;
        let (status, json) = post(&base, Vec::new()).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json["code"], "empty-body");
    }

    #[tokio::test]
    async fn a_pdf_page_that_already_has_text_is_skipped_with_a_reason() {
        let base = spawn(false).await;
        // A minimal one-page PDF carrying a real text layer.
        let pdf = std::fs::read("../../crates/pdf-core/tests/fixtures/hello.pdf")
            .expect("hello.pdf fixture");
        let (status, json) = post(&base, pdf).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["pages"][0]["skipped"], "already-has-text-layer");
        assert_eq!(json["pages"][0]["lines"].as_array().unwrap().len(), 0);
    }
}
