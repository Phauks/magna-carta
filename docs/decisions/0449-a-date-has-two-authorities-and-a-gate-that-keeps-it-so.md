---
number: 449
slug: a-date-has-two-authorities-and-a-gate-that-keeps-it-so
status: Proposed
date: 2026-09-08
area: Core domain
summary: "Date handling splits into exactly two authorities, mirroring money: a new dependency-free leaf package `@magna-carta/civil-time` owns what a civil date, a wall-clock time, a canonical stored instant and a time zone ARE — the shapes, the guards, the zoned projection, and plain calendar-day counting — and the design system's `formatters/` own how each reads to a person. The leaf package having no workspace dependencies is the load-bearing property rather than a tidiness preference: every one of the roughly seventy duplicates this replaces sat in a package that could not reach the one already holding the function, which is why `packages/notes` and `packages/tasks` each wrote a zone check that accepted a fixed offset the calendar's refused, and why only `packages/ledger`'s day check excluded year 0000. Both stricter rules become everyone's. The split is enforced by a source-scan fitness function, `pnpm run lint:date-handling`, derived into the inner loop and CI by the existing repo-wide lint derivation; its rules match the shapes the copies actually took, its findings carry accurate file:line because comments are blanked rather than removed, and every allowance it carries is printed on each run and fails once it outlives its violation. Two package fitness tests that previously exempted named files from touching `Intl` now assert the absence outright — those exemptions were what made the neighbouring packages write their own copies. Elapsed time stays banned for a record, with one stated carve-out for the age of a live measurement. The fifteen surfaces still holding a native date input rather than the DatePicker are recorded and closed rather than migrated, because whether they should all move is the owner's design question and not a scan's."
---

**A date has exactly two authorities — what it IS, and how it READS — and neither borrows the
other's job.**

**Context:** date handling was the most-duplicated logic in the repository, and every copy of it was
correct. That is what made it expensive rather than harmless: nothing was broken, so nothing drew
attention, and the copies accumulated.

The census: six implementations of "is this a real calendar day" (`packages/calendar`,
`packages/notes`, `packages/tasks`, `packages/matter-assets`, `packages/conflicts`,
`packages/ledger`, plus a fifth in the web app), three of "is this a resolvable time zone", about
forty copies of the civil-date pattern as a bare literal, six of the canonical-instant pattern, six
of the date picker's value reader — four of them carrying the same comment word for word — and nine
surfaces each printing a recorded moment in their own words.

Two had already drifted, silently and in the direction that matters. The calendar's zone check
refused a fixed offset like `+05:00`, because an offset is wrong for half the year in every zone
that observes daylight saving and storing one is how a hearing moves by an hour when the clocks
change; the copies in `packages/notes` and `packages/tasks` accepted one, so a note could store a
zone a calendar entry could not. And of the six day checks, only `packages/ledger`'s excluded year
0000 — which round-trips in V8 as the astronomical year zero, on which engines differ, and is no
date any record here is about.

Neither drift was a mistake anybody made. They are what a duplicate that is right looks like just
before it stops being.

**Decision:** two homes, mirroring `@magna-carta/money` and `formatters/money.ts` exactly.

`@magna-carta/civil-time` — a new leaf package with **no workspace dependencies at all** — owns the
four shapes and their guards, the zoned projection (`zonedReading`, `instantForCivilDateTime`,
`endOfCivilDayInstant`, moved out of `packages/calendar`), the viewer's own zone, and
`addCalendarDays`. The design system's `formatters/` own every wording, gaining `formatDateRange`,
`formatMonth`, `formatInstantDate` and `formatTimeOfDay` so the surfaces that were writing their own
had something to call.

The absence of dependencies is the decision, not a side effect of it. The zoned arithmetic already
existed, in `packages/calendar`, which depends on data access and the database — so the packages
that most needed it could not import it, and wrote their own. A leaf package is what makes "use the
shared one" available to a route module, a Worker, a screen and a domain package alike.

The stricter of each pair of drifted rules becomes the shared one: a fixed offset is refused
everywhere, and year 0000 is excluded everywhere.

**Enforcement:** `pnpm run lint:date-handling`, a source scan in the style of `lint:one-ui`. Adding
the script to the root `package.json` is the whole of the wiring — `tooling/check-scoped/repo-wide.mjs`
derives the repo-wide lint set from those scripts, so it runs in the inner loop and in CI with no
list to remember. Its rules match the shapes the copies actually took rather than a general idea of
a date, it blanks comments to spaces rather than deleting them so every reported `file:line` is the
real one, and its allowances are printed on every run and fail once they outlive their violations.

Two existing package fitness tests are strengthened rather than repointed:
`packages/calendar/test/window-and-arithmetic.test.ts` and
`packages/tasks/test/no-arithmetic.test.ts` each exempted named files from touching `Intl`, and both
lists are now empty. The exemptions were the mechanism: a package with a licensed local copy is a
package its neighbours cannot import from.

**What is deliberately not enforced.** `new Date().toISOString()` for a stored instant — three
hundred sites, one method call, one meaning, no policy in it; a rule firing on all of them would
teach people to switch the gate off, and what actually matters is the PATTERN that validates the
result, because a loosened pattern reorders a text-compared sort without failing. And whether a
surface picked the right formatter: `formatDate` and `formatInstantDate` are both correct calls and
differ by a day, and only a person reading the surface can say which it wanted.

**The storage layer, and why the gap is frozen rather than closed.** The schema had the same
fragmentation: nineteen columns across seven recently built tables guard the shape of the day or the
clock they hold, and thirty-two older ones across the ledger, time, costs, billing, trust, custody
and the directory do not. The wall-clock guards that exist had already drifted the way the zone
checks had — `[0-2][0-9]:[0-5][0-9]` reads like the shape and accepts 24:00, 25:10 and 29:59, which
`WALL_CLOCK_TIME_PATTERN` refuses. The guards now derive from the same shapes as SQLite globs,
proven equivalent by a test running a corpus through a real CHECK; glob rather than regex because
neither D1 nor a Durable Object registers the REGEXP hook, and glob's lack of alternation is why the
wall clock needs two alternatives OR'd. The old columns are RECORDED and not retrofitted: adding or
narrowing a CHECK in SQLite is a table rebuild, and a rebuild of a table other tables point at cannot
complete against a firm database holding data. The recorded lists may only shrink, so the one
classification open to a new date column is the guard.

**A wrong-shaped date fails by name, and a compile-time brand was rejected to get there.** Branding
`CivilDate` and `CanonicalInstant` was the obvious way to catch the confusion the scan cannot make,
and it is the wrong tool: a brand is erased at runtime, and the wrong-shaped values arrive at runtime
from D1 columns and request bodies — thirty-two of those columns carrying no shape CHECK, so a
civil-date column genuinely can hold an instant today. The brand would assert what the database does
not enforce and be wrong in the one case that matters, while costing 162 call sites a cast, and a
cast is a lie that typechecks. The check is at runtime instead, at the entry points, where the value
actually is. It replaces nothing that worked: `civilDateParts` returned a NaN day in silence and its
consumers surfaced `RangeError: Invalid time value`, naming no function, argument or value. The
failure was never the problem; the diagnosis was.

**The wrong-day mistake has two spellings, and the second shipped more of it.** `formatDate(x.createdAt.slice(0, 10))` was the one the first gate rule caught; `formatDate(x.createdAt)` — no slice at all — was six further surfaces, on the matter overview, the invoice window and the matter status dialog. `formatDate` pins to UTC deliberately, so that pinning is what makes a moment passed to it silently wrong rather than loudly. The rule now keys on the ARGUMENT rather than the operation, reading the `At` suffix this codebase uses consistently enough that the schema column scan relies on the same convention. What made both spellings possible was seven print sheets each declaring their own formatting seam, with the date parameter named `isoDate` in five of them and `civilDate` in two — a disagreement that was a record of nobody being sure what the function took. That seam is now one interface with both questions named separately, and a supplier takes the pair through one call rather than wiring two closures.

**Consequences.** Elapsed time remains banned for a record, with one stated carve-out — the age of a
live measurement, whose whole subject is how long ago it was taken, and which falls back to the
absolute instant where it cannot compute an age. The fifteen surfaces still holding a native
`<Input type="date">` rather than the `DatePicker` are recorded and closed rather than migrated:
whether they should all move is a design question with real trade-offs and it belongs to the owner,
so the gate stops the split growing and leaves the question open.
