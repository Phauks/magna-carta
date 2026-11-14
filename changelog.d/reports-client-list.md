---
category: Added
audience: public
---

**A Client List report.** `GET /api/v1/reports/client-list` (`reports:operational`, live) lists every client of an opened matter in name order, with the directory's default email, number and place for each and their matters counted by status. The clients come from the matters register the Matters List reads, and each name and contact from the directory's new `readEntityListingRows` (`packages/directory/src/entity-listing.ts`), the same row its own index prints. `packages/reporting/test/operational-client-list.test.ts` proves the counts add up to the Matters List's. No sealed identifier appears.

## Public

A new Client List report lists every client with their contact details and how many matters they have open and closed.
