//! The OCR container's HTTP surface: one POST route that takes an image or a PDF and
//! returns per-page raw facts. The engine stays pure; every wire concern lives here.
//! The standard `/ready` probe and body cap come from `engine_host::host::ready_app`.

pub mod dto;
pub mod pages;

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Query, State};
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

/// `?force=true` recognizes every page of a PDF even where one already carries a text
/// layer. The caller needs this to re-OCR a document with a newer model: without it, the
/// text layer a previous run wrote is itself the reason the page is skipped, and a result
/// could never be replaced by a better one.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
pub struct OcrQuery {
    pub force: bool,
}

/// Recognize an image or every scanned page of a PDF.
async fn ocr(
    State(state): State<AppState>,
    Query(query): Query<OcrQuery>,
    body: Bytes,
) -> Response {
    if body.is_empty() {
        return error(StatusCode::UNPROCESSABLE_ENTITY, "empty-body");
    }
    let result = if body.starts_with(b"%PDF") {
        recognize_pdf(&state, &body, query.force)
    } else {
        // An image is one page: there is no text layer to already have, so nothing to force.
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
        // A genuine engine fault is transient and retryable: the same bytes might
        // succeed on a re-run, and it must never look like a page with no words.
        Err(OcrError::InferenceFailed) => {
            error(StatusCode::SERVICE_UNAVAILABLE, "inference-failed")
        }
        // Everything else is the caller's problem -- a document that is malformed or
        // was refused by a size/bomb guard will fail identically on every retry.
        Err(other) => error(StatusCode::UNPROCESSABLE_ENTITY, other.code()),
    }
}

fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(serde_json::json!({ "code": code }))).into_response()
}

/// A decode failure is the caller's problem, not ours: `Limits` means the image tripped
/// the bounds set in `recognize_image` (the raster equivalent of the PDF
/// decompression-bomb guard), and anything else is a malformed or unsupported file --
/// neither will read differently on a retry.
fn image_decode_error(error: image::ImageError) -> OcrError {
    match error {
        image::ImageError::Limits(_) => OcrError::DocumentRejected,
        _ => OcrError::DocumentUnreadable,
    }
}

fn recognize_image(state: &AppState, bytes: &[u8]) -> Result<Vec<PageFacts>, OcrError> {
    // Decode under explicit limits: an image is untrusted input, and a decompression
    // bomb must be refused rather than allocated.
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| OcrError::DocumentUnreadable)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(image_decode_error)?.to_rgb8();

    let page = state.recognizer.recognize(&image)?;
    Ok(vec![PageFacts {
        page_index: 0,
        lines: page.lines,
        undecoded_regions: page.undecoded_regions,
        skipped: None,
        orientation_degrees: state.recognizer.page_orientation(&image),
    }])
}

/// `Document::load` only ever fails to parse or gets refused by the bomb guard -- a
/// malformed or oversize document is the caller's problem, not ours, and will fail the
/// same way on every retry. `PageOutOfRange` and `Render` cannot occur from `load`
/// itself; they are listed to keep the match exhaustive and, if they ever did occur
/// here, a document we could not read is still the more honest label than an engine
/// fault we did not have.
fn document_load_error(error: pdf_core::PdfError) -> OcrError {
    match error {
        pdf_core::PdfError::Rejected => OcrError::DocumentRejected,
        pdf_core::PdfError::Parse
        | pdf_core::PdfError::PageOutOfRange
        | pdf_core::PdfError::Render => OcrError::DocumentUnreadable,
    }
}

/// The most pages one synchronous request will walk. Every page is rendered and
/// recognized in sequence on a single-threaded engine, so page count is wall-clock: a
/// document declaring thousands of pages would hold the container -- which every firm
/// shares -- for as long as it took to walk them. The walk itself has to be bounded, not
/// merely each page within it. A production longer than this belongs on the job path, not
/// on a request someone is waiting on.
const MAX_PAGES: usize = 100;

/// The share of a page that must be covered by visible text before its text layer is
/// judged complete enough that recognition would add nothing -- whatever else is on the
/// page. Born-digital body text runs well above this even on a sparse page; a stamp, a
/// page number, or a caption runs an order of magnitude below.
const TEXT_LAYER_COVERAGE: f32 = 0.02;

/// The share of a page that must be raster image before the page is treated as a scan --
/// something whose content is pixels, and therefore has words only recognition can reach.
const SCANNED_PAGE_RASTER_COVERAGE: f32 = 0.5;

/// Does this page still need recognizing? Presence of a glyph is emphatically not the
/// test, and getting this wrong is expensive in both directions.
///
/// Two glyphs answer "yes, there is text here" while leaving the page's actual content
/// unread: an *invisible* text layer (excluded from the coverage measure upstream, in
/// `page_visible_text_coverage`), and a **Bates stamp** -- a dozen real, visible glyphs in
/// the corner of an otherwise scanned page. This product stamps productions itself, so a
/// skip-on-presence rule would silently discard the content of every stamped scanned page
/// it was ever asked to read. That is the failure this function exists to prevent.
///
/// So text is weighed against what it sits on. A page that is mostly raster and carries
/// only a sprinkling of text is a scan someone wrote on -- recognize it. A page drawn as
/// text and vectors is born-digital: whatever text it has is already better than anything
/// OCR could produce from a picture of it, so leave it alone even where there is little of
/// it. And a page dense with text needs nothing from us regardless of what is underneath.
///
/// Where the signals are ambiguous the tie goes to recognizing: OCRing a page that already
/// had text costs some duplicate lines a caller can see and drop, while skipping a page
/// that did not costs the page, silently.
fn needs_recognition(text_coverage: f32, raster_coverage: f32) -> bool {
    if text_coverage >= TEXT_LAYER_COVERAGE {
        return false;
    }
    let is_scan = raster_coverage >= SCANNED_PAGE_RASTER_COVERAGE;
    // Sparse text on a page that is not a scan: born-digital and simply sparse. Nothing to
    // recognize -- there is no picture of words here, only words.
    if !is_scan && text_coverage > 0.0 {
        return false;
    }
    true
}

/// A render failure is not automatically ours. `Rejected` means the page's declared
/// geometry exceeded the raster budget -- a property of the document, permanent across
/// retries -- while a genuine renderer fault is transient and worth retrying.
fn render_error(error: pdf_core::PdfError) -> OcrError {
    match error {
        pdf_core::PdfError::Rejected => OcrError::DocumentRejected,
        _ => OcrError::InferenceFailed,
    }
}

fn recognize_pdf(state: &AppState, bytes: &[u8], force: bool) -> Result<Vec<PageFacts>, OcrError> {
    // `Document::load` takes ownership of the buffer (it feeds the bomb guard before the
    // parser touches it), so the borrowed request body is copied once here.
    let document = pdf_core::Document::load(bytes.to_vec()).map_err(document_load_error)?;
    if document.page_count() > MAX_PAGES {
        return Err(OcrError::DocumentRejected);
    }
    let mut pages = Vec::new();
    for page_index in 0..document.page_count() {
        // An unreadable page must never be assumed to have no text layer -- that would
        // silently re-OCR a page whose existing text we simply failed to observe, so a
        // lookup failure is a permanent document fault, not a green light to proceed.
        let text_coverage = document
            .page_visible_text_coverage(page_index)
            .map_err(|_| OcrError::DocumentUnreadable)?;
        let raster_coverage = document
            .page_raster_coverage(page_index)
            .map_err(|_| OcrError::DocumentUnreadable)?;
        if !force && !needs_recognition(text_coverage, raster_coverage) {
            pages.push(PageFacts {
                page_index,
                lines: Vec::new(),
                undecoded_regions: 0,
                skipped: Some(SkipReason::AlreadyHasTextLayer),
                orientation_degrees: None,
            });
            continue;
        }
        let size = document
            .page_size(page_index)
            .map_err(|_| OcrError::InferenceFailed)?;
        // An outsize page is rastered at whatever density fits the pixel budget; one whose
        // declared geometry cannot be held even at the minimum useful density is refused,
        // never recognized into confident nonsense.
        let dpi = pages::render_dpi_for(size.width_pt, size.height_pt)
            .ok_or(OcrError::DocumentRejected)?;
        let rendered = document
            .render_page(page_index, dpi, false)
            .map_err(render_error)?;
        // Composite over white rather than discarding alpha: a page with no background
        // content is fully transparent, and dropping alpha would hand the engine a black page.
        let image = rendered.to_rgb_image().ok_or(OcrError::InferenceFailed)?;

        let recognized = state.recognizer.recognize(&image)?;
        let lines = recognized
            .lines
            .into_iter()
            .map(|mut line| {
                line.quad = pages::to_user_space(line.quad, size.height_pt, dpi);
                line.word_quads = line
                    .word_quads
                    .into_iter()
                    .map(|quad| pages::to_user_space(quad, size.height_pt, dpi))
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
                    // Deliberately distinct from `quad` above: a transform wired onto
                    // the line box but forgotten on the word boxes would leave this
                    // untouched, and a test comparing it against `quad`'s own numbers
                    // would not catch that.
                    word_quads: vec![Quad {
                        points: [(10.0, 10.0), (110.0, 10.0), (110.0, 50.0), (10.0, 50.0)],
                    }],
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

    #[tokio::test]
    async fn a_malformed_pdf_body_is_a_permanent_four_twenty_two_not_a_retry() {
        let base = spawn(false).await;
        // Starts with the PDF magic bytes (so it takes the PDF branch) but is not a
        // parseable document.
        let mut bogus = b"%PDF-1.4\n".to_vec();
        bogus.extend_from_slice(b"this is not a real pdf body");
        let (status, json) = post(&base, bogus).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json["code"], "document-unreadable");
        assert!(
            json.get("pages").is_none(),
            "a bad document must not present as pages: {json}"
        );
    }

    fn assert_point_close(point: &serde_json::Value, expected_x: f32, expected_y: f32) {
        let x = point[0].as_f64().unwrap() as f32;
        let y = point[1].as_f64().unwrap() as f32;
        assert!(
            (x - expected_x).abs() < 0.01,
            "x: expected {expected_x}, got {x}"
        );
        assert!(
            (y - expected_y).abs() < 0.01,
            "y: expected {expected_y}, got {y}"
        );
    }

    /// Assemble a spec-conforming PDF from object bodies numbered `1 0 obj` upward, in
    /// order. Byte offsets are tracked as each object is written rather than
    /// hand-computed, so the xref table cannot drift out of sync with the body above it.
    fn build_pdf(objects: Vec<Vec<u8>>) -> Vec<u8> {
        let mut buffer = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for object in objects {
            offsets.push(buffer.len());
            buffer.extend_from_slice(&object);
        }
        let xref_offset = buffer.len();
        let entry_count = offsets.len() + 1; // +1 for the mandatory free object 0
        buffer.extend_from_slice(format!("xref\n0 {entry_count}\n").as_bytes());
        buffer.extend_from_slice(b"0000000000 65535 f \n");
        for offset in &offsets {
            buffer.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        buffer.extend_from_slice(
            format!(
                "trailer\n<< /Size {entry_count} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF"
            )
            .as_bytes(),
        );
        buffer
    }

    /// `page_count` pages of the given `media_box`, each with no content stream at all --
    /// so no text layer, and nothing to render.
    fn pages_pdf(media_box: &str, page_count: usize) -> Vec<u8> {
        let kids: Vec<String> = (0..page_count).map(|i| format!("{} 0 R", i + 3)).collect();
        let mut objects = vec![
            b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_vec(),
            format!(
                "2 0 obj\n<< /Type /Pages /Kids [{}] /Count {page_count} >>\nendobj\n",
                kids.join(" ")
            )
            .into_bytes(),
        ];
        for index in 0..page_count {
            objects.push(
                format!(
                    "{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [{media_box}] \
                     /Resources << >> >>\nendobj\n",
                    index + 3
                )
                .into_bytes(),
            );
        }
        build_pdf(objects)
    }

    /// A minimal one-page PDF with no content stream and a US Letter `MediaBox`.
    fn minimal_blank_pdf() -> Vec<u8> {
        pages_pdf("0 0 612 792", 1)
    }

    /// A one-page US Letter PDF whose content is a full-page raster image -- a scan --
    /// optionally carrying a line of real, visible text in the bottom-left corner, the
    /// way a Bates stamp sits on a scanned production page.
    fn scanned_pdf(stamp: Option<&str>) -> Vec<u8> {
        let mut content = b"q 612 0 0 792 0 0 cm /Im0 Do Q\n".to_vec();
        if let Some(text) = stamp {
            content.extend_from_slice(format!("BT /F1 10 Tf 20 20 Td ({text}) Tj ET\n").as_bytes());
        }
        // A 2x2 24-bit RGB image, uncompressed: the smallest thing hayro will report as a
        // drawn image XObject. Stretched over the page by the `cm` above, it covers 100%
        // of it -- which is exactly what makes the page a scan.
        let pixels: [u8; 12] = [200, 200, 200, 180, 180, 180, 190, 190, 190, 210, 210, 210];
        let mut image_object = format!(
            "4 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 2 \
             /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {} >>\nstream\n",
            pixels.len()
        )
        .into_bytes();
        image_object.extend_from_slice(&pixels);
        image_object.extend_from_slice(b"\nendstream\nendobj\n");

        let mut content_object =
            format!("5 0 obj\n<< /Length {} >>\nstream\n", content.len()).into_bytes();
        content_object.extend_from_slice(&content);
        content_object.extend_from_slice(b"\nendstream\nendobj\n");

        build_pdf(vec![
            b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_vec(),
            b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_vec(),
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R \
              /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> >>\nendobj\n"
                .to_vec(),
            image_object,
            content_object,
            b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_vec(),
        ])
    }

    #[tokio::test]
    async fn a_pdf_page_with_no_text_layer_is_ocred_and_both_boxes_land_in_user_space() {
        let base = spawn(false).await;
        let (status, json) = post(&base, minimal_blank_pdf()).await;
        assert_eq!(status, reqwest::StatusCode::OK, "body: {json}");
        assert!(
            json["pages"][0]["skipped"].is_null(),
            "a page with no text layer must be recognized, not skipped: {json}"
        );

        // The stub's line quad is raw pixel points (0,0)-(300,0)-(300,60)-(0,60) at 300
        // DPI. Scale = 72/300 = 0.24; the page is 792pt tall, and y flips from the top:
        //   (0,0)   -> (0.0,  792.0)
        //   (300,0) -> (72.0, 792.0)
        //   (300,60)-> (72.0, 777.6)
        //   (0,60)  -> (0.0,  777.6)
        let quad = json["pages"][0]["lines"][0]["quad"]["points"]
            .as_array()
            .unwrap()
            .clone();
        assert_point_close(&quad[0], 0.0, 792.0);
        assert_point_close(&quad[1], 72.0, 792.0);
        assert_point_close(&quad[2], 72.0, 777.6);
        assert_point_close(&quad[3], 0.0, 777.6);

        // The stub's word quad is raw pixel points (10,10)-(110,10)-(110,50)-(10,50),
        // deliberately distinct from the line quad above:
        //   (10,10)  -> (2.4,  789.6)
        //   (110,10) -> (26.4, 789.6)
        //   (110,50) -> (26.4, 780.0)
        //   (10,50)  -> (2.4,  780.0)
        // If the transform were wired onto the line box and forgotten on the word boxes,
        // these would come back as the untransformed raw pixel points instead.
        let word_quad = json["pages"][0]["lines"][0]["wordQuads"][0]["points"]
            .as_array()
            .unwrap()
            .clone();
        assert_point_close(&word_quad[0], 2.4, 789.6);
        assert_point_close(&word_quad[1], 26.4, 789.6);
        assert_point_close(&word_quad[2], 26.4, 780.0);
        assert_point_close(&word_quad[3], 2.4, 780.0);
    }

    #[test]
    fn a_bates_stamp_does_not_make_a_scanned_page_look_like_it_has_a_text_layer() {
        // The trap this gate exists to avoid. A scanned page carrying a Bates stamp is
        // ~100% raster and a fraction of a percent text -- if the presence of the stamp's
        // glyphs counted as a text layer, every stamped page of a scanned production
        // would be skipped and its content lost. This product stamps productions itself.
        assert!(
            needs_recognition(0.001, 1.0),
            "a stamped scan must still be recognized"
        );
        // The same page before it was stamped.
        assert!(needs_recognition(0.0, 1.0));
        // A scan whose text layer is invisible reads as zero *visible* coverage upstream,
        // so it arrives here indistinguishable from an unstamped scan -- and is recognized.
        // That is what lets a result be replaced by a better one later.
        assert!(needs_recognition(0.0, 0.98));
    }

    #[test]
    fn a_born_digital_page_is_left_alone_however_sparse_its_text() {
        // Dense body text: nothing to add.
        assert!(!needs_recognition(0.25, 0.0));
        // A title page with one line on it: still born-digital. Its own text layer beats
        // anything recognition could read off a picture of it, so it is not re-recognized
        // merely for being sparse.
        assert!(!needs_recognition(0.002, 0.0));
        // Text over a small illustration is still a text page.
        assert!(!needs_recognition(0.05, 0.2));
    }

    #[test]
    fn a_page_with_neither_text_nor_raster_is_recognized_rather_than_assumed_empty() {
        // Nothing observed at all. It could be a scan the observer could not see into;
        // the tie goes to looking, since skipping would lose the page silently.
        assert!(needs_recognition(0.0, 0.0));
    }

    #[test]
    fn the_synthetic_scan_fixture_really_measures_as_a_scan() {
        // The gate is only as good as the signals under it: if the observer did not see
        // the page's image, every scan would read as "not a scan" and the tests above
        // would pass for the wrong reason.
        let document = pdf_core::Document::load(scanned_pdf(Some("SMITH000123"))).unwrap();
        let text = document.page_visible_text_coverage(0).unwrap();
        let raster = document.page_raster_coverage(0).unwrap();
        // The full-page image must read as covering essentially the whole page, and the
        // Bates stamp as a sliver -- the exact signal split `needs_recognition` relies on to
        // recognize a stamped scan rather than mistake the stamp for a text layer.
        assert!(
            raster > 0.9,
            "the full-page scan image must measure as a scan: raster={raster}"
        );
        assert!(
            text < TEXT_LAYER_COVERAGE,
            "the Bates stamp must measure well below the text-layer threshold: text={text}"
        );
        assert!(
            needs_recognition(text, raster),
            "a stamped scan must be recognized, not skipped: text={text} raster={raster}"
        );
    }

    #[tokio::test]
    async fn a_stamped_scanned_page_is_recognized_not_skipped() {
        let base = spawn(false).await;
        let (status, json) = post(&base, scanned_pdf(Some("SMITH000123"))).await;
        assert_eq!(status, reqwest::StatusCode::OK, "body: {json}");
        assert!(
            json["pages"][0]["skipped"].is_null(),
            "a Bates-stamped scan must be recognized, not skipped as already-texted: {json}"
        );
        assert_eq!(json["pages"][0]["lines"][0]["text"], "INVOICE");
    }

    #[tokio::test]
    async fn a_born_digital_page_is_still_skipped() {
        let base = spawn(false).await;
        // The counterpart to the test above: the gate must still skip what it is for.
        let pdf = std::fs::read("../../crates/pdf-core/tests/fixtures/hello.pdf")
            .expect("hello.pdf fixture");
        let (status, json) = post(&base, pdf).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["pages"][0]["skipped"], "already-has-text-layer");
    }

    #[tokio::test]
    async fn force_recognizes_a_page_that_would_otherwise_be_skipped() {
        let base = spawn(false).await;
        let pdf = std::fs::read("../../crates/pdf-core/tests/fixtures/hello.pdf")
            .expect("hello.pdf fixture");
        let response = reqwest::Client::new()
            .post(format!("{base}/ocr?force=true"))
            .body(pdf)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let json: serde_json::Value = response.json().await.unwrap();
        // Without this, a text layer written by a previous OCR pass would be the very
        // reason the page could never be re-read by a better model.
        assert!(
            json["pages"][0]["skipped"].is_null(),
            "force must recognize a page with an existing text layer: {json}"
        );
        assert_eq!(json["pages"][0]["lines"][0]["text"], "INVOICE");
    }

    #[tokio::test]
    async fn a_page_declaring_an_absurd_geometry_is_refused_not_allocated() {
        let base = spawn(false).await;
        // 14400pt is 200 inches -- Acrobat's own maximum page, so this is not even a
        // malformed file. At 300 DPI it is 60000x60000 px: ~14 GB of RGBA from a
        // kilobyte of input. It must be refused before anything is allocated, and
        // refused *permanently*: the geometry is a property of the document, so a retry
        // would only OOM the container again.
        let (status, json) = post(&base, pages_pdf("0 0 14400 14400", 1)).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{json}");
        assert_eq!(json["code"], "document-rejected");
    }

    #[tokio::test]
    async fn a_document_of_too_many_pages_is_refused_rather_than_walked() {
        let base = spawn(false).await;
        // The walk itself is bounded, not merely each page within it: every page is
        // rendered and recognized in sequence on an engine every firm shares.
        let (status, json) = post(&base, pages_pdf("0 0 612 792", MAX_PAGES + 1)).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{json}");
        assert_eq!(json["code"], "document-rejected");
    }

    #[tokio::test]
    async fn a_document_at_the_page_ceiling_is_still_walked() {
        let base = spawn(false).await;
        // The cap must not be off by one against a document that is exactly at it. The
        // pages are deliberately tiny (1x1 inch): this test is about the walk being
        // allowed, not about rastering 100 full-size pages.
        let (status, json) = post(&base, pages_pdf("0 0 72 72", MAX_PAGES)).await;
        assert_eq!(status, reqwest::StatusCode::OK, "{json}");
        assert_eq!(json["pages"].as_array().unwrap().len(), MAX_PAGES);
    }
}
