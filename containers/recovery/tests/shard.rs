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

// ---------------------------------------------------------------------------
// Encryption-header read (POST /extract-hash)
//
// The status code is the whole contract: 200 carries a hash, 422 carries a stable code about the
// FILE, and a 5xx means this service could not answer. The caller turns those into a result, a 400,
// and a retryable 503, so a test that lets two of them blur is testing nothing.
// ---------------------------------------------------------------------------

/// The committed RC4-128 fixture, password "test" — the same bytes crates/decryption-core's own
/// tests parse, so the two agree on what this file is.
const ENCRYPTED_PDF: &[u8] =
    include_bytes!("../../../crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf");

#[tokio::test]
async fn extract_hash_returns_the_hash_mode_and_tier_for_an_encrypted_pdf() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/extract-hash"))
        .body(ENCRYPTED_PDF)
        .send()
        .await
        .expect("POST /extract-hash");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.expect("json body");
    assert_eq!(body["format"], "pdf");
    assert_eq!(body["hashcatMode"], 10500);
    assert_eq!(body["tier"], "cfCapable");
    assert!(
        body["hash"]
            .as_str()
            .expect("hash string")
            .starts_with("$pdf$"),
        "the hash must be the hashcat-consumable string"
    );
}

#[tokio::test]
async fn extract_hash_refuses_unencrypted_bytes_with_a_stable_code_not_a_fault() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/extract-hash"))
        .body("this is not an encrypted document".as_bytes())
        .send()
        .await
        .expect("POST /extract-hash");

    // 422, never a 5xx: the service answered, and the answer is about the submitted file.
    assert_eq!(response.status(), 422);
    let body: serde_json::Value = response.json().await.expect("json body");
    assert!(
        matches!(
            body["code"].as_str(),
            Some("notEncrypted" | "unsupported" | "malformed")
        ),
        "the refusal must carry one of the stable codes, got {body}"
    );
}

#[tokio::test]
async fn extract_hash_rejects_an_empty_body() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/extract-hash"))
        .body(Vec::<u8>::new())
        .send()
        .await
        .expect("POST /extract-hash");

    assert_eq!(
        response.status(),
        400,
        "no bytes is a caller error, not a verdict on a file"
    );
}

#[tokio::test]
async fn extract_hash_accepts_a_body_past_axums_two_megabyte_default() {
    // The default body limit would reject ordinary encrypted documents. Pad the fixture well past
    // it and assert the handler still reads it (as a refusal here — the padded bytes are no longer
    // a valid PDF — which is a 422 from the parser, not a 413 from the framework).
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let mut padded = ENCRYPTED_PDF.to_vec();
    padded.resize(4 * 1024 * 1024, 0);

    let response = Client::new()
        .post(format!("{base}/extract-hash"))
        .body(padded)
        .send()
        .await
        .expect("POST /extract-hash");

    assert_ne!(
        response.status(),
        413,
        "a multi-megabyte encrypted document must reach the parser"
    );
}

// ---------------------------------------------------------------------------
// Password decrypt (POST /unlock)
//
// The same three-code contract the header read runs on — 200 plaintext, 422 a stable code about the
// file or the password, 5xx this service could not answer — over a body that carries a member's own
// document password. The assertions below that look like formatting details are the framing that
// keeps that password out of a URL, a header, and a deserializer's error text.
// ---------------------------------------------------------------------------

/// Frame an unlock body: a big-endian `u32` password length, the password, then the file.
fn unlock_body(password: &str, file: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(4 + password.len() + file.len());
    body.extend_from_slice(&(password.len() as u32).to_be_bytes());
    body.extend_from_slice(password.as_bytes());
    body.extend_from_slice(file);
    body
}

#[tokio::test]
async fn unlock_returns_the_plaintext_for_the_right_password() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/unlock"))
        .body(unlock_body("test", ENCRYPTED_PDF))
        .send()
        .await
        .expect("POST /unlock");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.expect("json body");
    assert_eq!(body["format"], "pdf");
    let decrypted = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        body["decryptedBase64"].as_str().expect("base64 string"),
    )
    .expect("the reply must decode");
    assert!(
        decrypted.starts_with(b"%PDF"),
        "the reply must carry the decrypted document"
    );
}

#[tokio::test]
async fn unlock_refuses_a_wrong_password_with_a_stable_code_not_a_fault() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/unlock"))
        .body(unlock_body("not-the-password", ENCRYPTED_PDF))
        .send()
        .await
        .expect("POST /unlock");

    // 422, never a 5xx: the service answered, and the answer is about what was submitted.
    assert_eq!(response.status(), 422);
    let text = response.text().await.expect("body text");
    assert!(
        text.contains("wrongPassword"),
        "the refusal must carry the stable code, got {text}"
    );
    assert!(
        !text.contains("not-the-password"),
        "a refusal must never echo the password back: {text}"
    );
}

#[tokio::test]
async fn unlock_refuses_unencrypted_bytes_with_a_stable_code() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/unlock"))
        .body(unlock_body("test", b"this is not an encrypted document"))
        .send()
        .await
        .expect("POST /unlock");

    assert_eq!(response.status(), 422);
    let body: serde_json::Value = response.json().await.expect("json body");
    assert!(
        matches!(
            body["code"].as_str(),
            Some("notEncrypted" | "unsupported" | "malformed")
        ),
        "the refusal must carry one of the stable codes, got {body}"
    );
}

#[tokio::test]
async fn unlock_rejects_a_body_that_carries_no_file_after_the_password() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let response = Client::new()
        .post(format!("{base}/unlock"))
        .body(unlock_body("swordfish", b""))
        .send()
        .await
        .expect("POST /unlock");

    assert_eq!(
        response.status(),
        400,
        "a body with no document is a caller error, not a verdict on a file"
    );
    let text = response.text().await.expect("body text");
    assert!(
        !text.contains("swordfish"),
        "a framing complaint must never quote the body: {text}"
    );
}

#[tokio::test]
async fn unlock_accepts_a_body_past_axums_two_megabyte_default() {
    let (state, _temp) = state_with_words(&["foo"]);
    let base = spawn_server(state).await;

    let mut padded = ENCRYPTED_PDF.to_vec();
    padded.resize(4 * 1024 * 1024, 0);

    let response = Client::new()
        .post(format!("{base}/unlock"))
        .body(unlock_body("test", &padded))
        .send()
        .await
        .expect("POST /unlock");

    assert_ne!(
        response.status(),
        413,
        "a multi-megabyte encrypted document must reach the decryptor"
    );
}
