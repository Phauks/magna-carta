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
- `src/notifications.ts` — the six topics and the two comparison-shaped points declared and wired to
  nothing
- `src/organisation-statements.ts` and `src/organisation-service.ts` — a firm's task lists, their
  statuses and flow, teams, and what a task carries besides its words: several assignees, watchers,
  a checklist and links
- `src/subtask-statements.ts` — the sub-task trees a list reads in one pass
- `src/watcher-notices.ts` — who is told beyond the actor: a task's watchers, and each member of a
  team the task is assigned to
- `src/recurrence-service.ts` — a repeating task: setting its rule, the next copy (pure), the guarded
  batch that writes it on completion, and the read and effects the hourly pass in
  `apps/api-worker/src/background/tasks/recurring-task-pass.ts` commits for `scheduled` repeats
- `src/comment-service.ts` / `src/comment-statements.ts` — a task's flat comment thread: add,
  reword and remove (the author's alone), the colleagues a comment names, and who is told
- `src/close-advisory.ts` — the count that rides a successful matter close and can never block one
- `src/plan-statements.ts` — the plan's SQL: the offered-plans read, the matter anchor cut from
  `opened_at`, the role resolution, and the template chain walk
- `src/plan-service.ts` — authoring a plan, and the propose/accept pair that is the whole design
- `src/sync-statements.ts` — the seam an addon writes through: the external-identity table, the
  deletion tombstone, and the change feed's two independently-positioned keyset streams
- `src/sync-service.ts` — link, record a round trip, unlink, and the lookup that makes a replayed
  sync idempotent

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

## The matter plan

**A plan proposes; a person accepts.** `proposeMatterPlan` is a PURE read that computes what the plan
would put on the matter and commits nothing; `acceptMatterPlan` writes only the subset a member kept,
in one batch. Writing them outright was the obvious reading and the owner narrowed it on 2026-09-01,
for three reasons that are properties of what a plan can get wrong rather than arguments from
principle: the offset is plain calendar-day addition so a template can propose Christmas Day, a role
can resolve to nobody on a matter opened before it is staffed, and assignment notifies — so writing
silently would tell somebody they own work on a matter they have never heard of.

**The platform ships no plans.** The migration creates the tables and inserts nothing, and it stays
that way. A plan is a statement about how one firm practises in one jurisdiction, and a shipped plan
with a step in the wrong order is a malpractice vector carrying the platform's name, trusted
precisely because it shipped. If curated plans are ever wanted the shape is the Nevada court-form
library's — jurisdiction-keyed reference data with attorney review in the loop — and that is a
research workstream rather than a seed migration. Owner flag **W11**, still open.

**The anchor vocabulary is `matter_opened` and `none`.** Held by a CHECK, so a third value is a
migration somebody reviews. Every candidate beyond it — a service date, a filing date, a trigger
event — is the front half of a docketing rule, and keeping the vocabulary at one value is the whole
reason the offset arithmetic is defensible while `packages/calendar` refuses to compute deadlines.
Owner flag **W12**, still open.

**NOTHING RECONCILES.** A task accepted from a plan carries `plan_template_id` and
`plan_task_template_id` as PROVENANCE and never as a live link: no read resolves them, editing a
template does not touch a task on an open matter, deactivating one does not either, and there is no
drift report and no "your plan has changed" prompt — both are the live link wearing a disguise. A
template edit that silently moved a due date on an open matter would be a docketing change nobody
authorized and nobody saw. `test/matter-plans.test.ts` edits every field of a template and asserts
the accepted task comes back byte-identical.

**`addCalendarDays` is the one piece of date arithmetic in this package**, and
`test/no-arithmetic.test.ts` pins its uniqueness rather than the absence of arithmetic — an exception
has to be visible to stay one. It adds whole calendar days to a civil date: no business days, no
holiday calendar, no service-method offset, no jurisdiction, no clock.

**A repeating task is one row at a time.** Only the current copy exists; the next is written when
it is due to appear (on completion, or on its start date, chosen per task) and
`recurrence_next_task_id` is unique, so the write is guarded and a completion racing the hourly pass
makes one copy. The rule is read from EACH COPY onward, with a count running down, so nothing walks
back to the start of a series. The next due date is the rule's next day as
`@magna-carta/civil-time`'s `occurrencesOf` walks it, and the start keeps its distance through
`movedLikeOccurrence`: counting days on a rule somebody chose, never a date derived from a rule of
law, and still no day arithmetic written in this package.

## Invariants that apply here

- **The visibility branch lives in ONE function.** `taskVisibilityFragment` is the entire population
  of the two rules — a task on a matter is visible to whoever can see that matter, a task on none is
  visible to every member of the firm, because the owner ruled that everyone sees every task and Me
  Mode is how a member narrows to their own — and every read composes it. A branch copied into
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

**Six topics for three acts** (assigned, reassigned, and a watched task changing), each split by
whether the task is on a matter — the `calendar.firmEvent.*` split exactly. The registry enforces that a matter-anchored type resolves a matter and an unanchored
one does not, so one type could not honestly be both; the producer knows which it is holding and
raises the right topic at the write. `assignmentTopicFor` is the one place that choice is made.

**The assignee needed a new audience.** `designated` is the firm's trust-compliance designation and
resolves to nobody when unconfigured, so a task assignment declared that way would have delivered to
no one, silently. `named-recipient` reads the member from the PAYLOAD, so the person told is whoever
was named at the write — re-reading the row when the queue drains would deliver the first
notification to the second person.

**A team cannot open a notification, so its members are told.** Assigning a team raises the
assignment topic once for each live member who did not already have the work, in person or through a
team already on it. **A watcher is copied in, as on a CC line**: told when they are added, and when
the task is completed, reopened, moved to another status, changes hands or has its due date moved.
Those reach the watchers named in the payload through the `named-members` audience and are
informational where an assignment asks for attention. A reworded title or body tells nobody.

**A comment tells the people on the task, and a mention asks for attention.** `commented` reaches
the people assigned (each live member of an assigned team) and watching; `commentMentioned` reaches
the people the comment names, who are dropped from the first so nobody is told twice. The people
named are rows in `matter_task_comment_mention`, sent by id: never find them by reading "@Name" in
the words, because a name is not an identity. Neither payload nor the audit row carries a word of
the comment.

**The two comparison-shaped points are declared and wired to nothing.** No write makes a task become
due. When the sub-slice that sweeps deadlines lands, it sweeps tasks through the same mechanism
against the same definition of overdue, not a second one.

## Time against a task — read here, owned there

`time_entry.task_id` is the link, and **it lives in `@magna-carta/timekeeping`, not here.** This
package depends on neither the column nor the read: a task does not know time exists, and the number
a surface shows is composed at the route, which reads the page of tasks from here and the page's
minutes from `@magna-carta/timekeeping/task-time`. Nothing in `packages/tasks` may grow a query over
`time_entry` — the work-in-progress store is that package's, with its own freeze contract and its own
permission, and a second reader of it here would be a second answer to what a task cost.

Two facts worth knowing from this side. **A task on NO matter can never carry time**, because the
link is refused unless the task is on the entry's own matter and firm work has none — so the firm's
own work is timeless by construction rather than by a rule somebody has to remember. And **the
minutes are read for a whole page at once**: the route batches, because a per-row read would be an
N+1 on the surface members open most, and the load profile counts the statements to prove it.

## Mirroring a task into another system — what an ADDON may rely on

**The platform integrates with nothing and ships no adapter.** It does not know what ClickUp is,
schedules no sync, resolves no conflict and maps no vocabulary. Every one of those is a decision
about somebody else's product; they belong to the adapter that knows it, built on
`@magna-carta/integrations` where the credential and capability machinery already lives. What
`src/sync-statements.ts` and `src/sync-service.ts` provide is only the part the platform cannot
delegate.

**Four primitives, and each one exists because it cannot be added afterwards.**

- **`matter_task_external_link`** — that a task IS some object over there. `system` is open text, the
  `directory_edge.edge_type` discipline, so a second system is an addon rather than a migration and
  nothing in this repository names a vendor. Two uniqueness rules, and they are different claims:
  one remote object maps to at most one task, one task holds at most one identity per system. **Both
  are indexes, not the service pre-check** — the check turns the common case into a readable refusal
  and a race between two syncs is precisely the case it loses.
- **`matter_task_deletion`** — the tombstone, written in the SAME BATCH as the delete. A row that is
  gone cannot be enumerated, so a mirror learns of a deletion there or never. It carries identifiers
  and nothing else: a tombstone preserving the title would defeat the delete it records.
- **`matter_task.updated_by`** — echo suppression. A two-way sync must tell its own writes from a
  person's, or it pushes back everything it just pulled. Connect the addon as its own member and skip
  the rows that name it.
- **`readTaskChanges`** — "what moved since I last looked", as two keyset streams with **independent
  positions**. One shared cursor looks sufficient and is wrong: its id half would come from whichever
  stream produced the last row, and a deletion handle applied as the tie-break against `matter_task.id`
  silently drops every live task sorting below it at that instant. That change is then never
  reported again. The comment in `sync-statements.ts` carries the full reasoning.

**Rules an adapter is held to.**

- **Visibility is not relaxed for a sync.** The feed composes `taskVisibilityFragment` like every
  other read, so an addon connected as a member syncs exactly what that member can see. There is no
  privileged enumeration and there must never be one.
- **The remote id is opaque.** This package never parses it, never orders by it and never assumes a
  shape. `system` is normalized (trimmed, lower-cased) because "ClickUp" and "clickup" are one
  system and the uniqueness rules are indexes that would not know it; the external id is trimmed and
  otherwise untouched, because lower-casing it would be this platform deciding somebody else's
  identifiers are case-insensitive.
- **`remote_revision` is stored and handed back, never compared.** It is a vendor's token — an ETag,
  a millisecond stamp, an opaque string. What it means is the adapter's business; not losing it is
  the platform's.
- **The identity is immutable.** `recordExternalSync` moves the URL, the revision and the sync
  instant and never the correspondence. Changing what a task mirrors is unlink then link, so both
  acts land in the audit trail.
- **The platform's vocabulary does not bend to fit a remote's.** A task's statuses are its list's,
  defined by the firm in Task Settings, and completion is a separate fact from status. An adapter
  maps a remote's statuses onto the list's own and must not invent new ones by writing free text
  somewhere: adding a status is a firm decision taken in Task Settings.
- **A task on no matter can never carry a time entry**, so a mirrored firm-work task syncs its
  content and never its time.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/calendar` (the visible-matter predicate and the civil-date resolver, and nothing
  else), `@magna-carta/matters` (the close-advisory shape alone), and `@magna-carta/meetings` (one
  statement, `clearActionItemTaskStatement`, and nothing else). A meeting summary's action item made
  into a task names it through an ENFORCED reference, so `deleteMatterTask` composes that statement into
  its batch before the delete: the item stops naming the task and reads again as untasked. The meetings
  package must never depend on this one — that would be a cycle — and this package writes no SQL of its
  own over a meetings table.
- The route layer (`apps/api-worker/src/http/routes/notes-and-tasks/tasks.ts`) hands the service the firm-scoped database,
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
- **The plan offer lives on the matter's Tasks section, not on the new-matter screen.** A better
  reading of propose-and-confirm than hooking the moment a matter is created: a matter opened before
  its plan existed can still take it, and somebody who declined at open can come back. What it is not
  is automatic — reviewing is a thing a person starts.
- **A step's `position` is not unique.** Reordering a list whose positions must stay distinct means
  rewriting every row after the one that moved; the handle is the tiebreak that makes ties harmless.
- **An accepted step whose predecessor was NOT accepted waits on nothing.** Dropping a predecessor is
  a decision the reviewer made, and pointing at a task that was never created would be worse than
  pointing at nothing.
- **`opened_at` holds two shapes** — a civil date on some paths and an instant on others — so the
  anchor read cuts the first ten characters rather than parsing. The same cut the note ordering and
  the matter-team validity window already make.
