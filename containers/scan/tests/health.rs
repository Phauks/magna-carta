use magna_carta_scan::{heuristics::ArchiveCaps, router, yara, AppState};
use std::sync::Arc;

fn test_state() -> AppState {
    AppState {
        rules: Arc::new(yara::build_rules(&[])),
        side_map: Arc::new(std::collections::HashMap::new()),
        clamd_address: "127.0.0.1:3310".into(),
        caps: ArchiveCaps::default(),
        engine_version: "test".into(),
        magika: Arc::new(
            magna_carta_scan::identify::IdentifyEngine::new()
                .expect("magika session builds with the embedded model"),
        ),
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

// The /scan handler returns the RAW facts (not a verdict): a 200 carrying `clam`, `heuristic`,
// `matches`, and `timings`. A clean buffer yields `clam: clean` where a clamd listens, or `clam:
// unavailable` in CI without one — either way the body shape is the raw result, never the old
// `verdict` union, and the per-engine timings are always present.
#[tokio::test]
async fn scan_returns_raw_facts_with_timings() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router(test_state())).await;
    });

    let response = reqwest::Client::new()
        .post(format!("http://{addr}/scan?contentType=text/plain"))
        .body("abcd")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value =
        serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert!(body.get("matches").is_some(), "matches must be present");
    assert!(body.get("timings").is_some(), "timings must be present");
    assert!(body.get("clam").is_some(), "clam fact must be present");
    // The old verdict union must be gone — the container reports facts, not a verdict.
    assert!(
        body.get("verdict").is_none(),
        "the raw result must not carry a container-side verdict"
    );
}
