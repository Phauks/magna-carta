# Billing automations — design (slice 3·7)

**Date:** 2026-08-16
**Status:** Design proposed. No product code in this cycle. The owner flags in section 20 decide what
gets built; three of them (M1, M2, M3) decide whether a whole automation exists.

**Owner-flag series: `M`.** Numbered in its own letter series so an answer to an automations question
can never be mistaken for an answer to a billing (`B`), trust (`T`), payments (`K`), notifications
(`N`), intake (`J`) or discovery (`P`) flag.

**Scope.** The scheduled, no-client-present layer over billing: recurring bill generation, batch bill
generation, payment reminders, payment plans, and evergreen below-floor replenishment. What an
unattended pass is allowed to do, what it must record, how each automation converges under
at-least-once delivery, and what each one does when the world changed between the read and the write.
**Excludes, each with its seam placed here:** any movement of client money, any charge against a
payment method, the invoice artifact and its delivery to a client, the client-facing surface, and
every screen.

**White-paper home:** _Financial Core — Billing_, read with _Financial Core — Trust accounting_,
_Notifications_, _Transactional outbox_, _Idempotency_, _Settings & configuration_, and _Payments_ as
the surrounding context.

**Governing decisions:** ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0008 and
ADR-0072 (the append-only ledger), ADR-0009 and ADR-0032 (trust, and fees never touching trust),
ADR-0059 (Notifications owns the delivery decision), ADR-0061 (money representation), ADR-0063
(idempotency), ADR-0064 (the transactional outbox), ADR-0067 (route metadata and the one enforcement
chokepoint), ADR-0039 (nothing heavy on the hot path), ADR-0083 (load-profile accretion), ADR-0150
(Cloudflare Workflows adopted narrowly, firm provisioning as the pilot), ADR-0213 (refuse rather than
guess).

**Decision inputs:** the shipped invoice spine, fee models and corrections
(`packages/billing`); the shipped trust subsystem and its authority-based authorization posture
(`packages/trust`, [`2026-08-10-trust-authority-based-authorization.md`](2026-08-10-trust-authority-based-authorization.md));
the shipped Notifications delivery half (`packages/notifications`,
[`2026-08-06-notifications-delivery-design.md`](2026-08-06-notifications-delivery-design.md)); the
shipped per-firm cron fan-out and transactional outbox (`apps/worker/src/scheduled.ts`,
`packages/data-access/src/outbox-relay.ts`); the billing design this slice extends
([`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)); the payments design, which is
designed and unbuilt ([`2026-08-15-payments-design.md`](2026-08-15-payments-design.md)); and the
phase-3 slice map ([`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md))
for the phase-wide invariants this slice inherits.

---

## Why now

Billing shipped, and everything it produces is produced by somebody sitting at a keyboard. A firm
that bills two hundred matters monthly composes two hundred drafts by hand; a firm whose client is
sixty days late chases the bill from memory; an evergreen retainer that fell below its floor has a
record waiting to be raised (`requestRetainerReplenishment`) and nothing that ever calls it. The
mechanism for each of these is built. What is missing is a caller with no person in front of it.

That is also what makes the slice dangerous, and it is worth naming the danger before the design
rather than after it. Every automation here either **tells a client they owe money** or **produces a
record the firm will act on financially**, and it does so while nobody is watching. The whole design
is organized around one question: what is an unattended pass permitted to do, and what must it refuse
to do no matter how convenient it would be.

## 1. What this design is, in one paragraph

**A billing automation performs a comparison, writes a durable billing record of what it decided, and
delivers nothing.** It never moves money, never composes a trust statement, never finalizes an
invoice without a firm setting saying it may, and never sends anything to a client — partly by
decision and partly because there is currently no channel to a client at all. Its consequences are an
append-only billing record, an outbox message in the same batch, and a run row saying what it looked
at and what it did about each one, including the ones it skipped and why. Convergence is a UNIQUE
index on the record, never a pre-check, so a redelivered cron fire or a replayed outbox row produces
nothing the first pass did not. Every cadence and threshold it consults is a firm setting with a
stated default and a reason for that default, and a firm that has configured nothing is told so
rather than being quietly given somebody else's answer.

## 2. What already exists, and what it obliges

| What ships                                | Where                                                                       | What it obliges of this design                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The per-firm cron fan-out                 | `listReachableActiveFirms` + the daily `0 3 * * *` pass in `scheduled.ts`   | One firm at a time, each in its own `try`/`catch`, logged through the one telemetry pipeline. One sick firm never aborts the fleet.                                               |
| The transactional outbox and its relay    | `insertOutboxMessageStatement`, `sweepOutbox`, the `*/5` relay              | Every external consequence is an outbox row in the same `commitEffectBatch` as the write. Handlers never call anything themselves.                                                |
| The per-firm queue dispatcher             | `apps/worker/src/costs/recoverable-charge-consumer.ts`                      | An unowned topic is acked and ignored, never thrown. New topics register a handler or ride only the notification pass.                                                            |
| The invoice draft composer                | `createInvoiceDraft` / `addClaimsToDraft` (`packages/billing/src/draft.ts`) | A recurring bill is a scheduled caller of these, not a second way to build an invoice.                                                                                            |
| The claim's partial unique index          | `invoice_wip_claim (source_kind, source_id) WHERE released_at IS NULL`      | An automation racing a member's manual draft **loses at commit**, cleanly, with the whole batch aborted. No new concurrency control is needed.                                    |
| `MAXIMUM_CLAIMS_PER_INVOICE = 400`        | `packages/billing/src/draft.ts`                                             | A recurring bill over a long backlog can exceed it. The automation must refuse by name and record it, never silently truncate a period.                                           |
| The finalize batch                        | `finalizeInvoice`                                                           | Finalization is irreversible, posts the receivable, locks work-in-progress, and is what permits money to leave trust. An automation reaching it is a decision, not a convenience. |
| The retainer floor and the ask            | `readRetainerStatus`, `requestRetainerReplenishment`, and its topic         | The below-floor automation is a scheduled caller of a shipped composer with a shipped topic. `requestedBy` is already nullable.                                                   |
| One open replenishment request per matter | the partial unique index behind `retainer-replenishment-already-open`       | Convergence for the replenishment automation is already built. The pass treats the refusal as a skip, not an error.                                                               |
| The aging read                            | `readAccountsReceivableAging`                                               | The overdue arithmetic exists. A reminder pass must not re-derive "unpaid" a second way; both read `invoice_matter_balance`.                                                      |
| The Notifications registry                | `packages/notifications/src/registry.ts`, the `billing` category            | Reminders are notification **types** on the shipped `outbox-topic` path. This slice adds entries and no delivery machinery.                                                       |
| Largest-remainder allocation              | `packages/money/src/allocate.ts`                                            | A payment plan's instalments are `allocate` over the total, so they sum to it exactly.                                                                                            |
| The firm setting seam                     | `readFirmSetting` / `FirmSettingDefinition`                                 | Every cadence and threshold is a key with a default in code, so a missing row **is** the default and is readable with no settings screen.                                         |
| The one-edit-only record idiom            | `retainer_replenishment_request.resolved_at`, held by trigger               | A reminder's later delivery stamp reuses this exact shape rather than inventing a status column.                                                                                  |

## 3. Three things that turned out not to exist, and each one reshapes the slice

This is the section to read if nothing else is read. Each of these was expected and is absent, and in
each case the absence removes a capability rather than deferring it.

### 3.1 There is no channel to a client, so a reminder cannot reach one

Notifications is entirely member-facing. A recipient is a control-plane `user` with a `member` row;
the five audiences (`responsible-member`, `actor`, `capability-holders`, `designated`,
`matter-team`) all resolve to members; the digest reads member addresses from the control plane; and
the client portal is `not-started` in every one of its nodes. There is no audience value that means
"the client", and adding one would not be a registry edit — it would be a second delivery subsystem
aimed at people with no session, no visibility predicate, and no preference record.

**Consequence: a payment reminder in this slice is a prompt to the firm, not a letter to the client.**
The automation decides a bill has crossed a reminder step and records that decision; a member acts on
it. That is half the feature, and saying so is better than shipping a "reminder" a client never
receives.

### 3.2 There is no invoice delivery record and no invoice artifact

The billing design specified an append-only `invoice_delivery` row per delivery attempt, and the
identifier prefix `invoiceDelivery` is registered — but **no such table exists in the per-firm
schema**, and no invoice renderer exists either (the letterhead node records "no invoice renderer
consumes it"). So the platform cannot answer "has this bill been given to the client", which is the
question several jurisdictions expect a firm to be able to answer before fees leave trust, and which
the billing design deliberately surfaces rather than gates on.

**Consequence:** the reminder record carries a `delivered_at` that stays null in this slice, held by
the same one-edit trigger the replenishment request uses. When the delivery record and the artifact
land, a delivery attaches to a reminder that already exists. The seam is a nullable column and a
trigger, which is the cheapest possible version of building it when in the area.

### 3.3 A scheduled pass has no actor, and the trust authorization posture is built on one

`resolveTrustAuthorizationDisposition` takes `actor: UserId`. The seeded version-1 posture is that a
holder of the trust authority acts alone and **anybody else routes to a holder**; the flag binds
whoever lets money go, and the triggers in the per-firm migration enforce the same predicate at the
database. A cron pass is nobody. There is no platform member, and minting one would be minting a
principal that can release client money and cannot be held to anything.

**Consequence: no automation in this slice takes an earned fee, composes a trust statement, or reaches
`applyEarnedFeesUnderAuthorizationPolicy`.** This is not a scheduling deferral. Even with payments
built and a card on file, the unattended path would still need an actor whose authority could be
checked, and the payments design independently reaches the same wall from the other direction: a
stored token is a `protected()` column, and decrypting one is a permission check plus a committed
audit row against a principal, which an unattended context does not have.

Recorded as a decision fragment: _a scheduled pass has no actor, so it composes no trust statement_.

## 4. The consequence tiers, and where the line is drawn

Three tiers, by what the act does to somebody outside the firm. The tier decides what authorization
the automation needs and whether it may act at all.

| Tier                                             | Acts                                                                                             | May an unattended pass do it?                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — internal, reversible, asserts nothing**    | Compose a draft invoice; write a reminder record; raise a replenishment request; write a run row | **Yes.** A draft is voidable, posts no ledger entry, locks no work-in-progress, and has been shown to nobody. A record of an internal decision is the same.                                                         |
| **B — becomes evidence, or is told to a client** | Finalize an invoice; deliver a bill; send a client a reminder                                    | **Only under a firm setting that says so, defaulting off, and pinned to a recorded human authorization.** Finalization is irreversible and posts a receivable; telling a client they owe money is the firm's voice. |
| **C — money moves**                              | Take an earned fee from trust; charge a card; disburse                                           | **No, structurally.** Section 3.3. Nothing in this slice reaches tier C, and a source scan proves it.                                                                                                               |

**What an authorization consists of.** Every tier-A and tier-B automation is driven by an
authorization record naming: **who** authorized it (a `UserId`, never null on a schedule or a plan),
**when**, **what version of the fee agreement was in force** at the time, and **what the recurrence
is** in terms the authorizer could have read — a cadence, an anchor day, what is included, and for a
plan the exact dated instalments, materialized at authorization rather than computed later. A
recurrence whose amounts are derived at run time is a recurrence nobody agreed to a number for.

**When the authorization goes stale.** Three conditions, all derived on every pass rather than stored,
so a pause heals when the condition clears and never has to be un-set by hand:

1. **The pinned fee agreement version is no longer in force.** A new `matter_billing_arrangement`
   version means the firm changed what it charges; a schedule authorized against the old one is
   running under terms nobody approved it against. Recommended: the schedule **pauses and reports**,
   and re-authorizing is a new schedule version, which is a person. (Flag M8.)
2. **The matter is closed.** A closed matter does not accrue work; a recurring bill for it is a bill
   for nothing. Recommended: the schedule stops, recorded as `matter-closed`. (Flag M6.)
3. **The authorizing member is no longer an active member holding the capability the automation
   exercises.** A schedule authorized by somebody who left the firm has no living authority behind it.
   Recommended: pause and report, never silently continue and never silently stop. (Flag M9.)

Each is one read per pass, and each writes an ordinary run row with its reason, so "why did nothing
bill this month" is answerable from the record rather than from the absence of one.

## 5. The shape: decide, record, emit — and deliver nothing

Every automation here has the same three-step body, and the sameness is the point: one convergence
story, one run record, one delivery boundary.

```
for each active firm (isolated, one at a time)
  if the firm's local hour is not its billing-automations hour: skip cheaply
  for each automation, in a fixed order:
      READ    the comparison over this firm's own rows        (bounded, resumable)
      COMPOSE one batch per subject: the billing record
              + its run row + its outbox message              (never one giant batch)
      COMMIT  through commitEffectBatch
  the */5 outbox relay carries the topics; Notifications subscribes as an ordinary
  outbox-topic type; nothing here resolves a recipient or renders anything
```

**Why the pass writes a billing record rather than raising a notification directly.** Notifications is
explicit that a notification is a pointer and never a record, and its retention sweep **deletes
`notification_event` rows** on the firm's window — which is where the UNIQUE dedupe key lives. A
condition whose only convergence is that key re-fires once the row ages out. For a comparison bucketed
by civil date that is harmless (the date has passed). For a reminder step that must fire **once per
invoice, ever**, it is a defect: sweep at ninety days and the seven-day reminder raises again. So the
billing record carries the convergence and the notification points at it, which is what the
subsystem's own rule already says should happen.

**Why not the comparison-sweep production path.** `sweepFirmComparisonNotifications` exists for
conditions the owning package deliberately refuses to store — an overdue deadline, a custody review
come round. These conditions **are** stored, by this slice, because a firm has to be able to see what
was decided on its behalf after the notification is gone. Once a record exists, the ordinary
`outbox-topic` path is the right one and needs no change to `sweep.ts`. It also removes a second
hazard: `MAX_COMPARISON_FINDINGS_PER_KIND` caps a comparison at two hundred findings per firm per
pass, and a capped reminder is a bill nobody chased.

**Why the local hour.** A monthly bill anchored to the first is composed on the **firm's** first. A
pass fixed to UTC composes August's bill on the 31st of July in Nevada. So the pass wakes hourly and
each firm acts only in its own configured hour, with the zone resolved from the firm's default office
— the same derivation the notification digest already uses, which should be extracted to one home
rather than read two ways.

## 6. Recurring bill generation

### 6.1 The schedule is an authorization, versioned in the shape the fee agreement already uses

**`recurring_bill_schedule`** — append-only, versioned per matter, dense, exactly one in force, and
the only edit any version takes is the one-time close of its `valid_to`. This is
`matter_billing_arrangement`'s shape verbatim, held by the same trigger discipline, because it is the
same kind of thing: a standing instruction a firm gave, whose history has to stay readable.

Columns: `matter_id`, `version`, `valid_from`, `valid_to`, `cadence` (`monthly` | `quarterly`, a
closed CHECK), `anchor_day`, `compose_offset_days`, `billing_arrangement_id` (the pinned fee
agreement version — section 4), `include_time`, `include_costs`, `minimum_amount_minor` (nullable),
`authorized_by` (NOT NULL), `authorized_at`.

Two mechanics worth fixing now because they are free now:

- **`anchor_day` is bounded to 1–28 and a value above it is refused by name.** A bill anchored to the
  31st has no answer in February, and every rule that invents one ("the last day", "the 28th",
  "roll forward") is a rule the firm did not choose. Refusing costs a firm one keystroke; guessing
  costs it a bill dated a day it did not pick.
- **`compose_offset_days` separates the period from the run.** A monthly schedule bills August and
  runs on the 1st, or the 5th, of September. Conflating the two makes "which period is this" a
  function of when the pass happened to fire, which is exactly what a redelivery changes.

### 6.2 The run row is the convergence, and it records skips as decisions

**`recurring_bill_run`** — append-only, one row per `(schedule_id, period_key)` with that pair
**UNIQUE**. Columns: the schedule and the schedule **version** that composed it, `period_key` (the
civil period, `2026-08`), `period_start`, `period_end`, `outcome` (a closed label), `outcome_subject`
(the identifier the outcome is about, where there is one), `invoice_id` (nullable), `ran_at`, and the
pass run this belonged to.

The invoice draft, its claims, the run row and the outbox message commit in **one batch**. There is
never a draft without its run row, nor a run row without its draft.

Outcome vocabulary, closed:

`drafted` · `nothing-to-bill` · `below-minimum` · `matter-closed` · `arrangement-superseded` ·
`authorizer-inactive` · `work-in-progress-claimed-elsewhere` · `claim-ceiling-exceeded` ·
`suppressed-by-firm`

**A skip is recorded, and that is what makes the period decided once.** If a skip wrote nothing, a
period skipped for a reason that has since cleared would draft on the next day's pass — a second bill
for one period, which is the defect the whole idempotency section exists to prevent.

**But a failure is not a skip, and the distinction is the whole rule.** A run row is written when the
pass **reached a decision about the world**. When it could not read the world at all — the firm's
database threw, an external read failed — it writes nothing, the firm is quarantined and logged by the
existing per-firm `catch`, and tomorrow's pass tries again. Recorded as a decision fragment.

**`suppressed-by-firm` is a run row written ahead of time.** A firm that wants to skip one month
inserts the row for that period; the UNIQUE index then makes the pass a no-op. The suppression
mechanism and the record are one table, and a skipped month is visible for the same reason every other
skip is.

## 7. Batch bill generation

A batch is the same composition with a person at the start and nobody in the middle: a member selects
matters and asks for drafts. It is a job, not a request — four hundred drafts is not work for a
handler (ADR-0039) — so it enqueues and reports.

**`billing_batch_run`** — `id`, `trigger` (`scheduled` | `member`), `started_by` (nullable, for a
scheduled pass), `started_at`, `selection` recorded as the resolved identifier list rather than as a
query, `completed_at`, plus the counts. Recording the resolved list matters: a query re-evaluated
later answers about a different world, and "which 400" has to be answerable from the row.

**`billing_batch_run_item`** — one per target, UNIQUE `(run_id, matter_id)`, with the same closed
outcome vocabulary as section 6.2 plus `already-drafted` and `no-arrangement`. **The item row commits
in the same batch as the draft it describes.** That is what makes a half-completed batch resumable
rather than mysterious: the resume predicate is the items with no outcome, and no cursor is stored.

**One matter per batch, never one batch for the run.** `MAX_BATCH_STATEMENTS` is ten thousand and a run
over four hundred matters each claiming up to four hundred entries is unbounded against it. Chunking at
the matter is also what gives item-level resumption; the ceiling and the resumption story are the same
decision.

**The scheduled recurring pass produces a run of the same shape**, with `trigger = 'scheduled'` and a
null `started_by`, so one table, one read and one deferred surface answer "what did the platform do
here" for both. The `recurring_bill_run` row names the batch item it rode with; the item is the
generic record and the run row is the schedule-specific one.

**Does a batch need unwinding on partial failure — the Workflows question.** No, and it is worth
stating why rather than assuming. ADR-0150 adopts Cloudflare Workflows narrowly for multi-step
**external** flows that must be compensated on partial failure, with firm provisioning as the named
pilot and the primitive unbuilt. A batch bill run is not that shape: every step is a D1 batch inside
one firm's database, each is individually atomic, each is individually recorded, and a half-completed
run is not a state anybody needs unwound — it is four hundred matters of which three hundred and
eighty-eight have a draft, all of them recorded, and the remainder resumable. Compensation would mean
deleting drafts a firm may already have opened. **No automation in this slice needs Workflows**, and
none should be blocked on it.

## 8. Payment reminders

### 8.1 What is compared

An invoice is due a reminder at step _k_ when: its status is `final`; its unpaid balance
(`SUM(total_minor - applied_minor)` over its `invoice_matter_balance` rows) is positive; its
`due_date` is not null; the firm's civil date is at or past `due_date + step[k].offsetDays`; there is
no reminder row for `(invoice, overdue-invoice, k)`; and the invoice is not covered by a payment plan
in good standing (section 9.4).

Reading unpaid balance from `invoice_matter_balance` and not from a second definition is not a
stylistic point — a reminder computed from a different notion of "unpaid" than the aging report will
eventually chase a bill the report says is paid, and the firm will believe the report.

### 8.2 The record

**`invoice_reminder`** — append-only, UNIQUE `(invoice_id, reason, ordinal)`. Columns: `invoice_id`,
`reason` (`overdue-invoice` | `plan-instalment-missed`, a closed CHECK), `ordinal` (the step index, or
the instalment sequence), `offset_days` **snapshot**, `due_date` snapshot, `observed_unpaid_minor`,
`observed_at`, `raised` (whether it produced a prompt — see below), `not-raised` reason, the run it
came from, and `delivered_at` / `delivery_reference`, both null and reachable only by the one-edit
trigger (section 3.2).

The offset and the due date are snapshot for the reason every other snapshot in billing exists: a
policy change next quarter must not silently re-date a decision the firm already acted on.

### 8.3 Turning reminders on does not produce a backlog of prompts

A firm enabling a 7/21/45 schedule with a ninety-day-old bill on its books has crossed all three
steps at once. Raising three prompts about one invoice is the fastest way to teach a firm to ignore
the surface.

**Only the highest crossed step is raised. The earlier ones are recorded as decided and not raised**,
with reason `caught-up`. Each `(invoice, step)` is still decided exactly once, the record explains why
two of them produced nothing, and the firm gets one prompt per invoice.

### 8.4 The world changed underneath

- **The invoice was paid between the read and the write.** The record states the balance it observed
  and when. It is not phrased as the current balance, and the prompt resolves the live figure behind
  the deep link. A reminder about a bill paid an hour ago is an annoyance the surface corrects, not a
  falsehood on a record.
- **The matter closed.** The reminder keeps running. An unpaid finalized invoice on a closed matter is
  still owed — billing's own close precondition is deliberately **soft** on an unpaid receivable, so a
  matter closing over a debt is an expected shape and the debt is the invoice's, not the matter's.
- **The invoice was credited or written off in full.** The unpaid balance is zero and the comparison
  simply does not select it. Nothing special is needed, which is the benefit of comparing against the
  balance rather than against a status.
- **A finalized invoice is never voided**, so there is no superseded-invoice case; `void` is
  unreachable from `final` by trigger.

## 9. Payment plans — the half that can be built, and the half that cannot

### 9.1 What a plan is

A plan is **a promise recorded on the firm's side about how an existing debt will be paid.** It is not
consent to charge anything, it creates no receivable, it changes no invoice, and the invoice's
`total_minor` does not move. Under the built schema it could not do otherwise: value reaches an invoice
through exactly one door and that door composes a posting.

**`payment_plan`** — append-only. `invoice_id` (one finalized invoice; a plan across several is a named
seam, because an instalment spanning invoices needs an allocation rule this slice does not need to
invent), `client_entity_id` derived from the matter's own client party and re-checked, `total_minor`
(refused above the invoice's unpaid balance at creation), `instalment_count`, `currency`,
`first_due_date`, `cadence`, `agreed_by` (the member), `agreed_at`, `client_assent_basis` (a closed
label: `written` | `verbal` | `portal`), `client_assent_at`, `client_assent_reference` (a nullable File
Manager handle), and `cancelled_at` / `cancelled_by` / `cancellation_reason` as the one edit.

**`client_assent_basis` records that the firm says the client agreed. The platform never asserts the
client agreed.** That distinction is what stops a plan row from later reading as consent to a charge.

**`payment_plan_instalment`** — materialized in the plan's own batch, append-only, never recomputed:
`plan_id`, `sequence`, `due_date`, `amount_minor`. Amounts come from `allocate` over the total, so they
sum to it exactly and the remainder lands in a stated place rather than in whichever instalment the
arithmetic happened to favour.

### 9.2 An instalment has no status, and its state is derived

An instalment is met when the value applied to the invoice since the plan began covers the cumulative
schedule through that instalment. It is a running-total comparison over `invoice_application` rows
billing already keeps, and it needs no column.

This is the honest model as well as the cheap one: a plan is a promise about a running total, not about
which cheque paid which instalment. Trying to attribute a payment to an instalment would have the
platform decide something the client never said.

### 9.3 What the automation does with a plan

One thing: it compares the plan's schedule against the applied total and, where an instalment's due
date has passed and the cumulative total does not cover it, writes an `invoice_reminder` with reason
`plan-instalment-missed` and the instalment's sequence as the ordinal. Same table, same convergence,
same delivery boundary.

### 9.4 A plan in good standing suppresses the ordinary overdue reminder

An invoice under a current plan is not overdue in the sense the reminder means, and chasing it would be
the platform contradicting an agreement the firm made. While a plan exists, is not cancelled, and has
no missed instalment, the `overdue-invoice` comparison skips its invoice and records
`covered-by-payment-plan`. A missed instalment ends the good standing, and from then on both reasons
are live. (Flag M11.)

### 9.5 What cannot be built, and why it is three walls rather than one

A plan that charges a card on its due date is a different feature, and it is unreachable today for
three independent reasons, any one of which would be sufficient:

1. **There is no payment rail.** Payments is designed and eight of its nine ledger nodes are
   `not-started`; `composeInvoiceApplication` refuses the `payment` kind by name for every rail,
   including a manual cheque.
2. **There is no stored payment method.** Whether to build one is payments flag K5, and the payments
   design records that a stored-method feature without a consent record is a feature that will be
   regretted.
3. **Even with both, an unattended charge has no principal.** A stored token is a `protected()` column;
   decrypting one is a permission check plus a committed audit row against a principal whose permission
   can be checked. A cron pass has none. The payments design reaches this conclusion independently and
   names it as a reason to prefer building stored methods late.

So the plan this slice can deliver is **the record, the schedule, the derived standing, and the missed-
instalment prompt**. Charging is flag M3, and the recommendation is no — not "not yet".

## 10. Evergreen below-floor replenishment

The smallest automation, because it is a scheduled call to a shipped composer.

Per firm: for every matter with an in-force `retainer` arrangement, read `readRetainerStatus`; where
`belowFloor` is true and `openRequestId` is null, call `requestRetainerReplenishment` with
`requestedBy: null` and commit. The existing `billing.retainer.replenishment_requested` topic fires,
and Notifications subscribes.

Four things this does **not** do, each for a reason:

- **It composes no trust statement.** It reads the leaf and its available balance through trust's own
  reads, which is what the shipped `readRetainerStatus` already does, and writes nothing to a trust
  table. Tier C.
- **It does not read `min_balance_minor`.** The retainer floor is business configuration on the
  agreement; the leaf's floor is the structural no-negative bound and is never repurposed.
- **It does not race-guard the balance.** A balance that moved between the read and the write means the
  row records a shortfall that is no longer exactly true. That is accepted and it is honest, because
  the row is explicitly an observation: `observed_balance_minor` and `requested_at` are on it, and the
  live figure stays trust's to answer. The alternative — aborting the batch on a trust balance — would
  require composing a trust statement, which tier C forbids. The one thing this must never become is a
  request phrased as the current balance.
- **It does not tell the client.** Section 3.1 makes that impossible today; flag M4 asks whether it
  should when a channel exists. Recommendation: firm only, because "your retainer is low, please send
  money" is the firm's voice and its timing.

## 11. Convergence, per automation

The general rule the platform already holds to: **a UNIQUE index is the guarantee and the read in
front of it is the sentence.** A guarded `UPDATE` that could store a row is a write, not a guard.

| Automation             | Convergence key                                               | What a redelivery does                                                                                        |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Recurring bill         | UNIQUE `recurring_bill_run (schedule, period)`                | The insert aborts the whole batch, so no second draft. The pass's read finds the row first and skips quietly. |
| Batch bill             | UNIQUE `billing_batch_run_item (run, matter)`                 | Same. Resumption re-reads items with no outcome, so a half-run continues rather than restarting.              |
| Payment reminder       | UNIQUE `invoice_reminder (invoice, reason, ordinal)`          | Same, and it survives the notification retention sweep because it is a billing row (section 5).               |
| Plan instalment missed | the same index, with the instalment sequence as the ordinal   | Same.                                                                                                         |
| Replenishment          | the shipped partial unique index, one open request per matter | The composer refuses by name; the pass records a skip.                                                        |
| The notification       | the shipped `<topic>:<outboxRowId>` dedupe key                | Stable across redeliveries by construction. Nothing new.                                                      |

Two things that follow and are easy to get wrong:

- **The record, its run row and its outbox message are one batch.** Splitting them gives a draft nobody
  recorded, or a topic for a record that rolled back.
- **The pass takes no lock and needs none.** Overlapping cron fires are safe because every write
  converges on an index, which is exactly the property `sweepOutbox` already relies on.

## 12. Configuration: nothing is decided silently

Every knob is a `FirmSettingDefinition` with a default in code, so a missing row is the default and is
readable without a settings screen.

| Key                                  | Default                               | Why that default                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing.automations.localHour`      | `6`                                   | Before the working day, in the firm's own zone, so the morning starts with the drafts already made. Anchored on the platform's clock where the firm has set no default office — stated, never substituted silently.                             |
| `billing.reminders.enabled`          | **`false`**                           | Telling a client they owe money is an act in the firm's voice. A platform that starts doing it the day it deploys has decided how the firm treats its clients. **Off is a decision, not an absence, and the surface must say so** (section 14). |
| `billing.reminders.steps`            | `[7, 21, 45]` days after the due date | A stated, conventional schedule so that turning reminders on is one switch rather than a form. Recommended rather than imposed; flag M2.                                                                                                        |
| `billing.recurring.autoFinalize`     | **`false`**                           | Finalization is irreversible, posts a receivable, locks work-in-progress, and is what permits money to leave trust. Tier B. Flag M1.                                                                                                            |
| `billing.replenishment.enabled`      | **`true`**                            | The firm already expressed the intent by recording a floor on the agreement. The automation honours a configuration the firm made rather than inventing one — which is why this default runs the other way from reminders.                      |
| `billing.batch.maximumMattersPerRun` | `500`                                 | A stated ceiling, refused by name with a suggestion to split, rather than a run that discovers its own limit.                                                                                                                                   |

**A firm that has configured nothing must be told, not silently covered.** "No reminder schedule is
configured, so no reminder will be raised for this invoice" is a sentence a surface owes the reader; a
blank space where a reminder would be is the platform looking like coverage it does not have. That is a
requirement on the deferred surfaces in section 14, and it is the reason each default above is written
down with a reason rather than being a constant somebody chose.

## 13. The run record, and what it owes a person who was not there

A run that touched four hundred matters and skipped twelve must be able to say which twelve and why,
months later. Three rules make that true:

1. **Every target gets a row, including the ones nothing happened to.** Four hundred targets, four
   hundred items.
2. **A reason is a closed label plus identifiers, never a sentence.** The same reasoning the
   notification suppression tally carries: prose drifts, is written for the person writing it, and
   cannot be counted. Where a refusal has a subject — the entry that was claimed elsewhere, the account
   role that was unmapped — the subject is its identifier.
3. **A run row records a decision about the world, never a failure to read it.** A transient failure
   writes nothing and is retried; a decision is permanent. Without this, one bad afternoon becomes a
   permanent skip and a firm never gets that month's bills.

Run records are financial-adjacent — they are the record of what the platform did on a firm's behalf —
and this slice sweeps none of them. Flag M12.

## 14. Deferred surfaces

No screen is designed here. Four surfaces are named, with what each must show:

- **The schedule surface (per matter).** The in-force schedule version, who authorized it and when,
  the fee agreement version it is pinned to, the next period it will compose, and — where it is paused
  — which of the three staleness conditions paused it and what clears it. A matter with no schedule
  says so.
- **The run surface.** One run, its trigger, who started it, its counts, and every item with its
  outcome, filterable to the skips. This is the surface section 13 exists for.
- **The reminder surface (per invoice).** The configured schedule, which steps have been decided, what
  each observed, and — prominently — **"no reminder schedule is configured"** when there is none, plus
  "no delivery has been recorded", which is the same honesty the billing design asks of the apply-funds
  surface.
- **The payment plan surface (per invoice).** The instalments as agreed, the derived standing, what the
  client has actually paid against the running total, and the basis on which the firm recorded the
  client's assent.

## 15. Notification types this slice registers

Ordinary `outbox-topic` entries in `NOTIFICATION_TYPES`, category `billing`, each naming its topic by
the producing package's exported constant. Nothing about delivery is built here.

| Topic                                      | Subject   | Audience                                                  |
| ------------------------------------------ | --------- | --------------------------------------------------------- |
| `billing.invoice.reminder_due`             | `invoice` | `capability-holders` on `billing:read`                    |
| `billing.recurring.drafted`                | `invoice` | `matter-team`                                             |
| `billing.recurring.paused`                 | `matter`  | `capability-holders` on `billing:configure`               |
| `billing.batch.completed`                  | `matter`  | `actor` for a member-triggered run                        |
| `billing.retainer.replenishment_requested` | `matter`  | already shipped and unsubscribed; this registers the type |

Three constraints inherited rather than chosen:

- **A billing type may not declare `escalation: "immediate"`.** Only `trust` and `security` may, held
  by a fitness test. A billing reminder rides the digest.
- **The digest carries counts and nothing else.** A member's morning mail says "3 billing items", never
  an invoice number, a client name, or an amount — an invoice number is client-identifying to anyone
  holding a prior bill. The content boundary is structural in `renderNotificationDigest` and this slice
  neither widens nor tests around it.
- **`billing.batch.completed` uses `actor`, which is a one-recipient audience.** A matter-anchored type
  reaching one person needs a written entry on the registry-fitness short list. This one is not
  matter-anchored — it is a reply to the member who started the run, which is exactly the shape the job-
  completion precedent already covers.

## 16. Permissions

No new capability keys. The six billing keys already cover every act here, and adding a seventh would
split a capability along an axis nobody manages by:

- `billing:configure` — create, amend, pause and cancel a recurring schedule; write the reminder
  policy; record a payment plan. It is the key whose registry comment already reads "billing
  arrangements, tax rates, the numbering scheme, the account-role map", and a standing instruction is
  the same kind of thing.
- `billing:draft` — start a batch run, which composes drafts and nothing else.
- `billing:finalize` — required on the authorizing member of any schedule whose firm setting says it
  finalizes. The staleness check in section 4 tests for the capability the automation actually
  exercises, not for a fixed one.
- `billing:read` — every run, reminder and plan read.

## 17. Fitness functions this design owes

Each is a structural claim above, re-proved over stored rows rather than trusted.

- **No file in the automations module composes a `trust_*` statement, or calls
  `applyEarnedFeesUnderAuthorizationPolicy`, `applyTrustFundsToInvoices`, or
  `composeTrustToOperatingTransfer`.** A source scan, on exactly the precedent billing already carries
  against trust and payments carries against both. This is the tier-C line, and it must be a scan
  rather than a rule to remember.
- **No `recurring_bill_run` names an invoice that another run also names**, and no `(schedule, period)`
  appears twice — the index proves the second, the query proves the first, and together they prove no
  period was billed twice by two schedule versions.
- **Every `recurring_bill_run` with outcome `drafted` names an invoice that exists and is on the
  schedule's matter.**
- **Every `invoice_reminder` names a finalized invoice**, and no reminder of reason `overdue-invoice`
  exists for an invoice that was under a plan in good standing on the day it was raised.
- **Every `payment_plan`'s instalments sum exactly to its `total_minor`**, and no plan's total exceeds
  the invoice's `total_minor`.
- **No `invoice_reminder` or `recurring_bill_run` carries a free-text reason** — a scan over the
  outcome columns against the closed vocabularies, because a label that has become prose is the failure
  mode section 13 exists to prevent.
- **Every batch run's item count equals the size of its recorded selection.** A run that quietly
  dropped a target is the one failure the run record exists to catch and is the easiest to introduce.

## 18. Load profile and measurement

An `AutomationVolume` corpus accreted onto the existing harness beside `InvoiceVolume`, and four
measurements:

1. **The per-firm pass, whole**, over a firm with a thousand matters, four hundred schedules and three
   thousand open invoices — the number that decides whether the pass fits an hourly wake.
2. **The recurring composition**, one schedule at its ceiling: the unbilled read plus a 400-claim draft
   in one batch. This is the batch with the real ceiling and the harness is what sets
   `maximumMattersPerRun`, not a guess.
3. **The reminder comparison** across a firm's open receivables, which is the read that scales with the
   firm's whole billing history rather than with its month.
4. **The replenishment sweep**, which is a per-matter trust available-balance read and therefore the
   one with an N+1 waiting in it.

## 19. What this design deliberately does not cover

- **Any movement of client money**, by any automation, for the structural reason in section 3.3.
- **Delivering a bill or a reminder to a client**, and the invoice artifact and `invoice_delivery`
  record it would need. Named, seamed, and belonging to the billing tail plus the client portal.
- **Statements of account** — a client statement is a read composition rendered by financial reporting,
  and scheduling one is that slice's scheduled-generation path, not a second one here.
- **Dunning as an escalation policy** — a second and third letter with changing language, interest, or
  a collections hand-off. The reminder record supports steps; what a step _says_ needs a channel first.
- **Interest on overdue invoices.** Representable as a line kind, computed by nothing, and a
  jurisdiction question that argues for the same refusing posture as tax.
- **Recurring bills across a client's whole matter set**, or a plan across several invoices. Both need
  an allocation rule, and `allocate` is the answer when a real case arrives.
- **Cloudflare Workflows.** Section 7 states why nothing here needs it.

## 20. Owner flags

Each has a recommendation where one is defensible. A recommendation the owner can ratify is more useful
than an open question; none of them is settled by this document.

| Flag    | Decision                                                                                                                                                                                | Recommended                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**  | May a recurring schedule **finalize**, or only draft? Finalizing posts the receivable, locks work-in-progress irreversibly, and creates the evidence that permits money to leave trust. | **Draft only in this slice.** `billing.recurring.autoFinalize` exists and defaults `false`; turning it on is a firm's deliberate act, and a schedule that finalizes requires `billing:finalize` on its authorizer. |
| **M2**  | Is the reminder automation **on or off** out of the box, and what are the default steps?                                                                                                | **Off, with a stated default schedule of 7 / 21 / 45 days after the due date.** Off is recorded and surfaced as a configuration, never as silence.                                                                 |
| **M3**  | May a payment plan **auto-charge**?                                                                                                                                                     | **No** — and not "not yet". Section 9.5: three independent walls, one of which survives payments shipping.                                                                                                         |
| **M4**  | Does below-floor replenishment notify the **client**, or only the firm?                                                                                                                 | **Firm only.** Impossible today, and when a channel exists the ask is still the firm's voice and timing.                                                                                                           |
| **M5**  | What becomes of a **payment plan when the matter closes**?                                                                                                                              | **It survives.** The debt is the invoice's, not the matter's, and billing's close precondition is deliberately soft on an unpaid receivable.                                                                       |
| **M6**  | What becomes of a **recurring schedule when the matter closes**?                                                                                                                        | **It stops**, recorded as `matter-closed` rather than deleted, so re-opening a matter restores a readable history.                                                                                                 |
| **M7**  | May an automation draft a bill on a matter whose **trust balance is below its retainer floor**?                                                                                         | **Yes.** The bill is what tells the client to top up; refusing to bill an under-funded matter is the platform deciding a firm should work unpaid. The pass raises the replenishment ask alongside it.              |
| **M8**  | Does a **superseded fee agreement** pause the schedule, or does the schedule follow the current agreement?                                                                              | **Pause and report.** A fee change is a decision with a client in it, and a schedule that silently re-prices is a bill nobody authorized at the new rate.                                                          |
| **M9**  | Does a schedule keep running when its **authorizing member leaves** or loses the capability?                                                                                            | **Pause and report.** Neither silently continuing nor silently stopping; the firm re-authorizes, which is one act by a person.                                                                                     |
| **M10** | Reminder policy grain: firm-wide only, or **per-client override**?                                                                                                                      | **Firm-wide in this slice.** Per-client belongs with the client billing guidelines on the Directory entity, which are not built.                                                                                   |
| **M11** | Does a payment plan **in good standing suppress** the ordinary overdue reminder?                                                                                                        | **Yes.** Chasing a bill the firm agreed to instalments on is the platform contradicting its own record of the agreement.                                                                                           |
| **M12** | **Retention** of run records, reminder records and closed schedules.                                                                                                                    | **No sweep in this slice.** They are the record of what the platform did on a firm's behalf; a window can be added on evidence and cannot be undone once things are gone.                                          |
| **M13** | Does a recurring schedule skip a period whose billable total is **below a minimum**?                                                                                                    | **Optional per schedule, defaulting to no minimum.** A period with genuinely nothing to bill produces no invoice and a `nothing-to-bill` run row either way.                                                       |

## 21. Test plan sketch

- **The refusals, by name, one test each:** an anchor day above 28; a batch above the ceiling; a
  draft whose claims exceed `MAXIMUM_CLAIMS_PER_INVOICE`; a schedule whose pinned arrangement was
  superseded; a schedule whose authorizer is deactivated; a plan whose total exceeds the invoice's
  unpaid balance.
- **Convergence at commit, not by pre-check:** two passes over one `(schedule, period)` with the
  second losing on the index; a replayed outbox row producing no second notification; a reminder record
  surviving a notification retention sweep that deletes its notification, and **not** re-raising.
- **The race with a person:** a manual draft claiming an entry between the automation's read and its
  commit, aborting the automation's whole batch and recording `work-in-progress-claimed-elsewhere`.
- **A half-completed batch resumes**, with the items already carrying an outcome untouched and the
  counts adding up.
- **A transient failure writes no run row** and the next pass produces the bill, distinguished from a
  decided skip which is permanent for its period.
- **The tier-C scan** fails when a file in the automations module imports a trust composer.
- **The local hour:** a firm in Nevada composes its August bill on its own 1 September, not on a UTC
  instant that is still August there; a firm with no default office is anchored on the platform's clock
  and the fixture says so rather than asserting a zone.
- **A firm that has configured nothing** produces no reminders, and the read that a surface would use
  reports the absence as an unconfigured policy rather than as an empty list.
