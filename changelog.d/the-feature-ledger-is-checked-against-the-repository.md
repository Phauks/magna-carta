---
category: Added
audience: internal
---

`pnpm run lint:ledger-staleness` checks the `roadmap.d/` feature ledger against **the repository**.
Its twin, `pnpm run lint:roadmap`, holds `docs/now.md` to a fresh render of the ledger, and that pair
already made it impossible for a derived document to drift off its source. Neither could tell whether
the **source** was true. Two nodes proved it one day apart: `discovery.search` and
`discovery.search.keyword` read `designed` — "accepted design spec exists; no code" — after four
thousand lines of search engine had shipped, and the auto-file node's notes described a state that had
ended two slices earlier. A person found both, because nothing was watching.

**Six rules, all exact, none of them reading English.** A node whose status asserts there is no code
may not point at code that no shipped node accounts for; a line saying a named path is absent fails
the day the path appears; a parent may not claim less than its own children; every path named must
resolve; every `adrs` entry must be an `ADR-NNNN` with a file behind it; and `not-started` may not
carry a spec.

**Quiet on purpose, and measured rather than argued.** The ledger holds 702 nodes, so a rule firing on
two percent of them prints fourteen lines nobody reads twice. Every candidate was run against the whole
ledger before being kept, and three plausible ones were run and thrown away: keying off a node's slice
tag is 13 hits and 13 of them false, because a slice tag is shared by nodes at different maturities;
flagging build claims inside a pre-code node is 22 hits and 22 of them false, because "the engine it
reuses is shipped" is how a node correctly explains what it is waiting on; and coupling the diff to the
ledger needs a diff base and is satisfied by touching a node rather than by making it true. The kept
rules produce **zero** false positives on the ledger and on a checkout from before the search fix.

**It found four stale nodes nobody had noticed, all now corrected.** The jurisdiction-compliance engine
read `designed` with evidence saying `packages/trust-jurisdictions` did not exist yet, while the package
holds the typed profile model, the registry, overlay resolution, the review gate, Nevada encoded and
three test files — now `partial`. LEDES e-billing read `not-started` over a child that shipped early —
now `partial`. And four notification nodes cited two decisions by their pending fragment slug, long
after both were accepted as `ADR-0251` and `ADR-0258`.

The scan **self-tests before it scans**, on fixtures that include both original stale nodes. One of
those fixtures asserts that the scan finds nothing wrong with the auto-file node: its claim names no
path and no identifier, so catching it would need an English noun phrase resolved against the tree, and
that is the guessing this gate refuses. A node the tree genuinely cannot match carries
`ledger-staleness:allow — <reason>` in its `notes`, on the same marker-plus-reason terms as the
object-dimension scan.
