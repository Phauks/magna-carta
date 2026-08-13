---
slug: the-public-roadmap-is-derived-and-states-no-date
status: Proposed
area: Product updates
date: 2026-08-13
summary: "The public roadmap is a rendered output of the roadmap.d/ feature ledger rather than a document anyone maintains, on the precedent of changelog.d/ to CHANGELOG.md and status.d/ to STATUS.md, and the split inside a published entry is the whole mechanism: a human authors the durable half (whether the capability is public at all, its public name, its one sentence of user language) and the assembler derives the volatile half (which horizon band it sits in) from the node's status on every run, so a capability that ships moves itself and there is no second place anyone could forget to update. Four optional, additive ledger keys carry it — audience, public-name, public-summary, awaiting-owner — plus an optional per-area public-group header; public-summary is REQUIRED whenever a node is public and is never defaulted from the internal scope: line, because defaulting would silently publish builder prose that cites packages. Visibility is deliberately narrow: name, sentence, band, area heading, and nothing else — no slice or phase numbers, no spec paths, no decision records, no evidence lines, no per-slice stage tracking, and above all NO DATES, with no date, target or confidence field anywhere in the schema so there is nothing to populate under pressure. The bands are the community board's own status vocabulary (Building Now, Planned, Future, Completed, Not on the roadmap) adopted verbatim so a request card and a roadmap entry never say the same thing two ways; Beta is left unmapped rather than approximated. Drift is held by three mechanisms in increasing order of weight: the band cannot be typed, a fitness function re-derives both rendered documents and fails when either differs from what is committed, and the public-copy rules are enforced on the fragment where an author can still fix them. The owner's own view is a second rendering of the same ledger, docs/now.md, and the web page is deliberately not built."
---

**A public roadmap that anyone maintains by hand will drift, and drift is the failure it was
commissioned to fix — so nobody maintains this one.**

**Context:** The owner asked for a roadmap they could keep track of and users could read, in one
sentence describing two different failures. Internally, every fact already existed — `ROADMAP.md`,
`STATUS.md`, and 702 capability nodes in `roadmap.d/` — and none of it was legible in one sitting.
Externally there was nothing at all.

The obvious build is a second document, written once and reviewed periodically. The evidence
against it is already in this repository: the docs-sync design measured eleven days and 236 commits
of drift in the rendered trackers under an explicit same-commit rule. Discipline is not a strategy,
and a stale public roadmap is worse than none — it says a capability is being worked on when it
shipped a quarter ago, or that something is coming when it was dropped.

**Decision:** Both new surfaces are rendered outputs of the existing feature ledger, and the ledger
stays the single home. `docs/public-roadmap.md` is what users read; `docs/now.md` is one screen for
the owner. The internal `ROADMAP.md` rewrite stays a separate follow-up, and both new documents
reuse the parser it will need.

**Authored versus derived, inside one entry.** A human decides whether a capability is public and
writes its name and its sentence — facts that rarely change. The assembler decides which band it
appears in, from `status`, every run. The volatile fact is the one that cannot be typed, so the
failure being guarded against has nowhere to occur.

**Prefer opting in the parent, not the leaf.** A parent's status is a genuine roll-up, so its
`shipped` means the whole capability including its screen. A leaf's `shipped` frequently means a
backend nobody can reach yet, and publishing that as Completed would be a lie the assembler tells on
the author's behalf.

**No dates, and no field for one.** Named horizon bands only. The reasoning is the reasoning the
search benchmark already uses here — it refuses to print a latency for a path it did not execute,
because a plausible invented number is worse than a stated gap — and the community-surfaces design
reached it independently: a nullable date column gets populated, and then it is a promise. The cost
is real and accepted: a prospect cannot tell whether Building Now means six weeks or nine months,
and some will want that before they sign. We lose that conversation rather than win it with a date
we do not have. The dated public changelog remains the evidence of cadence.

**One vocabulary with the feedback board.** The bands are the board's settled status names. A
roadmap that ignores what users voted for is half a product, and two surfaces describing the same
work in different words is the drift this decision exists to prevent, appearing at the most visible
possible seam. `Beta` belongs to the release-channel work and stays unmapped until a node can
honestly be in it.

**A cut promise is published, not deleted.** The ledger already keeps a dropped capability as `cut`
for the record; the public view carries it under "Not on the roadmap". The reference product's board
demonstrates the alternative in the open — a request marked Completed for something never built —
and a status used to close a conversation rather than describe reality teaches readers to distrust
every other status on the page.

**Consequences.** The public view is only as honest as the ledger, which raises the stakes on the
existing docs-in-commit rule for `roadmap.d/`; the weekly docs-sync routine already audits it, and
the gate now fails on a rendered document that has fallen behind. Publication remains a judgement:
nodes are opted in one at a time, so adding 702 capabilities to the public page is not something
that can happen by accident. The page itself is not built — the seam is the artifact contract in
`@magna-carta/product-updates`, on the same no-committed-artifact rule as the changelog — because a
user-interface surface is the owner's decision, not an assembler's.
