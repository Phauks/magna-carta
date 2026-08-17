---
category: Added
audience: internal
---

**Trust firm-funds and unclaimed-funds routes.** The API route layer for the bank-charge carve-out
and unclaimed-funds diligence file (domain layer landed in #208) is now reachable —
`trust-firm-funds.ts` and `trust-unclaimed-funds.ts`, gated by `trust:firmFunds`, with `openapi.json`
and the generated API client re-derived to match. No UI yet.
