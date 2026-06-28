//! The native Cloudflare-Container hosting toolkit: the axum service skeleton
//! (/ready, body cap, serve), an R2 client helper, and a panic-net layer.
//! No engine logic — engines bring their own routes and state.

use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use axum::Router;

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
}
