# Integrations & Plugins

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Integrations and tools -->

- id: integrations
  name: Plugin / add-on system
  scope: Ports-and-adapters integration framework, manifest-driven registration, first-party adapters, the Tools catalog, and the future third-party marketplace.
  status: partial
  slices: integration-port-system, integration-platform-foundation
  adrs: ADR-0015, ADR-0091, ADR-0096
  evidence: packages/integrations and packages/tools, with ten built tool/adapter packages on main (ai-detection, conversion, file-integrity, file-type, government-links, metadata, property-links, safe-browse, shipping, whois). Seventeen of the nineteen catalog manifests are backed by an in-repository library and only two by an integration, which is the shape of the area: the tool set is built, the vendor ports are not.
  notes: First-party only today; C seam to a marketplace documented, not built.

- id: integrations.port-framework
  name: Integration port framework
  scope: Typed category ports with vendor adapters behind them; canonical types, manifest, registry, dispatch, problem mapping.
  status: shipped
  slices: integration-port-system
  adrs: ADR-0091, ADR-0092
  spec: docs/specs/2026-06-16-integration-port-system-design.md
  evidence: packages/integrations/src (port.ts, manifest.ts, registry.ts, dispatch.ts, canonical.ts).

- id: integrations.port-framework.connections-credentials
  name: Connection & credential model
  scope: Per-functionality connection persistence and credential storage for adapters; API-key credential kind; OAuth lifecycle.
  status: partial
  surface: internal
  adrs: ADR-0092, ADR-0095
  evidence: packages/integrations/src/connection.ts + credentials.ts; apps/api-worker/src/plugins/secret-store.ts; API-key kind live for EasyPost.
  notes: OAuth connection flow deferred to the first OAuth adapter, gated on Google CASA / Microsoft verification. The per-firm credential READ is still unbuilt and now says so — unbuiltCredentialStore resolves to the credential-store-not-implemented dispatch outcome instead of throwing.

- id: integrations.platform-foundation
  name: Manifest-driven registration
  scope: One declarative IntegrationManifest per integration; central registry drives route mounting, adapter resolution, and PluginRuntime wiring.
  status: shipped
  surface: internal
  slices: integration-platform-foundation
  adrs: ADR-0096
  spec: docs/specs/2026-06-17-integration-platform-foundation-design.md
  evidence: apps/api-worker/src/plugins/ (registry.ts, runtime.ts, shipping-plugin.ts).

- id: integrations.c-transition
  name: Plugin transport progression (C seam)
  scope: In-process plugins now; service-binding Workers (C1) and Workers-for-Platforms isolation for third-party plugins (C2) behind the PluginRuntime seam.
  status: deferred
  adrs: ADR-0097
  evidence: ADR-0097 records the seam as named-not-built; trigger is the first untrusted/third-party plugin, not a date.

- id: integrations.marketplace
  name: Third-party plugin marketplace
  scope: Marketplace catalog of third-party plugins deployed in a dispatch namespace.
  status: not-started
  adrs: ADR-0097
  evidence: No catalog or dispatch-namespace code; named as the Spec 2 stage of the manifest platform.
  audience: public
  public-name: Third-party add-ons
  public-summary: Connect tools built by other people, without giving them the run of your data.

- id: integrations.ports
  name: Integration category ports
  scope: The named outward-reaching category ports (email/calendar, legal research, accounting, payments, e-signature, messaging, password manager)
  status: not-started
  notes: The port framework itself is shipped; the first credentialed port (email/calendar) is gated on the compliance review

- id: integrations.ports.email-calendar
  name: Email / calendar adapter
  scope: First planned credentialed vendor port: email filing and calendar sync into matters.
  status: designed
  adrs: ADR-0092
  spec: docs/specs/2026-06-16-email-filing-design.md
  evidence: Design spec on main; no adapter package; OAuth prerequisite unmet.
  notes: Distinct from the built @magna-carta/email parse engine (documents area).

- id: integrations.ports.legal-research
  name: Legal-research port
  scope: Port for CoCounsel/Westlaw, Lexis, PACER adapters; design-the-port-now, license-the-adapter-later.
  status: not-started
  evidence: No port or adapter code; vendor API entitlement recorded as a procurement prerequisite.

- id: integrations.ports.accounting-banking
  name: Accounting / banking ports
  scope: QuickBooks-class accounting and banking data ports.
  status: not-started
  evidence: No port or adapter code in packages/.

- id: integrations.ports.payments
  name: Payments port
  scope: Payment processing behind a port, lowest-fee build on raw rails.
  status: not-started
  adrs: ADR-0032
  evidence: Decision recorded; no payments package or routes.

- id: integrations.ports.e-signature
  name: E-signature port
  scope: External e-signature vendor port complementing the native in-house signing core.
  status: not-started
  adrs: ADR-0045
  evidence: No vendor port; native PDF services / e-signature core tracked in the documents area (status.d/2-5-pdf-services-e-signature-core.md).

- id: integrations.ports.messaging-voice
  name: Messaging (SMS/MMS/RCS) & voice/telephony ports
  scope: Communications-layer channel ports; Telnyx launch adapter, swappable to Twilio/Bandwidth/Plivo.
  status: not-started
  adrs: ADR-0047
  evidence: Decision recorded; no messaging or voice code in packages/ or apps/api-worker.

- id: integrations.ports.password-manager
  name: Password manager / secrets vault port
  scope: Staff credential sync from the firm's vault (Bitwarden candidate launch adapter); scope of retrieval vs management open.
  status: researching
  evidence: docs/research/bitwarden-integration-assessment.md; no code.

- id: integrations.shipping
  name: Shipping & postage
  scope: EasyPost adapter behind a typed ShippingPort: address validation, rate-shopping, label purchase, tracking, refund.
  status: partial
  slices: shipping-postage-backend
  adrs: ADR-0094, ADR-0095
  spec: docs/specs/2026-06-16-shipping-easypost-design.md
  evidence: packages/shipping + apps/api-worker/src/routes/shipping.ts on main; UI, webhook ingress, and live firm secret deferred.
  audience: public
  public-name: Postage and shipping
  public-summary: Buy a label, track the package, and have the cost land on the matter.

- id: integrations.shipping.easypost-adapter
  name: EasyPost adapter & firm routes
  scope: Draft shipment, rate-shop, buy label (PDF copied to firm storage), track, refund; idempotent purchase; shipment/label/tracking tables.
  status: shipped
  surface: awaiting-screen
  slices: shipping-postage-backend
  adrs: ADR-0094
  evidence: packages/shipping/src/easypost/ + shipment routes; per status.d fragment built done, tests todo.
  notes: The firm-secret credential read is still an unbuilt seam (firmSecretStoreNotYetAvailable), so no postage account can be connected and no label can be rated or bought — but the seam now REFUSES rather than throws. Connect, rate-shop, purchase, track and refund answer 501 not-implemented from the credential-store-not-implemented dispatch outcome; before 2026-08-15 all five answered 500. Draft creation succeeds by design (a draft needs no carrier). Verified 2026-08-15, docs/research/2026-08-15-tools-reality-check.md.

- id: integrations.shipping.certified-mail
  name: Certified mail
  scope: USPS Certified Mail with return receipt and signature as a first-class shipment option.
  status: shipped
  surface: awaiting-screen
  evidence: Certified-mail options modeled in packages/shipping/src/canonical.ts and easypost/map.ts.

- id: integrations.shipping.tracking-webhook
  name: Push-webhook tracking ingress
  scope: Vendor webhook ingestion replacing pull-on-demand tracking.
  status: deferred
  evidence: Design records tracking as pull-on-demand at launch with webhook ingress as a seam.

- id: integrations.shipping.cost-recovery
  name: Postage cost-recovery seam
  scope: shipment.purchased event recording postage against the matter for cost recovery.
  status: shipped
  surface: internal
  adrs: ADR-0156
  evidence: handleShipmentPurchased in apps/api-worker/src/costs/recoverable-charge-consumer.ts subscribes to shipment.purchased on the transactional outbox and posts the charge through packages/costs/src/recoverable-charge.ts against the firm's recovery policy — a built consumer rather than a named seam.

- id: integrations.shipping.ui
  name: Shipping UI
  scope: Firm-facing surface for drafting, buying, and tracking shipments.
  status: deferred
  evidence: status.d/shipping-postage-backend.md marks UI deferred; no shipping pages in apps/web.

- id: integrations.tools-area
  name: Tools area
  scope: One Tools catalog surfacing first-party utilities and integration-backed tools through the global rail and contextual entry points; presentation layer above the plugin framework.
  status: partial
  slices: tools-area
  adrs: ADR-0101
  spec: docs/specs/2026-06-16-tools-area-design.md
  evidence: packages/tools catalog merged; every tool is a top-level ability at /<id> with a rail row in its subject cluster; per-tool pages landing one at a time.
  notes: There is no Tools AREA left in the interface sense — the owner retired the two-sided screen and then its index on 2026-09-16, because a tool reached through a screen about tools costs a navigation and a column of the tools you are not using. The catalog, the permissions and the contextual selector are what the node still names.

- id: integrations.tools-area.catalog
  name: Tools catalog package
  scope: Single source-of-truth catalog; adding a tool is one manifest entry; reflects connection health without holding credentials.
  status: shipped
  surface: internal
  slices: tools-area
  adrs: ADR-0101
  evidence: packages/tools/src/catalog.ts + apps/api-worker/src/routes/tools-connection.ts.

- id: integrations.tools-area.listing-page
  name: Tools listing page
  scope: A /tools page rendering the catalog grouped by subject, tiles or dense list, maturity-stage badges.
  status: cut
  slices: tools-area
  spec: docs/specs/2026-07-08-tools-listing-page-design.md
  notes: Built, shipped, and retired by the owner on 2026-09-16. It was a stop on the way to work - a member who wants the WHOIS lookup wants the WHOIS lookup, not a page about it - and the two things it carried that were worth keeping, the descriptors and the search, were never the page's: they are the presentation layer's, and the command palette has rendered them all along from one keystroke with no navigation first. Every tool is a top-level ability with a rail row of its own now (integrations.tools-area.rail-rows).

- id: integrations.tools-area.rail-rows
  name: Tools in the global rail
  scope: Every permitted tool as a top-level row in the rail's Tools group, folded into its subject cluster (Records, Internet, Mailing, Files), alphabetical within a cluster, derived from the catalog.
  status: shipped
  surface: screen
  slices: tools-area
  evidence: apps/web/src/lib/navigation/tool-sidebar.ts projecting packages/tools into rows, the cluster registry at apps/web/src/lib/navigation/clusters.ts, and the sub-menu parts (Sidebar.MenuTrigger, Sidebar.MenuSub) in packages/design-system/src/lib/components/sidebar. Held by apps/web/test/tools-navigation.test.ts.
  notes: A cluster is a fold and never a screen — nothing is reached through one, and a cluster holding a single row is seated as a plain row instead. The eight subject groups became four on the same ruling: eight headings over nine tools is a heading per tool, which is no grouping at all.

- id: integrations.tools-area.contextual-entry
  name: Contextual entry points
  scope: Tools reachable in context — command palette, file-context tags on file-shaped tools; Location/Directory entity entry points.
  status: partial
  surface: screen
  evidence: The command palette half is built and derived rather than hand-listed — apps/web/src/lib/navigation/tool-destinations.ts turns the catalog plus the presentation layer into searchable entries, so adding a tool to the catalog is what puts it in the palette. The context half is data and a selector with no consumer: every manifest declares contextTags, and toolsFor in packages/tools/src/select.ts filters the catalog by tag and permission, but only its own tests call it. No Location, Directory or file surface offers tools in context.

- id: integrations.tools-area.diagnostics-group
  name: Diagnostics group (firm usage)
  scope: Read-only firm usage snapshot in the Firm group, computed on request — storage by class, matters by type and by location, the file versioning breakdown, Directory and member counts, and the AI meters.
  status: shipped
  surface: screen
  adrs: ADR-0103
  spec: docs/specs/2026-06-17-firm-usage-diagnostics-design.md
  evidence: apps/api-worker/src/routes/firm-usage.ts (GET /api/v1/firm-usage) composing per-domain reads from matters, file-manager, locations, directory, data-access, and search; the tables-only screen built over apps/web/src/lib/firm-usage/ per docs/decisions/pending/firm-usage-is-quantitative-tables-computed-on-request.md.
  notes: It left the tool catalog on 2026-09-16 and is a Firm destination at /firm-usage beside Reports, keeping the tools:firmUsage key that gates it — a tool is a utility a member RUNS, and this runs nothing; it is the firm reading its own records. Storage totals read the storage_meter rollup, so they are zero for any firm whose files did not arrive through ingest until the daily reconciliation runs. Custodian holdings report per office through @magna-carta/custodian/usage (external roots on a Held Offsite row); per-firm compute stays a Soon table (waits on the Cloudflare Analytics API credential, the ADR-0103 deferral).

- id: integrations.tools-area.network-speed-test
  name: Network speed test
  scope: First tool with its own page: Cloudflare measurement engine, per-direction charts, AIM score, authenticated round-trip probe.
  status: shipped
  surface: screen
  spec: docs/specs/2026-07-09-network-speed-test-design.md
  evidence: A top-level route directory named after its catalog id, over apps/web/src/lib/tools/speed-test/ — the measurement engine, the per-direction charts, the quality scores and the authenticated connection probe; stage alpha on its rail row.

- id: integrations.tools
  name: First-party tool set
  scope: The credential-less first-party tools surfaced as top-level abilities in the rail
  status: partial
  audience: public
  public-name: Built-in tools
  public-summary: Small utilities where you need them: company and attorney-license lookups, county property records, domain and website checks, and file inspection.
  notes: Backends shipped across the set; tool UIs ride the design-system shell wave. Measured 2026-08-15 — 19 catalog manifests, 11 backends returning verified-correct answers, 2 with a page a person can open (WHOIS, speed test); the rest read "soon". docs/research/2026-08-15-tools-reality-check.md.

- id: integrations.tools.government-links
  name: Government & licensing links
  scope: Curated deep-links to government portals, business registries, and attorney-license lookups (renamed from parcels).
  status: shipped
  surface: awaiting-screen
  evidence: packages/government-links/src (business/, licensing/, property/, registry.ts); docs/research/attorney-license-lookup-coverage.md.
  notes: Coverage is uneven by domain and that is what a firm feels — business and attorney-licence are all 51 jurisdictions, property is 835 assessor sites across only 22 (Nevada and the Mountain West; no TX/FL/NY/IL/PA/OH/GA/NC/MI/NJ), plus 17 recorder sites and no GIS. Links verified live 2026-08-15, docs/research/2026-08-15-tools-reality-check.md.

- id: integrations.tools.property-links
  name: Property external links
  scope: Zillow/Redfin/Maps/Realtor deep-links for a Location; pure link helper, not a plugin.
  status: shipped
  surface: awaiting-screen
  slices: property-external-links
  adrs: ADR-0093
  spec: docs/specs/2026-06-16-property-links-design.md
  evidence: packages/property-links on main; UI rides the Locations surface.
  notes: County-assessor provider has landed (src/providers/county-assessor.ts), so five providers resolve. Redfin/Maps/assessor links verified live 2026-08-15; Zillow and Realtor.com answer bot mitigation to a non-browser client and stay unverified. On a partial address the Zillow/Redfin/Maps links silently drop state and ZIP — the UI must require the structured address. docs/research/2026-08-15-tools-reality-check.md.

- id: integrations.tools.whois
  name: WHOIS lookup
  scope: Public domain/IP registration lookup, RDAP-first with legacy port-43 fallback for ccTLDs; firm-internal security hygiene.
  status: shipped
  surface: screen
  adrs: ADR-0120, ADR-0121
  evidence: packages/whois/src (rdap.ts, legacy.ts) + apps/api-worker/src/routes/whois.ts, with its own page in the app's tools section over apps/web/src/lib/tools/whois/.
  notes: Report enrichment in flight on branch whois-report-enrichment. Verified against public record for six targets 2026-08-15; a registry with neither RDAP nor a port-43 host (234 of 1,438 TLDs) now answers 501 rather than 500. The port-43 socket has no read deadline and that path stays unverified. docs/research/2026-08-15-tools-reality-check.md.

- id: integrations.tools.safe-browse
  name: Safe website viewer
  scope: Renders a suspect URL in an isolated remote browser and returns a static snapshot (screenshot, redirect chain, text, links).
  status: shipped
  surface: screen
  adrs: ADR-0119, ADR-0120
  evidence: packages/safe-browse/src/capture.ts + apps/api-worker/src/routes/safe-browse.ts, with its own page in the app's tools section over apps/web/src/lib/tools/safe-browse/ (stage alpha). Verified against the deployed service 2026-09-18 — a capture returns a screenshot.
  notes: Renderer is Cloudflare Browser Rendering (env.BROWSER, quickAction), an account entitlement rather than anything in the repository, and still unexercisable locally (Miniflare's binding has no quickAction). The entitlement was confirmed live on 2026-09-18 by the first capture that succeeded; before that every capture failed on a wait for networkidle2 that a page holding a socket never reaches, reported as a capacity outage. Interactive live browsing is designed and not built — the shell's Live toggle renders as a Soon affordance and the seam is in ADR-0119.

- id: integrations.tools.metadata
  name: Metadata inspector & scrubber
  scope: Inspect and strip metadata from OOXML and JPEG/PNG/TIFF images; stateless.
  status: shipped
  surface: awaiting-screen
  slices: metadata-inspector-scrubber
  adrs: ADR-0123
  evidence: packages/metadata + apps/api-worker/src/routes/metadata.ts.
  notes: HEIC/PDF and a Container engine deferred; backend only, no screen yet. Verified end to end 2026-08-15 — inspect found a docx's author/company, scrub removed both and left the body text intact (docs/research/2026-08-15-tools-reality-check.md).

- id: integrations.tools.file-integrity
  name: File hash & integrity
  scope: Five-algorithm streaming hash, ingest-baseline compare, integrity receipt; introduced the file context tag.
  status: shipped
  surface: awaiting-screen
  slices: file-hash-integrity
  adrs: ADR-0143
  evidence: packages/file-integrity + apps/api-worker/src/routes/file-integrity.ts.
  notes: Backend only — no screen yet. All five digests verified byte-identical to md5sum/sha1sum/sha256sum on 2026-08-15 (docs/research/2026-08-15-tools-reality-check.md).

- id: integrations.tools.file-type
  name: File type verifier
  scope: Content-based file-type identification (Magika/ONNX in the scan container) behind a verify endpoint.
  status: shipped
  surface: awaiting-screen
  slices: file-type-verifier
  adrs: ADR-0160
  evidence: packages/file-type + apps/api-worker/src/routes/file-type.ts (POST /api/v1/file-type/verify).
  notes: Backend only, and the identification engine is the scan Container's /identify — the route answers 503 until magna-carta-scan is deployed carrying it, so nobody can get an answer yet. The report builder itself was reviewed and does not over-report "unverifiable". Queued in docs/deploy-queue.md.

- id: integrations.tools.ssrf-guard
  name: Outbound SSRF guard
  scope: Shared validation of every user-supplied outbound target before any fetch or render; platform invariant for outbound tools.
  status: shipped
  surface: internal
  adrs: ADR-0118
  evidence: packages/integrations/src/safe-target.ts consumed by whois/safe-browse paths.

- id: integrations.candidates
  name: Candidate integrations
  scope: The named future integration candidates from the white paper's catalog
  status: partial
  notes: Mostly unstarted by design; wellbeing resources shipped early

- id: integrations.candidates.public-records
  name: Public records / people search / skip tracing
  scope: Built-in feature (adapter-sourced data) for service of process, asset/witness location, conflicts and intake enrichment.
  status: researching
  evidence: docs/research/public-records-landscape.md; no code.

- id: integrations.candidates.document-comparison
  name: Document comparison / proofreading / metadata scrubbing suite
  scope: Built-in redline, proofread, and outbound-document scrubbing (Litera-class capability).
  status: not-started
  evidence: No artifact beyond the shipped metadata scrubber tool; catalogued as a future built-in.

- id: integrations.candidates.transcription-dictation
  name: Transcription & dictation
  scope: Built-in capture tied to the telephony port: recording to text to time entries and draft notes; swappable speech engine.
  status: not-started
  evidence: No code; depends on the unbuilt messaging/voice port.

- id: integrations.candidates.wellbeing-resources
  name: Wellbeing resources directory
  scope: Per-jurisdiction lawyer-assistance and mental-health resource registry (50 states, DC, territories, national safety net).
  status: shipped
  surface: awaiting-screen
  slices: wellbeing-resources
  evidence: packages/wellbeing-resources with generated data + verify:data drift guard; in-app UI deferred.

- id: integrations.candidates.wellbeing-nudges
  name: Practitioner work-session nudges
  scope: Opt-in, user-scoped long-session detection from timer/app activity with proportionate suggestions escalating to wellbeing resources; never management-visible.
  status: not-started
  evidence: No nudge engine or health-data adapter code; resources package is the only artifact.

- id: integrations.candidates.process-serving
  name: Process serving plugin
  scope: Order and track service of process with affidavit returned to the matter (ABC Legal / Proof class); high priority.
  status: not-started
  evidence: Catalogued candidate; no code or spec.

- id: integrations.candidates.identity-kyc
  name: Identity / AML / KYC / sanctions screening plugin
  scope: Client due diligence at intake feeding conflicts check.
  status: not-started
  evidence: Catalogued candidate; no code or spec.

- id: integrations.candidates.ai-drafting
  name: AI drafting / legal-AI assistant plugin
  scope: Third-party drafting/review surface (Harvey/Spellbook class), distinct from the legal-research port and native document assembly.
  status: not-started
  evidence: Catalogued candidate; no code or spec.

- id: integrations.candidates.automation-bridge
  name: Automation bridge plugin
  scope: Zapier/Make/outbound-webhook catch-all over the OpenAPI surface.
  status: not-started
  evidence: Catalogued candidate; no code or spec.

- id: integrations.candidates.property-data
  name: Property data plugin
  scope: Parcel/APN lookup and point-in-time AVM valuation.
  status: researching
  evidence: docs/research/property-data-integrations.md + parcels-property-records-architecture.md + nevada-parcel-apn-system.md.

- id: integrations.candidates.practice-area-gated
  name: Practice-area-gated plugins
  scope: Remote online notarization, court reporting / deposition scheduling, medical-records retrieval, translation/interpretation, expert-witness directories.
  status: not-started
  evidence: Catalogued candidates; no code or specs.

- id: integrations.candidates.operational-connectors
  name: Operational connectors
  scope: Accounting beyond QuickBooks, BI export, HR/payroll, tax 1099/W-9, e-fax, marketing/reviews; lower differentiation.
  status: not-started
  evidence: Catalogued candidates; no code or specs.
