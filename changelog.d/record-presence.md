---
category: Added
audience: public
---

**Who else is here, as one shared feature.** A new per-firm `record_presence` table and two routes per record kind (`POST` and `DELETE {record}/presence`, mounted through `registerRecordPresenceRoutes` in `apps/api-worker/src/http/routes/shared/record-presence.ts`) say who else has a record open: a screen touches every few seconds and the answer is everyone seen in the last 30 seconds. Trust reconciliation is the first record served (`/api/v1/trust/bank-reconciliations/{reconciliationId}/presence`, behind `trust:read`). The marker on the screen follows once its design is picked.

## Public

Groundwork for showing who else is working on a reconciliation at the same time.
