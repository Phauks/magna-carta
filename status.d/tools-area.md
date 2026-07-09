---
slice: Tools area
group: cross-cutting
order: 7
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: in-progress by="Opus 4.8"
load-profile: n/a
tested: todo
branch: slice-0-7b-app-shell
active-work: docs/active-work/slice-0-7b-app-shell.md
next: per-tool pages, one at a time
link-spec: docs/specs/2026-07-08-tools-listing-page-design.md
link-plan: docs/specs/2026-07-08-tools-listing-page-implementation-plan.md
adrs:
blocked-by:
---

`@magna-carta/tools` catalog + firm-usage diagnostics (`GET /api/v1/firm-usage`) on `main`. The `/tools` listing page renders the catalog grouped by subject, as tiles or a dense list, each entry badged with its maturity stage. No tool has its own page yet, so every entry reads "Soon" and nothing is launchable; per-tool UIs land one at a time.
