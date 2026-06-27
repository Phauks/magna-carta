use axum::{
    extract::Path,
    routing::{get, put},
    Router,
};
use base64::Engine;
use magna_carta_bundle::{router, AppState};
use sevenz_rust2::{Password, SevenZReader};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

type Store = Arc<Mutex<HashMap<String, Vec<u8>>>>;

// Spawns the in-memory R2 stub (the owner Worker's outbound-Workers R2 mediation stands in here) and the
// bundle service pointed at it. Returns the bundle base URL and a handle to the shared store so the test
// can both seed inputs and read back the written volumes.
async fn spawn() -> (String, Store) {
    let store: Store = Arc::new(Mutex::new(HashMap::new()));
    let s_get = store.clone();
    let s_put = store.clone();
    let r2 = Router::new()
        .route(
            "/{*key}",
            get(move |Path(key): Path<String>| {
                let s = s_get.clone();
                async move {
                    s.lock()
                        .unwrap()
                        .get(&key)
                        .cloned()
                        .map(axum::body::Bytes::from)
                        .ok_or(axum::http::StatusCode::NOT_FOUND)
                }
            }),
        )
        .route(
            "/{*key}",
            put(move |Path(key): Path<String>, body: axum::body::Bytes| {
                let s = s_put.clone();
                async move {
                    s.lock().unwrap().insert(key, body.to_vec());
                    axum::http::StatusCode::OK
                }
            }),
        );
    let r2_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let r2_base = format!("http://{}", r2_listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(r2_listener, r2).await.unwrap() });

    let state = AppState {
        r2_base_url: Arc::from(r2_base.as_str()),
        http: reqwest::Client::new(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    (base, store)
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// POSTs a JSON manifest without relying on reqwest's optional `json` feature (serialize/parse with serde
// directly, since the crate already depends on serde_json).
async fn post_json(base: &str, manifest: &serde_json::Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{base}/build"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(manifest).unwrap())
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn zip_bundle_with_r2_and_inline_entries() {
    let (base, store) = spawn().await;
    store
        .lock()
        .unwrap()
        .insert("inputs/a".to_string(), b"alpha-content".to_vec());

    let manifest = serde_json::json!({
        "jobId": "job1",
        "format": "zip",
        "compression": "store",
        "entries": [
            { "archivePath": "a.txt", "mtimeEpochSecs": 1_700_000_000i64, "source": "r2", "r2Key": "inputs/a" },
            { "archivePath": "CONTENTS.txt", "mtimeEpochSecs": null, "source": "inline", "bytesBase64": b64(b"CONTENTS") },
        ],
        "outputKeyPrefix": "bundles/job1.zip",
    });

    let resp = post_json(&base, &manifest).await;
    let status = resp.status();
    let raw = resp.bytes().await.unwrap();
    assert_eq!(status, 200, "body: {}", String::from_utf8_lossy(&raw));
    let body: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(body["ok"], true);
    assert_eq!(body["volumes"].as_array().unwrap().len(), 1);
    assert_eq!(body["volumes"][0]["key"], "bundles/job1.zip");

    let written = store
        .lock()
        .unwrap()
        .get("bundles/job1.zip")
        .cloned()
        .unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(written)).unwrap();
    assert_eq!(archive.len(), 2);
    let mut s = String::new();
    archive
        .by_name("a.txt")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    assert_eq!(s, "alpha-content");
    let mut c = String::new();
    archive
        .by_name("CONTENTS.txt")
        .unwrap()
        .read_to_string(&mut c)
        .unwrap();
    assert_eq!(c, "CONTENTS");
}

#[tokio::test]
async fn encrypted_split_7z_bundle_reassembles_and_opens() {
    let (base, store) = spawn().await;
    // High-entropy payload (deterministic xorshift) so LZMA can't compress it below one small volume —
    // the archive must genuinely span several 1 KiB parts.
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    let payload: Vec<u8> = (0..8000)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x & 0xff) as u8
        })
        .collect();
    store
        .lock()
        .unwrap()
        .insert("inputs/big".to_string(), payload.clone());

    let manifest = serde_json::json!({
        "jobId": "job7z",
        "format": "sevenZip",
        "compression": "maximum",
        "encryption": { "password": "open sesame", "encryptFileNames": true },
        "split": { "maxPartBytes": 1024 },
        "entries": [
            { "archivePath": "data/big.bin", "mtimeEpochSecs": null, "source": "r2", "r2Key": "inputs/big" },
        ],
        "outputKeyPrefix": "bundles/job7z.7z",
    });

    let resp = post_json(&base, &manifest).await;
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = serde_json::from_slice(&resp.bytes().await.unwrap()).unwrap();
    assert_eq!(body["ok"], true);
    let volumes = body["volumes"].as_array().unwrap();
    assert!(volumes.len() > 1, "payload should span multiple volumes");
    assert_eq!(volumes[0]["key"], "bundles/job7z.7z.001");

    // Reassemble the volumes in order and open with the password.
    let store = store.lock().unwrap();
    let mut joined: Vec<u8> = Vec::new();
    for v in volumes {
        let key = v["key"].as_str().unwrap();
        joined.extend(store.get(key).cloned().unwrap());
    }
    let len = joined.len() as u64;
    let mut reader =
        SevenZReader::new(Cursor::new(joined), len, Password::from("open sesame")).unwrap();
    assert_eq!(reader.read_file("data/big.bin").unwrap(), payload);
}
