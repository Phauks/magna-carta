# The firm's money surfaces — screen design

**Date:** 2026-09-07
**Status:** Built. `/billing` and `/costs` are live in `apps/web`, the two listing shapes behind them
are on the contract, and the matter's own registers are rewired onto the same reads.
**Scope:** The two firm-wide money screens and the consolidation between them and the matter's Money
sections — which reads serve both scopes, which components serve both, which acts belong to which
scope, and the seams that make a bill or a cost reachable from wherever a reader met it.
**Excludes:** batch and recurring billing (the billing-automations slice), the invoice renderer and
LEDES, payments, a firm-wide Trust or Fees surface, and any change to the billing or costs domain
beyond the two listing shapes and the two mirror columns named below.

**Binding inputs, in order of authority:**

- The billing domain design ([`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)) and its
  accepted owner flags — the invoice lifecycle, the claim mechanism, corrections, the trust
  boundary. Nothing here reopens any of them.
- The matter Billing tab's screen design
  ([`2026-08-27-matter-billing-tab-design.md`](2026-08-27-matter-billing-tab-design.md)), whose
  section 10 gap register named gaps 1 and 6 — the per-matter invoice listing and display names on
  billing reads. Both are closed here.
- The owner's standing direction that UI is built in the repository and reviewed on the deployed
  site (root `CLAUDE.md`, _How we work_) — these are real screens in `apps/web`, not mockups.
- The page archetypes ([`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md)) and the
  sidebar's destination registry, which decide what a Money row is and what a screen header says.
- The build register ([`../now.md`](../now.md)) — the authority on what is real.

## 1. The problem, stated once

Billing lived in three places and only two of them existed.

A matter's Billing section was fully built. The sidebar's Billing row was a **Soon stub** — and,
unlike Time's, for no structural reason: `GET /api/v1/billing/invoices` takes `clientEntityId` as an
_optional_ filter, so an unnarrowed call has always returned every invoice in the firm.
`GET /api/v1/billing/receivables/aging` was likewise shipped, implemented, and had **no consumer
anywhere** outside the generated client. The row was announced over a read that already worked.

Costs was worse: it had no sidebar row at all. The sidebar's Money group held Time, Billing and
Trust; the matter's Money group held Time, Fees, Costs, Billing and Trust. The two disagreed about
what Money holds, and the reason was structural — `GET /api/v1/costs` answered one matter entire and
returned an empty list for anything else, exactly the shape `GET /api/v1/time-entries` was in before
its own `from`/`to` span. There was no read a firm-wide screen could be built on.

And the matter's Billing section was not actually matter-scoped. It listed the **client's** invoices
and then read every one of their details to compute this matter's share of each — the client's
account under the matter's heading, at one request per bill, growing with the client's whole history
rather than with the matter's.

Nothing connected any of it. `/billing` appeared in exactly one file outside `lib/billing/` (the
destination registry). No bill was addressable. A billed cost could not reach the bill that billed
it, though `cost_entry.invoice_id` had existed since the baseline schema.

## 2. The two listing shapes

### 2.1 Costs gains a period

`GET /api/v1/costs` takes `from`/`to` — a span of incurred dates across every matter, narrowable to
one matter, one status, and to billable or not, cursor-paged on `(incurred_date, id)`.

**One statement, two shapes.** The per-matter listing and the span differ only in what they select
on and share every column, join and ordering. Two SELECTs would be two answers about what a cost row
carries, free to drift.

**Each row names its matter**, resolved in the same statement the vendor's name already was. A
firm-wide listing prints the matter on every row, and resolving it per row is a lookup per
disbursement to fill one column.

**No capability beyond `costs:track` gates the span.** The per-matter listing already answers for any
matter that permission names, so a span reveals nothing that iterating matters would not — a second
gate would be a lock on the front door of a building with no walls. Time's period listing is gated
because time is **personal**: whose hours those are is the fact `time:viewFirm` protects. A
disbursement is the firm's own money advanced for a matter, which is a different kind of record.
This is the one deliberate asymmetry between the two period reads, and it is recorded here so a
later reader does not "fix" it.

**An index, up front.** `cost_entry` had `(matter_id, status)` and `(status, incurred_date)`; neither
leads with the date, so an unnarrowed range walked the table. `cost_entry_incurred_date_index` is
the exact counterpart of the index `time_entry` took for its own span a day earlier.

### 2.2 Invoices gain a matter, and every row a name

`GET /api/v1/billing/invoices` takes `matterId`. It answers with the bills that charge that matter —
**drafts included** — and adds that matter's own share to every row.

**The predicate is over `invoice_line`, not over the balance row, and that is load-bearing.** An
`invoice_matter_balance` row is written at finalization and at no other time, so filtering on it
would silently drop every draft — and a draft is exactly the bill a matter's own register most needs
to see. A draft that charges this matter has a line the moment a claim composes one, which is the
fact the filter asks about. `invoice_line (matter_id, invoice_id)` is the index it rides, and that
index was laid down in the original billing migration for precisely this read.

**The share is three figures, not one**, because a draft and a finalized bill hold it in different
places and flattening that would state a figure the record does not have:

| Field                | Where it comes from                | On a draft |
| -------------------- | ---------------------------------- | ---------- |
| `matterLinesMinor`   | sum of that matter's invoice lines | present    |
| `matterTotalMinor`   | the matter's balance row           | **null**   |
| `matterAppliedMinor` | the matter's balance row           | **null**   |

A null there means "not owed yet". Zero would read as "settled", which is a different and wrong
fact.

**The client's name is resolved in the listing and in the detail**, by the same two outer joins the
cost listing uses for its vendor. Null both where no directory entry answers to the identifier and
where the entry behind one is gone — `clientEntityId` tells those two apart. Never the identifier
standing in for a name: a Client column printing `directoryOrganization_01J…` is unreadable, and
resolving it a row at a time is a lookup per bill.

The three narrowings compose. The unnarrowed call is the firm's whole register.

## 3. One component set, two scopes

The rule: **a component takes a matter or takes none**, and what changes between the two is stated
once in that component rather than by forking it.

| Component             | With a matter                          | Without one                                   |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| `bill-columns.ts`     | This Matter / Unpaid, this matter lead | Total / Unpaid lead; Client comes forward     |
| `invoice-window`      | states the matter and its share        | states how many matters, and the way into one |
| `invoice-print-sheet` | names the matter and its share         | names the client alone                        |
| `bill-actions.ts`     | every act offered on its own terms     | matter-anchored acts refused, naming the way  |
| `cost-columns.ts`     | Matter column hidden                   | Matter column brought forward                 |

**Both column pairs are declared in both scopes, with one of each hidden.** A column that exists on
one screen and not the other means a stored layout means two things; a hidden column means a member
who wants the document's total while standing in a matter turns it on from the same show-and-hide
control every other column uses. The hidden one is also **named for what it covers** inside a matter
— `Total (all matters)` — because it sits beside a column that does not, and the difference between
the two is exactly what a reader who turned it on is asking about.

**A wrong answer is worse than no answer.** Outside a matter the This Matter column reads null rather
than falling back to the document's total: there is no share to state, and the whole bill's total in
that column would read as one matter's charge.

## 4. Which acts belong to which scope

**The firm's register reads and does not act**, and every verb that writes says so rather than
disappearing: _"The firm's register reads bills; the acts against one live on the matter it charges.
Open the bill there."_

Two reasons converge on the same answer. Applying a client's trust funds, writing off a balance and
recording a credit note each move **one matter's** money against one matter's account, and have no
meaning without one. Finalizing, voiding and recording a delivery simply live where the work does —
on the matter whose work the bill claims, which is also where the reader doing it is standing.

An act that disappears between screens teaches a reader that the menu has a mind of its own; an act
that says where it lives teaches them the product. And an act left **enabled** on a screen with no
dialog behind it is worse than either — a control that does nothing when pressed. This follows the
bill actions' own existing rule that a refused verb stays rendered with its reason, extended to a
third kind of refusal (a **scope** refusal, beside the state and permission refusals it already
carried).

Raising a bill likewise starts on the matter it charges, where the work it claims lives; there is no
create control here.

## 5. What the firm's register states about itself

The **receivables aging** sits above the table, not in the footer figures. It is not a summary of the
rows on screen: it is computed server-side over every finalized bill, including the ones past the
loaded page. A figure in the footer strip beside two that **do** narrow with the table would invite a
reader to add three numbers from three different scopes.

That is also why the aging is read from the server rather than summed here — the one receivables
number a partner acts on must not grow as they scroll — and why the caveat line beneath a partly
loaded register says the _column totals_ cover only what is loaded while the _outstanding_ figure
above does not.

The aging's failure is its own: the bills below are still true without it, so it degrades to a
warning and the strip is absent, never a failed screen.

## 6. The seams

Four surfaces held the same money and nothing connected them.

1. **A record names the bill that took it up.** `cost_entry.invoice_id` reaches the wire, and the
   row menu's **Open The Bill** lands on the matter's Billing section with that bill open. The verb
   renders on every record, refused where nothing has billed it, for the reason in section 4.

   It lives in the SHARED ledger catalogue rather than on the cost menu, because time asks the same
   question of the same kind of row: `time_entry.invoice_id` had been on the entry contract since it
   was written and nothing on the time surfaces read it, so the gap there was never the wire — it
   was a verb nobody had built. Two menus answering one question would be two chances to word the
   refusal differently. A ledger declares `opensTheBill` when it has somewhere to send a reader,
   which Time and Costs do and Fees does not.

2. **A bill is addressable.** `?invoice=` opens the named bill on the matter's register and on the
   firm's. This is what makes a bill linkable rather than describable, and what gives the cost's seam
   somewhere to land.
3. **A bill met across the firm finds its matter.** Where it charges one, the window offers the way
   in. Where it charges several it **says so and says what that waits on**: the invoice read carries
   matter identifiers and no names, and a list of links labelled by handle asks a reader to choose
   between strings they cannot read.
4. **Each matter money section knows its firm-wide sibling.** The money toolbar's row of siblings
   ends with the way out, past a rule so it never reads as a sixth section. The destination and its
   words come from the sidebar's own registry, so the rail and the toolbar cannot call one place two
   things — and a section whose firm-wide surface is not shipped renders nothing rather than a link
   to a Soon page.

## 7. What the screens deliberately do not have

**No free-text search on either.** Both screens page a record larger than what is loaded, and a
search box that quietly covered only the loaded page would tell a reader their word appears nowhere
in a month it never looked at. The columns' own filters are the search, and they say how many rows
they left out. This is the period ledger's own established rule, held to.

**A create control on Costs, and none on Billing.** The standing ruling is that a screen with no way
to create the thing it lists is not built, and `/costs` honours it the way `/time` already does: the
record window takes the firm's matters and its first field is the matter picker, unfilled, because a
cost filed against the wrong matter is what somebody stops trusting a ledger over.

`/billing` is the deliberate exception, and the reason is not that a bill is matter-anchored — it is
that a bill is not a form. A draft is opened and then _composed_, by claiming the matter's own
unbilled time, fees and costs onto it through the claim workbench, which is the matter's work and is
on the matter's screen. A create control here would open an empty draft on a screen that cannot then
fill it, which is a worse answer than sending somebody to where the work is.

**No client control in the billing header.** The Client column's own filter is the same machinery
every other column uses and says what it left out; a second client control would be a second answer
to one question. Only the **status** rides the header, because status is what the _server_ narrows —
choosing one changes what is read rather than what is shown.

## 8. Gaps this design leaves open

1. **The invoice read carries matter identifiers and no names.** It is what stops a bill that charges
   several matters offering the way into each of them (section 6.3).
2. **Application history, attribution and events** remain unserved — gaps 2 and 3 of the matter
   Billing tab design — so the window's Payments & Credits and History rails still say what they wait
   on.
3. **Approving a submitted cost across matters** is not offered on the firm's period; approval stays
   on the matter's own section.
4. **The recorder of a cost** is not on the record, so Entered By states its gap on both screens.
5. **Trust and Fees have no firm-wide surface.** Trust's row stays announced; a fee is not its own
   record yet. The money toolbar's way out is absent on both rather than pointing at a Soon page.
