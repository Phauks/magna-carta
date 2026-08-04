---
branch: claude/worker-followups-batch
worktree: .claude/worktrees/agent-a7a9668e80cef9d99
area: Grouped follow-up defect fixes — WOPI file-access agreement, matter lifecycle replay on retry, file-manager lifecycle residue
status: review
touches: apps/worker/src/editing/wopi-routes.ts, apps/worker/src/scheduled.ts, apps/worker/src/routes/folders.ts, apps/worker/src/routes/files.ts, apps/worker/test (editing, scheduled-storage), packages/matters/src/matter-service.ts, packages/matters/test, packages/file-manager/src (queries, file-statements, folder-statements, folder-service, file-service, validation), packages/file-manager/test, changelog.d
---

Bug-fix only across three areas. No schema change, no route added or removed, no change to any
declared response status — so the OpenAPI snapshot and the generated client are untouched (the
`/wopi/*` routes are raw and non-OpenAPI to begin with, and the one new refusal reuses the `422`
already declared on the folder and file patch routes).

The WOPI file-access handlers now resolve the token's own version through one shared gate, so
`CheckFileInfo` and `GetFile` refuse and serve identically — a soft-deleted file, a withdrawn version,
or a re-scan-flagged version is refused by both, and the metadata reported is the token's version
rather than whatever the file's current pointer has advanced to. `openMatter` and `reopenMatter` skip
their lifecycle precondition on an already-seen Idempotency-Key, matching `closeMatter`. In the file
manager: a daily re-drive for versions stranded pending behind a dead-lettered ingest, the folder-move
cycle check carried inside the UPDATE, a dedicated `invalid-name` refusal, and an in-batch assertion
that makes a version-lifecycle batch fail as a unit rather than committing the consequences of a
commit that lost its race.

A stream working in `packages/file-manager` collides here: this one owns `queries.ts`,
`file-statements.ts`, `folder-statements.ts`, `folder-service.ts`, `file-service.ts`, and
`validation.ts` for the duration. `apps/worker/src/editing/` is likewise owned here, though only
`wopi-routes.ts` changes.
