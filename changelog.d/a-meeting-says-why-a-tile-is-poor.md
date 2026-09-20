---
category: Added
audience: public
---

**A meeting now says why a tile is poor, from the browser's own connection.**
`apps/web/src/lib/meetings/client/connection-quality.ts` is a pure module that reads one
`RTCStatsReport` against the reading before it — packets lost, jitter, bytes, frames and the
outbound camera's resolution and simulcast layer, with the round trip taken from the candidate pair
actually carrying the media — and turns the connection's climbing counters into rates over the
interval. `qualityOf` judges three dimensions against stated thresholds and lets the worst one
decide; nothing measured is `unknown`, which is deliberately not `good`.
`client/diagnostics.svelte.ts` samples every five seconds through an injectable timer while a
meeting is live, keeps five minutes of samples and the last sixty wire events, and answers the
quality of the local uplink and of each other participant — traced from a media section back to its
owner through the mapping the subscriptions module already keeps.

**Nothing it holds is recorded.** The samples live in the tab, go when the meeting does, and never
reach the meeting's record, which stays who was in the room and for how long. `report()` assembles
the redacted snapshot a periodic post will one day carry — participant handles, qualities, the
uplink's numbers, the event ring — and a test reads it as text to hold that no session description,
display name or track name is in it. `sendReport` is a no-op until the room has a frame to receive
it on.

**The events come through a seam, not a reference.** Signaling and subscriptions emit through a
small `DiagnosticsSink` that defaults to a no-op, so neither has to know diagnostics exist and both
still run under a test with nothing listening.

**Three room-facing fixes found in review, each with a case that fails without it.** A `subscribe`
and a `close` are now chunked at the protocol's `MAX_SUBSCRIBE_TRACKS` / `MAX_CLOSE_MIDS` the way
`layer` already was — the room refuses an over-large frame whole, so every track it named would have
stayed black. A simulcast layer is recorded as settled only when the room's `layered` names the
media section, with what the plan wants held separately, so a `layer` frame the room's window drops
is asked for again rather than leaving a tile at the wrong size. And a `sync` the room never
answered no longer latches the socket shut for the rest of the meeting: the latch lets go after two
seconds, so a later gap can ask again.

**A roster row is authoritative the moment it arrives.** The presence map is kept beside the roster
and used to be never overwritten by one, so a rejoin delta saying "not speaking" — which is what the
room sends, because it resets deferred presence on a rejoin — was ignored, and a stale speaking mark
held that person at the front of everybody's gallery with their microphone pulled. Rows a frame
actually carried now overwrite the map; rows merely carried forward in a delta's merged list do not.

## Public

**You can see how your connection is doing, and everybody else's.** A small set of bars sits beside
each person's name on their tile and in the list down the side: four bars is good, fewer is worse,
and an empty mark means nothing has been measured yet. Your own preview carries the mark too, and
that one is about what you are sending — so when everybody says you are breaking up, you can find
out whether they are right.

**Connection** in the control bar opens the numbers behind the marks: the size of the picture you are
sending, how much is going out, how much is going missing, the round trip, the same answer for each
other person in the room, and a short list of what has happened on your connection with the error
reference to quote if you report it. None of it is recorded — the measurements live in your browser
while the meeting is open and go when you close it.
