---
branch: phase-3-financial-core
worktree: C:/dev/magna-carta-worktrees/phase-3-financial-core
area: Phase 3 (Financial Core) — slice map firmed up; now in the 3·1 (Time tracking) design cycle
status: designing
touches: docs/specs/2026-06-2*-phase-3-* + slice-3-1-time-tracking-design.md, docs/decisions/pending/ (4 ADR fragments), docs/research/2026-06-22-competitive-time-tracking-deep-dive.md, docs/Magna-Carta-White-Paper.md (§17.1 Time-tracking lifecycle line only), ROADMAP.md (Phase 3 section), STATUS.md (Phase 3 table). Soon: new packages/timekeeping + apps/worker (first Durable Object), per-firm migration slot after 0014, access-control/registry.ts (time:*), identifiers/registry.ts, scoped_setting in data-access.
---

Opening Phase 3 as a track independent of the in-flight Phase 2 work (3·1 Time/WIP and 3·2 Trust
gate only on already-shipped 0·3 ledger + 1·1 Matters/Locations — not on documents). First
deliverable: a phase-opening slice-map design doc that firms up main's existing **provisional**
Phase 3 slicing (HEAD `docs(roadmap): slice Phases 3–7 provisionally`). The one substantive change
to that provisional list is **flipping 3·3/3·4 so Costs precedes Billing** (an invoice bills costs);
plus per-slice scope/gates/invariants/seams, the Time↔Trust parallelism, and the
Phase-3-records-vs-Phase-6-processes payments boundary. Then the 3·1 (Time) design cycle.

Cross-stream note: edits ROADMAP.md (Phase 3 section only) and STATUS.md (Phase 3 table). No other
stream is touching Phase 3. Not editing any package source yet (design stage).
