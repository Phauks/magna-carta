# Engine host — a shared hosting harness for the pure-Rust document engines

**Status:** Accepted (design) · **Date:** 2026-06-28 · **Owner:** Trevor Goldsmith
**White-paper home:** _Delivery model_ ("a shared doc/discovery core → WASM for web + native for desktop"); _Performance & concurrency model_ (sandbox-hardened Container processing)
**ADRs:** **new ADR (pending fragment `engine-host-harness` — a shared runtime seam for pure-Rust document engines; the hosting pattern is shared, the format logic is not; numbered when assembled on `main`)** · builds on ADR-0024/ADR-0039 (shared-core, WASM-web + native-desktop, heavy work in Containers/Queues/DO), ADR-0088 (the pure-Rust PDF engine), the standing rule "Container subsystems extract to dedicated workers".

The codebase has grown several **pure-Rust document engines** that each compile to **WASM (for a Worker/the
browser)** and **native (for a Cloudflare Container)**: the PDF engine (`crates/pdf-core`), the decryption
core (`crates/decryption-core`), and the Rust cores behind bundling and conversion. A new one — **File Repair
& Salvage** — is about to join them. Each engine re-implements the same **runtime seam**: a wasm32 JS-
marshalling edge, an `axum` container service, a magic-byte format check, and the same pure-Rust
crate-feature discipline. This design extracts that seam into one shared crate + one convention, so a new
engine writes its _format logic_ and inherits its _hosting_.

This is a **hosting harness, not a format library.** The deep, format-specific logic (PDF object surgery,
ZIP/OOXML/CFB adapters, redaction geometry, password KDFs) stays in each engine and is explicitly **out of
scope** — consolidating it would couple unrelated engines.

---

## 0. Why a harness, and why only a harness (the evidence)

A read of the engines shows the duplication is in the seam, not the logic:

- **WASM edge.** `pdf-core/src/wasm.rs` and `decryption-core/src/wasm.rs` carry the **same documented
  convention** verbatim — _"thin JS marshalling edge — compiled only for wasm32. No engine logic here"_ —
  and the same mechanics: `&[u8]`/`Vec<u8>` in; results built as a `js_sys::Object` via a local `set`
  closure with `Uint8Array` payloads; `serde_wasm_bindgen` option structs; engine errors mapped to **stable
  string error codes** that never carry file content.
- **Container skeleton.** `containers/scan`, `containers/bundle`, and `containers/raster` each have a
  `main.rs` that binds `0.0.0.0:8080`, calls `axum::serve(listener, router(state))`, and a `router(state)`
  exposing `/ready` plus the work routes over an `AppState`. `bundle`'s is almost pure boilerplate (an R2
  base URL + a reused `reqwest::Client`).
- **Format check.** `decryption-core/src/detect.rs` is a ~17-line magic-byte `Format` identifier
  (`%PDF` → Pdf, the OLE2 magic → Ooxml, `PK\x03\x04` → Zip). Each engine restates the bytes it cares about.
- **Feature discipline.** Every engine must select **pure-Rust crate features** (e.g. `zip`'s
  `deflate-flate2`, `flate2`'s `miniz_oxide` backend) or its WASM target breaks. Today this is re-stated per
  crate and enforced only by a failing build.

The **format logic does not repeat** — and the two files literally named `detect.rs` turned out to be
_different concerns_ (pdf-core's is a bad-redaction detector; decryption-core's is format identification).
That near-miss is the rule: extract the seam, leave the engines alone.

## 1. Scope

**In scope (the shared harness):**

1. A `Format` type + magic-byte detection (the common, growable file-type check).
2. The **WASM edge toolkit** — the repeated JS-marshalling helpers and the edge convention.
3. The **Container host toolkit** — the `axum` service skeleton (`serve`, `/ready`, `AppState` shape,
   body-size cap, panic-net middleware) and a small R2-client helper.
4. A **`docs/conventions/` standard** documenting the seam so it is enforced by review, not just by a
   failing build.

**Out of scope (stays per-engine, by design):**

- All format parsing/transformation: PDF object surgery, ZIP/OOXML/CFB adapters, redaction geometry,
  password KDFs, salvage logic. The harness never parses a document.
- The detection/ML containers' specifics — `scan` (clamd + vectorscan are C/C++ → container-only, never
  WASM) and the Magika type-verifier (ONNX model). They may adopt the **Container host** half and the
  convention, but they are **not** dual-target engines and are not forced into the WASM half.

## 2. The crate — `magna-carta-engine-host` (`crates/engine-host`)

A new member of the existing `crates/` workspace. Pure Rust, `publish = false`. `cfg`-gated modules mirror
the patterns already used in `decryption-core` (`#[cfg(target_arch = "wasm32")] mod wasm`):

```
crates/engine-host/
  src/lib.rs        // re-exports; the seam's public surface
  src/format.rs     // `Format` enum + `detect(&[u8]) -> Option<Format>`   (always compiled)
  src/wasm_edge.rs  // JS-marshalling toolkit                              (#[cfg(target_arch = "wasm32")])
  src/host.rs       // axum service skeleton + R2 client helper            (#[cfg(not(wasm32))])
```

**`format`** — a single growable `Format` enum and `detect()` over leading magic bytes. Seeded with the
formats the engines already identify (PDF, ZIP, OOXML/OLE2); extended as engines need (recovery adds image
and archive-family signatures; this is the natural home for the carving signature table's _identification_
half, distinct from its scan loop). An engine that wants a richer check composes on top — the harness owns
only the cheap, shared magic-byte layer.

**`wasm_edge`** — the helpers every `wasm.rs` re-implements:
- `bytes_out(&[u8]) -> Uint8Array` and an object-builder helper (the `set(obj, key, val)` closure, lifted).
- A small `EdgeError` convention: engine errors map to **stable string codes**; a helper asserts the message
  carries **no file content** (the privileged-content rule, golden rule 4). Each engine still writes its own
  code mapping (the codes are engine-specific); the harness owns the _mechanism and the rule_.
- It holds **no engine logic** — the convention the current files already state, now enforceable.

**`host`** — the container skeleton:
- `serve(router)` — bind `0.0.0.0:8080`, `axum::serve`, the resolved-`io::Result` propagation `scan`/`bundle`
  already use.
- A `/ready` route and the `AppState`-cloning shape.
- **Body-size cap** + a **panic-net** layer (catch_unwind / `spawn_blocking` for the per-request engine call)
  — the fail-safe the `scan` CLAUDE.md documents, generalized so no engine re-derives it.
- An **R2-client helper** (a `reqwest::Client` builder with a connect-timeout and no general egress) — the
  `bundle` pattern, lifted.
- The `RawResult → app verdict` contract shape is documented here (raw facts in the container, the verdict
  in the app) but each engine defines its own payload type.

The name is descriptive (the crate _hosts_ engines on runtimes); it is open to change at build.

## 3. The convention (`docs/conventions/`)

A short standard — `engine-host-seam.md` (final name at build) — capturing the rules the harness encodes, so
they survive review:

- **Dual-target purity.** The engine core is I/O-free, threadless, `mmap`-free; bytes in, result out. The
  runtime hands it a buffer. (This is what makes Worker↔Container placement a routing decision, not a
  rewrite.)
- **Pure-Rust features only.** The required feature selections (`zip` `deflate-flate2`, `flate2`
  `miniz_oxide`, zstd via `ruzstd`, etc.) listed in one place; a C dependency breaks the WASM target.
- **The wasm32 edge is marshalling only** — no engine logic, stable string error codes, never log file
  content.
- **Container fail-safe** — bounded body size, panic caught, never a silently-wrong success.
- **Runtime placement** — Worker(WASM) is the default lane; the Container(native) is the heavy lane, entered
  only when file size / CPU exceeds the Worker budget; heavy/async work goes through a Queue + per-job
  Durable Object (the async-bulk-download pattern). Same engine crate, two compile targets.

## 4. The three-sub-project program

This design is **SP1**. The program:

1. **SP1 — build `engine-host`** (this branch). New crate + convention + workspace wiring. Unit-tested in
   isolation; touches no existing engine.
2. **SP2 — File Repair & Salvage on the harness** (own branch). The repair tool is the **first new
   consumer** — it proves the harness on new code. Research backing:
   `docs/research/file-corruption-recovery.md`; its open design questions (evidentiary model, format
   sequencing, matter attachment) are settled in SP2's own spec.
3. **SP3 — retrofit the existing engines** (own branch, coordinated). Move `pdf-core` and `decryption-core`
   onto `wasm_edge`/`format`, and `scan`/`bundle`/`raster` onto `host` — **one engine at a time, behind
   green tests**, never a big-bang.

**Sequencing rationale.** The harness is validated on **new** code (SP2) **before** it touches **merged,
working** engines (SP3). Retrofitting the merged PDF engine is the only speculative-risk step, so it goes
**last** — the framework earns the migration by first proving itself on recovery. "Framework first" is
honored (SP1 precedes everything); the merged-code refactor is simply not a prerequisite for the new tool.

## 5. Coordination (parallel worktrees)

SP3 will edit code active on other streams — `crates/pdf-core` (`pdf-engine-roadmap` / `pdf-secure-encrypt`),
`crates/decryption-core` (`decryption-tool`), `containers/bundle` (`enhanced-bundling-plan2`). **SP1 and SP2
touch none of them** (new crates only), so there is no collision until the retrofit, which is sequenced last
and coordinated with those streams at that point (sync `main`, then migrate each behind its tests). The
`crates/Cargo.toml` workspace member list is the one shared file SP1 edits — a one-line append.

## 6. Testing & fitness

- **`format`** — magic-byte detection unit tests (the cases `decryption-core/detect.rs` already covers, plus
  the new ones recovery adds); unknown bytes → `None`.
- **`wasm_edge`** — the marshalling helpers unit-tested on the wasm32 target; a test that the error-code path
  rejects/strips any message carrying content.
- **`host`** — the router skeleton (`/ready` returns ok; the body cap rejects oversize; the panic-net turns a
  panicking handler into an error response, not a crash) via an in-process `axum` test.
- **Fitness functions.** (a) `engine-host` imports **no** engine-logic crate (dependency-inversion guard,
  mirroring the `tools` purity test and the integration framework's no-adapter-in-core scan) — the harness
  sits beside the engines, never below them. (b) A feature-discipline check that the crate (and its
  consumers' shared deps) pull no C-backed feature on the wasm path.

## 7. Decisions recorded & docs to update

New ADR (Decision Log), as a `docs/decisions/pending/engine-host-harness.md` fragment numbered when assembled
on `main` — the engine-host harness: a shared runtime seam for the pure-Rust document engines; the hosting
pattern is shared, the format logic is not; detection/ML containers may adopt the container half but are not
dual-target. Concretizes the white paper's _Delivery model_ shared-core line and the "Container subsystems
extract to dedicated workers" rule.

On build (golden rule 5, same commit as the work): a cross-cutting row in [`ROADMAP.md`](../../ROADMAP.md)
and [`STATUS.md`](../../STATUS.md); a `changelog.d/` fragment; the ADR as a `docs/decisions/pending/`
fragment (assembled on `main`, never hand-edited on a branch). No user docs — this is internal architecture
with no user-facing surface (the SP2 tool ships the first user docs).
