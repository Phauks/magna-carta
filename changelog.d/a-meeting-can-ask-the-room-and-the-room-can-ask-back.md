---
category: Added
audience: public
---

**Polls and a question queue, on the record on chat's own terms.** Six per-firm tables by one
additive migration — `meeting_poll`, `meeting_poll_option`, `meeting_poll_respondent`,
`meeting_poll_answer`, `meeting_question`, `meeting_question_upvote` — the poll and question trios in
`@magna-carta/meetings`, and twelve routes in `routes/meeting-polls.ts` and
`routes/meeting-questions.ts`. Every act is a route with an audit row of identifiers and instants;
opening, closing, reading who answered what and marking a question answered are host acts that ask
the GRANT on the meeting through `requireHostGrant`, so an Attorney holding `meetings:host` and no
grant is `403 meeting-not-host`. Answering, asking and upvoting need an open stay, as posting a chat
message does.

**Anonymity is two tables that cannot answer each other's question.** `meeting_poll_answer` holds what
was chosen and, on a poll that shows no names, a participant pair of literal NULLs written by a
statement that has no argument for them; `meeting_poll_respondent` holds that a stay answered, the one
instant, and nothing about what. The answer names its option as the pair `(poll_id, option_id)`
against the option table's own unique pair, so an answer to another poll's option fails at the
foreign key. One participation per member per poll — the respondent insert refuses a later stay of the
same member, not only the same stay — and no audit row ever carries the question, a label or which
option was chosen.

**Six room frames and no client frame.** `poll-opened` and `question-asked` carry the row whole so
three hundred browsers are not sent to the read at once; `poll-closed` carries the final tally;
`question-updated` the new state, with an empty body for a redaction; `poll-tally` and
`question-tally` go through the reactions' per-second bucket, extracted to
`room/room-coalescing.ts` and now shared, holding the latest count the route read rather than a sum.
A guest's socket receives every frame with its user identifiers nulled. Two telemetry events,
`meetings.room.pollRelayed` and `meetings.room.questionRelayed`, carry socket counts and nothing a
person typed. Every participant CHECK accepts `attendee` beside `member` and `guest`, and a poll and a
question carry a nullable `breakout_id` by value, both while the migration is unlanded.

## Public

**Ask the room.** Whoever is running a meeting can put a question to everybody in it — two to ten
choices, one answer each or several — and watch the answers come in. A poll can be set so answers are
not shown with names; everybody can still see how many have answered.

**Let the room ask you.** Anybody in a meeting can put a question to the host, and the rest of the
room can upvote the ones they want answered, so the most pressing rise to the top. The host marks each
one answered as they go, and anybody can take back a question they asked.
