# The formatters — CLAUDE.md

How a date, an instant or a value reads on screen in `@magna-carta/design-system`, and the one place that decides it. The package-wide rules are in [`../../../CLAUDE.md`](../../../CLAUDE.md).

## The formatters: how a value READS, and the one place that decides

**`src/lib/formatters/` is the platform's display vocabulary** — how long, when, which day, how much,
who, which version, and what a field's ghost text says. Each function encodes a ruling already
issued, and a second answer to any of them is a correction that has to be re-issued screen by screen.
The date half is enforced by `pnpm run lint:date-handling`; the standing rules are
[`docs/conventions/dates.md`](../../../../../docs/conventions/dates.md).

- **What a date IS is not this package's question.** Shape, guards and arithmetic live in
  `@magna-carta/civil-time`; these functions turn one into words. Same split as `@magna-carta/money`
  and `formatters/money.ts`, deliberately.
- **`formatDate` / `formatDateRange` / `formatMonth` (civil-date.ts) pin to UTC. Always.** A recorded
  day is a day the firm wrote down; formatted in any other zone it is an instant again, and the same
  work date reads as the 12th in one office and the 11th in another. Every function in that file goes
  through one `civilFormatter` constructor for exactly this reason — do not add one that does not.
- **`formatInstant` / `formatInstantDate` / `formatTimeOfDay` (instant.ts) render in the VIEWER'S
  zone.** A moment happened to somebody, and a person reading a history is asking when it happened to
  them. `formatInstantDate` and `formatDate` are the twins that differ by a day, and both are right —
  a file uploaded at 23:40 in Boston was uploaded on a different day in Reno.
- **NEVER elapsed time.** "Just now", "2 hours ago" and their family are banned: they decay while the
  reader looks at them, two rows carrying them cannot be compared, and a record is a record. The one
  carve-out is the age of a LIVE measurement (a cached probe, a status snapshot), recorded by name in
  the gate's allowance list.
- **An unreadable value renders as the text that arrived.** A blank or a cheerful "Invalid Date" hides
  a defect that showing the data makes obvious.
- **`precision` and `length` are closed sets, not passthroughs.** `timeStyle` / `dateStyle` are not
  exposed, because an open knob is how a fourth way to print a moment gets in.
- **The patterns these sit beside carry no regex flags.** The OpenAPI emitter writes a regex's flags
  into the JSON Schema `pattern`, so a `/u` reaches every generated client as a pattern matching
  nothing. Pinned by `packages/civil-time/test/civil-date.test.ts`.
