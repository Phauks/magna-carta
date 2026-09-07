---
worktree: C:/dev/magna-carta-worktrees/claude/downloads-sidebar-reorganize-niunw4
area: Downloads and Uploads move from the sidebar's Workspace group into the footer utility tray beside Settings and Customize
status: review
touches: apps/web/src/lib/navigation/{destinations.ts,sidebar-preferences.svelte.ts}, apps/web/src/lib/components/app-shell.svelte, packages/design-system/src/lib/components/sidebar/sidebar.css, docs/conventions/{design-corrections.md,file-manager-rulings.md}, docs/user/downloads.md, docs/user/features/matter-documents.md
---

The owner's ruling of 2026-09-07: the two transfer registers are meta about what the application is
doing — often both at once — rather than places in the firm's work, so they belong at the foot of the
rail with Settings and Customize, not among the destination rows. Both entries move into the
registry's existing `footerPinned` tier (until now Settings alone), which is what takes them out of
the scrolling groups AND out of Customize mode in one move. The owner then set the arrangement
within the tray: the rail's own controls lead (Settings, then Customize) and the registers lean to
the inline end on an auto margin, with Settings still leading the row outright because the collapsed
rail truncates the tray to its first icon.

Touches the sidebar CSS recipe (a comment and the tray's stated one-line rule) and the destination
registry, so a concurrent stream editing either should look here first. The top-bar download and
upload trays are deliberately untouched.
