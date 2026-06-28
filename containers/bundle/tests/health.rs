use magna_carta_bundle::{router, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;

async fn spawn() -> String {
    let state = AppState {
        r2_base_url: Arc::from("http://unused"),
        http: reqwest::Client::new(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test]
async fn ready_returns_200() {
    let base = spawn().await;
    let resp = reqwest::get(format!("{base}/ready")).await.unwrap();
    assert_eq!(resp.status(), 200);
}
