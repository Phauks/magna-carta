# Observability & Diagnostics

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Reliability and support -->

- id: observability
  name: Observability & diagnostics
  scope: Diagnose without exfiltrating privileged content: redacted operational telemetry, user-initiated incidents, correlation IDs, usage analytics, status page; no third-party error SaaS, no session replay.
  status: partial
  slices: 0-6-telemetry-baseline-platform-closeout
  adrs: ADR-0017, ADR-0038
  evidence: packages/telemetry + incident ingest live; client capture, diagnostics setting, and the agent pipeline unbuilt.

- id: observability.redaction-model
  name: Redact-by-default event model
  scope: Three data classes (metadata / opaque identifiers / content-never); allowlist event assembly with a boundary scrubbing pass.
  status: shipped
  surface: internal
  adrs: ADR-0017
  evidence: packages/telemetry/src/scrub.ts + event.ts/events.ts allowlist construction; standard at docs/conventions/error-logging.md.

- id: observability.correlation
  name: Correlation & Error IDs
  scope: Per-request correlation ID on every event and problem response; Error ID minted at capture joining a user-visible failure to its server trace.
  status: shipped
  surface: internal
  evidence: packages/telemetry/src/ids.ts (correlation*/error* handles) wired through apps/api-worker/src/http/telemetry-middleware.ts.

- id: observability.error-record
  name: Every Error ID resolves to a record
  scope: The control plane keeps every answered failure and every browser crash against the Error ID the person saw, for thirty days, and System Status looks one up; every failure surface leads with a line naming the area, the action and the kind of failure.
  status: shipped
  surface: screen
  evidence: apps/api-worker/src/http/error-record.ts writes the error_record row for each answered problem; apps/api-worker/src/http/routes/platform/client-errors.ts keeps a browser crash against its client_ ID; apps/api-worker/src/http/routes/platform/platform-error-lookup.ts answers the lookup; apps/web/src/lib/diagnostics/failure-summary.ts builds the summary line every band, screen and toast leads with.

- id: observability.operational-telemetry
  name: Always-on operational telemetry
  scope: Redacted structured server logs and counters (Workers logger + Analytics Engine), firm-scoped, keyed by correlation/Error ID.
  status: shipped
  surface: internal
  slices: 0-6-telemetry-baseline-platform-closeout
  adrs: ADR-0074
  spec: docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md
  evidence: packages/telemetry/src/workers-logger.ts + TELEMETRY analytics_engine dataset binding in apps/api-worker/wrangler.jsonc.
  notes: Logpush-to-R2 archival is account configuration, not verified in-repo.

- id: observability.client-reporter
  name: In-house client capture
  scope: Svelte error boundary + global handlers, Error ID display, breadcrumb ring buffer, no third-party SDK.
  status: shipped
  evidence: apps/web/src/hooks.client.ts mints a client-side Error ID for a crash the platform never saw and installs the onerror/unhandledrejection handlers; apps/web/src/lib/diagnostics/breadcrumbs.ts is the ring buffer; apps/web/src/lib/diagnostics/report.ts posts to the incidents route from the crash screen and from the always-available help-menu dialog.
  audience: public
  public-name: Reporting a problem
  public-summary: Report a problem from inside the app and get a reference you can quote to us, without sending us the contents of your file.

- id: observability.client-reporter.error-boundary
  name: Error pages with trace identity
  scope: Error surfaces bake in build commit/mode/time plus browser line in a copyable trace block, and a client boundary catches what never reached a route.
  status: shipped
  surface: screen
  evidence: apps/web/src/hooks.client.ts is the SvelteKit client boundary for a failure while a route loads, and apps/web/src/lib/diagnostics/render-boundary.svelte (mounted by the root layout, above every route group) is the Svelte boundary for a throw while a component renders — the crash SvelteKit itself never catches; both error routes render apps/web/src/lib/diagnostics/failure-screen.svelte over the design system's failure-state, and the trace is assembled by apps/web/src/lib/diagnostics/failure-trace.ts — every line a key-value pair, absent facts stated rather than dropped, so one paste carries the whole report.

- id: observability.client-reporter.breadcrumbs
  name: Client breadcrumb ring buffer
  scope: Client-side ring of recent actions/IDs (never field content) attached to reports.
  status: shipped
  surface: internal
  evidence: apps/web/src/lib/diagnostics/breadcrumbs.ts — a fixed-capacity in-memory ring whose entries are already the shape apps/api-worker/src/http/routes/platform/incidents.ts accepts, with no slot for a payload, email addresses replaced and every field capped at the route's own limits. apps/web/test/failure-trace.test.ts pins the redaction.

- id: observability.client-reporter.report-a-problem
  name: Report a problem affordance
  scope: Always-available help-menu reporting usable without a crash.
  status: shipped
  surface: screen
  evidence: apps/web/src/lib/components/bug-report-dialog.svelte files through apps/web/src/lib/diagnostics/report.ts to the incidents route, carrying the breadcrumb ring and the same trace the failure screens copy; reachable from the profile menu and the command palette on every screen. Copy remains beside Submit for a member whose browser refuses the clipboard.
  notes: The optional in-office recipients and the email-me-a-copy flag stay Soon-marked — the incident route carries no recipients, and transactional email does not exist yet.

- id: observability.client-reporter.send-to-developer
  name: Send-to-developer on crash
  scope: Error screen/toast showing the Error ID with a prominent send button.
  status: shipped
  surface: screen
  evidence: Both error routes and every failure surface render Report a problem beside the Error ID, opening apps/web/src/lib/diagnostics/report-dialog.svelte. Nothing files automatically: a crash mints a handle and offers the report, holding the diagnostics setting's Off/strict default.

- id: observability.incidents
  name: Incident reports
  scope: User-initiated firm-scoped incident rows: Error IDs, redacted breadcrumbs, free-text description, context metadata; access-gated and audited.
  status: partial
  slices: 0-6-telemetry-baseline-platform-closeout
  evidence: Ingest endpoint shipped; screenshot capture and the acknowledgement loop unbuilt.

- id: observability.incidents.ingest
  name: Incident ingest endpoint
  scope: POST incidents route writing a bounded, redacted-by-construction firm-scoped row; description sealed under the firm key with an audited decrypt permission.
  status: shipped
  surface: awaiting-screen
  evidence: apps/api-worker/src/http/routes/platform/incidents.ts (protected-field write, incidents:viewDescription gate, incident.created event).

- id: observability.incidents.screenshot
  name: Opt-in redactable screenshot
  scope: User-redactable screenshot attached to a report, stored in R2.
  status: not-started
  evidence: No screenshot field in the incident request schema; no R2 write path.

- id: observability.incidents.acknowledgement
  name: Reporter acknowledgement loop
  scope: Receipt and resolution status posted back to the reporter in-app/portal.
  status: not-started
  evidence: No acknowledgement path, and the reason is the direction of the one notification that exists rather than the absence of a channel. incident.created is a registered notification type, but its audience is firm:manageMembers holders — whoever administers the firm, not the person who filed it — and it carries only an error-identifier count, since the description is sealed under the firm key. The email digest ships as a delivery channel; the in-app centre still has no surface. A receipt to the REPORTER, and a resolution status behind it, are unbuilt on both channels.

- id: observability.diagnostics-agent-pipeline
  name: Diagnostics agent pipeline
  scope: Queue from incident submission to an autonomous propose-only agent: triage, root-cause draft, draft PR, user acknowledgement.
  status: not-started
  evidence: No queue consumer or agent; incident.created is documented as the future feed (packages/telemetry/src/events.ts).

- id: observability.diagnostics-setting
  name: User-configurable diagnostics setting
  scope: Per-firm setting with per-user override controlling whether/what-detail diagnostics send (off-strict / standard / verbose-auto beta posture).
  status: not-started
  evidence: No diagnostics-level setting definition in packages or the settings surface.

- id: observability.analytics-tier
  name: Telemetry analytics tier (Iceberg on R2)
  scope: Logpush to Pipelines to R2 Data Catalog registering redacted cross-firm aggregate logs as Iceberg tables for DuckDB/Spark/BI at zero egress.
  status: deferred
  adrs: ADR-0056
  evidence: ADR-0056 defines adopt-when criteria (retention, sampling fidelity, query power, cost); configuration seam only, no build.

- id: observability.usage-analytics
  name: Product-usage analytics
  scope: Content-free usage.feature events (reached/completed) with pseudonymous identifiers, opt-out consent, and cross-firm aggregate queries.
  status: partial
  slices: usage-analytics
  adrs: ADR-0106
  spec: docs/specs/2026-06-18-usage-analytics-design.md
  evidence: Server-side pipeline on main (status.d built: in-progress); client beacon and Iceberg queries deferred.

- id: observability.usage-analytics.server-events
  name: Server-side reached/completed events
  scope: Route-to-feature middleware for reached; outbox sweep topic-to-feature for completed; versioned feature taxonomy.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/usage/ (reached-middleware.ts, completed.ts, feature-map.ts) + packages/telemetry/src/usage-features.ts.

- id: observability.usage-analytics.pseudonymization
  name: HMAC pseudonymization
  scope: firmId/userId HMAC-pseudonymized under a server pepper before write; missing pepper drops the event (fail-closed).
  status: shipped
  surface: internal
  evidence: packages/telemetry/src/pseudonymize.ts.

- id: observability.usage-analytics.consent
  name: Usage-analytics consent resolution
  scope: Firm-level enable (default on) with per-member opt-out, resolved off the hot path via a cached resolver.
  status: shipped
  surface: awaiting-screen
  evidence: apps/api-worker/src/usage/consent.ts + packages/data-access/src/usage-consent-statements.ts.

- id: observability.usage-analytics.aggregate-queries
  name: Aggregate queries with small-n suppression
  scope: Cross-firm aggregate-only queries, k=5 suppression with suppressed counts reported separately; canonical query set.
  status: shipped
  surface: internal
  evidence: packages/telemetry/src/usage-suppression.ts + docs/analytics/usage-queries.md.

- id: observability.usage-analytics.client-beacon
  name: Client beacon
  scope: Client-emitted reached events for pure-client surfaces with no server round-trip.
  status: deferred
  evidence: Documented seam, deferred until there is client traffic (ADR-0106).

- id: observability.status-page
  name: Public service status page
  scope: Isolated status Worker (KV-only) rendering zero-JS server-side HTML: live snapshot, 90-day per-component uptime history, upstream-provider advisories, subscribe panel.
  status: shipped
  surface: awaiting-screen
  slices: service-status
  adrs: ADR-0048
  spec: docs/specs/2026-07-02-service-status-design.md
  evidence: apps/status-worker (index.ts, render-status-page.ts, page-styles.ts — zero-JS server-rendered HTML with its assets inlined) over packages/status, whose modules are the shape of the page: history.ts for the 90-day per-component uptime, provider-registry.ts and statuspage-adapter.ts for upstream advisories, component-registry.ts, derive.ts and merge.ts for the live snapshot.
  audience: public
  public-name: Service status page
  public-summary: A page anyone can open to see whether Magna Carta is running normally.
  notes: Deploy-activation checklist (status.magnacarta.esq) still pending per status.d/service-status.md.

- id: observability.support-access
  name: Audited support access
  scope: Pull-not-push help-desk access: time-boxed audited support_grant, diagnostic vs privileged-self tiers.
  status: shipped
  surface: awaiting-screen
  slices: support-access-framework
  adrs: ADR-0157
  evidence: apps/api-worker/src/support/ + routes/support/support-grants.ts, support-sessions.ts, support-diagnostics.ts.
  audience: public
  public-summary: Any access to your firm's data by our support staff is recorded, and the record is yours to read.
  notes: Dormant until platform_staff is seeded; UI deferred.
