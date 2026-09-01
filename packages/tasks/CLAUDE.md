# @magna-carta/tasks — CLAUDE.md

**Purpose.** The task: one piece of work with somebody's name on it and a state that says whether the
firm still owes it. One row per task, edited in place, carrying what to do, whose it is, when it is
due, whether it is done, the one task it waits on, and the matter's files it points at. Validates in
memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no
binding, reads no clock, and never calls an external service.

**White paper:** _Tasks and workflows / matter plans_, with _Calendar and rules-based docketing_,
_Notifications_ and _Tenancy and data isolation_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-15-tasks-and-matter-plans-design.md`](../../docs/specs/2026-08-15-tasks-and-matter-plans-design.md),
scoped against a wider brief in
[`docs/specs/2026-09-01-tasks-scope-study.md`](../../docs/specs/2026-09-01-tasks-scope-study.md).

## Key files / entry points

- `src/types.ts` — the closed vocabularies (priority, state), the ceilings, the page caps, the
  blocking-chain depth, and the due-date shape
- `src/validation.ts` — every refusal as a code the route maps to a problem type, the title and body
  normalization, and the three-way due-date coherence check
- `src/task-statements.ts` — the SQL: **`taskVisibilityFragment`** (the whole population of "may this
  member see this task"), the ordering, the keyset cursor and its two halves, the reads, and the
  blocking-chain walk
- `src/task-service.ts` — create, edit, reassign, complete, reopen, cancel, delete, attach, detach,
  each one batch with its audit row
- `src/notifications.ts` — the four topics and the two comparison-shaped points declared and wired to
  nothing
- `src/close-advisory.ts` — the count that rides a successful matter close and can never block one

## The three things that decide this package's shape

**A task is not a calendar event and not a deadline.** It has an assignee and a completion state,
which neither has, and no external reality: nobody continues a task, nothing vacates one, and no
court knows one exists. Modelling one as an event would import the continuance discipline, under
which a hearing moved from the 3rd to the 17th is two rows because both settings really happened — a
task's due date moving is somebody changing their mind, and two rows would put two items on one
person's list. Modelling one as a deadline would dilute the table whose whole value is that a missing
entry is a malpractice event.

**`matter_id` is nullable, and that is the opposite of the call `firm_event` made.** Read both table
comments in `packages/database/src/per-firm-schema.ts` before copying either. The calendar split its
tables because a firm event and a matter event are read on two different surfaces; tasks have one
surface either way — "what is on my plate" spans a member's client work and their firm work — so two
tables would mean unioning them back together on the read every member makes most often.
`magnus_conversation` is the precedent: an optional matter link on a record whose tenancy root is the
firm.

**Nothing derives a date from another date.** A task stores the deadline's own civil-date columns and
resolves them through `packages/calendar/src/time-zone.ts`. A task template with a "+14 days" offset
is the docketing engine this platform has spent a subsystem refusing to build, wearing a different
hat, and `test/no-arithmetic.test.ts` is the calendar's own source scan applied here.

## Invariants that apply here

- **The visibility branch lives in ONE function.** `taskVisibilityFragment` is the entire population
  of the two rules — a task on a matter is visible to whoever can see that matter, a task on none is
  private to its assignee and whoever created it — and every read composes it. A branch copied into
  nine reads is a branch that will be wrong in one of them, which is the concern `firm_event` avoided
  by splitting tables and this package answers by confinement.
- **An assignee is not an access grant and not a screen.** A task on a matter is firm-visible within
  it: a colleague covering the file needs to see what is outstanding on it. Assigning to a member who
  cannot see the matter is refused AT THE WRITE, because the alternative is a task list with holes in
  it that nobody can explain.
- **THERE IS NO OVERDUE COLUMN and no place to put one.** Overdue is a comparison against now, made
  where the reader is, through `packages/calendar/src/overdue.ts`. `test/no-arithmetic.test.ts` scans
  the schema for one. A stored flag would need a nightly per-firm sweep over the most numerous table
  in the product, for a fact that is a subtraction and that is stale in exactly the window where it
  matters.
- **Cancelling and deleting are both real and are not redundant.** A cancellation is a decision about
  work and carries an actor, an instant and a REQUIRED reason. A delete is for a task that should not
  exist — a typo, a duplicate, a line somebody abandoned. Collapsing them loses the difference the
  record exists to hold; the CHECK constraints keep each terminal state carrying its own evidence and
  neither carrying the other's.
- **Completion is one-way in the product and reversible in the record.** Reopening clears the
  terminal columns because the CHECK requires an open row to carry none, and the audit row is what
  keeps the fact: a task that was closed and reopened is a fact about how the matter ran.
- **`blocked_by_task_id` GATES NOTHING.** A blocked task renders as blocked and may still be
  completed. A firm's real sequence has exceptions constantly, and a checklist that enforces order is
  a checklist people stop using. Cycles are refused at the write, where the chain is short and the
  walk is bounded; the one-hop case is a CHECK.
- **A task points only at documents on its own matter**, checked in SQL at the write, and a task with
  no matter points at none — a consequence rather than a rule anybody invented, because every row in
  `file` carries a NOT NULL `matter_id`.
- **`trigger_event_id` and `deadline_id` are LINKS and never inputs to a calculation** — the rule
  `packages/calendar/CLAUDE.md` states for `matter_deadline`, inherited verbatim.
- **The audit row carries identifiers, enums and dates — never words.** Not the title, not the body,
  not the cancellation reason. A task title on a matter is routinely the client and the instruction,
  and the audit log is a compliance record with its own retention and its own readers.
- **Open tasks ADVISE a matter close and never block one.** Trust blocks because a closed matter
  holding client money is how funds become unclaimed; an open task is a reminder somebody wrote three
  months ago. Closing changes no task — they drop out of the default list through a FILTER, so
  reopening the matter brings them back with no backfill.

## Notifications — this package produces, it does not deliver

A type SUBSCRIBES and never produces: the durable outbox row committed in the same atomic batch as
the write IS the emission, so there is no `notify()` call anywhere here.

**Four topics for two acts**, split by whether the task is on a matter — the `calendar.firmEvent.*`
split exactly. The registry enforces that a matter-anchored type resolves a matter and an unanchored
one does not, so one type could not honestly be both; the producer knows which it is holding and
raises the right topic at the write. `assignmentTopicFor` is the one place that choice is made.

**The assignee needed a new audience.** `designated` is the firm's trust-compliance designation and
resolves to nobody when unconfigured, so a task assignment declared that way would have delivered to
no one, silently. `named-recipient` reads the member from the PAYLOAD, so the person told is whoever
was named at the write — re-reading the row when the queue drains would deliver the first
notification to the second person.

**The two comparison-shaped points are declared and wired to nothing.** No write makes a task become
due. When the sub-slice that sweeps deadlines lands, it sweeps tasks through the same mechanism
against the same definition of overdue, not a second one.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/calendar` (the visible-matter predicate and the civil-date resolver, and nothing
  else), and `@magna-carta/matters` (the close-advisory shape alone).
- The route layer (`apps/api-worker/src/routes/tasks.ts`) hands the service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.
- **The timeline source is not here.** A task joins the federated read as one declared entry in
  `packages/calendar/src/sources/all.ts`, keyed `matterTask`, which reads `matter_task` by table name.

## Gotchas

- **The ordering appears three times and all three must agree.** `TASK_ORDER`, `cursorCondition`, and
  `encodeTaskSortKey` are the sort, the keyset predicate, and the cursor's packing. Three sort terms
  (undated-last, then date, then urgency, then handle) means a three-level comparison, and getting it
  wrong SKIPS OR REPEATS rows at a page boundary rather than failing. `test/task-lists.test.ts` walks
  six tasks mixing every level.
- **Undated tasks sort last, deliberately and against SQLite's default.** `NULL` orders first on an
  ascending sort, which would put every task nobody has scheduled at the top of a list whose job is
  to say what is due next — so the null-ness is lifted into its own leading term.
- **An undated task is absent from the timeline, and so is a matterless one.** Both fall out
  structurally rather than by a filter: a timeline is a walk over dates, and a task with no matter
  has none to anchor its visibility to.
- **`memberCanBeAssigned` takes the ASSIGNEE'S visibility predicate.** Today it is the same object as
  the actor's — the predicate carries no per-member narrowing — so passing the actor's reads
  correctly. The day an information-barrier overlay lands, this parameter is where the difference has
  to arrive, and it is named for whose it is so that day is a call-site change somebody can find.
- **Matter plans are not built.** Templates, role-based default assignment, propose-and-confirm
  instantiation and the anchor vocabulary are designed and gated on owner flags W8, W11 and W12. The
  plan-provenance columns this table would need are not here either: they arrive with the slice that
  fills them, and the schema comment says so rather than reserving columns nothing reads.
