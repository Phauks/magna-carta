---
category: Added
audience: internal
---

**Trust firm-funds carve-out and unclaimed-funds reads are reachable through the API (#210).** `apps/worker/src/routes/trust-firm-funds.ts` and `apps/worker/src/routes/trust-unclaimed-funds.ts` put routes over the domain layer that had landed without them; both firm-funds routes are gated on `trust:firmFunds`, not `trust:manage`, and the review closure accepts only an outcome, a reference to an already-posted disbursement and a note. `openapi.json` and `@magna-carta/api-client` are re-derived to describe them. Drafted by the docs-sync routine from the merge.
