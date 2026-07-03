// Integration tests for the recovery HTTP server. Each test spawns the router
// on an ephemeral port and drives it with `reqwest`, mirroring the pattern used
// by `containers/scan/tests/health.rs`.

use decryption_core::parse_rules;
use magna_carta_recovery::{router, server::AppState};
use reqwest::Client;
use std::io::Write;
use std::sync::Arc;
use tempfile::NamedTempFile;

// hashcat example_hashes mode 9600 (MS Office 2013 agile). Password is "hashcat".
// Source: https://hashcat.net/wiki/doku.php?id=example_hashes
const OFFICE_2013_EXAMPLE: &str = "$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b\
     *948dc0b2c2c6c32f14b5995a543ad037\
     *0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895";

/// Write a temporary wordlist file and build `AppState` pointing at it.
fn state_with_words(words: &[&str]) -> (AppState, NamedTempFile) {
    let mut file = NamedTempFile::new().expect("temp wordlist file");
    for word in words {
        writeln!(file, "{word}").expect("write word");
    }
    file.flush().expect("flush wordlist");

    let wordlist: Vec<String> = words.iter().map(|w| w.to_string()).collect();
    let noop_rules = parse_rules(":").expect("noop rule parses");

    let state = AppState {
        wordlist: Arc::new(wordlist),
        best64_rules: Arc::new(noop_rules),
    };
    (state, file)
}

/// Spawn the router on an ephemeral port and return the base URL.
async fn spawn_server(state: AppState) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral port");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        let _ = axum::serve(listener, router(state)).await;
    });
    format!("http://{addr}")
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ready_returns_ok() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = reqwest::get(format!("{base}/ready"))
        .await
        .expect("GET /ready");
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.expect("body"), "ok");
}

// ---------------------------------------------------------------------------
// Password found in wordlist
// ---------------------------------------------------------------------------

#[tokio::test]
async fn finds_password_when_present() {
    // Small wordlist containing "hashcat" — the known password for OFFICE_2013_EXAMPLE.
    let (state, _temp) = state_with_words(&["foo", "bar", "hashcat", "baz"]);
    let base = spawn_server(state).await;

    let client = Client::new();
    let body = serde_json::json!({
        "hash": OFFICE_2013_EXAMPLE,
        "format": "ooxml",
        "hashcatMode": 9600,
        "shardIndex": 0,
        "shardCount": 1,
        "ruleSet": "none"
    });

    let response = client
        .post(format!("{base}/recover-shard"))
        .json(&body)
        .send()
        .await
        .expect("POST /recover-shard");

    assert_eq!(response.status(), 200);
    let json: serde_json::Value = response.json().await.expect("parse JSON");
    assert_eq!(
        json["found"].as_str(),
        Some("hashcat"),
        "must find the known password in the wordlist"
    );
    assert!(
        json["candidatesTried"].as_u64().unwrap_or(0) >= 1,
        "candidatesTried must be >= 1"
    );
}

// ---------------------------------------------------------------------------
// Password absent from wordlist
// ---------------------------------------------------------------------------

#[tokio::test]
async fn returns_null_when_password_absent() {
    // Wordlist that does NOT contain the password "hashcat".
    let (state, _temp) = state_with_words(&["alpha", "beta", "gamma"]);
    let base = spawn_server(state).await;

    let client = Client::new();
    let body = serde_json::json!({
        "hash": OFFICE_2013_EXAMPLE,
        "format": "ooxml",
        "hashcatMode": 9600,
        "shardIndex": 0,
        "shardCount": 1,
        "ruleSet": "none"
    });

    let response = client
        .post(format!("{base}/recover-shard"))
        .json(&body)
        .send()
        .await
        .expect("POST /recover-shard");

    assert_eq!(response.status(), 200);
    let json: serde_json::Value = response.json().await.expect("parse JSON");
    assert!(
        json["found"].is_null(),
        "found must be null when password is not in the wordlist"
    );
}

// ---------------------------------------------------------------------------
// Malformed body → 400
// ---------------------------------------------------------------------------

#[tokio::test]
async fn malformed_body_returns_400() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let client = Client::new();
    // Send a body that is not valid JSON for the request schema.
    let response = client
        .post(format!("{base}/recover-shard"))
        .header("content-type", "application/json")
        .body(r#"{ "notAField": true }"#)
        .send()
        .await
        .expect("POST /recover-shard");

    assert_eq!(response.status(), 400, "malformed body must yield 400");
}

// ---------------------------------------------------------------------------
// Container self-splits the keyspace from shardIndex/shardCount
// ---------------------------------------------------------------------------

#[tokio::test]
async fn resolves_shard_range_by_index_and_count() {
    // "hashcat" sits at index 1 of a 4-word list. Splitting into 2 shards puts
    // it in shard 0 (words 0..2); shard 1 (words 2..4) must miss it.
    let (state, _temp) = state_with_words(&["foo", "hashcat", "bar", "baz"]);
    let base = spawn_server(state).await;
    let client = Client::new();

    let hit_body = serde_json::json!({
        "hash": OFFICE_2013_EXAMPLE,
        "format": "ooxml",
        "hashcatMode": 9600,
        "shardIndex": 0,
        "shardCount": 2,
        "ruleSet": "none"
    });
    let hit = client
        .post(format!("{base}/recover-shard"))
        .json(&hit_body)
        .send()
        .await
        .expect("POST /recover-shard");
    assert_eq!(hit.status(), 200);
    let hit_json: serde_json::Value = hit.json().await.expect("parse JSON");
    assert_eq!(
        hit_json["found"],
        serde_json::json!("hashcat"),
        "shard 0 of 2 covers index 1 and must find the password"
    );

    let miss_body = serde_json::json!({
        "hash": OFFICE_2013_EXAMPLE,
        "format": "ooxml",
        "hashcatMode": 9600,
        "shardIndex": 1,
        "shardCount": 2,
        "ruleSet": "none"
    });
    let miss = client
        .post(format!("{base}/recover-shard"))
        .json(&miss_body)
        .send()
        .await
        .expect("POST /recover-shard");
    assert_eq!(miss.status(), 200);
    let miss_json: serde_json::Value = miss.json().await.expect("parse JSON");
    assert_eq!(
        miss_json["found"],
        serde_json::json!(null),
        "shard 1 of 2 does not cover index 1 and must not find the password"
    );
}

#[tokio::test]
async fn rejects_out_of_range_shard() {
    let (state, _temp) = state_with_words(&["a", "b"]);
    let base = spawn_server(state).await;
    let client = Client::new();

    for (shard_index, shard_count) in [(2usize, 2usize), (0, 0)] {
        let body = serde_json::json!({
            "hash": OFFICE_2013_EXAMPLE,
            "format": "ooxml",
            "hashcatMode": 9600,
            "shardIndex": shard_index,
            "shardCount": shard_count,
            "ruleSet": "none"
        });
        let response = client
            .post(format!("{base}/recover-shard"))
            .json(&body)
            .send()
            .await
            .expect("POST /recover-shard");
        assert_eq!(
            response.status(),
            400,
            "shardIndex {shard_index} of {shard_count} must be 400"
        );
    }
}

// ---------------------------------------------------------------------------
// Unknown format → 400
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unknown_format_returns_400() {
    let (state, _temp) = state_with_words(&["hashcat"]);
    let base = spawn_server(state).await;

    let client = Client::new();
    let body = serde_json::json!({
        "hash": OFFICE_2013_EXAMPLE,
        "format": "unknown_format",
        "hashcatMode": 9600,
        "shardIndex": 0,
        "shardCount": 1,
        "ruleSet": "none"
    });

    let response = client
        .post(format!("{base}/recover-shard"))
        .json(&body)
        .send()
        .await
        .expect("POST /recover-shard");

    assert_eq!(
        response.status(),
        400,
        "an unknown format string must yield 400"
    );
}

// ---------------------------------------------------------------------------
// Malformed hash → 400
// ---------------------------------------------------------------------------

#[tokio::test]
async fn malformed_hash_returns_400() {
    let (state, _temp) = state_with_words(&["hashcat"]);
    let base = spawn_server(state).await;

    let client = Client::new();
    let body = serde_json::json!({
        "hash": "not-a-valid-office-hash",
        "format": "ooxml",
        "hashcatMode": 9600,
        "shardIndex": 0,
        "shardCount": 1,
        "ruleSet": "none"
    });

    let response = client
        .post(format!("{base}/recover-shard"))
        .json(&body)
        .send()
        .await
        .expect("POST /recover-shard");

    assert_eq!(response.status(), 400, "a malformed hash must yield 400");
}
