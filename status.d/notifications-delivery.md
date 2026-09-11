---
slice: Notifications — delivery
group: cross-cutting
order: 35
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: done by="Opus 5"
load-profile: todo
tested: todo
branch: claude/youthful-franklin-s4n2fw
active-work:
next: Provisioning, and coverage. The digest is built and cannot reach anybody until the sending domain, EMAIL_FROM and APP_BASE_URL exist (docs/deploy-queue.md). Coverage is now the largest gap the interface makes visible: thirty-nine topics already commit to the outbox with no registered type, so the feed shows less than the platform already knows. Three gaps left in the build — the deadline horizon comparison, which needs a firm lead-window setting nobody has specified; four of the five job coordinators, three of which record no requester; and the immediate-escalation send path, which no registered kind needs and a fitness test refuses until it ships. The FIRM tier of the policy has routes and no screen, and the channel port that would make SMS and push adapters rather than new delivery paths is unbuilt
link-spec: docs/specs/2026-08-06-notifications-delivery-design.md
link-plan: docs/specs/2026-08-06-notifications-delivery-implementation-plan.md
adrs: notifications-delivery-half, notifications-retention-and-swept-unread, a-comparison-is-a-third-production-path-and-the-registry-says-so, a-hearing-that-moved-is-not-a-hearing-that-was-edited, a-job-notification-is-a-reply-and-only-a-requester-can-receive-one, a-silenced-notification-is-counted-not-absent, a-digest-states-the-shape-of-the-queue-and-never-its-contents, a-dedupe-key-is-bounded-by-the-retention-window
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

**Not built in slice 4, deliberately:** any `apps/web` change. An email template is not a screen, and
the notification centre and the preference screens stayed deferred; `docs/user/` says plainly that the
digest cannot reach anybody until the firm's outbound mail is provisioned. (Slice 5 below builds both
screens; the provisioning sentence still holds.)

**Repaired in passing:** the per-firm drizzle snapshot had fallen one migration behind the schema
(the discovery processing-route migration was hand-written without refreshing it), so the next
`generate` would have emitted a destructive `review_document` rebuild. The snapshot is refreshed to
the lineage head.

**Slice 4 — what the dedupe key actually guarantees, resolved and named.** A correctness question
raised against the shipped subsystem: the UNIQUE index that makes a notification fire once lives on
`notification_event.dedupe_key`, and the retention sweep deletes that row, so the uniqueness that
enforces "once" does not outlive the firm's window. Settled as **the intended contract, not a defect**,
on the subsystem's own evidence: the design spec frames the key as a redelivery floor throughout (path
A "a redelivery is a no-op by construction", path B raising "once per day" in as many words), and each
production path's required lifetime is far shorter than the thirty-day retention floor — an outbox row
is published once and flipped out of `pending` so the relay never re-carries it, a comparison's bucket
is derived from the pass's own instant so it only ever moves forward, and a job reports each terminal
state once inside its own life. No shipped consumer relies on forever semantics, and the platform
already routes conditions that need it away from this key: the billing automations put their
convergence in `invoice_reminder` rows for exactly this reason and wrote down why.

So nothing durable was built. What was wrong was that the boundary lived only in another subsystem's
design document while the code said "dedupe key" and "UNIQUE" and left the reader to infer "once,
ever". The horizons are now declared per production path in `CONVERGENCE_HORIZON_BY_RAISER`, as a
`Record<NotificationRaisedBy, …>` so a fourth path is a **compile error** until it states one; both
`materialize.ts` and `retention.ts` name the boundary and the rule that follows it (a condition needing
once-per-subject-forever convergence carries it in the owning subsystem's own tables and points a
notification at that record); and `test/retention-convergence.test.ts` states the semantics out loud by
re-inserting a key the sweep took, then proves the property that makes it safe — the comparison bucket
follows the clock, so a swept bucket is unreachable rather than merely unlikely.

**One real hole closed beside it.** The comparison pass's per-kind findings cap was already counted
(`notifications.comparison_clamped`, over-reading by one to detect rather than infer). Its **zone
discovery** was not. The deadline comparison needs one cutoff per zone because no D1 query resolves a
zone, and that read was bounded at the same 200 with no over-read and no counter — so a truncated zone
list meant every deadline in an undiscovered zone matched neither the overdue bound nor the due-today
window, and the pass reported nothing about a whole jurisdiction with every other counter reading
healthy. It now over-reads by one and reports `notifications.comparison_zone_discovery_truncated`, kept
apart from the findings clamp because a clamp bounds what was missed and this does not bound it at all.
The value counts truncated **passes** rather than zones, because a read that over-reads by one to catch
its own truncation learns that it truncated and can never learn by how much.

**Left to the owner, not shipped:** whether 200 findings per kind per pass is the right ceiling. It is
counted rather than silent, but a busy litigation practice can exceed it honestly, and raising it
changes how much of a firm's overdue work gets reported — a firm-observable change and a load question,
recorded on the `notifications.scheduling` ledger node.

**Slice 3 gap closed — the firm's half of the settings had no writer.** A mechanical scan for exported
write-shaped functions with no production caller found three of them in this package, all in one
subsystem: the FIRM tier of the preference matrix (the in-app floor a member may not lower), the
retention window, and the digest local hour. Every one is read at evaluation time — the floor by the
shared recipient resolver on every fan-out, the window by the nightly sweep, the hour by the hourly
digest pass — and no route wrote any of them, so the floor could not be raised, the window could not
be changed and the summary landed at 07:00 for every firm on earth. The member API shipped; the firm
API did not, and the tests that covered the floor inserted the row themselves, which is why nothing
failed. Now `GET`/`PATCH /api/v1/firm/notifications/policy` under a new
`firm:manageNotificationPolicy` seeded to Owner/Admin — deliberately not the member key
`notifications:read`, which every default role including Read-only carries. Still not written by
anything: the firm's email DETAIL-LEVEL ceiling, which has no write statement in either tier and is a
separate gap rather than an omission here.

**Slice 5 built — the interface, and the one contract gap it exposed.** The read API, both preference
routes and the firm policy route had shipped with no caller: everything above was reachable only by
`curl`. Built: the notification centre (`/notifications`), which replaces the honest stub with the
real feed — cursor-paged through the shared `PagedList`, narrowed by state and category as QUERY
parameters so a filtered feed is cheaper rather than merely shorter, settling a row on follow and
dismissing separately, and stating what the retention sweep took while unread rather than showing a
reassuring zero. The top-bar bell became its own component beside the download and upload trays,
carrying a live unread badge over a shared count both surfaces read, polled on a slow interval and on
focus, and never cleared by a failed read. Settings · Notifications — the per-category
matrix — arrived on `main` from the settings stream while this one was in flight, and **that one
stands**: it is a table rather than a page of rows, it tracks a write per row, and it landed first.
This stream's own copy of that screen was dropped at the merge, and what survives from it is the
reconciliation the collision forced — the category's words and the preference transport now have
ONE home each (`category-vocabulary.ts`, `preferences-api.ts`), which the feed and the bell read
too, rather than a second vocabulary that would have drifted the first time either was edited.

The card is composed on the client from the kind and the declared facts
(`apps/web/src/lib/notifications/notification-presentation.ts`), because the row carries no sentence —
and a kind this client has never heard of renders as the category's own noun rather than being
dropped, so a client that shipped before a type did cannot swallow a notification somebody was meant
to see. `apps/web/test/notification-presentation.test.ts` scans the server's registry as text (apps/web
does not depend on the notifications package and should not start) and fails when a registered kind
has no words here — the same pairing scan, in the same direction, that the timeline registry gets.

**Contract gap found and closed: `read-all` was unusable by any client.** The route requires a
`throughCursor` naming the newest row the member saw, and no route handed one out — `nextCursor` names
the page's OLDEST row and is null at the end of the record, which is precisely the common case of a
member whose whole backlog fits on one page. The subsystem's own test minted the cursor by hand, which
is why nothing had noticed. The feed page now reports `readThroughCursor` beside `nextCursor`, and the
route test uses it instead of hand-minting, so the cursor's encoding stays in the one module that owns
it. The alternatives were both bad: mint it in the client, putting the encoding in a second place, or
fire one request per visible row, which is neither atomic nor able to clear the aged-out tally.
