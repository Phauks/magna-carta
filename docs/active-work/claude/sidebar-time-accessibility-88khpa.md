---
worktree: C:/dev/magna-carta-worktrees/claude/sidebar-time-accessibility-88khpa
area: The /time period ledger — the cross-matter time listing behind it, and the sidebar row it lights up
status: building
touches: apps/web/src/lib/time, apps/web/src/routes/(app)/time, apps/web/src/lib/navigation/destinations.ts, apps/api-worker/src/routes/time-entries.ts, apps/api-worker/openapi/openapi.json, packages/timekeeping/src/queries.ts, packages/database/src/per-firm-schema.ts, ROADMAP.md, STATUS.md, roadmap.d/financial.md, docs/now.md
---

Builds the firm-wide period surface at `/time` and flips its sidebar destination from an announced
Soon row to a shipped one. The blocker underneath it was the server: `GET /api/v1/time-entries`
answered one timekeeper on one day or one matter entire, and returned an empty list for anything
else — so the top bar's firm-wide Time Sheet was reading nothing. This adds the third listing shape,
a `from`/`to` span across matters, gated on `time:viewFirm` wherever it is not the caller's own time.

Concurrent streams should not step on `apps/web/src/lib/time/` (time-columns, time-figures,
time-sheet-scope all gain exports here) or on the time-entry list route and its OpenAPI snapshot.
The schema change is one added index (`time_entry_work_date_index`) and its migration.
