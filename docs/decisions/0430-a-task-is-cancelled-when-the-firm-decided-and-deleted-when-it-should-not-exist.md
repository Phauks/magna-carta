---
number: 430
slug: a-task-is-cancelled-when-the-firm-decided-and-deleted-when-it-should-not-exist
status: Proposed
date: 2026-09-01
area: Tasks
summary: "A task carries both a `cancelled` state and a real delete path, and the two are not redundant. Cancellation records that the firm DECIDED not to do the work and requires an actor, an instant and a reason, because the decision is the whole content of the record; deletion is for a task that should not exist — a typo, a duplicate, a line somebody abandoned before it meant anything — and removes the row, leaving an audit entry carrying identifiers and no words. The 2026-08-15 design offered cancellation alone, on the reasoning that without it a task that should not have been created has only `done` (a lie about work) or deletion (a hole in the record) to reach for. That reasoning establishes why cancellation must exist and does not establish that deletion must not: it conflates two different mistakes. The owner's direction on notes hours earlier settled the same tension the other way for a different record — a chain that can only accumulate is a record people stop keeping — and the resolution here takes both halves. The database holds each terminal state to carrying its own evidence and neither carrying the other's, through two CHECK constraints, so a repair script cannot invent a completion nobody performed or a cancellation nobody decided."
---

**Two different mistakes need two different remedies, and collapsing them loses the difference the
record exists to hold.**

**Context:** The tasks design settled on three states — `open`, `done`, `cancelled` — and argued the
third is not optional: without it, a task that should not have been created has only `done`, which is
a lie about work, or deletion, which is a hole in the record. That argument is sound and it is why
cancellation exists here.

What it does not establish is that deletion must not. It treats "a task that should not have been
created" as one case, and it is two:

- The firm considered work and decided against it. "Draft the reply brief" on a matter that settled.
  That decision is worth keeping, and what makes it worth keeping is the reason.
- Somebody typed a task twice, or misread a line and started one that meant nothing. There is no
  decision in it. Keeping it as a permanent cancelled row means every reader of that matter's task
  list, forever, reads past a typo.

The owner had settled a version of this tension the same week, for notes, in the opposite direction:
the first cut of `@magna-carta/notes` shipped a revision chain and withdrawal-as-a-state, and the
direction that replaced it was that replacing a note with another note every time somebody fixes a
word accumulates without end. A record that can only grow is a record people route around.

**Decision:** Both, with the difference stated everywhere it is offered.

- **Cancel** stamps `cancelled_at`, `cancelled_by` and a REQUIRED `cancellation_reason`. A
  cancellation with no reason is refused at the write, because "we decided not to" with no
  explanation tells a firm nothing six months later. The reason lives on the row where the surface
  reads it, and deliberately not in the audit metadata, which carries identifiers and enums rather
  than free text a member typed about a matter.
- **Delete** removes the row. Its attachments go first (they are the association and never the
  document, so every file stays in the matter's file record), anything waiting on it stops waiting,
  and the audit row that survives carries identifiers and no words: afterwards the firm can see a
  task existed here and who removed it, and cannot see what it said.

The schema holds the distinction rather than trusting the code to: `matter_task_completion_shape_check`
and `matter_task_cancellation_shape_check` require each terminal state to carry its own actor,
instant and reason and neither to carry the other's, so a repair script reaching this table directly
cannot invent a completion nobody performed.

**Consequences.** The user documentation and the product copy both say which is which, because the
whole value of having two is that people pick the right one. Completion is one-way in the product and
reversible in the record: reopening clears the terminal columns, since the CHECK requires an open row
to carry none, and the audit row keeps the fact that the task was closed and reopened — which is a
fact about how the matter ran even though the row no longer shows it.
