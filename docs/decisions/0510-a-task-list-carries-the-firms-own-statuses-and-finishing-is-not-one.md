---
number: 510
slug: a-task-list-carries-the-firms-own-statuses-and-finishing-is-not-one
status: Accepted
date: 2026-11-09
area: Tasks
summary: "A firm keeps several task lists, each with its own statuses, colours and flow, and a task sits on exactly one list. Finishing a task is not a status: completion is its own act, works from any status, and leaves the status where it stood. A task can be assigned to several people and to teams, and watched by people kept informed. A task on no matter is visible to the whole firm, replacing the rule that it was private to its creator and assignee. The legacy rung column and its route stay readable and writable, but the list screen reads the status."
---

**A task list carries the firm's own statuses, and finishing is not one of them.**

**Context:** the owner reviewed seven rounds of mockups of the task screen on 2026-11-09 and ruled
on each part. A firm runs several lists at once (one for partners, one for assignments, one for a
kind of case), wants to name and colour the steps a task moves through, and wants to say which step
may follow which. Until now a task had four fixed rungs (To Do, In Progress, On Hold, Done), one
assignee, and no start date, and a task on no matter was private to its creator and assignee.

**Decision — lists, statuses and a flow are the firm's.** A firm has one or more task lists, one of
them the default, and a task sits on exactly one. Each list has its own statuses, each with a name
and one of seven colours, and a flow saying which status may follow which. A new list starts with To
Do and In Progress, each able to move to the other. The migration put every existing task on a
default list called Tasks with the three statuses the open rungs named, so nothing moved.

**Decision — completion is separate from status.** Marking a task complete works from any status and
leaves the status where it stood, so reopening puts the task back exactly where it was. The flow
governs moves between statuses and never governs finishing the work. Completed tasks leave the open
list and are found under Show Completed.

**Decision — several assignees, teams, and watchers.** A task can be assigned to several people and
to teams. A team assigned is its members at the time anyone looks, so somebody joining a team picks
up its work without anybody reassigning it. Watchers are people kept informed of the work without
doing it. The first person named is still written to the task's own assignee column, which the
assignment notification and the mirror seam read.

**Decision — a task on no matter is the firm's.** Every member sees a task on no matter. The owner
ruled that all users should be able to see all tasks, with Me Mode narrowing to one's own work
(assigned, watching, or both). Matter walls still apply to a task on a matter.

**Decision — sub-tasks share their parent's list and matter.** A sub-task may have sub-tasks, at most
five deep. Moving a task to another list moves its whole tree. Deleting a task promotes its sub-tasks
to its parent rather than deleting them.

**Consequences:** shaping lists, statuses and teams rides `tasks:managePlans`, the same authority as
authoring matter plans, because it changes every member's screen at once; using them rides the
ordinary task permissions, and naming somebody else as an assignee or watcher needs `tasks:assign`.
The `progress` column and the rung route stay for existing callers and are no longer what the list
screen reads. `matter_task` is a parent table that cannot be rebuilt, so the new columns are added
with inline checks and everything else is a new table. Spec:
`docs/specs/2026-11-09-task-lists-and-task-screen-design.md`.
