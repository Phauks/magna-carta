# PDF engine slice 1 — core + render — design

**Status:** Draft (implementation-grade design) · **Date:** 2026-06-21 · **Owner:** Trevor Goldsmith
**Roadmap home:** [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md) §6 (slice 1) · feasibility GO: [`2026-06-21-pdf-engine-feasibility-results.md`](2026-06-21-pdf-engine-feasibility-results.md)
**Relates to / revisits:** ADR-0024 (Rust scope — the sanctioned shared document-engine core) · ADR-0090 (distribution & IP posture — client WASM is public, generic primitive, no source maps) · ADR-0088/0089 (the PDFium fork — superseded as destination by the roadmap) · ADR-0039/0083 (compute placement / load-profile harness)
**ADRs to raise (this slice):** `pdf-engine-pure-rust-core` (adopt the composed pure-Rust core) · `hayro-dependency-doctrine` (depend + upstream + fork-as-given) · `rust-workspace-layout` (the first `crates/` cargo workspace + WASM build convention)
**Build gates:** none functional (backend-first, no UI). Tooling gate: establishes the first Rust/WASM build in `vp` + CI.

Backend-first vertical slice: the first Rust+WASM foundation in the monorepo plus a PDF core that loads, inspects, and renders pages to raster. No preview UI — the 0·7/2·3 viewer consumes this later. This is the de-facto product PDF engine (no PDF rendering exists in the repo today: no Rust, no PDFium WASM, no EmbedPDF).

---

## 1. Scope

**In:**

1. A new top-level **`crates/`** cargo workspace and the first Rust crate, **`crates/pdf-core`** — `lopdf` (model; the spike's 100%-coverage primary) + `hayro` (render), portable to `wasm32` and native with no target-specific code.
2. A WASM build of the render+model surface via `wasm-bindgen`/`wasm-pack`.
3. A TS wrapper package **`packages/pdf`** (`@magna-carta/pdf`) exposing a typed API over the WASM module, with a bundled sample PDF for self-test.
4. The first-class **build integration**: `vp` cargo/wasm/`fmt`/`clippy` steps + a CI Rust job.
5. The **permanent regression harness** (re-homed from the throwaway spike) — render/parse smoke over a committed mini-corpus + a manifest-fetched local fidelity corpus.

**Out (named seams, §9):** any preview/viewer UI; deep object-model access (redaction/forms need it — slices 2–4); native Container/Tauri packaging; signing; OCR; the formal retirement of the EmbedPDF plan (a roadmap edit, not this slice).

---

## 2. Architecture & layout

```
crates/                      # NEW — first cargo workspace in the repo
  Cargo.toml                 # [workspace] members = ["pdf-core", "pdf-eval"]
  pdf-core/                  # the engine: lopdf model + hayro render
    src/lib.rs               # public Rust API (target-agnostic)
    src/wasm.rs              # #[wasm_bindgen] boundary (cfg(target_arch="wasm32"))
  pdf-eval/                  # dev-only: the permanent regression harness (native)
packages/pdf/                # NEW — @magna-carta/pdf, the TS wrapper
  src/index.ts               # typed API over the wasm-pack output
  src/pkg/                   # generated wasm-bindgen artifacts (built, gitignored)
  test/                      # JS-level tests (render the bundled sample)
```

The crate is **target-agnostic by construction**: `pdf-core/src/lib.rs` is pure Rust (no JS, no wasm types); `src/wasm.rs` is a thin `#[wasm_bindgen]` adapter compiled only for `wasm32`. Native callers (the `pdf-eval` harness today; Containers/Tauri later) link `lib.rs` directly. One core, two thin edges — the ADR-0024 "shared core (WASM + native)" shape.

**Isolation boundaries.** `lib.rs` knows nothing about JS or the product; `wasm.rs` only marshals bytes/handles; `@magna-carta/pdf` only re-types and ergonomically wraps. Each is understandable and testable alone.

---

## 3. Public API surface (minimal — render + model only)

Rust (`lib.rs`), mirrored across the wasm boundary into `@magna-carta/pdf`:

```ts
// @magna-carta/pdf
loadDocument(bytes: Uint8Array): PdfDocument          // parse; holds state in wasm memory
PdfDocument.pageCount: number
PdfDocument.pageSize(index): { widthPt: number; heightPt: number }
PdfDocument.renderPage(index, opts?: { dpi?: number; scale?: number; encodePng?: boolean })
   : { data: Uint8Array; width: number; height: number; encoding: "rgba8" | "png" }
PdfDocument.free(): void                               // release wasm memory (also via Symbol.dispose)
```

- **Default output is raw `rgba8`** (a viewer draws it straight to a canvas — no decode); `encodePng: true` is a convenience for non-canvas consumers.
- **Memory:** `PdfDocument` owns a wasm-resident parsed document; JS holds an opaque handle and **must** `free()` it (wrapped as a disposable so `using` works). Documented as the one lifecycle rule.
- **No deep object access** (`getObject`, content-stream ops) — deferred to the redaction/forms slices.

## 4. Build & toolchain

- **WASM:** `wasm-bindgen` + `wasm-pack` (target `web`) emit the JS bindings + `.wasm`; `@magna-carta/pdf` re-exports them; Vite consumes the package when the viewer is built. Size-optimized profile (the spike's `opt-level="z"`, `lto`, `strip`); `wasm-opt` in the release build.
- **Native:** falls out free — the `pdf-eval` harness *is* the native build; no separate packaging this slice.
- **`vp`:** gains `cargo build`/`test`/`fmt`/`clippy` and a `wasm-pack build` step wired into `vp run build-all` and `vp check`. **First Rust in `vp`** — this is the convention the `rust-workspace-layout` ADR records.
- **CI:** a Rust job (fmt + clippy + `cargo test` + wasm build) added alongside the pnpm gate.
- **ADR-0090 constraints (bind now):** the shipped WASM is a **generic primitive** (render/parse) — fine to ship and even upstream; **minification only, no source maps**; nothing proprietary in the client core (the redaction *verification gate* and product workflows are later, server-or-product-layer slices).

## 5. Error handling

`pdf-core` is a **pure compute library**: fallible operations return typed `Result`s (`PdfError { Parse, PageOutOfRange, Render, … }`) marshalled to JS as thrown typed errors — no logging, no Error-IDs inside the core. The **standard error pipeline** (golden rule 4 — redaction, Error-ID correlation, the in-house logger) lives at the **consuming Worker/route** that eventually calls the engine, not in the WASM core; the core just reports *what* failed. This keeps the core portable (it runs identically in a browser with no logger) and is stated as the boundary.

## 6. Testing (the harness becomes permanent)

- **CI smoke (blocking):** a small **committed**, permissively-licensed PDF corpus; `pdf-eval` asserts every file parses (lopdf + hayro) and page 0 renders to a non-empty raster of correct dimensions. Pure Rust — runs in CI with no PDFium.
- **Local fidelity (non-blocking):** the `corpus.lock` manifest fetches the full legal corpus; the **recalibrated** gate (median MSSIM ≥ 0.95 vs PDFium + visual-audit of the tail — not the miscalibrated 0.98) runs locally where the PDFium binary is available. Documented as a local check, not a CI gate.
- **TS wrapper:** a JS-level test loads the bundled sample PDF, asserts `pageCount`, `pageSize`, and a non-empty `renderPage`, and that `free()` releases without error.
- **Determinism:** same bytes + same opts → byte-identical raster (a regression guard for upstream `hayro` bumps).

## 7. Deferred / named seams

Native Container/Tauri packaging · deep object-model access · redaction verification gate · forms · secure/encrypt · signing · OCR · the preview/viewer UI · formally retiring the EmbedPDF/PDFium plan in the roadmap/2·3.

## 8. Open items to confirm at build (golden rule 11)

- Re-verify `hayro`/`lopdf`/`wasm-bindgen`/`wasm-pack` versions + licenses at build.
- Confirm the committed CI mini-corpus sources are redistributable (permissive/public-domain) and small.
- Confirm `vp`'s extension points for a non-pnpm (cargo/wasm) build step, and the CI Rust toolchain pin.
- Confirm the `wasm-pack` output shape Vite expects (target `web` vs `bundler`) against the app's Vite version.
- Confirm the `PdfError` variants against what `lopdf`/`hayro` actually surface.

**Code-hygiene note (golden rule 13):** the shipped Rust/TS source, tests, and any consumer-facing strings carry **no** process references (no ADR-NNNN, no "slice 1", no "spike"); reasoning goes inline or cites a `docs/conventions/` path. ADRs/specs are recorded here, not in code.
