# access-triggered-rescan

**Branch:** `access-triggered-rescan` (worktree `C:/dev/magna-carta-2-1-dev`, off `main` at the slice 2·1 merge).
**Scope:** file-level access-triggered re-scan + the dedup-skip reader, with informed-access (no data loss) for an infected-on-re-scan finding. Design: [`docs/specs/2026-06-22-access-triggered-rescan-design.md`](../specs/2026-06-22-access-triggered-rescan-design.md).

**Expected touch points:** `apps/worker/src/routes/files.ts` (the access trigger on open/preview/download), `apps/worker/src/files/ingest-consumer.ts` (the in-place re-scan path — read-only on `ingest-core.ts`), `packages/file-manager/src/{file-statements,file-service,scan-cache,queries}.ts` (in-place verdict statement, the engine-version setting, the cache reader), `apps/worker/src/scheduled.ts` (remove the proactive sweep). Status: design written; not yet planned/built.
