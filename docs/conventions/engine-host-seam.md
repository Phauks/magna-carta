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

## Hosting a pure-Rust engine in a Container

The reference shape for standing an engine up as a native Container service, so the
next engine copies it instead of re-deriving it. `containers/recovery` (File Repair)
is the first engine built to this pattern; `raster`/`scan`/`bundle` predate the harness
and hand-roll their axum, and are the retrofit targets, not the pattern to copy.

- **The engine crate stays pure.** `crates/<engine>` is I/O-free and serde-free — bytes
  in, engine types out. It never depends on `axum`, `serde`, or `tokio`. All HTTP/JSON
  marshalling lives in the container host, mapping from the engine's own types — the same
  "engine parses, host hosts" split `wasm_edge` uses on the WASM edge.
- **A thin container host.** `containers/<engine>` is a small standalone crate with
  path-dependencies on `crates/engine-host` and `crates/<engine>`. Its `main` builds the
  service with `engine_host::host` — `with_panic_net(ready_app(router()))` then `serve` —
  binding `0.0.0.0:8080`. It owns the request/response DTOs (`serde` camelCase, file bytes
  as base64) and the `From<engine_type>` mappings. An engine error becomes a `422` carrying
  only the stable error `code`, never file content (golden rule 4).
- **A repo-root build context.** Because the host path-depends on crates in `crates/`, the
  Docker build context must be the repo root, not the container directory. Set `image` (the
  Dockerfile path) and `image_build_context` (the context dir, e.g. `"../../"`) as sibling
  fields on the container config. The Dockerfile `COPY`s the **whole `crates/` workspace**
  (`COPY crates crates`) plus `containers/<engine>` — not just the two crates the binary
  uses: engine crates inherit `edition` (and may inherit shared dependencies) from the
  workspace root manifest `crates/Cargo.toml`, so cargo must see that root to resolve the
  inheritance, and it errors `failed to find a workspace root` without it. The workspace is
  ~1 MB of source and cargo still compiles only the target binary's dependency closure, never
  the other members. This is a verified wrangler capability, not a hack. Images build in
  Cloudflare Workers Builds on push (there is no local Docker build);
  `wrangler deploy --dry-run --containers-rollout=none` validates the worker bundle and
  config without attempting the image, so the image itself is first proven by the in-cloud build.
- **A `.dockerignore` at the build-context root.** Docker reads `.dockerignore` from the
  build-context root, so for a repo-root context it lives at the **repo root** (`/.dockerignore`),
  not beside the Dockerfile — a file at `containers/<engine>/.dockerignore` is silently ignored.
  Allowlist only the trees the engine images copy (`crates/`, `containers/`) and re-exclude
  build output, so `.git`, secrets (`.dev.vars`), `node_modules`, and every package's `target/`
  never transit to the builder. This one root file serves every repo-root-context engine
  container; it does not affect the older self-contained containers (they use their own
  directory as the context and read their own `.dockerignore`).
- **A dedicated container worker.** `apps/<engine>-worker` owns the Container Durable Object
  (`defaultPort=8080`, `sleepAfter`, `enableInternet=false` for untrusted bytes,
  `pingEndpoint="ready"`), a `getContainer(env.<ENGINE>, "<name>")` dispatch, and a forward
  proxy. The app worker reaches it through a `services` binding, never a `getContainer` call
  of its own — the app worker holds only the binding.
- **Future work (do not build now):** the four near-identical container workers
  (`convert`/`scan`/`bundle`/`recovery`) share enough that a `container-worker` base is worth
  extracting once they converge — a later program-scope consolidation, not a per-engine cost.
