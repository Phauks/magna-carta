# claude/magnus-slice-1 — Magnus conversation backend, build slice 1

**Scope.** Build slice 1 of the merged Magnus plan
([design](../../specs/2026-08-06-magnus-design.md) ·
[plan](../../specs/2026-08-06-magnus-implementation-plan.md)): the conversation and turn record, the
two fail-closed consent gates, the queue-dispatched path from a submitted turn to a model answer
through the existing inference chokepoint, the poll-and-push transport, and the audit and cost
records it leaves behind. **No user interface.** Nothing reaches a provider by default — both gates
default closed and the default adapter is a deterministic stub.

**Files this stream expects to touch**

- `packages/magnus/**` (new package)
- `packages/inference/src/{port,gateway,stub}.ts`, `packages/inference/CLAUDE.md`,
  `packages/inference/test/**`
- `packages/identifiers/src/{registry,types}.ts`
- `packages/access-control/src/registry.ts`
- `packages/database/src/per-firm-schema.ts`,
  `packages/database/drizzle/per-firm/20260806T050000_magnus-conversations.sql` + journal + snapshot
- `packages/data-access/src/pii-registry.ts`
- `apps/worker/src/magnus/**`, `apps/worker/src/routes/magnus.ts`,
  `apps/worker/src/{app,index,per-firm-migrations}.ts`, `apps/worker/wrangler.jsonc`,
  `apps/worker/src/contracts/problem-types.ts`, `apps/worker/openapi/openapi.json`
- `apps/worker/test/**` (new magnus suites; inventory updates in `conformance.test.ts`,
  `me.test.ts`, `auth-provisioning-e2e.test.ts`, `contracts/problem.test.ts`)
- `packages/database/test/node-sqlite.test.ts` (seeded-permission inventory)
- `packages/api-client/src/**` (regenerated)
- `changelog.d/magnus-slice-1.md`, `status.d/magnus.md`, `roadmap.d/ai.md`,
  `docs/conventions/operations.md`

**Overlap watch.** The per-firm migration journal head and the OpenAPI snapshot are the two shared
artefacts. Migration tag `20260806T050000_magnus-conversations` at journal idx 40 (head on branch
point was idx 39, `20260806T040000_operational-fixes`); a sibling slice landing first retags. A
trust/billing contract branch regenerating the OpenAPI snapshot collides here — later merger
regenerates rather than hand-merges.
