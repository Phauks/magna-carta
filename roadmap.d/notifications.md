# Notifications

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: notifications
  name: Notifications subsystem
  scope: One home for the decision (event, audience, channels, preferences, read state) and in-app delivery, delegating external delivery to communications-layer ports; replaces per-feature trigger code.
  status: not-started
  adrs: ADR-0059
  evidence: Decision recorded; no notification package, routes, tables, or spec in docs/specs/.

- id: notifications.registry
  name: Notification type registry
  scope: Declarative types: key, category, internal/external audience, severity, mandatory flag, eligible channels with default routing, channel-aware templates, cadence, audited flag; fitness-function introspectable.
  status: not-started
  adrs: ADR-0059
  evidence: No registry code or notification types anywhere in packages/.

- id: notifications.recipients-preferences
  name: Recipients & preferences
  scope: Recipient resolution to a firm member or Directory entity; per-user channel matrix on the settings scope chain; mandatory categories non-silenceable; external routing honors STOP/TCPA consent.
  status: not-started
  evidence: No recipient-resolution or preference code; the settings category and the messaging port it depends on are also unbuilt.

- id: notifications.center
  name: In-app notification center
  scope: Per-firm D1 rows (IDs + non-sensitive display fields, seen/read state, canonical deep-link) aggregated into the staff bell: unread badge, grouped/filterable list, mark-read, click-through.
  status: not-started
  evidence: No notification table, data-access statements, or bell UI.

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
  status: not-started
  evidence: No notify port; job-completion and other events currently have no notification consumers.

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
  status: not-started
  evidence: The underlying mechanisms (focus refetch, per-job DO channels) exist for other features; nothing delivers notifications over them.

- id: notifications.freshness.per-user-do-push
  name: Per-user Durable Object push channel
  scope: Real-time push per user extending the DO-per-job primitive, adoptable behind existing call sites.
  status: deferred
  evidence: Documented seam only.

- id: notifications.confidentiality
  name: Confidentiality & read-time enforcement
  scope: External channels carry no privileged content (allowlist bodies, deep links); in-app visibility re-checks access at read time (stale rows filtered, never an existence oracle); rows firm- and recipient-scoped; audited dispatch for audited categories.
  status: not-started
  adrs: ADR-0059
  evidence: Design recorded in the decision; no enforcing code.
