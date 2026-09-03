---
category: Added
audience: internal
---

`pnpm run lint:one-ui` now holds the one-table ruling, which until today was a header comment on `DataTable.Grid` and a row in the port plan's table of rules nobody had built.

Two rules. `raw-table` fails a `<table>`, `<thead>`, `<tr>`, `<th>`, `<td>` or a table ARIA role written anywhere outside the design system's data-table home, on both sides of the app/design-system line, one problem per file at its first element. `table-machinery` fails the half that rule cannot see: a screen that composes the presentational primitives correctly and then writes what the Grid already carries — a sortable header (`aria-sort`, the `mc-table-sort` recipe), the headless engine composed by hand (`createSvelteTable`, a direct `@tanstack/table-core` import) or the adapter's toolbar parts. That is the shape the ruling calls a defect by definition: a second answer to "what does clicking a header do", with the recipe on it so it reads fine in review.

The audit that preceded the rule: twelve surfaces render through `DataTable.Grid`, eighteen compose the primitives for a plain grid of facts, one page wrote a raw `<table>` (the speed test's sample list, now on the primitives) and one wrote its own sort (the firm-usage By Location table, recorded as an allowance that names the port it needs). Every rule is proved against known-bad input in the tool's own test file, and the allowance fails the run the day its violation is gone.
