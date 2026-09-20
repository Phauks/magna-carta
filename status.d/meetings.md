---
slice: Meetings — members-only meetings and calls from a calendar event, in rooms of up to three hundred
group: cross-cutting
order: 45
research: n/a
spec: done by="Claude"
plan: done
built: in-progress by="Claude"
ui: in-progress by="Claude"
load-profile: n/a
tested: in-progress by="Claude"
branch: claude/focused-edison-ylxfiy
active-work: docs/active-work/claude/focused-edison-ylxfiy.md
next: Host controls — mute a participant, mute everybody, remove somebody from the room, and co-hosts to share the doing of it; a room of three hundred is the size at which a meeting needs somebody able to run it. Then external guests on a signed one-time join link, breakout rooms and a waiting room, and dial-in once the telephony port has an adapter
link-spec: docs/specs/2026-09-18-meetings-design.md
link-plan:
adrs:
blocked-by:
---

A member starts a meeting on a calendar event and other members join from the same place: media goes browser to Cloudflare Realtime selective forwarding unit, signaling is a `MeetingRoom` Durable Object per meeting, and the record keeps who was in the room and when and nothing that was said.

Slice 3 lifts the room from twelve people to three hundred, which is work on the two ends rather than in the routing service: each browser pulls video only for the tiles it shows and audio only for the people talking, cameras publish three simulcast layers and subscribers choose between them, the room sends what changed rather than the whole roster above sixteen participants, and who is talking is measured by each browser and relayed by the room.
