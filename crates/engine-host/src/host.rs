//! The native Cloudflare-Container hosting toolkit: the axum service skeleton
//! (/ready, body cap, serve), an R2 client helper, and a panic-net layer.
//! No engine logic — engines bring their own routes and state.

use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use axum::Router;
use tower_http::catch_panic::CatchPanicLayer;

/// Default request-body cap (2 GiB), aligned with the scan inspectable-size cap.
/// Engines may override by composing their own DefaultBodyLimit.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024 * 1024;

/// Augment a caller's router with the standard `GET /ready` probe and the
/// default body-size cap. Engines pass their work routes in.
pub fn ready_app(router: Router) -> Router {
    router
        .route("/ready", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

/// Serve a router on a caller-supplied listener (used by tests on an ephemeral
/// port, and by `serve` on :8080).
pub async fn serve_on(listener: tokio::net::TcpListener, router: Router) -> std::io::Result<()> {
    axum::serve(listener, router).await
}

/// Bind `0.0.0.0:8080` (the container contract) and serve.
pub async fn serve(router: Router) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    serve_on(listener, router).await
}

/// A reqwest client for R2 GET/PUT against `R2_BASE_URL`: a bounded connect
/// timeout turns a wedged host into a prompt error, but no overall request
/// timeout, so a legitimately large transfer is never cut short. No credentials
/// and no general egress live in the container.
pub fn r2_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
}

/// Wrap a router so a panic in any handler is caught and returned as a 500,
/// keeping the service alive (the never-crash-the-container rule). Engines still
/// own their own honest verdict types; this is the last-resort net.
pub fn with_panic_net(router: Router) -> Router {
    router.layer(CatchPanicLayer::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn spawn(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            serve_on(listener, router).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn ready_returns_ok() {
        let base = spawn(ready_app(Router::new())).await;
        let body = reqwest::get(format!("{base}/ready"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "ok");
    }

    #[tokio::test]
    async fn oversize_body_is_rejected() {
        // A 1-byte cap router; a 2-byte POST must be rejected (413), not accepted.
        let app = Router::new()
            .route(
                "/echo",
                axum::routing::post(|body: axum::body::Bytes| async move { body }),
            )
            .layer(DefaultBodyLimit::max(1));
        let base = spawn(app).await;
        let status = reqwest::Client::new()
            .post(format!("{base}/echo"))
            .body(vec![0u8, 1u8])
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn r2_client_builds() {
        // The helper must produce a client without panicking or erroring.
        assert!(r2_client().is_ok());
    }

    #[tokio::test]
    async fn panicking_handler_becomes_500_not_a_crash() {
        #[allow(unreachable_code)]
        let app = with_panic_net(Router::new().route(
            "/boom",
            get(|| async {
                panic!("engine panicked");
                ""
            }),
        ));
        let base = spawn(app).await;
        let status = reqwest::get(format!("{base}/boom")).await.unwrap().status();
        assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    }
}
