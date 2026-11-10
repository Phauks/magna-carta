---
category: Changed
audience: public
---

**The conflicts check is redesigned, and a run can be cancelled.** The New Check panel asks for parties only and lists five locations, each a dropdown of what it searches; Firm Employees runs without a matter by looking for members among the entities a check reached (`findMemberEntities`). The check page gains Report and Runs tabs, collapsible Details, Status and Results sections, a per-location status log, result cards with filters and a review dropdown, and icon-only print and download buttons. `POST /api/v1/conflicts/checks/{checkId}/runs/{runId}/cancel` stops a run; a run summary reports `cancelled`, `cancelledByUserId` and `askedScope`. Reports say "0 results." and count results rather than candidates.

## Public

**The conflicts check is easier to run and to read.** New Check asks only for the parties and shows each place it searches with what it covers there. A check's page has Report and Runs tabs; the report is split into Details, Status and Results, each of which you can fold away. Each result says how strong the match is, what matched and how it was reached, and you can filter results and record a review from the result itself. A running check can be cancelled from its Running badge.
