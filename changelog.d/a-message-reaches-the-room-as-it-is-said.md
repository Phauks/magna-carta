---
category: Added
audience: public
---

**The room now relays a chat message as it is said.** `MeetingRoom` gains two RPCs the chat routes
call AFTER their own writes commit, on the `participantLeft` / `end` precedent: `messageSent`
broadcasts a `message` frame carrying the whole record the list route returns, and `messageRedacted`
broadcasts `message-redacted { messageId, redactedAt }`. The route is still the record and stays the
record — the frame is a copy of a row that is already committed, the write never goes through the
socket, and a browser that misses one is caught up by the read. Both frames reach every WELCOMED
socket and never the lobby, which is structural rather than filtered: a waiting socket is never
welcomed and the broadcast skips everything that is not. **The room stores nothing about a
message** — no key, no count — and a room nobody holds a socket on is a no-op.

**And the read converges what the relay cannot.** A poller walks forward on `(sent_at, id)`, and a
redaction moves no row's position in that ordering — so a message already handed to a browser could
be taken back somewhere the poll would never look again, which the frame closes for a socket that is
open and nothing closed for one that reconnected. `GET /api/v1/meetings/{meetingId}/messages` now
carries a second array beside the page, **`redacted: [{ id, redactedAt }]`**: the messages taken back
since the caller's own `since` instant. It is populated only for a caller that says where it read to,
because a first page already carries whatever the record holds.

**One event, `meetings.room.messageRelayed`**, carrying the socket count and which of the two acts it
was. There is no declared field for the message handle and none for its body: what was said is the
transcript's to hold, under the matter's own retention, and the telemetry stream has different
readers.

## Public

**What somebody types in a meeting now appears straight away.** Chat used to arrive on the next
refresh; it now reaches everybody in the room as it is sent, and a message somebody takes back
disappears from every screen rather than lingering until the next reload. Nothing about the record
changed: the transcript is still kept with the meeting, and a removed message still leaves a note
saying one was there.

**Somebody at the door cannot see the chat.** A person waiting to be let in receives nothing that is
said inside the room — that has always been the intent, and it is now the way the relay is built
rather than something the room remembers to check.
