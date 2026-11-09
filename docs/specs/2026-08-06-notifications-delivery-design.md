# Notifications — the delivery half — design

**Date:** 2026-08-06
**Status:** Design proposed; the owner flags in section 12 are open. No product code in this cycle.
**Scope:** How a raised notification reaches a person. The notification record and what it is
permitted to carry; the two channels that ship (an in-app read API and an email digest through the
platform's own send port) and the redaction boundary between them; the per-member preference model
and the firm policy floor above it; the delivery mechanics (subscription, scheduling, fan-out, digest
composition, idempotency, retention); and the enforcement of matter visibility at delivery time
rather than at emission time.
**Excludes:** every user interface (the notification centre, the bell, the preference screens — the
shipped stubs stay stubs); web push; SMS/MMS; desktop-native presentation; external calendar
subscription (iCalendar/CalDAV) and outbound webhooks; and any change to what the existing emission
points decide. Each is a named seam in section 11.
**White-paper home:** _Notifications_, with _Communications layer_, _Settings & configuration_,
_Calendar and rules-based docketing_, _Custodian_, _Tenancy and data isolation_, _Authentication,
access control & encryption_, _Observability and diagnostics_, and _Performance & concurrency model_
as surrounding context.
**Governing decisions:** ADR-0059 (the Notifications subsystem — the registry owns the decision,
Communications is transport, realtime stays minimal), ADR-0221 (custody reminders resolve through one
query-shaped collection point that delivery subscribes to), ADR-0064 (the transactional outbox),
ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0068 (trusted-insider access control;
ethical walls a deferred named seam), ADR-0067 (route metadata and the one enforcement chokepoint),
ADR-0052 (canonical deep links; a filtered row is a 404, never a 403), ADR-0039 (nothing heavy on the
hot path), ADR-0050 (the cron fan-out over active firms), ADR-0055 (deadline instants in the court's
zone), ADR-0038 / ADR-0017 (redaction and audit), ADR-0040 (the settings scope chain), ADR-0051 (the
registry / seam / fitness-function discipline), ADR-0047 (the messaging port, unbuilt), ADR-0023
(web/desktop parity), ADR-0054 (the deliberately minimal realtime stance).
**Decision inputs — all shipped, all read before writing this:** the transactional outbox and its
relay (`packages/data-access/src/outbox-statements.ts`, `outbox-relay.ts`); the effect-batch
chokepoint (`packages/data-access/src/effect-batch.ts`); the per-firm queue dispatcher
(`apps/worker/src/costs/recoverable-charge-consumer.ts`); the cron pass and its active-firm
enumeration (`apps/worker/src/scheduled.ts`); the six declared calendar emission points
(`packages/calendar/src/notifications.ts`); the one custody collection point
(`packages/custodian/src/reminders.ts`); the email-filing raise site
(`packages/email-filing/src/seams.ts`); the visible-matter predicate and the timeline source registry
(`packages/calendar/src/visibility.ts`, `src/sources/`); the scope-resolved settings table
(`packages/data-access/src/scoped-setting-statements.ts`); the send port and its Cloudflare adapter
(`apps/worker/src/email-port.ts`, `email-cloudflare.ts`); the telemetry allowlist
(`packages/telemetry/src/events.ts`); and the per-firm schema
(`packages/database/src/per-firm-schema.ts`).

---

## 1. The finding this design starts from

**The emission half is already built, and nobody has said so.**

The inventory below is the whole reason this design is small. Forty-four places in the platform
already decide that something notification-worthy happened. Thirty-one of them already write a
durable row **in the same atomic batch as the change it describes** — that is the transactional
outbox, shipped, swept every five minutes, publishing onto a per-firm queue that already resolves the
firm's database and dispatches by topic. Six more are declared constants in the calendar wired to
nothing. One is a query in the custody register. One is a no-op function in email filing. Five are
job coordinators that already push a terminal state over a WebSocket.

So the honest description of this subsystem is not "build a notification pipeline". It is: **the
pipeline exists and carries thirty-one kinds of message; add one subscriber to it, add the two
emission shapes it is missing, and decide who is allowed to read the result.** Everything expensive
here is a policy question, not a plumbing question.

### 1.1 The emission-point inventory

**A. Transactional outbox topics — 31 (30 per-firm, 1 control-plane).** Each already commits in the
same batch as its source write. Producer files in parentheses.

| Domain    | Topics                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Billing   | `billing.invoice.created`, `billing.invoice.finalized`, `billing.invoice.voided`, `billing.trust.applied` (`packages/billing/src/`)    |
| Ledger    | `ledger.entry.posted` (`packages/ledger/src/post-entry.ts`) — the topic every trust movement, transfer, and disbursement rides         |
| Matters   | `matter.created`, `matter.opened`, `matter.closed`, `matter.reopened`, `matter.updated`, `matter.renumbered` (`packages/matters/src/`) |
| Documents | `document.checked_in`, `document.checked_out`, `document.lock_released`, `document.checkin_conflict`, `document.reconciled`            |
| Files     | `file.version_committed`, `file.quarantined`, `file.rescan_infected`, `file.tier_changed`                                              |
| Directory | `directory.entity.created`, `directory.entity.renamed`                                                                                 |
| Locations | `location.created`, `location.updated`                                                                                                 |
| Shipping  | `shipment.created`, `shipment.purchased`, `shipment.refunded`                                                                          |
| Email     | `emailCaptureAddress.minted`                                                                                                           |
| Assistant | `magnus.turn_submitted`                                                                                                                |
| Support   | `incident.created`                                                                                                                     |
| Members   | `member.provision` (control-plane)                                                                                                     |

**B. Declared-but-unwired emission points — 6.** `CALENDAR_NOTIFICATION_EMISSION_POINTS` in
`packages/calendar/src/notifications.ts`: `calendar.deadline.horizon`, `calendar.deadline.due`,
`calendar.deadline.overdue`, `calendar.event.scheduled`, `calendar.event.rescheduled`,
`calendar.event.cancelled`. The file's own header says what it is: names placed early because adding
a raise to a write being built is one line and finding every write path afterwards is archaeology.

**C. Query-shaped collection point — 1 (serving 2 reasons).** `collectCustodyReminders` in
`packages/custodian/src/reminders.ts` — a due review and an overdue check-out, in one shape, from one
call, with no cron, no queue, and no timer in the package. ADR-0221 settled that delivery subscribes
to that function rather than growing a second definition of what is due.

**D. Placed no-op raise site — 1.** `raiseEmailFiledNotification` in
`packages/email-filing/src/seams.ts`.

**E. Job-coordinator terminal states — 5.** `BundleBuildCoordinator`, `ConversionJob`,
`DocumentAssemblyJob`, `SearchIndexJob`, `RecoveryJobCoordinator` — each already broadcasts its
terminal state to a subscribed socket. These are the "job completion rides the per-job Durable Object
channel" case, and they need a durable row only for the tab that was closed when the job finished.

### 1.2 What the inventory implies

Three consequences shape everything below.

1. **No new transactional write is needed for group A.** The outbox row is the emission. A design that
   added a second row beside it would be writing a second, weaker copy of a guarantee that already
   holds — and would double the write amplification of every money movement in the platform. The
   Notifications subsystem becomes a **subscriber** to the per-firm bus, not an owner of a topic on
   it.
2. **Groups B and C are not events, they are comparisons.** "This deadline is due today", "this
   deadline is overdue", "this review has come round", "this check-out has not come back" — none of
   them is a write anybody performs. Nothing in the calendar writes "missed", by design, and nothing
   in the custody register schedules anything, by design. They therefore need the second production
   path ADR-0059 named: a scheduled sweep that materializes what a comparison currently returns.
   Group B's other three points (`event.scheduled`, `rescheduled`, `cancelled`) **are** writes and
   should join group A by getting outbox topics on the calendar's own write paths.
3. **The registry must reference the existing constants, never restate them.** A registry type
   subscribing to `calendar.deadline.due` names the exported constant, and a fitness function asserts
   that every subscription resolves to a member of the producing package's own frozen set. Two
   spellings of one emission point is the failure mode ADR-0221 spent a paragraph refusing.

---

## 2. The notification record

### 2.1 Three tables, and why not one

A notification has three lifetimes that do not coincide, and one table cannot hold three lifetimes
without carrying a null-heavy row that means something different in each of its states.

- **What happened** happens once, no matter how many people hear about it.
- **Whether a given person has read it** is one fact per recipient, and it is the thing the feed sorts
  and counts on.
- **Whether a copy of it left the platform** is one fact per recipient per channel, with attempts, a
  failure state, and a retry — none of which the other two have.

So: `notification_event` (per firm), `notification_recipient` (per event per member), and
`notification_delivery` (per recipient row per **outbound** channel). A fourth,
`notification_digest_run`, holds the digest watermark and is discussed in section 5.4.

**The in-app channel gets no `notification_delivery` row, deliberately.** The in-app feed is not
delivered; it is read. The recipient row's existence _is_ the delivery — there is no attempt, no
transport failure, no retry, and no address. Only a channel that leaves the platform has a delivery
attempt whose state is worth storing, and inventing a permanently-`sent` in-app row to make the
schema look symmetric would be storing a fact no code could ever branch on.

### 2.2 `notification_event` — what happened

| Column         | Shape                                                         | Notes                                                                                               |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`           | `notificationEvent_` handle                                   |                                                                                                     |
| `kind`         | text, a registry key                                          | e.g. `calendar.deadline.due`. The wire contract once shipped.                                       |
| `category`     | text, closed set                                              | Denormalized from the registry so a category filter is an index walk, not a code-side join.         |
| `severity`     | text, closed set (`informational` / `attention` / `critical`) |                                                                                                     |
| `subject_kind` | text, closed set                                              | The kind of record this is about (`matterDeadline`, `custodyPacket`, `invoice`, `fileVersion`, …).  |
| `subject_id`   | text                                                          | The record's own handle. **A link, never a copy** — the matter-party precedent: no cross-domain FK. |
| `matter_id`    | text, nullable                                                | The visibility anchor. Non-null for every matter-rooted kind; null only for firm-scoped kinds.      |
| `occurred_at`  | canonical instant                                             | When the thing happened, not when the row was written. `assertCanonicalInstant` applies.            |
| `facts`        | canonical JSON, nullable                                      | The declared non-privileged slot. Grammar in 2.4.                                                   |
| `dedupe_key`   | text, UNIQUE                                                  | The idempotency floor. Construction in 5.3.                                                         |
| `created_at`   | canonical instant                                             |                                                                                                     |

`matter_id` is not an optimization. It is the single column that makes the wall a join rather than a
per-kind rule, which is the difference between one enforcement point and thirty. A registry type that
is matter-rooted and fails to populate it is a leak, so the registry declares `matterAnchored: true`
and a fitness function asserts that every such type's materializer supplies a non-null value.

### 2.3 `notification_recipient` — who hears it, and have they

| Column                  | Shape                           | Notes                                  |
| ----------------------- | ------------------------------- | -------------------------------------- |
| `id`                    | `notificationRecipient_` handle |                                        |
| `notification_event_id` | FK to the event                 |                                        |
| `recipient_user_id`     | the global `user_` join key     | The same key `member.user_id` carries. |
| `state`                 | `unread` / `read` / `dismissed` |                                        |
| `read_at`               | nullable canonical instant      |                                        |
| `dismissed_at`          | nullable canonical instant      |                                        |
| `created_at`            | canonical instant               |                                        |

Unique on `(notification_event_id, recipient_user_id)` — a redelivered queue message must not produce
a second feed entry. Index on `(recipient_user_id, state, created_at, id)` so the unread count and the
default feed page are both index walks confined to one member's rows, in the shape the calendar's
sources established: the filter column leads, then the ordering pair that the keyset cursor walks.

**Read state belongs to the recipient, not to a channel.** Marking an item read in the feed must also
settle it for a push notification that has not been tapped, whenever push arrives. Putting `read_at`
on a channel row would mean the answer to "has this person dealt with it" depends on which channel
you ask.

### 2.4 What the row is permitted to carry — the redact-by-default argument

The hard rule is golden rule 4 and ADR-0038: redact by default, never carry privileged content. The
question this design has to answer precisely is _how much is safe_, because "nothing" makes the
feature useless and "the title" makes it a disclosure surface.

**The recommendation: the row carries identifiers, enum labels, integers, and instants. It carries no
string that a person typed.**

Concretely, `facts` is a canonical-JSON object whose keys are declared by the registry type and whose
values are drawn from a closed grammar:

- a platform identifier (`matterDeadline_…`);
- an integer (a count, a day offset, a minor-unit amount where the type declares one);
- a boolean;
- an **enum label from a set the registry type declares** (`"overdue"`, `"31-90d"`, `"exclusive"`);
- a canonical instant or a civil date.

And from nothing else. No matter title, no client name, no document filename, no email subject line,
no deadline description, no custody item description, no location name, no free-text note. A fitness
function validates every registry type's declared `facts` schema against that grammar, so a type that
declares a `string` field fails at review rather than at a disclosure.

**Why this line and not a looser one.** Four arguments, in the order they bind:

1. **The platform already made this call twice, on harder cases.** A calendar timeline entry carries
   "the source's DECLARED non-privileged label" and, where a source has none, declares it has none
   and renders by kind alone — because an email's subject line on a read spanning every matter is a
   disclosure. A custody reminder carries the object's handle, its custody number, a date, and a
   coarse bucket, and explicitly no owner, no borrower, no item description, and no location name —
   because the register is a list of the most sensitive things a firm holds and its metadata alone is
   a disclosure. A notification is the _same read shape_ as the timeline: one list spanning every
   matter a member touches. The same answer follows.
2. **The row outlives the access check that justified it.** A feed row written today is read next
   week, digested next month, and swept at ninety days. Access can be revoked in between (section 6).
   A row that holds a title holds it after the reader stops being entitled to it, and the only
   remedies are deleting rows on a revocation — a sweep that must be perfect — or filtering at read,
   which works only if the row has nothing to leak.
3. **Freshness.** A stored title is a stale title. A deadline renamed, a matter renumbered, or an
   invoice voided leaves every notification about it wrong, and wrong in a way that is invisible
   because the row looks authoritative. Resolving at read means the feed cannot disagree with the
   record — the same reason the calendar reads sources in place instead of projecting them.
4. **It costs almost nothing.** The feed read already joins `matter` to enforce visibility. Adding the
   matter number and the responsible member to that same join is free; hydrating the _subject_ is a
   per-kind batched read over at most a page of rows, and the design defers even that: the card
   renders from `kind` + `facts` + the matter join, and the subject is resolved when the member
   follows the deep link, through the owning subsystem's own access-checked read.

**What the reader sees, then.** "A deadline you are responsible for is due today — matter 8181-3",
assembled at read time from the kind, the joined matter number, and nothing stored. Not "Response to
motion for summary judgment in Ellison v. Braddock due today", which is the sentence that must never
exist in a row.

### 2.5 `notification_delivery` — the outbound-channel row

| Column                      | Shape                                        | Notes                                                  |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `id`                        | `notificationDelivery_` handle               |                                                        |
| `notification_recipient_id` | FK to the recipient row                      |                                                        |
| `channel`                   | text, closed set — `email` today             | `push` and `sms` widen it later; see the rebuild note. |
| `state`                     | `pending` / `sent` / `failed` / `suppressed` |                                                        |
| `attempts`                  | integer, default 0                           |                                                        |
| `suppressed_reason`         | nullable, closed set                         | `preference`, `not-visible`, `no-address`, `policy`.   |
| `digest_id`                 | nullable `notificationDigest_` handle        | Which digest carried it. Null for an immediate send.   |
| `dispatched_at`             | nullable canonical instant                   |                                                        |

Unique on `(notification_recipient_id, channel)`. `suppressed` is a real state and not an absent row,
because "we decided not to email you about this" is a fact a support conversation needs and an absent
row cannot express — but the reason is a closed label, never a sentence, and `not-visible` is
recorded without recording what was not visible.

**The `channel` set is a SQLite CHECK, and widening it rebuilds the table.** That is exactly the
custody-movement lesson. The recommendation is therefore to seed the CHECK with the full v1-plus-seams
set — `in_app`, `email`, `push`, `sms`, `desktop` — from the first migration, even though only `email`
is written. A value nothing writes costs a byte in a constraint; a rebuild costs a migration that
copies every row of a growing table.

### 2.6 Retention

**Recommended default: ninety days from `occurred_at`, read or unread, swept nightly.**

A notification is a pointer, never a record. The source row, the audit log, and the outbox row are the
record, and each has its own retention posture set by its own subsystem. Deleting a notification
destroys no evidence — it removes a stale pointer to evidence that is still there. That is what makes
a fixed default defensible here where it would not be in the custody register, whose CLAUDE.md refuses
retention defaults outright: the custodian rule is about _client property_, and this is about a badge.

Ninety days rather than thirty because a member returning from a leave should still see what they
missed, and rather than a year because an unbounded feed is an unbounded read. Unread rows are swept
on the same clock as read ones: an unread ninety-day-old notification is not an outstanding task, it
is proof that the thing it points at is being tracked somewhere else. The sweep is a bounded
`DELETE … LIMIT` per firm on the existing cron pass, cascading recipient and delivery rows, and it
never touches a source record.

---

## 3. Channels

### 3.1 In-app — a read API, and only a read API

Five operations, every one of them through the chokepoint with route metadata, and every one of them
scoped to `recipient_user_id = <the session's user>` — never a path parameter, the bulk-download
precedent.

- `GET /api/v1/notifications` — keyset page, newest first, using the platform's own
  `encodeCursor`/`decodeCursor` (`@magna-carta/data-access/cursor-pagination`). Optional `category`
  and `state` filters. **Refuses** an unknown category rather than ignoring it — a silently dropped
  filter returns more than the caller asked for, which on a read spanning every matter is the wrong
  direction to fail in.
- `GET /api/v1/notifications/unread-count` — the cheap poll ADR-0054 named. One count, same predicate.
- `POST /api/v1/notifications/{notificationRecipientId}/read` and `/dismiss` — idempotent; the second
  call changes nothing and returns the same body.
- `POST /api/v1/notifications/read-all` — bounded by a cursor the caller passes back from a page it
  actually read, so "mark all read" cannot silently clear items that arrived after the page was
  rendered, and cannot become an unbounded `UPDATE`.

One capability, `notifications:read`, seeded to every default role — a member reading their own feed
is not a privilege, and gating it would produce a firm whose staff cannot see their own deadlines.
Preference writes are covered by the settings capability that already exists for a My Account
category; no new capability for them.

Freshness stays exactly where ADR-0054 left it: refetch on focus, cross-tab invalidation, and the
unread-count poll. No push layer. The UI is out of scope; this design ships the API the parked UI will
later consume, which is why the shipped stubs stay honest stubs until then.

### 3.2 Email — through the platform's own send port

Email rides `SendEmail` (`apps/worker/src/email-port.ts`) and its Cloudflare Email Service adapter,
with a `messageClass` of `notification-digest`. That port already logs `email.sent` with the message
class and outcome and **has no slot for the body**, which is the redaction property this design wants
and did not have to build. Two adjustments the plan carries: the port is `text`-only today, and a
digest is a text email (a decision, not a limitation — see below); and the port's known
correlation-id seam applies unchanged.

### 3.3 The email content boundary — the recommendation

**Recommended default: a digest email states the shape of the queue and nothing about its contents.**

- **Subject:** fixed and matter-free. `Magna Carta — 6 items need your attention`. The count varies;
  nothing else does.
- **Body:** per-category counts and one deep link into the in-app feed. `Deadlines 3 · Trust 1 ·
  Documents 2 — open your notifications: <link>`.
- **Not in the body:** matter titles, matter numbers, client or party names, document or file names,
  email subject lines, deadline descriptions or dates, custody numbers or item descriptions, dollar
  amounts, invoice numbers, and the identity of anyone involved.

**Why the content stops there.** The in-app feed and the email are not the same problem wearing two
hats. In-app, every read is behind the session, the chokepoint, RBAC, and — at delivery time — the
visible-matter predicate; a row rendered to the wrong person is a bug with a fix. Email is a copy the
platform hands to an infrastructure it does not control and cannot recall:

- It lands in a mailbox the firm may not administer, is retained by a provider the firm did not
  choose, is indexed by a desktop client, is backed up, and is often forwarded.
- It renders on a lock screen, in a notification bar, and on a shared machine, to whoever is looking.
- **It cannot be re-filtered.** Section 6's whole argument is that the wall binds at delivery time so
  that a member removed from a matter stops receiving its notifications. That works for every channel
  the platform can re-read. An email sent yesterday to somebody walled off the matter today is simply
  out there. The only content that is safe against a future access change is content that does not
  depend on access in the first place — which is exactly what a category count is.
- A matter **title** is client-identifying by construction: firms name matters after the parties and
  the dispute. A matter **number** is client-identifying to anyone holding a prior email, an invoice,
  or the firm's own file index — which, for the population that ends up reading a forwarded work
  email, is most of them.
- A count discloses nothing about a client. It discloses the recipient's own workload, to the
  recipient.

**The one carve-out: kinds about the recipient rather than about a client.** Account and security
notifications — a new sign-in, a password reset, an invite, a support-access grant — have no matter
anchor and are _about the person reading them_. They already send full content through this same port
today and should continue to. The rule is therefore scoped precisely: **a matter-anchored kind
contributes only a category count to an email.** Section 12 flag E1 records the alternative.

**Why text and not HTML.** A counts-only digest has nothing HTML buys. Text renders identically
everywhere, cannot leak through a tracking pixel or a remote image fetch, and keeps the port's
signature unchanged. If a later slice wants HTML, that is a port change with its own decision.

### 3.4 Push, SMS, desktop — seams, with the reason each is not built

- **Web push** — VAPID subscriptions on the app-shell service worker. Deferred in ADR-0059 and unmoved
  here: the `channel` CHECK carries the value, and nothing else about this design changes when it
  lands, because read state already lives on the recipient row rather than on a channel.
- **SMS/MMS** — blocked on a dependency, not on a preference: ADR-0047's messaging port does not exist,
  and external routing must additionally honour STOP/HELP and TCPA consent state, which is the port's
  job and not this subsystem's. The `channel` value is seeded; nothing else.
- **Desktop-native/tray** — rides the Tauri shell, presenting the same rows. Parity is preserved by
  construction because the presenter reads the same API (ADR-0023).

---

## 4. Preferences and the firm policy floor

### 4.1 Where preferences live — the shipped scope chain

`scoped_setting` already resolves a key against `user → firm → default`, validates the value through a
zod schema, and treats a missing row as the in-code default. That is precisely the ADR-0040 chain
ADR-0059 asked for, already built, already tested. Reuse it; do not build a preferences table.

**One key, `notifications.preferences`, holding the whole matrix** — not one key per category.
`resolveScopedSetting` reads one key per call, so ten category keys would be ten round trips on a path
that runs once per recipient per fan-out. One key is one query. The write path is a `PATCH` of a
single category that re-resolves the current value and composes the upsert inside the same effect
batch, so a concurrent edit in a second tab is a last-write-wins on one member's own preferences —
which is the correct severity for this fact.

### 4.2 The matrix

Per **category**, not per kind. The registry will carry thirty-plus kinds and a member asked to
toggle thirty switches will toggle none; categories (`deadlines`, `calendar`, `trust`, `billing`,
`documents`, `custody`, `email`, `conflicts`, `jobs`, `security`, `system`) are the grain people
actually think in. The registry type model still carries a per-kind override slot so the finer grain
is available later without a schema change, and slice 1 does not expose it.

Per category, a member sets:

- `inApp`: `on` | `off` — with `off` meaning _no feed row is written for me_, not _the row is hidden_.
  A suppressed notification should not be a row somebody later discovers.
- `email`: `off` | `daily` | `weekly`.

**Recommended defaults:** every category `inApp: on`; every category `email: daily` except `jobs` and
`system`, which default to `email: off` (a conversion finishing is a thing you are watching, not a
thing you need mailed).

### 4.3 Cadence — why there is no immediate email

**Recommended: email is digest-only. No per-event email in slice 1.**

An email per event is a mail-bomb on any active matter; it inverts the content argument (a stream of
one-line emails discloses the _timing and volume_ of activity per matter even when each line says
nothing); and every use case offered for it — "I need to know now" — is better served by the in-app
feed today and by push later, both of which stay inside the platform.

The exception the registry should carry from day one is a declared `escalation: "immediate"` on a
closed, small set of kinds where a day's delay is a compliance failure rather than an inconvenience —
trust-account events of the below-threshold and overdraft kind, and security events. Declaring it in
slice 1 and honouring it in the email slice costs one field; retrofitting an escalation path into a
digest-only pipeline costs a redesign. An immediate email obeys the same content rule: matter-anchored
kinds still say only _what category and how many_.

### 4.4 The firm policy floor — what a firm may mandate

**Recommendation, in three parts.**

1. **A registry-declared `mandatory` flag makes a category non-silenceable, and only two categories
   carry it: `security` and `trust`.** This is ADR-0059's position and it is right: they mirror the
   non-optional stance of the audit log. Mandatory binds the **in-app** channel only — the row is
   always written and always in the feed. A member may still set that category's email to `off`.
2. **A firm may raise the floor on in-app, and may never force a channel that leaves the platform.**
   The firm tier of the scope chain is the floor: a firm may set a category to `inApp: on` and a
   member cannot override it downward. A firm may **not** force `email: daily` upward on a member who
   set `off`. Forcing email is forcing privileged-adjacent metadata into a mailbox that may be a
   personal address, may be outside the firm's administration, and is beyond both the audit log and
   the wall. A firm that needs assurance a partner sees trust events has a better instrument: the
   mandatory in-app row plus the trust reconciliation reports, which are a firm-scoped read with their
   own permission.
3. **Trust events to the managing partner: yes, by designation, and the wall still wins.** A firm may
   designate one or more members as **trust-compliance recipients** (a firm-tier setting, written by a
   member holding the trust-management capability, and audited). A designated member is added to the
   recipient set of every `trust`-category notification, for every matter, _in addition to_ whoever the
   kind's audience rule already resolves.

   **The designation is not a grant of access.** If a designated member cannot see the matter, the
   notification is suppressed for them with `suppressed_reason = 'not-visible'` and **no placeholder
   appears in their feed** — a "1 item you cannot see" row is an existence oracle, which is the exact
   failure ADR-0052's 404-not-403 logic exists to prevent. Today, with ethical walls a deferred seam
   (ADR-0068), the practical effect is nil: the only invisible matters are the platform's own holding
   matters, which carry no trust activity. The rule matters the day walls ship, and stating it now is
   free. Section 12 flag P1 records the tension.

### 4.5 Auditing

Preference changes and the dispatch of `audited`-declared categories write `audit_log` rows carrying
**metadata only** — the category, the resolved cadence, the actor, and the notification kind. Never a
subject id, never a matter id, never a recipient list. The custody register's rule applies verbatim
here: nothing identifying is an audit-metadata field or a telemetry dimension.

---

## 5. Delivery mechanics

### 5.1 The two production paths

```
                    ┌─ (A) event-driven ───────────────────────────────────────────┐
  domain write ──▶ outbox row (SAME batch)  ──▶ relay sweep (*/5) ──▶ per-firm queue
                    └──────────────────────────────────────────────────┬───────────┘
                                                                       │
   registry: does a type subscribe to this topic? ─── no ──▶ ack, ignore│
                                                                       │ yes
                                                    materialize event + recipients
                                                                       │
                    ┌─ (B) comparison-driven ──────────────────────────┤
  cron pass ──▶ per firm: calendar horizon/due/overdue,                │
                custody reminders ──▶ materialize (date-bucketed) ─────┘
                                                                       │
                                                     in-app feed ◀──────┴──────▶ digest run
                                                     (filtered at read)          (filtered, keyset)
```

### 5.2 Path A — subscription, not a second write

The per-firm dispatcher (`recoverable-charge-consumer.ts`) currently maps one topic to at most one
owning handler and acks-and-ignores the rest, because the bus is open by design. Notifications wants
_many_ topics and owns none of them, so it becomes a **second, non-exclusive pass**: after the owning
handler runs (if there is one), the message is offered to the notification translator, which consults
the registry for a type subscribing to that topic and, on a hit, materializes. Two properties this
preserves:

- **An unknown topic stays acked and ignored.** The translator not finding a type is the normal case
  for most of the thirty topics, and it must never throw — throwing would dead-letter or retry-storm a
  message nobody handles.
- **A topic can have both a business consumer and a notification.** `shipment.purchased` posts costs
  _and_ may notify; the two are independent and neither can suppress the other.

A translator failure must not fail the owning handler's ack, and vice versa. Recommendation: the
owning handler's failure propagates (it always did); the translator's failure is caught, counted, and
logged through the one pipeline. A missed notification is an annoyance; a re-driven cost posting is a
double charge. Where the two are not equal, the weaker one yields.

### 5.3 Idempotency

Queues are at-least-once and sweeps overlap. Both paths converge on one floor: `dedupe_key` UNIQUE on
`notification_event`, using the codebase's existing UNIQUE-insert idiom — the insert is attempted, the
constraint refuses the duplicate, and the batch continues.

- **Path A:** `dedupe_key = "<topic>:<outboxRowId>"`. The outbox row id is stable across every
  redelivery of that message, so a redelivery is a no-op by construction.
- **Path B:** `dedupe_key = "<kind>:<subjectId>:<civilDate>"`. The civil date is the sweep's own bucket,
  so an overdue deadline raises **once per day** rather than once per sweep. That is the whole reason a
  comparison needs a bucket: `deadline.overdue` is true continuously, and without the bucket a firm
  gets a notification every five minutes forever.

`notification_recipient` is unique on `(event, recipient)`, so a partially-failed fan-out that retries
tops up the missing recipients without duplicating the ones already written.

### 5.4 Digest composition — bounded and keyset

A digest run for one recipient and one cadence:

1. Read the recipient's `notification_digest_run` watermark — `(last_occurred_at, last_event_id)`, a
   keyset cursor, not a timestamp alone (two events sharing an instant must not straddle a boundary).
2. Read that member's `notification_recipient` rows **after** the watermark, joined to the event,
   composing the visible-matter predicate **in SQL before the `LIMIT`** (section 6), capped at a page
   the digest can actually summarize.
3. Aggregate to per-category counts. A cap overrun contributes to the counts as "at least N"; there is
   no per-item list to truncate, which is a pleasant side effect of the content rule.
4. **Send first, then mark.** The email goes out, then one batch writes the `notification_delivery`
   rows as `sent` and advances the watermark. This is the ordering `sweepOutbox` argues for and the
   reasoning transfers exactly: a crash between the two re-sends a digest next run (at-least-once — a
   duplicate digest is a minor annoyance), where marking first risks losing it entirely (at-most-once
   — a missed deadline). Where those two are the outcomes, there is no debate.
5. A member with zero visible items in the window gets **no email**. A "you have nothing" email trains
   people to ignore the channel.

The runs themselves ride the existing cron pass over `listReachableActiveFirms`, with one firm's
failure quarantined and logged exactly as the outbox sweep and the reconciliation backstop already
quarantine theirs — one sick firm database must never abort a fleet-wide pass. Daily and weekly runs
are anchored to a firm-tier local hour so a digest lands in the morning rather than at UTC midnight,
computed in the firm's zone the way deadline instants are computed in the court's (ADR-0055).

### 5.5 Recipient resolution

Runs in the consumer, off the hot path, never in the emitting write. The registry type declares an
**audience rule** from a closed set:

- `responsible-member` — `matter.responsible_member_id`, one read;
- `actor` — the member who performed the act (for confirmations);
- `capability-holders` — members whose effective permissions include a declared capability, a bounded
  read against the shipped RBAC tables (this is how `trust` reaches whoever can act on trust);
- `designated` — the firm-tier designation of section 4.4;
- `matter-team` — **declared and unresolvable today**: there is no per-matter team table. It resolves
  to `responsible-member` until one exists, and the registry marks the substitution so the day a team
  model lands, the change is one resolver rather than a hunt through types.

**The actor is excluded by default.** Nobody needs telling they did the thing they just did. A type
may declare `includeActor: true` where a confirmation is genuinely the point.

Fan-out is capped per event (recommended 200 recipients) with a counter when clamped — a fan-out
larger than a firm's staff means a resolver bug, and the cap turns it into a metric instead of a mail
storm.

### 5.6 Telemetry

Allowlist events and counters only, per `docs/conventions/error-logging.md`: an event may declare
`kind` and `category` (both closed enum labels), a recipient **count**, and an outcome. Never a
subject id, never a matter id, never a recipient id, and never a dimension whose cardinality tracks
firm data. A dead-lettered digest surfaces exactly as a dead-lettered outbox row does — ids, class,
attempts, no payload.

---

## 6. The wall — enforced at delivery, not at emission

**The rule: a notification is filtered by matter visibility every time it is read or digested, and
never by deleting or rewriting rows when access changes.**

Emission-time enforcement is wrong for a reason that is easy to state and easy to get wrong in code:
access changes after emission. A member removed from a matter on Tuesday must stop seeing Monday's
notifications about it on Tuesday, and a member _added_ to a matter should see what is still live.
Enforcing at emission produces neither; it produces a set frozen at the moment of the event, plus a
revocation sweep that has to be perfect forever.

**One predicate, composed in SQL, before the `LIMIT`.** The feed read, the unread count, and the
digest read all join `notification_event.matter_id` and compose `visibleMatterPredicate()` from
`packages/calendar/src/visibility.ts` — the same seam every timeline source composes, whose header
already explains why it is a required argument and not an optional one, and why it is composed in the
query rather than applied in the Worker after rows come back. A post-filter under-fills the page,
makes the cursor mean something different from page to page, and turns the page size into an existence
oracle for the rows it removed.

Three consequences worth stating explicitly:

1. **The unread count uses the same query.** A count that includes filtered rows is a badge that tells
   a member how many things they are not allowed to see.
2. **The digest read is the dangerous one, and it uses the same shared function as the feed read.**
   The digest runs server-side with no request context, on the member's behalf; it is exactly where a
   "we already know who this is for" shortcut gets written. Push and poll resolve a job through one
   function per subsystem for the same reason (`docs/conventions/api.md`), and the same rule applies:
   feed and digest resolve a member's visible notifications through **one** function, so "the digest
   respects the wall" describes one implementation rather than two that can drift.
3. **A filtered row is invisible, not redacted-in-place.** No placeholder, no "1 hidden", no gap in a
   count. ADR-0052's 404-not-403 logic, applied to a list.

**A member's own row is scoped by session, not by path.** `recipient_user_id = <session user>` on
every read, the bulk-download precedent — a member can never read another member's feed by guessing an
identifier.

A fitness function asserts the composition the way the calendar's source fitness test does: every
notification read statement contains the predicate's marker, proved from one table-driven pass rather
than by review.

---

## 7. The registry — extending the declared shape, not replacing it

ADR-0059 defined the type: `key`, `category`, audience, `severity`, `mandatory`, eligible `channels`
with default routing, channel-aware templates, `cadence`, `audited`. This design adds the fields
delivery needs and changes none of them:

| Field            | Added by this design | Meaning                                                                                  |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `subscribesTo`   | yes                  | The outbox topic(s) and/or collection point(s) that raise it — **by imported constant**. |
| `subjectKind`    | yes                  | The identifier kind of the record it points at.                                          |
| `matterAnchored` | yes                  | Whether `matter_id` must be populated. Drives the wall fitness function.                 |
| `facts`          | yes                  | The declared non-privileged slot's schema, validated against the 2.4 grammar.            |
| `escalation`     | yes                  | `digest` (default) or `immediate`.                                                       |
| `deepLink`       | yes                  | A canonical route builder for the subject.                                               |
| `emailContent`   | yes                  | `category-count` (matter-anchored kinds) or `recipient-scoped` (account/security).       |

**Fitness functions** (the ADR-0051 discipline, and the reason the registry is a registry):

1. Every `subscribesTo` value resolves to a member of the producing package's own exported constant
   set — so `CALENDAR_NOTIFICATION_EMISSION_POINTS` and the topic constants are the single source of
   truth for spelling.
2. Every `matterAnchored` type's materializer supplies a non-null `matter_id`.
3. Every declared `facts` schema uses only the closed value grammar.
4. Every `mandatory` category declares no opt-out.
5. Every matter-anchored type declares `emailContent: 'category-count'`.
6. Every registered channel has a renderer.
7. Every notification read statement composes the visible-matter marker.

---

## 8. What changes in the packages that already emit

Small, and mostly nothing.

- **Calendar** — three write paths gain outbox topics (`calendar.event.scheduled`, `.rescheduled`,
  `.cancelled`), named from the existing frozen constant so the spellings cannot diverge. The three
  deadline points stay comparisons and are read by the sweep. `notifications.ts` keeps its role as the
  declaration; nothing in the package learns about delivery, and its "no cron, no queue, no recipient
  resolution here" property is preserved.
- **Custodian** — nothing at all. The sweep calls `collectCustodyReminders` exactly as the register's
  reports do, which is what ADR-0221 promised.
- **Email filing** — `raiseEmailFiledNotification` keeps its signature and stays a no-op in the
  package; the notification is materialized from a new `email.filed` outbox topic written in the same
  batch that promotes a link to `filed`, so the guarantee is transactional rather than best-effort.
  The seam function remains as the documented call site.
- **Job coordinators** — a terminal state additionally writes a notification for the `jobs` category,
  which defaults to `email: off`. The socket push is unchanged; the row exists for the closed tab.
- **Every other producer** — untouched. That is the point of subscribing.

---

## 9. Load profile and bounds

- Feed read: one statement, one join, keyset-paginated, capped page. Bounded by page size, not by firm
  data.
- Unread count: one statement, same predicate, index-covered by
  `(recipient_user_id, state, created_at, id)`.
- Fan-out: one recipient-resolution read per event plus one insert batch, capped at 200 recipients.
- Digest: one watermark read, one capped page read, one send, one batch write — per recipient per run.
  A firm of 50 members on a daily cadence is 50 of those, once a day, on the existing cron pass.
- Retention sweep: one bounded `DELETE … LIMIT` per firm per night.
- Everything measured against the load-profile fixtures as built (ADR-0083), asserting the _bound_
  (statement count and rows read) rather than a wall-clock number.

---

## 10. Test plan

- **Redaction, structurally.** The `facts` grammar validator rejects a string-valued declaration; a
  table-driven pass over every registered type proves it. A separate scan asserts no notification
  table column and no email body assembly reads a title, name, or subject column.
- **The wall.** Every read statement carries the predicate marker (table-driven, every read). A member
  whose visible-matter set shrinks stops seeing the row on the next read, with no row mutated. The
  unread count matches the filtered page count. No placeholder row is emitted for a filtered item.
- **Idempotency.** A redelivered queue message produces exactly one event and one recipient row. Two
  sweeps in one civil day produce one `deadline.overdue` event. A digest re-run after a simulated
  crash between send and mark re-sends and does not double-advance the watermark.
- **Preferences.** A category `off` writes no feed row. A `mandatory` category ignores an `off`. A firm
  floor raises but cannot force email on. A designated trust recipient with no visibility gets a
  `suppressed` delivery row and no feed row.
- **Subscription.** An unknown topic is acked and ignored. A translator throw does not fail the owning
  handler's ack. Every `subscribesTo` resolves to a producing package's exported constant.
- **Email content.** A golden test asserts a rendered digest against a fixture whose matters have
  deliberately identifying titles and numbers, and fails if any of them appears in the output.

---

## 11. Seams, stated plainly

| Seam                      | Why not now                                                          | What it costs later                                         |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Notification centre UI    | Out of scope; the API is the deliverable                             | A Svelte surface over a shipped read API                    |
| Preference UI             | Same                                                                 | A My Account category over a shipped setting key            |
| Web push                  | Deferred infrastructure (ADR-0054); no sub-second need               | A `channel` value already in the CHECK; read state unmoved  |
| SMS/MMS                   | The messaging port and its STOP/TCPA gate do not exist (ADR-0047)    | Same                                                        |
| Desktop-native            | Rides the Tauri shell                                                | A presenter over the same API (parity by construction)      |
| Per-user push channel     | ADR-0059's documented seam                                           | Extends the DO-per-job primitive behind the same call sites |
| External calendar feeds   | A different subsystem — a subscription surface, not a notification   | Out of this design entirely                                 |
| Outbound webhooks         | Same, plus a per-firm secret and a delivery-retry posture of its own | Out of this design entirely                                 |
| Per-kind preference grain | Category grain is what people use; the slot exists in the type model | A resolver change, no schema change                         |
| `matter-team` audience    | No per-matter team table exists                                      | One resolver, marked in the registry today                  |

---

## 12. Owner flags

Short, and E1 is the one that matters.

**E1 — the email content boundary (the taste call).** Recommended: a digest email carries a fixed
subject, per-category counts, and one deep link — no matter numbers, no titles, no dates, no amounts;
account and security kinds, which are about the recipient rather than a client, keep full content. The
alternative some firms will ask for is **per-item lines carrying the matter number but never the
title**, which is materially more useful and defensible on the grounds that a number is meaningless
without the firm's own systems. The counter-argument this design leans on is that an email cannot be
re-filtered when access changes and is retained where the firm's controls do not reach. If the answer
is "allow it", the shape is a firm-tier ceiling `emailDetailLevel: counts-only | matter-number | off`,
default `counts-only`, where a member may only choose a _more_ private value than the firm's ceiling
and never a less private one. **Recommendation: ship `counts-only` and `off`; leave `matter-number`
declared and unbuilt pending this answer.**

**P1 — trust events and the wall.** Recommended: a firm-designated trust-compliance recipient receives
`trust`-category notifications for every matter, but a designation is not a grant of access — where
the member cannot see the matter, the notification is suppressed with no placeholder. A firm may argue
that a managing partner not learning of a trust event on a screened matter is itself a compliance
failure. The design's position is that the fix is granting the access, not leaking around it. Confirm.

**P2 — the firm may not force email on.** Recommended: a firm floor may mandate in-app for a category
and may never force a member's email cadence upward. Confirm, since it is the one place a firm's
administrative reach is deliberately limited.

**R1 — ninety-day retention, read or unread.** Recommended default; a firm-tier override within
`[30, 365]` is a later slice. Confirm the number.

**C1 — digest-only email, with a declared `immediate` escalation honoured only for trust and
security.** Confirm that no other category may escalate in v1.
