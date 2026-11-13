---
number: 511
slug: a-task-watcher-is-copied-in-and-a-team-assignment-tells-its-members
status: Accepted
date: 2026-11-10
area: Tasks
summary: "A task's watchers are told when they are added and when the task is completed, reopened, moved to another status, given different assignees or has its due date moved, never about their own change and never about a reworded title. Assigning a team tells each live member who did not already have the work. Watcher notices are informational, reach the watchers named in the payload, and split by whether the task is on a matter like the assignment notices."
---

**A task watcher is copied in, and a team assignment tells its members.**

**Context:** the owner ruled on 2026-11-09 that watchers act like a CC, and that a task can be
assigned to a team. Until now neither was told anything: assignment notified only the people named
individually, and watching changed only what Me Mode's Watching view showed.

**Decision — what a watcher hears.** Being copied in is itself a notice, so the watcher knows to
expect the rest. After that a watcher hears the changes that alter what the work is or where it
stands: completion, reopening, a status move, a change of assignees, and a moved due date. A reworded
title or body, a checklist tick and a new link tell nobody, because a CC that fires on every edit is
one people learn to ignore. The actor is never told about their own act.

**Decision — how it travels.** Two outbox topics, `tasks.task.watchedChange` and
`tasks.firmTask.watchedChange`, split by whether the task is on a matter for the reason the
assignment topics are. The payload names the watchers at the write and carries the change as a
closed vocabulary and the priority, never the title or the status's name. The registry delivers
them to the named members as informational, where an assignment asks for attention.

**Decision — a team's members are told.** A team cannot open a notification, so assigning one raises
the ordinary assignment topic once for each live member who did not already have the work, in
person or through a team already on the task. Somebody who joins the team later is not told about
its past tasks; they find them in Me Mode.

**Consequences:** the notification settings gain the two kinds under Tasks with no new category. A
watcher added to many busy tasks receives the daily digest rather than an email per change, as with
every non-urgent kind.
