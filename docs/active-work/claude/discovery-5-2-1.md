# claude/discovery-5-2-1 — discovery review coding and the review-set access list

**Scope.** The backend half of discovery 5·2·1 per
[`docs/specs/2026-08-07-discovery-5-2-review-workflow.md`](../../specs/2026-08-07-discovery-5-2-review-workflow.md):
the tagging/coding model (groups, tags, per-document rows, the event journal), the per-review-set
access list with its SQL-composed visibility predicate, the two new discovery permission keys, and
the routes a review surface sits on. The Svelte surface itself is deferred to the owner.

**Files this stream expects to touch**

- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — five new handles
- `packages/database/src/per-firm-schema.ts` — five new per-firm tables
- `packages/database/drizzle/per-firm/20260808T000000_discovery-review-coding-and-access.sql`
  and `meta/_journal.json` + a refreshed snapshot
- `apps/worker/src/per-firm-migrations.ts` — the hand-registered migration (idx 51)
- `packages/discovery/src/` — `review-set-access-statements.ts`, `review-set-access-service.ts`,
  `review-set-visibility.ts`, `coding-panel-statements.ts`, `coding-panel-service.ts`,
  `coding-statements.ts`, `coding-service.ts`, `coding-progress-statements.ts`, plus additions to
  `types.ts`, `limits.ts`, `validation.ts`, `r2-keys.ts`
- `packages/discovery/test/` — new suites, including the access-list source-fitness pass
- `packages/access-control/src/registry.ts` and the four other permission inventories
- `apps/worker/src/routes/discovery.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/` (regenerated)
- `apps/worker/test/conformance.test.ts` (the not-vacuous operation list)
- `changelog.d/`, `status.d/`, `docs/decisions/pending/`, `docs/user/`, `docs/deploy-queue.md`

**Overlap watch.** `apps/worker/src/routes/discovery.ts` and `packages/discovery/` are this stream's
alone. The cross-cutting files above (the permission registry, the conformance list, the migration
journal) are append-only edits at the tail.
