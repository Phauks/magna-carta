# Calendar slice 2 — firm events, resource availability, event links, and honest continuance — design

**Date:** 2026-08-07
**Status:** Design per owner direction (the 2026-08-07 docket overrides on flags L1 and L4); the
three flags in section 11 are confirmations of recommendations, not open architecture. No product
code in this cycle. The implementation plan is section 12 of this document.
**Scope:** The calendar's second slice, owner-directed: events that belong to the firm rather than to
a matter (meetings, closures, training, firm-wide entries); rooms and other firm resources with an
availability model and a double-booking posture; typed links between events; and continuance
semantics that show what was continued from what without falsifying history. Excludes — unchanged
from slice 1: every user interface, court e-filing and docket integrations, rule-based deadline
computation, notification wiring (the seam is extended here, not wired), external calendar
synchronization, recurring events, and matterless **personal** appointments (a firm event is not a
personal appointment; section 2.6 draws the line).
**White-paper home:** _Calendar and rules-based docketing_, with _Foundational data & runtime
conventions_ (the time model), _Notifications_, _Tenancy and data isolation_, _Authentication, access
control & encryption_, and _Matters and File Manager_ as surrounding context.
**Governing decisions:** the calendar slice-1 decision (pending fragment
`docs/decisions/pending/case-calendar-event-model.md` — federation, civil dates, per-row zones, the
visibility seam, no deadline arithmetic; everything there stands except the two positions the owner
overrode), ADR-0055 (instants in UTC; civil dates as a plain date plus an explicit zone), ADR-0018
(calendar and docketing), ADR-0068 (trusted-insider access control; ethical walls a deferred named
seam), ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0039 (nothing heavy on the hot
path), ADR-0051 (registry, chokepoint, fitness function), ADR-0059 (Notifications owns delivery),
ADR-0064 (transactional outbox), ADR-0017 / ADR-0038 (audit and redaction), ADR-0052 (canonical deep
links; a filtered row is a 404, never a 403).
**Decision inputs:** the shipped calendar package (`packages/calendar/src/` — the thirteen-source
registry, `visibility.ts`, `notifications.ts`, the merge and its text-comparable sort key); the
shipped per-firm schema (`packages/database/src/per-firm-schema.ts` — `matter_event` and its check
constraints, `custody_location` as the firm-facility precedent, `location.time_zone`); the additive
migration discipline (`packages/database/CLAUDE.md` — no destructive DDL, which turns out to decide
one of this design's questions); the notifications delivery design
([`2026-08-06-notifications-delivery-design.md`](2026-08-06-notifications-delivery-design.md)) for
the subscriber model this slice's new emission points feed; and the owner docket
(`docs/decisions/pending/owner-docket-2026-08-07.md`).

## Why now — the owner's direction

Slice 1 flagged two decisions and recommended answers; the owner — the flags' intended audience —
answered both against the recommendation, with reasons, and directed this slice:

- **L1 asked whether `matter_event.matter_id` should be required.** Slice 1 said yes, and shipped it
  required. The owner's override: _"we need to enable people to put firm meetings"_ and _"availability
  of rooms"_ — the calendar must hold events that belong to the firm, not to any case, and the rooms
  those events happen in must have a visible availability story.
- **L4 asked whether a continued hearing is an edit or a new row.** Slice 1 said edit, with the audit
  log carrying the move. The owner's override: a continuance is a **real-world reschedule** — the
  court vacated one setting and made another, both of which happened — and the record must show what
  was continued from what without falsifying history. The L4 counter-argument ("we need to see it
  moved") was the owner's own position all along.

The owner also directed **event links** — relations between events — which continuance turns out to
need anyway, so the two share one mechanism (section 4).

Everything else from slice 1 was ratified and stands untouched: federation over projection (L2), the
366-day window cap as a refusal (L5), time and cost entries as filterable sources (L6), the
audit-log lifecycle allowlist (L7), and — separately ratified as design flag L3 — the refusal of
deadline arithmetic. Nothing in this slice recomputes, cascades, or derives a date.

## 1. What this design is, in one paragraph

**Five new recorded tables and one additive column, no change to any shipped row's meaning.** A
`firm_event` (with participants) holds what the firm schedules for itself; a `firm_resource` (with
bookings) holds the rooms, vehicles, and equipment those events occupy, with availability as a read
and double-booking as a visible fact rather than a refusal; a `calendar_event_link` holds typed
relations between events, and its `continuance_of` kind — constrained to a chain by two partial
unique indexes — is how a continued hearing becomes a new setting that points at the vacated one.
The federated read layer gains one source (`firmEvent`); the visibility contract gains one honest
declaration (a firm event has no matter and says so); and the notification seam gains four declared
emission points, wired to nothing.

## 2. Firm events — the second recorded scope

### 2.1 A second table, not a nullable column — and why the schema decides it

The obvious alternative is loosening `matter_event.matter_id` to nullable. It is rejected twice over,
and the second rejection is not a matter of taste.

**The domain argument** is slice 1's, and the owner's override does not touch it: every read over
`matter_event` is "what happened on this case", the visibility predicate keys off the matter, and
every one of the thirteen federated sources composes a predicate over a matter-id expression. A null
matter would put a "does not apply" branch inside the one seam whose value is that it has no
branches — the wall, when it is built, is one clause in one predicate precisely because every row
that predicate sees has a matter.

**The mechanical argument** closes the question: `matter_id` is `NOT NULL` on a shipped table, and
SQLite drops a `NOT NULL` — like widening the status `CHECK` — only by rebuilding the table. The
per-firm lineage is additive-only; the migration suite rejects a rebuild of a table holding data.
The change is not merely undesirable, it is unshippable under the fleet's own rules.

So firm events get their own table, sharing the event **shape** (the civil-date/time/zone model, the
status vocabulary, the participant model) but not the event **scope**. The two tables are the two
answers to "whose calendar is this on": a matter's, or the firm's.

### 2.2 `firm_event`

- `id` — `firmEvent_` handle.
- `event_type_id` — nullable foreign key to `matter_event_type`. **The catalog is shared,
  deliberately.** Its `category` column already carries `firm`, its rows are vocabulary rather than
  matter facts, and a second catalog would mean the firm curating "Meeting" twice. The table's
  `matter_` name prefix is a naming wart this design accepts and records: renaming a shipped table
  is a rebuild, and a wart is cheaper than a second home for one vocabulary. New platform rows are
  seeded for the firm scope (section 12, migration sketch).
- `title` — required, non-empty.
- `description` — free text, nullable.
- `status` — `scheduled` | `occurred` | `cancelled`, same vocabulary and same discipline: the status
  says what the firm asserts, nothing derives one.
- `status_reason` — free text, nullable. Why this is no longer happening, when it is not (the
  deadline `state_reason` precedent, optional here because a cancelled staff meeting does not always
  deserve a paragraph).
- `starts_on` / `starts_at_time` / `ends_on` / `ends_at_time` / `time_zone` — byte-identical shapes
  and check constraints to `matter_event`: civil dates as `YYYY-MM-DD` text, times separate and
  optional (all-day is a real answer), the IANA zone required on the row. The user interface defaults
  the zone from the hosting office; a firm retreat in another state overrides it per row, exactly as
  a hearing in another state's court does.
- `audience` — `all_members` | `participants`. **This is the "firm-wide entries" half of the owner's
  ask.** A firm holiday, an office closure, or an all-hands is on everyone's calendar without
  enumerating everyone — enumerating members into a participant list decays with every hire and
  departure, and a firm-wide entry that silently misses the newest associate is worse than none. An
  `all_members` event needs no participant rows; a `participants` event is on the calendars of the
  people listed.
- `location_id` — nullable foreign key to `location`. A firm event, unlike a hearing, usually **is**
  at one of the firm's offices, so the structured link is right here where it was wrong on
  `matter_event` — and it is what lets the interface default the zone and the room list. Nullable
  because an offsite retreat is real.
- `location_text` — free text beside it, for the offsite venue or the detail within an office.
- `recorded_at` / `recorded_by` / `created_at` / `updated_at` — the same record-versus-appearance
  instants as `matter_event`.

Indexes: `(starts_on, id)` — the firm calendar's date-ranged read; `(status, starts_on)` — what is
still scheduled; `(location_id)`. Check constraints mirror `matter_event`'s shape checks (date and
time GLOBs, range check, end-time-requires-start-time, non-empty title, status and audience sets,
non-empty zone).

### 2.3 `firm_event_participant`

The same three shapes as `matter_event_participant`, for the same reasons — a firm meeting's
attendees are mostly members, sometimes a Directory entity (the bank's relationship manager),
sometimes an external (a visiting CLE speaker who belongs in nobody's conflicts corpus):

- `id` — `firmEventParticipant_` handle; `firm_event_id` — required foreign key.
- `participant_kind` — `member` | `entity` | `external`, with the same shape check naming which
  column carries the participant (`member_user_id`, `entity_id` by value with no cross-domain
  foreign key, `participant_name`).
- `role` — free text, nullable.

A second table rather than widening `matter_event_participant` with a nullable `firm_event_id`, for
the section 2.1 mechanical reason: `event_id` there is `NOT NULL` and shipped, and "exactly one of
two columns" cannot be retrofitted without a rebuild. The duplication is the schema's, not the
code's — the participant replace-set logic in `@magna-carta/calendar` is written once and
parameterized over the table.

Indexes: `(firm_event_id)`, `(member_user_id)` — the "what is on my calendar" filter.

### 2.4 Visibility — an honest declaration, not a silent exemption

Every shipped timeline source composes the visible-matter predicate as a required argument, and a
fitness test proves it per source. A firm event has no matter, so it structurally cannot compose a
matter predicate — and the wrong move is to quietly skip the fitness test for it.

The source contract instead gains a declared field: `visibilityAnchor: 'matter' | 'firm'`. A
`matter`-anchored source composes the predicate exactly as today, fitness-enforced. A
`firm`-anchored source declares that its rows are firm-visible by construction — under ADR-0068's
trusted-insider posture every member sees the firm's own calendar, and an ethical wall is a
**matter** screen with nothing to bind to on a firm meeting. The fitness test then asserts the
declaration both ways: every `matter`-anchored source's statement carries the predicate marker, and
every `firm`-anchored source is one of a reviewed allowlist (today: exactly `firmEvent`). Absence of
the predicate is a declared decision with a named reviewer, never an oversight — the
`declaresLabel: false` idiom applied to visibility.

If a future overlay ever needs to screen firm events (a partners-only compensation meeting), that is
a new declared anchor with its own predicate, not a loosening of this one. Section 10 names it.

### 2.5 The `firmEvent` timeline source

One more registry row. `key: "firmEvent"` (a wire contract once shipped), `timeColumnShape:
'civilDate'` over `starts_on`, `visibilityAnchor: 'firm'`, label: the event-type name and the
audience — a firm event's **title** stays off the federated read for the same reason every label is
declared: "Meeting — all members" is renderable without disclosure, and the title ("Discuss the
Herrera write-down") is not the platform's to broadcast beyond the event's own access-gated read.
Detail follows the deep link.

Scope behavior: on a **matter timeline** the source returns no statements — a firm event is on no
matter's history. On the **firm calendar read** (`GET /api/v1/calendar/events`) it contributes its
date-windowed page like any source, merged under the same text-comparable sort key and the same
cursor. The read gains a `scope` filter — `matter` | `firm` | `all` (default `all`) — which narrows
the registry before any statement is built, exactly as `kind` does. The `memberId` filter matches a
firm event when the member is a participant **or** the event's audience is `all_members`: a firm
holiday is on everyone's answer to "what is on my calendar", which is the point of the audience
column.

### 2.6 What a firm event is not

A firm event is firm-visible business fact: a meeting, a closure, training, a reservation
(section 3.4). It is **not** a personal appointment — "dentist, Thursday 3pm" has an audience of
one, a privacy posture the trusted-insider model deliberately does not cover, and its own slice-1
deferral, which stands. The line is the audience: a firm event is readable by every member by
construction. Nothing in this slice stores a fact one member may record and another may not read.

## 3. Rooms and resources

### 3.1 Where a resource lives — the argued alternatives

**A Directory entity?** No. The Directory is the conflicts corpus — the people and organizations the
firm checks itself against — and slice 1 already refused to force a judge into it because a
non-party pollutes every conflicts run. A conference room is not even a person; putting "Conference
Room A" beside opposing counsel in the same search index is the judge problem with none of the
judge's dignity. Rejected on the same grounds, harder.

**A `custody_location` node?** Closer — that tree already models the firm's physical space
(office → room → safe → shelf) — but wrong on ownership: the custody tree exists to answer "where is
the original will", its rows carry custody semantics (packets resolve their office through it), and
a bookable conference room is not a custody location any more than the safe is bookable for
meetings. Entangling "where things are kept" with "what can be reserved" couples two subsystems that
change for different reasons. Rejected.

**Its own table**, `firm_resource` — recommended. A resource has properties neither alternative
carries (a kind, a capacity, a home office, an active flag for the room that becomes storage), and
its natural foreign key is `location` — the same office table the custody tree's roots bind to, so
the two views of the building agree on what an office is without sharing rows.

### 3.2 `firm_resource`

- `id` — `firmResource_` handle.
- `name` — required, non-empty, unique. "Conference Room A", "Pool car — silver".
- `kind` — `room` | `vehicle` | `equipment` | `other`. A closed platform enum, **not** a firm
  catalog, because — unlike event types — no jurisdiction-specific vocabulary exists here and
  nothing branches on it beyond grouping and iconography (the `custody_location.kind` discipline).
  `other` is the pressure valve; section 11 flag R2 confirms the call.
- `location_id` — nullable foreign key to `location`. The home office; null for a resource assigned
  to none.
- `capacity` — nullable positive integer. Real for rooms, meaningless for a projector; nullable is
  honest. **Nothing enforces it** — the platform does not refuse a twelve-person meeting in a
  ten-seat room; capacity renders on the picker so a person can decide.
- `notes` — free text, nullable.
- `active` — soft-deactivate, the catalog discipline: a deactivated room keeps its history and
  takes no new bookings.
- `created_at` / `updated_at`.

### 3.3 A booking is its own row, attached to exactly one event

The question the task poses directly: is a booking a property of an event, or its own record?

**Its own record**, `firm_resource_booking`, because the two facts genuinely diverge: one event can
occupy several resources (a deposition takes the conference room, the video rig, and the pool car
for the site visit after), and a booking's window is not always the event's window — the room is
booked from half past eight for a nine o'clock deposition because somebody has to set up. Folding
bookings into a `resource_id` column on the event forces one resource per event and one window for
both facts, and both constraints are false.

But a booking is **never freestanding**: every booking belongs to exactly one event (a matter event
or a firm event — two nullable foreign keys, an exactly-one shape check, the participant-kind
idiom). "Book the pool car Friday" with no event is not refused as a use case — it is expressed as a
firm event of the seeded **Reservation** type with the booking attached. One rule ("a room is busy
because something is happening in it") keeps who-booked-it, who-is-going, cancellation, and the
calendar's own read surfaces from being reinvented per booking; a standalone booking would need all
four and answer none. Section 11 flag R3 confirms.

- `id` — `firmResourceBooking_` handle.
- `resource_id` — required foreign key to `firm_resource`.
- `matter_event_id` / `firm_event_id` — nullable foreign keys, exactly one set (shape check).
- `starts_on` / `starts_at_time` / `ends_on` / `ends_at_time` — the event shapes again. Null times
  mean all day (a vehicle taken for the day). **Defaulted from the event at the write, editable per
  booking** — the setup-time case — and never silently re-derived afterward.
- `time_zone` — required IANA identifier, **the resource's zone**: defaulted from the resource's
  office (`location.time_zone`), frozen on the row at the write (the rate-snapshot idiom), so an
  office zone change never silently reinterprets an existing booking.
- `recorded_at` / `recorded_by` / `created_at` / `updated_at`.

**A booking's liveness is derived from its event, never stored.** A booking blocks the room if and
only if its event's status is not `cancelled`. There is no `released` flag and no second write when
an event is cancelled or continued — the room frees itself by derivation, the federation argument in
miniature: a fact that is a join cannot drift from the row it joins. Cancelling an event releases
its rooms atomically and unforgettably, because releasing is not an action at all.

Indexes: `(resource_id, starts_on, id)` — the availability read's filter, sort, and keyset;
`(matter_event_id)`; `(firm_event_id)`.

### 3.4 The overlap model — bounded, zone-honest, off the hot path

Overlap detection is the one place a calendar is tempted to store midnight-as-UTC, and this design
does not. The check runs in two stages, both bounded:

1. **A coarse SQL window** on the civil-date columns: bookings of this resource whose
   `starts_on … coalesce(ends_on, starts_on)` range intersects the candidate's date range widened by
   one day each side. Civil-date text comparison is zone-insensitive to within a day, which is what
   the widening absorbs; the result is a handful of rows for any real resource.
2. **A precise comparison in application code**: each row's wall-clock window resolved through its
   own stored zone (`packages/calendar/src/time-zone.ts`, the package's one piece of calendar
   arithmetic) to instants, then interval intersection. All-day bookings resolve to their civil day
   in their zone.

Because every booking of one resource carries that resource's zone by the write-path rule, stage 2
almost never disagrees with a same-zone text comparison — but it stays correct across the one edge
(an office zone change leaving old rows in the old zone) that a pure-SQL comparison would quietly
get wrong. Statement count per check: one. Rows read: the resource's bookings in a widened window —
bounded by the calendar of one room, not by the firm's data.

### 3.5 Double-booking — refuse, warn, or allow: the verdict

The three postures, argued:

**Refuse** (the booking fails when it overlaps). Feels rigorous; is wrong three ways. First, it
makes the platform adjudicate a fact it does not own — rooms are genuinely double-booked on purpose
(a tentative hold while a deposition date firms up; two small groups sharing the large room; the
partner who bumps the staff meeting). The front desk resolves room conflicts, and a tool that
refuses to record the firm's actual intentions gets worked around with a whiteboard, which is where
availability data goes to die. Second, refusal is only as good as its enforcement, and SQLite has no
exclusion constraint over an interval: the invariant would be application-checked, racing writes
could still slip a violation through, and an invariant the schema cannot hold is a promise the
platform should not make. Third — the malpractice-adjacent case — a hearing's room being taken must
never be a reason the hearing cannot be recorded; the record of the proceeding outranks the tidiness
of the room grid.

**Allow silently.** Records everything, surfaces nothing; the grid lies by omission and the first
collision is discovered in the hallway. Rejected without ceremony.

**Warn and allow, with the conflict visible everywhere — recommended.** The write succeeds and the
response carries the overlaps it created (`conflicts: [...]` — each a booking reference with its
window and its event's deep link, no titles); the availability read marks every overlapping pair;
the booking's own read shows what it collides with. The platform reports what it can see and does
not adjudicate — the overdue-deadline posture applied to rooms, and the same reason: the conflict
may be intentional, already resolved in the hallway, or about to vacate when the continuance is
entered. A per-firm hard-refuse toggle is a named seam (section 10), deliberately unbuilt: it is
firm policy machinery with no owner ask behind it, and the warn posture loses no data a stricter
firm would need.

Section 11 flag R1 confirms the posture.

### 3.6 The availability read

`GET /api/v1/calendar/resources/{resourceId}/availability?from=&to=` — the window required and
capped (the firm calendar's 366-day refusal discipline, same problem type), returning the resource's
live bookings in the window ordered by `(starts_on, id)`, each carrying: the booking window and
zone, the event reference (`matterEvent` | `firmEvent`, id, **kind and type only — never a title**),
whether the booking's event is a matter event the caller would follow into an access-checked read
(ADR-0052: a deep link, and a filtered target is a 404), and the ids of overlapping bookings in the
same response so the grid can paint conflicts without a second request. One statement joined to the
two event tables for status (deriving liveness in SQL), rows bounded by one resource's window.

`GET /api/v1/calendar/resources` lists the catalog (`kind`, `locationId`, `active` filters), for the
picker.

**No privileged content on the grid.** A room's schedule spans every matter; it is exactly the
firm-wide read shape the timeline label rule was written for, and the same rule applies verbatim: a
booking renders from its window, its resource, and its event's kind — "Booked — deposition" — and
the title lives behind the deep link.

## 4. Event links

### 4.1 `calendar_event_link`

The owner asked for relations between events; continuance (section 5) needs a typed, directed,
integrity-checked relation anyway; one table serves both.

- `id` — `calendarEventLink_` handle.
- Four nullable foreign keys — `from_matter_event_id`, `from_firm_event_id`, `to_matter_event_id`,
  `to_firm_event_id` — with a shape check per end (exactly one column set per end). Foreign keys
  rather than the by-value cross-domain idiom because this is the calendar linking to itself:
  integrity is enforceable, so it is enforced. Events are never hard-deleted (cancellation is a
  status), so a link never dangles.
- `kind` — `continuance_of` | `related`. Closed and small, because the engine branches on
  `continuance_of` (chain rules, section 5) and on nothing else; everything a firm means beyond
  that goes in the note rather than a vocabulary the platform would be inventing. `related` is
  undirected in meaning though stored directed; readers render it symmetrically.
- `note` — free text, nullable. "Prep session for the Malloy deposition."
- `created_at` / `recorded_by`.

Indexes: one per end column (four), for "links touching this event" from either side.

### 4.2 The chain constraints — enforced by the schema, not the service

Two hand-written partial unique indexes make a continuance chain a chain:

```sql
CREATE UNIQUE INDEX calendar_event_link_continuance_from_unique
  ON calendar_event_link (from_matter_event_id) WHERE kind = 'continuance_of';
CREATE UNIQUE INDEX calendar_event_link_continuance_to_unique
  ON calendar_event_link (to_matter_event_id) WHERE kind = 'continuance_of';
```

Every setting has at most one predecessor and at most one successor. A hearing continued, continued
again, and continued a third time is a four-node path, walkable in both directions, and the schema —
not a service invariant somebody forgets under concurrency — refuses a fork. Partial indexes are
normal in this lineage (the custody review indexes precedent), and a check constraint additionally
restricts `continuance_of` to matter-event ends (section 5.5).

`related` links carry no structural rules beyond their shape checks; a duplicate `related` link
between the same pair is refused by the service, not the schema, because directionality makes a
schema-level uniqueness statement more subtle than the fact deserves.

## 5. Continuance — the honest model

### 5.1 The correction/continuance line

The owner's direction dissolves slice 1's dichotomy rather than picking the other horn. Both of
these remain true, and they are different operations:

- **A correction is an edit.** The hearing was always on the 14th; somebody typed the 13th. The row
  misdescribed reality; editing it in place is the honest act, the audit row carries the fix, and
  slice 1's mutable-event decision stands for exactly this case. Forcing a compensating row for a
  typo is the thing that makes firms stop recording.
- **A continuance is a new setting.** The court vacated the March hearing and set a May one. Two
  things happened in the world, both are litigation history — a scheduling order, an appearance
  wasted, a speedy-trial clock — and a record that shows only the May setting has falsified the
  March one. Editing the row does not move a hearing; it **unhappens** one.

The platform cannot read intent, so it offers both verbs and documents the line; what it can do is
make the honest verb the easy one, which is what the one-call operation in 5.3 is for.

### 5.2 What the record shows

A continuance produces:

- **The old row, untouched in every historical column.** Its original `starts_on`, its zone, its
  participants, its `recorded_at` — all preserved. Its `status` becomes `cancelled` (true: that
  setting will not occur) and its new nullable `status_reason` says why ("Continued on defendant's
  motion"). `cancelled` is reused rather than a new `continued` status because widening the shipped
  status `CHECK` is a table rebuild (the section 2.1 constraint again) — and because it is
  accurate: what distinguishes a continuance from an outright cancellation is not the old setting's
  status but the existence of a successor, which is exactly what the link records.
- **A new row** — the setting as it now stands: new date, time, zone if the court moved, same type,
  title carried over, participants copied as a fresh replace-set (the same people are expected to
  appear; the caller edits if not).
- **One `continuance_of` link**, new setting → old setting, chain-constrained by section 4.2.

Nothing is hidden, nothing is rewritten, and slice 1's objection to the two-row model — "every
consumer must hide one of two hearings" — turns out to have assumed the old row would still read
`scheduled`. It does not: consumers already render `cancelled` events as cancelled (struck through,
filtered from a "what is coming" view by the existing status filter), so the old setting appears
exactly where it should — as history on the timeline, not as a live hearing on the calendar — with
no consumer changing at all.

### 5.3 The operation

`POST /api/v1/events/{eventId}/continue` — one service call, one atomic effect batch:

1. Refuses if the event is already `cancelled` or already has a successor (the partial index would
   refuse anyway; the service refuses first with a named problem type).
2. Inserts the new event row from the old one plus the caller's new date/time/zone and optional
   overrides; copies participants.
3. Updates the old row: `status = 'cancelled'`, `status_reason` from the caller.
4. Inserts the `continuance_of` link.
5. Composes the audit rows (`calendar.event.continued` on the old id, `calendar.event.created` on
   the new, metadata identifiers only) in the same batch.

The response carries the new event, the old event, and two purely informational lists the person
should see while the order is in their hand: **open deadlines whose `trigger_event_id` names the
continued event** — a lookup, not a cascade; nothing moves; the person decides what a stipulated
briefing schedule does now, because that is a legal judgement and the no-arithmetic position (owner
flag L3, ratified) binds here with full force — and **the old event's live bookings**, which the
status change just released by derivation (section 3.3), so the person can re-book rooms at the new
time if the new time is theirs to book.

### 5.4 The chain as a read

`GET /api/v1/events/{eventId}/continuance-chain` walks both directions from any node — bounded by a
depth cap of 100, a refusal past it — returning the settings in order with dates, statuses, and
reasons: the full procedural history of one hearing, which is the thing the owner asked to be able
to see. Event reads embed the immediate neighbors (`continuedFromEventId`, `continuedToEventId`,
resolved via the link table in the same page's bounded join) so a calendar surface can badge
"continued from Mar 14" without the chain walk.

### 5.5 Scope: continuance is a litigation fact

`continuance_of` links bind **matter events only** (a check constraint on the link table: both ends
of a `continuance_of` are matter-event columns). A moved staff meeting is not procedural history —
nobody litigates the all-hands — so firm events keep slice-1 edit-in-place semantics, and `related`
links remain available across all four end combinations for everything else. The notification
emission point for the operation is the already-declared `calendar.event.rescheduled`, raised — when
notifications wire it — from the continuance write path, which is precisely the "reschedule" that
constant was named for.

## 6. The API surface

Route module `apps/worker/src/routes/calendar/calendar.ts` extended; the two shipped permissions cover
everything — `calendar:read` for every read below, `calendar:manage` for every write. No third
permission: curating the resource list is calendar administration exactly as curating the event-type
catalog is, and slice 1's two-not-four argument was ratified with the rest.

| Route                                                                                                                    | Shape                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/firm-events`                                                                                                | Date-ranged, keyset; `from`/`to` required, 366-day refusal cap; `status`, `kind` filters                                                                                                            |
| `POST /api/v1/firm-events` · `PATCH /api/v1/firm-events/{firmEventId}` · `POST /api/v1/firm-events/{firmEventId}/cancel` | Writes, with the participant replace-set; cancel takes an optional reason                                                                                                                           |
| `GET /api/v1/calendar/events`                                                                                            | **Extended:** gains `scope` = `matter` \| `firm` \| `all` (default `all`); firm events join the merged page via the `firmEvent` source; `memberId` matches participants and `all_members` audiences |
| `GET /api/v1/matters/{matterId}/timeline`                                                                                | Unchanged; the `firmEvent` source contributes nothing to a matter scope                                                                                                                             |
| `GET /api/v1/calendar/resources` · `POST` · `PATCH /{firmResourceId}` (incl. deactivate)                                 | The resource catalog                                                                                                                                                                                |
| `GET /api/v1/calendar/resources/{firmResourceId}/availability`                                                           | Section 3.6; `from`/`to` required and capped                                                                                                                                                        |
| `POST /api/v1/resource-bookings` · `PATCH /{firmResourceBookingId}` · `DELETE /{firmResourceBookingId}`                  | Body names the resource and exactly one event; create and update responses carry `conflicts`                                                                                                        |
| `POST /api/v1/event-links` · `DELETE /api/v1/event-links/{calendarEventLinkId}`                                          | `related` links; `continuance_of` is never written here — only the continuance operation mints one                                                                                                  |
| `POST /api/v1/events/{eventId}/continue`                                                                                 | Section 5.3                                                                                                                                                                                         |
| `GET /api/v1/events/{eventId}/continuance-chain`                                                                         | Section 5.4                                                                                                                                                                                         |

Every mutating route is `audited` and idempotency-keyed through the chokepoint; every mutation
composes its `audit_log` row in the same batch, metadata carrying identifiers only — never a title,
a reason, or a participant name. Deletion of a `related` link is a true delete (a link is an
annotation, not history); everything else follows the status disciplines above.

## 7. UI-facing read shapes (the interface itself stays deferred)

Named so the eventual surface consumes what exists rather than asking for new reads:

- **The one calendar.** Month grid, week view, and agenda are the extended
  `GET /api/v1/calendar/events` with different windows — matter and firm events interleaved by the
  same sort key, `scope` and `kind` narrowing the registry, cancelled settings arriving with their
  status so the surface can strike them through or hide them by its own default.
- **The room grid.** Resources listed once, availability per resource per window, conflicts
  pre-paired in the response (section 3.6). Painting a week of six rooms is six availability reads
  or one per navigation — bounded either way; the surface chooses.
- **The event card.** An event read embeds its participants, its bookings (with conflict marks),
  its links, and its continuance neighbors; the chain walk is a tap away, not pre-loaded.
- **The badge grammar.** `continuedFromEventId` / `continuedToEventId` for "continued from Mar 14";
  `audience: all_members` for the firm-holiday banner; booking `conflicts` for the room warning.

## 8. Notifications — the seam extended, still wired to nothing

`CALENDAR_NOTIFICATION_EMISSION_POINTS` (`packages/calendar/src/notifications.ts`) gains four
entries, same discipline — declared constants in the producing package, no scheduler, no outbox
topic, no delivery, and the notifications registry subscribes to these names when its calendar
wiring lands (its design already binds to this constant by import, which is exactly why the names
live here):

- `calendar.firmEvent.scheduled` / `calendar.firmEvent.cancelled` — firm-event write paths.
- `calendar.firmEvent.rescheduled` — a firm event's date/time edit (edit-in-place, section 5.5).
- `calendar.booking.conflict` — a booking created or moved into overlap; the warn posture's
  delivery-shaped half, so the person who holds the colliding booking can hear about it without
  polling the grid.

A continuance raises the existing `calendar.event.rescheduled`; no new constant. If the
notifications build slice lands first and gives the calendar's existing points outbox topics, the
firm-event and booking paths adopt the identical mechanism in the same commit that builds them —
noted as a merge-order seam in the plan, not a dependency.

## 9. Load profile and measurement

The fixtures corpus gains: a year of firm events (weekly recurring-shaped meetings entered as
individual rows, a handful of `all_members` entries), eight resources across two offices, bookings
with a deliberate overlap fraction, and one hearing continued four times (a five-node chain with
deadlines hanging off intermediate settings).

Assertions, not reports:

1. **The firm calendar page** issues exactly `selectedSourceCount` statements — now including
   `firmEvent` — and stays within `sourceCount × (pageSize + 1)` rows read; page 20 not materially
   slower than page 1.
2. **An availability read** is one statement; rows read bounded by one resource's window.
3. **An overlap check** is one coarse statement plus in-memory comparison; rows read bounded by the
   widened window of one resource.
4. **The continuance operation** is one effect batch; the chain read for the five-node fixture is
   depth-bounded and does not scale with the firm's event count.
5. **The member-filtered firm calendar** (participants + `all_members`) composes predicates in SQL —
   asserted by the existing no-post-filter fitness shape.

## 10. Seams named, not built

- **The calendar user interface** — unchanged deferral; section 7 is its contract.
- **Recurring events** — unchanged (ADR-0055's wall-clock recurrence model when built); a weekly
  staff meeting is entered per occurrence until then, which the fixtures deliberately mirror.
- **A per-firm hard-refuse booking policy** — the warn posture loses no data a stricter firm needs;
  a policy toggle is one write-path check behind a firm setting when an owner asks.
- **Resource approval workflows** (a booking requiring sign-off) — workflow machinery with no ask.
- **A `firm`-anchored visibility overlay** (screening specific firm events) — a new declared anchor
  if ever needed (section 2.4), never a loosening of the matter predicate.
- **External room-panel / calendar sync for resources** — Phase 7 with the rest of calendar sync.
- **Firm-level deadlines** (slice 1's open question 4 — insurance renewals, reconciliation dates) —
  still its own subject; a firm event is a scheduled occurrence, not an obligation with a
  satisfied/vacated lifecycle, and conflating them would bolt deadline states onto meetings.

## 11. Owner flags

Three, all confirmations of recommendations — the scope itself is already owner-directed.

| Flag   | Decision                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **Double-booking posture: warn-and-allow with visible conflicts** (section 3.5) — the platform records intent and reports collisions; it does not referee rooms, and SQLite could not hold a refusal invariant anyway. Confirm; a per-firm hard-refuse toggle stays a named seam.                   |
| **R2** | **Resource kinds as a closed enum** (`room` \| `vehicle` \| `equipment` \| `other`), not a firm catalog — nothing branches on it and `other` absorbs the rest. Confirm, on the understanding that widening the enum is a rebuild-shaped change and `other`-plus-name is the escape valve meanwhile. |
| **R3** | **No freestanding bookings** — every booking hangs off an event; "book the car" is a Reservation-type firm event (section 3.3). Confirm; it is the rule that keeps one cancellation model and one calendar.                                                                                         |

---

# 12. Implementation plan

> **For agentic workers:** implement task-by-task; checkbox syntax for tracking. Each build slice
> leaves `main` shippable. The global constraints of the slice-1 plan
> ([`2026-08-05-case-calendar-implementation-plan.md`](2026-08-05-case-calendar-implementation-plan.md))
> apply verbatim — full names, no process references in source, everything through the firm-scoped
> data-access layer, no naive datetimes, no unbounded reads, nothing computes a deadline date,
> nothing writes "missed", every mutation audited and idempotency-keyed, TDD.

**Goal:** the four owner-directed capabilities on the shipped slice-1 foundation, backend only.

**Architecture:** everything lands in `@magna-carta/calendar` and the existing route module;
five new per-firm tables, one additive column, all migrations additive (no rebuild anywhere —
section 2.1's constraint is honored by construction).

## Migration sketch (one hand-written per-firm migration + generated DDL, snapshot refreshed in the same commit)

```sql
-- firm_event: the firm's own scope. Shapes mirror matter_event; audience is the firm-wide switch.
CREATE TABLE firm_event (
  id TEXT PRIMARY KEY, event_type_id TEXT REFERENCES matter_event_type(id),
  title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', status_reason TEXT,
  starts_on TEXT NOT NULL, starts_at_time TEXT, ends_on TEXT, ends_at_time TEXT,
  time_zone TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'participants',
  location_id TEXT REFERENCES location(id), location_text TEXT,
  recorded_at TEXT NOT NULL, recorded_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  /* CHECKs: status set; audience IN ('all_members','participants'); non-empty title and zone;
     date/time GLOB shapes; ends_on >= starts_on; end time requires start time */
);
CREATE INDEX firm_event_starts_on_id_index ON firm_event (starts_on, id);
CREATE INDEX firm_event_status_starts_on_index ON firm_event (status, starts_on);
CREATE INDEX firm_event_location_index ON firm_event (location_id);

-- firm_event_participant: the matter_event_participant three-shape model, second table because
-- the shipped one's event_id is NOT NULL and additive-only forbids the rebuild.
CREATE TABLE firm_event_participant (
  id TEXT PRIMARY KEY, firm_event_id TEXT NOT NULL REFERENCES firm_event(id),
  participant_kind TEXT NOT NULL, member_user_id TEXT REFERENCES member(user_id),
  entity_id TEXT, participant_name TEXT, role TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  /* CHECKs: kind set + kind-names-a-populated-column shape */
);
CREATE INDEX firm_event_participant_event_index ON firm_event_participant (firm_event_id);
CREATE INDEX firm_event_participant_member_index ON firm_event_participant (member_user_id);

-- firm_resource: rooms, vehicles, equipment. Own table — not Directory (conflicts corpus),
-- not custody_location (custody semantics).
CREATE TABLE firm_resource (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  location_id TEXT REFERENCES location(id), capacity INTEGER, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  /* CHECKs: kind IN ('room','vehicle','equipment','other'); non-empty name; capacity > 0 */
);
CREATE UNIQUE INDEX firm_resource_name_unique_index ON firm_resource (name);

-- firm_resource_booking: window defaulted from the event, zone frozen from the resource's office.
-- Liveness is DERIVED from the event's status — no released flag, no second write.
CREATE TABLE firm_resource_booking (
  id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES firm_resource(id),
  matter_event_id TEXT REFERENCES matter_event(id),
  firm_event_id TEXT REFERENCES firm_event(id),
  starts_on TEXT NOT NULL, starts_at_time TEXT, ends_on TEXT, ends_at_time TEXT,
  time_zone TEXT NOT NULL,
  recorded_at TEXT NOT NULL, recorded_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  /* CHECKs: exactly one of matter_event_id/firm_event_id; date/time shapes; range; end-time rule */
);
CREATE INDEX firm_resource_booking_resource_starts_index
  ON firm_resource_booking (resource_id, starts_on, id);
CREATE INDEX firm_resource_booking_matter_event_index ON firm_resource_booking (matter_event_id);
CREATE INDEX firm_resource_booking_firm_event_index ON firm_resource_booking (firm_event_id);

-- calendar_event_link: typed relations; continuance chain held by partial uniques.
CREATE TABLE calendar_event_link (
  id TEXT PRIMARY KEY,
  from_matter_event_id TEXT REFERENCES matter_event(id),
  from_firm_event_id TEXT REFERENCES firm_event(id),
  to_matter_event_id TEXT REFERENCES matter_event(id),
  to_firm_event_id TEXT REFERENCES firm_event(id),
  kind TEXT NOT NULL, note TEXT,
  recorded_by TEXT, created_at TEXT NOT NULL
  /* CHECKs: exactly one column per end; kind IN ('continuance_of','related');
     continuance_of restricted to matter-event ends */
);
CREATE INDEX calendar_event_link_from_matter_index ON calendar_event_link (from_matter_event_id);
CREATE INDEX calendar_event_link_from_firm_index ON calendar_event_link (from_firm_event_id);
CREATE INDEX calendar_event_link_to_matter_index ON calendar_event_link (to_matter_event_id);
CREATE INDEX calendar_event_link_to_firm_index ON calendar_event_link (to_firm_event_id);
CREATE UNIQUE INDEX calendar_event_link_continuance_from_unique
  ON calendar_event_link (from_matter_event_id) WHERE kind = 'continuance_of';
CREATE UNIQUE INDEX calendar_event_link_continuance_to_unique
  ON calendar_event_link (to_matter_event_id) WHERE kind = 'continuance_of';

-- Additive column: why a matter event is no longer happening (optional; set by cancel/continue).
ALTER TABLE matter_event ADD COLUMN status_reason TEXT;

-- Seed: platform event-type rows for the firm scope (category 'firm', origin 'platform'):
-- Firm meeting, Training, Office closure, Firm holiday, Reservation.
```

## Build slice 2·1 — Firm events

- [ ] Identifiers: `firmEvent`, `firmEventParticipant` prefixes and branded types.
- [ ] Schema + migration + seed rows + snapshot refresh in the same commit; migration-chain test on
      fresh `node:sqlite`; every check rejects its bad case; assert no table rebuild is emitted.
- [ ] `src/firm-event-statements.ts` + `src/firm-event-service.ts`: create, update, cancel (optional
      reason), participant replace-set — the matter-event service shapes parameterized over the
      table, not copied. Zone validated at the write; audience transitions unrestricted.
- [ ] The `firmEvent` timeline source with `visibilityAnchor: 'firm'`; the source contract gains the
      anchor field; the fitness test asserts marker-composition for `matter` anchors and allowlist
      membership for `firm` anchors; matter scope yields no statements.
- [ ] Routes: firm-event CRUD + cancel; `scope` and widened `memberId` on
      `GET /api/v1/calendar/events` (participant-or-`all_members`, composed in SQL); OpenAPI
      snapshot + typed client regenerated.
- [ ] `notifications.ts` gains the three `calendar.firmEvent.*` points (still wired to nothing);
      adopt outbox topics here only if the notifications calendar wiring has already landed on main.
- [ ] Worker integration test: record a firm meeting with two members and an external speaker; an
      `all_members` closure appears on every member's filtered read; a matter timeline never shows a
      firm event; a caller without `calendar:manage` is refused the writes.

## Build slice 2·2 — Resources and bookings

- [ ] Identifiers: `firmResource`, `firmResourceBooking`.
- [ ] Schema + migration + snapshot refresh; check-constraint tests.
- [ ] `src/resource-service.ts`: catalog CRUD, soft-deactivate; a deactivated resource resolves on
      existing bookings and refuses new ones.
- [ ] `src/booking-service.ts`: create (window defaulted from the event, zone frozen from the
      resource's office with an explicit-override path), update, delete; the two-stage overlap check
      (coarse SQL widened one day each side, precise instant intersection through
      `src/time-zone.ts`); responses carry `conflicts` with no privileged content.
- [ ] Liveness derived, never stored: availability joins event status in SQL; cancelling or
      continuing an event frees its rooms with no second write — asserted by test.
- [ ] Routes: resource catalog, availability (window cap as refusal, same problem type as the firm
      calendar's), bookings; `calendar.booking.conflict` declared.
- [ ] Tests: overlap detected across a DST boundary and across an office-zone change (old rows keep
      the frozen zone); all-day against timed; the deliberate-double-booking write succeeds and both
      sides see the conflict; a hearing is recordable when its room is taken.

## Build slice 2·3 — Links and continuance

- [ ] Identifier: `calendarEventLink`.
- [ ] Schema + migration (partial uniques hand-written) + `matter_event.status_reason` + snapshot
      refresh; the partial uniques refuse a fork under direct SQL, asserted.
- [ ] `src/link-service.ts`: `related` create/delete (duplicate pair refused in the service);
      `continuance_of` unmintable through the link routes.
- [ ] `src/continuance-service.ts`: the one-batch operation of section 5.3 — refusals first, copy
      semantics, audit rows (`calendar.event.continued` + `calendar.event.created`), response with
      trigger-linked open deadlines (lookup only — the no-arithmetic scan must stay green) and the
      released bookings.
- [ ] Chain read, depth-capped at 100 with a refusal past it; event reads embed continuance
      neighbors via a bounded per-page join.
- [ ] Routes: event-links, continue, continuance-chain; OpenAPI + client.
- [ ] Load-profile: extend fixtures (section 9 corpus) and assert the five measurements; record the
      firm-calendar statement count now that the registry is fourteen.
- [ ] Documentation, same commits as the code they describe: `packages/calendar/CLAUDE.md` (the
      anchor field, the correction/continuance line, the derived-liveness rule, how to add nothing —
      a booking is not a source), `docs/user/` guides for firm events, rooms, and continuing a
      hearing (no architecture, and an explicit note that continuing never moves a deadline),
      `roadmap.d/calendar.md` evidence lines, `changelog.d/` fragment. Never a rendered tracker.

## Test strategy notes

- **TDD throughout; the slice-1 fitness suite is the spine.** Every new source property lands in the
  table-driven source-fitness pass; the no-date-arithmetic scan must stay green across the
  continuance service (the deadline lookup is a `SELECT`, and the test proves no code path derives a
  date from the new setting).
- **The honest-history property gets its own test:** after a continuance, the old row's historical
  columns are byte-identical to before the operation except `status`, `status_reason`, and
  `updated_at`.
- **Concurrency:** two simultaneous continuances of one event — one wins, one refuses (the partial
  unique is the backstop); two overlapping bookings — both land, both report the conflict.
- **Load-profile assertions are bounds, not wall-clock numbers** (statement counts and rows read),
  per the shipped measurement idiom.
