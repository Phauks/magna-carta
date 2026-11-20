---
category: Added
audience: public
---

**A member's own Outlook or Google event can be put on a matter.** `POST /api/v1/matters/{matterId}/events` takes an optional `fromAccountEvent`; the provider's event becomes the new event's synced copy through a `calendar_sync_link` row with `adopted` set (migration `20261120T211806_a-members-own-event-becomes-a-copy`), written in the same batch as the event. An adopted copy needs no rule, stays in the calendar it was made in, and is never deleted or moved by a pass. On the calendar, an own event opens a window that asks for the matter and the type.

## Public

You can now put one of your own Outlook or Google events on a matter. Press it on the Calendar, choose the matter and the type, and press Add to Matter. Your own event is kept and stays in step with the one on the matter.
