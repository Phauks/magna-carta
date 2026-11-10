# Matter Billing tab — screen design

**Date:** 2026-08-27
**Status:** Screen design proposed; review surface built as a mockup. The billing **domain** is not
designed here — it was designed, decided, and largely built elsewhere, and this document designs the
screen against those records without reopening any of them.
**Scope:** The Billing tab on the matter detail screen — the fourth member of the Time / Costs / Fees
family and the surface the other three seam into. The invoice list as the tab's spine, the details
panel for one invoice, the draft view where time, costs and fees converge onto a bill, the trust
application, the correction paths, and what every affordance honestly is against the built API.
**Excludes:** firm-level billing surfaces (aging across matters, batch runs, the automations
surfaces named in the billing-automations design), billing configuration screens (account-role map,
tax rates, numbering scheme, render shape default), the client portal, and any change to the billing
domain or its API beyond the gap register in section 10.

**Binding inputs, in order of authority:**

- The billing domain design ([`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)) and its
  accepted owner flags B1–B14 — the invoice lifecycle, the claim mechanism, corrections, the trust
  boundary. The screen renders this model; it never softens it.
- The corrections model as written for users
  ([`../user/features/correcting-a-bill.md`](../user/features/correcting-a-bill.md)) — the screen's
  correction language matches it sentence for sentence where a sentence is shown.
- The payments design ([`2026-08-15-payments-design.md`](2026-08-15-payments-design.md)) — designed,
  unbuilt; decides what "Record Payment" honestly is today.
- The billing-automations design
  ([`2026-08-16-billing-automations-design.md`](2026-08-16-billing-automations-design.md)) —
  designed, unbuilt; decides what reminders and payment plans honestly are today.
- The owner's standing rulings on the sibling surfaces:
  [`../conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md) (the one-table
  machinery, one chip per row, the details-panel pattern, the visible editing chain, footer
  summation, typable comboboxes) and the generalized rulings in
  [`../conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) (Lucide-only,
  no inert controls, Soon badges naming their dependency, names never "You", never "Just now",
  filters inside the column header, dialogs capped at the viewport, N22c selection-presents-details).
- The build register ([`../now.md`](../now.md)) — the authority on what is real; every Soon badge
  in this design names a register node or an owner flag.
- The owner's standing direction: **per-matter invoice pages** — the render shape
  `per_matter_pages` already shipped in `packages/billing/src/types.ts`, and the per-matter framing
  of this tab follows the same direction.

---

## 1. What the tab is, in one paragraph

**The Billing tab is where a matter's work becomes a bill and where what happened to that bill is
readable forever.** Its spine is the invoice list — every invoice that bills this matter, newest
first, on the same table machinery as the Docket, Time and Costs (no third variant). One row is one
invoice; selecting it presents the invoice in a details panel beside the list (N22c), with its
lines, its per-matter balance, everything ever applied to it, every recorded delivery, and every
correction standing beside it. A draft is a workbench: the panel shows the unbilled time, costs and
fees it can claim and the lines it has composed. A finalized invoice is evidence: the panel says so,
says why it is locked, and offers only the acts the model permits — deliver, apply trust funds,
record a payment (Soon), credit, write off, reverse a misapplied application. Nothing on this screen
can edit, un-finalize, or delete a finalized bill, and the screen never pretends otherwise.

## 2. The spine: the invoice list

### 2.1 Which invoices appear

Every invoice with an `invoice_line` naming this matter — drafts included. An invoice belongs to a
client and may bill several of that client's matters (billing design, B4); on **this matter's** tab
such an invoice still appears, carrying **this matter's share** (its `invoice_matter_balance` row)
in the money columns, with the whole bill readable in the details panel. This is the per-matter
page the owner directed, applied to the tab as well as to the rendered document.

The built listing cannot serve this yet — `GET /api/v1/billing/invoices` filters by client and
status only. Gap 1 in section 10; the design index (`invoice_line (matter_id, invoice_id)`) exists
for exactly this read.

### 2.2 Columns

Defaults on: **Invoice** (the drawn number, `00413`; a draft shows "Draft" in the muted style — it
has no number and the screen never invents one) · **Status** (the one chip, 2.3) · **Issued** ·
**Due** (overdue derived at read: the date renders danger with "· N days" when past-due and unpaid;
never a stored flag) · **This Matter** (the matter's share: total) · **Unpaid** (the matter's
`total − applied`) · **Delivered** (2.4). Off by default: **Client** · **Total (all matters)** ·
**Credited** (sum of credit notes against it; dash when none) · **Created**. Voided drafts render
struck in the danger-muted treatment, excluded from every total, exactly as voided time entries do.

Column headers carry the shared filter-in-header machinery, sort, reorder, pin and resize — the
Docket's machinery, shared exactly (the time tab's one-table ruling binds here; this surface adds
no variant). The totals row pins under the list and is scope-honest: matter totals unfiltered,
"In view:" totals when a filter is in play, voids never counted.

### 2.3 The one chip: a derived standing, honestly labelled

The stored lifecycle is three states — `draft`, `final`, `void` — and **"sent" is deliberately not
one of them** (billing design 3.1). The chip therefore renders the invoice's **standing**, derived
exactly the way the API derives it, and delivery renders in its own column (2.4), never as a chip:

| Chip               | Derivation                                  | Treatment                 |
| ------------------ | ------------------------------------------- | ------------------------- |
| **Draft**          | `status = draft`                            | quiet neutral             |
| **Unpaid**         | `status = final`, `applied = 0`             | amber (the money is owed) |
| **Partially paid** | `status = final`, `0 < applied < total`     | info-blue                 |
| **Paid**           | `status = final`, `applied = total`         | green                     |
| **Void**           | `status = void` (reachable from draft only) | danger-muted, row struck  |

One chip per row — the time tab's TS2 generalized: the chip is standing, and everything else
(delivery, corrections, overdue) renders through its own column or the panel, never a second chip.

**"Corrected by credit note" is not a chip.** A credit note does not change the invoice's state —
it stands beside the bill and moves what is owed. It renders as the **Credited** column and, on any
row with a credit note, a small Lucide marker beside the chip whose hover names it ("Corrected by
credit note · $1,200.00 · Mar 12"); the panel carries the full record. A fully-credited bill
therefore reads **Paid** with its credit visible — which is the true story: value reached the bill,
part of it as a correction. Owner decision V1 confirms this register.

### 2.4 Delivered is a record, not a state

The **Delivered** column reads the shipped delivery-state summary: the date first delivered
("Jul 12"), "Failed · 2 attempts" when every attempt failed, or "None recorded" muted when there is
none. The hover is scope-honest: "The platform records deliveries the firm made; it does not send
bills." A draft shows a dash — only a finalized bill can be delivered.

### 2.5 The toolbar

On the tabs row, the shared composition: **Draft Bill** (primary; opens the draft dialog, 4.1), the
clear-filters control (present only while a filter is in play), the column chooser, and the details
toggle. No reset-to-defaults control (TL9). No "Send" button anywhere — the platform transmits
nothing; the affordance is **Record Delivery** (5.4).

## 3. The footer: the unbilled story, and where the seams land

The page footer carries what no column carries, as legible labelled figures:

- **Unbilled** — the matter's unbilled work-in-progress (time + costs, from the shipped
  `/unbilled` read), with the hover breaking it down ("14 time entries · $6,180.00, 6 costs ·
  $842.50 — work no draft holds and no invoice has billed").
- **On drafts** — the sum claimed by open drafts (derived from draft claims; gap 4).
- **Outstanding** — what the matter still owes across its finalized invoices (the receivable half
  of the same read).
- Counts and the filtered note on the left, per the Docket's conventions.

**The chain seams from the other three tabs land here.** The Time tab's unbilled figure and a
billed entry's "Open in Billing" (TV2), the Costs tab's equivalents, and the Fees surface's
arrangement seam all resolve to this tab: the unbilled seams land on this tab with the Draft Bill
flow in reach; "Open in Billing" on a billed entry lands with **that entry's invoice selected and
the details panel open**. The reverse linkage holds too: a line in the details panel names its
source entries, and its context action is "Open in Time" / "Open in Costs" (Soon only where the
sibling listing cannot yet be addressed by entry).

## 4. The draft: where time, costs and fees converge

### 4.1 Opening a draft

**Draft Bill** opens a capped dialog: the client (resolved from the matter's client party and shown,
never chosen here — one client per invoice is the model's rule, and the matter names the client),
issue date, due date, and the billing period. It saves an empty draft (`POST /billing/invoices`) and
selects it, with the panel in the draft view. The footer of the dialog says what a draft is: "A
draft is a working document. Nothing is asserted to anybody until it is finalized."

### 4.2 The draft view: claims by source

The draft's details panel shows the convergence the family exists for — three groups under one
running total:

- **Time** — each claimed entry: date, timekeeper, hours × rate, the composed line amount.
- **Costs** — each claimed entry: date, description, amount, hard/soft marked.
- **Fees** — arrangement-driven lines: a flat-fee line carrying the arrangement's amount (its
  claims on contributing time entries ride at zero, exactly as the model composes them), a
  contingency fee where a recovery is recorded (`POST /invoices/{id}/contingency-fee`).

Beneath them, **Unbilled on this matter**: what the draft could still claim, with per-group "Claim
all" and per-entry claiming (`POST /invoices/{id}/claims`). An entry another draft holds is refused
by the API and the refusal is surfaced by name — the screen does not pre-hide contested entries,
because the claim index, not a read, is the guarantee. The claim ceiling (400 per invoice) is
stated when approached, with the API's own suggestion: a shorter period or a split bill.

### 4.3 Bill review edits the line, never the entry

A claimed line is editable in place — wording, quantity, rate, amount (`PATCH .../lines/{lineId}`).
The edit caption states the settled rule (B13): the entry stays the timekeeper's contemporaneous
record; the line is what the client is told. Removing a line releases its claim
(`POST .../claims/{claimId}/release`) and the entry returns to unbilled — the released claim row
remains, so the history stays answerable.

A draft's total is computed from its lines and labelled as computed — a draft has no balance rows
and no stored total, and the list's money columns for a draft say so on hover.

### 4.4 Void and finalize

**Void Draft** releases everything and keeps the record; the confirm states it ("Only a draft can
be voided — a finalized bill is corrected by a credit note, never erased").

**Finalize** is the tab's one irreversible act and its dialog says exactly what the one atomic
write does, in the API's own words: the next number in sequence is drawn, every claimed entry locks
as billed, the per-matter balances are created with the ceiling that makes over-application
impossible, and the receivable posts — or none of it happens. The render shape (one flowing
document / one page per matter, the firm default shown, overridable per bill) rides the dialog for
a multi-matter bill. The two named refusals are surfaced as the API states them: an unmapped
account role ("The firm has not said which ledger account plays _fee income_ — set it in billing
configuration"), and a claim contested at commit. Finalize is permission-gated (`billing:finalize`)
separately from drafting, and the button states who may, not just that you may not.

## 5. The details panel for an invoice (N22c)

Selecting a row presents the invoice beside the list; the reader stays in the list; explicit close.
Sections, top to bottom:

1. **Identity** — the number (or "Draft"), the client, the chip, the matters it bills with each
   one's share, issue and due dates, currency. People are named with the initials-avatar-plus-name
   treatment; a former member's name is history and always renders (TK1 generalized).
2. **The chain, visible** (TS3 generalized) — a stepper: **Draft → Finalized → Paid**, with the
   lock note under it. Finalized: "This bill is an evidentiary record. It is never edited or
   un-finalized; a correction is a credit note recorded beside it." Delivery deliberately does
   **not** appear as a chain step — it is a record, shown in section 6 of the panel — and the
   apply-funds affordance carries the delivery fact beside it (5.5).
3. **Lines** — presentation order, matter-tagged on a multi-matter bill, each naming its source
   entries where claims link (gap 4).
4. **Balance** — per matter: total, applied, unpaid; the invoice-level figures as the sum. On this
   matter's tab the matter's own row leads.
5. **Applied to this bill** — the application history, append-only, newest last: kind (trust
   transfer, payment (Soon), credit note, client credit, write-off), amount, effective date, who
   applied it, and reversal linkage rendered as the pair ("reversed by —" / "reverses —"). Needs
   the application-history read (gap 2).
6. **Delivery** — every recorded attempt: channel, recipient, date, outcome; "None recorded" is a
   stated fact, prominent on a finalized unpaid bill. **Record Delivery** opens the capped dialog
   (channel from the shipped closed set — the client-portal channel is not offered while nothing
   can produce it; recipient; date; outcome, including _failed_, because a history that can only
   hold successes reads as complete when it is not).
7. **Corrections** — every credit note beside the bill: date, reason (the firm's own words,
   rendered in full), lines, where its value landed (against the unpaid balance, and the excess as
   an opened client credit, named and linked). Credit notes carry no number today — the owner's
   numbering decision is open — and the panel shows them dated, not numbered, until it is decided.
8. **History** — the event rail: created, finalized (with actor), each application, each delivery,
   each credit note, each reversal, oldest first. Composable today from the reads above; a single
   event read is gap 3's second half.

### 5.1 Actions per state — each honest about the API

| State              | Actions offered                                                                                                         | Reality                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Draft              | Claim work · Edit line · Release claim · Void Draft · **Finalize**                                                      | All built                                                                                                    |
| Final (any)        | Record Delivery · **Apply Trust Funds** · Record Payment · Credit Note · Write Off · Print / PDF · Export LEDES         | Delivery, trust application, credit note, write-off built. Payment **Soon** (K1). Print/LEDES **Soon** (5.6) |
| Final, mis-applied | Reverse an application (from the application row, with the reason)                                                      | Built; a trust transfer and a credit note refuse by name, and the refusal sentence renders as the API says   |
| Paid in full       | The applying actions retire (the balance CHECK would refuse them); Credit Note stays — its excess opens a client credit | Built                                                                                                        |
| Void               | Nothing but the record                                                                                                  | —                                                                                                            |

No inert controls: an unbuilt action is a Soon badge whose hover names the register node or flag it
waits on, or it is absent. A built action a permission denies renders disabled with the permission
named.

### 5.2 Apply Trust Funds

The panel's apply affordance opens the flow the shipped authorization posture defines: a member who
holds the trust authority for the amount applies in one act; anybody else submits a request that
lands pending with who-can-release named (`POST /billing/trust-application-requests`, the shared
queue with trust's disbursement requests). The dialog shows the client's available trust balance
for this matter, the invoice's unpaid share for this matter as the ceiling, and — prominently,
never as a gate — the delivery fact: "No delivery of this bill has been recorded" (B2: finalization
gates; the firm proceeds knowingly). Partial application is the ordinary case and the dialog says
the remainder stays owed.

### 5.3 Record Payment (Soon)

A cheque, wire, cash, or card arriving cannot be recorded today: every payment rail including the
manual receipt is designed and unbuilt, and the application composer refuses the kind by name. The
affordance renders Soon, hover: "Waits on payments — the manually recorded receipt is its first
slice (flag K1)." It is kept visible because the family's story is incomplete without it and the
owner has a decision pending that would make it real first.

### 5.4 Corrections

The three correction acts render with the user documentation's own distinctions — a credit note
says the charge was wrong; a write-off says the charge was right and the money is not coming; a
reversal says the value landed in the wrong place. The credit-note dialog: reason in the firm's own
words, lines each naming matter and optionally the specific charge credited (the contingency
arithmetic needs the attribution and the dialog says so), and the landing rule stated before issue:
"What the bill can no longer absorb becomes a recorded credit the firm owes back." An opened client
credit links from the credit note that opened it, shows its remaining balance, and offers the one
act the platform performs — set it against a later bill of the same client — with the two
money-moving exits (refund from operating, return to trust) named as recorded-elsewhere, exactly as
the API describes them.

### 5.5 Print, PDF, LEDES (Soon)

The render model (pages under the finalized shape — per-matter pages or combined) is a shipped
read, but no renderer consumes it: there is no invoice PDF, and the Location letterhead node is
not started. Print/PDF renders Soon naming both. LEDES export: the e-billing flag shipped;
guideline validation and the export path are not started; Soon naming the LEDES nodes.

## 6. Reminders, plans, automations — surfaced honestly, later

The billing-automations design defers its surfaces and this tab does not build them. It reserves
two facts the automations design says a surface owes the reader, rendered when those slices land:
"No reminder schedule is configured, so no reminder will be raised for this bill", and a payment
plan's derived standing. Until then the tab carries nothing — a blank is worse than nothing only
when it pretends to be coverage, and nothing here pretends.

## 7. Empty, loading, error

The shared state panes: an empty tab states the two-sided truth ("No invoices yet — $7,022.50 of
unbilled work is ready to bill") with Draft Bill in reach; loading is the shimmer rows; error is
the standard pane with the Error ID. A firm without the account-role map configured can still
draft — the refusal belongs to finalize and is delivered there, by name.

## 8. What is real vs Soon (from the build register)

**Real (shipped, `financial.billing.*` / `financial.trust.*`):** draft compose, claims, release,
line edit, void; finalize with numbering, snapshots, WIP→A/R posting and locking; the trust
application including the request/approval posture; credit notes and their lines; client credits
and applying them to later bills; write-offs; application reversals; the delivery record and its
history; the unbilled and receivable reads; aging; arrangements (all four fee models); recoveries
and the contingency residual; the render model and render-shape setting.

**Soon (designed or not started):** every payment kind including the manual receipt
(`payments.*`, 0% shipped — flags K1/K7); the invoice PDF artifact and letterhead
(`financial.billing.location-letterhead`, renderer absent); LEDES guideline validation and
submission; computed tax (`financial.billing.invoice-composition` note); reminders, payment plans,
recurring and batch generation (`financial.billing.automations`, designed — flags M1–M3); the
client portal channel.

## 9. Screen decisions for the owner

New letter series **V** (the billing screen), so an answer here is never mistaken for a billing
(B), payments (K), or automations (M) answer.

| Flag   | Decision                                                                                                                                                    | Recommended                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **V1** | The chip register: Draft / Unpaid / Partially paid / Paid / Void, with corrections as the Credited column plus marker — never a chip, never a "Sent" status | As designed (2.3)                                                |
| **V2** | Delivered as a default-on column reading the delivery record                                                                                                | Yes (2.4)                                                        |
| **V3** | A multi-matter bill on this tab leads with this matter's share; the whole bill lives in the panel                                                           | Yes (2.1)                                                        |
| **V4** | Column defaults (2.2) — confirm or correct                                                                                                                  | As listed                                                        |
| **V5** | Overdue: the due date renders danger with the day count, derived at read — no stored flag, no chip                                                          | Yes                                                              |
| **V6** | Record Payment stays visible as Soon rather than absent, pending K1                                                                                         | Visible-Soon — the family's story is incomplete without it       |
| **V7** | "Open in Billing" from a billed time/cost entry lands on this tab with the invoice selected                                                                 | Yes (3)                                                          |
| **V8** | Credit notes render dated and unnumbered until the credit-note numbering decision is made                                                                   | Yes (5.7)                                                        |
| **V9** | The draft view lives in the details panel (list stays in reach) rather than a full-screen composer                                                          | Panel — N22c generalized; revisit only if real drafts outgrow it |

## 10. API gaps, consolidated

In rough priority order for this screen; nothing here changes the domain.

1. **Per-matter invoice listing.** `GET /billing/invoices` filters by client and status only; this
   tab needs "invoices billing matter M" (the design's own index, `invoice_line (matter_id,
   invoice_id)`, exists for it). Include per-row: this matter's balance figures.
2. **Application history read.** No read serves an invoice's `invoice_application` rows (kind,
   amount, effective date, applied-by, reversal linkage). The panel's "Applied to this bill" and
   the reversal affordance both need it.
3. **Attribution and events.** The invoice reads serve no `finalized_by` / `finalized_at` /
   created-by; no read serves the invoice's event history for the panel's History rail.
4. **Draft claims read.** Claims are write-only today; the draft view needs which entries a draft
   holds (source kind/id, line linkage, claimed amounts) and the footer needs "on drafts" sums.
5. **Unbilled entries listing.** `/matters/{id}/unbilled` serves counts and sums; the claim picker
   needs the candidate entries themselves (or an unbilled filter on the time/cost listings, which
   would also serve their tabs' seams).
6. **Display names on billing reads.** `clientEntityId` and `matterId` come back raw; the list and
   panel need display names without N+1 lookups.
7. **Manual payment receipt** — the K1 slice; until it lands, Record Payment is Soon.
8. **Invoice artifact** — a renderer over the shipped render model, and the letterhead snapshot
   node; until then Print/PDF is Soon.
9. **Credit-note numbering** — blocked on the open owner decision, surfaced by V8.
10. **Entry-addressable sibling deep links** — "Open in Time / Costs" from a line's source entry
    needs the sibling tabs' listings addressable by entry id (the Time tab records the mirror gap).
