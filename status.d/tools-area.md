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
next: remaining per-tool pages, one at a time
link-spec: docs/specs/2026-07-08-tools-listing-page-design.md
link-plan: docs/specs/2026-07-08-tools-listing-page-implementation-plan.md
adrs:
blocked-by:
---

`@magna-carta/tools` catalog + firm-usage diagnostics (`GET /api/v1/firm-usage`) on `main`. The `/tools` listing page renders the catalog grouped by subject, as tiles or a dense list, each entry badged with its maturity stage. Network Speed Test is the first tool with its own page (stage `alpha`) — Cloudflare's measurement engine, a live line-and-area chart per direction, an AIM quality score, and an authenticated round-trip probe beside it. Firm Usage is the second: the tables-only quantitative snapshot computed on open, over a route extended with matters by type and by location, the file versioning breakdown, Directory and member counts, and the AI meters. The rest still read "Soon" and land one at a time.
