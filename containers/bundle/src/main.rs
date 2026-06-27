use magna_carta_bundle::{router, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The owner Worker services R2 GET/PUT at this base via outbound Workers; defaults to the documented
    // virtual host. No credentials and no general egress live in this container.
    let r2_base_url =
        std::env::var("R2_BASE_URL").unwrap_or_else(|_| "http://bundle-r2".to_string());
    let state = AppState {
        r2_base_url: Arc::from(r2_base_url.as_str()),
        http: reqwest::Client::new(),
    };
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
