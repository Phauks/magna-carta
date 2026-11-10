//! The audio/video transcode engine: an axum service that turns an MP4, QuickTime or Matroska file
//! carrying H.264 or HEVC video into an MP4 every browser plays. Pure Rust throughout: no FFmpeg and no
//! C codec library ever sees the untrusted bytes.

use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

pub mod audio;
pub mod bits;
pub mod demux;
pub mod error;
pub mod h264_sps;
pub mod limits;
pub mod mux;
pub mod picture;
pub mod transcode;
pub mod video;

pub use error::TranscodeError;

/// The source formats this engine reads, as the conversion registry names them.
pub const SOURCE_FORMATS: [&str; 3] = ["mp4", "mov", "mkv"];
/// The target formats it writes. `playable-mp4` exists so an MP4 source has somewhere to go.
pub const TARGET_FORMATS: [&str; 2] = ["mp4", "playable-mp4"];
/// The one recipe: H.264 video, AAC sound, the movie header first.
pub const RECIPE: &str = "mp4-h264-aac-faststart";

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn status_for(error: &TranscodeError) -> StatusCode {
    match error {
        TranscodeError::Unsupported(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        TranscodeError::Malformed(_) => StatusCode::UNPROCESSABLE_ENTITY,
        TranscodeError::TooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
        TranscodeError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// A failure response. The message names formats and limits only, so it is safe to log and to show.
fn failure(error: &TranscodeError) -> Response {
    eprintln!("transcode failed: {error}");
    (status_for(error), error.to_string()).into_response()
}

async fn handle_convert(headers: HeaderMap, body: Body) -> Response {
    let (Some(source_format), Some(target_format), Some(recipe)) = (
        header_value(&headers, "x-source-format"),
        header_value(&headers, "x-target-format"),
        header_value(&headers, "x-recipe"),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !SOURCE_FORMATS.contains(&source_format)
        || !TARGET_FORMATS.contains(&target_format)
        || recipe != RECIPE
    {
        return failure(&TranscodeError::unsupported(format!(
            "{source_format} to {target_format} by {recipe}"
        )));
    }

    // Spool the body to disk: a video is far larger than the memory this service should hold.
    let working = match tempfile::tempdir() {
        Ok(directory) => directory,
        Err(error) => {
            return failure(&TranscodeError::internal(format!(
                "no working directory ({error})"
            )))
        }
    };
    let source = working.path().join("source");
    let output = working.path().join("rendition.mp4");
    match spool(body, &source).await {
        Ok(()) => {}
        Err(error) => return failure(&error),
    }

    let (source_for_task, working_for_task, output_for_task) =
        (source.clone(), working.path().to_path_buf(), output.clone());
    let outcome = tokio::task::spawn_blocking(move || {
        transcode::transcode(&source_for_task, &working_for_task, &output_for_task)
    })
    .await;
    let report = match outcome {
        Ok(Ok(report)) => report,
        Ok(Err(error)) => return failure(&error),
        // A decoder that panics on a hostile stream ends this one conversion, not the service.
        Err(_) => return failure(&TranscodeError::malformed("a decoder stopped on this file")),
    };
    let file = match tokio::fs::File::open(&output).await {
        Ok(file) => file,
        Err(error) => {
            return failure(&TranscodeError::internal(format!(
                "the rendition cannot be read ({error})"
            )))
        }
    };
    let length = file
        .metadata()
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    // The working directory goes when the body has been sent: the stream owns it.
    let stream = tokio_util::io::ReaderStream::new(file).map(move |chunk| {
        let _keep = &working;
        chunk
    });
    let mut response = Response::new(Body::from_stream(stream));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("video/mp4"),
    );
    headers.insert(header::CONTENT_LENGTH, header::HeaderValue::from(length));
    headers.insert(
        "x-video",
        header::HeaderValue::from_static(if report.video_copied {
            "copied"
        } else {
            "encoded"
        }),
    );
    headers.insert(
        "x-audio",
        header::HeaderValue::from_static(match report.audio {
            None => "none",
            Some(true) => "copied",
            Some(false) => "encoded",
        }),
    );
    response
}

async fn spool(body: Body, path: &std::path::Path) -> Result<(), TranscodeError> {
    let mut file = tokio::fs::File::create(path).await.map_err(|error| {
        TranscodeError::internal(format!("the source cannot be spooled ({error})"))
    })?;
    let mut stream = body.into_data_stream();
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            TranscodeError::malformed(format!("the request body broke off ({error})"))
        })?;
        written += chunk.len() as u64;
        if written > limits::MAX_INPUT_BYTES {
            return Err(TranscodeError::too_large(
                "the file is over the size ceiling",
            ));
        }
        file.write_all(&chunk).await.map_err(|error| {
            TranscodeError::internal(format!("the source cannot be spooled ({error})"))
        })?;
    }
    file.flush().await.map_err(|error| {
        TranscodeError::internal(format!("the source cannot be spooled ({error})"))
    })?;
    Ok(())
}

pub fn router() -> Router {
    Router::new()
        .route("/ready", get(|| async { StatusCode::OK }))
        // The body is streamed to disk under the engine's own ceiling, so axum's in-memory limit is lifted.
        .route(
            "/convert",
            post(handle_convert).layer(DefaultBodyLimit::disable()),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn request(source: &str, target: &str, recipe: &str, body: Vec<u8>) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/convert")
            .header("x-source-format", source)
            .header("x-target-format", target)
            .header("x-recipe", recipe)
            .body(Body::from(body))
            .unwrap()
    }

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(name),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn ready_answers() {
        let response = router()
            .oneshot(
                Request::builder()
                    .uri("/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_conversion_streams_back_an_mp4() {
        let response = router()
            .oneshot(request(
                "mkv",
                "playable-mp4",
                RECIPE,
                fixture("hevc10-flac.mkv"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("content-type").unwrap(), "video/mp4");
        assert_eq!(response.headers().get("x-video").unwrap(), "encoded");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[4..8], b"ftyp");
    }

    #[tokio::test]
    async fn an_unknown_recipe_is_unsupported() {
        let response = router()
            .oneshot(request("mp4", "mp4", "gif", fixture("h264-aac.mp4")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[tokio::test]
    async fn a_refused_codec_is_unsupported() {
        let response = router()
            .oneshot(request("mkv", "mp4", RECIPE, fixture("h264-ac3.mkv")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[tokio::test]
    async fn a_missing_header_is_a_bad_request() {
        let request = Request::builder()
            .method("POST")
            .uri("/convert")
            .header("x-source-format", "mp4")
            .body(Body::empty())
            .unwrap();
        let response = router().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
