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
next: The waiting room — arrivals held in a lobby until a host admits them, one per meeting because a firm runs several at once; it hangs from the hosting grant that host controls just made real. Then external guests on a signed one-time join link, breakout rooms, and dial-in once the telephony port has an adapter
link-spec: docs/specs/2026-09-18-meetings-design.md
link-plan:
adrs:
blocked-by:
---

A member starts a meeting on a calendar event and other members join from the same place: media goes browser to Cloudflare Realtime selective forwarding unit, signaling is a `MeetingRoom` Durable Object per meeting, and the record keeps who was in the room and when and nothing that was said.

Slice 3 lifts the room from twelve people to three hundred, which is work on the two ends rather than in the routing service: each browser pulls video only for the tiles it shows and audio only for the people talking, cameras publish three simulcast layers and subscribers choose between them, the room sends what changed rather than the whole roster above sixteen participants, and who is talking is measured by each browser and relayed by the room.

Host controls follow it, because a room that size has somebody running it. Authority over a meeting is a grant on the meeting rather than a capability of a seat: the starter gets one when the room is created, co-hosts are rows beside it, hosting never passes by itself, a hostless room is claimed, and ending a meeting needs a grant like every other host act. The server half is built — the record, the routes with their audit rows, and the four frames a host sends into the room; the per-tile menu and the Host controls band are the web half.
