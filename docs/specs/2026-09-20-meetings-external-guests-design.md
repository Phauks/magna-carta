# External guests in a meeting — the signed link, the door, and the record

**Status:** Design, 2026-09-20. Slice 2 of Meetings, ahead of the client portal's grant model.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the signaling room, the routes and the screen this builds on. Everything it settles stands; this spec adds a second kind of person to the room and changes as little as it can to admit one.
**Beside:** [`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md) — the lobby, the host grant and the host's acts. **A guest always waits in that lobby**, and that spec already says so: a guest waits whatever the `meeting.lobby` setting says, because the door is what a guest link opens onto. This spec designs no lobby, no host act and no frame of its own; section 9 says exactly what a guest adds to that one and nothing more.
**White paper:** _Communications layer_; _Client portal_ (the `PortalGrant` model this link is deliberately smaller than); _Authentication, access control & encryption_.
**Ledger:** the `meetings.guests` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).

## 1. What this settles

A meeting today is firm members only, because a participant is somebody holding a session. A hearing, a settlement conference and a client call are not that, and the client portal — whose `PortalGrant` is the real answer to "somebody outside the firm may reach this" — is not started. So this slice mints a **signed, expiring link for one named guest on one meeting**, on the same assurance tier the e-signature work calls the tokenized link (possession of a mailbox, and nothing stronger). It is a stopgap with an explicit successor: when `PortalGrant` lands it subsumes this link, and the two tables here are the ones it absorbs.

Six decisions carry the design, and the rest follows from them.

1. **A guest is a Directory entity on the event.** Never a free e-mail address, so the record always names somebody the firm knows and the conflicts corpus can see.
2. **The link proves possession of a mailbox and nothing else**, so it never admits anybody by itself: it gets them as far as the lobby, and a host admits them.
3. **A guest holds no session and never will.** The chokepoint gains a narrow guest lane, and a guest request cannot reach a member-only handler because it never carries a user id at all.
4. **A guest's stay is its own table, shaped exactly like a member's**, so `meeting_attendance.user_id` keeps its NOT NULL and its foreign key to `member` — and the stay opens at the **door**, as the waiting room already has a member's do.
5. **The guest arrives on the app origin**, at a route outside the application shell, because the meeting's media permissions and the socket's same-origin check are both properties of that origin.
6. **Two names are kept, not one** — the Directory name the link was minted for, and the name the person typed at the door. The difference between them is the whole of what a forwarded link leaves behind, and discarding it would discard the evidence.

## 2. Who a guest is

A guest is a **participant on the meeting's event whose `participant_kind` is `entity`** — a `directoryPerson_` or `directoryOrganization_` handle on `matter_event_participant` or `firm_event_participant`. Not a free address typed into a box. Two reasons, and the second is the one that matters in a law firm: a Directory entity is conflict-checkable and already carries the contact points, so the invitation has an address to send to without inventing a second store of them; and a record that says "a link was sent to somebody@example.test" names nobody the firm can later identify, whereas one that names an entity is a fact about a person the firm has a relationship with.

**A participant of kind `external`, carrying only a `participant_name`, cannot be invited.** The schema's own note explains why that kind exists — a judge or a court reporter should not be forced into the Directory as a prerequisite, because it would pollute the conflicts corpus with people who are party to nothing — and that reasoning is unchanged here. What changes is that such a participant has no address and no identity the record can resolve, so there is nothing to mint a link for. The entry window therefore shows an external participant with an **Add to Directory** action beside the disabled Invite: promoting them is a deliberate act with a known cost, taken by a member who has decided this person belongs in the corpus, rather than a side effect of sending an invitation. An external participant who is never promoted is never a guest, and the meeting is exactly as usable for everyone else.

An **organization** entity is invitable and is not a special case: the link is minted against the organization, and the person who arrives confirms their own name at the door. A client company sending whichever of its people is free is the ordinary shape, and the record then reads "Acme Corporation — arrived as Jane Hollis", which is more true than either half alone.

**One live link per entity per meeting.** A second mint against the same pair rotates the existing invitation rather than creating a second; two live links for one guest would be two revocations to perform and one to forget.

## 3. The link

### 3.1 What is minted

Minting produces two things that are deliberately not the same object: a durable **invitation row** in the firm's own database, which is the authority, and a **bearer token** carrying an unguessable secret, which is the only thing that travels.

The token is the support-session token's wire format (`apps/api-worker/src/support/support-session-token.ts`), reused rather than re-invented: `base64url(payload).base64url(HMAC-SHA-256(AUTH_SECRET, body))`, with a `typ` discriminator. That discriminator is load-bearing and the existing file says why — several token kinds share one secret and one format, so a preview-file token would otherwise pass this token's signature check. The guest token's `typ` is `meeting-guest-invitation`.

```
payload = { typ: "meeting-guest-invitation", firmId, meetingId, invitationId, secretVersion, exp, secret }
```

`secret` is 32 bytes from `crypto.getRandomValues`, base64url-encoded — 256 bits, minted through `@magna-carta/identifiers/random` like every other credential here. The invitation row stores **SHA-256 of the secret**, never the secret and never the token.

**Why both a signature and a stored hash**, since either alone would authenticate. The signature is what lets a public route reject a flood of guessed or mangled tokens with no database read at all: a guest route is reachable by anyone on the internet, and a request that reached a per-firm durable object before anything checked it would make an unauthenticated stranger's typing into billable storage traffic. The stored hash is what makes the **row** the authority rather than the secret: a database read that returns no row, a revoked row, or a stale `secret_version` refuses a perfectly-signed token, so revocation and rotation are immediate and do not wait for an expiry. Neither property is available from the other half, so both are kept.

### 3.2 How long it lives

`expires_at` is an instant, computed once at mint and stored on the row (never re-derived at read time, per [`docs/conventions/dates.md`](../conventions/dates.md)):

```
expires_at = min( mint + GUEST_LINK_MAX_DAYS, max( eventEndInstant, mint ) + GUEST_LINK_GRACE_HOURS )
GUEST_LINK_GRACE_HOURS = 2      GUEST_LINK_MAX_DAYS = 14
```

The grace is what a meeting that runs long needs; two hours covers a hearing that starts late without leaving a live link for a week afterwards. The fourteen-day ceiling bounds a link minted against an event scheduled far out, and it is a ceiling rather than the rule because the ordinary case — invite this morning for this afternoon — should not leave a credential alive for a fortnight. An event with no end time (`endsAtTime` is nullable on both event tables) takes **the end of the event's day in the event's own time zone**, which the meeting summary already carries; the server has no zone of its own to derive a day in, and a link that expired at midnight UTC for a firm in Honolulu would die during the meeting it was minted for.

Three things end a link before its expiry, and all three are read on every verification: the meeting reaching `ended`, the invitation being revoked, and the secret being rotated.

### 3.3 Rotation and revocation

- **Rotate** — `POST /api/v1/meetings/{meetingId}/guests/{invitationId}/rotation`, `meetings:host`. Mints a fresh secret, increments `secret_version`, writes the new hash, and sends a fresh e-mail. Every token of the old version stops verifying at once, and any guest grant minted from the old version fails at its next request (section 5) — which the room turns into a closed socket rather than a guest who keeps working on a link the firm believes it replaced. This is the answer to "the client forwarded it to the whole company by accident."
- **Revoke** — `DELETE /api/v1/meetings/{meetingId}/guests/{invitationId}`, `meetings:host`. Sets `revoked_at` and `revoked_by_user_id`. The row is kept: who was invited to a meeting is part of what the record says happened, and deleting it would make an invitation that was withdrawn indistinguishable from one that was never sent. A guest currently in the room is removed by the host-controls removal act, which the handler calls after the write commits, on the ordering the existing routes already obey — a participant is never told they are out by a write that then failed.

Minting, rotating and revoking all ride **`meetings:host`**, already registered and already bound to `resource: "firm"`. No new permission key: somebody who may open a meeting on this event and end it is somebody who may decide who is in it, and the event's own visibility predicate has already answered the harder question of whether they may see the matter at all.

### 3.4 Delivery

Through the existing `sendEmail` port (`apps/api-worker/src/email-port.ts`) and whatever adapter this deployment carries, with `messageClass: "meeting-guest-invitation"` so the telemetry counts it without touching the body. The mail carries **the firm's name, the event's title, the event's start in the event's own zone, and the link** — and nothing else about the matter. The title is disclosed because the host's act of inviting this person to this meeting discloses it; no matter identifier, no matter name that is not already in the title, no participant list and no document travels.

**The address is not stored on the invitation.** The row records `directory_email_id`, the contact point that was used, and the address itself stays the Directory's fact. One home per fact, and a second copy of a client's e-mail address is a second thing to protect, redact and keep current.

**The link goes to a screen that spends nothing on open.** This is the property the joining mails already hold and `apps/api-worker/test/joining-mail.test.ts` already pins: a mail client that prefetches links, a corporate scanner that follows every URL in an inbound message, and a person who clicks twice must all cost nothing, because opening the arrival page performs no write and burns no token. What spends the token is the guest pressing Join on that page, which is a POST no prefetcher makes. The mail also carries the bare token on its own line as a typed fallback, exactly as the confirmation mail does, so a client that refuses links is not a dead end.

## 4. The arrival

### 4.1 Where it is hosted, and why not the portal host

**The app origin, at `/join/<token>`, outside the `(app)` route group.** Not `portal.magnacarta.esq`, which the white paper's _Client portal_ topic reserves for the `PortalGrant` surface. Four reasons, in the order they would bite:

1. **The portal host does not exist.** Standing one up for a meeting link would settle, by accident and in a hurry, several questions the portal's own design owns — its origin, its cookie posture, its principal model — and would then have to be unpicked when `PortalGrant` subsumes this link.
2. **The media permissions are already right on this origin.** With no `Permissions-Policy` header the default allowlist for camera, microphone and display capture is `self`, which is the application origin. A second host needs its own allowlist entry and its own correctness argument for exactly the three capabilities a meeting needs.
3. **The socket's same-origin check is on this origin.** The upgrade refuses a present `Origin` that is not this application's, and that check was added deliberately because a WebSocket upgrade is not subject to the same-origin policy. A guest page on another host would force that check to be widened, which is the opposite of what this slice should do to it.
4. **It needs no operator step.** `/join/*` is an SPA path served by the static assets, and the guest API rides the existing `/api/*` family, so neither the zone's route patterns nor `run_worker_first` in `wrangler.jsonc` changes. A new top-level path family on this Worker is both of those plus an operator action, and the failure mode when it is forgotten is a 200 carrying the application shell.

The cost is stated rather than waved at: the guest page is served from the same origin as the firm's application, so it must be **structurally unable to reach it**. It lives outside the `(app)` group, so it inherits no shell, no session bootstrap, no sidebar and no back-navigation registry; it calls only the guest routes; and it holds no cookie, so an application route it somehow called would answer the reserved 404 anyway. No guest-supplied bytes are ever rendered on this page, which is the reason the cookieless files origin exists and the reason it does not apply here.

### 4.2 What the guest does

1. **Open the link.** The page reads the token from the path and asks `GET /api/v1/guest/meeting` for the reduced summary — the firm's name, the event's title and time, the medium, the meeting's status, and the name the link was minted for. Nothing is written and nothing is spent.
2. **Confirm the name and choose devices.** The name field is pre-filled with the invited Directory name and is editable; a person arriving on an organization's link types their own. Beside it, a microphone picker, a camera picker (absent in a call) and a live preview with a level meter, so a guest learns their microphone is muted in hardware here rather than in front of the room.
3. **Press Join.** `POST /api/v1/guest/arrivals` spends the token: it opens a **guest stay at the door** (`waiting_from` set, `admitted_at` null), records the arrival on the invitation, and mints the guest grant. The response is the member join's shape — `{ waiting: true, participantId, displayName, iceServers, medium, guestGrant }` — because a guest arriving is a member arriving at a lobby-on room plus a credential.
4. **Wait in the lobby.** The page opens the meeting's signaling socket with the grant and receives the `lobby` frame, then `admitted` and `welcome`, or `refused: denied`. Every one of those is the waiting room's, unchanged.
5. **The room.** On admission the guest publishes and subscribes exactly as a member does, from the relay credentials the arrival already answered with.

A meeting that has ended, an expired link, a revoked link, a rotated secret and a link that has been used too many times are each answered at step 1 or step 3 with a sentence a person can act on and a suggestion to ask the firm for a new link. A token whose **signature** does not verify gets one flat refusal that says nothing at all — section 7.2 explains why the line is drawn there and not elsewhere.

### 4.3 The guest routes

| method   | path                                                | lane       | does                                                                                             |
| -------- | --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/guest/meeting`                             | invitation | the reduced summary; writes nothing, spends nothing                                              |
| `POST`   | `/api/v1/guest/arrivals`                            | invitation | body `{ confirmedName }`; opens the guest stay at the door, records the arrival, mints the grant |
| `GET`    | `/api/v1/guest/meeting/socket`                      | grant      | the signaling socket, in the lobby state until the guest is admitted                             |
| `POST`   | `/api/v1/guest/departures`                          | grant      | closes this guest's own stay, the way a member's leave does                                      |
| `POST`   | `/api/v1/meetings/{meetingId}/guests`               | app        | `meetings:host` — mint an invitation for an entity on the event and send it                      |
| `GET`    | `/api/v1/meetings/{meetingId}/guests`               | app        | `meetings:host` — the invitations on this meeting, never the token or the secret                 |
| `POST`   | `/api/v1/meetings/{meetingId}/guests/{id}/rotation` | app        | `meetings:host` — a new secret and a fresh mail                                                  |
| `DELETE` | `/api/v1/meetings/{meetingId}/guests/{id}`          | app        | `meetings:host` — revoke; `reversal` metadata required on a DELETE                               |

The guest routes carry **no meeting identifier in the path**. The meeting is a fact of the token, not of the request line, so a guest cannot address a meeting the link was not minted for, and there is no identifier for them to change. The reduced summary is a distinct schema from `MeetingSummary` rather than the same one with fields nulled — `{ firmName, title, startsOn, startsAtTime, endsAtTime, timeZone, medium, status, invitedName }` — because a nulled field is a field somebody restores, and `matterId` and `eventId` must never be reachable here.

## 5. The guest lane at the chokepoint

A guest has no session, no cookie, no `member` row and no capability. The chokepoint's first three steps are about a session, and the whole risk of this slice is in how a request with none of that is admitted. The lane is therefore made as small as it can be and refuses by default at every point.

**`RouteMeta` gains one field**: `guestLane?: "invitation" | "grant"`. Absent — which is every other route in the platform — nothing changes at all. Present, it is refused at **registration** unless the route also declares `authenticated: false`, `permission: null`, `surface: "app"` and `resource: "firm"`, on the same fail-at-startup terms an unregistered permission is refused on today. A guest route can therefore not be written that names a capability, because there is no principal to hold one.

At request time the lane is **step 0**, ahead of the session resolution, and it never runs for a route that did not declare it:

1. **Read the credential.** The `X-Meeting-Guest` header on an ordinary request; the `guest` query parameter on the socket upgrade alone, because a browser cannot set a header on a WebSocket. The parameter is accepted **only** on the upgrade route, so no ordinary route can be driven by a URL somebody was persuaded to click.
2. **No credential, or a signature that does not verify** — the reserved 404, the same absence a cross-firm request gets. Nothing is read, so nothing is billed and nothing is disclosed.
3. **Verify the payload:** `typ` matches the lane, `exp` is in the future, and the firm id is one this deployment serves.
4. **Resolve the firm context** through a new port method, `resolveGuestFirmContext(c, grant)` — deliberately not a widening of `resolveFirmContext`, whose member-active check is the thing a guest cannot pass and the thing a member must never skip. Two methods cannot be confused; one method with a flag can.
5. **Read the invitation row** and refuse unless it is live: not revoked, `secret_version` equal to the token's, `expires_at` in the future, SHA-256 of the presented secret equal to the stored hash under a constant-time comparison, and the meeting not `ended`.
6. **Stash `chokepointGuestGrant`, `chokepointFirmId` and `chokepointFirmContext` — and never `chokepointUserId`, and never `permissions`.** This is the structural guarantee rather than a rule somebody has to remember: `requireChokepointUserId` throws on absence, so a member handler that a guest route was accidentally pointed at fails loudly on its first line instead of serving a guest something it assumed was a member.
7. **Continue into the existing steps 4, 5 and 6** — idempotency, rate limit, handler — unchanged. The firm-scoped idempotency store works because the firm context is stashed; the rate-limit key is `guest:${invitationId}` rather than the IP key, so one shared link is one bucket however many people hold it.

`loadPermissions` is never called on this path, which is the same structural property the pending unified-identity work relies on for portal principals: no `member` row means RBAC grants nothing anywhere, under any bug. A guest is not a firmless session either — `firmlessSession` is untouched and still defaults to `reject`, because a guest **has** a firm context, resolved from a credential rather than from a cookie.

## 6. The record

### 6.1 Two tables, additive

```
meeting_guest_invitation
  id                    text pk            -- meetingGuestInvitation_ handle
  meeting_id            text not null -> meeting.id
  entity_kind           text not null      -- 'person' | 'organization'  (CHECK)
  entity_id             text not null      -- directoryPerson_/directoryOrganization_ handle, by value
  invited_name          text not null      -- the Directory display name at mint, frozen
  directory_email_id    text null          -- which contact point the link was sent to
  token_secret_hash     text not null      -- SHA-256 of the secret, hex; never the token
  secret_version        integer not null default 1
  issued_by_user_id     text not null -> member.user_id
  expires_at            text not null      -- instant
  revoked_at            text null
  revoked_by_user_id    text null  -> member.user_id
  arrival_count         integer not null default 0
  last_arrival_at       text null
  created_at, updated_at
  UNIQUE (meeting_id, entity_id)
  INDEX (meeting_id)

meeting_guest_stay                        -- meeting_attendance's shape, for somebody with no user id
  id                    text pk            -- meetingGuestStay_ handle
  meeting_id            text not null -> meeting.id
  invitation_id         text not null -> meeting_guest_invitation.id
  confirmed_name        text not null      -- what the guest typed at the door, <= 80 characters
  joined_at             text not null      -- instant the stay began, which for a guest is at the door
  waiting_from          text not null      -- instant they reached the door; never null, a guest always waits
  admitted_at           text null          -- instant a host let them in; null while waiting
  admitted_by_user_id   text null  -> member.user_id
  left_at               text null
  ended_reason          text null          -- 'left' | 'socket-lost' | 'removed' | 'denied'  (CHECK)
  created_at, updated_at
  INDEX (meeting_id, left_at)
  INDEX (meeting_id, waiting_from) WHERE left_at IS NULL AND admitted_at IS NULL
  partial UNIQUE (meeting_id, invitation_id) WHERE left_at IS NULL
  CHECK ((admitted_at IS NULL) = (admitted_by_user_id IS NULL))
  CHECK (ended_reason IS NULL OR left_at IS NOT NULL)
  CHECK (left_at IS NULL OR left_at >= joined_at)
```

The column-for-column correspondence with `meeting_attendance` as the waiting room leaves it is deliberate and is the property to hold: `joined_at`, `waiting_from`, `admitted_at`, `left_at` and `ended_reason` mean here exactly what they mean there, so the two predicates that decide who is present compose over both tables without a second definition of "in the room". The three differences are the three facts a member's stay has no room for — the invitation, the name typed at the door, and the absence of a user id — and `waiting_from` being NOT NULL, because a guest waits whatever the meeting's lobby setting says.

Identifiers: `meetingGuestInvitation` and `meetingGuestStay` in `@magna-carta/identifiers` (types plus registry). Personal-data registry: `meeting_guest_invitation.entity_id`, `invited_name`, `directory_email_id` and `meeting_guest_stay.confirmed_name` are `retain-under-matter`, on the same reasoning `meeting_attendance.user_id` already carries — who was in the room is part of what the record says happened.

### 6.2 Why a second table rather than a nullable column on `meeting_attendance`

The alternative was the schema's own participant-kind idiom: `participant_kind` on `meeting_attendance`, `user_id` relaxed to nullable, a `guest_entity_id` beside it, and an exactly-one shape CHECK — which is how `matter_event_participant` already resolves this exact question, and the house idiom is normally the answer.

It is rejected here for a mechanical reason that does not apply to a new table. **SQLite cannot drop a NOT NULL in place**, so relaxing `meeting_attendance.user_id` is a table rebuild — create, copy, drop, rename — and the rebuild register (`packages/database/src/reviewed-rebuilds.ts`) is explicit that a rebuild is debt rather than a routine tool, that the grandfathered list must never grow, and that the answer to changing a constraint on an existing table is to **add a column** rather than write a cleverer rebuild. That is exactly why the waiting room could put `waiting_from`, `admitted_at` and `ended_reason` on `meeting_attendance` and think nothing of it: adding is free, and relaxing is the one thing adding cannot do. Three further costs land on the same side: `user_id`'s foreign key to `member.user_id` stops constraining anything the moment it is nullable; `meeting_attendance_open_stay_unique_index` stops constraining guests at all, because SQLite treats NULLs in a unique index as distinct, so a second partial index would be needed anyway; and a guest stay carries three facts a member stay never has, which would be three columns null on every member row forever.

The real cost of the second table is stated plainly, because it is the thing a reviewer should check: **every read of "who is in this meeting" must now read both tables, and one that forgets silently under-reports the record.** The waiting room already saw this coming and built the thing that contains it — "one predicate, one home": _in the room_ and _waiting_ are single exported SQL fragments in `meeting-statements.ts`, composed by the live count, the capacity guard, the roster and the lobby list, so those four cannot drift into disagreeing about who is present. This slice does not add a fifth definition; it makes each fragment a union over the two tables, in the one file that holds them. Four composers follow from it:

- **The live count and the capacity guard.** The guard is on **admission**, by the waiting room's ruling, and its `WHERE` counts admitted open stays of both kinds — so `MAX_MEETING_PARTICIPANTS` is one ceiling over members and guests and a host admitting into a full room gets the refusal naming who did not get in.
- **The lobby ceiling.** `MAX_MEETING_LOBBY` counts waiting stays of both kinds, and the guest door is guarded by it exactly as the member door is. The waiting room's own note says the guest door lands on this path next; this is that.
- **The attendance read.** `listAttendance` becomes a `UNION ALL` ordered by `(joined_at, id)`, which is the sort key the cursor already encodes, so the paged walk is unchanged.
- **The end.** `closeAllAttendanceStatement` gains a sibling for guest stays in the same batch, so ending a meeting still closes every open stay — member and guest, waiting and admitted — at **one** instant.

A fitness test asserts the reads directly: a meeting holding one member and one guest answers two entries from the attendance read and a live count of two, and the assertion is written so that a third kind of stay added without touching the fragments fails it.

### 6.3 What the attendance read returns

`MeetingAttendanceEntry` — which the waiting room is already widening with `waitingFrom`, `admittedAt` and `endedReason` — gains `participantKind: "member" | "guest"` and `displayName`, and `userId` becomes nullable, null for a guest, who has none. Widening the field is preferred to inventing a parallel guest array for the reason the pending principal-kind work gives for nullable firm identifiers: the compiler then forces every reader to say what it does with the absent case, once, rather than leaving a silent under-report for reviewers to catch forever. A guest entry also carries `entityId` and `invitedName`, so the Meetings page can render **"Jane Hollis (Guest — invited as Acme Corporation)"** and a reader can see at a glance that the person who attended is not the person who was invited.

**A stay handle on the wire is now one of two kinds**, because `participantId` is the stay's own handle and a guest's is a `meetingGuestStay_`. The room does not care — a participant handle has always been opaque to every frame — but two route parameters do: the removal route's `{participantId}` and the lobby's admission and denial bodies. Each takes a shared `meetingParticipantHandle` validator accepting either shape rather than `identifierPathParam("meetingAttendance", …)`, and the service resolves which table it names. One helper, named once, rather than a guest-shaped copy of three host routes.

## 7. Security

### 7.1 The credential

256 bits of CSPRNG entropy in the secret; SHA-256 of it at rest; HMAC-SHA-256 over `AUTH_SECRET` for the envelope, with the `typ` discriminator the shared-secret format requires. Every comparison of a secret or a signature is constant-time (`apps/api-worker/src/constant-time.ts`). The token never reaches a log, a counter dimension, an error message, an audit row or a telemetry field — the same rule the human-verification token carries, and for the same reason: it is a bearer credential, and a field that holds one is a field somebody eventually prints.

The **guest grant** minted at arrival is the same format with `typ: "meeting-guest-grant"` and a shorter life — `min(invitation expires_at, mint + 12 hours)` — carrying the guest stay's own handle as well, which is what every frame and every host act names them by. It rides the socket URL as a query parameter on the upgrade alone. That is the exposure worth naming: a URL can end up in a log. It does not end up in browser history (a WebSocket address is not a navigation), it sends no `Referer`, it never leaves this Worker, it is capability-only for one meeting, and it dies with the meeting. The redaction allowlist must exclude it explicitly, and a fitness assertion over the request-logging path is cheaper than remembering.

### 7.2 Replay, and what a refusal may say

The token is **not burned on first use**, and that is a decision rather than an omission. A guest whose laptop sleeps, whose browser crashes or who loses a network for two minutes must be able to come back, and a burnt link means telephoning the firm in the middle of a hearing. What is single-use is the **arrival**: each spend of the token mints a fresh grant, and a spend while a stay is already open returns **that** stay rather than opening a second — held by the partial unique index, and the same answer a member's second join already gets. The room's existing rule then does the rest: one live socket per stay, newest wins, the older refused `superseded` and closed. Two browsers on one link therefore cannot be in the room at once; the second takes the place of the first, visibly, and the arrival count records that it happened.

**A guest who was removed or denied cannot come back on the same link.** The arrival route refuses an invitation that holds a stay on this meeting closed `removed` or `denied`, which is the guest half of the waiting room's bar on re-entry — without it, a removal would be undone by the person removed simply reopening their e-mail. It is the meeting they are barred from and not the event; a host who wants them back rotates the link into a new meeting, which leaves a record of exactly that.

Arrivals are bounded twice. `arrival_count` on the invitation is capped at `MAX_GUEST_ARRIVALS = 20` over its life, refused with `guest-link-exhausted`, which bounds a link forwarded to a crowd without punishing a bad connection. And the arrival route sits on a new rate-limit bucket, `guest-arrival` (20 per 60 seconds), keyed by the invitation once the signature verifies and by the client address before it, so junk traffic and a real guest's retries are bounded separately.

**Where the line between a flat refusal and a useful one is drawn.** A token whose signature does not verify gets one indistinguishable answer, because a stranger guessing at the route must learn nothing — not whether a meeting exists, not whether a firm does. A token whose signature **does** verify but which is expired, revoked, rotated, exhausted or attached to an ended meeting gets a specific, actionable sentence, because the only person who can present a validly-signed token is somebody the firm sent one to, and they already know everything that answer tells them. Withholding it from them would cost a real guest a phone call to gain nothing against anybody.

### 7.3 A link that reached the wrong person

Three things stand between a forwarded link and a stranger in a privileged conversation, and none of them is the token.

- **The lobby.** A guest never enters on their own. Admission is a host's act, always, with no "trusted guest" setting to erode it — the difference between this and a conferencing product's default is deliberate.
- **The name at the door.** The page asks who is arriving and pre-fills the invited name. The host sees both in the lobby: the name typed, and the entity the link was minted for. A mismatch is visible **before** admission rather than discovered afterwards, which is the only moment at which it is still cheap.
- **The record keeps both.** `invited_name` and `confirmed_name` are separate columns and neither overwrites the other, so "the link for Acme Corporation was used by somebody calling themselves J. Doe" survives in the record. A design that resolved the two into one name would destroy exactly the evidence a firm would want six months later.

The confirmed name is untrusted display text: length-bounded at 80 characters, normalized for whitespace, rendered as text and never as markup, and it never replaces the Directory's name anywhere.

### 7.4 What is logged

Audit rows through `domainAuditStatement`, identifiers and instants only, on the meeting's existing event vocabulary: `meetings.guest.invited`, `meetings.guest.linkRotated`, `meetings.guest.linkRevoked`, `meetings.guest.arrived`, `meetings.guest.admitted`, `meetings.guest.denied`, `meetings.guest.left`. Never the token, never the secret, never the address, never anything anybody said. A refused arrival is counted, including the flat signature refusal — a gate that is silent when it is working is a gate nobody notices has stopped.

## 8. What a guest may do, and what a guest sees

**May:** publish audio, and video where the medium allows it; share a screen (a client showing a document is the ordinary case); subscribe to other participants; use in-meeting chat, on the same record terms every line has and subject to section 9; leave.

**Is subject to, exactly as a member is:** being muted, being asked to unmute (and refusing), being spotlighted, being removed, and the room being locked. Every one of those is the host-controls spec's act reaching a stay, and a guest stay is a stay — so the guest screen renders the `muted`, `unmute-requested` and `room-state` frames with the same components, and the removal path closes a guest stay `removed` and bars the link (section 7.2).

**May not, and cannot:** end the meeting, admit or deny anybody, mute or remove anybody, claim or hand over hosting, rotate or revoke a link, or read the attendance list. None of these is a hidden control on the guest screen; the routes are simply not in the guest lane, a guest holds no `meeting_host` grant and can hold none — the table's `user_id` references `member.user_id`, so a guest is structurally unable to be named in it — and a guest request carries no capability for the chokepoint to consult even if one were named.

**Does not see:** any user identifier. The roster frame carries `userId` today, and for a guest socket the room redacts it — `rosterEntryFor` takes the viewer's kind and a guest's roster entries carry `userId: null`, with the same redaction on `roster`, `roster-delta` and `welcome`. A guest sees display names, who is speaking, who is muted and which tracks exist, which is what a tile needs and no more. The guest also never sees the matter: no matter identifier, no event identifier, no attendance list, no link into the application.

**The screen** is the room and nothing else: the tile grid, the control bar (microphone, camera, share, leave — never End), a roster rail showing names, and a header carrying the firm's name and the event's title. No sidebar, no navigation, no search, no notifications, no matter link, and no route that could produce one.

## 9. Interplay

**The lobby** ([`2026-09-20-meetings-host-controls-and-waiting-room-design.md`](2026-09-20-meetings-host-controls-and-waiting-room-design.md)) — a guest always waits in it, with no exception and no setting, which is that spec's own ruling and not an addition here. Everything a waiting guest needs already exists there: the stay opens at the door, the socket's ticket is that open stay, the `waiting:` storage prefix keeps a waiter structurally out of the roster, and the `lobby`, `admitted`, `waiting` and `refused: denied` frames are the ones a guest reads. The guest is a **new kind of row arriving on that path**, not a second path, and it adds exactly three things:

1. **The lobby list and the `waiting` frame gain `kind: "member" | "guest"` and, for a guest, `invitedName`**, with `userId` null. That pair — the name typed at the door beside the Directory name the link was minted for — is what the host reads before admitting, and it is the whole of what stands between a forwarded link and a stranger (section 7.3). A lobby row that showed only the typed name would make a forwarded link invisible at the one moment it is still cheap to catch.
2. **Admission writes `admitted_at` and `admitted_by_user_id` on the guest stay** through the same guarded statement, in the same batch, under the same ceiling.
3. **Denial closes the guest stay `denied`**, and the arrival route then refuses the link for the life of the meeting.

Nothing about the lobby's own model changes for a guest: no new frame, no new refusal reason, no change to the ticket, no second waiting surface. If this section and that spec ever disagree, that one is right about the lobby and this one is right about the guest.

**Capacity** — a guest in the room counts against `MAX_MEETING_PARTICIPANTS` exactly as a member does, and a guest at the door counts against `MAX_MEETING_LOBBY` exactly as a member does, through the unioned fragments of section 6.2. Waiting costs no seat in the room, which is the waiting room's own arrangement and not something a guest needed. If the room is full when the host admits, the guarded statement refuses that one admission, the host is told which person did not get in, and the guest stays at the door rather than being dropped.

**Lock** — a locked room refuses a guest arrival with `meeting-locked`, on the host-controls ruling that lock beats the lobby: a queue in front of a shut door is a queue nobody is admitted from. The arrival page says so in the same words a member's Join control does, and the link is not spent, so the guest can try again when the host unlocks.

**Recording** — the announcement reaches guests with no extra work, because it is a room frame and a guest socket receives every room frame that is not member-identifying. Two requirements land on the recording node rather than here: the guest screen renders the same persistent recording mark every other screen renders, and a guest admitted while recording is running gets the announcement on arrival like any other late arrival.

**Chat** — a guest's lines are on the record like everyone else's, attributed to the guest stay and through it to the Directory entity, carrying the same redaction, retention and personal-data treatment a filed e-mail carries. The owner's ruling that chat is kept on the record is unchanged; this only names who the author is when the author is not a member.

**There is one thing the chat stream has to change, and it is free today and expensive next week.** `meeting_message.attendance_id` is NOT NULL with a foreign key to `meeting_attendance(id)` — which is right for the reason its own migration gives, that a line hangs from the stay that made it sayable — but a guest stay is not a row in that table, so as written a guest cannot chat at all, and the fix afterwards is the NOT NULL relaxation this spec rejected in section 6.2 for being a rebuild. While that migration is still unlanded the change is two lines: make the author column a bare `participant_id` carried **by value with no foreign key** — the `matter_party` and `custody_owner` precedent the calendar's participant tables already follow — beside a `participant_kind` of `member | guest`. The reasoning the migration states is preserved exactly: the line still hangs from a stay, and the member is still reached through that stay rather than copied onto the message. What changes is only that "a stay" stops meaning "a row in one particular table". **If that migration lands as written, this slice's chat arm is deferred rather than built**, because it would be paid for with a rebuild.

**The Meetings page** — attendance lists guests by name, marked, with the invited entity beside the confirmed name (section 6.3). The entry window and the room gain a **Guests** panel for a member holding `meetings:host`: the entity participants on the event, whether each has a live link, when it expires, how many arrivals it has had, and the mint, rotate and revoke actions. The token is never shown, not even truncated — unlike a capture address, which a person has to be able to read off a screen, this one only ever travels by e-mail.

**The client portal** — when `PortalGrant` lands it subsumes this link: a portal recipient is already a Directory entity with an assurance level, and a meeting becomes one more capability on a grant. The two tables here are what that migration absorbs, and nothing in this design should be built in a way that assumes the guest lane is permanent.

## 10. The client

The guest page reuses the meeting client **unchanged**, and that is the check on whether this design has gone wrong: `MeetingClient` takes only `MeetingClientSeams` (peer connection, socket, user media, display media, media stream, audio level meter) and a `MeetingJoinRequest` of `{ meetingId, participantId, iceServers, socketUrl, medium }`. Every one of those is a value the arrival route already answers, and `socketUrl` is a string — so the guest's socket URL carrying a grant is not a new capability, it is the same field with a different value. `browserMeetingSeams()` is used as is.

Reused as is: `MeetingGrid`, `MeetingTile`, `MeetingControls`, `MeetingAudio`, `meeting-tiles.ts`, `subscription-policy.ts`, `audio-level-meter.ts`, `refusalStatement` and the superseded handling. `MeetingRoster` takes one new property, `showIdentifiers` (false for a guest), which is the redaction's client half and is belt to the room's braces. `socket-url.ts` gains `guestMeetingSocketUrl(grant)` beside `meetingSocketUrl`, in the one directory that is allowed to know a path.

What is genuinely new in `apps/web` is two files: the arrival route and a device-check-and-name component. The waiting surface is not one of them — the waiting room builds it, and a guest sees what a waiting member sees, which is the right answer for both: a person standing at a door is a person standing at a door, and a second one of those screens would be a second place to keep the sentence right.

## 11. Testing

- **`packages/meetings/test`** — over `node:sqlite`, on the existing service tests' shape: minting refuses a participant of kind `external`; a second mint against the same entity rotates rather than duplicating; an arrival opens a stay at the door with `waiting_from` set and `admitted_at` null; a second arrival while that stay is open returns it rather than opening a second; `MAX_MEETING_PARTICIPANTS` counts admitted members and admitted guests together and the guarded admission refuses the one past it; `MAX_MEETING_LOBBY` counts waiting members and waiting guests together; ending a meeting closes every stay of both kinds, waiting and admitted, at **one** instant; the attendance read returns both kinds in `joined_at` order across a page boundary; a stay closed `removed` or `denied` refuses the next arrival on that invitation.
- **Token unit tests** — a tampered payload, a wrong `typ` (a support-session token presented here, and this token presented there), an expired `exp`, a rotated `secret_version`, a revoked row, and a secret whose hash does not match; each refused, and the comparison constant-time.
- **`apps/api-worker/test/guest-lane.test.ts`** — the chokepoint lane: no credential, a bad signature, a valid grant; that `loadPermissions` is never invoked on the guest path; that `chokepointUserId` is never set; that a member route presented with a guest credential answers the reserved 404; that a route declaring `guestLane` with a permission or `authenticated: true` throws **at registration**; and that the `guest` query parameter is accepted on the upgrade route and refused on every other.
- **`apps/api-worker/test/meetings-guest-routes.test.ts`** — the arrival flow end to end against the fake routing service: preview writes nothing, arrival opens a waiting stay and increments `arrival_count`, a second arrival returns the same stay with a fresh grant, the twenty-first is refused, an ended or locked meeting refuses, and the guest routes never return `matterId` or `eventId` (asserted over the response body, not over the schema).
- **`apps/api-worker/test/meeting-room.test.ts`** — a guest socket receives roster frames with `userId: null` while a member's carry it; a guest waiting receives `lobby` and not `welcome`; the hosts' `waiting` frame carries the guest's `kind`, `confirmedName` and `invitedName`; admission sends `admitted` then `welcome` and announces an ordinary roster join.
- **Contract** — the emitted OpenAPI snapshot and the generated client regenerated in the same commit; the conformance suite's operation list updated; the reduced summary asserted to be a distinct schema from `MeetingSummary`.
- **`apps/web`** — the arrival page against a fake transport: the invited name pre-fills and is editable, the device preview runs before anything is joined, the lobby state renders, and the room renders with the roster identifiers absent.
- **Mail** — the invitation text carries the firm's name, the title, the time and a link to the **screen**, plus the typed fallback, and contains no matter identifier. The joining-mail test is the template.

## 12. The file-touch list, and the one shared-surface risk

**The shared-surface risk is `apps/api-worker/src/chokepoint/chokepoint.ts` and `apps/api-worker/src/contracts/route-meta.ts`.** Every route in the platform depends on both, and the host-controls-and-waiting-room stream is working in the same subsystem. The guest lane is the only change either file needs, it is additive (one optional field, one step that does not run when the field is absent, one new port method), and it should land in **one commit of its own, ahead of the rest**, so that a conflict there is a conflict about six lines rather than about a slice. Whichever stream touches `route-meta.ts` second rebases rather than merges.

**This slice sequences after the waiting room and must not start before it lands**, because the guest arrives through a door that spec builds. Three files are touched by both and are where a collision would actually cost something: `packages/meetings/src/meeting-statements.ts` (the two predicates, which this slice turns into unions), `packages/meetings/src/types.ts` (both add vocabularies), and `apps/web/src/lib/meetings/meeting-lobby.svelte` (the waiting surface, which a guest and a member share). Per the repository's rule that every file has exactly one owner while work is split, those three belong to the waiting-room stream until it lands, and this slice takes them afterwards.

**Backend agent**

- `packages/identifiers/src/registry.ts`, `src/types.ts` — `meetingGuestInvitation`, `meetingGuestStay`.
- `packages/database/src/per-firm-schema.ts` + one hand-written additive migration + the snapshot, `pnpm run migration-bundles` in the same commit. Additive only: no rebuild, no column relaxed.
- `packages/meetings/src/types.ts` — the guest row types, `MAX_GUEST_ARRIVALS`, `GUEST_LINK_GRACE_HOURS`, `GUEST_LINK_MAX_DAYS`, the reduced summary type.
- `packages/meetings/src/validation.ts` — `guest-link-not-valid`, `guest-link-expired`, `guest-link-revoked`, `guest-link-exhausted`, `guest-not-invitable`.
- `packages/meetings/src/meeting-statements.ts` — the invitation and guest-stay statements, and the **in-the-room** and **waiting** fragments widened into unions over both tables. This file is shared with the waiting-room stream and is the second place the two streams meet.
- `packages/meetings/src/meeting-service.ts` — `inviteGuest`, `rotateGuestLink`, `revokeGuestLink`, `arriveAsGuest`, `closeGuestStay`; the waiting room's admission and denial paths widened to resolve either stay handle.
- `apps/api-worker/src/meetings/guest-token.ts` — **new**; mint and verify, on the support-session token's format.
- `apps/api-worker/src/meetings/guest-invitation-mail.ts` — **new**; the message text, pure and testable.
- `apps/api-worker/src/routes/meetings.ts` — the four host routes; the attendance read's widened entry.
- `apps/api-worker/src/routes/meetings-guest.ts` — **new**; the four guest routes.
- `apps/api-worker/src/chokepoint/chokepoint.ts`, `ports.ts`, `context-accessors.ts`, `contracts/route-meta.ts`, `chokepoint/rate-limiter.ts` — **the shared surface**: the lane, `resolveGuestFirmContext`, `requireChokepointGuestGrant`, the `guestLane` field and its registration guards, the `guest-arrival` bucket.
- `apps/api-worker/openapi/openapi.json` + `packages/api-client` — regenerated, never hand-edited.

**Web agent**

- `apps/web/src/routes/join/[token]/+page.svelte`, `+page.ts` — **new**, outside `(app)`.
- `apps/web/src/lib/meetings/guest-arrival.svelte` — **new**; the name field and the device check.
- `apps/web/src/lib/meetings/meeting-lobby.svelte` — the waiting-room stream's waiting surface, reused; a guest sees the same thing a waiting member sees.
- `apps/web/src/lib/meetings/meeting-lobby-panel.svelte` — the host's lobby rows gain the guest mark and the invited name beside the typed one.
- `apps/web/src/lib/meetings/guest-api.ts` — **new**; the four guest calls.
- `apps/web/src/lib/meetings/screen/meeting-roster.svelte` — `showIdentifiers`.
- `apps/web/src/lib/api/socket-url.ts` — `guestMeetingSocketUrl`.
- `apps/web/src/lib/meetings/meeting-guests-panel.svelte` — **new**; the host's Guests panel.
- `apps/web/src/routes/(app)/meetings/[id]/+page.svelte`, `apps/web/src/lib/meetings/meeting-entry-action.svelte` — the panel's two entrances.

**Both, in the same commit as the work:** `roadmap.d/meetings.md` (`meetings.guests` to `in-build`, then `shipped`), `pnpm exec vp run register-build`, `status.d/`, `vp run status-build`, `changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md` for the guest lane, and `docs/user/features/meetings.md` — a guest is the first person outside the firm to use this product, and the guide is where they are told what the link does and how long it lives.

## 13. What this does not settle

A guest who is not on the event's participant list (the link is minted from a participant, always). Dial-in for a guest (there is no telephony port). A guest on the desktop shell (parity holds — the guest page is web, and Tauri adds nothing to a link somebody opens from an e-mail). A host setting that admits a known guest without the lobby (deliberately absent, not deferred). A per-guest watermark or recording consent stronger than the announcement. And the portal itself, which is the design this one is standing in for.

## Amendments taken during the build of the server half (2026-09-24)

Each is a place the built server differs from the sections above, and why. None changes a ruling in section 1.

**The guest concern is a trio of its own, plus one module the member side reaches.** Section 12 put the guest statements and service in `meeting-statements.ts`, `meeting-service.ts` and `types.ts`. They are `packages/meetings/src/guest-types.ts`, `guest-statements.ts` and `guest-service.ts`, on the hosting and lobby precedent of one trio per concern, and `guest-removal.ts` holds the two pieces the member-side host acts need (`isGuestStayHandle`, `removalOfGuestStatements`) so that no member-side service imports the guest service, which itself composes `requireHostGrant` — the two importing each other was an import cycle. What `meeting-statements.ts` did take is the union: `MEETING_STAY_TABLES`, `inTheRoomCount` and `waitingCount`, the one home every count, ceiling and list composes.

**The host routes live beside the guest routes.** Section 12 put the four host routes in `routes/meetings.ts`. They are in `routes/meetings-guest.ts` with the guest routes, so the whole of the link's life — mint, list, rotate, withdraw, open, arrive — is one file; `meetings.ts` only exports the helpers both need (`iceServersFor`, `isSameOriginUpgrade`, `notConfigured`) and widens the attendance entry.

**The invitation is asked for by entity, not by participant row.** The mint's body is `{ entityId, directoryEmailId? }`. The entity is what the invitation names, the event participant is checked rather than addressed, and an absent `directoryEmailId` takes the Directory's own choice — primary, then preferred, never an address the person has asked the firm not to use.

**Two more guest routes: the chat.** Section 8 lets a guest use in-meeting chat; section 4.3 listed no route for it. `GET` and `POST /api/v1/guest/meeting/messages` are on the grant lane, for a guest who is in the room — admitted, not merely at the door — and answer the member's transcript with every firm user identifier taken out. There is deliberately no guest redaction act: a guest's line has no member behind it, so only a host may take it back, which falls out of the existing author comparison.

**A sixth refusal code, `guest-name-not-valid`.** The name at the door is untrusted display text — control and format characters stripped, whitespace collapsed, one to eighty code points — and a name that is empty after that is refused as a 422 rather than stored.

**The invitation list is paged.** The platform's pagination gate holds every list read to a keyset page; `GET /api/v1/meetings/{meetingId}/guests` pages at fifty, oldest first.

**One index is not built.** Section 6.1's separate index on `meeting_guest_invitation(meeting_id)` is omitted: the unique index on `(meeting_id, entity_id)` has it as its prefix and answers every read that one would.

**Rotation refuses a withdrawn link; minting again reinstates it.** Section 3.3 left the pairing open. Rotation of a withdrawn link answers `guest-link-revoked`, so bringing a withdrawn guest back is always the deliberate act of inviting them again, which reuses the one row with a fresh secret.

**A rotation also closes the socket on the old link.** A guest in the room on a link that has just been replaced is sent `refused: superseded` and closed, after the commit, so every copy of the old link stops working at once rather than at the socket's next reconnect.

**A member route presented with a guest credential answers the reserved 404** before a session is looked for — the other direction of section 5's lane — so a browser holding a member's cookie and a guest's link at once meets one answer rather than a session path deciding what to make of a credential it was never built to read.

**An ended meeting's refusal is the existing `meeting-ended` problem type** (409), not a new `meeting-already-ended` type: the condition and the sentence are the member's, and a second name for them would be a second thing a client has to map.

**An arrival is not replayed from an Idempotency-Key.** Its answer carries a grant, and a credential is never written to the idempotency store — so an arrival that is retried is simply a second arrival on an open stay, answered with that stay and a fresh grant. The host routes store the invitation and never the token, and mail only on the call that committed.

**The frames are widened, and no frame type is added.** `RosterParticipant` and `WaitingParticipant` in `@magna-carta/meeting-protocol` carry `userId: string | null` and an optional `kind`; `WaitingParticipant` carries an optional `invitedName`. The fields are optional on the wire so a client built before them keeps parsing.
