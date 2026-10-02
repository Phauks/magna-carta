---
number: 470
slug: a-renamed-migration-tag-is-reconciled-at-runtime-not-recreated
status: Accepted
date: 2026-09-16
area: Data & migrations
summary: A migration tag renamed after it deployed is reconciled in the applied-ledger at runtime, from a recorded registry of renames — recreating the database is no longer the remedy.
---

A migration tag renamed after it deployed is reconciled in the applied-ledger at runtime, from a recorded registry of renames — recreating the database is no longer the remedy.

**The problem.** A tag is immutable once it is on `main`, because `main` is production. The applied-ledger records the TAG and not the SQL behind it, so renaming a deployed migration leaves every database that ran it holding an id the lineage no longer contains, and the runner refuses the whole lineage for the life of that database. On 2026-09-15 two per-firm migrations were re-stamped anyway, to repair an apply order a merge had inverted, and the repair was right. What made it safe was a premise about the fleet: no firm onboarded, both pools empty and recreatable, so any affected database could simply be recreated. The premise was wrong. A firm database had applied one of the two retired ids and stopped answering the moment the rename deployed.

**Why "recreate it" is the wrong remedy to build on.** It is a claim about the whole fleet, checked once, at the moment it is most tempting to believe. It decays silently — the window closes when a database acquires data worth keeping, and nothing announces that. And the per-firm database is a firmId-addressed Durable Object, so acting on the claim is not a drop and a re-provision but either wiping durable storage or moving the firm to a new id. The remedy is at its least available exactly when it is needed.

**The decision.** A rename is recorded as data in `packages/database/src/re-stamped-migrations.ts`, and `runPendingMigrations` consults it before refusing an unknown tag: it rewrites the retired ledger row to the id the migration carries now, through the same `supersedeAppliedMigrations` seam a baseline collapse uses. This is correct whether or not the premise held, and it costs one ledger rewrite.

**Why it is sound, and where it stops.** A re-stamp moves the id and nothing else, so a ledger holding the old id already carries exactly the schema the new id names and the rewrite asserts nothing that is not already true. That is the entire justification, which is why an entry is legitimate only for a pure rename: a tag whose SQL also changed is not a re-stamp, and listing one would claim a schema the database does not have. Three shapes stay refused, in their own words — a ledger holding both ids of one re-stamp, a deployment older than the rename, and a genuinely unknown tag.

**Kept separate from the baseline collapse.** `LEGACY_BASELINES` retires a chain behind one new migration and reconciles only on an exact, complete match of that chain; that completeness rule is what makes it safe. A re-stamp retires one tag for one other, independently of the rest of the ledger. Folding them together would mean loosening the rule.

**Recorded once.** The immutability gate reads the registry directly rather than asking for the same fact in `allowed-changes.mts`, so the gate and the runner cannot disagree about which retired tags a database may still hold. That narrows the allowance list to its real case: a tag going away with nothing standing in for it.

**What it does not change.** Renaming a deployed tag is still the last resort, and `tooling/migration-integrity` still refuses an inverted apply order on every pull request — the window where a rename is genuinely free, because the migration has not reached a database yet. This decision is about what the fleet is owed when that window is misjudged, not about widening it.
