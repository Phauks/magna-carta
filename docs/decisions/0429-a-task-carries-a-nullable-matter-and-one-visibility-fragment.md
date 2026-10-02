---
number: 429
slug: a-task-carries-a-nullable-matter-and-one-visibility-fragment
status: Proposed
date: 2026-09-01
area: Tasks
summary: "`matter_task.matter_id` is nullable, so one record and one set of routes serve both a matter's tasks and the firm's own work, and the does-not-apply branch that nullability creates is confined to one composable SQL fragment (`taskVisibilityFragment`) that every read composes rather than being answered with a second table. This is the opposite of the call `firm_event` made against `matter_event`, and the divergence is deliberate on two grounds: the mechanical half of the calendar's argument — that dropping a NOT NULL on a shipped SQLite table is a rebuild the additive-only lineage forbids — does not apply to a column that is nullable from its first migration; and the design half turns on where the records are READ. A firm event and a matter event are read on two different surfaces, so two tables match two surfaces, whereas tasks have one surface either way, because \"what is on my plate\" spans a member's client work and their firm work in one list and two tables would mean unioning them back together on the read every member makes most often. `magnus_conversation` is the shipped precedent: an optional matter link on a record whose tenancy root is the firm. The two visibility rules the fragment holds are that a task on a matter is firm-visible within it under the same visible-matter predicate every calendar source composes, and a task on none is private to its assignee and whoever created it — never firm-wide, because a firm-wide default would put \"review the associate's performance\" in front of the associate."
---

**One record, one branch, and the branch lives in one function.**

**Context:** A task needs to hold two things a firm actually has: work on a client's matter, and work
that belongs to no client at all — renewing the malpractice policy, interviewing a candidate, getting
a vendor contract reviewed. The platform had already faced this shape once, in the calendar, and
answered it by splitting the table: `firm_event` exists precisely so that `matter_event.matter_id`
can stay NOT NULL. Its table comment gives two reasons, and both deserved an answer before diverging
from it.

The first reason is mechanical: dropping a NOT NULL on a shipped SQLite table is a rebuild, and this
lineage is additive-only. That does not bind here. `matter_task` did not exist; its column is
nullable in its first migration, so nothing is being loosened.

The second reason is the real one, and it is about branches: "a null matter would put a
does-not-apply branch inside the one seam whose value is having no branches." That concern is
correct. A visibility branch copied into nine reads is a branch that will be wrong in one of them,
and being wrong in a visibility read is the worst place to be wrong.

**Decision:** Nullable, with the branch confined rather than the table split.

What decides it against the calendar's answer is where the records are read. A firm event is read on
the firm's calendar and a matter event on the matter's; two tables match two surfaces, and neither
read ever wants the other's rows. Tasks are the opposite: the read a member makes most often is "what
is on my plate", and it spans their client work and their firm work in one list. Splitting the table
would mean unioning it back together on exactly that read, which buys a NOT NULL and pays for it with
a second table, a second set of write paths, a second timeline decision, and a union in the hottest
read the subsystem has.

`magnus_conversation` is the shipped precedent for the shape chosen: an optional matter link on a
record whose tenancy root is the firm, with the matter scoping the record rather than owning it.

The branch is answered by `taskVisibilityFragment` in `packages/tasks/src/task-statements.ts`, which
is the entire population of "may this member see this task" and which every read composes. It holds
two rules:

- **A task on a matter is firm-visible within that matter**, screened by the same visible-matter
  predicate every calendar source composes. Not narrowed to the assignee: a colleague covering a file
  needs to see what is outstanding on it, and an assignee is not an access grant.
- **A task on no matter is private to its assignee and whoever created it.** There is no matter to
  screen it by, and firm-wide would be the wrong default in a specific and predictable way — "review
  the associate's performance" would be in front of the associate.

**Consequences.** The permission keys bind `resource: "firm"` rather than `"matter"`, because a
matter cannot be the tenancy root of a record that need not have one. Notifications must split into
four topics for two acts (a separate decision), because the notification registry enforces that a
matter-anchored type resolves a matter and an unanchored one does not. The timeline source carries
only tasks that are on a matter, which falls out structurally rather than by a filter. And the
confinement has to hold: a future read that writes the branch out again instead of composing the
fragment is the defect this decision exists to prevent, which is why the fragment is exported from
one module and the package's CLAUDE.md names it first among the invariants.
