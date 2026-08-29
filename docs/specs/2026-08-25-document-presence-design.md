# Document presence — design

**Status:** Proposed (design) · **Date:** 2026-08-25 · **Owner:** Trevor Goldsmith
**Ledger item:** **P16** — "a document showing who has it open, live." The owner raised it
unprompted while answering the checkout question and called it interesting; recorded in
[`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) (round eight)
as designed-in-discussion, not built.
**White paper:** _Documents & automation_, _Delivery model_, _Performance & concurrency model_ —
binding context, not restated here.
**Binding rulings:** **a checkout is not a lock** (editing runs through Durable Objects; others
still edit a checked-out file) · **reading is never blocked** · names are the person's name,
**never "You"** (ruling L14) · Lucide icons only · presence is worth having (the P16 ruling itself).
**Related spec:** [`2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md`](2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md)
(the editing architecture this composes over).

**Not in scope:** building any of it (this is the design round); the client portal (unbuilt — one
decision here is deliberately taken ahead of it); desktop parity mechanics (the design is
transport-level and the desktop shell consumes the same API, so parity is structural); concurrent
authorship _credit_ (open ledger item P8 — presence says who is in the room, not who wrote the
sentence).

---

## 1. Current state — what the platform already knows, verified in code

Presence is unusual among P-items: most of the machinery already exists, because the editing
architecture was built with a per-document coordinator from the start. What follows was read from
the code, not inherited from the slice 2·2 spec.

**The document's editing posture is durable, recorded state.** `file.edit_state`
(`packages/database/src/per-firm-schema.ts`) is `idle | coediting | checked_out`, NOT NULL, on the
file row itself — one column away from every file-list read. It answers "is something happening to
this document" but never _who_.

**The per-document Durable Object already holds a participant set.** `DocumentSession`
(`apps/api-worker/src/editing/document-session.ts`), addressed `idFromName(fileId)` — one per
document, an owner red-flag against pooling — holds in durable storage:

- `participants: Record<memberId, "view" | "edit">` — every editor who joined the live session;
- `sessionId` — the shared co-editing session identity, minted on first join, cleared on close;
- `wopiLock`, the `current` working-object metadata, and the idle-reap alarm (30 minutes,
  re-armed by every join and every save).

**Arrival is authoritative; departure is not.** The editor-launch route
(`apps/api-worker/src/editing/edit-session-route.ts`) calls `joinEditor(memberId, …)` on every edit
launch — so the server _participates_ in every arrival. But `dropParticipant` exists and **is
called from no route**: today a participant leaves the set only when the 30-minute idle reap fires
or the file is force-closed. A member who closes their tab remains "present" for up to half an
hour. Any presence surface built naively on this set would lie, which section 4 treats as the
first thing v1 must fix.

**Viewers are deliberately invisible.** The read-only view-session route reads the Durable Object's
state (`getState()`) to join the live session id but writes nothing — no participant record, no
lock, no audit row. `recordParticipant` (the "view" capability writer) is likewise never called.
So today the server has authoritative knowledge of _editors_ and zero knowledge of _viewers_ —
the taxonomy in section 2 is not a design preference, it is the built reality.

**Checkouts are recorded business state.** `document_checkout` carries `holder_member_id`,
`lock_type` (`exclusive | offline_working_copy`), `status` and `last_activity_at`, aged by the
daily `active → stale → released` sweep. Who has a document checked out is a plain firm-database
read, no coordinator involved.

**No surface reads any of it.** The file-list API returns no `editState`; the mockup's
coediting/checked-out rendering runs on fixture data. And the WOPI `CheckFileInfo` response
(`apps/api-worker/src/editing/wopi-routes.ts`) carries `UserId` but **no `UserFriendlyName`** —
so even once the Collabora container is live, its own in-editor avatar list would show opaque
member identifiers rather than names.

**The push seam already has a house convention.** `docs/conventions/api.md` (_Push progress over
WebSocket_) defines the platform's subscribe-beside-poll pattern on hibernatable Durable Object
WebSockets: the poll endpoint always stays, the pushed frame is the poll body verbatim, ping/pong
rides the runtime's byte-for-byte auto-response so a keepalive never wakes a hibernating object,
and nothing about a subscription lives on the instance (attachments + storage only).
`downloads.bundleEvents` and `conversions.events` are the two shipped implementations, with the
shared helpers in `apps/api-worker/src/progress/`. Presence v3 is a third tenant of this
convention, not a new transport.

**Prior art elsewhere, briefly verified (2026-08).** Microsoft 365 / SharePoint co-authoring shows
per-document presence indicators and live cursors inside the editor, and legal document-management products
(iManage, NetDocuments) reach the same experience through Office co-authoring integrations —
presence inside the editor is table stakes, presence _on the file list_ is the differentiator
practice-management products mostly lack. Cloudflare's current Durable Objects guidance confirms:
hibernatable WebSockets (`ctx.acceptWebSocket`) accrue **no duration billing while hibernated**,
per-connection attachments are capped at 16,384 bytes, and incoming WebSocket messages are billed
as requests at a 20:1 ratio with outgoing messages free
(developers.cloudflare.com/durable-objects/platform/pricing,
/durable-objects/best-practices/websockets). The cost argument in section 3 rests on those
numbers.

---

## 2. What "open" can mean — the taxonomy, one honesty class per row

"Who has it open" is three different claims with three different evidentiary standards. The design
refuses to blur them, because a presence indicator that cannot say which claim it is making will
eventually make the wrong one.

| Open in the sense of…                                              | The server's knowledge                                                                                                                                         | Honesty class                                                                                    | Where the truth lives                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Editing** — a live session in the in-app editor                  | The server is a party to it: the launch joined the member to the `DocumentSession` Durable Object, and every WOPI callback carries the member's verified token | **Authoritative** — arrival and activity are facts; departure needs one wiring fix (section 4)   | The document's own Durable Object                               |
| **Viewing** — the preview pane, the read-only editor view          | None, by design: the view launch writes nothing, and a preview is a byte fetch. Only the client knows the pane is still on screen                              | **Advisory** — exists only if the client volunteers heartbeats, and expires the moment they stop | The same Durable Object, as TTL'd entries, if built at all (v2) |
| **Checked out** — an offline working copy or opt-in exclusive lock | Fully recorded: the `document_checkout` row, aged by the daily sweep                                                                                           | **Recorded state** — a fact about a claim, not about a person's screen right now                 | The firm database, already                                      |

Two consequences fall straight out:

- **Editing presence and checkout state are free of new truth infrastructure** — one is Durable
  Object state the server already maintains, the other is a table the server already sweeps. Only
  viewing presence needs anything invented (heartbeats), which is exactly why it is a later tier.
- **The three must render distinctly.** "In the editor now" (live), "checked out by" (a standing
  claim — and _not_ a lock, per the ruling), and "viewing now" (advisory, if ever built) are
  different sentences, and the UI never collapses them into one anonymous dot vocabulary without a
  way to tell which claim is being made (section 6).

What "open" never means here: having the matter open, having the file selected in a list, or
appearing in an audit trail. Presence is about _now_; the audit log and History already own _then_.

---

## 3. Source of truth and cost — the per-document Durable Object, and what a list may honestly ask

### The recommendation

**Per-document presence lives in the document's own `DocumentSession` Durable Object, and nowhere
else.** Editing sessions it already hosts are the authoritative tier; viewer heartbeats (v2) join
it as advisory, TTL'd entries in the same state. No presence rows are written to the firm
database — presence is ephemeral coordination state, not business data, and writing per-heartbeat
rows into per-firm SQLite would put churn on the durable record for facts that expire in seconds.
The only durable footprint stays what it already is: `file.edit_state` and `document_checkout`.

Alternative considered and rejected: a **per-matter presence aggregator** (one Durable Object
fanning in every document's presence so a list reads one object). Rejected for now on three
grounds — it is a second copy of the truth that can disagree with the per-document object; the
fan-in write lands on the editing hot path (every join/leave/save would make a cross-object call,
against golden rule 10); and section 3's read model makes it unnecessary at v1 scale. It remains
the named seam if measurement ever shows list-level _live_ presence is wanted (section 7, v3+).

### The cost model, argued with the platform's actual prices

- **One open document (inspector, editor chrome):** one `getState()`-shaped read on open, then a
  slow poll (~30 s) while the surface stays open. A Durable Object request is ~$0.15/million;
  an inspector open for ten minutes costs ~20 requests. The object is usually already awake — an
  edit session in progress is receiving WOPI callbacks — so wake cost is the exception, and a
  woken idle object answers a read in single-digit milliseconds and hibernates again. This is
  honest and nearly free.
- **A matter file list (rows with presence dots):** the dishonest design is the one to name and
  refuse — resolving N Durable Objects per list render (200 files = 200 cross-object requests per
  refresh per viewer) buys liveness nobody asked for at a cost profile that scales with folder
  size. The honest v1 answer: **the list-level signal is `file.edit_state`, one column on the row
  the list already reads.** Zero additional reads, zero additional queries — the dot is D1 data
  the list query returns anyway, refreshed whenever the list refreshes. It answers "something is
  happening to this document" at list altitude; _who_ is answered at selection altitude by the one
  per-document read. A member polling a matter list every 30 s costs the platform exactly what it
  costs today.
- **v3 live push:** hibernatable WebSockets make a subscribed-but-quiet presence socket cost
  nothing in duration (verified: no duration billing while hibernated; keepalive pings answered
  byte-for-byte by the runtime without waking the object). The marginal cost of push over poll is
  therefore roughly the incoming-message request charge at 20:1 — cheaper than the poll it
  replaces once a surface would otherwise poll faster than every ~10 minutes. Push is an
  optimization with a measured crossover, which is why it is v3 and not v1 (golden rule 10:
  measure first; the poll stays as the fallback per the house convention regardless).

### Granularity, settled

| Surface                          | Granularity                                            | Read                                                                                                 |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| File list rows                   | Document-level _something-is-live_ dot                 | `edit_state` from the list query itself (already fetched)                                            |
| Inspector / editor-launch screen | Person-level: who, capability, since when, last active | One presence read against the document's Durable Object, slow-polled while open                      |
| Editor chrome (inside Collabora) | Person-level, live cursors                             | Collabora's own session awareness — free once `CheckFileInfo` carries `UserFriendlyName` (section 5) |

---

## 4. Presence must never lie — the truth rules

The failure mode that kills presence features is the stale claim: "Alice is editing" when Alice's
laptop died forty minutes ago. Every rule here exists to make the displayed claim one the server
can stand behind.

1. **Arrival is only ever server-witnessed.** A member appears in presence exclusively because the
   launch route joined them (edit) or their heartbeat arrived (v2 view). The client never asserts
   its own presence as a display fact.
2. **Departure is wired, not inferred — and inference remains as the backstop.** v1 adds the leave
   signal that is missing today: the web app fires a leave call (`navigator.sendBeacon` on
   `pagehide`, and an explicit call on in-app editor close) that finally invokes the existing
   `dropParticipant`. The idle reap remains the backstop for the crashed client, exactly as it is
   today for the version cut.
3. **Every claim carries its age, and ages out on display.** The participant record grows
   `joinedAt` and `lastSeenAt`; `lastSeenAt` is touched by the attributable WOPI callbacks the
   member's token already signs (Lock, PutFile — the mutating callbacks, which hit the Durable
   Object anyway). The presence read returns the timestamps, and the client renders **nothing**
   for an entry whose `lastSeenAt` is older than the display TTL — even though the server has not
   reaped it yet. Stale-but-unreaped is rendered as absent, never as present.
   - v1 display TTL for editing presence: generous (minutes-scale, tuned to the measured Collabora
     save/keepalive cadence once the container is deployed — the same measurement the reap window
     already waits on). An idle-but-open editor saves nothing, so v1 wording must survive sparse
     activity: "In the editor — last active 14:32" is honest where a bare "editing now" is not.
   - v2 heartbeat TTL for viewing presence: tight (tens of seconds — the heartbeat cadence plus
     one missed beat). Advisory presence with no fresh heartbeat simply does not exist.
4. **Unavailable renders as nothing.** If the presence read fails — object unreachable, request
   timeout, the deployment has no editing runtime — the surface shows no presence at all: no dot,
   no cached names, no "presence unavailable" placeholder occupying the claim's space. The
   `edit_state` dot degrades the same way: absent data, absent dot. (The same posture the
   documents surface already takes in
   `apps/web/src/lib/documents/document-loop-availability.ts`: state the truth or state nothing,
   never render a control as though it worked.) A client whose slow poll stops getting answers
   drops its last claim after the display TTL rather than freezing it on screen.
5. **Presence is ephemeral and leaves no record.** Nothing presence-shaped is persisted beyond the
   Durable Object's own state; the audit trail keeps recording what it already records
   (`document.edit_session_opened`). Whether that boundary is exactly right is an owner decision
   (section 8, Q4) — but the default here is that presence is a live signal, not a log.

---

## 5. API and state deltas

No new tables, no new columns, no migration. Presence's durable footprint already exists
(`edit_state`, `document_checkout`); everything new is Durable Object state and routes.

**Durable Object (`DocumentSession`) — v1:**

- `participants` entries widen from a bare capability to
  `{ capability, joinedAt, lastSeenAt }`. The stored shape is versioned on load (an old-shape
  record read back is upgraded in place), so no coordinated migration is needed.
- `joinEditor` stamps `joinedAt`/`lastSeenAt`; the mutating WOPI callbacks touch `lastSeenAt` for
  the token's member (they already reach the object; the touch rides the write they make).
- `dropParticipant` gains a caller (the leave route below). Its close/cut semantics are unchanged.

**Routes — v1 (all chokepoint-registered, OpenAPI snapshot + client regenerated same commit):**

- `GET /api/v1/documents/{fileId}/presence` — the presence read. Gated exactly as the view-session
  route is (`permission: null`, `resource: "matter"`): seeing presence requires precisely the
  access that seeing the file requires, nothing more. Returns the composed truth of all three
  taxonomy rows: `editState`, the live editors (member id, display name, capability, `joinedAt`,
  `lastSeenAt`), and the active checkout (holder's name, `lockType`, since) — names resolved
  through the firm-scoped data-access layer in one batched read, rendered per ruling L14 (the
  person's name, never "You"). This is the one poll body; v3's pushed frame is this body verbatim.
- `DELETE /api/v1/documents/{fileId}/edit-session` — the leave signal (idempotent; a beacon may
  fire twice). Invokes `dropParticipant`; a `sessionClosed: true` result triggers the same
  version-cut path the reap takes today.

**WOPI surface — v1:** `CheckFileInfo` adds `UserFriendlyName`, resolved from the token's member
at callback time. This is what makes Collabora's own in-editor user list and cursor labels show
names instead of identifiers — the entire in-editor presence experience, bought with one field.
(The `/wopi/*` surface is deliberately non-OpenAPI; no snapshot change.)

**Routes — v2 (advisory tier, gated on owner decision Q1):**

- `POST /api/v1/documents/{fileId}/presence/heartbeat` — the viewer heartbeat, sent by surfaces
  that show the document's content (preview pane, read-only editor view) while visible
  (Page Visibility API gates it; a hidden tab stops claiming presence). Writes a TTL'd advisory
  entry via `recordParticipant`'s widened successor. Cadence ~30 s; the entry expires server-side
  at read time when stale, so a crashed viewer needs no reap of its own.

**Routes — v3:** `GET /api/v1/documents/{fileId}/presence/events` — subscribe-beside-poll per the
push-progress convention in `docs/conventions/api.md`: hibernatable accept, attachment-held
context, state frames on every participant transition, `426` with the poll path for a plain
request. Every participant mutation ends in a broadcast, per the convention's standing rule.

---

## 6. UI consequences — for future mockup rounds, not built now

Recorded so the mockup rounds inherit intent rather than reinvent it; each composes with the
already-rendered `edit_state` treatments and lands in the ruling ledger when the owner reviews it.

- **List rows:** a presence-tinted mark on rows whose `edit_state` is not `idle` — one visual
  vocabulary, two claims: live co-editing vs standing checkout, distinguishable at a glance
  (colour/glyph via design tokens and Lucide only). No names at list altitude, no per-row Durable
  Object reads. Hover may show what selection shows, priced as a selection (one read).
- **Inspector (Details):** an "In the editor now" line naming the people, each with capability and
  honest recency ("last active 14:32"), plus the checkout line ("Checked out by Priya Shah since
  Tuesday — not a lock; you can still edit", wording per the ruling). Absent data renders nothing
  — no empty presence section.
- **Editor-launch moment:** launching into a document someone already has open says so before the
  iframe loads — "You'll be joining Priya Shah" — turning co-editing from a surprise into a
  choice. (The launch response already knows the session is live; this is the same presence read
  at a moment the user is already waiting.)
- **Editor chrome:** inside Collabora, presence is the editor's own (avatars, cursors) once
  `UserFriendlyName` ships — the platform builds nothing here.
- **Failure:** every one of these surfaces renders absence, not apology, when presence is
  unavailable (section 4, rule 4).

---

## 7. Phased plan

| Phase                                                                                          | Scope                                                                                                                                                                                                                                                                                                              | New truth infrastructure                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1 — editing presence from what the server already knows**                                   | Participant timestamps + leave wiring in `DocumentSession`; the presence `GET`; the leave `DELETE` + web-app beacon; `UserFriendlyName` in `CheckFileInfo`; `editState` exposed to the file-list read it already sits on; inspector line + list mark + launch-screen line; display-TTL honesty; nothing-on-failure | **None** — zero heartbeats, zero new storage, zero new transport                                                                                                     |
| **v2 — viewer presence, advisory tier** (gated on owner decision Q1)                           | Heartbeat route + TTL'd advisory entries; preview/read-only surfaces send while visible; inspector distinguishes "viewing" from "editing"                                                                                                                                                                          | Heartbeats (client-volunteered, TTL'd, expiring server-side at read)                                                                                                 |
| **v3 — live push** (gated on measurement: a surface that would poll faster than the crossover) | `presence/events` subscribe-beside-poll on the hibernatable-WebSocket convention; frame = poll body verbatim; poll remains the fallback                                                                                                                                                                            | A third tenant of the existing push convention; the per-matter rollup object stays a named seam, built only if list-level _live_ presence is ever measured to matter |

The v1 argument, stated once: editing presence is the only tier where the server is already a
party to the truth — every claim it makes is backed by a signed token the server verified on a
callback it served. It therefore ships with no new lying-surface: no heartbeat that can be
spoofed, no client assertion to trust, no new storage to age. Viewer presence inverts all three,
which is precisely why it waits for both an owner decision and its own machinery. And v1 is not a
stub of the feature — "who is editing this document right now, by name, in the inspector and at
launch" _is_ the P16 sentence the owner said.

---

## 8. Owner decisions

| #      | Question                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | **Should viewer presence exist at all?** Editing presence reports collaboration; viewing presence reports _reading behaviour_ — "the managing partner is looking at your draft" is a different workplace fact from "Priya is editing with you", and some firms will read it as surveillance. v2 is gated entirely on this. | Ship v1 without it; decide Q1 on real usage. If built, viewing presence shows only on the document surfaces (inspector/launch), never as a list-level signal.                                                         |
| **Q2** | **Who sees presence?** Options: everyone with access to the file (presence rides exactly the file-read gate, no new reach) vs the matter team only vs role-carved.                                                                                                                                                         | Everyone with file access — presence reveals less than the version history the same member can already open. Flagged because visibility rules are firm-culture territory.                                             |
| **Q3** | **The client portal boundary.** When the portal exists: do firm members' presence show to portal clients, and does a client viewing a shared document show to the firm?                                                                                                                                                    | Neither, by default — presence is firm-internal until the owner deliberately opens it. Decided ahead of the portal so the portal inherits a closed default rather than an accident.                                   |
| **Q4** | **Is presence ever a record?** Today's audit trail records session opens; presence itself would be ephemeral and unlogged. A firm reconstructing "who had this open that afternoon" would find session-open audit events, not presence history.                                                                            | Keep presence ephemeral; the audit log is the record and already exists. Flagged because "who saw this document" has discovery-adjacent gravity in a law practice, and retaining it is a real (if heavy) alternative. |
| **Q5** | **Does the list mark distinguish live editing from checkout at a glance, or is one mark enough with the difference behind selection?** Pure rendering, but it sets the row vocabulary every later mockup inherits.                                                                                                         | Distinguish — the two claims have different consequences for the person about to open the file.                                                                                                                       |

---

## 9. What this design deliberately does not do

- **No presence in the firm database.** Ephemeral coordination state stays in the coordinator.
- **No per-list Durable Object fan-out, ever.** List altitude reads the row it already has.
- **No invented departure.** The leave beacon plus the existing reap; never a guess rendered as a
  fact.
- **No third editor-presence system.** Inside the editor, Collabora's awareness is the presence
  UI; the platform feeds it a name and stops.
- **No new transport.** v3 rides the push-progress convention as written; if that convention
  changes, presence changes with it, in `docs/conventions/api.md`'s one home.
