# `@magna-carta/civil-time` — CLAUDE.md

**Purpose.** What a civil date, a wall-clock time and a time zone ARE, and the whole of the platform's
arithmetic on them. This is the shape authority; it holds no display and no data access, and it has no
workspace dependencies at all so that every package, worker and screen can reach it.

**White paper:** _Core domain_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Ruling ledger:** [`docs/conventions/dates.md`](../../docs/conventions/dates.md) — the standing rules
this package encodes, and the gate that keeps them the only copy.

## Key files / entry points

- `src/civil-date.ts` — the `YYYY-MM-DD` shape, `isCivilDate` (pattern **and** a real day on the
  calendar), `civilDateOf` / `todayInUtc`, `addCalendarDays`, `endOfCivilMonth`.
- `src/wall-clock.ts` — the `HH:MM` shape and `isWallClockTime`.
- `src/time-zone.ts` — `isResolvableTimeZone`, `viewerTimeZone`, and the zoned arithmetic:
  `zonedReading`, `instantForCivilDateTime`, `endOfCivilDayInstant`.

## Local conventions

- **Shape here, display in the design system.** How a date READS to a person is
  `packages/design-system/src/lib/formatters/{civil-date,instant}.ts` and never this package. The two
  halves mirror `@magna-carta/money` and the design system's money formatter, deliberately.
- **No workspace dependencies, ever.** The moment this package imports another one, the packages that
  needed it most (`notes`, `tasks`, the workers' route modules) stop being able to reach it, and they
  go back to writing their own copy. That is exactly how the three `isResolvableTimeZone`
  implementations happened.
- **A civil date is a string, not a `Date`.** A `Date` is an instant and an instant is a day only once
  somebody names a zone. Functions that take one say so in their type.

## Invariants that apply here

- **No date is ever derived from another date beyond plain day counting.** No business-day rule, no
  holiday calendar, no service-method offset, no chained recalculation. That is the calendar package's
  stated invariant and this package inherits it: a computed deadline that is wrong is trusted
  precisely because it was computed. `addCalendarDays` counts days and nothing else.
- **A stored zone is a named IANA zone, never a fixed offset.** `isResolvableTimeZone` refuses
  `+05:00` even where the runtime accepts it — an offset is wrong for half the year in every zone that
  observes daylight saving, and storing one is how a hearing moves by an hour when the clocks change.

## Dependencies & contracts

- Depends on nothing. Consumed by `calendar`, `notes`, `tasks`, `matters`, `matter-assets`,
  `conflicts`, `trust`, `notifications`, `reporting`, `apps/api-worker` and `apps/web`.
- `packages/calendar` re-exports nothing from here: importers of the zoned arithmetic import
  `@magna-carta/civil-time/time-zone` directly, so there is one import path and the lint can name it.

## Gotchas

- **`civilDateOf` is UTC and `zonedReading` is not.** They differ by a day for roughly a third of every
  day. "Today" on the server is `todayInUtc`; "today" for the person reading a screen is
  `zonedReading(Date.now(), theirZone).civilDate`. Picking the wrong one shows a task as overdue that
  is not.
- **`CIVIL_DATE_PATTERN` alone is not validation.** It accepts `2026-02-30`. Use `isCivilDate` unless
  you are handing the pattern to zod, which is the one place the bare pattern belongs — and even there
  the service layer checks the day exists.
