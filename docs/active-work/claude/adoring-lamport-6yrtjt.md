---
worktree: C:/dev/magna-carta-worktrees/claude/adoring-lamport-6yrtjt
area: The calendar's second owner round — repeating settings, then the rail, the record form and the grid
status: building
touches: packages/calendar, packages/civil-time, apps/api-worker/src/routes/calendar.ts, apps/web/src/lib/calendar, apps/web/src/routes/(app)/calendar, packages/design-system/src/lib/components/calendar-grid, roadmap.d/calendar.md, docs/user/features
---

The calendar round that follows #620. Shipping in slices: repeating settings first (the rule stored,
returned, shown and edited; the read-time expansion onto the grid is the slice after), then the
owner's second batch — collapsible folders and a pinned month picker in the rail, the screen title
and date navigation swapping places, one record form asking Matter / Firm / None instead of two
dialogs, multi-day events spanning their days, an all-day band, a participant's role as a choice, and
consolidating Book a Room with the location field.

It owns the whole of `apps/web/src/lib/calendar` and the calendar grid components; a concurrent
stream touching either will conflict. `packages/civil-time` gains `recurrence.ts` (moved out of the
web app so the form and the calendar service share one grammar), which is a new export path on a
package almost everything depends on.
