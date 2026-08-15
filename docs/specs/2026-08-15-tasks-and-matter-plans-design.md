# Tasks and matter plans — design

**Status:** Proposed (design) · **Date:** 2026-08-15 · **Owner:** Trevor Goldsmith
**White paper:** _Tasks and workflows / matter plans_ — this is the follow-up spec its
"Needs development" note asks for, covering matter-plan template authoring, task dependencies and
sequencing, assignment and reassignment, due-date derivation, notification and escalation, and
completion tracking.
**Stands on:** [`2026-08-15-notes-and-activity-design.md`](2026-08-15-notes-and-activity-design.md) —
read that first. The ordering is the point: a task subsystem that invented its own activity record
would be the second timeline in the codebase.
**Implementation plan:** [`2026-08-15-notes-and-tasks-implementation-plan.md`](2026-08-15-notes-and-tasks-implementation-plan.md)
**ADR fragments raised:** four, all `Proposed`, in `docs/decisions/pending/`.

**Not in scope:** any screen; rules-based docketing, which is `researching` and stays there
(section 3 is emphatic about why); the notifications delivery matrix and digest, which are the
notifications subsystem's own next sub-slice; the client portal.

---

## 1. What exists, and what the ledger says wrongly

Four nodes in `roadmap.d/tasks.md`, three `not-started` and one `researching`. Their evidence holds
almost entirely and is corrected in one respect by this branch (section 10).

There is no task table among the 176 per-firm tables, no `TaskId` among the 166 identifier types in
`packages/identifiers/src/types.ts`, no task package, and no route. The only trace anywhere is
`apps/web/src/lib/matters/sections.ts`, whose `other` section is described as "Everything else the
matter accumulates — research, tasks, and tool output — finds its home here." A catch-all mentioning
tasks as future accumulated content is what the ledger's evidence already says, and it is accurate.

What **does** exist, and matters enormously to this design, is the substrate: the matter lifecycle
with its close hooks (`packages/matters`), the calendar with its deadline model and its civil-date
machinery (`packages/calendar`), the notifications registry with its subscription discipline
(`packages/notifications`), the matter-assignment table (`matter_assignment`), and matter types
(`matter_type`) as the key a plan would be chosen by.

---

## 2. A task is not a calendar event, and it is not a deadline

Three records that all have a date on a matter, and they are three records.

A **calendar event** is a proceeding: it has a start, a zone, participants (member, entity and
external shapes), an event type from a shared catalog, and a continuance discipline in which a
rescheduled hearing produces a second row because both settings really happened. A **deadline** is an
obligation with a state (`open`, satisfied, vacated, superseded), an authority note, and an optional
`trigger_event_id` linking it to the event that started the clock. A **task** is neither: it has an
**assignee** and a **completion state**, which neither of the others has, and it has no external
reality — nobody continues a task, nothing vacates it, and no court knows it exists.

**Why not model a task as a calendar event.** The continuance discipline is exactly wrong. A hearing
moving from the 3rd to the 17th is two real settings and the calendar records both, held to a chain by
two partial unique indexes. A task's due date moving from the 3rd to the 17th is somebody changing
their mind, and recording it as two tasks would put two items on the assignee's list and make every
consumer responsible for hiding one. The calendar itself already drew this line for firm events
("a moved staff meeting is not procedural history, so firm events keep edit-in-place semantics"); a
task sits on the same side, further along.

**Why not model a task as a deadline.** A deadline is the firm's obligation to a court or a rule.
Diluting `matter_deadline` with "call the client back" would put a reminder in the table whose whole
purpose is that missing an entry is a malpractice event — and the calendar's stated posture is that
missed deadlines "cut toward VISIBILITY and against ARITHMETIC." A deadline surface that is mostly
tasks is a deadline surface people stop reading.

**What a task may have is a link.** An optional `trigger_event_id` to a `matter_event`, exactly as
`matter_deadline` carries one, and under exactly the same rule stated in
`packages/calendar/CLAUDE.md`: the link "is a LINK to the event that started the clock and never an
input to a calculation." A task may also carry an optional `deadline_id`, so "draft the opposition"
can hang off the deadline it serves and a firm can see which obligations have no work scheduled
against them. Both links are references; neither moves a date.

**Decision recorded as ADR fragment `a-task-is-not-a-calendar-event-and-carries-no-derived-date`.**

---

## 3. Due dates — the date engine does not exist, and a task must not build one

The brief for this work assumed `packages/calendar` ships rules-based docketing and that a task due
"14 days after service" reaches the same computation a deadline does. **It does not, and the absence
is deliberate and documented.** This is the single most important thing to get right in this spec,
because the obvious design — a task template with a `+14 days` offset — quietly builds the engine the
platform has spent a subsystem refusing to build.

The evidence is unambiguous and it is in three places.

`packages/calendar/CLAUDE.md`, as an invariant in capitals: **"NOTHING COMPUTES A DEADLINE DATE.** No
business-day arithmetic, no court-holiday calendar, no service-method offsets, no cascade when a
trigger event moves, no default deadline created when a matter opens, and no inference of a
jurisdiction from anything." With the reasoning: "a computed deadline that is wrong is worse than
none, because it gets trusted precisely because it was computed and the firm that would have looked
the rule up does not." A test, `packages/calendar/test/window-and-arithmetic.test.ts`, scans the
sources for any date-arithmetic identifier.

`packages/calendar/src/time-zone.ts`, the module header: "This is the only arithmetic in the package
that touches a calendar... **It NEVER derives a date from another date.** There is no business-day
arithmetic here, no holiday calendar, no service-method offset, and no chained recalculation."

`roadmap.d/calendar.md`: `calendar.docketing` is `researching`, and the parent node's evidence says
"no docketing computation (which is a deliberate position, not a gap)."

**So: how does a task reach the existing date machinery?** Exactly as a deadline does, and the machinery
is smaller than the brief assumed. What exists is a **civil-date resolver**, not a rule engine, and it
is the right thing to reuse.

- **A task stores the three columns a deadline stores.** `due_on` (`YYYY-MM-DD` civil date), an
  optional `due_time` (`HH:MM`), and a required `time_zone`. Not a UTC instant, for the reason the
  calendar states as an invariant: "No column stores midnight-local-as-UTC: that is the
  daylight-saving off-by-one that moves a hearing by a day when the clocks change." A task inherits
  that, because a task due "Friday" that fires Thursday night twice a year is the same bug with lower
  stakes and higher frequency.
- **Resolution to an instant is `instantForCivilDateTime` and `endOfCivilDayInstant` from
  `packages/calendar/src/time-zone.ts`.** No new function. A task with a date and no time is due at
  the **end** of that civil day in its zone, which is what `endOfCivilDayInstant` exists for and for
  the reason written beside it: rendering a dateless-time obligation as midnight "would report a whole
  working day of deadlines as already missed."
- **Overdue is computed at read time and never stored.** `packages/calendar/src/overdue.ts` is the
  whole mechanism — "no sweep, no scheduled job, no state transition, and no column." A task gets the
  same treatment, and the argument is _stronger_ here than for deadlines: tasks are numerous, a
  nightly overdue sweep across every firm's tasks is precisely the heavy scheduled work golden rule 10
  keeps off the platform, and a stored flag would be stale in exactly the window where it matters.
- **A matter plan does not compute either.** A plan template's "14 days after service" is the same
  forbidden arithmetic wearing a template. Section 5 resolves this with propose-and-confirm.
- **When a docketing engine exists, a task needs no schema change.** Its column shape is already the
  deadline's, so a derived date lands the same way for both, through the one engine, and nothing about
  tasks has to be revisited.

**The zone.** A deadline's zone is the court's, and no property of the firm, matter or office says
which. A task's zone is different and simpler: it is the **assignee's office zone at the moment of
assignment**, frozen onto the row — the same discipline `firm_resource_booking` uses, whose
`time_zone` is "the RESOURCE'S, frozen from its office at the write, so an office zone change never
reinterprets an old booking." A task reassigned across offices keeps its zone unless the reassigner
changes the date, because silently moving a due date by three hours on a reassignment is worse than
an occasional mismatch a person can see and fix.

---

## 4. The task record, and completion

**`matter_task`** — the matter, the title, an optional body, the assignee (`member.user_id`), the
optional priority, the three date columns, the optional `trigger_event_id` and `deadline_id`, the
state, the actor and instant on every state move, and the plan provenance columns of section 5.

**A task is firm-visible within its matter**, screened by the same visible-matter predicate every
calendar source composes. An assignee is not an access grant and not a screen: assigning a task to a
member who cannot see the matter is refused at the write, because the alternative is a task list with
holes in it that nobody can explain.

**State is a closed vocabulary: `open`, `done`, `cancelled`.** Three values, and the third is not
optional — without it, a task that should not have been created has only `done` (a lie about work) or
deletion (a hole in the record) to reach for. `cancelled` carries an actor, an instant and a reason.

**A task is editable in place, and this is a deliberate departure from the note.** A note's value is
that it was written then; a task's value is that it says what to do now. The calendar made this same
call for events, in the same words: "a firm made to record a compensating row to fix a typo stops
recording." The `audit_log` row in the same batch carries the change, which is the calendar's
mechanism and not a new one. Assignment and due-date changes additionally raise their own topics
(section 7), because those two are the changes other people need to hear about.

**Completion is one-way in the product and reversible in the record.** Marking a task `done` stamps
`completed_at` and `completed_by`. Reopening is a state move back to `open`, audited, not a delete of
the completion — a task that was closed and reopened is a fact about how the matter ran.

**Subtasks are not modelled.** A one-level checklist inside a task is a different feature from a task
tree, and a task tree brings rollup completion, depth limits, and a recursive read the timeline cannot
bound. `blocked_by` (section 5) covers the sequencing that plans actually need.

---

## 5. Matter plans — what a template is, who authors it, and how instantiation works

**A matter plan template is firm-authored, and the platform ships none.**

This is a competitive decision made against the grain and it is worth defending. Every competitor
ships plan libraries, and a firm evaluating this platform will notice their absence. Ship them anyway
is the tempting answer, and it is wrong for the same reason the calendar refuses to compute deadlines:
a plan is a statement about **how this firm practises in this jurisdiction**, and a platform-shipped
plan is the platform asserting a procedure. A shipped plan with a missing step, or a step in the wrong
order, or a step that is right in Nevada and wrong in California, is a malpractice vector carrying the
platform's name — and it gets trusted precisely because it shipped, which is the calendar's exact
argument about computed dates.

What the platform ships instead is an **empty catalog and an authoring surface worth using**. If the
owner later wants a curated set, the pattern already exists in the tree: the Nevada court-form library
([`2026-08-14-nevada-court-form-library-design.md`](2026-08-14-nevada-court-form-library-design.md))
and the trust-rules catalog are both jurisdiction-keyed reference data with attorney review in the
loop, and a curated plan library is the same shape with the same obligations. That is a research
workstream, not a default. **Owner flag W11.**

**The template shape.** `matter_plan_template` — a name, an optional bound `matter_type_id`, an active
flag, firm authorship, soft-deactivate rather than delete (the discipline `matter_type` and
`firm_resource` already use). `matter_plan_task_template` — the task's title and body, an optional
default assignee **role** rather than a member (section 6), an optional `blocked_by` reference to
another template task in the same template, and a **due-date anchor** rather than a date.

**The due-date anchor is where this connects to section 3, and it is propose-and-confirm.** A template
task declares an anchor from a closed vocabulary — today exactly one value, `matter_opened`, plus
`none` — and an integer `offset_days`. Instantiation renders a **proposed** civil date from the anchor
and the offset using plain calendar-day addition in the matter's zone, and **presents it for
acceptance**. Nothing is written until a member accepts.

Three things make that honest rather than a loophole:

- **Plain calendar days, never business days.** No holiday calendar, no weekend skip, no
  service-method offset. Adding fourteen days to a date is not the arithmetic the calendar forbids;
  deriving a court deadline from a rule is, and this does not do that.
- **The anchor vocabulary is deliberately almost empty.** `matter_opened` is a fact the matter row
  already carries. There is no `service_date` anchor, no `filing_date` anchor, and no
  `trigger_event` anchor, because each of those is the front half of a docketing rule and adding one
  invites the back half. Growing the vocabulary is a reviewed decision, on the model of the calendar's
  `FIRM_ANCHORED_SOURCE_KEYS` allowlist.
- **Acceptance is the write.** This is the calendar's own reserved interaction, reused rather than
  reinvented. Its `statutory_catalog` source is "a reserved source and unreachable," and the
  documented plan for when a catalog exists is: "propose-and-confirm — a member accepts a proposed
  date and that acceptance creates the row, the catalog never writes one by itself, and an existing
  row is never recomputed when the catalog changes." A matter plan is the first consumer of that
  pattern, and it uses it exactly.

**Instantiation is proposed, not automatic.** The white paper says plans are "auto-instantiated when a
matter is opened." This design narrows that on purpose: opening a matter **offers** the plan bound to
its type, with its tasks and their proposed dates, and the member accepts, edits or declines. A plan
that instantiated silently would write eleven dated obligations onto a matter without anybody having
read them, which is the trusted-because-computed failure again. **Owner flag W12** — a firm that opens
forty matters a month may reasonably want it automatic, and that is a firm setting, not a design
default.

**Instantiation is a one-time copy, and there is no live link.** Instantiated tasks carry
`plan_template_id` and `plan_task_template_id` as **provenance** — so a firm can ask "which matters
came off the old intake plan" — and never as a reference the read resolves. Editing a template does
not touch a task on an open matter. Deactivating a template does not touch one either. The reason is
the one the calendar states about recomputation: a template edit that silently moved a due date on a
live matter would be a docketing change nobody authorized and nobody saw. **Nothing reconciles**; there
is no drift report and no "your plan has changed" prompt, because both are the live link wearing a
disguise.

**Sequencing is `blocked_by`, and it gates nothing.** A task may reference one predecessor in the same
plan instance. A blocked task renders as blocked and sorts below; **it is not refused, and completing
it out of order is allowed.** A firm's real sequence has exceptions constantly, and a platform that
enforces order on a checklist is a platform people stop using the checklist part of. Cycles are
refused at template-authoring time, where the graph is small and static.

**Decision recorded as ADR fragments `a-matter-plan-is-firm-authored-and-instantiates-once` and
`a-plan-proposes-a-date-and-a-member-accepts-it`.**

---

## 6. Assignment, roles, and the per-matter team that already exists

A task's assignee is one `member.user_id`. Not a list — a task with three assignees is a task nobody
owns, and the platform has `blocked_by` and multiple tasks for genuine parallel work. Reassignment is
an edit that stamps a new assignee, audits it, and raises a topic.

**A plan template names a role, not a member.** `matter_plan_task_template.default_assignee_role` is a
string matched against `matter_assignment.assignment_role`, because a template that named Sarah
would be wrong the moment Sarah's matters were reassigned. At instantiation the role resolves against
the matter's live `matter_assignment` rows; an unresolved role leaves the task **unassigned and
visibly so**, never silently assigned to the responsible attorney. `matter_assignment` is already the
right table for this: it carries `matter_id`, `member_user_id`, `assignment_role`, and a
`valid_from`/`valid_to` interval, and `packages/matters/CLAUDE.md` records that ending an assignment
keeps the row.

**A finding, and it is not this design's to fix.** `packages/notifications/src/recipients.ts` resolves
the `matter-team` audience with this comment: _"DECLARED AND UNRESOLVABLE TODAY: there is no per-matter
team table, so 'the people working this matter' narrows to the one member the schema can actually
name."_ That comment is **stale**. `matter_assignment` is a per-matter team table with exactly the
columns that resolver needs, and it shipped **two merges after** `recipients.ts` — the notifications
delivery slice is commit `45003814` (pull request #175) and the matter-assignment table arrived in
`8d98eca0` (pull request #177). Three registered notification types today declare
`audience: "matter-team"` with `audienceSubstitutedFrom: "matter-team"` and quietly deliver only to
the responsible member, reporting `substituted: true` to nobody who reads it.

The substitution field was built for exactly this ("Declaring the substitution here means the day one
lands the change is ONE resolver rather than a hunt through every type that meant 'the team'"), and
the day has landed. It is a one-function change in `recipients.ts` — a `matter_assignment` read
filtered to live rows, unioned with the responsible member — and it belongs to the notifications
package, not to tasks. Recorded here as a finding, and as a ledger evidence correction (section 10).
**This design does not rely on it**: task notifications use the `designated` audience (section 7),
which resolves today.

---

## 7. Notifications — task assignment subscribes, it does not produce

`packages/notifications/src/registry.ts` states the rule in its header: **"A type SUBSCRIBES; it never
produces. Thirty-one topics already commit a durable outbox row in the same atomic batch as the write
that produced them, so the outbox row IS the emission. A second row beside it would be a weaker copy
of a guarantee that already holds."** So there is no `notify()` call anywhere in the task write path.

Tasks split cleanly into two shapes, and only one of them is buildable in this slice.

**Topic-shaped — buildable now.** `task.assigned` and `task.reassigned` happen at a write, so the task
write path commits an outbox row in the same batch as the task row, the audit row and the idempotency
record, exactly as every other mutating path here does. Each is one registry entry: `category: tasks`
(already in the white paper's declared category list), `audience: designated` (the assignee — resolves
today, and deliberately not `matter-team`, which currently narrows silently), `matterAnchored: true`,
`subjectKind` the task, and a facts schema carrying identifiers and non-sensitive fields only. The
title does **not** travel: a task title is free text on a matter ("Call Mrs. Herrera re the settlement
offer"), and `packages/notifications` already assembles its card at read time "from the kind and a
visibility-filtered matter join — no title, name, or filename is stored."

**Comparison-shaped — waits, and subscribes rather than sweeping.** `task.due-soon` and `task.overdue`
have no write to hang off; they are a comparison against now, which is exactly the class
`roadmap.d/notifications.md` records as pending: "The comparison-shaped points (deadlines, custody
reminders) and the job coordinators are the next sub-slice." `packages/calendar/src/notifications.ts`
already declares `calendar.deadline.horizon`, `calendar.deadline.due` and `calendar.deadline.overdue`
as emission points "DECLARED and not wired," for the stated reason that "two definitions of 'what is
due' would eventually disagree, and the one people act on would be whichever they saw last."

**Tasks declare their two beside them and wire nothing** — a `TASK_NOTIFICATION_EMISSION_POINTS`
constant in the tasks package, named now because the write paths are being built now and adding a
raise to an existing write is one line where finding every write path afterwards is archaeology. When
the comparison sub-slice lands, it sweeps deadlines and tasks through one mechanism against one
definition of overdue, which is the read-time comparison in `packages/calendar/src/overdue.ts` and not
a second one.

**Escalation** is the registry's own `NotificationEscalation` field and needs nothing new here. An
escalation policy on a task type is a registry declaration; this design contributes the emission
points it escalates from.

---

## 8. Tasks and the matter timeline

One more declared source, on the recipe in `packages/calendar/CLAUDE.md`.

- **Key** `matterTask`, kinds `["task"]`, `visibilityAnchor: "matter"`, `timeColumnShape: "civilDate"`
  sorting on `due_on`.
- **Label: the state, and nothing else** — the `matterDeadline` precedent exactly, whose label is
  `matter_deadline.state` because "the title, the authority note, and the reason it is no longer in
  force are all free text." A task title is the same kind of text, and `open`/`done`/`cancelled` says
  whether the firm still owes this without saying what it is.
- **`supportsMemberFilter: true`**, resolved in SQL on `assignee_user_id`, so "what is on my calendar"
  includes the tasks assigned to me. This is the one place tasks and the calendar genuinely converge,
  and it is a predicate rather than a post-filter for the reason the registry insists on: "a
  post-filter under-fills the page, makes the next cursor mean something different from page to page,
  and turns the page size into an existence oracle for the rows it removed."
- **`cancelled` tasks are excluded**, on the `documentFiled` soft-delete precedent.
- **Overdue is not a kind and not a label.** It is the read-time comparison, computed where the reader
  is, exactly as the deadline source declines to project it: "Overdue is deliberately absent from the
  label: it is a comparison against now, made where the reader is, and never a stored fact."

The read count rises by one statement per page. `TimelineReadResult.statementCount` reports it.

---

## 9. Matter close — an advisory, never a precondition

`packages/matters` ships both hooks and they are deliberately separate mechanisms.
`close-preconditions.ts` blocks a close and can contribute an in-batch `commitGuard`;
`close-advisories.ts` returns notices that ride the successful response and, in the file's own words,
has "no arm on which a notice becomes a refusal." Trust registers a precondition against the close, as
the invariants document records.

**Tasks register an advisory. Never a precondition.** The reasoning is written in
`close-advisories.ts` itself and it is exactly this case: "One boolean away from each other, a
subsystem that only meant to inform starts blocking closes on a Friday afternoon, and the firm learns
to route around the close screen." Money blocks a close because holding client funds on a closed
matter is a fiduciary failure. An open task is a reminder somebody wrote three months ago, and a
matter that cannot close because of one is a close screen the firm defeats by cancelling tasks it
never read.

The advisory is a count and nothing more — "4 open tasks on this matter" — because an advisory that
listed titles would put free text on a response, and section 8's label decision applies to every
surface, not only the timeline.

**What happens to the tasks: nothing automatic.** They are not cancelled, not completed, not deleted,
and not swept. The shipped invariant is that closed is "archived-but-additive," and a close that
mutated a dozen unrelated rows would contradict it. Open tasks stay open, stay on the matter, and
**drop out of the default "my tasks" read**, which filters to matters that are not closed — a filter,
not a state change, so reopening a matter brings its tasks back without a backfill. **Owner flag W13**
covers the one affordance this leaves open: whether the close screen offers a bulk-cancel control
beside the advisory.

**Decision recorded as ADR fragment `open-tasks-advise-a-matter-close-and-never-block-it`.**

---

## 10. Ledger correction

`roadmap.d/tasks.md` carried two staleness problems, both corrected on this branch.

**All four nodes' evidence asserted no spec exists.** It does now, and the correction follows the
precedent `roadmap.d/intake.md` set on 2026-08-15: the evidence names the spec, records that it is
`Proposed` pending owner flags, and **no status moves and no node carries a `spec:` key**, because a
design nobody has accepted has not advanced a capability.

**`tasks.workflow-model` was `researching`, and it was never that.** The status vocabulary defines
`researching` as "a named open research workstream," and the white paper's _Open research
workstreams_ names exactly two — the trust-rules catalog and the competitive analysis. The workflow
model is not among them; it was a "Needs development" note, which is what `not-started` is for
("Promised in the white paper; no artifact or spec yet"). Corrected to `not-started` with evidence
saying why. `docs/now.md` and `docs/register-history.json` re-rendered with `vp run register-build`.

**No node is added for the note primitive.** There is none anywhere in `roadmap.d/`, which is a real
finding and an owner decision about whether the register grows, not a gap for a branch to fill.

---

## 11. Owner flags

Continuing the **W** series from
[`2026-08-15-notes-and-activity-design.md`](2026-08-15-notes-and-activity-design.md), which raises
W1 through W6 and W9 through W10.

### These decide what gets built

**W7 — Do tasks ship after the note primitive, or independently of it?** The two are separable in
schema — a task table needs no note table — but not in surface: the activity stream a task lands on is
the note design's decision, and tasks built first would be the subsystem tempted to invent one.
Recommendation: notes first, tasks second, both against the same federated read.

**W8 — Is instantiation offered at matter open, or automatic?** Section 5. The white paper says
auto-instantiated; this design says proposed, because eleven dated obligations written onto a matter
nobody read is the trusted-because-computed failure. A high-volume firm may reasonably disagree, and
"automatic for this template" is a firm setting rather than a platform default. Recommendation:
proposed, with the setting as a fast follow.

**W11 — Does the platform ever ship curated matter plans?** Section 5. The design ships none and gives
the malpractice argument. If the answer is eventually yes, the shape is a jurisdiction-keyed reference
catalog with attorney review in the loop — the Nevada court-form library and the trust-rules catalog
are both precedents — and it is a research workstream with its own spec, not a seed migration.

**W12 — May a plan template's anchor vocabulary grow beyond `matter_opened`?** Section 5. Every
candidate anchor (`service_date`, `filing_date`, a trigger event) is the front half of a docketing
rule, and the platform has spent a subsystem refusing the back half. Keeping the vocabulary at one
value is the whole reason the offset arithmetic is defensible. Growing it is an owner decision with
the calendar's stated position on the other side of it.

**W13 — Does the close screen offer bulk-cancel for open tasks?** Section 9. The advisory tells the
person; whether the platform hands them a control that cancels a dozen tasks in one click is a product
decision with an obvious footgun.

### These decide how it is built, not whether

**W14 — Priority: a platform vocabulary, or firm-defined?** Not settled here. A three-value platform
enum is what every competitor ships and it is what people expect; a firm-defined picklist matches the
`picklist_option` machinery already in the tree. The former is simpler and the latter is more
consistent with how this platform treats firm vocabulary elsewhere.

**W15 — Does the default "my tasks" read span matters, or sit on the matter?** Section 8 makes the
member filter work either way. A firm-wide "my tasks" list is what makes a task subsystem useful and
is one more read composing the visible-matter predicate; a matter-scoped one is a smaller first slice.
Recommendation: firm-wide, because a task list you have to go looking for is a task list nobody looks
at.

---

## 12. Test plan

- **No date arithmetic in the tasks package.** The identifier scan
  `packages/calendar/test/window-and-arithmetic.test.ts` already runs; the equivalent must cover the
  tasks package, with the plan-instantiation offset as the single, named, reviewed exception.
- **Instantiation writes nothing until acceptance.** A proposed plan that is declined leaves zero
  rows.
- **A template edit does not touch an instantiated task.** Edit every template field, assert no live
  task row changed.
- **A cycle in `blocked_by` is refused at authoring time**, and a blocked task can still be completed.
- **A daylight-saving boundary case on `due_on` + `time_zone`**, reusing the calendar's own fixtures,
  so a task due "Sunday" in a transitioning zone is not due Saturday night.
- **Overdue is nowhere in the schema.** A source scan for an `overdue` column or flag on any task
  table, mirroring how the calendar keeps the same promise.
- **The task source composes the visible-matter predicate and labels by state only** — the existing
  table-driven `source-fitness` pass, extended by one registry entry and no new test code.
- **A close with open tasks succeeds** and carries the advisory; the tasks are unchanged afterwards.
- **Assignment to a member who cannot see the matter is refused at the write.**
