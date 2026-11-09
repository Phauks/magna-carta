---
category: Added
audience: internal
---

**The one table can group its rows into bands.** `createDataTableGrid` takes a `grouping` thunk
(`GridGrouping`: `keyOf`, an optional `labelOf`, and an optional `order(keys, direction)` that may
flip with the sort), and `DataTable.Grid` renders a heading row per band with its count, sticky
beneath the measured header, plus an optional `bandDetail` snippet. Rows are sorted before they are
split, pinned rows stay above every band, and `rowsInView` follows the drawn order so keyboard and
range selection walk the rows as the reader sees them. `DataTable.GroupByMenu` is the matching
trigger and radio menu. The pure split is `bandedGridRows` in
`packages/design-system/src/lib/components/data-table/grid-rows.ts`; the Tasks and Notifications
screens are its first consumers.
