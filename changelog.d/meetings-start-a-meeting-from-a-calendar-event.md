---
category: Added
audience: public
---

**Meetings, slice 1: a members-only video meeting started from a calendar event.** Media goes from the browser to the Cloudflare Realtime selective forwarding unit and never through a Worker; a `MeetingRoom` Durable Object per meeting brokers each browser's session with the unit over hibernating WebSockets, keeps the roster and writes attendance. `@magna-carta/meetings` holds the domain half on the communications package's shape, two tables join the per-firm lineage, and the routes sit under the chokepoint behind `meetings:host` and `meetings:join`.

A meeting belongs to exactly one calendar event and carries no title, time or participant list of its own — those are the event's, read through a join — so authorization, visibility and the walled-matter question are answered once, by the event, rather than a second time by a free-standing meeting object. One meeting per event by unique index, created on demand by the first member who presses Start. The record keeps who was in the room and when, and nothing that was said: no recording, no transcript, no chat, which is what lets the feature ship before the jurisdiction consent machinery exists. Without `REALTIME_SFU_APP_ID` and `REALTIME_SFU_APP_SECRET` the create and join routes answer 503 and the calendar shows no Start control, so an unprovisioned account sees the feature dormant rather than broken. Design: [`docs/specs/2026-09-18-meetings-design.md`](../docs/specs/2026-09-18-meetings-design.md).

External guests, recording, dial-in by telephone and rooms larger than the slice-1 cap of twelve are each their own node in the feature ledger, sequenced after this one.

## Public

**Meet by video without a second subscription.** Open a calendar event and press **Start meeting**; everyone else on the event sees **Join meeting** in the same place. You see and hear each other, anyone can share a screen, and the controls are the ones you would expect: microphone, camera, share screen, leave. Whoever started it can end it for the room.

**The meeting is on the record.** When it ends, the event shows who was in the room and when each person joined and left — so the case file remembers the conference the way it remembers a document or a filed email, rather than leaving it in another company's account. Nothing said in the meeting is captured: there is no recording, no transcript and no chat log.

**What this first release does not do yet.** Only people at your firm can join — there is no way to invite a client or another party in, and no way to dial in by telephone. A meeting holds twelve people. Guide: [Meetings](../docs/user/features/meetings.md).
