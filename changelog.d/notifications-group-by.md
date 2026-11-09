---
category: Added
audience: public
---

**The notification centre groups its rows.** `apps/web/src/routes/(app)/notifications` passes the
grid a `grouping` from `notification-grouping.ts` and offers `DataTable.GroupByMenu`: Day (the
default, the reader's own calendar days, ordered with the sort direction), Category, Priority,
Matter, Read State, or No Grouping. Opened, the dismissed shelf is always the last band.

## Public

**Notifications can be grouped.** The list is grouped by day to begin with, newest day first, under
headings such as Today and Yesterday, each with a count. **Group By** at the top of the list groups
it by category, priority, matter or read state instead, or not at all. When you show your dismissed
notifications, they sit under their own Dismissed heading at the end.
