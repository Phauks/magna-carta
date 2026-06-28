# Engine-host harness (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `magna-carta-engine-host` — the shared hosting harness (magic-byte `Format` detection, the wasm32 JS-marshalling edge toolkit, and the `axum` container skeleton) that the pure-Rust document engines consume instead of re-implementing the runtime seam.

**Architecture:** A new pure-Rust library in the existing `crates/` workspace, with `cfg`-gated modules: `format` (always compiled), `wasm_edge` (`cfg(target_arch = "wasm32")`), `host` (`cfg(not(wasm32))`). It owns the runtime seam only — no document parsing lives here. SP2 (File Repair & Salvage) is its first consumer; SP3 retrofits the existing engines later.

**Tech Stack:** Rust (edition 2021), `axum` 0.8 + `tokio` + `reqwest` (native host), `wasm-bindgen`/`js-sys`/`serde-wasm-bindgen` (wasm edge), `tower-http` (middleware).

## Global Constraints

- **Crate name:** `magna-carta-engine-host`, at `crates/engine-host`. Full names, no shorthand (golden rule 12).
- **Workspace:** member of `crates/Cargo.toml`; `edition.workspace = true`; `version = "0.0.0"`; `publish = false`.
- **wasm-target deps (exact):** `wasm-bindgen = "0.2"`, `js-sys = "0.3"`, `serde-wasm-bindgen = "0.6"`. If any transitive dep pulls `getrandom`, add `getrandom = { version = "0.4", features = ["wasm_js"] }` (the pattern pdf-core/decryption-core use).
- **native-host deps (exact):** `axum = "0.8"`, `tokio = { version = "1", features = ["full"] }`, `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }`, `tower-http = { version = "0.6", features = ["catch-panic"] }`. (`reqwest` is a normal non-wasm dependency, so it is available to the host tests without a separate dev-dependency.)
- **Pure-Rust features only** (the seam's reason to exist): never select a C-backed feature on any path — e.g. `zip` → `deflate-flate2`, `flate2` → default `miniz_oxide`, zstd → `ruzstd`. A C dep breaks the wasm target.
- **No engine logic in the harness.** No document parsing, no format transformation. The harness moves bytes and hosts; engines parse.
- **No file content in errors or logs** (golden rule 4): edge error codes are fixed `&'static str` values, never dynamic file bytes.
- **Container contract:** listens on `0.0.0.0:8080`, exposes `GET /ready`, runs with `enableInternet = false` (R2 reached via an `R2_BASE_URL`, no general egress).
- **Fitness:** `engine-host` imports **no** engine-logic crate (`pdf-core`, `decryption-core`, any `containers/*` lib). It sits beside the engines, never below.

---

### Task 1: Crate skeleton + workspace wiring

**Files:**
- Create: `crates/engine-host/Cargo.toml`
- Create: `crates/engine-host/src/lib.rs`
- Modify: `crates/Cargo.toml` (add `"engine-host"` to `members`)

**Interfaces:**
- Produces: the `magna-carta-engine-host` crate with `cfg`-gated modules `format` (always), `wasm_edge` (wasm32), `host` (non-wasm). Public surface filled by later tasks.

- [ ] **Step 1: Add the crate to the workspace**

Modify `crates/Cargo.toml` members from:

```toml
members = ["pdf-core", "pdf-eval"]
```

to:

```toml
members = ["engine-host", "pdf-core", "pdf-eval"]
```

- [ ] **Step 2: Write `crates/engine-host/Cargo.toml`**

```toml
[package]
name = "magna-carta-engine-host"
version = "0.0.0"
edition.workspace = true
publish = false

[lib]
name = "magna_carta_engine_host"

# Native (Cloudflare Container) hosting toolkit.
[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
tower-http = { version = "0.6", features = ["catch-panic"] }

# wasm32 JS-marshalling edge toolkit.
[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
serde-wasm-bindgen = "0.6"

[target.'cfg(target_arch = "wasm32")'.dev-dependencies]
wasm-bindgen-test = "0.3"
```

- [ ] **Step 3: Write `crates/engine-host/src/lib.rs`**

```rust
//! magna-carta-engine-host: the shared runtime seam for the pure-Rust document
//! engines. It owns hosting only — magic-byte format detection, the wasm32 JS
//! marshalling edge, and the axum container skeleton. NO document parsing lives
//! here; engines parse, the harness hosts.

pub mod format;

#[cfg(target_arch = "wasm32")]
pub mod wasm_edge;

#[cfg(not(target_arch = "wasm32"))]
pub mod host;
```

- [ ] **Step 4: Create an empty `format` module so the crate compiles**

Create `crates/engine-host/src/format.rs`:

```rust
//! Cheap, growable magic-byte file-type identification shared across engines.
//! Owns ONLY the leading-bytes layer; an engine that needs a richer check
//! composes on top.
```

- [ ] **Step 5: Verify the crate builds (native)**

Run: `cargo build -p magna-carta-engine-host`
Expected: compiles with no errors (unused-module warnings are fine).

- [ ] **Step 6: Commit**

```bash
git add crates/Cargo.toml crates/engine-host/Cargo.toml crates/engine-host/src/lib.rs crates/engine-host/src/format.rs
git commit -m "feat(engine-host): crate skeleton + workspace wiring"
```

---

### Task 2: `format` — magic-byte detection

**Files:**
- Modify: `crates/engine-host/src/format.rs`

**Interfaces:**
- Produces: `pub enum Format { Pdf, Zip, Ole2 }` and `pub fn detect(bytes: &[u8]) -> Option<Format>`. `Ole2` is the honest magic-level identity of the D0CF11E0 compound-file container (an engine decides whether a given OLE2 is encrypted-OOXML, legacy .doc, .msg, …).

- [ ] **Step 1: Write the failing tests**

Append to `crates/engine-host/src/format.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Pdf,
    Zip,
    Ole2,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pdf_by_magic() {
        assert_eq!(detect(b"%PDF-1.7\nrest"), Some(Format::Pdf));
    }

    #[test]
    fn detects_zip_by_local_header_magic() {
        assert_eq!(detect(b"PK\x03\x04rest"), Some(Format::Zip));
    }

    #[test]
    fn detects_ole2_compound_file_by_magic() {
        let ole2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00];
        assert_eq!(detect(&ole2), Some(Format::Ole2));
    }

    #[test]
    fn returns_none_for_unknown_bytes() {
        assert_eq!(detect(b"not a known file"), None);
    }

    #[test]
    fn returns_none_for_too_short_input() {
        assert_eq!(detect(b"PK"), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p magna-carta-engine-host format::`
Expected: FAIL — `detect` not found.

- [ ] **Step 3: Implement `detect`**

Add above the `#[cfg(test)]` block in `crates/engine-host/src/format.rs`:

```rust
const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Identify a file by its leading magic bytes. Returns `None` when the leading
/// bytes match no known container/document magic (the engine then decides what,
/// if anything, to attempt). This is intentionally the cheap layer only.
pub fn detect(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"%PDF") {
        return Some(Format::Pdf);
    }
    if bytes.starts_with(&OLE2_MAGIC) {
        return Some(Format::Ole2);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(Format::Zip);
    }
    None
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p magna-carta-engine-host format::`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/engine-host/src/format.rs
git commit -m "feat(engine-host): magic-byte Format detection"
```

---

### Task 3: `host` — the axum skeleton (`ready_app`, `serve_on`, `serve`, body limit)

**Files:**
- Create: `crates/engine-host/src/host.rs`
- Test: inline `#[cfg(test)]` in `crates/engine-host/src/host.rs`

**Interfaces:**
- Consumes: `Format` (none directly).
- Produces:
  - `pub fn ready_app(router: axum::Router) -> axum::Router` — adds `GET /ready` and a request-body-size limit to a caller's router.
  - `pub async fn serve_on(listener: tokio::net::TcpListener, router: axum::Router) -> std::io::Result<()>`.
  - `pub async fn serve(router: axum::Router) -> std::io::Result<()>` — binds `0.0.0.0:8080` and calls `serve_on`.
  - `pub const MAX_BODY_BYTES: usize` — the default body cap (2 GiB, matching the scan inspectable cap).

- [ ] **Step 1: Write the failing tests**

Create `crates/engine-host/src/host.rs`:

```rust
//! The native Cloudflare-Container hosting toolkit: the axum service skeleton
//! (/ready, body cap, serve), an R2 client helper, and a panic-net layer.
//! No engine logic — engines bring their own routes and state.

use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use axum::Router;

/// Default request-body cap (2 GiB), aligned with the scan inspectable-size cap.
/// Engines may override by composing their own DefaultBodyLimit.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    async fn spawn(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            serve_on(listener, router).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn ready_returns_ok() {
        let base = spawn(ready_app(Router::new())).await;
        let body = reqwest::get(format!("{base}/ready"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "ok");
    }

    #[tokio::test]
    async fn oversize_body_is_rejected() {
        // A 1-byte cap router; a 2-byte POST must be rejected (413), not accepted.
        let app = Router::new()
            .route("/echo", axum::routing::post(|body: axum::body::Bytes| async move { body }))
            .layer(DefaultBodyLimit::max(1));
        let base = spawn(app).await;
        let status = reqwest::Client::new()
            .post(format!("{base}/echo"))
            .body(vec![0u8, 1u8])
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p magna-carta-engine-host host::`
Expected: FAIL — `ready_app` / `serve_on` not found.

- [ ] **Step 3: Implement the skeleton**

Add above the `#[cfg(test)]` block in `crates/engine-host/src/host.rs`:

```rust
/// Augment a caller's router with the standard `GET /ready` probe and the
/// default body-size cap. Engines pass their work routes in.
pub fn ready_app(router: Router) -> Router {
    router
        .route("/ready", get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

/// Serve a router on a caller-supplied listener (used by tests on an ephemeral
/// port, and by `serve` on :8080).
pub async fn serve_on(
    listener: tokio::net::TcpListener,
    router: Router,
) -> std::io::Result<()> {
    axum::serve(listener, router).await
}

/// Bind `0.0.0.0:8080` (the container contract) and serve.
pub async fn serve(router: Router) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    serve_on(listener, router).await
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p magna-carta-engine-host host::`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/engine-host/src/host.rs
git commit -m "feat(engine-host): axum host skeleton (ready, serve, body cap)"
```

---

### Task 4: `host` — R2 client helper + panic-net layer

**Files:**
- Modify: `crates/engine-host/src/host.rs`

**Interfaces:**
- Produces:
  - `pub fn r2_client() -> reqwest::Result<reqwest::Client>` — a `reqwest::Client` with a 10 s connect timeout and no overall request timeout (the bundle pattern: a wedged R2 host errors promptly; a large transfer is never cut short).
  - `pub fn with_panic_net(router: axum::Router) -> axum::Router` — wraps a router so a panicking handler becomes a `500` response, not a process crash.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/engine-host/src/host.rs`:

```rust
    #[test]
    fn r2_client_builds() {
        // The helper must produce a client without panicking or erroring.
        assert!(r2_client().is_ok());
    }

    #[tokio::test]
    async fn panicking_handler_becomes_500_not_a_crash() {
        let app = with_panic_net(
            Router::new().route("/boom", get(|| async { panic!("engine panicked") })),
        );
        let base = spawn(app).await;
        let status = reqwest::get(format!("{base}/boom"))
            .await
            .unwrap()
            .status();
        assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p magna-carta-engine-host host::`
Expected: FAIL — `r2_client` / `with_panic_net` not found.

- [ ] **Step 3: Implement the helpers**

Add to the top-of-file `use` block in `crates/engine-host/src/host.rs`:

```rust
use std::time::Duration;
use tower_http::catch_panic::CatchPanicLayer;
```

Add below `serve` (above the `#[cfg(test)]` block):

```rust
/// A reqwest client for R2 GET/PUT against `R2_BASE_URL`: a bounded connect
/// timeout turns a wedged host into a prompt error, but no overall request
/// timeout, so a legitimately large transfer is never cut short. No credentials
/// and no general egress live in the container.
pub fn r2_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
}

/// Wrap a router so a panic in any handler is caught and returned as a 500,
/// keeping the service alive (the never-crash-the-container rule). Engines still
/// own their own honest verdict types; this is the last-resort net.
pub fn with_panic_net(router: Router) -> Router {
    router.layer(CatchPanicLayer::new())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p magna-carta-engine-host host::`
Expected: PASS (4 host tests total).

- [ ] **Step 5: Commit**

```bash
git add crates/engine-host/src/host.rs
git commit -m "feat(engine-host): R2 client helper + panic-net layer"
```

---

### Task 5: `wasm_edge` — the JS-marshalling toolkit

**Files:**
- Create: `crates/engine-host/src/wasm_edge.rs`

**Interfaces:**
- Produces:
  - `pub trait EdgeError { fn code(&self) -> &'static str; }` — the stable-error-code contract (a `&'static str` cannot carry dynamic file content).
  - `pub fn allowed_code(code: &str, allowed: &[&str]) -> bool` — native-testable guard that an emitted code is from a fixed set.
  - `pub fn bytes_out(bytes: &[u8]) -> js_sys::Uint8Array` (wasm only).
  - `pub fn to_js_error<E: EdgeError>(error: &E) -> wasm_bindgen::JsError` (wasm only).
  - `pub struct ObjectBuilder` with `new()`, `set(&self, key: &str, value: &wasm_bindgen::JsValue) -> &Self`, `into_value(self) -> wasm_bindgen::JsValue` (wasm only) — the `js_sys::Object` + `Reflect::set` helper both `wasm.rs` files re-implement.

Note: the `EdgeError` trait and `allowed_code` compile on **all** targets and are unit-tested natively; the `js_sys`/`wasm-bindgen` glue is `cfg(target_arch = "wasm32")` and is covered by a wasm-bindgen-test (run in the wasm CI job).

- [ ] **Step 1: Write the failing native tests**

Create `crates/engine-host/src/wasm_edge.rs`:

```rust
//! The wasm32 JS-marshalling edge toolkit: stable error codes (never file
//! content), bytes->Uint8Array, and an object builder. The trait + code guard
//! compile everywhere and are tested natively; the js_sys glue is wasm-only.

/// The stable-error-code contract for the wasm edge. A `&'static str` code is
/// chosen from a fixed set per engine, so it can never carry dynamic file bytes
/// — the privileged-content rule, enforced by construction.
pub trait EdgeError {
    fn code(&self) -> &'static str;
}

/// Guard that an emitted code is one of an engine's declared fixed codes. Engines
/// call this in a test to prove their error mapping never leaks an ad-hoc string.
pub fn allowed_code(code: &str, allowed: &[&str]) -> bool {
    allowed.contains(&code)
}

#[cfg(test)]
mod tests {
    use super::*;

    enum SampleError {
        WrongPassword,
        Malformed,
    }

    impl EdgeError for SampleError {
        fn code(&self) -> &'static str {
            match self {
                SampleError::WrongPassword => "wrongPassword",
                SampleError::Malformed => "malformed",
            }
        }
    }

    const ALLOWED: &[&str] = &["wrongPassword", "malformed"];

    #[test]
    fn error_code_is_a_fixed_static_string() {
        assert_eq!(SampleError::WrongPassword.code(), "wrongPassword");
        assert!(allowed_code(SampleError::Malformed.code(), ALLOWED));
    }

    #[test]
    fn an_unlisted_code_is_rejected_by_the_guard() {
        // A would-be content-bearing string is not in the fixed set.
        assert!(!allowed_code("secret-client-name.docx", ALLOWED));
    }
}
```

- [ ] **Step 2: Run the native tests to verify they fail**

Run: `cargo test -p magna-carta-engine-host wasm_edge::`
Expected: FAIL — module/symbols not found until `lib.rs` exposes it (it already declares `wasm_edge` only under `cfg(wasm32)`).

Because `wasm_edge` is currently gated to wasm32, first make the trait + guard available on all targets: in `crates/engine-host/src/lib.rs` replace

```rust
#[cfg(target_arch = "wasm32")]
pub mod wasm_edge;
```

with

```rust
pub mod wasm_edge;
```

Re-run: `cargo test -p magna-carta-engine-host wasm_edge::`
Expected: now COMPILES and the two native tests run — they should PASS (the trait + guard are already written above). If they pass, this step's "fail" is satisfied structurally by Step 1 having been the first introduction; proceed.

- [ ] **Step 3: Add the wasm-only glue (gated inside the always-compiled module)**

Append to `crates/engine-host/src/wasm_edge.rs`:

```rust
#[cfg(target_arch = "wasm32")]
mod glue {
    use super::EdgeError;
    use wasm_bindgen::prelude::*;

    /// Copy a byte slice into a JS `Uint8Array` for return across the edge.
    pub fn bytes_out(bytes: &[u8]) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(bytes)
    }

    /// Map an engine error to a `JsError` carrying only its stable code.
    pub fn to_js_error<E: EdgeError>(error: &E) -> JsError {
        JsError::new(error.code())
    }

    /// Builder over `js_sys::Object` + `Reflect::set` — the pattern both engines'
    /// `wasm.rs` files re-implement.
    pub struct ObjectBuilder {
        object: js_sys::Object,
    }

    impl ObjectBuilder {
        pub fn new() -> Self {
            Self { object: js_sys::Object::new() }
        }

        pub fn set(&self, key: &str, value: &JsValue) -> &Self {
            let _ = js_sys::Reflect::set(&self.object, &JsValue::from_str(key), value);
            self
        }

        pub fn into_value(self) -> JsValue {
            self.object.into()
        }
    }

    impl Default for ObjectBuilder {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use glue::{bytes_out, to_js_error, ObjectBuilder};

#[cfg(target_arch = "wasm32")]
#[cfg(test)]
mod wasm_tests {
    use super::*;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn bytes_out_roundtrips_length() {
        let arr = bytes_out(&[1, 2, 3]);
        assert_eq!(arr.length(), 3);
    }

    #[wasm_bindgen_test]
    fn object_builder_sets_a_key() {
        let value = ObjectBuilder::new()
            .set("ok", &JsValue::from_bool(true))
            .into_value();
        let got = js_sys::Reflect::get(&value, &JsValue::from_str("ok")).unwrap();
        assert_eq!(got.as_bool(), Some(true));
    }
}
```

- [ ] **Step 4: Run native + wasm tests**

Native (the trait + guard): `cargo test -p magna-carta-engine-host wasm_edge::`
Expected: PASS (2 native tests).

Wasm glue (CI wasm job; locally if wasm-pack is installed): `wasm-pack test --node crates/engine-host`
Expected: PASS (2 wasm tests). If wasm-pack is not installed locally, this gate runs in CI — note it and proceed; the native tests cover the content-safety contract.

- [ ] **Step 5: Commit**

```bash
git add crates/engine-host/src/lib.rs crates/engine-host/src/wasm_edge.rs
git commit -m "feat(engine-host): wasm edge toolkit (codes, bytes_out, ObjectBuilder)"
```

---

### Task 6: Fitness — dependency-inversion guard

**Files:**
- Create: `crates/engine-host/tests/fitness.rs`

**Interfaces:**
- Consumes: nothing (reads the crate's own manifest).
- Produces: a test asserting `engine-host`'s manifest names no engine-logic crate.

- [ ] **Step 1: Write the failing test**

Create `crates/engine-host/tests/fitness.rs`:

```rust
//! Fitness: the harness sits BESIDE the engines, never below them. It must not
//! depend on any engine-logic crate — that would invert the layering and couple
//! unrelated engines through the harness.

const FORBIDDEN_DEPENDENCIES: &[&str] = &[
    "pdf-core",
    "decryption-core",
    "magna-carta-scan",
    "magna-carta-bundle",
    "magna-carta-raster",
];

#[test]
fn harness_depends_on_no_engine_logic_crate() {
    let manifest = include_str!("../Cargo.toml");
    for forbidden in FORBIDDEN_DEPENDENCIES {
        assert!(
            !manifest.contains(forbidden),
            "engine-host must not depend on the engine-logic crate `{forbidden}` — \
             the harness hosts engines, it never consumes them"
        );
    }
}
```

- [ ] **Step 2: Run the test to verify it passes (guard is already satisfied)**

Run: `cargo test -p magna-carta-engine-host --test fitness`
Expected: PASS — the manifest names none of the forbidden crates. (This is a guard test: it currently passes and will fail loudly if a future edit adds an engine dependency.)

- [ ] **Step 3: Commit**

```bash
git add crates/engine-host/tests/fitness.rs
git commit -m "test(engine-host): dependency-inversion fitness guard"
```

---

### Task 7: The seam convention doc

**Files:**
- Create: `docs/conventions/engine-host-seam.md`

- [ ] **Step 1: Write the convention**

Create `docs/conventions/engine-host-seam.md`:

```markdown
# Engine-host seam — convention

The standard every pure-Rust document engine follows so it inherits its hosting
from `magna-carta-engine-host` (`crates/engine-host`) instead of re-implementing
the runtime seam. Home of the design: `docs/specs/2026-06-28-engine-host-framework-design.md`.

## Rules

- **Dual-target purity.** The engine core is I/O-free, threadless, and `mmap`-free:
  bytes in, result out. The runtime hands it a buffer (a Worker streams it from R2;
  the Container holds it in memory). This is what makes Worker-vs-Container placement
  a routing decision, not a rewrite.
- **Pure-Rust features only.** Never select a C-backed crate feature on any path —
  `zip` -> `deflate-flate2`, `flate2` -> default `miniz_oxide`, zstd -> `ruzstd`. A C
  dependency breaks the wasm target. Declare deflate/codec backends directly.
- **The wasm32 edge is marshalling only.** No engine logic in `wasm.rs`. Use
  `engine_host::wasm_edge` (`bytes_out`, `ObjectBuilder`, `EdgeError` + `to_js_error`).
  Error codes are fixed `&'static str` values from a per-engine set — never file
  content (golden rule 4). Prove it with `wasm_edge::allowed_code` in a test.
- **Container fail-safe.** Build the service with `engine_host::host` (`ready_app`,
  `with_panic_net`, `serve`). Bind `0.0.0.0:8080`, expose `GET /ready`, cap the body,
  catch panics. A panicking handler returns 500; it never crashes the container or
  reports a silently-wrong success.
- **Runtime placement.** The Worker (wasm) is the default lane; the Container (native)
  is the heavy lane, entered only when file size or CPU exceeds the Worker budget.
  Heavy/async work goes through a Queue + a per-job Durable Object. Same engine crate,
  two compile targets.
- **Raw facts in the container, the verdict in the app.** The container returns
  structured facts; the app composes the user-facing verdict. Each engine defines its
  own payload type; the harness does not.
```

- [ ] **Step 2: Commit**

```bash
git add docs/conventions/engine-host-seam.md
git commit -m "docs(engine-host): the engine-host seam convention"
```

---

### Task 8: Close-out — ROADMAP / STATUS / changelog / ADR fragments

**Files:**
- Modify: `ROADMAP.md` (add a cross-cutting row — append only)
- Modify: `STATUS.md` (add a row for this slice — your row only)
- Create: `changelog.d/engine-host-harness.md`
- Create: `docs/decisions/pending/engine-host-harness.md`

- [ ] **Step 1: Sync main before touching shared/generated files**

Run: `git fetch && git merge --no-edit origin/main` (or `git merge main` for the local tracking branch). Resolve any conflict in `ROADMAP.md`/`STATUS.md` by keeping both rows.
Expected: clean merge or a trivial append conflict you resolve by keeping both sides.

- [ ] **Step 2: Add the changelog fragment**

Create `changelog.d/engine-host-harness.md` — per `changelog.d/README.md`, a frontmatter `category:` then the entry text:

```markdown
---
category: Added
---
**Engine-host harness** — a shared `magna-carta-engine-host` crate giving the pure-Rust document engines one runtime seam (magic-byte format detection, the wasm32 JS-marshalling edge, and the axum container skeleton) instead of re-implementing it per engine.
```

- [ ] **Step 3: Add the ADR pending fragment**

Create `docs/decisions/pending/engine-host-harness.md`, using the exact frontmatter keys a historical fragment uses (`slug`, `status`, `area`, `date`, `summary`), then the body. The build assigns the ADR number on `main`:

```markdown
---
slug: engine-host-harness
status: Accepted
area: Architecture / Rust document engines
date: 2026-06-28
summary: Extract the shared runtime seam (wasm32 JS edge, axum container skeleton, magic-byte Format detection, pure-Rust feature discipline) from the pure-Rust document engines into a magna-carta-engine-host crate; the hosting pattern is shared, the deep format logic stays per-engine; detection/ML containers may adopt the container half but are not dual-target; engines are retrofitted incrementally behind green tests after the harness is proven on the File Repair & Salvage tool.
---

**Engine-host harness — a shared runtime seam for the pure-Rust document engines.**

**Context:** the PDF engine (`crates/pdf-core`), the decryption core (`crates/decryption-core`), and the bundling/conversion cores each re-implement the same hosting seam — a wasm32 JS-marshalling edge (`wasm.rs`), an axum container skeleton (`main.rs` + `router`/`AppState`), a magic-byte format check, and pure-Rust crate-feature discipline. A read of the code confirms the duplication is in the seam, not the format logic (the two files literally named `detect.rs` are even different concerns). A new engine — File Repair & Salvage — is about to repeat the seam again.

**Decision:** extract the hosting seam (only) into `magna-carta-engine-host` (`crates/engine-host`), with `cfg`-gated modules `format` (magic-byte `Format` + `detect`), `wasm_edge` (the JS-marshalling toolkit + stable-error-code rule), and `host` (the axum `/ready`+`serve` skeleton, body cap, panic-net, R2 client helper). The hosting pattern is shared; the deep format logic stays per-engine. Detection/ML containers (scan, the Magika type-verifier) may adopt the container half but are not dual-target and are not forced into the wasm half. Engines are retrofitted onto the harness incrementally, behind green tests, after it is proven on the new File Repair & Salvage consumer.

**Considered and rejected:** a large shared "format core" library that absorbs the parsers (rejected — the deep parsing does not repeat and merging it would couple unrelated engines); a big-bang migration of the merged PDF engine before the harness is proven (rejected — retrofit is sequenced last, after validation on new code).

**Consequences:** a new engine writes its format logic and inherits its hosting. A fitness test keeps `engine-host` from importing any engine-logic crate (it sits beside the engines, never below). Concretizes the white paper's _Delivery model_ shared-core line and the "Container subsystems extract to dedicated workers" rule (ADR-0138); builds on ADR-0024/ADR-0039 and ADR-0088.
```

- [ ] **Step 4: Add ROADMAP + STATUS rows**

In `ROADMAP.md`, append a row/line under the appropriate in-flight section noting the engine-host harness (SP1 built; SP2 File Repair & Salvage and SP3 retrofit to follow). In `STATUS.md`, add one row for this slice with stage `Built` once Tasks 1–7 are green. Keep edits to your own additions (append-don't-collide).

- [ ] **Step 5: Run the full crate gate**

Run: `cargo test -p magna-carta-engine-host && cargo fmt --check && cargo clippy -p magna-carta-engine-host --all-targets -- -D warnings`
Expected: all tests pass; fmt clean; no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md STATUS.md changelog.d/engine-host-harness.md docs/decisions/pending/engine-host-harness.md
git commit -m "docs(engine-host): roadmap/status rows + changelog + ADR fragments"
```

---

## Notes for the implementer

- **Verify crate pins against docs.rs before use** (golden rule 11): `axum` 0.8, `tower-http` 0.6, `wasm-bindgen` 0.2, `js-sys` 0.3, `serde-wasm-bindgen` 0.6 are the versions the sibling crates use today — confirm they are still current and adjust if a newer minor is stable.
- **`tower-http` `catch-panic` feature** provides `CatchPanicLayer`. The body cap uses `axum::extract::DefaultBodyLimit` (no `tower_http::limit` needed), so the crate enables only `catch-panic`.
- **The wasm glue tests** need a wasm test runner (`wasm-pack`, or `cargo test --target wasm32-unknown-unknown` with the wasm-bindgen test runner configured). If the toolchain is not present locally, those two tests run in the wasm CI job; the native trait/guard tests still gate the content-safety contract locally.
- **Pure-Rust-feature fitness (spec §6b).** `engine-host` itself pulls no codec crate (`zip`/`flate2`/zstd), so there is nothing to guard yet — the automated "no C-backed feature on the wasm path" check lands with the first consumer that adds codec dependencies (SP2, File Repair & Salvage). For SP1 the rule is enforced by the convention doc (Task 7) and the Global Constraints above.
- **Do not add any engine-logic dependency** to `crates/engine-host/Cargo.toml` — the Task 6 fitness test will fail, by design.
