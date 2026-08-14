---
category: Added
audience: internal
---

**A firm can now produce, from its own append-only records, the document a bar examiner asks for
about one trust account — and ask for the same period again in five years and get the same integers.**

The first shipped capability in the reporting area, which had eleven ledger nodes and nothing built.

**What the document is.** For one trust account over one period: the cover, every reconciliation whose
statement period ends inside it, each client's ledger with each matter under it, the
receipts-and-disbursements journal, the firm's own bank-charge cushion where it keeps one, the
exceptions, and the provenance. Served as JSON from
`GET /api/v1/reports/trust-compliance/{trustAccountId}` on a new `reports:trustCompliance` capability.

**Why it re-derives.** Every ledger-backed figure filters on **both** date axes the schema already
carries — `effective_date` for the period, `recorded_at` for what the platform knew. Give it a period
and a knowledge instant and the answer is a pure function of rows that can never change; omit the
instant and you get a live report, stamped and explicitly not claimed to reproduce. Five new select
builders in the trust package carry the second axis; the settled as-of statements are untouched,
because the three-way proof's contract does not move for a report. A reconciliation closed **after**
the knowledge instant reads as open and its attestation does not appear — printing it would be
printing knowledge from after the moment the document claims to be taken at.

**The test that is the point.** Produce a pack; post a correction with an effective date inside the
period and a `recorded_at` months later — the exact move that silently rewrites a signed month on any
single-axis report; re-run at the same instant. Every integer is identical. Re-run live and the
figures move, the attestation does not, and the difference is stated leg by leg.

**Nothing recomputes what another package owns.** The three-way proof, the client-ledger total, the
book balance, the outstanding-item list and the ledger's stored-balance check are all called through
the functions that own them. What this package adds is decomposition — a per-client, per-matter
breakdown of a total trust asserts, and a per-entry journal behind a bank balance it asserts — and
each decomposition ships with an agreement test proving it sums to its aggregate over rows written by
the real composers, not by the suite.

**Two blocks are labelled as outside the reproducibility claim, and that is a finding rather than an
omission.** The proof shown beside each attestation, and the outstanding items, unmatched statement
lines and balance checks in the exceptions section, are each read through an owner that takes no
knowledge instant. Bounding them here would have meant writing a second definition of the
reconciliation a firm attested to. They carry their own `computedAt` and an explicit
`boundedByKnowledgeInstant: false`, the document says which part may differ between two runs, and the
reproducibility test strips exactly those two blocks and holds everything else to byte-identical
figures. The first version of that test found the leak: the exceptions section was silently unbounded,
and it took a failing comparison rather than a review to notice.

**Read-only is checkable, at two layers.** `@magna-carta/reporting` composes nothing, holds no
binding, reads no clock and owns no table; a purity scan over its own sources rejects a write
statement, effect-batch machinery, a domain composer import, or an aggregate of its own over the
ledger, and asserts it has sources to check. At the route layer the conformance suite rejects any
mutating route gated on a `reports:` read key. Nothing is materialised.

**What it refuses, by name rather than by answering short.** A period holding more of an account's
activity than one document can carry — the remedy is a shorter period, and a report missing entries
with no way to tell would be worse than none. An account whose outstanding-item list is longer than
one reconciliation can account for — the trust package's own refusal, propagated unchanged. And it
prints no governing-rule citation for a jurisdiction nobody has had reviewed: every encoded
jurisdiction ships unreviewed today, so the cover states which of the four refusals applies, in the
corpus's own words, and produces the rest of the document — the figures are the firm's own records and
no rule elsewhere conditions them. Refusing the whole pack instead is a seam the owner can flip.

**Measured.** Over the load-profile trust volume, at one month and at twelve: the client-ledger read
0.6 to 1.4 ms, the journal 0.6 to 1.7 ms, and the whole document 63 to 106 ms. Nothing scans. The cost
is dominated by the per-reconciliation three-way proof, not by the per-row reads, so the
`ledger_line.effective_date` denormalization the design held in reserve is not warranted yet.

**Five capabilities seeded to Owner/Admin alone** — trust compliance, financial, productivity,
operational, and produce — deliberately narrower than the trust and billing reads a firm grants more
widely, because an aggregate across every matter and client is a different exposure from a per-matter
read, and a report about people is a different grant from a report about money.

**Not built, and named rather than half-built:** turning a pack into a filed, content-hashed firm
record. It needs a renderer that this repository cannot run — the conversion engines are not deployed
— and the two append-only tables that would record a production are deliberately left out of the
migration rather than shipped for nothing to write. The other three report families, delivery, and
every screen are also unbuilt. **Nine owner questions from the design remain open**; three of them
ship as defaults behind named seams and the pack records which it was produced with.
