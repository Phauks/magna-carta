---
category: Added
audience: internal
---

A migration that rebuilds a table other tables point at is now refused at authoring time.

`REVIEWED_REBUILDS` asks whether a human audited the copy. That is the wrong question for this shape, because no amount of care makes it applicable: a rebuild drops the table it replaces, and in a durable object foreign keys are enforced at the statement and at the commit, with `PRAGMA foreign_keys=OFF` a no-op inside the single execution context a migration runs in. Four ways around it were tried against real durable-object storage and all four fail. So a drop with children cannot complete against any firm database that holds data — it completes only against the empty ones the suite used to build.

The migration-integrity sentinel now reads the schema **as it stood at that migration** — a table gains references over time, and the head's answer is not the one that decides whether the drop could have completed — and refuses any rebuild of a table anything references. Pointed at the migration that caused the outage, it names it and the thirty-five tables that reference `matter`.

The six that predate the finding are listed as debt rather than permission. Each is unappliable to a firm whose rebuilt table has children, and the list must not grow; widening a CHECK or dropping a column on a parent table needs a different answer.
