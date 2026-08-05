# Billing and invoicing — design (slice 3·4)

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 14 are open. No product code in this cycle.
**Scope:** The invoice — what it is, when it becomes evidence, how it draws work-in-progress from the
shipped time and cost stores, how it is numbered, how value reaches it, and what it posts to the
ledger. The billing arrangements (hourly, flat fee, contingency, retainer/evergreen) and which ship
when. The trust boundary: what satisfies the earned-fee precondition the trust subsystem left
refusing. The tax seam. The read and write surface a future payments slice consumes. Excludes,
each with its seam placed here: payment processing and rails, recurring and batch bill generation,
reminders and dunning, settlement disbursement statements, report rendering, the client-portal
surface, and the invoice user interface.
**White-paper home:** _Financial Core — Billing_, with _Time tracking_, _Costs and expenses_, _Trust
accounting_, _Operating accounting / general ledger_, _Money & currency_, _Identifiers_,
_Idempotency_, _Transactional outbox_, _Notifications_, _Payments_, and _Locations_ as the
surrounding context.
**Governing decisions:** ADR-0008 (append-only double-entry ledger), ADR-0072 (the ledger core as
built), ADR-0061 (money representation, the two scales, and rounding named per boundary), ADR-0009
and ADR-0032 (the trust engine and fees never touching trust), ADR-0079 (matter numbers frozen at
assignment, and the counter idiom that freezes them), ADR-0003 (tenancy and the firm-scoped
data-access layer), ADR-0063 (idempotency), ADR-0064 (the transactional outbox), ADR-0067 (route
metadata and the one enforcement chokepoint), ADR-0051 (registry, chokepoint, fitness function),
ADR-0039 (nothing heavy on the hot path), ADR-0083 (load-profile accretion), ADR-0059 (Notifications
owns the delivery decision), ADR-0213 (the refuse-rather-than-guess posture on jurisdiction-specific
facts).
**Decision inputs:** the shipped work-in-progress stores and their shared freeze contract
(`packages/timekeeping`, `packages/costs`, `packages/billing-core`); the shipped ledger
(`packages/ledger`); the shipped trust subsystem, and in particular the refusing earned-fee port at
`packages/trust/src/transfer.ts`; the shipped matter-number counter idiom at
`packages/matters/src/numbering/counter-statements.ts`; the money package's rounding helpers and
`allocate` (`packages/money/src/rounding.ts`, `packages/money/src/allocate.ts`); the phase-3 slice
map ([`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md))
for the coordination pins and phase-wide invariants; and the trust accounting analysis
([`../research/2026-08-04-trust-accounting-analysis.md`](../research/2026-08-04-trust-accounting-analysis.md)),
whose flag T4 this design exists to answer.

## Why now

Three of the four things an invoice is made of are already on `main` and doing nothing with each
other. Time entries accumulate in a work-in-progress store with a resolved rate snapshot and a
`billed` state nothing ever sets. Cost entries accumulate the same way, with an `invoice_id` column
that is null on every row that will ever exist until this slice ships. Client money sits in trust
leaves whose only legitimate exit toward the firm — the earned-fee transfer — is wired to a port
that **refuses every transfer**, on the stated grounds that what evidence permits money to leave
trust had not been settled.

This design settles it. A finalized invoice is the evidence, and making that true is most of the
work: an invoice that can satisfy an ethics rule has to be an evidentiary record rather than a
mutable row, has to say exactly what it charges and for which matter, and has to carry an unpaid
balance that cannot be exceeded no matter how many concurrent requests try.

The rest of the slice follows from that. The ledger has never been touched by the financial core's
domain slices — time and costs are both deliberately non-posting — so invoice finalization is the
first and, in Phase 3, the only place where the firm's own work becomes a number on the firm's own
balance sheet.

## 1. What this design is, in one paragraph

**A draft invoice is a working document; a finalized invoice is an evidentiary financial record, and
the line between them is the only interesting moment in the subsystem.** Before it, everything is
editable and work-in-progress entries are merely _claimed_. At it, in one batch: a number is drawn
from an allocation ledger, the accounts-receivable entry posts, every claimed entry locks, and the
per-matter balance rows are created with a bounds CHECK that makes over-application structurally
impossible. After it, nothing about the invoice is ever edited — value arrives as append-only
application rows, corrections arrive as credit notes, and the one mutable row in the subsystem is a
derived balance updated only inside a posting batch, exactly as `account_balance` is.

## 2. What already exists, and what it obliges

| What ships                      | Where                                                  | What it obliges of this design                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time work-in-progress           | `time_entry` (+ `invoice_id`, `status`, `rate_e4`)     | The rate is already snapshot per entry. Billing consumes the snapshot and never re-resolves a rate.                                                                         |
| Cost work-in-progress           | `cost_entry` (+ `invoice_id`, `disbursement_class`)    | Hard and soft costs are already distinguished, which is the distinction the ledger treatment turns on (section 9.3).                                                        |
| The shared freeze contract      | `@magna-carta/billing-core`                            | `billed` and `void` are **terminal**. Billing may drive an entry into `billed`; it may not drive one back out (section 5.4).                                                |
| The append-only ledger          | `@magna-carta/ledger`                                  | Postings compose, never commit; the caller merges them into its own batch. Balance bounds are the only mechanism that aborts a D1 batch on a business condition.            |
| The trust subsystem             | `@magna-carta/trust`                                   | The transfer's second leg already posts `Dr Operating Bank / Cr Accounts Receivable`. That credit is unbalanced unless finalization debits accounts receivable (section 9). |
| The refusing earned-fee port    | `packages/trust/src/transfer.ts`                       | Billing implements the port; trust never learns what an invoice is (section 8.1).                                                                                           |
| The matter-number counter idiom | `packages/matters/src/numbering/counter-statements.ts` | A sequential number under concurrency is a solved problem here. Billing reuses the idiom rather than re-deriving it (section 4).                                            |
| Rounding named per boundary     | `packages/money/src/rounding.ts`                       | `roundInvoiceLine` already documents that invoice lines may be **negative** — discounts and credits were anticipated (section 3.3).                                         |
| Largest-remainder allocation    | `packages/money/src/allocate.ts`                       | Spreading one payment across several matters sums to the whole exactly (section 7.4).                                                                                       |
| The client link                 | `matter_party` with `role = 'client'`                  | The invoice's client is resolved through the party table; `matter.client_display_name` is display-only and is not the link.                                                 |
| Letterhead and remit-to         | `location.address_block` / `footer` / `remit_to`       | Snapshot at finalize, never read live (phase invariant; section 10).                                                                                                        |
| The e-billing flag              | `matter.e_billing`                                     | Already landed ahead of its consumer. LEDES reads it; capture-time validation already does.                                                                                 |

Two things do **not** exist and their absence shapes the design: there is no product chart of
accounts (only a demo one), so account resolution is a named seam that refuses rather than guesses
(section 9.4); and there is no `notify()`, so statements and reminders are emission points only
(section 12).

## 3. The invoice model

### 3.1 The lifecycle is three states, and "sent" is not one of them

`draft` → `final`, with `void` reachable **only from draft**.

A draft is a working document: lines can be added, removed, re-worded, re-ordered, discounted; the
whole thing can be thrown away. Nothing has been asserted to anybody, so append-only discipline
would buy nothing and cost a great deal — a firm made to write a compensating record for a typo in a
draft stops using the draft.

Finalization is the transition to evidence. After it the invoice row, its lines, and its claims are
frozen by database trigger; there is no un-finalize, and `void` is unreachable. A finalized invoice
that should not have been issued is corrected by a **credit note** (section 6), which is a second
permanent record rather than the erasure of the first. This is the same reasoning as the ledger's
reversal rule and the trust subsystem's rule that a release is a new linked row.

**Sent is deliberately not a state.** A bill is delivered — by email, by post, by hand, through a
client portal, through an e-billing gateway — possibly several times, possibly by several channels,
and a re-send is not a change to the financial record. Modelling delivery as a status forces the
finalized row to be mutable for the one field that is least load-bearing, which is exactly the
concession that makes an append-only table stop being one. Delivery is instead an append-only
`invoice_delivery` row per attempt (channel, recipient reference, timestamp, external reference,
outcome), and "has this bill been given to the client" is a read over those rows. That read matters
for a real reason: several jurisdictions expect a client to have received a bill before fees are
taken from trust, and section 8.3 explains why it is surfaced rather than gated.

### 3.2 The tables

Nine tables, in three groups by their mutability posture — which is the property worth organizing
them by, because getting it wrong in either direction is the characteristic failure of a billing
subsystem hung off an append-only ledger.

**Editable while draft, frozen at finalize** (trigger: `RAISE(ABORT)` on any `UPDATE`/`DELETE` when
the owning invoice's stored status is not `draft`):

- **`invoice`** — the header. Client entity, currency, billing period, issue date, due date, notes,
  the letterhead and remit-to snapshot columns, the arrangement snapshot, `status`, the drawn
  `invoice_number` (null until finalize), `finalized_at` / `finalized_by`, `voided_at` /
  `voided_by` / `void_reason`. **No stored total and no stored balance** — both are derived from
  the balance rows below, so a payment never has a reason to touch this row.
- **`invoice_line`** — what the client is told, in presentation order: `line_index`, `matter_id`
  (NOT NULL — every line names its matter), `kind`, a **snapshot** description, quantity, `rate_e4`,
  `amount_minor` (may be negative — see 3.3), the UTBMS code snapshot, and a tax-treatment marker.
- **`invoice_wip_claim`** — which work-in-progress rows this invoice has taken: `invoice_id`,
  `source_kind` (`time_entry` | `cost_entry`), `source_id`, the optional `invoice_line_id` that
  presents it, `claimed_amount_minor`, and `released_at`. This table, not the line table, is the
  concurrency control (section 3.4).

**Append-only from birth** (trigger: `RAISE(ABORT)` on `UPDATE` and `DELETE`, unconditionally —
the discipline the trust subsystem applies to `trust_hold`, `trust_transfer`, and `trust_movement`):

- **`invoice_number_counter`** and **`invoice_number_allocation`** — the numbering pair (section 4).
  The counter's `next_value` is the sanctioned exception, as it is for matters.
- **`invoice_application`** — every unit of value that reaches an invoice: `invoice_id`,
  `matter_id`, `kind` (`trust_transfer` | `payment` | `credit_note` | `client_credit` |
  `write_off` | `reversal`), a positive `amount_minor`, the source reference
  (`trust_transfer_id` / `credit_note_id` / an external payment reference), `reverses_application_id`
  (UNIQUE, so a double reversal is structurally impossible — the `reverses_entry_id` precedent),
  the effective date, and who applied it.
- **`credit_note`** and **`credit_note_line`** — a correction against a finalized invoice
  (section 6).
- **`invoice_delivery`** — one row per delivery attempt (section 3.1).
- **`client_credit`** — value owed back to a client that has not yet been discharged (section 6.2).

**Derived state, mutable only inside a posting batch** — one table, and it is the single most
important one in the design:

- **`invoice_matter_balance`** — one row per `(invoice_id, matter_id)`, created in the finalize
  batch. `total_minor` (the matter's share of the finalized invoice, adjusted only by credit notes),
  `applied_minor` (delta-updated by every application), `currency`, and a CHECK
  `applied_minor >= 0 AND applied_minor <= total_minor`.

The balance table is `account_balance` applied to a different subject, deliberately and with the same
justification: **D1 has no interactive transactions, so a bounds CHECK is the only mechanism that can
abort a whole batch on a business condition.** Because over-application aborts the batch rather than
being pre-checked, "this invoice has enough unpaid balance for this transfer" is a structural
guarantee rather than a hopeful read — which is precisely what the earned-fee precondition needs it
to be (section 8.2).

Balances are per `(invoice, matter)` rather than per invoice, and the invoice-level unpaid balance is
a `SUM` over its rows — mirroring trust's rule that a roll-up carries no stored balance and a total is
a `SUM` over descendant leaves. The reason is not symmetry: a trust transfer draws on exactly one
matter leaf, so the ceiling it must respect is that matter's share of the invoice, not the invoice's
total. A single-matter invoice, which is most of them, has exactly one row.

### 3.3 Lines may be negative, and the money package already knew

`roundInvoiceLine` is half-away-from-zero, and its comment says why: "a negative line
(discount/credit/write-off) rounds to the same magnitude as its positive twin". Discounts,
write-downs, and courtesy adjustments are ordinary lines with a negative `amount_minor`. This does
not conflict with the ledger's positive-amounts-direction-is-data rule, which governs `ledger_line`
and stays untouched: the posting derived from a set of invoice lines nets to a positive amount in a
stated direction (section 9.1).

Line kinds: `fee`, `cost`, `flat_fee`, `discount`, `adjustment`, `interest`, `tax`. Tax lines are
composed, never hand-entered (section 7).

### 3.4 Pulling work-in-progress: the claim is the concurrency control

Adding an entry to a draft creates an **`invoice_wip_claim`** row and, in the same batch, sets the
entry's `invoice_id`. The claim is the truth; the `invoice_id` column is a mirror kept for the
"what is still unbilled on this matter" read, which is the hot read and must not join.

The claim's uniqueness is what stops two drafts billing the same hour:

```
UNIQUE (source_kind, source_id) WHERE released_at IS NULL
```

This is the matter-numbering lesson applied to a second problem. A guarded
`UPDATE … WHERE invoice_id IS NULL` looks like it prevents a double claim and does not: a zero-row
`UPDATE` is not an error in SQLite, so the losing batch commits happily having changed nothing, and
the losing draft ends up with a line whose entry belongs to somebody else's invoice. The partial
unique index makes the losing `INSERT` abort its whole batch, which is a real refusal the caller
can retry or report. The guarded `UPDATE` stays as the mirror write, and is documented as a mirror
rather than a guard.

**Release, and what it costs.** While the invoice is a draft, removing a line or voiding the draft
sets `released_at` on the claim and nulls the entry's `invoice_id`, returning the entry to unbilled
work-in-progress. History is preserved — the released claim row remains, so "this entry was on a
draft that was abandoned on the 3rd" is answerable — and the partial index makes the released row
invisible to uniqueness, so the entry can be claimed again. After finalization the freeze trigger
refuses the release outright, which is the honest consequence of the entry having become evidence.

**Status moves at finalize, not at claim.** A claimed entry stays `draft` (or `approved`) and stays
editable, because bill review is exactly when a firm fixes a narrative or a duration. The transition
to `billed` happens in the finalize batch, atomically with everything else, satisfying the phase
invariant that an entry can never be locked without its receivable nor billed twice.

**One consequence, stated plainly:** editing a claimed time entry's narrative does **not** change the
invoice line's text. The line takes a snapshot when it is composed and bill-review edits the **line**.
Two records, both true and both worth keeping: the entry is the timekeeper's contemporaneous record
of what was done, and the line is what the client was told. It also makes a finalized invoice
self-contained — it can be re-rendered years later without reading a single row from the
work-in-progress stores, which is the same property the letterhead snapshot exists to give.

### 3.5 One client, several matters

**An invoice belongs to exactly one client and may bill several of that client's matters.** Every
line names its matter; there is no `invoice.matter_id`, because a stored column that is supposed to
agree with the lines is a column that will eventually disagree with them. "Invoices for this matter"
is served by an index on `invoice_line (matter_id, invoice_id)`.

One client per invoice is a hard rule, and it rhymes with trust's one-client-per-entry rule for a
related reason: an invoice spanning two clients cannot be applied from trust at all (a trust entry
touching two clients is refused at the composition guard), cannot be sensibly aged, and is
indistinguishable at the row level from a billing error. The client is resolved through
`matter_party` where `role = 'client'` and validated for every line's matter at draft composition,
with a fitness query re-proving it over stored rows.

## 4. Numbering

Invoice numbers reuse the matter-number idiom in full: an `invoice_number_counter` keyed by scope,
a **guarded increment**, and an `invoice_number_allocation` row whose composite primary key
`{scope_key, drawn_value}` is the load-bearing backstop, all composed into the finalize batch, with
the bounded-retry loop and the out-of-band counter advance on a lost race.

Two decisions specific to invoices:

**The number is drawn at finalize, never at draft.** A number drawn at draft is a number burned by
every abandoned draft, and gaps in an invoice sequence are the first thing an auditor asks about.
Drawing inside the finalize batch means a failed finalize rolls the allocation back with everything
else, so the sequence has no gaps by construction rather than by care.

**The scope key is firm-wide by default and may be per-Location.** A multi-office firm issuing
invoices on two letterheads usually wants two sequences; a single-office firm wants one. This is the
matter-numbering scheme mechanism unchanged, and it is the argument for the shared extraction below.

**Reuse rather than copy.** The three statement builders are already generic apart from their table
names and one foreign key. They are extracted into a small shared package that matters and billing
both consume, rather than duplicated — because the subtlety that makes them correct (a zero-row
guarded `UPDATE` aborts nothing; the allocation primary key is the real mechanism) is exactly the
kind of thing a copy loses. The extraction is a mechanical move with matters' existing suite as its
proof.

## 5. Billing arrangements

### 5.1 The model

**`matter_billing_arrangement`** — effective-dated and append-only, in the shape the rate engine
already established: a new arrangement closes the prior row's `valid_to` and never edits it, and an
invoice records which arrangement version governed it. Columns: `matter_id`, `kind`, `valid_from`,
`valid_to`, and the kind-specific fields — `flat_fee_amount_minor`; `contingency_share_e4` (a
dimensionless decimal at the rate scale, never `Money`, per the money convention);
`retainer_target_minor` and `retainer_threshold_minor`; and the advance-deposit destination
(section 5.5). Absence of an arrangement means hourly, so no backfill is required for matters that
already exist.

### 5.2 Hourly — first, and mostly already built

Fee lines are composed from claimed time entries using the rate and amount already snapshot on each
entry. Billing never resolves a rate: the entry recorded the rate in force on its work date, which
is the whole point of the effective-dated rate engine, and re-resolving at invoice time would
silently re-rate historical work.

Consolidation (several entries by one timekeeper on one day collapsed to one line) and
block-billing prohibitions from client guidelines both operate on the line composition step, which is
why claims and lines are separate tables: N claims to one line is representable without inventing
anything.

### 5.3 Flat fee — second, and the reason claims and lines are separate

A flat-fee matter's time is still captured — the white paper is explicit that time is tracked on
every matter for profitability and realization. It is simply not what the client is charged.

So on a flat-fee invoice: one `flat_fee` line carrying the arrangement's amount, and claims on every
contributing time entry with `invoice_line_id` **null** and `claimed_amount_minor` zero. The entries
lock as billed, realization reporting can see exactly which work the fee covered, and the client's
invoice shows one line. This falls out of the two-table split with no special case.

Partial and milestone flat fees (a fee invoiced in instalments) are representable as several
`flat_fee` lines across several invoices against one arrangement; the arrangement records the total
and a fitness query can report over-billing against it. No milestone scheduler is built.

### 5.4 Contingency — recorded, dormant, and honest about it

The arrangement records the share and the fee basis. Nothing computes. There is no contingency
invoice, no settlement disbursement statement, and no lien handling in this slice.

This is a position rather than a scheduling accident. A settlement disbursement is a trust
disbursement that splits a recovery between client share, fee, advanced costs, and third-party liens
— it is `allocate` over a set of claimants, most of whom are not in the platform's data model, under
rules about lien priority that vary by state and by lien type. It belongs with trust's disbursement
path once a real matter demands it, and building it now would mean inventing lien policy with no
verified source, which is the mistake the trust analysis exists to prevent. Recording the
arrangement now is nonetheless right: the arrangement is what tells the time surfaces this matter is
not billed hourly, and it is what a later settlement slice reads.

### 5.5 Retainer and evergreen — configuration now, alerts later

The arrangement records the target balance and the replenishment threshold. The threshold is a
business configuration and is emphatically **not** `min_balance_minor`, which is the structural floor
on the trust leaf and must never be repurposed. The below-threshold alert itself is billing
automations (3·7), which reads this configuration; this slice writes it and reads it back.

The advance-fee deposit destination — trust or operating — is recorded per arrangement and never
inferred. Jurisdictions genuinely differ (Missouri exempts an advanced flat fee at or under $2,000
from the trust-deposit requirement; Texas recognizes a true non-refundable retainer as the lawyer's
property; most states follow deposit-and-withdraw-as-earned), and the trust analysis names this as
the highest-consequence data fact in its whole set. The platform records the firm's choice and
supplies no default, in the same posture the jurisdiction resolver takes.

## 6. Corrections after finalization

### 6.1 Credit notes

A **`credit_note`** is a permanent record against a finalized invoice: its own lines, its own reason,
its own effective date, and an `invoice_application` of kind `credit_note` that reduces what the
client owes. It posts its own ledger entry (section 9.2). It never edits the invoice.

The interesting constraint is the one the balance CHECK imposes: **a credit note cannot reduce a
matter's balance below what has already been applied to it.** Concretely, the credit note lands as an
application against `applied_minor` up to the unpaid remainder, and any excess becomes a client
credit rather than a reduction. Two reasons this is right, and one honest consequence.

It is right because the alternative — reducing `total_minor` below `applied_minor` — is a negative
unpaid balance, which is not a thing a receivable can be, and because the money in question has in
the ordinary case already left the client's trust ledger and become the firm's. Un-writing that is
not a correction to an invoice; it is a decision about firm funds.

### 6.2 The hard case: a credit note after the fee has already been transferred out of trust

Say it plainly. The firm finalized a $5,000 invoice, transferred $5,000 out of the client's trust
ledger into operating under the earned-fee rule, and then concedes that $1,200 of it was not earned.

The trust ledger is not rewound. The transfer was valid when it was made, the trust entries are
append-only, and the client's trust balance genuinely is $5,000 lower. What the firm now has is
$1,200 of the client's money sitting in its operating account, and **that is a firm-funds question,
not an invoicing question.** The platform records the obligation and refuses to discharge it on its
own.

The credit note therefore creates a **`client_credit`** row — client, matter, amount, the credit note
that created it, and an open/discharged state — and names the three real exits, each of which is an
operation the platform already has:

1. **Refund from operating.** An operating disbursement to the client. Firm money leaving a firm
   account; no trust entry at all.
2. **Return to the client's trust ledger.** Two linked entries in the shape of the earned-fee
   transfer run backwards: an operating disbursement and a trust deposit. It is not commingling —
   money the firm concedes it did not earn is the client's money — but it cannot be one entry,
   because the composition guard refuses any trust entry touching an operating account, and that
   refusal is correct here for the same reason it is correct in the forward direction.
3. **Apply to a future invoice.** An `invoice_application` of kind `client_credit` against a later
   finalized invoice of the same client, discharging the credit.

The platform will not choose among these, because they differ in what the client is owed and when,
and in at least one reading the choice has jurisdiction-specific consequences the platform has not
researched. What it does do is make the open credit **visible and un-loseable**: it is a row with a
balance, it appears on the client's financial surface, and a matter cannot quietly close over it
(section 11.2).

### 6.3 Reversing a mistaken application

An application posted in error — a payment recorded against the wrong invoice, a transfer applied to
the wrong matter — is corrected by a **reversal application**: a new row of kind `reversal` carrying
a positive amount, a UNIQUE `reverses_application_id`, and a negative delta on `applied_minor`. The
underlying money movement is reversed on its own terms through the ledger's `reverseEntry`, in the
same batch. Amounts stay positive; direction is the row's kind, never a sign.

## 7. Taxes

### 7.1 The posture: mechanism, no policy, no default

The platform ships the machinery to charge tax and **encodes no knowledge of when tax is owed**. No
rate table, no nexus determination, no taxability-of-legal-services catalog, no jurisdiction
inference from the matter's office. A firm that has configured nothing gets no tax line.

Three arguments, in ascending order of force.

**The domain genuinely varies, at a granularity below the state.** Most US states do not tax legal
services; several tax them under a gross-receipts or general-excise regime rather than a sales tax;
some tax a subset of services; exemption and resale certificates move the answer per client; and the
answer changes by legislative session. A platform-supplied rate would be wrong somewhere on the day
it shipped.

**The trust analysis's own three-bucket asymmetry classifies this as a data fact.** Rigor rules may
resolve to the strictest observed value when a jurisdiction is silent, because over-complying is
safe. Restriction rules may resolve to "off" only on a recorded finding of silence. **Data facts
assert something about the world, and a wrong silence states a wrong fact — they are never
defaulted.** A tax rate is as pure a data fact as the set contains. Adopting a different posture
here than in trust would not be a considered difference; it would be an inconsistency.

**Unlike trust, there is no ethical floor forcing us to encode anything.** The trust subsystem cannot
refuse to have an opinion about the no-negative rule, because a subsystem with no opinion there is
unsafe. Here, the safe default is the empty one: no tax line is the correct output for the large
majority of US law firms, and a firm that owes tax knows it owes tax.

### 7.2 The mechanism

A per-firm **`tax_rate`** catalog: name, jurisdiction label (free text, for the firm's own
reference), rate as a dimensionless decimal at the rate scale, an applies-to selector
(`fees` | `costs` | `both`), effective-dated, active flag. A **`TaxPolicyPort`** resolves a taxable
basis to zero or more ordered tax components; the shipped implementation reads the firm's configured
rates, and the port is where a future verified catalog or a third-party tax service would attach.

Three mechanics worth fixing now because they are cheap now:

- **Components are ordered and may compound.** Every US firm will use zero or one, but a
  Canadian GST-plus-QST arrangement is a compounding pair, and the ordered-components shape costs
  nothing today and is a schema change later.
- **Tax is computed on the aggregate taxable base per rate, then rounded once** with `roundTax`
  (half-up, the statutory rule). Per-line computation accumulates rounding error and produces a tax
  total that does not equal rate × base, which is the number a tax authority checks. Where per-line
  tax attribution is needed for reporting, it is `allocate` over the rounded total, which sums
  exactly.
- **Taxability is per line, resolved at draft and snapshot.** Advanced hard costs are commonly not
  taxable where the same firm's soft costs are; the `disbursement_class` column already carries the
  distinction, so the default is derivable and overridable per line.

The rate, the name, and the basis are **snapshot onto the invoice at finalize**, like the letterhead:
a rate change next year must not alter last year's bill.

## 8. The trust boundary

This is the design's most consequential section, and it exists to answer flag **T4**.

### 8.1 The direction of the dependency

`@magna-carta/trust` owns the transfer and knows nothing about invoices. `@magna-carta/billing`
implements trust's `EarnedFeePrecondition` port, calls `composeTrustToOperatingTransfer`, and merges
the returned statements into its own batch. Billing never composes a trust entry, never writes a
trust table, and never reimplements a trust rule — exactly the seam the trust analysis proposed, and
the same shape as the matter-close precondition, where the shell knows nothing about money and the
composition root hands it the rule.

**No change to the trust package is required, and that is the test that the seam is in the right
place.** The precondition instance is constructed per request by the billing service from the
application it has already resolved, so the port's existing context
(`{nodeId, matterId, amountMinor, currency}`) is exactly enough: it is the re-check that what trust
is about to compose matches what billing authorized. Widening the port with an invoice reference
would have made trust know what an invoice is, for no gain.

### 8.2 What satisfies the precondition — the recommended rule, stated exactly

An earned-fee transfer of amount **A** from matter leaf **L** (matter **M**, client **C**) is
permitted if and only if the caller names one or more **applications**, and for each named
application `(invoice I, matter M, amount a)`:

1. `I.status = 'final'` — the invoice has been finalized, which means a number was allocated, the
   lines and claims are frozen, and the accounts-receivable entry posted;
2. `I`'s client is `C`, the client whose trust ledger is being drawn on;
3. `I` has an `invoice_matter_balance` row for `M` — the invoice actually bills that matter;
4. `a` is at most that row's unpaid balance, `total_minor - applied_minor`;
5. the named amounts sum to `A`, and the context trust leaf `L` is `M`'s leaf.

And the guarantee is not the read. Every condition above is checked before the batch so the failure
reads as a sentence, but the **mechanism** is the `invoice_matter_balance` CHECK: the application
rows and their `applied_minor` deltas ride the same batch as the trust entries, so a concurrent
transfer, payment, or credit note that consumed the balance between the read and the commit aborts
the entire batch — the trust entries, the transfer link, the applications, and the idempotency
record together. This is deliberately the same layering trust uses for the no-negative rule: a
domain pre-check that names a refusal a person can act on, standing in front of a database
constraint that is the actual guarantee. Both are needed and neither substitutes for the other.

**The recommended default is a hard requirement with no override.** This is the operation where
real-world trust violations happen; the friction is the point; and an override path is a path, which
means it becomes the path. The cost is real and should be stated: a firm that invoices out of band —
in a spreadsheet, through an outside bookkeeper, on an insurer's e-billing portal — cannot take its
own earned fees until it has finalized an invoice here. The mitigation is that finalizing an invoice
here is cheap and does not require the platform to have generated it.

### 8.3 Delivery is surfaced, not gated

Several jurisdictions expect the client to have been given a bill or accounting before fees are
withdrawn. The recommendation is nonetheless that **finalization alone gates, and delivery is
recorded and shown**.

The reason is that out-of-band delivery is real and common — bills get handed over at a meeting,
posted, or sent from the client's own e-billing portal — so a hard delivery gate would be satisfied
by firms recording deliveries that the platform did not perform, which converts a compliance record
into a checkbox and makes the record worse than not having it. The apply-funds surface therefore
shows, prominently, whether the platform has any record of the bill reaching the client, and the
firm proceeds knowingly. This is an owner decision (flag B2) and the argument runs the other way if
the owner prefers the stricter reading.

### 8.4 Partial applications

Partial is the normal case, not an edge case. An evergreen retainer at $2,000 against a $6,500
invoice applies $2,000 and leaves $4,500 unpaid; the next replenishment applies more. Each is its
own application row, its own trust transfer with its own two linked entries, and its own delta.
Nothing about the invoice changes; only its derived balance moves.

Three related mechanics:

- **A transfer may not draw more than the matter's own unpaid balance**, even when the invoice as a
  whole is owed more — because the matter's balance is what that client ledger's money relates to.
- **A payment against a multi-matter invoice allocates** across matters by unpaid balance using
  `allocate` (largest-remainder), producing one application row per matter that sums to the payment
  exactly. This is the case the money package's allocation helper names.
- **The ceiling is available balance, not balance.** The trust composer already reads
  `readTrustAvailableBalance`, so a matter whose funds are under a disputed-funds hold refuses the
  transfer with trust's own named refusal, and billing adds nothing.

### 8.5 What this design does not touch

No trust invariant is weakened, relaxed, or routed around. The no-negative floor, the composition
guard, one-client-per-entry, available-as-ceiling, the append-only discipline around the ledger, the
two-linked-entry transfer shape, and the jurisdiction refusals all continue to be enforced where they
are enforced now, by the package that owns them. This design's entire contribution to the trust side
is to supply a satisfier for a port that currently refuses everything.

## 9. The ledger tie-in

### 9.1 Finalization posts; accounts receivable is not derived

The question is worth asking, because a receivable derived from invoice state would be simpler,
would have no chart-of-accounts dependency, and could not drift from the invoice subledger by
construction. Against a subsystem whose invoice tables are already append-only, that is a real
argument and it is the argument the "no premature double-entry" instinct is reaching for.

It loses on two grounds, the first of which is decisive and empirical.

**The shipped trust transfer already credits accounts receivable.** Its second leg posts
`Dr Operating Bank / Cr Accounts Receivable`, and that credit only balances against a debit that
finalization made. Under a derived-receivable model, every trust-funded fee in the firm's history
would credit an account nothing ever debits, and the ledger would carry a growing negative asset
equal to the total of all fees ever taken from trust. Deriving the receivable is therefore not
available without changing shipped trust code and breaking the two-linked-entry shape that exists
for reconciliation reasons. It is not a close call.

**And accounts receivable is a real asset on a real balance sheet.** The firm's operating books
(3·5) need it, a firm's accountant expects it, and the ledger is meant to be the money truth for the
firm, not only for cash. Keeping the receivable outside the ledger would mean the balance sheet is
assembled from two sources, which is the condition the single-ledger decision exists to avoid.

So: **finalization posts, and the invoice tables are the subledger to the ledger's control account.**
That relationship is testable and is made a fitness query: the sum of unpaid balances across all
invoice-matter balance rows must equal the accounts-receivable control account's balance. When it
does not, one of the two is wrong and the report says which invoices.

The posting composed at finalize, in one entry:

```
Dr  Accounts Receivable            invoice total
  Cr  Fee Income                     fee and flat-fee lines, net of fee discounts
  Cr  Client Costs Advanced          hard-cost lines            (see 9.3)
  Cr  Cost Recovery Income           soft-cost lines
  Cr  Tax Payable                    per tax component
```

The entry has a handful of lines regardless of whether the invoice has ten lines or a thousand, which
matters for the batch-size budget in section 13.

### 9.2 The other postings

- **Payment received:** `Dr Operating Bank / Cr Accounts Receivable`, composed by billing.
- **Trust transfer applied:** composed by **trust**, not by billing. Its second leg already credits
  accounts receivable, so billing composes the application row and the balance delta and **no ledger
  entry at all**. This is the single most likely bug in the slice — a double credit that leaves the
  subledger and the control account disagreeing by the amount of every trust-funded fee — and it gets
  an explicit test asserting that a trust application composes exactly one accounts-receivable credit.
- **Credit note:** `Dr Fee Adjustments (contra-revenue) / Cr Accounts Receivable`. Contra-revenue
  rather than a debit to fee income, so gross billings and adjustments stay separately readable.
- **Write-off:** the same shape against a write-off account, which is a different management fact
  from a credit note and is kept distinct for that reason.
- **Client credit discharged:** as described in 6.2, each exit is an ordinary posting.

### 9.3 Hard costs, and an honest gap

Hard costs are money the firm advanced on the client's behalf, not the firm's expense. The correct
treatment credits **Client Costs Advanced**, an asset, and recognizes no income — the firm is being
repaid, not earning. Soft costs (in-house copying, printing) are genuine firm expenses and their
recovery is income. The shipped `disbursement_class` column carries exactly this distinction, which
is a pleasant fit rather than a coincidence: it is the industry distinction and it exists for this
reason.

The gap: **nothing in the platform records the cash going out** when the firm advances a filing fee.
Cost entries are pure work-in-progress and never post; operating disbursements and accounts payable
are 3·5, which is unbuilt. So the credit to Client Costs Advanced has no matching debit yet, and that
account will carry a negative balance equal to all hard costs invoiced but not yet recorded as
disbursed.

That is not an invariant violation — no bounds are set on that account, and the ledger stays balanced
because the entry balances — but it is a wrong-looking number on a balance sheet, and it must be
documented rather than discovered. It is named in the reports as an expected open position, it is
what 3·5 closes when operating disbursements land, and it is flag B7. The alternative postures
(recognize hard-cost recovery as income, or hold it in a clearing account) are worse or equivalent:
recognizing income overstates both revenue and expense permanently, and a clearing account is the
same negative balance under a name that hides it.

### 9.4 Account resolution refuses rather than guesses

Finalization must resolve which firm accounts to post into, and the product chart of accounts does
not exist (the demo chart is explicitly demo-only). The interim seam is a firm-scoped
**`firm_account_role`** map from a small closed set of roles — `accounts_receivable`, `fee_income`,
`client_costs_advanced`, `cost_recovery_income`, `tax_payable`, `fee_adjustments`, `fee_write_off`,
`operating_bank`, `client_credit_liability` — to `ledger_account` identifiers.

**An unmapped role refuses finalization with a named error**, in the posture the jurisdiction
resolver established: a fact we do not have is not a fact we invent. A firm that has not mapped its
chart cannot finalize an invoice, and the refusal says which role is missing and where to set it.
When 3·5 ships the chart product, it populates this map; the roles are the stable contract across
that boundary and are co-designed rather than assumed (coordination pin 4).

## 10. Presentation is snapshot

At finalize the invoice copies, and thereafter never reads live: the Location's letterhead address
block, footer, remit-to, and letterhead logo reference; the firm identity; the client's billing name
and address; the matter numbers and titles; the arrangement version; every line's text; every tax
rate, name, and basis; and the totals. A finalized invoice can be re-rendered byte-identically years
later from its own rows.

This is the phase invariant on letterhead generalized, and the generalization is the point: a later
edit to an office address, a client's name, a matter title, or a tax rate must not silently alter a
document the firm already gave somebody. The rendered artifact itself (a PDF through the assembly
engine) is archived on first delivery rather than at finalize — the bytes worth keeping are the ones
the client actually received — and that is a File Manager and document-assembly concern this design
names as a seam rather than builds.

## 11. Surrounding surfaces

### 11.1 Permissions

Six keys, split where the capabilities genuinely differ: `billing:read`, `billing:draft`,
`billing:finalize`, `billing:apply` (moves client money to an invoice), `billing:credit` (credit
notes and write-offs), `billing:configure` (arrangements, tax rates, numbering scheme, account-role
map). Drafting and finalizing are separated because a billing clerk assembling drafts for a
partner's approval is the common firm shape; applying is separated from finalizing because it moves
client money and the trust subsystem already treats reading and moving as different capabilities.

### 11.2 The matter-close precondition

Trust already registers a hard block on a matter holding client money. Billing registers a **second**
precondition on the same registry: a matter with an unpaid finalized invoice balance, or an open
client credit, refuses to close. The refusal names the invoices and the amounts, and — following the
close-precondition contract — contributes a commit guard so a balance that changes between the read
and the commit aborts the close rather than slipping through. Unlike trust's, the recommended
posture here is a **soft block with an override recorded**: an uncollectable receivable is a real and
ordinary outcome, and the legitimate exit (a write-off) is one click away, so a hard block would be
friction without an ethical floor underneath it. An **open client credit** blocks harder, because
that is the firm holding money it has conceded is not its own — closer to the trust case than to the
receivable case.

## 12. Statements, reminders, and delivery — emission points only

`notify()` does not exist; Notifications owns the delivery decision. This slice therefore emits
outbox topics in the same batch as the write that caused them, carrying identifiers and
non-privileged fields only, and builds no delivery:

`billing.invoice.finalized` · `billing.invoice.delivered` · `billing.invoice.credited` ·
`billing.payment.applied` · `billing.trust.applied` · `billing.client_credit.opened`

A **client statement** — every invoice, payment, credit, and open balance for a client over a period
— is a read composition over the tables this design defines, not a stored artifact, and is rendered
by Reports (3·6). **Overdue is derived at read time and never written**: it is a comparison against
the due date, a stored flag would need a sweep to maintain what a comparison gives for free, and it
would have the platform assert something about a client's conduct that may have been settled this
morning. Reminders and dunning are 3·7 over these same emission points.

## 13. Load profile and measurement

An `InvoiceVolume` corpus accreted onto the existing harness, and four measurements:

1. **Draft assembly** over a matter with a large unbilled backlog — the read that finds unclaimed
   entries, and the batch that claims them.
2. **The finalize batch**, which is the one with a real ceiling. Statement count scales with claims
   and lines (two writes per claimed entry plus one per line), while the ledger entry does not.
   D1's bound-parameter cap is 100 per statement and batches are bounded in practice, so the design
   sets a **maximum claim count per invoice**, refused with a named error suggesting a shorter
   billing period or a split invoice, and the harness is what sets the number rather than a guess.
3. **Balance and aging reads** across a firm's open receivables.
4. **The apply-funds path end to end**, since it composes trust statements, ledger statements, and
   billing statements into one batch and is the longest chain in the financial core.

## 14. Owner decisions

Each has a recommended default; the recommendation is what ships if the owner says nothing, and each
is flagged in the built product until answered.

| Flag    | Decision                                                                                                                                                                            | Recommended                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **B1**  | **Answers T4.** Does an earned-fee transfer hard-require a finalized invoice with sufficient unpaid balance for that matter, with no override?                                      | **Yes** — hard requirement, structurally enforced by the balance CHECK, no override path. |
| **B2**  | Must the invoice also have a recorded delivery to the client before funds may be taken?                                                                                             | **No** — finalization gates; delivery is recorded and shown prominently (8.3).            |
| **B3**  | Invoice states `draft / final / void`, with delivery as append-only rows rather than a "sent" status?                                                                               | **Yes.**                                                                                  |
| **B4**  | One client per invoice, several of that client's matters allowed, every line naming its matter?                                                                                     | **Yes.**                                                                                  |
| **B5**  | Does a full credit note release billed work-in-progress back to draft? Doing so requires widening the shared `billed`-is-terminal freeze that time and costs both consume.          | **No** — corrections are new adjusting entries, as the white paper states.                |
| **B6**  | Taxes: per-firm configured rates only, no platform taxability knowledge, no default rate?                                                                                           | **Yes** (7.1).                                                                            |
| **B7**  | Hard-cost recovery credits **Client Costs Advanced**, which runs negative until 3·5 records the operating disbursement, with the open position named in reports?                    | **Yes** (9.3).                                                                            |
| **B8**  | Account roles resolve through a firm-configured map, and an unmapped role **refuses** finalization?                                                                                 | **Yes** — refuse rather than guess (9.4).                                                 |
| **B9**  | Fee models: hourly first, flat fee and retainer configuration next, contingency **recorded only** with settlement statements deferred to a later slice?                             | **Yes** (5.4).                                                                            |
| **B10** | Is the advance-fee deposit destination (trust or operating) recorded per arrangement and never inferred by the platform?                                                            | **Yes** — it is the highest-consequence jurisdiction-varying fact in the area (5.5).      |
| **B11** | A credit note beyond what is already applied becomes an open **client credit** the firm discharges by refund, return to trust, or future application — the platform moves no money? | **Yes** (6.2).                                                                            |
| **B12** | Extract the counter/allocation numbering idiom into one shared package consumed by matters and billing, rather than copying it?                                                     | **Yes** (4).                                                                              |
| **B13** | Bill-review edits the invoice **line**, not the underlying time entry; the entry's narrative is the timekeeper's record and the line is what the client was told?                   | **Yes** (3.4).                                                                            |
| **B14** | Matter close: **soft** block with a recorded override on an unpaid receivable, but a **hard** block on an open client credit?                                                       | **Yes** (11.2).                                                                           |

## 15. Named seams, not built here

Payment rails and processors; surcharging (operating card payments only, gated by the jurisdiction
profile); payment plans; recurring and batch bill generation; reminders and dunning; settlement
disbursement statements and lien handling; the invoice PDF artifact and its archival; the client
portal's invoice surface; report rendering and aging reports; LEDES electronic submission (the
export format itself is in scope — section 16); QuickBooks and bank-feed synchronization; and any
platform-supplied tax catalog.

## 16. LEDES and billing guidelines

Assigned to this slice by the phase-3 slice map and specced here at the level the slice map requires,
as a sub-stream that runs parallel to the finalize path rather than after it.

A **canonical invoice shape** is composed from the finalized invoice and its lines; **LEDES 1998B**
and **LEDES XML 2.0/2.1** are exporter adapters behind a small port, in the shipped port-and-canonical
pattern. UTBMS codes come from the snapshot on each line, which is why the line carries them rather
than dereferencing the entry. **Billing guidelines** (rate caps, required codes, block-billing and
increment rules) live on the client's Directory entity and are validated **before finalization**,
because an invoice that fails an insurer's guideline should never have become an evidentiary record
in the first place. A guideline failure is a named refusal listing every offending line.

## 17. Open questions

- **Interest on overdue invoices** is representable as a line kind and nothing computes it. Whether
  the platform should compute it at all is a jurisdiction question (statutory maxima, agreement
  requirements) that argues for the same refusing posture as tax.
- **Trust deposits arriving against a specific invoice.** A client who pays a bill into trust rather
  than to the firm creates a deposit that is morally earmarked. Nothing in this design links them,
  and the apply-funds step is manual and deliberate, which is probably correct — but it is worth
  revisiting once real usage exists.
- **Whether a firm wants gapless numbering per Location or per firm** is a configuration this design
  supports and does not decide; the default is firm-wide.
- **Multi-currency** stays a schema change and not a silent extension, as it does everywhere else in
  the financial core.
