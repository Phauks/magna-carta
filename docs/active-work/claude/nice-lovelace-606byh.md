---
worktree: C:/dev/magna-carta-worktrees/claude/nice-lovelace-606byh
area: File Workbench becomes a sidebar destination in the Firm group; its route moves off /tools
status: building
touches: apps/web/src/lib/navigation, apps/web/src/routes/(app)/file-workbench, packages/tools, docs/conventions/file-workbench-rulings.md, status.d, changelog.d, docs/decisions/pending
---

File Workbench stops being a row inside the Tools catalogue and becomes a destination of its own:
a sidebar row in the Firm group, starred by default, at `/file-workbench` rather than
`/tools/file-workbench`. The tool catalogue keeps its manifest row, because the contextual
surfacing path queries the catalogue by context tag, so the manifest gains an optional route
override instead of every consumer deriving `/tools/<id>`.

Do not step on: `apps/web/src/lib/navigation/destinations.ts`, `packages/tools/src/{types,catalog}.ts`,
`apps/web/src/lib/screen/screen-header.ts`. The ten standalone file-tool rows in the catalogue are
deliberately untouched by this stream.
