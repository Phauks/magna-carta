use magna_carta_scan::{heuristics::ArchiveCaps, router, yara, AppState};
use std::sync::Arc;

fn test_state() -> AppState {
    AppState {
        rules: Arc::new(yara::build_rules(&[])),
        clamd_address: "127.0.0.1:3310".into(),
        caps: ArchiveCaps::default(),
        engine_version: "test".into(),
    }
}

// Spawns the router on an ephemeral port and asserts GET /ready -> 200 "ok".
#[tokio::test]
async fn ready_returns_ok() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        // Background server for the test; discard the result (tolerant of axum's serve return type).
        let _ = axum::serve(listener, router(test_state())).await;
    });

    let response = reqwest::get(format!("http://{addr}/ready")).await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "ok");
}
