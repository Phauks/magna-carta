# Notifications — the delivery half — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Deliver a raised notification to a person. Four slices: the record plus the registry plus a
subscriber on the shipped per-firm bus plus the in-app read API (slice 1); the comparison-driven
production path and the emission points that are missing a transactional write (slice 2); per-member
preferences and the firm policy floor on the shipped settings chain (slice 3); the email digest
channel (slice 4). No user interface in any of them.

**Architecture:** One new package, `@magna-carta/notifications`, holding the type registry, the pure
materializers, and the statement builders — the shape every domain package here already takes:
validate in memory, compose statements into `@magna-carta/data-access`'s `composeEffectBatch`, hold no
binding, read no clock, call no external service. Four per-firm tables. **No new transactional write
on any existing emission path** for the thirty-one topics that already ride the transactional outbox
— the subsystem subscribes to the per-firm queue instead, as a second non-exclusive pass in the
existing dispatcher. Design spec:
[`docs/specs/2026-08-06-notifications-delivery-design.md`](2026-08-06-notifications-delivery-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Drizzle (schema types; hand-written raw SQL where drizzle-kit
would emit a table rebuild), Cloudflare D1 (per-firm), Cloudflare Queues (the per-firm bus), Cloudflare
Cron (the existing scheduled pass), Hono + `@hono/zod-openapi`, Vitest (+
`@cloudflare/vitest-pool-workers` for the worker suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): `notificationEvent_`, `notificationRecipient_`,
  `notificationDelivery_`, `notificationDigest_`; `resolveNotificationRecipients`, never
  `resolveRecipients` shortened further; "the firm-scoped data-access layer", never an abbreviation;
  `newIdentifier`, never `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice N" except a forward-looking schedule note. Enforced by
  `pnpm run lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3). The registry and the
  materializers hold no database handle and no `env`.
- **Redact by default is structural, not a review note.** A notification row's `facts` slot accepts
  only the closed value grammar (identifier, integer, boolean, declared enum label, instant, civil
  date). No column anywhere in this subsystem stores a title, a name, a filename, a subject line, or a
  free-text note, and no email body assembly reads one. A validator enforces the grammar over every
  registered type; a source scan asserts no notification module reads a title-shaped column.
- **Every notification read composes the visible-matter predicate in SQL, before the `LIMIT`.** Feed,
  unread count, and digest resolve through ONE shared function. A post-filter is never acceptable.
- **Every read is scoped to the session's user**, never to a path parameter.
- **Nothing on the hot path.** No emitting write path gains a recipient read, a preference read, or a
  render. Fan-out and rendering run in the queue consumer or the cron pass.
- **At-least-once everywhere; idempotency is a UNIQUE constraint, not a check-then-insert.**
- **A translator or digest failure never fails an owning consumer's ack**, and never dead-letters a
  message another handler owns.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals, identifier prefixes, and ADR numbers reconcile at merge** if a sibling slice
  lands first.
- **Owner flags E1, P1, P2, R1, C1 are answered before slice 3 starts.** Slices 1 and 2 are safe under
  every answer; slice 3 hard-codes P1 and P2, slice 4 hard-codes E1 and C1.

## Commands

- Package tests: `pnpm --filter @magna-carta/notifications test`
- Worker tests: `pnpm --filter @magna-carta/worker test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm run lint:process-refs` · decision lint: `pnpm run lint:decisions`
- Per-firm migrations: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`, then
  `refresh-per-firm-snapshot` in the SAME commit as any hand-written migration
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

## Slice 1 — the record, the registry, the subscriber, the read API

**Shippable on its own as:** notifications raised by the platform's existing outbox topics appear in a
member's feed, filtered by matter visibility, readable and dismissable through the API. No
preferences (every category is on, which is the recommended default), no email, no UI.

### Task 1.1 — the package skeleton and the identifier prefixes

- [ ] Create `packages/notifications/` with `package.json`, `tsconfig.json`, and a `CLAUDE.md` from
      `docs/conventions/area-claude-template.md`. Dependencies: `@magna-carta/data-access`,
      `@magna-carta/database`, `@magna-carta/identifiers`, `@magna-carta/calendar` (for the visibility
      predicate and the emission-point constants). No other domain package.
- [ ] Add `notificationEvent`, `notificationRecipient`, `notificationDelivery`, and `notificationDigest`
      to `packages/identifiers/src/registry.ts` with a comment block explaining what each row is, in
      the style of the neighbouring entries, and the matching types in `types.ts`.

### Task 1.2 — the schema

- [ ] Add the four tables to `packages/database/src/per-firm-schema.ts`: `notification_event`,
      `notification_recipient`, `notification_delivery`, `notification_digest_run`, per the design's
      section 2. Column comments state the reasoning inline.
- [ ] `notification_delivery.channel` CHECK is seeded with the full set
      `in_app | email | push | sms | desktop` from the first migration — widening a SQLite CHECK later
      means rebuilding a growing table, and a value nothing writes costs a byte.
- [ ] Indexes: `notification_recipient (recipient_user_id, state, created_at, id)` — the filter column
      leads, then the ordering pair the keyset walks; `notification_event (matter_id)`;
      `notification_event (dedupe_key)` UNIQUE;
      `notification_recipient (notification_event_id, recipient_user_id)` UNIQUE;
      `notification_delivery (notification_recipient_id, channel)` UNIQUE.
- [ ] Generate the migration, refresh the snapshot in the same commit, and run the schema-conformance
      and schema-name-sync suites.

### Task 1.3 — the type registry

- [ ] `src/registry.ts`: the `NotificationType` shape (`key`, `category`, `severity`, `mandatory`,
      `audience`, `subscribesTo`, `subjectKind`, `matterAnchored`, `facts`, `escalation`, `channels`,
      `emailContent`, `deepLink`) and the frozen `NOTIFICATION_TYPES` registry.
- [ ] `src/facts-grammar.ts`: the closed value grammar and its validator. A declared `string` field is
      a validation failure, not a warning.
- [ ] Seed the registry with the slice-1 types drawn ONLY from topics that already exist, each naming
      the producing package's exported constant rather than a string literal where one exists:
      `ledger.entry.posted` (category `trust`), `billing.invoice.finalized` and
      `billing.invoice.voided` (`billing`), `file.quarantined` and `file.rescan_infected`
      (`documents`), `document.checkin_conflict` (`documents`), `matter.closed` and `matter.reopened`
      (`system`), `incident.created` (`system`).
- [ ] Fitness tests: every `subscribesTo` resolves to an exported constant of its producing package;
      every `matterAnchored` type declares a materializer that supplies `matter_id`; every declared
      `facts` schema passes the grammar; every `mandatory` category declares no opt-out; every
      matter-anchored type declares `emailContent: 'category-count'`.

### Task 1.4 — materialization and recipient resolution

- [ ] `src/materialize.ts`: pure functions turning a `(type, payload, resolvedRecipients)` triple into
      the event row and its recipient rows, with `dedupe_key = "<topic>:<outboxRowId>"`. No clock, no
      database.
- [ ] `src/recipients.ts`: the audience resolvers — `responsible-member`, `actor`,
      `capability-holders`, `designated` (returns empty until slice 3), and `matter-team` substituting
      to `responsible-member` with the substitution marked in the registry so the day a team model
      lands, the change is one resolver. Actor excluded unless the type declares `includeActor`.
      Fan-out capped at 200 with a counter when clamped.
- [ ] `src/statements.ts`: the insert statements, using the UNIQUE-insert idiom so a redelivery is a
      no-op rather than a checked read.

### Task 1.5 — the subscriber pass on the per-firm bus

- [ ] In `apps/worker/src/costs/recoverable-charge-consumer.ts`, add a second, non-exclusive pass after
      the owning handler: offer the message to the notification translator, which consults the registry
      and materializes on a hit. Comment states why it is non-exclusive (a topic may have both a
      business consumer and a notification) and why an unknown topic still acks (the bus is open).
- [ ] The translator's failure is caught, counted, and logged through the one telemetry pipeline; the
      owning handler's failure still propagates. Test both directions: an owning-handler throw is not
      swallowed, and a translator throw does not prevent the owning handler's ack.
- [ ] Test: a redelivered message produces exactly one event row and one recipient row per recipient.

### Task 1.6 — the read API

- [ ] `src/read-statements.ts`: ONE shared function resolving a member's visible notifications, taking
      the visible-matter predicate as a REQUIRED argument and composing it into the `WHERE` before the
      `LIMIT`. The feed page, the unread count, and (in slice 4) the digest all call it.
- [ ] Routes in `apps/worker/src/routes/notifications/notifications.ts`, every one through the chokepoint with full
      route metadata: `GET /api/v1/notifications` (keyset, platform cursor, `category`/`state` filters,
      refusing an unknown category rather than ignoring it), `GET /api/v1/notifications/unread-count`,
      `POST /api/v1/notifications/{notificationRecipientId}/read`, `.../dismiss`, and
      `POST /api/v1/notifications/read-all` bounded by a caller-supplied cursor.
- [ ] Add the `notifications:read` capability to `@magna-carta/access-control`'s registry and seed it to
      every default role; a member reading their own feed is not a privilege.
- [ ] Every read scoped to the session user, never a path parameter.
- [ ] Re-emit the OpenAPI snapshot and regenerate the typed client in the SAME commit.

### Task 1.7 — the wall fitness function and the measurement

- [ ] A table-driven test asserting every notification read statement contains the visible-matter
      marker, in the shape `packages/calendar/test/source-fitness.test.ts` established.
- [ ] A test proving a member whose visible-matter set shrinks stops seeing the row on the next read,
      with no row mutated, and that the unread count matches the filtered page count exactly.
- [ ] A test proving no placeholder is emitted for a filtered item.
- [ ] Load-profile measurement asserting the BOUND (statement count, rows read) for the feed page, the
      unread count, and a fan-out — not a wall-clock number.

### Task 1.8 — documentation

- [ ] `packages/notifications/CLAUDE.md` — purpose, key files, the invariants that bind here (redaction
      grammar, delivery-time wall, one shared read function, idempotency by UNIQUE), and the gotchas.
- [ ] `docs/user/features/` — the notification centre's user-facing guide is written when the UI ships;
      this slice adds nothing there. Note it in the slice's changelog fragment so it is not forgotten.
- [ ] Changelog fragment and a `status.d/` fragment for the slice. Never edit `CHANGELOG.md`,
      `STATUS.md`, or `ROADMAP.md` directly.

---

## Slice 2 — the comparison-driven path, and the emission points missing a write

**Shippable on its own as:** deadlines, custody reviews, and overdue check-outs reach the feed;
calendar event changes and email filings become transactional topics; delivered notifications age out.

### Task 2.1 — the three calendar write-path topics

- [ ] Add `calendar.event.scheduled`, `calendar.event.rescheduled`, and `calendar.event.cancelled` as
      outbox messages on the calendar's own record/edit/cancel effects, spelled from the existing
      `CALENDAR_NOTIFICATION_EMISSION_POINTS` constant so the two cannot diverge. Payload: identifiers
      only.
- [ ] Register the three types. The calendar package learns nothing about delivery; its "no cron, no
      queue, no recipient resolution here" property is preserved and its header comment updated only if
      it becomes inaccurate.

### Task 2.2 — the email-filing topic

- [x] Add an `email.filed` outbox message in the same batch that promotes a link to `filed`, so the
      guarantee is transactional rather than best-effort. Built on **both** paths that reach `filed` —
      the staff accept route and the capture consumer (accept-on-capture, and an auto-file rule
      choosing to file) — with the topic named once in `packages/email-filing/src/topics.ts`.
      **Deviation:** `raiseEmailFiledNotification` is deleted rather than kept as the documented call
      site. Once the row is written at the same place the no-op documents nothing the row does not,
      and a no-op call beside a real emission reads as a second mechanism. Recorded as
      `ADR-an-email-filing-announces-itself-with-a-row-not-a-call`.
- [x] Register the type. Payload and `facts` carry identifiers only — never a subject line.

### Task 2.3 — the per-firm sweep

- [ ] Add a sweep step to the existing cron pass in `apps/worker/src/scheduled.ts`, over the SAME
      `listReachableActiveFirms` enumeration, with one firm's failure quarantined and logged exactly as
      the outbox sweep already quarantines a sick firm database.
- [ ] The sweep calls, per firm: the calendar's horizon/due/overdue comparisons and
      `collectCustodyReminders` from `@magna-carta/custodian/reminders` — **the shipped function, not a
      reimplementation.** No second definition of what is due.
- [ ] `dedupe_key = "<kind>:<subjectId>:<civilDate>"` so a continuously-true comparison raises once per
      civil day rather than once per sweep. The civil date is computed in the firm's zone.
- [ ] Test: two sweeps in one civil day produce exactly one `calendar.deadline.overdue` event for one
      deadline; two sweeps across a date boundary produce two.

### Task 2.4 — retention

- [ ] A nightly bounded `DELETE … LIMIT` per firm removing events older than ninety days from
      `occurred_at`, read or unread, cascading recipient and delivery rows. Never touches a source
      record.
- [ ] Test the bound (the sweep is capped and resumable) and that a source row survives its
      notification.

### Task 2.5 — job-coordinator completion rows

- [ ] Each coordinator's terminal state additionally materializes a `jobs`-category notification. The
      socket push is unchanged; the row exists for the tab that was closed when the job finished.

---

## Slice 3 — preferences and the firm policy floor

**Depends on owner flags P1 and P2.**

### Task 3.1 — the preference value

- [ ] A single `ScopedSettingDefinition` keyed `notifications.preferences` in the notifications
      package, whose zod schema is the per-category matrix
      (`inApp: on|off`, `email: off|daily|weekly`) and whose in-code default is the recommended
      default set — every category
      `inApp: on`; `email: daily` except `jobs` and `system`, which default `off`. One key, not one per
      category: `resolveScopedSetting` reads one key per call, and the fan-out path resolves
      preferences once per recipient.
- [ ] Resolution honours the shipped `user → firm → default` chain unchanged.

### Task 3.2 — enforcement

- [ ] A category set `inApp: off` writes NO feed row — a suppressed notification must not be a row
      somebody later discovers.
- [ ] A `mandatory` category (`security`, `trust`) ignores an `off` for the in-app channel and is shown
      locked; the member may still set that category's email cadence.
- [ ] The firm tier is a FLOOR on in-app only. A firm may raise `inApp` to `on`; a firm may NOT force a
      member's email cadence upward. Test both directions.

### Task 3.3 — the trust-compliance designation

- [ ] A firm-tier setting naming zero or more members who join the recipient set of every
      `trust`-category notification, written by a member holding the trust-management capability and
      audited (metadata only).
- [ ] **A designation is not a grant of access.** Where the designated member cannot see the matter,
      write a `notification_delivery` row with `suppressed_reason = 'not-visible'` and NO feed row and
      NO placeholder. Test that the member's feed and unread count are byte-identical to a firm with no
      such notification.

### Task 3.4 — preference API and audit

- [ ] `GET`/`PATCH` on the preference key through the existing settings surface; a `PATCH` of one
      category re-resolves and composes the upsert in the same effect batch.
- [ ] Preference changes write an `audit_log` row carrying the category, the resolved cadence, and the
      actor — never a subject, a matter, or a recipient list.

---

## Slice 4 — the email digest

**Depends on owner flags E1 and C1.**

### Task 4.1 — the digest reader

- [ ] `src/digest.ts`: read the `notification_digest_run` watermark as a keyset cursor
      `(last_occurred_at, last_event_id)` — never a bare timestamp, or two events sharing an instant
      straddle the boundary — then read the member's rows after it through **the same shared read
      function slice 1 built**, composing the visible-matter predicate, capped at a page.
- [ ] Aggregate to per-category counts. A cap overrun contributes as "at least N"; there is no per-item
      list to truncate.

### Task 4.2 — the renderer, and the content boundary

- [ ] Render a text email: a fixed matter-free subject carrying only a count, a body of per-category
      counts, and one deep link into the feed. Matter-anchored kinds contribute a COUNT and nothing
      else. Account and security kinds — which are about the recipient rather than a client — keep
      their existing full content through the same port.
- [ ] A golden test renders a digest over a fixture whose matters carry deliberately identifying titles
      and numbers, and FAILS if any of them appears in the output. This is the test that makes the
      boundary structural.
- [ ] Text, not HTML: nothing HTML buys here, and it keeps the send port's signature unchanged and the
      body free of remote fetches.

### Task 4.3 — the run

- [ ] Send through `SendEmail` with `messageClass: "notification-digest"`. **Send first, then mark** —
      the ordering the outbox relay already argues for: a crash between the two re-sends a digest
      (annoying), where marking first risks losing it (a missed deadline).
- [ ] Write the `notification_delivery` rows as `sent` and advance the watermark in ONE batch.
- [ ] A member with zero visible items in the window gets NO email.
- [ ] Daily and weekly runs anchor to a firm-tier local hour so a digest lands in the morning, not at
      UTC midnight.
- [ ] Honour a registry-declared `escalation: "immediate"` for the trust and security kinds only, under
      the same content rule.
- [ ] Test the crash-between-send-and-mark path: the digest re-sends and the watermark does not
      double-advance.

---

## Definition of done (every slice)

- [ ] `pnpm check:scoped` clean on the diff; `pnpm test` green.
- [ ] `pnpm run lint:process-refs` and `pnpm run lint:decisions` clean.
- [ ] OpenAPI snapshot and typed client regenerated in the same commit as any route change.
- [ ] Per-firm migration generated and the snapshot refreshed in the same commit.
- [ ] Load-profile measurement asserts the bound, not a wall-clock number.
- [ ] Developer docs (the package `CLAUDE.md`) and, where a user-visible surface ships, `docs/user/`
      updated in the same commit; changelog and `status.d/` fragments committed. `CHANGELOG.md`,
      `STATUS.md`, and `ROADMAP.md` are never edited on a branch.
