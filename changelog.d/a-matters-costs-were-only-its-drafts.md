---
category: Fixed
audience: internal
---

**The cost listing narrowed to drafts exactly as the time listing did.** Asking for a matter's costs
with no status returned only the draft ones; everything submitted, approved, invoiced or voided was
excluded, and the contract declared the parameter optional with no default and no note. A matter
that had been billing for a year showed almost nothing.

An absent status now means every status. Narrowing to one remains the work-in-progress question, and
the contract says so.

The listing resolves the vendor's directory name in the same statement rather than answering with an
identifier. A matter with fifty disbursements would otherwise be fifty lookups to print one column.
Two outer joins, because a vendor is optional on a cost and may be a person or an organization; the
screen tells "no vendor recorded" from "the directory entry is gone", which are different facts and
`vendorId` is what distinguishes them.

The Costs section is built over the repaired read, replacing a fixture table. It shows each cost's
status and its hard-or-soft class, and totals what the firm advanced beside what it may recover —
the difference being what the firm decided to absorb, which is a decision worth seeing rather than
one figure hiding it. Voided costs are excluded from both, since a withdrawn cost was never advanced.

**Both silent defaults are now gone, and there were only two.** The other seven query defaults in
the route surface are page sizes and explicit nulls, so this was a repeated mistake rather than a
class needing a gate.
