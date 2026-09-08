---
worktree: C:/dev/magna-carta-worktrees/claude/date-consolidation-continued
area: Finishing the date consolidation — the second spelling of the wrong-day bug, the print-sheet formatting seam that made both possible, and every native date field moved onto the DatePicker
status: review
touches: apps/web/src/lib/print-sheet, apps/web/src/lib/billing, apps/web/src/lib/time, apps/web/src/lib/costs, apps/web/src/lib/matters, apps/web/src/lib/calendar, apps/web/src/lib/activity, apps/web/src/lib/communications, apps/web/src/lib/directory, apps/web/src/lib/auth, apps/web/src/lib/dates, apps/web/src/routes/(app)/matters, packages/civil-time, packages/design-system/src/lib/components/date-picker, packages/design-system/src/lib/components/data-table, packages/design-system/src/stories, tooling/lint-date-handling, docs/conventions/dates.md
---

Follows the date consolidation that landed in #577. Two things it did not reach.

Six more surfaces named the wrong day, in the spelling the first pass did not look for: a stored
instant passed straight to `formatDate` with no slice — "Opened", "Closed" and "On hold since" on the
matter overview, "Created" and a credit note's "Opened" on the invoice window, "On hold since" on the
matter status dialog. The gate's rule now reads the ARGUMENT rather than the operation, because
slicing was only ever one spelling.

And the seam that made all ten possible is now one: seven print sheets each declared their own date
formatters, with the parameter named `isoDate` in five and `civilDate` in two. `$lib/print-sheet`
declares the pair once and nine suppliers collapsed to `printSheetDates()`.

Touches the same date surfaces as #577 across billing, time, costs, matters and calendar, so a
concurrent stream editing a print sheet's context or a matter overview fact will meet it. The ruling
ledger is `docs/conventions/dates.md`.

Then the owner ruled, on 2026-09-08, that every date is entered through the `DatePicker` — closing the
one question the first pass had deliberately left open and recorded. All sixteen native date fields
moved, the gate's allowance list is empty and asserted empty, and the picker gained the three things
the last two surfaces needed: the Input's `size` scale, an `aria-label` that reaches the segment group
rather than the DOM-less root, and the CalendarDate/text conversion moved beside it so a design-system
component could use it without importing the app.

That widens the overlap: any stream touching a form with a date field, the data table's column filters,
or the design system's date picker will meet this one.
