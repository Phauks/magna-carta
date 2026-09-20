---
worktree: (none — this stream runs in the primary checkout)
area: The calendar, owner review round: many individual calendars in folders, a day view, colours, the create gesture, and the record form's location, times and zones
status: building
touches: apps/web/src/lib/calendar, apps/web/src/routes/(app)/calendar, apps/web/test, packages/design-system/src/lib/components/calendar-grid, packages/design-system/src/stories, packages/calendar/src, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, apps/api-worker/src/routes/calendar/calendar.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src/types.gen.ts, docs/conventions/design-corrections.md, docs/specs/2026-09-02-calendar-interface-design.md, roadmap.d/calendar.md, changelog.d/, status.d/
---

The owner walked the deployed calendar and issued a round of corrections. The firm calendar stops
being one undifferentiated grid: it gains a rail of individual calendars kept in folders (the firm's
own records, the members grouped by the role the firm gave them, the rooms, and the date calendars —
custody dates and file-destruction dates), each turned on or off on its own or by its folder, each
wearing a colour the member chose. A Day view with a lane per calendar answers the day a firm has
six attorneys in four places at once. Double-clicking a day or an hour starts a record on it, and
the panel that opens carries that day's calendar in its context pane so availability is visible
while the time is being chosen. The record forms change with it: Where becomes Location, a
dropdown-with-add over the firm's offices and rooms; an online setting carries a conference link
(the one part of this that reaches the database — a nullable `conference_url` on `matter_event` and
`firm_event`); the times become time fields with the zone beside them as a shortcode; and the matter
stops being required, because an event with no matter is a firm event and that table already exists.

Two shared surfaces move and are the parts a concurrent stream should know about: the design
system's `CalendarGrid` gains a `Day` presentation, a per-entry colour and a create gesture, and the
calendar's contract gains one optional field on four request shapes, so the committed OpenAPI
snapshot and the generated client move with it.
