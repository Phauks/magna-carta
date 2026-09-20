# Meetings — raise hand, reactions, polls and questions, design

**Status:** Design, 2026-09-20. Two slices, in this order: raise hand and reactions, then polls and questions.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the routes, the screen, the large-room work and the module structure this builds on. Nothing there is restated; where a rule of that spec decides something here it is named and used.
**Beside:** [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) — the host grant, and the rule that decides which acts are routes with audit rows and which are frames. **Both slices here depend on it**: "lower all hands" and every poll act are host acts, and a host act is a grant on the meeting rather than a permission key held by half the firm. The first slice also reads the `hostRole` that spec puts on the stored participant.
**Ledger:** the `meetings.reactions` and `meetings.polls` nodes in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).
**Owner rulings carried in:** chat is kept on the record (2026-09-20), which is the line these two slices are measured against; and a firm runs several meetings at once, so every surface here is one per meeting.

## 1. What these two slices settle

Four in-meeting tools, and the room already has everything they need except a place to put them: a **raised hand** the host works through in the order it went up, a **small closed set of reactions** anybody can throw on a tile, a **poll** a host asks the room, and a **question queue** the room asks the host. Zoom sells all four across its plans and the measurement of 2026-09-20 put each on the ledger; this is the design for the two nodes that carry them.

They are one design document and two slices because they split cleanly on the only question that matters in this subsystem: **does the meeting record keep it.** A raised hand and a reaction do not. A poll and a question do, and the poll slice is therefore the second thing this subsystem has ever stored — after chat, on chat's own terms.

## 2. The line between a signal and a record

**A raised hand is a fact about the next minute.** It exists so the person running the room knows who wants the floor, it is answered by giving them the floor or by lowering it, and when the meeting ends there is nothing left that anybody would ask about. The same is true of a reaction: somebody agreed with a sentence four seconds ago. Neither is a thing the matter file says happened.

**Chat is the contrast, and the owner ruled it the other way.** What somebody typed in a meeting on a matter is correspondence that happened inside that meeting — the parent design's chat section puts it on the call and text log's retention basis, gives it a redaction path, and registers the body as content-level residue. A poll and its answers sit on that same side: a host asked the room a question and the room answered, which is a thing the meeting produced, and a question a participant put to the room is content in exactly the sense a chat message is. So polls and questions are rows written through the firm-scoped data-access layer, with audit rows of identifiers and instants, and hands and reactions are signaling that never leaves the room.

**"Never stored" means never in the firm's record, not never held.** A raised hand is held on the stored participant between frames, like `speaking` and `muted` already are — that is the room's transient signaling state, deleted on leave, on end and when the last socket closes. The distinction matters because it is the whole reason the first slice adds no table, no migration, no personal-data registration and no audit event: there is nothing to retain, nothing to erase and nothing to redact.

**And it is the reason the first slice is cheap and the second is not.** Slice one is frames and a screen. Slice two is a lineage migration, four tables, two route files, two domain trios and a personal-data registration — because storing something is what costs, and it is charged once at the boundary rather than a little at a time.

---

# Slice one — raise hand and reactions

## 3. The raised hand

**A hand is a boolean the participant owns, and an instant the room stamps.** The browser sends `presence { speaking, muted, hand }`; the room records `handRaisedAt` on the stored participant — the instant it accepted the change, or null — and relays the change to everybody else. The person raising the hand decides the boolean; the room decides the clock, for the reason the chat transcript's `sent_at` is the server's instant: a queue ordered by what each person's own machine said is not one ordering, and the disagreement is invisible to the host reading it.

**`hand` rides the presence frame rather than a frame of its own.** It is one of the three things a tile says about a person, it is measured by the same browser that measures the other two, and a separate frame would be a second small message from the same source about the same subject at the same moment. `RosterParticipant` gains **`hand: boolean`** and **`handRaisedAt: string | null`**, so a browser that arrives late draws the marks and sorts the queue from the roster alone.

**Two fields on the wire, one fact in storage.** `hand` is `handRaisedAt !== null`, projected in `room/room-roster.ts` and nowhere else. It is carried because every tile, every roster row and every badge branches on the boolean and none of them wants to compare against null, while only the hands panel wants the instant. A derived value crossing a wire is not a second home for a fact; a second stored column would be.

**The host sees hands in the order they were raised, and the client is what sorts them.** The room relays facts and the browser arranges them — the same division the subscription policy already holds, and the same reason: a room of three hundred must not be asked to keep a sorted list in storage and rewrite it on every change. The hands panel is `roster.filter(hand).sort(by handRaisedAt)`, which is a pure derivation of what every browser already holds.

**Lowering, by three routes to the same effect.** The participant lowers their own hand with the ordinary presence frame. A host lowers one hand, or all of them, with **one client frame `lower-hands { participantId: string | null }`** — null meaning everybody — on the host-controls spec's own precedent for the hosting route: one act with different arguments rather than two frames whose invariants can drift apart. It is a **frame and not a route**, by that spec's rule: a lowered hand leaves nothing behind that anybody could later ask who did.

**A host lowering one hand tells that person who did it.** The room sends them `hands-lowered { by, at }` on the `muted { by, at }` precedent — a control that takes something away from a member without saying so reads as a broken machine. The whole-room form sends the same frame to the room with no participant named, and every browser clears every hand: three hundred cleared hands as one frame rather than three hundred presence frames, which is the same arithmetic the roster delta was built for.

**A host's own hand is not spared by "lower all".** A host clearing the floor is clearing it, and a control that skipped the person pressing it would leave the queue saying something the panel does not. This is the opposite of the mute-all rule and deliberately so: mute-all exists so a host can speak, and lower-all exists so a host can start the queue again.

## 4. The six reactions

**A closed set, named by meaning, drawn by a glyph.** `MEETING_REACTIONS` in `@magna-carta/meeting-protocol` is the whole vocabulary, and a `reaction` frame naming anything else does not parse. Closed rather than open because the alternative — a free string, or an emoji code point — would put arbitrary text on a tile in a firm's meeting, and because the product has no emoji anywhere by golden rule 2. What is on the wire is a name from this list; what is on the screen is a Lucide glyph.

| name          | what it says    | glyph, `@lucide/svelte` 1.28.0 |
| ------------- | --------------- | ------------------------------ |
| `thumbs-up`   | Agree           | `thumbs-up`                    |
| `thumbs-down` | Disagree        | `thumbs-down`                  |
| `heart`       | Thank you       | `heart`                        |
| `laugh`       | That is funny   | `laugh`                        |
| `applause`    | Well said       | `hand-heart`                   |
| `celebrate`   | Congratulations | `party-popper`                 |

**The glyph names were audited against the pinned version, and two of the six asked for do not exist.** `@lucide/svelte` is pinned at 1.28.0 in `pnpm-workspace.yaml`, and its 1,756 icons include `thumbs-up`, `thumbs-down`, `heart`, `laugh` and `party-popper` — and no clapping glyph and no surprised face at all. The nearest matches are worse than nothing: `clapperboard` is a film slate and would read as recording in a product that is about to ship recording for real, and the face set Lucide does ship (`smile`, `meh`, `annoyed`, `frown`, `angry`) has nothing for surprise, only degrees of displeasure that would say something about the speaker the sender did not choose. So **applause is drawn as `hand-heart`** — a hand offered, which is the nearest unclaimed gesture — and **surprise is not built**, its slot going to `thumbs-down`, which is unambiguous and is a thing people actually mean in a meeting.

**Two glyphs that would have been obvious are already spoken for in this product.** `sparkles` is the Assistant, in the sidebar destination and in the file workbench's AI capability; `star` is a favourite, in the navigation rail, the Directory and the office record. Reusing either for a reaction would make the same mark mean two things one screen apart.

**The wire carries the name, never the icon name, and that is the reason the two lists are separate.** Lucide renames icons: the faces pinned here as `laugh` and `smile` have already been renamed upstream to `face-grinning` and `face-slightly-smiling`, so an upgrade of the icon package would otherwise be a change to the meeting protocol. The mapping from name to glyph lives in one table in the client's reactions module, and re-choosing a drawing is a line there.

**Six, and the set is closed to growth without a decision.** Adding a seventh is a protocol change and a deliberate act, not a matter of taste — which is the point of a closed vocabulary in a place where a firm's client can be watching.

## 5. What the room relays, and what it costs at three hundred

**A reaction is relayed and never stored in the record**, so the room's whole job is fan-out. Naively that is the worst shape in the subsystem: three hundred people applauding one sentence is three hundred inbound frames and, relayed one by one, ninety thousand outbound — the same quadratic the roster delta exists to avoid, arriving in a single second.

**So the room coalesces, above the same threshold the roster does.** At or below `ROSTER_DELTA_THRESHOLD` participants the room relays `reaction { participantId, name, at }` and the bubble appears on that person's tile. Above it, individual reactions are accumulated into a per-name count and flushed as **one `reactions { counts: [{ name, count }], at }` frame per second for the whole room**. Three hundred people applauding therefore costs one frame a second, which is the design target.

**The threshold is the roster's own constant, reused rather than copied.** `ROSTER_DELTA_THRESHOLD` already means "the size above which this room stops restating individuals", which is exactly the question being asked here, and a second constant holding the same sixteen would be a second answer that somebody eventually tunes alone. If a third use lands, it is renamed once for all three.

**What coalescing costs is attribution, and that is the honest trade.** Above sixteen participants nobody can see three hundred tiles anyway — the gallery draws sixteen — so a bubble on the right face is a promise the screen cannot keep for most of the room. What the reader gets instead is the count, which is the thing that is actually true at that size: eleven people applauded.

**The flush is driven by the next frame, with the room's own alarm as the backstop.** A bucket opens on the first reaction in a window; a reaction arriving after the window has run flushes the bucket, including itself, and opens the next one. A bucket with nothing after it would otherwise sit unsent, so opening one arms the room's existing alarm at the flush instant — the alarm `room/room-lifecycle.ts` already owns, which already takes the soonest of several deadlines and re-arms for the next.

**This is a sub-second alarm, which the presence design explicitly refused, and the difference is arithmetic.** Presence refused it because every suppressed transition would re-arm the alarm and transitions arrive many times a second per person, so a room of three hundred would be woken about as often as relaying everything. A reaction bucket arms the alarm **at most once per second for the whole room**, and only while somebody is reacting — a burst of a few seconds around a sentence. During that burst the room is already being woken by the inbound frames themselves, so the extra wake is noise; between bursts there is no bucket and no deadline.

**The sender is excluded from an individual relay and included in a coalesced one.** A presence frame is not echoed to its sender and a `reaction` frame is not either, because the sender's own screen shows its own bubble the moment the button is pressed — an optimistic echo, which is what makes the control feel like a button rather than a request. A `reactions` frame goes to every socket including the reactors, because a count that excluded the reader would be a different number per socket and the room would be building three hundred frames to avoid one double-count. The client draws the two in different places — its own glyph on its own tile, the counts in the reactions strip — so nothing is counted twice on any screen.

## 6. Rate limiting: drop what restates itself, refuse what does not

**The room already throttles presence by dropping.** A transition inside the window is discarded and the stored booleans are kept current, which is safe because a presence frame carries the whole of what it is about: an unsent frame loses nothing a later one restates, and `welcome`, a `sync` answer and every roster frame read the record.

**That reasoning does not carry to a hand or a reaction, and applying it anyway would be a real defect.** A raised hand may be the last thing a participant does for ten minutes; dropped, it is never relayed at all and the host never learns that somebody wants the floor. A reaction is a single act with no later frame to restate it; dropped, it simply did not happen for anybody but its sender. So **the rule for this slice is the other one: what restates itself is dropped, what does not is refused.**

- **`speaking` and `muted`** keep the existing throttle, unchanged, dropping inside the window.
- **A change to `hand`, and every `reaction`**, are relayed immediately and are never silently discarded. A participant may send at most one of them per `MEETING_SIGNAL_INTERVAL_MILLISECONDS = 1000`; the one after that is **refused with a new reason `rate-limited`, socket kept open**, so the browser knows its act did not land and can send the settled state again when the window passes. A refusal is a worse experience than a drop by exactly one thing — the client has to handle it — and that is the price of never losing an act.
- The interval lives in `@magna-carta/meeting-protocol` rather than in the room, because it is a number both ends have to agree on: a client that paced itself differently would be refused for behaving correctly.

**A presence frame carrying only a `speaking` or `muted` change is not rate-limited by the signal window**, and a frame that changes the hand as well is governed by the window. One frame, two rules, decided by which field moved — which is legible precisely because the frame states its whole subject rather than a difference.

**`hand` is optional on the client presence frame and required on the room's.** A browser left open across the deploy goes on sending two booleans, and an absent `hand` means "this browser has nothing to say about a hand" — the stored value is left exactly as it stands. Reading absence as `false` would lower the hand of every participant who had not reloaded. Room to client the field is always present, because the room is the one writing it and a reader branching on presence is a reader with two code paths.

**A modified client cannot raise somebody else's hand or react as them.** Every frame here is attributed from the socket's own attachment, which is written once at upgrade and never trusted from the frame — the same rule that makes a track name carry its publisher's handle.

## 7. Frames — slice one

Additive in both directions, so `MEETING_PROTOCOL_VERSION` stays 1: nothing already on the wire changes shape.

Client to room:

| type          | fields                              | room does                                                                                                 |
| ------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `presence`    | `speaking`, `muted`, `hand?`        | as today, plus: stamps or clears `handRaisedAt` and relays the change outside the drop-throttle           |
| `reaction`    | `name` (one of `MEETING_REACTIONS`) | relays it, individually or into the second's bucket, and stores nothing                                   |
| `lower-hands` | `participantId` (null clears all)   | clears the stamps, tells the person or the room `hands-lowered`; host or co-host only, refused `not-host` |

Room to client:

| type            | fields                                                        |
| --------------- | ------------------------------------------------------------- |
| `presence`      | as today, plus `hand`                                         |
| `reaction`      | `participantId`, `name`, `at` — at or below the threshold     |
| `reactions`     | `counts: [{ name, count }]`, `at` — above it, once per second |
| `hands-lowered` | `by`, `participantId` (null for the room), `at`               |

**Refusal reason added:** `rate-limited`, which leaves the socket open and is about the frame that arrived, so the parser's own half of the vocabulary is unchanged and the client's fatal set does not grow. `not-host` comes from the host-controls slice and is reused here rather than duplicated.

**`RosterParticipant` gains `hand` and `handRaisedAt`,** carried on `welcome`, `roster` and `roster-delta` alike, so a `sync` and a late arrival both get the queue.

**The fitness function is what holds the ends together**: every type added above needs a handler at the far end and a sender at the near one, or `packages/meeting-protocol/test/frames-have-handlers.test.ts` fails before the merge.

## 8. The screen — slice one

**The control bar gains two controls and no more.** **Raise hand** is a toggle drawn with Lucide `hand`, reading Raise hand or Lower hand, with the raised state marked rather than merely pressed. Beside it a **reactions** control — a `DropdownMenu` on Lucide `smile`, the one unclaimed face in the set — opening a single row of the six glyphs with their words as accessible names. One press sends one frame and closes the menu, because a reaction is a thing you throw and not a mode you enter.

**A hand is marked in three places, and they are three different readers.** On the **tile**, a small corner mark, so a person looking at the gallery sees it. On the **roster row**, the same mark, because in a room of three hundred only sixteen have a tile. In the **hands panel**, the ordered queue.

**The hands panel is a `Sheet` opened from the Host controls menu**, on the lobby panel's precedent and for its reason: the roster rail is hidden below the large breakpoint, and a host on a narrow screen must still be able to work the queue. Rows carry the avatar, the name, how long the hand has been up, and two actions — **Ask to unmute** (the host-controls frame, which is almost always what a raised hand wants) and **Lower hand**. The header carries **Lower all hands**. A count badge sits on the Host controls button so a host who is not looking at the panel still learns that somebody is waiting, which is the lobby badge's own argument.

**A non-host sees no panel and no lower control**, absent rather than disabled, on the standing ruling in `meeting-controls.svelte`.

**A reaction appears on its sender's tile and rises out of it over `REACTION_DWELL_MILLISECONDS = 4000`.** The dwell is information — long enough that somebody glancing up sees it, short enough that a tile is not permanently decorated — and it is a client constant, because only the browser reads it. Several reactions on one tile stack rather than replace, bounded at a handful so a burst cannot cover a face.

**Above the threshold the counts are a strip, not bubbles.** The coalesced frame draws a short row of glyph-and-count beside the header's meta line, each entry fading on the same dwell. A count is what the room actually knows at that size.

**The motion is the design system's, and it stops under reduced motion.** The rise is a keyframe and a recipe class in `packages/design-system` beside the existing presence recipes, not raw CSS in `apps/web`, which golden rule 2 forbids anyway. Under `prefers-reduced-motion` the bubble appears and fades where it is: the dwell is information and the movement is decoration, so the decoration is what goes.

**Reactions are announced politely in a small room and not at all in a large one.** An `aria-live="polite"` region reads "Priya Raman reacted: Agree" at or below the threshold; above it a stream of changing counts is noise, so the strip is marked `aria-hidden` and the count is reachable from the reactions control's own label. A raised hand is announced either way — it is a request for the floor, and a screen reader user running the meeting must hear it.

## 9. What slice one does not write

**No table, no migration, no identifier, and no entry in `packages/data-access/src/pii-registry.ts`.** That is not an omission to be filled in later; it is the slice's whole claim. A hand and a reaction reach the room's transient storage, are relayed, and are deleted with the rest of the roster when the meeting ends.

**No audit event either.** The host-controls spec's line holds: writing an audit row for each of these would fill a matter's audit log with the mechanics of a conversation, which is the one thing this subsystem has been careful not to record. If a firm ever needs "who lowered the room's hands" on the record, the path is the one that spec names — the room already writes through the firm-scoped data-access layer for the socket-loss sweep — and it is one statement, not a redesign.

## 10. Testing — slice one

**`packages/meeting-protocol/test/`:** a `reaction` naming something outside the vocabulary is `unknown-frame` rather than `malformed-frame` only when its type is unknown, and a bad `name` on a good type is `malformed-frame`; a `presence` frame with no `hand` parses; the roster type carries both new fields.

**`apps/api-worker/test/meeting-room.test.ts`** (against the fake routing client): a hand is stamped and relayed outside the presence throttle, and a speaking transition inside the window is still dropped; a second reaction inside the signal window is `rate-limited` with the socket open; below the threshold each reaction is relayed individually and excludes its sender; above it, three hundred reactions in one second produce exactly one `reactions` frame carrying the counts, asserted on the broadcast count; a bucket with no following frame is flushed by the alarm, and the alarm's other deadlines still fire; `lower-hands` from a socket with no grant is `not-host` and changes nothing; `lower-hands` with no participant clears every stamp in one frame; a hand survives a `sync` and rides a `roster-delta`.

**`apps/web/test/`:** the client's outgoing window paces reactions and re-sends the settled hand after a `rate-limited` refusal; a `reaction` frame puts a bubble on the right tile and it clears on the dwell; a `reactions` frame draws the strip and no bubble; the hands panel orders by `handRaisedAt` and not by roster order; a non-host renders neither panel nor lower control; the reactions menu offers exactly six items, each with its word.

**Load profile:** the three-hundred-participant fixture gains a one-second applause burst, so the coalescing is measured rather than argued.

---

# Slice two — polls and questions

## 11. What a poll is, and what a question is

**A poll is a host asking the room a closed question and seeing the answers.** It is opened by a host, answered by anybody in the room, closed by a host, and it is on the record from the moment it opens — the question, the options, who answered and what the answers were.

**A question is the room asking the host.** Anybody in the room writes one, anybody upvotes one, and a host marks it answered as they work through the queue. It is content the meeting produced, on chat's terms exactly.

**Both are routes, and the room only relays.** The chat design's rule is the rule here: **the route is the record**, and the frame is a copy of a row that is already committed so the other browsers see it as it happens rather than on a poller's next tick. A write that went through the socket would put a firm's record in a Durable Object's transient storage, which empties when the room does.

**Both hang from the stay, not from the member,** carrying `participant_kind` + `participant_id` by value with no foreign key, exactly as `meeting_message` does — because a member's stay is a `meeting_attendance` row and an external guest's will be a `meeting_guest_stay` row, and a foreign key here would bar every guest from answering a poll before guests have even landed.

## 12. Schema — polls (per-firm lineage, additive)

```
meeting_poll
  id                   text pk            -- meetingPoll_ handle
  meeting_id           text not null -> meeting.id
  asked_by_user_id     text not null -> member.user_id
  question             text not null      -- MAX_MEETING_POLL_QUESTION_LENGTH = 500
  anonymous            integer not null   -- 0 | 1  (CHECK)
  max_choices          integer not null default 1   -- CHECK between 1 and MAX_MEETING_POLL_OPTIONS
  opened_at            text not null      -- instant
  closed_at            text null          -- instant
  closed_by_user_id    text null -> member.user_id
  created_at, updated_at
  CHECK (closed_at IS NULL) = (closed_by_user_id IS NULL)
  CHECK length(question) <= 500
  INDEX (meeting_id, opened_at, id)

meeting_poll_option
  id                   text pk            -- meetingPollOption_ handle
  poll_id              text not null -> meeting_poll.id
  position             integer not null   -- 0-based, the order the room sees
  label                text not null      -- MAX_MEETING_POLL_OPTION_LENGTH = 200
  CHECK length(label) <= 200
  UNIQUE (poll_id, position)

meeting_poll_respondent
  id                   text pk            -- meetingPollRespondent_ handle
  poll_id              text not null -> meeting_poll.id
  participant_kind     text not null      -- 'member' | 'guest'  (CHECK)
  participant_id       text not null      -- the stay, BY VALUE, no foreign key
  answered_at          text not null      -- instant
  UNIQUE (poll_id, participant_kind, participant_id)

meeting_poll_answer
  id                   text pk            -- meetingPollAnswer_ handle
  poll_id              text not null -> meeting_poll.id
  option_id            text not null -> meeting_poll_option.id
  participant_kind     text null          -- 'member' | 'guest'  (CHECK), null on an anonymous poll
  participant_id       text null          -- the stay, by value; null on an anonymous poll
  CHECK (participant_kind IS NULL) = (participant_id IS NULL)
  INDEX (poll_id, option_id)
```

**Options are a child table and not a JSON column, and this is the decision worth defending.** A JSON array would be smaller, it would never be queried on its own, and the options genuinely never change once a poll is open — three real arguments for the blob. The table wins on three others. **An answer must name an option that exists**, and a foreign key is the only thing that makes an answer to the seventh option of a four-option poll impossible; with JSON that check lives in the service, and the service is not the only writer a database outlives. **The tally is a read over rows**: a left join from options to answers returns every option including the ones nobody picked, in `position` order, where a JSON array forces every reader to reassemble the zeroes itself and a reader that forgets shows a poll with three bars instead of five. And **an option label is content the firm put on a screen** — it is registered in the personal-data registry as residue like any other content column, and a JSON blob would register one column whose insides no residue report can address.

**There is no draft.** A poll row exists because a host asked the room, so `opened_at` is `NOT NULL` and is set at insert. Authoring a poll before the meeting is a real feature and a different one — it wants a template that belongs to the event rather than to the room — and a nullable `opened_at` now would be a record that says a poll happened when nobody was ever asked.

**Several polls may be open at once**, and the screen shows the most recent first. One-at-a-time would need a partial unique index and would refuse the ordinary case where a host stacks two questions at the end of a briefing; nothing downstream cares how many are open.

**An answer cannot be changed.** `meeting_poll_respondent`'s unique index is the whole enforcement: one participation per stay per poll, whatever `max_choices` lets that participation contain. An answer is a thing somebody said in a meeting, on the same footing as a message, and a tally that could move backwards while it is on screen for three hundred people is a tally nobody can read. A host who wants the room asked again opens a second poll, which is also the honest record of having asked twice.

**`max_choices` is on the poll and the respondent row is what bounds a participant**, which is precisely why the two tables are split. With "choose up to three", a unique index over `(poll_id, participant)` on the answer table would be wrong — that participant legitimately has three answer rows — so the guard has to live on a row that exists once per participation. It also answers the question the screen asks on every paint, "have I answered this", with one indexed read and no scan of the answers.

## 13. Anonymity — what is promised, and what is kept

**An anonymous poll stores the answer without the participant**, and the count stays honest because the two facts are split across the two tables: `meeting_poll_answer` holds **what was chosen and nothing about who**, `meeting_poll_respondent` holds **that this stay answered and nothing about what**. The tally is a count of answer rows; the ballot-stuffing guard is the respondent table's unique index. Neither table can answer the other's question.

**The answer row carries no instant, and that is deliberate.** An `answered_at` on the answer would re-link it to the respondent row written in the same batch and to the audit row written beside it, which would make the split cosmetic. So the instant lives on the respondent row alone, for both kinds of poll — one home for "when was this answered", reached through the participation rather than through the choice. An attributed poll loses nothing by it: a participant's several answers are one act at one instant.

**The audit row never carries the option, on either kind of poll.** On an anonymous poll it would be the entire thing anonymity promises, handed to a log with its own retention and its own readers. On an attributed one it would be a copy of the record's own content in a compliance record, which is the line `@magna-carta/communications` already holds for a message body and the parent design already holds for chat. What the audit row carries is the poll, the stay and the instant.

**Anonymity here is anonymity from the product, and the screen says so in those words.** No route, no export, no frame and no audit row can name who chose what. What it is not is a secret ballot against somebody holding the raw database: rows are stored in insertion order whatever their columns say, and a sufficiently determined reader with direct access could correlate the order of the answer rows with the order of the respondent rows. Closing that would mean holding answers in the room and writing them shuffled at close, which the chat design already refused for the reason that applies twice as hard here — a record that lives only in a Durable Object's transient storage is a record that empties when the room does. So the panel reads **"Answers are not shown with names"**, which is true, rather than "anonymous", which would be a promise this keeps only most of the way.

**Participation is never secret, and the screen does not pretend otherwise.** The respondent row names the stay, the audit row names the actor, and the tally says how many answered out of how many are in the room. Being in the room is already on the record as an attendance row; only the choice is withheld.

## 14. Schema — questions

```
meeting_question
  id                   text pk            -- meetingQuestion_ handle
  meeting_id           text not null -> meeting.id
  participant_kind     text not null      -- 'member' | 'guest'  (CHECK)
  participant_id       text not null      -- the stay, BY VALUE, no foreign key
  body                 text not null      -- MAX_MEETING_QUESTION_LENGTH = 1000
  asked_at             text not null      -- instant
  answered_at          text null          -- instant
  answered_by_user_id  text null -> member.user_id
  redacted_at          text null          -- instant
  redacted_by_user_id  text null -> member.user_id
  created_at           text not null
  CHECK (answered_at IS NULL) = (answered_by_user_id IS NULL)
  CHECK (redacted_at IS NULL) = (redacted_by_user_id IS NULL)
  CHECK a redacted row's body is empty, and a live row's is not
  CHECK length(body) <= 1000
  INDEX (meeting_id, asked_at, id)

meeting_question_upvote
  id                   text pk            -- meetingQuestionUpvote_ handle
  question_id          text not null -> meeting_question.id
  participant_kind     text not null      -- 'member' | 'guest'  (CHECK)
  participant_id       text not null      -- the stay, by value
  upvoted_at           text not null      -- instant
  UNIQUE (question_id, participant_kind, participant_id)
```

**The question row is the chat row with two pairs instead of one**, and that is on purpose: a question is content said in a meeting, so it takes the redaction pair, the blanked body, the append-only rule and the two CHECKs that hold them from both sides, word for word from `meeting_message`. A second removal mechanism for the same kind of content would be a second answer to what taking something back means. The answered pair is the same shape for the same reason — a state change with no actor cannot be questioned — and it is a pair rather than a boolean because "answered by whom" is the question a firm asks of a queue months later.

**Upvotes are a child table and not a counter, which is the mirror of the options decision.** A counter column cannot answer "have I already upvoted this", which the screen must answer on every paint to draw the control, and which is the only thing that stops one person pressing it fifty times. The unique index is both that guard and that read. A counter would also be a second home for a number the moment withdrawal lands — and withdrawal is in this slice, because an upvote you cannot take back is a vote and not a signal.

**The count is computed, and the queue is bounded so it can be.** `MAX_MEETING_QUESTIONS = 500` per meeting, guarded on the insert and refused as `meeting-question-limit-reached`; a page is 100. A left join with a group-by over an indexed child table at that size is a read, not a scan, and the ceiling is there for the same reason `MAX_MEETING_LOBBY` is: a room's queue is not somewhere a firm should be able to accumulate ten thousand rows.

**The list is paged on `(asked_at, id)` and sorted in the browser.** This is the one shape here that looks wrong and is not. The panel shows the most upvoted first, so the obvious read orders by count — but a cursor walking a value that changes while the reader pages repeats rows and skips rows, and an upvote count in a live meeting changes constantly. So the keyset is the record's own stable key, the client holds the page and sorts it, and the order moves live as upvotes arrive instead of only on the next read. The ceiling is what makes it honest: five hundred questions is five pages, and a panel that holds them all is sorting what it has rather than guessing about what it does not.

**Anonymous questions are not built.** They are a second anonymity mechanism with the poll's correlation problem and no clear need in a firm's meeting, where the queue is colleagues and invited guests. Named as not built rather than left to be discovered.

## 15. Routes — polls

All under the chokepoint, `resource: "firm"` like the rest of the family, `idempotency: "required"` on every write, audited with identifiers and instants. Every host act is `meetings:host` **plus the grant**, resolved through `requireHostGrant` from the host-controls slice — the key says who may be named a host, the grant says who is running this room.

| method | path                                                  | permission              | does                                                                            |
| ------ | ----------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| POST   | `/api/v1/meetings/{meetingId}/polls`                  | `meetings:host` + grant | body `{ question, options[], anonymous, maxChoices }`; opens it                 |
| GET    | `/api/v1/meetings/{meetingId}/polls`                  | `meetings:join`         | cursor-paged, newest first, each with its tally and whether the caller answered |
| GET    | `/api/v1/meetings/{meetingId}/polls/{pollId}`         | `meetings:join`         | one poll, the same shape                                                        |
| POST   | `/api/v1/meetings/{meetingId}/polls/{pollId}/close`   | `meetings:host` + grant | closes it; a closed poll refuses answers                                        |
| POST   | `/api/v1/meetings/{meetingId}/polls/{pollId}/answers` | `meetings:join` + stay  | body `{ optionIds }`; one participation per stay                                |
| GET    | `/api/v1/meetings/{meetingId}/polls/{pollId}/answers` | `meetings:host` + grant | who answered what, paged; refused on an anonymous poll                          |

**Answering needs an OPEN STAY, not a permission.** `readOpenAttendance` is the whole check, exactly as posting a chat message is: a member who left cannot answer a poll in a meeting they are no longer in, and a member who never joined has nothing to answer from. Reading needs `meetings:join` and the event's own visibility, composed through `readMeeting` rather than a new clause — a meeting has no visibility rule of its own, and a second expression of the walled-matter question is a second place for it to be wrong.

**The attributed-answers read is refused on an anonymous poll**, `409 meeting-poll-answers-not-attributed`, rather than answering with an empty page — which would read as "nobody answered" and is the one wrong answer this route can give.

**Problem types added:** `meeting-poll-not-found` (404, and the same for a poll in a meeting the member may not reach), `meeting-poll-closed` (409), `meeting-poll-already-answered` (409), `meeting-poll-answers-not-attributed` (409), `meeting-poll-invalid` (422). The last is one type rather than four because the question's length, the option count, an option's length and `maxChoices` are one validation of one body; its `detail` names which of them failed. `meeting-not-joined` (409) and `meeting-not-host` (403) are reused from the family.

## 16. Routes — questions

| method | path                                                                     | permission              | does                                               |
| ------ | ------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------- |
| POST   | `/api/v1/meetings/{meetingId}/questions`                                 | `meetings:join` + stay  | body `{ body }`; asks one                          |
| GET    | `/api/v1/meetings/{meetingId}/questions`                                 | `meetings:join`         | cursor-paged on `(asked_at, id)`, with `since`     |
| POST   | `/api/v1/meetings/{meetingId}/questions/{questionId}/upvotes`            | `meetings:join` + stay  | one per stay, idempotent                           |
| POST   | `/api/v1/meetings/{meetingId}/questions/{questionId}/upvotes/withdrawal` | `meetings:join` + stay  | takes it back                                      |
| POST   | `/api/v1/meetings/{meetingId}/questions/{questionId}/answered`           | `meetings:host` + grant | body `{ answered }`; marks or unmarks              |
| POST   | `/api/v1/meetings/{meetingId}/questions/{questionId}/redact`             | `meetings:join`         | host or the author; blanks the body, keeps the row |

**`since` is an instant and is the caller's to send**, on the chat read's own terms: it is what a panel holds after the previous page, so the queue can be followed without re-reading it, while the cursor walks a long queue from its beginning. Both are on the same `(asked_at, id)` key, so a poll and a walk cannot disagree about where they are.

**Marking answered takes a boolean rather than being one-way.** A host works a queue fast and marks the wrong row; an act that could not be undone would leave the record saying a question was answered when it was not. Unmarking clears both halves of the pair together.

**Redaction is the author or a host**, which is chat's rule and falls out of the same comparison: a host moderates the room, a participant takes back what they said, and a guest's question has no firm member behind it so it is the host's alone.

**Problem types added:** `meeting-question-not-found` (404), `meeting-question-too-long` (422), `meeting-question-limit-reached` (409).

## 17. Frames — slice two, and why it adds no client frame

**Every act here is a route, so the browser sends nothing new on the socket.** It writes through the API and reads through the socket, and the room is told after the record commits — the `participantLeft` / `end` / `hostingChanged` precedent, in that order for the same reason: nobody is told the room changed by a write that then failed.

Room to client:

| type               | fields                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `poll-opened`      | the poll whole: `pollId`, `question`, `options[{ optionId, position, label }]`, `anonymous`, `maxChoices`, `openedAt` |
| `poll-closed`      | `pollId`, `closedAt`, the final tally                                                                                 |
| `poll-tally`       | `pollId`, `counts[{ optionId, count }]`, `respondents`, `at` — coalesced, once per second                             |
| `question-asked`   | the question whole: `questionId`, `participantId`, `body`, `askedAt`                                                  |
| `question-updated` | the question's new state — answered, unanswered or redacted                                                           |
| `question-tally`   | `[{ questionId, upvotes }]`, `at` — coalesced, once per second                                                        |

**`poll-opened` and `question-asked` carry the row whole rather than a handle,** which is the opposite of what "the route is the record" might suggest. The reason is arithmetic again: a bare handle would send three hundred browsers to the read path in the same instant a poll opens, which is the thundering herd the relay exists to prevent. Both are small and bounded — a poll is at most 500 characters plus ten labels of 200, a question at most 1,000 — so both sit far inside the 64 KB frame ceiling. A browser that misses a frame is still caught up by the paged read, which remains the record.

**The two tallies reuse the coalescing module the reactions slice builds,** for the same reason and with the same arithmetic: three hundred people answering a poll or upvoting a question in one second is three hundred facts nobody is waiting on individually, and one frame a second is the honest relay of them. `room/room-coalescing.ts` gains two more bucket kinds and no new mechanism; if it did not already exist this slice would be writing a second per-second bucket beside the first.

**The tally is computed by the route and handed to the room, never read by the room.** The room has no business reading the firm's record — it does not today, outside the socket-loss sweep — and a room computing a tally every second would be a read per second for a number the writer already had in hand. The answer write's own batch produces the new counts as one indexed aggregate over rows bounded by the room's ceiling, and the room's bucket holds the latest tally rather than a sum, so a flush sends the current truth rather than a replay.

**Room methods the routes call, after the record commits:** `pollOpened(poll)`, `pollClosed(pollId, closedAt, tally)`, `pollAnswered(pollId, tally)`, `questionAsked(question)`, `questionUpdated(question)`, `questionUpvoted(questionId, upvotes)`.

## 18. Personal data and the audit log

**Registered in `packages/data-access/src/pii-registry.ts`**, on the lines the meeting tables already sit on — a poll and a question are things that happened in a conversation the firm had on a matter:

- `meeting_poll.asked_by_user_id`, `meeting_poll.closed_by_user_id`, `meeting_question.answered_by_user_id` — `retain-under-matter`: who asked the room, who closed the question, who answered it, is provenance on a record of a gathering.
- `meeting_poll.question`, `meeting_poll_option.label`, `meeting_question.body` — `retain-under-matter`, and **content-level residue** for the residue report, exactly as `meeting_message.body` is.
- `meeting_poll_respondent.participant_id`, `meeting_poll_answer.participant_id`, `meeting_question.participant_id`, `meeting_question_upvote.participant_id` — `retain-under-matter`: the stay is who did it and the proof they were in the room, and the member resolves through `meeting_attendance.user_id`, which is registered already. The answer's is nullable and is null on every anonymous poll, which the note states so a reader does not take its absence for a gap.
- `meeting_question.redacted_by_user_id` — `pseudonymize-keep`, word for word with `meeting_message.redacted_by_user_id`: who took something back on an append-only row is attribution that is replaced at the member tombstone and never dropped.

**Audit events**, identifiers and instants only, never the question text, never an option label, never a question body and never which option was chosen: `meetings.poll.opened`, `meetings.poll.closed`, `meetings.poll.answered`, `meetings.question.asked`, `meetings.question.answered`, `meetings.question.upvoted`, `meetings.question.redacted`.

## 19. The screen — slice two

**Two panels, both `Sheet`s, both opened from the control bar.** A **Polls** control and a **Q&A** control, each with a count badge — an open poll the member has not answered, and the number of unanswered questions. A sheet rather than a section of the roster rail for the lobby panel's reason: the rail is hidden below the large breakpoint, and a member on a narrow screen must still be able to answer.

**The Polls panel, for everybody:** each poll as a card — the question, the options as a `radio-group` for one choice or `checkbox`es for several, and Answer. Once answered, or once the poll closes, the card becomes the tally: one `progress` bar per option in `position` order, the count and the share, and the line "12 of 30 answered". An anonymous poll carries the sentence **"Answers are not shown with names"** above the options, before the answer rather than after it.

**The Polls panel, for a host:** a **New poll** form at the top of the same sheet — the question, two to ten option rows that add and remove, a `switch` for "Do not show names with answers", and a `select` for how many choices a participant may make. Opening it sends one write and the panel switches to the live tally, which moves as the coalesced frames arrive. **Close poll** sits on the open poll's card, behind an `action-dialog` because a close cannot be undone and the room is mid-answer. A host of an attributed poll gets **See who answered**, which opens the paged attributed read.

**The Q&A panel:** the queue, unanswered first and most upvoted first within each group, each row carrying the asker's name, the body, an upvote control that reads its own state, and — for a host — **Mark answered** and **Redact**. An author sees Redact on their own row. The composer is a `textarea` with the thousand-character ceiling counted down, and Ask.

**Empty states say what to do, not that there is nothing.** An empty Q&A panel for a participant reads "Ask the first question"; for a host with nothing open in Polls, "Ask the room a question".

**The count badges are what make a panel nobody is looking at work.** A poll opening while the panel is shut raises a toast naming nothing but the act — "A poll is open" — once, on the lobby toast's precedent and for its reason: a badge on a control a member is not looking at is a poll nobody answers.

**Three sheets is the point at which the rail earns itself.** Chat, Polls and Q&A all want the same corner of the screen, and after this slice all three exist. Consolidating them into one tabbed side panel is named here as the next interface act in this subsystem, and it is deliberately not done inside a slice that is also landing four tables — the chat panel is another agent's file today, and a tabbed rail is a change to all three at once or it is a worse version of what it replaced.

## 20. Testing — slice two

**`packages/meetings/test/` (`node:sqlite`, on the service-test precedent):** a poll opens with its options in position order; answering needs an open stay and a member who left is refused; a second answer from the same stay is refused by the respondent index, including when `maxChoices` is three and the first act used all three; an answer to another poll's option fails at the foreign key; an anonymous poll's answer rows carry no participant and no instant while the respondent rows carry both, and the tally over the two agrees; a closed poll refuses an answer; closing writes both halves of the pair; the question ceiling refuses the five-hundred-and-first; an upvote is one per stay and withdrawal removes exactly one; marking answered and unmarking move the pair together; a redaction blanks the body and keeps the row, and a host and the author may do it where a third member may not; every audit row written here carries identifiers and instants and nothing else — the existing metadata assertion, extended, with the explicit case that no answer row's option ever reaches an audit row.

**`apps/api-worker/test/meeting-poll-routes.test.ts` and `meeting-question-routes.test.ts`:** a walled matter's meeting is 404 through every route in both files, which is the family's rule; every host route answers 403 `meeting-not-host` to a member holding the key and no grant; the attributed-answers read is 409 on an anonymous poll and paged on an attributed one; a poll body over its ceilings is 422 with the failing field in `detail`; the question page walks and `since` agrees with the cursor; the contract snapshot and the generated client are re-emitted in the same commit.

**`apps/api-worker/test/meeting-room.test.ts`:** `poll-opened` carries the poll whole and reaches every socket; three hundred answers in one second produce one `poll-tally` frame; `question-updated` carries the new state and a redacted question's frame carries an empty body; the room reads nothing from the record to build any of them.

**`apps/web/test/`:** the polls panel draws a radio group for one choice and checkboxes for several, refuses Answer past `maxChoices`, and switches to the tally on the answer; an anonymous poll shows the not-attributed sentence before the answer; the Q&A panel sorts unanswered-then-upvotes over the page it holds and re-sorts when a tally frame arrives without a re-read; the upvote control reads its own state and withdrawal returns it; a non-host sees no New poll form, no Close, no Mark answered and no See who answered.

## 21. What these slices do not do

- **Prepared polls.** A poll authored before the meeting belongs to the event, not to the room, and is a different record.
- **Poll redaction.** A poll's question and its option labels have no removal path; the answers would outlive a redacted question and leave a tally of something unreadable. If a firm needs it, it is the chat pair applied to two more columns and a decision about what happens to the answers.
- **Anonymous questions.** Section 14.
- **Exporting a poll's result to the matter file.** The rows are the record and the panel is the reading of them; a filed document of the result is a document-automation act.
- **Reactions on a chat message, and a reaction from somebody who is not in the room.** A reaction here is a signal from a stay, relayed to a room.
- **Surprise, as a reaction.** Section 4 — no glyph exists in the pinned icon set, and the nearest faces say something the sender did not choose. Revisit when Lucide ships one, which is a line in the mapping table.
- **A tabbed side panel.** Section 19.

## 22. The files each slice touches

Two agents can build each slice in parallel as long as the split below holds: **the backend agent owns `packages/` and `apps/api-worker/`, including the emitted contract and the generated client; the web agent owns `apps/web/`.** One amendment for slice one: **`packages/design-system` goes to the WEB agent**, because the only change there is the reaction's motion recipe and the backend agent touches no styling — the split's purpose is that no file appears on both lists, which this preserves. The contract is the handoff: the backend agent emits and regenerates first.

### Slice one — raise hand and reactions

Backend:

- `packages/meeting-protocol/src/types.ts` — `MEETING_REACTIONS` and `MeetingReaction`; `hand` and `handRaisedAt` on `RosterParticipant`
- `packages/meeting-protocol/src/frames.ts` — `hand` on the presence client frame (optional) and on the presence room frame; the `reaction` and `lower-hands` client frames; the `reaction`, `reactions` and `hands-lowered` builders and their entries in `MEETING_ROOM_FRAME_TYPES`; `rate-limited` in the refusal vocabulary; `MEETING_SIGNAL_INTERVAL_MILLISECONDS`
- `packages/meeting-protocol/CLAUDE.md` — the vocabulary and the drop-versus-refuse rule
- `packages/meeting-protocol/test/reaction-frames.test.ts` (new)
- `apps/api-worker/src/meetings/room/room-reactions.ts` (new) — the relay, the per-participant signal window, the threshold branch
- `apps/api-worker/src/meetings/room/room-coalescing.ts` (new) — the per-second bucket and its flush, reused by slice two
- `apps/api-worker/src/meetings/room/room-presence.ts` — the hand: the stamp, the relay outside the drop-throttle, `lower-hands`
- `apps/api-worker/src/meetings/room/room-state.ts` — `handRaisedAt` on `StoredParticipant`
- `apps/api-worker/src/meetings/room/room-roster.ts` — the projection of one stamp into two wire fields
- `apps/api-worker/src/meetings/room/room-lifecycle.ts` — the flush deadline joins the alarm's set
- `apps/api-worker/src/meetings/room/room-frames.ts` — dispatch for the two new client frames
- `apps/api-worker/src/meetings/CLAUDE.md` — the two new modules in the map
- `apps/api-worker/test/meeting-room.test.ts`
- `roadmap.d/meetings.md`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`

Web:

- `apps/web/src/lib/meetings/client/reactions.svelte.ts` (new) — the outgoing window and the re-send after a refusal, the incoming bubbles and their dwell, the counts strip
- `apps/web/src/lib/meetings/client/presence.ts` — the hand as a third fact this browser states
- `apps/web/src/lib/meetings/client/signaling.ts` — the handler per new room frame
- `apps/web/src/lib/meetings/client/meeting-client.svelte.ts` — `raiseHand()`, `lowerHand()`, `react(name)`, `lowerHands(participantId)`, and the state the screen renders
- `apps/web/src/lib/meetings/screen/meeting-reactions.svelte` (new) — the control-bar menu and the counts strip
- `apps/web/src/lib/meetings/screen/meeting-hands-panel.svelte` (new) — the host's ordered queue
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — Raise hand, the reactions menu, Lower all hands and the hands badge in the Host controls menu
- `apps/web/src/lib/meetings/screen/meeting-tile.svelte`, `meeting-roster.svelte` — the hand mark and the bubbles
- `apps/web/src/lib/meetings/screen/meeting-tiles.ts` — the hand and the live reactions in the tile model
- `packages/design-system/src/lib/styles/animations.css` and `styles/recipes/presence.css` — the rise keyframes and their recipe, reduced-motion included
- `apps/web/test/meeting-client.test.ts`, `meeting-room-page.test.ts`, `meeting-controls-harness.svelte`, a new `meeting-reactions.test.ts`
- `docs/user/features/meetings.md` — raising a hand and reacting

### Slice two — polls and questions (after)

Backend:

- `packages/database/src/per-firm-schema.ts` — `meeting_poll`, `meeting_poll_option`, `meeting_poll_respondent`, `meeting_poll_answer`, `meeting_question`, `meeting_question_upvote`
- `packages/database/drizzle/per-firm/<timestamp>_meeting-polls-and-questions.sql` and the snapshot under `packages/database/drizzle/per-firm/meta/`
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — the six handles
- `packages/data-access/src/pii-registry.ts` — the entries in section 18
- `packages/meetings/src/poll-types.ts`, `poll-statements.ts`, `poll-service.ts`, `poll-validation.ts` (new)
- `packages/meetings/src/question-types.ts`, `question-statements.ts`, `question-service.ts`, `question-validation.ts` (new)
- `packages/meetings/CLAUDE.md` — the two concerns, the respondent-versus-answer split and the anonymity rule
- `packages/meetings/test/poll-service.test.ts`, `packages/meetings/test/question-service.test.ts` (new)
- `packages/meeting-protocol/src/frames.ts` — the six room frames and their builders; no client frame
- `apps/api-worker/src/meetings/room/room-polls.ts` (new) — the six room methods over the coalescing bucket
- `apps/api-worker/src/meetings/meeting-room.ts` — the six methods the routes call
- `apps/api-worker/src/routes/meeting-polls.ts`, `apps/api-worker/src/routes/meeting-questions.ts` (new)
- `apps/api-worker/src/app.ts` — the two route bundles
- `apps/api-worker/openapi/openapi.json` (emitted) and `packages/api-client` (generated)
- `apps/api-worker/test/meeting-poll-routes.test.ts`, `meeting-question-routes.test.ts` (new), `meeting-room.test.ts`
- `roadmap.d/meetings.md`, `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`

Web:

- `apps/web/src/lib/meetings/client/polls.svelte.ts` (new) — the polls the room has opened, the caller's own answers, the live tallies
- `apps/web/src/lib/meetings/client/questions.svelte.ts` (new) — the queue, the caller's own upvotes, the browser-side sort
- `apps/web/src/lib/meetings/client/signaling.ts` — the handler per new room frame
- `apps/web/src/lib/meetings/meetings-api.ts` — the twelve reads and writes
- `apps/web/src/lib/meetings/screen/meeting-polls-panel.svelte` (new), `meeting-poll-form.svelte` (new), `meeting-questions-panel.svelte` (new)
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — the Polls and Q&A controls and their badges
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte` — the two sheets and the toast
- `apps/web/test/meeting-polls.test.ts`, `meeting-questions.test.ts` (new), `meeting-room-page.test.ts`
- `docs/user/features/meetings.md` — polls and the question queue
