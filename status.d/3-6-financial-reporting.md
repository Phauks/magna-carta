---
slice: 3·6 — Financial & trust-compliance reports
group: phase-3
order: 6
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: todo
load-profile: done by="Opus 5"
tested: in-progress by="Opus 5"
branch: claude/financial-reporting-1
active-work: docs/active-work/claude/financial-reporting-1.md
next: Owner answers on the nine flagged questions and on the two defaults this build shipped behind seams; then the filed pack artifact (needs a renderer), then sub-slice 3·6·2 — the financial reports
link-spec: docs/specs/2026-08-13-financial-reporting-design.md
link-plan: docs/specs/2026-08-13-financial-reporting-implementation-plan.md
adrs:
blocked-by:
---

**Designed — all four report families, bar-audit pack first, per the owner's scope answer.** A projection layer rather than a subsystem: every quantity is either owned by another package and called rather than reimplemented, a decomposition shipping with a fitness test that proves it sums to its aggregate, or a count or ratio that touches no money the ledger has an opinion about. Nothing recomputes the three-way reconciliation — a closed period prints its frozen attestation verbatim and, where the live proof now differs, both appear labelled. Reproducibility is bitemporal on columns that already exist: an effective-date period plus a `recorded_at` knowledge instant, both on append-only tables, so a stated triple is a pure function of rows that cannot change. Read-only is four checkable mechanisms — a purity fitness scan, GET-only routes, a `reports:*` namespace that grants no write, and the one write (the filed pack artifact and its append-only production record) composed by the route and the queue consumer rather than by the package. Nothing is materialised. Three gaps are named rather than approximated: work in progress, productivity, and realization's standard-value leg are live-only because the work-in-progress stores are mutable and carry no `billed_at`/`voided_at`; profitability is not computable at all for want of a timekeeper cost rate; and a firm-wide operating position waits on slice 3·5's chart of accounts, which is not on `main`. Six ADR fragments. **Nine questions are flagged for the owner** — the load-bearing one being what an ethical wall does to a firm-wide financial total; the trust-compliance pack is settled either way and is never screened, and every response carries a completeness declaration so the later answer costs a field's value rather than a redesign.

**Sub-slice 3·6·1 built — the bar-audit pack, backend only.** `@magna-carta/reporting` lands with the temporal contract (a civil-date period on the effective axis plus a `recorded_at` knowledge instant, validated together, with a live mode that is stamped and says it does not reproduce), the completeness declaration every response carries, and the pack itself: cover, reconciliations, per-client and per-matter ledgers, the receipts-and-disbursements journal, the firm's own bank-charge cushion, exceptions, provenance. Five bitemporal select builders land in the trust package — the settled as-of statements are untouched, because the three-way proof's contract does not move for a report — and a reconciliation closed after the knowledge instant reads as open with no attestation, because printing one would be printing knowledge from after the moment the document claims to be taken at. `GET /api/v1/reports/trust-compliance/{trustAccountId}` serves it on the first of five `reports:` capabilities, all seeded to Owner/Admin alone.

**Read-only is proved at two layers**: a purity scan over the reporting package's own sources rejects a write statement, effect-batch machinery, a domain composer import, or an aggregate of its own over the ledger, and asserts it has sources to check; the conformance suite rejects any mutating route gated on a `reports:` read key. Nothing is materialised, and every decomposition ships with an agreement test proving it sums to the aggregate its owner produces over rows written by the real composers.

**One design correction, recorded as its own decision fragment.** The design asks for the live three-way proof "at the pack's knowledge instant". That is not obtainable: the proof is owned by the trust package and takes no knowledge instant, and writing a bounded copy here would be a second implementation of the reconciliation a firm attested to. The pack calls the owner's function, groups it with the exceptions whose owning reads have the same property, stamps both blocks with their own instant and `boundedByKnowledgeInstant: false`, and says on its face which part of the document may differ between two runs. The reproducibility test strips exactly those two blocks — the first version of it found the exceptions section silently unbounded.

**Measured over the trust volume** at one month and at twelve: client-ledger read 0.6 → 1.4 ms, journal 0.6 → 1.7 ms, whole document 63 → 106 ms, nothing scanning. The cost centre is the per-reconciliation three-way proof rather than the per-row reads, so the `ledger_line.effective_date` denormalization the design held in reserve is not warranted.

**Unbuilt and named:** the filed pack artifact and its production record, which need a renderer this repository cannot run (the conversion engines are not deployed) — the two append-only tables are deliberately out of the migration rather than shipped for nothing to write. Sub-slices 2 to 5 and every screen are untouched. **Two defaults shipped behind named seams and flagged**: zero-balance ledgers are listed, authorizers are named, and a jurisdiction with no reviewed corpus states its refusal on the cover rather than refusing the whole document — which matters today, because every encoded jurisdiction ships unreviewed.
