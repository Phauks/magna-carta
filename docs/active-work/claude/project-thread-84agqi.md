---
worktree: (none — this stream runs in a cloud checkout)
area: PDF engine review — correctness fixes, functional gaps and refactors in crates/pdf-core and packages/pdf
status: building
touches: crates/pdf-core/, packages/pdf/, apps/api-worker/src/search/text-extraction.ts, changelog.d/
---

Works through the findings of the 2026-11-10 review of the PDF engine, one pull request at a time on
this branch: sanitize and signing fixes first, then text extraction and recognition of long
documents, then PDF generation, then the shared-helper extraction and the file splits. The splits
move `forms.rs`, `surgery.rs`, `redact.rs`, `generate.rs` and `wasm.rs` wholesale, so a concurrent
stream editing those files should say so here before that pull request opens.
