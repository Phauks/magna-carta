# The fee work-in-progress store — design

**Date:** 2026-09-07
**Status:** Proposed.
**Scope:** The store a recorded fee lives in, the routes over it, the claim path that lets a draft
invoice take one up, and the consolidation between the Fees surfaces and the Costs surfaces they
were built to parallel.
**Excludes:** the fee arrangement (which the owner moved out of this screen entirely — see below),
contingency and retainer composition, taxes, the invoice renderer, and any change to how an hourly
fee line is composed from claimed time.

**Binding inputs, in order of authority:**

- The owner's standing ruling of **2026-09-03**, _the fee arrangement lives behind the status seal_
  ([`design-corrections.md`](../conventions/design-corrections.md)) — the arrangement leaves the
  Fees screen, and "fees are **recorded** against whatever the status window says".
- The billing domain design ([`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)) — the
  invoice lifecycle, the claim mechanism, the line kinds. Nothing here reopens any of it.
- The built Fees surface, whose own statement of what a fee is
  (`apps/web/src/lib/billing/fee-record.ts`) is the record this store must serve.
- The costs slice ([`2026-06-23-slice-3-3-costs-expenses-design.md`](2026-06-23-slice-3-3-costs-expenses-design.md))
  and the firm money surfaces ([`2026-09-07-firm-money-surfaces-design.md`](2026-09-07-firm-money-surfaces-design.md)),
  which this deliberately mirrors rather than reinvents.

## 1. A ruling was reversed, and this records it

The fees-and-costs design of 2026-08-26 ruled, at length and with alternatives weighed, that **the
Fees tab is not a work-in-progress surface**. Its section 2.2 argued that fee value materializes as
invoice lines, that a fee store parallel to `time_entry`/`cost_entry` would be "a second home for
the same fact" and would drift from the arrangement, and that Fees should therefore be a projection:
the arrangement strip on top, the fee-kind invoice lines beneath, the unbilled figure in the footer.

That is no longer the design, and the reversal happened in two steps rather than one, which is why
it is easy to miss:

1. **The owner took the arrangement off the screen** (2026-09-03). "Move this into the matter
   status… remove from fee screen." The Fees screen states nothing about the arrangement — no
   strip, no View, no Amend, no summary in the details panel.
2. **That removed the projection's own justification.** Section 2.2's case rested on the pairing:
   the agreement as the cause, the billed lines as the effect. With the agreement gone to the
   status window, what section 2.2 leaves behind is the alternative it explicitly rejected as "too
   thin" — a pure invoice view, which shows nothing unbilled and so cannot answer the question a
   money section exists to answer.

The owner's own sentence settles what replaces it: fees are **recorded**. `fee-record.ts` states
the consequence precisely — a fee is a flat charge for professional services, typed by hand, its
own dated work-in-progress record riding the same chain as a time entry and a cost, claimed onto a
draft invoice exactly as either of those is. **Never computed from time entries**, never derived
from them: the amount is what somebody decided to charge.

**The drift section 2.2 feared is real and is answered by scope, not by absence.** A recorded fee
does not drift from the arrangement because it makes no claim about the arrangement. An hourly
matter's fee value is still the Time tab's, consolidated into a `fee` line at compose time; a
flat-fee arrangement's amount is still the arrangement's, composed by `flat-fee.ts`. What this
store holds is the third thing neither of those covers — the charge somebody typed, which today has
nowhere to live at all.

## 2. The record

`fee_entry`, per-firm, mirroring `cost_entry`'s shape wherever the fact is the same and differing
only where the domain does. A cost has a payee, a receipt and a hard/soft class; a fee has a
timekeeper and nothing else of its own.

| Column                                     | Why                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `feeEntry_` handle; a new kind in the identifier registry                                                                              |
| `matter_id`                                | Required. A fee is recovered from a file, like a cost                                                                                  |
| `fee_date`                                 | The date the charge is **for** — the anchor, exactly as `incurred_date` is                                                             |
| `timekeeper_user_id`                       | Whose professional services the charge is for. Not a foreign key, for the reason `created_by` is not: the fact outlives the membership |
| `description`                              | What the client reads on the bill                                                                                                      |
| `amount_minor`                             | Integer minor units. The flat charge exactly as typed, never computed                                                                  |
| `currency`                                 | Checked to `USD`, as every money column is today                                                                                       |
| `billable`                                 | 0/1. Absorbing is a decision the ledger keeps visible                                                                                  |
| `status`                                   | The `billing-core` chain: draft, submitted, approved, billed, void                                                                     |
| `kick_back_reason`                         | Set on kick-back, cleared on the next submission — the costs slice's rule, held to                                                     |
| `invoice_id`                               | The mirror set at finalization, so a billed fee names its bill without a join                                                          |
| `memo`                                     | For the firm alone. It never reaches a bill, a print sheet or the portal                                                               |
| `created_at` / `updated_at` / `created_by` | The provenance the costs slice found unserved and now serves                                                                           |

**Indexes, up front rather than when measured** — this is the "build when in the area" rule, and
both reads are already specified: `(matter_id, status)` for the matter's own section, and a leading
`(fee_date)` for the firm-wide span. `cost_entry` needed the second one retrofitted; `fee_entry`
takes it at birth.

**Deliberately absent.** No `entry_number` column: `FeeRecord.entryNumber` is nullable and the
matter-scoped entry number is an open gap across all three ledgers, not a fee problem to solve here.
No `provenance` columns: the cross-ledger move (`reclassify`) is designed and unbuilt on every
surface, and inventing its storage on one ledger would fix its shape before the move exists.

## 3. The package

`packages/fees`, mirroring `packages/costs` file for file: a service, its statements, its
validation. It rides **`@magna-carta/billing-core`'s lifecycle** — `assertTransition`, `isFrozen`,
`BillableStatus` — rather than restating the chain, which is what makes "the same chain as a time
entry and a cost" true in the type system rather than only in prose.

The one piece each domain package keeps for itself is its validation error class, so the HTTP layer
sees exactly one error type at the 422/409 boundary. `FeeValidationError` mirrors
`CostValidationError`, including the guarded transition wrapper that maps `billing-core`'s generic
`IllegalTransitionError` into the domain's own.

## 4. The routes

`apps/api-worker/src/http/routes/timekeeping/fees.ts`, taking the shape `costs.ts` arrived at:

- **One statement, three shapes.** The per-matter listing, the `from`/`to` firm-wide span, and the
  single-entry read share `LIST_COLUMNS` / `LIST_FROM` / `LIST_ORDER`. The costs route learned this
  the expensive way — its detail read was a hand-written column list that answered with fewer facts
  than the row it was opened from — and the fee route starts where that ended.
- **Names resolved beside the record, never a lookup per row**: the timekeeper's display name and
  the recorder's by `member` outer joins, the matter's number and title by an outer join on
  `matter`. All outer, so a record whose member or matter went missing reads back as itself.
- **Cursor-paged on `(fee_date, id)`**, the identifier as the tiebreak, because `created_at` is not
  a total order and a keyset cursor over a non-total order skips or repeats at a page boundary.
- **Gated by `billing:configure` for writes and `billing:read` for reads**, matching the fee
  surfaces' existing gates rather than minting a `fees:` namespace for one table.

## 5. The claim seam, and the one destructive migration

A fee that cannot reach a bill is not work in progress; it is a note. So the claim path is part of
this slice, not a follow-up.

The mechanism already generalizes: `WorkInProgressKind` is a union, `WORK_IN_PROGRESS_TABLES` is a
`Record` keyed by it, and `draft.ts` fetches and maps per kind. Adding `fee_entry` widens the union
and the compiler then names every site that must handle it. A claimed fee composes a **`flat_fee`**
line — no quantity, no rate, the amount as typed — which is the existing line kind whose meaning
already is "a flat amount rather than a computed one".

**The cost is a table rebuild, and it should be seen before it is agreed.** `invoice_wip_claim`
carries `CHECK (source_kind IN ('time_entry','cost_entry'))`, and SQLite cannot widen a `CHECK` in
place. Widening it means the create-copy-drop-rename dance, on a **financial table**, and the table
carries two triggers (`invoice_wip_claim_frozen_no_update`, `invoice_wip_claim_frozen_no_delete`)
that freeze a finalized invoice's claims and must be recreated with it. The billing design
anticipated exactly this shape of problem for `InvoiceApplicationKind` and answered it by naming
every kind up front; the claim table was not given that treatment, and this is the bill for it.

This is the one genuinely risky step in the slice — `main` is production, so the rebuild reaches
real data on merge. It wants: the rebuild in its own migration, the triggers recreated verbatim,
the foreign keys and the unique index preserved, and a test that a finalized invoice's claim is
still frozen afterwards.

## 6. What Fees shares with Costs rather than copies

The two surfaces were built to parallel each other, and the parallel has already produced one
duplication this repository paid for: `canWorkDraft` existed twice, byte-identical, on the matter
and firm cost surfaces, and its comment promised a rule the accepted design refuses. The fee
surfaces are the moment to hoist rather than the moment to copy a third time.

Moving to a shared home **before** the fee surfaces read them:

- **The recorder reading** (`recorderState`/`recorderText`) — who wrote a record down, in its three
  honest states, and the note explaining a departed member. Nothing in it is about a cost.
- **The returned-draft reason** (`returnedDraftReason`) — a draft that came back, read as a draft
  fact. Nothing in it is about a cost either.
- **`canWorkDraft`** — a draft is editable, everything past it is evidence. This is the chain's
  rule, and the chain is `billing-core`'s.
- **The gap-registry shape** — `cost-gaps.ts` and `fee-gaps.ts` are the same module written twice.
  The registry's _entries_ are per-ledger and stay so; its type, its two sentence-builders and the
  rule that an entry leaves the file when the field is served are one thing.

Staying separate, deliberately: the columns (a cost has a payee and an expense code, a fee has a
timekeeper), the record windows (different fields), and the figures (a cost's footer names absorbed
spending; a fee's names what is waiting to be billed). Sharing those would mean a component that
takes a discriminator and branches, which is two screens in one file rather than one screen reused.

## 7. What this deliberately does not do

**No fee is computed.** Nothing here reads a time entry, a rate or an arrangement. An hourly
matter's fee value remains the Time tab's and reaches a bill as a consolidated `fee` line at compose
time; a flat-fee arrangement's amount remains `flat-fee.ts`'s. A recorded fee is a third thing, and
keeping it a third thing is what stops the drift the 2026-08-26 design was right to fear.

**No arrangement.** The screen states nothing about it, per the owner's ruling. A fee is recorded
against whatever the status window says, and this store holds no version pointer, because a pointer
would be the first step back toward the surface the owner removed.

**No batch capture.** `costs.ts` has one because a cost grid import exists; nothing imports fees.

## 8. Gaps this design leaves open

1. **The matter-scoped entry number**, unserved on all three ledgers. `FeeRecord.entryNumber` stays
   nullable and the column states its gap.
2. **Attachments.** `FeeRecord.attachmentCount` stays null: there is no fee attachment table, and
   the picker the cost ledger waits on does not exist either.
3. **The cross-ledger move.** `FeeProvenance` is declared and unserved; `reclassify` is designed and
   unbuilt on every ledger. A fee that "began as a time entry" is a shape this store can hold when
   the move exists, not a thing it invents now.
4. **The firm's review setting** is still unserved, so the review vocabulary stays absent on Fees
   exactly as it is on Time and Costs — one matter must not show two different firms.
