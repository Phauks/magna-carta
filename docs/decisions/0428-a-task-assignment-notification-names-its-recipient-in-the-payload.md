---
number: 428
slug: a-task-assignment-notification-names-its-recipient-in-the-payload
status: Proposed
date: 2026-09-01
area: Notifications
summary: "Task assignment adds a sixth notification audience, `named-recipient`, resolving to the one member a type's declared payload field names, and raises FOUR topics for two acts — `tasks.task.assigned` / `tasks.task.reassigned` for a task on a matter and `tasks.firmTask.assigned` / `tasks.firmTask.reassigned` for one on none. The audience is new because none of the five existing ones means \"the one member this row names\": the 2026-08-15 design routed task assignment to `designated`, which is the firm's TRUST-COMPLIANCE designation and resolves to nobody when unconfigured, so as designed every task assignment would have delivered to no one, silently, since an unrecognized audience is an empty audience rather than an error. It resolves from the payload rather than the subject's row so the person told is whoever was named at the WRITE — re-reading the row when the queue drains would deliver the first notification to the second person and the second one to them again. The four-topic split is forced by two fitness rules the registry already enforces (a matter-anchored type must resolve a matter; a type that is not matter-anchored must not), which a nullable matter cannot satisfy with one type; `calendar.event.*` versus `calendar.firmEvent.*` is the shipped precedent, and the producer chooses at the write where the answer is certain rather than leaving a consumer to infer it from a null."
---

**An audience that resolves to nobody is not a smaller audience; it is a feature that does not work
and does not say so.**

**Context:** The tasks design specified `task.assigned` and `task.reassigned` with
`audience: "designated"`, glossing that value as "the assignee — resolves today". It does not mean
that. In the shipped vocabulary (`packages/notifications/src/types.ts`), `designated` is *the firm's
trust-compliance designation*: "a type declaring it reaches exactly the designated members and nobody
else", and "an unconfigured designation resolves to nobody, never to the firm".

The consequence is the bad kind. A task assignment declared that way reaches the firm's trust
designees — or, far more likely, nobody at all — and nothing about the result looks wrong: the
fan-out treats an empty audience as an empty audience, so the notification is simply never written
and no counter moves. That is the failure mode this subsystem is otherwise careful about, which is
why suppressions are counted rather than merely absent.

**Decision:** A sixth audience, `named-recipient`, with the payload field declared on the type.

- The audience resolves to exactly the one member the payload names, and to nobody when it names
  none — which is the correct outcome for a task assigned to no one, and is reached by the same code
  path rather than by a special case.
- The key comes from the type (`audiencePayloadKey`), not from a field name the resolver assumes.
  A generic consumer guessing `assigneeUserId` would silently reach nobody for every future producer
  that spelled its field differently, which is the same silent failure one level down.
- It resolves from the PAYLOAD and never from the subject's row. The person to tell is whoever was
  assigned at the moment of the write; if the task has moved on by the time the queue drains, the
  reassignment raised its own topic for its own recipient, and re-reading the row here would deliver
  the first notification to the second person and the second one to them again.

**And four topics for two acts**, split by whether the task is on a matter. The registry already
enforces, in two fitness tests, that a matter-anchored type must be able to resolve a matter and that
a type which is not matter-anchored must not resolve one — because a firm-scoped row that quietly
acquired a matter would fall behind a filter it must not be behind, and an anchored row without one
is not unfiltered but *unfilterable*. A task's matter is nullable, so one type cannot honestly be
both. `calendar.event.*` versus `calendar.firmEvent.*` is the shipped precedent for exactly this
split, and the producer makes the choice at the write, where the answer is certain.

**Consequences.** `tasks` joins `NOTIFICATION_CATEGORIES` and `matterTask` joins the subject kinds;
both are SQLite CHECKs, so both are table rebuilds. The three existing recipient-resolution call
sites each pass `namedRecipientUserId` explicitly — null for the comparison sweep, which finds a
condition rather than a person, and null for job completion, whose audience is the requester through
`actor`. The facts each type carries are the priority and whether there is a date, never the title
and never the date itself: a title on a matter is the client and the instruction, and a due date
moves, so a card stating one the record no longer agrees with would be worse than a card stating
none.
