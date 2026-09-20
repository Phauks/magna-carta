---
category: Fixed
audience: internal
---

**A session handle means nothing without the room that issued it.** The whole fleet's meetings run
inside one Cloudflare Realtime application, which knows nothing about meetings or firms: it will
forward any session's track to anybody presenting the application credential. The signaling room was
passing a browser's `subscribe` frame straight through, so any participant in any meeting could pull
any other meeting's media — including another firm's — by naming a session id. The room now checks
every (session, track) pair against its OWN roster and refuses the whole frame (`unknown-track`)
without asking the service anything, refuses a subscription to the asker's own session, and refuses a
`publish` whose track name does not carry the publisher's own participant handle
(`foreign-track-name`) — a name is how every other browser resolves a track to a tile, so a foreign
one puts one member's camera under another member's face. Published tracks are recorded from what the
service CONFIRMED rather than from what the browser offered, and a participant is capped at eight.

**The room now closes what it started.** Each published track's media section is kept beside its name,
which is the only handle the routing service accepts for stopping one — so leaving, ending, closing a
track, and the new grace sweep all stop the forwarding they are ending, best-effort and never
blocking the record. A closed track leaves the roster and the room is told, where before a stopped
screen share was offered to every browser that joined afterwards.

**A closed laptop now ends a stay.** Nothing closed attendance when a socket simply went away, so a
stay stayed open for the life of the record. A dropped socket with no other socket for that stay arms
a Durable Object alarm a minute out; the sweep closes the stay through the firm-scoped data-access
layer with its own `meetings.meeting.left` audit row carrying `reason: socket-lost`, drops the roster
entry and stops the media. It never ends the meeting — that is the host's act and it records who took
it. The same alarm retires the ended marker a day after a meeting closes.

**An upgrade joins a participant; it does not reset one.** A reconnect or a second tab overwrote the
participant's routing session and tracks with nulls, leaving live media nothing could name, subscribe
to or close; and closing one of two sockets removed the participant the other was still watching
through. Both are read-modify-write under the object's own gate now, and a stay survives while any
socket for it is open.

**One participant's bad luck no longer ends the meeting.** The routing session was opened inside
`blockConcurrencyWhile`, and Cloudflare terminates and resets an object whose callback throws —
dropping every socket in the room. The failure is carried out as a value and answered on the one
socket that asked, and `end()` now writes its two storage operations under one gate so no frame can
land in the window that answered "the room does not know you" for a meeting that had just ended.

**The database holds the two rules the reads cannot.** A partial unique index on
`meeting_attendance (meeting_id, user_id) WHERE left_at IS NULL` and a capacity-guarded
`INSERT … SELECT` settle the races a read-then-write is a round trip too early for: a double-clicked
Join is handed the stay the first click opened, a thirteenth simultaneous arrival is told the room is
full, and the loser of a simultaneous Start is handed the winner's room — each of which previously
surfaced as a 500 on a raw constraint.

**Signaling is refused cross-origin, failures are recorded, and the attendance record is paged.** A
browser will open a WebSocket cross-origin carrying the member's cookie where it would refuse to let
that page read any other call here, so an upgrade whose `Origin` is not this application's is now a 403. Every routing-service and relay-credential failure goes through the standard error pipeline with
an Error ID — carried on the `refused` frame so the screen can show it — and never the upstream body,
the application id or a session description. `GET /api/v1/meetings/{id}/attendance` is cursor-paged
like every other list, and the relay-credential mint has one home
(`apps/api-worker/src/realtime/turn-credentials.ts`) shared by the meeting join and the connection
tool, each deciding its own fallback.
