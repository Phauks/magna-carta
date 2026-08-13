---
slice: 3·6 — Financial & trust-compliance reports
group: phase-3
order: 6
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: todo
ui: todo
load-profile: todo
tested: todo
branch: claude/financial-reporting
active-work: docs/active-work/claude/financial-reporting.md
next: Owner answers on the nine flagged questions; then sub-slice 3·6·1 — the bar-audit pack
link-spec: docs/specs/2026-08-13-financial-reporting-design.md
link-plan: docs/specs/2026-08-13-financial-reporting-implementation-plan.md
adrs:
blocked-by:
---

**Designed — all four report families, bar-audit pack first, per the owner's scope answer.** A projection layer rather than a subsystem: every quantity is either owned by another package and called rather than reimplemented, a decomposition shipping with a fitness test that proves it sums to its aggregate, or a count or ratio that touches no money the ledger has an opinion about. Nothing recomputes the three-way reconciliation — a closed period prints its frozen attestation verbatim and, where the live proof now differs, both appear labelled. Reproducibility is bitemporal on columns that already exist: an effective-date period plus a `recorded_at` knowledge instant, both on append-only tables, so a stated triple is a pure function of rows that cannot change. Read-only is four checkable mechanisms — a purity fitness scan, GET-only routes, a `reports:*` namespace that grants no write, and the one write (the filed pack artifact and its append-only production record) composed by the route and the queue consumer rather than by the package. Nothing is materialised. Three gaps are named rather than approximated: work in progress, productivity, and realization's standard-value leg are live-only because the work-in-progress stores are mutable and carry no `billed_at`/`voided_at`; profitability is not computable at all for want of a timekeeper cost rate; and a firm-wide operating position waits on slice 3·5's chart of accounts, which is not on `main`. Six ADR fragments. **Nine questions are flagged for the owner** — the load-bearing one being what an ethical wall does to a firm-wide financial total; the trust-compliance pack is settled either way and is never screened, and every response carries a completeness declaration so the later answer costs a field's value rather than a redesign.
