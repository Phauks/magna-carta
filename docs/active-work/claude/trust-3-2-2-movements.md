---
branch: claude/trust-3-2-2-movements
area: Trust accounting — sub-slice 3·2·2 (movement operations)
status: building
touches: packages/trust/, packages/database/ (one table + one migration), packages/identifiers/, apps/worker/ (first trust routes), docs
---

# Trust accounting 3·2·2 — deposits, disbursements, matter-to-matter transfers

Builds the movement operations over the 3·2·1 foundation: money into a client's matter ledger,
money out of it, and a reallocation between two matters of the same client. Each movement is an
ordinary balanced ledger entry composed through the existing composition guard, plus one
`trust_movement` record carrying the per-client-ledger facts the bar rules require — source or
payee, purpose, method, reference, and the authorizing member.

Governing owner decisions honoured: the three-level client-to-matter tree, build before the
pre-beta baseline, available balance (not stored balance) as the disbursement ceiling, and the
refusal of any movement touching two clients. The earned-fee evidence question stays behind the
existing port and is not answered here.

## Files this stream expects to touch

- `packages/trust/src/movements.ts` (new), `src/composition-guard.ts`, `src/statements.ts`,
  `src/types.ts`, `src/trust-validation.ts`, `src/fitness.ts`, `package.json`
- `packages/trust/test/movements.test.ts` (new), `test/support.ts`,
  `test/composition-guard.test.ts`, `test/schema-name-sync.test.ts`, `test/fitness.test.ts`
- `packages/database/src/per-firm-schema.ts` (one new table),
  `packages/database/drizzle/per-firm/20260805T140000_trust-movements.sql` + journal + snapshot
- `packages/identifiers/src/registry.ts` + `src/types.ts` (one handle)
- `apps/worker/src/per-firm-migrations.ts`, `src/routes/trust.ts` (new), `src/app.ts`,
  `src/contracts/problem-types.ts`, `package.json`, `openapi/openapi.json`
- `apps/worker/test/routes/trust.test.ts` (new), `test/contracts/problem.test.ts`
- `packages/api-client/src/*.gen.ts` (regenerated from the snapshot)
- `changelog.d/trust-movements.md`, `status.d/3-2-trust-accounting-jurisdiction-compliance.md`

No new permission keys — `trust:read` and `trust:manage` landed with 3·2·1 — so the four permission
inventories are untouched. No UI.
