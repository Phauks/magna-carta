---
worktree: (none — this stream runs in a remote checkout)
area: Moving the favourite star into the page menu on every screen header
status: review
touches: apps/web/src/lib/screen/, apps/web/src/lib/navigation/favorite-control.svelte, docs/conventions/design-corrections.md, docs/user/features/your-sidebar.md, roadmap.d/platform.md, changelog.d/
---

Moves Add to Favorites into the shared page menu (`page-actions-menu.svelte`) and removes the standalone star from `ScreenHeader`. Screens passing `pageMenu` items are unaffected.
