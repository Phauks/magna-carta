use magna_carta_scan::{heuristics::ArchiveCaps, router, yara, AppState};
use std::sync::Arc;

// The router with clamd pointed at a port nothing listens on, so every clamd connect fails and the
// signature engine reports unavailable — without needing a real daemon.
fn state_with_unreachable_clamd() -> AppState {
    AppState {
        rules: Arc::new(yara::build_rules(&[])),
        clamd_address: "127.0.0.1:1".into(),
        caps: ArchiveCaps::default(),
        engine_version: "test".into(),
    }
}

async fn serve(state: AppState) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router(state)).await;
    });
    format!("http://{addr}")
}

// A clamd-unavailable, otherwise-clean body must NOT come back as a 200 verdict (which the ingest
// consumer would commit) — it must be a 503 the consumer retries, so a transient signature-engine fault
// never lets a never-virus-scanned file become usable. The verdict precedence that keeps a definitive
// bad signal (infected / suspicious / encrypted) a 200 even while clamd is down is covered by the
// combine unit tests in src/verdict.rs.
#[tokio::test]
async fn clean_body_with_unreachable_clamd_is_a_retryable_503() {
    let base = serve(state_with_unreachable_clamd()).await;
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{base}/scan?contentType=text/plain"))
        .body(b"a perfectly ordinary clean body".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
}

// A real document is far larger than axum's stock 2 MiB extractor cap. A 3 MiB body must be accepted and
// scanned (here it reaches the unreachable-clamd path -> 503), never 413-rejected — the handler streams
// the raw body and enforces its own ceiling at the inspectable-size cap.
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
    assert_eq!(response.status(), 503);
}
