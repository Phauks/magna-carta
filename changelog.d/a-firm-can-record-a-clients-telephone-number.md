---
category: Added
audience: internal
---

**A firm can now record a client's telephone number.** It could not before. `directory_phone` and
`directory_address` were real tables with no domain module at all — not one statement in the
repository inserted a phone number or an address — and email had a write path reachable only from
inbound mail capture. All three are reachable now, through fourteen operations under the firm-scoped
chokepoint, with a combined read that answers all three channels at once.

**Permission and preference are separate facts.** A contact point records whether it may be used and
whether it is preferred, because someone can be reachable by a method that is not their preference.
At most one point is preferred across all three channels, since "write to me" is one answer about
every channel rather than one answer per channel. Withdrawing permission is what the surface offers
instead of deletion — deleting the value loses the instruction that came with it.

**A date of birth is a date again.** It was filed as an encrypted identifier, which is matched only by
exact blind index, and a date of birth carries too few plausible values to index safely — so the code
deliberately refused, and the date could not be searched or range-queried. It is now a plain date on
the person, with date of death and a separate deceased flag beside it, registered in the PII registry.
The birth-year compromise was withdrawn on the way: a year cannot fill in a court form.

**Addresses take the international field set** — no hardcoded state or ZIP, no required field — and the
seam a validation provider would land in ships without the provider. Sending a client's address to a
third party is a disclosure only the firm can authorise, so the recommendation is recorded and nothing
is adopted.
