# Billing automations — implementation plan (slice 3·7)

**Design:** [`2026-08-16-billing-automations-design.md`](2026-08-16-billing-automations-design.md).

**This plan does not start until M1, M2 and M3 are answered.** They decide whether a recurring
schedule may finalize, whether reminders ship on or off with which steps, and whether a payment plan
may charge anything — and the third of those decides whether stage 4 is a record or a rail. The
remaining flags shape a default or a refusal inside a stage and can be answered while that stage is
being built; each is named at the task that consumes it.

---

## Global constraints

These bind every task below and are not repeated in each one.

- **Golden rule 13 binds what the code may say.** No source file, test, migration comment, OpenAPI
  `description` or user-facing string in this slice may name a slice, a phase, an ADR, a spec, or this
  plan's own task numbers. State the reasoning inline, or cite a concrete file — `packages/trust/src/authorization-policy.ts`,
  `docs/conventions/invariants.md` — by path. The one exception the standard allows is a forward-looking
  statement of **when** an interim gets replaced ("the client channel arrives with the portal"), which
  is a schedule and not a citation. `pnpm run lint:process-refs` is the gate.
- **Golden rule 12.** Names are spelled out in full: `recurringBillSchedule`, not `recurringSched`;
  `paymentPlanInstalment`, not `instalment` alone where the type is ambiguous; "the firm-scoped
  data-access layer", never an abbreviation.
- **Golden rule 3.** Every read and write goes through the firm-scoped data-access layer against the
  firm's own `FirmDatabase` handle. Nothing in this slice touches the control plane except the member
  activity read the staleness check needs, which goes through the existing session/member seam.
- **Tier C is a source scan, added in stage 1 and never relaxed.** No file in the automations module
  may compose a `trust_*` statement or call `applyEarnedFeesUnderAuthorizationPolicy`,
  `applyTrustFundsToInvoices`, `composeTrustToOperatingTransfer`, or `composeInvoiceApplication`. The
  scan is written before the first automation, on the precedent of the scan billing already carries
  against trust.
- **One batch per subject, never one batch per run.** Every task that composes for many matters commits
  per matter, with the run item in the same batch as the work it describes.
- **A UNIQUE index is the convergence and a read is the sentence.** No guarded `UPDATE` is ever
  described as a guard. No task pre-checks its way to idempotency.
- **Every new migration is registered in `apps/worker/src/per-firm-migrations.ts` as well as the drizzle
  journal**, or the Durable Object never applies it. Take the next per-firm migration slot only after a
  `main` sync and `pnpm exec vp run worktrees` — the slot is the phase's known contention point.
- **`pnpm install` before believing a typecheck** after any merge that adds an export path.

## Stage ordering, and why stage 1 is useful alone

The ordering is by **how much of an automation can be true with nothing else built.** The run record
comes first because it is what makes every later stage reportable, and because a batch bill run is the
one automation with a person at both ends of it — a member starts it and a member reads the result —
so it needs no channel, no schedule, and no comparison.

```
1  The run record + batch bill generation        (needs nothing new)
2  Recurring bill schedules                      (needs stage 1's run record; M1, M6, M8, M9, M13)
3  Payment reminders                             (needs stage 1; M2, M10)
4  Payment plans, as a record                    (needs stage 3's reminder table; M3, M5, M11)
5  Below-floor replenishment                     (needs stage 1; smallest, could ship anywhere)
```

Stage 5 is deliberately last and could be first: it is a scheduled call to a shipped composer and has
no dependency on anything in stages 1–4 except the run record. It sits at the end because it is the
one whose value is smallest without a surface to read it on, and because putting the two automations
that write client-facing decisions earlier gets the hard review earlier.

---

## Stage 1 — The run record, and batch bill generation

Ships something a firm can use on day one: select matters, get drafts, read exactly what happened to
each.

### Task 1.1 — The tier-C source scan

Before any automation code. A fitness test over the new module's files asserting none of them imports
or calls the four trust-and-application entrances named in the global constraints. Modelled on the scan
in `packages/billing` that asserts no billing file composes a `trust_*` statement. It fails on an
import as well as a call, so a helper that "just reads" a trust composer's types does not open the door.

### Task 1.2 — The run tables

One migration, in the next per-firm slot.

- **`billing_batch_run`** — `id`, `trigger` (`scheduled` | `member`, closed CHECK), `started_by`
  (nullable), `started_at`, `selection_matter_ids` (the **resolved** list as canonical JSON, not a
  query), `matter_count`, `completed_at`, `completed_item_count`. Append-only from birth except
  `completed_at` and `completed_item_count`, which the one-edit trigger admits once.
- **`billing_batch_run_item`** — `id`, `run_id`, `matter_id`, `outcome` (nullable until decided, closed
  CHECK over the vocabulary in the design's section 6.2 plus `already-drafted` and `no-arrangement`),
  `outcome_subject_id` (nullable), `invoice_id` (nullable), `decided_at`. UNIQUE `(run_id, matter_id)`.
  Append-only except the one transition from undecided to decided, held by trigger.
- Identifier prefixes `billingBatchRun` and `billingBatchRunItem` in
  `packages/identifiers/src/registry.ts`, spelled in full with the comment the registry's other billing
  entries carry.

The undecided item row is what makes resumption cursor-free: the resume predicate is
`outcome IS NULL`.

### Task 1.3 — The composer

`packages/billing/src/automations/batch-run.ts`. Pure, returns `EffectWrite`, `ClockPort` and
`randomSource` injected, no wall-clock read and no ambient randomness — the contract every billing
composer already holds.

- `composeBatchRun(selection, trigger, startedBy)` — the run row plus every item row, one batch. The
  selection is refused above `billing.batch.maximumMattersPerRun` by name, with a message that says to
  split it.
- `composeBatchRunItemOutcome(itemId, outcome, subject)` — the single statement a worker merges into
  the batch that did the work.
- `readBatchRun` / `readBatchRunItems` — the reads a surface and a test both use.

**No draft composition lives here.** The batch composer records; the worker calls
`createInvoiceDraft` / `addClaimsToDraft`, which already exist.

### Task 1.4 — The batch consumer

A queue consumer, not a handler: four hundred drafts is not request work.

- Register a `billing.batch.requested` topic and its handler in the per-firm dispatch table
  (`apps/worker/src/costs/recoverable-charge-consumer.ts` — the table, not the cost-recovery module;
  extract the table to its own file first if it has grown past readability, which is a reuse call to
  make when the file is open, not a promise here).
- The handler reads the run's undecided items, and for each one, in its own `commitEffectBatch`:
  compose the draft, claim the period's unbilled work in progress, and write the item outcome. A
  refusal from `addClaimsToDraft` becomes an outcome, never a thrown message — except a transient
  database failure, which throws so the queue retries and leaves the item undecided.
- The message is acked when the run has no undecided items left. A batch that outruns one invocation
  re-enqueues itself with the same run id; the UNIQUE index makes an overlapping redelivery harmless.
- `billing.batch.completed` is emitted in the batch that writes `completed_at`.

### Task 1.5 — Routes

Three, all through `defineOpenAPIRoute` with full `RouteMeta`, idempotency required on the mutating one.

- `POST /api/v1/billing/batch-runs` — `billing:draft`. Resolves and records the selection, emits the
  topic, returns `202` with the run id.
- `GET /api/v1/billing/batch-runs/{runId}` — `billing:read`.
- `GET /api/v1/billing/batch-runs/{runId}/items` — `billing:read`, paginated, filterable by outcome.

Re-emit the OpenAPI snapshot and regenerate the API client in the same commit; add the operations to
the conformance not-vacuous list.

### Task 1.6 — Fitness, tests, docs

- Fitness: every run's item count equals its recorded selection size; no item carries an outcome
  outside the closed vocabulary.
- Tests: a run that half-completes and resumes; a redelivered message producing no second draft; an
  item whose draft loses the claim race recording `work-in-progress-claimed-elsewhere`; a selection over
  the ceiling refused by name.
- Docs: `packages/billing/CLAUDE.md` gains the automations section; `docs/user/` gains the batch-billing
  task; a `changelog.d/` fragment; the `roadmap.d/financial.md` nodes flipped with evidence.

---

## Stage 2 — Recurring bill schedules

**Gated on M1** (draft or finalize), and shaped by M6, M8, M9, M13.

### Task 2.1 — The schedule table

`recurring_bill_schedule`, in the `matter_billing_arrangement` shape and held by the same trigger
discipline: versions dense per matter, exactly one in force by partial unique index, and the only
update any version takes is the one-time close of `valid_to`. Columns per the design's section 6.1.

`anchor_day` carries a CHECK of `BETWEEN 1 AND 28` and the service refuses a higher value by name
before the CHECK sees it, with a message that says why a bill anchored to the 31st has no answer in
February. The comment on the column states that reasoning inline; it cites no document.

### Task 2.2 — The run table

`recurring_bill_run`, UNIQUE `(schedule_id, period_key)`, append-only from birth, columns per the
design's section 6.2. It carries `batch_run_item_id` so one read answers "what did the platform do on
this matter" across both triggers.

### Task 2.3 — The schedule service

`packages/billing/src/automations/recurring-schedule.ts`:

- `setRecurringBillSchedule` — a change is a **new version**; never an edit. Refuses when the matter has
  no in-force `matter_billing_arrangement` to pin against, and stamps the pinned version on the row.
- `readRecurringBillSchedule` / `readRecurringBillScheduleHistory`.
- `resolveScheduleStanding(schedule, now)` — the derived pause, returning `active` or one of
  `arrangement-superseded` / `matter-closed` / `authorizer-inactive`. **Derived on every pass, never
  stored**, so a pause clears itself when its condition clears. The comment states that a stored pause
  would need un-setting by hand and would be wrong the moment the condition changed.
- `periodsDue(schedule, standing, now, alreadyRun)` — the pure period arithmetic, testable with no
  database: which `period_key` values the schedule owes as of a civil date in the firm's zone.

### Task 2.4 — The scheduled pass

`apps/worker/src/billing/automations-pass.ts`, and its wiring.

- A new hourly cron trigger, named and commented in `wrangler.jsonc` and dispatched in
  `apps/worker/src/index.ts` beside the existing four. **Its own trigger, not a rider on the 03:00
  maintenance pass**, because the maintenance pass is invisible-to-the-firm storage work on a UTC clock
  and this produces records a firm reads the same morning in its own zone.
- The pass enumerates firms with `listReachableActiveFirms` — the one enumeration every per-firm sweep
  already shares — and quarantines a throwing firm with `logOperationFailed` exactly as the outbox sweep
  does. Counters only, no identifiers in telemetry.
- Each firm is skipped cheaply unless its local hour matches `billing.automations.localHour`.
- **Extract the firm time-zone derivation to one home first.** `resolveFirmDigestZone` in
  `@magna-carta/notifications/settings` is the shipped derivation and its body is not digest-specific;
  a second copy would eventually disagree with the one the calendar books against, which is what its own
  comment already warns. Move it to the shared home both callers can reach and leave the notifications
  export as a re-export. This is a cross-package edit: `pnpm exec vp run worktrees` and a `main` sync
  before it.
- For each schedule, for each period due: one `commitEffectBatch` carrying the draft, its claims, the
  `recurring_bill_run` row, the batch item, and the outbox message.
- **A decision writes a run row; a failure writes nothing.** The distinction is implemented as one
  explicit branch, with a comment saying that without it a bad afternoon becomes a permanent skip and a
  firm never gets that month's bills.

### Task 2.5 — Finalize, only if M1 says so

If and only if the owner directs it: read `billing.recurring.autoFinalize`, and where true, require
`billing:finalize` on the schedule's authorizer in the staleness check, and merge `finalizeInvoice`'s
statements into the same batch. The setting's default stays `false` regardless. If M1 says draft-only,
the setting still ships, defaulting `false` and refusing `true` by name with the reason — a firm that
sets it should be told it is not built, never silently ignored.

### Task 2.6 — Routes, fitness, tests, docs

- `PUT /api/v1/matters/{matterId}/recurring-bill-schedule` — `billing:configure`, idempotency required.
- `GET` the in-force schedule and its history — `billing:read`.
- `POST /api/v1/matters/{matterId}/recurring-bill-schedule/suppressions` — `billing:configure`; writes
  the `suppressed-by-firm` run row for a named period ahead of time. The suppression **is** the run row,
  so the UNIQUE index makes the pass a no-op and no second mechanism exists.
- Fitness: no `(schedule, period)` twice; every `drafted` outcome names an existing invoice on the
  schedule's matter; no two runs name one invoice.
- Tests: the period arithmetic across a month boundary and a leap February; the three staleness
  conditions each pausing and each clearing; a firm in a western zone composing on its own first; a
  redelivered fire producing nothing.

---

## Stage 3 — Payment reminders

**Gated on M2** (on or off, and the steps), shaped by M10.

### Task 3.1 — The reminder policy setting

`billingReminderPolicyDefinition` in `packages/billing/src/automations/reminder-policy.ts`: a
`FirmSettingDefinition` whose schema is `{ enabled: boolean, steps: number[] }` with the default M2
directs. The default lives in code, so a firm that has written nothing reads the default and no
settings screen is required for the value to be readable — which is the point of the seam.

The read helper returns the policy **and whether it came from a stored row**, because a surface has to
be able to say "no reminder schedule is configured" rather than showing a schedule the firm never chose.
That distinction is the requirement, not a nicety.

### Task 3.2 — The reminder table

`invoice_reminder`, UNIQUE `(invoice_id, reason, ordinal)`, append-only from birth with exactly one
admitted edit: `delivered_at` / `delivery_reference`, held by trigger on the
`retainer_replenishment_request.resolved_at` precedent. Columns per the design's section 8.2, including
`raised` and a closed `not_raised_reason` (`caught-up` | `covered-by-payment-plan`).

The `delivered_at` column ships null and stays null in this slice. Its comment says the delivery record
and the invoice artifact arrive with the client-facing surface, which is a schedule and not a citation.

### Task 3.3 — The comparison

`packages/billing/src/automations/reminders.ts`:

- `readInvoicesDueReminder(database, policy, asOfCivilDate)` — one indexed read over `invoice` joined to
  the `invoice_matter_balance` sum, using the **same** unpaid definition `readAccountsReceivableAging`
  uses, with a comment saying that a second definition would eventually chase a bill the aging report
  calls paid. Bounded and resumable: the selection predicate is the outstanding work itself, on the
  `runNameIndexBackfillPass` precedent, so no cursor is stored.
- `composeInvoiceReminder` — the record, its run item and its outbox message, one batch.
- **Only the highest crossed step is raised**; the lower ones get rows with `raised = 0` and
  `not_raised_reason = 'caught-up'`, so each `(invoice, step)` is still decided exactly once and the
  record explains the silence.

### Task 3.4 — The notification types

Add `billing.invoice.reminder_due`, `billing.recurring.drafted` and `billing.recurring.paused` to
`NOTIFICATION_TYPES`, each naming its topic by the constant billing exports — never a literal, because
two spellings of one emission point fail silently on an open bus. Facts stay inside the closed grammar:
identifiers, integers, declared labels, civil dates. No amount, no invoice number, no client name; the
deep link resolves them behind billing's own access-checked read.

`billing.batch.completed` uses the `actor` audience; add nothing to the registry-fitness
one-recipient short list, because it is not matter-anchored — confirm that against
`test/registry-fitness.test.ts` rather than assuming it.

### Task 3.5 — Fitness, tests, docs

- Fitness: every reminder names a finalized invoice; no `overdue-invoice` reminder exists against an
  invoice that was under a plan in good standing when it was raised (added in stage 4, asserted as
  vacuous until then).
- Tests: **a reminder record surviving a notification retention sweep that deletes its notification, and
  not re-raising** — the defect the record exists to prevent, so it gets its own named test; enabling a
  policy against a ninety-day-old bill producing exactly one prompt; a bill paid between the read and the
  write leaving a record that states what it observed and when.
- Docs: `docs/user/` gains the reminder-configuration task, including the sentence about what an
  unconfigured policy means.

---

## Stage 4 — Payment plans, as a record

**Gated on M3.** If M3 is answered as recommended, this stage is the record and nothing charges; if it
is answered the other way, this stage does not start until payments has shipped both a rail and a
stored method, and the actor problem in the design's section 3.3 has an answer that is not "mint a
platform principal".

### Task 4.1 — The tables

- `payment_plan` — append-only, columns per the design's section 9.1, with `cancelled_at` /
  `cancelled_by` / `cancellation_reason` as the single admitted edit, held by trigger.
  `client_assent_basis` is a closed CHECK. Refused at composition above the invoice's unpaid balance,
  and refused against anything but a finalized invoice.
- `payment_plan_instalment` — materialized in the plan's own batch, append-only from birth, **no status
  column**. Amounts from `allocate`, with a test asserting they sum to `total_minor` exactly for
  awkward divisions.
- Identifier prefixes `paymentPlan` and `paymentPlanInstalment`.

### Task 4.2 — The derived standing

`readPaymentPlanStanding(database, planId, asOf)`: the cumulative schedule against the value applied to
the invoice since the plan began, from `invoice_application` rows. Returns which instalments are met,
which is next, and whether the plan is in good standing. A pure derivation over rows billing already
keeps; nothing is stored, on exactly the reasoning `client_credit`'s open state is derived.

### Task 4.3 — The missed-instalment reminder

Extend stage 3's comparison with the `plan-instalment-missed` reason and the instalment sequence as the
ordinal. Same table, same index, same delivery boundary — no second reminder mechanism.

### Task 4.4 — The suppression (M11)

While a plan exists, is not cancelled and is in good standing, the `overdue-invoice` comparison skips its
invoice and writes a row with `not_raised_reason = 'covered-by-payment-plan'`. A missed instalment ends
good standing and both reasons go live from then on.

### Task 4.5 — Routes, tests, docs

- `POST /api/v1/invoices/{invoiceId}/payment-plans` — `billing:configure`, idempotency required.
- `GET /api/v1/invoices/{invoiceId}/payment-plans` and the standing read — `billing:read`.
- `POST .../cancellation` — `billing:configure`.
- Tests: a plan above the unpaid balance refused; instalments summing exactly; a partial payment moving
  the standing; a cancelled plan un-suppressing the ordinary reminder.
- Docs must be explicit that recording a plan charges nothing and is not consent to charge — that
  sentence belongs in `docs/user/`, in user language, because it is the thing a firm will assume
  otherwise.

---

## Stage 5 — Below-floor replenishment

The smallest stage, and a scheduled call to a shipped composer.

### Task 5.1 — The sweep

In the same hourly pass, after the other automations:

- Read every matter with an in-force `retainer` arrangement — one query, not a per-matter arrangement
  read, because a per-matter walk here is the N+1 the load profile is watching for.
- For each, `readRetainerStatus`; where `belowFloor` and no open request, call
  `requestRetainerReplenishment` with `requestedBy: null` and commit with the run item.
- `retainer-replenishment-already-open` is a **skip outcome, not an error** — it is the shipped
  convergence working.
- Read `billing.replenishment.enabled`, defaulting `true`, with the reason in the definition's comment:
  the firm expressed the intent by recording a floor on the agreement, so the automation honours a
  configuration the firm made rather than inventing one.

### Task 5.2 — The notification type

`billing.retainer.replenishment_requested` is already emitted by `packages/billing/src/retainer.ts` and
nothing subscribes. Register the type against the exported constant. This is the whole delivery change.

### Task 5.3 — Tests and docs

- The pass composes **no trust statement** — asserted by the stage-1 scan and by a test that runs the
  sweep against a firm with retainer matters and diffs the trust tables to nothing.
- A balance that moves between the read and the write leaves a request stating the balance it observed
  and when, and the test asserts the row is an observation rather than a claim about the present.
- `roadmap.d/financial.md`: `financial.billing.fee-models.retainer` moves off `partial` when the
  automated alert lands, and its note about the automation belonging to this slice is removed in the
  same commit.

---

## Verification per stage

Each stage is done when all of these hold, and not before:

1. `pnpm check:scoped` clean on the diff, and `pnpm run lint:process-refs` clean.
2. `pnpm test` green with the machine idle — never alongside another worktree's suite.
3. The stage's fitness queries return empty against the load-profile corpus, and each has a test that
   makes it return non-empty for a deliberately broken row, so a vacuous fitness function is caught.
4. The load-profile measurement for the stage is recorded, and `AutomationVolume` is accreted rather
   than replaced.
5. `docs/user/`, `packages/billing/CLAUDE.md`, a `changelog.d/` fragment, the `roadmap.d/` nodes and the
   `status.d/3-7-billing-automations.md` stage tokens all move in the same commit as the code.
6. The OpenAPI snapshot and the generated API client are re-emitted in the same commit as any route
   change.

## Deliberately not in this plan

- **Any path that moves client money**, including a payment plan that charges. Three independent walls,
  one of which survives payments shipping.
- **Delivery of a bill or a reminder to a client**, the `invoice_delivery` record, and the invoice
  artifact. The reminder record's null `delivered_at` is the whole seam this slice builds toward it.
- **Dunning escalation, statements of account, and interest.** Each needs a channel or a jurisdiction
  fact this slice does not have.
- **Cloudflare Workflows.** Nothing here is a multi-step external flow needing compensation; every step
  is one atomic D1 batch inside one firm, individually recorded and individually resumable.
- **Every screen.** Four deferred surfaces are named in the design with what each must show; none is
  designed here.
