---
worktree: cloud session
area: one date-and-time field for the calendar event form
status: building
touches: packages/design-system/src/lib/components/date-time-field, packages/design-system/src/lib/formatters, apps/web/src/lib/calendar/record-timing-fields.svelte, apps/web/src/lib/calendar/event-draft.ts, docs/conventions/design-corrections.md
---

Builds the design system's DateTimeField (a day, a time, or both in one field, with one panel holding
the month and a list of times) and puts it on the calendar event form's Starts and Ends, with the end
following the start. The recurring-events stream owns recurrence-field.svelte and entry-window.svelte;
this stream does not touch them, and keeps `draft.startsOn` unchanged.
