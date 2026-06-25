---
category: Added
---

Time tracking, work-in-progress (WIP), and an effective-dated rate engine — the daily driver
(backend + API; the UI rides 0·7). A new `@magna-carta/timekeeping` package captures time four ways
(manual, a one-line quick-add parser, a weekly matters-by-days grid, and a server-persisted live
timer), stores it in a per-firm WIP store that is independently tracked and never posts to the
double-entry ledger (billable time converts to A/R only at billing), and moves each entry
Draft → (optional Submitted → Approved) → Billed under a column-level freeze contract. The live
timer is the codebase's first Durable Object — one idle-friendly instance per timekeeper,
firm-namespaced, with an abandoned-timer alarm and a `live_run_id`-idempotent stop-commit that
collapses a cross-device double-commit to one entry. Rates are append-only effective-dated versions
on named rate cards; a captured entry snapshots the rate in force on its work date and keeps it
forever, with an opt-in re-rate for unbilled drafts. The slice also lands two pieces of shared
infrastructure the rest of the phase consumes: the UTBMS task/activity/expense code catalog, and a
scoped-setting resolver (the first realization of the settings-precedence chain — matter → client →
user → location → firm). The AI narrative / UTBMS-suggestion feature is seamed but dark, gated on
client consent (default off, no model reached).
