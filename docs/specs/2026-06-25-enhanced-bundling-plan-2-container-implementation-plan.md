# Enhanced Bundling — Plan 2: `containers/bundle` Rust encoder (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dedicated Rust Container that turns a bundle manifest into one or more archive volumes — ZIP (Deflate/store, AES-256, ZIP64) and 7z (LZMA2, AES-256, header encryption), with 7z format-native multi-volume splitting — reading inputs and writing outputs through the owner Worker's `env.R2` binding (outbound Workers), spooling the encoded archive to ephemeral disk and never buffering it in memory.

**Architecture:** An axum 0.8 HTTP service (`/ready`, `POST /build`) mirroring `containers/scan` (lib + thin bin on `:8080`). The Worker sends a **manifest only** — never bytes: `{ jobId, format, compression, encryption?, split?, entries[], outputKeyPrefix }`. The container fetches each entry's bytes by HTTP `GET {R2_BASE_URL}/{r2Key}` and writes each output volume by HTTP `PUT {R2_BASE_URL}/{outputKey}`; in production `R2_BASE_URL` is the outbound-Workers virtual host (`http://bundle-r2`) the owner Worker services via `env.R2`, and in CI/tests it is a local stub. Encoding streams each input into the encoder, which writes to a **temp file** (both `zip::ZipWriter` and `sevenz_rust2::ArchiveWriter` require `Write + Seek`); the finished file is then streamed to R2 (split into 7z volumes when requested). The encryption password travels in the request body (in-memory), is used only for encoding, and is never logged or written to disk.

**Tech Stack:** Rust 2021, `axum` 0.8, `tokio`, `serde`/`serde_json`, `zip` 8.6 (with `aes-crypto`), `sevenz-rust2` 0.7, `reqwest` 0.12 (R2 GET/PUT), `tempfile`. `linux/amd64` Cloudflare Container. No new C dependency (all pure-Rust crates — clean under golden rule 14).

## Global Constraints

- **Mirror `containers/scan`** (`containers/scan/CLAUDE.md`): lib (`src/lib.rs`, unit-testable router + modules) + thin bin (`src/main.rs`) serving `:8080`; multi-stage `Dockerfile`; the engine cannot run under `@cloudflare/vitest-pool-workers`, so verification is a **CI image-build acceptance gate**, not the worker test pool.
- **Crate pins verified against docs.rs before use** (golden rule 11). This environment does not compile the container; every crate API call below is written to the documented API, and the implementer MUST confirm the exact signature on docs.rs for the pinned version and adjust the call if it differs (the _behavior_ is fixed; the spelling may need a tweak). Pins: `axum 0.8`, `zip 8.6`, `sevenz-rust2 0.7`, `reqwest 0.12`, `tempfile 3`. Commit `Cargo.lock` (binary crate).
- **Code explains itself; no process-doc refs** (golden rule 13): no "ADR-NNNN", "spec", "Plan N", "spike", `§` in source/tests. Explain reasoning inline or cite a concrete file.
- **Names fully spelled out** (golden rule 12).
- **Never buffer the whole archive in memory.** Inputs stream from R2 into the encoder; the encoded archive lives on ephemeral disk; output streams to R2. The password is never logged or persisted.
- **The Rust⇄TS contract is the manifest + result JSON.** Keep it byte-compatible with the worker adapter (Plan 3); a change is a change on both sides (the same discipline `containers/scan` applies to `ScanResult`).
- **Split is 7z-only** (`docs/specs/2026-06-25-enhanced-bundling-plan-2-crate-feasibility-findings.md`): a `format:"zip"` request carrying `split` is rejected by the handler (defense in depth; the TS `validateOptionsForFormat` already rejects it).

**Build/test commands (run from `containers/bundle`):** `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`. The image/acceptance gate runs in CI (Task 7), not locally.

**Shared contract types (defined in Task 1, referenced throughout):**

```rust
// The manifest the Worker POSTs to /build. Bytes never appear here — only R2 keys (+ optional inline
// bytes for a generated CONTENTS file). The password is in-memory only and is never logged.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub job_id: String,
    pub format: Format,                 // "zip" | "sevenZip"
    pub compression: Compression,       // "store" | "normal" | "maximum"
    pub encryption: Option<Encryption>, // None = no encryption
    pub split: Option<Split>,           // None = single artifact; only valid for sevenZip
    pub entries: Vec<Entry>,            // already layout-resolved: archive_path is final
    pub output_key_prefix: String,      // volumes are written under this R2 key prefix
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Format { Zip, SevenZip }

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Compression { Store, Normal, Maximum }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Encryption { pub password: String, pub encrypt_file_names: bool }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Split { pub max_part_bytes: u64 }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub archive_path: String,          // the path inside the archive (already sanitized/wrapped/flattened)
    pub mtime_epoch_secs: Option<i64>, // original modified time; None → builder uses a fixed epoch
    #[serde(flatten)]
    pub source: EntrySource,
}

#[derive(serde::Deserialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum EntrySource {
    R2 { r2_key: String },             // fetched via GET {R2_BASE_URL}/{r2_key}
    Inline { bytes_base64: String },   // small generated content (e.g. the CONTENTS manifest)
}

// GOLDEN wire shape (must stay byte-identical to the worker's `BundleManifestEntry` in
// packages/file-manager/src/bundle-manifest.ts — the discriminator is FLATTENED onto the entry):
//   { "archivePath": "Pleadings/a.pdf", "mtimeEpochSecs": 1700000000, "source": "r2", "r2Key": "files/f1/v1" }
//   { "archivePath": "CONTENTS.txt",    "mtimeEpochSecs": null,       "source": "inline", "bytesBase64": "..." }
// NOT a nested `"source": { "source": "r2", ... }` object. `#[serde(flatten)]` over the internally-tagged
// enum produces exactly the flat form above.

// The /build response. `volumes` are the R2 keys written, in order.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResponse {
    pub ok: bool,
    pub volumes: Vec<Volume>,
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume { pub key: String, pub size_bytes: u64 }
```

---

### Task 1: Crate skeleton + `/ready` + contract types

**Files:**

- Create: `containers/bundle/Cargo.toml`, `containers/bundle/src/lib.rs`, `containers/bundle/src/main.rs`, `containers/bundle/src/contract.rs`, `containers/bundle/.gitignore`, `containers/bundle/.dockerignore`
- Test: `containers/bundle/tests/health.rs`

**Interfaces:**

- Produces: the contract types above (in `contract.rs`); `router(state: AppState) -> axum::Router`; `AppState { r2_base_url: Arc<str>, http: reqwest::Client }`.

- [ ] **Step 1: `Cargo.toml`**

```toml
[package]
name = "magna-carta-bundle"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
name = "magna_carta_bundle"
path = "src/lib.rs"

[[bin]]
name = "magna-carta-bundle"
path = "src/main.rs"

[dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# ZIP: Deflate + ZIP64 + AES write. Lean features — no bzip2/zstd/xz C deps (Windows-clean dev host).
zip = { version = "8.6", default-features = false, features = [
  "deflate-flate2",
  "aes-crypto",
  "time",
] }
# 7z: LZMA2 + AES-256 + header encryption, pure Rust.
sevenz-rust2 = "0.7"
# R2 transport: GET inputs / PUT output volumes against R2_BASE_URL (the outbound-Workers virtual host
# in prod, a local stub in tests). rustls so the image needs no system OpenSSL.
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
futures-util = { version = "0.3", default-features = false, features = ["std"] }
tempfile = "3"
base64 = "0.22"

[dev-dependencies]
# Local R2 stub + client for the handler/encoder tests.
axum = "0.8"
```

- [ ] **Step 2: Write the failing test**

```rust
// containers/bundle/tests/health.rs
use magna_carta_bundle::{router, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;

async fn spawn() -> String {
    let state = AppState { r2_base_url: Arc::from("http://unused"), http: reqwest::Client::new() };
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
```

- [ ] **Step 3: Run it (RED)**

Run: `cd containers/bundle && cargo test --test health`
Expected: FAIL to compile — `magna_carta_bundle` / `router` / `AppState` do not exist.

- [ ] **Step 4: Write `contract.rs`**

Put the **Shared contract types** block (above) into `containers/bundle/src/contract.rs`. Add `#![allow(dead_code)]` at the top of the file is NOT needed — every type is used by later tasks; if clippy flags an unused field before Task 6, that is expected and resolved when the handler lands.

- [ ] **Step 5: Write `lib.rs`**

```rust
// containers/bundle/src/lib.rs
use axum::{routing::get, Router};
use std::sync::Arc;

pub mod contract;
pub mod r2;       // Task 2
pub mod encode;   // Tasks 3-5
pub mod build;    // Task 6

/// Shared service state: the R2 base URL every entry GET / volume PUT is resolved against, and a reused
/// HTTP client. Cloned cheaply per request.
#[derive(Clone)]
pub struct AppState {
    pub r2_base_url: Arc<str>,
    pub http: reqwest::Client,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/ready", get(|| async { "ok" }))
        .route("/build", axum::routing::post(build::build_handler)) // Task 6 adds the handler
        .with_state(state)
}
```

Until Task 6 lands `build::build_handler`, temporarily register only `/ready` (drop the `/build` line) so the crate compiles; re-add `/build` in Task 6. Create empty `pub mod` files `r2.rs`, `encode.rs`, `build.rs` (each `// filled in a later task`) so `lib.rs` compiles. Remove the placeholder modules' emptiness as each task fills them.

- [ ] **Step 6: Write `main.rs`**

```rust
// containers/bundle/src/main.rs
use magna_carta_bundle::{router, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The owner Worker services R2 GET/PUT at this base via outbound Workers; defaults to the documented
    // virtual host. No credentials and no general egress live in this container.
    let r2_base_url = std::env::var("R2_BASE_URL").unwrap_or_else(|_| "http://bundle-r2".to_string());
    let state = AppState { r2_base_url: Arc::from(r2_base_url.as_str()), http: reqwest::Client::new() };
    let listener = TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
```

- [ ] **Step 7: Run it (GREEN), fmt, clippy, commit**

Run: `cd containers/bundle && cargo test --test health && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

```bash
git add containers/bundle
git commit -m "feat(bundle-container): crate skeleton, /ready, build manifest contract"
```

---

### Task 2: R2 I/O over the outbound-Workers base URL

**Files:**

- Modify: `containers/bundle/src/r2.rs`
- Test: `containers/bundle/tests/r2_roundtrip.rs`

**Interfaces:**

- Produces: `async fn get_to_writer(http, base, key, dst: &mut (impl Write)) -> Result<u64, R2Error>` (streams a GET body into `dst`, returns bytes written); `async fn put_file(http, base, key, file: tokio::fs::File, len: u64) -> Result<(), R2Error>` (streams a sized PUT). `enum R2Error`.

**Why:** the container never holds R2 credentials. It performs plain HTTP `GET`/`PUT` against `{base}/{key}`; in production the owner Worker intercepts that host (outbound Workers) and services it via `env.R2`. The PUT carries a known `Content-Length` (the spooled file's size) so R2 stores it (an unknown-length stream would be rejected).

- [ ] **Step 1: Write the failing test** (a local axum stub stands in for the Worker's R2 mediation)

```rust
// containers/bundle/tests/r2_roundtrip.rs
use axum::{extract::Path, routing::{get, put}, Router};
use magna_carta_bundle::r2::{get_to_writer, put_file};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

// A minimal in-memory R2 stub: GET returns stored bytes, PUT stores the body.
#[tokio::test]
async fn get_then_put_roundtrips_through_the_base_url() {
    let store: Arc<Mutex<std::collections::HashMap<String, Vec<u8>>>> = Arc::new(Mutex::new(
        std::collections::HashMap::from([("inputs/a".to_string(), b"hello world".to_vec())]),
    ));
    let s1 = store.clone();
    let app = Router::new()
        .route("/{*key}", get(move |Path(key): Path<String>| {
            let s = s1.clone();
            async move { s.lock().unwrap().get(&key).cloned().map(axum::body::Bytes::from)
                .ok_or(axum::http::StatusCode::NOT_FOUND) }
        }))
        .route("/{*key}", put({
            let s2 = store.clone();
            move |Path(key): Path<String>, body: axum::body::Bytes| {
                let s = s2.clone();
                async move { s.lock().unwrap().insert(key, body.to_vec()); axum::http::StatusCode::OK }
            }
        }));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let http = reqwest::Client::new();
    let mut buf: Vec<u8> = Vec::new();
    let n = get_to_writer(&http, &base, "inputs/a", &mut buf).await.unwrap();
    assert_eq!(n, 11);
    assert_eq!(buf, b"hello world");

    // round-trip a PUT: write buf to a temp file, PUT it, GET it back
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out");
    std::fs::write(&path, b"archive-bytes").unwrap();
    let file = tokio::fs::File::open(&path).await.unwrap();
    put_file(&http, &base, "outputs/out.zip", file, 13).await.unwrap();
    let mut got: Vec<u8> = Vec::new();
    get_to_writer(&http, &base, "outputs/out.zip", &mut got).await.unwrap();
    assert_eq!(got, b"archive-bytes");
}
```

- [ ] **Step 2: Run it (RED)**

Run: `cd containers/bundle && cargo test --test r2_roundtrip`
Expected: FAIL — `r2::get_to_writer` / `put_file` do not exist.

- [ ] **Step 3: Implement `r2.rs`**

```rust
// containers/bundle/src/r2.rs
use futures_util::StreamExt;
use std::io::Write;

#[derive(Debug)]
pub enum R2Error {
    Http(reqwest::Error),
    Status(reqwest::StatusCode),
    Io(std::io::Error),
}
impl std::fmt::Display for R2Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            R2Error::Http(e) => write!(f, "r2 http error: {e}"),
            R2Error::Status(s) => write!(f, "r2 unexpected status: {s}"),
            R2Error::Io(e) => write!(f, "r2 io error: {e}"),
        }
    }
}
impl std::error::Error for R2Error {}

fn url(base: &str, key: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), key.trim_start_matches('/'))
}

/// Streams `GET {base}/{key}` into `dst` chunk-by-chunk (the body never fully buffers in memory).
/// Returns the number of bytes written.
pub async fn get_to_writer<W: Write>(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    dst: &mut W,
) -> Result<u64, R2Error> {
    let resp = http.get(url(base, key)).send().await.map_err(R2Error::Http)?;
    if !resp.status().is_success() {
        return Err(R2Error::Status(resp.status()));
    }
    let mut total = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(R2Error::Http)?;
        dst.write_all(&chunk).map_err(R2Error::Io)?;
        total += chunk.len() as u64;
    }
    Ok(total)
}

/// Streams a sized `PUT {base}/{key}` from a file. The explicit Content-Length (`len`) is required —
/// R2 rejects an unknown-length body. The file is consumed as a streaming body, never read into memory.
pub async fn put_file(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    file: tokio::fs::File,
    len: u64,
) -> Result<(), R2Error> {
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = reqwest::Body::wrap_stream(stream);
    let resp = http
        .put(url(base, key))
        .header(reqwest::header::CONTENT_LENGTH, len)
        .body(body)
        .send()
        .await
        .map_err(R2Error::Http)?;
    if !resp.status().is_success() {
        return Err(R2Error::Status(resp.status()));
    }
    Ok(())
}
```

Add `tokio-util = { version = "0.7", features = ["io"] }` to `[dependencies]` (the `ReaderStream` adapter).

- [ ] **Step 4: Run it (GREEN), fmt, clippy, commit**

Run: `cd containers/bundle && cargo test --test r2_roundtrip && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

```bash
git add containers/bundle
git commit -m "feat(bundle-container): R2 GET/PUT streaming over the outbound-Workers base URL"
```

---

### Task 3: ZIP encoder (store/Deflate, AES, ZIP64, timestamps)

**Files:**

- Modify: `containers/bundle/src/encode.rs`
- Test: `containers/bundle/tests/encode_zip.rs`

**Interfaces:**

- Produces: `trait EntryReader` (an entry's bytes as a `Read`); `struct LocalEntry { archive_path, mtime_epoch_secs, reader }`; `fn encode_zip(entries: impl Iterator<Item = LocalEntry>, compression: Compression, encryption: Option<&Encryption>, out: &mut (impl Write + Seek)) -> Result<(), EncodeError>`.

**Notes for the implementer (confirm against docs.rs `zip` 8.6):** `zip::write::ZipWriter::new(out)`; per file `FileOptions::default().compression_method(...).large_file(true)` for ZIP64; `.with_aes_encryption(zip::AesMode::Aes256, password)` when encrypting; `.last_modified_time(zip::DateTime::...)` for the timestamp; `writer.start_file(archive_path, options)?` then `std::io::copy(reader, &mut writer)?`; `writer.finish()?`. Map compression: `Store → Stored`, `Normal → Deflated` (default level), `Maximum → Deflated` with the max level via `.compression_level(Some(9))`.

- [ ] **Step 1: Write the failing test**

```rust
// containers/bundle/tests/encode_zip.rs
use magna_carta_bundle::contract::{Compression, Encryption};
use magna_carta_bundle::encode::{encode_zip, LocalEntry};
use std::io::{Cursor, Read};

fn entries() -> Vec<LocalEntry> {
    vec![
        LocalEntry::from_bytes("Pleadings/a.txt", Some(1_700_000_000), b"alpha".to_vec()),
        LocalEntry::from_bytes("b.txt", None, b"bravo".to_vec()),
    ]
}

#[test]
fn plain_store_zip_round_trips() {
    let mut out = Cursor::new(Vec::new());
    encode_zip(entries().into_iter(), Compression::Store, None, &mut out).unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(out.into_inner())).unwrap();
    assert_eq!(archive.len(), 2);
    let mut s = String::new();
    archive.by_name("Pleadings/a.txt").unwrap().read_to_string(&mut s).unwrap();
    assert_eq!(s, "alpha");
}

#[test]
fn aes_zip_opens_with_password_and_rejects_wrong_one() {
    let mut out = Cursor::new(Vec::new());
    let enc = Encryption { password: "correct horse".into(), encrypt_file_names: false };
    encode_zip(entries().into_iter(), Compression::Maximum, Some(&enc), &mut out).unwrap();
    let bytes = out.into_inner();

    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.clone())).unwrap();
    let mut s = String::new();
    archive.by_name_decrypt("b.txt", b"correct horse").unwrap().read_to_string(&mut s).unwrap();
    assert_eq!(s, "bravo");

    let mut archive2 = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    assert!(archive2.by_name_decrypt("b.txt", b"wrong").is_err());
}
```

(Confirm the `zip` reader's decrypt method name on docs.rs — `by_name_decrypt`/`by_index_decrypt` — and adjust the test call if the 8.6 spelling differs. The _behavior_ asserted is fixed: right password reads, wrong password errors.)

- [ ] **Step 2: Run it (RED)**

Run: `cd containers/bundle && cargo test --test encode_zip`
Expected: FAIL — `encode::encode_zip` / `LocalEntry` do not exist.

- [ ] **Step 3: Implement the ZIP path in `encode.rs`**

```rust
// containers/bundle/src/encode.rs
use crate::contract::{Compression, Encryption};
use std::io::{Read, Seek, Write};

#[derive(Debug)]
pub enum EncodeError {
    Zip(zip::result::ZipError),
    Io(std::io::Error),
    SevenZip(String),       // Task 4
    SplitNotSupported,      // Task 5 (zip + split guard)
}
impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::Zip(e) => write!(f, "zip encode error: {e}"),
            EncodeError::Io(e) => write!(f, "io error: {e}"),
            EncodeError::SevenZip(m) => write!(f, "7z encode error: {m}"),
            EncodeError::SplitNotSupported => write!(f, "zip does not support multi-volume splitting"),
        }
    }
}
impl std::error::Error for EncodeError {}

/// One archive entry's content as a reader, with its destination path and original modified time.
pub struct LocalEntry {
    pub archive_path: String,
    pub mtime_epoch_secs: Option<i64>,
    pub reader: Box<dyn Read + Send>,
}
impl LocalEntry {
    pub fn from_bytes(path: &str, mtime: Option<i64>, bytes: Vec<u8>) -> Self {
        LocalEntry { archive_path: path.to_string(), mtime_epoch_secs: mtime,
            reader: Box::new(std::io::Cursor::new(bytes)) }
    }
}

fn zip_options(
    compression: Compression,
    encryption: Option<&Encryption>,
    mtime_epoch_secs: Option<i64>,
) -> zip::write::FileOptions<'static, ()> {
    use zip::write::FileOptions;
    let mut options = FileOptions::default().large_file(true); // ZIP64 always
    options = match compression {
        Compression::Store => options.compression_method(zip::CompressionMethod::Stored),
        Compression::Normal => options.compression_method(zip::CompressionMethod::Deflated),
        Compression::Maximum => options
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(9)),
    };
    if let Some(secs) = mtime_epoch_secs {
        if let Some(dt) = epoch_to_zip_datetime(secs) {
            options = options.last_modified_time(dt);
        }
    }
    if let Some(enc) = encryption {
        options = options.with_aes_encryption(zip::AesMode::Aes256, &enc.password);
    }
    options
}

/// Streams each entry into a ZIP written to `out` (a seekable sink — the temp file). ZIP64 is forced on
/// so large/many-file bundles are always valid; AES-256 encrypts contents when requested (ZIP-AES never
/// hides file names — that is the format, not a choice). Original timestamps are preserved when supplied.
pub fn encode_zip(
    entries: impl Iterator<Item = LocalEntry>,
    compression: Compression,
    encryption: Option<&Encryption>,
    out: &mut (impl Write + Seek),
) -> Result<(), EncodeError> {
    let mut writer = zip::ZipWriter::new(out);
    for mut entry in entries {
        let options = zip_options(compression, encryption, entry.mtime_epoch_secs);
        writer.start_file(&entry.archive_path, options).map_err(EncodeError::Zip)?;
        std::io::copy(&mut entry.reader, &mut writer).map_err(EncodeError::Io)?;
    }
    writer.finish().map_err(EncodeError::Zip)?;
    Ok(())
}

/// Converts a Unix epoch to the ZIP `DateTime`. Returns None for times the DOS-derived ZIP format cannot
/// represent (before 1980 / after 2107); the caller then omits the timestamp rather than failing.
fn epoch_to_zip_datetime(secs: i64) -> Option<zip::DateTime> {
    // Confirm the exact `zip::DateTime` constructor on docs.rs 8.6 (try_from a time::OffsetDateTime with
    // the `time` feature). Behavior: build a DateTime for `secs`, or None if out of the 1980..=2107 range.
    let odt = time::OffsetDateTime::from_unix_timestamp(secs).ok()?;
    zip::DateTime::try_from(odt).ok()
}
```

Add `time = "0.3"` to `[dependencies]` (the `time` feature of `zip` re-exports it; an explicit dep keeps `epoch_to_zip_datetime` readable).

- [ ] **Step 4: Run it (GREEN), fmt, clippy, commit**

Run: `cd containers/bundle && cargo test --test encode_zip && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

```bash
git add containers/bundle
git commit -m "feat(bundle-container): ZIP encoder (store/Deflate, AES-256, ZIP64, timestamps)"
```

---

### Task 4: 7z encoder (LZMA2, AES-256, header encryption)

**Files:**

- Modify: `containers/bundle/src/encode.rs`
- Test: `containers/bundle/tests/encode_7z.rs`

**Interfaces:**

- Produces: `fn encode_7z(entries: impl Iterator<Item = LocalEntry>, compression: Compression, encryption: Option<&Encryption>, out: &mut (impl Write + Seek)) -> Result<(), EncodeError>`.

**Notes (confirm against docs.rs `sevenz-rust2` 0.7):** `sevenz_rust2::ArchiveWriter::new(out)?`; `writer.set_content_methods(vec![...])` with `AesEncoderOptions::new(password)` (push it BEFORE the LZMA2 method so content is compressed then encrypted) and `Lzma2Options::from_level(level)`; `writer.set_encrypt_header(encrypt_file_names)`; add each entry via the writer's add-reader/add-entry API (e.g. `writer.push_archive_entry(SevenZArchiveEntry::from_path/name(...), Some(reader))?` — confirm the exact constructor); `writer.finish()?`. Compression level: `Store → 0`, `Normal → 5`, `Maximum → 9`.

- [ ] **Step 1: Write the failing test**

```rust
// containers/bundle/tests/encode_7z.rs
use magna_carta_bundle::contract::{Compression, Encryption};
use magna_carta_bundle::encode::{encode_7z, LocalEntry};
use std::io::Cursor;

fn entries() -> Vec<LocalEntry> {
    vec![LocalEntry::from_bytes("docs/a.txt", Some(1_700_000_000), b"alpha".to_vec())]
}

#[test]
fn plain_7z_round_trips() {
    let mut out = Cursor::new(Vec::new());
    encode_7z(entries().into_iter(), Compression::Normal, None, &mut out).unwrap();
    let bytes = out.into_inner();
    // Read back with sevenz-rust2 and assert the entry content (confirm the reader API on docs.rs).
    let archive = sevenz_rust2::ArchiveReader::new(Cursor::new(bytes), sevenz_rust2::Password::empty()).unwrap();
    assert!(archive.archive().files.iter().any(|f| f.name() == "docs/a.txt"));
}

#[test]
fn encrypted_7z_opens_with_password_and_rejects_wrong_one() {
    let mut out = Cursor::new(Vec::new());
    let enc = Encryption { password: "correct horse".into(), encrypt_file_names: true };
    encode_7z(entries().into_iter(), Compression::Maximum, Some(&enc), &mut out).unwrap();
    let bytes = out.into_inner();
    // Right password: header (names) decrypts and the entry is present.
    let ok = sevenz_rust2::ArchiveReader::new(Cursor::new(bytes.clone()),
        sevenz_rust2::Password::from("correct horse"));
    assert!(ok.is_ok());
    // Wrong password with header encryption on: opening the archive fails.
    let bad = sevenz_rust2::ArchiveReader::new(Cursor::new(bytes), sevenz_rust2::Password::from("wrong"));
    assert!(bad.is_err());
}
```

(Confirm `ArchiveReader`/`Password` spellings on docs.rs 0.7 and adjust; the asserted behavior — round-trip, right-vs-wrong password — is fixed.)

- [ ] **Step 2: Run it (RED)** → `cargo test --test encode_7z` fails (`encode_7z` missing).

- [ ] **Step 3: Implement the 7z path in `encode.rs`**

```rust
// add to encode.rs
use crate::contract::{Compression as C, Encryption as E}; // alias to avoid clashing imports if needed

pub fn encode_7z(
    entries: impl Iterator<Item = LocalEntry>,
    compression: Compression,
    encryption: Option<&Encryption>,
    out: &mut (impl Write + Seek),
) -> Result<(), EncodeError> {
    use sevenz_rust2::encoder_options::{AesEncoderOptions, Lzma2Options};
    let mut writer = sevenz_rust2::ArchiveWriter::new(out).map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    let level: u32 = match compression { Compression::Store => 0, Compression::Normal => 5, Compression::Maximum => 9 };
    // Order matters: compress THEN encrypt. When encrypting, header encryption hides the file list iff
    // encrypt_file_names is set.
    let mut methods = Vec::new();
    if let Some(enc) = encryption {
        methods.push(AesEncoderOptions::new(enc.password.as_str().into()).into());
        writer.set_encrypt_header(enc.encrypt_file_names);
    } else {
        writer.set_encrypt_header(false);
    }
    methods.push(Lzma2Options::from_level(level).into());
    writer.set_content_methods(methods);
    for mut entry in entries {
        // Confirm the exact add-entry signature on docs.rs 0.7. Behavior: add an entry named
        // `archive_path` whose content is read from `entry.reader`, carrying mtime when present.
        let mut meta = sevenz_rust2::SevenZArchiveEntry::default();
        meta.name = entry.archive_path.clone();
        if let Some(secs) = entry.mtime_epoch_secs { meta.last_modified_date = seven_z_time(secs); meta.has_last_modified_date = true; }
        writer.push_archive_entry(meta, Some(&mut entry.reader))
            .map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    }
    writer.finish().map_err(|e| EncodeError::SevenZip(e.to_string()))?;
    Ok(())
}

/// Confirm the 7z time type on docs.rs (Windows FILETIME-style). Behavior: convert a Unix epoch to the
/// crate's timestamp type; this helper isolates that conversion.
fn seven_z_time(epoch_secs: i64) -> sevenz_rust2::NtTime { sevenz_rust2::NtTime::from_unix_time(epoch_secs) }
```

(The `SevenZArchiveEntry` field names / `NtTime` constructor are the items most likely to differ from this sketch — confirm each on docs.rs 0.7 and adjust spelling. The structure — methods vector with AES before LZMA2, `set_encrypt_header`, per-entry push with a reader, `finish` — is the documented shape.)

- [ ] **Step 4: Run it (GREEN), fmt, clippy, commit**

```bash
git add containers/bundle
git commit -m "feat(bundle-container): 7z encoder (LZMA2, AES-256, header encryption)"
```

---

### Task 5: 7z multi-volume splitting (byte-split of the spooled archive)

**Files:**

- Create: `containers/bundle/src/split.rs` (+ `pub mod split;` in `lib.rs`)
- Test: `containers/bundle/tests/split.rs`

**Interfaces:**

- Produces: `fn split_file_into_volumes(path: &Path, max_part_bytes: u64) -> Result<Vec<PathBuf>, std::io::Error>` — cuts a file into `<path>.001`, `.002`, … each ≤ `max_part_bytes` (the last smaller), returning the part paths in order. A file at or under the limit still produces a single `.001` (7z volume convention). Concatenating the parts reproduces the original bytes exactly.

**Why:** a 7z multi-volume archive is the single `.7z` stream cut into fixed-size pieces (`docs/specs/2026-06-25-enhanced-bundling-plan-2-crate-feasibility-findings.md`); 7-Zip reassembles by reading `.001` onward. ZIP never reaches this code (the handler rejects `format:"zip" + split`).

- [ ] **Step 1: Write the failing test**

```rust
// containers/bundle/tests/split.rs
use magna_carta_bundle::split::split_file_into_volumes;

#[test]
fn splits_into_ordered_parts_that_concatenate_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("archive.7z");
    std::fs::write(&path, (0u8..=255).cycle().take(2500).collect::<Vec<_>>()).unwrap();
    let parts = split_file_into_volumes(&path, 1000).unwrap();
    assert_eq!(parts.len(), 3); // 1000 + 1000 + 500
    assert!(parts[0].to_string_lossy().ends_with(".001"));
    assert!(parts[2].to_string_lossy().ends_with(".003"));
    let joined: Vec<u8> = parts.iter().flat_map(|p| std::fs::read(p).unwrap()).collect();
    assert_eq!(joined, std::fs::read(&path).unwrap());
}

#[test]
fn small_file_still_yields_one_001_part() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.7z");
    std::fs::write(&path, b"tiny").unwrap();
    let parts = split_file_into_volumes(&path, 1_000_000).unwrap();
    assert_eq!(parts.len(), 1);
    assert!(parts[0].to_string_lossy().ends_with(".001"));
}
```

- [ ] **Step 2: Run it (RED)** → fails (`split` module missing).

- [ ] **Step 3: Implement `split.rs`**

```rust
// containers/bundle/src/split.rs
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Cuts `path` into `<path>.NNN` volumes of at most `max_part_bytes` each (1-based, zero-padded to 3
/// digits, more digits only if needed). The parts concatenated in order reproduce the file byte-for-byte
/// — which is exactly how a 7z multi-volume archive reassembles. A file at/under the limit yields one
/// `.001` part (the 7z volume convention; recipients always point their tool at `.001`).
pub fn split_file_into_volumes(path: &Path, max_part_bytes: u64) -> Result<Vec<PathBuf>, std::io::Error> {
    assert!(max_part_bytes > 0, "max_part_bytes must be positive (validated upstream)");
    let mut input = std::fs::File::open(path)?;
    let mut parts = Vec::new();
    let mut index = 1usize;
    let mut buf = vec![0u8; 64 * 1024];
    let mut remaining_in_part = 0u64;
    let mut current: Option<std::fs::File> = None;
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 { break; }
        let mut written = 0usize;
        while written < n {
            if remaining_in_part == 0 {
                let part_path = volume_path(path, index);
                current = Some(std::fs::File::create(&part_path)?);
                parts.push(part_path);
                index += 1;
                remaining_in_part = max_part_bytes;
            }
            let take = std::cmp::min((n - written) as u64, remaining_in_part) as usize;
            current.as_mut().unwrap().write_all(&buf[written..written + take])?;
            written += take;
            remaining_in_part -= take as u64;
        }
    }
    if parts.is_empty() {
        // An empty input still gets one (empty) .001 so the volume set is never zero-length.
        let part_path = volume_path(path, 1);
        std::fs::File::create(&part_path)?;
        parts.push(part_path);
    }
    Ok(parts)
}

fn volume_path(path: &Path, index: usize) -> PathBuf {
    let width = 3.max(((index as f64).log10().floor() as usize) + 1);
    PathBuf::from(format!("{}.{:0width$}", path.display(), index, width = width))
}
```

- [ ] **Step 4: Run it (GREEN), fmt, clippy, commit**

```bash
git add containers/bundle
git commit -m "feat(bundle-container): 7z multi-volume byte-split of the spooled archive"
```

---

### Task 6: The `POST /build` handler (manifest → fetch → encode → split → PUT)

**Files:**

- Modify: `containers/bundle/src/build.rs`, `containers/bundle/src/lib.rs` (re-add the `/build` route)
- Test: `containers/bundle/tests/build_e2e.rs`

**Interfaces:**

- Produces: `pub async fn build_handler(State(state): State<AppState>, Json(req): Json<BuildRequest>) -> Response`.

**Flow:** validate (reject `Zip + split`); for each entry, open a temp spill file and stream its bytes into it (R2 GET for `R2` source, base64-decode for `Inline`) — producing a `LocalEntry` reader over the spill file; encode (zip or 7z) into an output temp file (seekable); if `split`, cut the output into volumes else keep one; PUT each volume to `{output_key_prefix}.NNN` (or `{output_key_prefix}` for a single ZIP); return `BuildResponse`. Inputs and output both transit ephemeral disk, never fully in memory. The password (in `req.encryption`) is used only for `encode_*` and never logged.

- [ ] **Step 1: Write the failing end-to-end test** (local R2 stub serves inputs + captures outputs)

```rust
// containers/bundle/tests/build_e2e.rs
// Spins the bundle router with R2_BASE_URL pointed at a local in-memory R2 stub; POSTs a manifest for a
// ZIP and a 7z bundle; asserts the written volume(s) re-open and contain the entries. (Full stub + client
// setup mirrors tests/r2_roundtrip.rs — reuse that harness shape.)
```

Write the concrete test using the same in-memory R2 stub as `tests/r2_roundtrip.rs`: seed `inputs/a` and `inputs/b`; POST `{format:"zip", compression:"store", entries:[{source:"r2", r2Key:"inputs/a", archivePath:"a.txt"}, {source:"inline", bytesBase64:<base64 "CONTENTS">, archivePath:"CONTENTS.txt"}], outputKeyPrefix:"bundles/job1.zip"}`; assert a `200` `BuildResponse{ ok:true, volumes:[{key:"bundles/job1.zip", ..}] }` and that GET-ing that key yields a ZIP whose `a.txt`/`CONTENTS.txt` read back correctly. Repeat for `{format:"sevenZip", split:{maxPartBytes: small}, encryption:{password,encryptFileNames:true}}` asserting multiple `.001/.002` volumes that reassemble and open with the password.

- [ ] **Step 2: Run it (RED).**

- [ ] **Step 3: Implement `build.rs`** (handler skeleton — fill the documented call shapes)

```rust
// containers/bundle/src/build.rs
use crate::contract::{BuildRequest, BuildResponse, Entry, EntrySource, Format, Volume};
use crate::encode::{encode_7z, encode_zip, LocalEntry};
use crate::{r2, split, AppState};
use axum::{extract::State, http::StatusCode, response::{IntoResponse, Response}, Json};
use base64::Engine;

pub async fn build_handler(State(state): State<AppState>, Json(req): Json<BuildRequest>) -> Response {
    match build(&state, req).await {
        Ok(volumes) => Json(BuildResponse { ok: true, volumes, error: None }).into_response(),
        Err(message) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(BuildResponse { ok: false, volumes: vec![], error: Some(message) }),
        ).into_response(),
    }
}

async fn build(state: &AppState, req: BuildRequest) -> Result<Vec<Volume>, String> {
    if matches!(req.format, Format::Zip) && req.split.is_some() {
        return Err("zip does not support multi-volume splitting".into());
    }
    // 1. Spill every input to a temp file (R2 GET or inline), building LocalEntry readers over them.
    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut locals: Vec<LocalEntry> = Vec::with_capacity(req.entries.len());
    let mut spill_paths = Vec::new(); // keep files alive until encoding is done
    for (i, entry) in req.entries.iter().enumerate() {
        let spill = scratch.path().join(format!("in-{i}"));
        let mut file = std::fs::File::create(&spill).map_err(|e| e.to_string())?;
        match &entry.source {
            EntrySource::R2 { r2_key } => {
                r2::get_to_writer(&state.http, &state.r2_base_url, r2_key, &mut file)
                    .await.map_err(|e| e.to_string())?;
            }
            EntrySource::Inline { bytes_base64 } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(bytes_base64).map_err(|e| e.to_string())?;
                std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
            }
        }
        drop(file);
        spill_paths.push(spill.clone());
        locals.push(LocalEntry {
            archive_path: entry.archive_path.clone(),
            mtime_epoch_secs: entry.mtime_epoch_secs,
            reader: Box::new(std::fs::File::open(&spill).map_err(|e| e.to_string())?),
        });
    }
    // 2. Encode into an output temp file (seekable).
    let out_path = scratch.path().join("archive.out");
    {
        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        let enc = req.encryption.as_ref();
        match req.format {
            Format::Zip => encode_zip(locals.into_iter(), req.compression, enc, &mut out),
            Format::SevenZip => encode_7z(locals.into_iter(), req.compression, enc, &mut out),
        }.map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
    }
    // 3. Split (7z only) or keep single; PUT each volume.
    let parts: Vec<std::path::PathBuf> = match &req.split {
        Some(split) => split::split_file_into_volumes(&out_path, split.max_part_bytes)
            .map_err(|e| e.to_string())?,
        None => vec![out_path.clone()],
    };
    let mut volumes = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let key = if req.split.is_some() {
            format!("{}.{:03}", req.output_key_prefix, i + 1)
        } else {
            req.output_key_prefix.clone()
        };
        let len = std::fs::metadata(part).map_err(|e| e.to_string())?.len();
        let file = tokio::fs::File::open(part).await.map_err(|e| e.to_string())?;
        r2::put_file(&state.http, &state.r2_base_url, &key, file, len).await.map_err(|e| e.to_string())?;
        volumes.push(Volume { key, size_bytes: len });
    }
    Ok(volumes)
}
```

- [ ] **Step 4: Re-add the `/build` route in `lib.rs`** (it was registered in Task 1's router; confirm it points at `build::build_handler`).

- [ ] **Step 5: Run the e2e test (GREEN), fmt, clippy, commit**

```bash
git add containers/bundle
git commit -m "feat(bundle-container): /build handler — manifest to encoded, split, R2-written volumes"
```

---

### Task 7: Dockerfile, ignore files, area CLAUDE.md, CI acceptance gate

**Files:**

- Create: `containers/bundle/Dockerfile`, `containers/bundle/CLAUDE.md`
- Modify: the CI workflow that builds container images (mirror the `scan-container` job) to add a `bundle-container` job that builds the image and runs the acceptance gate.
- Create: `containers/bundle/tests/acceptance.sh` (build the image, run it with `R2_BASE_URL` pointed at a tiny local stub, POST a manifest, verify the written archive re-opens).

**Notes:** mirror `containers/scan/Dockerfile` — a multi-stage `linux/amd64` build (Rust builder → slim runtime), copying the `magna-carta-bundle` binary, `EXPOSE 8080`, no signature DB and **no `enableInternet`** (the container needs no general egress; R2 goes through the owner Worker). The acceptance gate is the real verification (the crate cannot run under the worker test pool).

- [ ] **Step 1: Write `Dockerfile`** (mirror `containers/scan/Dockerfile`'s builder/runtime split; no clamd/freshclam stages, no baked DB).

- [ ] **Step 2: Write `CLAUDE.md`** (purpose, key files, the manifest⇄result contract is the Rust⇄TS boundary, the disk-spool + no-memory-buffer invariant, split-is-7z-only, password-never-logged, crate pins verified, the deploy-time-activation / acceptance-gate note — mirroring `containers/scan/CLAUDE.md`).

- [ ] **Step 3: Write `tests/acceptance.sh`** — `docker build` the image; `docker run` it with `R2_BASE_URL` at a local stub container/server; `curl -X POST /build` with a manifest; assert `ok:true` and that the captured output re-opens (unzip / 7z list). Mirror `containers/scan/tests/eicar_e2e.sh`.

- [ ] **Step 4: Add the CI job** mirroring `scan-container` so the image build + acceptance gate run on changes under `containers/bundle/`.

- [ ] **Step 5: Commit**

```bash
git add containers/bundle .github  # or the repo's CI config location
git commit -m "build(bundle-container): Dockerfile, area CLAUDE.md, CI image-build acceptance gate"
```

---

## Self-review

- **Spec coverage:** manifest contract + service (Task 1); credential-free R2 I/O via outbound-Workers base URL (Task 2); ZIP encoder — store/Deflate/AES/ZIP64/timestamps (Task 3); 7z encoder — LZMA2/AES-256/header encryption (Task 4); 7z byte-split volumes, ZIP guarded out (Task 5); the `/build` orchestration with disk-spool + inline CONTENTS entry (Task 6); Dockerfile + CLAUDE.md + CI acceptance gate (Task 7). Matches the design's "heavy lane" and the feasibility findings (disk-spool output model, split 7z-only, outbound-Workers data flow).
- **Out of this plan:** the worker side — the `BundleContainer` Container class + `outboundByHost` `env.R2` handler, extending `apps/worker/src/downloads/` (coordinator/queue/routes) for `BundleOptions`, multi-volume artifacts, and the encrypted in-memory-password path; threading the `file_version` SHA-256 into the inline CONTENTS entry. That is **Plan 3** (worker orchestration). UI is **Plan 4**.
- **Crate-API caveat:** this environment does not compile Rust; every `zip`/`sevenz-rust2` call is written to the documented API with an inline "confirm the signature on docs.rs" note where the spelling is most likely to differ (golden rule 11). The asserted _behavior_ in each test is fixed; the implementer adjusts call spellings to compile, never the behavior.
- **Type consistency:** the contract types (Task 1) are consumed by the handler (Task 6); `LocalEntry`/`encode_zip`/`encode_7z` (Tasks 3-4) and `split_file_into_volumes` (Task 5) are consumed by Task 6; `r2::get_to_writer`/`put_file` (Task 2) by Task 6.

## Follow-on (not Plan 2)

- **Plan 3 — worker orchestration:** `BundleContainer` (`@cloudflare/containers` Container class) + the `outboundByHost` R2 handler; extend `downloads/` (coordinator, `bundle-build` queue, routes) to send the manifest, carry `BundleOptions`, handle multi-volume artifacts + the poll/sign of each volume, and the encrypted single-flight (password in-memory, no durable queue, no cache); generate the inline CONTENTS entry from the `file_version` hashes; keep the `client-zip` fast lane for plain ZIP.
- **Plan 4 — UI:** the bundle-options surface gating off `FORMAT_CAPABILITIES` (split hidden for ZIP), masked-password "never stored" notice.
