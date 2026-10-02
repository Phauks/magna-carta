---
category: Added
audience: internal
---

**A meeting can now be asked about after it has ended.** The room holds no rows, deletes its own
state as it goes and hibernates between frames, so a three-hundred-person meeting that went wrong
left attendance and an Error ID on whichever refusal a member happened to see. `meetings.room.*` in
`@magna-carta/telemetry`'s catalog is now the durable trace: one allowlist builder per act — joined,
welcomed, published, subscribed, layer changed, presence relayed, refused, socket lost, swept,
superseded, admitted, denied, muted, removed, locked, ended, the alarm and what it found due, a
frame's storage spend, and a browser's own report — each correlated by firm, meeting and, where the
act is about a person, stay. `apps/api-worker/src/meetings/room/room-diagnostics.ts` is the room's
one emitter and nothing may throw out of it; every other module reaches it with one call.

**The redaction is structural, not a rule at the call sites.** There is no declared field for a
display name, a track name, a session description or a chat line, so an edit cannot add one without
adding it to the catalog first, where it would have to be argued for. A test reads the whole emitted
set back as text and fails on any of them. What is left is identifiers the platform minted, counts,
closed enums and instants — the posture the custody and asset registers take, for a sharper reason:
the metadata of a law firm's meetings is a disclosure with no transcript attached.

**A refusal is sent and recorded in one call**, because a refusal recorded and not sent — or sent and
not recorded — is exactly the drift the Error ID exists to close: the member ends up holding a handle
the record does not know, and the support search the field exists for finds nothing.

**Two things are deliberately not recorded per occurrence**, because they are the frames a large room
sends most. Presence is one event per coalesced flush carrying the count it covered. What a frame
spends in storage is sampled, one frame in twenty, and is approximate under concurrency — a budget,
never a ledger, and the catalog says so.

**A browser now tells the room what its connection is doing.** `diagnostic-report` is an additive
client frame carrying quality, round trip, loss fraction, jitter, the outbound layer and the count of
inbound streams. Every field is optional — an absent measurement is "not taken", never "none" — and
every one is bounded in the schema, because it is the one frame whose whole content is an
unverifiable claim about the sender and telemetry aggregates these. The room takes one per
participant per five seconds and drops the rest in silence, keeps the last sample on the participant
record for the inspect call, and acknowledges nothing.

**`GET /api/v1/meetings/{meetingId}/inspect` reads one live room**, behind the platform-operator
guard. It is the only meeting route that names the firm in the query rather than addressing the room
by the session firm, and the reason is structural rather than convenient: its caller belongs to no
firm, so there is no session firm to read. A firm permission was rejected — a member who could read
the room's internals could read a colleague's connection quality and their place in the meeting. It
answers with the roster (role, presence, track and subscription counts, last sample), the door, the
open sockets and which stay each carries, the alarm and which of its deadlines are pending, the
storage key count and approximate size, the routing sessions and the ended marker, and it changes
nothing. A room nobody has ever addressed answers with empty lists, because that is itself the
finding.

**The room's fan-out cost is a number now.** `apps/api-worker/test/support/meeting-room-load.ts`
drives real socket pairs against the real object: everybody arrives, everybody publishes, everybody
talks at once, the gallery turns a page, a tenth of the room reconnects, the host ends it. Forty
clients run in the ordinary suite as an assertion on the two bounds; three hundred run by hand
(`VITE_MEETING_ROOM_LOAD_PARTICIPANTS=300`). At three hundred: one frame per join per socket exactly,
0.4 storage lists per frame, 414,180 frames delivered, 1,500 on the busiest socket, in twenty
seconds.

**It falsified a design claim on its first run, and found a bug.** Every deferred presence transition
armed the alarm through the full reconciliation, which reads the whole roster AND the whole door to
find the nearest deadline — two roster-wide reads on the frame a room of three hundred sends most,
measured at 1.2 storage lists per frame against a design that claims one. The deadline is already
known where the transition is deferred, so `relayPresence` now answers with it and the caller arms
for that instant; the same pass fell to 0.4. Separately, the room's direct replies to one socket
called `send` unguarded, and `send` on a closed socket throws — and a throw out of `webSocketMessage`
resets the Durable Object, dropping every socket in the meeting. A supersede, a leave or the end of a
meeting racing a queued frame would have ended the meeting for everybody in it. The room-wide
broadcast had swallowed that since it was written; every direct reply now goes through the same
`trySend`.

**A member given a grant mid-meeting is now told who is already at the door.** Every other `waiting`
frame goes out because the queue moved; this one goes out because the audience did. A co-host
appointed at the twentieth minute learned the roster had changed and nothing at all about the people
standing outside, so their lobby panel stayed empty until the next knock — which, in the case that
matters, is a meeting where the person who could let somebody in has just been appointed. An empty
door is stated rather than left silent.

**The event form can open a meeting with its lobby on.** `CalendarEventMeetingInput` takes an
optional `lobby`, read on the create path exactly as the medium beside it is. Omitted means off,
which is what every meeting scheduled before the door existed was — a form that did not ask must not
quietly put a firm's own colleagues in a queue.

**Twenty import cycles left the API worker.** Every one of them ran through `authForEnv` living in
`app.ts`, which imports every route module — so a route-specific guard that has to resolve a session
for itself (the platform-operator lane, which the per-firm chokepoint cannot serve because its caller
belongs to no firm) closed a cycle, and a second route in that lane added two more findings. It moved
to `src/auth-instance.ts`, which takes only the `Bindings` type from `app.ts`. The `import/no-cycle`
ratchet drops from 36 to 16.
