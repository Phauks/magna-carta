---
category: Fixed
audience: public
---

**Every frame a meeting socket sends now spends from a budget.** The room throttled a `sync`, a
layer change, a hand and a reaction, and nothing else — so `publish`, `subscribe`, `renegotiate`,
`close` and the speaking half of `presence` could each arrive as fast as a browser could write to a
socket. The first four are a billed call to the routing service apiece, presence writes the
participant record, and every refusal emitted an unsampled telemetry event, so the cheapest thing to
send was the most expensive thing to serve. A per-socket token bucket —
`FRAME_BUDGET_PER_SECOND` (20) and `FRAME_BUDGET_BURST` (40) in `@magna-carta/meeting-protocol`,
on the wire because a client has to know the pace it is held to — is now spent in
`dispatchClientFrame` ahead of the parse, so a frame the room will not read costs it no parse
either. Over budget is `refused: rate-limited` with the socket kept open, host frames included.

Underneath it, the four acts that reach the routing service carry per-participant windows on the
existing `syncAt`/`layerAt` pattern (`publishAt`, `subscribeAt`, `renegotiateAt`, `closeAt`),
claimed past every refusal the roster can decide and ahead of the session, so a frame the room was
never going to act on spends nothing. They are refused rather than dropped because the browser is
waiting on an answer to each of them. A request to unmute carries a window kept on the member being
ASKED — two hosts taking turns would otherwise each stay inside a budget of their own — and the
budget's own refusals are sampled into telemetry on the terms the storage budget is, because a flood
recorded frame-by-frame costs more than the flood. The load harness sends six frames per socket
across a whole pass, so its pace is unchanged and its counts are unchanged.

**A room is claimed from inside it.** `claimHosting` asked only whether any OTHER grant-holder had
an open stay, so a member holding `meetings:host` who had never joined could take a live meeting
sixty seconds after the host's tunnel dropped, from outside it — and the record would show a host
nobody in the meeting had met. Nobody hands this grant over, so being in the room, or standing at
its door, is the whole of what makes taking it an act of the meeting rather than of the permission
key. Refused `meeting-not-joined`; the door case is unchanged and the claimer is still admitted by
the same batch, which is how a lobby-on meeting whose host has gone gets a host at all.

**Two smaller ones from the same review.** A reconnect no longer hands back a grant that was
withdrawn while the socket was being opened — an existing participant record keeps its own
`hostRole`, and the routes' `hostingChanged` stays the only writer of truth after the first welcome.
And the platform operator's read into a live room (`routes/meeting-inspect.ts`) is `audited: true`,
writing the operator, the firm and the meeting to the control plane's `auth_audit` before the room
is read.

## Public

**A meeting is steadier when one person's browser misbehaves.** The room now paces what a single
connection may send it, so a tab that goes haywire — or a modified client — is slowed down instead of
slowing down everybody else's video. Nobody is disconnected for it, and a browser doing the ordinary
thing will never notice.

**Nobody can take over your meeting from outside it.** Taking over a meeting whose host has
disappeared is still possible, and it still needs no one's permission — but only from somebody who
is actually in the meeting, or waiting at its door. Somebody who never joined is told to join first.

**Coming back after a dropped connection no longer restores a role that was taken away.** If your
co-host role was withdrawn while you were reconnecting, you come back without it, the way the record
says.
