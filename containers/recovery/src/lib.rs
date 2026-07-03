//! The recovery container's HTTP surface: three POST routes that hand a request
//! body to the pure `recovery_core` engine and marshal the result to JSON. All
//! I/O and wire concerns live here; the engine stays pure and serde-free. The
//! standard `/ready` probe and body cap are added by
//! `engine_host::host::ready_app`, which the binary and tests wrap around
//! `router()` — this module owns only the work routes.

pub mod dto;

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};

use engine_host::wasm_edge::EdgeError;

use dto::{DiagnosisReportDto, RepairResultDto};

/// Diagnose the request body and return the report as JSON (always 200: a
/// diagnosis of unrecognized or unrecoverable bytes is still a valid answer).
async fn diagnose(body: Bytes) -> Response {
    let report = recovery_core::diagnose(&body);
    (StatusCode::OK, Json(DiagnosisReportDto::from(report))).into_response()
}

/// Attempt a format-pillar repair of the request body. On success, 200 with the
/// salvaged files and loss manifest; on a recovery failure, 422 with the stable
/// error code (never file content).
async fn repair(body: Bytes) -> Response {
    match recovery_core::repair(&body) {
        Ok(result) => (StatusCode::OK, Json(RepairResultDto::from(result))).into_response(),
        Err(error) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "code": error.code() })),
        )
            .into_response(),
    }
}

/// Carve embedded known-type files out of the request body. Same response shape
/// as repair: 200 with the carved files, or 422 with the stable error code.
async fn carve(body: Bytes) -> Response {
    match recovery_core::carve(&body) {
        Ok(result) => (StatusCode::OK, Json(RepairResultDto::from(result))).into_response(),
        Err(error) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "code": error.code() })),
        )
            .into_response(),
    }
}

/// The engine's work routes. Compose with `engine_host::host::ready_app` (and
/// `with_panic_net`) to get the full container service.
pub fn router() -> Router {
    Router::new()
        .route("/diagnose", post(diagnose))
        .route("/repair", post(repair))
        .route("/carve", post(carve))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spawn the full container app (work routes + `/ready` + body cap) on an
    /// ephemeral loopback port and return its base URL.
    async fn spawn_app() -> String {
        let app = engine_host::host::ready_app(router());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn ready_probe_returns_ok() {
        let base = spawn_app().await;
        let body = reqwest::get(format!("{base}/ready"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "ok");
    }

    #[tokio::test]
    async fn diagnose_returns_a_recoverability_verdict() {
        let base = spawn_app().await;
        let response = reqwest::Client::new()
            .post(format!("{base}/diagnose"))
            .body(b"%PDF-1.5\n".to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let json: serde_json::Value = response.json().await.unwrap();
        assert!(
            json.get("recoverability")
                .and_then(|v| v.as_str())
                .is_some(),
            "expected a recoverability string, got {json}"
        );
    }

    #[tokio::test]
    async fn repair_is_either_ok_with_files_or_unprocessable_with_a_code() {
        let base = spawn_app().await;
        let body = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n".to_vec();
        let response = reqwest::Client::new()
            .post(format!("{base}/repair"))
            .body(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let json: serde_json::Value = response.json().await.unwrap();
        if status == reqwest::StatusCode::OK {
            let files = json.get("files").and_then(|v| v.as_array()).unwrap();
            assert!(!files.is_empty(), "a 200 repair must carry files: {json}");
            assert!(
                json.pointer("/loss/fullyRecovered")
                    .and_then(|v| v.as_bool())
                    .is_some(),
                "loss.fullyRecovered must be a bool: {json}"
            );
        } else {
            assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
            assert!(
                json.get("code").and_then(|v| v.as_str()).is_some(),
                "a 422 must carry a code: {json}"
            );
        }
    }

    #[tokio::test]
    async fn carve_is_either_ok_with_files_or_unprocessable_with_a_code() {
        let base = spawn_app().await;
        // A buffer with an embedded JPEG (SOI ... EOI) surrounded by filler bytes.
        let mut body = vec![0x00u8; 8];
        body.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
        body.extend_from_slice(&[0x00; 32]);
        body.extend_from_slice(&[0xFF, 0xD9]);
        body.extend_from_slice(&[0x00u8; 8]);

        let response = reqwest::Client::new()
            .post(format!("{base}/carve"))
            .body(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let json: serde_json::Value = response.json().await.unwrap();
        if status == reqwest::StatusCode::OK {
            let files = json.get("files").and_then(|v| v.as_array()).unwrap();
            assert!(!files.is_empty(), "a 200 carve must carry files: {json}");
        } else {
            assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
            assert!(
                json.get("code").and_then(|v| v.as_str()).is_some(),
                "a 422 must carry a code: {json}"
            );
        }
    }
}
