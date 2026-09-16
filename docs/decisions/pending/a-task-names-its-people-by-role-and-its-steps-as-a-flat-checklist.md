---
slug: a-task-names-its-people-by-role-and-its-steps-as-a-flat-checklist
status: Accepted
area: Tasks
date: 2026-09-16
summary: "A task carries its people in `matter_task_participant` — one row per person per task, each in one of four closed roles (responsible, assigned, reviewer, watcher) held by a CHECK — and the one-name `assignee_user_id` column is retired where it stands after a migration copies every value across as `assigned`. A role is never a permission or a gate: it decides who is told and whose list the task is on, and \"my tasks\" includes the tasks I watch. The assign permission governs the DIFFERENCE a write makes — naming another member in a work role or taking them out of one — so a member without it may still take a task and add watchers, and re-sending the current list is never a refusal. The checklist inside a task is `matter_task_checklist_item`: flat lines with a title and a tick, no people, no date, no priority, no rollup, written live rather than on Save. The sub-task tree stays refused; the checklist is the part of it people use."
---

**A task's people are a list of roles, and its steps are lines, not tasks.**

**Context:** The task record carried one assignee. The owner's review of the deployed surface said
the one name was the wrong shape — a real piece of work has somebody responsible for it, one or more
people assigned to do it, and colleagues who only want to watch it — and asked for the to-do list
ClickUp puts inside a task. The scope study of 2026-09-01 had recommended keeping the one name and
had left the checklist open as flag T5, noting that the design's refusal was aimed at task trees
rather than at a flat list.

**Decision:** The people move into `matter_task_participant`, one row per person per task with a
role from a closed vocabulary of four: `responsible`, `assigned`, `reviewer`, `watcher`. The owner
named three; `reviewer` is the one a firm's work has that a general product does not name, and it is
what makes "done" mean something on a task somebody else drafted. The vocabulary is a CHECK, so a
fifth role is a reviewed migration. A person holds one role on one task, by unique index: somebody
who both does the work and reviews it is somebody doing the work, and two rows would put them on a
list twice.

`assignee_user_id` is retired on the parent table rather than dropped (a-vocabulary-on-a-parent-table
-grows-by-adding-a-column): the migration copies every value across as an `assigned` participant
whose handle is derived from the task's own token, empties the column in the same statement set, and
nothing reads or writes it again. The index built on it stays for the same reason.

A role is not a permission and not a gate. Nothing about who is on a task changes who may move or
finish it; what a role decides is who is TOLD and whose list the task is on. The visibility rule for
a task on no matter reads the participant table in every role, so adding a colleague as a watcher
on the firm's own work is what lets them see it.

The assign permission is applied to the difference a write makes rather than to the list it sends.
Naming somebody other than the actor in a work role (responsible, assigned, reviewer), or taking
them out of one, is refused without it; taking a task oneself and adding or removing watchers is
not, because watching is a subscription and not an obligation. The service does the check on the
diff, handed the route's answer, so re-sending the current set is never a refusal and the route
carries the write permission alone.

Every person who joins a task is told in the role they joined in, and every person whose role moves
is told; nobody is told they left and the actor is never told about themselves. The four existing
topics carry it, with the role added to the payload and a `role` fact on the card.

The checklist is `matter_task_checklist_item`: a title, a position, and a tick (actor and instant
together or neither, by CHECK). A line has no people, no date, no priority, no documents and no
time, and ticking every line completes nothing — the task's rung is a fact somebody moves. That is
the whole distinction between this and the sub-task tree the design refuses, which needs rollup
semantics, depth limits and a recursive read. The lines are written live, each its own batch,
because a checklist that had to be Saved is a checklist nobody ticks; on a task that does not exist
yet they are written in the task's own batch.

**Consequences.** Every read that asked "whose is this" now reads the participant table beside the
page, in one bounded read keyed by the page; the calendar's task source resolves its one actor slot
to the first responsible or assigned member and filters "my calendar" through the same table. The
list filter `assigneeUserId` becomes `participantUserId`. The plan acceptance writes the resolved
role as an `assigned` participant. Every participant and checklist write stamps the task as changed,
so the change feed reports it. The wire shape of a task gains `participants`, `checklist`, and the
matter's title and number; `assigneeUserId` leaves it.
