---
category: Fixed
audience: internal
---

**Six more surfaces named the wrong day, and the gate that missed them now reads the argument rather than the operation.** "Opened", "Closed" and "On hold since" on the matter overview; "Created" and a credit note's "Opened" on the invoice window; "On hold since" on the matter status dialog.

All six passed a stored instant to `formatDate` — with no slice anywhere, which is why the rule written last round did not see them. `formatDate` pins to UTC deliberately, because a recorded day must not move under the reader; hand it a moment and that pinning is exactly what makes the wrong answer silent rather than loud. `matter.openedAt` is written as `openedAt: now` beside `createdAt: now` from the same clock, so the matter overview named the following day for every matter opened after late afternoon in an American office.

The lesson is the rule's, not the six sites'. Slicing was only ever one _spelling_ of "take the day of an instant"; the rule now keys on the argument's name — the `At` suffix this codebase uses consistently enough that the schema's column scan relies on the same convention — and deliberately says nothing about `validFrom`/`validTo`, which are dual-shape by design, or anything ending `AtTime`, which is a wall clock.

**And the seam that made all ten possible is now one.** Seven print sheets each declared their own formatting context, with the date parameter named `isoDate` in five and `civilDate` in two. That disagreement was a record of nobody being sure what the function took. `apps/web/src/lib/print-sheet/` declares the pair once — `date` for a day the firm wrote down, `instantDate` for the day a moment fell on — and a supplier calls `printSheetDates()` instead of wiring two closures, so it cannot wire them to the wrong pair. Nine suppliers collapsed to that one call.

The calendar entry sheet keeps its own `date`, because it prints "Tuesday, September 15, 2026" and that is a genuine per-sheet choice; it takes `instantDate` from the shared set like everything else.
