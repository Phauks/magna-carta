---
category: Added
audience: public
---

**The notification centre, the live bell, and the member's preference matrix** — the three screens
that were `awaiting-screen` over an API that had shipped with no caller.

`apps/web/src/routes/(app)/notifications/+page.svelte` replaces the stub with the real feed: cursor
paged through the shared `PagedList`, narrowed by state and category as QUERY parameters so a
filtered read is cheaper rather than merely shorter, settling a row on follow and dismissing
separately, and reporting what the retention sweep took while unread. The top-bar bell became
`$lib/notifications/notification-tray.svelte` beside the download and upload trays, over a shared
count (`$lib/notifications/unread-count.svelte.ts`) polled slowly and on focus, paused while the page
is hidden, and never cleared by a failed read. `settings/notifications` is the member's per-category
matrix — one row, both channels — with the in-app switch disabled and its reason stated in words
where a mandatory category or the firm's floor holds it.

A notification row carries no sentence, so the card is composed on the client from the kind and the
declared facts (`$lib/notifications/notification-presentation.ts`). A kind that module has no entry
for renders as its category's own noun rather than being dropped: a client that shipped before a type
did must not swallow a notification somebody was meant to see.
`apps/web/test/notification-presentation.test.ts` scans the server's registry as text — apps/web does
not depend on `@magna-carta/notifications` and should not start — and fails when a registered kind has
no words here.

**One contract gap closed.** `POST /api/v1/notifications/read-all` requires a `throughCursor` naming
the newest row the member saw, and no route handed one out: `nextCursor` names the page's OLDEST row
and is null exactly when a member's whole backlog fits on one page. The subsystem's own test minted
the cursor by hand, which is why nothing had noticed. The feed page now reports `readThroughCursor`
beside `nextCursor`, and that test uses it, so the encoding stays in the one module that owns it.

## Public

Notifications you can actually see, and settings that decide which ones are worth your attention.

The platform has been writing notifications for a while — deadlines falling due, tasks assigned to
you, movements on client money, a file quarantined by scanning — and until now there was nowhere to
read them. The bell in the top bar is live: it carries a real count of what is waiting, and opens on
the newest few. **Notifications** is the full list, narrowed by category or down to just what you
have not read yet, with the record behind each item one click away. Following an item marks it read;
dismissing one is a separate, deliberate act, because having seen something and having dealt with it
are different statements.

**Settings · Notifications** is where you decide what reaches you. One row per category, with both
channels on it: whether it appears in the application, and whether it joins a daily or weekly summary
email or none at all. Your firm can require a category in the application — trust and security are
always on — and where it has, the row says so in words rather than leaving you with a switch that
silently refuses to move. Your firm can never raise what your mailbox carries: by email the choice is
yours.

A category you turn off writes nothing at all rather than hiding something you might later stumble
on. So that the difference between "nobody told me" and "I asked not to be told" stays visible, the
count of what your own settings have stopped is shown beside the switch that stopped it. The list
also tells you when notifications aged out of it while still unread, rather than showing you a
reassuring zero — everything they pointed at is exactly where it was.

Summary emails still carry counts only: how many items are waiting, in which categories, and a link.
Never a matter name or number, a filename, a subject line, a date or an amount. They also cannot
reach anybody until your firm's outbound mail is provisioned.
