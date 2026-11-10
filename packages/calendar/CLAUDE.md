# @magna-carta/calendar — CLAUDE.md

**Purpose.** The calendar: the recorded tables that hold facts born here (a litigation event, a
deadline, a firm event, a resource and its bookings, a typed link between events), the event-type
catalog and participant lists beside them, and the **source registry** that federates those rows with
the subsystem tables that already record what the firm did — under one comparable sort key, one
shared cursor, and one visibility contract. Validates in memory and composes statements into
`@magna-carta/data-access`'s `composeEffectBatch`; holds no binding, reads no clock, and never calls
an external service.

**White paper:** _Calendar and rules-based docketing_, with _Foundational data & runtime conventions_
(the time model), _Notifications_, _Tenancy and data isolation_, and _Authentication, access control &
encryption_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0018, ADR-0055,
ADR-0059, ADR-0068, ADR-0051.)
**Spec:** [`docs/specs/2026-08-05-case-calendar-design.md`](../../docs/specs/2026-08-05-case-calendar-design.md).

## Key files / entry points

- `src/contract.ts` — **what the calendar's API accepts and returns**, as plain zod: every request
  body and response shape, each named with `.meta({ id })`, which the contract emitter reads as the
  component name. The route module in `apps/api-worker` declares routes over these and restates no
  field; path and query parameters stay with the routes (addressing, not shape). Rule and reasoning:
  `docs/conventions/api.md` (_Where a contract shape lives_). A change here changes the committed
  contract — re-emit the snapshot and the client in the same commit.
- `src/sync-contract.ts` — what the connected-accounts routes accept and return
- `src/sync-port.ts` — `CalendarSyncPort`: what calendar sync needs from a member's own calendar
  account, in this package's vocabulary. An interface only; the adapters that implement it live in
  their provider's package (`packages/microsoft-graph`) and this package still calls no service
- `src/types.ts` — the closed vocabularies, the window and page caps, and the two shapes a source's
  time column can have
- `src/validation.ts` — every refusal as a code the route maps to a problem type, plus the window and
  horizon caps
- `src/time-zone.ts` — **the only calendar arithmetic in the package**: a civil date plus an optional
  wall-clock time, read in a named zone, as a UTC instant
- `src/overdue.ts` — the read-time comparison, and nothing else
- `src/settings.ts` — the firm's calendar settings over the per-firm setting table: the day the
  week begins on (a FIRM setting, never a personal one, by the owner's ruling; Sunday by default)
- `src/event-statements.ts` / `src/event-service.ts` — recording, editing, and cancelling an event,
  plus the participant replace-set
- `src/event-type-statements.ts` / `src/event-type-service.ts` — the catalog, and the platform-row
  immutability rule
- `src/deadline-statements.ts` / `src/deadline-service.ts` — recording, editing, satisfying,
  vacating, and superseding a deadline
- `src/event-shape.ts` — the shape asserts both event scopes share (dates, times, zone, the three
  participant shapes), written once and parameterized over the table
- `src/firm-event-statements.ts` / `src/firm-event-service.ts` — the firm's own scope: meetings,
  closures, training, holidays, reservations, with the `all_members`/`participants` audience switch
- `src/resource-statements.ts` / `src/resource-service.ts` — the bookable-resource catalog (rooms,
  vehicles, equipment), soft-deactivate discipline
- `src/booking-statements.ts` / `src/booking-service.ts` — bookings, the two-stage overlap check,
  and the availability read with pre-paired conflicts
- `src/link-statements.ts` / `src/link-service.ts` — typed event links; `related` only through the
  service, `continuance_of` only through the continuance operation
- `src/continuance-service.ts` — the one-batch continue operation and the depth-capped chain read
- `src/visibility.ts` — **the visibility seam**: the one predicate every matter-anchored source
  composes
- `src/sources/registry.ts` — the `TimelineSource` declaration shape, the `visibilityAnchor`
  contract field, and the registry
- `src/sources/build.ts` — the one place a source's SELECT is assembled (`boundedSelect` for
  matter anchors, `boundedFirmScopedSelect` for the allowlisted firm anchors)
- `src/sources/all.ts` — the fifteen declared sources, the audit-log lifecycle allowlist, and
  `FIRM_ANCHORED_SOURCE_KEYS` (the reviewed firm-anchor allowlist)
- `src/merge.ts` — the k-way merge, the shared cursor, and the canonical-instant assertion
- `src/timeline.ts` — one page across the registry: pre-reads, statements, merge, and the counts a
  measurement asserts against
- `src/notifications.ts` — the eleven emission points; the three matter-event ones are real outbox
  topics written by the services here, `calendar.event.meetingScheduled` is a real topic written by
  the ROUTE (the row it announces is a meeting, which this package does not know about), and the
  other seven are declared and wired to nothing

## Invariants that apply here

- **Nothing is projected, copied, or backfilled.** A fact born in another subsystem is read IN PLACE
  through a declared source; a fact born here gets a row here. That is what makes the class of bug
  where the timeline disagrees with the register unwritable — the timeline IS the register. A source
  is a read-side declaration and NEVER a write-side obligation on the subsystem that owns the rows.
- **Every source's statement builder takes the visible-matter predicate as a REQUIRED argument** and
  a **matter-anchored** source composes it into the `WHERE` clause **before the `LIMIT`**. Required
  rather than optional so the omission is a type error first and a fitness failure second. Composed
  in SQL and never applied in the Worker after the rows come back: a post-filter under-fills the
  page, makes the next cursor mean something different from page to page, and turns the page size
  into an existence oracle for the rows it removed. `test/source-fitness.test.ts` proves all of it
  for every registered source from one table-driven pass.
- **A source declares its `visibilityAnchor`, and a `firm` anchor is a reviewed allowlist entry,
  never a silent exemption.** A firm event has no matter, so it structurally cannot compose the
  matter predicate; under the trusted-insider posture its rows are firm-visible by construction (an
  ethical wall is a MATTER screen with nothing to bind to on a firm meeting). The fitness pass
  asserts the declaration both ways: every `matter`-anchored statement carries the predicate marker,
  and every `firm`-anchored source is one of `FIRM_ANCHORED_SOURCE_KEYS` (today: exactly
  `firmEvent`). If screening firm events is ever needed, that is a NEW declared anchor with its own
  predicate — never a loosening of this one.
- **A repeating setting is ONE ROW carrying a rule, and this package writes no occurrence.**
  `recurrence_rule` holds an RFC 5545 `RRULE`; the dates it falls on are read back from it, never
  stored. A row per date would multiply a firm's calendar by the length of its longest series before
  anybody looked at it and make "move the series" fifty-two writes. **The rule is validated at the
  WRITE against the grammar the record form itself writes** (`@magna-carta/civil-time/recurrence`,
  which both sides depend on precisely so there is one reading of what a valid rule is): a rule this
  platform cannot read back is a series nobody can edit again, so it is refused with
  `calendar-invalid-recurrence` rather than stored. **A continuance does not inherit the series** —
  continuing a hearing moves ONE setting to a new date, and carrying the rule across would make the
  replacement repeat.
- **The correction/continuance line.** A CORRECTION is an edit: the row misdescribed reality, the
  edit-in-place rule stands, and the audit row carries the fix. A CONTINUANCE is a real-world
  reschedule: the court vacated one setting and made another, both of which happened — so the old
  row keeps every historical column byte-untouched (only `status`, `status_reason`, and
  `updated_at` move), a new row carries the setting as it now stands, and ONE `continuance_of` link
  points new to old, held to a chain by two partial unique indexes the SCHEMA enforces (at most one
  predecessor and one successor per setting; a fork is refused even under racing writes).
  Continuance binds MATTER events only — a moved staff meeting is not procedural history, so firm
  events keep edit-in-place semantics. The continue response lists trigger-linked open deadlines as
  a PURE LOOKUP (nothing moves; the no-arithmetic position binds in full) and the bookings the
  status change released.
- **A booking's liveness is DERIVED from its event, never stored.** A booking blocks its resource if
  and only if its event's status is not `cancelled`. There is no released flag and no second write —
  a fact that is a join cannot drift from the row it joins, so cancelling or continuing an event
  frees its rooms atomically because releasing is not an action at all. The booking's `time_zone`
  is the RESOURCE'S, frozen from its office at the write, so an office zone change never
  reinterprets an old booking.
- **Double-booking is warn-and-allow, with the conflict visible everywhere.** The write succeeds and
  carries `conflicts`; the availability read pre-pairs every overlapping pair. Refusal would make
  the platform referee rooms it does not own, could not be held by SQLite anyway (no interval
  exclusion constraint, so a refusal is a race), and must never be why a hearing cannot be
  recorded. The overlap check is two bounded stages: one coarse civil-date SQL statement widened a
  day each side, then precise instant intersection per row through each row's own stored zone.
- **A booking is never freestanding, and a booking is not a source.** Every booking hangs off
  exactly one event ("book the pool car Friday" is a Reservation-type firm event with the booking
  attached) — that one rule keeps who-booked-it, cancellation, and the calendar's read surfaces
  from being reinvented per booking. And nothing about bookings joins the timeline registry: a room
  being busy is the availability read's fact, not a calendar entry.
- **Every instant column is canonical.** The merge compares sort keys AS TEXT, which is chronological
  only for the exact shape `YYYY-MM-DDTHH:mm:ss.sssZ`. A source that began writing `…:00Z` would sort
  AFTER `…:00.500Z` — `'.'` precedes `'Z'` in byte order — and the timeline would be quietly wrong in
  a way no test of the merge itself would catch. `assertCanonicalInstant` is the guard and its failure
  message states that consequence, because the failure is otherwise inscrutable.
- **NOTHING COMPUTES A DEADLINE DATE.** No business-day arithmetic, no court-holiday calendar, no
  service-method offsets, no cascade when a trigger event moves, no default deadline created when a
  matter opens, and no inference of a jurisdiction from anything. A deadline's `trigger_event_id` is a
  LINK to the event that started the clock and never an input to a calculation. Missed deadlines are
  the largest single source of malpractice claims, and that cuts toward VISIBILITY and against
  ARITHMETIC: a computed deadline that is wrong is worse than none, because it gets trusted precisely
  because it was computed and the firm that would have looked the rule up does not.
  `test/window-and-arithmetic.test.ts` scans the sources for any date-arithmetic identifier.
- **A matter-event write path announces itself in its own batch, and announces nothing else.** The
  three matter-event emission points are outbox messages composed into the effect the service was
  already returning: two identifiers, never a title, a description, a court reference, a location, or
  a participant. The package still schedules nothing, resolves no recipient, and reads no preference.
  **`rescheduled` means the setting MOVED** — the five columns that answer when it happens, compared
  as stored — and never a title or room correction, because a notification is the one thing a reader
  acts on without opening the record. **A continuance raises exactly one `rescheduled`, naming the
  NEW setting**: the batch cancels a row and inserts another, but one thing happened in the world,
  and announcing a cancellation plus a scheduling would say the hearing is off and then that a
  different hearing exists. `test/event-topics.test.ts` holds all of it.
- **Nothing writes "missed".** Overdue is `state = 'open'` and the due instant is past, computed at
  read time in `src/overdue.ts`. No sweep, no scheduled job, no state transition, and no column. A
  stored flag would need per-firm machinery for a fact that is a subtraction, could be stale where a
  comparison cannot, and would make the platform assert something about a firm's conduct it is not in
  a position to assert — the deadline may have been extended by a stipulation nobody has typed in,
  satisfied under another matter, or vacated by an order that arrived this morning.
- **The audit log is a source ONLY over its strict allowlist.** `MATTER_LIFECYCLE_EVENT_KEYS` is a
  frozen four-key constant. The log records when a row was WRITTEN rather than when the thing
  HAPPENED, its subject column is untyped, its event vocabulary is uncurated by design, and it is a
  compliance record with its own retention and access posture. It is still the only home for a
  matter's own lifecycle, which is why it is registered at all.
- **A timeline entry carries no privileged content.** Identifiers, a kind, a sort key, an actor, a
  deep link, and the source's DECLARED non-privileged label. Where a source has no such label it
  DECLARES that it has none and the row renders by kind alone — an email's subject line is privileged
  content, and putting one on a read spanning every matter is a disclosure. Absence is a decision,
  never an oversight.
- **A WINDOW OVER A SPAN IS AN OVERLAP, NOT A START.** `civilDateWindowConditions` compares both
  bounds against the source's sort column, which for an event is `starts_on` — so a three-day trial
  was outside every window that did not contain its first day, and a firm reading Tuesday saw an
  empty column it was spending in court. A source whose rows can span uses
  `spanningCivilDateWindowConditions` instead: it is in the window when it STARTS before the window
  closes and ENDS after it opens. `COALESCE(ends_on, starts_on)` is what makes a point-in-time row
  behave exactly as it always did — its end IS its start — so the predicate collapses to the plain
  one for almost every row the calendar holds. This does not widen a source past its window; it
  returns rows the window always should have held. Today: the `matterEvent` and `firmEvent` sources
  and `selectFirmEventsStatement`. A deadline is a point and keeps the plain window.
- **A civil date is stored as a civil date.** `starts_on`, `ends_on`, and `due_on` are `YYYY-MM-DD`
  text and a time is separate and optional, because "all day" is a real and common answer. No column
  stores midnight-local-as-UTC: that is the daylight-saving off-by-one that moves a hearing by a day
  when the clocks change, which is the one failure a docketing system cannot have.
- **The zone lives on the row and is required.** A Nevada firm appearing in a California court has a
  hearing in `America/Los_Angeles`, and no property of the firm, the matter, or the office says so. It
  is validated at the WRITE, never at the read: a row whose zone nothing can resolve is a hearing
  nobody can display and nobody can correct without a migration. A fixed offset is refused — it is
  wrong for half the year wherever daylight saving is observed.
- **An event is MUTABLE and a continued hearing is an edit.** The one place this package departs from
  the custody ledger's append-only discipline, deliberately: a calendar is a plan and a record of a
  plan, hearings move, and a firm made to record a compensating row to fix a typo stops recording. A
  second row would put two hearings on the calendar and make every consumer responsible for hiding
  one. The `audit_log` row written in the same batch carries the move.
- **A platform event type's name and code are immutable to a firm.** A firm deactivates one it does
  not use; it never redefines what "Hearing" means for everybody else. Nothing in the API can mint a
  `platform` row — the shared vocabulary arrives only by migration.

## How to add a source

One entry in `TIMELINE_SOURCES`, and nothing else anywhere:

1. **A registry row** — the stable `key` (a WIRE CONTRACT once shipped, since it appears in responses
   and in the `kind` filter), the closed `kinds` set, the declared `timeColumnShape`, and the
   declared `visibilityAnchor` (almost always `matter`; a `firm` anchor additionally requires an
   entry on the reviewed `FIRM_ANCHORED_SOURCE_KEYS` allowlist, with the reasoning written down).
2. **A statement builder** — built through `boundedSelect`, which composes the predicate, the keyset,
   and the `LIMIT` for you. Return `[]` where the scope cannot match rather than a query that cannot
   hit.
3. **A projection** — through `projectRow`, with the deep link into the owning subsystem's own read.
4. **A label decision** — a genuinely non-privileged summary, or `declaresLabel: false` and `NULL AS
   label` in the SQL. There is no third option.
5. **A permission** — the read capability a DESCRIPTION of these rows sits behind (`notes:read`,
   `custody:read`), or `null` where every member may read the record. It gates `describe` only: the
   entry itself carries no content and is never withheld.
6. **A `describe`, where the rows have names** — one statement through `describeSelect`, which binds
   the matter, the page's row ids, the predicate and the LIMIT for you, projecting the fixed
   `row_id / title / type_text / facts_json` columns. Called only by a matter-scoped read that asked
   to describe (the matter's Activity section); the firm-wide read never calls it, so nothing a
   describe projects reaches a cross-matter answer. The `facts_json` object is the subsystem's own
   fields, read only by that subsystem's own presentation in `apps/web/src/lib/activity/`.

It is **never** a change to the owning subsystem's write path, and never a new table. The web app
pairs every key here with an `ActivityContribution` beside the owning subsystem's own code, and
`apps/web/test/activity-contributions.test.ts` fails until it exists.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/money`, and `@magna-carta/access-control` (for the `Permission` a source declares —
  the same registry matter-search names its capabilities from). It depends on no other domain
  package: every source reads its rows by table name, which the schema-name-sync fitness test pins
  to `@magna-carta/database`.
- The route layer (`apps/api-worker/src/http/routes/calendar/calendar.ts`) hands every service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.

## Gotchas

- **The read count scales with the REGISTRY, not with the firm's data.** That is the line between a
  bounded fan-out and an N+1: N here is the number of declared sources, fixed in code and reviewed
  when it changes. `TimelineReadResult` reports `statementCount` and `rowsRead` so a measurement can
  assert the bound rather than infer it.
- **A page over-reads to under-return.** Every source reads `pageSize + 1` so the MERGED result can
  tell "there is more" from "that is all"; the extras are discarded. At fifteen sources and a
  fifty-row page that is up to 765 rows read to return 50.
- **The zone read returns its own clamp, and callers consume it rather than re-derive it.**
  `readOpenDeadlineTimeZones` over-reads by one and answers `{ timeZones, clamped }`. The signal is
  on the read because the consequence of missing it is not an under-filled page: a zone the read
  never returns contributes no cutoff, so every deadline in it matches neither the overdue bound nor
  the due-today window and a whole jurisdiction goes unreported while every counter beside it reads
  healthy. `clamped` is a BOOLEAN — over-reading by one learns that the bound bit and never by how
  much, and a magnitude invented there would be the same dishonesty one level down. The other
  bounded reads here (`readOpenDeadlinesByTriggerEvent`, `readLinksTouchingEvent`,
  `readLiveBookingsInWindow`) still return bare arrays; each is a backstop on a read whose natural
  size is a handful, and each says so in its own comment. If one of those bounds ever becomes
  reachable in practice, this is the shape it takes.
- **The cursor is the platform's, not the calendar's.** `encodeCursor`/`decodeCursor` from
  `@magna-carta/data-access/cursor-pagination`, byte-identical to every other list read's — the
  calendar mints no wire contract of its own. One cursor serves every source because they all sort by
  the same comparable key.
- **The merge's tiebreak is load-bearing.** Sort key then row id, so the order is TOTAL. Without it,
  two sources tying on one key would order differently from page to page and a keyset walk would
  repeat or skip rows at the boundary.
- **A `kind` filter narrows the registry, not the results.** Filtering to one source issues ONE
  statement. A kind naming a source the registry does not carry is REFUSED rather than ignored: a
  silently-dropped filter returns more than the caller asked for, which on a read spanning every
  matter is the wrong direction to fail in.
- **A member filter DROPS the sources that cannot answer it.** Silently ignoring the filter would put
  other people's matters on the answer to "what is on my calendar".
- **The window cap is a refusal, not a clamp.** A caller that asked for three years and quietly
  received one cannot tell that from a firm with nothing recorded in years two and three.
- **`statutory_catalog` is a reserved source and unreachable.** The column and its check land now
  because adding them later means rebuilding the table; the create path refuses the source until a
  verified jurisdiction-keyed catalog exists. When one does, the interaction is propose-and-confirm —
  a member accepts a proposed date and that acceptance creates the row, the catalog never writes one
  by itself, and an existing row is never recomputed when the catalog changes.
