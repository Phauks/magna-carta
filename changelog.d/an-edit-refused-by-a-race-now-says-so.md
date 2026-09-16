---
category: Fixed
audience: public
---

**A guarded write refuses its batch instead of being reported on after it commits.** A statement whose WHERE repeats the precondition its caller read is marked `guarded(statement, label)` in its effect; affecting no rows now raises from inside the transaction, so the audit row and outbox message riding the same batch roll back with it. Previously the WHERE clause protected the row and nothing else — `batch()` surfaces no per-statement row count, `commitEffectBatch` returned void, the route answered 200, and the unguarded audit statement recorded the refused edit. Both SQLite adapters enforce it, the Durable Object returns it as a typed `unaffectedGuard` outcome beside `uniqueConstraint`, and `commitEffectBatch` refuses a guarded effect handed to an adapter that has not declared `enforcesGuardedWrites`. The fee and cost ledgers adopt it and map the refusal onto the 409 they already return, so no contract moves. `pnpm run lint:guarded-writes` holds the line.

## Public

An edit that loses a race now says so instead of reporting success. Changing a fee or cost entry that somebody else invoices at the same moment is refused — the entry and its invoice were always protected, but the answer used to report the change as applied, and you only saw otherwise on a reload. The refusal is the same one you get for editing an entry that has already been billed, and nothing is recorded against the entry for a change that did not happen.
