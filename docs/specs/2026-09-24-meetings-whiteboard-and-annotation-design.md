# Meetings — a shared whiteboard, and annotation over a shared screen, design

**Status:** Design, 2026-09-24. Three slices, in this order: the board, filing the board, annotation over a shared screen.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the frame budget, the large-room rules, the module structure, and in-meeting chat, whose record terms this design takes for the board. Nothing there is restated; where a rule of that spec decides something here it is named and used.
**Beside:** [`2026-09-20-meetings-reactions-and-polls-design.md`](2026-09-20-meetings-reactions-and-polls-design.md) — the line between what the room relays and what the record keeps, the drop-versus-refuse rule, and the per-second coalescing a large room is built on. [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) — the host grant, and the rule that decides which acts are routes with audit rows and which are frames. [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) — the guest stay, which may draw and may not do much else. [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md) — the precedent for filing something a meeting produced into the matter through the untrusted-file pipeline, and for a firm meeting that has nowhere to file.
**Ledger:** the `meetings.whiteboard` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).
**Owner rulings carried in:** chat is kept on the record (2026-09-20), which is the line a board is measured against; a firm runs several meetings at once, so every board belongs to one meeting and never to the firm.

## 1. What this settles

A member opens a **whiteboard** in a meeting and everybody in the room draws on it together: pen, highlighter, lines, arrows, boxes, ellipses and short text, in a closed set of inks. A member sharing a screen lets the room **annotate** it, and every browser draws those marks over its own picture of the shared screen. When the meeting ends — or earlier, when a host asks — the board is **filed into the matter** as an SVG and a one-page PDF through the same untrusted-file pipeline every uploaded document goes through.

Eight decisions carry the design, and the rest follows from them.

1. **A board is an append-only log of typed operations, and the room is the ordering authority.** Not a CRDT. The room already exists, is single-threaded, and is the one place every socket in a meeting meets; it stamps a sequence number on each operation it accepts, and every browser folds the same log in the same order into the same picture. Erase, clear and undo are operations in the log, never edits to it.
2. **During the meeting the log lives in the room's own storage, as a chunked keyspace behind one index key**, bounded in bytes, in operations and in boards per room. It is the first content the room itself holds, and it holds it only until the board is filed.
3. **A stroke in progress is relayed and never stored; a finished stroke is stored and sequenced.** A cursor, a laser pointer and the growing tail of a stroke are presence, on the reactions design's terms. What a late arrival needs is only what was finished.
4. **Every frame fits the existing budgets.** The socket's twenty frames a second, the sixty-four-kilobyte frame ceiling and the one-list-per-frame rule are unchanged: the browser paces its board frames well under the first, simplifies and splits a long stroke to fit under the second, and an appended operation costs the room two key reads and two key writes and no list.
5. **What is filed is the board as it stands**, built from typed operations into an SVG and a PDF page, on chat's retention and personal-data terms. The SVG is written by a typed builder, so nothing a participant drew or typed can become markup; the PDF is written by the platform's own pure-Rust PDF engine.
6. **The composite of a shared screen and its annotations exists only in each browser.** No server decodes the presenter's video — there is no memory-safe way to — so the filed record of an annotated screen is the annotation layer alone, plus a still picture of the screen **only when the presenter's own browser captures it and the presenter says yes**, for that filing.
7. **Everybody in the room may draw by default, and a host can restrict drawing to presenters** — the hosts, and whoever opened the board or is sharing the screen under it. Guests draw when everybody may.
8. **The renderer is the design system's own**, a Canvas 2D surface written in TypeScript and styled through tokens and recipes. tldraw and Excalidraw were measured and are not taken: one is not open source and needs a paid key in production, both are React components carrying their own stylesheets, and neither can be dressed by this design system without raw CSS.

## 2. What it is not

- **A document editor.** No moving, resizing or restyling an element once drawn, no pages, no images or files placed on the board, no sticky notes, no zoom or pan. Each is a new operation kind and a new question about the fold; section 19 names them.
- **An overlay on the presenter's actual desktop.** The presenter sees the annotations over their own screen tile in the meeting, not over the application they are sharing. An overlay drawn over the operating system is a desktop-shell capability with no web equivalent, which the parity rule does not allow as a feature.
- **A record of everything anybody ever drew.** What was erased before a board was filed is not in the file, exactly as a physical whiteboard photographed at the end of a meeting does not show what was wiped off it at the start. Section 8 argues this and section 19 names it as the owner's to revisit.
- **A recording.** A board is not in the audio recording, and a recording is not on a board.

## 3. The drawing model

### 3.1 Why an ordered log and not a CRDT

A CRDT — Yjs and Automerge are the two worth naming, and both are memory-safe (TypeScript, and Rust compiled to WebAssembly) — solves convergence **without** an ordering authority: every replica merges every other replica's updates in any order and arrives at the same document. That is the right tool for peers that cannot agree on an order, offline editing, or a document that outlives any server. None of those is this problem. A meeting has one Durable Object that every socket already talks to, that processes one frame at a time, and that already stamps the room's instant on every fact it relays (the hand, the chat line, the reaction). A total order is free here, and a fold over a totally ordered log is a thirty-line pure function with no tombstone growth, no vector clocks and no merge semantics for anybody to misread.

**The decisive reason is validation, not simplicity.** A CRDT update is an opaque binary produced by the sender's replica. The room could relay it but could not bound it — could not say "this stroke has at most fifteen hundred points and every one of them is on the board", could not refuse an update that claims to be somebody else's, and could not count what a board costs without decoding the library's own encoding. This protocol refuses binary frames outright and validates every frame against a schema, and a whiteboard is exactly the kind of untrusted, high-rate input that rule exists for. A typed operation is something the room reads field by field before it keeps it.

### 3.2 The operations

Six kinds, declared in `@magna-carta/meeting-protocol` because both ends have to agree on them byte for byte. Every operation carries an `operationId` of the form `<stay handle>:<epoch>:<counter>` — the sender's own stay handle, a random epoch minted once per page load, and a counter that rises by one per operation — so an operation can be named before the room has sequenced it and a resend after a reconnect names the same thing.

| kind      | fields                                                                                  | draws or does                                                                |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `stroke`  | `tool` (`pen` \| `highlighter`), `ink`, `width`, `points` (delta-encoded integer pairs) | a freehand line                                                              |
| `shape`   | `shape` (`line` \| `arrow` \| `rectangle` \| `ellipse`), `ink`, `width`, `from`, `to`   | a figure fixed by two corners                                                |
| `text`    | `ink`, `size` (`small` \| `medium` \| `large`), `at`, `text` (at most 500 characters)   | plain text, top-left anchored, broken only where the writer typed a new line |
| `erase`   | `targets` (1 to 256 operation ids)                                                      | hides those elements                                                         |
| `clear`   | `throughSequence`                                                                       | hides every element at or below that sequence                                |
| `restore` | `reverts` (the operation id of one `erase` or `clear`)                                  | undoes exactly what that erase or clear hid                                  |

**Coordinates are integers in board units, never pixels.** A whiteboard is `BOARD_WIDTH_UNITS = 16000` by `BOARD_HEIGHT_UNITS = 9000`; an annotation board takes the shared picture's shape with its long side at 16000 (section 7). Every browser maps its own rendering onto those units, so a stroke lands in the same place on a phone and on a projector. **Points are delta-encoded**: the first pair absolute, every later pair the difference from the one before, which is what keeps an ordinary stroke to a few bytes a point in JSON. The room decodes the deltas as it validates them and refuses a stroke any of whose points leaves the board.

**Inks, widths, tools, shapes and sizes are closed sets named by meaning**, on the reactions precedent: `BOARD_INKS = ["ink", "red", "blue", "green", "amber", "violet"]`, `BOARD_WIDTHS = ["fine", "medium", "bold"]`. The wire carries a name; what that name looks like is the design tokens' (section 11). A free colour string would put an arbitrary value on every screen in a firm's meeting and into the filed document, and it would be the one attribute in the export whose content came from the sender.

### 3.3 The fold

The fold is a pure function in a new package, `@magna-carta/whiteboard`, and it is the whole definition of what a board shows. It takes the log in sequence order and keeps three things: the elements (each with its sequence, its author's stay and whether it is hidden), what each erase or clear actually hid, and the set of operation ids already applied.

- **An operation id already applied is ignored, whatever its kind.** This is what makes a resend harmless: a stroke the room accepted, whose confirmation the browser never saw, comes back after the reconnect, is appended a second time, and changes nothing. The room also skips an obvious duplicate before appending it (section 4.2), but correctness does not rest on that.
- **A `stroke`, `shape` or `text` adds a visible element.**
- **An `erase` hides whichever of its targets are present and visible, and records exactly that set as its effect.** A target that is already hidden is not in the effect.
- **A `clear` hides every present, visible element whose sequence is at or below `throughSequence`, and records that set.** Naming the sequence rather than "everything" is what makes a clear mean the same thing on every screen: it wipes what its sender could see, and a stroke that landed a moment after is left standing.
- **A `restore` un-hides exactly the effect of the erase or clear it names, then forgets that effect**, so a second restore of the same erase does nothing. It reverses what that act did and nothing more — an element a later erase also targeted while it was already hidden comes back, because the later erase hid nothing. That is the rule chosen because it is the one every browser can apply from the log alone.

Every browser folding the same log in the same order holds the same picture. That is the convergence property, and section 16 tests it as a pure function against every ordering a socket can actually produce.

### 3.4 Undo

**Undo is per participant and is expressed as operations, never as removal from the log.** A browser keeps an undo stack of its own acts on each board: undoing a stroke sends an `erase` of it, undoing an erase or a clear sends a `restore` of it, and redoing either sends the inverse again (a fresh `erase`, since a restore cannot be restored). A stroke long enough to be split into several operations (section 5.4) is one entry on the stack and one `erase` naming every part. The stack holds a hundred entries, is lost when the page reloads, and never reaches the wire as anything but ordinary operations — so the room has no concept of undo to get wrong.

**Anybody allowed to draw may erase anything and restore anything.** A shared board where only an author may remove their own mark is a board a meeting cannot tidy. A `clear` is the exception, and it is a presenter act (section 6): wiping the board is running the meeting.

### 3.5 Ordering, reconnection and late arrival

**The browser draws its own act at once and reconciles when the room answers.** What a browser shows is the fold of the confirmed log with its own pending operations applied on top. When the room's `board-operations` frame arrives carrying one of those ids, the operation moves from pending to confirmed; the picture changes only where somebody else's operation landed between the two. A round trip is paid on every stroke and seen on none.

**Frames arrive in order on one socket, and the applier still does not assume it.** A catch-up answer and a live broadcast can interleave. The client applier (`sequence-applier.ts` in the whiteboard package, pure) holds operations by sequence, applies the contiguous run, ignores what it already has, and asks for a catch-up from its last contiguous sequence when a gap has stood for two seconds.

**A reconnecting browser asks for what it missed and re-sends what it never saw confirmed.** After the new socket's `welcome`, it sends `board-sync` for each open board from its own last sequence, then re-sends its pending operations. The ids make the re-send idempotent.

**A late arrival is a reconnecting browser that has missed everything.** It learns the open boards from the room state on its `welcome` and syncs each from sequence zero. The catch-up is the log itself: the room's sealed chunks are immutable and are, taken together, a snapshot of the board through the last sequence each holds; the open chunk is the tail.

**No folded snapshot is built, and that is a decision.** A snapshot that dropped hidden elements would be smaller only by what had been erased, and it would make every erase before it unrestorable — an undo that works or fails depending on when the room last compacted. A snapshot that kept hidden elements to stay restorable is the log with its erase operations rewritten, and no smaller. With the log bounded at four mebibytes (section 4), the largest possible catch-up is a few seconds on an ordinary connection and a typical one is a few tens of kilobytes. Compaction waits until the load profile says it is needed.

## 4. Where the log lives during the meeting

### 4.1 The room's own storage, and why not the firm's record

**Every operation through a route would put a busy whiteboard on the firm's database.** The chat design's rule is that the route is the record, and for a message that is right: a message is a deliberate act a few times a minute. A drawer produces an operation per stroke, several a second, and the firm's database is one Durable Object per firm through which every other request in that firm is served. A whiteboard in one meeting would be felt in every file listing and every time entry the firm made while it was in use.

**So the room holds the log, and the record is what it is filed as.** This is the first content the room itself holds — until now the wrangler note on the binding, and this directory's area note, could say that nothing anybody said is ever in the room's storage, because chat is relayed and never stored there. Both notes change in the first slice. What makes it acceptable is that the holding is bounded in size (below), bounded in time (until filed, or a day after a firm meeting ends), never read by telemetry or by the operator's inspect call, and deleted with the rest of the room.

### 4.2 The keyspace

```
board-index                         one key: every board this room holds
  boards: {
    <boardId>: {
      kind              'whiteboard' | 'annotation'
      presenterId       the stay that opened it, or whose screen it is over
      sharedTrackName   annotation only: the screen track it is over
      widthUnits, heightUnits
      openedAt
      live              false once closed, or once the screen under it has stopped
      latestSequence
      byteCount, operationCount
      sealedChunks      how many chunks are full and will never change
      relayedThrough    the last sequence broadcast (the coalescing cursor, section 5.3)
      counters: { <stay>:<epoch>: highest counter accepted }   best-effort duplicate skip
      awaitingFiling    true between the meeting ending and the room being told it is filed
    }
  }
drawing-policy                      one key: 'everyone' | 'presenters'
board:<boardId>:chunk:<n, zero-padded>   the operations, in sequence order, each chunk at most 128 KiB
```

**One index key, never a list, on every frame that draws.** Appending an operations frame reads the index and the open chunk, assigns sequences, and writes both back — two reads and two writes, under `blockConcurrencyWhile` on the reactions bucket's precedent, because two frames arriving together would otherwise both take the same sequence. No frame that draws lists anything, which keeps the room's economy rule intact: the roster is still read at most once per frame, and a board frame does not read it at all unless the policy makes it ask (section 6).

**A chunk is sealed when the next append would carry it past `BOARD_CHUNK_BYTES = 128 KiB`**, and a sealed chunk is never written again. The open chunk is the only value rewritten, so the cost of an append does not grow with the board. A catch-up is ONE list over `board:<boardId>:chunk:` and nothing else.

**The ceilings, all the room's own and none on the wire:**

| constant               | value   | what it bounds                                                               |
| ---------------------- | ------- | ---------------------------------------------------------------------------- |
| `MAX_BOARD_BYTES`      | 4 MiB   | one board's log, measured as the operations' encoded bytes                   |
| `MAX_BOARD_OPERATIONS` | 20,000  | one board's operation count, so a flood of tiny operations meets a bound too |
| `MAX_MEETING_BOARDS`   | 16      | boards opened in one meeting, whiteboards and annotation boards together     |
| `BOARD_CHUNK_BYTES`    | 128 KiB | one stored value, far under the storage value ceiling                        |

A room at every ceiling holds sixty-four mebibytes of operations, far inside what one Durable Object stores. **A full board refuses the next frame with `board-full`, socket kept open**, and the screen says what to do: file it and open a new one. A clear does not free space — the log is append-only and a cleared board is still a board somebody might restore.

### 4.3 When the log goes

- **A matter meeting's boards are kept until they are filed.** Ending a meeting today deletes every key the room holds. After this design it deletes every key except the board index and the chunks of boards the end route has asked to be filed, marks each of those `awaitingFiling`, and the filing consumer's `boardFiled` call (section 8.4) deletes a board's keys once its documents are committed. If nothing ever arrives — the queue dead-letters, say — the room's alarm deletes them `BOARD_RETENTION_AFTER_END_HOURS = 72` after the meeting ended and records that it did, and the filing row stands at `failed` for somebody to see. The alarm already carries several deadlines; this is one more, reconciled in `armAlarm` like the reaction bucket.
- **A firm meeting's boards go with the meeting.** A firm event has no matter, and `initiateUpload` requires one, so there is nowhere to file — the recording design reached the same fact. The board opens with a line saying so ("This board is not kept after the meeting"), and a member may download it as an SVG or a PDF built in their own browser (section 8.5).
- **A board closed during a meeting** keeps its log until its filing completes in a matter meeting, and loses it at once in a firm meeting.

## 5. Frames

Additive in both directions, so `MEETING_PROTOCOL_VERSION` stays 1. Every new type is added to `@magna-carta/meeting-protocol` first, and the fitness function in that package then fails until the room's dispatch and the browser's receive switch both name it.

### 5.1 Client to room

| type               | fields                                                                                                            | room does                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `board-operations` | `boardId`, `operations` (1 to 32)                                                                                 | validates, sequences, appends, relays; refused `rate-limited` inside its window                  |
| `board-pointer`    | `boardId`, `x`, `y` (null when the pointer left the board), `mode` (`cursor` \| `laser` \| `drawing`), `preview?` | relays it; stores nothing; dropped silently inside its window                                    |
| `board-sync`       | `boardId`, `afterSequence`                                                                                        | answers this socket alone with the operations after that sequence; dropped inside its window     |
| `drawing-policy`   | `policy` (`everyone` \| `presenters`)                                                                             | host or co-host only, refused `not-host`; stores the room-level fact and broadcasts `room-state` |

A `preview` on a pointer frame is the growing tail of a stroke not yet finished: `{ operationId, tool, ink, width, from, points }`, where `from` is the index of the first point carried. A receiver appends when `from` is exactly the number of points it already holds for that preview, and otherwise discards the preview until the finished stroke arrives in the log. A dropped pointer frame therefore costs a gap in somebody's preview for a fraction of a second, and the finished stroke replaces the preview whole.

### 5.2 Room to client

| type               | fields                                                                                                         | reaches                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `board-operations` | `boardId`, `operations: [{ sequence, participantId, at, operation }]`, `latestSequence`, `catchUp`, `complete` | every welcomed socket, the sender included; one socket for a catch-up |
| `board-pointer`    | `boardId`, `participantId`, `x`, `y`, `mode`, `preview?`, `at`                                                 | every welcomed socket but the sender                                  |
| `board-filing`     | `boardId`, `filingId`, `state`, `at`                                                                           | every welcomed socket                                                 |

**The sender receives its own operations back, and that is the confirmation.** One payload is built for the room rather than a second acknowledgement frame for the sender — the sender matches its pending operations by id, and a frame that excluded it would need a second frame carrying the sequences anyway. Nothing on these frames names a firm user: `participantId` is a stay handle, which a guest's roster already carries, so the one payload serves a guest's socket as it serves a member's and needs no per-viewer build.

**`room-state` gains two fields**, `drawing` (the policy) and `boards` — each open board's `boardId`, `kind`, `presenterId`, `sharedTrackName`, `widthUnits`, `heightUnits` and `openedAt`. The whole state is broadcast when a board opens or closes and when the policy changes, and rides the `welcome` inline, which is exactly how a late arrival learns which boards to sync. At most sixteen entries, so the whole list is cheaper than a difference, on the spotlight's own reasoning. A sequence number never rides the room state: it changes on every operation and belongs on the operations frame.

**A catch-up is streamed, not paged by request.** One `board-sync` is answered with as many `board-operations` frames as the log after that sequence needs, each packed under `BOARD_FRAME_TARGET_BYTES`, the last marked `complete`. The alternative — a request per page — would put a board's worth of requests through the drop window below.

### 5.3 Pacing, the budget, and a room of three hundred

The socket's general budget is twenty frames a second with a burst of forty, and presence, layer changes and everything else share it. So a drawing browser paces itself well inside it, by numbers on the wire because a client pacing by any other number would be refused for behaving correctly:

| constant                                 | value | rule                                                                                                                        |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `BOARD_POINTER_INTERVAL_MILLISECONDS`    | 125   | at most eight pointer frames a second; one inside the window is DROPPED — a cursor restates itself                          |
| `BOARD_OPERATIONS_INTERVAL_MILLISECONDS` | 250   | at most four operations frames a second; one inside the window is REFUSED `rate-limited` — a stroke does not restate itself |
| `BOARD_SYNC_INTERVAL_MILLISECONDS`       | 2000  | a catch-up is a request the asker repeats, so one inside the window is dropped                                              |

A browser drawing steadily therefore sends twelve board frames a second at most, and the eight left over are more than presence and a gallery page turn need. **Finished strokes are batched**: every operation completed inside the quarter second travels in the next frame, so drawing fast does not mean sending more. The two windows ride the socket's **attachment**, beside the frame budget and for its reason — they are about one connection, and a window kept on the participant record would cost a storage write per pointer frame to bound a frame that stores nothing.

**At or below `ROSTER_DELTA_THRESHOLD` welcomed sockets, every accepted operations frame is relayed as it is appended**, and every pointer frame is relayed from everybody.

**Above it, the log is its own coalescing bucket.** The room relays accepted operations at most once per `BOARD_RELAY_INTERVAL_MILLISECONDS = 250` per board: the index carries `relayedThrough`, an append past the window broadcasts everything after it — read from the open chunk the append already holds — and an append inside the window arms the room's alarm for the window's end, on the reaction bucket's pattern. No second key is needed, because the operations are already stored. Each socket receives at most four operations frames a second per board however many people are drawing, and the sequence numbers let a browser apply a burst of thirty operations exactly as it would thirty frames of one.

**Above it, pointer frames are relayed only from presenters** — the hosts, and the stay that opened the board or is sharing the screen under it. A laser pointer and a live stroke from the person leading the discussion are what a large room is watching; three hundred cursors are noise nobody can see, and relaying them would cost eight frames a second per drawer per socket. A participant who is not a presenter still draws, and their stroke appears when it is finished, a quarter second after the pen lifts at most.

The load harness measures all of it (section 16): operations frames per socket per second above the threshold, lists per board frame (zero for an append, one for a catch-up), and the time an append holds the room's gate.

### 5.4 The frame ceiling, and simplifying on the client

`MAX_MEETING_FRAME_BYTES` is sixty-four kibibytes and does not move. A stroke has to fit, so the browser makes it fit before it is sent, with three pure steps in `simplify.ts`:

1. **Ramer-Douglas-Peucker** at a tolerance of one screen pixel expressed in board units at the drawer's own scale — a point the eye cannot place is a point nobody needs.
2. **Quantize to integer units and drop consecutive duplicates.**
3. **Split** anything still longer than `MAX_STROKE_POINTS = 1500` into consecutive strokes sharing their end points, which the undo stack holds as one entry (section 3.4).

The worst case is fifteen hundred points with every delta at its largest, about twenty-one kilobytes; an ordinary stroke of a hundred points is well under a kilobyte. The browser packs operations into frames under `BOARD_FRAME_TARGET_BYTES = 48 KiB`, measured on the encoded frame, so a batch never reaches the ceiling and the one frame that would be `frame-too-large` is never built. All five numbers — the stroke point cap, the operations-per-frame cap, the erase target cap, the text length cap and the frame target — are on the wire, because the browser has to divide by them.

### 5.5 Refusals

Added to `MEETING_REFUSAL_REASONS`, every one about the frame that arrived and every one leaving the socket open:

- `board-unknown` — the board is not open in this room, or the screen under an annotation board has stopped.
- `drawing-restricted` — the policy says presenters, and this stay is not one; or a `clear` from somebody who is not a presenter under either policy.
- `board-full` — the board is at one of its ceilings.
- `foreign-operation` — an operation id not prefixed with the sender's own stay handle, on the reasoning `foreign-track-name` already carries: an id is how a later erase names a mark, and one forged under somebody else's handle would attribute their mark to them in the filed contributors.

`rate-limited` and `not-host` are reused. A waiting socket's board frames are refused `not-admitted` by the door rule that already refuses everything but `ping` and `leave`, before any board key is read.

## 6. Who may draw

**Everybody in the room, by default.** A whiteboard in a meeting is somewhere the room works together, and the conferencing products a firm already knows open it that way.

**A host or co-host can restrict it to presenters** with the `drawing-policy` frame. The presenters of a board are the hosts and co-hosts, and the stay that opened it (a whiteboard) or whose screen it is over (an annotation board). The policy is one room-level fact covering every board, held in the `drawing-policy` key and broadcast in the room state.

**It is a frame and not a route**, by the host-controls rule: it is about this moment and leaves nothing behind that anybody could later ask who did — the spotlight's shape exactly. The room authorizes it from the stored participant's `hostRole`, never from the socket's attachment, for the reason every host frame is.

**What the policy costs a frame.** Under `everyone`, an operations frame reads nothing about its sender. Under `presenters`, or for a frame carrying a `clear`, it reads the sender's own participant record — one key — to ask whether they are a host, and compares their stay with the board's presenter in the index it already holds.

**Guests.** A guest stay draws, erases and points exactly as a member stay does whenever the policy lets everybody draw, and its operations are attributed to the guest stay on the record like its chat lines. A guest never opens or closes a board, never files one and never uploads a still, because every one of those is a route and the guest lane carries none of them. A guest who is sharing a screen is the presenter of the annotation board over it once a host opens one.

**The door.** A waiting socket is sent no board frame — the broadcast skips every socket that has not been welcomed — and may send none.

**Audio calls.** A whiteboard is offered in a call as in a video meeting: it captures nobody and lights no camera, which is what a call's medium protects. Annotation is not, because a call carries no screen share.

## 7. Annotation over a shared screen

### 7.1 An annotation board is a board over a track

A screen share is a video track (`<stay>:screen`) routed browser to browser, and the room never sees a pixel of it. An **annotation board** is an ordinary board — the same operations, the same log, the same fold — bound to one share: it carries the sharer's stay as its presenter, the share's track name, and the shape of the shared picture. It is opened through the board route by the sharer ("Allow annotation" on their own share) or by a host, and closed when the sharer stops, when the sharer allows annotation no longer, or when the meeting ends.

**The sharer decides whether their screen can be drawn on.** Somebody else's marks over a person's screen are intrusive, and the person whose screen it is has the best view of whether this is the moment; a host may open annotation over any share because running the room includes that.

### 7.2 Whose coordinates

**Each annotator draws in their own rendering of the track, and the browser maps that rendering onto the track's own frame.** A shared screen is drawn letterboxed in a tile of whatever shape each browser happens to have, so a pixel on one screen is nothing on another. The board's units cover the picture itself: `widthUnits` and `heightUnits` take the frame's shape with the long side at 16000, fixed from the width and height the opener's browser reported when the board opened. `annotation-space.ts` in the whiteboard package is the pure pair of mappings between a rendered content rectangle (the tile less its letterbox) and board units, and every browser — the presenter's own included, over their local screen tile — draws the layer back through it.

**When the shared picture changes shape, the board closes.** A presenter who switches from a window to a whole screen, or resizes the window they are sharing, has changed what the marks were drawn on. The sharer's browser sees the track's settings change, closes the annotation board through the route (which files it in a matter meeting), and offers annotation again over the new picture. Marks scaled onto a different picture would point at the wrong things, which is worse than marks that are gone.

**What annotation cannot follow.** The layer is fixed to the frame, so a presenter who scrolls a document has moved the content out from under the marks. This is how every conferencing product's annotation behaves, and the screen says so the first time a member annotates.

### 7.3 The composite exists only in each browser

**No part of this platform decodes a presenter's video.** The recording design establishes why: the routing service offers no video egress worth using, and a decoder for the codecs a screen share arrives in would be a C or C++ dependency this platform does not take without the owner's consent. So there is no server-side composite of the screen and its marks, and none is designed. Each browser composites for itself, cheaply — its own decoded video element under a transparent drawing surface — and what is on the record has to come from somewhere else.

### 7.4 What is filed for an annotated screen, decided

Two candidates were on the table: the annotation layer alone, or the layer plus a still picture of what it was drawn over, captured in a browser. **The decision is both, in that order of default: the layer alone always, and the still only when the presenter's own browser captures it and the presenter says yes, for that filing.**

- **Why a still at all.** Marks over nothing are hard to read six months later: an arrow pointing at a clause is evidence about the clause only if the clause is there.
- **Why only the presenter's browser.** Two reasons, and the second decides it. The presenter's browser holds the original capture at full resolution, where every other browser holds a copy the routing service has compressed for the network. And **what is on a person's screen is theirs to put in a matter's file or not**: a shared screen routinely shows things outside the matter — a notification, another client's name in a tab strip — and only the person whose screen it is can judge whether the picture may go into this file. A still captured by an annotator's browser would put somebody else's screen on the record without them.
- **Why per filing and never a standing setting.** A screen at the end of a share is not the screen at its start, and consent to one picture is not consent to the next.

**How it happens.** When the sharer stops sharing an annotated screen in a matter meeting — or presses File annotations while sharing — their browser grabs the current frame **before** the track is stopped (a `grabFrame` seam on the client, so the state machine stays testable), holds it in memory, and asks, in an `ActionDialog`: "File your annotations to the matter. Include a picture of what you were sharing?" with **Annotations only** as the default and **Include the picture** beside it, and the picture shown. Declined, the frame is discarded in the browser and never leaves it. Accepted, the browser encodes it as a PNG and uploads it through the ordinary upload path (section 10) — so the still is a document of its own on the matter, scanned and status-gated like any upload — and the close or filing request names its upload session.

**A host's filing of somebody else's annotation board is always annotations only**, and so is the automatic filing when the meeting ends, and so is anything filed for a guest presenter, who has no upload route. The screen says which kind was filed.

## 8. What is filed

### 8.1 When

- **When the meeting ends**, every open board with content, closed with reason `meeting-ended`.
- **When a board closes** during the meeting: a whiteboard replaced by a new one, a whiteboard a presenter closes, an annotation board whose share stopped or changed shape.
- **On demand**, when a host asks (or the sharer, for their own annotation board). A board may be filed several times; each filing is a new **version** of the same documents on the matter, which is the File Manager's own history and needs nothing new to show "the board at 10:40, and again at 11:15".

A filing whose board has no visible element at its sequence files nothing and records `empty`.

### 8.2 The documents

| document | name                                                    | built by                                                                 |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| SVG      | `Whiteboard — <event title> — <YYYY-MM-DD HH:mm>.svg`   | `svg-export.ts` in `@magna-carta/whiteboard`, pure TypeScript            |
| PDF      | the same name with `.pdf`                               | a new drawing-page function in `crates/pdf-core`, via `@magna-carta/pdf` |
| still    | `Screen share — <event title> — <YYYY-MM-DD HH:mm>.png` | the presenter's browser, uploaded; only when consented                   |

An annotation board's documents read `Screen annotations — …`. The instant in a name is the filing's, written in the event's own time zone, which the meeting summary already carries ([`docs/conventions/dates.md`](../conventions/dates.md)). Documents land at the matter's root folder, as a recording does.

**The SVG is the layer as vectors**, one page at the board's own units: a paper background for a whiteboard and none for an annotation layer, then each visible element in sequence order. **The PDF is one page** at 960 points on the long side: the still underneath when there is one, then the same elements as PDF path operators, highlighter opacity through a graphics state, and text in the engine's standard sans face. The path geometry — the quadratic smoothing of a stroke, an arrow's head, an ellipse — is computed once, by `geometry.ts` in the whiteboard package, and handed as path commands to the canvas, the SVG builder and the PDF engine alike, so the three cannot disagree about where a line runs.

**The PDF engine is the one the platform has.** `crates/pdf-core` is pure Rust over `lopdf`, already writes content streams (watermarking, Bates numbering) and already embeds an image as an XObject. The drawing page is a new module beside those, reusing the image embed and the standard-font machinery, compiled into the same WebAssembly module the worker already loads for form filling. No C or C++ enters anywhere. **The still is decoded and re-encoded, never embedded verbatim**: the engine's image path decodes the PNG with the pure-Rust `image` crate and writes the pixels Flate-compressed, so the bytes that reach a PDF reader are bytes this engine produced rather than bytes a browser sent.

**Every document is a pure function of its inputs** — the operations through the filing's sequence, the board's size, and the still's bytes. No instant, identifier or random value is written into either the SVG or the PDF (the engine's document identifier is derived, not random). That is what makes a retried filing byte-identical to the attempt it replaces, and what makes the export testable as a snapshot.

**Inks on paper are the tokens' paper values.** A board on screen follows the theme and mode — an `ink` mark is dark on a light surface and light on a dark one — but a filed document is paper. `@magna-carta/design-tokens` gains the six ink tokens and a generated export of their paper values (section 11), and that export is the only place a filed colour comes from.

### 8.3 The pipeline

`apps/api-worker/src/meetings/board-filing-consumer.ts`, on a new `meeting-board-filing` queue — building an SVG and a PDF is exactly the work golden rule 10 keeps out of a route handler and out of a socket callback. One message per filing, carrying the firm, the meeting, the board and the filing.

1. **Read the log from the room**, through a `boardForFiling(boardId)` call on the meeting's own room, which answers the operations through its latest sequence and that sequence. The room does not fold anything for this; the consumer does.
2. **Fold, and stop at `empty`** when nothing is visible.
3. **Wait for the still**, where one is named: its version must be `clean`. A version still `pending` retries the message with a delay; one quarantined or flagged is left out, the filing records `still_outcome = 'refused'`, and the board is filed without it — the marks are the record and must not be held hostage to a picture.
4. **Build the SVG and the PDF.**
5. **File each through the one entrance**: `initiateUpload` (a new version on the board's existing file where there is one), the bytes written at the minted key with the minted dimensions, `completeUploadSession`, and the ingest event — the path the document-assembly consumer already takes. The reservation and the filing row's version handles commit in one batch, so a retry after a crash finds the versions already reserved and writes the same bytes to the same keys.
6. **Commit the filing** `filed`, with the contributors (section 9), then tell the room with `boardFiled(boardId, filingId, throughSequence)`, which broadcasts `board-filing` and, after the meeting has ended, deletes the board's keys.

A document the firm's upload policy refuses at the gate — a firm that removed `image/*` from its allowed types, say — is the ingest gate's to quarantine as it would any upload; the filing records which document was refused and files the other. A failure that exhausts the queue's attempts records `failed` with the Error ID, never a message.

### 8.4 On the record like chat

The board is content a meeting produced, as a chat line is, and it takes chat's treatment wherever the two can be compared:

- **Retention.** The filed documents are matter documents and are retained under the matter as every filed document is. The rows below carry identifiers and instants, and no content column at all — what was drawn and typed exists only in the filed documents, which is the one home for it.
- **Personal data.** A board can hold a name, an address, anything anybody wrote on it. The documents carry the File Manager's treatment of any document on a matter; the tables' identifier columns are registered in the personal-data registry on the lines chat's already sit on (section 9.3).
- **Redaction.** Chat's pair, on the board: `redacted_at` and `redacted_by_user_id`, set together, by a member holding `meetings:host` — a board has no single author, so chat's "the host or the author" collapses to the host. Redacting a board soft-deletes every document filed for it through the File Manager's own soft-delete, in the same batch, refuses any later filing, and — during the meeting — tells the room to close the board and delete its log. The row keeps that a board existed, in which meeting, who contributed to it, and who removed it. A mark removed during the meeting is an `erase` and needs no redaction at all; a filed PDF that needs one region hidden rather than the whole document withdrawn has the platform's existing PDF redaction, like any other filed PDF.
- **Audit.** Identifiers and instants only, never an element count's worth of content, never a word of any text on a board.

### 8.5 A firm meeting

Nothing is filed and nothing is kept. A member may **Download** an open board as an SVG or a PDF: the SVG from the same pure export, the PDF from the same engine through `@magna-carta/pdf`, which already runs in the browser. It is that member's own copy of a meeting that has no matter to keep one. A guest is offered no download.

## 9. The record

### 9.1 Schema (per-firm lineage, additive)

Three tables, one hand-written migration, the snapshot refreshed in the same commit, the worker bundle regenerated by `pnpm run migration-bundles`. No rebuild, no relaxed column.

```
meeting_board
  id                          text pk            -- meetingBoard_ handle
  meeting_id                  text not null -> meeting.id
  kind                        text not null      -- 'whiteboard' | 'annotation'  (CHECK)
  opened_by_user_id           text not null -> member.user_id
  opened_at                   text not null      -- instant
  presenter_kind              text not null      -- 'member' | 'guest'  (CHECK)
  presenter_id                text not null      -- the stay, BY VALUE: the opener, or the sharer under an annotation board
  width_units                 integer not null
  height_units                integer not null
  closed_at                   text null          -- instant
  closed_reason               text null          -- 'meeting-ended' | 'closed' | 'replaced' | 'share-stopped' | 'share-changed' | 'redacted'  (CHECK)
  svg_file_id                 text null -> file.id   -- the board's two documents once first filed; later filings are versions
  pdf_file_id                 text null -> file.id
  redacted_at                 text null          -- instant
  redacted_by_user_id         text null -> member.user_id
  created_at, updated_at
  CHECK (closed_at IS NULL) = (closed_reason IS NULL)
  CHECK (redacted_at IS NULL) = (redacted_by_user_id IS NULL)
  CHECK width_units and height_units between 1 and 16000
  UNIQUE (meeting_id) WHERE kind = 'whiteboard' AND closed_at IS NULL
  UNIQUE (meeting_id, presenter_id) WHERE kind = 'annotation' AND closed_at IS NULL
  INDEX (meeting_id, opened_at, id)

meeting_board_filing
  id                          text pk            -- meetingBoardFiling_ handle
  board_id                    text not null -> meeting_board.id
  reason                      text not null      -- 'meeting-ended' | 'board-closed' | 'requested'  (CHECK)
  requested_by_user_id        text null -> member.user_id   -- null when the filing was automatic
  requested_at                text not null      -- instant
  state                       text not null      -- 'pending' | 'filed' | 'empty' | 'failed'  (CHECK)
  through_sequence            integer null       -- the log position filed, once the room has answered
  still_file_version_id       text null -> file_version.id
  still_consented_by_user_id  text null -> member.user_id
  still_outcome               text not null default 'none'  -- 'none' | 'included' | 'refused'  (CHECK)
  svg_file_version_id         text null -> file_version.id
  pdf_file_version_id         text null -> file_version.id
  element_count               integer null
  failure_error_id            text null          -- the standard pipeline's Error ID, never a message
  completed_at                text null
  created_at, updated_at
  CHECK (still_file_version_id IS NULL) = (still_consented_by_user_id IS NULL)
  CHECK (state = 'filed') = (pdf_file_version_id IS NOT NULL)
  INDEX (board_id, requested_at, id); INDEX (state)

meeting_board_contributor
  id                          text pk            -- meetingBoardContributor_ handle
  board_id                    text not null -> meeting_board.id
  participant_kind            text not null      -- 'member' | 'guest'  (CHECK)
  participant_id              text not null      -- the stay, BY VALUE, no foreign key
  operation_count             integer not null
  first_operation_at          text not null      -- instant
  last_operation_at           text not null      -- instant
  UNIQUE (board_id, participant_kind, participant_id)
```

**The stay, by value, with no foreign key**, on the chat and poll precedent: a guest's stay is a `meeting_guest_stay` row and a member's a `meeting_attendance` row, and a foreign key to either would bar the other.

**Who drew on a board is on the record; each stroke's author is not.** The contributor rows are written by the filing consumer from the log it has just folded, and rewritten by each later filing, so the record says who contributed, how much and between which instants. Keeping the author of every stroke would mean filing the log itself, which is a working document of the meeting rather than a record of it; the contributor rows are the part of it a firm would ask about.

**Two partial unique indexes are the one-open-board rules**, held by the database rather than by the service: one open whiteboard per meeting (opening a new one closes the old in the same batch, reason `replaced`), and one open annotation board per sharer.

**Breakout rooms are not a column yet.** Section 14 says why.

### 9.2 Identifiers and settings

`meetingBoard`, `meetingBoardFiling` and `meetingBoardContributor` join `packages/identifiers` (types and registry).

**`meetings.whiteboardEnabled`**, a per-firm boolean defaulting to **false**, in `packages/meetings/src/settings.ts` on the settings-registry pattern the structure section names for every sub-feature — so the board lands dark and is turned on per firm. The recording design declares the same file for its own switches; whichever slice lands first creates it and the other adds to it.

### 9.3 Personal data and audit

Registered in `packages/data-access/src/pii-registry.ts`:

- `meeting_board.opened_by_user_id`, `meeting_board.presenter_id`, `meeting_board_filing.requested_by_user_id`, `meeting_board_filing.still_consented_by_user_id`, `meeting_board_contributor.participant_id` — `retain-under-matter`: who opened a board, whose screen it was over, who asked for it to be filed, who consented to a picture of their screen, and who drew on it are part of what the record says happened, on the line attendance sits on.
- `meeting_board.redacted_by_user_id` — `pseudonymize-keep`, word for word with `meeting_message.redacted_by_user_id`: who removed something is attribution on a row that is never deleted.

No content column exists to register. The filed documents are the File Manager's.

**Audit events** through `domainAuditStatement`, identifiers and instants only: `meetings.board.opened`, `meetings.board.closed`, `meetings.board.filingRequested`, `meetings.board.filed`, `meetings.board.filingFailed`, `meetings.board.stillConsented`, `meetings.board.redacted`. The drawing policy writes none, by the rule that made it a frame.

## 10. Routes

`apps/api-worker/src/routes/meeting-boards.ts`. All under the chokepoint, `resource: "firm"` like the rest of the family, `idempotency: "required"` on every write, audited. Every route answers a walled matter's meeting with the family's 404.

| method | path                                                               | permission                                 | does                                                                                          |
| ------ | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/meetings/{meetingId}/boards`                              | `meetings:join` + open stay                | body `{ kind, sharedTrackName?, frameWidth?, frameHeight? }`; opens a board; the room is told |
| GET    | `/api/v1/meetings/{meetingId}/boards`                              | `meetings:join`                            | cursor-paged, each board with its latest filing                                               |
| POST   | `/api/v1/meetings/{meetingId}/boards/{boardId}/close`              | `meetings:join` + presenter, or host grant | body `{ stillUploadSessionId? }`; closes it and, in a matter meeting, queues its filing       |
| POST   | `/api/v1/meetings/{meetingId}/boards/{boardId}/filings`            | host grant, or the sharer of that board    | body `{ stillUploadSessionId? }`; 202 with the pending filing                                 |
| GET    | `/api/v1/meetings/{meetingId}/boards/{boardId}/filings/{filingId}` | `meetings:join`                            | the filing's state and documents                                                              |
| POST   | `/api/v1/meetings/{meetingId}/boards/{boardId}/stills`             | `meetings:join` + the sharer of that board | body `{ declaredSize }`; reserves a PNG upload on the matter and returns its presigned PUT    |
| POST   | `/api/v1/meetings/{meetingId}/boards/{boardId}/redact`             | `meetings:host`                            | sets the pair, withdraws the filed documents, refuses later filings, closes a live board      |

**Opening.** A whiteboard is opened by any member with an open stay when the policy lets everybody draw, and by a host or co-host when it does not. An annotation board is opened by the member sharing the named track, or by a host or co-host over anybody's share; the route checks the track against the room's roster through the room rather than trusting the body, and takes the frame's width and height from the opener's browser. The sixteen-board ceiling is guarded on the insert. After the batch commits the route calls `boardOpened(board)` on the room, which writes the index entry and broadcasts the room state — the `participantLeft` and `end` ordering, so nobody is told a board opened by a write that then failed.

**A still is only ever the sharer's.** The stills route refuses anybody but the member sharing the screen under that board, reserves the upload with `initiateUpload` (declared `image/png`, at most `MAX_BOARD_STILL_BYTES = 8 MiB`, `uploadKind: "interactive"`, `uploadedBy` the sharer) and answers with the presigned PUT the upload routes already mint. The close and filing routes accept its upload session only from that same member, and record them as the consenting member. A still named by anybody else is refused.

**Ending a meeting files its boards.** The end route's own batch closes every open board with `meeting-ended` and, in a matter meeting, inserts a pending filing for each; after it commits and after `room.end`, it enqueues one message per filing. The room's end keeps those boards' keys (section 4.3).

**Problem types added:** `meeting-board-not-found` (404, and the same for a board in a meeting the member may not reach), `meeting-board-closed` (409), `meeting-board-limit-reached` (409), `meeting-board-not-fileable` (409 — a firm meeting's board, whose `detail` says there is no matter to file into), `meeting-board-not-presenter` (403 — the member holds the key and is not the presenter, so the remedy differs from `permission-denied`), `meeting-board-redacted` (409), and `meeting-board-still-invalid` (422 — over the size ceiling, not a PNG, or a still named by somebody who is not the sharer). `meeting-not-joined`, `meeting-not-host` and `meeting-ended` are reused.

**Room methods the routes and the consumer call, each after its own commit:** `boardOpened(board)`, `boardClosed(boardId, reason)`, `boardForFiling(boardId)`, `boardFiled(boardId, filingId, throughSequence)`, `boardRedacted(boardId)`.

## 11. Rendering, and why not a whiteboard SDK

### 11.1 The candidates, measured 2026-09-24

|                       | tldraw 5.4.2                                                                                                                                                                                                      | Excalidraw 0.18.1                                                                                                    | this design                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Licence               | proprietary: source-available, "will not work in production without a valid license key", commercial pricing by negotiation; the free hobby licence is non-commercial and requires a "made with tldraw" watermark | MIT                                                                                                                  | ours                                       |
| Package, unpacked     | about 15 MB                                                                                                                                                                                                       | about 47 MB, with some thirty runtime dependencies (Radix, Jotai, rough.js, perfect-freehand, pica, Sass among them) | a few hundred lines of TypeScript          |
| Language              | TypeScript                                                                                                                                                                                                        | TypeScript                                                                                                           | TypeScript                                 |
| Framework             | a React component; React 18 or 19 as a peer                                                                                                                                                                       | a React component; React 17 to 19 as a peer                                                                          | Svelte 5, like the rest of the application |
| Styling               | its own stylesheet, imported whole                                                                                                                                                                                | its own stylesheet, imported whole                                                                                   | the design system's tokens and one recipe  |
| Its model on the wire | its own document store and sync                                                                                                                                                                                   | its own element format and scene                                                                                     | the typed operations above                 |

**Neither can be taken, and the licence is only the first reason.** tldraw cannot ship without a paid key, and its trial licence reports a hash of the key to the vendor's servers, which is a call out of a firm's meeting the platform does not make. Excalidraw's licence is fine. What rules both out is the same three things. **They are React applications**, and this is a Svelte application: embedding either means a second UI runtime and a second component model inside a meeting screen. **They carry their own stylesheets and their own UI** — toolbars, menus, dialogs, colour pickers — and golden rule 2 has no door for that: a component's look here is a design-system recipe over tokens, raw CSS is rejected by the gate, and a third-party stylesheet overridden until it looks like ours is raw CSS with extra steps. **And they bring their own model**, which would have to be translated into operations the room can validate (section 3.1) or trusted on the wire — the first costs most of what building the renderer costs, and the second is the thing this design refuses.

**perfect-freehand** (MIT, TypeScript, about 110 kilobytes unpacked) was measured as the one piece worth borrowing, since it is what gives both products their pressure-shaped strokes. It is not taken either: it turns a stroke into a filled outline polygon, which would make every stroke in the export a fill rather than a line and add a pressure channel to the operation for a quality nobody asked for. A round-capped, round-joined line with quadratic smoothing reads well at every width here and is the same geometry in all three renderers.

### 11.2 What the design system builds

**`DrawingSurface`**, in `packages/design-system/src/lib/components/drawing-surface/`, domain-free on the calendar grid's division: it is told what to draw and it reports what a hand did, and it never learns what a board, a stay or a meeting is.

- **In:** the surface's size in units; the committed items as path commands (from `geometry.ts`), each with an ink name from the design system's own closed set, a width step and a tool; text items as runs of plain text; the live overlay — previews and pointers, each with a caller-supplied label; an `underlay` snippet (the shared screen's video, for annotation); and the accessible names for everything.
- **Out:** gestures in surface units — a freehand path as it grows and when it ends, two corners for a shape, a point for text, the items an eraser passed over (hit-tested in `geometry.ts`, handed in as a function) — and the keyboard acts of section 12.
- **How it paints.** Two stacked canvases: one holding the committed items, repainted only when they change; one holding previews, pointers and the eraser's trail, repainted every animation frame while anything on it moves. A board of ten thousand strokes costs one repaint when a stroke lands, not ten thousand DOM nodes. Canvas 2D rather than SVG on screen for exactly that reason; SVG is the export, where a document is written once.
- **Inks never appear as literals.** The painter reads each ink's computed value from the surface's own custom properties (`--mc-whiteboard-ink-red` and the rest) once when it mounts and again when the theme or mode changes. The tokens are six semantic colours with light and dark values, in `@magna-carta/design-tokens`, and each is added to the contrast gate against the board surface at the non-text ratio of three to one, in every theme and mode. The same package emits a generated TypeScript export of their paper values, `@magna-carta/design-tokens/whiteboard-inks`, which the SVG and PDF export read and nothing on screen does. The wire's `BOARD_INKS` and the tokens are two lists naming the same six meanings, on the reaction-and-glyph precedent, and a test in the whiteboard package fails if a wire ink has no paper value.
- **Its look is one recipe**, `styles/recipes/drawing-surface.css`: the surface, its focus edge, `touch-action: none` so a pen on a tablet draws rather than scrolls, the keyboard cursor, and the laser's fade — tokens and logical properties only, reduced motion included.
- **`DrawingToolbar`**, the controls: pen, highlighter, shapes, text, eraser, laser, ink swatches, width steps, undo, redo and clear, each a design-system `Button` with `aria-pressed` for a tool and a Lucide glyph (`pen-line`, `highlighter`, `minus`, `move-up-right`, `square`, `circle`, `type`, `eraser`, `pointer`, `undo-2`, `redo-2`, `trash-2`), with the names audited against the pinned `@lucide/svelte` in the same slice, on the reactions design's precedent. It takes closed sets and a disabled state, and knows nothing about who may clear.

## 12. Accessibility

- **Everything but a freehand line has a keyboard path.** The surface is one focusable region labelled with the board's name. With it focused, the arrow keys move a visible crosshair by a small step and by a large one with Shift; Enter with a shape tool fixes the first corner and Enter again the second; Enter with the text tool opens the text field at the crosshair; Escape abandons what is in progress. Freehand drawing is the one act a keyboard cannot express, and WCAG's keyboard criterion names a path-dependent input as its one exception — a line, an arrow and a box cover what a keyboard user needs to point at something.
- **The board is also a list.** Beside the surface, a visually compact list of the board's elements in the order they were drawn — "Text, red: Plaintiff's exhibit 4", "Arrow, blue, by Priya Raman", "12 strokes by James Cole" grouped — reachable from the toolbar and read by a screen reader. A text element is read as its text. Selecting an entry and pressing Delete erases it, which is the keyboard's eraser.
- **Undo and redo are Ctrl or Cmd with Z, and Shift for redo**, and each announces what it did in a polite live region.
- **Announcements are sparing.** A board opening, closing, being filed, and the policy changing are announced politely; another participant's strokes are not, for the reason reactions go quiet above sixteen — a stream of "somebody drew" is noise. The list is where the content is.
- **Reduced motion.** Under `prefers-reduced-motion`, the laser pointer is a dot with no trail, a remote stroke appears whole when its preview frame lands rather than being eased along, and a pointer jumps rather than gliding between the eight positions a second the room sends. The information stays; the movement goes.
- **Colour is never the only difference.** Every ink is named in the list and on its swatch, and the ink tokens clear the non-text contrast ratio against the board in every theme and mode, by gate.
- **A shared screen's annotations** follow the same rules, and the list names who drew each mark over the share.

## 13. Security

- **A board frame is untrusted input and is bounded field by field before anything is kept.** The schema bounds the operations per frame, the points per stroke, the erase targets, the text length, every enumerated field and every coordinate — the last after the deltas are decoded, because a bound on each delta is not a bound on where the line ends. The budget is spent before the parse, so a flood does not buy a parse apiece.
- **An operation cannot be somebody else's.** The id's prefix must be the sender's own stay (`foreign-operation`), and the author the room records is taken from the socket's attachment, never from the frame.
- **Text is text everywhere.** Board text is at most 500 characters; the schema refuses control characters other than the line break, and refuses the bidirectional embedding, override and isolate controls, which could make a filed line read differently from what it contains. On screen it is painted with the canvas's text call and shown in the list as text, never as markup. In the SVG it is written by one escaping function that encodes the five characters markup gives meaning to, inside `text` and `tspan` elements whose attributes are all numbers or fixed names.
- **The SVG is built from typed operations and nothing else.** No string from the wire reaches an attribute: coordinates are integers formatted by one function, a colour is looked up in the paper table by a closed-set name, and a width by a closed-set step. The builder can emit exactly `svg`, `rect`, `g`, `path`, `line`, `polygon`, `ellipse`, `text` and `tspan`, and a test parses its output and asserts that set. There is no `script`, `style`, `foreignObject`, `image`, `use`, link or external reference of any kind — the still goes into the PDF, never into the SVG. A filed SVG is served from the cookieless files origin like every other document, so even an SVG that somehow carried script would run nowhere that holds a session; this one carries none to run.
- **The PDF carries no bytes a browser sent.** The still is decoded and re-encoded by the engine (section 8.2), the vectors are operators the engine writes, and the text is set in a standard font through the engine's own escaping.
- **The still is a document like any upload** — presigned PUT, ingest, magic-byte check, scan, status gate — and the consumer uses it only once its version is clean.
- **The log never reaches telemetry, the inspect call or an error.** No event in the catalog has a field for a point, an ink, a text or an operation, so no call site can add one without adding it to the catalog first.

## 14. Breakout rooms

**A board belongs to the room it is drawn in**, because the room is its ordering authority and its store: the log is in that room's storage, the frames reach that room's sockets, and the sequence is that room's. Today a meeting is one room, so `meeting_id` places a board completely.

Breakout rooms are not designed. When they are, each breakout room is a room of its own under the same meeting — the ledger's own words — and a board opened there is a board of that room. The breakout design adds the column that says which room a board was drawn in (nullable, meaning the main room, additive), and the filing consumer addresses that room for the log. When a host brings the rooms back, each breakout room's open boards close and file like any other closing board. Nothing in this design assumes one room per meeting except that column's absence.

## 15. Telemetry and inspection

In the `meetings.room.*` family, one allowlist builder per act, correlated by firm, meeting and stay:

- `meetings.room.boardAppended` — per accepted operations frame: operation count, bytes, whether it was relayed or held for the coalesced relay, recipients reached. At most four a second per drawer.
- `meetings.room.boardRelayed` — per coalesced relay above the threshold: operation count and recipients.
- `meetings.room.boardSynced` — per catch-up: operations and frames sent.
- Pointer frames record **nothing per occurrence**. They are the frame a drawing room sends most, and the sampled frame-budget event already records the frame type one frame in twenty.
- Refusals go through the existing `meetings.room.refused` with the new reasons.
- `meetings.room.alarmRan` gains `boardRelayFlushed` and `boardsRetired`, so a wake that did only board work is not indistinguishable from a spin.

`meetings.board.filed`, from the consumer: outcome, stage, element count, contributor count, the two documents' sizes, the still's outcome, the attempt. **`room-inspect.ts`** shows each board's index entry — kind, presenter handle, sequences, bytes, chunk count, whether it is awaiting filing — and never an operation.

## 16. Testing

**`packages/whiteboard/test/` — the convergence, as pure tests.** A seeded generator produces logs of every kind of operation from several authors, including erases of erased elements, clears racing strokes, restores of restores and duplicate ids. For each: folding the log in order, and feeding the sequence applier the same operations in every delivery a socket can produce — interleaved catch-up and live frames, duplicated frames, a gap closed late — ends in the same state. Reconnection: a client with pending operations loses its socket, re-syncs and re-sends; the room model appends some operations twice; the fold shows each element once. Undo: a stack of mixed acts undone and redone to depth ends where it started, and a split stroke undoes as one. `simplify.ts`: a fifteen-thousand-point stroke leaves as strokes of at most fifteen hundred points that meet end to end, never outside the board, each frame under the target. `annotation-space.ts`: a point maps to the same board unit through a letterboxed tile, a pillarboxed one and the presenter's own. The paper-ink table covers every wire ink.

**`packages/whiteboard/test/svg-export.test.ts` — the export as a snapshot.** A fixed log's SVG is compared byte for byte with a committed snapshot, and two builds of it are identical. Text carrying markup, entity-like sequences, quotation marks and bidirectional controls either renders inert or is refused at the schema, as the case may be; the output parses, and its element names are a subset of the allowed set with no attribute outside the builder's own.

**`crates/pdf-core`** — the drawing page renders back through the engine's own renderer with ink where the strokes are and paper where they are not; a still is embedded as Flate-compressed pixels and never as the bytes it arrived as; a page built twice is identical.

**`packages/meeting-protocol/test/board-frames.test.ts`** — every bound, the deltas' decoded bound, the closed sets, and the fitness function extended by the new types.

**`apps/api-worker/test/meeting-room.test.ts`** — sequences are contiguous and ordered under concurrent frames; an operations frame reads no list and a catch-up reads one; a chunk seals at its size and is never rewritten; the ceilings refuse `board-full`; the policy refuses `drawing-restricted` and a non-presenter's clear under either policy; a foreign id is refused; a waiting socket's board frame is `not-admitted`; above the threshold thirty operations inside a quarter second reach each socket as one frame, and pointers relay only from presenters; the end keeps an unfiled matter board's keys and the alarm retires them at their deadline; a firm meeting's board is gone at the end; a screen track closing marks its annotation board not live.

**`apps/api-worker/test/meeting-room-load.test.ts`** — a drawing phase in the harness: a handful of presenters and a crowd drawing at the paced rate for ten seconds, reporting operations frames per socket per second above the threshold, lists per board frame, and the gate's hold time per append. The counts are the result.

**`apps/api-worker/test/meeting-board-routes.test.ts`** — a walled matter's meeting is 404 through every route; the one-open-whiteboard and one-open-annotation rules hold under two concurrent opens; a firm meeting's filing is `meeting-board-not-fileable`; a still from anybody but the sharer is refused; redaction withdraws the documents and refuses the next filing; the contract snapshot and the generated client are re-emitted in the same commit.

**`apps/api-worker/test/meeting-board-filing-consumer.test.ts`** — against a fake room: an empty board records `empty` and files nothing; a filing writes two documents through the one entrance and a second filing writes versions of them; a pending still retries, a quarantined one files without it and says so; a crash after the reservation retries into the same versions with identical bytes; every audit row carries identifiers and instants only.

**`apps/web/test/`** — the boards concern against a fake socket: pacing never exceeds the windows, a refused frame is re-sent, pending operations reconcile on their echo, a gap asks for a catch-up; the annotation layer tracks a tile resize; the still dialog defaults to annotations only and a declined picture never reaches the upload seam; a guest sees no open, file or download control.

**`packages/design-system`** — stories for the surface and the toolbar in every theme and mode, each with the axe check; the keyboard path draws a rectangle and places text; reduced motion leaves the laser a dot.

## 17. Slices, and the file-touch list

Three agents, one owner per file. **The backend agent** owns `packages/` except the design system and the design tokens, owns `crates/pdf-core`, and owns `apps/api-worker/` including the emitted contract and the generated client. **The web agent** owns `apps/web/`. **The design-system agent** owns `packages/design-system/` and `packages/design-tokens/`. The handoffs are the two contracts that cross agents: the protocol and whiteboard package land first from the backend agent, and the ink tokens with their paper export land first from the design-system agent, because the whiteboard package imports them.

### Slice one — the board (no filing)

Backend:

- `packages/meeting-protocol/src/frames.ts` — the four client frames, the three room frames and their builders, the four refusal reasons, the board constants on the wire
- `packages/meeting-protocol/src/types.ts` — the operation types, the closed sets, `drawing` and `boards` on `MeetingRoomState`
- `packages/meeting-protocol/CLAUDE.md`; `packages/meeting-protocol/test/board-frames.test.ts` (new)
- `packages/whiteboard/` (new) — `package.json`, the tsconfig files, `vitest.config.ts`, `CLAUDE.md`, `src/fold.ts`, `src/sequence-applier.ts`, `src/undo.ts`, `src/simplify.ts`, `src/geometry.ts`, `src/annotation-space.ts`, and their tests; its entry in the build references (`node tooling/tsconfig-refs/index.mjs`)
- `packages/database/src/per-firm-schema.ts`, the migration and its snapshot — `meeting_board` only
- `packages/identifiers/src/registry.ts`, `src/types.ts` — `meetingBoard`
- `packages/data-access/src/pii-registry.ts` — the `meeting_board` entries
- `packages/meetings/src/board-types.ts`, `board-statements.ts`, `board-service.ts`, `board-validation.ts` (new); `src/settings.ts` (new, or added to); `CLAUDE.md`; `test/board-service.test.ts` (new)
- `packages/telemetry/src/events.ts` — the room's board events and the alarm's two fields
- `apps/api-worker/src/meetings/room/room-boards.ts` (new) — the index, the chunks, the append, the catch-up, the relay and its coalescing, the policy check
- `apps/api-worker/src/meetings/room/room-state.ts` — the board keys, the policy key, the room state's two fields
- `apps/api-worker/src/meetings/room/room-frames.ts` — dispatch for the four client frames, the two windows on the attachment
- `apps/api-worker/src/meetings/room/room-hosting.ts` — `drawing-policy`
- `apps/api-worker/src/meetings/room/room-lifecycle.ts` — the relay deadline and the board retirement in the alarm; the end's treatment of board keys
- `apps/api-worker/src/meetings/room/room-media.ts` — a closed screen track marks its annotation board not live
- `apps/api-worker/src/meetings/room/room-diagnostics.ts`, `room-inspect.ts`
- `apps/api-worker/src/meetings/meeting-room.ts` — `boardOpened`, `boardClosed`
- `apps/api-worker/src/routes/meeting-boards.ts` (new) — open, list, close; `apps/api-worker/src/app.ts` — the bundle
- `apps/api-worker/wrangler.jsonc` — the note on `MEETING_ROOM`, which may no longer say nothing anybody said is in its storage
- `apps/api-worker/openapi/openapi.json` (emitted), `packages/api-client` (generated)
- `apps/api-worker/src/meetings/CLAUDE.md` — the module, and the rule that board content is the one content the room holds and why
- `apps/api-worker/test/meeting-room.test.ts`, `meeting-board-routes.test.ts` (new), `support/meeting-room-load.ts`, `meeting-room-load.test.ts`
- `roadmap.d/meetings.md` (`meetings.whiteboard` to `in-build`, then as built), `status.d/meetings.md`, `STATUS.md`, `STATUS.json`, `docs/now.md`, `changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`

Design system:

- `packages/design-tokens/tokens/semantic.json` and the theme and mode sources the six inks need; `generated/` re-rendered; `src/contrast-pairs.ts` — each ink against the board surface; `src/whiteboard-inks.ts` (new, generated) and its export in `package.json`; `CLAUDE.md`
- `packages/design-system/src/lib/components/drawing-surface/` (new) — `drawing-surface.svelte`, `drawing-toolbar.svelte`, `drawing-painter.ts`, `drawing-keyboard.svelte.ts`, `types.ts`, `index.ts`
- `packages/design-system/src/lib/styles/recipes/drawing-surface.css` (new) and its import in `src/lib/styles/components.css`; the package's component exports
- `packages/design-system/src/stories/drawing-surface.stories.svelte` (new); `packages/design-system/CLAUDE.md`

Web:

- `apps/web/src/lib/meetings/client/boards.svelte.ts` (new) — the boards this browser holds, the confirmed log and the pending overlay, the undo stacks, remote previews and pointers, the pacing, the re-send, the catch-up
- `apps/web/src/lib/meetings/client/signaling.ts` — the handler per new room frame, the senders
- `apps/web/src/lib/meetings/client/host-controls.ts` — the policy directive; the room-state reader's two fields
- `apps/web/src/lib/meetings/client/meeting-client.svelte.ts` — the wiring and the state the screen renders
- `apps/web/src/lib/meetings/meetings-api.ts` — open, list, close
- `apps/web/src/lib/meetings/screen/meeting-board.svelte` (new), `meeting-board-model.ts` (new) — the stage and the projection from folded elements to the surface's items
- `apps/web/src/lib/meetings/screen/meeting-controls.svelte` — Whiteboard, and Drawing in the Host controls menu
- `apps/web/src/lib/meetings/screen/meeting-grid.svelte`, `meeting-tiles.ts` — an open whiteboard takes the large slot after a screen share and before a spotlight, and a member may hide it on their own screen
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte`; `apps/web/src/lib/meetings/guest-meeting.svelte` — a guest sees and draws
- `apps/web/src/lib/meetings/CLAUDE.md`; `apps/web/test/meeting-boards.test.ts` (new), `meeting-room-page.test.ts`
- `docs/user/features/meetings.md` — the board, drawing, undo, the keyboard path, and that a firm meeting's board is not kept

### Slice two — filing the board

Backend:

- `crates/pdf-core/src/drawing.rs` (new), `src/lib.rs`, `src/wasm.rs` — the drawing page
- `packages/pdf/src/index.ts`, `packages/pdf/README.md`, `packages/pdf/test/drawing-page.test.ts` (new)
- `packages/whiteboard/src/svg-export.ts`, `src/pdf-page-spec.ts`, `src/contributors.ts` (new) and their tests, the SVG snapshot included
- `packages/database/src/per-firm-schema.ts`, a second migration and its snapshot — `meeting_board_filing`, `meeting_board_contributor`, and the board's file and redaction columns
- `packages/identifiers/src/registry.ts`, `src/types.ts` — `meetingBoardFiling`, `meetingBoardContributor`
- `packages/data-access/src/pii-registry.ts` — the rest of section 9.3
- `packages/meetings/src/board-*.ts` — filings, contributors, redaction
- `packages/telemetry/src/events.ts` — `meetings.board.filed`
- `apps/api-worker/src/meetings/board-filing-consumer.ts` (new), `apps/api-worker/src/meetings/board-pdf-engine.ts` (new, the engine wiring on the form engine's pattern)
- `apps/api-worker/src/event-dispatch.ts`, `apps/api-worker/src/app.ts`, `apps/api-worker/wrangler.jsonc` — the queue, its producer, its consumer
- `apps/api-worker/src/meetings/meeting-room.ts` — `boardForFiling`, `boardFiled`, `boardRedacted`
- `apps/api-worker/src/meetings/room/room-boards.ts`, `room-lifecycle.ts` — keys kept for filing, deleted when filed
- `apps/api-worker/src/routes/meeting-boards.ts` — filings, filing read, redaction; `apps/api-worker/src/routes/meetings.ts` — the end route closes and files boards
- the emitted contract and the generated client; `apps/api-worker/test/meeting-board-filing-consumer.test.ts` (new), `meeting-board-routes.test.ts`, `meetings-routes.test.ts`
- the ledger, status, register, changelog and decision fragments

Web:

- `apps/web/src/lib/meetings/meetings-api.ts` — filing, filing read, redaction
- `apps/web/src/lib/meetings/client/board-download.ts` (new) — a firm meeting's download, from the same export and engine
- `apps/web/src/lib/meetings/screen/meeting-board.svelte` — File to matter, the filed state, Download in a firm meeting
- `apps/web/src/lib/meetings/meeting-attendance-panel.svelte` — an ended meeting's boards and their documents beside who attended
- tests; `docs/user/features/meetings.md` — filing, where the documents land, redaction

### Slice three — annotation over a shared screen

Backend:

- `apps/api-worker/src/routes/meeting-boards.ts` — the annotation arm of opening, the stills route, the still on close and filing
- `apps/api-worker/src/meetings/board-filing-consumer.ts` — the still: wait, include, or refuse
- `packages/meetings/src/board-*.ts` — the sharer rules and the still consent
- the emitted contract, the generated client, the route and consumer tests, the ledger and status fragments

Web:

- `apps/web/src/lib/meetings/client/still-frame.ts` (new) — the frame grab behind a seam on `MeetingClientSeams`, and the PNG encoding
- `apps/web/src/lib/meetings/client/meeting-client.svelte.ts` — the seam; grabbing before the track stops; closing the board when the share changes shape
- `apps/web/src/lib/meetings/client/capture.ts` — the share's settings change reported to the boards concern
- `apps/web/src/lib/meetings/screen/meeting-annotation-layer.svelte` (new) — the surface over the screen tile, through `annotation-space.ts`
- `apps/web/src/lib/meetings/screen/meeting-board-filing-dialog.svelte` (new) — the still consent, an `ActionDialog`
- `apps/web/src/lib/meetings/screen/meeting-tile.svelte`, `meeting-grid.svelte` — Allow annotation and Annotate on a screen tile, the layer in place
- `apps/web/src/lib/meetings/meetings-api.ts` — the stills route and the presigned PUT
- tests; `docs/user/features/meetings.md` — annotating, and what a picture of your screen means before you agree to it

## 18. Decisions to record

Four, each a fragment under `docs/decisions/pending/` in the slice that lands it: **a board is an operation log ordered by the room, not a CRDT, because the room must validate every operation**; **the room holds a board's content during the meeting, bounded in size and time, and the record is what it is filed as**; **an annotated screen is filed as its annotation layer, with a still only by the presenter's own capture and consent, because no server decodes the presenter's video**; **the renderer is the design system's own and no third-party whiteboard SDK is taken**.

## 19. What this does not settle

- **Whether erased content belongs on the record.** The board is filed as it stands, and what was erased before a filing is gone with the log (section 2). That matches a physical whiteboard and differs from chat, where a redacted line leaves its row. If the owner wants every mark ever made kept, the change is to file the log itself as a third document — the log is already the export's input — at the cost of a record nobody reads without a player for it.
- **Moving, resizing and restyling an element; several pages; images, documents and sticky notes on a board; zoom and pan.** Each is an operation kind and a question for the fold. Moving is the likeliest to be asked for first.
- **A folded snapshot and an undo horizon.** Not built, for the reasons in section 3.5, until the load profile shows a catch-up that costs too much.
- **Text outside the standard font's repertoire in the PDF.** The engine's standard sans face covers Latin text; a character it cannot set is drawn as a replacement mark in the PDF, while the SVG carries it exactly. Embedding a font with the needed coverage is a change to the engine and a choice of font, and is left to when a firm needs it.
- **Annotation that follows scrolled content.** Not possible without understanding the shared application, which the platform never sees.
- **An overlay on the presenter's own desktop**, drawn over the operating system rather than over their screen tile. A desktop-only capability, and the parity rule does not admit one.
- **Remote control of a shared screen**, which the measurement against Zoom listed beside annotation. A different act with a different consent question.
- **A still from a guest presenter.** A guest has no upload route, so a guest's shared screen is filed as its annotations alone. If guests ever upload, the consent flow here is what they would use.
- **Breakout rooms**, beyond the column their design adds (section 14).
- **A board in a firm meeting kept somewhere.** It waits, like a firm meeting's recording, on a firm-level document home.
