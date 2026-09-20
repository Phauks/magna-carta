---
category: Added
audience: public
---

**A call is a meeting made of sound, not a video meeting with the camera off.** `meeting.medium`
(`video` | `audio`, `NOT NULL DEFAULT 'video'`, CHECK) joins the per-firm lineage as an additive
`ALTER TABLE ... ADD COLUMN` — a rebuild is impossible on a parent table, so the column carries its
own CHECK, which `packages/database/CLAUDE.md` proves is allowed there. `POST /api/v1/meetings` takes
an optional `medium`, `MeetingSummary` carries it on every read including the list, and the creation
audit row carries it as a closed-vocabulary label beside the identifiers.

**The medium is chosen at Start and never changed**, and the room is what holds that: the signaling
socket is told which kind of gathering it is off the meeting row — never off anything a browser
says — and a `publish` naming a camera or a screen share in a call is `refused` with
`track-kind-refused`, the socket kept open and nothing asked of the routing service. One meeting per
event means the first Start decides; a second Start asking for the other medium gets the room that
exists, with `created: false`, rather than switching a camera on for everybody already in it.

**Two room fixes from the same review.** The grace period after a dropped connection is now timed
per person, on the participant's own roster entry: one pending deadline for the room was a grace
period only for whoever armed it, so the second person to drop was swept while twenty seconds into
their own minute. And a stay now holds **one live socket, newest wins** — an upgrade retires the
older socket (`refused: superseded`, then a 4000 close), resets the participant to no session and no
tracks, and tells the room. That is forced by WebRTC rather than chosen: a reconnecting browser
brings a new peer connection, so it cannot resume the routing session its predecessor opened, and
carrying the old one forward left the returning member publishing where nobody was subscribed while
everybody else held a subscription to a session that would never send again — a black tile that
never resolved.

## Public

**Start a call, not just a meeting.** A calendar entry now offers **Start call** beside **Start
meeting**. A call is the same room and the same record — who was in it and when — with sound only:
no camera, no screen share, and each person appears as their name rather than a picture. Everyone
else sees **Join call** in the same place, so nobody has to work out which kind it is.

**Whoever starts it decides which it is.** A call stays a call for everyone in it; nobody can turn a
camera on partway through. If you want video instead, end the call and start a meeting.

**Coming back after a dropped connection works properly.** Reconnecting — or opening the meeting in
a new tab — now hands the room over cleanly, so your colleagues see you again instead of a tile that
never loads, and the old window tells you it has been taken over rather than going quiet.
