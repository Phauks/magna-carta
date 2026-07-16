# Observability & Diagnostics

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

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
  adrs: ADR-0017
  evidence: packages/telemetry/src/scrub.ts + event.ts/events.ts allowlist construction; standard at docs/conventions/error-logging.md.

- id: observability.correlation
  name: Correlation & Error IDs
  scope: Per-request correlation ID on every event and problem response; Error ID minted at capture joining a user-visible failure to its server trace.
  status: shipped
  evidence: packages/telemetry/src/ids.ts (correlation*/error* handles) wired through apps/worker/src/telemetry-middleware.ts.

- id: observability.operational-telemetry
  name: Always-on operational telemetry
  scope: Redacted structured server logs and counters (Workers logger + Analytics Engine), firm-scoped, keyed by correlation/Error ID.
  status: shipped
  slices: 0-6-telemetry-baseline-platform-closeout
  adrs: ADR-0074
  spec: docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md
  evidence: packages/telemetry/src/workers-logger.ts + TELEMETRY analytics_engine dataset binding in apps/worker/wrangler.jsonc.
  notes: Logpush-to-R2 archival is account configuration, not verified in-repo.

- id: observability.client-reporter
  name: In-house client capture
  scope: Svelte error boundary + global handlers, Error ID display, breadcrumb ring buffer, no third-party SDK.
  status: partial
  evidence: Error pages carry build identity + copyable trace (changelog.d/developer-console-and-error-tracing.md); breadcrumb library and crash-surface send not built.

- id: observability.client-reporter.error-boundary
  name: Error pages with trace identity
  scope: Error surfaces bake in build commit/mode/time plus browser line in a copyable trace block.
  status: shipped
  evidence: apps/web/src/routes/+error.svelte + changelog.d/developer-console-and-error-tracing.md.

- id: observability.client-reporter.breadcrumbs
  name: Client breadcrumb ring buffer
  scope: Client-side ring of recent actions/IDs (never field content) attached to reports.
  status: not-started
  evidence: apps/worker/src/routes/incidents.ts accepts a breadcrumbs array but notes the client library enforces content rules "when it ships".

- id: observability.client-reporter.report-a-problem
  name: Report a problem affordance
  scope: Always-available help-menu reporting usable without a crash.
  status: partial
  evidence: Profile-menu "Report a bug" dialog assembles a paste-ready trace-grade report (changelog.d/settings-foundation-and-profile-menu.md); in-app submission to the ingest endpoint not wired.

- id: observability.client-reporter.send-to-developer
  name: Send-to-developer on crash
  scope: Error screen/toast showing the Error ID with a prominent send button.
  status: not-started
  evidence: No crash-surface send flow in apps/web.

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
  evidence: apps/worker/src/routes/incidents.ts (protected-field write, incidents:viewDescription gate, incident.created event).

- id: observability.incidents.screenshot
  name: Opt-in redactable screenshot
  scope: User-redactable screenshot attached to a report, stored in R2.
  status: not-started
  evidence: No screenshot field in the incident request schema; no R2 write path.

- id: observability.incidents.acknowledgement
  name: Reporter acknowledgement loop
  scope: Receipt and resolution status posted back to the reporter in-app/portal.
  status: not-started
  evidence: No acknowledgement path; depends on the unbuilt notifications subsystem.

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
  evidence: apps/worker/src/usage/ (reached-middleware.ts, completed.ts, feature-map.ts) + packages/telemetry/src/usage-features.ts.

- id: observability.usage-analytics.pseudonymization
  name: HMAC pseudonymization
  scope: firmId/userId HMAC-pseudonymized under a server pepper before write; missing pepper drops the event (fail-closed).
  status: shipped
  evidence: packages/telemetry/src/pseudonymize.ts.

- id: observability.usage-analytics.consent
  name: Usage-analytics consent resolution
  scope: Firm-level enable (default on) with per-member opt-out, resolved off the hot path via a cached resolver.
  status: shipped
  evidence: apps/worker/src/usage/consent.ts + packages/data-access/src/usage-consent-statements.ts.

- id: observability.usage-analytics.aggregate-queries
  name: Aggregate queries with small-n suppression
  scope: Cross-firm aggregate-only queries, k=5 suppression with suppressed counts reported separately; canonical query set.
  status: shipped
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
  slices: service-status
  adrs: ADR-0048
  spec: docs/specs/2026-07-02-service-status-design.md
  evidence: apps/status-worker + packages/status; changelog.d/status-page.md, status-page-history-and-upstream-advisory.md, status-worker-edge-cache.md.
  notes: Deploy-activation checklist (status.magnacarta.esq) still pending per status.d/service-status.md.

- id: observability.support-access
  name: Audited support access
  scope: Pull-not-push help-desk access: time-boxed audited support_grant, diagnostic vs privileged-self tiers.
  status: shipped
  slices: support-access-framework
  adrs: ADR-0157
  evidence: apps/worker/src/support/ + routes/support-grants.ts, support-sessions.ts, support-diagnostics.ts.
  notes: Dormant until platform_staff is seeded; UI deferred.
