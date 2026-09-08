---
category: Changed
audience: internal
---

**A date that is the wrong kind of date now fails by name, and every new date column carries a shape guard.** Two follow-ons to the date consolidation, both aimed at the same confusion: a stored instant handed to a function that takes a day is a whole day out, and both are strings.

The storage layer turned out to have exactly the fragmentation the code did. Nineteen columns across seven tables check the shape of what they hold — calendar, notes, tasks, matter assets, every one recently built. Thirty-two older columns across the ledger, time, costs, billing, trust, custody and the directory carry no guard at all. Nobody decided that; there was nothing shared to point at.

And the guards that existed had already drifted, the same way the zone checks had. Every wall-clock column checks `[0-2][0-9]:[0-5][0-9]`, which reads like the wall-clock shape and is not: verified against real SQLite, it accepts `24:00`, `25:10` and `29:59`. Nothing writes one, because every write path goes through `isWallClockTime` — the point is that the backstop was looser than the schema read as promising.

The guards now come from the platform's own shapes, as globs proven equivalent to the patterns by a test that runs a boundary corpus through a real `CHECK` rather than eyeballing one against the other. Eyeballing is how the loose spelling happened. The old columns are recorded rather than retrofitted: adding or narrowing a `CHECK` in SQLite is a table rebuild, and a rebuild of a table other tables point at cannot complete against a firm database holding data. The recorded lists may only shrink, so the one classification still open to a new date column is the guard.

The runtime half is the diagnosis. `civilDateParts` used to return `{ year: 2026, month: 9, day: NaN }` for a stored instant — silently, since every field is still a number — and everything built on it surfaced as `RangeError: Invalid time value`, naming no function, no argument and no value. Now it says which function, which argument, what the value is, and what to do: _"addCalendarDays: the civil date … is a stored INSTANT, not a day"_.

A compile-time brand was the obvious answer and was rejected on the evidence: a brand is erased at runtime, the wrong-shaped values arrive at runtime from columns that mostly carry no `CHECK`, so it would assert what the database does not enforce and be wrong exactly when it mattered — while costing 162 call sites a cast. The reasoning is recorded in `docs/conventions/dates.md` so it is not re-proposed.
