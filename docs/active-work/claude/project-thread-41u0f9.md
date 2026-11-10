---
worktree: /home/user/magna-carta (cloud session)
area: repeating calendar events — read-time expansion, the per-day change scopes, the Ends editor
status: review
touches: packages/calendar, packages/civil-time/src/recurrence.ts, apps/api-worker/src/http/routes/calendar, apps/web/src/lib/calendar, packages/design-system/src/lib/components/calendar-grid, apps/api-worker/openapi/openapi.json, packages/api-client
---

Paints every day a repeating event falls on and asks, on a change or a cancel, whether it reaches
this day, this and later days, or the whole series. The date-and-time picker thread owns
`record-timing-fields.svelte` and the timing defaults in `event-draft.ts`; this stream does not edit
them.
