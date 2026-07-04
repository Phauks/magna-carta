# pdf-byte-level-surgery

**Scope:** Add a byte-level content-surgery path to the pure-Rust PDF engine so pages whose text is analyzable but whose stream cannot survive lopdf's whole-stream re-encode (inline images, exotic constructs — e.g. TAMReview) surger instead of flattening. Additive fallback (bar A); instrument to diagnose full-replacement (bar B). Design: `docs/specs/2026-07-03-pdf-byte-level-surgery-design.md`.

**Expected files touched:**
- `crates/pdf-core/src/content_tokens.rs` (new — raw tokenizer)
- `crates/pdf-core/src/surgery.rs` (reorder `try_build_surgery`; add `build_byte_splice`; factor `run_advance`)
- `crates/pdf-core/src/lib.rs` (register module)
- `crates/pdf-eval/…` (a `surgery` validation operation running op-path vs byte-path in shadow — the A/B report)
- tests alongside each

**Branched from:** `main` (`a28bb8f`).

**Coordination:** touches `crates/pdf-core/src/surgery.rs` and `lib.rs` — no other in-flight stream is in `crates/pdf-core` per `vp run worktrees` at start. The `pdf-eval` harness merged to main (`a92d53e`); this extends it.
