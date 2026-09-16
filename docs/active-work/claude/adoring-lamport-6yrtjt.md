---
worktree: (none — this stream runs in the primary checkout)
area: The calendar's rail of calendars becomes the design system's NavigationLayout, so the firm calendar is the same two-sided screen Settings, Magnus, Tools and Reports already are
status: building
touches: apps/web/src/lib/calendar/calendar-view.svelte, apps/web/src/lib/calendar/calendar-rail.svelte, apps/web/src/lib/calendar/calendar-screen.svelte, apps/web/src/lib/calendar/CLAUDE.md, docs/conventions/design-corrections.md, changelog.d/
---

The firm calendar had drawn its own left column — a `<nav>` at `w-3xs` with its own scroll region
and its own gutter — beside the grid, which is the fifth hand-rolled copy of the shape the owner
ruled on 2026-09-11 is one component. This stream puts it on `NavigationLayout`: the rail moves into
the navigation column at the standard measure, and the screen header, the toolbar and the grid move
into the content column, following the Magnus precedent (the layout takes the full height under the
top bar, so a screen's own header belongs inside it rather than above it).

`CalendarView` gains a `header` snippet for that reason, and renders the layout only where the rail
stands (`rail` and a firm-side scope). Every other host of the component — the matter section, the
rooms grid, Home's card, the record forms' day schedule — has one calendar, no rail, and keeps the
plain frame it has now; nothing about the reads, the window arithmetic or the projection changes.

Touches `design-corrections.md` (the 2026-09-11 ruling's consumer list) — coordinate before editing
that file.
