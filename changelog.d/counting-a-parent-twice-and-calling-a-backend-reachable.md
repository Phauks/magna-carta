---
category: Changed
audience: internal
---

**The register counted 133 roll-up parents as if they were work, and it could not tell a screen
somebody uses from a backend nobody can open. Both are fixed, and there is now one page for
answering the questions the build is waiting on.**

Three corrections to how the feature ledger is read, all raised by the owner reading the register.

**A roll-up is not a unit of work.** Hierarchy is encoded in the dotted id, so a node with children
is a summary of them — and its status goes `partial` the moment its children stop agreeing. Counting
those parents beside the leaves did not add work to the totals, it added the same work a second time
under a status nobody chose. The distortion was not evenly spread either: of 133 parents, 107 were
`partial`, so it landed almost entirely on the one status a reader is most likely to mistake for
progress. Every share in the register now runs over the 621 units of work, with the parent count and
its `partial` share stated in its own section rather than quietly dropped. The numbers move
accordingly: shipped reads 41% where it read 35%, and `partial` 16% where it read 27%.

**`surface:` — a new ledger key, because `status` never held reach.** A backend nobody can open and a
screen somebody uses every day are both `shipped`, and reading those as one number overstates the
product by the entire amount of interface that has not been built. The key takes `screen`,
`awaiting-screen` or `internal`, is required on every leaf whose status is `shipped`, `partial` or
`in-build`, and is refused on roll-up parents and on nodes with nothing built — a parent's reach is
its children's, and a capability nothing has been written for has no reach to record. It is recorded
rather than derived because deriving it was measured and rejected: prose in `notes` carried a usable
signal on 63 nodes of 754, and an `evidence:` path naming a screen on 14 of the 359 leaves with code
behind them. The register gains a section reading the answer back, and the interface debt is now a
stated figure rather than something inferred from `partial`.

**`docs/decisions-open.html` — the decision desk.** The `awaiting-owner` questions were recorded
where each piece of work stopped, one line inside one area file, and reachable only as a list part
way down the register. That is somewhere to read them, not somewhere to answer them. The desk is a
third rendering of the same ledger, built by the same `vp run register-build`: every open question as
a card, sorted by whether anything is built behind it, with the reach chip from `surface:`, an answer
box that persists in the browser, filters by area and by unanswered, and a copy-out block that names
each decision by node id. It has no network of any kind — that is what lets it be read from the
repository, from a published copy or from a laptop with no connection and be the same page — so the
answers come back by paste, in a format written to be applied without anybody matching them up by
hand. `pnpm run lint:roadmap` holds it to a fresh render like the other two, so a question leaves the
desk exactly when its node's key does.
