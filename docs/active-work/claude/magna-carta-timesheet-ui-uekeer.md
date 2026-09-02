---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-timesheet-ui-uekeer
area: Refiling a misfiled time entry onto another matter — service, route and the two surfaces that offer it
status: building
touches: packages/timekeeping, apps/api-worker/src/routes/time-entries.ts, apps/api-worker/openapi/openapi.json, apps/web/src/lib/time, docs/conventions/time-tab-rulings.md, changelog.d/
---

Time gets recorded against the wrong matter, and until now the only remedy was to strike the entry
and type it again — which loses its number, its memo, its codes, its files and its history, and
leaves a struck row on a matter the work was never really on. This stream adds the move: a
`POST /time-entries/{id}/refile` that keeps the record and re-resolves the rate and the rounding
against the destination, plus the Matter field on the sheet and the record window that reach it.

Touches `apps/api-worker/openapi/openapi.json`, which another stream also declares.
