---
category: Changed
audience: internal
---

**A date now has exactly two authorities, and a gate that keeps it so.** `@magna-carta/civil-time` (new, no workspace dependencies) owns what a civil date, a wall-clock time, a stored instant and a time zone ARE; the design system's `formatters/` own how each reads. `pnpm run lint:date-handling` fails a third.

Nothing here was broken, which is the point. Every copy agreed, so nothing drew attention: six implementations of "is this a real calendar day", three of "is this a resolvable time zone", about forty copies of the civil-date pattern, six of the canonical-instant pattern, six of the date picker's value reader, and nine surfaces each printing a recorded moment in their own words.

Two of them had already drifted. Of the three zone checks, the calendar's refused a fixed offset like `+05:00` — an offset is wrong for half the year wherever clocks change — and the copies in `packages/notes` and `packages/tasks` accepted one, so a note could store a zone a calendar entry could not. Of the six day checks, `packages/ledger`'s alone excluded year 0000, which round-trips in V8 and is no date any record is about. Both stricter rules are now everyone's.

The leaf package having no workspace dependencies is the load-bearing part. Every hand-written copy sat in a package that could not reach the one that already had the function.

Two package fitness tests got stronger rather than being repointed: `packages/calendar` and `packages/tasks` each had an exemption list naming the files allowed to touch `Intl`, and both lists are now empty — the exemptions were what made the other packages write their own.

Sixteen surfaces held a native `<Input type="date">` rather than the `DatePicker`, recorded rather than failed while whether they should all move was still an open design question. The owner settled it days later and they are all the component now; the list is empty and asserted empty. Standing rules: `docs/conventions/dates.md`.
