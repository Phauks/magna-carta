# Notifications

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Notifications -->

- id: notifications
  name: Notifications subsystem
  scope: One home for the decision (event, audience, channels, preferences, read state) and in-app delivery, delegating external delivery to communications-layer ports; replaces per-feature trigger code.
  status: partial
  adrs: ADR-0059, ADR-0251, ADR-0258
  spec: docs/specs/2026-08-06-notifications-delivery-design.md
  evidence: packages/notifications + six per-firm tables + the read API + the comparison-driven per-firm sweep + the per-category preference matrix + the counts-only email digest shipped; there is still no user interface, and the digest cannot reach anybody until outbound mail is provisioned (docs/deploy-queue.md).
  audience: public
  public-name: Notifications
  public-summary: Be told when something needs you, in the app and by email, and only ever about matters you already have access to.

- id: notifications.registry
  name: Notification type registry
  scope: Declarative types: key, category, internal/external audience, severity, mandatory flag, eligible channels with default routing, channel-aware templates, cadence, audited flag; fitness-function introspectable.
  status: shipped
  surface: internal
  adrs: ADR-0059, ADR-0251
  evidence: packages/notifications/src/registry.ts, with the declaration rules held by packages/notifications/test/registry-fitness.test.ts.
  notes: Twenty types registered. A type declares its production path (raisedBy — outbox-topic, comparison-sweep, or job-coordinator), the emission point it names, its subject kind, its matter anchoring, its non-privileged fact schema, and its email content level. A fitness test asserts each type is indexed under exactly one path, and that a matter-anchored type does not reach a single member unless it is on a list saying why. Each path also declares how long its dedupe key must hold (CONVERGENCE_HORIZON_BY_RAISER in packages/notifications/src/materialize.ts) — the uniqueness lives on a row the retention sweep deletes, so a fourth path is a compile error until it states a horizon shorter than the retention floor, and a condition needing once-per-subject-forever convergence carries it in the owning subsystem's own tables instead.

- id: notifications.recipients-preferences
  name: Recipients & preferences
  scope: Recipient resolution to a firm member or Directory entity; per-user channel matrix on the settings scope chain; mandatory categories non-silenceable; external routing honors STOP/TCPA consent.
  status: partial
  surface: screen
  evidence: Settings - Notifications (apps/web/src/routes/(app)/settings/notifications/+page.svelte) is the member's own matrix - a table of categories against the two channels, rendered from the server's own resolved answer in the server's order, so a category added to the platform appears the day it ships. A switch the member may not move renders locked with the reason beside it rather than silently refusing, and a category reports what its own setting has held back and since when. Its words are apps/web/src/lib/notifications/category-vocabulary.ts and its transport apps/web/src/lib/notifications/preferences-api.ts. packages/notifications/src/recipients.ts resolves the declared audiences off the hot path and applies the per-category in-app floor before anything is written; the matrix itself is packages/notifications/src/preferences.ts on the shipped scope chain. The MEMBER tier is read and written through apps/api-worker/src/http/routes/notifications/notification-preferences.ts; the FIRM tier - the floor itself - through apps/api-worker/src/http/routes/firm/firm-notification-policy.ts, which until then no route wrote at all, so the floor was read on every fan-out and settable by nobody. Still unbuilt here - the messaging port external routing depends on (ADR-0047) and Directory-entity recipients, since every audience resolver returns firm members.
  notes: Two channels composing in opposite directions, held by packages/notifications/test/preferences.test.ts - in app the firm tier is a floor a member may not lower, by email the member's choice wins because a firm may not force mail into a mailbox it does not administer. `security` and `trust` are non-silenceable in app from either tier (MANDATORY_CATEGORIES, asserted against every registered type by test/registry-fitness.test.ts). A silenced category writes NO feed row and a counted notification_in_app_suppression row instead, so a member who chose not to hear something stays distinguishable from a member nobody told; packages/notifications/test/preference-enforcement.test.ts proves both the missing feed row and the tally. The email detail level (a member's choice under a firm ceiling) shipped ahead of the matrix, so a firm's stored ceiling is not rewritten when the digest lands.

- id: notifications.firm-policy
  name: Firm notification policy
  scope: The firm's own tier of the notification settings - the per-category in-app floor, the retention window, and the local hour the summary email lands - written under a firm-administration capability and audited.
  status: shipped
  surface: awaiting-screen
  slices: notifications-delivery
  evidence: GET/PATCH /api/v1/firm/notifications/policy in apps/api-worker/src/http/routes/firm/firm-notification-policy.ts, under firm:manageNotificationPolicy seeded to Admin only (packages/database/drizzle/per-firm/20260908T000000_baseline.sql). It composes writeFirmNotificationPreferencesStatement, writeNotificationRetentionDaysStatement and writeNotificationDigestLocalHourStatement in packages/notifications - all three of which existed and had no production caller, so all three settings were read at evaluation time and writable by nothing. Held by apps/api-worker/test/firm-notification-policy-routes.test.ts, which drives the floor end to end through the member's own read.
  notes: Deliberately NOT the member key notifications:read, which every default role including Read-only carries - reusing it would let any member raise the floor and shorten retention for the whole firm. The two channels still compose in opposite directions: the firm's in-app tier is a floor a member may not lower, and the firm's email tier is only a default a member's own choice overrides. The retention window and digest hour are refused outside their declared bounds rather than clamped, because a firm that asked for five years and silently got one would believe it had the first. Deliberately absent: the firm's email DETAIL-LEVEL ceiling (notifications.emailDetailLevel), which has no write statement in either tier and is not reachable from this surface either.

- id: notifications.trust-compliance-designation
  name: Trust-compliance designation
  scope: A firm-tier list of members who join the recipient set of every trust-category notification, written under the trust-management capability and audited by count.
  status: shipped
  surface: awaiting-screen
  evidence: The setting and its resolver are packages/notifications/src/preferences.ts (trustComplianceRecipientsDefinition, readTrustComplianceRecipients), applied to the trust CATEGORY in packages/notifications/src/recipients.ts so all three production paths inherit it; GET/PUT /api/v1/firm/notifications/trust-compliance-recipients in apps/api-worker/src/http/routes/notifications/notification-preferences.ts under trust:manage. Held by packages/notifications/test/preference-enforcement.test.ts and apps/api-worker/test/notification-preferences-routes.test.ts.
  notes: A designation is not a grant of access. The designated member gets an ordinary recipient row and the visible-matter predicate still decides at read, so a notification about a matter they cannot see leaves their feed and unread count byte-identical to a firm where it was never raised - no placeholder, which would be an existence oracle. The audit row carries the recipient COUNT and never the names.

- id: notifications.center
  name: In-app notification center
  scope: Per-firm D1 rows (IDs + non-sensitive display fields, seen/read state, canonical deep-link) aggregated into the staff bell: unread badge, grouped/filterable list, mark-read, click-through.
  status: shipped
  surface: screen
  evidence: Six per-firm tables, the member-scoped read API (page, unread count, mark read/dismiss/read-all) behind notifications:read, and the screens over it - apps/web/src/routes/(app)/notifications/+page.svelte for the feed and apps/web/src/lib/notifications/notification-tray.svelte for the top-bar bell, which carries a live unread badge over the shared count in unread-count.svelte.ts. Held by apps/web/test/notification-presentation.test.ts and apps/api-worker/test/notifications-routes.test.ts.
  notes: The card is assembled at read time from the kind, the declared facts and a visibility-filtered matter join - no title, name, or filename is stored, so the sentence is composed on the client in apps/web/src/lib/notifications/notification-presentation.ts. A kind that module has no entry for renders as its category's own noun rather than being dropped: a client that shipped before a type did must not swallow a notification somebody was meant to see, and a source scan over the server's registry fails when a registered kind has no words. Both filters are query parameters rather than client-side narrowing, so a filtered feed is cheaper rather than merely shorter and the cursor keeps meaning the same thing from page to page. The feed page reports readThroughCursor beside nextCursor - the newest row rather than the oldest - because read-all takes the newest as its bound and nextCursor is null exactly when a member's whole backlog fits on one page.

- id: notifications.channels
  name: Delivery channels
  scope: The channels a notification can route to — in-app, email, SMS, web push, desktop
  status: partial
  evidence: In-app is the read API and the two screens over it (a feed row is not delivered, it is read, so it carries no delivery row by design) and email is the counts-only digest; SMS, web push and desktop are seeded values in the notification_delivery channel CHECK with nothing written to them.
  notes: The two built channels do not share a delivery port. In-app writes recipient rows directly and email is a bespoke hourly digest pass with its own reader, renderer and watermark, so adding SMS or push today means a third delivery mechanism rather than an adapter behind one seam. Cutting that port is the work that makes the remaining three channels modular; nothing about the registry, the preference matrix or the read blocks it.

- id: notifications.channels.email
  name: Email channel
  scope: External delivery via the communications layer: transactional provider for system/billing, matter mailbox for thread-bound mail.
  status: partial
  surface: internal
  adrs: ADR-0074, ADR-0251
  evidence: The digest reader, its renderer and its per-firm hourly run are packages/notifications/src/digest.ts, src/digest-render.ts and runNotificationDigestPass in apps/api-worker/src/background/scheduled.ts, sending through apps/api-worker/src/notifications/digest-send-port.ts over the shipped SendEmail port; held by packages/notifications/test/digest.test.ts and test/digest-render.test.ts. Unbuilt here - thread-bound mail through the matter mailbox, and the matter-number detail level, which is declared and renders as counts-only.
  notes: Digest-only, counts-only. A summary carries a fixed matter-free subject holding a count, a line of per-category counts and one link - no title, number, name, filename, date or amount, enforced by a golden test over a fixture whose matter is named after its parties. Composed per member per cadence from a keyset watermark through the SAME shared read the feed composes, so the wall binds at delivery time in one implementation; sends before it marks; and every row it did not mail is settled as a suppressed notification_delivery row naming a closed reason. Cannot reach anybody until the sending domain, EMAIL_FROM and APP_BASE_URL are provisioned - absent any of the three the port reports a typed not-configured reason and the pass mails nobody (docs/deploy-queue.md).

- id: notifications.channels.sms
  name: SMS/MMS channel
  scope: Appointment/deadline/payment reminders through the messaging port where type and recipient warrant.
  status: not-started
  adrs: ADR-0047
  evidence: Messaging port unbuilt; no SMS code in the repo.

- id: notifications.channels.web-push
  name: Web push channel
  scope: Push API subscriptions + VAPID via the app-shell service worker.
  status: deferred
  adrs: ADR-0059
  evidence: Deferred in ADR-0059 and left there by the notifications delivery design, which records the subscription infrastructure as deferred with no sub-second need to force it; the channel value is already in the notification_delivery CHECK, so adopting it moves no schema. No service-worker push code exists.

- id: notifications.channels.desktop
  name: Desktop-native notifications
  scope: Native tray/notification presenter over the same rows, riding Tauri with the web center as fallback.
  status: deferred
  adrs: ADR-0023
  evidence: Rides the deferred desktop shell; no code.

- id: notifications.raise-port
  name: notify() raise port & co-located raises
  scope: Single raise port with high-value raises co-located on unbypassable paths (audit-log write for money/trust, task write path, conflicts/portal/deadline/job seams); fan-out off the hot path via Queues.
  status: partial
  surface: internal
  adrs: ADR-0251
  evidence: A second non-exclusive pass in apps/api-worker/src/background/costs/recoverable-charge-consumer.ts subscribes to the shipped transactional outbox; fourteen topics are subscribed to in OUTBOX_SUBSCRIBED_DECLARATIONS, one per registered type, the newest three being the calendar's own matter-event write paths, which commit an outbox row in the batch they were already composing (packages/calendar/src/notifications.ts, packages/calendar/src/event-service.ts, packages/calendar/src/continuance-service.ts). The comparison-shaped points are raised by packages/notifications/src/sweep.ts, and a job coordinator's terminal state by packages/notifications/src/job-completion.ts.
  notes: There is deliberately no raise port for topics already on the outbox — the outbox row IS the emission, and a second row beside it would be a weaker copy of a guarantee that already holds. One of the five job coordinators (DocumentAssemblyJob) is wired; RecoveryJobCoordinator's type is registered and unwired, and the other three record no requester, which apps/api-worker/src/jobs/job-completion-notification.ts and the pending decision fragment explain per coordinator.

- id: notifications.scheduling
  name: Scheduled reminders
  scope: Cron-triggered Workflow sweeping due reminders per firm; deadline dates computed in the court's zone.
  status: partial
  surface: internal
  evidence: runNotificationComparisonSweep in apps/api-worker/src/background/scheduled.ts runs on the daily cron over listReachableActiveFirms, calling packages/notifications/src/sweep.ts, which reads the calendar's own overdue arithmetic (packages/calendar/src/overdue.ts) and collectCustodyReminders (packages/custodian/src/reminders.ts); the once-per-civil-day bucket and the audience count are held by packages/notifications/test/comparison-sweep.test.ts and apps/api-worker/test/notifications-comparison-sweep.test.ts, and the bucket's retention-safety by packages/notifications/test/retention-convergence.test.ts.
  notes: Due and overdue deadlines and both custody reasons are swept. calendar.deadline.horizon is declared and raises nothing — it needs a firm-configured lead window that no setting defines, and a fitness test asserts the emission point resolves to no type so the gap cannot be mistaken for an oversight. Every way this pass can stop finding things now announces itself: the per-kind findings clamp on notifications.comparison_clamped, and the zone-discovery truncation that produces no findings at all for a whole jurisdiction on notifications.comparison_zone_discovery_truncated.
  awaiting-owner: Two, both about how much of a firm's overdue work one pass carries. The deadline horizon's lead window — "an open deadline enters the firm's configured lead window" needs a number and a bound, and a lead the platform picks is a lead the firm did not choose. And whether 200 findings per kind per pass is the right ceiling: it is counted rather than silent, but a busy litigation practice can exceed it honestly, and raising it is a firm-observable change in how much gets reported as well as a load question.

- id: notifications.digest
  name: Digest rollup
  scope: Cadence-based rollup of multiple items into one summary notification.
  status: partial
  surface: screen
  slices: notifications-delivery
  evidence: Partial because the email rollup shipped and the in-app one did not. The member's per-category cadence is now settable on Settings - Notifications. The email digest is the same one notifications.channels.email describes, composed per member per cadence in packages/notifications/src/digest.ts and run hourly per firm by runNotificationDigestPass. Email is digest-ONLY by construction: the cadences in packages/notifications/src/types.ts are periods (off, daily, weekly) with no immediate value, and the only bypass is a registry-declared escalation reserved to the trust-compliance and security categories. What stays deferred is an IN-APP rollup — a feed row that stands for several others — which is a different thing from the email summary and is not built.

- id: notifications.freshness
  name: Freshness & delivery mechanics
  scope: Durable rows plus refetch-on-focus, cross-tab BroadcastChannel invalidation, cheap unread-count poll; job-completion rides the per-job Durable Object channel.
  status: partial
  evidence: The durable rows and the cheap unread-count poll are shipped (GET /api/v1/notifications/unread-count, index-covered), and the bell now consumes them - apps/web/src/lib/notifications/unread-count.svelte.ts polls on a slow interval, refetches on window focus, stops while the page is hidden, and never clears a known count on a failed read. Cross-tab BroadcastChannel invalidation is still unbuilt. A document assembly's terminal state writes the durable row beside its unchanged socket push (apps/api-worker/src/assemblies/assembly-coordinator.ts), proved by apps/api-worker/test/notifications-comparison-sweep.test.ts.
  notes: The poll also reports what the retention sweep took while unread, so a member returning from leave is told there is a gap rather than shown a zero. Four of the five job coordinators still write no durable row — three record no requester and the bundle builder is single-flight across several of them.

- id: notifications.freshness.per-user-do-push
  name: Per-user Durable Object push channel
  scope: Real-time push per user extending the DO-per-job primitive, adoptable behind existing call sites.
  status: deferred
  adrs: ADR-0059
  evidence: ADR-0059's documented seam and nothing more — it extends the Durable-Object-per-job primitive behind the same call sites, so adopting it changes no caller. Nothing is built.

- id: notifications.confidentiality
  name: Confidentiality & read-time enforcement
  scope: External channels carry no privileged content (allowlist bodies, deep links); in-app visibility re-checks access at read time (stale rows filtered, never an existence oracle); rows firm- and recipient-scoped; audited dispatch for audited categories.
  status: partial
  surface: internal
  adrs: ADR-0059, ADR-0251
  evidence: The closed fact grammar (packages/notifications/src/facts-grammar.ts) refuses a text-valued declaration; every read composes the visible-matter predicate in SQL before the LIMIT, proved for all of them by packages/notifications/test/wall-fitness.test.ts. A preference change writes an audit_log row carrying the categories touched and nothing else, held by apps/api-worker/test/notification-preferences-routes.test.ts.
  notes: The external-channel half landed with the email digest — every rendering is counts-only and held there by packages/notifications/test/digest-render.test.ts, including the declared matter-number detail level, which renders exactly as counts-only until it ships rather than degrading to a matter number nobody approved. Audited DISPATCH - an audit row per delivered notification of an audited category - is still unbuilt; what ships is the audited preference and designation writes.
