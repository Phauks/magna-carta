---
number: 128
slug: pdf-engine-pure-rust-core
status: Accepted
date: 2026-06-21
area: Documents
summary: The PDF render engine for inline preview and safe-delivery is written entirely in pure Rust (hayro), compiled to WASM for the web runtime and native for the desktop runtime, with no C binding, no vendored binary, and no server round-trip for rendering.
---

**The PDF render engine for inline preview and safe-delivery is written entirely in pure Rust (hayro), compiled to WASM for the web runtime and native for the desktop runtime, with no C binding, no vendored binary, and no server round-trip for rendering.**

**Context:** Inline PDF preview requires a render path that executes in the browser (no server round-trip, no file upload to a third-party service) and in the Tauri desktop shell. Candidate approaches: a C-based library behind a Worker Container (pdfium, mupdf), a JavaScript renderer (pdf.js), a pure-Rust library compiled to WASM (hayro), or a vendored binary blob. Magna Carta's IP-protection posture (see the white paper, _IP protection and distribution_) rules out distributing source that can be statically linked into a competitor's product; a C binding further complicates the WASM target and the signed-binary integrity model.

**Decision:** Use hayro, a pure-Rust PDF renderer, as the sole render dependency. Compile it to `wasm32-unknown-unknown` via wasm-pack for web and run it natively for desktop via Tauri. The Rust workspace lives at `crates/`, with `pdf-core` as the WASM-targeted library crate and the TypeScript wrapper at `packages/pdf`. No C FFI, no pdfium DLL, no server-side render process, and no third-party render service.

**Consequences:** Rendering fidelity is bounded by hayro's coverage of the PDF specification; documents that use features hayro does not yet implement will render partially or not at all. This is acceptable for the inline preview use-case (a convenience surface, not the authoritative file) and for safe-delivery sandboxing (a locked-down viewer rather than a full editor). Pdfium or a fallback path may be added for documents that fail hayro's parse, but will not be the default path and will not ship as a vendored binary. The `pdf-eval` harness measures hayro's parse coverage against a controlled corpus and is the signal for when a fallback is warranted.

**Relationship to distribution policy:** hayro is a pure library dependency consumed through Cargo; it is not vendored into the repository and is not distributed as a binary blob. This is consistent with the IP-protection distribution policy.
