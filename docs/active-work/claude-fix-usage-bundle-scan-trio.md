# claude/fix-usage-bundle-scan-trio

**Branch:** `claude/fix-usage-bundle-scan-trio` · **Off:** main (f818589) · **Owner:** Trevor Goldsmith · **Started:** 2026-08-04

## Scope

Three small, independent defect fixes — no new feature surface, no contract change:

1. **Usage `reached` telemetry can no longer fail a committed response.** The post-`next()` consent read
   plus emit ran unguarded on the response path, so a consent-read failure turned an already-committed
   2xx into a 500. It now runs off the response path with an error boundary.
2. **A reaped bundle artifact is rebuildable.** The bulk-download coordinator early-returned for every
   status except `failed`, so a `ready` job whose R2 object had been expired by the `bundles/` lifecycle
   rule was a permanently dead bundle. The coordinator now verifies the recorded artifact before sharing
   a `ready` state.
3. **The scan worker uses its configured container capacity.** Every scan addressed the single Durable
   Object name `scan`, so `max_instances: 5` was unreachable. Requests now shard deterministically by a
   stable per-file key.

## Files I expect to touch

- `apps/worker/src/usage/reached-middleware.ts`, `apps/worker/src/background.ts` (new — the
  fire-and-forget helper lifted out of `routes/files.ts`), `apps/worker/src/routes/files.ts` (import only)
- `apps/worker/src/downloads/bundle-coordinator.ts`
- `apps/scan-worker/src/{index.ts,scan-shard.ts}`, `apps/scan-worker/wrangler.jsonc`
- `apps/worker/src/files/container-scan-adapter.ts`, `packages/file-manager/src/{scan-port.ts,ingest-core.ts}`,
  `apps/worker/src/files/ingest-consumer.ts` (the shard key plumbed from the callers that hold a stable id)
- tests: `apps/worker/test/usage/reached-middleware.test.ts`, `apps/worker/test/bundle-coordinator.test.ts`,
  `apps/scan-worker/test/scan-shard.test.ts`
- `changelog.d/fix-usage-bundle-scan-trio.md`

## Coordination

No overlap with any other registered stream. The scan-port meta gains one optional field, so no call
site is forced to change; the OpenAPI contract is untouched.
