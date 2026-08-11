# claude/assets-4-3-2-3 — Matter assets, slices 4·3·2 and 4·3·3

**Scope.** Finish slice 4·3·2 (the remaining six structured classes, encumbrances and net equity, the
grouped estate schedule as of a date) and build slice 4·3·3's merge-field half (the collection-only
asset subjects, the one new assembly source) plus the custody item link coming into use.

Reconciled against
[`docs/specs/2026-08-05-matter-assets-implementation-plan.md`](../../specs/2026-08-05-matter-assets-implementation-plan.md):
the plan's Task 10 (protected identifiers) landed EARLY in slice 4·3·1, so 4·3·2's remainder is tasks
9, 11, 13 and the load-profile half of 14; task 12's firearm notice also landed early and only needs
its registry read confirming. From 4·3·3 this stream takes tasks 16, 17 and 18. Task 15
(`custom_field.target` widening to `matterAsset`) and task 19 (the starter schedule template) are
deliberately left for a following stream — task 15 is the custom-fields engine's migration and wants
coordinating with the Custodian `custodyPacket` widening.

**Files expected to be touched**

- `packages/database/src/per-firm-schema.ts` (seven new tables), `packages/database/drizzle/per-firm/`
  (one hand-registered migration at idx 42, tag `20260806T070000_matter-asset-classes-and-encumbrances`,
  plus the snapshot refresh)
- `packages/matter-assets/**` (attribute rows for six classes, encumbrances, equity, the schedule, the
  custody link assertion), `packages/matter-assets/CLAUDE.md`
- `packages/data-access/src/pii-registry.ts` (four new person-referencing tables)
- `packages/document-assembly/src/catalog/{subjects,groups,generate}.ts`,
  `src/{types,resolve,merge-statements}.ts`, `test/fixtures/shipped-keys.json`
- `packages/custodian/src/queries.ts` (one read: an item's placement, so the asset detail composes it
  rather than copying it)
- `apps/worker/src/routes/matter-assets.ts`, `apps/worker/src/contracts/problem-types.ts`,
  `apps/worker/openapi/openapi.json`, `packages/api-client/`
- `roadmap.d/core-domain.md`, `status.d/4-3-matter-assets.md`, `changelog.d/assets-4-3-2-3.md`,
  `docs/user/features/asset-register.md`

**Overlap watch.** The migration journal and the OpenAPI snapshot are the collision surfaces. Journal
head at branch point is idx 41 (`20260806T060000_billing-trust-application`); this stream takes idx 42
and assumes it is first to merge. No other migration-bearing or contract-moving branch was in flight
at branch time.
