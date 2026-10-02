---
category: Added
audience: public
---

**A raised hand and six reactions, relayed by the room and stored nowhere.** `RosterParticipant`
gains `hand` and `handRaisedAt` — two wire fields over ONE stored fact, projected in
`room/room-roster.ts` and nowhere else — and the client `presence` frame gains an optional `hand`.
The browser decides the boolean and the room stamps the instant, for the reason a chat message's
instant is the server's: a queue ordered by what each person's machine said is not one ordering. A
host lowers one hand or all of them with `lower-hands { participantId | null }`, authorized from the
STORED participant record like every other host frame and refused `not-host` otherwise; nobody is
spared by "lower all", including the host who pressed it. A lowered or raised hand travels on a
ROSTER change rather than a frame of its own, which is what keeps a host's queue right for the
browser that joined a minute after the hand went up.

**`MEETING_REACTIONS` is a closed vocabulary of six** — `thumbs-up`, `thumbs-down`, `heart`, `laugh`,
`applause`, `celebrate` — named by meaning rather than by the glyph that draws them, so upgrading the
icon package is not a change to the meeting protocol. A `reaction` naming anything else does not
parse.

**The room coalesces above `ROSTER_DELTA_THRESHOLD`, which is the whole design.** Three hundred
people applauding one sentence is three hundred inbound frames and, relayed one by one, ninety
thousand outbound inside a second. At or below the threshold the room sends `reaction
{ participantId, name, at }` and leaves the sender out; above it, reactions accumulate into a
per-name count flushed as ONE `reactions { counts, at }` frame per second for the whole room, driven
by the next frame with the room's own alarm as the backstop. The branch is counted over the WELCOMED
SOCKETS rather than over the roster: it is choosing a fan-out, and a roster read there would spend
three hundred keys on every reaction in exactly the room the coalescing exists for. The load harness
now drives a second of applause and measures it at **one frame per socket and zero roster reads per
reaction**.

**A new refusal reason, `rate-limited`, and it is the first throttle here that refuses rather than
drops.** Every other one discards a frame inside its window, which is safe because those frames
restate themselves. A hand may be the last thing somebody does for ten minutes and a reaction is a
single act with no later frame to carry it, so both answer to `SIGNAL_INTERVAL_MILLISECONDS` —
exported from the protocol package, because a client that paced itself by a different number would be
refused for behaving correctly — and the frame inside the window is refused with the socket kept
open.

**Nothing reaches the record.** No table, no migration, no audit row and no personal-data
registration: a hand and a reaction are transient room state on the terms the roster already is,
deleted when the stay ends and when the meeting does. One event,
`meetings.room.reactionsRelayed`, carrying the count and whether it was coalesced, and no field for
which reaction it was.

## Public

**Put your hand up.** Raise your hand and everybody in the meeting sees it — and whoever is running
the room sees who is waiting, in the order the hands went up, so the floor goes round in turn instead
of to whoever speaks first. Lower it yourself, or let the host lower it when it is your turn.

**Say what you think without interrupting.** Six reactions — agree, disagree, thank you, that is
funny, well said and congratulations — appear on your tile for a few seconds. In a large meeting they
are gathered into a count instead, because "eleven people agreed" is the thing that is actually true
when three hundred people are listening.
