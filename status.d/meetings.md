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
next: External guests on a signed one-time join link — the lobby is their door and they always wait, so the door is built and what is missing is the link. Then breakout rooms, and dial-in once the telephony port has an adapter
link-spec: docs/specs/2026-09-18-meetings-design.md
link-plan:
adrs:
blocked-by:
---

A member starts a meeting on a calendar event and other members join from the same place: media goes browser to Cloudflare Realtime selective forwarding unit, signaling is a `MeetingRoom` Durable Object per meeting, and the record keeps who was in the room and when and nothing that was said.

Slice 3 lifts the room from twelve people to three hundred, which is work on the two ends rather than in the routing service: each browser pulls video only for the tiles it shows and audio only for the people talking, cameras publish three simulcast layers and subscribers choose between them, the room sends what changed rather than the whole roster above sixteen participants, and who is talking is measured by each browser and relayed by the room.

Host controls follow it, because a room that size has somebody running it. Authority over a meeting is a grant on the meeting rather than a capability of a seat: the starter gets one when the room is created, co-hosts are rows beside it, hosting never passes by itself, a hostless room is claimed, and ending a meeting needs a grant like every other host act. The server half is built — the record, the routes with their audit rows, and the four frames a host sends into the room; the per-tile menu and the Host controls band are the web half.

The waiting room hangs from that grant, because admitting somebody is a host act. One lobby per meeting and never one per firm: a firm runs several at once, so a firm-level door would queue the people arriving at a deposition behind the people arriving at a staff briefing. An arrival at the door is a stay from the moment it knocks — the socket upgrade's ticket is an open stay, and the record has to be able to say who waited and was never let in — which split "in the room" from "has an open stay" and moved the room's capacity guard onto the admission, with a much smaller ceiling at the door. The server half is built: the columns, the lobby trio, the four routes, and the `waiting:` storage prefix that keeps a waiter structurally out of every roster rather than filtered out of it. The waiting screen, the host's lobby sheet and the switch at Start are the web half.

Diagnosability is the slice that makes a meeting answerable after it has ended, which nothing else
here can be: the room holds no rows, deletes its own state as it goes, and hibernates between frames,
so a three-hundred-person meeting that went wrong used to leave attendance and an Error ID on
whichever refusal a member happened to see. Both halves are now built. The browser measures its own
connection and says so on the wire; the room records each act it takes as one structured event
through the standard pipeline, correlated by firm, meeting and stay, with the redaction structural
rather than a rule at the call sites — there is no declared field for a name, a track or a session
description. A platform operator can read one live room through a guarded route, and a load harness
drives three hundred fake clients against the real object so the fan-out cost is a number instead of
an argument. It falsified a design claim on its first run: every deferred presence transition was
arming the alarm through a reconciliation that reads the whole roster and the whole door, which took
the room to 1.2 storage lists per frame against a design that claims one, and is now 0.4.
