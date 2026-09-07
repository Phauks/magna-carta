---
category: Fixed
audience: internal
---

Table-rebuild migrations only believed they had disabled foreign keys, and a firm's database paid for it.

`PRAGMA foreign_keys` is a no-op inside a transaction — SQLite honours it only when no transaction is open, and reports success either way. Every rebuild migration writes `PRAGMA foreign_keys=OFF` in its own text, and the runner executes that text inside `transactionSync`, so enforcement was never actually off. A rebuild drops the old table, `DROP TABLE` on a parent with enforcement live fires a violation for every child row, and the migration failed with `FOREIGN KEY constraint failed` — taking the firm's whole database with it, because the per-firm lineage is applied in the durable object's constructor ahead of any read it serves.

It passed everywhere it was tested. A database with no rows has no children to orphan, and the test harness applied migrations in a bare loop with no transaction and no enforcement at all — so the one condition that triggers this could not arise. A harness that applies migrations differently from production is not testing the migrations, and it now applies them the same way: enforcement on, each migration in a transaction, the pragma toggled outside it.

The pragma moves to where SQLite honours it, in the migration target either side of the transaction, and is restored in a `finally` so a failed migration cannot leave enforcement off for the reads that follow. What that owes back is paid inside the transaction: `PRAGMA foreign_key_check` runs before the ledger row commits, so a migration that genuinely orphans a row now aborts and rolls back rather than committing a dangling reference for a later read to trip over. That is a stronger guarantee than the one the migrations thought they had.

The copy control also carries a faulted row's reason now, not just its status — a report that said "Firm database: Not answering" and stopped handed over the symptom with the diagnosis stripped out of it.
