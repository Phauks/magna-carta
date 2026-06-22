---
number: 31
slug: locations-multi-location-firms-firm-may-operate
status: Accepted
date:
area: Locations
---

**Multi-location firms:** a firm may operate multiple offices, modeled as a first-class **Location** entity — a _dimension inside the per-firm D1_, not a new isolation tier. The **firm stays the tenancy/isolation/crypto-shred/conflicts boundary**; conflicts impute across all offices. Matters **optionally** reference a home Location (driving number prefix, letterhead/remit-to, reporting); **trust jurisdiction profiles bind per account**, each account associated with a Location (a firm runs several jurisdictions at once); **Custodian hierarchy is rooted at Location**; users belong to one+ Locations with optional per-location role scoping; reports gain per-location roll-ups. Rejected: office-as-tenant (breaks shared Directory + firm-wide conflicts), office-as-Directory-`Organization` (conflates internal/external), office-in-control-plane (wrong tier).
