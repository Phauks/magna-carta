---
slice: 6·3 — Tasks (the task record and its two screens)
group: phase-6
order: 3
research: n/a
spec: done
plan: done
built: done
ui: done
load-profile: todo
tested: done
branch: claude/tasks-feature-planning-ihaq2r
active-work: docs/active-work/claude/tasks-feature-planning-ihaq2r.md
next: matter plans — UNBLOCKED, W8 answered 2026-09-01 (a plan proposes and a member accepts); W11 and W12 stay open but the design's own answers to both are safe defaults the build proceeds under, so what remains is templates, role-based default assignment and propose-and-confirm instantiation. Then the time-entry link; due-soon and overdue reminders wait on the notifications comparison sweep; the board view waits on T3
link-spec: docs/specs/2026-08-15-tasks-and-matter-plans-design.md
link-plan: docs/specs/2026-09-01-tasks-scope-study.md
adrs:
blocked-by:
---

`@magna-carta/tasks`: one `matter_task` row per task, edited in place, carrying what to do, whose it is, when it is due, whether it is still owed, the one task it waits on, and the matter's files it points at. `matter_task_document` links those files many-to-many on the `matter_note_document` model. `tasks:read`, `tasks:write` and `tasks:assign` seeded to the seats that do firm work — Billing included, because chasing a retainer replenishment is a billing clerk's own work, and a list that cannot hold it sends them to a spreadsheet.

**`matter_id` is nullable**, which is the opposite of the call `firm_event` made, and the divergence is the slice's central decision. The mechanical half of the calendar's argument does not apply to a column nullable from its first migration; the design half turns on where the records are read, and tasks have one surface either way — "what is on my plate" spans a member's client work and their firm work in one list, so two tables would mean unioning them back together on the read every member makes most often. The does-not-apply branch the calendar warned about is real and is answered by confinement: `taskVisibilityFragment` is the entire population of "may this member see this task", and every read composes it. A task on a matter is firm-visible within it; a task on none is private to its assignee and whoever created it.

**Nothing derives a date and there is no overdue column.** A task stores the deadline's own civil-date shape and resolves it through `packages/calendar/src/time-zone.ts`; overdue is computed where the reader is. The calendar's date-arithmetic source scan runs over this package, and a schema scan asserts no overdue column exists on either table — a task template with a "+14 days" offset is the docketing engine this platform refuses to build wearing a different hat.

**Cancelling and deleting are both real.** A cancellation records that the firm decided against the work and requires the reason; a delete is for a task that should not exist. Two CHECK constraints hold each terminal state to carrying its own evidence and neither the other's. The design offered cancellation alone; taking both follows the owner's notes direction of the same week, that a record which can only accumulate is a record people stop keeping.

**Notifications:** four topics for two acts, split by whether the task is on a matter — the `calendar.firmEvent.*` split, forced by the two registry fitness rules about matter anchoring. The assignee needed a new audience: the design routed assignment to `designated`, which is the firm's trust-compliance designation and resolves to nobody when unconfigured, so as designed every task assignment would have delivered to no one, silently. `named-recipient` reads the member from the payload. `tasks` joined the category vocabulary and `matterTask` the subject kinds, two CHECKs and therefore two table rebuilds. Due-soon and overdue are declared and wired to nothing, beside the calendar's deadline points and for their reasons.

**Surfaces:** the matter's Tasks section and My Work at `/tasks` are one component reading two routes. Open tasks register a close **advisory** and never a precondition; closing a matter changes no task, and they drop out of the default list through a filter so reopening brings them back with no backfill.

Not built: matter plans and their templates, the time-entry link, the board and its firm-defined statuses, recurrence, watchers and comments. The load profile has no task volume profile yet.
