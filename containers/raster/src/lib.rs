use axum::{
    body::Bytes,
    extract::DefaultBodyLimit,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};

pub mod convert;
pub use convert::{convert, ConvertError};

// 256 MiB — an encoded raster source is far smaller than the worker's general
// 2 GiB ingest cap. axum buffers the full body in RAM before the image::Limits
// bomb-guard (512 MiB max_alloc) can run, so a 2 GiB cap would allow the
// buffered body + decoded surface + encode output to approach 4 GiB and
// pressure the Container instance. 256 MiB keeps the peak (body + decoded
// surface ≤ 512 MiB + encode output) comfortably within the instance budget
// while accepting any realistic image. The decode Limits in convert.rs still
// guard against decompression and pixel bombs independently.
const MAX_CONVERT_BODY_BYTES: usize = 256 * 1024 * 1024;

async fn handle_convert(headers: HeaderMap, body: Bytes) -> Response {
    let source_format = match headers.get("x-source-format").and_then(|v| v.to_str().ok()) {
        Some(v) => v.to_owned(),
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let target_format = match headers.get("x-target-format").and_then(|v| v.to_str().ok()) {
        Some(v) => v.to_owned(),
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let recipe = match headers.get("x-recipe").and_then(|v| v.to_str().ok()) {
        Some(v) => v.to_owned(),
        None => return StatusCode::BAD_REQUEST.into_response(),
    };

    match convert(&body, &source_format, &target_format, &recipe) {
        Ok((output, mime)) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, mime)],
            output,
        )
            .into_response(),
        Err(ConvertError::UnsupportedFormat) => StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response(),
        Err(ConvertError::Decode) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
        Err(ConvertError::Encode) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub fn router() -> Router {
    Router::new()
        .route("/ready", get(|| async { StatusCode::OK }))
        .route(
            "/convert",
            axum::routing::post(handle_convert)
                .layer(DefaultBodyLimit::max(MAX_CONVERT_BODY_BYTES)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use std::io::Cursor;
    use tower::ServiceExt;

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(width, height, image::Rgba([10, 20, 30, 255]));
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    #[tokio::test]
    async fn get_ready_returns_200() {
        let response = router()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/ready")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn post_convert_png_to_webp_returns_200_with_webp_body() {
        let png = png_bytes(8, 5);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    .header("x-source-format", "png")
                    .header("x-target-format", "webp")
                    .header("x-recipe", "raster")
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("image/webp")
        );

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!body.is_empty());
        // Verify the output is actually a valid WebP image.
        image::load_from_memory_with_format(&body, ImageFormat::WebP)
            .expect("response body must be a valid WebP image");
    }

    #[tokio::test]
    async fn post_convert_unknown_target_format_returns_415() {
        let png = png_bytes(4, 4);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    .header("x-source-format", "png")
                    .header("x-target-format", "mp4")
                    .header("x-recipe", "raster")
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[tokio::test]
    async fn post_convert_missing_source_format_header_returns_400() {
        let png = png_bytes(4, 4);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    // x-source-format intentionally omitted
                    .header("x-target-format", "webp")
                    .header("x-recipe", "raster")
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn post_convert_missing_target_format_header_returns_400() {
        let png = png_bytes(4, 4);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    .header("x-source-format", "png")
                    // x-target-format intentionally omitted
                    .header("x-recipe", "raster")
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn post_convert_missing_recipe_header_returns_400() {
        let png = png_bytes(4, 4);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    .header("x-source-format", "png")
                    .header("x-target-format", "webp")
                    // x-recipe intentionally omitted
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn post_convert_png_to_pdf_returns_200_with_pdf_body() {
        let png = png_bytes(8, 5);
        let response = router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert")
                    .header("x-source-format", "png")
                    .header("x-target-format", "pdf")
                    .header("x-recipe", "image-pdf")
                    .body(axum::body::Body::from(png))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("application/pdf")
        );

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(
            body.starts_with(b"%PDF-"),
            "response body must start with PDF magic bytes"
        );
    }
}
