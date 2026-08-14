# Notifications

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Notifications -->

- id: notifications
  name: Notifications subsystem
  scope: One home for the decision (event, audience, channels, preferences, read state) and in-app delivery, delegating external delivery to communications-layer ports; replaces per-feature trigger code.
  status: partial
  adrs: ADR-0059, ADR-0251, ADR-0258
  spec: docs/specs/2026-08-06-notifications-delivery-design.md
  evidence: packages/notifications + five per-firm tables + the read API shipped; the comparison-driven sweep, preferences, and the email digest are later sub-slices, and there is no user interface.
  audience: public
  public-name: Notifications
  public-summary: Be told when something needs you, in the app and by email, and only ever about matters you already have access to.

- id: notifications.registry
  name: Notification type registry
  scope: Declarative types: key, category, internal/external audience, severity, mandatory flag, eligible channels with default routing, channel-aware templates, cadence, audited flag; fitness-function introspectable.
  status: shipped
  adrs: ADR-0059, ADR-0251
  evidence: packages/notifications/src/registry.ts, with the declaration rules held by packages/notifications/test/registry-fitness.test.ts.
  notes: Nine types registered; a type also declares the outbox topic it subscribes to, its subject kind, its matter anchoring, its non-privileged fact schema, and its email content level.

- id: notifications.recipients-preferences
  name: Recipients & preferences
  scope: Recipient resolution to a firm member or Directory entity; per-user channel matrix on the settings scope chain; mandatory categories non-silenceable; external routing honors STOP/TCPA consent.
  status: partial
  evidence: packages/notifications/src/recipients.ts resolves the declared audiences off the hot path; the per-category preference matrix and the firm policy floor are the next sub-slice, and the messaging port external routing depends on is still unbuilt.
  notes: The email detail level (a member's choice under a firm ceiling) is built ahead of the matrix, so a firm's stored ceiling is not rewritten when the digest ships.

- id: notifications.center
  name: In-app notification center
  scope: Per-firm D1 rows (IDs + non-sensitive display fields, seen/read state, canonical deep-link) aggregated into the staff bell: unread badge, grouped/filterable list, mark-read, click-through.
  status: partial
  evidence: Five per-firm tables plus the member-scoped read API (page, unread count, mark read/dismiss/read-all) behind notifications:read; the bell and the list are UI and unbuilt.
  notes: Backend only. The card is assembled at read time from the kind and a visibility-filtered matter join — no title, name, or filename is stored.

- id: notifications.channels
  name: Delivery channels
  scope: The channels a notification can route to — in-app, email, SMS, web push, desktop
  status: not-started

- id: notifications.channels.email
  name: Email channel
  scope: External delivery via the communications layer: transactional provider for system/billing, matter mailbox for thread-bound mail.
  status: not-started
  adrs: ADR-0074
  evidence: Transactional email adapter exists as a transport primitive (apps/worker/src/email-port.ts, email-cloudflare.ts); no notification routing feeds it.

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
  evidence: A second non-exclusive pass in apps/worker/src/costs/recoverable-charge-consumer.ts subscribes to the shipped transactional outbox; nine of the thirty-one existing topics are registered.
  notes: There is deliberately no raise port for topics already on the outbox — the outbox row IS the emission, and a second row beside it would be a weaker copy of a guarantee that already holds. The comparison-shaped points (deadlines, custody reminders) and the job coordinators are the next sub-slice.

- id: notifications.scheduling
  name: Scheduled reminders
  scope: Cron-triggered Workflow sweeping due reminders per firm; deadline dates computed in the court's zone.
  status: not-started
  evidence: No reminder sweep in apps/worker/src/scheduled.ts; the fan-out pattern exists elsewhere (backups) but not for reminders.

- id: notifications.digest
  name: Digest rollup
  scope: Cadence-based rollup of multiple items into one summary notification.
  status: deferred
  evidence: Carried in the type model as a declared v1 seam.

- id: notifications.freshness
  name: Freshness & delivery mechanics
  scope: Durable rows plus refetch-on-focus, cross-tab BroadcastChannel invalidation, cheap unread-count poll; job-completion rides the per-job Durable Object channel.
  status: partial
  evidence: The durable rows and the cheap unread-count poll are shipped (GET /api/v1/notifications/unread-count, index-covered); focus refetch and cross-tab invalidation are UI and land with the bell.
  notes: The poll also reports what the retention sweep took while unread, so a member returning from leave is told there is a gap rather than shown a zero.

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
  evidence: The closed fact grammar (packages/notifications/src/facts-grammar.ts) refuses a text-valued declaration; every read composes the visible-matter predicate in SQL before the LIMIT, proved for all of them by packages/notifications/test/wall-fitness.test.ts.
  notes: The external-channel half lands with the email digest. Audited dispatch lands with the preference slice.
