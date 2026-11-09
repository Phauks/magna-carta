---
category: Changed
audience: public
---

**The notification centre is the product's one grid.** `apps/web/src/routes/(app)/notifications`
renders on `DataTable.Grid` with a declared column model (`notification-columns.ts`): a leading
read-state check, Notification, Details, Matter, Category, Priority and When, with Dismiss or Restore
pinned to the trailing edge on every row. The Everything/Unread toggle and the category select are
gone; their questions are the Status and Category column filters. The feed reads unread and read
rows together (`state` on `GET /api/v1/notifications` now repeats), and the dismissed rows are a
second read the member opens from the foot of the table, ordered after the live rows and drawn
quiet. New route `POST /api/v1/notifications/{id}/restore` returns a dismissed row to the feed as
read. Priority shows only Urgent or Needs Attention; informational rows have no word. The bell tray
leads with the most pressing of its rows, says "No Results" when empty, and links to "Open
Notifications". The `email.filed` kind now reads "Email saved to a matter".

## Public

**Notifications is now a table you can sort and filter.** Narrow it from the column headings (unread,
category, priority), mark an item read with the check at the start of its row, and dismiss what you
are finished with. Dismissed items are no longer mixed in with the rest: **Show Dismissed** at the
foot brings them back into view, and **Restore** puts one back in the list. The bell now shows the
most urgent items first.
