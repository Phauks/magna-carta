---
worktree: C:/dev/magna-carta-worktrees/claude/date-handling-audit-xx8q3o
area: One home for date handling — @magna-carta/civil-time, the design system's date formatters, the gate that keeps them the only copies, and the one field every date is typed into
status: review
touches: packages/civil-time, packages/design-system/src/lib/components/date-picker, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/formatters, packages/design-system/src/stories, packages/calendar, packages/notes, packages/tasks, packages/ledger, packages/matters, packages/matter-assets, packages/conflicts, packages/trust, packages/notifications, packages/locations, packages/reporting, packages/directory, packages/document-assembly, packages/custodian, packages/status, packages/fixtures, packages/inference, packages/product-updates, packages/database, packages/wellbeing-resources, apps/api-worker, apps/web, tooling/lint-date-handling, CLAUDE.md, docs/conventions/dates.md, docs/conventions/README.md, package.json, vite.config.ts
---

Three passes, one stream. The first landed as #577; the branch carries the follow-up work rather
than starting a new one, because the question each pass answered was the same question.

**One home for the shape and the display.** New leaf package `@magna-carta/civil-time` owns what a
civil date, a wall-clock time, a stored instant and a time zone ARE; the design system's
`formatters/` own how each reads. Removes six implementations of "is this a real calendar day",
three of "is this a resolvable zone" (two of which accepted a fixed offset the third refused), about
forty copies of the civil-date pattern, six of the canonical-instant pattern, six of the date
picker's value reader, and nine surfaces that each printed a moment their own way.
`pnpm run lint:date-handling` is the gate; `docs/conventions/dates.md` is the ruling ledger.

**The wrong-day bug had a second spelling.** Six more surfaces passed a stored instant to
`formatDate` with no slice anywhere — "Opened", "Closed" and "On hold since" on the matter overview,
"Created" and a credit note's "Opened" on the invoice window, "On hold since" on the matter status
dialog. The rule now reads the ARGUMENT rather than the operation. And the seam that made all ten
possible is one: seven print sheets each declared their own date formatters, with the parameter
named `isoDate` in five and `civilDate` in two; `$lib/print-sheet` declares the pair once.

**Every date is typed into the same field** (owner's ruling, 2026-09-08). Sixteen surfaces held a
native `<Input type="date">`; all sixteen are the `DatePicker`, and the gate's allowance list is
empty and asserted empty. The picker gained the Input's `size` scale, an `aria-label`/`aria-invalid`
that reach the segment group, and the CalendarDate/text conversion moved beside it so a
design-system component could use it without importing the app.

Touches a very wide set of files but most of it is import rewiring. The load-bearing edits are the
new package, `packages/design-system/src/lib/formatters/{civil-date,instant}.ts`,
`packages/design-system/src/lib/components/date-picker/`, `apps/web/src/lib/print-sheet/`, the two
fitness tests whose exemption lists this removes
(`packages/calendar/test/window-and-arithmetic.test.ts`, `packages/tasks/test/no-arithmetic.test.ts`),
and `tooling/lint-date-handling/`. A concurrent stream adding a date field, a date-shaped validator,
or a print sheet will meet the gate; one touching the data table's column filters or the design
system's date picker will meet the third pass.
