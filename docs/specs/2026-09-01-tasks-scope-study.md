# Tasks — scope study against the "ClickUp inside Magna Carta" brief

**Status:** Study (not a spec, not a plan) · **Date:** 2026-09-01 · **Owner:** Trevor Goldsmith
**White paper:** _Tasks and workflows / matter plans_
**Reads against:** [`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md)
(Proposed) and [`2026-08-15-notes-and-tasks-implementation-plan.md`](2026-08-15-notes-and-tasks-implementation-plan.md)
(does not start; gated on owner flags)

**What this file is for.** The brief — "assignments for themselves or others, linked to time
entries, notified, visible from inside matters, more or less ClickUp inside Magna Carta" —
is broader than the design on file. This study says which half of the brief the design already
answers, which half it deliberately refuses and what reversing each refusal costs, and which
half it never considered. It decides nothing. It ends in a slice shape and a flag list.

**Nothing here is built and nothing here moves a ledger status.** `roadmap.d/tasks.md` stays at
`not-started` on all four nodes, on the precedent it already records.

---

## 1. This is not a blank page

Tasks has a design, an implementation plan, four `Proposed` ADR fragments, and a feature-ledger
entry with its own `awaiting-owner` text. What it does not have is a single row of code: no
`matter_task` among the per-firm tables, no `TaskId` among the identifier types, no package, no
route, and no matter section. The only trace in the product is
`apps/web/src/lib/matters/sections.ts`, whose `other` section says the matter's tasks will
eventually land there.

Two things changed since the design was written, and both matter.

**The note primitive shipped**, which answers flag **W7** by event rather than by decision — the
design's recommendation was notes first, tasks second, and that is what happened. `@magna-carta/notes`
is on `main` with a `matterNote` timeline source, a Notes section off maturity stage `soon`, and
`matter_note_document` linking a matter's files to a note. Tasks are unblocked.

**The owner simplified notes at build time, on 2026-09-01**, and the reasoning is recorded in
`packages/notes/src/note-service.ts`: the first cut kept a revision chain and made withdrawal a
state, and the owner replaced it with edit-in-place and outright delete, because "replacing a note
with another note every time somebody fixes a word accumulates without end." **That is the
strongest available signal about how the austere half of the tasks design will land.** The tasks
design already chose edit-in-place, so it survives; but its `cancelled`-instead-of-delete state, its
refusal of subtasks, and its no-reconciliation stance on plan templates are all the same species of
argument, and at least one of them is likely to get the same treatment. Section 4 flags which.

---

## 2. Two claims in the design have gone stale against `main`

Both are in the design's notification section, and one of them changes what gets built.

**The `matter-team` finding is fixed.** The design (section 6) reports that
`packages/notifications/src/recipients.ts` cannot resolve "the people working this matter" and
narrows to the responsible member. It resolves it now: `matterTeam()` unions
`matter.responsible_member_id` with live `matter_assignment` rows joined to active members, ended
assignments excluded, and `resolveDeclaredAudience` returns it with `substituted: false`. The
one-function change the design asked for has landed. **Task notifications may address the matter
team.**

**`designated` does not mean what the design uses it for, and this is a defect in the plan.** The
design routes `task.assigned` to `audience: "designated"`, glossing it as "the assignee". In the
shipped vocabulary (`packages/notifications/src/types.ts`) `designated` is _the firm's
trust-compliance designation_ — "a type declaring it reaches exactly the designated members and
nobody else", and "an unconfigured designation resolves to nobody". A task assignment declared that
way would reach the firm's trust designees, or, far more likely, nobody at all — silently, because
the fan-out treats an empty audience as an empty audience.

So the assignee is **not** an addressable audience today. `NOTIFICATION_AUDIENCES` is a closed set
of five and none of them means "the one member this row names". Tasks must add a sixth —
`assignee`, resolved from the task row. That one is cheap: audience is a registry declaration and
not a stored column, so it is a resolver in `recipients.ts` and an entry in the closed set, with no
migration behind it. Cheap or not, it is the difference between task notifications working and task
notifications being a registry entry that delivers to nobody.

**Two things tasks need _are_ CHECK migrations, and the plan carries neither.** `notification_event`
stores `category` and `subject_kind` as CHECK'd columns, so a value absent from the constraint fails
at the database rather than at the type checker. `tasks` is not among the eleven categories — the
white paper lists it first among nine, and the built `NOTIFICATION_CATEGORIES` does not have it —
and `task` is not among the twenty-nine subject kinds. Two constraints to widen, plus a new row in
every member's per-category preference matrix.

---

## 3. The brief, mapped

| The brief asks for                                                                              | Where it stands                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create an assignment for someone else                                                           | Designed. One `assignee_user_id`, refused at the write if the assignee cannot see the matter.                                                      |
| Create an assignment for yourself                                                               | Designed **only on a matter**. A task with no matter does not exist in the design. Section 5.                                                      |
| Link to time entries                                                                            | **Absent.** Never considered. Section 6 — and it is the highest-value item in the brief.                                                           |
| Notifications                                                                                   | Designed, with the two defects in section 2 above. Due-soon and overdue wait on the notifications comparison sub-slice, deliberately.              |
| See them inside a matter                                                                        | Half designed: a `matterTask` timeline source is specified, but there is no Tasks **section**, and the section map has no slug for one. Section 7. |
| Due dates                                                                                       | Designed, and this is the part of the design most worth keeping. Section 4.                                                                        |
| Priorities                                                                                      | Designed as an open question — flag W14, platform enum versus firm picklist.                                                                       |
| Dependencies                                                                                    | Designed as `blocked_by`, one predecessor, advisory only — a blocked task can still be completed.                                                  |
| Templates / recurring plans                                                                     | Designed in full as firm-authored matter plans, propose-and-confirm, no platform library.                                                          |
| Boards, custom statuses, tags, comments, attachments, checklists, watchers, recurrence, my-work | **Absent or refused.** Sections 4 and 5. This is the ClickUp-shaped half.                                                                          |

---

## 4. What the design refuses, and what each reversal costs

These are not oversights. Each is argued, and three of them are load-bearing for the platform's
posture on dates. Reversing any is an owner call, so each is priced.

**Refused: any date arithmetic.** A task stores `due_on`, optional `due_time`, and a required
`time_zone` — the deadline's own column shape — and resolves to an instant through
`packages/calendar/src/time-zone.ts`. Overdue is a read-time comparison through
`packages/calendar/src/overdue.ts`, never a column and never a sweep. **Keep this.** It is the
cheapest correct decision in the whole design: it costs nothing to honour, a stored overdue flag
would need a nightly per-firm sweep across the most numerous table in the product, and the task
schema is already the shape a real docketing engine would write into if one is ever built.

**Refused: subtasks and task trees.** The argument is rollup completion, depth limits, and an
unbounded recursive read. It is sound for a _tree_. It is much weaker for **a flat checklist inside
one task**, which is what people actually use in ClickUp and which is a JSON column or a child
table with no recursion, no rollup semantics, and no timeline consequence. Worth separating: the
design refuses one thing and the brief probably wants the other. **New flag T5.**

**Refused: multiple assignees.** "A task with three assignees is a task nobody owns." Defensible,
and the platform has `blocked_by` and multiple tasks for real parallel work. The cost of holding
the line is that "the whole team needs to review this" becomes three rows. **Keep, and revisit only
if the firm-wide list makes the duplication visible.**

**Refused: platform-shipped plan templates** (W11) and **an anchor vocabulary beyond `matter_opened`**
(W12). Both are the same argument as the calendar's refusal to compute deadlines: a plan is a
statement about how a firm practises in a jurisdiction, and one shipped with a missing step carries
the platform's name into a malpractice claim. **Keep both.** If curated plans are ever wanted, the
shape is the Nevada court-form library's — jurisdiction-keyed reference data with attorney review —
and that is a research workstream, not a seed migration.

**Narrowed: plan instantiation is propose-and-confirm** (W8), against the white paper's
"auto-instantiated when a matter is opened". The design's reasoning is that eleven dated obligations
appearing on a file nobody read is the trusted-because-computed failure. **Recommendation: keep the
default, ship the firm setting.** A firm opening forty matters a month will want automatic, and
automatic-for-this-template is one boolean, not a redesign.

**Refused: deletion.** A task is `cancelled`, never deleted, with an actor, an instant and a reason.
**This is the one most likely to be overruled**, on the notes precedent from the same week. A
cancelled task is a row that stays on the matter forever because somebody typed a title wrong. The
honest middle is that a task cancelled within some short window, or one that never had a state move,
deletes outright, and everything else cancels. **New flag T6.**

---

## 5. The structural gap: a task with no matter

Every table in the design is `matter_task`, and every read composes the visible-matter predicate.
The brief's "assignments for themselves" does not fit inside that. "Renew the malpractice policy",
"interview the paralegal candidate", "get the Westlaw contract reviewed" are real firm work that
belongs to no client file, and a task product that cannot hold them is a task product people keep a
second list beside.

This is the single largest addition the brief makes, and it is structural rather than cosmetic,
because the visible-matter predicate is what makes every other read safe. A task with no matter has
no anchor, so it needs its own visibility rule, and there are exactly three candidates:

- **Private to the assignee and the assigner.** Simplest, and it is what a personal to-do actually
  is. Costs nothing to the rest of the platform.
- **Firm-wide.** Matches how `firm_event` already works, and the calendar guards firm-anchoring
  behind a reviewed one-entry allowlist (`FIRM_ANCHORED_SOURCE_KEYS`) precisely so a second entry is
  a decision somebody makes on purpose.
- **A third anchor with its own predicate**, which is what the notes design's stage 2 says an entity
  note needs, and which that plan warns must not be smuggled in as a firm-anchoring.

**Recommendation: one nullable `matter_id`, and private-to-participants when it is null.** It keeps
one table, one set of write paths and one "my tasks" read; it adds one predicate rather than a
second subsystem; and it makes the timeline source's job trivially correct, because a matterless
task simply is not on any matter's timeline. **New flag T1**, and it gates the schema, so it is
worth answering before anything is written.

---

## 6. Where a task meets time — the brief's named requirement

Nothing in the design connects tasks to time, and the connection is where a legal task list earns
its keep over a general one. Three separable pieces, cheapest first.

**A time entry may name the task it was worked on.** One nullable `task_id` on `time_entry`. The
column costs a migration and buys "how long did this actually take", per task, per template task,
and eventually per matter plan — which is the number that tells a firm whether its own plan
estimates are honest. Two constraints are already in the table and both bind: a billed or void
entry's business columns freeze (`time_entry`'s service refuses any update beyond the billing lock
set), so a task link cannot be added after billing; and `source` is a CHECK'd enum
(`timer`, `manual`, `quick_add`, `grid`, `offline_sync`, `calendar`) that would gain a `task` value
if a task is to be a distinguishable capture origin.

**A timer starts from a task.** This is the affordance people mean when they say the two are linked,
and most of it already exists. The live timer is a per-timekeeper Durable Object that binds a matter,
a narrative and a UTBMS task code before commit; starting one from a task pre-fills all three from
the task row. Worth pricing honestly: the timer manager design records that a replacing `start`
**silently overwrites the stored run**, destroying the first run's elapsed time, and that the run
store must become plural before the manager ships. A start-from-task button multiplies the number of
places that hazard is reachable from, so it should land **after** the plural run store, not before.

**A task shows the time logged against it.** One grouped read over `time_entry` filtered by
`task_id`, on the model of `packages/timekeeping/src/my-day.ts`. Read-only, over the work-in-progress
store and never the ledger. Trivial once the column exists.

**What to refuse.** A task must not carry an estimate that anything compares against actuals
automatically, and a task's completion must not create, submit or approve a time entry. The first is
a report, and reports have a home; the second would put an unreviewed row in the work-in-progress
store, and the owner's standing time rulings are emphatic that time is the timekeeper's own record.
**New flag T2** covers whether the link is one entry to one task, or many-to-many.

---

## 7. Surfaces — three of them, and only one is designed

**Inside the matter.** The section map (`apps/web/src/lib/matters/sections.ts`) has fourteen slugs
and no `tasks`; the design specifies only a timeline source. A real Tasks section is the brief's
"see them from inside of matters" and it is a list screen, which means the owner's standing list
rulings bind it completely and unusually specifically: the screen shows its whole record by default
with the table the only thing narrowing it, a row's own double-click opens it, a column's controls
are summoned by right-clicking that column's heading and nowhere else, a placeholder row takes none
of a row's treatment, and a clear-filters control exists only while something is narrowing. Those
are settled; a Tasks list that re-litigates them is rework.

**My Work, firm-wide.** Flag **W15**, and the design's own recommendation is firm-wide, "because a
task list you have to go looking for is a task list nobody looks at". The brief agrees. There is no
`/tasks` route today. This is the surface that decides whether the feature is used at all, and it
should be in the first slice, not a follow-on.

**The board.** ClickUp's identity, and the design has no view model at all. It collides with one
real decision: a board over `open | done | cancelled` is three columns and worthless, so a board
implies **firm-defined statuses**, which is a different schema from a closed three-value CHECK. The
platform already has the machinery — `picklist_option` for firm vocabulary, and `custom_field.target`
was widened to `matterAsset` recently with no migration because the column never had a CHECK, so
adding a `task` target is the same cheap widening and gives tasks the firm's own fields nearly free.
**Recommendation: ship the closed state vocabulary first and the board later**, because a board is a
view over whatever the statuses are, and inventing firm statuses in slice one buys a column layout at
the cost of every consumer — the timeline label, the close advisory, the notification facts — losing
a value it can reason about. **New flag T3.**

---

## 8. The rest of the ClickUp surface, priced

- **Comments on a task.** The obvious ClickUp feature the design does not have. The note primitive
  is matter-anchored and is the firm's record of the matter, not a discussion thread, so this is a
  new small table rather than a reuse. Medium value; the assignment and reassignment audit trail
  plus an editable body covers more of it than it looks. **New flag T4.**
- **Attachments.** Cheap and settled by precedent: `matter_note_document` links a `file` handle
  many-to-many under a count cap, on the `matter_asset_document` model. A `matter_task_document` is a
  direct copy. Do it in the same slice as the record.
- **Tags and custom fields.** Nearly free via the `custom_field.target` widening above.
- **Watchers.** A new audience beyond the `assignee` one section 2 already requires, plus a link
  table. Defer; the matter team already covers most of the intent.
- **Recurrence.** "Every Monday" is plain calendar-day addition, which is the same narrow exception
  the plan-template offset already carves out — so it is buildable without touching the no-arithmetic
  invariant. But it needs a generator, and a generator that writes ahead is a sweep. Defer past the
  first two slices and design it beside the notifications comparison sweep, not separately.
- **Manual ordering.** A `position` column, needed only when the board exists. Defer with it.
- **Client-visible tasks.** Out of scope in the design and it should stay out: the portal has its own
  slice and its own grant model.

---

## 9. A slice shape

Sized so each ships something a firm can use, and ordered so nothing is built twice.

1. **The record and the two lists.** `matter_task` with a nullable matter (T1), the closed state
   vocabulary, the deadline's date columns, one assignee, `blocked_by`, attachments, the write paths
   with their audit rows, the Tasks section in the matter, and the firm-wide My Work list.
2. **Notifications and the close advisory.** The `assignee` audience and its resolver, the `tasks`
   category and the `task` subject kind as two CHECK migrations, `task.assigned` and
   `task.reassigned` as outbox topics committed in the same batch as the write, the two
   comparison-shaped points declared and wired to nothing, and the open-task count as a close
   _advisory_ — never a precondition.
3. **Time.** `time_entry.task_id`, the per-task time read, and start-a-timer-from-a-task **after**
   the timer's plural run store lands.
4. **Matter plans.** Templates, role-based default assignment resolved against `matter_assignment`,
   propose-and-confirm instantiation, provenance columns, cycle detection at authoring time, and no
   platform templates.
5. **The view layer.** Firm statuses if T3 says so, the board, saved filters, ordering.
6. **Later.** Recurrence, watchers, comments if T4 says so, the portal's own client-visible task.

Stages 1, 2 and 4 are the existing implementation plan's stages 3, 4 and 5, re-cut so the firm-wide
list ships with the record rather than after it. Everything else is new: the nullable matter, the
time link, and the whole view layer.

---

## 10. Owner flags

**Already open and unchanged** (from the 2026-08-15 design): **W8** auto-instantiate or propose ·
**W11** platform-shipped plan library · **W12** anchor vocabulary · **W13** bulk-cancel at matter
close · **W14** priority vocabulary · **W15** my-tasks scope. **W7** is answered by event — notes
shipped first.

**New, raised by this brief:**

- **T1 — May a task exist with no matter, and what makes one visible?** Section 5. Recommendation:
  yes, nullable `matter_id`, private to assignee and assigner when null. **Gates the schema.**
- **T2 — Is a time entry's task link one-to-one or many-to-many?** Section 6. Recommendation:
  one nullable `task_id` on `time_entry`; a task with several entries is the common case and works
  either way, and an entry split across two tasks is a billing narrative problem, not a schema one.
- **T3 — Firm-defined task statuses, or the closed three?** Section 7. Recommendation: closed three
  first; firm statuses only when the board is built, and as a picklist rather than a free column.
- **T4 — Do tasks get comments?** Section 8. No recommendation; it depends on whether the firm
  discusses work in the product or in email.
- **T5 — A flat checklist inside a task?** Section 4. Recommendation: yes, and note that the design's
  refusal was aimed at task _trees_, which is a different feature.
- **T6 — Does a task ever delete, or only cancel?** Section 4. Recommendation: revisit against the
  notes decision of the same week rather than inheriting the design's answer unexamined.

---

## 11. What this study does not decide

No schema, no package boundary, no route, no screen, and no ledger status. The existing design and
plan stay `Proposed`. What changes if the owner accepts this study's framing is that the
implementation plan's stage 3 grows a nullable matter and a time link, its stage 4 grows a corrected
audience and two CHECK migrations it does not currently carry, and a sixth stage appears for the
view layer.
