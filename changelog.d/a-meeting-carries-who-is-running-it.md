---
category: Added
audience: internal
---

Host controls for meetings, as far as the server goes: who is running a room is a grant on the
meeting rather than a permission key half the firm holds.

`meetings:host` says a firm lets a member convene meetings. It could never say who is running THIS
room, because that changes while the meeting runs — hosting is handed over, co-hosts are named and
withdrawn, and the member who opened the room may have been called away an hour ago. So the meeting
record carries the answer in a new `meeting_host` table: the starter gets a grant in the same batch
as the room, a co-host is another under the same meeting, and a hand-over closes one and opens
another at one instant. A grant is CLOSED and never deleted, because the question a firm asks months
later is who was hosting when something happened, which is a question about an interval.

**Hosting does not pass on its own.** A host whose tunnel drops for ninety seconds has not stopped
hosting, and a room reassigned on a socket loss would hand a client meeting to whoever happened to
be next in the roster. What replaces it is a claim: a key-holder may take a room nobody is running,
refused the moment anybody else holding a grant is in it and audited as a claim rather than as a
hand-over, because nobody gave it.

**Ending a meeting narrows.** It was gated on the key alone, so any Attorney in the firm could close
any meeting they could see the event for, from anywhere, without being in it. It now needs a grant
like every other act here; the ordinary case is unchanged because the starter holds one, and a
key-holder closing an abandoned room claims it first, which leaves a record of exactly that.

The acts split by whether somebody could later ask who did it. Removing a participant, locking the
room and changing who is hosting are routes with audit rows; muting one person, muting the room,
asking somebody to unmute and spotlighting a participant are frames on the signaling socket, because
each is about this moment and an audit row for each would fill a matter's log with the mechanics of a
conversation. A mute closes the target's audio at the routing service rather than asking their
browser nicely — a mute the browser could decline is not a mute — and asking somebody to unmute is a
request their screen answers, never a microphone opened for them.

The room authorizes every host frame from the STORED participant record rather than from the socket's
attachment, so a co-host whose grant was withdrawn ten minutes ago stops on their next frame instead
of when their socket happens to close. No new permission key: the authority is in the grant, and the
key is narrower than it was.
