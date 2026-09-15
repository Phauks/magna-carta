---
category: Fixed
audience: internal
---

**Two per-firm migrations were applied in an order no already-migrated firm ever used.** `20260911T000000_office-email-address-lines-and-firm-brand-images` and `20260914T090000_event-conference-link` were each cut on a branch before the migration they were merged after, so drizzle gave them the later `idx` while their timestamp ids still sorted earlier. Apply order is by TAG, so a freshly provisioned firm ran them first and an already-provisioned one ran them last. They are re-stamped to `20260911T120001_…` and `20260914T120001_…`; the schema outcome was identical either way, because the four migrations involved touch disjoint tables — this was a live tripwire, not a live defect.

**The belief that caused it was written down in three places.** `migrationsFromJournal` sorts the journal lexically by tag, and that is the order every database applies in; `idx` is drizzle's dense counter and names the snapshots. The integrity checks said "apply order is by idx", the bundle test said "the runner applies in journal ORDER", and the database `CLAUDE.md` called `idx` the apply order. All three are corrected, and `migration.ts` now carries the statement the others defer to.

**Why nothing failed before it landed.** The ordering assertion lived only in a Vitest fitness function, and the gate runs its test battery under the `run-tests` label. A migration pull request without the label never checked. `applyOrderViolations` moves the assertion into `tooling/migration-integrity`, which the gate runs on **every** pull request — the window in which a tag still costs nothing to change, because a migration nobody has applied can be renamed and one that has reached a database cannot.

**And the repair is now one command.** `scripts/timestamp-latest-migration.mjs` re-stamps a migration that sorts below the lineage head, not just a freshly generated `NNNN_` one — the case that arises every time `main` is merged into a branch carrying a migration. It is idempotent, steps one second past the head when wall-clock "now" would not clear it, and prints the old and new tags because the worker bundle keys off the filename.

A tag is immutable once a database has applied it, so the rename is only free while no firm is onboarded. `docs/deploy-queue.md` records what must be recreated and the point after which this remedy is gone.
