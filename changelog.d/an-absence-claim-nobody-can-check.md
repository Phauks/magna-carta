---
category: Changed
audience: internal
---

**A node's evidence can say "no conflicts check exists to trigger" and be wrong for weeks, because
nothing in the repository can check an English sentence. The obvious fix — make the sentence name a
path — was measured at 96 hits over 708 nodes and rejected. Eight capabilities that existed were
being counted as work not begun, with seven further claims saying so in prose, and every one of them
was found by running the matcher by hand instead.**

**The idea, and why it does not survive measurement.** You cannot check a sentence against a
filesystem, but you can refuse it: require evidence asserting something does not exist to also carry
a repository path, so `no conflicts check exists` becomes `no caller of packages/conflicts exists`
and the three path rules in `tooling/lint-ledger-staleness/` can finally see it. An unfalsifiable
claim becomes a falsifiable one and the existing machinery does the work. The measurement says
otherwise. **96 raw hits, 14% of every node** — not a lint finding but a migration — and the hits are
not a fixable tail. They are the ledger's most correct idiom: _"no code"_, _"none exists"_,
_"Backend only — no UI"_, each naming a capability with **no location on the tree at all**, because
it was never built anywhere. Forcing a path onto those means inventing one, and rule 4 correctly
suppresses an unresolved path inside an absence claim, so the invented path is never checked until
somebody happens to create a file at exactly that name. The convention also cannot make anybody look:
writing `no packages/conflicts caller exists` requires having checked, and checking is what corrects
the belief.

**A better formulation appeared while measuring, and it fails too — by one.** Drop the filesystem and
compare the ledger against itself: a node's prose asserts a named capability does not exist, where
that capability is another area root the ledger holds at a has-code status. No English resolved
against a tree, just two committed statements disagreeing, the same shape as the roll-up and
slice-delivery rules. **8 hits, 5 true, 3 false**; narrowed to a standalone word followed by a
subsystem noun, **6 hits, 5 true, 1 false**. The survivor is `ai.magnus.record` — _"belongs to the
discovery surface and is not built **here**"_ — a node scoping an absence to itself while naming a
subsystem that exists. That is ordinary English, and the narrowing that would suppress it is fitted
to the one sample rather than derived. One false positive is one too many for a scan whose entire
argument is that it fires rarely and is right when it does.

**So the matcher ships as a search tool and not as a gate**, which is the division the design already
draws: judgement reads prose, the gate does not. Run over `roadmap.d/` by hand it found five stale
claims, and following one of them found a sixth seam nobody was looking for.

**Conflicts, corrected in one direction throughout.** Slices 1 and 2 shipped and six nodes still read
as though nothing had. The matching engine is `shipped`, not `researching`: four blocking channels
over the Directory corpus, related-party edge expansion as a 0-1 BFS that costs corporate hops
nothing, and a deliberately scorer-free evidence tier that orders and never filters. The immutable
log is `shipped`: three append-only tables with nine `RAISE(ABORT)` triggers, a runtime fitness probe
that refuses a plaintext-identifier-shaped digit run in recorded evidence, and the plain-language
statement of what a check searched. Human clearance is `shipped` — four disposition kinds, a required
rationale, a reversal that is a second row rather than an edit — and firm-wide imputation is
`shipped`, matching the firm's own people by identity and never by name, with the party class unioned
back into the floor on every read so no stored policy can drop the firm-wide corpus. Strictness and
search depth are `partial` rather than shipped, and for stated reasons: the strictness floor has no
write path behind it, and the content source is registered with no corpus and records `unavailable`
on every check so the log can never read as searched-and-clean for document text.

**Billing was carrying the same shape.** `financial.billing.invoice-composition` read `not-started`
with "no invoice model in tree" over eight invoice tables and a composer that builds fee and cost
lines from claimed work-in-progress; `financial.billing.wip-to-ar` read `not-started` with "no
posting service exists" over a `finalizeInvoice` that locks every claimed entry into billed and
writes the receivable in the same batch. Four further notes lines across time, costs and the billing
parent still called that slice unbuilt. Composition is `partial` (tax is a declared line kind and a
posting role with nothing computing it) and the posting is `shipped`.

Shipped moves 249 → 254 and partial 192 → 195, so shipped-plus-partial goes 441 → 449 of 708, 62% to
63%. The Conflicts area moves from 11% done to 56%.
