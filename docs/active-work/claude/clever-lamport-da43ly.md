---
worktree: C:/dev/magna-carta-worktrees/claude/clever-lamport-da43ly
area: owner's UI round of 2026-09-17 — favourites star, settings shell, directory search, calendar fit, search-in-place gate
status: building
touches: apps/web/src/lib/navigation/favorite-control.svelte, apps/web/src/routes/(app)/settings, apps/web/src/lib/settings, packages/design-system/src/lib/components/navigation-layout, apps/web/src/routes/(app)/directory, apps/web/src/lib/directory, apps/api-worker/src/routes/directory.ts, packages/directory, apps/web/src/lib/calendar, packages/design-system/src/lib/components/calendar-grid, tooling/lint-workspace-search, docs/conventions/design-corrections.md, changelog.d
---

The owner's round of 2026-09-17: the favourites star loses its box; every settings page scrolls in
the one region and the settings nav folds by band and by group on the sidebar's own disclosure
pattern; the Directory searches its own table (matters included) instead of swapping in a second
results surface, and a gate keeps every Workspace screen doing the same; the calendar fits a laptop
with one scrollbar. Concurrent streams should stay off the settings shell, the directory screen and
the calendar interface until this lands.
