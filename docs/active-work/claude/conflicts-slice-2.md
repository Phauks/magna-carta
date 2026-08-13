---
branch: claude/conflicts-slice-2
worktree: .claude/worktrees/conflicts-slice-2
area: Conflicts 4·1 deepening slice 2 — event triggers, the re-check ledger, the queue consumers, the cron backstop, the notification
status: building
touches: packages/conflicts/, packages/directory/, packages/notifications/src/registry.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, apps/worker/src/conflicts/, apps/worker/src/per-firm-migrations.ts, apps/worker/src/costs/recoverable-charge-consumer.ts, apps/worker/src/scheduled.ts, changelog.d/, status.d/slice-4-1-conflicts.md, docs/user/features/, docs/active-work/
---

Slice 2 of the conflicts deepening, per
[`docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md`](../../specs/2026-08-13-conflicts-deepening-implementation-plan.md).
The firing half: a corpus change that could alter an already-checked matter's answer produces a
durable, visible re-check request, and a check that satisfies it.

- **Outbox topics at the producing write points** — `packages/directory/src/topics.ts` as one frozen
  set; `linkMatterParty`, `mergeEntities`, `createEdge`, and `addIdentifier` each emit exactly one
  outbox row in the batch they were already composing. No query is added to any write path.
- **The re-check ledger** — `conflicts_recheck_request`, a per-firm migration with a partial unique
  index on the unsatisfied rows and a `BEFORE UPDATE` trigger that admits only the two satisfaction
  columns.
- **The two queue consumers** — request (cause → affected matter set → ledger rows) and run (claim,
  coalesce, check, stamp), deliberately separate so a slow check cannot back-pressure cause
  resolution. The request consumer never imports `runConflictsCheck`; neither imports
  `disposition.ts`, and a source scan proves it.
- **The cron backstop and the periodic re-scan** — the per-firm conflicts pass in `runScheduledSweep`.
- **`conflicts.hit.surfaced`** in the notifications registry, subscribing to a check-written outbox
  row the automated path emits only when a tier 1-2 hit surfaced or a matter's first hit did.

**Migration:** takes the next free per-firm journal index above `main`'s head. If another stream lands
first, this one retags to the next free index and regenerates the snapshot — never leaves a hole.

**Overlaps to watch:** `packages/database/src/per-firm-schema.ts` + the per-firm drizzle lineage +
`apps/worker/src/per-firm-migrations.ts` (any stream adding a migration), and
`packages/notifications/src/registry.ts`. This branch adds no route, so `openapi.json` and the
generated client are untouched.
