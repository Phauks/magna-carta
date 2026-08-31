---
category: Added
audience: public
---

**The Firm Usage screen ships at apps/web/src/routes/(app)/tools/firm-usage/** — the tables-only
quantitative snapshot over the extended `GET /api/v1/firm-usage`, computed on request, per
docs/decisions/pending/firm-usage-is-quantitative-tables-computed-on-request.md. Custodian holdings
render as a reserved column and per-firm compute as a Soon table, so both seams are visible on the
screen before their data exists.

## Public

**See what your firm holds and what it uses.** Firm Usage, under Tools, shows your storage by
class, matters by type, files and their versions (including what deletion still holds), a
per-location view you can sort, your Directory counts, and your AI usage — every figure computed
fresh the moment you open the page. Owner and Admin seats only.
