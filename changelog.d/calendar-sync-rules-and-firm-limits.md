---
category: Added
audience: internal
---

**Calendar sync settings: the firm's limit and each member's rules.** The firm sets, for every event
type and for deadlines, whether it may be copied to a member's own calendar and with how much detail
(a new permission, `calendar:manageSyncPolicy`, held by Owner/Admin). Each member then chooses,
inside that limit, which event types go to which of their Outlook calendars; nothing is chosen by
default, every event type has its own row, and a rule can only point at a calendar the member's
account has and can write to. Stopping a type from leaving removes every member's rule for it in the
same write. These are settings only: no event is sent yet, and both pages stay out of the settings
navigation until sync itself ships.
