---
branch: claude/custodian-4-2-4-stocktake
worktree: .claude/worktrees/agent-a9013470e95bc7614
area: Custodian slice 4·2·4 — stocktake (periodic physical-inventory verification)
status: building
touches: packages/custodian/src/stocktake-*, packages/custodian/test/, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/ (new migration 20260805T150000_custodian-stocktake + snapshot 0029), packages/identifiers/src/{registry,types}.ts, apps/worker/src/{per-firm-migrations.ts,routes/custody.ts,contracts/problem-types.ts}, apps/worker/openapi/openapi.json, packages/api-client/, apps/worker/test/{custody-routes,conformance}.test.ts, apps/worker/test/contracts/problem.test.ts, status.d/4-2-custodian.md, changelog.d/custodian-stocktake.md
---

Periodic physical-inventory verification over the packet/item/location/movement model
shipped in slices 4·2·1 to 4·2·3: open a stocktake scoped to a location subtree or the
whole register, record sightings and exceptions as they are counted, close it producing
a reconciliation of what the register expected against what a person actually saw.

**Observe-only, structurally.** A stocktake reports; it never disposes, relocates, or
auto-corrects. Nothing on this path writes `custody_movement`, `custody_packet`, or
`custody_item` — the reconciliation lists _proposed_ corrective movements a person then
records by hand through the existing one movement write path. Destruction and retention
stay owner-gated (flags C4-C11 unanswered) and are untouched here.

Sighting rows are evidentiary (who verified what, where, when), so
`custody_stocktake_sighting` carries the movement ledger's append-only discipline: BEFORE
UPDATE / BEFORE DELETE `RAISE(ABORT)` triggers plus the INSERT-OR-REPLACE bypass closure.

Journal-tail assumption: per-firm head is idx 28 = `20260805T140000_trust-movements`;
this stream adds idx 29 = `20260805T150000_custodian-stocktake`.

Overlap note: `claude/undeclared-body-contract-fix` carries no migration and does not
touch `packages/custodian`, but it does regenerate the OpenAPI snapshot and the
api-client — both streams move the emitted contract, so whichever merges second may need
a trivial regeneration rebase.
