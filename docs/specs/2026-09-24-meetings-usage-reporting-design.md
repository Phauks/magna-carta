# Meetings usage and quality — how much the firm meets, and how the connections held

**Status:** Design, 2026-09-24. Not built.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — the meeting record, the attendance row per stay, the signaling room, and the diagnosability section as built (the `meetings.room.*` event family, the browser's connection report, the operator's inspect call, the load harness). Everything it settles stands; this design reads what that one records and adds one small table beside it.
**Beside:** [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) — a guest's stay is a row in its own table and is counted here, never named. [`2026-09-07-report-screen-design.md`](2026-09-07-report-screen-design.md) — a report is one registry entry plus one presenter. [`2026-08-31-tabular-export-rendering-design.md`](2026-08-31-tabular-export-rendering-design.md) — the export seam the report rides.
**White paper:** _Reports_; _Communications layer_; _Observability & diagnostics_.
**Ledger:** the `meetings.usage-reporting` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md) — "How much the firm meets, by member and matter, and how the connections held up — in Reports and Firm Usage", `not-started`, "attendance rows exist, no report reads them".

## 1. What this settles

A firm asks two questions of its meetings once it has been holding them for a while: how much of its time goes into them, and whether the product held up while it did. The first is a question about the record — who was in which room, for how long, on which matter. The second is a question about connections, and the platform has so far refused to keep anything about a connection beyond the browser tab that measured it. This design answers both without moving that line for any one person.

Seven decisions carry it, and the rest follows from them.

1. **Minutes are the attendance record's.** The firm's own `meeting_attendance` and `meeting_guest_stay` rows are exact to the millisecond, per firm, and already the one definition of "in the room" the ceiling is counted over. Cloudflare's Realtime bill is the platform's cost, per account, in gigabytes, and never appears on a firm's report (section 3).
2. **Computed on demand, paged by meeting, and no rollup of figures.** A twelve-month report at the stress fixture is a handful of round trips to the firm's database, and the reporting package's standing rule that nothing is materialised holds. Two additive partial indexes on `meeting` are the whole of the schema relief (section 4).
3. **The day is the firm's day.** Days and the period's edges are read in the zone of the firm's default office — the resolution the notification digest already makes — and in UTC, stated on the report, where a firm has none. A stay that crosses a midnight is split at that midnight, so the days sum to the period (section 5).
4. **Connection quality comes only from what the firm owns.** The attendance record's own departures (a stay closed because its connection was lost) and a per-meeting tally the room writes into the firm's database: counts of connection reports by verdict, reconnections and routing-service refusals, with no person on any row. Nothing is read from Analytics Engine, which carries no firm and must not (section 6).
5. **Never on a report:** a guest's name, typed or invited; the Directory entity behind a guest link; an event's title; anything said in chat; and any connection measurement tied to one person. Quality is shown for the firm and by medium only, never per member or per matter, and is withheld when fewer than five people were in meetings in the period.
6. **Two surfaces, two existing keys.** The Meetings Usage report in Reports on `reports:operational`; a Meetings section on Firm Usage, over the last thirty days, on `tools:firmUsage`. No new permission (section 9).
7. **One fold, one read.** The SQL is `@magna-carta/meetings`' (the package that owns the tables); the aggregation is a pure function in `@magna-carta/reporting` (the projection layer); both surfaces call the same assembly, and the report's CSV is the report screen's own export path (section 10.3).

## 2. What is counted, exactly

Every figure below is derived from one quantity, the **in-room interval** of a stay, so the report cannot hold two definitions of presence.

- **When a stay entered the room.** A member's stay that never waited entered at `joined_at`; one that waited entered at `admitted_at`; a guest's stay always waited and entered at `admitted_at`. A stay that waited and was never admitted was never in the room and contributes nothing — time at the door is not time in a meeting. This is the same distinction `IN_THE_ROOM_PREDICATE` and `GUEST_IN_THE_ROOM_PREDICATE` draw in `packages/meetings/src/meeting-statements.ts`, and the expression that yields the entry instant is added to each entry of `MEETING_STAY_TABLES` beside those two sentences, so a third kind of stay cannot be added without saying when it enters.
- **When it left.** `left_at`; for a stay still open, the meeting's `ended_at` (a stay the ending somehow did not close counts to the ending, never past it); for a stay open in a live meeting, the instant the report is computed. The last case is why the report is live (section 7).
- **Clipped to the window.** Each interval is intersected with the report's window of instants, `[startsAt, endsBefore)`. Only the overlap counts.
- **Participant time** is the sum of the clipped intervals over every stay: two people in a room for an hour is two hours. It is the figure that divides by member.
- **Meeting time** is, per meeting, the length of the union of its clipped intervals — the time anybody was in the room — so two people in one room for an hour is one hour, and a gap when the room stood empty is not counted. It is the figure that divides by matter.
- **A meeting held in the window** is a meeting with at least one clipped interval of positive length. A meeting that ran across a boundary is held in both windows; the meeting count therefore does not sum across adjacent periods or across days, and the report says so where it prints one. Participant and meeting time do sum.
- **Members** are distinct `user_id`s with in-room time. A member who dropped and came back holds two stays and is one member.
- **Guests** are counted two ways and named neither: guest arrivals (admitted guest stays) and guest links used (distinct `invitation_id` among them). A link is the only identity the record has for a guest, so an organization's link used by two of its people is one link — the report says "links", not "people", for that reason.
- **Medium** is `meeting.medium`, chosen at start and never changed, so every stay in a meeting has one medium.
- **Matter** is the event's: a matter event's matter, and for a firm event the bucket **Firm Events**. The meeting read composes the visible-matter predicate as a required argument, exactly as every other meeting read does.

Every duration travels as an integer count of **milliseconds**. The agreement tests (section 13) compare integers, and a decomposition that has been rounded cannot be proved to equal its total. Minutes and hours are a formatting of the payload, applied on the screen and in the file.

## 3. Minutes: the record, not the bill

Two sources could claim to say how much a firm met, and they measure different things.

**The attendance rows** say who was present, and when, in the firm's own database, per stay, to the millisecond, written through the firm-scoped data-access layer in the same batch as the audit row of each arrival and departure. They are the record the firm would produce if asked who attended a meeting, and they are already the one definition the room's ceiling is counted over.

**Cloudflare's Realtime bill** says how many gigabytes the selective forwarding unit and the relay moved. It is one figure per Cloudflare account, and the whole fleet's meetings share one Realtime application — the meetings design records that the room is the only thing that knows which meeting a session belongs to — so there is no per-firm line on it to read. Even per session it would be the wrong unit: bytes depend on the medium, on how many tiles each browser shows, on which simulcast layer each tile pulls, and on whether a relay was needed, none of which is how much the firm met. An hour-long call and a ten-minute gallery of sixteen cameras can cost the same.

So the two do not reconcile row to row, and the design does not pretend they do. **The report is the firm's own record, and it says so**: its stamp carries a sentence that the minutes are measured from who was in the room, as the meeting record holds it, and are not a bill. The reconciliation that does exist is the platform's, not the firm's: the fleet's participant time by medium, multiplied by the per-participant-hour rates in section 12, should track the Realtime line on the invoice, and a drift between the two is an operating-cost question for the platform (a relay in use more than assumed, a layer choice that pulls more than modelled). That comparison is an operator's arithmetic over the invoice and a fleet total; it appears on no firm's screen, because a firm is not billed in gigabytes and a figure it cannot act on would be read as a charge.

## 4. On demand, and why no rollup

### 4.1 The walk

The report reads the stays of the meetings that overlap its window, in pages, and folds them.

- **The unit of a page is a meeting, never a stay.** A page is up to `MEETINGS_USAGE_PAGE_MEETINGS = 500` meetings, keyset-ordered by `(started_at, id)`, and the one statement that reads it returns every stay of exactly those meetings — both stay tables, `UNION ALL`, the `listAttendance` shape — ordered by meeting and then by entry instant. A meeting's stays are therefore never split across pages, so the fold's per-meeting state (the union that yields meeting time) never crosses a page boundary, and a page is a pure function of its rows.
- **The page's meetings are a keyset-bounded subquery the stay read joins against**, not a list of identifiers bound into an `IN`, so the statement's bound-parameter count does not grow with the page and no platform binding ceiling is approached.
- **Two sets of meetings overlap a window**, and the walk reads both. Those that started inside it (`started_at` in `[startsAt, endsBefore)`) are the ordered walk. Those that started before it and still had somebody in the room at `startsAt` — a meeting running across midnight on the first day, or one still live — are the **carry-in**, read once, first, as the first page: meetings that started before the window and either ended at or after `startsAt` or have a stay open or closed at or after it. The carry-in is small by construction, and it is the one part of the walk whose cost grows with history rather than with the period, which is why it is measured on its own (4.2).
- **Every row the read returns carries its captions**: the member's current display name (the `listAttendance` join), and the matter's title and number through the event. Names are captions, not figures, and are as they stand when the report is computed; the handle travels beside each one, on the reporting package's standing rule.

Two additive partial indexes on `meeting` are the whole of the schema change the read needs: `meeting_started_at_index ON meeting (started_at, id) WHERE started_at IS NOT NULL`, which makes the ordered walk a range scan that already arrives in keyset order rather than a scan and a sort per page, and `meeting_ended_at_index ON meeting (ended_at) WHERE ended_at IS NOT NULL`, which serves the carry-in's ended arm. Both are additive and rebuild nothing. The stay side needs nothing new: `meeting_attendance_meeting_user_index` and `meeting_guest_stay_meeting_left_at_index` both lead on `meeting_id`.

### 4.2 The scale it is measured at

The load profile has no meetings today — the calendar volume in `packages/fixtures/src/load-profile/profile.ts` lays down events, and nothing hangs a meeting from them. This slice adds a `MeetingsVolume` to the profile and a generator beside the calendar's, on the profile's rule that every count is a parameter and changing one bumps the version:

| Parameter               | Local scale (multiplier 1) | Why                                                                                                                                                                                                                |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meetingCount`          | 2,400                      | About the number of events the calendar volume lays down (400 matters at up to twelve settings each, the probe matter and the weekly firm meetings), one meeting per event, which is the ceiling the schema allows |
| `staysPerMeeting`       | 2 to 8                     | A client meeting, a deposition, a staff briefing                                                                                                                                                                   |
| `probeMeetingStayCount` | 300 plus reconnections     | The tail: a room at the ceiling, with a tenth of it dropping and returning, so one page carries the largest meeting the product admits                                                                             |
| `reconnectFraction`     | 0.1                        | Stays closed `socket-lost` and followed by a second stay of the same member                                                                                                                                        |
| `waitedFraction`        | 0.15                       | Stays that waited; a fifth of those never admitted, so the door arm is exercised                                                                                                                                   |
| `guestStayFraction`     | 0.1                        | Guest stays through `meeting_guest_stay`, some from one organization link used twice                                                                                                                               |
| `audioFraction`         | 0.3                        | Calls beside video meetings, so the medium split is a real branch                                                                                                                                                  |
| `abandonedLiveFraction` | 0.02                       | Meetings nobody ended — the room never ends one by itself, so these stay `live` forever with every stay closed, and the carry-in must not grow with them                                                           |
| `tallyFraction`         | 0.9                        | Meetings with a connection tally; the rest are the "not reported" arm                                                                                                                                              |
| `spanDays`              | 730                        | Two years, dense at the recent end, on the calendar volume's pattern                                                                                                                                               |

That is about 12,000 stays at local scale and, at the stress multiplier of three, about 7,200 meetings and 36,000 stays. **These are estimates derived from the profile's parameters, not measurements.** The measurement follows the reporting set's precedent in `packages/fixtures/src/load-profile/reports-measurements.ts`: every read at **one month and at twelve**, because how the cost grows with the period is the point, plus the thirty-day Firm Usage window, recording pages walked, rows returned, and the `EXPLAIN QUERY PLAN` of the page statement and of the carry-in. The plan must show the ordered walk on `meeting_started_at_index` without a temporary sort and the stay side on the two `meeting_id`-leading indexes. The wall time is a fact about the machine; the counts are the result.

At the derived figures, a twelve-month report at the stress multiplier walks about 3,600 meetings — eight pages — and returns about 18,000 stay rows. That is eight round trips to the firm's database object, which is the number the page size is chosen against: a round trip from the request's Worker to the firm's object is the unit cost here, not the rows. The Firm Usage window is one page.

### 4.3 Ceilings, and a refusal rather than a short answer

On the reporting package's rule that a section which came back short is a refusal, never a short section:

- **The period** is at most 366 days. Longer is refused `reporting-period-exceeds-read-budget` with the remedy — produce it in parts — in the message.
- **The stays** a report may fold are capped at `MAX_MEETINGS_USAGE_STAYS = 100,000`. The walk counts as it goes and refuses with the same code the moment the count passes the cap; it never returns totals over the part it read. The number is set by the measurement and stated in one place.
- **The matter rows** a report may carry are capped at `MAX_MEETINGS_USAGE_MATTERS = 5,000`, refused the same way, because the document is returned whole.

Both caps are far above the stress fixture's twelve-month figures, which is what a ceiling is for: the point at which a firm's volume has outgrown the shape, announced by name.

### 4.4 When a rollup would be considered

The reporting package's invariant is that nothing is materialised — no rollup table, no cached total — and this design keeps it. A rollup was considered and is not proposed: a per-meeting or per-day summary written at the meeting's end would be a second answer to "how long was this person in this room", free to disagree with the stays it summarised the first time a stay was closed late by the grace sweep, and it would have to be written by a room that does not always end (an abandoned meeting is never ended). The walk pages; that was the condition. It would be reconsidered only if the stress measurement, after the page size is tuned, still could not complete a twelve-month report inside a Worker request's limits — and then the first remedy is a denormalization of an immutable column onto the stay (the meeting's `started_at`, so a stay-side index can drive the window), on the precedent the reporting package already names for the ledger, before any stored figure. Either would be a decision recorded in its own right.

**The connection tally of section 6 is not a rollup.** It is the only record of a fact nothing else keeps; no row anywhere could re-derive it.

## 5. Days and zones

A period is two civil dates, and a day is a day in a place ([`docs/conventions/dates.md`](../conventions/dates.md)). The server has no zone of its own to read one in, and three candidates were weighed.

- **The reader's zone**, sent by the browser, was rejected: two members of one firm asking for September would get different totals, because the period's edges would move with each of them, and a report is a document two people must be able to compare.
- **Each event's own zone** was rejected: a stay would fall on a day in one place and the period's edge in another, and the days would not sum to anything.
- **The firm's zone** is taken: the zone of the firm's default office, resolved from the firm's default-location setting (`firmDefaultLocationDefinition`) and that location's `time_zone`, which is exactly the resolution the notification digest makes in `resolveFirmDigestZone` (`packages/notifications/src/settings.ts`) — where the comment already states the reason: a second copy of where this firm is would eventually disagree with the one the calendar books against. That function is given a neutral name in the same file, `resolveFirmZone`, which the digest's resolver then calls, so there is one resolver with two callers rather than a report importing a function named for a mail. Where a firm has set no default office, or the office predates the zone column, the report reads days in **UTC** and says so — the digest's own posture: stated, never substituted in silence.

The route turns the period into the window once: `startsAt = instantForCivilDateTime(periodStart, "00:00", zone)` and `endsBefore = endOfCivilDayInstant(periodEnd, zone) + 1`, both from `@magna-carta/civil-time/time-zone`, then clipped at the instant the report is computed so a period ending today counts nothing that has not happened. The fold receives the window and the zone, never the civil dates alone, and computes the day starts with the same function — so the spring day of a daylight-saving zone is twenty-three hours long, the autumn day twenty-five, and a zone whose clocks change at midnight (`America/Santiago`) starts its day when the clock reached it, which is what `instantForCivilDateTime` already resolves a skipped wall clock to. An interval that crosses a day start is split at it, so **every day's participant time and meeting time sum exactly to the period's**, which is an agreement test (section 13).

The response carries the zone and where it came from (`timeZoneSource: "firm-default-office" | "platform"`), and a `dayBoundaryStatement` the screen prints under the stamp: _"Days are read in America/Los_Angeles, the zone of the firm's default office."_ or _"The firm has no default office with a time zone, so days are read in UTC."_ A day is printed with `formatDate` — it is a civil date the server computed in the firm's zone, which is exactly what that formatter is for, and never `formatInstantDate`.

The Firm Usage section's window is **the last thirty days as instants** — `[computedAt − 30 days, computedAt)` — which needs no zone at all, because two instants compare the same everywhere. It carries no days.

## 6. Connection quality

### 6.1 What the telemetry carries, and why none of it reaches a firm's report

The meetings telemetry is rich. `meetings.room.clientReport` carries, per accepted browser report and per stay, the verdict (`good`, `fair`, `poor`, `unknown`), the round trip, the loss fraction, the jitter, the outbound layer and the inbound count; `meetings.room.refused` carries every refusal's closed reason and Error ID; `meetings.room.superseded`, `socketLost`, `swept` and `joined` carry the reconnection story; every one of them is correlated by firm, meeting and stay (`packages/telemetry/src/events.ts`). It is exactly what an operator reads when a firm says the meeting broke.

**None of it can be a firm's report, and the reasons are structural rather than a preference.**

- **Events are log lines, not a dataset.** `logger.log` writes one structured line to Workers Logs (`packages/telemetry/src/workers-logger.ts`); only counters reach Analytics Engine. There is no per-firm query over the event stream, and its retention is the log pipeline's, measured in days, not the firm's record's.
- **Analytics Engine carries no firm, by rule.** A counter's dimensions are declared, enum-like labels, "never identifiers, never free text" (`packages/telemetry/src/metrics.ts`, and the telemetry package's own notes, which add: never filter that dataset to a single firm; per-firm analytics belong to the deferred Iceberg tier with small-cell suppression). A `firmId` dimension is refused, and an HMAC of one is still an identifier. So what Analytics Engine can aggregate per firm is, and will stay, **nothing**.
- **The stream is lossy by design.** Several events are sampled (the storage budget, one budget refusal in twenty), the emitter swallows its own failures so a meeting never ends over a log line, and a report built on it would silently under-count exactly when the platform was struggling — the moment the figure is wanted.

### 6.2 The tally — the one new record, and what is on it

So the firm-level figures come from two places the firm owns.

**From the attendance record, with nothing new written.** A stay closed with `ended_reason = 'socket-lost'` is a connection that dropped and did not come back inside the room's one-minute grace; a later stay of the same member in the same meeting is that person coming back. Both are already on the record, in both stay tables, and the fold counts them: **dropped connections**, and **of which the person returned**.

**From the room, a per-meeting tally.** The room already accepts one connection report per participant per five seconds and writes it onto the participant's stored record (`acceptClientReport` in `apps/api-worker/src/meetings/room/room-diagnostics.ts`). The tally adds four counters to that same record — reports by verdict — bumped **inside the write that already happens**, so a report costs the room no extra storage operation. When a participant leaves (the leave route, the grace sweep, a removal), their counters are added into one room-level tally key, in the write the departure already makes; a supersede and a `sfu-unavailable` refusal each add one to the same key. When the room empties, and when the meeting ends, the room writes the tally into the firm's database and starts a fresh segment.

```
meeting_connection_tally
  id                text pk        -- meetingConnectionTally_ handle, minted by the room when the segment opens
  meeting_id        text not null -> meeting.id
  opened_at         text not null  -- instant the segment's first counted fact arrived
  closed_at         text not null  -- instant the room wrote it
  good_reports      integer not null default 0
  fair_reports      integer not null default 0
  poor_reports      integer not null default 0
  unknown_reports   integer not null default 0
  reconnects        integer not null default 0   -- a socket taken over by the same stay's newer one
  routing_refusals  integer not null default 0   -- `sfu-unavailable` refusals the room sent
  created_at        text not null
  CHECK every count >= 0;  CHECK closed_at >= opened_at
  INDEX (meeting_id)
```

- **No person is on any row.** There is no attendance column, no user column, no guest column and no per-person count: a segment is the whole room's. It therefore has no personal-data column and no entry in `packages/data-access/src/pii-registry.ts`, which registers only tables that hold one.
- **Only refusals about the connection are counted.** `sfu-unavailable` is the routing service failing the member, and a supersede is a browser that came back inside the grace. Every other reason in `MEETING_REFUSAL_REASONS` — a malformed frame, a foreign track name, a picture offered into a call, a frame over budget — is about what a browser asked for, not about how its connection held, and is left to the operator's stream.
- **The row's id is the flush's idempotency.** The insert is `INSERT OR IGNORE` on the primary key (`fitness:unguarded-write` — a zero is a retried flush that already landed). A flush attempt, whatever its outcome, closes the segment: new counts go to a new segment with a new id, and an unacknowledged one is kept as it stands under a pending key and retried unchanged at the next flush. So a retry can never drop increments that arrived after the first attempt, and never double-count one that landed. A pending segment is kept beside the ended marker when a meeting ends and retried once when the alarm retires the marker; after that it is lost, and the meeting reads as **not reported** (section 8), which is the honest label for it.
- **Written through the firm-scoped data-access layer by the room**, on the exact precedent of the grace sweep's `closeStay` (`firmDatabaseFor` and `commitEffectBatch` in `room/room-lifecycle.ts`), composed by a `tallyConnectionSegment` service in `@magna-carta/meetings` returning an effect with no audit row — it records no act of a person, and an audit row per room segment would fill a matter's log with the mechanics of a connection, which the subsystem has been careful never to record. The write sits in a new concern module, `room/room-connection-tally.ts`, that nothing may throw out of, on the diagnostics module's rule.
- **It is a figure about coverage as much as quality**, and the report prints both: how many meetings held in the window have a tally, and how many do not (a meeting before this slice, a room that could not write, a lost pending segment). A quality share over the meetings that reported is never presented as the firm's whole.

This changes one sentence the product has already said to members. The meetings guide's **Connection quality** section says that nothing about a connection reaches the meeting's own record. After this slice, a count of verdicts across everybody in the room is kept beside the record, never whose; the guide's sentence is rewritten to say exactly that in the same commit (section 14), and the room-diagnostics comment that says how somebody's connection behaved never reaches the record stays true word for word — no somebody is on the tally.

### 6.3 What never appears

Structural, not a rule to remember. The report's two reads are `@magna-carta/meetings` statements whose column lists are pinned by a source-scan test (the digest renderer's precedent in `@magna-carta/notifications`): they select no `confirmed_name`, no `invited_name`, no `entity_id`, no event `title`, no `description`, and read no `meeting_message` and no `meeting_guest_invitation` at all — a guest link is counted by the `invitation_id` on the stay, which is a handle and never leaves the fold. The response schema has no field any of them could travel in. So:

- **A guest is never named** — neither the name typed at the door nor the Directory name the link was minted for — and no Directory entity handle appears. Guests are one aggregate row: "Guests (not named)".
- **Nothing anybody said**: chat is not read.
- **No event title**: a meeting is reported through its matter's caption, which a holder of the report key may already read, and a firm event is the bucket **Firm Events**. A title would put one matter's content on a firm-wide document for no figure it adds.
- **No per-person connection figure**, on any surface. The operator's inspect route was deliberately not given a firm permission for the reason that a member able to read the room's internals could read a colleague's connection quality; a report that printed quality per member would reopen exactly that. Quality is shown for the firm and by medium only.

### 6.4 Small cells

Connection quality is withheld — stated, not blank — when fewer than **five** distinct people (members plus guest links) were in meetings in the window, and a medium's own quality row is withheld on the same test. In a firm of three, "twelve poor reports" is a sentence about one of two colleagues. Five is the platform's existing small-cell threshold, `DEFAULT_SUPPRESSION_THRESHOLD` in `packages/telemetry/src/usage-suppression.ts`; the route passes it in, so the reporting package does not take a telemetry dependency to learn a number. The usage figures themselves are not suppressed: who was in which meeting is already readable, per meeting, by anybody holding `meetings:join` on the event.

### 6.5 The one thing Analytics Engine is given

Beside the tally, and for the operator rather than the firm: a counter `meetings.connectionReports` with the declared dimensions `["quality", "medium"]`, raised once per accepted browser report. Two closed labels, no firm, no meeting, no person — the fleet's rate of poor connections by medium, which is the operator's question ("are calls worse this week everywhere") and which a firm's tally cannot answer across firms. It is the fleet view; the tally is the firm's. Neither is read as the other.

## 7. Where the code goes

- **`@magna-carta/meetings` owns the SQL** — the reporting package's own rule is that new SQL over another package's tables belongs in that package, inside its schema-name-sync net. A new trio beside the others: `usage-types.ts` (the row shapes the two reads return), `usage-statements.ts` (the carry-in read, the page read, the tally read, the tally insert) and `usage-service.ts` (`tallyConnectionSegment`). The in-room entry instant is added to `MEETING_STAY_TABLES` in `meeting-statements.ts`, and the page read composes both tables from that list, so the fitness test that holds the list to every stay table the schema declares also holds this read.
- **`@magna-carta/reporting` owns the fold** — `src/meetings-usage/`: `fold.ts` (pure: pages of rows plus a window, a zone and a threshold in, the aggregate out; no clock, no database), `assemble.ts` (walks the pages through the meetings reads, folds as it goes so memory is proportional to the groups and never to the rows, applies the ceilings, reads the tallies, and returns the payload) and `types.ts`. The package stays read-only: its purity scan already refuses a write statement, effect machinery, a composer import and a clock read, and the new sources pass it — the reads are named `list…` and `read…`, never with a composer's verb.
- **Temporal contract: live-only.** Attendance rows carry no recording instant, a live meeting's minutes grow while the report is read, and a tally arrives when a room empties rather than when the minutes happened — so no knowledge instant could make a figure reproduce, and the route does not accept one. The period resolves through `resolveLiveOnlyPeriod`, and the stamp is `reproducibilityStatement` over the live case, printed as served.
- **Completeness: `complete`.** The meeting reads compose the visible-matter predicate, which today excludes only the platform's own holding matters; the response carries `completeScope()` like every other report, so the day an information barrier becomes a clause in that predicate the declaration is the seam it lands on.

## 8. Routes and shapes

| method | path                             | permission            | does                                                                                    |
| ------ | -------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/v1/reports/meetings-usage` | `reports:operational` | the Meetings Usage report over a period; query `periodStart`, `periodEnd` (civil dates) |
| GET    | `/api/v1/firm-usage`             | `tools:firmUsage`     | unchanged route; the response gains `meetings`, the last thirty days                    |

`reports.meetingsUsage` is a new module, `apps/api-worker/src/routes/reports-meetings-usage.ts`, on the one-route-file-per-resource rule, with `RouteMeta` `{ surface: "app", authenticated: true, permission: "reports:operational", resource: "firm", audited: false, idempotency: "optional", rateLimit: "default" }` — the trust pack's meta, and a GET, which the conformance suite requires of every `reports:` read. `/api/v1/*` already routes to the Worker first, so no zone route and no `wrangler.jsonc` change. Its OpenAPI `description`:

> How much the firm met over one period, and how its meeting connections held up: meetings held, time in meetings and participant time, by medium, by member, by matter and by day, with guests counted and never named, and connection quality as counts across the firm. Days are read in the zone of the firm's default office, or in UTC where it has none, and the response says which. The figures cover everything recorded when the report is computed, and a meeting still in progress counts up to that instant, so the report is live and not claimed to reproduce. A period longer than a year, or one holding more meetings than one document can carry, is refused by name rather than answered short.

Responses: 200 with the shape below; 401; 403 naming `reports:operational`; 404 for an unreachable firm or a deactivated member; 422 `report-period-invalid` (not two calendar dates, or inverted) and `report-period-too-large` (over a year, over the stay or matter ceiling), the problem types the trust pack's route already maps; 429.

```
MeetingsUsageReport
  window        { periodStart, periodEnd, timeZone, timeZoneSource: "firm-default-office" | "platform",
                  startsAt, endsBefore }                         -- instants, canonical shape
  reproducibility            ReportReproducibility              -- always the live arm, with computedAt
  reproducibilityStatement   string                             -- the reporting package's sentence
  dayBoundaryStatement       string
  recordStatement            string                             -- "measured from who was in the room … not a bill"
  completeness               ReportCompleteness
  totals        { meetings, meetingMilliseconds, participantMilliseconds,
                  members, memberStays, guestArrivals, guestLinks }
  byMedium      [ { medium: "video" | "audio", meetings, meetingMilliseconds, participantMilliseconds } ]
  byMember      [ { userId, displayName, meetings, stays, participantMilliseconds } ]
  guests        { arrivals, links, participantMilliseconds }
  byMatter      [ { matterId | null, matterNumber | null, matterTitle | null,     -- null triple = Firm Events
                    meetings, meetingMilliseconds, participantMilliseconds, members, guestArrivals } ]
  byDay         [ { day, meetings, meetingMilliseconds, participantMilliseconds } ]   -- every day of the period
  quality
    withheld          null | { reason: "fewer-people-than-threshold", threshold }
    fromTheRecord     { droppedConnections, returnedAfterDrop }
    fromTheRooms      { meetingsReported, meetingsNotReported,
                        reports: { good, fair, poor, unknown }, reconnects, routingRefusals }
    byMedium          [ { medium, withheld: boolean, fromTheRecord, fromTheRooms } ]
  provenance    { computedAt, shapeVersion, pagesRead, staysRead }
```

The agreements the payload guarantees, each an agreement test: `Σ byMember.participantMilliseconds + guests.participantMilliseconds = totals.participantMilliseconds`; `Σ byMatter` of each time equals the total; `Σ byDay` of each time equals the total; `Σ byMedium` of each time and of `meetings` equals the total (a meeting has one medium). Meeting counts by day and by member are not additive and are not claimed to be. A tally segment belongs to the window when its `opened_at` falls in it, so a segment that opened before a window and ran into it is counted in the earlier one; that is stated on the connections section rather than split, because counts cannot be divided by time.

`FirmUsageResponse` gains, additively:

```
meetings
  window        { startsAt, endsBefore }                          -- the last thirty days, instants
  totals        -- the report's totals shape
  byMedium      -- the report's byMedium shape
  quality       -- the report's quality shape
```

computed by the same `assemble` with the thirty-day window and no zone (so no days). No names, no members, no matters: Firm Usage is the firm reading its own totals, and the per-person decomposition is the report's.

## 9. Permission

**`reports:operational`, already registered and already seeded.** Its registry line is "operational volumes — matters, invoices, movements, reconciliations"; the report registry declares Operational Volumes on it; and the baseline per-firm migration seeds it to Owner/Admin. How much the firm met in a period is an operational volume, and the audience — the seat that reads firm-wide aggregates across every matter — is exactly the one the key was seeded for. A firm-wide, per-member account of meeting time is a different exposure from the per-meeting attendance a `meetings:join` holder already reads, which is why the key is a `reports:` one and not a meetings one.

- **`reports:productivity` was considered and rejected.** It is "hours recorded by timekeeper", and a minute in a meeting is not a recorded hour: it is not a time entry, it is not billable by being attended, and a report that sat under the productivity key would invite reading one as the other.
- **A new key (`reports:meetings`) was considered and rejected.** It would have the same audience, and the cost of a key is not its registry line: `packages/access-control/CLAUDE.md` records that a permission with no seed is a permanent refusal, that the per-firm seed migrations are the entire supply, and that no surface writes a direct grant — so a new key buys nothing a firm could use to narrow or widen it, and costs a seed, a lint entry and a conformance line.

**Registration steps for the chosen key:** none in `packages/access-control` and none in `packages/database` — the key is in `PERMISSIONS` and in the baseline's `role_permission` seed, so `pnpm run lint:ungranted-permissions` passes as it stands. The steps that remain are the route's: name the key in `RouteMeta`, add `reports.meetingsUsage` to the conformance suite's operation list, and declare the registry entry with `permission: "reports:operational"`, which the registry fitness test requires to be a `reports:` key. Had a new key been taken, the steps would have been the registry line, a seed migration in `packages/database/drizzle/per-firm/` in the same commit (the `20260919T001020_seed-meetings-permissions.sql` shape), and the lint's confirmation that some role carries it.

**Firm Usage keeps `tools:firmUsage`**, seeded to Owner/Admin in the same baseline, because the section is a part of that page and a page with two keys is two pages. It shows nothing a holder of that key could not already count.

## 10. Screens

### 10.1 Reports — one registry entry and one presenter

In `apps/web/src/lib/reports/report-registry.ts`, a built declaration in the operational family, beside Operational Volumes:

```
id: "meetings-usage"          family: "operational"          name: "Meetings Usage"
answers: "How much the firm met in a period — meetings, time in meetings and participant time, by
          member, by matter, by medium and by day — and how the connections held up."
permission: "reports:operational"    temporal: "live-only"    stage: "alpha"
scope: { trustAccount: false }
```

The run screen draws the period control and nothing else — a live-only report does not draw the knowledge instant, and there is no subject. The read fires when the period is complete, with no Run button, on the report screen's own rule. `meetings-usage-presenter.ts` arranges the payload into sections and computes nothing: every total row is the payload's own, and a minute is `participantMilliseconds / 60,000` formatted, never a sum.

| Section         | Columns                                                                                                                                                                                    | Note the section may carry                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Summary**     | Measure, Figure — Meetings Held, Video Meetings, Audio Calls, Time in Meetings, Participant Time, Members Who Attended, Guest Arrivals, Guest Links Used                                   | "A meeting that ran across the end of a day or a period is counted in both."                                 |
| **By Member**   | Member, Meetings, Stays, Participant Minutes; then **Guests (not named)**; then Total                                                                                                      | —                                                                                                            |
| **By Matter**   | Matter Number, Matter, Meetings, Meeting Minutes, Participant Minutes, Members, Guest Arrivals; **Firm Events**; Total                                                                     | —                                                                                                            |
| **By Day**      | Day, Meetings, Meeting Minutes, Participant Minutes                                                                                                                                        | the `dayBoundaryStatement`                                                                                   |
| **Connections** | Measure, Figure — Good, Fair and Poor Reports, Not Yet Measured, Reconnections, Dropped Connections, Of Which Returned, Routing Service Refusals, Meetings Reported, Meetings Not Reported | when withheld: "Fewer than five people were in meetings in this period, so connection quality is not shown." |
| **Provenance**  | Computed At, Days Read In, the stamp, the record statement                                                                                                                                 | —                                                                                                            |

A figure cell carries both faces (`figureCell`): the text a reader sees — whole minutes grouped, or `formatDuration` for the summary's two times — and the exact number of minutes, so a spreadsheet sums a column to the total the payload printed. A share of good reports is formatted from two payload figures by the formatter Firm Usage already uses; it is never a stored figure and never a sum. The state set is the run screen's: the fixture (`meetings-usage-fixture.ts`, the design system's sample people and matters, never a firm's own figures) under the loading region, the failure notice with Retry and the Error ID, the refusal naming `reports:operational`, and an empty period rendered as the report with empty sections and its stamp — which is a true answer. Each table renders its header row over `DataTable.EmptyRow` when a section is empty, on the standing ruling that a table renders before its data.

The catalogue picks the report up from the registry with no edit of its own, and the reports guide's list of what runs today gains it.

### 10.2 Firm Usage — a Meetings section on the page's own pattern

The page is a stack of titled sections, each a `DataTable`, with a fixture of the same tables under one `LoadingRegion` (`apps/web/src/routes/(app)/firm-usage/+page.svelte`); it has no cards, so the "card" is a section like its neighbours, placed after **AI Usage** and before **Compute and Activity**:

**Meetings, Last 30 Days** — Measure | Last 30 Days: Meetings Held; Video Meetings; Audio Calls; Time in Meetings; Participant Time; Members Who Attended; Guest Arrivals; Connection Reports Good, Fair and Poor (or the withheld sentence); Dropped Connections; Meetings Not Reported. Beneath the table, one link, **Open the Meetings Usage report**, to `/reports/meetings-usage` with the last thirty days as its period. The link is drawn for every reader; a reader without `reports:operational` meets the run screen's refusal naming the key, which is the product's one sentence for a refused control, rather than a link that silently is not there.

The fixture gains a `FIXTURE_MEETINGS` table in sample figures, and `firm-usage-report.ts` gains the same section, so every download format carries what the screen showed.

### 10.3 Export

The reporting package has no export of its own and needs none. **The report's CSV is the report screen's export path**: the presentation is the tabular export document's shape by design, the run screen's `ExportMenu` renders it through `$lib/export` — text, CSV and Excel in the browser (`render-csv.ts` among them) — and Word and PDF through the server printer `POST /api/v1/reports/exports` on `reports:export`, which prints the document the browser already holds and stores nothing. Firm Usage's export is its own `firmUsageExportDocument`, extended by the one section. No new export route, format or renderer.

## 11. Security

- **Authorization.** Two existing keys, both seeded to Owner/Admin; both routes are reads under the chokepoint, addressed by the session's firm and never by a path value. The conformance suite's rule that no `reports:` key gates a mutating route holds.
- **What leaves.** Member display names, matter titles and numbers, counts and durations. Never a guest's name or entity, an event title, chat, or a per-person connection figure — enforced by the column scan over the two reads and by a route test asserting over the response **body**, not the schema, that a fixture guest's typed name, invited name and entity handle appear nowhere (the external-guests design's own test shape).
- **Walls.** The meeting reads take the visible-matter predicate as a required argument, so the report can never count a meeting an id-addressed read would refuse, and inherits an information-barrier clause the day one exists.
- **Small cells.** Quality withheld below five people, per window and per medium.
- **The tally.** Written only by the room, only counts, only per meeting; the room already holds the firm and meeting on the socket's attachment and addresses the firm's database by that firm, the grace sweep's path. A browser can inflate its own report count by at most one per five seconds (the existing throttle) and every value it sends is already bounded field by field in the protocol package; a flood moves the tally no faster than a well-behaved client and cannot move another firm's.
- **Cost of a read.** Bounded by the period ceiling, the stay and matter ceilings and the default rate limit; the page read carries no bound parameter that grows with the page.
- **Audit.** The report read is unaudited, on the trust pack's precedent: the chokepoint's audit record exists for mutations. Whether a firm-wide per-member read should be is recorded in section 15 rather than decided here.
- **Telemetry.** The fleet counter has two closed labels; no event gains a field. The telemetry package's structural redaction is untouched.

## 12. Cost

No new provider and no new metered line. The paragraph for [`docs/operating-costs.md`](../operating-costs.md), folded into the Durable Objects and Realtime rows of section A the way the editor container's paragraph is:

> **Meetings usage reporting (folded into the Durable Objects and Realtime rows above).** The report and the Firm Usage section read the firm's own database on request and store nothing: a twelve-month report at the stress load profile is about eight round trips returning about 18,000 rows, which at the rows-read rate is a ten-thousandth of a dollar (~, derived from the profile, not measured). The connection tally writes one row per room segment — one or two per meeting — and adds no storage operation per connection report, because its counters ride the participant write the room already makes. What meetings actually cost is the Realtime line, and it is proportional to participant time and to what each browser pulls: ~1.7 GB per participant-hour in a four-person video meeting (three tiles at the full simulcast layer, assumed at ~1.2 Mbps, plus three audio streams at ~40 kbps — assumed rates, not measured), ~0.05 GB per participant-hour in a four-person call, so ~$0.08 and ~$0.003 per participant-hour past the 1,000 GB monthly allowance (~600 participant-hours of four-person video across the whole fleet). Re-derive with measured layer bitrates, and confirm which direction of traffic Realtime meters, before relying on either. The firm's report is in minutes and never in gigabytes; comparing the fleet's participant time by medium with the invoice is the platform's check on these rates.

## 13. Testing

- **The pure fold** — `packages/reporting/test/meetings-usage-fold.test.ts`, over hand-built pages of stay rows and no database: a member who never waited counts from `joined_at`; one who waited counts from `admitted_at`; one who waited and was never admitted counts nothing; a guest counts from `admitted_at`; an open stay in a live meeting stops at the computed instant; an open stay in an ended meeting stops at `ended_at`; clipping at both window edges; meeting time is the union, so two overlapping stays count once and a gap when the room stood empty counts not at all; a member with two stays is one member and two stays; `socket-lost` followed by a later stay counts as dropped and returned; a firm event lands in Firm Events; guests aggregate into one row with links counted by invitation, so an organization link used twice is two arrivals and one link.
- **Agreement** — `meetings-usage-agreement.test.ts`, on the reporting package's discipline: over a generated fixture, every decomposition of section 8 sums to its total as integers, and the test says so of `byDay` in every zone case below.
- **Zone boundaries** — `meetings-usage-zones.test.ts`: a stay across local midnight splits at the zone's midnight and not UTC's; the spring-forward day is twenty-three hours and the autumn day twenty-five, and the days still sum; `America/Santiago`, whose day starts when the clock reaches it; `Pacific/Honolulu` and `Pacific/Auckland`, whose periods start a day apart from UTC's; a period ending today clips at the computed instant; a firm with no default office reads in UTC and says `platform`; the window is computed by `instantForCivilDateTime` and `endOfCivilDayInstant` and never by string arithmetic on an instant, the slip `pnpm run lint:date-handling` exists to catch.
- **Paging** — `meetings-usage-paging.test.ts`: folding a walk page by page equals folding it as one page, for page boundaries placed at every meeting; a page never splits a meeting (the probe meeting of three hundred stays and its reconnections arrives whole); the carry-in brings in a meeting that started before the window and ran into it, and leaves out an abandoned live meeting whose stays all closed before it; the stay ceiling over-reads by one and refuses rather than truncating; the walk terminates on a final short page.
- **The reads** — `packages/meetings/test/usage-statements.test.ts` over `node:sqlite`, on the existing service tests' shape: both stay tables are read; a meeting on the platform's holding matter is not; the column lists name none of the forbidden columns (a source scan over `usage-statements.ts`); the tally insert is a no-op on a repeated id.
- **The room** — `apps/api-worker/test/meeting-room.test.ts`: a report bumps the participant's counters inside the write it already made (the fake storage's put count is unchanged per report); a departure adds them to the room tally; a supersede and an `sfu-unavailable` refusal each add one; the end writes one row and deletes the key; the room emptying writes one row; a flush whose write fails keeps its segment pending and a later flush writes it unchanged while new counts land in a new segment. `meeting-room-load.test.ts`: the printed line's lists per frame and writes per report are unchanged.
- **Routes** — `apps/api-worker/test/reports-meetings-usage-routes.test.ts`: 401; 403 for a member without `reports:operational`; 422 for an inverted period, a period over a year, and a fixture past the stay ceiling; 200 with the shape; the body contains no guest's typed or invited name and no entity handle. `firm-usage.test.ts`: the `meetings` section is present, carries no names, and its window is thirty days of instants. `conformance.test.ts`: `reports.meetingsUsage` in the operation list, and a read.
- **Load profile** — `packages/fixtures/src/load-profile/meetings-measurements.ts`: the one-month and twelve-month walks and the thirty-day window at the local and stress multipliers, the carry-in on its own, pages and rows, and the two plans.
- **Web** — `apps/web/test/meetings-usage-presenter.test.ts`: every member, matter and day in a fixture payload reaches a row, every printed total is the payload's, the stamp and the two statements are the response's words, the withheld quality renders its sentence, and the presentation renders through the export document's renderers. `apps/web/test/firm-usage-report.test.ts`: the export carries the Meetings section.

## 14. The file-touch list

**Sequencing and the shared surface.** This is the meetings stream's own checkout, and several of the files below are ones the external-guests slice is changing right now: `packages/meetings/src/meeting-statements.ts`, `packages/database/src/per-firm-schema.ts`, `apps/api-worker/src/meetings/room/room-state.ts`, `room-lifecycle.ts` and `room-diagnostics.ts`, and the emitted contract. This slice starts after that one lands and takes them afterwards; while work is split, each file below has exactly one owner.

**Backend agent**

- `packages/identifiers/src/registry.ts`, `src/types.ts` — `meetingConnectionTally`.
- `packages/database/src/per-firm-schema.ts` — the `meeting_connection_tally` table and the two partial indexes on `meeting`; one hand-written additive migration in `packages/database/drizzle/per-firm/`, the snapshot refreshed, `pnpm run migration-bundles` in the same commit. Nothing rebuilt, nothing relaxed.
- `packages/meetings/src/meeting-statements.ts` — the in-room entry instant on each `MEETING_STAY_TABLES` entry.
- `packages/meetings/src/usage-types.ts`, `usage-statements.ts`, `usage-service.ts` — **new**.
- `packages/meetings/package.json` — the three exports; `packages/meetings/CLAUDE.md` — the usage trio and its one rule (no name beyond a member's).
- `packages/meetings/test/usage-statements.test.ts` — **new**.
- `packages/reporting/src/meetings-usage/fold.ts`, `assemble.ts`, `types.ts` — **new**; `packages/reporting/package.json` — the `@magna-carta/meetings` dependency and the exports; `packages/reporting/CLAUDE.md` — key files.
- `packages/reporting/test/meetings-usage-fold.test.ts`, `meetings-usage-agreement.test.ts`, `meetings-usage-zones.test.ts`, `meetings-usage-paging.test.ts` — **new**.
- `packages/notifications/src/settings.ts` — `resolveFirmZone`, with the digest's resolver calling it.
- `packages/telemetry/src/metrics.ts` — `meetings.connectionReports`.
- `apps/api-worker/src/meetings/room/room-connection-tally.ts` — **new**; the counters, the fold on departure, the flush and the pending segment.
- `apps/api-worker/src/meetings/room/room-state.ts` — the optional counters on `StoredParticipant`, the tally and pending keys.
- `apps/api-worker/src/meetings/room/room-diagnostics.ts` — the counters in `acceptClientReport`'s existing write, the `sfu-unavailable` bump, the fleet counter.
- `apps/api-worker/src/meetings/room/room-lifecycle.ts` — the departure fold, the supersede bump, the flush on end and on empty, the pending retry when the ended marker is retired.
- `apps/api-worker/src/meetings/CLAUDE.md` — the module map line.
- `apps/api-worker/src/routes/reports-meetings-usage.ts` — **new**; `apps/api-worker/src/routes/firm-usage.ts` — the `meetings` section; `apps/api-worker/src/app.ts` — the one registration line.
- `apps/api-worker/openapi/openapi.json` and `packages/api-client` — regenerated, never hand-edited.
- `apps/api-worker/test/reports-meetings-usage-routes.test.ts` — **new**; `firm-usage.test.ts`, `meeting-room.test.ts`, `meeting-room-load.test.ts`, `conformance.test.ts`.
- `packages/fixtures/src/load-profile/profile.ts` — `MeetingsVolume`, the scaled copy in `scaleProfile`, and a `GENERATOR_VERSION` bump; `meetings-generate.ts` and `meetings-measurements.ts` — **new**; the generator and measurement wiring beside the calendar's.
- `docs/operating-costs.md` — the paragraph of section 12.

**Web agent**

- `apps/web/src/lib/reports/report-registry.ts` — the declaration.
- `apps/web/src/lib/reports/meetings-usage-api.ts` — **new**; the hand-written wire shapes and the read, mirroring `reports.meetingsUsage`.
- `apps/web/src/lib/reports/meetings-usage-presenter.ts`, `meetings-usage-fixture.ts` — **new**; `apps/web/src/lib/reports/CLAUDE.md` — key files.
- `apps/web/src/lib/firm-usage/firm-usage-api.ts`, `firm-usage-report.ts`, `firm-usage-format.ts` — the section's shape, its export section, and its duration formatting through the design system's `formatDuration`.
- `apps/web/src/routes/(app)/firm-usage/+page.svelte` — the section, its fixture, and the link.
- `apps/web/test/meetings-usage-presenter.test.ts` — **new**; `apps/web/test/firm-usage-report.test.ts`.
- `docs/user/features/reports.md` — the Meetings Usage report, what each figure means, and that guests are counted and never named; `docs/user/firm-usage.md` — the Meetings section; `docs/user/features/meetings.md` — the **Connection quality** section's sentence about what is recorded, rewritten to what section 6.2 now does.

**Both, held by the backend agent and written once the web half reports in:** `roadmap.d/meetings.md` (`meetings.usage-reporting` to `in-build` and then `shipped`; the fleet counter added to `meetings.diagnostics`' evidence), `pnpm exec vp run register-build`, `status.d/meetings.md` and `vp run status-build`, `changelog.d/<slug>.md`, and two decision fragments in `docs/decisions/pending/` — that meeting minutes are the attendance record and never the bill, and that connection quality is a per-meeting tally in the firm's own database with no person on it.

## 15. What this does not settle

- **A reproducible form.** Attendance carries no recording instant, so the report is live; a knowledge instant would need one on both stay tables and a tally that is written when the minutes happen rather than when a room empties.
- **Billing a firm for meetings.** The platform subscription's pricing model is undecided; the per-participant-hour estimate in section 12 is the platform's cost, not a price, and nothing here meters a firm for one.
- **Per-firm reconciliation against Cloudflare.** Whether Realtime can report usage per session, which would let the platform attribute its bill to firms, is unknown; the fleet-level check is all this design claims.
- **The operator's dashboard** over the `meetings.room.*` stream and the new counter — the half of `meetings.diagnostics` that still reads nothing.
- **Meeting time as recorded time.** Turning attendance into a time entry is a timekeeping question with billing consequences, and deliberately not implied by anything here.
- **Time at the door.** How long people waited before a host let them in is on the record and is not reported.
- **Meetings nobody ended.** The room never ends a meeting by itself, so an abandoned meeting stays `live` forever with every stay closed. The report is unaffected — it counts time in the room — but a firm's count of live meetings is, and whether something should close them is a meetings question.
- **Whether a firm-wide, per-member read should be audited.** The trust pack's precedent is not; a per-member account of time is a different kind of read, and the owner may want it on the record.
- **Who may read it beyond Owner/Admin.** Widening `reports:operational` needs a direct grant, and no surface writes one.
- **A multi-office firm's day.** The default office's zone reads the whole firm's days; a per-office breakdown in each office's own zone is a later shape.
- **Walls.** When an information barrier becomes a clause in the visible-matter predicate, the report must say how many matters' meetings it excluded; the completeness declaration is the seam, and the count is not designed.
- **Owner acknowledgement of the changed sentence.** Members have been told that nothing about a connection is recorded; section 6.2 keeps that true of every person and not of the room, and the owner should see the new sentence before it ships. If it is refused, the connections section keeps only its from-the-record half — dropped connections and returns — and the tally is not built.
- **Recording and transcription minutes**, which will cost differently from forwarding media and will want their own line when those slices land.
