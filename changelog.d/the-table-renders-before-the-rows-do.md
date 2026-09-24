---
category: Changed
audience: public
---

**Where a data table will hold the rows, the table renders first.** The owner's ruling of
2026-09-18, on the Downloads and Uploads registers: "downloads and upload pages should show the
table data would populate in, even if there is no data. i want this as a lint and standard rule,
that data tables will still appear before data is in the area. this prepares users for the proper
shape." The header row now stands from the first paint and the words about the emptiness live in
the table's own empty body, under it.

`DataTable.EmptyRow` is the new part that carries them for a hand-composed table: one row, one cell
spanning every column, one line in the table's muted register, styled by the same recipe as the
grid's own empty state and marked `data-placeholder` so it takes none of a row's treatment. Surfaces
built on `DataTable.Grid` needed no part — the grid already draws its header over its own empty body
and says "No Results" there — only the gate in front of it removed.

The fitness function gained a third rule, `table-behind-absence`
(`tooling/lint-structured-empty/`), which reads a Svelte file's markup tree for a data table gated
behind the absence of its own rows: a conditional whose absence branch renders the product's one
`EmptyState` where its other branch renders the table, and the same arrangement one layer in, where
a region is handed an `emptyState` snippet that replaces the table it would otherwise render. It
follows the table through any depth of snippet, and it deliberately leaves a refusal and a failure
alone — a member who may not see the table, and a read that broke, are not tables waiting to fill.
The inline `<!-- structured-empty-allow: <why> -->` works for it as for the other two.

What it found, and what changed: Downloads, Uploads, the directory record's names, categories,
matters, relationships and near-matches panes, the matter calendar's deadlines and events, an
event's bookings, the matter activity register, and the file inspector's versions and checks.

## Public

**A register shows its shape before it holds anything.** Open Downloads before you have exported
anything, or Uploads before you have sent a file, and the table is there — its column headings over
one line saying it is empty — rather than a sentence on a blank page. A search that matches nothing
says so in the same row, so the columns never disappear under you. The same is true of a record's
names and relationships, a matter's deadlines and events, and a file's versions and checks.
