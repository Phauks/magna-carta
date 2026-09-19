# Platform — Delivery, Architecture, Tenancy & Data Conventions

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Apps and access -->

- id: platform
  name: Platform
  scope: Delivery model, application architecture, architectural coherence, tenancy and isolation, Cloudflare primitive adoption, and the foundational data and runtime conventions.
  status: partial
  evidence: apps/api-worker, apps/web, packages/{data-access,database,money,identifiers}, crates/
  notes: Backend foundations largely shipped; web UI shell in build; desktop not started.

- id: platform.workers-api
  name: Workers REST API
  scope: Cloudflare Workers backend on Hono exposing a REST API documented by OpenAPI 3.1.
  status: partial
  slices: 0-1-walking-skeleton, 0-5a-api-contract-foundation, 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0001, ADR-0022, ADR-0069
  evidence: apps/api-worker/src/app.ts over eighty-two route modules in apps/api-worker/src/routes/, emitting 446 operations into the committed contract at apps/api-worker/openapi/openapi.json.
  notes: First-party same-origin /api surface live; the public token-auth host is reserved, not built.

- id: platform.workers-api.code-as-contract
  name: Code-as-contract OpenAPI
  scope: Each endpoint defined once with zod via @hono/zod-openapi, deriving the typed client and the emitted OpenAPI 3.1 spec.
  status: shipped
  surface: internal
  slices: 0-5a-api-contract-foundation, 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0066, ADR-0067
  spec: docs/specs/2026-06-04-api-contract-design.md
  evidence: apps/api-worker/src/contracts/, apps/api-worker/openapi/openapi.json

- id: platform.workers-api.contract-toolchain
  name: Spec CI toolchain
  scope: Spectral linting, oasdiff breaking-change detection, and snapshot drift gates over the emitted spec; the Prism mock server runs on demand rather than as a dependency.
  status: shipped
  surface: internal
  slices: 0-5b-api-contract-enforcement-pipeline
  adrs: ADR-0066
  evidence: apps/api-worker/openapi/ committed snapshot + CI contract gates
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
  evidence: apps/api-worker/src/chokepoint/chokepoint.ts

- id: platform.workers-api.domain-modules
  name: Domain-module route tree
  scope: The route surface as about twenty domain modules behind a manifest, contract shapes in the domain packages, an HTTP-versus-background import boundary, and the fitness tests that hold the shape.
  status: in-build
  surface: internal
  slices: api-worker-domain-modules
  spec: docs/specs/2026-09-18-api-worker-domain-modules-design.md
  evidence: apps/api-worker/src/bindings.ts + src/routes/domain-app.ts + the four fitness tests under apps/api-worker/test (route-table, route-hygiene-scan, route-shape-ratchet, http-background-boundary-scan); the route files themselves are still flat
  notes: In flight on docs/active-work/claude/adoring-ride-fe94q5.md. Lazy per-domain loading deferred pending a recorded startup trend; the background orchestration stays in this Worker per the extraction rubric.

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
  evidence: apps/web/src/routes/ (login, matters, settings, account, and a route per tool)
  notes: Skeleton shipped; the app shell and first operable surfaces are on main, and the settings sections are being completed under docs/active-work/claude/settings-implementation-plan-asr0l6.md.

- id: platform.web-spa.app-shell
  name: App shell and first surfaces
  scope: Authenticated application shell, navigation, settings surfaces, matter and tools views.
  status: partial
  surface: screen
  slices: 0-7b-auth-ui-deferred-surfaces
  spec: docs/specs/2026-07-02-slice-0-7b-stage-1-app-shell-design.md
  evidence: apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/view-shell, apps/web/src/routes/(app)/ (matters, settings, the tools at the top level); the July branch slice-0-7b-app-shell was superseded by the streams that landed these, and its note is retired
  notes: The shell, navigation, matter and tool views are on main; several settings sections are still stubs, which docs/active-work/claude/settings-implementation-plan-asr0l6.md is closing.

- id: platform.web-spa.rail-information-architecture
  name: The rail's information architecture
  scope: Five groups, each answering one question — Favorites, My Desk, Workspace, Money, Firm, Tools — with a fold at the group level and a sub-menu cluster inside a group.
  status: shipped
  surface: screen
  evidence: apps/web/src/lib/navigation/destinations.ts (the groups and the rows), clusters.ts (the sub-menus), sidebar-preferences.svelte.ts (the render tree, the two folds and the show/hide layer), and the sub-menu parts in packages/design-system/src/lib/components/sidebar. Held by apps/web/test/sidebar-groups.test.ts.
  notes: The owner's direction of 2026-09-16. Home and Notifications had sat in a fourteen-row Workspace group, which put "your morning" in the same list as "the firm's evidence"; My Desk is what the split says out loud. Firm Usage moved to Firm on the same ruling, and the tools became top-level rows folded into subject clusters.

- id: platform.web-spa.favorites
  name: Favorites
  scope: A member's own shortcuts to any address in the product — a matter, a tool, a record, a section deep inside one — saved from every screen's header and rendered as the rail's first group.
  status: shipped
  surface: screen
  audience: public
  public-name: Favorites
  public-summary: Star any page — a matter, a tool, a client record — and it sits at the top of your sidebar.
  evidence: apps/web/src/lib/navigation/favorites.svelte.ts (the store, the pathname identity, the glyph resolved from the area), apps/web/src/lib/navigation/favorite-control.svelte (the star every screen's header carries), and the Favorites group in sidebar-preferences.svelte.ts. Held by apps/web/test/favorites.test.ts.
  notes: Per browser, like every other sidebar preference; carrying them across a member's devices waits on the member-preferences store. The star is the favourite's mark and the eye is Customize's show/hide, which is the owner's ruling of 2026-09-16 — one symbol had been answering two questions.

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
  notes: Crawler directives for private surfaces exist (apps/api-worker/src/crawler-directives.ts); the public sites themselves do not.

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
  evidence: ten crates — pdf-core, email-core, ocr-core, decryption-core, recovery-core, discovery-core, search-core, engine-host, and the pdf-eval and search-eval harnesses beside them.
  notes: The Tantivy search core this said was not started is built (crates/search-core over tantivy 0.26 — schema, query, merge, split and directory), and so is the discovery core. The document-generation merge engine is deliberately NOT Rust: it shipped in TypeScript over fflate and fast-xml-parser (document-automation.generation-engine), so it is not a gap here.

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
  evidence: apps/api-worker/src/files/, containers/scan, apps/scan-worker

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
  notes: Parked by the white paper's Inbound capture topic, which rejects building on vendor firmware up front as an unbounded per-vendor integration tax and frames the area as receiving-plus-routing instead. A single-dominant-device panel app stays available as one adapter behind the capture port, which is what makes the rejection cheap to revisit.

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
  evidence: apps/api-worker session-context + same-origin /api
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
  evidence: apps/api-worker/src/timer/, apps/api-worker/src/routes/bundle-status.ts, async bulk-download job DO

- id: platform.client-state.global-server-push
  name: Global server-push layer
  scope: Per-matter/per-firm push channel extending the DO-channel primitive.
  status: deferred
  adrs: ADR-0054
  notes: Rejected for v1 by ADR-0054 and kept as a seam — freshness is refetch-on-focus plus the cross-tab broadcast, with per-feature live channels on the Durable-Object-per-job primitive only where genuinely needed. Extending that same primitive to a per-matter or per-firm channel is the reopening move if a real need appears.

- id: platform.client-state.local-first-sync
  name: Local-first sync engine
  scope: Full client sync engine (TanStack DB / Zero / Triplit class).
  status: cut
  adrs: ADR-0054
  notes: Cut as the default by ADR-0054 — it fights the server-authoritative ledger and the per-firm-D1 model — and kept only as a seam. Offline follows the delivery-model parity table instead: the web cache is in-memory and cleared on logout, and the desktop shell adds a persister plus an outbound mutation queue behind the same call sites.

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
  evidence: packages/data-access/src/effect-batch.ts, protected-fields.ts, apps/api-worker/src/chokepoint/

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
  evidence: apps/api-worker/test/conformance.test.ts over the route registries and the emitted contract, packages/design-system/test/fitness/ (off-token and import-boundary gates), and sixteen lint:\* scripts in package.json that the gate's Governance step derives rather than lists, so a new one runs on the pull request that adds it. Two are about capabilities nobody can reach: tooling/lint-unwired-writes fails an exported write-shaped function in apps/ or packages/ that nothing outside a test calls, and tooling/lint-ungranted-permissions fails a permission that gates a chokepoint route or a Tools catalogue manifest and that no migration seed grants to any role. Both were measured in several forms and kept in their narrowest; the permission scan reports one hit on today's tree, allowlisted with its reason, and replayed against 2026-06-22 it names documents:edit on the commit that introduced the route.
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
  evidence: apps/api-worker/src/firm-database/, packages/database/src/per-firm-schema.ts
  notes: Realized as a firmId-addressed FirmDatabase SQLite Durable Object, superseding the per-firm-D1 half of the original decision.

- id: platform.tenancy.per-firm-bucket
  name: Per-firm R2 bucket
  scope: Per-firm versioned file storage; bulk content always to R2, never the database.
  status: shipped
  surface: internal
  slices: 1-1-matters-locations-file-manager
  evidence: packages/file-manager, apps/api-worker firm provisioning (R2 create)

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
  evidence: apps/api-worker/src/member-provision-consumer.ts, packages/data-access/src/member-statements.ts

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
  evidence: apps/api-worker/src/firm-provisioner.ts, firm-resource-provider.ts

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
  evidence: no backup workflow in apps/api-worker/src/scheduled.ts

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
  evidence: apps/api-worker/src/firm-database/, apps/api-worker/src/timer/, apps/edit-worker

- id: platform.primitives.queues
  name: Queues
  scope: Async work: file ingest, member provisioning, outbox relay delivery, per-firm consumers.
  status: shipped
  surface: internal
  adrs: ADR-0155
  evidence: apps/api-worker files-ingest consumer, member-provision-consumer.ts

- id: platform.primitives.containers
  name: Containers
  scope: Heavy services in Containers: Collabora editing, malware scan, OCR, raster conversion, bundling, recovery, file repair.
  status: shipped
  surface: internal
  adrs: ADR-0122, ADR-0138
  evidence: ten containers — collabora, scan, ocr, raster, bundle, recovery, file-repair, and the three built since this list was written: libreoffice, search and discovery.
  notes: The Tantivy container this said was not started is built (containers/search over crates/search-core), and so is the discovery lane. LibreOffice headless returned as an in-house engine rather than an adopted service — containers/libreoffice is a Rust supervisor over a pool of office-suite child processes with no egress, which is what the in-house-only conversion decision (ADR-0116) asked for rather than what it ruled out.

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
  evidence: packages/telemetry, apps/api-worker/src/telemetry-middleware.ts

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
  status: partial
  surface: awaiting-screen
  evidence: Partial because the Location half is built and the per-user half is not. location.time_zone holds an IANA zone and never a fixed offset, because an offset breaks across daylight saving; packages/locations/src/location-service.ts refuses on write anything Intl cannot resolve, and an offset-shaped string by name. timeZoneForLocation in packages/document-assembly/src/resolve.ts is the ONE place it enters the platform, so an office recorded before the column existed falls back to the normalized zone in one spot rather than in every formatter. There is no per-user display-zone preference anywhere, and nothing derives a matter's jurisdiction from its office — location.jurisdiction is a separate column read by trust off the account's office, not by matters.

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
  evidence: packages/data-access (idempotency + outbox), apps/api-worker/src/timer/

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
  evidence: packages/data-access/src/{outbox-statements,outbox-relay}.ts, apps/api-worker cron relay sweep

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
  evidence: packages/database migration runner, apps/api-worker/src/per-firm-migrations.ts

- id: platform.schema-migration.control-plane-applier
  name: Control-plane auto-applier
  scope: Automatic application of control-plane migrations on deploy.
  status: shipped
  surface: internal
  slices: release-channels-backend-rails
  adrs: ADR-0151
  spec: docs/specs/2026-06-26-control-plane-migration-applier-design.md
  evidence: apps/api-worker/src/control-plane-migrations.ts

- id: platform.schema-migration.monotonic-ids
  name: Monotonic migration ids
  scope: Collision-proof migration numbering across parallel branches.
  status: shipped
  surface: internal
  spec: docs/specs/2026-07-03-monotonic-migration-ids-design.md
  evidence: packages/database/scripts/timestamp-latest-migration.mjs post-processes drizzle-kit generate into a UTC-timestamp id and rewrites the journal tag; both lineages under packages/database/drizzle/ carry timestamp-named migrations over a single collapsed baseline.
  notes: Was in-build against an active-work note that no longer exists; the scheme and the pre-production baseline collapse the design called for are both on main.
