# pdf-validation-harness

**Scope:** Phase 1 of the document-engine validation harness — a reusable,
engine-agnostic test apparatus in `crates/pdf-eval`, proven end to end on the
**forms** operation over a small set of pdf.js form files. Design + plan:
`docs/specs/2026-07-03-document-engine-validation-harness-design.md` and
`…-implementation-plan.md`.

**Expected files (pdf-eval only — no shared/cross-cutting surface beyond
`.gitignore`):**
- new `crates/pdf-eval/src/validate/` module tree (operation interface, corpus,
  runner, report, operations/forms)
- `crates/pdf-eval/corpus-forms.lock`, `crates/pdf-eval/validation-baseline.json`
- `crates/pdf-eval/Cargo.toml` (serde/serde_json; optional reqwest behind a
  `corpus-fetch` feature)
- `crates/pdf-eval/src/main.rs` (dispatch arms for `validate` / `corpus-fetch`)
- `.gitignore` (ignore `crates/pdf-eval/corpus-forms/`)

**Base:** branched off `pdf-surgery-completion` (carries the completed surgery
work + these specs). Phase-2 (redaction operation) will use
`Document::page_text_rects` from that surgery work.
