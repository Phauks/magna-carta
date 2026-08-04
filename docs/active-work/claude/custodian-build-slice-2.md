---
branch: claude/custodian-build-slice-2
worktree: .claude/worktrees/agent-a9a28ccfabc0f4d34
area: Slice 4·2·2 Custodian — review dates and reminders, register reports, printable labels
status: building
touches: packages/custodian/, packages/database/, packages/telemetry/, apps/worker/, changelog.d/, status.d/, docs/user/, docs/decisions/pending/
---

Build stream for slice 4·2·2 of Custodian, continuing from the merged register slice
(`claude/custodian-build-slice-1`) against the accepted design
(`docs/specs/2026-08-04-custodian-design.md`) and its implementation plan
(`docs/specs/2026-08-04-custodian-implementation-plan.md`).

Ships three things:

- **Review dates and the reminder emission seam.** `review_on` and `review_interval_months` on
  packets and items; completing a review appends a `reviewed` movement and rolls the date forward on
  the anniversary cycle. One collection point (`collectCustodyReminders`) serves both review dates
  and overdue check-outs, so the Notifications registry wires to a seam rather than to a bespoke
  scheduler.
- **Register reports.** Holdings per owner, holdings per location with occupancy counts, items and
  packets due for review, and packets under hold. Overdue check-outs already ship from the register
  slice and are the fifth report, unchanged.
- **Printable labels.** Code 128 barcode label sheets as SVG for packets and locations, rendered
  in-house with no dependency.

Deliberately NOT built here, and left as the schema seam the register slice landed:

- **The destruction request/approval workflow.** `custody_destruction_request` exists as a table with
  no service, no route, and no code path that writes it. Owner-gated.
- **Retention policy of any kind.** No `retention_until` column, no default, no derived value, no
  sweep — the design's hardest line, and this slice does not soften it.
- Gated release, receipts, portal visibility, stocktake, and the will-on-death jurisdiction engine.

Files this stream owns:

- `packages/custodian/**`
- `packages/database/src/per-firm-schema.ts` (append-only edits to the two custody tables), the new
  per-firm migration + its journal entry, `apps/worker/src/per-firm-migrations.ts`
- `packages/telemetry/src/metrics.ts`
- `apps/worker/src/routes/custody.ts`, the OpenAPI snapshot and the generated api-client
- `apps/worker/test/{conformance,custody-routes}.test.ts`
- `docs/user/features/safe-custody-register.md`, `status.d/4-2-custodian.md`, `changelog.d/`,
  `docs/decisions/pending/`

Overlaps to coordinate: `packages/database/src/per-firm-schema.ts` and
`apps/worker/src/per-firm-migrations.ts` are append-only here, and the migration carries a later
timestamp tag than the register slice's head so the journal reconciles by ordering rather than by
edit. `custody_movement` is rebuilt in place to widen its kind vocabulary — that is the one
non-additive statement in the migration, and it is why it is hand-written.
