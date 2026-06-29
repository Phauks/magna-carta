# pdf-decompression-guard

**Scope:** Crate-wide decompression-bomb hardening for `crates/pdf-core` — a shared
`guard.rs` (input cap + raw-bytes pre-flight + bounded inflate) wired into every public
entrypoint, closing the disclosed-and-deferred bomb residual across redact/scrub/detect/
surgery/secure/generate/watermark/bates/forms. Parser-agnostic pre-flight covers both
lopdf and hayro. No fork.

**Files expected to touch:**

- `crates/pdf-core/src/guard.rs` (new)
- `crates/pdf-core/src/lib.rs` (module decl; guard `Document::load` / `load_protected`)
- `crates/pdf-core/src/{redact,scrub,detect,secure,generate,watermark,bates,forms,decrypt}.rs`
  (one `guard_input` call per public op; error-variant plumbing; swap the 4 explicit
  `decompressed_content()` sites to `bounded_decompress`)
- `crates/pdf-core/src/wasm.rs` (`"decompression-bomb"` token mapping)
- `packages/pdf/src/index.ts` (typed `DecompressionBombError`)
- `crates/pdf-core/tests/` + in-module tests (programmatic bomb fixtures)
- `docs/specs/2026-06-28-pdf-decompression-guard-design.md` + implementation plan
- `changelog.d/`, `docs/decisions/pending/`, `STATUS.md`, `ROADMAP.md` (at completion)

**Shared-file coordination:** `STATUS.md` / `ROADMAP.md` PDF-engine row at completion only
(overlaps already declared by scan-engine + metadata-scrubber — edit own row).
