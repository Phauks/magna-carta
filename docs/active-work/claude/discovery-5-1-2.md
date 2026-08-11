# claude/discovery-5-1-2 — Discovery sub-slice 5·1·2, the review-set model

**Area:** Discovery — the corpus object, its load sources, and the record-custodian wiring.
**Status:** building.
**Spec:** [`docs/specs/2026-08-05-discovery-5-1-design.md`](../../specs/2026-08-05-discovery-5-1-design.md)
**Plan:** [`docs/specs/2026-08-05-discovery-5-1-implementation-plan.md`](../../specs/2026-08-05-discovery-5-1-implementation-plan.md)
(sub-slice 5·1·2, tasks 1–6)

## Scope

The review set, the record custodian, the load and its source lanes, and the review documents a load
allocates. Sub-slice 5·1·1 (the Rust discovery core) is merged; this is the object it produces facts
for. Processing, indexing, the review-document list read, and the load profile are 5·1·3 and 5·1·4.

- New `packages/discovery`: the closed vocabularies, the load-source contract, the review-set and
  record-custodian services, the load declaration and its lane resolution, the batched review-document
  allocation, and the R2 key layout.
- Six per-firm tables in one migration, with the forward-only state machines enforced by trigger.
- `DiscoveryLoadCoordinator` Durable Object: the load's cursor and chunk state in durable storage.
- The `discovery:*` permission scope — deliberately its own namespace, so matter access alone
  reaches no review set.
- The transcript include/exclude control on every load that could sweep assistant transcripts
  (the ratified work-product ruling).

## Files expected to touch

- `packages/discovery/**` (new)
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`
- `packages/access-control/src/registry.ts`, `packages/access-control/test/registry.test.ts`
- `packages/database/src/per-firm-schema.ts`,
  `packages/database/drizzle/per-firm/20260806T080000_discovery-5-1-2.sql`,
  `packages/database/drizzle/per-firm/meta/*`, `packages/database/test/node-sqlite.test.ts`
- `packages/data-access/src/pii-registry.ts`
- `apps/worker/src/routes/discovery.ts` (new), `apps/worker/src/discovery/**` (new),
  `apps/worker/src/app.ts`, `apps/worker/src/index.ts`, `apps/worker/src/per-firm-migrations.ts`,
  `apps/worker/src/contracts/problem-types.ts`, `apps/worker/wrangler.jsonc`
- `apps/worker/test/{conformance,me,auth-provisioning-e2e,contracts/problem}.test.ts`,
  `apps/worker/test/discovery-routes.test.ts` (new)
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/*` (regenerated)
- `tooling/lint-custodian-vocabulary.mjs` (widen to the whole repo — the half held back for this slice)
- `changelog.d/discovery-5-1-2.md`, `status.d/5-1-discovery-ingest-and-processing.md`,
  `docs/decisions/pending/*`, `roadmap.d/discovery.md`, `docs/user/features/*`

## Overlaps to coordinate

`packages/identifiers`, `packages/access-control/src/registry.ts`,
`packages/database/src/per-firm-schema.ts`, `apps/worker/src/per-firm-migrations.ts`,
`apps/worker/src/contracts/problem-types.ts`, and `apps/worker/openapi/openapi.json` are shared with
other slices. Migration tag `20260806T080000_discovery-5-1-2`; the journal idx is taken dense against
whatever is on `main` at merge.
