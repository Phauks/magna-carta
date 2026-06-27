---
number: 127
slug: hayro-dependency-doctrine
status: Accepted
date: 2026-06-21
area: Documents
summary: hayro is an accepted Cargo dependency for PDF rendering; it is consumed as a versioned crate (not vendored), pinned in Cargo.lock, and treated as a black-box render library — the codebase does not fork it or patch its internals.
---

**hayro is an accepted Cargo dependency for PDF rendering; it is consumed as a versioned crate (not vendored), pinned in Cargo.lock, and treated as a black-box render library — the codebase does not fork it or patch its internals.**

**Context:** Choosing a Rust PDF library requires an explicit acceptance decision because it becomes a load-bearing transitive dependency with licensing, maintenance, and WASM-compatibility implications. The alternatives considered: lopdf (parse/mutation, not a renderer), pdf-rs (parse only), mupdf-rs (C binding, not WASM-compatible), pdfium-render (C binding + DLL, explicit non-starter), and hayro (pure Rust, renders to pixel buffers, compiles to `wasm32-unknown-unknown`).

**Decision:** Accept hayro as a versioned crate dependency (currently `0.7`). It is pinned in `crates/Cargo.lock` and upgraded through the normal dependency-review process. It is not forked, not vendored into the repository, and not patched in-tree. The `pdf-core` crate wraps hayro's API behind the project's own types (`Document`, `PageSize`, `RenderedPage`, `PdfError`) so that hayro is never a direct import boundary in application code; a future swap or fallback path requires changing only `pdf-core`.

**Licensing:** hayro is licensed under the MIT License, which is compatible with the project's use. This is recorded here as the explicit acceptance point; Renovate's dependency-license gate (`lint:licenses`) enforces the allowlist going forward.

**lopdf placement:** lopdf (the parse-and-mutation library) is a dependency of `pdf-eval` only, used for parse-coverage measurement against the corpus. It does not enter `pdf-core` or `packages/pdf`; it is not part of the render or preview surface. This boundary is intentional — lopdf's document-model API is richer than hayro's but it does not render to pixels, and mixing two document-model representations in `pdf-core` would break the single-abstraction goal of that crate.
