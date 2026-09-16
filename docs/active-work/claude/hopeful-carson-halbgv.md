---
worktree: C:/dev/magna-carta-worktrees/claude/hopeful-carson-halbgv
area: Transfer registers (uploads/downloads), sidebar groups, tools elevation, build panel icons
status: building
touches: apps/web/src/lib/transfers, apps/web/src/lib/file-manager, apps/web/src/lib/export, apps/web/src/lib/navigation, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/versions, apps/web/src/routes/(app)/uploads, apps/web/src/routes/(app)/downloads, apps/web/src/routes/(app)/tools, packages/design-system/src/lib/components/sidebar, docs/conventions, CHANGELOG.md
---

Reworking the two transfer registers into one shared shape: a single top-bar tray shell both
Uploads and Downloads render through (so the Upload control finally names itself on hover), the
two-word empty states, and an upload history that survives the tab — a per-browser record of what
each finished batch landed, with every landed file downloadable again from the Uploads surface.
Alongside it: the sidebar's Workspace/Money/Firm groups fold away and remember it, the tool catalog
is elevated out of its two-sided sub-page into a Tools group of its own in the rail, and the build
panel's copy and repository controls take their conventional glyphs.

Do not edit in parallel: `apps/web/src/lib/navigation/destinations.ts`,
`apps/web/src/lib/navigation/sidebar-preferences.svelte.ts`,
`apps/web/src/lib/components/app-shell.svelte`, the sidebar package, and both transfer surfaces.
