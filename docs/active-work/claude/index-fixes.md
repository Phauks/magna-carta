---
branch: claude/index-fixes
worktree: /home/user/magna-carta/.claude/worktrees/index-fixes
area: Query and index fixes for the four hot paths the custodian/calendar volume sweep named with measurements
status: building
touches: packages/calendar/src/sources/all.ts, packages/custodian/src/queries.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, apps/worker/src/per-firm-migrations.ts, packages/fixtures/src/load-profile/calendar-measurements.ts, packages/fixtures/baselines/, changelog.d/, docs/decisions/pending/, roadmap.d/
---

The follow-up the load-profile sweep deliberately left: the custodian and calendar volume profiles
landed with committed baselines and no query rewritten, so each fix here can be proved against a
baseline that already exists.

Four findings, in the order the evidence ranks them:

1. **`custodyDueBack`** — the timeline source filters `custody_movement.item_id IS NULL`, which the
   partial `custody_movement_due_back_index` says nothing about, so the planner takes
   `custody_movement_item_index` and the `IS NULL` arm matches most of the table. A correlated
   most-recent-check-out subquery then runs over what came back. The shallow matter costing the same
   as the deep one is the tell.
2. **`matter_event_participant`** — the member filter's `EXISTS` walks the single-column
   `member_user_id` index and filters `event_id` inside it.
3. **`custody_packet`** — no index covers the register list's `(created_at, id)` sort.
4. **The firm-wide window** scans 9 of 14 sources on their date columns.

Each diagnosis is confirmed with `EXPLAIN QUERY PLAN` against the profile corpus before anything
changes, and `pnpm --filter @magna-carta/fixtures run measure` is re-run after each fix against the
committed baseline. Backend and harness only — no UI. An index that does not earn its write cost is
dropped rather than added.
