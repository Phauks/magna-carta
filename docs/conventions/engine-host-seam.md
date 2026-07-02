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
- **Cheap format detection.** Identify a file's container type with `engine_host::format::detect` (magic-byte Format — Pdf/Zip/Ole2). It is the shared, growing first check; an engine that needs a richer or deeper identification composes on top of it rather than re-reading magic bytes. Ole2 is the honest magic-level identity of a compound file — the engine decides whether a given Ole2 is encrypted OOXML, legacy .doc, .msg, etc.
- **Container fail-safe.** Build the service with `engine_host::host` (ready_app — adds GET /ready and the MAX_BODY_BYTES cap; serve / serve_on; with_panic_net; r2_client for R2 GET/PUT). Bind `0.0.0.0:8080`, catch panics. A panicking handler returns 500; it never crashes the container or reports a silently-wrong success.
- **Runtime placement.** The Worker (wasm) is the default lane; the Container (native)
  is the heavy lane, entered only when file size or CPU exceeds the Worker budget.
  Heavy/async work goes through a Queue + a per-job Durable Object. Same engine crate,
  two compile targets.
- **Raw facts in the container, the verdict in the app.** The container returns
  structured facts; the app composes the user-facing verdict. Each engine defines its
  own payload type; the harness does not.
