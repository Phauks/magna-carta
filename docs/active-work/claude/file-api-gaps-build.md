---
worktree: C:/dev/magna-carta-worktrees/claude/file-api-gaps-build
area: File Manager API — coarse scan reason on the wire, version authorship, sortable file listing
status: building
touches: packages/file-manager, packages/data-access/src/cursor-pagination.ts, packages/database, apps/api-worker/src/routes/files.ts, apps/api-worker/src/files/ingest-consumer.ts, apps/api-worker/openapi/openapi.json
---

Three contract changes to the File Manager read surface, on top of the `apps/api-worker` rename.
Closes the raw-signature exposure on `files.list` behind a closed `scanReason` enum plus an
`activeContent` boolean; puts the committing member on a version (`uploadedByUserId` +
`uploadedByDisplayName`); and gives `files.list` a `sort`/`direction` pair with a sort-tagged cursor
and four new indexes on `file`.

Owns `packages/file-manager/src/queries.ts`, `packages/file-manager/src/verdict.ts` and
`apps/api-worker/src/routes/files.ts` for the duration — all three are rewritten by more than one of
the changes, so a concurrent edit there will conflict. Also adds one per-firm migration and one
problem-type slug (`cursor-sort-mismatch`). Does NOT regenerate `packages/api-client`: the committed
client is already stale against the committed contract and two branches have collided on it.
