# claude/financial-reporting-1 — financial and trust-compliance reporting, build sub-slice 3·6·1

**Scope.** The bar-audit pack: the first shipped capability in the `reports` area. Follows
[`docs/specs/2026-08-13-financial-reporting-implementation-plan.md`](../../specs/2026-08-13-financial-reporting-implementation-plan.md)
sub-slice 3·6·1 (tasks 1–7) and its companion design. Backend only — the UI is deferred to the
owner. The remaining four sub-slices (financial, productivity, operational, delivery) are not in
this stream.

**Status.** built (backend) — open for review

## What landed

Everything below except the filed pack artifact and its production record, which are named as
unbuilt: they need a renderer this repository cannot run, and shipping two append-only tables nothing
writes into would be schema a later slice works around rather than a seam it uses.

## What this stream builds

- `@magna-carta/reporting` — a new pure package that composes nothing and holds no binding, with the
  read-only purity fitness function landing before the first read.
- The five `reports:` permission keys and their Owner/Admin seed.
- Bitemporal `select…Statement` builders in `packages/trust/src/statements.ts` — the existing as-of
  statements are not changed.
- The pack's seven sections, its agreement tests against the aggregates trust already owns, and the
  reproducibility test.
- `GET /api/v1/reports/trust-compliance/{trustAccountId}`, the production enqueue and its queue
  consumer, and the two append-only production tables.
- A `reports-measurements.ts` load profile and the user guide.

## Files this stream expects to touch

- `packages/reporting/**` (new)
- `packages/trust/src/statements.ts`, `packages/trust/test/schema-name-sync.test.ts`
- `packages/access-control/src/registry.ts`, `packages/access-control/test/registry.test.ts`
- `packages/database/drizzle/per-firm/` (two migrations + journal + snapshot),
  `packages/database/src/per-firm-schema.ts`, `packages/database/test/node-sqlite.test.ts`
- `apps/worker/src/per-firm-migrations.ts`, `apps/worker/src/routes/reports.ts`,
  `apps/worker/src/reports/**`, `apps/worker/src/app.ts`, `apps/worker/src/index.ts`,
  `apps/worker/wrangler.jsonc`, `apps/worker/openapi/openapi.json`,
  `apps/worker/test/conformance.test.ts`, `apps/worker/test/me.test.ts`,
  `apps/worker/test/auth-provisioning-e2e.test.ts`
- `packages/api-client/**` (generated)
- `packages/fixtures/src/load-profile/reports-measurements.ts`
- `changelog.d/`, `docs/decisions/pending/`, `status.d/`, `roadmap.d/reports.md`,
  `docs/user/features/`

## Overlaps to coordinate

`apps/worker/src/per-firm-migrations.ts`, `packages/database/drizzle/per-firm/` and
`packages/database/src/per-firm-schema.ts` are declared by `claude/conflicts-slice-2` and
`claude/index-fixes`; `changelog.d/`, `docs/decisions/pending/` and `packages/fixtures/baselines/`
are declared by several streams. Migration indices are appended, never renumbered — sync `main`
before the migration lands.

`packages/ledger/src/statements.ts` is claimed by the dormant `slice-3-5-operating-general-ledger`
branch. This stream adds no ledger statement: every new read is over trust's own tables and lands in
`packages/trust/src/statements.ts` instead.
