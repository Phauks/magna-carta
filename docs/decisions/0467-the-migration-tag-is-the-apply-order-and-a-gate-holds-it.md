---
number: 467
slug: the-migration-tag-is-the-apply-order-and-a-gate-holds-it
status: Accepted
date: 2026-09-15
area: Architecture / Data
summary: "A migration's TAG is the order every database applies it in — migrationsFromJournal sorts the journal lexically by tag — and drizzle's dense idx is the order migrations were integrated in, which names the meta/ snapshots. The two coincide only while every new tag sorts above the lineage head, which a merge does not preserve: a branch cut before another one lands keeps its earlier timestamp and is renumbered to a later idx, after which a freshly provisioned firm builds its schema in an order no already-migrated firm ever used. That invariant moves out of a Vitest fitness function and into tooling/migration-integrity, which the gate runs on every pull request rather than only under the run-tests label — the window in which a tag still costs nothing to change, because a migration nobody has applied can be renamed and one that has reached a database cannot. The repair is idempotent and scripted rather than a hand edit during a conflict resolution. Never renumber idx to satisfy the rule: the snapshots are named for it and describe the schema at that point."
---

**A migration id is a promise about order, and the promise was being made by the wrong field.**

**Context:** Two per-firm migrations merged in September 2026 whose timestamp ids sorted below the
migration they were merged after — `20260911T000000_office-email-address-lines-and-firm-brand-images`
behind `20260911T120000_conflicts-check-numbers-and-runs`, and `20260914T090000_event-conference-link`
behind `20260914T120000_task-rungs-and-archive`. Both are the same shape: a branch cut earlier, merged
later, renumbered by drizzle to a later `idx` while its tag stood still.

Nothing failed at the time, for two compounding reasons. The assertion that would have caught it lived
in a Vitest fitness function, and the gate runs its test battery only under the `run-tests` label — so
a migration pull request without the label never checked. And the belief that made the hand-resolution
look correct was written down in three places: `tooling/migration-integrity` said "apply order is by
idx", the worker-bundle test said "the runner applies in journal ORDER", and this package's own
`CLAUDE.md` called `idx` the apply order. All three were wrong. `migrationsFromJournal` sorts by tag,
and always has.

The consequence is not cosmetic even though this instance was harmless. Apply order by tag means a
freshly provisioned firm runs an out-of-order migration BEFORE the migration it was authored on top
of, while every already-provisioned firm ran it after — so the two fleets build the same schema by
different routes, and diverge the first time one of those migrations depends on the other. Here they
touched disjoint tables, so the outcome was identical; that was luck, and luck is what a gate is for.

**Decision:** The tag is the apply order, stated once in `packages/database/src/migration.ts` and
deferred to everywhere else. `applyOrderViolations` asserts that tag order and `idx` order agree, and
it runs inside `tooling/migration-integrity` — the plain node script the gate executes on **every**
pull request — rather than only in the test battery. The remedy is always to re-stamp the incoming
migration above the lineage head, and `scripts/timestamp-latest-migration.mjs` now does it: it
re-stamps a migration that sorts below the head, not only a freshly generated `NNNN_` one, is
idempotent, steps one second past the head when wall-clock "now" would not clear it, and prints the
old and new tags because the worker bundle imports the `.sql` by name.

**Never renumber `idx` to satisfy the rule.** The `meta/` snapshots are named for it and each
describes the cumulative schema at that point; reordering `idx` would leave every snapshot describing
a state its name denies, and drizzle diffs against the highest-numbered one.

**Consequences:** The check is placed where the remedy is still free. A tag is immutable once a
database has applied it — the runner refuses an applied tag it does not recognise, which is the rule
`legacy-baselines.ts` states about its own list — so a rename is available before a migration deploys
and gone afterwards. That is exactly why the assertion belongs on the pull request rather than on the
merge: catching an inversion a day later, as happened here, only stayed cheap because no firm is
onboarded. The two existing inversions were repaired by renaming, and `docs/deploy-queue.md` records
what that obliges anyone holding a database that applied the old ids, plus the point after which the
remedy stops existing. After the first alpha firm, an inversion found post-deploy is either a
reconciling ledger rewrite (`supersedeAppliedMigrations` already provides the mechanism) or a recorded
exception — both far more expensive than the re-stamp this now forces beforehand.
