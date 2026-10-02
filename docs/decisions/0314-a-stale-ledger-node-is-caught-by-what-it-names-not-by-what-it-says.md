---
number: 314
slug: a-stale-ledger-node-is-caught-by-what-it-names-not-by-what-it-says
status: Proposed
date: 2026-08-14
area: Documentation
summary: "The roadmap.d/ feature ledger gains a second fitness function, pnpm run lint:ledger-staleness, checking the ledger against the repository where lint:roadmap checks only the rendered documents against the ledger. It detects staleness exclusively through what a node NAMES — a path, a decision number, a child node — and never through what its prose says, because every prose-reading rule was measured and every one of them fired overwhelmingly on correct nodes. Six rules are kept: a pre-code node may not name existing code that no has-code node accounts for; an absence claim about a named path fails when the path resolves; a pre-code parent may not have a has-code descendant; every named path must resolve; every adrs entry must be an ADR-NNNN with a file; and not-started may not carry a spec. Three are rejected with their measurements — the slice-tag rule at 13 hits and 13 false, the affirmative-build-claim rule at 22 hits and 22 false, and diff-to-ledger coupling because it needs a diff base and is satisfied by touching a node rather than by making it true. The kept set produces zero false positives on the ledger and on a pre-fix checkout, catches the first of the two known stale nodes and not the second, and found four further stale nodes on its first run."
---

**A fitness function over documentation is worth having only if it is trusted, and it is trusted only
if it is almost never wrong. So the ledger is checked against what its nodes name, never against what
their sentences claim.**

**Context:** `roadmap.d/` is the source of truth for what exists in this program, and `docs/now.md` is
rendered from it. `pnpm run lint:roadmap` already gates drift — but in one direction only. It compares
the rendered documents against the ledger and never the ledger against the repository, so the assembler
cannot invent a state and equally cannot notice a stale one. A node nobody updates stays wrong forever
and every derived document repeats it faithfully.

Two nodes went stale one day apart, both found by a person reading rather than by a check.
`discovery.search` and `discovery.search.keyword` read `designed` — which the ledger's own vocabulary
defines as "accepted design spec exists; no code" — after roughly four thousand lines of engine, worker,
container and object host had shipped, with `discovery.search`'s evidence line still reading "No index
code on the tree yet." The `communications.email.filing.auto-file-rules` notes read "Nothing evaluates
during a capture yet: the port on the capture core and the evidence gatherer in the consumer are the
next slice" two slices after both were built. Both sat on the largest change of their day, which points
at size rather than carelessness: the bigger the change, the deeper in code its author is.

**Decision:** A second fitness function, `pnpm run lint:ledger-staleness`, wired beside `lint:roadmap`
in the Governance step. Its rules read only facts a filesystem can settle — a path resolves or it does
not, a decision file exists or it does not, a status is in a set or it is not.

The rule that earns the change rests on one observation about how this ledger is actually written: a
node claiming no code legitimately points at substrate that is already built, and **substrate that is
already built belongs to some other node that says so.** So a path that exists, is named by a node
whose status asserts there is no code, and is claimed by no shipped, partial or in-build node, is code
that nothing in the ledger accounts for. That single qualifier is the difference between a rule that
fires 41 times and one that fires once.

Three further rules cost nothing and close adjacent holes: an absence claim about a **named** path
fails the day the path appears; a pre-code parent with a has-code descendant contradicts the ledger's
own definition of `partial`; and every named path and every cited decision must resolve. A sixth
forbids `not-started` from carrying a `spec`, which its own definition excludes.

**Considered and rejected, each with the number that rejected it:**

**Keying off a node's `slices:` tag** — "files exist under this slice, so the node cannot be
pre-code." Measured against `status.d/` fragments marked `built: done` it fires 13 times and all 13 are
false: a slice tag is shared across nodes at different maturities, so `calendar.sync`,
`communications.messaging.port` and `payments.port` are all genuinely not started and all tagged to a
port system that is genuinely built. It also would not have caught the search node, which carries no
slice tag at all — only a third of nodes do.

**Flagging an affirmative build claim inside a pre-code node** — "is built", "now exists",
"unit-tested". Seductive, because it *would* have caught the search node. It fires 22 times and all 22
are false, every one the same good idiom: a pre-code node explaining what it is waiting on ("the
bulk-download engine it reuses is shipped; no portal-scoped path"). The obvious narrowing — ignore the
claim when the field also carries a contrasting absence clause — suppresses the one true positive,
whose evidence also said "Still dormant end to end". A narrowing that removes the only real hit while
keeping twenty-two false ones is worse than no rule.

**Coupling the diff to the ledger** — "a change touching a claimed path must touch its node." It would
have caught **both** known instances and is still wrong: it needs a diff base, so it is
non-deterministic locally and depends on CI fetch depth; it fires on every refactor, rename and
formatter pass; and decisively, **it is satisfied by touching a node rather than by making it true.** A
gate a one-word edit silences is a gate a one-word edit will silence, and it would then read green over
exactly the drift it was installed to find. The honest owner of that check is the weekly docs-sync
routine, which reads the merge window with judgement rather than a threshold.

**Consequences:** The first of the two known instances is caught — replayed against the tree from
before the fix, the rule fires on `discovery.search.keyword` with four unaccounted paths. Its parent is
not caught directly, because its evidence named no path, but the roll-up rule fires on the parent the
moment the child is corrected, so the repair cascades.

**The second instance is not caught, and no rule here pretends otherwise.** "The port on the capture
core and the evidence gatherer in the consumer are the next slice" names no path and no identifier and
sits on a `partial` node, a status that asserts nothing about code. Detecting it requires resolving an
English noun phrase against the tree, and the 22-false-positive measurement above is what that costs
here. One of two is the honest score, accepted because the rules that catch the first cost nothing on
the ledger they do not catch.

On its first run the scan found four stale nodes nobody had noticed — the jurisdiction-compliance
engine reading `designed` beside a built package its evidence said did not exist, LEDES e-billing
reading `not-started` over a shipped child, and four notification nodes citing two decisions by pending
slugs long after they were numbered — all corrected in the same change. The scan self-tests against
fixtures on every run, including a fixture asserting that it does **not** flag the auto-file node, so
that if someone later believes they have solved the natural-language half, the belief has somewhere to
be tested.
