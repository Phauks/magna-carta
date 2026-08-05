---
branch: claude/trust-ledger-slice-1
area: Trust accounting — slice 3·2·1 (schema + by-construction invariants)
status: building
---

# Trust accounting 3·2·1 — the trust ledger schema and its structural guards

Builds the first sub-slice of trust accounting: the per-firm trust schema, the client-to-matter
account tree over the existing `ledger_account` sub-ledger seam, and the invariants that must hold
**by construction** rather than by a caller remembering them. Movement operations (receipt,
disbursement, the close precondition), the jurisdiction corpus, reconciliation, and compliance
surfacing are later sub-slices and are only seamed here.

Owner-decided 2026-08-05: the three-level account tree (trust-account parent, client node, matter
leaf) and building trust before the pre-alpha per-firm baseline collapse. Every other open decision
in `docs/research/2026-08-04-trust-accounting-analysis.md` is deferred, not silently defaulted.

## Files this stream expects to touch

- `packages/trust/` (new package — the whole subsystem)
- `packages/database/src/per-firm-schema.ts` (four new tables), `packages/database/drizzle/per-firm/`
  (two new migrations), `packages/database/test/node-sqlite.test.ts` (seeded-permission inventory)
- `packages/identifiers/src/registry.ts` + `src/types.ts` (four handles)
- `packages/access-control/src/registry.ts` (`trust:read`, `trust:manage`)
- `packages/ledger/src/fitness.ts` + its test (the parent-balance roll-up query)
- `packages/data-access/src/pii-registry.ts`
- `apps/worker/src/per-firm-migrations.ts`, `apps/worker/test/me.test.ts`,
  `apps/worker/test/auth-provisioning-e2e.test.ts` (permission inventories)
- `docs/conventions/invariants.md` (the fees-never-touch-trust attribution the analysis flags),
  `status.d/3-2-trust-accounting-jurisdiction-compliance.md`, `roadmap.d/financial.md`,
  `changelog.d/`, `docs/decisions/pending/`

No API routes and no UI in this sub-slice, so `apps/worker/openapi/` and `packages/api-client/` are
untouched.
