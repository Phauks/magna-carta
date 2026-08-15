# Notes, activity, tasks and matter plans — implementation plan

**This plan does not start.** Ten build-gating owner flags across the two designs —
**W1 through W8 and W11 through W13** — decide what is in it. W1 decides whether stage 1 exists at
all; W2 decides whether stage 2 does; W4 decides whether stage 1 ships database triggers; W5 and W6
decide two confidentiality postures the code has to be written against rather than retrofitted to; W7
decides the ordering between the halves; W8, W11 and W12 decide what stage 5 is. The plan is written
now so that answering those flags is the only work between here and a first commit.

**Designs:** [`2026-08-15-notes-and-activity-design.md`](2026-08-15-notes-and-activity-design.md) and
[`2026-08-15-tasks-and-matter-plans-design.md`](2026-08-15-tasks-and-matter-plans-design.md).

**Ordering principle.** The primitive first, then what stands on it — because the activity stream is a
decision, not a table, and tasks built ahead of it are the subsystem most likely to invent a second
one. Within that, each stage is a vertical slice (schema through the firm-scoped data-access layer,
domain, route, interface, tests, developer and user documentation) and each ships something a firm can
use on its own.

**What every stage inherits and none re-implements.** Firm-scoped data access and `composeEffectBatch`
with its audit row; idempotency on every mutating route; the permission registry; OpenAPI as
code-as-contract; the design system and Lucide icons; the cursor primitive in
`@magna-carta/data-access/cursor-pagination`; the civil-date resolver in
`packages/calendar/src/time-zone.ts`; the notification registry's subscribe-never-produce discipline.
A stage that appears to write a table directly, mint its own cursor, or add a second date function is
a defect in this plan, not a licence.

---

## Stage 1 — The matter note (gated on W1; W4, W5 and W6 shape it)

The whole primitive, on one attachment axis, with no client-facing surface anywhere near it.

1. **`@magna-carta/notes`**, pure on the house pattern: validates in memory, composes statements into
   `composeEffectBatch`, holds no database binding, reads no clock, calls no external service.
   Modelled on `packages/matters` and `packages/calendar` file for file.
2. **Schema — two tables, not one.** `matter_note` (the identity: matter, original author, created
   instant, state, retraction actor / instant / reason) and `matter_note_revision` (the body, its own
   author, its own instant, its ordinal in the chain). A partial unique index pins exactly one head
   revision per note.
3. **Under W4: three `RAISE(ABORT)` triggers on `matter_note_revision`** refusing `UPDATE`, `DELETE`
   and `INSERT OR REPLACE`, on the six-trigger conflicts-log pattern. None on `matter_note`, whose
   state column must move for retraction.
4. **Identifiers.** `matterNote` and `matterNoteRevision` in `packages/identifiers/src/registry.ts`,
   spelled in full.
5. **Permissions.** `notes:read`, `notes:write`, and `notes:retract` as a distinct key — retraction is
   the one act that removes a colleague's words from view and should not ride an ordinary write
   permission.
6. **The write paths.** Create (note plus first revision, one batch). Revise (append a revision, move
   the head, one batch). Retract (state, actor, instant, reason; the body stops rendering everywhere).
   No delete path exists, and no route mints one.
7. **The timeline source.** One entry in `TIMELINE_SOURCES` in `packages/calendar/src/sources/all.ts`:
   registry row keyed `matterNote`, `visibilityAnchor: "matter"`, `timeColumnShape: "instant"`,
   `declaresLabel: false` with `NULL AS label`, a statement builder through `boundedSelect` filtering
   to live heads and excluding retracted notes, and a projection deep-linking to the matter's notes
   section. No change to any write path anywhere.
8. **PII registry.** `matter_note_revision.body` as `report-manual`; `matter_note.author_user_id` and
   `matter_note_revision.author_user_id` as `pseudonymize-keep` on the `user` axis. Under that
   registry's coverage test.
9. **The merge-field fitness function.** A source scan asserting that no entry in the merge-field
   catalog resolves to a note table. This is the only mechanical guard against the
   highest-consequence leak in either design and it lands in the same slice as the table, not after.
10. **Under W6: search.** Note bodies indexed; the visible-matter predicate composed identically to
    the timeline's; results carry matter, date, author and a deep link, and no snippet unless W6 says
    otherwise.
11. **Route, contract, interface.** Read and write behind the permissions above, with the mutating-route
    idempotency requirement; the `notes` section in `apps/web/src/lib/matters/sections.ts` climbs off
    maturity stage `soon`.
12. **Documentation.** `packages/notes/CLAUDE.md`; a `docs/user/` task page; the changelog fragment;
    the ledger nodes, whose existence is itself an owner decision (design section 11 / section 1).

**Depends on nothing outside the repository.**

---

## Stage 2 — The Directory-entity note and its visibility anchor (gated on W2)

Not a copy of stage 1. The table is easy; the anchor is the work.

1. **`directory_entity_note` and `directory_entity_note_revision`**, same shape, keyed to a Directory
   entity handle.
2. **A third `visibilityAnchor`.** `packages/calendar/src/sources/registry.ts` today declares `matter`
   and `firm`, with `FIRM_ANCHORED_SOURCE_KEYS` as a reviewed one-entry allowlist. An entity note is
   neither, and the package's own rule is that a new anchor comes with its own predicate rather than a
   loosening of an existing one. That predicate — what makes an entity note visible to a member,
   given the entity may be reachable from matters they are screened off — is the substance of this
   stage and is designed before it is built.
3. **The fitness pass extends by declaration.** `packages/calendar/test/source-fitness.test.ts` is
   table-driven over the registry; the new anchor becomes a third case there, not a special case in
   the read.

**Do not attempt stage 2 by registering an entity note as `firm`-anchored.** It would pass review by
looking like one more allowlist entry and would be a silent loosening of the one exemption the package
guards.

---

## Stage 3 — Tasks (gated on W7; W14 and W15 shape it)

1. **`@magna-carta/tasks`**, pure, same pattern.
2. **`matter_task` schema.** Matter, title, optional body, `assignee_user_id`, optional priority
   (shape per W14), `due_on` / `due_time` / `time_zone`, optional `trigger_event_id` and `deadline_id`,
   state over `open | done | cancelled`, completion and cancellation actor / instant / reason, and the
   two plan-provenance columns stage 5 fills. **No `overdue` column, no computed instant column.**
3. **Identifiers, permissions** (`tasks:read`, `tasks:write`, `tasks:assign`), and the write paths:
   create, edit, reassign, complete, reopen, cancel — each one batch with its audit row.
4. **Date handling reaches `packages/calendar/src/time-zone.ts` and adds nothing.**
   `instantForCivilDateTime` for a task with a time, `endOfCivilDayInstant` for one without.
   `packages/calendar/src/overdue.ts` for the read-time comparison. The tasks package imports these;
   it does not reimplement, wrap or extend them.
5. **The date-arithmetic scan.** The equivalent of
   `packages/calendar/test/window-and-arithmetic.test.ts` over the tasks package, and a schema scan
   asserting no `overdue` column exists on any task table.
6. **Assignment is validated at the write** — assigning a task on a matter the assignee cannot see is
   refused, not silently created.
7. **The timeline source.** Key `matterTask`, `visibilityAnchor: "matter"`,
   `timeColumnShape: "civilDate"` on `due_on`, label = the state (the `matterDeadline` precedent),
   `supportsMemberFilter: true` resolved in SQL on the assignee, `cancelled` excluded.
8. **The "my tasks" read** (scope per W15), composing the same predicate and the same cursor primitive.
9. **Documentation, ledger, changelog** as stage 1.

---

## Stage 4 — Notifications and the close advisory

1. **Two registry entries** in `packages/notifications/src/registry.ts`: `task.assigned` and
   `task.reassigned`, `category: tasks`, `audience: designated`, `matterAnchored: true`, facts schemas
   carrying identifiers and non-sensitive fields only. **No title in the payload.**
2. **Two outbox topics** exported as constants from the tasks package and imported by the registry by
   constant, never by string literal — the registry's stated discipline, because an unrecognized topic
   on the per-firm bus is acked and ignored, so a typo does not throw, it silently stops delivering.
3. **`TASK_NOTIFICATION_EMISSION_POINTS`** declaring `task.due-soon` and `task.overdue` and wiring
   nothing, beside `packages/calendar/src/notifications.ts` and for its reasons. The comparison
   sub-slice that lands deadline reminders subscribes to these; tasks grow no sweep of their own.
4. **The close advisory.** One `CloseAdvisory` in the tasks package returning a count of open tasks,
   registered by the composition root — never a `ClosePrecondition`, and never a precondition with a
   softer flag. The advisory's notice carries a count and no titles.
5. **The default task read filters to matters that are not closed** — a filter, so reopening a matter
   restores its tasks with no backfill.

**Not in this stage, and named so nobody waits for it:** the `matter-team` resolver fix in
`packages/notifications/src/recipients.ts`. It is a real finding (tasks design section 6) and a
one-function change, and it belongs to the notifications package. Task notifications use `designated`
and do not depend on it.

---

## Stage 5 — Matter plans (gated on W8, W11 and W12)

1. **`matter_plan_template`** (name, optional `matter_type_id`, active flag, firm authorship,
   soft-deactivate) and **`matter_plan_task_template`** (title, body, `default_assignee_role`,
   optional `blocked_by`, due-date anchor and `offset_days`).
2. **The anchor vocabulary is `matter_opened` and `none`, and nothing else** (W12). Enforced by a CHECK
   constraint so growing it is a migration somebody reviews.
3. **The offset renderer is plain calendar-day addition in the matter's zone** — no business days, no
   holiday calendar, no service-method offset. It lives in one named function with the reasoning
   inline, and it is the single named exception in the tasks package's date-arithmetic scan.
4. **Instantiation is propose-then-accept** (W8). The proposal is a pure computation over the template
   and the matter and writes nothing. Acceptance writes every task in one batch, with the two
   provenance columns filled.
5. **Role resolution** against live `matter_assignment` rows. An unresolved role leaves the task
   unassigned and visibly so — never silently assigned to the responsible attorney.
6. **Cycle detection at template-authoring time**, where the graph is small and static.
7. **Nothing reconciles.** No drift report, no "your plan has changed" prompt, no recomputation of an
   instantiated task when its template moves. A test asserts that editing every field of a template
   leaves live task rows byte-identical.
8. **The platform seeds no templates** (W11). The migration creates the tables and inserts nothing.

---

## What this plan deliberately leaves out

- **`portal_comment` and any client-visible surface.** The notes design decides the shape ahead of the
  portal so the portal inherits a decision; the table belongs to the portal's own slice.
- **A note on a document.** A different product with a different privilege story.
- **Subtasks and task trees.** `blocked_by` covers what plans need.
- **Rules-based docketing.** It is `researching`, it stays there, and nothing in these five stages
  brings it closer or further away — which is the point of the propose-and-confirm seam.
- **The `matter` close-reason column.** Confirmed absent, small, and belonging to `packages/matters`
  (notes design section 11, owner flag W10). It is a candidate for the next slice that opens that
  package, not this one.
