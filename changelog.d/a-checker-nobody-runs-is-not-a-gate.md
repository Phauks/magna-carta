---
category: Fixed
audience: internal
---

**The drizzle snapshot-freshness checker was correct, complete, and wired into nothing — so the
per-firm snapshot fell behind the schema twice, weeks apart, and both times the damage was found by
the next person who ran `generate` rather than by a gate.** The second occurrence sat on `main` long
enough that a generate there would have re-emitted fourteen statements, including a destructive
`review_document` table rebuild aimed at firms that already had those columns. `check-snapshots` now
runs in three places, and the failure names its own repair.

The mechanism is a property of drizzle-kit, not a mistake: it writes a snapshot only as a side effect
of emitting a migration. Every hand-written migration — the normal case in this repository, because
partial indexes, FTS5 tables, seeds and ordered column adds cannot be generated — advances the journal
while `meta/` stands still. Nothing observable happens at that moment. The cost lands later, when the
next `generate` diffs against the stale snapshot and re-emits every table added since.

That is exactly the failure shape a gate exists for: silent at the point of introduction, expensive
and confusing at the point of discovery, and cheap to detect at any time in between. Detecting it
costs 2.6 s for both lineages, which is why it goes in all three tiers rather than being rationed:

- **`pnpm check:scoped`** — conditional, triggered by any change under `packages/database/`. The
  trigger is deliberately wider than the checker's true inputs; deciding which file reaches the
  drizzle generator costs more thought than the three seconds costs time.
- **`pnpm check`** — unconditional. The whole-repo gate is the one that is real today: the CI account
  is billing-blocked and `gate.yml` has executed nothing since 2026-08-05.
- **`gate.yml`, `governance` job** — unconditional, beside the migration-integrity test, which proves
  the committed chain is sound while this proves the snapshot still describes it. Ready for when CI
  starts running again.

The `--check` failure message previously read "Re-run without --check to repair", which is true and
leaves the reader to work out what the command is. It now prints the exact
`refresh-<lineage>-snapshot` invocation, the snapshot file it rewrites, and the fact that it belongs
in the same commit as the migration.

Verified by reproduction rather than by reading: adding one scratch column to the per-firm schema
without refreshing made `check:scoped` fail at the new step in 3 s with the repair instructions; the
advertised repair command fixed it and proved its own settle; reverting the column returned the gate
to green. No reviewer checklist was added — the rule already has a home in
`packages/database/CLAUDE.md`, and what it lacked was enforcement, not another place to be written
down.
