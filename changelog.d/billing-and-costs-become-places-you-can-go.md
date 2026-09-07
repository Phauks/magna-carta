---
category: Added
audience: public
---

**`/billing` and `/costs` — the firm's own money surfaces, and one component set behind both scopes.**

Billing's sidebar row was a Soon stub over a read that already worked: `GET /api/v1/billing/invoices` takes `clientEntityId` as an _optional_ filter, so an unnarrowed call has always answered for the whole firm, and `GET /api/v1/billing/receivables/aging` was a shipped route with no consumer anywhere outside the generated client. Costs was worse — no row at all, because `GET /api/v1/costs` answered one matter entire and returned an empty list for anything else, exactly the shape the time listing was in before its own span. It gains `from`/`to` across every matter, cursor-paged over the same statement the per-matter shape walks, with each row's matter and vendor resolved in that statement rather than a lookup per disbursement, over a new leading-date index (`cost_entry_incurred_date_index`) — the counterpart of the one `time_entry` took a day earlier. The span is gated by `costs:track` alone and not by a second capability: the per-matter listing already answers for any matter that permission names, so a span reveals nothing iterating matters would not. Time's is gated because time is personal; a disbursement is the firm's own money.

Two gaps from the matter Billing tab's screen design close with them. The invoice listing takes a **matter** — predicate over `invoice_line` rather than the balance row, because a balance row exists only after finalization and filtering on it would drop every draft — and carries that matter's share as three figures, since a draft's share is its lines and a finalized bill's is its balance, and null there means "not owed yet" rather than zero. And the **client's name** is resolved in the listing and the detail. The matter's register had been listing the CLIENT's whole billing history and then reading every one of those bills' details to work out this matter's share: the client's account under the matter's heading, at a request per bill.

`bill-columns.ts`, `invoice-window.svelte`, `invoice-print-sheet.ts` and `bill-actions.ts` now take a matter or take none; the cost columns gain a Matter column hidden inside a matter and brought forward across the firm. Both money-column pairs are declared in both scopes with one of each hidden, so a stored layout means the same thing on both screens. The matter-anchored acts are refused on the firm's register with a scope refusal — a third kind beside the state and permission refusals the verb set already carried.

Seams: `cost_entry.invoice_id` reaches the wire, and one **Open The Bill** verb in the shared ledger catalogue (`opensTheBill`, on the terms `reclassify` and `canRestoreVoid` already follow) lands a billed cost OR time entry on the matter's Billing section with that bill open — `time_entry.invoice_id` had been on the entry contract since it was written and nothing on the time surfaces read it, so that gap was a verb rather than a read; `?invoice=` opens a named bill on either register; the money toolbar's sibling row ends with the way out to the firm-wide twin, read from the sidebar's own registry so the two cannot call one place two things. Design: [`docs/specs/2026-09-07-firm-money-surfaces-design.md`](../docs/specs/2026-09-07-firm-money-surfaces-design.md). The invoice detail resolves each matter's number and title beside every line AND every balance — the lines because a draft has no balance rows, so reading the balances alone would say a draft charges nobody — and the window offers one link per matter.

A cost's own record answers with what `cost_entry` already held. `created_at` and `created_by` were
in the table from the baseline schema and were never projected, so Date Entered and Entered By said
"not served" about facts the firm's database was holding; both reach the wire now, with the
recorder's name resolved by a `member` outer join in the same statement the vendor's and the
matter's already were — outer, and `created_by` deliberately not a foreign key, because who wrote a
disbursement down has to survive that person leaving. It is **not** a permission fact: the costs
design rules that a cost belongs to the matter and not to its recorder, so no read or write on a
cost is scoped per person. The two surfaces had been carrying byte-identical copies of
`canWorkDraft` whose comment promised a recorder gate that ruling refuses; they now share one
function that states the real rule — a draft is editable, and everything past it is evidence.

`GET /api/v1/costs/{id}` stopped being a third shape: it was a hand-written column list that
resolved none of the three names, so opening a cost answered with less than the row it was opened
from. And `invoiceId`, which this same change put on the wire, is now read where it is served — the
details panel, the record window and the print sheet each still said "not served" over it. The
address they open goes through one `billHref` in the money surface, which three files had been
spelling by hand and one of them without encoding the identifier.

## Public

Billing and Costs are places you can go. **Billing** in the sidebar is every bill the firm has raised, for every client, with what is still owed and how far past due it is over the table. **Costs** is what the firm advanced across every matter for the days you choose — what is still waiting on a bill, and what the firm decided to absorb.

Neither question could be asked before. A matter's own sections answer for one file, and no amount of visiting matters one at a time adds up to what the firm is owed or what it laid out last month.

**A matter's Billing section now shows the matter's bills, not the client's.** It listed every bill the client had ever been given and then worked out this matter's share of each one, which stated the client's account under the matter's heading. It reads its own bills now: the ones that charge this matter, drafts included, each showing this matter's share. The whole document's total is still there as a column you can turn on, named "Total (all matters)" so the two are never confused.

**A billed cost or time entry names the bill that billed it.** Right-click one and choose "Open The Bill" to see what the client was actually told. An open bill is in the address too, so you can send somebody the bill rather than a register and instructions. A billed cost offers the same way through from its own record and from the details panel beside the list, and its printed sheet carries the bill's reference.

**A cost says who recorded it and when.** Entered By and Date Entered carry values on both cost screens now; they start hidden, because they answer a question about the record rather than about the money, and a reader who wants them turns them on. Date Entered is when the cost was written down, which is not the day the money went out — a disbursement captured three weeks late is a different record from one captured the day it was paid. Entered By is who to ask when a figure looks wrong, never a lock: a cost belongs to the matter it was advanced for, not to whoever typed it. A cost recorded by somebody who has since left the firm says so rather than showing an internal identifier.

**Each matter money section knows its firm-wide twin.** The row across the top of Time, Costs and Billing ends with the way out to the same money at the firm's scale.

Applying trust funds, writing off a balance and recording a credit note stay a matter's acts — they move one matter's money. The firm's register shows them and says where they live rather than hiding them.
