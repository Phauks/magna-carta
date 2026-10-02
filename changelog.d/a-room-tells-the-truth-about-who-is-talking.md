---
category: Fixed
audience: internal
---

The second wave of Meetings came back from review with seven defects that share one shape: a decision
made from a read that was already stale by the time it was acted on, or a frame nobody was counting.

**A held-back presence transition is now relayed, not dropped.** The room throttles how often one
person's speaking and muted state is relayed, which is what makes a room of three hundred
affordable — but the transition inside the window was discarded outright, and the last transition of
a burst is the one that is still true. A one-word answer left somebody `speaking: true` on every
other screen until they next spoke; a quick mute and unmute left them shown muted for the rest of the
meeting. A suppressed transition now raises `presenceDirty` and arms the room's alarm for the end of
its window, and the alarm relays what is stored. The room's one alarm reconciles three deadlines
where it reconciled two.

**A cancelled event can no longer end a meeting somebody is in.** The cancel read the meeting a round
trip before it committed, and the statement it composed matched `status <> 'ended'` — so a member who
joined in between had the room closed under them by somebody editing a calendar, with the room itself
never told, and a host who ended it in the same window turned the cancel into a server error. The
closing now carries its own precondition (`status = 'scheduled'`, no open stay) and its own guard
label, so the batch rolls back whole and the route answers the 409 it answers from the pre-read —
or, when the host got there first, treats the closing as a no-op and lets the cancellation through.

**Opening a room from the event form asks for `meetings:host`.** The four event mutations ride
`calendar:manage`, which is the key for keeping a diary; a `meeting` field on the form convenes a
gathering, which is a meetings act by another door. Refused with a 403 about that field alone — the
event still records. Cancelling stays on the diary key, because after the fix above a cancellation
can only ever close a room nobody walked into.

**A poller following a chat no longer loses a message to a tie.** `since` was a strict comparison on
an instant, so the second of two messages stamped the same millisecond was gone for that reader
permanently. The continuation is now the `(sent_at, id)` keyset every other list walks: the read
takes `sinceId` beside `since`, and the last page carries a `nextCursor` as a POSITION rather than a
has-more flag, which is what a screen following a live meeting actually needs.

**The words of a chat message are no longer stored in the idempotency record.** That row is replayed
verbatim to whoever retries the key and is not part of the record a redaction reaches, so a retried
send would have served text a member had already taken back. The record's own fields are stored and
the words are not; a first answer is read back off the row.

**Two members taking the same message back together are both answered.** The loser of the race met
the redaction's guard and was handed an Error ID for a message that is, in fact, gone.

**And three costs nobody was counting.** `sync` and `layer` are now throttled per participant, the
way presence is — one whole-roster answer a second and one layer change a quarter second, because a
browser can send either as fast as it can write to a socket and each costs the room a read of every
key it holds or a call to the routing service. A layer change is refused unless it names a media
section the room actually subscribed for that browser, which the roster check it passed never
constrained. A broadcast skips a socket that has been accepted and not yet welcomed, so concurrent
arrivals no longer set every new browser asking for the whole roster at once. And resolving who is
connected walks the sockets once a pass rather than once a participant — ninety thousand attachment
reads per alarm in a full room, before.

The protocol package's frames-have-handlers scan was reading for the frame's name anywhere in a
side's sources, which passes for six frames whose names appear in a type alias or a meeting state; it
now parses the dispatch on each side and compares the set both ways.
