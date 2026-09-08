# Dates, times and zones — the standing rules

**White paper:** _Core domain_ — [`../Magna-Carta-White-Paper.md`](../Magna-Carta-White-Paper.md).
**Enforced by:** `pnpm run lint:date-handling` ([`tooling/lint-date-handling/`](../../tooling/lint-date-handling/))
for the code, [`date-shape-guards.test.ts`](../../packages/database/test/date-shape-guards.test.ts)
for the columns, and the two package fitness tests named at the end.

A date is the most-copied thing in this codebase, and every copy of it was correct. That is what
made the duplication expensive rather than harmless: nothing was broken, so nothing drew attention,
and the copies accumulated until one of them was corrected and the others were not.

The count when this standard was written: **six** implementations of "is this a real calendar day",
**three** of "is this a resolvable time zone" — two of which accepted a fixed offset the third
refused — about **forty** copies of the civil-date pattern, **six** of the canonical-instant
pattern, **six** of the date picker's value reader, and **nine** surfaces each printing a recorded
moment in their own words.

## The two authorities

| Question                                                                       | Home                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| What a date, a time, an instant and a zone **are**, and the arithmetic on them | [`@magna-carta/civil-time`](../../packages/civil-time/)                                          |
| How any of them **reads** to a person                                          | [`packages/design-system/src/lib/formatters/`](../../packages/design-system/src/lib/formatters/) |

The split mirrors money exactly, and deliberately: `@magna-carta/money` owns what an amount is,
`formatters/money.ts` owns how much it says. Neither half borrows the other's job.

`@magna-carta/civil-time` has **no workspace dependencies**, and that is the load-bearing property.
Every one of the hand-written copies existed in a package that could not reach the one that already
had the function — `packages/notes` and `packages/tasks` could not import `packages/calendar`, so
they each wrote their own zone check, and both wrote a weaker one.

## The four shapes

| Shape               | Written as                     | Import from                          | Guard                  |
| ------------------- | ------------------------------ | ------------------------------------ | ---------------------- |
| **Civil date**      | `YYYY-MM-DD`                   | `@magna-carta/civil-time/civil-date` | `isCivilDate`          |
| **Wall-clock time** | `HH:MM`, 24-hour               | `@magna-carta/civil-time/wall-clock` | `isWallClockTime`      |
| **Stored instant**  | exactly `toISOString()`'s form | `@magna-carta/civil-time/instant`    | `isCanonicalInstant`   |
| **Time zone**       | an IANA name, never an offset  | `@magna-carta/civil-time/time-zone`  | `isResolvableTimeZone` |

**The pattern is not the validation.** `CIVIL_DATE_PATTERN` accepts `2026-02-30`. Hand it to zod at
a route boundary if that is all you have; use `isCivilDate` everywhere a day has to exist.

**A stored zone is a named zone.** `isResolvableTimeZone` refuses `+05:00` even where the runtime
accepts it: an offset is wrong for half the year in every zone that observes daylight saving, and
storing one is how a hearing moves by an hour when the clocks change. Where a refusal wants to say
so in those words, `isFixedOffset` is the predicate — so the refusal and its explanation cannot come
to different conclusions about what an offset looks like.

**The stored-instant shape is narrow on purpose.** `2026-09-08T12:00:00Z` and
`2026-09-08T12:00:00.000Z` are the same moment and sort differently as text, and the federated
chronology in `packages/calendar` compares sort keys as text. One row in the wrong shape puts a
hearing in the wrong place on a timeline, and nothing fails.

## Three things that look alike and differ by a day

This is the distinction most worth getting right, and the one a scan cannot make for you.

- **`civilDateOf(instant)` / `todayInUtc()`** — the day in UTC. The server's "today", with no zone
  read into it.
- **`zonedReading(instant, zone).civilDate`** — the day that instant fell on _in that place_. The
  reader's "today", and the one an overdue comparison wants.
- **`formatDate(day)`** vs **`formatInstantDate(moment)`** — the display twins of the same split.
  `formatDate` pins a recorded day to UTC so a cost incurred on the 4th is the 4th in every office;
  `formatInstantDate` says which day a moment fell on where the reader is, so a file uploaded at
  23:40 in Boston reads as a different day in Reno. Both are true and both are correct calls.

Picking the wrong one of any pair shows a task as overdue that is not.

## A wrong-shaped date fails by name, and the check is at runtime on purpose

Hand a stored instant to a function that takes a day and you are a whole day out. Both are strings,
so nothing about the call looks wrong.

Every entry point in `@magna-carta/civil-time` refuses a value that is not its shape and says what
the value actually is: _"addCalendarDays: the civil date "2026-09-08T12:00:00.000Z" is a stored
INSTANT, not a day … `zonedReading(Date.parse(value), zone).civilDate` is that reading"_. Before
this, `civilDateParts` returned `{ year: 2026, month: 9, day: NaN }` **in silence** — every field
still a number — and everything built on it surfaced as `RangeError: Invalid time value`, a message
naming no function, no argument and no value, on a request carrying a dozen dates. The failure was
never the problem; the diagnosis was.

**A compile-time brand was the obvious answer and it is the wrong one here.** It was considered and
rejected on three counts, recorded so it is not re-proposed:

1. **A brand is erased at runtime, and the bad values arrive at runtime.** They come from a D1
   column or a request body — and thirty-two civil-date columns still carry no shape `CHECK`, so a
   civil-date column genuinely _can_ hold an instant today. A brand asserts a shape the database does
   not enforce, and it is wrong in precisely the case that matters: real data that is already wrong.
2. **Every call site would take a cast to satisfy it** — 162 of them across the six functions whose
   misuse costs a day — and a cast is a lie that typechecks.
3. **The runtime check gives the same guarantee for none of that churn.** Nothing unchecked reaches
   the arithmetic either way; the difference is only where the check is written, and one of the two
   places can see the value.

The honest version of a brand is "this was checked", not "this came from a trusted column" — and
that is what the guards already enforce, at the only place the two can be told apart.

## Never take the day of an instant with a day formatter

There are two spellings of this and the second is the one that shipped more of it.

```ts
formatDate(row.createdAt.slice(0, 10)); // takes the UTC day, then pins it to UTC
formatDate(row.createdAt); // no slice at all — same wrong day
```

`formatDate` pins to UTC _deliberately_, because a recorded day must not move under the reader.
Hand it a moment and that pinning is what makes the wrong answer silent instead of loud. Ten
surfaces shipped one of the two — "Date Entered", "Created", "Opened", "Closed", "On hold since" —
across the matter overview, the invoice window, the time record and two print sheets that reach
clients.

`createdAt.slice(0, 10)` is the UTC day. For any reader west of Greenwich it is the **wrong** day
for roughly a third of every day, and it does not look wrong: it produces a perfectly well-formed
`YYYY-MM-DD`.

Four surfaces shipped that — two of them print sheets that reach clients — under labels reading
"Date Entered" and "Created". A record entered at 18:30 in Los Angeles has a `createdAt` of 01:30Z
the next morning, so the sheet named the following day.

| What you want                                      | Call                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| The day to **show a reader**                       | `formatInstantDate(instant)` — the design system, viewer's own zone |
| The **UTC** day, for a query key or a sweep bucket | `civilDateOf(instant)`                                              |
| The day **in a named zone**                        | `zonedReading(Date.parse(instant), zone).civilDate`                 |

`civilDateOf` takes the stored instant as a string precisely so this has a name. A slice is
invisible to every scan; that is how all four bugs were written, and it is why the `day-of-an-instant`
rule reads the receiver rather than the operation.

**This is also the case that defeats a type.** A branded `CivilDate` obtained by parsing accepts
`createdAt.slice(0, 10)` without complaint — the value is not malformed, it is the wrong day. Only
knowing where the string came from catches it.

## No date is derived from another date

No business-day rule, no holiday calendar, no service-method offset, no jurisdiction, no chained
recalculation. `addCalendarDays` counts calendar days and is the whole of the arithmetic on offer;
it will land a task on a Sunday or on Christmas Day, and that is the honest behaviour — a person
moves such a date in a second and a template cannot know to.

The reason is not conservatism. A computed deadline that is wrong gets trusted **because** it was
computed. Deadline derivation waits on a verified jurisdiction-keyed rule catalog, and until that
exists the platform declines to guess.

## A column that holds a day says so

New civil-date and wall-clock columns take the guards in
[`packages/database/src/date-shape-checks.ts`](../../packages/database/src/date-shape-checks.ts) —
`civilDateShape(table.workDate)`, `wallClockTimeShape(table.dueAtTime, true)` — never a glob typed
out by hand. The globs come from the same shapes the code checks, proven equivalent against a real
SQLite `CHECK` rather than eyeballed, because eyeballing is how the guard already in the schema came
to accept `24:00`.

`GLOB` rather than `REGEXP`: SQLite ships glob in every build, and neither D1 nor a Durable Object
registers the `REGEXP` hook. Glob has character classes and no alternation, so the wall clock needs
its two alternatives `OR`'d — collapsing them to `[0-2][0-9]:[0-5][0-9]` is the same shape only if
you do not look at hour 24.

**The gap is recorded, not closed, and that is deliberate.** Nineteen columns across seven recently
built tables carry a guard; thirty-two older ones across the ledger, time, costs, billing, trust,
custody and the directory do not, and four of the guards that exist are the loose wall-clock
spelling. None of it can be fixed in place: adding or narrowing a `CHECK` in SQLite is a table
rebuild, and a rebuild of a table other tables point at **cannot complete against a firm database
that holds data** — see
[`reviewed-rebuilds.ts`](../../packages/database/src/reviewed-rebuilds.ts), which names the day a
firm's database sat unreachable for one.

So [`date-shape-guards.test.ts`](../../packages/database/test/date-shape-guards.test.ts) records
every unguarded column, every loosely guarded one, and the single column the naming convention
catches that holds an instant instead. Those lists may shrink and must never grow — which means the
only classification still open to a **new** date column is the guard itself.

## Display

- Every wording comes from `@magna-carta/design-system/formatters`. A surface never builds an
  `Intl.DateTimeFormat` or calls `toLocaleDateString`.
- The set: `formatDate`, `formatDateRange`, `formatMonth` (recorded days, UTC-pinned);
  `formatInstant`, `formatInstantDate`, `formatTimeOfDay`, `instantAttribute` (moments, in the
  reader's zone); `formatClock`, `formatDuration` (durations, which are not times of day).
- **Elapsed time is banned for a record.** No "2 hours ago", no "just now". It decays while the
  reader looks at it, two rows carrying it cannot be compared, and a record is a record.
  The one carve-out is the **age of a live measurement** — a cached probe, a status snapshot — whose
  whole subject is how long ago it was taken; those surfaces are named in the gate's allowance list
  and fall back to the absolute instant when they cannot compute an age.
- An unreadable value renders as the text that arrived. A silent blank or a cheerful "Invalid Date"
  hides a defect that showing the data makes obvious.

## A printed sheet takes its date formatters, and there is one set

Seven sheets each declared their own formatting seam, and the parameter was named `isoDate` in five
and `civilDate` in two. That disagreement was a record of nobody being sure what the function took,
and it is what let an instant reach a formatter contracted for a day — twice, on sheets that go to
clients.

One interface now: [`apps/web/src/lib/print-sheet/`](../../apps/web/src/lib/print-sheet/) declares
`date` (a day the firm wrote down, UTC-pinned) and `instantDate` (the day a moment fell on, in the
reader's zone), and every sheet's context extends it. A supplier calls `printSheetDates()` rather
than wiring two closures, so it cannot wire them to the wrong pair.

A sheet keeps its own `date` only where the wording genuinely differs — the calendar entry sheet
prints "Tuesday, September 15, 2026" — and it still takes `instantDate` from the shared set.

## The date field

The platform's date field is **`DatePicker`** (`@magna-carta/design-system/date-picker`) — the only
one that can carry a firm-configured week start. Fifteen surfaces still hold a native
`<Input type="date">`; that list is **recorded and closed** in
[`tooling/lint-date-handling/rules.mjs`](../../tooling/lint-date-handling/rules.mjs), so a sixteenth
fails. Whether the existing fifteen should all become `DatePicker` is an open design question for
the owner, not a decision the gate makes.

In a form, the seam between stored text and what the picker holds is `civilDateValue` /
`civilDateText` from [`apps/web/src/lib/dates/`](../../apps/web/src/lib/dates/) — never a
`try { parseDate(…) } catch { return undefined }` written again in a component.

## What the gate covers, and what it cannot

`pnpm run lint:date-handling` is derived into both the inner loop and CI by
`tooling/check-scoped/repo-wide.mjs`, so it runs everywhere with no further wiring. It reads source
text, so it catches a shape or a formatter written out and misses one assembled at runtime or
reached by different means.

The `day-of-an-instant` rule is the one that reads a RECEIVER rather than an operation — a trailing
`At`, or `now`/`instant`/`sortKey`, before `.slice(0, 10)`. It has to: the operation is ordinary
string work and the mistake is entirely in what the string was. It deliberately says nothing about
`validFrom`/`validTo`, which hold a civil date at one end and an instant at the other by design, so
the reads that slice them are normalising exactly that. A dual-shape column is a hazard, and it is a
different one. Two package fitness tests hold the same line from inside:
`packages/calendar/test/window-and-arithmetic.test.ts` and
`packages/tasks/test/no-arithmetic.test.ts` both now assert that their package names `Intl` nowhere
at all — each had an exemption list before the arithmetic moved somewhere every package could reach.

Every allowance the gate carries is printed on every run, and an allowance that outlives its
violation fails. A rule with a standing exemption is a rule that is not yet true of this repository,
and the run says so.
