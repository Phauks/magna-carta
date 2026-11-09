use serde::Serialize;
use std::sync::Mutex;

/// The Magika engine handle, built once and shared. `magika::Session::new()` loads Magika's standard
/// model, which is EMBEDDED in the crate (a `const` byte array) — no model file is read from disk or
/// fetched over the network at runtime, consistent with the container's no-egress posture.
///
/// `magika::Session::identify_content_sync` takes `&mut self` (it reuses internal inference buffers), so
/// the session lives behind a `Mutex`. Identification is CPU-bound and already runs on a blocking thread
/// (see `crate::identify` handler), and the firm-facing identify path is far lower volume than the scan
/// path, so serializing the model across concurrent requests is an acceptable trade for a single shared
/// session over per-request model loads (each `Session::new()` re-parses the embedded model).
pub struct IdentifyEngine {
    session: Mutex<magika::Session>,
}

impl IdentifyEngine {
    /// Builds the engine with Magika's embedded standard model. No network, no external model file: the
    /// model ships inside the crate, so this only fails on an inference-backend (ONNX Runtime) init fault.
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self {
            session: Mutex::new(magika::Session::new()?),
        })
    }
}

/// The raw identification facts the container returns — no verdict, no extension recommendation. Field
/// names and JSON shape match the app-side `RawIdentifyResult` the worker re-validates with zod
/// (`apps/api-worker/src/http/routes/files/file-type.ts`); the app decides the extension verdict from these facts.
#[derive(Debug, Serialize, PartialEq)]
pub struct RawIdentifyResult {
    pub label: String,
    pub score: f64,
    pub group: String,
    #[serde(rename = "magikaVersion")]
    pub magika_version: String,
    #[serde(rename = "modelVersion")]
    pub model_version: String,
}

/// The magika crate version, recorded as engine build provenance. The crate exposes no runtime
/// version constant, so this is pinned here — keep it aligned with the `magika` dependency in
/// `Cargo.toml`. `modelVersion` carries the embedded model name (`magika::MODEL_NAME`), which is the
/// component that actually changes when the model is retrained.
const MAGIKA_CRATE_VERSION: &str = "1.1";

/// Runs the model over a byte buffer and lowers its output to the raw wire facts. Infallible from the
/// caller's view: a lock poisoned by an earlier panic is recovered rather than propagated, and an
/// inference fault panics — the handler runs this inside `spawn_blocking`, so a panic surfaces as a
/// `JoinError` it maps to a retryable 503 (`engines_unavailable`), never a fabricated identification.
pub fn identify_bytes(engine: &IdentifyEngine, bytes: &[u8]) -> RawIdentifyResult {
    // Recover a poisoned lock (a prior panic) instead of propagating poison — a single failed
    // identification must not wedge the shared engine for the life of the container.
    let mut session = engine
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let inferred = session
        .identify_content_sync(bytes)
        .expect("magika identification over an in-memory buffer");
    // `info()` resolves the effective content type (the overwrite, if any, else the inferred type) to its
    // static metadata: the stable label string, group, and MIME.
    let info = inferred.info();
    RawIdentifyResult {
        label: info.label.to_string(),
        score: inferred.score() as f64,
        group: info.group.to_string(),
        magika_version: MAGIKA_CRATE_VERSION.to_string(),
        model_version: magika::MODEL_NAME.to_string(),
    }
}
