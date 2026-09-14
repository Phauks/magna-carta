---
category: Changed
audience: public
---

**A task's state becomes four rungs — To Do, In Progress, On Hold, Done — and cancelling is replaced
by archiving.** The rungs are one control group in the record window's action bar; beside them sit
the only two other things that happen to a task, and they differ in one thing: archiving keeps the
data, deleting takes it. Archiving is orthogonal to the rungs — a task is archived FROM where it
stood and comes back there — so the list's foot now offers **Show Done** and **Show Archived** as two
questions rather than one. The archive reason is optional, which is the whole lesson of the state it
replaces: cancelling required one, and nobody used it.

**The schema route is the finding, not the change.** `matter_task.state` is a CHECK-constrained enum
on a table `time_entry`, `matter_task_document` and `matter_task_external_link` all reference — plus
its own `blocked_by_task_id`. SQLite cannot alter a CHECK, and the rebuild that would has to drop the
table, which a durable object refuses at the commit for every child row: the migration applies to an
empty database and takes every real firm's offline on wake, which has happened here before. Six
mechanisms were probed against real durable-object storage and all six fail — including
`PRAGMA writable_schema`, SQLite's own documented way to change a constraint with nothing dropped,
which workerd's authorizer answers with `SQLITE_AUTH`.

So `state` narrows to the one thing the database pairs it with by CHECK — is the work finished — and
the three open rungs arrive as an added `progress` column, with `archived_at`/`archived_by`/
`archive_reason` beside it. `ALTER TABLE … ADD COLUMN` drops nothing, so it lands on a parent, and the
same probe file proves the three properties the route rests on: an added column may carry its own
CHECK, that CHECK may name a second column, and existing rows take the default. The reader's four
rungs are reassembled from the two columns in exactly one function. Recorded as
ADR-a-vocabulary-on-a-parent-table-grows-by-adding-a-column, which is the general answer for this
fleet rather than a note about tasks.

`20260914T120000_task-rungs-and-archive` carries every cancelled task onto the archive columns with
its reason intact, and `packages/database/test/task-rungs-migration.test.ts` runs it over rows rather
than over an empty database — the gap both of this repository's migration outages came through.

## Public

**Tasks now move along four rungs: To Do, In Progress, On Hold, Done.** They are one row of controls
at the bottom of a task's window, and the one it is on looks pressed, so you can see where anything
stands at a glance. Done is on the list too, beside each row, because ticking finished work off is
what a list is for. Moving a task off Done puts it back where it was rather than at the start.

**Cancelling is gone; archiving replaces it.** Archive keeps the task and everything it carries, and
**Show Archived** brings it back into view whenever you want it; **Put Back** returns it to the rung
it left from. You can say why you archived something, but you no longer have to. Delete is still
there for a task that should not exist at all — it removes the task for good.
