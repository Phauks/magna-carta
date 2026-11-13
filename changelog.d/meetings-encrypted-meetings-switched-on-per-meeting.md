---
category: Added
audience: internal
---

**A meeting can be opened end-to-end encrypted, behind a deployment switch.** Each meeting now records whether its pictures and sound are sealed end to end (`meeting.encrypted`, fixed when the room opens), and the summary, Start, scheduled meetings, personal-room sessions and a guest's arrival all carry it. Start asks for it by default, but a meeting is opened encrypted only where `MEETINGS_END_TO_END_ENCRYPTION` is `on`, which stays unset until the browsers have been tried against the live routing service. In an encrypted meeting the browser loads the MLS engine before it connects, joins the key group once the room welcomes it, and puts the SFrame transform on every sender and receiver before a frame can cross it, with video held to VP8. A browser without a frame transform is told it cannot join, before anything is captured. The room refuses key-group frames in a meeting opened in the clear (`not-encrypted`).
