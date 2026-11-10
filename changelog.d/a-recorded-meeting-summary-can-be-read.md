---
category: Added
audience: public
---

**Meeting recording, the summary's web half.** The Recordings panel gains a Summary column
(`recordingSummaryText` and `recordingSummaryOpens` in
`apps/web/src/lib/meetings/screen/recording-list.ts`): "Being Written", "Read", "Could Not Be
Written" or "Not Written". Pressing it opens the new summary panel
(`apps/web/src/lib/meetings/screen/summary-panel.svelte`, its words in `summary-panel.ts`), a reading
`ActionDialog` over the list on the transcript's precedent, read through
`meetingsRecordingSummaryOptions`. The text stands under one quiet line saying it is the platform's
characterization of the conversation and not a record of it; the action items are a numbered list,
each with its owner or "No owner" and its due date through the design system's civil-date formatter.
A summary being written, one that could not be written (with its Error ID), one refused for each of
its three reasons, and a ready one whose words are withheld (in the transcript panel's words) are the
design system's `EmptyState`, decided by one pure function (`summaryBody`); a summary being written
is read again every fifteen seconds while the panel is open, and the list is read again when it
settles. **Create Task** makes nothing on its own press: it opens a `New Task` confirmation naming
who the task will be assigned to, with a box to take the owner's name off (refused, with the reason,
where the member holds neither the item nor the key to assign), and only its commit calls the task
route with a fresh idempotency key; the made task links to `/matters/{matterId}/tasks?entry={taskId}`
(`taskAddress` in `meetings-api.ts`), a task somebody else made first is said on the row and linked,
and any other refusal stands in the confirmation. **Re-run** is offered only where the session holds
`meetings:host`, behind a destructive confirmation saying the text and action items are replaced and
tasks already made are kept. Summary and action-item text is drawn and nowhere else: not logged, not
in an address, not in a failure report. Tests: `apps/web/test/meeting-summary.test.ts` and the
Summary column in `meeting-recording-list.test.ts`.

## Public

**Read a recorded meeting's summary.** Once a recording's transcript is ready, the Recordings list
shows where its summary stands, and a ready one opens right there: a short account of the meeting,
marked as the platform's characterization rather than a record of what was said, and the action items
people agreed to, each with who it belongs to and when it is due. **Create Task** shows you the task
and who it will be assigned to before anything is made, and lets you leave the owner's name off; the
item then links to the task on the matter. When a summary was not written, it says why: summaries
switched off, AI processing not switched on for the firm, or nothing said. Somebody who can host
meetings can write a summary again with **Re-run**; tasks already made are kept.
