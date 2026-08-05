# claude/trust-accounting-analysis

**Branch:** `claude/trust-accounting-analysis` · **Started:** 2026-08-04 · **Status:** complete, docs-only

## Scope

Analysis package for slice 3·2 (trust accounting) prepared for owner review. Trust accounting is
invariant-heavy and the standing rule in this area is analysis plus an owner flag, never a unilateral
build — so this stream produces a research document and nothing else.

Covers the ledger-model options over the built append-only double-entry substrate, the invariants
that must hold by construction, jurisdiction variance and the verify-against-primary-text posture
(following the ADR-0213 custodian precedent), the integration points against the built 3·1 time and
3·3 costs subsystems and forward to 3·4 billing and the payments phase, what the pre-alpha per-firm
schema baseline collapse means for sequencing, the audit and reporting obligations, and a proposed
sub-slice breakdown with the owner decisions each sub-slice needs answered first.

**Analysis only.** No code, no schema, no migration, no spec, no plan, no ADR. Every recommendation
in the document is labelled as a recommendation. The binding decisions in this area remain ADR-0008,
ADR-0009, ADR-0032, ADR-0061, and ADR-0072.

## Files touched

- `docs/research/2026-08-04-trust-accounting-analysis.md` (new)
- `changelog.d/trust-accounting-analysis.md` (new fragment)
- `docs/active-work/claude/trust-accounting-analysis.md` (this note)

No shared or generated file is edited — no `CHANGELOG.md`, no `STATUS.md`, no `ROADMAP.md`, no
`status.d/` fragment, no white paper, no `docs/conventions/`. No decision fragment: no decision was
made. No overlap expected with any other stream.
