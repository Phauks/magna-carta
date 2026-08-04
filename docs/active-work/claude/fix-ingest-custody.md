---
branch: claude/fix-ingest-custody
worktree: .claude/worktrees/agent-a21f299f79a4a19c0
area: Ingest chain of custody — a clean verdict binds to the bytes, not to the key
status: review
touches: apps/worker/src/files/ingest-consumer.ts, apps/worker/src/routes/files.ts, apps/worker/src/control-plane-migrations.ts, packages/file-manager/src/, packages/database/src/control-plane-schema.ts, packages/database/drizzle/control-plane/, changelog.d/
---

Three fixes in the file pipeline. (1) A committed version's bytes were mutable for the rest of the
presigned PUT's lifetime: the overwrite's R2 object-create event no-opped, leaving a clean verdict
over content nothing had inspected. An object-create event for an already-committed version now
re-measures the stored bytes against the hash recorded at commit and withdraws the version when they
differ. (2) The gate's sniffed-vs-declared content-type comparison was byte-exact string equality,
which quarantined every legacy Office document (`application/x-cfb` against `application/msword`);
an explicit container-equivalence table replaces it, and the container type is added to the default
upload policy's allowed list. (3) `firm.bucket_name` gains the UNIQUE index the ingest consumer's
`WHERE bucket_name = ?` firm resolution depends on, as a control-plane migration.

Files a concurrent stream should not step on while this is open: `packages/file-manager/src/`
(`ingest-core.ts`, `file-service.ts`, `file-statements.ts`, `upload-policy.ts`, the new
`content-type-equivalence.ts`) and `apps/worker/src/files/ingest-consumer.ts`. The control-plane
migration adds one journal entry and one snapshot — a second stream generating a control-plane
migration in parallel will collide on `meta/_journal.json` and must rebase rather than merge.
`apps/worker/src/routes/files.ts` gains a comment only, at the download presign call.
