# Platform — Delivery, Architecture, Tenancy & Data Conventions

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Apps and access -->

- id: platform
  name: Platform
  scope: Delivery model, application architecture, architectural coherence, tenancy and isolation, Cloudflare primitive adoption, and the foundational data and runtime conventions.
  status: partial
  evidence: apps/worker, apps/web, packages/{data-access,database,money,identifiers}, crates/
  notes: Backend foundations largely shipped; web UI shell in build; desktop not started.

- id: platform.workers-api
  name: Workers REST API
  scope: Cloudflare Workers backend on Hono exposing a REST API documented by OpenAPI 3.1.
  status: partial
  slices: 0-1-walking-skeleton, 0-5a-api-contract-foundation, 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0001, ADR-0022, ADR-0069
  evidence: apps/worker/src/app.ts, apps/worker/src/routes/
  notes: First-party same-origin /api surface live; the public token-auth host is reserved, not built.

- id: platform.workers-api.code-as-contract
  name: Code-as-contract OpenAPI
  scope: Each endpoint defined once with zod via @hono/zod-openapi, deriving the typed client and the emitted OpenAPI 3.1 spec.
  status: shipped
  surface: internal
  slices: 0-5a-api-contract-foundation, 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0066, ADR-0067
  spec: docs/specs/2026-06-04-api-contract-design.md
  evidence: apps/worker/src/contracts/, apps/worker/openapi/openapi.json

- id: platform.workers-api.contract-toolchain
  name: Spec CI toolchain
  scope: Spectral linting, Prism mock smoke, oasdiff breaking-change detection, and snapshot drift gates over the emitted spec.
  status: shipped
  surface: internal
  slices: 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0066
  evidence: apps/worker/openapi/ committed snapshot + CI contract gates
  notes: Spectral duplicated-entry-in-enum rule disabled (crash on null-valued extensions), recorded as an ADR-0066 amendment.

- id: platform.workers-api.typed-client
  name: Generated typed client
  scope: Committed Hey API plus Svelte Query v6 client generated from the emitted spec, operationId-keyed factories.
  status: shipped
  surface: internal
  slices: 0-5b-api-contract-enforcement-pipeline
  evidence: packages/api-client

- id: platform.workers-api.route-chokepoint
  name: Route metadata chokepoint
  scope: Ordered enforcement chain (tenancy, authn, RBAC, idempotency, rate limit) driven by per-route declared metadata, with a conformance fitness suite.
  status: shipped
  surface: internal
  slices: 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0067
  evidence: apps/worker/src/chokepoint/chokepoint.ts

- id: platform.workers-api.public-api-host
  name: Public API host
  scope: api.magnacarta.esq token-authenticated third-party/SDK surface, separated from cookie-auth first-party calls by host.
  status: not-started
  notes: Host reserved by design; only the same-origin first-party surface exists.

- id: platform.workers-api.service-bindings
  name: Internal Worker RPC
  scope: Plugin/core and heavy-service calls over Cloudflare service bindings, separate from the public REST surface.
  status: shipped
  surface: internal
  adrs: ADR-0096, ADR-0122
  evidence: SCAN_SERVICE / BUNDLE_SERVICE bindings; apps/{scan-worker,bundle-worker,convert-worker,ocr-worker,recovery-worker,file-repair-worker}

- id: platform.web-spa
  name: Web SPA
  scope: Svelte 5 / SvelteKit SPA (adapter-cloudflare) served as Workers static assets, login-gated, per-route code-splitting.
  status: partial
  slices: 0-1-walking-skeleton, 0-7b-auth-ui-deferred-surfaces
  adrs: ADR-0005
  evidence: apps/web/src/routes/ (login, matters, settings, tools, account)
  notes: Skeleton shipped; app shell and first operable surfaces in build on branch slice-0-7b-app-shell.

- id: platform.web-spa.app-shell
  name: App shell and first surfaces
  scope: Authenticated application shell, navigation, settings surfaces, matter and tools views.
  status: in-build
  surface: screen
  slices: 0-7b-auth-ui-deferred-surfaces
  spec: docs/specs/2026-07-02-slice-0-7b-stage-1-app-shell-design.md
  evidence: apps/web/src/lib/view-shell, docs/active-work/slice-0-7b-app-shell.md; branch slice-0-7b-app-shell on origin

- id: platform.web-spa.multi-tab-sync
  name: Cross-tab state sync
  scope: BroadcastChannel cache-invalidation broadcast so an edit in one tab updates other tabs and windows.
  status: not-started
  adrs: ADR-0054

- id: platform.web-spa.popout-windows
  name: Pop-out windows
  scope: Optional pop-out windows for documents and matters with coherent state.
  status: not-started

- id: platform.web-spa.app-shell-caching
  name: Service-worker asset cache
  scope: Service worker caches app shell/assets only, no client-data caching, cleared on logout; web app deliberately not an installable PWA.
  status: not-started
  adrs: ADR-0025

- id: platform.web-spa.public-surfaces
  name: Public web surfaces
  scope: Marketing site, help center, public intake forms, product-updates pages rendered separately (static/SSR) for SEO.
  status: not-started
  notes: Crawler directives for private surfaces exist (apps/worker/src/crawler-directives.ts); the public sites themselves do not.

- id: platform.desktop
  name: Tauri desktop shell
  scope: Tauri 2 shell reusing the identical Svelte bundle and Workers API, shipped after the web MVP.
  status: not-started
  adrs: ADR-0002, ADR-0023, ADR-0024
  evidence: docs/desktop-build-avenues.md (accumulating opportunity log; no Tauri code in tree)
  audience: public
  public-name: Desktop app
  public-summary: The same product as an application on your own machine, with the browser version always available and no feature only in one of them.

- id: platform.desktop.parity
  name: Web/desktop parity policy
  scope: No platform-exclusive features; desktop adds only optional local accelerations with a complete server/web fallback.
  status: not-started
  adrs: ADR-0023
  notes: Policy accepted; nothing to enforce until the desktop build begins. Scanning parity framing revised to MFP-receiving plus LAN bridge.

- id: platform.desktop.local-accelerations
  name: Desktop local accelerations
  scope: Local bulk ingest, on-device OCR (same engine/models), local Tantivy index, OS keychain, native filesystem and notifications.
  status: not-started

- id: platform.desktop.offline-sync
  name: Desktop offline and sync
  scope: On-disk cache persister plus a durable outbound mutation queue replayed on reconnect.
  status: not-started
  adrs: ADR-0054, ADR-0057

- id: platform.rust-core
  name: Rust shared core
  scope: Rust used surgically — server engines in Containers, scoped shared cores compiled to WASM for web/Workers and native for desktop.
  status: partial
  surface: internal
  adrs: ADR-0024, ADR-0128, ADR-0129
  evidence: crates/{pdf-core,email-core,ocr-core,decryption-core,recovery-core,engine-host}
  notes: PDF/email/OCR/decryption/recovery cores and the engine-host seam built; Tantivy search and the document-generation merge engine not started (Discovery and Documents areas).

- id: platform.scan-capture
  name: Inbound capture (scan-to-matter)
  scope: MFP/copier scanning treated as a receiving-plus-routing problem: Magna Carta as a destination for scan-to-email/eSCL/WSD, never per-vendor panel apps as core.
  status: partial
  notes: Named in the white paper as needing its own subsystem spec; only the source-agnostic ingest substrate exists.

- id: platform.scan-capture.ingest-chokepoint
  name: Source-agnostic ingest pipeline
  scope: One staged/quarantine incoming pipeline (scan verdict, staff-accept onto a matter) shared by uploads and future scan/email sources.
  status: shipped
  surface: awaiting-screen
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  spec: docs/specs/2026-06-16-slice-2-1-inbound-upload-untrusted-pipeline-design.md
  evidence: apps/worker/src/files/, containers/scan, apps/scan-worker

- id: platform.scan-capture.inbound-email
  name: Inbound email capture
  scope: Receiving scan-to-email / inbound mail on Cloudflare via an Email Worker into the ingest pipeline (25 MiB ceiling noted).
  status: designed
  spec: docs/specs/2026-06-16-email-filing-design.md
  evidence: crates/email-core (parse engine built as substrate; no Email Worker receiving path)

- id: platform.scan-capture.matter-routing
  name: Inbound matter routing
  scope: Routing model for inbound captures: firm-wide intake queue, barcode/QR cover-sheet auto-filing, per-matter intake aliases.
  status: not-started

- id: platform.scan-capture.desktop-lan-bridge
  name: Desktop LAN scanner bridge
  scope: Desktop-attached scanner (TWAIN/eSCL) and on-LAN MFP bridge protocol set (eSCL/WSD/SMB/WebDAV terminating on desktop).
  status: deferred
  notes: Explicitly deferred to the build in the white paper, alongside the large-scan fallback.

- id: platform.scan-capture.vendor-panel-apps
  name: Per-vendor MFP panel apps
  scope: Apps on vendor firmware platforms (MEAP, EIP, ESA, OXP, OSA, eSF, HyPAS).
  status: deferred
  notes: Rejected up front as core (unbounded per-vendor integration tax); optional single-dominant-device app deferred.

- id: platform.url-navigation
  name: URL and navigation architecture
  scope: Real deep-linkable permalink per view; matter-number canonical URLs over immutable opaque handles; path=addressable state, query=refinement.
  status: partial
  adrs: ADR-0052
  evidence: apps/web/src/routes/(app)/matters/[id], packages/matters (numbering engine), packages/identifiers (opaque handles)

- id: platform.url-navigation.matter-number-urls
  name: Matter-number URL scheme
  scope: Canonical human-facing matter-number URL, firm-configurable (opaque option), sealed matters force-opaque, firm-bound resolution.
  status: partial
  surface: awaiting-screen
  adrs: ADR-0079
  evidence: packages/matters numbering engine + apps/web matter routes
  notes: Backend numbering shipped; configurable scheme/forced-opaque URL behavior awaits the web matter surface.

- id: platform.url-navigation.alias-redirects
  name: Renumbering alias redirects
  scope: Prior matter numbers kept as aliases that 301-redirect to the current canonical URL; opaque handle always resolves.
  status: not-started

- id: platform.url-navigation.reserved-namespace
  name: Reserved route namespace
  scope: Maintained reserved list of top-level host and path names so user-influenced segments cannot shadow system routes.
  status: not-started

- id: platform.url-navigation.host-separation
  name: Host and auth-model separation
  scope: app/api/portal/marketing hosts; firm resolved from session never the address; cookie auth same-origin vs token auth by host.
  status: partial
  surface: internal
  evidence: apps/worker session-context + same-origin /api
  notes: First-party host + session-resolved firm shipped; api. and portal. hosts not stood up.

- id: platform.url-navigation.custom-domains
  name: White-label custom domains
  scope: Cloudflare for SaaS custom-domain seam (app.firm.com to firm lookup); per-firm vanity subdomains rejected.
  status: deferred
  notes: Shaped but deferred in the white paper.

- id: platform.client-state
  name: Client data and state architecture
  scope: Three-way state split with one owner each: URL state in the router, server state in TanStack Query v6, local/UI state in Svelte 5 runes.
  status: partial
  adrs: ADR-0054

- id: platform.client-state.server-state-query
  name: Server-state caching layer
  scope: TanStack Query caching, dedup, refetch-on-focus, optimistic mutations with rollback surfacing the Error ID, keys derived from the contract client.
  status: partial
  surface: internal
  evidence: packages/api-client Svelte Query factories
  notes: Factories shipped; app-wide adoption rides the 0-7b shell build.

- id: platform.client-state.live-job-channels
  name: Per-feature live channels
  scope: Durable-Object-backed channels only where needed: long-running job progress and the cross-device live timer.
  status: shipped
  surface: internal
  adrs: ADR-0131
  evidence: apps/worker/src/timer/, apps/worker/src/routes/bundle-status.ts, async bulk-download job DO

- id: platform.client-state.global-server-push
  name: Global server-push layer
  scope: Per-matter/per-firm push channel extending the DO-channel primitive.
  status: deferred
  notes: Explicitly rejected for v1, kept as a seam.

- id: platform.client-state.local-first-sync
  name: Local-first sync engine
  scope: Full client sync engine (TanStack DB / Zero / Triplit class).
  status: cut
  notes: Rejected as the default (fights the server-authoritative ledger and per-firm isolation); kept only as a seam.

- id: platform.architectural-integrity
  name: Architectural integrity and coherence
  scope: Coherence engineered as a property of the codebase: prevent structurally, fail loudly in CI, make the right thing discoverable.
  status: partial
  adrs: ADR-0051

- id: platform.architectural-integrity.chokepoint-seams
  name: Chokepoint seams
  scope: Cross-cutting concerns as properties of a mandatory path: firm-scoped data access, protected() fields, audit-on-write, outbox-on-effect.
  status: shipped
  surface: internal
  adrs: ADR-0003, ADR-0026
  evidence: packages/data-access/src/effect-batch.ts, protected-fields.ts, apps/worker/src/chokepoint/

- id: platform.architectural-integrity.registry-first
  name: Registry-first pattern
  scope: Growing categories as declarative registries: permissions, identifier prefixes, protected fields, settings, conversion formats, tools catalog, flags.
  status: shipped
  surface: internal
  evidence: packages/access-control, packages/identifiers prefix registry, packages/data-access/src/protected-field-registry.ts, packages/tools, packages/feature-flags

- id: platform.architectural-integrity.fitness-functions
  name: Architectural fitness functions
  scope: CI checks over the architecture itself: boundary/dependency rules, custom lint, conformance tests over registries and the OpenAPI contract, LLM tier.
  status: partial
  surface: internal
  adrs: ADR-0070
  evidence: tooling/lint-process-references.mjs, apps/worker conformance suite, design-system fitness gates
  notes: Deterministic tiers shipped piecemeal per area; the propose-only LLM-as-fitness-function tier is not built (docs-sync agent exists for docs, not architecture).

- id: platform.architectural-integrity.capability-indexes
  name: Generated read-first indexes
  scope: Capability map generated from registries and module surfaces, regenerated in CI with fail-on-drift, surfaced by area CLAUDE.md files.
  status: not-started
  adrs: ADR-0051

- id: platform.architectural-integrity.spec-plan-workflow
  name: Spec-plan-execute continuity
  scope: Per-slice written designs and plans persisted in the repo so sessions resume from the plan.
  status: shipped
  surface: internal
  evidence: docs/specs/ (170+ design/plan documents), STATUS.md pipeline

- id: platform.tenancy
  name: Tenancy and data isolation
  scope: Three tiers: control-plane D1 (identity, firm registry), per-firm database, per-firm R2 bucket; firm is the unit of tenancy.
  status: partial
  adrs: ADR-0003

- id: platform.tenancy.control-plane
  name: Control-plane database
  scope: Central D1 holding credentials, sessions, the single firm_id per user, and the firm registry; no client or matter content.
  status: shipped
  surface: internal
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  evidence: packages/database/src/control-plane-schema.ts

- id: platform.tenancy.per-firm-database
  name: Per-firm database
  scope: Per-firm structured business data in an isolated database.
  status: shipped
  surface: internal
  slices: per-firm-database-durable-object
  adrs: ADR-0003, ADR-0140
  spec: docs/specs/2026-06-23-per-firm-database-durable-object-design.md
  evidence: apps/worker/src/firm-database/, packages/database/src/per-firm-schema.ts
  notes: Realized as a firmId-addressed FirmDatabase SQLite Durable Object, superseding the per-firm-D1 half of the original decision.

- id: platform.tenancy.per-firm-bucket
  name: Per-firm R2 bucket
  scope: Per-firm versioned file storage; bulk content always to R2, never the database.
  status: shipped
  surface: internal
  slices: 1-1-matters-locations-file-manager
  evidence: packages/file-manager, apps/worker firm provisioning (R2 create)

- id: platform.tenancy.firm-scoped-dal
  name: Firm-scoped data-access layer
  scope: All business data through the firm-scoped data-access layer; no query crosses firms.
  status: shipped
  surface: internal
  slices: 0-2-foundational-data-money-identifiers-database-data-access
  adrs: ADR-0003, ADR-0071
  spec: docs/specs/2026-06-04-foundational-data-conventions-design.md
  evidence: packages/data-access

- id: platform.tenancy.member-mirror
  name: Member mirror sync
  scope: Per-firm member table mirroring the firm's users by global user_id (role, location, rate, display identity); provision/deactivate writes both places.
  status: shipped
  surface: internal
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  evidence: apps/worker/src/member-provision-consumer.ts, packages/data-access/src/member-statements.ts

- id: platform.tenancy.locations-dimension
  name: Locations inside the firm
  scope: Offices as a first-class dimension inside the per-firm database, never a separate tenant; firm-wide Directory and conflicts.
  status: shipped
  surface: awaiting-screen
  slices: 1-1-matters-locations-file-manager
  adrs: ADR-0031
  evidence: packages/locations

- id: platform.tenancy.firm-provisioning
  name: Firm provisioning
  scope: Idempotent, resumable firm resource provisioning behind a provider port (pool claim now, REST adapter for real D1/R2).
  status: shipped
  surface: internal
  slices: 0-4-auth-rbac-skeleton-firm-provisioning
  evidence: apps/worker/src/firm-provisioner.ts, firm-resource-provider.ts

- id: platform.tenancy.backup-dr
  name: Backup and disaster recovery
  scope: Two layers: platform point-in-time recovery for operational mistakes, plus exported snapshots for long-term and disaster recovery.
  status: partial
  adrs: ADR-0050

- id: platform.tenancy.backup-dr.time-travel
  name: Point-in-time recovery layer
  scope: D1 Time Travel 30-day any-minute restore, no setup.
  status: shipped
  surface: internal
  notes: Platform-provided for the control-plane D1; per-firm data now lives in the FirmDatabase Durable Object (ADR-0140), whose PITR story should be re-verified against this promise.

- id: platform.tenancy.backup-dr.export-snapshots
  name: Export snapshots
  scope: Cron-triggered Workflow fanning out across firms, streaming zstd-compressed SQL dumps into each firm's R2 under backups/, control plane included; restore drills.
  status: not-started
  adrs: ADR-0050, ADR-0078
  evidence: no backup workflow in apps/worker/src/scheduled.ts

- id: platform.tenancy.backup-dr.gfs-retention
  name: GFS retention tiering
  scope: Daily 30d, weekly 1y, monthly/yearly 7+ years; aged snapshots tier to Infrequent Access.
  status: not-started

- id: platform.tenancy.backup-dr.bucket-locks
  name: Backup immutability locks
  scope: Prefix-scoped R2 bucket-lock retention rules per GFS tier so snapshots cannot be deleted before aging out.
  status: not-started

- id: platform.tenancy.backup-dr.offsite-export
  name: Off-Cloudflare export
  scope: Off-Cloudflare export seam for account-loss/catastrophe/certified-WORM tail.
  status: deferred
  notes: Explicitly designed-but-deferred in the white paper.

- id: platform.primitives
  name: Cloudflare primitive adoption
  scope: The mapped platform primitives actually in use beyond Workers/D1/R2 (covered by other nodes).
  status: partial

- id: platform.primitives.durable-objects
  name: Durable Objects
  scope: Live collaboration/state and container control: FirmDatabase, live timer, bulk-download jobs, per-document edit sessions.
  status: shipped
  surface: internal
  adrs: ADR-0131, ADR-0140
  evidence: apps/worker/src/firm-database/, apps/worker/src/timer/, apps/magna-carta-edit

- id: platform.primitives.queues
  name: Queues
  scope: Async work: file ingest, member provisioning, outbox relay delivery, per-firm consumers.
  status: shipped
  surface: internal
  adrs: ADR-0155
  evidence: apps/worker files-ingest consumer, member-provision-consumer.ts

- id: platform.primitives.containers
  name: Containers
  scope: Heavy services in Containers: Collabora editing, malware scan, OCR, raster conversion, bundling, recovery, file repair.
  status: shipped
  surface: internal
  adrs: ADR-0122, ADR-0138
  evidence: containers/{collabora,scan,ocr,raster,bundle,recovery,file-repair}
  notes: LibreOffice headless from the original mapping superseded by the in-house-only conversion decision (ADR-0116); Tantivy container not started (Discovery phase).

- id: platform.primitives.vectorize
  name: Vectorize semantic search
  scope: Semantic search over Vectorize.
  status: not-started
  notes: Rides the Discovery phase.

- id: platform.primitives.kv
  name: KV cache/config
  scope: KV for cache and config surfaces.
  status: shipped
  surface: internal
  evidence: apps/status-worker (STATUS_KV)

- id: platform.primitives.worker-secrets
  name: Worker secrets anchors
  scope: Root KEK, session-signing, transactional-email and admin keys as Worker secrets with a required-secrets deploy gate.
  status: shipped
  surface: internal
  evidence: wrangler secrets.required gate; docs/conventions/security.md

- id: platform.primitives.telemetry
  name: Telemetry pipeline
  scope: Workers Logs / Analytics Engine telemetry with structural redaction, correlation ids, and Error IDs.
  status: shipped
  surface: internal
  slices: 0-6-telemetry-baseline-platform-closeout
  adrs: ADR-0074
  spec: docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md
  evidence: packages/telemetry, apps/worker/src/telemetry-middleware.ts

- id: platform.time-model
  name: Time, dates and timezones
  scope: Time modeled by kind — UTC instants, civil dates plus jurisdiction zone, wall-clock recurrences, durations — on the Temporal API.
  status: partial
  adrs: ADR-0055
  evidence: packages/database/src/per-firm-schema.ts (by-kind temporal columns), design-system Calendar typed CalendarDate
  notes: Convention decided and applied in schemas; no Temporal-based formatting layer or storage fitness function in the tree yet.

- id: platform.time-model.zone-context
  name: Zone context homes
  scope: IANA zone on each Location supplying default matter jurisdiction; per-user display-zone preference.
  status: not-started
  evidence: no zone column in packages/locations/src

- id: platform.time-model.rendering-enforcement
  name: Zone rendering enforcement
  scope: Single UI formatting layer rendering in an explicit zone plus a fitness function forbidding naive local datetimes in storage.
  status: not-started

- id: platform.durability-on-close
  name: Durability on close
  scope: No graceful close ever trusted: acknowledged writes durable, replay safe, close/logout guards flush-first, autosaved server-side drafts.
  status: partial
  adrs: ADR-0057

- id: platform.durability-on-close.server-durability
  name: Server-side durability
  scope: Idempotent replay, outbox, DO durable storage for timer/job state, at-least-once queues with idempotent consumers.
  status: shipped
  surface: internal
  evidence: packages/data-access (idempotency + outbox), apps/worker/src/timer/

- id: platform.durability-on-close.client-guard
  name: Shared close/logout guard
  scope: One shared client primitive for beforeunload/close-requested flush-then-warn; logout cache-clear gated on drained queue.
  status: not-started
  notes: Awaits the web app shell; numbers (flush/checkpoint intervals) deferred to the build by design.

- id: platform.durability-on-close.draft-autosave
  name: Server-side draft autosave
  scope: Editor and form input autosaved as server-side drafts on an interval.
  status: not-started

- id: platform.money
  name: Money and currency
  scope: Integer minor units only (amounts at 2 dp, rates at 4 dp), ISO-4217 tag, Dinero.js v2 bigint behind an in-house money module seam.
  status: partial
  slices: 0-2-foundational-data-money-identifiers-database-data-access
  adrs: ADR-0061
  spec: docs/specs/2026-06-08-money-package-implementation-plan.md
  evidence: packages/money

- id: platform.money.rounding-helpers
  name: Boundary-named rounding
  scope: Intent-named helpers: tax half-up, invoice-line half-up, GL banker's, splits largest-remainder; no silent default mode.
  status: shipped
  surface: internal
  evidence: packages/money (named rounding + largest-remainder allocate)

- id: platform.money.multi-currency
  name: Multi-currency / FX
  scope: FX machinery beyond the carried currency field.
  status: deferred
  notes: Field exists so multi-currency is a later evolution; explicitly not built (design for the superset, ship the subset).

- id: platform.identifiers
  name: Identifier strategy
  scope: Type-prefixed CSPRNG-random URL-safe handle as the single primary key; ~126-bit guess-resistance; time-encoded ids rejected.
  status: shipped
  surface: internal
  slices: 0-2-foundational-data-money-identifiers-database-data-access
  adrs: ADR-0062
  spec: docs/specs/2026-06-09-identifiers-package-implementation-plan.md
  evidence: packages/identifiers (prefix registry, branded types, UNIQUE-insert retry, seeded fixture source)

- id: platform.idempotency
  name: Idempotency
  scope: Client-generated Idempotency-Key on every mutation; same-key replay, in-progress 409, fingerprint-mismatch 422; row and effect commit atomically.
  status: shipped
  surface: internal
  slices: 0-2-foundational-data-money-identifiers-database-data-access, 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0063
  evidence: packages/data-access/src/{idempotency-statements,hono-idempotency-middleware,run-idempotent-effect}.ts
  notes: Per-route required/optional declaration enforced by the conformance suite; TTL purge cron wired.

- id: platform.outbox
  name: Transactional outbox
  scope: Effects recorded as outbox rows in the same transaction as the business change; relay publishes to Queues; idempotent consumers; dead-letter to observability.
  status: partial
  slices: 0-2-foundational-data-money-identifiers-database-data-access
  adrs: ADR-0064
  evidence: packages/data-access/src/{outbox-statements,outbox-relay}.ts, apps/worker cron relay sweep

- id: platform.outbox.saga-workflows
  name: Sagas via Workflows
  scope: Multi-step external flows composed as Workflows with compensating actions on the outbox + idempotency primitives.
  status: not-started
  adrs: ADR-0150
  notes: Decision accepted; no Workflow entrypoint in the tree yet.

- id: platform.schema-migration
  name: Schema migration and the fleet
  scope: Drizzle single source for types and migrations, two lineages, fleet rollout with per-firm isolation, expand-contract discipline.
  status: partial
  slices: 0-2-foundational-data-money-identifiers-database-data-access
  adrs: ADR-0065
  spec: docs/specs/2026-06-09-database-package-implementation-plan.md
  evidence: packages/database (fleet runner, expand-contract guard, schema fitness functions)

- id: platform.schema-migration.fleet-runner
  name: Fleet rollout orchestrator
  scope: Bounded-concurrency fan-out applying pending per-firm migrations, quarantine on failure, idempotent resume, version recorded in the firm registry.
  status: shipped
  surface: internal
  evidence: packages/database migration runner, apps/worker/src/per-firm-migrations.ts

- id: platform.schema-migration.control-plane-applier
  name: Control-plane auto-applier
  scope: Automatic application of control-plane migrations on deploy.
  status: shipped
  surface: internal
  slices: release-channels-backend-rails
  adrs: ADR-0151
  spec: docs/specs/2026-06-26-control-plane-migration-applier-design.md
  evidence: apps/worker/src/control-plane-migrations.ts

- id: platform.schema-migration.monotonic-ids
  name: Monotonic migration ids
  scope: Collision-proof migration numbering across parallel branches.
  status: shipped
  surface: internal
  spec: docs/specs/2026-07-03-monotonic-migration-ids-design.md
  evidence: packages/database/scripts/timestamp-latest-migration.mjs post-processes drizzle-kit generate into a UTC-timestamp id and rewrites the journal tag; both lineages under packages/database/drizzle/ carry timestamp-named migrations over a single collapsed baseline.
  notes: Was in-build against an active-work note that no longer exists; the scheme and the pre-production baseline collapse the design called for are both on main.
