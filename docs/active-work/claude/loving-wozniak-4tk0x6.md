---
worktree: C:/dev/magna-carta-worktrees/claude/loving-wozniak-4tk0x6
area: The header's Build Information panel — one diagnosis format shared with the issue reporter, a reusable panel section, probe latency, deep links to the commit and to each Worker in the Cloudflare dashboard, an environment badge, and a diagnostic-action registry the command palette renders
status: building
touches: apps/web/src/lib/versions/, apps/web/src/lib/diagnostics/, apps/web/src/lib/developer/, apps/web/src/lib/components/command-palette.svelte, apps/web/src/lib/components/bug-report-dialog.svelte, apps/web/test/, apps/web/e2e/, apps/api-worker/src/routes/platform/meta-versions.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src/
---

Reworks the Build Information panel behind the header chip. The copy control now reports the whole
panel including its failures, over one shared section-and-entry report model that the issue
reporter's trace also renders, so a paste from either surface reads the same and the panel's report
can ride into a filed issue. The four sections collapse onto one `version-panel-section.svelte`
(heading, fold, failure block, loading region), so a fifth section is a descriptor rather than a
copy. `GET /api/v1/meta/versions` gains a per-Worker probe latency; rows gain links to the commit on
GitHub and to the Worker in the Cloudflare dashboard; the chip gains an environment badge outside
production. A new diagnostic-action registry (`$lib/developer/diagnostic-actions.ts`) is the seam the
command palette renders and the way any later developer tool becomes reachable from search.

Anything under `apps/web/src/lib/versions/` or `apps/web/src/lib/diagnostics/` collides with this
stream, as do the palette and the issue dialog. The API change is additive (one nullable field on
`ServiceVersion`).
