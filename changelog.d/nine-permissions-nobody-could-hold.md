---
category: Fixed
audience: public
---

**Nine registered permissions were granted to no role, so the surfaces behind them refused
everybody.** The registry declares 102 keys; the `role_permission` seeds granted 90. Twelve were
declared and seeded nowhere, and nothing made up the difference:
`effectivePermissions` (`packages/access-control/src/resolver.ts`) is the union of a member's role
rows and their unexpired direct grants, with no wildcard and no owner bypass, and no statement in
`packages/data-access` writes either table — the migration seeds are the entire supply. So an absent
seed is not a default a firm can change; it is a 403 for every member of every firm, forever, that
reads exactly like a firm having configured things that way.

**Four of the nine are the co-editing surface**, enforced at the chokepoint since 2026-06-22 and
unreachable from that day: the editor launch (`documents:edit`), the offline checkout and its
check-in (`documents:checkout`), the divergent-copy resolution (`documents:reconcile`) and the
force-release of another member's lock (`documents:forceReleaseLock`). No test caught it because
every editing suite inserted its own `direct_grant` first — and one of them carried the comment "the
role-seeding migration lands at integration", which is where the migration stopped. Those suites now
hold nothing but seeded roles, so the denial each asserts is a seat the seed deliberately does not
reach rather than an artefact of its own setup.

**Five are Tools catalogue manifests** — the property-listing, county-records, business-entity,
attorney-licence and shipping tiles. `toolsByGroup` (`packages/tools/src/select.ts`) renders only the
tools whose permission the member holds, so four whole subject groups never appeared on `/tools` for
any seat. Every tool added to the catalogue after the baseline shipped with its own seed in the same
commit; these five were declared against a Tools shell that did not exist yet and the seeding never
followed the shell when it landed.

**The split, and why it is not one line.** `documents:edit` and `documents:checkout` reach the three
content-writing seats, exactly where `files:upload`, `files:organize` and `documents:assemble`
already sit — typing a new version and uploading one are the same act through two doors.
`documents:reconcile` stops at Owner/Admin and Attorney: choosing which of two divergent copies
becomes the firm's text of record is the `files:delete` bracket, not the drafting one.
`documents:forceReleaseLock` stops at Owner/Admin alone, because an override every editor also holds
is not an override; nothing deadlocks behind that, since the exclusive lock is opt-in and the
idle-checkout sweep frees a stale hold on the daily cron. The four link libraries reach every default
role — they open a public-record website and read nothing of the firm's — and the shipping tile
matches `shipping:manage` at Owner/Admin, because every operation behind that tile is gated on it.

**The other three are correct and were established rather than assumed.** `firm:provision` and
`support:mintSession` sit on `surface: "public"` routes whose session, authn and RBAC steps the
chokepoint skips by design (`apps/api-worker/src/http/chokepoint/chokepoint.ts`), so their permission is
nominal metadata beside a header-token guard. `diagnostics:overview` is carried by a diagnostic
support session through `resolveSupportPermissions`, never by a firm role, and seeding it would hand
every member the help-desk view the tier exists to keep separate.

**A firm provisioned before this migration gets the rows on its next wake**, since the per-firm
`FirmDatabase` applies pending migrations when it starts — asserted by splitting the committed
lineage at this tag and driving exactly that, with the same end state as a firm created today.

## Public

**Editing a document in the browser now works.** Opening a document in the editor, taking a copy away
to work on offline, checking it back in, resolving a conflict between two copies, and releasing a
lock somebody else left behind were all built and all refused — every member of every firm was told
they did not have permission, whatever their role. They now sit where the rest of your document work
already does.

Anyone who can upload a document can also edit one and take it offline: that is the Owner/Admin,
Attorney and Paralegal seats. Deciding which of two conflicting copies becomes the real one is
narrower — Owner/Admin and Attorney — because it can set aside somebody else's work. Breaking another
member's lock is narrower still and sits with Owner/Admin alone; a lock nobody is using is released
automatically overnight, so nobody has to wait for an administrator.

**Four groups of tools appear on the Tools page that were never visible to anybody.** Property
listings, county property records, business-entity lookups and attorney-licence lookups are ordinary
public-record links, so every seat sees them, including Read-only. Shipping and postage appears for
Owner/Admin, matching who can already connect the firm's postage account. Several of these still read
"Soon" until their own page is built — what changed is that they are now on the page at all.

Nothing was taken away from anyone: every change here is an addition, and it reaches firms already
using Magna Carta as well as new ones.
