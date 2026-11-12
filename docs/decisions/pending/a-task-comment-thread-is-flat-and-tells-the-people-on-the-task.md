---
slug: a-task-comment-thread-is-flat-and-tells-the-people-on-the-task
status: Accepted
area: Tasks
date: 2026-11-10
summary: "A task carries a flat comment thread. A comment names colleagues by id in a mention table, never by parsing its words. A new comment tells the people assigned and watching, and the people it names by a separate attention notice, never the author and never anyone twice. Only the author rewords or removes a comment; removal deletes it and the audit row keeps no words. A repeating task's next copy starts with an empty thread, and deleting a task deletes its thread."
---

**A task comment thread is flat, and tells the people on the task.**

**Context:** the owner asked on 2026-11-10 for a comment thread on tasks, the last open question (T4)
on the tasks ledger node. Nothing in the product had comments on firm records or @-mentions to reuse.

**Decision — the shape.** One thread per task, oldest first, with no replies to replies and no
reactions, so it reads in the order things were said. Only the author may reword or remove a
comment. A reworded comment carries `edited_at`; a removed one is deleted, because it is
discussion and not the matter's record (that is a note), and the audit log records that it was
written and removed without its words.

**Decision — naming a colleague.** The author's words keep "@Name" as text, and the people named
are rows in `matter_task_comment_mention`, sent by id. A name is not an identity, so the platform
never works out who was meant from the words. Each named person must be an active member who can
see the task, checked through the same predicate an assignment uses.

**Decision — who is told.** Two topic pairs, split by whether the task is on a matter like the other
task notices. `commented` tells the people assigned (each live member of an assigned team) and
watching, as information. `commentMentioned` tells the people named, asking for attention. Somebody
both named and watching is told once, by the mention. The author is never told. A rewording tells
only the people it newly names. Payloads carry identifiers and the priority, never the comment.

**Consequences:** the notification settings gain four kinds under Tasks with no new category. A
repeating task's next copy starts with no comments, and deleting a task deletes its comments with it.
