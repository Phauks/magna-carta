---
category: Added
audience: public
---

**A Matters List report.** `GET /api/v1/reports/matters-list` (`reports:operational`, live, no date) lists every matter the firm has opened, open, on hold or closed, with its number, client, type, office, responsible attorney and the instants it opened and closed, and counts them by office. The matters package owns the read (`readMatterRegister`, `packages/matters/src/matter-register.ts`); `packages/reporting/src/operational/matters-list.ts` counts it. Intakes, consultations and platform-owned matters are left out.

## Public

A new Matters List report lists every matter the firm has opened, with its client, type, office, responsible attorney and the days it opened and closed, and how many are open, on hold and closed in each office.
