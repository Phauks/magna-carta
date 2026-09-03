---
category: Added
audience: public
---

**Tasks — `@magna-carta/tasks`, the `matter_task` record, eleven routes, and two screens.**

`matter_task` holds what to do, whose it is, when it is due, whether it is still owed, the one task
it waits on, and the matter's files it points at; `matter_task_document` links those on the
`matter_note_document` model. Three permission keys (`tasks:read`, `tasks:write`, `tasks:assign`)
seeded to the seats that do firm work, Billing included.

**`matter_id` is nullable**, which is the opposite of the call `firm_event` made against
`matter_event`, and both table comments now say why. The calendar split its tables because a firm
event and a matter event are read on two different surfaces; tasks have one surface either way, so
splitting would mean unioning back together on the read every member makes most often. The
does-not-apply branch the calendar warned about is answered by confinement: `taskVisibilityFragment`
is the whole population of "may this member see this task", and every read composes it.

Nothing derives a date and no overdue column exists — the calendar's date-arithmetic source scan runs
over this package, and a schema scan asserts the absence. Cancellation and deletion are both real,
held apart by two CHECK constraints so each terminal state carries its own evidence.

Notifications raise four topics for two acts, split by whether the task is on a matter — the
`calendar.firmEvent.*` split, forced by the registry's two matter-anchoring fitness rules. The
assignee needed a sixth audience: the design routed assignment to `designated`, which is the firm's
trust-compliance designation and resolves to nobody when unconfigured, so as specified every task
assignment would have delivered to no one, silently. `named-recipient` reads the member from the
payload, so the person told is whoever was named at the write. `tasks` joins the category vocabulary
and `matterTask` the subject kinds — two CHECKs, so two table rebuilds.

Open tasks register a close advisory and never a precondition. The matter's Tasks section and My Work
at `/tasks` are one component reading two routes.

## Public

Tasks — work with somebody's name on it, on a matter or on none.

Every matter now has a **Tasks** section, and **My Work** in the sidebar gathers every task you can
reach in one list: across the matters you can see, plus your own work that belongs to no client file.
Renewing the malpractice policy and interviewing a candidate are real firm work, and they now have
somewhere to live that is not a spreadsheet. A task with no matter is private to you and whoever you
assign it to.

A task carries what to do, whose it is, a due date and time if there is one, and one of four
priorities. Assign it to a colleague and they are told. You cannot assign a task on a matter to
somebody who cannot open that matter — that would be a gap in their list nothing explains — so it is
refused when you try rather than appearing and then not working.

**Cancelling and deleting are different, and both are offered.** Cancelling is for work the firm
decided not to do: it asks why, and that answer stays on the task, so six months later somebody can
see what was proposed and why it did not happen. Deleting is for a task that should not exist — a
typo, a duplicate — and it is gone. Finishing a task records who did it and when, and reopening one
is always possible.

A task can say it is waiting on another one, which sorts it below and marks it — and stops you doing
nothing. Real work has exceptions constantly, and a checklist that argues with you is a checklist
people stop using.

**Overdue is worked out fresh whenever you look**, in the task's own time zone, so it is never based
on a stale calculation. A task due Friday is not treated as late on Friday morning.

Tasks are deliberately kept apart from deadlines. A deadline is what a court or a rule requires of
the firm and lives on the matter's Calendar, where missing one is serious; if that list filled up
with reminders, people would stop reading it.

Closing a matter tells you how many of its tasks are still open and changes none of them. They are
not cancelled or completed — they simply stop cluttering the day-to-day list, and reopening the
matter brings them straight back.

Matter plans — a template that lays out a standard set of tasks when a matter of a given kind is
opened — are designed and not built yet, and neither are board views, recurring tasks, or reminders
for tasks that are coming due.
