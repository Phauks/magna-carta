use magna_carta_scan::{heuristics::ArchiveCaps, router, yara, AppState};
use std::sync::Arc;

// The router with clamd pointed at a port nothing listens on, so every clamd connect fails and the
// signature engine reports unavailable — without needing a real daemon.
fn state_with_unreachable_clamd() -> AppState {
    AppState {
        rules: Arc::new(yara::build_rules(&[])),
        side_map: Arc::new(std::collections::HashMap::new()),
        clamd_address: "127.0.0.1:1".into(),
        caps: ArchiveCaps::default(),
        engine_version: "test".into(),
        magika: Arc::new(
            magna_carta_scan::identify::IdentifyEngine::new()
                .expect("magika session builds with the embedded model"),
        ),
    }
}

async fn serve(state: AppState) -> String {
    // The handler spools the body into the clamd-shared scratch dir — the fixed /scan the container's
    // entrypoint creates, which exists nowhere else. Point the spool at the OS temp dir so these tests
    // exercise the real spool path on any host; each spooled file removes itself on drop.
    std::env::set_var("SCAN_SCRATCH_DIR", std::env::temp_dir());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router(state)).await;
    });
    format!("http://{addr}")
}

// A clamd-unavailable, otherwise-clean body is now a FACT, not a container verdict: the response is a
// 200 carrying `clam: { state: "unavailable" }`. The app — which holds the firm's policy — decides that
// an unavailable clamd with no other signal is a retry (it never fabricates a clean). The container's
// only 503 is an in-process engine panic (a true container fault), covered by the lib unit tests.
#[tokio::test]
async fn clean_body_with_unreachable_clamd_reports_clam_unavailable() {
    let base = serve(state_with_unreachable_clamd()).await;
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{base}/scan?contentType=text/plain"))
        .body(b"a perfectly ordinary clean body".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value =
        serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(
        body["clam"],
        serde_json::json!({ "state": "unavailable" }),
        "an unreachable clamd must surface honestly as clam: unavailable, not a 503"
    );
    // No other signal: empty matches and a `none` heuristic — exactly the case the app treats as a retry.
    assert_eq!(body["matches"], serde_json::json!([]));
    assert_eq!(body["heuristic"], serde_json::json!({ "kind": "none" }));
}

// A real document is far larger than axum's stock 2 MiB extractor cap. A 3 MiB body must be accepted and
// scanned (here it reaches the unreachable-clamd path -> 200 with clam: unavailable), never 413-rejected
// — the handler streams the raw body and enforces its own ceiling at the inspectable-size cap.
#[tokio::test]
async fn a_body_over_the_stock_extractor_limit_is_accepted() {
    let base = serve(state_with_unreachable_clamd()).await;
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{base}/scan?contentType=application/octet-stream"))
        .body(vec![0u8; 3 * 1024 * 1024])
        .send()
        .await
        .unwrap();
    assert_ne!(
        response.status(),
        413,
        "a >2 MiB body must not be rejected by the body limit"
    );
    assert_eq!(response.status(), 200);
    let body: serde_json::Value =
        serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(body["clam"], serde_json::json!({ "state": "unavailable" }));
}
