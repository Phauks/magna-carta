---
category: Added
audience: public
---

**Firm Profile is live: the firm's name is set from Settings and reaches the paper.** `PUT /api/v1/firm/profile` sits behind a new `firm:manageProfile`, seeded to Owner/Admin alone. Its own key rather than a corner of `firm:manageMembers`, on the reasoning the three firm policy keys beside it already carry: administering who works here and deciding what the firm is called to a client are different acts, and the second one reaches paper that has already left the building.

**The write reaches `firm.display_name` and never `firm.name`.** The latter is the provisioning handle — UNIQUE, what a crashed provisioning run finds its own partial row by, and for a self-serve firm generated rather than chosen. Renaming it would break that resume and would let one firm's chosen name refuse another's.

**There is no GET, deliberately.** Every session already resolves the firm's display name — the bootstrap returns it and the chokepoint reads it for every request — so a second read would be a second answer for a screen to reconcile against the session it is already holding. After a save the session is re-read rather than patched locally, because the name is on the chrome around the page too.

The name is trimmed and normalized to NFC by the same rule the joining door applies, so a name typed here and the same name typed there are the same name; an empty or over-long one is refused with a 422 rather than clamped. The change is audited in the firm's own log with what the firm was called before and after — written after the control-plane batch, on the first execution only, so a replay cannot double-write the firm's history.

Instant with its own Save rather than the firm scope's draft footer: it is one field, and the footer's staged-count-and-recap anatomy over a single row would be more machinery than the act.

## Public

**You can change your firm's name from Settings · Firm Profile.** It is what clients see: on invoices, in the client portal, and on every document the platform generates.

New documents carry the new name from the moment you save. Documents already produced keep the name they were produced under — nothing is reprinted, and the page says so before you save rather than after.

Only an owner or administrator can change it; everybody else sees what the firm is called. The change is recorded in the firm's audit log against whoever made it.

An address, a telephone number and a letterhead belong to an office rather than to the firm as a whole, so they stay under Offices — where a document actually reads them from.
