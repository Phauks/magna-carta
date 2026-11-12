---
category: Changed
audience: internal
---

**A change made in Outlook is picked up when it happens.** Each connected account now asks Microsoft
to say when anything in the member's calendar changes, and a notice brings that account's sync pass
forward to about a second away, where it used to wait for the next pass and could take six hours.
The notice is believed only by a secret the account gave Microsoft, carries nothing that is read
about the change, and is received on a new public address, `POST
/api/v1/calendar-sync/provider-notices/microsoft/{firmId}/{connectionId}`. The six-hour pass stays
as the backstop for a lost notice. A request for a pass that arrives while one is running is now
run straight after it. Dormant until a Microsoft application is registered.
