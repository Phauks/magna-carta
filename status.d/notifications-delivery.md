---
slice: Notifications — delivery
group: cross-cutting
order: 35
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: todo
load-profile: todo
tested: todo
branch: main
active-work: claude/notifications-3
next: The email digest (slice 4, blocked on owner flags E1 and C1). Two gaps left inside slice 2 — the deadline horizon comparison, which needs a firm lead-window setting nobody has specified, and four of the five job coordinators, three of which record no requester
link-spec: docs/specs/2026-08-06-notifications-delivery-design.md
link-plan: docs/specs/2026-08-06-notifications-delivery-implementation-plan.md
adrs: notifications-delivery-half, notifications-retention-and-swept-unread, a-comparison-is-a-third-production-path-and-the-registry-says-so, a-hearing-that-moved-is-not-a-hearing-that-was-edited, a-job-notification-is-a-reply-and-only-a-requester-can-receive-one, a-silenced-notification-is-counted-not-absent
blocked-by:
---

Slice 1 built: five per-firm tables, the type registry with its validated fact grammar, a second
non-exclusive translator pass on the shipped per-firm queue (no producing package changed —
thirty-one topics already commit transactionally), the member-scoped read API behind
`notifications:read`, the firm-ceiling email detail level, and the firm-configurable retention window
with its nightly sweep and its swept-unread tally.

Slice 2 built: the comparison-driven production path as a declared third `raisedBy` on the registry
with its own index, a per-firm sweep on the daily cron calling the calendar's own overdue arithmetic
and the custody register's own collection point, once-per-civil-day dedupe bucketed in the subject's
own zone, the three calendar matter-event outbox topics (with `rescheduled` raised on a move and not
on an edit), and the document-assembly coordinator's completion row. Retention and the email-filing
topic, both listed under slice 2 in the plan, had already shipped with slice 1 and were verified
rather than rebuilt.

Slice 3 built: the per-category preference matrix on one `notifications.preferences` scoped-setting
key, with the two channels composing in opposite directions (the firm's tier is a floor in app, the
member's choice wins by email); the mandatory in-app floor on `security` and `trust` from either
tier; enforcement at fan-out in the one shared recipient resolver, so all three production paths
inherit it; a sixth per-firm table, `notification_in_app_suppression`, so a silenced notification is
a counted fact rather than an absence, swept on the firm's own retention window; the firm-tier
trust-compliance designation, applied to the trust category and audited by count; and the member and
firm preference API. **Deviation:** the plan's `notification_delivery` row with
`suppressed_reason = 'not-visible'` at fan-out is not built — the column is `NOT NULL` against a
recipient row that by definition does not exist, and deciding visibility at fan-out is the
emission-time enforcement this subsystem refuses. The designated member gets an ordinary recipient
row and the shipped read filter decides, which is what makes their feed byte-identical to a firm
where nothing was raised.

**Repaired in passing:** the per-firm drizzle snapshot had fallen one migration behind the schema
(the discovery processing-route migration was hand-written without refreshing it), so the next
`generate` would have emitted a destructive `review_document` rebuild. The snapshot is refreshed to
the lineage head.
