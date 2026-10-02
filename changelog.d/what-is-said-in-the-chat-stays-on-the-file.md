---
category: Added
audience: public
---

**In-meeting chat, kept on the record** — the owner's ruling of 2026-09-20, and it makes `meeting_message`
the meeting subsystem's first stored content. Everything the record held until now was identifiers
and instants, because the audio, the video and the screen share are routed between browsers and
reach no storage here at all. A chat message is a thing somebody said, so it carries what a filed
message carries: it is retained under the matter, it is registered as personal data, and it can be
taken back.

**A message hangs from the STAY, not from the member.** Being in the room is what made it sayable,
so the row names the stay it was said from and the member is resolved through it — which means
somebody whose connection dropped and who dialled back in has each message attributed to the stay it
was actually said in, rather than to a person who was present through a gap they were absent for.
The stay is named BY VALUE (`participant_kind` + `participant_id`, no foreign key) because a
member's stay is a `meeting_attendance` row and an external guest's will be a `meeting_guest_stay`
row: `meeting_attendance.user_id` is NOT NULL, so a foreign key onto it here would have barred every
guest from chat, and relaxing that afterwards is exactly the table rebuild this schema refuses on a
table anything references. `@magna-carta/meetings` writes the literal `'member'`; nothing writes
`'guest'` yet, on the call and text log's reasoning for its own producer column.

**Taking a message back is not a delete.** `redacted_at` and `redacted_by_user_id` blank the body and
keep the row, held from both sides by a CHECK — a redacted row's body is empty and a live row's is
not — so the transcript says a message was there and that somebody removed it. A second removal
answers with the row as it stands rather than moving an instant somebody's record already carries.
The author may take back their own words and a member holding `meetings:host` may take back
anybody's, and both stay possible after the meeting has ended: the words outlive the gathering.

**Three routes** — `POST /api/v1/meetings/{meetingId}/messages` (idempotent, 201),
`GET /api/v1/meetings/{meetingId}/messages` (cursor-paged, oldest first, with `since` for a poller)
and `POST /api/v1/meetings/{meetingId}/messages/{messageId}/redact` — all on `meetings:join`, with
the host question asked inside the redaction handler because the AUTHOR may do it without holding
`meetings:host`. Every one reads the meeting through the same visible-matter gate the rest of the
subsystem composes, so a walled matter's transcript is as absent as its room. The room will later
relay a `message` frame so a message reaches the other browsers as it is said; the route is the
record either way, because a write through the socket would put the firm's record in a Durable
Object's transient storage, which empties when the room does.

**The audit rows carry identifiers, instants and a character COUNT** — never the body, and least of
all on the redaction, where an audit row recording what was removed would be the one place the
removed words survived.

## Public

**What is said in a meeting's chat now stays on the file.** Chat used to be nowhere: it did not
exist, and when it lands in other tools it usually disappears when the meeting does. Here a
conversation in a meeting on a matter is part of the matter's record, read later like any other
correspondence on the file.

**You can take back something you said**, and so can whoever is hosting. The message goes; the fact
that there was one, and that somebody removed it, stays — which is what makes the rest of the
conversation something anyone can rely on.

**The transcript reads from the beginning of the meeting**, and it is there for everyone who could
have joined, not only for the people who were typing.
