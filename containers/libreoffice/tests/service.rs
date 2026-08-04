//! The HTTP surface, driven end to end over the fake worker.
//!
//! These prove the wire contract the convert worker's forwarding proxy depends on: the raster
//! engine's shape, and status codes that never collapse a failure into an empty 200.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use magna_carta_libreoffice::pool::{Pool, PoolConfiguration};
use magna_carta_libreoffice::service::{router, ServiceConfiguration};
use tower::ServiceExt;

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_magna-carta-libreoffice-fake-worker");

static NEXT_FIXTURE: AtomicU32 = AtomicU32::new(0);

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let number = NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "magna-carta-libreoffice-service-{label}-{}-{number}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("spool")).unwrap();
        std::fs::create_dir_all(root.join("profiles")).unwrap();
        Self { root }
    }

    fn spool(&self) -> PathBuf {
        self.root.join("spool")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn service(fixture: &Fixture, worker_arguments: &[&str]) -> (axum::Router, Arc<Pool>) {
    let pool = Pool::start(PoolConfiguration {
        worker_binary: PathBuf::from(FAKE_WORKER),
        worker_arguments: worker_arguments.iter().map(|a| (*a).to_owned()).collect(),
        pool_size: 1,
        profile_root: fixture.root.join("profiles"),
        profile_template: None,
        max_conversions_per_worker: 1_000,
        max_resident_kibibytes: u64::MAX,
        conversion_deadline: Duration::from_millis(400),
        acquire_deadline: Duration::from_millis(400),
        warm_deadline: Duration::from_secs(5),
        reconcile_interval: Duration::from_millis(50),
    });
    let router = router(ServiceConfiguration {
        pool: Arc::clone(&pool),
        spool_directory: fixture.spool(),
    });
    (router, pool)
}

fn convert_request(source: &str, target: &str, recipe: &str, body: &'static [u8]) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/convert")
        .header("x-source-format", source)
        .header("x-target-format", target)
        .header("x-recipe", recipe)
        // Always present in production: the convert worker forwards headers verbatim. It must make
        // no difference to dispatch, which is on the format pair.
        .header("x-engine-id", "libreoffice")
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn ready_is_503_until_a_worker_has_initialised_then_200_with_the_suite_version() {
    let fixture = Fixture::new("ready");
    let (router, pool) = service(&fixture, &["--ready-delay-ms", "400"]).await;

    let early = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        early.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "readiness must not be claimed before a worker can convert"
    );

    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);
    let ready = router
        .oneshot(
            Request::builder()
                .uri("/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ready.status(), StatusCode::OK);
    let body = ready.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8(body.to_vec()).unwrap();
    assert!(body.contains("\"ready\":true"), "{body}");
    assert!(body.contains("suiteVersion"), "{body}");
}

#[tokio::test]
async fn a_served_pair_returns_the_converted_bytes_and_the_canonical_media_type() {
    let fixture = Fixture::new("convert");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/pdf")
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert!(body.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn the_open_document_edge_returns_the_open_document_media_type() {
    let fixture = Fixture::new("odt");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "odt", "odt", b"source"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/vnd.oasis.opendocument.text")
    );
}

#[tokio::test]
async fn a_pair_this_container_does_not_serve_is_415() {
    let fixture = Fixture::new("unsupported");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    for (source, target, recipe) in [
        ("xlsx", "pdf", "pdf"),
        ("pptx", "pdf", "pdf"),
        ("pdf", "docx", "docx"),
        ("wpd", "pdf", "pdf"),
        ("docx", "pdf", "pdf-a-2b"),
    ] {
        let response = router
            .clone()
            .oneshot(convert_request(source, target, recipe, b"source"))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{source} to {target} via {recipe}"
        );
    }
}

#[tokio::test]
async fn a_missing_format_or_recipe_header_is_400() {
    let fixture = Fixture::new("headers");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    for headers in [
        vec![("x-target-format", "pdf"), ("x-recipe", "pdf")],
        vec![("x-source-format", "docx"), ("x-recipe", "pdf")],
        vec![("x-source-format", "docx"), ("x-target-format", "pdf")],
    ] {
        let mut request = Request::builder().method("POST").uri("/convert");
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::from(&b"source"[..])).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn a_password_protected_document_is_422_and_carries_no_document_content() {
    let fixture = Fixture::new("password");
    let (router, pool) = service(
        &fixture,
        &["--behaviour", "unconvertible:password-protected"],
    )
    .await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert!(
        body.is_empty(),
        "a failure response must carry no document-derived content"
    );
}

#[tokio::test]
async fn a_document_that_will_not_convert_is_422() {
    let fixture = Fixture::new("unconvertible");
    let (router, pool) = service(&fixture, &["--behaviour", "unconvertible:save-failed"]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("wpd", "odt", "odt", b"source"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn a_wedged_conversion_is_504() {
    let fixture = Fixture::new("wedge");
    let (router, pool) = service(&fixture, &["--behaviour", "hang"]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
}

#[tokio::test]
async fn a_dead_worker_is_503_rather_than_a_document_verdict() {
    let fixture = Fixture::new("dead");
    let (router, pool) = service(&fixture, &["--behaviour", "exit:7"]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "a worker fault says nothing about the document and must stay retryable"
    );
}

#[tokio::test]
async fn a_success_that_produced_no_bytes_is_never_an_empty_200() {
    let fixture = Fixture::new("empty");
    let (router, pool) = service(&fixture, &["--behaviour", "empty-output"]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
        .await
        .unwrap();
    assert_ne!(
        response.status(),
        StatusCode::OK,
        "a caller about to file something must never be handed an empty success"
    );
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn an_empty_body_is_refused_before_a_worker_is_touched() {
    let fixture = Fixture::new("empty-body");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    let response = router
        .oneshot(convert_request("docx", "pdf", "pdf", b""))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_engine_identifier_header_never_affects_dispatch() {
    let fixture = Fixture::new("engine-id");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    // The email render engine will share this container behind its own identifier; dispatch stays
    // on the format pair, so an unrelated identifier converts and an absent one does too.
    for engine_identifier in [Some("email"), Some("something-else"), None] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/convert")
            .header("x-source-format", "odt")
            .header("x-target-format", "pdf")
            .header("x-recipe", "pdf");
        if let Some(identifier) = engine_identifier {
            request = request.header("x-engine-id", identifier);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::from(&b"source"[..])).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{engine_identifier:?}");
    }
}

#[tokio::test]
async fn no_job_package_survives_a_request() {
    let fixture = Fixture::new("cleanup");
    let (router, pool) = service(&fixture, &[]).await;
    assert!(pool.wait_until_ready(Duration::from_secs(5)).await);

    for _ in 0..3 {
        let response = router
            .clone()
            .oneshot(convert_request("docx", "pdf", "pdf", b"source"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(
        std::fs::read_dir(fixture.spool()).unwrap().count(),
        0,
        "the spool must be empty once every request has been answered"
    );
}
