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
- `src/translate.ts` — the subscriber: one bus message in, zero or more notifications out
- `src/retention.ts` — the bounded nightly sweep and the swept-unread tally

## Invariants that apply here

- **A notification row carries no string a person typed.** Identifiers, integers, booleans, declared
  enum labels, canonical instants, and civil dates — and nothing else. A declared `string` field is a
  validation failure, not a warning (`src/facts-grammar.ts`; `test/facts-grammar.test.ts`). Three
  reasons, in the order they bind: the row **outlives the access check** that justified it, and a row
  holding a title holds it after the reader stops being entitled to it; a stored title is a **stale**
  title, wrong invisibly because the row still looks authoritative; and resolving at read costs
  nothing, because the read already joins `matter` to enforce visibility.
- **The wall binds at DELIVERY time, through ONE predicate, composed in SQL before the `LIMIT`.**
  Access changes after emission — a member removed from a matter on Tuesday must stop seeing Monday's
  notifications about it on Tuesday, and a member added should see what is still live. Rows are never
  deleted or rewritten when access changes; they are filtered, and become visible again if access
  returns. Every read takes `visibleMatterPredicate` as a **required** argument, and
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
  time the sweep runs, forever.
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

1. **Name the topic by its producing package's exported constant.** Two spellings of one emission
   point is a silent failure — an unrecognized topic on the per-firm bus is acked and ignored by
   design, so a typo does not throw, it just stops delivering.
2. **Declare the audience** from the closed set, and mark any substitution (`matter-team` resolves to
   `responsible-member` today because there is no per-matter team table).
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
  `@magna-carta/file-manager`, `@magna-carta/ledger`, `@magna-carta/matters`). Those last four are
  imported for their **names**, never for their behaviour.
- Consumed by the worker: the per-firm queue dispatcher (the second pass), the notifications route
  bundle, and the daily cron's retention step.

## Gotchas

- **`in_app` is a `channel` value nothing writes, on purpose.** The in-app feed is not delivered, it
  is read — the recipient row's existence _is_ the delivery, and there is no attempt, no transport
  failure, no retry, and no address. The value is in the CHECK because widening a SQLite CHECK later
  rebuilds a growing table; `push`, `sms`, and `desktop` are there for the same reason.
- **Read state lives on the recipient row, not on a channel.** Marking an item read in the feed must
  also settle it for a push notification nobody tapped, whenever push arrives.
- **A firm-scoped kind has a null matter anchor and is NOT behind the wall.** There is no matter whose
  visibility could decide it. That arm is written once, in `visibleNotificationScope`, so tightening
  the join cannot silently make firm-scoped kinds disappear.
- **`matter-number` is a declared and unbuilt email detail level.** It is in the vocabulary so a
  firm's stored ceiling is not silently rewritten when the level ships; nothing renders it today.
- **`designated` resolves to nobody** until the firm-tier trust-compliance designation is built. An
  audience nobody has configured resolves to nobody, never to the firm — defaulting it would be
  inventing a disclosure out of an absent setting.
- **The read-all bound is a refusal, not a clamp.** A malformed cursor means "the first page"
  everywhere else, which is harmless for a read; here that reading would silently mean "everything".
