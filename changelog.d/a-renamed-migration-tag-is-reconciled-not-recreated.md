---
category: Fixed
audience: internal
---

**A firm database that applied a migration under its pre-rename id now reconciles itself on wake, instead of refusing to start.**

The 2026-09-15 re-stamp of `20260911T000000_office-email-address-lines-and-firm-brand-images` and `20260914T090000_event-conference-link` was taken on the premise that no database could have applied either id — no firm onboarded, both per-firm pools empty and recreatable. A firm database had applied the first of them. From the moment the rename deployed it refused to wake, because the applied-ledger records the TAG and that id named a migration the lineage no longer contained. Every route that needs firm data answered with the build panel's `Firm database: Not answering`, and the runner's sentence for it — `deploy mismatch (code older than schema)` — pointed at the opposite of the truth: the deployment was newer than the rename, not older.

`packages/database/src/re-stamped-migrations.ts` records a rename as data, and `runPendingMigrations` consults it before it refuses. A re-stamp moves the id and not the SQL, so the schema the database has is already the schema the new id names, and the ledger row is rewritten through the `supersedeAppliedMigrations` seam the baseline collapse already uses — one transaction, no schema SQL, resumable if it is interrupted part way.

Three shapes are still refused, each in its own words: a ledger holding both ids of one re-stamp, which the rewrite cannot express and should not guess at; a deployment older than the rename, which is told to roll forward rather than sent hunting for a schema change nobody made; and a genuinely unknown tag, which is the deploy mismatch the original sentence was written for.

The immutability gate reads the registry directly, the way it already reads `LEGACY_BASELINES`, so a rename is recorded once and the gate and the runner cannot drift into disagreeing about which tags a database may still be holding. `tooling/migration-immutability/allowed-changes.mts` is correspondingly narrowed: it is for a tag going away with nothing standing in for it, and the 2026-09-15 rename is now its worked example of an entry that should not be written there — an allowance asserts nothing needs repairing, which is a claim about the fleet that is easy to believe and hard to check.
