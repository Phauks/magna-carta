---
category: Added
---

**PDF render engine — `@magna-carta/pdf` (pure-Rust/WASM core, inline preview foundation):** `crates/pdf-core` (a pure-Rust hayro-backed renderer compiled to `wasm32-unknown-unknown` via wasm-pack) and `packages/pdf` (the TypeScript wrapper — `loadDocument`, `PdfDocument.pageCount`/`pageSize`/`renderPage`/`free`, `Symbol.dispose` support). `crates/pdf-eval` is the permanent parse-coverage harness (lopdf + the hayro render path, smoke-tested against a controlled corpus in CI). Rust quality gates added to CI (`rust-pdf-core` job: fmt, clippy, tests, pdf-eval smoke, wasm-pack build) and to `pnpm check` (`vp run rust-check`); `vp run build-all` depends on `rust-wasm-build` so the WASM artefact is always current before the SPA bundles. No server round-trip for rendering; no C binding; no vendored binary. (`crates/`, `packages/pdf`)
