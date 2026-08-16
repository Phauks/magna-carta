---
category: Added
audience: internal
---

**Notification preferences, the firm policy floor, and the one property that makes them safe: a
suppressed notification is counted, never merely absent.**

A member now sets, per category, whether it reaches their in-app feed and how often it is mailed —
one `notifications.preferences` key on the shipped `user → firm → default` scope chain, defaulting to
on in app everywhere and a daily mail except `jobs` and `system`. The two channels compose in
**opposite directions**, and that asymmetry is the decision rather than an implementation detail. In
app, the firm's tier is a **floor**: a firm may insist a category reaches its members and a member
cannot switch it back off. By email, the **member's tier wins**: a firm may never raise somebody's
cadence, because forcing email is forcing privileged-adjacent metadata into a mailbox the firm may not
administer, beyond both the audit log and the visibility filter. `security` and `trust` are
non-silenceable in app from either tier; a member may still set their email cadence to `off`.

**The part worth reading.** A category set `inApp: off` writes **no feed row** — not a hidden one, not
one somebody later discovers. Which produces the failure mode every preference system has: silence.
Afterwards, "nobody was told" and "this person asked not to be told" look identical, so a member
cannot be reassured and a real fan-out fault cannot be found. So the fan-out writes a
`notification_in_app_suppression` tally beside the rows it did write — member, category, civil day,
whose choice it was, and a count — and reports a `notifications.suppressed_by_preference` counter with
both closed labels. No event, no subject, no matter, no kind: a per-item record of what somebody
declined to hear would be a second feed holding exactly the pointers they asked not to be given. The
tally ages out on the firm's own retention window, and a member's preference read reports their own
back to them, so they can see that their choice and not a fault is why nothing arrived. An audience
everybody silenced is counted apart from an audience that resolved to nobody — only the second is a
bug.

**A firm may also designate trust-compliance recipients** — a firm-tier list, written under
`trust:manage` and audited by count and never by name, whose members join the recipient set of every
trust-category notification on top of whatever the kind's audience already resolves. **A designation
is not a grant of access:** the designated member gets an ordinary recipient row and the shipped
visibility filter still decides at read, so a notification about a matter they may not see leaves
their feed and their unread count byte-identical to a firm where it was never raised — no placeholder,
which would be an existence oracle.

**API, no screen:** `GET`/`PATCH /api/v1/notifications/preferences` (the member's own, scoped to the
session and never a path parameter; the `PATCH` audited with the categories touched and never a
subject, a matter, or a recipient) and `GET`/`PUT
/api/v1/firm/notifications/trust-compliance-recipients`. The notification centre and the preference
screen remain unbuilt, so `docs/user/` gains nothing here — there is no surface a member can reach yet.

**Also repaired in passing:** the per-firm drizzle snapshot had fallen a migration behind the schema,
so the next `generate` would have re-emitted a full `review_document` table rebuild against firms that
already have the columns. The snapshot is refreshed to the lineage head; the new migration adds one
table and nothing else.
