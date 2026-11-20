---
category: Added
audience: public
---

**A member may share a calendar of their own Outlook or Google account as busy time.** `calendar_sync_shown_calendar` gains `share_busy` (migration `20261120T200255_a-member-shares-a-calendar-as-busy`), set through `busyCalendarRemoteIds` on the shown-calendars replace. `GET /api/v1/calendar/members/{memberUserId}/busy-time` answers one member's busy hours to anybody holding `calendar:read`; its statement selects hours only. A colleague's calendar paints each stretch as Busy and the event form's availability line counts it.

## Public

You can now let colleagues see when your own Outlook or Google calendar has you busy. Turn on Show Colleagues as Busy beside a calendar in Settings, Calendar Sync. They see the word Busy and the times, never the title or place.
