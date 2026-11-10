---
category: Added
audience: internal
---

**Calendar sync sends events to a member's Outlook calendar.** Each connected account has its own
sync pass, which makes the member's Outlook calendar agree with their rules: an event of a type they
chose is written to the calendar that type's rule names, an edit is sent as an update, and a
cancelled event, a removed rule or a type the firm has closed takes the copy back. Deadlines go as
whole-day entries. Where the firm allows minimal detail, only the event type and the matter number
leave. No attendees are ever sent, so Outlook emails nobody. A pass runs a few seconds after a
calendar change or a saved setting and again every six hours; an unreachable Outlook is retried,
and a refused sign-in marks the account for signing in again. One direction only: a change made in
Outlook is not read back yet, and repeating events are not sent yet. Dormant until a Microsoft
application is registered.
