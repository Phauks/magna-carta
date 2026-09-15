# Calendar — places, people and recurrence

**Status:** Design. Nothing here is built.
**White paper:** _Calendar and rules-based docketing_ · _Directory_ · _Firm profile and offices_.
**Over:** [`2026-09-02-calendar-interface-design.md`](2026-09-02-calendar-interface-design.md), which
settled the component, the screens and the record forms. This spec settles the four model questions
that round left open, all four raised by the owner on 2026-09-14 and recorded as rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md).

## What this settles

Four questions, in the order their answers depend on each other:

1. **Where a setting is held** — an office, a room inside one, a place in town, or a meeting link.
2. **Who is at it** — correcting participants after the fact, and adding several at once by what
   they are rather than one name at a time.
3. **When it repeats** — recurrence.
4. **What zone its end is read in** — today a record has one zone; the owner asked for two.

Each is a slice that ships on its own. They are one spec because they touch the same two tables and
the same two forms, and building them blind to each other would cost the schema twice.

## What already exists, and is not the problem

The owner's words were "location and booking a room seem duplicative of what should be the same
functionality", which read as a missing model. Most of the model is there:

- `location` is the office: it carries `address_block`, `time_zone`, `jurisdiction` and
  `number_code`. Offices are already distinct addresses.
- `firm_resource.location_id` already points a room at the office it is in. "Office 1, Room 1" is
  already expressible; nothing displays it that way.
- `firm_resource_booking` already holds a resource for an event's window, with conflicts paired at
  read time.
- The join between the two — a setting whose location names one of the firm's rooms now books it —
  landed on 2026-09-14 ([`room-location.ts`](../../apps/web/src/lib/calendar/room-location.ts)).

So the location work is three narrow gaps, not a rebuild. They are stated as such below.

## 1 · Where a setting is held

### 1.1 A room's name is unique to its office, not to the firm

`firm_resource_name_unique_index` is unique on `name` alone. A firm with two offices cannot call a
room in each of them "Conference Room 1" — which is exactly the shape the owner described: "Office
1, Room 1; Office 2, Room 2. Where offices are distinct addresses, but rooms are not."

**Change.** Replace the index with a unique index on `(location_id, name)`. Rooms with no office
(`location_id IS NULL`) stay unique among themselves: SQLite treats NULLs as distinct in a unique
index, so a bare `UNIQUE(location_id, name)` would let a firm create two unassigned "Boardroom"s.
Use a generated column or the `COALESCE(location_id, '')` expression index so the null case is one
value rather than many.

**Migration.** Additive index swap, no data change. A firm that already has two rooms of the same
name cannot exist (the old index forbade it), so nothing needs reconciling on the way in.

### 1.2 A room is displayed by its office

The picker groups every room under one "Rooms" heading. Once 1.1 lands, two rooms can share a name
and the heading stops distinguishing them.

**Change.** `location-picker.svelte` groups rooms under a heading per office — the office's own name
— with rooms assigned to no office under a final "Rooms" heading. What the picker WRITES stays the
room's own name where the firm has one office, and the qualified `"<office> — <room>"` where it has
more than one. `roomForLocation` matches either spelling, so a location recorded before this lands
still books its room.

**Why the qualified name and not an identifier.** The column stays free text, for the reason it
always was: a courthouse, a department number and opposing counsel's address are none of them
records this product holds, and a foreign key here would have to decide what a location means.
Qualifying the text is what makes it unambiguous without making it a reference.

### 1.3 A meeting link is a place a setting can be held, and it can run out

The owner: "An activity may be on zoom or in person. Zoom/Google Meet may also be valid locations
that need to have prescribed times, as people have different licenses."

A firm has a finite number of concurrent meetings its licences allow. That is exactly what a
bookable resource models — a thing that can be held for a window and double-booked — except that a
room holds one setting at a time and a licence pool holds N.

**Change, in two parts.**

- `firm_resource.kind` gains `meetingLink`. It is a place a setting is HELD, so it appears in the
  location picker beside the rooms, under its own "Meeting links" heading.
- `firm_resource` gains `concurrent_limit`, an integer, null meaning one. A room is one. A Zoom
  account with five host licences is five. The availability read already pairs overlapping
  bookings; what changes is the threshold at which an overlap becomes a CONFLICT — today any
  overlap, after this any overlap beyond `concurrent_limit`.
- `firm_resource.notes` is where the URL goes today by convention. It should be its own column,
  `join_url`, so the entry window can offer the link rather than a reader copying it out of a note.

**What it deliberately does not do.** It does not create the meeting, hold a real licence, or talk
to Zoom or Google. It records the firm's own count of what it has and warns when the calendar
exceeds it. An integration is a separate subsystem and is not proposed here.

**Interaction with the existing conference-link field.** `matter_event.conference_url` stays: a
setting can be in a room AND on a call, which is why the two fields were separated in the first
place. Where the location names a meeting-link resource, the event's `conference_url` is filled from
that resource's `join_url` if it is empty, and left alone if the person typed one.

## 2 · Who is at a setting

### 2.1 Participants are editable after the record exists

The entry window's Edit deliberately never re-sends participants
([`entry-updates.ts`](../../apps/web/src/lib/calendar/entry-updates.ts)): "a window that did not
touch who is at a setting cannot change it". That was a safety property when the window had no
participant control. It is now the reason there is no way to add somebody to a setting already
recorded, which the owner hit directly.

**Change.** The entry window's record pane gains the same `participant-picker.svelte` the record
forms use, and `entry-updates.ts` sends participants only when the pane actually edited them — a
dirty flag on the participant list, not an unconditional include. The invariant survives in the form
that mattered: a correction that did not touch participants still sends none.

**Contract.** `PATCH /api/v1/matters/{id}/events/{eventId}` and the firm-event equivalent take an
optional `participants` array. Present means "these are the participants now"; absent means "leave
them". The service replaces the set rather than diffing, because the client holds the whole list and
a diff protocol here buys nothing.

### 2.2 People are added by what they are, not one name at a time

The owner: "We need to make it so it can be easy to add individuals based on tags 'Attorney's',
'All', 'Partners', 'those assigned to a specific case'. We need to allow setting these custom tags
or attributes."

Two kinds of group, and they are not the same thing:

- **Derived groups**, which the firm already knows and cannot get wrong: everyone; everyone holding
  a given role (the roles the firm handed out, which the calendar rail already reads); everyone
  assigned to a named matter (`matter_assignment`). These need no new storage — they are queries
  over records that exist.
- **Firm-defined tags**, which are the owner's "custom tags or attributes": a named set a firm
  curates. These need storage.

**Model for the second.** `member_tag` (id, name, active, timestamps) and `member_tag_member` (tag
id, member user id), both per-firm. A tag is a catalog entry on the same soft-deactivate discipline
as event types and resources: retiring one keeps its history.

**Interface.** The participant picker gains a second mode: instead of a person, choose a group. A
chosen group EXPANDS to its members at the moment it is chosen, and the participants recorded are
the people. The set is not stored as "the Partners tag" — it is stored as the partners who were
partners that day.

**Why expansion and not a stored reference.** A setting is a record of who was expected at it. If a
paralegal joins the firm in March, they were not expected at January's hearing, and a stored
reference would rewrite that. The same reasoning as the matter's own party list. The cost is that
changing a tag does not update past settings, which is the correct behaviour rather than a
limitation.

**Where tags are edited.** Settings › Practice, beside the event types and the resources, which is
where the firm's other catalogs live.

## 3 · Recurrence

The owner: "We need ability to add ability for recurring events."

### 3.1 The rule, and where it lives

`matter_event` and `firm_event` each gain `recurrence_rule`, free text holding an RFC 5545 `RRULE`
(`FREQ=WEEKLY;BYDAY=TU;COUNT=12`), null on a one-off. The standard is used because it is the one
every calendar product reads and writes, and a firm exporting its calendar should not have this
product's private dialect in it.

### 3.2 Occurrences are expanded, not stored

A recurring setting is ONE row. The reads expand it across the window they were asked for. Storing
an occurrence per date would multiply a weekly status conference by fifty-two before anybody looked
at it, and the window a calendar reads is at most a year (the existing cap).

**Where the expansion happens.** In the timeline source's projection, not in SQL: an `RRULE` is not
a predicate SQLite can evaluate. The source reads the recurring rows whose rule could touch the
window (start on or before the window's end, and no `UNTIL` before its start), expands each in
TypeScript, and emits one entry per occurrence. The page ceiling already in the read plan is what
bounds a pathological rule.

**Identity of an occurrence.** `<eventId>@<occurrence date>`. It is not a record id and nothing
writes to it; the grid's `recordKeyOf` already strips a suffix for the day view's per-lane copies
and takes this the same way.

### 3.3 Correcting or cancelling one occurrence

The hard half, and the reason this is a spec rather than a column.

- **Correcting the series** edits the one row. Every occurrence moves.
- **Correcting one occurrence** writes an EXCEPTION: a real `matter_event` row carrying
  `recurrence_parent_id` and `recurrence_occurrence_on`, which the expansion skips when it emits
  that date. So an exception is an ordinary event that happens to know what it replaces, and every
  read that already understands events understands it.
- **Cancelling one occurrence** is an exception whose `status` is `cancelled` — which is why the
  exception is a row rather than an exclusion list. A vacated occurrence stays visible and struck,
  which is the standing rule.
- **Cancelling the series** sets the parent's status; its exceptions keep their own.

**The form asks which.** Editing an occurrence of a recurring setting asks "this occurrence" or "the
whole series" before it commits, because guessing wrong is a firm's calendar quietly moving.

### 3.4 What is deliberately out

No `RRULE` a person cannot read back: the form offers daily, weekly on chosen days, monthly by date,
monthly by weekday, and yearly, with an end after N or on a date. A firm that pastes a raw rule is
not a case this serves. Nothing here generates deadlines — a recurring event is not a docketing
rule, and rules-based docketing is its own subsystem.

## 4 · A setting's end has its own zone

The owner: "they may start and end separately."

`matter_event.time_zone` and `firm_event.time_zone` are one column each, and
[`record-timing-fields.svelte`](../../apps/web/src/lib/calendar/record-timing-fields.svelte) asks
once because of it.

**Change.** Add `end_time_zone`, nullable, null meaning "the same as the start" — so every existing
row is already correct and nothing backfills. The form asks a second zone only when an end date or
time is set. The projection carries both; the grid keeps placing by the civil day and the wall clock
in the row's own zone, unchanged, because a block on an hour axis is drawn in ONE zone and the
start's is the one it is drawn in.

**What it is for.** A deposition that starts in Denver and ends in Chicago is not the case; an
overnight flight, a hearing that runs past midnight into another zone's day, and a multi-day trial
whose venue moves are. The honest reading is that the END is stated where the end happens.

**What it must not do.** It must not tempt anything into deriving a duration across two zones. The
day and week grids size a block from `startMinute` and `endMinute` in the row's own zone
([`time-placement.ts`](../../packages/design-system/src/lib/components/calendar-grid/time-placement.ts));
where the two zones differ, the end minute is the end's wall clock converted into the start's zone
for LAYOUT ONLY, and the displayed end time keeps its own zone's words. This is the one conversion
in the calendar, and it exists so a block's height is a real length rather than a number from two
different clocks.

## Test plan

Every decision above is settled in a pure module and asserted without a browser, which is this
area's standing rule.

- **Places.** `roomForLocation` over a qualified name, a bare name, a renamed office, a room with no
  office, two offices with the same room name, and a meeting link — the last of which books but is
  not a room. The concurrency ceiling: N bookings are not a conflict, N+1 is.
- **People.** Group expansion: everyone, a role with nobody in it, a matter with no assignments, a
  retired tag, a member who holds two of the chosen tags (once, not twice). The dirty-participant
  rule: a correction that did not touch participants sends none.
- **Recurrence.** Expansion over a window that starts mid-series, a rule with `COUNT` exhausted
  before the window, a rule with `UNTIL` inside it, an exception that moves an occurrence out of the
  window, an exception that moves one in, a cancelled occurrence, and a series cancelled with a live
  exception. Daylight saving: a weekly 9am setting is 9am on both sides of the change, because the
  expansion is over civil dates and never over instants.
- **Zones.** An end with no zone reads as the start's. An end in another zone lays out by its
  converted minute and prints its own words. A block whose end converts to before its start is read
  as a point, which is the rule `timeSpanOf` already applies.

## Order of build

1. **Places** (1.1, 1.2) — narrow, and the picker is already half of it.
2. **Participants editable** (2.1) — the owner's reported defect; no new storage.
3. **A setting's end zone** (4) — one nullable column, one form question.
4. **Groups and tags** (2.2) — new storage and a settings surface.
5. **Meeting links** (1.3) — new kind, new column, and the conflict threshold changes with it.
6. **Recurrence** (3) — the largest, and the one that should land alone.

Nothing in 2 through 6 blocks 1, and each ships a working calendar.
