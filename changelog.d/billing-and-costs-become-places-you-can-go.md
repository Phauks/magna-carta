---
category: Added
audience: public
---

**`/billing` and `/costs` — the firm's own money surfaces, and one component set behind both scopes.**

Billing's sidebar row was a Soon stub over a read that already worked: `GET /api/v1/billing/invoices` takes `clientEntityId` as an _optional_ filter, so an unnarrowed call has always answered for the whole firm, and `GET /api/v1/billing/receivables/aging` was a shipped route with no consumer anywhere outside the generated client. Costs was worse — no row at all, because `GET /api/v1/costs` answered one matter entire and returned an empty list for anything else, exactly the shape the time listing was in before its own span. It gains `from`/`to` across every matter, cursor-paged over the same statement the per-matter shape walks, with each row's matter and vendor resolved in that statement rather than a lookup per disbursement, over a new leading-date index (`cost_entry_incurred_date_index`) — the counterpart of the one `time_entry` took a day earlier. The span is gated by `costs:track` alone and not by a second capability: the per-matter listing already answers for any matter that permission names, so a span reveals nothing iterating matters would not. Time's is gated because time is personal; a disbursement is the firm's own money.

Two gaps from the matter Billing tab's screen design close with them. The invoice listing takes a **matter** — predicate over `invoice_line` rather than the balance row, because a balance row exists only after finalization and filtering on it would drop every draft — and carries that matter's share as three figures, since a draft's share is its lines and a finalized bill's is its balance, and null there means "not owed yet" rather than zero. And the **client's name** is resolved in the listing and the detail. The matter's register had been listing the CLIENT's whole billing history and then reading every one of those bills' details to work out this matter's share: the client's account under the matter's heading, at a request per bill.

`bill-columns.ts`, `invoice-window.svelte`, `invoice-print-sheet.ts` and `bill-actions.ts` now take a matter or take none; the cost columns gain a Matter column hidden inside a matter and brought forward across the firm. Both money-column pairs are declared in both scopes with one of each hidden, so a stored layout means the same thing on both screens. The matter-anchored acts are refused on the firm's register with a scope refusal — a third kind beside the state and permission refusals the verb set already carried.

Seams: `cost_entry.invoice_id` reaches the wire and the row menu's Open The Bill lands on the matter's Billing section with that bill open; `?invoice=` opens a named bill on either register; the money toolbar's sibling row ends with the way out to the firm-wide twin, read from the sidebar's own registry so the two cannot call one place two things. Design: [`docs/specs/2026-09-07-firm-money-surfaces-design.md`](../docs/specs/2026-09-07-firm-money-surfaces-design.md). Left open, symmetric and deliberate: `time_entry.invoice_id` is the same column and still does not reach the wire.

## Public

Billing and Costs are places you can go. **Billing** in the sidebar is every bill the firm has raised, for every client, with what is still owed and how far past due it is over the table. **Costs** is what the firm advanced across every matter for the days you choose — what is still waiting on a bill, and what the firm decided to absorb.

Neither question could be asked before. A matter's own sections answer for one file, and no amount of visiting matters one at a time adds up to what the firm is owed or what it laid out last month.

**A matter's Billing section now shows the matter's bills, not the client's.** It listed every bill the client had ever been given and then worked out this matter's share of each one, which stated the client's account under the matter's heading. It reads its own bills now: the ones that charge this matter, drafts included, each showing this matter's share. The whole document's total is still there as a column you can turn on, named "Total (all matters)" so the two are never confused.

**A billed cost names the bill that billed it.** Right-click a cost and choose "Open The Bill" to see what the client was actually told. An open bill is in the address too, so you can send somebody the bill rather than a register and instructions.

**Each matter money section knows its firm-wide twin.** The row across the top of Time, Costs and Billing ends with the way out to the same money at the firm's scale.

Applying trust funds, writing off a balance and recording a credit note stay a matter's acts — they move one matter's money. The firm's register shows them and says where they live rather than hiding them.
