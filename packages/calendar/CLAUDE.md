# @magna-carta/calendar — CLAUDE.md

**Purpose.** The case calendar: the two recorded tables that hold facts born here (a litigation event
and a deadline), the event-type catalog and participant list beside them, and the **source registry**
that federates those rows with the subsystem tables that already record what the firm did — under one
comparable sort key, one shared cursor, and one visibility predicate. Validates in memory and composes
statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no binding, reads no clock,
and never calls an external service.

**White paper:** _Calendar and rules-based docketing_, with _Foundational data & runtime conventions_
(the time model), _Notifications_, _Tenancy and data isolation_, and _Authentication, access control &
encryption_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0018, ADR-0055,
ADR-0059, ADR-0068, ADR-0051.)
**Spec:** [`docs/specs/2026-08-05-case-calendar-design.md`](../../docs/specs/2026-08-05-case-calendar-design.md).

## Key files / entry points

- `src/types.ts` — the closed vocabularies, the window and page caps, and the two shapes a source's
  time column can have
- `src/validation.ts` — every refusal as a code the route maps to a problem type, plus the window and
  horizon caps
- `src/time-zone.ts` — **the only calendar arithmetic in the package**: a civil date plus an optional
  wall-clock time, read in a named zone, as a UTC instant
- `src/overdue.ts` — the read-time comparison, and nothing else
- `src/event-statements.ts` / `src/event-service.ts` — recording, editing, and cancelling an event,
  plus the participant replace-set
- `src/event-type-statements.ts` / `src/event-type-service.ts` — the catalog, and the platform-row
  immutability rule
- `src/deadline-statements.ts` / `src/deadline-service.ts` — recording, editing, satisfying,
  vacating, and superseding a deadline
- `src/visibility.ts` — **the visibility seam**: the one predicate every source composes
- `src/sources/registry.ts` — the `TimelineSource` declaration shape and the registry
- `src/sources/build.ts` — the one place a source's SELECT is assembled
- `src/sources/all.ts` — the thirteen declared sources, and the audit-log lifecycle allowlist
- `src/merge.ts` — the k-way merge, the shared cursor, and the canonical-instant assertion
- `src/timeline.ts` — one page across the registry: pre-reads, statements, merge, and the counts a
  measurement asserts against
- `src/notifications.ts` — the six emission points, declared and wired to nothing

## Invariants that apply here

- **Nothing is projected, copied, or backfilled.** A fact born in another subsystem is read IN PLACE
  through a declared source; a fact born here gets a row here. That is what makes the class of bug
  where the timeline disagrees with the register unwritable — the timeline IS the register. A source
  is a read-side declaration and NEVER a write-side obligation on the subsystem that owns the rows.
- **Every source's statement builder takes the visible-matter predicate as a REQUIRED argument** and
  composes it into the `WHERE` clause **before the `LIMIT`**. Required rather than optional so the
  omission is a type error first and a fitness failure second. Composed in SQL and never applied in
  the Worker after the rows come back: a post-filter under-fills the page, makes the next cursor mean
  something different from page to page, and turns the page size into an existence oracle for the
  rows it removed. `test/source-fitness.test.ts` proves all of it for every registered source from
  one table-driven pass.
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
   and in the `kind` filter), the closed `kinds` set, and the declared `timeColumnShape`.
2. **A statement builder** — built through `boundedSelect`, which composes the predicate, the keyset,
   and the `LIMIT` for you. Return `[]` where the scope cannot match rather than a query that cannot
   hit.
3. **A projection** — through `projectRow`, with the deep link into the owning subsystem's own read.
4. **A label decision** — a genuinely non-privileged summary, or `declaresLabel: false` and `NULL AS
label` in the SQL. There is no third option.

It is **never** a change to the owning subsystem's write path, and never a new table.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `@magna-carta/money`. It depends on no other domain package: every source reads its rows by table
  name, which the schema-name-sync fitness test pins to `@magna-carta/database`.
- The route layer (`apps/worker/src/routes/calendar.ts`) hands every service the firm-scoped database,
  the real clock, a crypto random source, and the authenticated actor — none of which is client input.

## Gotchas

- **The read count scales with the REGISTRY, not with the firm's data.** That is the line between a
  bounded fan-out and an N+1: N here is the number of declared sources, fixed in code and reviewed
  when it changes. `TimelineReadResult` reports `statementCount` and `rowsRead` so a measurement can
  assert the bound rather than infer it.
- **A page over-reads to under-return.** Every source reads `pageSize + 1` so the MERGED result can
  tell "there is more" from "that is all"; the extras are discarded. At thirteen sources and a
  fifty-row page that is up to 663 rows read to return 50.
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
