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
branch: claude/notifications-4
active-work:
next: Provisioning, then the user interface. The digest is built and cannot reach anybody until the sending domain, EMAIL_FROM and APP_BASE_URL exist (docs/deploy-queue.md). Three gaps left in the build — the deadline horizon comparison, which needs a firm lead-window setting nobody has specified; four of the five job coordinators, three of which record no requester; and the immediate-escalation send path, which no registered kind needs and a fitness test refuses until it ships
link-spec: docs/specs/2026-08-06-notifications-delivery-design.md
link-plan: docs/specs/2026-08-06-notifications-delivery-implementation-plan.md
adrs: notifications-delivery-half, notifications-retention-and-swept-unread, a-comparison-is-a-third-production-path-and-the-registry-says-so, a-hearing-that-moved-is-not-a-hearing-that-was-edited, a-job-notification-is-a-reply-and-only-a-requester-can-receive-one, a-silenced-notification-is-counted-not-absent, a-digest-states-the-shape-of-the-queue-and-never-its-contents
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

Slice 4 built: the email digest — the first time this subsystem hands anything to a mailbox, and the
first consumer of slice 3's per-category email cadence. A digest window read added to the ONE shared
read the feed and the unread count already compose, so the wall binds at delivery time in one
implementation; a keyset watermark (an instant AND its event id) per member per cadence; a renderer
whose entire vocabulary is a closed category label, an integer, a cadence and a configured origin, so
there is no argument a title could arrive in; and an hourly per-firm run anchored to the firm's own
morning, resolved from the default office the calendar already books against rather than a second
copy of where the firm is. Send first, mark second, both committed in one batch. A member with
nothing visible in the window gets no email. **Every row a run did not mail is settled** as a
`suppressed` `notification_delivery` row naming a closed reason — `preference` where the member's
cadence for that category is `off` or the resolved detail level is `off`, `no-address` where there is
no mailbox — so a member who chose not to be written to stays distinguishable from a member the
platform silently failed to write to, which is the in-app suppression tally's requirement met with
the mechanism the schema already had.

**Deviation 1 — the immediate escalation.** The plan's task 4.3 asks the run to honour a
registry-declared `escalation: "immediate"` for trust and security kinds. No registered kind declares
one, and an immediate send has no trigger without editing the raise paths, so the sender would be
untriggered code while leaving such kinds in the digest would quietly mail a compliance-grade notice
inside a day's counts. Built instead: the walk HALTS at the first such row, leaving the watermark
behind it so nothing is settled that no channel carried, and a fitness test asserts no type declares
`immediate` today. Registering the first one is a gate failure until its send path ships.
`emailContent: 'recipient-scoped'` gets the same treatment for the same reason.

**Deviation 2 — the send port.** The digest resolves its own rather than reusing `emailAdapterForEnv`,
which falls back to the dev logging adapter when the Email Service binding is absent. Right for a
password reset; catastrophic here, because the run would record `sent` rows and advance watermarks
for mail printed to a log, and the member would never hear about those notifications again. The
digest port reports one of three typed not-configured reasons instead, counted every pass.

**Not built, deliberately:** any `apps/web` change. An email template is not a screen, and the
notification centre and the preference screens stay deferred; `docs/user/` says plainly that the
digest cannot reach anybody until the firm's outbound mail is provisioned.

**Repaired in passing:** the per-firm drizzle snapshot had fallen one migration behind the schema
(the discovery processing-route migration was hand-written without refreshing it), so the next
`generate` would have emitted a destructive `review_document` rebuild. The snapshot is refreshed to
the lineage head.
