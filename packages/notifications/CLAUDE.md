# @magna-carta/notifications — CLAUDE.md

**Purpose.** The delivery half of Notifications: the type **registry** that owns every decision about
who hears what, the closed **fact grammar** that makes the redaction rule structural, the pure
materializers that turn a decided notification into rows, the **one shared read** every surface
resolves a member's visible notifications through, and the retention machinery. Validates in memory
and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no binding,
reads no clock, and calls no external service.

**White paper:** _Notifications_, with _Communications layer_, _Settings & configuration_, _Tenancy
and data isolation_, and _Observability and diagnostics_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0059, ADR-0064,
ADR-0221, ADR-0052, ADR-0054, ADR-0040.)
**Spec:**
[`docs/specs/2026-08-06-notifications-delivery-design.md`](../../docs/specs/2026-08-06-notifications-delivery-design.md).

## The one sentence that explains the shape

**The emission half was already built.** Thirty-one places in the platform already write a durable
outbox row **in the same atomic batch as the change it describes**, and the relay already publishes
them onto a per-firm queue with a topic dispatcher. So this package does not own a topic and does not
ask any producing package to change: it **subscribes**, as a second non-exclusive pass in that
dispatcher. Everything expensive here is a policy question, not a plumbing one.

## The three production paths, and why a type declares which one raises it

Every type declares `raisedBy`, and the registry keeps **one index per path**. Inferring the path
from the emission point's name would be guessing, and it is already wrong: the calendar's declared
emission points and the platform's outbox topics are drawn from one vocabulary, and three of those
names are now both.

- **`outbox-topic`** — a subscription. Something committed a write, committed an outbox row in the
  same batch, and the relay carried it. `src/translate.ts` materializes it.
- **`comparison-sweep`** — not a write at all. "This deadline is overdue" and "this review has come
  round" are subtractions against the clock that nobody performs and that the owning packages
  deliberately refuse to store. `src/sweep.ts` calls the owning package's own shipped comparison and
  materializes what it returns.
- **`job-coordinator`** — a terminal state a Durable Object reached, with no firm-database batch to
  ride. `src/job-completion.ts` writes it, best-effort, after the transition is persisted.

All three build a payload, resolve recipients through the same resolvers, and go through the same
pure materializer and the same UNIQUE-insert statements. **A path never gets its own materializer** —
that is the fastest route to two subtly different notions of what a notification row is.

## Key files / entry points

- `src/types.ts` — the closed vocabularies (category, severity, subject kind, channel, audience,
  escalation, email detail level) and the caps: page size, fan-out, retention bounds
- `src/facts-grammar.ts` — **the redaction boundary**: the closed value grammar and its two
  validators, one for a type's declaration and one for a materializer's output
- `src/registry.ts` — the `NotificationType` shape and the frozen `NOTIFICATION_TYPES`; topic → types
- `src/materialize.ts` — pure `(type, payload, recipients) → rows`, plus the two dedupe-key shapes
- `src/recipients.ts` — the audience resolvers, each bounded by construction
- `src/statements.ts` — the inserts and the settling updates
- `src/read-statements.ts` — **the one shared read**; the feed page, the unread count, and the
  single-row resolve all compose their `WHERE` from `visibleNotificationScope`
- `src/settings.ts` — the firm retention window, and the email detail level as a member's choice
  under a firm's ceiling
- `src/preferences.ts` — **who hears what**: the per-category matrix, the two tiers composing in
  opposite directions, the sparse merge BOTH tiers patch through, the firm's trust-compliance
  designation, and the per-pass policy reader every fan-out constructs once
- `src/suppression-statements.ts` — the tally that makes a silenced notification a counted fact
  rather than an absence
- `src/emission-points.ts` — the emission points with no producing-package constant, and the written
  reason each has none
- `src/translate.ts` — the subscriber: one bus message in, zero or more notifications out
- `src/sweep.ts` — the comparison path: the calendar's own overdue arithmetic and the custody
  register's own collection point, bucketed by civil date and capped per kind
- `src/job-completion.ts` — the row for the tab that was closed when a job finished
- `src/retention.ts` — the bounded nightly sweep and the swept-unread tally
- `src/digest.ts` — the summary's read and its bookkeeping: the keyset watermark, the candidate
  walk, the cadence partition, and the delivery rows that settle both what was sent and what was not
- `src/digest-render.ts` — **the content boundary**: the only place anything here crosses out of the
  platform, and the reason its whole parameter list is a closed label, integers, a cadence and a
  configured origin

## Invariants that apply here

- **A notification row carries no string a person typed.** Identifiers, integers, booleans, declared
  enum labels, canonical instants, and civil dates — and nothing else. A declared `string` field is a
  validation failure, not a warning (`src/facts-grammar.ts`; `test/facts-grammar.test.ts`). Three
  reasons, in the order they bind: the row **outlives the access check** that justified it, and a row
  holding a title holds it after the reader stops being entitled to it; a stored title is a **stale**
  title, wrong invisibly because the row still looks authoritative; and resolving at read costs
  nothing, because the read already joins `matter` to enforce visibility.
- **The wall binds at DELIVERY time, through ONE predicate, composed in SQL before the `LIMIT`.**
  What a matter's notifications may show changes after emission, so it is resolved at read: rows are
  never deleted or rewritten when it changes, they are filtered, and they reappear if it changes
  back. **What the predicate actually decides today** is one thing — it excludes the platform's own
  internal holding matters. It takes **no member context**, so there is no per-member matter wall
  yet; the point of composing it here is that when an overlay exists it is one more clause in that
  one predicate and every read inherits it untouched. Do not describe this surface, in an OpenAPI
  `description` or anywhere else a caller reads, as though a member losing access to a matter
  already loses its notifications. Every read takes `visibleMatterPredicate` as a **required**
  argument, and
  `test/wall-fitness.test.ts` proves every exported read carries the marker from one table-driven
  pass. A post-filter is never acceptable: it under-fills the page, makes the cursor mean something
  different from page to page, and turns the page size into an existence oracle.
- **The feed and the count ask the same question.** A count that included rows the page filters out
  is a badge telling a member how many things they are not allowed to see. They share
  `visibleNotificationScope`, and a test compares the composed clause byte for byte.
- **Every read is scoped to the SESSION's user**, never to a path parameter — the bulk-download
  precedent. A row belonging to somebody else is **not found**, never forbidden: a distinguishable
  refusal tells the caller the row exists.
- **A filtered row is invisible, not redacted in place.** No placeholder, no "1 hidden", no gap in a
  count.
- **Idempotency is a UNIQUE constraint, not a check-then-insert.** Queues are at-least-once and
  sweeps overlap, so a duplicate is the ordinary case. The event-driven key is
  `<topic>:<outboxRowId>` (stable across redeliveries by construction); the comparison-driven key
  carries a **civil date**, because a condition that is continuously true would otherwise raise every
  time the sweep runs, forever; the job key carries the **terminal outcome**, because a job the
  stuck-alarm failed and that then reported success reported two terminal states and both happened —
  keying on the job alone would leave the timeout's row standing as the last word.
- **THE DEDUPE KEY IS BOUNDED BY THE RETENTION WINDOW, and reading it as "once, ever" is the one
  mistake this subsystem invites.** The UNIQUE index lives on `notification_event.dedupe_key` — a
  column on a row `retention.ts` DELETES on the firm's window — so it is a duplicate-suppression floor,
  never a permanent record that a subject was ever notified about. That is the intended contract and
  not a defect, because no production path can re-present a key the sweep took: each declares a
  **convergence horizon** in `CONVERGENCE_HORIZON_BY_RAISER` (`src/materialize.ts`), and every one is
  far shorter than the thirty-day retention floor. An outbox row is published once and flipped out of
  `pending`, so the relay never re-carries it; a comparison's bucket is derived from the pass's own
  instant and therefore only moves forward, which makes a swept bucket **unreachable** rather than
  merely unlikely; a job reports each terminal state once inside its own life. The table is
  `Record<NotificationRaisedBy, …>`, so a fourth production path is a **compile error** until it states
  a horizon — which is the review this exists to force. The rule that follows: **a condition that must
  raise once per subject FOREVER does not use this key for that.** It carries its convergence in the
  owning subsystem's own tables, with their own UNIQUE index and their own retention posture, and the
  notification points at that record — billing's `invoice_reminder` rows are the worked example, and
  they outlive the notification that announced them precisely because they are billing rows rather than
  pointers. It is the same rule as "a notification is a pointer and never a record", applied to
  idempotency. `test/retention-convergence.test.ts` states the semantics out loud by re-inserting a key
  the sweep took, and holds the comparison bucket to following the clock.
- **A comparison's civil-date bucket is computed in the SUBJECT's zone, not the firm's or UTC's.** A
  deadline's zone is the court's, and it is on the row. The custody register keeps no zone at all —
  it is one firm's own list of civil dates the firm typed — so its bucket is the platform's civil
  day, and the asymmetry is deliberate rather than an oversight.
- **A comparison is unbounded, so its read is capped and the clamp is COUNTED.** Two hundred findings
  per kind, per kind rather than per sweep so one runaway comparison cannot starve the others. A firm
  reporting `notifications.comparison_clamped` every night is a firm being told about some of its
  overdue work and not the rest, which is a fact an operator has to be able to see. **Every bound in
  the pass announces itself, including the one that is not a findings cap.** Zone discovery is capped
  too — the deadline comparison needs one cutoff per zone because no D1 query resolves a zone — and a
  truncated zone list is the one way this pass stops finding things without the findings clamp moving:
  a zone that read never returns contributes no cutoff, so every deadline in it matches neither the
  overdue bound nor the due-today window, and the pass reports nothing about a whole jurisdiction with
  every other counter reading healthy. **The calendar's own read reports that truncation** —
  `readOpenDeadlineTimeZones` over-reads by one and answers `{ timeZones, clamped }` — so this pass
  consumes the signal rather than deriving it at the call site, and the next caller inherits it instead
  of re-deriving it. The pass turns it into
  `notifications.comparison_zone_discovery_truncated`, kept apart from the findings clamp because a
  clamp bounds what was missed and this does not bound it at all. The value counts truncated **passes**,
  not zones: a read that over-reads by one to catch its own truncation learns that it truncated and can
  never learn by how much, and a magnitude invented there would be the same dishonesty one level down.
- **A matter-anchored type does not reach one person** unless it is on the short list in
  `test/registry-fitness.test.ts` saying why. Three kinds shipped reaching exactly one reader once,
  on the strength of a comment; the list is what makes narrowing a deliberate, written act.
- **A SUPPRESSED notification is counted, never merely absent.** A category a member set `inApp: off`
  writes no feed row — not a hidden one — which is right, and which produces the failure mode a
  preference system has: afterwards, "nobody was told" and "this person asked not to be told" look
  identical, so a member cannot be reassured and a real fan-out fault cannot be found. Every
  suppression therefore writes a `notification_in_app_suppression` row (member, category, civil day,
  whose choice, count — and no event, no subject, no matter, no kind) in the SAME batch as the rows it
  did write, and reports an `InAppSuppressionCount` its caller turns into
  `notifications.suppressed_by_preference`. Adding a fourth production path means adding both, and
  `test/preference-enforcement.test.ts` is where that is proved. An audience everybody in it silenced
  is counted APART from an audience that resolved to nobody: only the second is a resolver bug.
- **The two preference tiers compose in OPPOSITE directions, and the asymmetry is the design.** In
  app the firm's tier is a FLOOR — a firm may set a category on and a member may not lower it; a
  firm's `off` is only a default a member may raise. By email the MEMBER's tier wins — a firm may
  never raise somebody's cadence, because forcing email is forcing privileged-adjacent metadata into
  a mailbox the firm may not administer, beyond both the audit log and the wall. `security` and
  `trust` are non-silenceable in app whatever either tier stored, read from the CATEGORY through
  `categoryIsMandatory` so two kinds in one category cannot disagree. `resolveCategoryPreference` is
  the only place any of this is decided.
- **A designation adds a recipient; it never grants access.** A firm's trust-compliance list joins
  the recipient set of every trust-category notification and stops there: the designated member gets
  an ordinary recipient row, and the visible-matter predicate still decides at read what it may show
  them. Do not add a visibility check at fan-out to "save" the row — that is emission-time
  enforcement, which this subsystem refuses because access changes after emission, and it would also
  need a `notification_delivery` row against a recipient row that by definition does not exist.
- **AN EMAIL IS THE ONE CHANNEL THAT CANNOT BE RE-FILTERED, so it carries only what never depended
  on access.** Every other surface here is read inside the product, where a row shown to the wrong
  person is corrected by the next read; a summary is a copy in a mailbox the firm may not
  administer, retained, forwarded, and rendered on a lock screen. So it says how many items are
  waiting in which categories, and nothing else: **no matter title, matter number, client or party
  name, filename, email subject line, deadline description or date, custody number, amount, invoice
  number, or platform handle.** A matter title is client-identifying by construction and a matter
  number is client-identifying to anyone holding a prior invoice. The boundary is STRUCTURAL, not a
  rule to remember — the digest read selects a category, a kind, an instant and two handles, and
  `renderNotificationDigest` takes a closed category label, integers, a cadence and a configured
  origin, so there is no argument a title could arrive in. `test/digest-render.test.ts` renders over
  a fixture whose matter is named after its parties and numbered, and fails if any of it appears.
  Widening the digest `SELECT` fails a source scan in that same file.
- **`matter-number` renders as `counts-only`, and that is not a bug to fix in passing.** The level is
  declared so a firm's stored ceiling is not silently rewritten when it ships; until it does, a
  resolved level of `matter-number` gets the most private reading of what the firm chose.
- **SEND FIRST, MARK SECOND, and the watermark moves only where the run settled what it walked.** A
  crash between the two re-sends a summary — an annoyance — where marking first risks losing one, a
  missed deadline. The delivery rows and the watermark commit in one batch, after the send returns.
  A send that did not happen leaves the mark where it was and the next run re-reads the same window.
- **AN EMAIL THAT WAS NOT SENT IS SETTLED, never merely absent** — the email half of the suppression
  rule above, using the mechanism the schema already had. Every row a run withheld gets a
  `notification_delivery` row with `state = 'suppressed'`, a closed reason (`preference` where the
  category's cadence is `off` or the resolved detail level is `off`, `no-address` where there is no
  mailbox), and a null `digest_id`, because no summary carried it. Without it, a member who chose
  not to be written to and a member the platform silently failed to write to are the same observable.
- **A member with nothing visible in the window gets NO email**, and the run is still recorded — "we
  have never written to you" and "there was nothing to write about" are different facts.
- **A kind declaring `escalation: "immediate"` HALTS the walk; it is never folded into a summary.**
  No registered kind declares one and `test/digest.test.ts` holds that to being deliberate, so
  registering the first is a gate failure until its send path ships. Halting rather than skipping is
  what keeps the watermark honest: stepping over it would settle a row no channel carried.
- **Nothing on an emitting write path.** No producing package resolves a recipient, reads a
  preference, or renders anything. Fan-out and rendering run in the queue consumer or the cron pass.
- **A translator failure never fails an owning consumer's ack.** A missed notification is an
  annoyance; a re-driven cost posting is a double charge. Where the two are not equal, the weaker one
  yields.
- **A swept notification is never the only record of what it pointed at.** The source row, the
  timeline, and the audit log are the record and keep their own retention. That is what makes a
  retention window defensible here where the custody register refuses one outright. The sweep still
  **tallies** what it takes while unread, per member, and the unread count reports it beside the live
  count — because "there is nothing you missed" is a claim the platform is not in a position to make
  about somebody who was away.

## Adding a notification type

One entry in `NOTIFICATION_TYPES`, and nothing else anywhere:

1. **Declare `raisedBy`, and name the emission point by its producing package's exported constant.**
   Two spellings of one emission point is a silent failure — an unrecognized topic on the per-firm
   bus is acked and ignored by design, so a typo does not throw, it just stops delivering. Where no
   producing constant exists, add it to `src/emission-points.ts` with the reason there is none.
2. **Declare the audience** from the closed set, and mark any substitution in
   `audienceSubstitutedFrom`. No type declares one today — a substitution is a recipient list the
   platform narrowed silently, and a fitness test holds that to being a deliberate edit.
3. **Declare `matterAnchored` honestly**, and give an anchored type a `matterResolution` that can
   actually reach a matter. An anchored row without one is not unfiltered, it is _unfilterable_.
4. **Declare `facts` inside the grammar**, and write `buildFacts` to always supply every declared
   field — a missing one means the producer changed shape, and the refusal is how that gets noticed.
5. **Declare the deep link.** The subject is resolved _there_, through the owning subsystem's own
   access-checked read, which is why nothing about it is stored here.

`test/registry-fitness.test.ts` holds all of it. A rule you cannot see enforced there is a rule that
is not enforced.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/access-control` (the capability a `capability-holders` audience names),
  `@magna-carta/calendar` (the visible-matter predicate — the one seam every filtered read composes),
  and the producing packages whose topic constants the registry imports (`@magna-carta/billing`,
  `@magna-carta/file-manager`, `@magna-carta/ledger`, `@magna-carta/matters`,
  `@magna-carta/conflicts`, `@magna-carta/email-filing`, `@magna-carta/meetings`). Those are imported for their **names**,
  never for their behaviour — with two exceptions the comparison sweep needs and that are the whole
  point of it: `@magna-carta/calendar`'s overdue arithmetic and `@magna-carta/custodian`'s
  `collectCustodyReminders`, both called rather than restated.
- Consumed by the worker: the per-firm queue dispatcher (the second pass), the notifications route
  bundle, the daily cron's comparison and retention steps, and the document-assembly coordinator.

## Gotchas

- **`in_app` is a `channel` value nothing writes, on purpose.** The in-app feed is not delivered, it
  is read — the recipient row's existence _is_ the delivery, and there is no attempt, no transport
  failure, no retry, and no address. The value is in the CHECK because widening a SQLite CHECK later
  rebuilds a growing table; `push`, `sms`, and `desktop` are there for the same reason.
- **Read state lives on the recipient row, not on a channel.** Marking an item read in the feed must
  also settle it for a push notification nobody tapped, whenever push arrives.
- **A firm-scoped kind has a null matter anchor and is NOT behind the filter.** There is no matter
  whose visibility could decide it. That arm is written once, in `visibleNotificationScope`, so
  tightening the join cannot silently make firm-scoped kinds disappear. The **accepted cost**: such a
  row's capability is enforced when the fan-out resolves its audience and never again, so a member
  who held `trust:manage` when a trust posting landed keeps that row in their feed after the
  capability is withdrawn. The deep link behind it still re-checks, so following it reveals nothing —
  but the row and its category count persist. Re-resolving capability at read would put a per-row
  permission check on the hot path for the one class of row with no anchor to check against; the fix,
  when it is worth it, is a capability column on the event resolved by this same shared read.
- **`matter-number` is a declared and unbuilt email detail level.** It is in the vocabulary so a
  firm's stored ceiling is not silently rewritten when the level ships; the renderer treats it as
  `counts-only`.
- **THE EMAIL DETAIL LEVEL HAS A RESOLVER AND NO WRITER, IN EITHER TIER.** `resolveEmailDetailLevel`
  composes a firm ceiling with a member's choice and the digest pass calls it every run, but nothing
  in this package writes `notifications.emailDetailLevel` at either scope and no route reaches it — so
  every firm resolves the `counts-only` default forever. That is the same shape the firm's in-app
  floor was in until `apps/api-worker/src/http/routes/firm/firm-notification-policy.ts` shipped, and it is invisible
  to `pnpm run lint:unwired-writes` for the reason that gate states out loud: there is no write
  function to find a caller for. **Build both tiers together or neither.** A firm ceiling alone lets a
  firm raise what its members' mail carries with no member lever to lower it, which inverts the one
  asymmetry this subsystem is built on — by email the member's choice wins.
- **A setting that binds anybody but the actor does not go on the member route.** The two preference
  surfaces split on that line: `notifications:read` (every default role, including Read-only) for a
  member's own switches, `firm:manageNotificationPolicy` (Admin) for the floor, the retention
  window and the digest hour. Adding a firm-tier setting to the member route would hand every seat in
  every firm a lever over its colleagues.
- **Outbound mail is an UNPROVISIONED SEAM, and the digest resolves its own port rather than reusing
  the worker's shared `emailAdapterForEnv`.** That resolver falls back to the dev logging adapter
  when the Email Service binding is absent — right for a password reset, catastrophic here: a
  summary resolved through it returns successfully having mailed nobody, and the run then records
  `sent` rows and advances the watermark, so the member never hears about those notifications again.
  `apps/api-worker/src/notifications/digest-send-port.ts` answers `unavailable` with a closed reason
  instead, and the pass exits before reading a single firm.
- **The digest run is HOURLY, and most of what it does is decline to run.** A summary lands in the
  firm's own morning, so the pass wakes every hour and asks each firm whether its local hour has come
  round; the zone is read from the firm's default office rather than stored a second time. A firm
  that has set no default location is anchored on the platform's clock — stated, not substituted
  silently.
- **The two cadences are independent walks over the same rows.** `notification_digest_run` is unique
  per `(member, cadence)`, so a category on the weekly cadence is skipped by the daily run — neither
  carried nor withheld — and settled by the weekly one. A member who changes cadence mid-window can
  leave a row settled by neither; it stays in the feed, and no mail claims otherwise.
- **`named-members` reads a LIST from the payload, and a meeting invitation is the one thing that
  uses it.** The plural of `named-recipient` and resolved on its reasoning: the colleagues to invite
  are the ones who were on the calendar event when it was recorded, so re-reading the participant
  rows when the queue drains would invite whoever happens to be on it by then and miss whoever was
  taken off. It reaches only the MEMBERS on the event — a Directory entity has no way into a room
  yet, so there is nobody to name — and it is deliberately not `matter-team`: a hearing appearing on
  a case is the team's fact, and being asked into a room at nine on Tuesday is the fact of the people
  who were asked. The list is deduplicated in the resolver, because a participant list is edited by
  hand and one member listed twice must not become two feed rows for one invitation.
- **`matter-team` is the responsible member PLUS the currently-valid `matter_assignment` rows.** The
  responsible member is always an arm of that read and never conditional on holding an assignment:
  `matter.responsible_member_id` is that fact's one home and the assignment write path refuses a
  role that normalizes to it, so resolving the team from assignments alone would omit exactly the
  person most entitled to hear. An unstaffed matter therefore resolves to that one member rather
  than to nobody. The assignment arm additionally requires an **active** member, where the
  responsible arm does not — an assignment row outlives a member's departure by design, and this
  audience reaches email where a deactivated member's feed does not. The validity window is read
  exactly as `packages/document-assembly/src/merge-statements.ts` reads it (a creation bound is a
  civil date inclusive of its day; an end-assignment bound is the ending instant, exclusive), so an
  assignment that staffs a document also staffs its notifications.
- **`designated` is an audience no type declares, and the trust designation is not that audience.**
  The audience value resolves to the firm's designated list for a type that names it; the additive
  rule that actually ships works on the trust CATEGORY, in `resolveNotificationRecipients`, so it
  composes over whatever a kind's own audience already reached rather than replacing it. Either way an
  unconfigured designation resolves to nobody, never to the firm — defaulting it would be inventing a
  disclosure out of an absent setting.
- **The policy reader is constructed once per PASS, not per event.** A firm's overdue deadlines
  resolve to the same handful of people hundreds of times over, so `createNotificationPolicyReader`
  memoizes per member for the life of the pass. A fourth raiser that constructs one per finding
  doubles the pass's query count for an answer that cannot change inside it.
- **The read-all bound is a refusal, not a clamp.** A malformed cursor means "the first page"
  everywhere else, which is harmless for a read; here that reading would silently mean "everything".
