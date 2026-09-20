---
category: Added
audience: public
---

**`MAX_MEETING_PARTICIPANTS` moves from twelve to three hundred**, and the guarded insert that
actually holds the ceiling is unchanged — it binds the number as data, so the cap moved by moving one
constant. What had to be built is on the two ends of the connection rather than in the routing
service, which forwards whatever it is asked for.

**The room sends what changed.** Above `ROSTER_DELTA_THRESHOLD` (sixteen participants) every
broadcast is a new `roster-delta` frame — `{ joined, left, updated }`, with `left` carrying handles
rather than whole entries — because a full roster to three hundred sockets on every one of three
hundred arrivals is ninety thousand frames of the whole list for three hundred facts. At or below the
threshold the full `roster` frame is still sent, where the list is smaller than the bookkeeping a
difference costs. `welcome` always carries the whole roster, since a socket that has just arrived
holds nothing to apply a difference to, and a new `sync` frame is the way back to the truth for a
client that suspects a gap: the room answers that one socket with one full `roster`. Every path that
changes the roster knows who it changed, so the difference is built at the call site rather than by
comparing two lists — and a frame costs **at most one** `storage.list`, asserted in the room suite
against a three-hundred-participant roster seeded directly into the object.

**Cameras publish three layers and subscribers choose between them.** `subscribe` tracks take an
optional `preferredRid` (`f`, `h`, `q`) and a new `layer` frame changes the choice for tracks that
are already flowing — `PUT tracks/update` upstream, answered with `layered`. It is deliberately not a
second `subscribe`: the media is already arriving, and asking for it again would build a second media
section and renegotiate the connection, so a gallery page turning would cost every tile on the page a
renegotiation. Both fallbacks are `asciibetical` because the layer names sort in size order, so "the
next one along" means "the next size down" without the service being told what the names mean. A
`layer` naming a pair this room is not carrying is `refused` with `unknown-track` through the same
check a `subscribe` answers to — one function, so the two cannot drift.

**Who is talking is relayed, not measured by everybody.** A browser measures its own microphone and
sends `presence { speaking, muted }` on transitions; the room stores both on the participant, relays
a `presence` delta `{ participantId, speaking, muted, at }` to everybody else at most once per second
per participant, and carries the two booleans on `RosterParticipant` so an arriving browser sees who
is talking immediately. A transition inside the window is **dropped rather than deferred** — the
stored state stays current either way, and a presence frame carries the whole of what it is about, so
an unsent frame loses nothing a later one does not restate. Deferring would mean arming this object's
one alarm at sub-second range on a room that otherwise sleeps between a minute-long grace and a
day-long marker.

## Public

**A meeting now holds three hundred people.** The room used to stop at twelve; it now takes the same
number as the large plans of the tools firms compare it to, and the thirteenth person joining is no
longer turned away.

**It stays usable at that size.** Your browser pulls video only for the tiles it is actually showing
and sound only for the people talking, and cameras send a smaller picture to a smaller tile, so a
full room does not cost you the bandwidth of three hundred cameras. Everyone else appears as a name
tile until they are on screen.

**You can see who is talking and who is muted**, on every tile, whether or not your browser is
pulling that person's sound — and joining a meeting already in progress shows you that immediately
rather than leaving the room blank until each person next speaks.
