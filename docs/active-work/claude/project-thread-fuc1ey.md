---
worktree: (none — this stream runs in a remote checkout)
area: The page menu beside the favourite star on every screen header
status: review
touches: apps/web/src/lib/screen/, apps/web/src/routes/(app)/notifications, apps/web/src/routes/(app)/shipping, apps/web/src/routes/(app)/uploads, docs/conventions/design-corrections.md, docs/user/, roadmap.d/platform.md, changelog.d/
---

Adds a `…` page menu beside the star in `ScreenHeader`, with a `pageMenu` snippet for a screen's own items. Streams redesigning screen headers (tasks, notifications, Magnus, conflicts, the person screen) should pass their page-level extras through `pageMenu` rather than adding their own header overflow.
