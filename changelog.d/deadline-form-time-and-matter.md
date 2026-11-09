---
category: Fixed
audience: public
---

**Record a Deadline no longer accepts a time that is not a time, and no longer offers "No matter".** The deadline form's time was a plain text box that took anything typed into it and said nothing until the commit refused; it is now the same time-of-day control the event form uses (`apps/web/src/lib/calendar/record-deadline-dialog.svelte`). A half-typed time reports an empty value from that control, so the form reads the control's `validity.badInput` and the draft refuses it (`deadlineDraftShortfalls(draft, { timeEntryUnfinished })` in `apps/web/src/lib/calendar/deadline-draft.ts`) instead of recording the deadline as due at the end of the day, and the refusal is shown beneath the field with `aria-invalid` once the reader leaves it. The server already refused a malformed `dueAtTime` at the request contract and in `assertWallClockTime`; tests now pin both (`apps/api-worker/test/calendar-routes.test.ts`, `packages/calendar/test/deadline-service.test.ts`). The shared matter picker gains `offerNoMatter` (default on), which the deadline form turns off: a deadline is recorded only on a matter (`matter_deadline.matter_id` is `NOT NULL` and the only create route is `POST /api/v1/matters/{matterId}/deadlines`), so the list no longer offers an answer the commit then refused with "A matter is needed."

## Public

**Recording a deadline is clearer about what it needs.** The time field now takes only a time of day, and a time left half-typed is pointed out beneath the field instead of being saved as "end of day". The matter list on the deadline form no longer offers **No matter**, because every deadline belongs to a matter; pick the matter it is due on.
