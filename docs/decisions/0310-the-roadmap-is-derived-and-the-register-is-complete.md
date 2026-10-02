---
number: 310
slug: the-roadmap-is-derived-and-the-register-is-complete
status: Proposed
date: 2026-08-14
area: Product updates
summary: "The roadmap is a rendered output of the roadmap.d/ feature ledger rather than a document anyone maintains, on the precedent of changelog.d/ to CHANGELOG.md and status.d/ to STATUS.md, and what it renders internally is the COMPLETE register: every one of the 702 capability nodes, at the status the ledger actually holds, led by the counts across all nine statuses, with nothing collapsed and nothing curated. Statuses are never banded. Collapsing nine into five horizons was built and withdrawn because it put partial (a shipped backend with no screen on it) under the same heading as in-build (being written right now), which is the largest loss of signal this source can suffer and precisely the distinction the owner needs; the register therefore carries one column per status, a done/part-built/ahead/parked roll-up, a per-area matrix, and the shipped-versus-shipped-plus-partial gap named in prose as the program's approximate interface debt. Subtrees are printed whole rather than collapsed to their shallowest node, because a parent's status is a roll-up and its children are the actual units of work. The document states plainly that the ledger holds no history and draws no trend line from it, naming CHANGELOG.md as the only dated record of what shipped, because an invented trend is worse than a stated gap. The customer-facing rendering keeps its whole design — a human authors the durable half of a public entry and the assembler derives the volatile band from status, four optional additive ledger keys carry it, public-summary is required and never defaulted from the internal scope line, and there are NO DATES with no date, target or confidence field anywhere in the schema so there is nothing to populate under pressure — but the document itself is NOT written to disk while the product has no users, because a document nobody reads is a document nobody keeps honest; the renderer, the ledger keys, the public-copy lint and the artifact schema all stay under test so publishing is one line in the assembler on the day there are readers. Drift is held by the same two mechanisms as before: the status cannot be typed into the rendered document, and a fitness function re-derives it and fails when what is committed differs."
---

**A roadmap that anyone maintains by hand will drift, and drift is the failure it was commissioned
to fix — so nobody maintains this one. What it renders is everything, not a selection.**

**Context:** The owner asked for a roadmap they could keep track of, in one sentence describing two
different failures. Every fact already existed — `ROADMAP.md`, `STATUS.md`, and 702 capability nodes
in `roadmap.d/` — and none of it was legible in one sitting. The first build answered that with two
curated digests, and the curation was the error: what was wanted was the whole inventory in one
place, at full detail, with the arithmetic over it.

The obvious alternative is a second document, written once and reviewed periodically. The evidence
against it is already in this repository: the docs-sync design measured eleven days and 236 commits
of drift in the rendered trackers under an explicit same-commit rule. Discipline is not a strategy.

**Decision:** `docs/now.md` is a rendered output of the feature ledger, and it is the complete
register — every node, at its real status, in ledger order, indented by the depth of its dotted id,
with the counts leading. The ledger stays the single home. The internal `ROADMAP.md` rewrite stays a
separate follow-up and reuses the same parser.

**Nine statuses, nine columns.** The withdrawn version banded the ledger's nine statuses into five
public horizons and used those bands internally too. That collapse put `partial` — most often a
shipped backend with no screen on it — under the same heading as `in-build`, work being written that
week. An owner deciding what to build next needs exactly that distinction, and no other pair of
statuses is more expensive to conflate. The register carries one column per status and additionally
a coarse done / part-built / ahead / parked roll-up, so the four numbers a reader reasons about and
the nine they audit against are both present and neither is inferred from the other.

**The interface debt is named, not left to be computed.** Shipped alone and shipped-plus-partial are
different by 182 nodes. Either number alone misleads in a different direction, so the document
prints both and says in prose what the distance between them is. A reader who takes only one number
away should at least have been told the other exists.

**No trend line, because there is no history to draw one from.** The ledger records current status
only. A "where we were" would have to be manufactured, and a plausible invented number is worse than
a stated gap — the same reasoning the search benchmark already uses here when it refuses to print a
latency for a path it did not execute. The register says the history is absent and points at the
dated changelog.

**Nothing is collapsed.** An earlier rendering kept only the shallowest node of each subtree, on the
theory that a parent plus nine children is nine lines saying what one line said. It is not: a
parent's status is a roll-up, its children are the units of work, and the collapse hid the detail
the document exists to show.

**The public rendering is designed, built, tested and not published.** The whole customer-facing
design stands — the human authors whether a capability is public and what its sentence says, the
assembler derives the band from `status` every run, `public-summary` is required rather than
defaulted from builder prose, the bands are the feedback board's own vocabulary so a request card
and a roadmap entry never mean two things by "Building Now", a `cut` promise is published rather
than deleted, and there are no dates and no field to put one in. What changed is only whether the
document is written to disk. There are no users; a document written for users with no reader is one
nobody keeps honest, which is the drift this decision exists to prevent arriving by an unexamined
route. The renderer, the ledger keys, the public-copy lint and the artifact parser all stay under
test — the corpus test renders the document in memory from the real ledger and round-trips it
through the artifact schema — so the guarantee the committed file carried survives without the file.

**Consequences.** The register is only as honest as the ledger, which raises the stakes on the
existing docs-in-commit rule for `roadmap.d/`; the weekly docs-sync routine already audits it and
the gate fails on a rendered document that has fallen behind. The document is long by design and is
read by search and by section rather than end to end, which is the trade taken against a digest
nobody could act on. Publishing the public view again is a one-line change in the assembler and a
decision about a page, which remains the owner's.
