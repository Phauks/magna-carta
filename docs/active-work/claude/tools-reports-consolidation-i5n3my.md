---
worktree: /home/user/magna-carta (remote session)
area: One catalogue framework behind Tools and Reports — a shared grouped listing with the product's own screen search over it
status: building
touches: apps/web/src/lib/catalogue, apps/web/src/lib/tools, apps/web/src/lib/reports, apps/web/src/routes/(app)/tools/+page.svelte, apps/web/src/routes/(app)/reports/+page.svelte, apps/web/test, changelog.d
---

Tools and Reports were the same screen written twice: a grouped list of things a member opens,
each entry a glyph, a name, a line saying what it does, and a maturity mark. Tools had a tile view
and a list view behind the multi-view shell; Reports had one hand-rolled list and no view switch.
Neither could be searched, so finding an entry meant reading every section.

This stream extracts the shared shape into `apps/web/src/lib/catalogue/` — one entry vocabulary,
one row, one tile, one grouped renderer per view, and one screen assembly that puts ScreenSearch
and the view switch in the masthead's action row — and rewires both screens onto it. The tool and
report registries keep owning their own facts and project into the catalogue vocabulary; nothing
about a tool or a report moves into the shared layer.

Do not step on `apps/web/src/lib/tools/tool-presentation.ts`, `apps/web/src/lib/reports/`, or the
two index routes. `tool-row.svelte`, `tool-tile.svelte`, `tools-list-view.svelte`,
`tools-tiles-view.svelte`, `report-row.svelte` and the tools view-preference pair are removed by
this stream.
