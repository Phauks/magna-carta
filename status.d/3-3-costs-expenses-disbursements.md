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
next: Approving a submitted cost from the firm-wide period, and the recorder each row is missing
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/costs` + `@magna-carta/billing-core` (shared WIP lifecycle); first per-firm queue consumer; recoverable-charge seam. cost→A/R + LEDES → 3·4.

**Costs becomes a place you can go, which took a listing shape it did not have.** `GET /api/v1/costs` answered one matter entire and returned an empty list for anything else, so Costs was absent from the sidebar's Money group entirely while the matter's own Money group carried it — the two disagreed about what Money holds, for a structural reason rather than an oversight. The listing now also takes a `from`/`to` span of incurred dates across every matter, narrowable to one matter, one status and to billable or not, cursor-paged over the same statement the per-matter shape walks so a cost reads back identically whichever found it. The unnarrowed range had no index whose leading column was the date, so `cost_entry` gained one, exactly as `time_entry` did for its own span.

`/costs` is that period: what the firm advanced, what is still waiting on a bill, and what it decided to absorb. Its columns are the matter ledger's own declaration with the Matter column brought forward, so a cost carries the same words on both screens.

And a cost now names the bill that took it up. `cost_entry.invoice_id` existed and never reached the wire, so a billed cost could not answer what the client was actually told; the row menu's **Open The Bill** lands on the matter's Billing section with that bill open.
