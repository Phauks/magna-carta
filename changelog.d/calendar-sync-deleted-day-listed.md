---
category: Added
audience: public
---

**One day of a repeating event deleted in a member's own calendar is listed for them and cancels nothing.** After a pass has nothing left to send it asks each series copy for its deleted days (`listSeriesDeletedDays` on the calendar sync port: Google's `instances` with `showDeleted=true`, Graph's `cancelledOccurrences`) and records each as a row in the new per-firm table `connection_sync_day_issue` (migration `20261119T191608_a-deleted-day-of-a-repeating-event-is-a-question`). The issue list carries `occurrenceOn` and `canPutBack`, and the put-back and leave routes take an optional `occurrenceOn` query. Put Back is offered only where the provider gives a handle for the day (Google); the next pass calls `restoreSeriesDay`. Neither provider call has run against the live service.

## Public

If you delete one day of a repeating event in Outlook or Google, Calendar Sync now lists that day so you can decide what to do. Nothing is called off in Magna Carta. With Google you can put the day back from that page.
