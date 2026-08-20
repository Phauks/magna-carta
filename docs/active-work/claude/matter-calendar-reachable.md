---
worktree: C:/dev/magna-carta-worktrees/claude/matter-calendar-reachable
area: the matter Calendar section in apps/web, and the calendar reads behind it
status: building
touches: apps/web/src/lib/matters, apps/web/src/routes/(app)/matters/[id]/calendar, apps/worker/src/routes/calendar.ts, packages/calendar/src/event-statements.ts, roadmap.d, status.d, changelog.d
---

Makes the matter Calendar section reachable: the events and deadlines already recorded against a
matter are read and shown, instead of the stub that stood there. Adds the event type's name to the
event read — the listing carried only an identifier, which a screen cannot render — through a
display-only projection, leaving the lean single-event read the lifecycle services use untouched.
Nothing here creates or edits an event; the write surfaces stay disabled and badged.
