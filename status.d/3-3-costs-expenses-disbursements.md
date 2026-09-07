---
slice: 3·3 — Costs & expenses (disbursements)
group: phase-3
order: 3
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: in-progress by="Opus 5"
load-profile: done by="Opus 4.8"
tested: done by="Opus 4.8"
branch: main
active-work: docs/active-work/claude/billing-uui-consolidation-5l2kiu.md
next: Approving a submitted cost from the firm-wide period, and a cost's entry number and attached files
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/costs` + `@magna-carta/billing-core` (shared WIP lifecycle); first per-firm queue consumer; recoverable-charge seam. cost→A/R + LEDES → 3·4.

**Costs becomes a place you can go, which took a listing shape it did not have.** `GET /api/v1/costs` answered one matter entire and returned an empty list for anything else, so Costs was absent from the sidebar's Money group entirely while the matter's own Money group carried it — the two disagreed about what Money holds, for a structural reason rather than an oversight. The listing now also takes a `from`/`to` span of incurred dates across every matter, narrowable to one matter, one status and to billable or not, cursor-paged over the same statement the per-matter shape walks so a cost reads back identically whichever found it. The unnarrowed range had no index whose leading column was the date, so `cost_entry` gained one, exactly as `time_entry` did for its own span.

`/costs` is that period: what the firm advanced, what is still waiting on a bill, and what it decided to absorb. Its columns are the matter ledger's own declaration with the Matter column brought forward, so a cost carries the same words on both screens.

**The cost record answers with what the table already held.** `cost_entry.created_at`, `.created_by` and `.kick_back_reason` were in the baseline schema and were never projected, so Date Entered, Entered By and the reason a cost was sent back said "not served" on every cost surface about facts the firm's own database was holding. The kick-back reason was the costly one: the transition returns a cost to **draft** and writes the reviewer's reason on the row, and the next submission clears it, so a non-null value means exactly "this draft came back and has not been sent again" — the only thing telling a returned draft from one nobody submitted. Unserved, the person who had to fix the cost was told nothing. It now leads the record window's Details pane, sits above the chain on the details panel, and has a hidden Returned column; it is read as a DRAFT fact so no later transition that forgets to clear it can print it over an approved cost, and it shows whether or not the firm runs review, because a reason already on a record is a fact rather than an invitation to a workflow. Both reach the wire now, the recorder's name resolved by a `member` outer join in the same statement the vendor's and the matter's already were — outer, and `created_by` deliberately not a foreign key, because who wrote a disbursement down has to survive that person leaving the firm. Entered By is not a permission fact: this slice's design rules that a cost belongs to the matter and not to its recorder, so there is no per-user self-scoping on costs at all, and the two surfaces' duplicated `canWorkDraft` — whose comment promised a recorder gate that ruling refuses — is now one function that states the real rule. The detail read stopped being a third shape at the same time: it was a hand-written column list resolving none of the three names, so opening a cost answered with less than the row it was opened from.

And a billed record now names the bill that took it up. `cost_entry.invoice_id` existed and never reached the wire, so a billed cost could not answer what the client was actually told; the row menu's **Open The Bill** lands on the matter's Billing section with that bill open. The verb lives in the shared ledger catalogue rather than on this menu, because time asks the same question of the same kind of row — `time_entry.invoice_id` had been on the entry contract since it was written and nothing on the time surfaces read it, so that gap was a verb rather than a read. A ledger declares `opensTheBill` when it has somewhere to send a reader; Fees does not, because an unbilled fee record has no table behind it yet.
