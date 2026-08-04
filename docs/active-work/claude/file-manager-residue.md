---
branch: claude/file-manager-residue
worktree: .claude/worktrees/agent-a23001c744ea887fd
area: File manager residue — soft-deleted files accepting writes, the sub-cap ingest tee, a stale comment
status: review
touches: packages/file-manager/src/file-service.ts, packages/file-manager/src/ingest-core.ts, packages/file-manager/src/validation.ts, packages/file-manager/CLAUDE.md, packages/file-manager/test/file-service.test.ts, apps/worker/src/routes/files.ts, apps/worker/src/routes/uploads.ts, apps/worker/src/editing/checkout-routes.ts, apps/worker/test/ingest-core.test.ts, crates/pdf-core/src/sign.rs, changelog.d/
---

Three defect fixes in the file pipeline.

1. **Soft-deleted files took mutations.** `requireFile` never read `deleted_at`, so every write that
   resolved a file through it succeeded on a deleted row. It is split: `requireLiveFile` (the default,
   refusing with the new `file-deleted` code) backs rename, move, document-type assignment,
   soft-delete, a new upload version, and check-in initiation; `requireFileIncludingDeleted` backs the
   one surface that must see a deleted row, the undelete. The routes map `file-deleted` to the same
   404 body `unknown-file` gets, so the refusal leaks nothing the reads do not.
2. **The sub-cap ingest lane tee'd without backpressure coupling.** Replaced with one bounded read of
   the body feeding both the digest and the scan port; the cap is what makes it sound, and the read
   stops as soon as the body passes the size R2 reported. The over-cap streaming lane is untouched.
3. **A stale comment** in `crates/pdf-core/src/sign.rs` cited `SignError::XrefStream`, a variant that
   no longer exists — the writer appends a classic cross-reference table chained through `/Prev`, which
   signs an xref-stream original fine. Comment only.

Overlaps a concurrent stream should know about: `apps/worker/src/routes/files.ts` (a two-line addition
to the error mapper) and `crates/pdf-core/src/sign.rs` (the file header comment only — the
`claude/2-5-analysis-prep` stream owns that file's code and its own note still describes the removed
variant).
