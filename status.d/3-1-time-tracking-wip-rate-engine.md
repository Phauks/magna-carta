---
slice: 3·1 — Time tracking + WIP + rate engine
group: phase-3
order: 1
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: in-progress by="Opus 5"
load-profile: done by="Opus 4.8"
tested: done by="Opus 4.8"
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/timekeeping`; first Durable Object (live timer); scoped-setting resolver; UTBMS catalog. AI narrative/UTBMS seam ships dark. Three read surfaces are up — the matter's Time tab, the top bar's Time Sheet, and the period ledger at `/time` over the new cross-matter `from`/`to` listing. The week grid and My Day are the UI still to come.

**A billed hour reaches its bill.** `time_entry.invoice_id` has been on the entry contract since it was written and nothing on the time surfaces read it, so a billed entry could not answer the one question a ledger cannot — what was the client actually told. The gap was a verb rather than a read, and the verb is the shared ledger catalogue's rather than a second copy: the cost ledger asked the same question of the same kind of row, so **Open The Bill** was lifted into `ledger-record-menu.ts` behind an `opensTheBill` declaration, on the terms `reclassify` and `canRestoreVoid` already follow. It renders on every entry, refused where nothing has billed it, and lands on the matter's Billing section with that bill open.
