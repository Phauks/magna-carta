---
number: 324
slug: a-report-labels-the-figure-it-cannot-take-as-at-a-past-instant
status: Proposed
date: 2026-08-14
area: Reports
summary: "Two rules the reporting design holds simultaneously turn out to collide in the bar-audit pack: every ledger-backed figure is bounded by the report's knowledge instant, and no figure another package owns is ever re-implemented. The three-way proof, the outstanding-item list, and the ledger's stored-balance fitness query are each owned elsewhere and each take no knowledge instant, so a pack cannot both call them and bound them. The pack calls them, groups them into two blocks that carry their own `computedAt` and an explicit `boundedByKnowledgeInstant: false`, and states on its own face that those blocks are the only part of the document that may differ between two runs of the same period. Every other figure reproduces, and the reproducibility test strips exactly those two blocks and holds the rest to byte-identical integers across a backdated correction. The rejected alternatives were both worse: a bitemporal copy of the proof would be a second definition of the reconciliation a firm attested to, and omitting the live comparison would remove the surface on which a firm sees that a backdated posting moved its books."
---

**A report that cannot bound a figure says so on the figure, rather than bounding it wrongly or
leaving it out.**

**Context.** The reporting design makes two commitments that are individually right and that meet in
one section of the bar-audit pack.

The first is reproducibility. Every ledger-backed figure is filtered on both date axes — an effective
period and a knowledge instant — so that a stated triple selects rows that can never change, and a
pack re-run in five years returns the same integers. That is what makes the document evidence rather
than a screenshot, and it is the property the whole slice exists to deliver.

The second is that a report never becomes a second answer to a question that already has one. The
three-way proof is owned by the trust package. The outstanding-item list is owned there too, and the
trust package's own notes say why it must be one list: a firm working from a second definition would
clear an item the proof still counted as in transit. The stored-balance check is the ledger's own
fitness query. A report calls all three; it does not re-derive them.

The collision is that none of the three takes a knowledge instant. `computeTrustThreeWayProof`
computes over everything recorded, by design — it is what a person reconciling looks at. So a pack
taken as at a past Tuesday can call it, or bound it, and not both.

**Three ways out, and why two of them are worse.**

_Write a bitemporal proof in the reporting package._ This is the one the reproducibility rule pulls
toward and it is the worst of the three. It would put a second implementation of the three-way
reconciliation inside a report — internally consistent, plausible, and free to disagree with the
attestation a firm signed. Every argument the design makes against a reporting surface owning a
financial figure applies to this one at full strength, and the figure in question is the single most
consequential number in the subsystem.

_Omit the live comparison from an as-of pack._ Reproducibility would hold trivially, and the document
would lose the section it exists for. A backdated posting into a closed reconciliation's period is
legal, it moves the live proof, and the frozen-versus-live split is precisely the surface on which a
firm sees that it happened. Removing it to protect a claim about the rest of the document trades the
finding for the property.

_Label it._ The pack calls the owner's function, prints what it returns, stamps the instant it was
computed at, and carries `boundedByKnowledgeInstant: false` beside it. The two affected areas are
grouped rather than scattered — `proofAtProduction` on each reconciliation, and `atProduction` inside
the exceptions section — so a reader deciding whether two copies of the document should agree can see
at a glance which part is allowed to differ. The pack's own reconciliation note says it in words.

**Decision.** Label it. A report may carry a figure it cannot take as at a past instant, provided the
figure is read through its owner, is grouped with the others of its kind, carries its own instant, and
declares that it is not bounded. Everything else in a report bounded by a knowledge instant reproduces,
and the reproducibility test enforces exactly that boundary: it strips those two blocks and asserts the
whole remainder is identical across a correction backdated into the period.

**Consequences.**

- The claim a firm can make about a produced pack is narrower than "the document reproduces", and it is
  true: the figures reproduce, two named comparisons are live and say so, and the captions are as they
  stood. The user guide states all three.
- The boundary is a test rather than a convention. Widening what the reproducibility test strips is how
  the claim quietly stops being true; the reporting package's local notes say to narrow it instead.
- Anything added to those two blocks inherits the label, and anything moved out of them has to be
  provably bounded. That is a cheaper rule to hold than a per-figure judgment.
- If the trust package ever grows a knowledge-bounded proof of its own — for its own reasons, not a
  report's — the pack calls that instead and the blocks shrink. Nothing here forecloses it, and nothing
  here asks for it.
