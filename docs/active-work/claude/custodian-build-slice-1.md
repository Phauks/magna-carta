---
branch: claude/custodian-build-slice-1
worktree: .claude/worktrees/claude/custodian-build-slice-1
area: Slice 4·2·1 Custodian — the register (schema, domain package, routes, telemetry)
status: building
touches: packages/custodian/, packages/database/, packages/identifiers/, packages/access-control/, packages/data-access/, packages/telemetry/, apps/worker/, changelog.d/, status.d/, docs/user/
---

Build stream for slice 4·2·1 of Custodian, from the accepted design
(`docs/specs/2026-08-04-custodian-design.md`) and its implementation plan
(`docs/specs/2026-08-04-custodian-implementation-plan.md`). Ships the register: the custody location
tree rooted at a firm Location, packets and the items inside them, the mandatory Directory owner
link, firm-scoped custody numbers on the matters allocation-ledger idiom, the append-only movement
ledger with borrower and due-back tracking, holds, and scanned-copy binding over ordinary File
Manager files.

Owner decisions taken as the design recommends: packet is the unit of custody and item the unit of
description; the Directory owner link is mandatory with no escape hatch; scans for a matterless
packet file onto a per-firm system holding matter, so `file.matter_id` stays `NOT NULL`.

Deferred to later custodian slices and deliberately not built here: review dates and their reminder
emission, the destruction request/approval workflow (its table ships as a schema seam only), labels
and barcodes, the register reports, gated release, receipts, portal visibility, stocktake, and the
will-on-death jurisdiction engine.

Files this stream owns:

- `packages/custodian/**` (new package)
- `packages/database/src/per-firm-schema.ts` (append-only), a new per-firm migration + its journal
  entry, `apps/worker/src/per-firm-migrations.ts`
- `packages/identifiers/src/{registry,types}.ts`, `packages/access-control/src/registry.ts`
- `packages/data-access/src/pii-registry.ts`, `packages/telemetry/src/{events,metrics}.ts`
- `apps/worker/src/routes/custody.ts`, `apps/worker/src/app.ts`,
  `apps/worker/src/contracts/problem-types.ts`, the OpenAPI snapshot and the generated api-client
- `apps/worker/test/{conformance,me,auth-provisioning-e2e}.test.ts` (inventory lists only)

Overlaps to coordinate: `apps/worker/src/per-firm-migrations.ts` and
`packages/database/src/per-firm-schema.ts` are also touched by `claude/search-write-pipeline` and
`claude/fix-matters-numbering` — this stream appends only, and its migration carries a later
timestamp tag so the journal reconciles by ordering rather than by edit.
