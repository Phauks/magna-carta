---
category: Fixed
audience: public
---

**The last eighteen unpaged list endpoints, traced to their statements and answered one of three
ways.** Seven now carry a `capped` flag alongside their rows — a stocktake's sightings, an asset's
valuation history, a timekeeper's recent narratives, a matter's staffing windows, a matter's capture
addresses, a matter's auto-file rules, and one message's auto-file decisions — because each has an
ordering key the platform's two-part opaque cursor cannot carry (a three-column sort, or an aggregate
computed per query), and each is read to be judged whole. Three of the seven had no `LIMIT` at any
layer and now have one. Ten more are firm-configured catalogs whose bound is now written down as a
claim checkable at a named place rather than left as "it is probably small": document and matter
types, rate cards, UTBMS codes, non-billable categories, narrative templates, offices, asset classes
and asset types, and the auto-file review. The shrink-only pagination baseline
(`tooling/lint-list-pagination/unpaged-baseline.mjs`) is down to one named entry — custody reminders,
which merges two streams and wants a design call — and its header now records what the campaign
found: there was never a uniform fix, and applying one everywhere would have been wrong most of the
time.

## Public

**A list that stopped short now says so.** Several screens read a record that can be longer than one
response carries — an asset's valuation history, the sightings on a stocktake, the auto-file rules on
a matter, the addresses a matter has used for email capture. Each of those answers now tells you when
there is more than you are seeing, instead of ending quietly at a limit and looking complete.
