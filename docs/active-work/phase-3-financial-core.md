---
branch: phase-3-financial-core
worktree: C:/dev/magna-carta-worktrees/phase-3-financial-core
area: Phase 3 (Financial Core) — slice 3·1 (Time tracking) built and tested local
status: 3·1 (Time tracking) built + tested local; ready to merge. 3·2/3·5 parallel-eligible next.
touches: docs/specs/2026-06-2*-phase-3-* + slice-3-1-time-tracking-design.md, docs/decisions/pending/ (4 ADR fragments), docs/research/2026-06-22-competitive-time-tracking-deep-dive.md, docs/Magna-Carta-White-Paper.md (§17.1 Time-tracking lifecycle line only), ROADMAP.md (Phase 3 section), STATUS.md (Phase 3 table), packages/timekeeping (new package), apps/worker (first Durable Object + time-entry routes), packages/data-access (scoped_setting resolver), packages/access-control (time:* permissions), packages/identifiers (registry additions), migration 0016_time-tracking, changelog.d/slice-3-1-time-tracking.md
---

Phase 3 opened as a track independent of the in-flight Phase 2 work (3·1 Time/WIP and 3·2 Trust
gate only on already-shipped 0·3 ledger + 1·1 Matters/Locations — not on documents). The phase-opening
slice-map design doc firmed up the provisional Phase 3 slicing (3·3 Costs before 3·4 Billing;
per-slice scope/gates/invariants/seams, Time↔Trust parallelism, Phase-3-records-vs-Phase-6-processes
payments boundary). Then the 3·1 (Time) design + build cycle.

**3·1 built:** the new `@magna-carta/timekeeping` package (WIP store + Draft→Billed lifecycle,
effective-dated rate engine, UTBMS catalog, non-billable categories, narrative templates, My Day
reads); the codebase's first Durable Object (`LiveTimerDurableObject`, per-timekeeper,
firm-namespaced, abandoned-timer alarm, `live_run_id`-idempotent stop-commit); the net-new
`scoped_setting` table + `resolveScopedSetting` resolver in `@magna-carta/data-access` (first
realization of the white-paper settings-precedence chain); migration `0016_time-tracking` (per-firm)
and `matter.e_billing` column; `time:*` permissions in `@magna-carta/access-control` registry;
`TimeEntryId` and related handles in `@magna-carta/identifiers`; chokepoint routes with a
regenerated OpenAPI snapshot + extended conformance; load-profile `TimeVolume` + measurements;
e2e + WIP-ledger and billed/void freeze fitness scans; 4 ADR pending fragments. The AI
narrative/UTBMS-suggestion seam is built but dark (consent-gated, no model reached by default).

Cross-stream note: edits ROADMAP.md (Phase 3 section only) and STATUS.md (Phase 3 table). No other
stream is touching Phase 3.
