# Release Channels

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Early access -->

- id: release-channels
  name: Release channels
  scope: Firm-level stable/beta/alpha channels gating behavior (never schema) through feature flags, with consent-gated self-serve beta and developer-only alpha.
  status: partial
  slices: release-channels-backend-rails
  adrs: ADR-0148, ADR-0149
  spec: docs/specs/2026-06-25-release-channels-design.md
  evidence: Backend rails on main (status.d built done, tests todo); frontend (Plan 2) deferred past 0.7.
  audience: public
  public-name: Early access to new features
  public-summary: Turn a new feature on for your firm before it reaches everyone, and turn it off again if it gets in the way.

- id: release-channels.firm-channel
  name: firm.release_channel model
  scope: One control-plane column, values stable/beta/alpha with alpha superset nesting; channel is a firm property, never per-user; default stable.
  status: shipped
  surface: internal
  slices: release-channels-backend-rails
  adrs: ADR-0149
  evidence: Control-plane firm column read per request by session context; delivered via /me.

- id: release-channels.schema-invariant
  name: Channels gate behavior, not schema
  scope: One fleet schema (additive, dark-shipped columns); flags flip exposure; migration runner marches every firm regardless of channel.
  status: shipped
  surface: internal
  adrs: ADR-0149, ADR-0151
  evidence: Control-plane migration auto-applier (apps/api-worker/src/control-plane-migrations.ts) + single per-firm migration lineage.

- id: release-channels.beta-door
  name: Beta door (firm self-serve)
  scope: Firm endpoint accepting only stable/beta, behind firm:manageReleaseChannel, requiring an explicit versioned consent acknowledgment recorded in the per-firm audit log.
  status: shipped
  surface: awaiting-screen
  evidence: apps/api-worker/src/routes/firm/release-channel.ts (PUT /api/v1/firm/release-channel).

- id: release-channels.alpha-door
  name: Alpha door (developer-only)
  scope: Secret-guarded platform endpoint writing any channel including alpha; audited in control-plane auth_audit; internal firms pinned to alpha for dogfooding.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/routes/platform/platform-release-channel.ts + platform-operator-guard.ts.

- id: release-channels.feature-flags
  name: Feature-flag engine (@magna-carta/feature-flags)
  scope: Thin wrapper over the Cloudflare Flagship binding: evaluation-context construction, safe-default enforcement, FLAG_CATALOG with per-entry stage; test-substitutable fake.
  status: shipped
  surface: internal
  adrs: ADR-0148
  evidence: packages/feature-flags/src (catalog.ts, flagship-adapter.ts, port.ts).

- id: release-channels.fail-safe-defaults
  name: Fail-safe flag defaults
  scope: Every evaluation defaults to stable behavior; missing binding or flag outage resolves all-off automatically (Miniflare test pool included).
  status: shipped
  surface: internal
  evidence: packages/feature-flags/src/default-off-adapter.ts + resolveFlagEvaluator fallback in apps/api-worker/src/flags/.

- id: release-channels.spa-delivery
  name: Session & SPA flag delivery
  scope: Per-request evaluation context (firmId, channel, role, userId — non-privileged identifiers only); resolved flag set delivered in the /me bootstrap beside permissions; one bundle for all channels.
  status: shipped
  surface: internal
  evidence: apps/api-worker/src/routes/session/me.ts (evaluateCatalog into the flags payload).

- id: release-channels.frontend
  name: Channel frontend (Plan 2)
  scope: Settings surface for the beta opt-in/consent flow plus stage-labeled Alpha/Beta markers and feedback affordances on pre-stable features, disappearing on graduation.
  status: planned
  evidence: Deferred past 0.7 per status.d/release-channels-backend-rails.md; apps/web/src/routes/(app)/settings/beta-access ships as an honest seam awaiting this slice.
  notes: Maturity-stage badges and dots already render across the navigation rail (apps/web/src/lib/components/app-shell.svelte) and the matter section nav, driven by the per-destination stage in apps/web/src/lib/navigation/destinations.ts rather than by a firm's release channel; the channel-driven marker system is not built.
