//! The discovery container's HTTP surface: five POST routes that hand a request body to the pure
//! `discovery_core` engine and marshal the result to JSON. All I/O and wire concerns live here; the
//! engine stays pure and serde-free. The standard `/ready` probe and body cap are added by
//! `engine_host::host::ready_app`, which the binary and the tests wrap around `router()`.
//!
//! WHY THIS IS ITS OWN CONTAINER AND NOT A ROUTE ON THE SEARCH ONE. Extraction is bursty and
//! CPU-saturating for hours during a large load, while the search container's whole design premise
//! is staying warm with a resident cache serving sub-second queries. Sharing them would mean a bulk
//! load makes review search slow — the one combination a discovery user will actually hit.
//!
//! An engine error becomes a 422 carrying ONLY the stable code. Nothing derived from the document
//! reaches a response body on the failure path, because every byte this service sees is privileged.

pub mod dto;

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};

use engine_host::wasm_edge::EdgeError;

use dto::{ArchiveEntryDto, DigestSetDto, ExpansionDto, IdentificationDto, ReadingDto};

/// The one failure shape every route shares: the engine's stable code and nothing else.
fn engine_error(error: discovery_core::DiscoveryError) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({ "code": error.code() })),
    )
        .into_response()
}

/// Identify the request body from its bytes. Always 200: every input has an answer, and bytes
/// nothing can name are an answer too.
async fn identify(body: Bytes) -> Response {
    let identification = discovery_core::identify(&body);
    (
        StatusCode::OK,
        Json(IdentificationDto::from(identification)),
    )
        .into_response()
}

/// Read the request body end to end — identify, extract, chunk, digest, fingerprint.
async fn read(body: Bytes) -> Response {
    match discovery_core::read_document(&body, &discovery_core::Limits::default()) {
        Ok(reading) => (StatusCode::OK, Json(ReadingDto::from(reading))).into_response(),
        Err(error) => engine_error(error),
    }
}

/// The five-algorithm digest set. Always 200: hashing bytes cannot fail.
async fn digest(body: Bytes) -> Response {
    let digests = discovery_core::digest_all(&body);
    (StatusCode::OK, Json(DigestSetDto::from(digests))).into_response()
}

/// List an archive's entries without decompressing any of them.
async fn enumerate_archive(body: Bytes) -> Response {
    match discovery_core::enumerate(&body, &discovery_core::Limits::default()) {
        Ok(entries) => {
            let listed: Vec<ArchiveEntryDto> = entries.iter().map(ArchiveEntryDto::from).collect();
            (StatusCode::OK, Json(listed)).into_response()
        }
        Err(error) => engine_error(error),
    }
}

/// Expand an archive under every guard, returning what came out and what did not.
async fn expand_archive(body: Bytes) -> Response {
    match discovery_core::expand(&body, &discovery_core::Limits::default()) {
        Ok(expansion) => (StatusCode::OK, Json(ExpansionDto::from(expansion))).into_response(),
        Err(error) => engine_error(error),
    }
}

/// The engine's work routes. Compose with `engine_host::host::ready_app` (and `with_panic_net`) to
/// get the full container service.
pub fn router() -> Router {
    Router::new()
        .route("/identify", post(identify))
        .route("/read", post(read))
        .route("/digest", post(digest))
        .route("/archive/enumerate", post(enumerate_archive))
        .route("/archive/expand", post(expand_archive))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spawn the full container app (work routes + `/ready` + body cap) on an ephemeral loopback
    /// port and return its base URL.
    async fn spawn_app() -> String {
        let app = engine_host::host::with_panic_net(engine_host::host::ready_app(router()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    async fn post_bytes(
        base: &str,
        path: &str,
        body: Vec<u8>,
    ) -> (reqwest::StatusCode, serde_json::Value) {
        let response = reqwest::Client::new()
            .post(format!("{base}{path}"))
            .body(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        (status, response.json().await.unwrap())
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
    async fn identify_answers_from_the_bytes() {
        let base = spawn_app().await;
        let (status, json) = post_bytes(&base, "/identify", b"%PDF-1.7\ntrailer\n".to_vec()).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["format"], "pdf");
        assert_eq!(json["confidence"], "certain");
    }

    #[tokio::test]
    async fn read_returns_passages_digests_and_a_fingerprint() {
        let base = spawn_app().await;
        let (status, json) = post_bytes(
            &base,
            "/read",
            b"The seller shall indemnify the buyer.\n".to_vec(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["outcome"], "read");
        assert_eq!(json["passages"].as_array().unwrap().len(), 1);
        assert!(json["digests"]["sha256"].as_str().unwrap().len() == 64);
        assert_eq!(json["textFingerprint"].as_str().unwrap().len(), 16);
    }

    #[tokio::test]
    async fn an_engine_failure_is_a_422_carrying_only_the_stable_code() {
        let base = spawn_app().await;
        // A real document that reads successfully and contains no words: the named exception, not a
        // crash and not an empty success.
        let (status, json) = post_bytes(&base, "/read", b"   \n\t\n".to_vec()).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json["code"], "noTextExtracted");
        // Nothing but the code: no detail, no file content, no echo of the input.
        assert_eq!(json.as_object().unwrap().len(), 1);
    }

    /// A handler that fails the way a parser handed a crafted file would, if one ever got past the
    /// engine's typed errors. The return type is named so the panic is the handler's behaviour
    /// rather than an inference accident.
    async fn panicking_handler() -> String {
        panic!("a parser gave up")
    }

    #[tokio::test]
    async fn a_panicking_handler_returns_500_without_killing_the_container() {
        // The panic net is a last-resort guarantee, so it is asserted against a route that really
        // panics rather than against the hope that no handler ever will. The service must still be
        // serving afterwards — that is the property, not the 500 itself.
        let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
            router().route("/panic", post(panicking_handler)),
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });
        let base = format!("http://{addr}");

        let response = reqwest::Client::new()
            .post(format!("{base}/panic"))
            .body(Vec::new())
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        );

        let still_serving = reqwest::get(format!("{base}/ready"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(still_serving, "ok");
    }

    #[tokio::test]
    async fn a_body_over_the_cap_is_refused_by_the_harness_rather_than_the_handler() {
        // The cap belongs to the harness, so the refusal has to arrive before any handler sees the
        // bytes — otherwise an oversized body would be buffered before being rejected, which is the
        // allocation the cap exists to prevent.
        // The tightened cap is composed INSIDE `ready_app`, which is the order the harness's own
        // default is meant to be overridden in: the innermost limit is the one the extractor reads.
        let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
            router().layer(axum::extract::DefaultBodyLimit::max(1024)),
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });

        let response = reqwest::Client::new()
            .post(format!("http://{addr}/identify"))
            .body(vec![b'x'; 8192])
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn an_archive_enumerates_without_being_expanded_and_expands_under_the_guards() {
        let base = spawn_app().await;
        // Built here rather than committed: a hostile archive is not a thing to leave in a
        // repository as a file.
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in [("PLTF000001.txt", b"first"), ("PLTF000002.txt", b"secnd")] {
            use std::io::Write as _;
            writer.start_file(name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        let archive = writer.finish().unwrap().into_inner();

        let (status, json) = post_bytes(&base, "/archive/enumerate", archive.clone()).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json.as_array().unwrap().len(), 2);
        assert_eq!(json[0]["path"], "PLTF000001.txt");
        assert_eq!(json[0]["isTraversal"], false);

        let (status, json) = post_bytes(&base, "/archive/expand", archive).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["entries"].as_array().unwrap().len(), 2);
        assert!(json["skipped"].as_array().unwrap().is_empty());
    }
}
