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
  adrs: ADR-0059, ADR-0251
  evidence: packages/notifications/src/registry.ts, with the declaration rules held by packages/notifications/test/registry-fitness.test.ts.
  notes: Seventeen types registered. A type declares its production path (raisedBy — outbox-topic, comparison-sweep, or job-coordinator), the emission point it names, its subject kind, its matter anchoring, its non-privileged fact schema, and its email content level. A fitness test asserts each type is indexed under exactly one path, and that a matter-anchored type does not reach a single member unless it is on a list saying why.

- id: notifications.recipients-preferences
  name: Recipients & preferences
  scope: Recipient resolution to a firm member or Directory entity; per-user channel matrix on the settings scope chain; mandatory categories non-silenceable; external routing honors STOP/TCPA consent.
  status: partial
  evidence: packages/notifications/src/recipients.ts resolves the declared audiences off the hot path and applies the per-category in-app floor before anything is written; the matrix itself is packages/notifications/src/preferences.ts on the shipped scope chain, read and written through apps/worker/src/routes/notification-preferences.ts. Still unbuilt here - the messaging port external routing depends on (ADR-0047) and Directory-entity recipients, since every audience resolver returns firm members.
  notes: Two channels composing in opposite directions, held by packages/notifications/test/preferences.test.ts - in app the firm tier is a floor a member may not lower, by email the member's choice wins because a firm may not force mail into a mailbox it does not administer. `security` and `trust` are non-silenceable in app from either tier (MANDATORY_CATEGORIES, asserted against every registered type by test/registry-fitness.test.ts). A silenced category writes NO feed row and a counted notification_in_app_suppression row instead, so a member who chose not to hear something stays distinguishable from a member nobody told; packages/notifications/test/preference-enforcement.test.ts proves both the missing feed row and the tally. The email detail level (a member's choice under a firm ceiling) shipped ahead of the matrix, so a firm's stored ceiling is not rewritten when the digest lands.

- id: notifications.trust-compliance-designation
  name: Trust-compliance designation
  scope: A firm-tier list of members who join the recipient set of every trust-category notification, written under the trust-management capability and audited by count.
  status: shipped
  evidence: The setting and its resolver are packages/notifications/src/preferences.ts (trustComplianceRecipientsDefinition, readTrustComplianceRecipients), applied to the trust CATEGORY in packages/notifications/src/recipients.ts so all three production paths inherit it; GET/PUT /api/v1/firm/notifications/trust-compliance-recipients in apps/worker/src/routes/notification-preferences.ts under trust:manage. Held by packages/notifications/test/preference-enforcement.test.ts and apps/worker/test/notification-preferences-routes.test.ts.
  notes: A designation is not a grant of access. The designated member gets an ordinary recipient row and the visible-matter predicate still decides at read, so a notification about a matter they cannot see leaves their feed and unread count byte-identical to a firm where it was never raised - no placeholder, which would be an existence oracle. The audit row carries the recipient COUNT and never the names.

- id: notifications.center
  name: In-app notification center
  scope: Per-firm D1 rows (IDs + non-sensitive display fields, seen/read state, canonical deep-link) aggregated into the staff bell: unread badge, grouped/filterable list, mark-read, click-through.
  status: partial
  evidence: Six per-firm tables plus the member-scoped read API (page, unread count, mark read/dismiss/read-all) behind notifications:read; the bell and the list are UI and unbuilt.
  notes: Backend only. The card is assembled at read time from the kind and a visibility-filtered matter join — no title, name, or filename is stored.

- id: notifications.channels
  name: Delivery channels
  scope: The channels a notification can route to — in-app, email, SMS, web push, desktop
  status: partial
  evidence: In-app is the read API (a feed row is not delivered, it is read, so it carries no delivery row by design) and email is the counts-only digest; SMS, web push and desktop are seeded values in the notification_delivery channel CHECK with nothing written to them.

- id: notifications.channels.email
  name: Email channel
  scope: External delivery via the communications layer: transactional provider for system/billing, matter mailbox for thread-bound mail.
  status: partial
  adrs: ADR-0074, ADR-0251
  evidence: The digest reader, its renderer and its per-firm hourly run are packages/notifications/src/digest.ts, src/digest-render.ts and runNotificationDigestPass in apps/worker/src/scheduled.ts, sending through apps/worker/src/notifications/digest-send-port.ts over the shipped SendEmail port; held by packages/notifications/test/digest.test.ts and test/digest-render.test.ts. Unbuilt here - thread-bound mail through the matter mailbox, and the matter-number detail level, which is declared and renders as counts-only.
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
  evidence: Named a seam with subscription infrastructure deliberately deferred; no service-worker push code.

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
  adrs: ADR-0251
  evidence: A second non-exclusive pass in apps/worker/src/costs/recoverable-charge-consumer.ts subscribes to the shipped transactional outbox; thirteen topics are registered, the newest three being the calendar's own matter-event write paths, which commit an outbox row in the batch they were already composing (packages/calendar/src/notifications.ts, packages/calendar/src/event-service.ts, packages/calendar/src/continuance-service.ts). The comparison-shaped points are raised by packages/notifications/src/sweep.ts, and a job coordinator's terminal state by packages/notifications/src/job-completion.ts.
  notes: There is deliberately no raise port for topics already on the outbox — the outbox row IS the emission, and a second row beside it would be a weaker copy of a guarantee that already holds. One of the five job coordinators (DocumentAssemblyJob) is wired; RecoveryJobCoordinator's type is registered and unwired, and the other three record no requester, which apps/worker/src/jobs/job-completion-notification.ts and the pending decision fragment explain per coordinator.

- id: notifications.scheduling
  name: Scheduled reminders
  scope: Cron-triggered Workflow sweeping due reminders per firm; deadline dates computed in the court's zone.
  status: partial
  evidence: runNotificationComparisonSweep in apps/worker/src/scheduled.ts runs on the daily cron over listReachableActiveFirms, calling packages/notifications/src/sweep.ts, which reads the calendar's own overdue arithmetic (packages/calendar/src/overdue.ts) and collectCustodyReminders (packages/custodian/src/reminders.ts); the once-per-civil-day bucket and the audience count are held by packages/notifications/test/comparison-sweep.test.ts and apps/worker/test/notifications-comparison-sweep.test.ts.
  notes: Due and overdue deadlines and both custody reasons are swept. calendar.deadline.horizon is declared and raises nothing — it needs a firm-configured lead window that no setting defines, and a fitness test asserts the emission point resolves to no type so the gap cannot be mistaken for an oversight.
  awaiting-owner: The deadline horizon's lead window. "An open deadline enters the firm's configured lead window" needs a number and a bound — a firm-tier setting on the retention window's pattern would cost little, but the default value is the question, and a lead the platform picks is a lead the firm did not choose. Nothing else in the sweep is blocked on it.

- id: notifications.digest
  name: Digest rollup
  scope: Cadence-based rollup of multiple items into one summary notification.
  status: deferred
  evidence: Carried in the type model as a declared v1 seam.

- id: notifications.freshness
  name: Freshness & delivery mechanics
  scope: Durable rows plus refetch-on-focus, cross-tab BroadcastChannel invalidation, cheap unread-count poll; job-completion rides the per-job Durable Object channel.
  status: partial
  evidence: The durable rows and the cheap unread-count poll are shipped (GET /api/v1/notifications/unread-count, index-covered); focus refetch and cross-tab invalidation are UI and land with the bell. A document assembly's terminal state writes the durable row beside its unchanged socket push (apps/worker/src/assemblies/assembly-coordinator.ts), proved by apps/worker/test/notifications-comparison-sweep.test.ts.
  notes: The poll also reports what the retention sweep took while unread, so a member returning from leave is told there is a gap rather than shown a zero. Four of the five job coordinators still write no durable row — three record no requester and the bundle builder is single-flight across several of them.

- id: notifications.freshness.per-user-do-push
  name: Per-user Durable Object push channel
  scope: Real-time push per user extending the DO-per-job primitive, adoptable behind existing call sites.
  status: deferred
  evidence: Documented seam only.

- id: notifications.confidentiality
  name: Confidentiality & read-time enforcement
  scope: External channels carry no privileged content (allowlist bodies, deep links); in-app visibility re-checks access at read time (stale rows filtered, never an existence oracle); rows firm- and recipient-scoped; audited dispatch for audited categories.
  status: partial
  adrs: ADR-0059, ADR-0251
  evidence: The closed fact grammar (packages/notifications/src/facts-grammar.ts) refuses a text-valued declaration; every read composes the visible-matter predicate in SQL before the LIMIT, proved for all of them by packages/notifications/test/wall-fitness.test.ts. A preference change writes an audit_log row carrying the categories touched and nothing else, held by apps/worker/test/notification-preferences-routes.test.ts.
  notes: The external-channel half lands with the email digest. Audited DISPATCH - an audit row per delivered notification of an audited category - is still unbuilt; what ships is the audited preference and designation writes.
