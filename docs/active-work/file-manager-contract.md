# file-manager-contract

**Scope:** Close the contract and infrastructure gaps that block a matter Files UI. Backend only —
this stream does not touch `apps/web`.

Design: [`docs/specs/2026-07-09-matter-file-manager-design.md`](../specs/2026-07-09-matter-file-manager-design.md)

## What this stream builds

- `GET /api/v1/folders?matterId=` — the folder tree (no folder listing endpoint exists today).
- `FileSummary` enrichment (`versionNumber`, `sizeBytes`, `sniffedContentType`, `updatedAt`,
  `scanVerdict`, `status`, `quarantineReason`) + an opt-in pending/quarantined include on
  `files.list`. `currentVersionId` stays clean-only.
- `GET /api/v1/uploads/{id}` — ingest outcome for the uploader.
- A consumer for the `file.quarantined` outbox topic (currently acked into `unhandled_topic`).
- A development-only R2 upload route + dev presigner change, so the four-step upload ceremony runs
  under `wrangler dev`.
- R2 bucket CORS configuration and its runbook step.

## Files expected to be touched

- `apps/worker/src/routes/files.ts`, `folders.ts`, `uploads.ts`
- `apps/worker/src/files/presign.ts`, `presigner-wiring.ts`, and a new development upload route
- `apps/worker/src/queues/` — the `file.quarantined` consumer
- `packages/file-manager/src/queries.ts`, `file-statements.ts`
- `apps/worker/openapi/openapi.json` (generated), `packages/api-client/src/*.gen.ts` (generated)
- `docs/conventions/operations.md` — the CORS runbook step
- `changelog.d/`, `docs/decisions/pending/`, `status.d/` fragments

**Never edited:** `packages/file-manager/src/ingest-core.ts` — the pure single-read pipeline.

## Overlaps

None with `slice-0-7b-app-shell` (that stream owns `apps/web`). The `operations.md` edit is the one
shared file; sync `main` before touching it.
