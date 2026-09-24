# Changelog

All notable changes to Magna Carta are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); releases will follow [Semantic Versioning](https://semver.org/) once they begin.

This file **lives and breathes with the work:** every user-facing or otherwise notable change adds a **fragment** in `changelog.d/` in the **same commit** — a definition-of-done item (see [`docs/conventions/documentation.md`](docs/conventions/documentation.md)). The fragments are folded into `[Unreleased]` on `main`; at release, `[Unreleased]` is cut into a dated, versioned section.

Categories: **Added · Changed · Deprecated · Removed · Fixed · Security.**

> **Automation.** Notable changes are committed as per-entry fragments in `changelog.d/<slug>.md` on a branch; `vp run changelog-build` folds them into `[Unreleased]` on `main` (see [`documentation.md`](docs/conventions/documentation.md)). This in-house fragment assembler — the chosen approach over external tools (git-cliff / release-please / changesets) — keeps parallel worktrees from colliding on this file. Release-time version-cutting of `[Unreleased]` into a dated section is still to come. The propose-only **docs-maintenance agent** (white paper, _Maintenance agents_; ADR-0058) can later draft fragments from merged PRs for human approval.

## [Unreleased]

### Added

- **Community feedback board designed — native build supersedes the deferred-Fider lean (ADR-0044 amended)** (spec [`docs/specs/2026-06-17-community-feedback-board-design.md`](docs/specs/2026-06-17-community-feedback-board-design.md); white paper _Community & feedback forum_ §30 + _Product updates_ §31 amended): a 2026-06-17 changelog/feedback-tool survey (Linear, ClickUp/Canny, GitHub, Stripe, Vercel, Notion, UserJot, Featurebase, Frill, Productboard, Fider) settled §30's open delivery question against buying/hosting — **Fider** needs an off-Cloudflare **Postgres + mandatory SMTP**, is **AGPL-3.0**, and ships **no changelog and no roadmap/kanban UI**; its real surface is small (posts → votes → comments → tags → 6 statuses → 3 roles), so a **native build is less work than operating an off-Cloudflare host** and the only path that keeps everything on **control-plane D1 + Cloudflare-email** and honors the confidentiality boundary. **Decision:** build natively as a clean, extractable **`@magna-carta/community`** package (the government-links / property-links pattern), platform-level and isolated from the per-firm data-access layer so the isolation _is_ the confidentiality boundary. **Board first** (feature requests + upvote + comments + status pipeline `open→under_review→planned→in_progress→completed` + `declined`/`duplicate`, roadmap-as-filtered-view-by-status), with a **dormant `discussion` seam** for an open forum later; **display-name identity** (real name/firm never shown publicly, aggregate vote counts only, admins resolve the real account for moderation); the loop is **subscriber-carry + Cloudflare-email notify on ship**, never auto-authored prose (preserves ADR-0048's version-accuracy by construction). The **product-updates surface (ADR-0048) is unchanged** and remains standalone-buildable; the board is the requests/votes/discussion half it links into. **Design + decision only — no package, schema, route, or UI; implementation deferred until Fable is available again** (its own plan later).
- **Firm-usage diagnostics headless reads** (spec [`docs/specs/2026-06-17-firm-usage-diagnostics-design.md`](docs/specs/2026-06-17-firm-usage-diagnostics-design.md); ADR-0103): a read-only, per-firm usage snapshot assembled entirely from per-firm D1 — no API token required. `@magna-carta/file-manager` gains `readStorageUsage` (storage consumed, summed from the `storage_meter` rollup via the pure `summarizeStorageMeterRows` helper) + counts for non-deleted files, clean-only versions, and folders; `@magna-carta/matters` gains `readMatterCounts` (matters broken down by status); `@magna-carta/locations` gains `readLocationCount` (non-deleted locations). Each domain package owns the read of its own tables — no cross-domain query. The `tools:firmUsage` permission is registered in `@magna-carta/access-control` and the `firm-usage` Diagnostics manifest is added to the `@magna-carta/tools` catalog. **Worker route built:** `GET /api/v1/firm-usage` exposes the snapshot through the slice 0·5 chokepoint — composing storage usage + file/version/folder counts + matter counts (by status) + location count into a `FirmUsageResponse`, gated by `tools:firmUsage` (a `tools`→`firm` conformance binding added; the OpenAPI snapshot + generated client re-emitted) — and `tools:firmUsage` is seeded to the Owner/Admin role so firm administrators can reach it (per-firm migration `0006_seed-tools-firm-usage`). **Deferred:** per-firm compute/activity (Workers CPU time, request volume) requires a Cloudflare Analytics Engine query + an API-token credential — a designed seam, not built; the UI rides the design-system shell. Builds on ADR-0078/0083 (storage metering + load-profile accretion), ADR-0101 (the Tools layer), ADR-0003 (tenancy), ADR-0068 (access control).
- **`@magna-carta/government-links` — recorder property system + the coverage map becomes a verifier**: the property domain now carries **recorder** (deeds/liens search) alongside the assessor, keyed by system + jurisdiction (new `recorderSites` builder; optional `recorder` on `StateRegistration`; `recorderSiteForJurisdiction`; `allRecorderSites` / `allPropertySites`). **GIS (parcel-map) was evaluated and cut**: the platforms are too disparate to link usefully and mostly duplicate the assessor's own map, so curating them is high-churn for low legal value — the `gis` system/builder/accessor stay as a **dormant seam** (no data) for a future land-use need. **Nevada is fully built and owner-verified** — all 17 county-equivalents carry an assessor + recorder, hand-checked through the map (corrected URLs applied; Lincoln's recorder added). Property is now **852 portals**. The coverage map (`mockups/coverage-map.html`) presents four top-level views — **Assessor · Recorder · SOS · Bar License Lookup** — and is a **keyboard-driven verifier built for bulk review**: select a state and the map **zooms to it** and recolors its counties by verification status (verified / needs-fix / unchecked / not-covered), the portal list drops in **below the map**, and the **preview opens on the right** under an **action bar** (Verify / Needs-fix / Fix / Open / Clear, with a status pill) for the active link so judgment and action sit together. The list carries an **All / Unchecked / Verified / Needs-fix filter** with live counts so a partly-reviewed state collapses to just the work left. An **active row** auto-loads in the preview so your eyes stay on one panel; single keys drive the loop — <kbd>↑</kbd>/<kbd>↓</kbd> move the active link, <kbd>←</kbd>/<kbd>→</kbd> jump between states (rolling across state boundaries), <kbd>G</kbd> verifies and <kbd>B</kbd> flags-needs-fix (both **auto-advance to the next unchecked** link), <kbd>U</kbd> skips to the next unchecked, <kbd>F</kbd> opens an inline **corrected-link** editor, <kbd>O</kbd> opens, <kbd>Esc</kbd> backs out. Preview embeds the page in an iframe (parent focus is re-pulled after each load so an autofocusing embed can't kill the shortcut loop); a per-state progress bar shows verified/needs-fix/unchecked at a glance, and every mark/edit is **undoable** (Ctrl+Z / Ctrl+Shift+Z, which jump back to the changed item). Many official portals send `X-Frame-Options` and refuse to embed, so the dev server gained a **framing proxy** (`coverage:serve` `GET /proxy?url=`) that re-serves a page without its framing headers; the map's **Proxy** button loads it fully sandboxed (a stable static snapshot — these pages otherwise postback to their real URL and re-trigger the block), with **Open** as the always-works fallback. Marks and corrected links persist in `localStorage`, and **Export** dumps both (status + `correctedUrl`) as JSON. 80 tests, `vp check` + `lint:process-refs` green.
- **`@magna-carta/government-links` — coverage map, refresh tooling, and coverage milestones**: an interactive marketing/orientation **coverage map** (`packages/government-links/mockups/coverage-map.html`) over the registry — a US map with a property / business / licensing toggle, **deep-link vs search-only** shading, and click-to-open (county → assessor, state → Secretary-of-State / attorney). Property is county-granular and **data-driven** — a region lights up only where a URL is actually wired, so partial states render accurately. A generator (`scripts/build-coverage-data.mts`, `scripts/dump-coverage.mts`) emits the map's data straight from `allAssessorSites` / `allBusinessSites` / `allLicensingSites` so it can't drift; a small dev server (`scripts/serve-coverage-map.mts`; `pnpm --filter @magna-carta/government-links coverage:serve`) backs the map's in-page **Rebuild data** button (`POST /rebuild`), and a root **`tools/open-coverage-map.cmd`** launcher opens it. Coverage milestones this cycle: **property gains Alaska** — 14 organized boroughs with an online search (the 5 offline boroughs + 11 unorganized census areas have no assessor; documented-omitted) → **835 county-equivalents across 20 states + DC + 2 territories**; and the **attorney-licensing domain is finalized to 51 verified jurisdictions** (49 online searches + New Hampshire / South Dakota verification-only, proven in [`docs/research/attorney-license-lookup-coverage.md`](docs/research/attorney-license-lookup-coverage.md)) through manual review. The mockups + dev tooling are throwaway (not product UI; the real surfaces ship through the design system). `vp check` + `lint:process-refs` green.
- **`@magna-carta/tools` — pure catalog package (built)** (spec [`docs/specs/2026-06-16-tools-area-design.md`](docs/specs/2026-06-16-tools-area-design.md); ADR-0101): the Tools area's pure foundation — `ToolManifest` types (`SubjectGroup`, `ContextTag`, `ToolBacking`, `MatterContext`, `SUBJECT_GROUP_ORDER`), the catalog of the existing tools (`property-listing-links`, `county-property-records`, `business-entity-lookup`, `attorney-license-lookup`, the `shipping` integration, and a `network-speed-test` manifest — its widget pending the shell), `toolsByGroup` (sidebar view: grouped by subject in fixed display order, empty groups omitted, permission-gated) and `toolsFor` (contextual view: context-tag filter + permission gate). A catalog-purity fitness function asserts unique ids, well-formed manifests, and non-empty `category` on every `integration`-backed tool. The **`tools:` permission namespace** in `@magna-carta/access-control` (`tools:propertyListings`, `tools:propertyRecords`, `tools:businessLookup`, `tools:attorneyLicense`, `tools:shipping`, `tools:speedTest`) gates each tool on both surfaces. `library`-backed tools are self-contained; `integration`-backed tools reference an integration `category` and reflect its `Dispatch`/health — the Tools layer itself never touches credentials. **UI deferred:** the sidebar/contextual rendering, the id→component map, the integration health branching, and role-seeding land with the design-system shell (slice 0·7a). `pnpm check` green. Concretizes ADR-0015 on the presentation side; builds on ADR-0091/0092 (integration framework) and ADR-0068 (access control).
- **Company email & account-of-record on Google Workspace; operating-cost register** (ADR-0100): chose Google Workspace for `magnacarta.esq` operational mailboxes and the identity that owns third-party accounts (Cloudflare, GitHub, EasyPost, Google Cloud) — one paid seat plus free role aliases (`ops@`/`billing@`/`legal@`/…) — over Microsoft 365 and over Cloudflare Routing + Gmail Send-As. Two binding invariants: an independent **off-domain** break-glass recovery mailbox for the Cloudflare account and the `.esq` registrar (a same-domain recovery is a lockout loop), and **role-not-personal** addresses for infra logins; DNS is coordinated with the product's Cloudflare Email Sending (§2) so neither clobbers the other's MX/SPF/DMARC. Runbook: [`docs/conventions/operations.md`](docs/conventions/operations.md) §7. The company mailbox choice is decoupled from the product's email features. New living register [`docs/operating-costs.md`](docs/operating-costs.md) consolidates all recurring/associated costs — subscriptions, usage-metered platform spend, per-transaction and one-time legal — plus the deliberate cost-avoidance choices (no third-party error/auth/conversion SaaS).
- **Slice 1·3 backend built — Directory** (spec [`docs/specs/2026-06-12-slice-1-3-directory-design.md`](docs/specs/2026-06-12-slice-1-3-directory-design.md); backend plan [`docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md`](docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md); ADR-0085–0087; ADR-0080 amended): the 17-task backend, backend + API only. **`@magna-carta/directory`** — the domain package on the slice-0·2 atomic-batch pattern: `directory_person` and `directory_organization` (equal-depth node tables, distinct standard fields, type-prefixed `dpe_`/`dor_` handles, `status`/`merged_into_id` for merge, `needs_review` for provisional migration entities); `directory_name` history with append-and-flip (name change inserts the new row + flips `is_current` on the prior, never edits in place — history and the conflicts corpus are preserved by construction); scheme-keyed `directory_name_phonetic_code` rows (Double Metaphone primary/secondary via pinned `words/double-metaphone`; scheme CHECK is open `length>0` so Beider-Morse is additive-by-sweep at Phase 4); FTS5 trigram virtual table over `normalized_display` with insert/update/delete sync triggers; `directory_identifier` protected rows (all sensitive identifiers — SSN, EIN, driver's licence, financial/account, DOB, SSN-last-four — live here as `protected()` ciphertext, **uniform model**: the dead plaintext `dob`/`ein` node columns from the plan were dropped, matching the design; blind-index policy: SSN/EIN/driver's licence/account standalone-indexed, DOB/SSN-last-four never standalone-indexed); **EIN standalone-indexed policy row added to the 1·2 blind-index policy table**; `directory:viewSensitiveIdentifiers` is the decrypt permission (permission check → audit row → AAD decrypt, inseparable, 1·2 contract); typed `directory_edge` table (handle prefix discriminates endpoints, no kind column; edge types cover the conflicts seam-4 set — affiliation, spouse/family, corporate parent/subsidiary/successor, representation, role-assignment); per-firm `directory_category` definitions + `directory_entity_category` links (categories are classification labels, not schema variants); duplicate-candidate generation (`findDuplicateCandidates` — phonetic-block union trigram union blind-index channels, deduplicated by entity, signal-count ranked, `excludeEntityId` seam); non-destructive `mergeEntities` (subordinate archived to `status='merged_into'`, references repointed in one atomic batch — `matter_party`, edges, categories, contact/identifier rows — an append-only `entity_merge` event recording the exact repoint list + survivorship choices as the future guarded-unmerge seam); `matter_party` created (role-on-link, one entity may hold several roles in one matter); idempotent 1·1 client-display-field migration (distinct `client_display_name`/`client_code` combinations create provisional Directory entities, ambiguous/blank names flagged `needs_review`, never auto-merged on a bare string). **Idempotency** threaded through all directory write paths (matters pattern — same-key route retry creates one entity and replays; merge replay proven not to double-repoint). **`/v1/directory` worker routes** — 14 operations through the 0·5 chokepoint: create/read/update person and organization, add/change name, search, upsert/read identifier, create/read edge, manage categories, find duplicate candidates, merge entities, link/read matter parties. **Migration `0009_directory`** (per-firm). **Load-profile extended (`ledgerVolume-v5`):** Directory entities/names/edges/identifiers/party links seeded through the real domain write paths; 4 measured ops — blind-index identifier lookup, protected-field list read (`directory:viewSensitiveIdentifiers`), candidate-generation query, graph-expansion traversal; no hot-path full scans; baseline committed. **Permissions** `directory:edit` + `directory:viewSensitiveIdentifiers` registered and seeded. **Fitness + e2e:** `assertDirectoryFitness` (every `directory_name` row has Double Metaphone codes; no float columns; handle-TEXT primary keys; no `directory_edge` references a hard-deleted entity; merge relink completeness — no inbound reference pointing at a `merged_into` subordinate); repo-wide no-plaintext-escape scan extended to Directory fields; schema-name-sync; worker end-to-end suite (create entities → add names/edges/identifiers → entry-time duplicate prevention → merge → confirm repoint + alias still matches + `entity_merge` event complete + audited sensitive-identifier read). **Built by Opus 4.8; all package suites + the worker suite + `pnpm check` + `lint:process-refs` green. Fable 5 re-review pending per the model-split policy.** UI plan + owner manual-verification checklist follow once 0·7a/0·7b land.
- **Integration platform foundation — manifest-driven plugin decoupling** (spec [`docs/specs/2026-06-17-integration-platform-foundation-design.md`](docs/specs/2026-06-17-integration-platform-foundation-design.md); ADR-0096/0097): structural refactor inverting the core-knows-each-plugin model. Each integration package now exports one declarative `IntegrationManifest` (id, category, displayName, summary, credential, capability, permission gate, `registerRoutes` callback, and Spec-2 marketplace fields declared whole so the contract is not reshaped later). The core holds a central manifest registry (`listManifests()` / `manifestFor(category)`) — the single place the core learns a plugin exists; adding or removing a plugin touches only that plugin's package plus one registry line. `app.ts` stops naming individual plugins; all plugin routes mount through the unchanged ADR-0067 chokepoint via a single loop over `listManifests()`. `PluginRuntime` is the new uniform dependency seam (firm-scoped capabilities handed to every plugin), replacing the bespoke per-plugin `CreateAppOptions` fields — and it is the exact seam the C-transition (ADR-0097) later replaces with RPC. **Shipping** was migrated as the proof: the existing e2e, conformance, and OpenAPI snapshot tests stay green; routes are byte-identical; only mounting became data-driven. **Parcels and property-links** gained catalog-only manifests, putting both credentialed and credential-less integration types in the registry from day one. **Well-formedness + decoupling fitness guard:** unique `id`/`category` per manifest; every non-null `permission` is in the access-control registry; `app.ts` imports no individual plugin route module by name — regression is a CI failure, not a runtime surprise. **Intrinsic shared-resource concerns** (per-firm migration lineage, permission registrations, identifier prefixes) remain core-side. Load profile `[-]` — structural refactor, no per-firm data surface (the marketplace's per-firm enablement rows arrive in Spec 2). **ADR-0097** records the C-transition seam (in-process → service-binding C1 → Workers-for-Platforms C2) as a named-not-built progression with its hard problems documented: per-firm D1 across Workers, firm-key custody, distributed migration ownership, chokepoint-across-boundary, aggregated OpenAPI; trigger = first untrusted/third-party plugin. All package suites + the worker suite + `pnpm check` + `lint:process-refs` green.
- **Shipping & postage vertical-slice backend — shipment lifecycle, worker routes, R2 label storage (Plan 2 built)** (spec [`docs/specs/2026-06-16-shipping-easypost-design.md`](docs/specs/2026-06-16-shipping-easypost-design.md); plan [`docs/specs/2026-06-16-shipping-easypost-plan-2-vertical-slice.md`](docs/specs/2026-06-16-shipping-easypost-plan-2-vertical-slice.md)): the firm-facing shipping backend on top of Plan 1's port + adapter. **Identifiers:** `shipment`/`shipmentLabel`/`trackingEvent` handles. **Schema (migration `0007`):** the per-firm `shipment` (addresses/parcel/options as JSON text, optional `matter_ref`, `postage_cost_minor`/`service_fee_minor` cost-recovery columns), `shipment_label` (PDF bytes in per-firm R2 at `r2_key`, never D1), and `tracking_event` (deduped by a `(shipment_ref, remote_id)` unique index) tables; the `shipping:manage` permission seeded to Owner/Admin. **Service + statements (`@magna-carta/data-access`):** `createShipmentDraft`/`recordPurchase`/`recordRefund` returning an `EffectWrite` (statements + audit + outbox), with the `shipment.purchased` outbox message as the Phase-3 cost-recovery seam the financial core will consume to post a matter disbursement. **Idempotent purchase:** `buyLabel` forwards the chokepoint key as the EasyPost `Idempotency-Key`, so a retried purchase never double-charges (a thrown effect stores no idempotency record and re-runs; the carrier key dedups the buy). **Worker routes, all through the slice 0·5 chokepoint:** `POST /v1/integrations/shipping/connection` (stores the API key as a firm secret + records the connection), `POST /v1/shipments` (draft), `POST /v1/shipments/{id}/rates` (live rate-shop, ephemeral), `POST /v1/shipments/{id}/purchase` (buy the chosen rate, copy the label PDF from EasyPost's transient URL into per-firm R2, record postage + fee), `GET /v1/shipments/{id}/label` (stream the PDF from R2), `POST /v1/shipments/{id}/tracking` (pull live, cache events `INSERT OR IGNORE`), `POST /v1/shipments/{id}/refund`. The integration registry is built per request from the firm's D1 (`ConnectionStore`) and an injectable `firm_secret` `CredentialStore` seam — **production wires the seam to throw until slice 1·2 lands** (a one-line swap turns it on), with a fetch-backed EasyPost client; tests inject an in-memory secret store + a fake EasyPost. A non-ok `Dispatch` maps onto the worker problem taxonomy (`not-connected` → 409, `capability-unsupported` → 422, adapter-error by category → 422/429/502). **Tracking is pull-based** (on-demand pull + cache; push-webhook ingress is a captured follow-up, not built). **Tests:** a shipment-service unit suite and a Miniflare end-to-end across connect → create → rate → purchase → label → tracking. **Load profile:** the `ledgerVolume` profile (now v3) lays down 300 shipments across the firm's matters with tracking events, and two volume-shaped reads (per-matter shipment list, per-shipment tracking history) joined the measured set, both index-backed. Also wired the `0006`/`0007` per-firm migrations into the worker runtime bundler (`0006` had been added without being bundled). **Deferred:** EasyPost push-webhook ingress; the Phase-3 cost-recovery posting (the cost columns + `shipment.purchased` payload ship as the seam); the live `firm_secret` backing (slice 1·2); the UI (after 0·7a). All package suites + the worker suite + `pnpm check` + `lint:process-refs` green.
- **Shipping & postage backend spine — `@magna-carta/shipping` + EasyPost adapter + api-key credential kind + `integration_connection` repository (Plan 1 built)** (spec [`docs/specs/2026-06-16-shipping-easypost-design.md`](docs/specs/2026-06-16-shipping-easypost-design.md); plan [`docs/specs/2026-06-16-shipping-easypost-implementation-plan.md`](docs/specs/2026-06-16-shipping-easypost-implementation-plan.md); Plan 2: [`docs/specs/2026-06-16-shipping-easypost-plan-2-vertical-slice.md`](docs/specs/2026-06-16-shipping-easypost-plan-2-vertical-slice.md); ADR-0094/0095): the backend port + adapter spine for legal-grade postage and package shipping. **`@magna-carta/shipping`** (new package): the canonical model — `CanonicalAddress`, `Parcel` (dimensions + weight), `Rate` (`amountMinor` money encoding, `currency`, `carrier`, `service`, `remoteId`), `RatedShipment` (the EasyPost shipment id carried as `remoteId`, consumed by `buyLabel`), `Label` (label URL + tracking number), `TrackingEvent` (status + events), `RefundResult`; request-input types `AddressInput`, `ParcelInput`, `ShipmentOptions`, `RateRequest`, `BuyLabelRequest` — all zod-validated at the boundary (`packages/shipping/src/canonical.ts`; ADR-0091 canonical-record + zod-boundary contract). **`ShippingPort`**: five operations — `validateAddress`, `rateShipment`, `buyLabel`, `getTracking`, `refundLabel` — with a capability descriptor gating certified-mail usage (USPS Certified Mail with return receipt and signature; `ShipmentOptions` models certified mail + return receipt + signature + insurance). **EasyPost adapter** (`createEasyPostAdapter({ http })`): full mapping in `packages/shipping/src/easypost/map.ts` (`mapRatedShipment`, `mapLabel`, `mapAddress`, `mapTrackingEvents`, `mapRefund`, `mapShipmentOptions`, `dollarsToMinor`); EasyPost HTTP errors mapped into the framework's `IntegrationProblem` taxonomy (`auth`/`rate_limit`/`validation`/`upstream`/`network`) via `classifyError(status, title)` — errors surface as the dispatch `adapter-error` outcome; the EasyPost Forge child-user model centralizes postage billing to our account so every firm's postage charges our EasyPost account (no per-firm EasyPost billing setup — the rationale for choosing EasyPost over Pirate Ship). All suites (canonical zod boundary, adapter mapping, error handling, registry-resolution end-to-end, fitness) + `pnpm check` + `lint:process-refs` green. **API-key credential kind (ADR-0095)**: the `api-key` `CredentialKind` (`{ kind: "api-key"; key: string }`, typed `ApiKeyCredential`) added to `@magna-carta/integrations` (`src/credentials.ts`), amending ADR-0091/0092 which had assumed the first credentialed adapter would use OAuth — EasyPost uses a static per-account key, no rotation machinery or DO refresh lock. **`integration_connection` per-firm table** (migration `0006`, `@magna-carta/data-access`): stores authorized adapter connections (`integrationConnection_…` handles from `@magna-carta/identifiers`, `{firmId, userId?, adapterId, status}`, health state `connected | degraded | needs_reauth | disabled`, capability snapshot) with firm-scoped isolation. **`ConnectionStore`** (firm-scoped, `@magna-carta/data-access`): `getConnection` over the `integration_connection` table (insert/select/update-status/delete statement builders). **`CredentialStore` seam** (`@magna-carta/data-access`): the `firm_secret`-backed `CredentialStore` seam — `createFirmSecretCredentialStore` over a `SecretStore` interface, tested with an in-memory fake; the live `firm_secret` backing is wired in Plan 2, gated on slice 1·2. **Provider rationale (ADR-0094):** EasyPost selected over Pirate Ship — Pirate Ship has neither a public API (web-only UI) nor certified mail support; EasyPost has both, plus a multi-carrier network and the Forge child-user billing model. **Plan 2 (gated on slice 1·2):** the `shipment`/`shipment_label`/`tracking_event` tables + shipping service, all worker routes (connection-management, `POST /v1/shipments`, rates, purchase, label, tracking, refund), EasyPost HMAC-verified webhook ingress, R2 label storage, and the live `firm_secret`-backed `CredentialStore` wired in.
- **Property external-links resolver — `@magna-carta/property-links` (built)** (spec [`docs/specs/2026-06-16-property-links-design.md`](docs/specs/2026-06-16-property-links-design.md); plan [`docs/specs/2026-06-16-property-links-implementation-plan.md`](docs/specs/2026-06-16-property-links-implementation-plan.md); ADR-0093): a pure, dependency-free utility turning a `PropertyReference` (address; `apn`/`jurisdictionId` reserved) into the external "view this property on X" links available for it — one-click property lookups. A `LinkProvider` registry + a total `resolvePropertyLinks(reference) → PropertyLink[]` (maps the providers, drops the `null`s, never throws); **Zillow** (`/homes/{slug}_rb/`), **Redfin** (`/?location=…`), **Google Maps** (`maps/search?api=1`), and **Realtor.com** (`realestateandhomes-search`) ship as the first providers, delivered as plain `https` hyperlinks that open the native app via Universal/App Links when installed and the website otherwise (no custom `zillow://` schemes). The **external-links half** of property lookups, distinct from the credentialed property-_data_ ports (valuation/ownership — Zillow/Redfin have no API, so that data comes from ATTOM/Regrid/HouseCanary; [`docs/research/property-data-integrations.md`](docs/research/property-data-integrations.md)). Mirrors `@magna-carta/parcels`; 22 tests, `pnpm check` green. **Buttons ride the Locations UI** (out of scope here); a Trulia provider, a county-assessor provider wrapping `parcels`, per-firm provider config, and an optional credential-less framework adapter are documented seams.
- **`@magna-carta/government-links` — new `licensing` domain: attorney-license lookup for all 50 states + DC**: a third category on the engine (after property and business), proving it generalizes past records-about-things to records-about-people. Each state's official **attorney-license search** — verify a lawyer's status/standing by name or bar number — in one `licensing/attorney-license.ts` data table (51 rows, keyed by 2-digit state FIPS), drawn from the authoritative body per state: a mandatory bar's member directory, or in non-unified-bar states the judiciary / disciplinary board (New York OCA, Ohio Supreme Court, Illinois ARDC, Kansas KARD, Arkansas AOC, Nebraska Judicial, Tennessee BPR). New `./licensing` export and `attorneyLicenseSiteForState(fips)` accessor; a coverage guard asserts all 51 present, FIPS-sorted, state-keyed. **The consumer seam:** an attorney profile that stores multiple-state bar admissions renders a verify link next to each via `attorneyLicenseSiteForState`. URLs verified live; the blocked/migrated ones (AL, DE, ID, FL, OR re-pointed to the authoritative search) re-verified by hand. 75 tests, `vp check` + `lint:process-refs` green.
- **`@magna-carta/government-links` — business (Secretary of State) domain now covers all 50 states + DC**: the SoS domain scales from the Nevada proof to **every US state plus the District of Columbia** — 51 rows in one `business/secretary-of-state.ts` data table (one per state, keyed by 2-digit state FIPS), each a business-entity search and, where the state publishes a public one, a UCC search (both search-only). `businessEntitySiteForState(fips)` / `uccSiteForState(fips)` resolve any state; a coverage guard asserts all 51 present, FIPS-sorted, state-keyed. Demonstrates the engine scaling a second category to national coverage with no model changes. A handful run under a non-SoS agency (Arizona Corporation Commission, Maryland SDAT, Virginia SCC, DC DLCP, Michigan/LARA), so labels stay the neutral "{State} Business Entity Search". URLs verified live — the four that block automated fetches (TN, UT, VT, WA) and the migrated ones (Michigan → MiBusiness, Ohio → businesssearch, Virginia → CIS) re-verified by hand. 69 tests, `vp check` + `lint:process-refs` green.
- **`@magna-carta/parcels` renamed to `@magna-carta/government-links` — domains as subpaths**: the package that began as the county-assessor engine is now the general government-portal deep-link engine, so it takes its true name. Structure: the shared engine (`types`, `keys`, `platforms`, `resolve`, and the cross-domain `registry`) at the package root; **`property/`** (the assessor states + `stateSites` builder + property registry, `./property` export) and **`business/`** (Secretary-of-State data + `businessSites` builder + business registry, `./business` export) as the two domain subdirs. Each domain owns its data table and accessors; the root `registry` composes them into `siteForSystem` and re-exports the whole surface (so a consumer still has one import for everything). `apn.ts` → `keys.ts` (the key normalizer is category-agnostic). Clean rename, no legacy alias — importers move to `@magna-carta/government-links` directly. 66 tests, full suite green, `vp check` + `lint:process-refs` clean.
- **`@magna-carta/parcels` — engine generalized to multi-category government portals; Nevada Secretary of State as the proof** (research [`docs/research/parcels-property-records-architecture.md`](docs/research/parcels-property-records-architecture.md)): the core is now a general government-portal deep-link engine, not assessor-only. Every `PortalSite` carries a `category` (`property | business`) and a `system` (`assessor · recorder · gis · businessEntity · ucc`), and the registry keys on **`system` + `jurisdictionId`** so one jurisdiction can hold several portals without collision; `category` also fixes key granularity (property by 5-digit county FIPS / 10-digit MCD GEOID, business by 2-digit state FIPS). A generic `portalUrl(site, {key, year})` resolves any portal; `assessorUrl(site, {apn})` is now a thin property-domain wrapper. The new **business domain** (`src/business/`, `./business` export) ships **Nevada** (state FIPS 32): the SilverFlume business-entity search and the ORION UCC index, both search-only — proving the engine across a second category _and_ a different jurisdiction granularity. The ~820 property rows are untouched (the `stateSites` builder supplies the new fields). New accessors `siteForSystem` / `businessEntitySiteForState` / `uccSiteForState`. The step toward `@magna-carta/government-links` (property + business as subpath domains; `parcels` a deprecated property alias). 66 parcels tests (full suite 1001), `vp check` + `lint:process-refs` green.
- **County assessor deep-link engine — `@magna-carta/parcels` (built, landed on main)** (research [`docs/research/parcels-key-model-and-resolver.md`](docs/research/parcels-key-model-and-resolver.md), [`docs/research/parcels-property-records-architecture.md`](docs/research/parcels-property-records-architecture.md)): a pure, credential-less, zero-runtime-dependency resolver that turns a US county (5-digit FIPS, or 10-digit county-subdivision GEOID for the New-England town-assessed states) plus a parcel/APN into the best link to that jurisdiction's official assessor property search — `assessorSiteForJurisdiction(id)` + `assessorUrl(site, lookup)`, returning a deep-link to the parcel where the portal exposes a public key in its URL and the plain search page otherwise (it never throws; uncovered jurisdictions fall back to a web search at the consumer). A **jurisdiction-keyed registry + platform/template adapters + a key-normalizing URL builder**: the `STATES` table (one row per state — postal code, FIPS prefix, expected count as a drop/dup guard, sites) feeds the national lookup and every coverage/integrity test, so onboarding a state is one row plus a `states/<x>.ts` module built through the `stateSites` factory; platform adapters cover the live vendor systems (Catalis DevNet Wedge, GSA/GovStack, Schneider Beacon/qPublic, TerraScan TaxSifter, Megabyte MBAP) with APN normalization (strip/keep separators, Hawaii TMK). Portals that deep-link only by an internal account id (Harris PropertyAccess, Aumentum, Tyler Eagle) are kept search-only by design — no scraping. **Coverage at landing: 21 jurisdiction-sets / 821 county-equivalents** (AZ, CA, CO, DE, DC, HI, ID, KS, MT, NE, NV, NM, ND, OK, OR, SD, UT, WA, WY, GU, VI), growing additively. The resolver design records the considered-and-declined public-id→portal-key resolver; the architecture note sets the **direction to generalize this core into a shared government-portal deep-link engine** (`@magna-carta/government-links`, domains for property — assessor·recorder·gis — and business — Secretary-of-State·UCC), with `@magna-carta/property-links` wrapping the property domain so the assessor link joins its aggregated list. **Internal enrichment, not resale.** Mirrors `property-links`; full suite + `pnpm check` + `lint:process-refs` green.
- **Slice 1·2 backend built — the `protected()` crypto module** (spec [`docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md`](docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md); plan [`docs/specs/2026-06-12-slice-1-2-implementation-plan.md`](docs/specs/2026-06-12-slice-1-2-implementation-plan.md); ADR-0084; ADR-0026 amended): the implementation-grade encryption layer below ADR-0026, backend only, zero new runtime dependencies (native Web Crypto). **The pure `@magna-carta/encryption` package** — six modules, all golden-vector-pinned as frozen contracts: the versioned ciphertext **envelope** (`[algo_version | key_version | iv | AES-256-GCM ct+tag]`, base64 TEXT), the non-extractable **key hierarchy** (root KEK AES-KW-wraps per-firm 32-byte keys → `unwrapFirmKeyToHkdfKey` imports straight into a non-extractable HKDF base key → HKDF-SHA-384 derives per-purpose AES-256-GCM keys and per-field HMAC index subkeys, `extractable: false` end to end, `deriveKey` never `deriveBits`), **AAD context binding** (`mc:aad:v1|firm|table|field|row_pk|versions` — a ciphertext moved between rows/fields/firms fails the GCM tag), the **blind index** (version-prefixed truncated HMAC-SHA-384), and the frozen **normalization** transforms (digit-strip, uppercase-strip, state-prefix) — committed AAD/blind-index/normalize golden vectors are the change-is-a-new-version pins, plus an AAD-mismatch matrix and a 1,000-IV-uniqueness fitness test. **The data-access chokepoint** (`@magna-carta/data-access`): `composeProtectedWrite` (seal + emit the sibling blind-index value) / `readProtected` (permission check → `protected.decrypt` audit row committed **before** any plaintext → AAD decrypt, inseparable and fail-closed) / `blindIndexValue` (no permission, no audit — matching reveals nothing), the `protectedField` declaration registry pinned to the schema + access-control registry by a conformance test, the shred-aware fail-closed **firm-key provider** (per-isolate non-extractable-handle cache with `invalidate()`), and the `firm_secret` store (`getSecret`/`putSecret` under `firm:manageSecrets`, AAD-bound to each secret's row id). **The worker wiring:** the idempotent provisioning **key-mint** step + two idempotent **backfill sweeps** (key-mint for pre-existing firms; incident-description encryption — SQL migrations cannot encrypt, so expand-contract with a code sweep), the audited **crypto-shred** (`shredFirmKey` — null `wrapped_firm_key` + a `firm.key_shredded` audit row + cache `invalidate()`, function-only with the offboarding route a named seam), and the **TOTP `encryptionKeys` closure** (the 2FA-secret encryption stays under Better Auth's auth-secret-derived rotation array — user login credentials must survive a firm crypto-shred). **Migrations:** `0002_firm-key-columns` (control-plane `wrapped_firm_key` + `firm_key_version`), `0006_protected-secrets-and-incident-ciphertext` (per-firm `firm_secret` + the incident description ciphertext/audit columns), `0007_incident-description-nullable`. **Permissions** `firm:manageSecrets` and `incidents:viewDescription`. New Worker secret **`ROOT_KEK`** (32 random bytes base64). **Fitness:** the Workers-runtime **parity** suite re-runs the golden vectors under Miniflare, and the repo-wide **no-plaintext-escape** source scan proves no protected value leaves storage outside the chokepoint. Per-package `CLAUDE.md` for `@magna-carta/encryption`; a Protected-fields/encryption section added to [`docs/conventions/invariants.md`](docs/conventions/invariants.md); `ROOT_KEK` + the rotation array + the crypto-shred note added to [`docs/conventions/security.md`](docs/conventions/security.md). **Built by Opus 4.8; all package suites + the worker suite + `pnpm check` + `lint:process-refs` green. 7-angle adversarial review complete (2026-06-16): 16 raw → 6 confirmed findings, all low-severity (0 critical/high/medium — no crypto-correctness, access-control, audit, or tenancy issue survived refute-by-default verification), all fixed** — `shredFirmKey` made idempotent (pre-read guard against a duplicate `firm.key_shredded` audit row on re-shred/never-minted), the triplicated raw-bytes base64 codec consolidated into one `encryption/src/base64.ts` (typed `Base64DecodeError`; encoding byte-identical, golden vectors pass), the incident-encrypt backfill switched to reuse `firmKeyProviderForEnv`, and `blindIndexValue`'s redundant guard dropped. **Load-profile extended (`ledgerVolume-v3`):** the volume harness seeds protected volume through the real chokepoint (500 sealed incident descriptions + 12 firm secrets) and measures three protected ops — a decrypt page, a keyed secret read, and the blind-index derivation — with by-name/by-id plan probes asserting indexed reads; the firm key is seed-derived so cached ciphertexts decrypt on replay; first signal is that the per-decrypt audit write dominates a page reveal (flagged for the future diagnostics view). **Fable 5 re-review pending per the model-split policy.** First consumers (incident descriptions, the secrets store) ship the module exercised ahead of Directory (slice 1·3 declares its identifier fields against the policy table).
- **Public-records landscape + Nevada parcel/APN enrichment approach — research** (research [`docs/research/public-records-landscape.md`](docs/research/public-records-landscape.md), [`docs/research/nevada-parcel-apn-system.md`](docs/research/nevada-parcel-apn-system.md)): two forward-looking research notes. The landscape note maps US public records into five categories (court, property, business, vital, identity), the systems and aggregators that cover each, the DPPA/GLBA/FCRA permissible-purpose gates, and a general **platform coverage-map** concept (a future marketing-site feature). The Nevada note is an actionable approach for enriching location data — especially houses — from county assessor sources: an **address→assessor deep-link** as the zero-ingestion MVP, an enrichment ladder up to in-app parcel/APN lookup (Washoe/Clark ArcGIS REST), a **MapLibre + PMTiles-on-R2** map layer (not Google, whose ToS would block it), and the NRS 239 / NRS 250.087 licensing posture. **Internal enrichment, not resale; nothing built.**
- **Integration catalog expanded — candidate future ports + a build-vs-integrate heuristic** (white paper _Plugin / Add-on system_; research [`docs/research/property-data-integrations.md`](docs/research/property-data-integrations.md)): catalogued a set of future integration categories beyond the launch ports, each tagged by disposition. **Built-in** (a native feature, external data via adapter only where a provider requires it): public records · people search · skip tracing (high priority); document comparison · proofreading · metadata scrubbing; transcription · dictation (tied to the telephony port). **Plugin**: process serving (high priority); identity / AML · KYC · sanctions & PEP screening; AI drafting / legal-AI assistant; a Zapier/Make automation bridge; property data (parcel/APN lookup + point-in-time AVM valuation); plus practice-area-gated (RON, court reporting, medical-records retrieval, translation, expert-witness directories) and operational connectors (Xero/Sage, BI export, HR/payroll, tax 1099, e-fax, marketing). Added the **build-in-or-plugin heuristic** that governs the split — default to built-in when easy enough or high-value, reach for a plugin when the capability is genuinely external (licensed vendor data or service). Vendor names are illustrative, not selections; nothing is built. The new research note holds the property-data provider landscape and its legal use cases (date-of-death, date-of-separation valuation).
- **Slice 1·1 backend built — Matters core, Locations & File Manager (Phase 1 opens)** (spec [`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md); backend plan [`docs/specs/2026-06-11-slice-1-1-backend-implementation-plan.md`](docs/specs/2026-06-11-slice-1-1-backend-implementation-plan.md); ADR-0079–0082): the 18-task backend, backend + API only. **Three domain packages on the ledger pattern** (validate in memory, compose into the slice-0·2 atomic batch): **`@magna-carta/locations`** — addresses, letterhead/remit-to text, number code, staff assignment (exactly-one-primary), soft close (firm-default close refused); **`@magna-carta/matters`** — the prospective→open→closed lifecycle (number drawn at open, frozen at assignment; closed = archived-but-additive behind the empty close-precondition hook), the pure segment-template numbering renderer + the atomic guarded-counter idiom over `{firm, scope_key}` with the UNIQUE-`matter_number` backstop proven concurrent on real SQLite, matter/document types, and the consultations view + stale flag; **`@magna-carta/file-manager`** — the D1 folder tree over opaque server-minted R2 keys, `file`/`file_version` with the pending→clean/quarantined status gate enforced by a read-mediation source scan, the single-read ingest pipeline (`file-type` magic-byte sniff + `crypto.DigestStream` streaming SHA-256 + the engine-less `unscanned` scan port → commit/quarantine), the no-op hash-skip, exact D1 storage metering + R2-LIST reconciliation (`normalizeR2StorageClass` maps R2's `""`/PascalCase tier to the lowercase token), and the pure ZIP selection resolver. **Storage seams:** the minimal per-firm `setting` (typed accessor, zod defaults in code) and append-only `audit_log` tables the unbuilt ADR-0040 framework and future audit subsystem will formalize, written in the same batch as each mutation. **Worker surface, all through the slice 0·5 chokepoint:** the direct-to-R2 presign/upload-session lifecycle (`aws4fetch`; bytes bypass the Worker; PUT + resumable multipart), the `files-ingest` queue consumer over the pure ingest core, the matters/matter-types/document-types/locations/numbering routes (incl. the read-shaped `numbering-scheme/preview`, allow-listed in the audited-mutating conformance gate), the file/folder routes, the signed single-file download (302 to a presigned GET + audit) and the streaming ZIP64 bulk download (`client-zip`, version-pinned at request time), and the stale-pending-upload + daily storage-reconciliation crons (failures on the 0·6 telemetry pipeline). **`presignGet`** added to the R2 presigner. **The end-to-end suite** drives the whole journey over the real HTTP surface: provision firm → Location + matter type + scheme → consultation (no number, in the consultations view, absent from the default list) → open draws `RENO-26-0001` → upload (initiate → synthetic R2 event → ingest commit → clean) → re-upload identical bytes (no-op skip) → declared-type-lie quarantine → blocked-extension refusal → bulk download → close → add-a-document-to-the-closed-matter → second-firm DB-level tenant isolation; plus a worker-side `file_version` status-predicate source scan. Per-package `CLAUDE.md` for the three packages; File-Manager + numbering invariants added to [`docs/conventions/invariants.md`](docs/conventions/invariants.md). **Built by Opus 4.8 on a branch started before 0·5b/0·6 landed, then merged up to `main`** (see _Changed_); all package suites + the worker suite + `pnpm check` + `lint:process-refs` green. **7-angle adversarial review complete (2026-06-15, Opus): 24 confirmed findings (0 critical, 2 high, 10 medium, 12 low), all fixed in three waves** — exactly-once ingest commit (per-version idempotency record), clean-version-scoped metering reconciliation (fixing both meter inflation and cross-firm contamination), the correctness mediums (reopen-status from `opened_at`, same-matter folder/file moves, monotonic current-version bump, number-draw 422-not-500, bounded stale-pending sweep), and the golden-rule-1 consolidations (shared classification-type service + route factories, `requireChokepointIdempotency`, `domainAuditStatement`, a shared cursor-pagination util, `requireBucket`). **Pending:** the load-profile extension (matters/locations/files volume + the R2 blob layer) and the UI plan (after 0·7a/0·7b). **Fable 5 re-review pending per the model-split policy.**
- **Distribution & IP-protection posture recorded — ADR-0090** (ADR-0090; standard [`docs/conventions/security.md`](docs/conventions/security.md) _Distribution & IP-protection posture_): how the program's internals are protected once distributed (web MVP, then Tauri desktop). A **posture-only** decision — nothing built; every mechanism is a named future seam. The strategy: **treat everything shipped to a client as readable by an adversary; the moat is the server and the legal perimeter, not the bytes.** Spans all four named threats (competitor cloning, code/IP theft from the shipped artifacts, license circumvention, tenant-data exfiltration). **Binds now:** no production source maps; "does this value belong server-side?" is a design check on new client-shipped logic; internal process docs (white paper / specs / ADRs / research) are trade secrets. Client hardening is **minification only** — obfuscation rejected as a primary defense (cost > value). The **open/closed line** is explicit (reconciling ADR-0088 §J): generic engine primitives are deliberately open-sourced; the proprietary product layer, firm data, and brand are protected. Entitlement enforcement, when built, is **server-side only** (the Tauri client never enforces its own license — no offline crack surface). Tenant-data exfiltration is already governed by the existing tenancy posture (ADR-0003/0052). **Cost noted as immaterial:** value placement is mostly descriptive of existing DB-bound server logic (Workers bill CPU time, not I/O wait); "protected" never means moving heavy client-feasible compute onto an inline Worker (golden rule 10 → Container/Queue); the real costs are legal/one-time (trademark, copyright, EULA/ToS). Builds on ADR-0003, 0023, 0052, 0088.
- **Slice 0·6 built — telemetry baseline & platform closeout (Phase 0's backend complete)** (spec [`docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md`](docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md); plan [`docs/specs/2026-06-09-slice-0-6-implementation-plan.md`](docs/specs/2026-06-09-slice-0-6-implementation-plan.md); ADR-0074 amended with build findings): the golden-rule-4 logging path, realized. **`@magna-carta/telemetry`** (new package): **allowlist event builders** where redaction is structural — `defineEvent` rejects an undeclared field at the type level and strips it at runtime, so a content field has no slot to be logged in (negative-compile proofs pin both halves); a **scrubbing-backstop tripwire** (email/SSN/digit-run denylist → `[scrubbed]` + a `telemetry.scrubbed` trip, `err_`/`cor_` handle-safe); `cor_` correlation + `err_` Error IDs over `@magna-carta/identifiers`; a pure **`Logger` seam** with a memory adapter and the Workers adapter that is the **one legal `console.*` site** (scrubs every event, emits structured JSON to Workers Logs, mirrors counters to Analytics Engine fire-and-forget). **Worker wiring:** the **telemetry middleware** installed ahead of the 0·5 chokepoint mints the correlation id + a request-scoped logger into context and logs `request.completed` (route TEMPLATE, never the concrete path); the **`app.onError` boundary** turns any escaped exception into the RFC 9457 500 carrying its Error ID + `error.captured` (Hono routes thrown handlers there, so an outer try/catch cannot be the boundary); `problemJson` now mints `errorId` via telemetry and stamps the correlation id on every problem reply (Problem schema gains `correlationId`; snapshot re-emitted). **Incident intake:** the per-firm **`incident` table** (migration 0003) + **`POST /v1/incidents`** through the chokepoint (`firm:reportIncident` seeded onto every default role; `incident-report` rate bucket 5/300s; one atomic per-firm batch writing the row + an `incident.created` outbox→Queue message with no consumer yet — the diagnostics agent's future feed). **Fitness made structural:** a **console-ban** source scan (only the Workers logger + the load-profile CLI allowlisted) and an **errorId-coverage** extension of the 0·5 conformance suite (every 4xx/5xx response declares `errorId`) — and to make the ban honest, every 0·4-era interim `console.*` (the platform-admin denial-cause seam → `auth.denied`; the scheduled/sweep/dead-letter/auth-audit seams → `operation.failed` / `outbox.deadLettered` / a `reconciliation.unprovisioned` counter) was migrated onto the pipeline. **Transactional email:** the **Cloudflare Email Service** adapter behind the slice 0·4 `sendEmail` port (verified against the public-beta `env.SEND_EMAIL.send({...})` Workers API), selected env-driven — Cloudflare when the binding AND `EMAIL_FROM` are set, else the logging adapter; `EMAIL_FROM` is the activation switch the deploy runbook flips once the domain is onboarded, so no send fails against an un-onboarded domain; every send logs `email.sent` (class + outcome, never body) and a failure rethrows. **CI:** **Renovate** (`renovate.json` — pin strategy, weekly, grouped, the drizzle<1.0 rule machine-enforced, propose-only) + a **`pnpm audit --audit-level high`** gate with a documented `pnpm.auditConfig.ignoreGhsas` allowlist for two pre-existing transitive dev-tooling highs (each drops when Renovate upgrades its carrier). New deploy runbook [`docs/conventions/operations.md`](docs/conventions/operations.md) (Logpush→R2, Email DNS + `EMAIL_FROM` activation, secrets gate, per-firm D1 binding, the audit allowlist, dashboard toggles); [`docs/conventions/error-logging.md`](docs/conventions/error-logging.md) backend items marked built and UI items annotated with their destination slice. **Telemetry 35 / worker 273 / database 73 / access-control 20 tests green; full suite 643.** Built **on Opus during the Fable-access gap** — flagged for a Fable re-review (`*`). **7-angle adversarial review complete (2026-06-13)** — 7 parallel finders (3 correctness lenses + reuse/simplification/efficiency/altitude) + empirical per-finding verifiers: **11 findings confirmed, all low severity, zero high/critical.** Nine fixed in-pass: the cron `scheduled()` handler gained the same `operation.failed` error boundary as the request-path twin (golden rule 4 — no silently-dropped cron failure); the duplicated background-failure emission + the `MESSAGE_HEAD_LENGTH` redaction cap collapsed into one `logOperationFailed` helper (`@magna-carta/telemetry/operation`); the scrub backstop now exempts whole minted-handle values so a dash-flanked digit run in an `err_`/`cor_` token can never corrupt the correlation id; the dead `telemetry.scrubbed` event builder removed (the counter is the spec signal) and `EVENT_NAMES` derived from the builders (the uniqueness test can no longer drift); `outbox.swept` wired into the sweep (a successful pass is now observable); the console-ban regex broadened to the full `console.*` surface incl. bracket notation; `migration.applied` annotated as an explicit provisioning wiring seam. Two deferred as documented low-priority seams: the email adapter's per-send correlation id (needs an AsyncLocalStorage request scope; the error path already emits a request-correlated `error.captured`) and the conformance resolver's `allOf`/`oneOf` handling (safe-direction false-positive; composed error schemas are against the one-Problem-shape convention). Landed on `main` 2026-06-13 (with slice 0·5), all gates green (643 tests, `pnpm check`, `lint:process-refs`, `lint:licenses`, contract snapshot). **UI surfaces (client reporter, breadcrumb library, screenshot capture, diagnostics setting, visual-regression CI) are inherited by slice 0·7a/0·7b; the diagnostics agent follows once incidents flow.**
- **Code carries no process-artifact references — golden rule 13 + a CI fitness gate** (root [`CLAUDE.md`](CLAUDE.md) golden rule 13; standard [`docs/conventions/code-style.md`](docs/conventions/code-style.md); gate [`tooling/lint-process-references.mjs`](tooling/lint-process-references.mjs)): swept ADR / design-spec / plan / spike / `§` / white-paper citations out of **all** source, tests, config, and consumer-facing strings — including the OpenAPI `description`s that were shipping ADR numbers to API consumers (the committed snapshot + generated client were regenerated). Code now states its _reasoning_ inline (the citation usually sat beside the explanation already) or points to a file **by path**; decisions stay in the [Decision Log](docs/Decision-Log.md), their home. **One exception, kept:** forward-looking schedule notes that name _when_ a seam is replaced or a feature built ("slice 0·6 swaps in the real email adapter", "Phase 3 adds the product chart-of-accounts"). **Enforced** in CI by `pnpm run lint:process-refs`, which hard-bans the unambiguous citations across code (documentation and generated files exempt — docs cite ADRs by design). The Phase-0 API spike (`api-contract-spike.test.ts` + `support/api-contract-spike-app.ts`), superseded by the shipped contract pipeline, was **folded into a permanent library-emission guard** ([`apps/worker/test/openapi-emission.test.ts`](apps/worker/test/openapi-emission.test.ts)) and removed. The Tier-B comment sweep ran as a 14-agent workflow over disjoint per-package file sets. 587 tests green; `pnpm check` and the gate clean.
- **PDF tooling analysis — one PDFium-WASM engine across runtimes (EmbedPDF), AGPL prohibition, and off-the-shelf Adobe-parity redaction** (research [`docs/research/pdf-tooling.md`](docs/research/pdf-tooling.md); ADR-0088 refining ADR-0045; competitive gap row added to [`docs/research/competitive-analysis.md`](docs/research/competitive-analysis.md)): a tentative, owner-collaborative pass resolving ADR-0045's deferred redaction question, reframed after research found a single integrated SDK and a **spike confirmed server-side execution**. **One engine, every runtime:** the ecosystem has only two comprehensive engines — MuPDF (AGPL, excluded) and PDFium (BSD-3) — and **EmbedPDF** (MIT; PDFium bundled Apache-2.0) is the integrated, plugin-composable SDK over PDFium with **first-class Svelte** support that **runs in browser, Node, and serverless**, so the same WASM engine serves the interactive viewer, server/Container batch work, and (size-permitting) light Worker ops — realizing the ADR-0024/ADR-0039 one-engine model off the shelf. **Spike (2026-06-13):** `@embedpdf/pdfium` v2.14.4 runs headless in pure Node (init ~41 ms, load+parse ~4.3 ms, correct page count/dims); `pdfium.wasm` is 4.6 MB raw / ~2.05 MB gzip — under the Workers paid 10 MB limit, so size is fine and edge-vs-Container CPU placement is a load-harness measurement (ADR-0083). Capabilities are tree-shakable plugins (viewer, annotation, **redaction**, forms, stamp, search, selection, **metadata read+edit**, **export/save**, signature, thumbnail, print, layout-analysis, AI). **pdf.js and pdf-lib dropped** (EmbedPDF covers viewer + create/modify/save); standalone `pdfium-render` likely unnecessary. **AGPL/SSPL made a hard repo-wide prohibition** (incl. transitive + isolated-service) with a license-scanning CI gate joining the ADR-0048 pipeline — excluding **MuPDF** entirely and catching **Ghostscript-via-OCRmyPDF**, so OCR becomes **Tesseract-direct** (refining ADR-0030). **Redaction un-deferred, Adobe parity largely off the shelf:** EmbedPDF's Redaction plugin is true destructive content removal (the vector-level capability the prior pass planned to build) — we add only a sanitize pass (qpdf backstop if needed) and a **verification gate** that refuses to emit if any content survives under a mark; raster-rebuild retained as fallback only. **Placement = client-first by default** (owner, 2026-06-13): interactive single-document work (view/annotate/redact/fill/stamp/extract/metadata/export) runs on the user's device (browser WASM / Tauri native), bytes never leaving it; only four cases are server-side (no-user generation, bulk/batch, native OCR/LibreOffice, trust seal + evidence-redaction), mostly Container with the Worker orchestrating — the light-Worker-PDF tier collapses into the client. **Device variance is the user's concern** (no required server fallback for large interactive docs; batch is server-side regardless). **Shared review/markup and its coordinating Durable Object are deferred** — v1 markup is single-user, client-side; collaborative _document_ editing stays Collabora on the source `.docx` (ADR-0010). Tentative (Proposed), but the five build-time questions were **spiked 2026-06-13**: render ~2.9–6.6 ms/page (single-page Worker-feasible, bulk → Container); **signature = verify only, so `@signpdf` stays for the PAdES seal** (the one firm constraint); **metadata read+write/strip confirmed in-engine** (EmbedPDF `EPDF_SetMetaText` extensions) with a working verification-gate text-extraction primitive; `FPDF_SaveAsCopy` round-trips headless in Node; Bates feasible via the high-level engine. No blocker found. **Upstream-first engine-extension policy (scoped to metadata and signing):** generic capability EmbedPDF lacks is built to be contributed upstream (MIT; fork + PR), shipped locally in parallel (`pnpm patch`/fork) so no slice blocks on the merge, and collapsed to upstream — dropping the external dependency — if accepted; **signing** is the dependency-elimination case (build PAdES seal-creation, drop `@signpdf` if merged), **metadata** the gap-filling case (write/strip already in-engine, contribute sanitization completeness). Boundary: upstream the generic engine primitive, keep the proprietary layer (ESIGN/UETA workflow, redaction verification gate) in-tree.
- **Slice 1·3 designed — Directory** (spec [`docs/specs/2026-06-12-slice-1-3-directory-design.md`](docs/specs/2026-06-12-slice-1-3-directory-design.md); ADR-0085–0087; ADR-0080 amended; white paper _Directory_ amended): Phase 1's third design cycle, run owner-collaborative over the conflicts + directory-mechanics research. **The SSOT graph:** two equal-depth node tables (`directory_person` / `directory_organization`, distinct standard fields, type-prefixed handles) + one typed `directory_edge` table (the handle prefix discriminates endpoints — no kind column); a **category is a per-firm classification label, not a schema variant**; all names (incl. the current one) are queryable `directory_name` rows with role + temporal validity + frozen normalization, name changes **append-and-flip** never edit-in-place. **The six conflicts seams, recall side:** scheme-keyed `directory_name_phonetic_code` rows (**Double Metaphone** via pinned `words/double-metaphone` at launch; the scheme key makes Beider-Morse additive-by-sweep at Phase 4) + an FTS5 trigram table synced by triggers; sensitive identifiers as `protected()` rows against the 1·2 policy table with `directory:viewSensitiveIdentifiers` the decrypt permission, **EIN added to that policy table** (standalone blind index, the org exact-match channel); the conflicts seam-4 edge types made explicit (affiliation/principal-of-org, spouse/family, corporate parent/subsidiary/successor, representation, role-links). **Wiring the 1·1 seam live:** create `matter_party` (role-on-link, many-hats) and migrate `client_display_name`/`client_code` into real entities + `role='client'` links (ambiguous names → provisional review entity, never auto-merged on a bare string). **The three owner gates, resolved (owner, 2026-06-12):** (1) **custom-fields engine → its own slice 1·4** (ADR-0087 — it is the largest, genuinely shared subsystem; built against known field _kinds_ so it need not wait for LEAP; sequenced after 1·3, before Phase 2·6; the typed-EAV shape is designed in this spec as 1·4's seed); (2) **duplicate handling = entry-time prevention + non-destructive merge now, automated unmerge deferred to LEAP as a _guarded_ operation** (ADR-0086) — the unmerge-tenability finding: once a merged entity accrues new activity (the A+B→merge, then add C, then unmerge case) the new data has no recoverable attribution to a former side, so an unconditional split is a footgun; the safety net is non-destructiveness (subordinate archived, every repointed reference recorded in an append-only `entity_merge` event), the event is the seam; (3) **phonetics minimal-go** (ADR-0085 — Double Metaphone + trigram now, Beider-Morse rides the Phase-4 Rust/WASM core, no mature JS impl). **Firm personnel are not Directory entities:** staffing is the 0·4 `member` axis, intra-firm imputation is a Phase-4 `member`↔matter↔`matter_party` join (no personnel node needed), prior-firm lateral history is a documented seam built in Phase 4 — **and the owner reserves this decision for reconsideration in the Phase 4 Conflicts design cycle** (the 1·3 position adds no data to retrofit, so revisiting is cheap). **Deferred with seams:** the Fellegi-Sunter scorer, severity bands, strictness/depth, graph traversal, and the immutable conflicts log → Phase 4; automated unmerge → LEAP; the custom-fields engine → slice 1·4; UI → after 0·7a/0·7b. New domain package `@magna-carta/directory` composing into the slice-0·2 atomic batch. **Backend implementation plan written same cycle** ([`docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md`](docs/specs/2026-06-12-slice-1-3-backend-implementation-plan.md)): 17 TDD tasks — per-firm schema + migration (incl. the FTS5 trigram virtual table + sync triggers drizzle-kit cannot model), the package scaffold + id prefixes, frozen name normalization, scheme-keyed Double Metaphone behind a one-file seam, `createPerson`/`createOrganization` composing the atomic batch, append-and-flip name history, trigram search, `protected()` identifiers with the EIN policy-table row + blind-index channel + `directory:viewSensitiveIdentifiers`, the typed edge graph, category labels, duplicate-candidate generation, non-destructive merge + the `entity_merge` event, the `matter_party` table + the idempotent 1·1 client-display-field migration (ambiguous names → provisional review entity, never auto-merged), the `/v1/directory` routes through the 0·5 chokepoint, the Directory load-profile volume + measured ops, and the fitness/no-plaintext-escape/schema-name-sync/e2e suite. **Build gated on slices 1·1 + 1·2 + 0·5** (the plan builds against their spec'd interfaces, confirmed against landed code at execution). UI plan + owner manual-verification checklist follow once 0·7a/0·7b land.
- **Slice 0·4 landed — secrets deploy gate + platform-admin denial-cause logging** (closes slice 0·4; ADR-0073): `AUTH_SECRET` and `PLATFORM_ADMIN_KEY` set in the Cloudflare dashboard and pinned as a wrangler **`secrets.required`** deploy gate — a missing secret now fails `wrangler deploy` with an explicit list rather than letting auth routes 500 by design at runtime. The platform-admin guard now distinguishes the denial cause (`unconfigured` / `missing-header` / `mismatch`) in a **redacted `console.error` correlated to the client's Error ID**, while the client still receives one **field-identical 401** (no enumeration oracle; the presented and configured keys are never logged) — an **interim telemetry seam** slice 0·6 replaces with the standard redacting pipeline (which will own severity/sampling). Secrets verified live in production (`AUTH_SECRET` confirmed; guard fails closed); **demo-firm provisioning deferred to slice 0·7b** (no human-operable surface until the auth UI lands). **Worker Secrets vs Secrets Store settled (owner, 2026-06-12):** dashboard Worker Secrets + `secrets.required` is the standard; Secrets Store is adopted only if a multi-Worker sharing or central-rotation need appears (no ADR — recorded here and in ROADMAP). **Built by Opus 4.8 — a Fable 5 review pass is pending per the model-split policy.**
- **Slice 0·5b Tasks 9–14 — the committed OpenAPI snapshot, conformance fitness suite, generated client, and CI contract gates (slice 0·5 complete)** (plan [`docs/specs/2026-06-09-slice-0-5-implementation-plan.md`](docs/specs/2026-06-09-slice-0-5-implementation-plan.md) Tasks 9–14; standard [`docs/conventions/api.md`](docs/conventions/api.md)): the code-as-contract pipeline closed end to end. **The committed snapshot** (`apps/worker/openapi/openapi.json`, emitted by `apps/worker/scripts/emit-openapi.mts`): the real route graph is bundler-targeted (extensionless imports, `.sql` text modules, attribute-less `.json`) and never loads under plain Node, so the emitter drives a **programmatic Vite SSR pipeline** — the same transforms tests and wrangler use — guaranteeing the document matches what the Worker serves; a Vitest sanity test compares the committed file to a fresh emission byte-for-byte (the local mirror of the CI drift gate), proven deterministic across the node-side emit and the in-pool build. A shared emit helper derives the document's root `tags` from the operations and feeds **both** the snapshot and the live `/api/openapi.json` route (replacing `doc31`), so they never diverge — a full-stack test asserts the running Worker serves the committed document. **The §3.5 conformance fitness suite** (`apps/worker/test/conformance.test.ts`): structural assertions over the emitted contract — authenticated-mutating ⇒ audited + named permission; every permission ∈ the registry with its namespace matching `x-mc-resource` (the per-subsystem binding — `members`/`firms` are both the `firm` subsystem); the money/trust/payment/comms idempotency-required machinery (namespace set empty until those slices land, plus a registration safety net that flags a money-looking route absent from it); no silently-public route (`authenticated: false` needs a justified `PUBLIC_ALLOW_LIST` entry); surface coherence; unique well-shaped operationIds; and the 0·5a forward-obligation — **component-name uniqueness** (zod-to-openapi silently first-write-wins on a duplicate `.openapi(name)`, so each route is re-emitted in isolation and its component shapes compared). Every rule is proven both ways (clean contract + a caught misconfiguration), with a vacuity guard pinning the four committed operations; `MUTATING_METHODS` lifted to a single exported home shared by the registration guard and the fitness functions. **The committed Hey API + Svelte Query client** (`packages/api-client`, `@hey-api/openapi-ts` 0.98.2 + `@hey-api/client-fetch` + `@tanstack/svelte-query`, plain-object `openapi-ts.config.mjs` with `exportFromIndex`): stable domain-named factories (`meGetOptions`, `membersInviteMutation`, …) keyed off the native operationId — the tsc-stays-flat guarantee, never Hono `hc`; the `.gen.ts` output is committed, regenerated by `generate-client`, and diff-gated; a compile-only test exercises the public surface and a dedicated `tsc -p` type-checks every generated file. **CI contract gates** (`.github/workflows/ci.yml`): snapshot drift, client drift, Spectral hygiene lint, oasdiff breaking-change (PR-only vs the base snapshot, `fail-on ERR`, `review: false` so the contract never leaves CI, skipped on first introduction), and a Prism mock smoke. **Tooling deviations recorded** (ADR-0066 amendment): Spectral 6.16/nimma crashes traversing the document's `null`-valued `x-mc-permission` extensions, so `.spectral.yaml` disables `duplicated-entry-in-enum`; the generated client is formatter- and lint-exempt (its bytes are the generator's), its "compiles" gate provided by the dedicated `tsc -p`. 263 worker tests green; `pnpm check` and the full suite clean. **Built under Opus during the Fable-access gap — flagged for Fable re-review.**
- **Slice 0·5b Tasks 7–8 — the ADR-0067 enforcement chokepoint, wired as the single API boundary** (plan [`docs/specs/2026-06-09-slice-0-5-implementation-plan.md`](docs/specs/2026-06-09-slice-0-5-implementation-plan.md) Tasks 7–8; design ADR-0067): the chokepoint built in Task 7 (the ordered tenancy → authn → RBAC → idempotency → rate-limit middleware over injected ports) is now the **single enforcement point every `/api/v1` route traverses** — metadata-driven, never per-handler discipline. **Routes migrated onto `defineOpenAPIRoute` + the chokepoint** (`apps/worker/src/routes/{health,me,members,firms}.ts`, composed in `app.ts` via `chokepoint/register.ts`): each route is a route-bundle carrying its full `RouteMeta`, registered with `chokepointMiddleware` (the dev response validator → route-specific guards → the chokepoint), and `assertRouteHasMeta` runs at startup so a route mounted without metadata (or naming an unregistered permission) **throws at registration, fail-closed**. **The inline per-handler checks are deleted:** `me.ts`'s session→firm→permission→member-active block and `members.ts`'s `authorizeMemberManagement` + route-mounted idempotency middleware are gone — the chokepoint owns them, behind real ports (`chokepoint/ports.ts`: `resolveSession` over Better Auth, `resolveFirmContext` = control-plane firm lookup → `resolveFirmDatabase` → member-active check, `loadPermissions` over the session firm only). **404-not-403 unified (ADR-0052):** a deactivated member is now structural absence → **404** on every authenticated route (the 0·4 route-local 403 retired); a within-firm permission denial stays **403 + `requestAccess`** (the ADR-0068 request→grant seam). **Idempotency applied exactly once** at the chokepoint's step-4 gate (`chokepoint/idempotency-port.ts`), surface-scoped (`${firmId}:${clientKey}` for the app surface, `platform:${clientKey}` for the public firms route) — no chokepoint + route-mounted double-application. `firms.provision` keeps its platform-admin secret guard as route-specific middleware (the documented public-surface exception, run before the chokepoint's gates so nothing is discoverable without the secret). **Composition root:** the `/api/openapi.json` `doc31` config gains `servers` (the `api.magnacarta.esq/v1` + app-surface origins), `info.description`, and `info.contact`; the 0·5a `defaultHook` is installed app-wide (Zod request failures → the 422 problem). **Tests** (231 worker tests green): the 0·4 end-to-end TOTP/login/invite/provision journey and the conformance fitness functions still pass through the wired chokepoint path; integration coverage proves each enforcement case (logged-out 401, within-firm 403 + `requestAccess`, absent/deactivated 404, missing-`Idempotency-Key` 400, and a new auth-bucket hammer → 429 + `Retry-After`). Forward-obligations cleared: the tenant-scoped rate-limit key and the data-access idempotency middleware on `problemJson` are both landed. **Built under Opus during the Fable-access gap — flagged for Fable re-review.**
- **Slice 0·5a — API contract foundation (the contracts layer), built** (plan [`docs/specs/2026-06-09-slice-0-5-implementation-plan.md`](docs/specs/2026-06-09-slice-0-5-implementation-plan.md) Tasks 1–6; design ADR-0066/0067 in [`docs/specs/2026-06-04-api-contract-design.md`](docs/specs/2026-06-04-api-contract-design.md); standard [`docs/conventions/api.md`](docs/conventions/api.md)): slice 0·5 split at its architectural pause point into **0·5a** (this — the unwired contract vocabulary + machinery) and **0·5b** (the enforcement chokepoint + snapshot/CI/client pipeline, which depends on slice 0·4). Ships, all behind `apps/worker/src/contracts/` and `apps/worker/src/chokepoint/`: the **RFC 9457 problem module** + a compile-checked type-URI registry (`problemType`, `problemJson`, the `defaultHook` mapping zod failures to 422 `application/problem+json` with field-level `errors[]`; an `err_` correlation id per reply via a new `@magna-carta/identifiers` `error` prefix + the `identifierPattern` accessor); the **pagination envelope** + cursor/idempotency-key/identifier-path-param fragments (cursor-only, lowercase header key, branded `Identifier<T>` path params); **`RouteMeta` + `defineOpenAPIRoute`** — the centrepiece that emits route metadata both natively (`operationId`/`tags`) and as `x-mc-*` extensions, registers meta in a WeakMap resolved at registration time (the library rest-destructures the route, so the key never survives into the registry or Hono's matched routes), flips the idempotency-key header to `required: true` in the document on idempotency-required routes, and **fails closed at definition time** on the access-control invariants the 0·5b chokepoint will trust (a public route naming a capability throws; an authenticated _mutating_ route with `permission: null` throws — privilege-escalation-by-omission, caught via the route's HTTP method); the **async-capable `RateLimiter` seam** + an in-memory sliding-window limiter (named buckets, injectable clock, fail-closed under clock anomalies; the sync-or-promise return lets a future Durable-Objects/KV adapter fit without a breaking change); and the **dev-only response/contract divergence validator** (parses outgoing JSON against the declared response schema only when `ENVIRONMENT === "development"`, a strict zero-body-read pass-through otherwise). Built TDD with two-stage per-task review (spec + quality) **on Fable**, then a full **7-angle adversarial pass on Opus** during the Fable-access gap — verified findings fixed same-pass (the fail-closed auth guard, problem-module status-range + symbol-safe-path hardening, three mutation-proven test-coverage gaps, comment-accuracy corrections); **flagged for a Fable re-review** when access returns (STATUS.md `*` marker). Forward-obligations recorded against 0·5b: a component-name-uniqueness fitness function, tenant-scoping the rate-limit key, and migrating the data-access idempotency middleware onto `problemJson`. 360 tests green; merged additively (the only live-path change is an unused `ENVIRONMENT` binding).
- **Load-profile harness built — golden rule 10's measurer is live** (ADR-0083; spec [`docs/specs/2026-06-11-load-profile-harness-design.md`](docs/specs/2026-06-11-load-profile-harness-design.md); plan [`docs/specs/2026-06-11-load-profile-harness-implementation-plan.md`](docs/specs/2026-06-11-load-profile-harness-implementation-plan.md)): the designed harness realized inside `@magna-carta/fixtures` under `src/load-profile/` — `pnpm --filter @magna-carta/fixtures run measure` builds (or replays) the `ledgerVolume` snapshot, runs the measured set, and writes the baseline. **Profiles + generation:** the versioned `ledgerVolume` v1 profile (counts/distributions as parameters, one scale multiplier) generated archetype-driven through the real domain write paths — one-seed deterministic, with `GENERATOR_VERSION` participating in snapshot identity. **Snapshot cache:** content-keyed (a stable hash of generator version + resolved profile + per-firm migration journal tags + seed) under `node_modules/.cache/load-profile` with a JSON manifest; measurements run against an isolated **working copy** replayed via `node:sqlite` `backup()` (pin-tested, with the new `openNodeDatabaseFile` primitive in `@magna-carta/database`), never the cached artifact. **Measurement runner:** warmup + timed iterations → min/median/p95 per named operation, plus `EXPLAIN QUERY PLAN` capture with hot-path full-scan flagging — the measure script exits non-zero on a hit; measurement contexts derive `${seed}:measure` so the generation identifier stream is never replayed. **The v1 measured set (five operations):** `balance-read.busy-subledger`, `post-entry.two-line`, `reverse-entry.two-line`, `create-account.trust-subledger`, and `ledger-fitness.table-wide`. **First committed baseline:** [`packages/fixtures/baselines/ledgerVolume-v1.json`](packages/fixtures/baselines/ledgerVolume-v1.json) (25,102 entries) — machine-relative regression references, never production latencies. **Plan-scan findings: none** — all three hot-path probes (balance read, entry by id, lines by entry) walk indexes (`ledger_line` is covered by its UNIQUE `(entry_id, line_index)` index); nothing allowlisted beyond the table-wide-by-nature fitness pass. **CI:** a tiny-scale smoke ([`packages/fixtures/test/load-profile-smoke.test.ts`](packages/fixtures/test/load-profile-smoke.test.ts) — no timing assertions; asserts the five operations and scan-free hot-path statements) keeps the harness green.
- **Directory-mechanics research — the slice 1·3 design cycle's remaining open areas** ([`docs/research/directory-mechanics.md`](docs/research/directory-mechanics.md)): the three Directory-internal gaps the conflicts research deliberately did not cover, resolved into **candidate shapes — all three subsequently owner-gated (2026-06-12): none is adopted**; each enters the 1·3 design cycle as an explicit go/no-go (build at all? benefit worth the cost? defer or descope instead?) with the candidate shape on file only so a "go" is actionable, and with cheaper alternatives recorded per item (fixed standard fields without an engine; merge-without-unmerge or prevention-only tiers; trigram-only search with phonetic codes added later by backfill sweep). **(1) The shared custom-fields engine** (deferred from 1·1 so it is designed once for matter types and entity categories): typed-EAV — per-firm field definitions + picklist-option rows + typed value rows with **real, indexed reference columns**; JSON-column storage rejected on two platform invariants (merge must relink every reference, which JSON blobs make a corpus scan; field-level audit/temporal history maps to rows); Clio's 12 field kinds as the launch superset. **(2) Merge/unmerge:** the market survey found no true unmerge anywhere (Salesforce hard-deletes into a recycle bin, HubSpot is explicitly irreversible; Dynamics 365's deactivate-and-reparent is the closest model) — recommended: non-destructive merge (subordinate archived `merged_into`, never deleted), a first-class append-only `entity_merge` event recording survivorship choices and **every repointed reference**, the subordinate's names/identifiers kept master-resolved in the matching corpus (a merged-away alias must still trigger a conflict hit), and unmerge as deterministic inverse replay with post-merge edits staying with the master. **(3) Phonetic encoders, feasibility-verified:** `words/double-metaphone` (typed, pure, Workers-safe) is viable at write time today; **Beider-Morse has no mature JavaScript implementation** (reference is PHP; the one TS package is v0.4 single-maintainer) — so the conflicts research's phonetic-code columns refine into **scheme-keyed `name_phonetic_code` rows** (adding a scheme later = additive rows + a backfill sweep, not a schema change), Double Metaphone at launch, Beider-Morse deferred to the Phase 4 conflicts engine via the `rphonetic` Rust crate (commons-codec port) on the already-planned shared Rust→WASM core, with Daitch-Mokotoff a free rider.
- **Slice 1·2 designed — the `protected()` crypto module** (spec [`docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md`](docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md); ADR-0084; ADR-0026 amended — TOTP line closed): the implementation-grade layer below ADR-0026's architecture, resolving every open decision from the research doc. **Module:** pure `@magna-carta/encryption` (envelope, AES-KW wrap, HKDF-SHA-384 derivation, blind indexes — injected `CryptoKey` handles only) + enforcement in `data-access` (the `protectedField` declaration; `readProtected` = ADR-0068 permission check → per-firm `audit_log` decrypt row → AAD decrypt, inseparable; blind-index matching needs neither). **Bytes fixed now because they're corpus-rewrite-expensive later:** the versioned ciphertext frame `[algo_version | key_version | iv | AES-256-GCM ct+tag]`, AAD context binding (`mc:aad:v1|firm|table|field|row_pk|versions` — anti-ciphertext-shuffle), frozen HKDF info constants with per-field index subkeys, non-extractable keys end to end with per-firm keys minted at provisioning (idempotent `FirmProvisioner` step + a mint sweep for existing firms). **Blind-index policy table** (the binding contract Directory declares against in 1·3): SSN L=16/digit-strip, account numbers L=24, driver's license L=16 state-prefixed — lengths computed from the coincidence formula, transforms frozen with the decrypt-reindex cost of changing one documented; **DOB and SSN last-four are never standalone-indexed** (~15/~13 bits — frequency-fingerprintable at any tuning) and match by decrypt-and-compare on higher-entropy candidate sets. **First consumers so the module ships exercised:** `getSecret`/`putSecret` over `firm_secret` (`firm:manageSecrets`), incident descriptions upgraded to protected (the 0·6 seam retired; expand-contract with a code backfill sweep — SQL migrations cannot encrypt), and the audited `shredFirmKey` crypto-shred function (offboarding route a named seam). **TOTP seeds (owner decision, 2026-06-12):** stay under Better Auth's own at-rest encryption — verified empirically against the pinned version, `encryptionKeys` rotation configured, auth secret in the managed-secrets inventory; the per-firm chokepoint was structurally wrong for user-owned login credentials (firm crypto-shred must not break a login). Rotation machinery stays deferred; the envelope's version bytes and the version-prefixed index values are the dual-read seams. **Implementation plan written same cycle** ([`docs/specs/2026-06-12-slice-1-2-implementation-plan.md`](docs/specs/2026-06-12-slice-1-2-implementation-plan.md)): 12 TDD tasks — the pure package with committed golden vectors (AAD serialization, blind-index values) as frozen-contract pins, the AAD-mismatch matrix and 1,000-IV-uniqueness fitness tests, the firm-key provider with shred-aware fail-closed caching, the provisioning mint step + two idempotent backfill sweeps (key-mint for pre-existing firms, incident-description encryption — SQL migrations cannot encrypt), a Workers-runtime parity suite re-running the vectors under Miniflare, and the repo-wide no-plaintext-escape source scan. Zero new runtime dependencies (native Web Crypto only).
- **Load-profile harness designed — the cross-cutting performance/scaling measurer** (spec [`docs/specs/2026-06-11-load-profile-harness-design.md`](docs/specs/2026-06-11-load-profile-harness-design.md); ADR-0083): the white paper's third fixtures entry point (_Synthetic data & fixtures_), deferred by slice 0·3 (§5.5), designed as its own **phase-independent cross-cutting slice** — golden rule 10's named measurer, without which every "optimize when measured" gate was unfireable and the slice-DoD perf-test unfulfillable. Builds inside `@magna-carta/fixtures` (no new package; a separate export path keeps it off the scenario/demo import surface): declarative named+versioned **volume profiles** (counts and distributions as profile parameters, one scale multiplier from CI-smoke to stress scale; v1 ships `ledgerVolume`, the only domain with schema today), generation through the real domain write-paths (valid by construction; one-seed byte-identical), **snapshot artifacts** (SQLite file + JSON manifest of profile version/seed/schema state/package versions) in a gitignored content-keyed local cache — manifest mismatch regenerates, artifacts never committed — and a **query-level measurement runner** (warmup + timed iterations → median/p95 per named domain operation, plus `EXPLAIN QUERY PLAN` capture flagging full scans on measured paths — a mechanical no-N+1 detector) writing small committed JSON baselines for human diffing. **Honesty clause recorded:** local `node:sqlite` numbers are relative (regression deltas, growth curves, plan shapes), never absolute production latencies — the `loadtest` environment (ADR-0075) is the named absolute-numbers seam, and request-path HTTP measurement is a named seam built after slice 0·5. The **accretion rule** (ADR-0078's build-when-in-the-area principle) binds every later domain slice to extend the profile and the measured set while open (1·1 adds matters/files + the R2 blob layer, 1·3 the Directory graph, Phase 3 financial volume). First consumers: the slice 0·3 deferred efficiency candidates, the per-slice DoD perf-test, and real-density UI data for 0·7a/1·1. STATUS.md gains a **Cross-cutting** section tracking it. **Implementation plan written same cycle** ([`docs/specs/2026-06-11-load-profile-harness-implementation-plan.md`](docs/specs/2026-06-11-load-profile-harness-implementation-plan.md)): 8 TDD tasks — the `openNodeDatabaseFile` + `node:sqlite` `backup()` persistence primitives in `@magna-carta/database` (pin-tested), the profile module, the archetype-driven volume generator (trust subledgers never overdrawn, payments bounded by receivables, reversals on operating expenses only, seed-twice determinism proven at tiny scale), the content-keyed snapshot cache with isolated working copies, the measurement runner (untimed per-iteration `prepare` so reverse-entry measures only the reversal; the sanctioned `performance.now()` read documented at site), the five-operation v1 ledger measurement set with the `${seed}:measure` derived context (replaying the generation seed would collide on UNIQUE identifier primary keys), the CI smoke, and the `measure` script producing the first committed baseline. Build: next free session.
- **Slice 1·1 backend implementation plan** ([`docs/specs/2026-06-11-slice-1-1-backend-implementation-plan.md`](docs/specs/2026-06-11-slice-1-1-backend-implementation-plan.md)): 18 TDD tasks realizing the slice 1·1 spec's backend — per-firm schema (matters/locations/file-manager tables plus the minimal `setting` and append-only `audit_log` storage seams the unbuilt ADR-0040 settings framework and future audit subsystem will formalize), three new domain packages on the ledger pattern (`@magna-carta/locations`, `@magna-carta/matters` with the pure numbering renderer + the guarded-increment/UNIQUE-backstop counter idiom proven concurrent on real SQLite, `@magna-carta/file-manager` with the status-gate quarantine discipline and a source-scan fitness test), the Worker upload surface (aws4fetch presigning behind an injectable seam, Uppy-shaped endpoints, multipart session lifecycle), the `files-ingest` queue consumer over a pure single-read ingest core (`crypto.DigestStream` streaming SHA-256, `file-type` magic-byte sniff, engine-less scan port), streaming ZIP64 downloads via `client-zip`, exact D1 storage metering + reconciliation cron, and an end-to-end test walking the owner's consultation→retain→upload→close→add-to-closed flow. The **UI plan** (spec §11 + the owner manual verification checklist) is deliberately deferred until slices 0·7a/0·7b land — component-level tasks against an unbuilt design system would invent APIs; the upload endpoint and list-filter shapes in this plan are the UI's contract.
- **Slice 1·1 designed — Matters core, Locations & File Manager** (spec [`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md); ADR-0079–0082; ADR-0078 amended): Phase 1's first design cycle, run owner-collaborative over the research doc's open decisions. **Matter shell & lifecycle (ADR-0080):** display-only client fields pre-Directory (the `matter_party` role-on-the-link shape sketched, wired live in 1·3); matter types as per-firm data (custom-fields engine deferred to a shared design with Directory); the owner-shaped lifecycle — **Prospective = an unnumbered consultation** surfaced only in a per-attorney virtual Consultations folder (replacing the legacy catch-all consultations matter; each consult is its own matter so files never move on retention and parties feed Phase 4 conflicts permanently), **Open draws the number**, **Closed = archived-but-additive** (still accepts late-arriving items) behind a named close-precondition hook Phase 3 fills with the zero-balance rule — the white paper's "read-only" closed state corrected same commit. **Numbering engine (ADR-0079):** an ordered segment template (literal/counter/year/date-opened/location/type/client/staff-initials/name) whose counter scope derives from scoping-marked segments over one `{firm, scope_key}` counter table — reproducing every surveyed real-world format (year-sequence, client-matter `10034-00012`, office/practice prefixes, court-style, date-opened, court-assigned manual numbers) with frozen rendered numbers, permission-gated manual entry/renumber, and configurable counter starts for migrating firms. **Locations (ADR-0031 realized):** addresses, jurisdiction, letterhead text fields (logo asset a Phase 2 seam), number code, staff assignment, firm default. **File Manager:** D1 folder tree over opaque per-firm R2 keys (`files/{file_id}/{version_id}` — rename/move is metadata), `file_version` carrying content SHA-256 (ADR-0078), `storage_encoding` (ADR-0077 delta seam), `artifact_role` + `pinned` (derived-artifact columns now, eviction policy to dedicated Phase 2 research), scan verdict + status, the no-op version skip, soft-delete only. **Inbound upload path (ADR-0081, closing the white paper's named open item):** uniform direct-to-R2 (bytes never transit the Worker), presigned PUT + resumable S3 multipart behind pinned Uppy, quarantine as a **status gate** (no pending-key copy — promotion is a status flip), the single-read ingest consumer (magic-byte/size/bomb gates + SHA-256 + the malware-scan port recording an explicit `unscanned` launch verdict + commit + metering), policy enforced at presign and re-verified at the gate, `aws4fetch` presigning under one Worker-secret R2 token, `FirmResourceProvider.configureBucketNotifications` → the purpose-named `files-ingest` queue. **Bulk download (ADR-0082):** adopt `client-zip` (pinned) for streaming store-mode ZIP64, version keys resolved at request time, live-stream v1. **Storage metering (ADR-0078 amended):** the authoritative billing/capacity number moves to an exact incremental per-firm D1 rollup (class × artifact role × prefix) with Analytics Engine as the trend feed and a scheduled LIST reconciliation — AE's single-index/sampling/3-month limits cannot carry a billing figure. **Marked for future research (owner):** the malware-scan engine and the async bulk-download job lifecycle (both seamed, neither has a timeline home). **New convention:** every UI-bearing slice ships an **owner manual verification checklist** as a definition-of-done deliverable ([`docs/conventions/testing.md`](docs/conventions/testing.md)).

- **Storage foundations — content hashes from day one, compressed backup dumps, per-firm storage metering; the build-when-in-the-area principle** (white paper _Matters and File Manager_, _Database backup & disaster recovery_, _Document versioning & storage tiering_; CLAUDE.md _How we work_; ADR-0078, extending ADR-0077/0050): the ADR-0077 follow-ups, governed by a new owner-set working principle — when a slice is open, build the cheap-from-the-getgo / expensive-to-retrofit parts up front (seams, schema columns, instrumentation); "build when measured" gates are reserved for heavy machinery, never foundations. Decided: **(1)** every stored R2 object records a SHA-256 content hash at write time (slice 1·1 — evidence-grade fixity, the delta-verification hash, dup-detection UX, upload short-circuit, scan-verdict caching, no-op version skip; cross-matter blob dedup explicitly not decided — ethical walls / refcounted destruction / hold semantics); **(2)** the ADR-0050 per-firm SQL backup dumps are zstd-compressed as they stream from the first build (~85–95% on SQL text; neither no-compression rationale applies; restore drills exercise the compressed path; `--patch-from` against GFS keyframes the named later option); **(3)** a per-firm storage-metering rollup (bytes + object counts by storage class/prefix → Analytics Engine) builds in slice 1·1 — the instrument that fires every storage adopt-when trigger (ADR-0077's ~100 GB/firm, ADR-0056, ADR-0049 destruction economics) and doubles as the billing/capacity number. Parked for research (slice 1·1 design cycle): a derived-vs-original artifact class (recomputable renditions are caches, not archives). Recorded constraint: any future per-firm R2 envelope encryption must sit below the delta/dedup layer.
- **Version-history delta storage — designed-but-deferred, seam reserved** (white paper _Document versioning & storage tiering_; ADR-0077, extending ADR-0035): superseded document versions accumulate forever as full snapshots in Infrequent Access (tiering, never pruning) and successive versions are highly redundant — but `.docx`/`.xlsx`/`.pptx` are deflated ZIP containers, so a one-word edit scrambles the compressed bytes and defeats naive binary deltas. The recorded design: re-pack the ZIP with _stored_ entries (the ReZipDoc insight — the tool itself, a Java git clean/smudge filter, rejected), delta with **zstd `--patch-from`** (one tool for every format; Rust bindings fit the shared Rust doc core), verify a roundtrip content hash, and swap the IA object via an async Queue/Container job at the existing ADR-0035 supersede-to-IA hook; the latest version always stays full and a keyframe every K versions bounds reconstruction chains so every version stays independently verifiable (legal-hold/discovery defensibility). The pipeline builds in Phase 2 once Collabora editing generates measurable churn (golden rule 10 — at IA's $0.01/GB-mo, full snapshots must reach ~100 GB/firm before costing $1/mo); what slice 1·1 reserves now is the only expensive-to-retrofit part: a `storage_encoding` discriminator on version metadata and the rule that nothing outside the data-access layer assumes a version object is raw file bytes. Content-defined chunking (cross-document dedup for templated legal work) considered, deferred to discovery scale. ADR-0035's "no compression" is scoped to the active corpus (`current` + latest version, preserving the range-stream preview path).
- **Slice 0·7a designed — the design-system foundation** (spec [`docs/specs/2026-06-10-design-system-foundation-design.md`](docs/specs/2026-06-10-design-system-foundation-design.md); ADR-0076, superseding ADR-0028): the token pipeline, theming model, and component layer that make golden rule 2 ("all UI through the design system") mechanically enforceable. Every tooling choice was adversarially stress-tested against June-2026 primary sources. **Tokens** (`@magna-carta/design-tokens`): spec-pure **DTCG 2025.10** with the Resolver module for theming — a **curated theme gallery × light/dark** (firm picks the theme as an ADR-0040 firm setting; each user picks light/dark/system; two `<html>` attributes apply it at runtime — themes are pure data, a new theme is a new resolver input), single launch density behind `density.*` future-axis aliases, OKLCH palette ramps authored programmatically via a **Culori** generation script; generated by **Terrazzo 2.x** (pinned exact) into CSS custom properties + Tailwind v4 `@theme`, gated by golden-file snapshots, a **WCAG 2.2 contrast gate over every theme×mode**, an every-theme-defines-every-token completeness check, and spec-purity (the conditions that price Terrazzo's bus-factor-1 at "abandonment costs days" — Style Dictionary v5 is the named escape hatch). **Components** (`@magna-carta/design-system`): an in-house styled layer **directly on Bits UI v2** — **shadcn-svelte replaced** (its look lives in vendored class strings, not CSS variables; escaping it converges on headless-build cost plus permanent fork maintenance; retained as an uninstalled reference corpus) — ~28 components in four build tiers (~7–11 engineer-week first pass), semantic component classes fed exclusively by token custom properties, variants as plain typed functions (no churning DSL), a token z-scale, one internal floating/presence wrapper; satellites: svelte-sonner, virtua, TanStack table-core + in-house adapter, paneforge, `@internationalized/date` (`CalendarDate` = the ADR-0055 civil date), Lucide deep imports, superforms + formsnap on a Standard Schema contract. **Catalog + enforcement:** Storybook 10 stories tripling as Vitest browser-mode behavior tests and per-story axe checks (+ a manual screen-reader pass per batch), Playwright visual regression across every theme×mode (Argos CI the named upgrade), and lint/fitness functions banning arbitrary values, raw colors, raw z-index, styled raw HTML outside the package, and `bits-ui` imports outside the package. The **design language + page archetypes** (ADR-0053) are authored owner-first inside the slice before any component is styled; the roadmap's slice 0·7 splits into 0·7a (this foundation) and 0·7b (auth UI + deferred diagnostics surfaces, its own design cycle). Risk register and rejected alternatives (Ark UI Svelte, Style Dictionary today, hand-rolled generator, no-DTCG, Skeleton/Flowbite/Carbon/daisyUI/Melt, Histoire) recorded in the spec and ADR.
- **Auth, RBAC skeleton & firm provisioning — built (slice 0·4)** (ADR-0073, amended with build findings; spec [`docs/specs/2026-06-09-slice-0-4-auth-rbac-provisioning-design.md`](docs/specs/2026-06-09-slice-0-4-auth-rbac-provisioning-design.md); plan [`docs/specs/2026-06-09-slice-0-4-implementation-plan.md`](docs/specs/2026-06-09-slice-0-4-implementation-plan.md)): the designed model, realized — backend + API only. **Auth:** Better Auth **1.6.16** mounts at `/api/auth` on control-plane D1 via the Drizzle adapter (`transaction: false` — D1 rejects `BEGIN`; the **`nodejs_compat`** compatibility flag is required — the workerd build needs `node:async_hooks`); the five auth tables land in control-plane migration `0001_auth-and-provisioning`, transcribed from the pinned package's `getAuthTables()` (**no Better Auth CLI exists for the 1.6.x line**) with a schema-sync fitness test as the version-bump tripwire; every Better Auth row mints a prefixed handle (`usr_`/`ses_`/`acc_`/`ver_`/`twf_`) through a **fail-loud `generateId`** (an unknown model throws — ADR-0062); **invitation-only membership** (signup disabled; the public route 400s `EMAIL_PASSWORD_SIGN_UP_DISABLED`, fitness-tested); **TOTP** exercised end-to-end API-only (enroll → verify → 2FA login); **invite activation** = `resetPassword` creating the missing credential account + an `onPasswordReset` hook flipping `email_verified` (completing a reset proves mailbox possession) and writing the `password.reset` audit; guarded auth-audit hooks (`login.success` on session create; transition-exact `two_factor.enabled`/`two_factor.disabled` via paired user.update hooks) that can never fail the auth flow, while request-path audit rows ride the atomic effect batch. **Routes:** `POST /api/v1/firms` (platform-admin key, constant-time SHA-256-folded comparison), `POST /api/v1/members` (the Better Auth user + the per-firm `member` mirror synced through the control-plane outbox → Queue consumer; per-firm migration `0002_member-rbac` adds the mirror + roles-as-data), `GET /api/v1/me` (session + effective permissions). **`@magna-carta/access-control`** (pure package, 20 tests): the static permission registry + the `effectivePermissions` resolver the slice 0·5 chokepoint will consume. **Security-review hardening — idempotency is auth-gated and tenant-scoped:** session + permission checks run before the idempotency pre-decision, and stored keys are scoped `${firmId}:${clientKey}` (`platform:${clientKey}` on platform-admin routes) via a new optional `deriveStoredKey` middleware hook — closing an unauthenticated replay/key-existence oracle and cross-firm replay/poisoning. **Firm provisioning:** an idempotent, resumable orchestration behind the `FirmResourceProvider` port — the dev adapter claims the pre-declared `DB_FIRM_POOL_*` Miniflare bindings (selected by the absence of the Cloudflare REST credentials), the Cloudflare REST adapter creates real D1/R2; resume identity = `firm.name` UNIQUE + nullable `database_identifier` (same name + same owner email replays as a no-op, a different owner is 409); per-firm migration SQL ships in the Worker as plain `.sql` text imports (wrangler Text rule + a vitest plugin — Vite `?raw` does not survive wrangler's esbuild). **Cron wiring (closes the slice 0·2 deferral):** the scheduled handler sweeps the control-plane + per-firm outbox relays and purges expired idempotency records every 5 minutes. Side additions: the `sendEmail` port with the dev terminal-logging adapter (slice 0·6 swaps Cloudflare Email Service behind the same signature, ADR-0074), the committed placeholder-only `.dev.vars` with a byte-identity guard, and the auth & secrets operational facts recorded in [`docs/conventions/security.md`](docs/conventions/security.md). 84 worker tests green including the slice end-to-end suite.
- **`@magna-carta/ledger` + `@magna-carta/fixtures` — the append-only ledger core and fixtures harness, built (slice 0·3)** (ADR-0072; spec [`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`](docs/specs/2026-06-09-ledger-core-and-fixtures-design.md); plan [`docs/specs/2026-06-09-ledger-and-fixtures-implementation-plan.md`](docs/specs/2026-06-09-ledger-and-fixtures-implementation-plan.md)): the designed posting model, realized. **Schema** (per-firm migration `0001_ledger-core`): `ledger_account` (structural model, subledger seam, soft-close), `ledger_entry` (dual dates; UNIQUE `reverses_entry_id`), `ledger_line` (direction + `amount_minor CHECK (> 0)` + an explicit direction CHECK — drizzle text enums are type-level only), `account_balance` (normal-balance terms, nullable bounds, the CHECK that aborts a violating batch — proven on real SQLite at both statement and write-path level). **`@magna-carta/ledger`** (first domain package, 41 tests): `postEntry`/`createAccount`/`reverseEntry` validate in memory and compose into the slice-0·2 `composeEffectBatch` (entry → lines → aggregated balance deltas → `ledger.entry.posted` outbox row, ids client-minted and seedable); validation = ledger invariants only with stable machine-readable codes, including review-added hardening: the **`parent-has-postings`** creation-side leaf-rule guard (an account that ever posted can never become a parent — closes the sequential roll-up hole), safe-integer minor-unit assertions at the statement boundary, an empty-IN-list guard, year-0000 date rejection, and a documented bounds-refusal-at-commit path (a reversal that would overdraw trust composes fine but the batch CHECK refuses it — the ADR-0009 behavior, tested); table-wide fitness queries (sum-to-zero per entry; materialized balance = recomputed lines) plus a schema-name-sync sweep pinning every SQL identifier to the drizzle schema. **`@magna-carta/fixtures`** (14 tests): one seed → `FixtureContext` (seeded faker 10.4.0 + fixed clock anchored 2026-01-05 + the ADR-0062 seeded identifier source, sequence-locked determinism tests), `createLocalPerFirmDatabase` over the new `@magna-carta/database/node-sqlite` D1-shaped adapter (guarded ROLLBACK, committed-migration loader), the production seeding guard, the 14-account demo chart (demo-only boundary, trust subledgers under Client Trust Liability), named scenarios `retainerDeposit`/`trustCorrection` (reversal-link asserted)/`boundsRejection`/`multiLineSettlement` with assertions baked in as plain Errors, and the guarded `seedDemoFirm` 13-entry bundle with the **seed-twice byte-identical** determinism proof (outbox `id` excepted — minted unseeded in data-access, documented seam). Side additions: `currencyCode` accessor in `@magna-carta/money`; `acct_`/`lln_` prefixes + branded ids in `@magna-carta/identifiers`; ledger-core invariants added to [`docs/conventions/invariants.md`](docs/conventions/invariants.md); per-package `CLAUDE.md`s for both new packages.
- **Production Cloudflare resources + the resource naming convention** (ADR-0075): created `magna-carta-production-platform-control` (the control-plane D1), `magna-carta-production-platform-files` (R2 — walking-skeleton placeholder until per-firm buckets land in slice 0·4), and `magna-carta-production-platform-jobs` (the shared jobs queue); `wrangler.jsonc` now binds the real resources (placeholder `database_id` retired). The convention — `magna-carta-<environment>-<scope>[-<purpose-or-slug>]` — bakes the environment in from day one (D1/R2 cannot be renamed), sorts the per-firm fleet and the platform set as adjacent blocks, mints per-firm lowercase slugs rather than deriving names from `frm_` handles (R2's charset forbids them; names are recorded registry pointers, never parsed), and grows queues by purpose, never per firm. Deploys go through **Cloudflare Workers Builds** (owner-chosen over a GitHub-Actions-held API token; Actions remains the test gate; PR previews disabled until a `staging` environment exists).
- **Slice 0·6 designed — telemetry baseline & platform closeout** (spec [`docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md`](docs/specs/2026-06-09-slice-0-6-telemetry-baseline-design.md); ADR-0074): backend + CI only — the UI-dependent pieces (client-reporter surfaces, breadcrumb library, screenshot capture/redaction, diagnostics settings, **visual-regression CI**) move to the design-system/auth-UI slice, and the **diagnostics agent** follows once incidents flow. What ships: **`@magna-carta/telemetry`** as the golden-rule-4 single logging path (typed **allowlist event builders** that make redact-by-default structural — an undeclared field has no slot to be logged in; a scrubbing-backstop tripwire with a `telemetry.scrubbed` counter; `cor_` correlation IDs on every request and `err_` Error IDs minted in one place — the 0·5 problem module delegates here; a pure `Logger` seam whose Workers adapter emits structured JSON to Workers Logs and counters to Analytics Engine), a **console-ban fitness function** (ad-hoc `console.*` outside the adapter fails CI), the telemetry middleware ahead of the chokepoint (request events, escaped-exception capture → RFC 9457 500 with the Error ID), **incident intake** as `POST /v1/incidents` in the single Worker (per-firm `incident` row inside the isolation boundary, `protected()` upgrade a named seam; `incident.created` outbox → Queue with no consumer yet — the diagnostics agent's contract), **transactional email = Cloudflare Email Service** behind the slice 0·4 `sendEmail` port via the native `send_email` binding (public-beta caveat + DKIM/SPF runbook recorded; Resend/SES rejected; the platform's first paid-Workers-plan dependency, owner-confirmed), and **Renovate** (pnpm-catalog-aware, pin strategy, propose-only) + OSV/audit CI gate + GitHub secret scanning (Dependabot rejected on catalog support).
- **Slice 0·4 designed — auth, RBAC skeleton & firm provisioning** (spec [`docs/specs/2026-06-09-slice-0-4-auth-rbac-provisioning-design.md`](docs/specs/2026-06-09-slice-0-4-auth-rbac-provisioning-design.md); ADR-0073): backend + API only (auth UI + design-system bootstrap deliberately split into their own later slice). Better Auth on control-plane D1 via the Drizzle adapter with `firm_id` as an additional user field joined to the firm registry (organization plugin rejected — it would centralize membership join tables the tenancy model keeps per-firm); **invitation-only membership** (no open signup) so every user creation rides the idempotent write path; factors = email/password + **TOTP** (fully exercisable API-only; seeds under Better Auth's built-in encryption until `protected()` lands), **passkeys deferred to the auth UI slice** (WebAuthn ceremonies require a browser — wiring them now would land dead surface); the per-firm `member` mirror syncs through a new **control-plane `outbox` + `idempotency_key` pair** reusing the slice 0·2 machinery; the RBAC skeleton lands as the pure **`@magna-carta/access-control`** package (static permission registry + `effectivePermissions` resolver, consumed by the slice 0·5 chokepoint); **firm provisioning** is an idempotent, resumable orchestration behind a `FirmResourceProvider` port (dev adapter claims pre-declared Miniflare bindings; Cloudflare REST adapter creates real D1/R2, the new binding accepted as config-commit + deploy for a fleet of one); plus the worker cron wiring (relay sweeps, TTL purge) slice 0·2 deferred. Routes (`POST /v1/firms`, `POST /v1/members`, `GET /v1/me`) dogfood the API contract conventions.
- **Append-only ledger core + fixtures harness — designed (slice 0·3)** (ADR-0072; spec [`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`](docs/specs/2026-06-09-ledger-core-and-fixtures-design.md)): the double-entry ledger's posting model, decided. **Line encoding = direction + always-positive amount** (`direction 'debit'|'credit'` + `amount_minor CHECK (> 0)` — chosen over signed and two-column encodings because it structurally eliminates the silent sign-flip, the bug class where a flipped sign still balances); a **structural account model** (type with code-derived normal balance, single currency inherited by lines, parent/subledger seam, soft-close — no CoA product until Phase 3); **materialized per-account balances in normal-balance terms with nullable min/max bounds and a CHECK** — a failed CHECK being D1's only batch-abort mechanism, so Phase-3 trust sets `min = 0` and an overdraw rolls back the entire posting atomically, zero write-path retrofit (ADR-0009 ready); **dual entry dates by kind** (backdatable civil `effective_date` + immutable UTC `recorded_at`; the gap is audit signal; no future-dating); **first-class reversals** (`reverses_entry_id` UNIQUE FK, mirror entries, status derived from the link — double-reversal impossible under race); validation scoped to **ledger invariants only** (balanced ≥ 2-line single-currency entries, active leaf accounts, non-empty description) with consumer rules deferred to named seams. Realized as **`@magna-carta/ledger`** (the first domain package: validate in memory → compose statements into the slice-0·2 `composeEffectBatch` chokepoint; `postEntry`/`reverseEntry`/`createAccount`; outbox `ledger.entry.posted`) and **`@magna-carta/fixtures`** (one seed → `FixtureContext`: seeded faker + fixed clock + the ADR-0062 seeded identifier source, byte-identical replay; factories call the domain services directly — the canonical write path forever, HTTP later just another caller; named scenarios `retainerDeposit`/`trustCorrection`/`boundsRejection`/`multiLineSettlement` with baked-in assertions doubling as write-path integration tests; a demo CoA explicitly bounded as demo-only; production seeding structurally guarded).

- **Phase 0 API spike — contract toolchain validated end-to-end** (ADR-0066/ADR-0067, both decided 2026-06-04; conventions now written in [`docs/conventions/api.md`](docs/conventions/api.md)): the spike found the library comparison already resolved by ADR-0066, so it validated the decided stack empirically instead — a 9-test guard suite (`apps/worker/test/api-contract-spike.test.ts`) proves `@hono/zod-openapi` 1.4.0 + zod 4.4.3 emit a correct OpenAPI 3.1 document (named-component `$ref`s via `.openapi("Name")`, `x-mc-*` route-metadata extension passthrough for the ADR-0067 fitness functions, discriminated unions / branded identifier strings / `z.iso.datetime()` JSON-Schema emission, and `defaultHook` mapping Zod failures to RFC 9457 `422 application/problem+json` with field-level `errors[]`); Hey API 0.98.2 generated the typed client + `@tanstack/svelte-query` `queryOptions`/query-key factories from that document, and Spectral linted it clean (0 errors). Binding findings for slice 0·5: the OpenAPI-native `operationId` must be set (not only `x-mc-operationId`) or SDK method names fall back to path-derived; Spectral's default ruleset wants `servers`/`info`/operation `tags`+`description` populated at emission; Hey API config must be a plain-object file (its jiti loader cannot resolve the `defineConfig` import). The suite stays in the tree as a regression guard for library bumps.

- **`@magna-carta/money` — foundational money package (slice 0·2, package 1 of 4)** (ADR-0061 amended, ADR-0071; spec [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md) §1): branded `Money`/`Rate`/`Ratio` types over Dinero.js v2's default **number calculator** (JS safe-integer amounts; `Dinero<bigint>` superseded — broken in 2.0.2 for multiply/allocate/toDecimal); named rounding helpers encoding intent at every boundary (`roundTax` half-up, `roundInvoiceLine` half-away-from-zero so a credit/discount line rounds to the same magnitude as the charge, `roundLedger` banker's half-even, `allocate` largest-remainder); arithmetic (`add`/`subtract`/`multiplyByQuantity`/`percentOf`) that returns a branded `Intermediate` for high-precision products, which the compiler forces you to round before it can be read as cents or added to `Money`; comparison + sign predicates (`equal`/`compare`/`lessThan`/`greaterThan`/`isZero`/`isNegative`/`isPositive`/`minimum`/`maximum`) for the ledger and trust invariants; aggregation/convenience (`sum`/`zero`/`negate`/`abs`) and `fromDecimal` for the human-input boundary; `format` via `Intl.NumberFormat` with explicit currency, fed the **exact decimal string** (a float pass would misprint cents near the 2^53 ceiling) through one memoized formatter per currency; DB-boundary `toMinor`/`fromMinor`; safe-integer guards at the constructor and rounding boundaries (`ratio` validated at construction too; `negate(zero)` can never emit `-0`); all arithmetic behind a swappable single-file seam (`src/dinero.ts`) so a future decimal.js custom calculator is a one-file change; differential-tested against decimal.js (including the multiply/round path) plus scenario fixtures (contingency split, payment application, tax on a cost); 45 tests pass. Package-layout decision recorded as ADR-0071 (four packages on the structure-vs-access seam: `money`, `identifiers`, `database`, `data-access`; acyclic dependency graph `data-access → database → identifiers`, `data-access → money`).
- **`@magna-carta/identifiers` — foundational identifier package (slice 0·2, package 2 of 4)** (ADR-0062, ADR-0071; spec [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md) §2): one opaque, **type-prefixed, CSPRNG-random, URL-safe handle per row** (`mat_…`/`doc_…`/`usr_…` — a 21-char nanoid token ≈ 126 bits) that is **both the D1 primary key and the public id**, purely random and never time-encoded (UUIDv7/ULID rejected for leaking creation time); branded `Identifier<T>` id types derived from the entity literal so `MatterId` ≠ `DocumentId` at compile time yet erase to plain strings at runtime (a branded id flows into a `string`, but a raw `string` is not a branded id without validation — enforced by negative-compile assertions the gate checks); a declarative **prefix registry** as the single source of truth (entity type → prefix); `newIdentifier(type, randomSource?)` with a CSPRNG default and an injectable **seeded random source** (`seededRandomSource(string | number)`) for byte-deterministic fixtures; `generateUniqueIdentifier(type, tryInsert, …)` — the **bounded UNIQUE-insert retry idiom** (ADR-0062) that idempotency and the outbox reuse, with the DB insert supplied as a callback so the loop stays pure and DB-agnostic (only a `false` return signals a collision; a thrown database error is fatal and propagates un-retried); `isIdentifier`/`assertIdentifier` boundary narrowing that turns an untrusted `string` into a branded id or rejects a malformed/wrong-prefix one; all behind a **swappable single-file seam** over nanoid (a fitness test asserts only the seam imports nanoid, plus an alphabet-sync guard against validator drift); the default-source token generator is built once at module load (hot-path row inserts skip nanoid's per-construction setup); 29 tests pass.
- **`@magna-carta/database` — foundational database package (slice 0·2, package 3 of 4)** (ADR-0065, ADR-0071; spec [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md) §5; plan [`docs/specs/2026-06-09-database-package-implementation-plan.md`](docs/specs/2026-06-09-database-package-implementation-plan.md)): how the database is **defined & evolved**. **Two-lineage Drizzle schemas** as the single source of truth for types and migrations — `control-plane` (the `firm` registry: firm\_ handle primary key, backing-D1 identifier, and a `per_firm_schema_version` mirror column for fleet-wide visibility) and `per-firm` (`idempotency_key` per ADR-0063 with the UNIQUE(key) concurrency guard; `outbox` per ADR-0064 with the relay-sweep index) — each with its own drizzle-kit config and committed initial migration. A **journal loader** turns drizzle-kit's generated `_journal.json` + SQL into plain-data migrations (Workers have no filesystem; statements split on `--> statement-breakpoint`). The **migration runner** applies pending migrations in journal order, idempotently, failing loud on a deploy mismatch (database knows a migration the code doesn't); the **D1 adapter** applies each migration's statements plus its `_migrations` record in **one `batch()` call** — D1's only atomic primitive (D1 rejects `BEGIN`; drizzle's `db.transaction()` is unusable there). The **fleet rollout orchestrator** skips current firms via the registry mirror, fans out with bounded concurrency, quarantines failing firms while the fleet continues, resumes idempotently, and reports — exercised as a fleet of one. **Fitness functions:** every table's primary key is a TEXT identifier handle (ADR-0062); no `REAL` columns and `*_minor`/`*_rate_e4` must be INTEGER (ADR-0061); destructive migration SQL (DROP TABLE/COLUMN, ADD COLUMN NOT NULL without DEFAULT) fails CI unless explicitly annotated `-- contract:` (expand-contract discipline). Pinned to stable drizzle (orm 0.45.2 / kit 0.31.10, deliberately not the 1.0 RC — the journal format the loader consumes changes there). 32 tests pass. Cron-Workflow wiring and lazy catch-up land with `apps/worker`/`data-access`.
- **`@magna-carta/data-access` — foundational data-access package (slice 0·2, package 4 of 4 — slice complete)** (ADR-0063 amended, ADR-0064 amended, ADR-0071; spec [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md) §3–§4; plan [`docs/specs/2026-06-09-data-access-package-implementation-plan.md`](docs/specs/2026-06-09-data-access-package-implementation-plan.md)): how the database is **safely reached**. The load-bearing realization: D1 has **no interactive transactions** (`BEGIN` rejected; the Sessions API is read-replication consistency only), so the ADR-0063/0064 "same D1 transaction" guarantee is delivered as **one atomic `batch()`** — pre-check `SELECT` (fast replay / 409 / 422), **speculative** handler effect (statements + outbox messages, committing nothing; safe because external effects only ever go through the outbox), then a single batch ordered `[INSERT completed idempotency record, …business statements, outbox rows]`. The record's UNIQUE(key) is the concurrency guard: a racing duplicate's whole batch rolls back and it replays the winner's stored response (stored **failures** replay too — a retry never silently re-runs). Ships: canonical-JSON request **fingerprinting** (SHA-256; endpoint included so cross-endpoint key reuse trips 422), the **decision table**, **statement builders** (idempotency record, TTL purge, outbox insert with per-aggregate `seq` computed in-SQL via a `MAX(seq)+1` subselect), the **`composeEffectBatch` chokepoint** (the one place a write batch is assembled), **`runIdempotentEffect`** (the orchestration incl. the conflict-replay race path), the **outbox relay sweep** (publish-**then**-mark for at-least-once, per-row failure isolation, attempts + dead-letter at max), and the **Hono idempotency middleware** (`required`/`optional` per route; 400 missing-header, replay with `Idempotency-Replayed: true`, 409/422 short-circuits via one shared kind→HTTP mapping). Post-review hardening: the fingerprint includes the **canonically-sorted query string** (two requests differing only in query no longer collide — a confirmed wrong-replay bug); relay status transitions are **guarded** (`AND status = 'pending'` + `meta.changes`) so overlapping sweeps can never flip a failed row to dispatched (silent message loss) or double-fire the dead-letter callback; the middleware reads the body through hono's cached `req.json()` (handlers must read via `HonoRequest`, never `req.raw`); a thrown effect is pinned as fatal-with-nothing-committed (retry re-executes — only stored failure responses replay); and the seq subselect's in-transaction visibility is proven against **real SQLite** (`node:sqlite`) with the production SQL. A schema-name-sync fitness test pins the SQL to `@magna-carta/database`'s drizzle schemas (drizzle stays dev-only). 48 tests pass. Deferred to `apps/worker` slices: route-registry conformance, the outbox-chokepoint source scan, Queue consumers, Cron/relay-DO/TTL wiring.
- **Phase 0 slice 0·1 — walking skeleton** (spec [`docs/specs/`](docs/specs/); ADR-0069, ADR-0070): monorepo (`apps/web` SvelteKit SPA + `apps/worker` Hono `@hono/zod-openapi` Worker + `packages/tsconfig`) on the `vp` toolchain with pnpm catalog version pinning; one Cloudflare Worker serves the SPA as Workers Static Assets and owns `/api/*`; `GET /api/health` proves SPA → same-origin `/api` → Hono → control-plane D1 (`SELECT 1`); `/api/openapi.json` emits an OpenAPI 3.1 doc; Miniflare integration test passes; CI (`.github/workflows/ci.yml`) runs `pnpm check` + Vitest + build + `wrangler deploy --dry-run`.
- **Foundational data & runtime conventions — money, identifiers, idempotency, transactional outbox, fleet migration** (white paper _Foundational data & runtime conventions_ §9.3–9.7; spec [`docs/specs/2026-06-04-foundational-data-conventions-design.md`](docs/specs/2026-06-04-foundational-data-conventions-design.md); ADR-0061–0065): the five remaining §9 members, all decided. **Money (ADR-0061):** integer minor units at two fixed scales (**amounts 2dp / rates 4dp**), ISO-4217 currency-tagged **USD-only, no FX**; arithmetic via **Dinero.js v2 (`Dinero<bigint>`) behind a thin in-house `money` seam** (swappable, so a later Rust→WASM ledger core touches no stored row); **rounding named per boundary** — half-up for tax (SSUTA §324, Nevada is a member) and invoice lines, banker's/half-even for GL, largest-remainder for splits; floats forbidden by a fitness function. **Identifiers (ADR-0062):** one **opaque, type-prefixed, CSPRNG-random, URL-safe handle per row that is also its primary key** (`mat_…`/`doc_…`/`usr_…`), **purely random — never time-encoded** (UUIDv7/ULID rejected for leaking creation time), ~126-bit guess-resistant, **UNIQUE + retry** for guaranteed non-overlap, **branded TS id types**, seeded-PRNG in fixtures; the integer-PK-plus-handle split rejected at per-firm scale. **Idempotency (ADR-0063):** client-generated **IETF `Idempotency-Key`** with Stripe semantics, **atomic dedup via a UNIQUE idempotency-row insert committed in the same D1 transaction as the effect** (the UNIQUE key _is_ the concurrency guard — exactly-once with no lock), chokepoint-enforced and **required on money/trust/payment/comms routes**, processor pass-through, ~24h TTL. **Transactional outbox (ADR-0064):** the effect is written to an `outbox` row **in the same D1 transaction** as the business change (D1 has no cross-system transactions), a **Cron-Workflow relay** (DO-poke latency seam) publishes to **at-least-once Cloudflare Queues**, **idempotent consumers**, dead-letter on max attempts; emitting an effect is a chokepoint, multi-step flows compose as **sagas via Workflows**. **Fleet migration (ADR-0065):** **Drizzle + drizzle-kit** as the single TS source of truth for types _and_ migrations (under the firm-scoped DAL), a **Cron-Workflow rollout orchestrator** across the per-firm-D1 fleet with **control-plane version tracking, per-firm failure isolation, eager + lazy application, and expand-contract zero-downtime discipline** — built now though one firm runs it as a fleet of one. Together: identifiers supply the UNIQUE-insert idiom idempotency and the outbox reuse; idempotency + outbox give **effectively-once** effects; all are enforced by DAL chokepoints + coherence fitness functions and exercised through the write-path fixtures.
- **Notifications subsystem** (white paper _Notifications_; ADR-0059): a first-class orchestration layer that **separates the decision from the delivery** — a declarative **notification-type registry** (`key`/`category`, internal-`member`/external-_Directory_ **audience**, severity, mandatory-vs-opt-out, eligible channels + channel-aware templates + cadence, audited) owns _who hears what, on which channel, whether they want it, and whether it is read_, while the **Communications layer becomes pure channel transport the engine drives** (ADR-0047 amended). Gives the scattered triggers one home — deadline/payment/report-ready reminders, task assignment + escalation, docketing reminders, job-completion, safe-custody release reminders, conflicts hits, portal activity, and diagnostics acknowledgements all become **notification types**. **Per-recipient routing** is a _Settings_ My-Account category (user → firm → system) with **security/trust-compliance categories non-silenceable** and external routing gated by **STOP/HELP + TCPA** state. **Delivery is always durable** (a per-firm D1 row of IDs + non-sensitive fields + a canonical deep-link — never privileged content); v1 channels = the **in-app notification center ("the bell") + email/SMS via the Comms ports**, with **web push, desktop-native/tray, and digest rollup as seams**. **Realtime stays deliberately minimal** (honors ADR-0054): refetch-on-focus + cross-tab BroadcastChannel + a cheap unread-count poll, with **job-completion riding the existing per-job Durable Object channel** and a **per-user DO push channel as the documented seam**. Events raise through one **`notify()` port co-located with existing seams** (money/sensitive raises ride the audit-log write), fan out **off the hot path** via Queues, and **scheduled reminders** are materialized by a Cron-Workflow in the court's zone. Confidentiality inherits the observability discipline — external channels carry no privileged content, in-app **re-checks access at read time** (404-not-403). Rejected: folding into the Communications layer, an in-app-center-only build, building the global server-push layer now, and embedding content in notifications.
- **Docs-maintenance agent** added to the _Maintenance agents_ family (white paper _Maintenance agents_; `documentation.md`; ADR-0058): a **propose-only** agent scoped to **mechanical drafting** (draft `[Unreleased]` changelog entries from merged PRs; roll roadmap status up from the changelog — the work ADR-0016 named only in passing, now first-class) and **docs-coverage-gap flagging** (a user-visible PR with no `docs/user/` guide, a design change with no ADR, a dangling `ADR-NNNN` reference). It **never authors design narrative or user-guide prose** (that ships **in-commit** with the change, preserving version-accuracy-by-construction) and never auto-merges. **Deterministic doc hygiene stays in CI (`vp check`), not the agent** — the cross-reference rule (`§N` from outside the white paper), dead links, and an empty-`[Unreleased]`-on-a-user-facing-PR gate are lint rules; the agent carries only the judgment-bearing residue (the LLM-as-fitness-function pattern of ADR-0051). Rejected: a _docs-authoring agent_ (breaks docs-in-commit) and a _maximal docs auditor_ doing cross-reference integrity itself (belongs in CI).
- **Durability on close / graceful shutdown** convention (white paper _Foundational data & runtime conventions_ → _Durability on close / graceful shutdown_, ADR-0057): **no close is trusted to be graceful** — "losing data on close" is reduced to one class, **client-held state the server has not yet durably accepted**, and engineered away _before_ the close across all four surfaces (web tab/window close, desktop quit, server Workers/DO lifecycle, logout). **Prevent → loud → discipline:** loss made **impossible** (acknowledged-write source of truth + idempotency keys + transactional outbox + the **on-disk desktop outbound queue** surviving quit/crash + **DO durable storage** for the live timer and job orchestration + at-least-once idempotent Queues + checkpointed local jobs), then **loud** (a `beforeunload`/`visibilitychange` and Tauri `close-requested` guard that flushes-then-warns, plus **editor/form autosave as server-side drafts**), with logout's cache-clear **gated on the outbound queue draining**. Shutdown hooks are best-effort UX only, never the correctness mechanism (must survive `kill -9` / power loss); enforced by a single shared client guard primitive + a coherence fitness function asserting DO/job state lives in durable storage. Flush/checkpoint/autosave intervals deferred to the build (same seam as the performance model). Rejected: _shutdown-hook-as-durability_, _warn-only with no durable queue_, and _a full local-first sync engine_ (already rejected platform-wide in ADR-0054).
- **Telemetry analytics tier** evaluated and deferred (white paper _Observability and diagnostics_ → _Telemetry analytics tier_, ADR-0056): **Analytics Engine stays the MVP telemetry-query path**; **R2 Data Catalog** (managed Apache **Iceberg** on R2, zero-egress, with **compaction** + snapshot-expiration maintenance) is recorded as the **designed-but-unbuilt analytics tier** — register the redacted Logpush logs **already landing in R2** as Iceberg tables, queryable by DuckDB/Spark/BI. Scope is **redacted cross-firm aggregate telemetry only** (clear of the per-firm isolation boundary). **Adopt-when triggers:** retention past ~92 days, exact/unsampled counts, rich joins / external engines, or cost-at-scale on existing Logpush-in-R2. Beta limits (Parquet-only, ~2 GB/table/hr, orphan-file cleanup not yet automated) flagged verify-before-build; reuses the Cron-Workflow → per-firm R2 fan-out (ADR-0050). Rejected: _adopt now_ (premature) and _reject outright_ (forfeits a cheap, aligned seam).
- **URL & navigation architecture** (white paper _Delivery model_; ADR-0052): deep-linkable permalinks where the **canonical URL is the matter number by default** (`/matters/8181-3`) — **firm-configurable** (opaque selectable for max confidentiality; per-matter **force-opaque** for sealed matters), with an **immutable opaque handle underneath** plus **prior-number redirect aliases** so renumber/rename never breaks a link, and matter numbers constrained to **URL-safe characters**; entities without a human number (documents, contacts, events) stay opaque. **Firm resolved from the session, never the URL**; host split — `app.` (staff SPA, same-origin `/api` cookie auth), **`api.` reserved** (public/SDK OpenAPI, token auth), `portal.` (client portal), `magnacarta.esq`/`www` (public); **path = addressable state, query = ephemeral**; **tabs nest, entities stay flat** (the last identifier resolves; stale parents/superseded numbers 301 to canonical); a **reserved route-namespace list**; **`Referrer-Policy: same-origin`**; and **server-side-only access enforcement** — SPA guards are UX, every request runs session→firm→RBAC/ethical-walls, a cross-firm matter hits a separate D1 → **404** (no cross-DB path), and unauthorized-but-existing resources return **404 not 403** (no existence oracle; numbers are enumerable but that grants nothing). Name/caption slugs and per-firm vanity subdomains rejected; white-label custom-domain seam deferred.
- **Database backup & disaster recovery** (white paper _Tenancy and data isolation_ → _Database backup & disaster recovery_, ADR-0050): two layers — **D1 Time Travel** (free, always-on, 30-day point-in-time recovery) as operational undo, and **export snapshots** via a Cron-triggered Workflow that calls the D1 export REST API per database and streams each SQL dump into **that firm's own R2 bucket** (control-plane DB included). **GFS ~7+ yr retention** (daily→30d, weekly→1yr, monthly/yearly→7+yr) with aged snapshots **tiered to IA**, and **R2 bucket-lock immutability** blocking premature deletion. Stays **on Cloudflare in one account** (separate backup account declined); an **off-Cloudflare export seam is designed-but-deferred** for the residual catastrophe / certified-WORM tail. Backups inherit per-firm isolation + at-rest encryption; `protected()` ciphertext stays encrypted in the dump so crypto-shred still applies. Rejected: _Time Travel only_ (no DR past 30 days).
- **Deleted-file storage lifecycle** (white paper _Document versioning & storage tiering_, ADR-0049): deletion is a soft-delete, then the R2 object moves **trash (Standard, 30-day recoverable) → Infrequent Access (cold retention, same `CopyObject` path as version tiering) → policy-driven hard-delete** at a per-record retention/destruction date — **blocked by any legal/discovery/safe-custody hold** and audited. The destroy machinery is built but **retention defaults to indefinite** (keep-by-default), giving a per-matter/jurisdiction switch for bar-rule / client-purge / GDPR-CCPA erasure obligations without re-architecture. Cost-checked at single-firm and 1,000-firm × 5 TB scale (IA ~33% cheaper, ~$300k/yr platform saving on the cold segment). Rejected: _never destroy_ (unbounded cost/exposure — kept only as the default behavior) and _hard-delete with no IA archive_. D1 backup/snapshot strategy is the still-open second half of this design.
- **Product updates surface** captured: in-app + public access to the changelog, release notes, and roadmap, plus a live known-issues / service-status banner. Architecture decided — **bundle the versioned content** (changelog/release-notes/roadmap derived from `CHANGELOG.md`/`ROADMAP.md` into a `product-updates.json` static asset, version-accurate + offline-native) and **centralize only the live status** in control-plane KV (admin/agent-written, no deploy); public pages render from the same artifact (transparency, no dependency on the deferred forum tool); a single system-of-record per content type, with the _Community & feedback forum_ integrated by seams (SSO, vote-count enrichment, escalation bridge) rather than duplicated (white paper _Product updates_; ADR-0048).
- **Communications layer expanded to messaging + voice** (white paper _Communications layer_ / _Plugin / Add-on system_ / _Client intake / CRM_, ADR-0047): new `messaging` (SMS/MMS/RCS) and `telephony` plugin ports behind a swappable CPaaS, **Telnyx as the launch adapter** (own IP network, RCS, bidirectional media streaming, Ed25519 webhooks), with Twilio/Bandwidth/Plivo as swappable alternates. Consumers: outbound notifications, the SMS 2FA factor, e-signature/portal access codes, **two-way client texting** (promoted out of the competitive backlog), and a **receptionist call-intake** workflow. **Transcription is in-house on Cloudflare Workers AI** (Whisper/Deepgram), so privileged call audio never egresses; OTP stays in Better Auth (no vendor "Verify"). Compliance (A2P 10DLC/RCS-brand registration, TCPA opt-out, call-recording consent via the existing jurisdiction-profile machinery, E911 seam) lives in the ports. Self-hosted SMPP gateway (Jasmin) rejected, kept as documented fallback.
- **Community & feedback forum** captured as a wanted feature (public discussion, feature voting, known issues, tied to bug reporting + docs) — white paper §27, ADR-0044 (_Proposed_: delivery tool deferred, leaning self-hosted Fider; per-tracked-user tools like Canny rejected).
- **GitHub** as source control & code management + **GitHub Actions** for CI/CD (deploy to Cloudflare via Wrangler) — white paper §28, ADR-0043.
- **Technology stack summary** at the top of the white paper — a consolidated index of every language, library, and service, each pointing to the section that decides it.
- **Testing layers & tooling** (white paper §28, `testing.md`, ADR-0041): Vite+ integrated testing for unit + Svelte component (behavior) tests, Playwright for e2e + visual regression over the Storybook/Histoire catalog, integration via Miniflare, write-path fixtures for data. A component is covered by catalog entry + behavior tests + visual-regression.
- **Performance & concurrency model** (white paper §25, `performance.md`, ADR-0039): a foundational compute-placement model (work goes in the right tier — Workers/Containers/Queues/Durable Objects/Rust core/Web Workers/Tauri), resource discipline (stream, no-N+1, bounded memory), and a measure-first profiling discipline using the load-profile fixtures. Added as a golden rule; vertical-slice delivery made explicit.
- **Settings & configuration framework** (white paper §26, `settings.md`, ADR-0040): a declarative settings registry that generates the Settings UI, with scope resolution (entity → user → location → firm → system), per-setting RBAC view/edit access enforced in the DAL, and storage that surfaces existing subsystem data without copying it.
- Error logging & user-driven diagnostics method (white paper _Observability & diagnostics_, `error-logging.md`, ADR-0038): an in-house, Cloudflare-native pipeline with a one-click "send to developer" / "report a problem" flow, firm-scoped incidents, a propose-only diagnostics agent (triage → root-cause → draft PR → acknowledge), and a configurable diagnostics setting (off/standard/verbose-auto, the latter being the beta posture).
- Documentation tooling: `vp run decisions-build` / `vp run changelog-build` assemble per-entry ADR and changelog fragments on `main`, so parallel worktrees no longer collide on the register or `CHANGELOG.md`. ADRs became a directory of per-file records (`docs/decisions/`) numbered at merge; the Decision-Log register is generated.
- Worktree coordination: `vp run worktrees` prints the active-work registry — concurrent streams from `git worktree list` merged with per-stream `docs/active-work/<branch>.md` notes, plus declared touch-overlaps and each stream's drift from `main`. New `CLAUDE.md` conventions cover making a stream visible, a `main`-sync cadence, and the worktree/branch lifecycle.
- **Product-usage analytics (opt-out)** — `reached`/`completed` usage events on the one telemetry path, gated by a per-firm `usage_analytics.enabled` (default true) plus a per-user `member.opted_out_of_usage_analytics` override resolved off the hot path; content-free `{ feature, phase, surface }` from a versioned feature taxonomy, with HMAC-pseudonymous identifiers that fail closed on a missing pepper. Server-side `reached` is wired in a route→feature outbound-pass middleware and `completed` from the outbox sweep (topic→feature, firm-level); live counts flow through the Analytics Engine `usage` dataset, cross-firm aggregate only with small-n (k=5) suppression. The R2 Data Catalog Iceberg tier (Logpush→Pipelines) for full-fidelity retention/BI and the client beacon for pure-client surfaces are documented, deferred seams. Design: [`docs/specs/2026-06-18-usage-analytics-design.md`](docs/specs/2026-06-18-usage-analytics-design.md).
- **AI inference foundation (`@magna-carta/inference`)** (spec [`docs/specs/2026-06-17-ai-inference-foundation-design.md`](docs/specs/2026-06-17-ai-inference-foundation-design.md)): the credential-less AI-Gateway-backed model chokepoint every future AI feature reaches the model through — backend plumbing only; no UI; the first AI feature and the BYOK adapter are later slices. **`@magna-carta/inference`** (new pure package): the `InferencePort` interface with streaming (token-stream async iterator for interactive first-token-latency paths) and durable (Cloudflare-Workflow-invocable, per-step contract) text-generation result shapes, plus the platform-fixed embedding operation whose model argument is absent by design (a firm-swappable embedding model would invalidate the Vectorize index — the type enforces this); typed `Dispatch` outcomes (`ok` / `adapterError`) and a normalized `IntegrationProblem` taxonomy with a caller-safe `detail`, never a spliced upstream body. The curated ZDR-eligible model catalog (`src/catalog.ts`): every entry carries `slot` / `modelId` (gateway-routable, provider-prefixed) / `snapshotId` (pinned for reproducibility) / `referenceId` / `zdrEligible` / `noTrainingEligible` / `verifiedOn`; validated at module load via a zod `safeParse` — a malformed entry or a non-ZDR reasoning entry fails loud at import; `claude-fable-5` excluded (mandates 30-day retention; non-ZDR). The per-firm reasoning-model setting (`src/settings.ts`): `primaryReasoningModelDefinition` stores the firm's selected reasoning model in the per-firm `setting` table via a `FirmSettingDefinition` whose schema is a refinement over the ZDR-eligible reasoning subset — an off-catalog or non-ZDR model id is rejected at the write path; reads are total (default on missing/invalid/unparseable). `aiProcessingEligibilityDefinition` is the firm-level eligibility seam (per-matter enforcement, consent UI, and content minimization are the first AI feature's scope). The AI-Gateway-backed implementation (`src/gateway.ts`): reaches the model only through the authenticated Worker `AI` binding; pins `skipCache: true` (caching off — no firm-dimension in the default cache key, cross-firm cache collision risk), `collectLog: false` (logging off — the binding toggle is all-or-nothing, no payload-only middle ground), and derived firm metadata (`firm_id` opaque, ≤5 keys, no `model` tag, never client/matter text) on every request via the binding's `gateway` options object (not `cf-aig-*` headers, which the binding does not read); the fail-closed per-request ZDR guard asserts the selected model is `zdrEligible` before dispatch and rejects with a non-retryable `validation` problem on a miss — it never silently downgrades; authoritative token usage is read from the inference response, never the logs. **`@magna-carta/data-access`** gains the per-firm token-usage metering read/write surface (`src/token-usage-statements.ts` + `./token-usage-statements` subpath export). **`@magna-carta/database`** gains the `token_usage_meter` per-firm table and migration `0014_inference-token-usage`. **`apps/worker`** gains the AI binding + `INFERENCE` Queue binding on `Bindings`, the firm-scoped call-site helper (`src/inference/call-site.ts` — reads the firm's model through the firm-scoped data-access layer and constructs the port), and the off-hot-path Queue consumer (`src/background/inference/inference-consumer.ts`) with the `firmRateGate(firm_id)` pass-through seam sited between dequeue and `env.AI.run` (the per-firm token-bucket machinery drops in behind this hook without touching `InferencePort` or any call site, built when measured) and the firm-isolated metering write through the firm-scoped data-access layer. The BYOK credentialed adapter seam is documented and deferred — built when a firm attestation requires it or the shared rate cap is measured-binding. Load-profile extension for the token-usage table is deferred to the first AI feature (volume-shaped only once a feature drives traffic). The client-consent model (ADR-ai-inference-client-consent) is Proposed — owner decision required before the first AI feature ships.
- **Slice 1·4 backend built — the shared custom-fields engine** (spec [`docs/specs/2026-06-18-slice-1-4-custom-fields-design.md`](docs/specs/2026-06-18-slice-1-4-custom-fields-design.md); backend plan [`docs/specs/2026-06-18-slice-1-4-backend-implementation-plan.md`](docs/specs/2026-06-18-slice-1-4-backend-implementation-plan.md)): the 17-task backend, backend + API only. **`@magna-carta/custom-fields`** — a new sibling domain package on the slice-0·2 atomic-batch pattern (validates in memory, composes statements for the caller to run, holds no D1 binding): the typed entity-attribute-value engine for matter types (1·1) and entity categories (1·3). **Identity is a stable `customField_` handle, never the label** — values, picks, and reads all bind by handle, so a rename is a one-column UPDATE that never breaks a stored value. **Three per-firm tables (migration `0013_custom-fields`):** `custom_field` definitions (the Clio-12 kind catalog — checkbox/date/time/number/currency/picklist/single-line/multi-line/url/email/matter-reference/contact-reference; `target` matter|entity; optional `attachment_id`; `number_scale`; `required`/`archived`/`converting` flags; the reserved `template_field_key` seam), `picklist_option` rows, and `custom_field_value` with five typed value columns under a CHECK that **exactly one is non-null** (reference kinds get a real indexed `value_reference_id` column), `is_current`/`valid_from`/`valid_to` temporal columns, and a **one-current partial unique index** `(target_row_id, field_id) WHERE is_current = 1`. **Value history is append-and-flip** (the directory pattern): a set flips the prior current row to history and inserts a new current row in one batch; a clear flips and inserts nothing — the full history endures, so clear and Convert are reversible. **Retype is a non-destructive guided Convert** (`previewConvert` counts each value clean/needs-a-rule/parked without writing; `applyConvert` flips every original to history, gives clean values a coerced current row, and leaves parked values cleared — no data loss; `CONVERT_INLINE_VALUE_LIMIT` is the calibrated inline-vs-Queue ceiling, the bulk offload a forward seam). **Currency/number scaling happens at the route** — `value_number` stores an integer in minor units, the route scales the inbound decimal by the field's `number_scale` (falling back to the money minor-unit scale for currency). **Lifecycle & governance:** archive-first (retire-but-keep-readable), a hard-delete that **refuses a field with values** (`field-in-use` → 409) and only deletes an unused field with its options, the load-profile-calibrated anti-bloat caps (`MAX_FIELDS_PER_SCOPE`/`MAX_FIELDS_PER_FIRM`/`MAX_OPTIONS_PER_FIELD`, named codes), and a separate gated, audited **Purge** erasure seam that refuses until its executing pass is built. **Reference-kind values stay whole through directory merge** — the directory's `mergeEntities` gained two `custom_field_value` `REPOINT_TARGETS` (in `packages/directory/src/merge.ts`): a value POINTING AT the subordinate repoints `value_reference_id` → master, and a value OWNED BY the subordinate repoints `target_row_id` → master with a new **`onCollision: archive-to-history`** mode — on a same-field collision the loser is moved onto the master and flipped to history (field-level survivorship) rather than discarded, the relink CI-guarded against dangling pointers. **20 `/api/v1/custom-fields` worker routes** through the 0·5 chokepoint — field define/rename/required/reorder/archive/unarchive/hard-delete/purge/resolve, convert preview+apply, picklist-option create/rename/reorder/archive/hard-delete, value set/clear, and the record-values/history reads — all mutations behind `customFields:manage` with idempotency, reads open to any firm member, `CustomFieldError.code` mapped to RFC 9457 problems at the route. **Load-profile extended (`ledgerVolume-v6`):** custom-field definitions + typed values + reference-kind columns seeded at volume. **Fitness + e2e:** `assertCustomFieldFitness` per-invariant probes; a worker end-to-end suite drives the whole lifecycle over the real HTTP surface (define a picklist + a contact-reference field → set values on a matter and on directory contacts → rename keeps the binding by handle → Convert to currency with a parked value keeps the original in history and flips the kind → merge repoints the contact-reference and survivorship-absorbs the owned value while the merged alias still resolves → archive keeps values readable → hard-delete-with-values refused 409). Per-package `CLAUDE.md` for `@magna-carta/custom-fields`. **Built by Opus 4.8; the full worker suite + the `@magna-carta/custom-fields` and `@magna-carta/fixtures` package suites + `lint:process-refs` + package-scoped `vp check` green (the repo-wide `pnpm check` OOMs in the formatter on this machine, so the gate ran package-scoped). Fable 5 re-review pending per the model-split policy.** UI plan + owner manual-verification checklist follow once 0·7a/0·7b land (the 1·1/1·3 precedent).
- **Access-triggered re-scan + content-dedup skip + informed access** (design [`docs/specs/2026-06-22-access-triggered-rescan-design.md`](docs/specs/2026-06-22-access-triggered-rescan-design.md)): the per-firm dedup cache (`scan_cache`) gains a reader, and committed files are re-scanned **when they are accessed** — not by a proactive sweep — so a file nobody opens is never re-scanned (it can't harm anyone until accessed) and cost tracks attention, not corpus size. A `/download` or `/preview` enqueues a background re-scan **only if** the served version's recorded engine version is stale vs the firm's current engine (a per-firm `fileManager.scanEngineVersion` setting, stamped automatically by each real clean scan); the consumer's new in-place re-scan branch is **cache-first** (identical content already scanned under the current engine reuses the verdict with no engine call) and stamps the verdict on the committed version **without moving the current-version pointer** (idempotent on `rescan:<versionId>:<engineVersion>`). **Never-silent-clean holds:** an unset engine version or a non-definitive engine result never fabricates or downgrades a verdict. **Informed access (no data loss):** a re-scan that finds an already-visible version `infected` leaves it listed (no hide, no version-regress) — a raw `/download` is gated `409` until the member acknowledges the risk (`?acknowledgeMalware=true`), which proceeds and is audited as `file.downloaded_malware_acknowledged`; a fresh finding emits a `file.rescan_infected` notification (once per version per engine). The proactive weekly re-scan sweep is removed (superseded). `security.md` amended (the accepted, mitigated deviation from hard-quarantine, for firm-controlled evidence). **Fast-follows (deferred):** the safe-preview rendition (leans on the conversion engine) and a stronger step-up re-authentication on the malware override.
- **Ad-hoc malware-scan diagnostic** (`POST /api/v1/scan/diagnose`): a firm member can stream a file's bytes straight through the scan engine and get back a verdict — `clean` / `infected` / `unscanned` / `suspicious`, plus the signature, reason, or active-content flag — **without** uploading it to a matter or storing anything. The body streams unbuffered to the engine; the inspectable-size cap is enforced from `Content-Length` before the scan runs. Gated on a new firm-level capability `firm:scanFile` (seeded to every default role in per-firm migration `0017`, mirroring `firm:reportIncident`); because the scan stores nothing, the request's audit row (`file.scan_diagnosed`, verdict only — never the file's bytes or name) is the record of who ran a scan. Returns an honest `unscanned` until the scan Container is activated (the engine-less adapter never reports a false `clean`).
- **Conversion — engine placement (local vs server).** `@magna-carta/conversion` now tags each engine with where it can run: libvips runs **locally** (browser wasm) and on the **server** (Container); the native engines (LibreOffice, email render, FFmpeg) are server-only. `canConvertLocally(from, to)` reports whether a conversion can run entirely on the user's device — letting a surface offer "convert on your device" (no upload) versus "send to servers."
- **Conversion — the multi-hop execution runner.** `@magna-carta/conversion` can now _run_ a conversion, not just plan it: `runConversion(from, to, bytes)` finds a path through the registry and executes it hop-to-hop, threading each step's output into the next and returning the converted bytes or a typed failure — a missing path is an unsupported edge, and a deferred engine mid-chain surfaces `engine-not-implemented` without running later hops. Single-hop image conversions run end-to-end today via the libvips adapter; multi-hop chains light up the moment their engines land with the execution substrate.
- **`X-Robots-Tag: noindex, nofollow` on every private application surface.** The application Worker now stamps a `noindex` directive on every app-origin response — the SvelteKit SPA shell, the API, Better Auth, health, and every branded per-firm subdomain — so no authenticated, firm-scoped surface (e.g. a client portal) can be indexed by a search engine. The directive is a code-owned Worker response-header middleware (version-controlled, covered by a standing fitness test) rather than a dashboard rule; the existing Cloudflare-managed `robots.txt` is kept as complementary (it governs crawling, the header governs indexing). The middleware is registered after the cookieless preview route, so the sealed `files.*` edge — which serves only `Content-Disposition: attachment` bytes and bare 404s, never an indexable page — keeps its exhaustive payload-derived header set untouched. The public marketing site, when built, is a separate app on its own host and does not run through this Worker, so it does not inherit the directive.
- **On-demand "scan this matter now"** (`POST /api/v1/scan/matter/{id}`): a member can proactively queue a background malware re-scan of a matter's files instead of waiting for each to be opened. Only **stale** files are queued — a current version already scanned under the firm's current engine is skipped in SQL, so a matter already up to date enqueues nothing; nothing is re-scanned when no current engine version is recorded. The scans run off the request path on the **bulk lane** (the same in-place re-scan branch the access trigger uses, cache-first). The per-request fan-out is capped (the owner runs 20k+-file matters); the response reports `{ enqueued, capped }`, and any file beyond the cap is still re-scanned on next access — nothing is silently skipped. Gated on `files:upload`; the request is audited (`matter.files_rescan_requested`, with the enqueued count).
- **YARA detection rules — YARA Forge, self-updating, false-positive-filtered.** The malware scanner's YARA layer (previously an empty corpus behind clamd + the structural heuristics) now loads the [YARA Forge](https://yarahq.github.io/) `extended` package. The image build fetches the latest YARA Forge release, drops the false-positive-prone heuristic `_SUSP_` pocket (rules scoring below the `YARA_MIN_SUSP_SCORE` floor, default 75 — keeping ~4,686 high-confidence malware rules over the `core` tier), compiles the kept set with yara-x (skipping + logging any rule yara-x cannot compile, failing the build only on a systemic collapse), and serializes it into the image; the service deserializes it at boot with no startup recompile. Rules **self-update** on the existing nightly Deploy-Hook rebuild (no runtime egress — the same image-only model as the clamd database), and the resolved release tag is the engine-version `yara-rules/<tag>` component, so a new Forge release re-scans the fleet via the access-triggered staleness gate while an unchanged one leaves it untouched. A YARA hit is treated identically to a clamd signature hit (`infected`) — one quarantine path. Tier and score floor are build ARGs (`YARA_FORGE_TIER`, `YARA_MIN_SUSP_SCORE`, optional `YARA_FORGE_TAG` pin), swappable without code.
- **Malware-scan engine + content dedup — the slice 2·1 scan Container** (decision record [`docs/specs/2026-06-22-scan-throughput-decision-and-horizontal-plan.md`](docs/specs/2026-06-22-scan-throughput-decision-and-horizontal-plan.md)): the detection-only scan engine behind the ingest pipeline's `MalwareScanPort`. **`containers/scan/`** — a standalone Rust crate (an **axum 0.8** service on `/ready` + `POST /scan`) fans each file body to three engines and combines them most-dangerous-wins into the TypeScript `ScanResult` union: **clamd** signature scan over loopback TCP, **yara-x 1.18** heuristic rules, and **structural heuristics** (lopdf/cfb/zip) — PDF active-content, Office VBA + encrypted-package detection, and archive caps (depth / entry-count / uncompressed-size / expansion-ratio from entry metadata, so a zip bomb is caught before expansion). **Transport (Option B):** the body streams to a clamd scratch file that clamd scans by path while the in-process engines read it through a memory map — ~1× resident (verified 0 MiB anonymous RSS vs INSTREAM's ~1×-file), so a memory-constrained instance runs many concurrent scans. **Per-firm content dedup ("scan-once"):** a `scan_cache` table keyed by `(content_sha256, engine_version)` records definitive verdicts so a re-scan or duplicate-heavy migration reuses a verdict instead of re-running the engine; the engine version in the key makes a signature-database update a deliberate cache miss (never a stale clean). The clean verdict is recorded into the cache atomically on commit. **Bulk lane:** the files-ingest-bulk queue concurrency is raised for parallel scanning across the autoscaling Container fleet (the throughput lever, since single-stream is matcher-bound at clamd's ~15 MiB/s floor). **Hardening (adversarial review):** clamd fails **closed** on a scan-limit breach (`AlertExceedsMax`, previously a silent clean below the Rust layer); the whole clamd exchange is timeout-bounded → a retryable 503 (never a clean verdict); the in-process engines run under `spawn_blocking` + `catch_unwind` with a pre-parse PDF nesting-depth guard against lopdf's unbounded-recursion abort; nested-archive heap is bounded on real materialized bytes; `interpret_reply` is record-by-record so a `FOUND` can never be masked. **Prefilter deferred (not removed):** a SIMD prefilter to clear clean files before clamd was built and proven unable to beat the matcher floor _soundly_ — ClamAV's irreducible any-type signatures force 100% fall-through — so it is un-wired from the image but kept as a tested, self-maintaining artifact (`atoms.rs`/`prefilter.rs`/`build-atoms` + the DB-derived differential gate). Migration `0016` adds `scan_cache` + the `file_version.scan_detail` column.
- **Inline file preview backend — the slice 2·3 safe-delivery sandbox** (spec [`docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md`](docs/specs/2026-06-19-slice-2-3-inline-preview-safe-delivery-design.md); backend plan [`docs/specs/2026-06-19-slice-2-3-backend-implementation-plan.md`](docs/specs/2026-06-19-slice-2-3-backend-implementation-plan.md)): cookieless `<video>`/`<audio>` subresource delivery of untrusted bytes so they reach only the browser's media decoder and never an HTML/script parser. **Delivery contract:** a firm-scoped preview-grant route (`POST /api/v1/files/preview-grant`) authorizes the current clean version of an inline-playable file and returns a signed HMAC token (`{ r2Key, bucket, sniffedContentType, verdict, exp }`) signed over a key derived from `AUTH_SECRET` — NOT an R2 presign, which cannot carry the required response headers. A host-guarded cookieless serving route (`GET /api/files-preview/{token}`) on the `files.*` hostname — outside the ADR-0067 chokepoint, with its own standing fitness guard — streams the bytes with full HTTP **Range/206** (`ETag`+`If-Range`) support and a fixed safe-header set: `Content-Disposition: attachment` (a no-op for a subresource, honored for a top-level navigation), `X-Content-Type-Options: nosniff`, server-fixed `Content-Type` (never the attacker-declared MIME), and `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors <app-origin>`. The grant is `audited:false`; the existing audited `/download` route continues to record every full-file pull. CORS is ungranted at launch; `crossorigin` + scoped `Access-Control-*` is a deferred player-slice seam. **`security.md` amended additively** (not deviated from): the attachment rule is unchanged; the amendment adds a second sanctioned inline-render mechanism (a native media subresource for verdict-confirmed inert media) alongside `<iframe sandbox>`. Browser media-decoder RCE is a named accepted platform residual; its genuine mitigation is the deferred Container-produced derived rendition. **`inline_playable` verdict seam:** an additive nullable two-axis column (`playable`|`download-only`|`indeterminate`, NULL = never-sniffed) lands on `file_version` as a schema-only seam; the codec-sniff parser, the `runIngest` compute hook, and corpus backfill are deferred to the first-reader slice. Until then every preview correctly falls back to download-only (the safe direction). **Real HTTP/HTTPS only:** the preview route is served over real HTTP(S) on web and desktop alike — never routed through a `tauri://` custom-scheme proxy, which does not honor Range, and would silently kill seeking. Desktop player code (0·7a/0·7b) inherits this as a hard constraint. Load profile `[-]` (NULL-only column, stateless delivery, no per-firm data surface). Backend-only; the Vidstack player UI defers to 0·7a/0·7b.
- **In-app conversion — the substrate-independent core (in-house only).** New pure `@magna-carta/conversion` package: a `ConversionPort` (typed, never-throws result), a format registry of single-engine weighted edges, multi-hop pathfinding, and a working libvips image adapter over `wasm-vips` (PNG/JPEG/WebP/TIFF/GIF, tested in Node). LibreOffice/FFmpeg/email edges are registered but their bodies are deferred to the execution substrate (they return `engine-not-implemented`). The converter is **in-house only** — confidentiality absolute, one engine per edge; a pluggable external-engine model was considered and rejected because in a law practice nearly all content is privileged, so any classifier that permits egress is a one-mistake leak of privileged material. The conversion orchestrator, Worker routes, Container/Durable-Object execution, the LibreOfficeKit fork-pool, and the FFmpeg sandbox remain gated on the slice 2·1/2·2 execution substrate.
- **Server-side file conversion — transient job path.** New `POST /api/v1/conversions/upload` → `POST /api/v1/conversions` → `GET /api/v1/conversions/{jobId}` routes implement a fully async, transient conversion journey: the client presigns an upload slot (bytes go directly to R2, never through the Worker), submits a job (202 queued), and polls until `done` — at which point the response carries a short-lived presigned GET URL for the converted file. The `ConversionJob` Durable Object is the single-flight coordinator keyed per firm and job, the `CONVERSION` queue delivers execution work, and `resolveEnginePort` selects the real libvips Container (HTTP) adapter when the `LIBVIPS_CONTAINER` binding is present, or falls back to the deferred port otherwise. Tenant isolation is enforced at the DO level — a job id that does not belong to the requesting firm returns unknown-job. Activating real conversions in production is a deploy-time step: build and push the libvips Container image, add the `containers` binding for `LIBVIPS_CONTAINER` in `wrangler.jsonc`, and add an R2 lifecycle rule expiring the `conversions/` prefix. All other conversion engines (LibreOffice, FFmpeg, email) remain registered with deferred bodies.
- **Dedicated conversion worker (`magna-carta-convert`).** A new `apps/convert-worker` Cloudflare Worker hosts the conversion engine Container(s) and is the execution home for the heavy native engines. The app worker reaches it over a `CONVERT` service binding — no public surface, outbound networking disabled — and `resolveEnginePort` in `conversion-engine.ts` returns the `serviceBindingPort` adapter automatically once the binding is present, leaving the `ConversionJob` Durable Object, the queue consumer, and all routes in the app worker unchanged. The in-container libvips engine image (`containers/convert/`) is a deploy-time activation: build the image, deploy the worker, and the `CONVERT` binding activates real conversions. Until then `resolveEnginePort` returns the deferred port and all conversion routes remain fully functional with `engine-not-implemented` results.
- **Pure-Rust raster engine for the `magna-carta-convert` conversion worker.** The raster image engine that backs the conversion worker is now a dedicated Cloudflare Container service built in pure Rust (`containers/raster/`, `magna-carta-raster`): an axum HTTP service (`GET /ready`, `POST /convert`) that decodes source images and re-encodes them to the target format using the `image` crate exclusively — no native libvips or any other C codec library, so untrusted document bytes never touch a memory-unsafe codec. Supported formats are PNG, JPEG, WebP, TIFF, GIF, and BMP; a per-decode bomb guard (`image::Limits`) rejects pixel bombs and decompression bombs before any allocation. The engine Container is a deploy-time build: build and deploy `magna-carta-convert` and the `CONVERT` service binding activates it; until then the worker returns `engine-not-implemented` for raster conversions as before. The engine class is `RasterEngineContainer` (the convert worker's Container-backed Durable Object, keyed `"raster"`).
- **Conversion — image-to-PDF via the pure-Rust raster engine.** The raster engine (`containers/raster/`) now converts raster images (PNG, JPEG, WebP, TIFF, GIF, BMP) directly to PDF. Output is a single-page PDF whose page dimensions are set to the image's natural aspect ratio with the longer side at 792 pt, produced entirely in pure Rust via the `krilla` PDF writer — no PDFium, no C codec libraries, no memory-unsafe code in the conversion path. The `image-pdf` edges are registered in `@magna-carta/conversion` as server-only (a PDF-capable container is required; the format is not producible locally in the browser). The `recipe` seam is forwarded through for future page-geometry control.
- **Tools — a general File Converter (foundation).** A new matter-free file-conversion tool in the Tools area, built on the conversion core — convert a file to another format without uploading it to a matter. Registers the `tools:fileConverter` permission, a `documents` subject group, and the `file-converter` catalog manifest (library-backed, matter-free). Adds file-facing helpers to `@magna-carta/conversion` (`detectFormat`, `availableTargets`, `convertFile`) that map a `File` to a registered format, list its conversion targets, and convert it to a downloadable `Blob`. The interactive widget rides the design-system shell, the server-side engines (Office/AV) ride the conversion substrate, and role-seeding lands with the UI — none of which this foundation needs.
- **Tools — Metadata Inspector & Scrubber.** A new utility in the Tools area that shows exactly what hidden information a document or image is carrying and produces a cleaned copy that is safe to send. Upload a `.docx`, `.jpg`, or `.png` file and the tool surfaces anything that could identify you or your firm — author names, tracked changes, comments, hidden text, photo location coordinates, camera details, and edit history. Hit **Make safe to send** for a one-click clean, or review and toggle individual items before downloading the scrubbed copy. Nothing is stored between sessions.
- **WHOIS Lookup and Safe Website Viewer** — two new security-hygiene tools in a new **Websites & Domains** group, available to all staff roles. **WHOIS Lookup** retrieves the public registration record for any domain name or IP address (registrar, registration and expiry dates, nameservers, status, and registrant where published). **Safe Website Viewer** renders a suspect URL in an isolated remote browser and returns a static snapshot — screenshot, redirect chain, page text, and outbound links — so the live page never loads in the user's browser and no hostile code can reach the user's device. Both tools surface in the Tools sidebar; the Safe Website Viewer also exposes every redirect hop so cloaked or phishing links are visible at a glance.
- **Auto-clean of build artifacts on merge to `main`**: a tracked `post-merge` git hook runs `vp run clean`, which sweeps regenerable build output (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) from worktrees whose branch is merged into `main` and prunes dangling Docker build cache and image layers. Deletion is **git-ignored-only** (each candidate is confirmed with `git check-ignore`) and never touches the active worktree, `node_modules`, tracked source, or the worktree/branch themselves. Activate once per clone with **`vp run setup-hooks`**; run on demand with `vp run clean` (preview via `node tooling/clean/index.mjs --dry-run`, or sweep every non-current worktree with `--all-worktrees`). This stops dead build artifacts from filling the dev disk.
- **File Hash & Integrity tool.** Compute a file's MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests in
one pass, and verify a stored file still matches the SHA-256 recorded when it was ingested — with a
chain-of-custody record and a downloadable hash receipt. Available as a standalone Tools utility and
as a per-file action.
- **Bates numbering for `@magna-carta/pdf` — `stampBates(bytes, options?)`:** stamps sequential identifying labels onto every page of a PDF. The stamp is an **additive overlay**: a new text stream is appended last on each page so it renders on top; no existing text, images, vector graphics, or metadata is removed or modified. Options: `prefix` (label text before the number, default `""`), `suffix` (label text after the number, default `""`), `startNumber` (default `1`), `stopNumber` (inclusive ceiling — the call throws if exceeded, before modifying any page), `padding` (zero-pad digit count, default `6`), `position` (one of six corners/edges, default `"bottomRight"`), `font` (one of twelve built-in standard PDF Type 1 text fonts across the Helvetica, Times, and Courier families — no font embedding required, default `"helvetica"`), `marginPt` (default `18`), `fontSizePt` (default `8`). Returns `{ pdf: Uint8Array, start: number, end: number, pageCount: number }`. The engine adds exactly one shared font object per document regardless of page count. Placement is rotation-aware: labels read upright on pages with any `/Rotate` value (0/90/180/270). Page resources are merged non-destructively — no existing font resource is dropped. Continuous set numbering is supported by threading `result.end + 1` as the next `startNumber`. The WASM binding (`stampBates`) is exposed alongside the existing `redactDocument`, `sanitizeDocument`, and `detectDocument` exports. Validated by 97 Rust unit tests (`cargo test -p pdf-core`) and the JS integration suite. (`crates/pdf-core`, `packages/pdf`)
- **PDF bad-redaction detector — two additional categories (RemovableAnnotation + HiddenLayer), completing seven-category coverage:** `detectDocument(bytes)` in `@magna-carta/pdf` (WASM surface) and the underlying `pdf_core::detect` in `crates/pdf-core` now cover all seven bad-redaction patterns. **RemovableAnnotation (Critical):** flags text whose glyph center falls within the bounding rectangle of an annotation whose subtype is one of Redact, Square, Circle, Polygon, FreeText, Stamp, Highlight, or Ink — annotations that an editor can strip to expose the underlying content; implemented as a structural detector over the annotation object model. **HiddenLayer (High):** flags text enclosed in a marked-content sequence whose optional-content group is off by default in the document's `/OCProperties` configuration — content that is present in the content stream and extractable but not rendered by a conforming viewer; findings are page-level (`region: null`) with recovered text. The WASM `category_str` mapper and the TypeScript `DetectionFinding.category` union are extended to cover both new categories (`"removableAnnotation"`, `"hiddenLayer"`). The fast-follow adds five Rust tests (HiddenLayer off-vs-on OCG and indirect-`/Resources`, RemovableAnnotation by subtype, and cross-category precedence), bringing `pdf-core` to 38 tests; all pass, with `cargo clippy` and `cargo fmt` clean. (`crates/pdf-core`, `packages/pdf`)
- **PDF bad-redaction detector — `pdf_core::detect` (five-category geometric + structural scan with a ranked `DetectionReport`):** `detectDocument(bytes)` in `@magna-carta/pdf` (WASM surface) and the underlying `pdf_core::detect` in `crates/pdf-core`. Scans a PDF for content that appears hidden but remains recoverable: **CoveredText** (Critical — extractable text under an opaque fill, identified by paint-order geometry), **InvisibleText** (High — text in PDF invisible rendering mode, Tr 3), **WhiteoutText** (High — text and its covering fill are the same near-white colour), **MetadataLeak** (Medium — identifying text in the information dictionary, XMP stream, bookmark titles, or AcroForm field values), and **OrphanedText** (High — text in objects unreachable from the trailer but present in the cross-reference table). The operation is read-only — it never modifies the input — and never asserts a document is clean: an empty `findings` list means nothing was detected by these mechanisms, not a guarantee. `DetectionReport` includes `pagesUnreadable`, the set of page indices the renderer could not interpret; those pages were not examined by the geometric detectors. The geometric detectors are built on the `textpos::observe_page` observing-Device primitive (`GlyphMark` + `CoverMark` + `PageObservation`), shared with future content-stream surgery. Two detectors are deferred to a fast-follow mechanism spike: RemovableAnnotation (annotation-layer content that an editor can strip) and HiddenLayer (optional-content-group hidden content). `crates/pdf-eval` gains a `detect` mode (prints the ranked report) and a `detect-smoke` mode (appends an opaque cover over page 1 and asserts the detector flags it), wired as a CI step in the `rust-pdf-core` job. (`crates/pdf-core`, `packages/pdf`, `crates/pdf-eval`)
- **PDF document sanitization engine — `pdf_core::sanitize` (seven-surface scrub with a five-layer hard gate):** `sanitizeDocument(bytes, opts?)` in `@magna-carta/pdf` (WASM surface) and the underlying `pdf_core::sanitize` in `crates/pdf-core`. Removes seven document-level surfaces with all flags defaulting to `true`: document metadata (`/Metadata` stream + `/Info` dictionary), XFA form definitions (blank AcroForm field shells are kept), the structure tree, the bookmark outline, optional-content configuration (`/OCProperties`), embedded file attachments (the `/EmbeddedFiles` name tree and `FileAttachment` annotations), and form field values (appearance streams cleared, `NeedAppearances` set). Each surface is independently opt-out via `ScrubOptions`. Orphaned objects are pruned after the surface passes. Redaction is now sanitized-by-default: `redactDocument` accepts `scrub?` in `RedactionOptions` (default `true`), composing redact-then-sanitize as a single pipeline. Verification gate: five layers — structural-absence walk, metadata text check, logical-content decompress-and-scan (catches strings inside compressed streams), raw-byte scan of the emitted PDF, fail-closed on any failure — before any output is returned. `crates/pdf-eval` gains a `sanitize-smoke` mode (sanitizes a corpus file with default options and asserts the gate passes), wired as a CI step in the `rust-pdf-core` job. Documented boundaries: optional-content scrub is configuration-level (removes `/OCProperties`, does not excise marked-content operators — the decompress-scan covers known supplied strings); structure-tree removal drops accessibility tagging (pass `structureTree: false` to preserve it); the byte-level survival scan does not decode custom-font glyph encodings or pixel-encoded images. (`crates/pdf-core`, `packages/pdf`, `crates/pdf-eval`)
- **PDF render engine — `@magna-carta/pdf` (pure-Rust/WASM core, inline preview foundation):** `crates/pdf-core` (a pure-Rust hayro-backed renderer compiled to `wasm32-unknown-unknown` via wasm-pack) and `packages/pdf` (the TypeScript wrapper — `loadDocument`, `PdfDocument.pageCount`/`pageSize`/`renderPage`/`free`, `Symbol.dispose` support). `crates/pdf-eval` is the permanent parse-coverage harness (lopdf + the hayro render path, smoke-tested against a controlled corpus in CI). Rust quality gates added to CI (`rust-pdf-core` job: fmt, clippy, tests, pdf-eval smoke, wasm-pack build) and to `pnpm check` (`vp run rust-check`); `vp run build-all` depends on `rust-wasm-build` so the WASM artefact is always current before the SPA bundles. No server round-trip for rendering; no C binding; no vendored binary. (`crates/`, `packages/pdf`)
- **AcroForm support for `@magna-carta/pdf` — `readForm`, `fillForm`, `flattenForm`:** enumerate interactive form fields, fill values by name, and flatten a form into permanent static page content. The four fillable field types are text, checkbox, radio, and choice (list/combo); push-button and signature fields are enumerated but read-only in this version. Field values are passed as a plain object mapping fully-qualified field names (dot-joined, as returned by `readForm`) to strings (for text/choice/radio) or booleans (for checkboxes). **Generated Helvetica appearances:** the engine writes a real PDF Form XObject appearance for every filled text or choice widget, so the rendered value is identical in every viewer without relying on viewer-honoured `/NeedAppearances`. Helvetica is a base-14 standard font; no font file is embedded. Checkbox and radio fills set the field value and the widget's selected state (`/V` and `/AS`) and render through the field's existing on/off state appearances — a checkbox or radio widget that carries no state appearance streams is filled at the value level but is not given a generated appearance. **Flatten bakes into content:** when `flatten: true` is set (or `flattenForm` is called), each widget's appearance is drawn into the page via a `Do` operator with a placement transform, page resources are merged non-destructively, widget annotations are removed, and the `/AcroForm` dictionary is dropped — after flattening, `readForm` returns an empty array. **Forms are not redaction.** Filling and flattening write and bake visible field values; they do not remove hidden content, metadata, or other surfaces — use `redactDocument`/`sanitizeDocument` for that. V1 boundaries: Helvetica base-14 appearances only (single-line, no rich text or multiline), no XFA, no digital-signature creation, no `/MK` border styling on generated appearances. Validated by 32 Rust unit tests in `crates/pdf-core` and 3 JS integration tests on the real IRS W-9 AcroForm fixture (fill + flatten round-trip verifies the form is dropped; fill without flatten verifies the form is retained). `(crates/pdf-core, packages/pdf)`
- **PDF redaction engine — `pdf_core::redact` (rasterize-and-reassemble with a hard verification gate):** `redactDocument(bytes, regions, opts)` in `@magna-carta/pdf` (WASM surface) and the underlying `pdf_core::redact` in `crates/pdf-core`. Accepts `RedactionRegion` values (page index + display-space rect + optional reason string) and `RedactionOptions` (DPI, default 300; fill colour, default black; text strings to check in the gate). Operation: renders each affected page to a pixel buffer via hayro, burns the redaction region onto the image, replaces the page's content stream and resource dictionary with the image XObject, prunes orphaned objects so original bytes do not survive, then enforces a hard verification gate (lopdf text-extract structural check + content-string scan + raw-byte scan of the emitted PDF) before returning. The gate fails closed — `RedactError::GateFailed` / a thrown `Error` on the WASM surface — if any supplied text survives or the extract itself fails structurally; the function never returns an unsafe PDF. `crates/pdf-eval` gains a `redact-smoke` mode (redacts the full first page and asserts the gate passes), wired as a CI step in the `rust-pdf-core` job. Text-position surgery (remove only the glyphs within the region, preserving the rest of the page as PDF operators) is deferred to the text-position-primitive slice. (`crates/pdf-core`, `packages/pdf`, `crates/pdf-eval`)
- **PDF text-preserving redaction — surgery mode for `redactDocument` in `@magna-carta/pdf`:** `RedactionOptions` gains an optional `mode` field (`"flatten"` | `"surgery"`, default `"flatten"`). Surgery mode excises only the glyphs whose centres fall within a redaction rectangle from the page content stream, leaving remaining text on that page as selectable PDF operators. The engine now resolves Core-14 standard-font metrics (Helvetica, Times, Courier, Symbol, ZapfDingbats and their variants) from built-in advance-width tables when no embedded `/Widths` array is present, lifting surgery coverage over standard-14-font documents. The engine falls back to rasterize-and-reassemble (`"flatten"`) for any page it cannot confirm clear: per-page fallback triggers for simple fonts that are not standard-14 and omit `/Widths`, non-Identity Type0 encodings, Type3 fonts, text drawn inside Form XObjects, non-zero page rotation, inline images, and redaction rectangles that overlap raster image XObjects. The per-page outcome gate (re-observing glyph positions via the hayro textpos device after the edit) ensures a surgered page is never less safe than a flattened page. `RedactionResult` gains `pagesSurgered` and `pagesFlattened` arrays (0-based page indices) alongside the existing `pagesRedacted`. Over-removal of an immediately neighbouring glyph is the only residual non-safety failure mode. Surgery also resolves inherited `/Resources` via the page parent chain (pages that declare `/Resources` on an ancestor `/Pages` node rather than the page dict itself). **This is an initial, partial-coverage version (incomplete):** surgery succeeds only on supported pages and otherwise falls back to the safe flatten path, so on complex documents (scanned pages, CJK/composite fonts, form-XObject text, inline images) most pages are still rasterised — over the 10-file mixed corpus only 3 of 10 documents surgered. Non-Identity Type0/CID fonts, Form-XObject text, and inline images are planned for later versions. `crates/pdf-core` passes 80 tests. (`crates/pdf-core`, `packages/pdf`)
- **Release channels — backend rails** (spec [`docs/specs/2026-06-25-release-channels-design.md`](docs/specs/2026-06-25-release-channels-design.md)): the complete backend mechanism for a firm to run pre-release behavior, proven end-to-end by a throwaway smoke flag (`release-channels.smoke`).

**Model.** `firm.release_channel TEXT NOT NULL DEFAULT 'stable'` on the control-plane `firm` table — a single additive expand-contract migration. Nesting `alpha ⊇ beta ⊇ stable`: an alpha firm sees everything beta sees. Channel is a firm property; every member of a firm shares one channel.

**Two doors to one column.** The column has two write paths with distinct trust boundaries:

- **Beta firm endpoint** (`PUT /api/v1/firm/release-channel`): accepts only `{ stable, beta }`; backed by the new RBAC permission `firm:manageReleaseChannel` (seeded to Owner/Admin), enforced server-side in the firm-scoped data-access layer. Requires an explicit consent acknowledgment in the request body (who, when, the exact text/version) recorded in the per-firm `audit_log` (event `firm.release_channel_changed`). Leaving beta needs no consent.
- **Alpha secret-guarded platform endpoint**: writes any channel value including `alpha`; same trust lane as `firm:provision`. Audit home is the control-plane `auth_audit` (event `firm.release_channel_set_alpha`, `user_id` null), metadata `{ firmId, oldChannel, newChannel }`.

**`@magna-carta/feature-flags`.** New package: thin wrapper over the Cloudflare Flagship `env.FLAGS` Worker binding. Exports `FLAG_CATALOG` (all declared feature flags, each with a `stage: alpha | beta | stable`), `getBooleanValue(flagKey, default, context)`, `evaluateCatalog(flagKeys, context)`, and evaluation-context builder. The native Flagship binding evaluates flags with no outbound HTTP (off the request hot path). Every evaluation supplies a default equal to stable behavior — a Flagship outage or missing flag is invisible to users. Local Miniflare: the optional binding declaration means the binding is absent in tests; `resolveFlagEvaluator` falls back to `defaultOffEvaluator` (all flags off) automatically.

**Session and `/me`.** Session context reads `release_channel` from the control-plane `firm` row per request and builds the evaluation context `{ firmId, channel, role, userId }`. The `/me` response now delivers the resolved flag set for the current session alongside the existing permissions payload, so the SPA can gate UI without a second round-trip.

**Proof.** One throwaway boolean flag (`release-channels.smoke`) is wired through the full stack — catalog entry, API route that returns its value, worker integration test asserting the channel drives the flag outcome. The flag is retained as the reference example; real features adopt the rails as they ship.

**Decisions recorded** as pending ADR fragments (`docs/decisions/pending/release-channels-flagship.md`, `docs/decisions/pending/release-channels-gate-behavior-not-schema.md`), numbered at merge.

**Deferred (Plan 2).** Beta opt-in Settings UI + explicit consent dialog; one product UI element gated on the throwaway flag; stage-labeled alpha/beta visibility markers + feedback affordance on pre-stable features.
- **In-app document editing, versioning & storage tiering — the slice 2·2 backend** (spec [`docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md`](docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md); plan [`docs/specs/2026-06-18-slice-2-2-implementation-plan.md`](docs/specs/2026-06-18-slice-2-2-implementation-plan.md); pending ADRs `collabora-editing-host-topology`, `document-editing-concurrency-reconciliation`, `container-subsystems-extract-to-dedicated-workers`). Edit a matter's `.docx`/office documents in the browser with app-managed versioning and an optimistic, never-block concurrency model. **WOPI host:** the worker is the WOPI host (standard `X-WOPI-*` baseline, Collabora `X-COOL-*` additive) on a cookieless, access-token-guarded callback surface (`/wopi/files/*`) off the cookie chokepoint — CheckFileInfo / GetFile / PutFile (streaming-hash, host-authoritative timestamp with the `1010` stale-write guard) / the Lock family — with firm-scope and capability re-derived from the verified token on every callback (a firm-A token 404s on a firm-B document; a view token mutates nothing, server-side). **Versioning:** a mutable `current` working object is the live copy; a deliberate Save / session-close cuts an immutable version by server-side R2 copy with a SHA-256 no-op skip; the current pointer advances monotonically. **Concurrency & reconciliation:** real-time co-editing joins one shared session on a per-document `DocumentSession` Durable Object (participants + lock + working-object metadata in durable storage); a never-blocked read-only viewer onto the live document; offline checkout takes a presigned working copy, and its check-in returns through the ADR-0081 **quarantine ingest** — a fast-forward when the base is still current, else a retained-forever `conflict_pending` conflicting copy that current never regresses to, resolved by a human (`reconcile`, keep current/incoming/both). **Locks & lifecycle:** an opt-in exclusive lock makes a second member's edit launch read-only; a `documents:forceReleaseLock` holder can force-release (auditing both parties); the DO idle-reap alarm frees a dead co-editing session; a daily sweep auto-releases idle checkouts (`active→stale→released`, firm-configurable window); soft-delete reaps the live session and destroys the working copy (versions retained); restore re-materializes lazily; version-restore brings an archived version forward. **Tiering:** a conservative daily cron tiers cold, superseded versions Standard→Infrequent-Access past the IA 30-day window (never the live version, never deletes), shifting `storage_meter` in the same batch. **Permissions** `documents:edit` / `documents:checkout` / `documents:forceReleaseLock` / `documents:reconcile` (matter-scoped). **Migrations** `0022` (working-copy / checkout / reconciliation columns + `document_checkout`), `0023` (the tiering + idle-checkout sweep indexes), and `0024` (the idle-release index). **Load profile** extended to `ledgerVolume-v8` (tiered versions, checkouts, conflicts; the two firm-wide sweep scans measured + index-backed). **Container topology:** the coolwsd editing compute is extracted to a dedicated **`magna-carta-edit`** worker — one isolated coolwsd container per open document, built off the scan/convert-worker pattern (`DocumentSession` + the WOPI host stay in the app worker, the compute/coordination seam). The editor loads from a per-document cookieless origin, and coolwsd's WOPI callbacks reach the app worker through Cloudflare container **outbound interception** over a service binding — the container has no general egress (`enableInternet=false`). Liveness rides the editor's WebSocket natively (no alarm keep-alive — verified in the measurement spike); the version-cut-on-reap wiring is in place (a no-op until the container writes `current`). The live container image build/deploy and the post-sleep reconnect remain gated on the editing-container CI deploy. Backend + worker surface only; the editor UI follows the design-system slices. Built by Opus 4.8; pre-merge adversarial review pending.
- Time tracking, work-in-progress (WIP), and an effective-dated rate engine — the daily driver
(backend + API; the UI rides 0·7). A new `@magna-carta/timekeeping` package captures time four ways
(manual, a one-line quick-add parser, a weekly matters-by-days grid, and a server-persisted live
timer), stores it in a per-firm WIP store that is independently tracked and never posts to the
double-entry ledger (billable time converts to A/R only at billing), and moves each entry
Draft → (optional Submitted → Approved) → Billed under a column-level freeze contract. The live
timer is the codebase's first Durable Object — one idle-friendly instance per timekeeper,
firm-namespaced, with an abandoned-timer alarm and a `live_run_id`-idempotent stop-commit that
collapses a cross-device double-commit to one entry. Rates are append-only effective-dated versions
on named rate cards; a captured entry snapshots the rate in force on its work date and keeps it
forever, with an opt-in re-rate for unbilled drafts. The slice also lands two pieces of shared
infrastructure the rest of the phase consumes: the UTBMS task/activity/expense code catalog, and a
scoped-setting resolver (the first realization of the settings-precedence chain — matter → client →
user → location → firm). The AI narrative / UTBMS-suggestion feature is seamed but dark, gated on
client consent (default off, no model reached).
- **Matter bulk downloads can now be packaged with a chosen format, compression, encryption, and
multi-volume splitting** (ADR `enhanced-bundling-formats-encryption-split`). When downloading a set of
matter files as a bundle, you can now choose the archive **format** (ZIP or 7z), a **compression** level
(store / normal / maximum), optional **AES-256 encryption** with your own password, and — for 7z —
**multi-volume splitting** into fixed-size parts. Quality-of-life options round it out: name the output,
wrap everything in a folder, flatten the folder tree, and include a CONTENTS manifest (each file's path,
size, and SHA-256). Plain ZIP downloads keep their existing fast path; the heavier formats, compression,
encryption, and splitting are produced by a dedicated archive-builder service. **Encryption passwords are
never stored** — an encrypted bundle is built and streamed to you in one pass, with the password held only
for that request, so re-downloading an encrypted bundle rebuilds it on demand.
- PDF security — inspect, unlock, and protect. The PDF engine can now report whether a
document is encrypted and how, unlock a password-protected PDF with a known password
(RC4, AES-128, or AES-256), and re-protect a document with AES-256, owner/open passwords,
and a permission policy. It runs entirely on the device, so the password and the document
never leave the browser. Unlocking needs a password you already have — it does not recover
or guess passwords — and the "Unlock & Secure PDF" tool that surfaces this arrives in a
later release.
- **Per-firm scan-policy backend rails (Slice B1):** three firm-level settings (`scan.policy` `{tier: core|extended|full, suspiciousScoreFloor: 0–100}`, `scan.flagged_treatment` `block`|`informed-access`|`allow-and-flag`, and `scan.step_up_reauth_on_flagged` boolean) are stored in the generic `setting` table via `FirmSettingDefinition` entries — no per-firm migration needed, missing row equals the default. The prior four-state scan verdict collapses to one `scanVerdict: "flagged"` state in `file_version` (the full raw engine result survives in `scan_cache`, so the persistence state is stable across schema changes); the old `infected`/`suspicious` distinction was an engine diagnosis not a persistence state. Treatment is enforced at two chokepoints: at ingest, `computeVerdict` applies the firm's resolved tier/floor to the raw container facts and routes each file to quarantine (`block`), informed-access commit, or allow-and-flag commit; at download/preview, the gate in `downloads.ts` reads `flaggedTreatment` at access time so a policy change takes effect on the next request without re-ingesting. `block` is the default, matching today's behavior for all firms. The step-up re-auth setting is stored and surfaced in 409 metadata (`stepUpRequired: true`) but the actual session-age challenge is deferred to a future auth slice. Permission `firm:manageScanPolicy` is seeded to Owner and Admin roles in migration `0025`. `GET /api/v1/firm/scan-policy` returns the resolved three settings; `PATCH /api/v1/firm/scan-policy` writes them. All suites (`ingest-core`, `scan-policy`, `files-routes`, `conformance`) + `pnpm check` + `lint:process-refs` green.
- Costs and expenses — per-matter disbursement work-in-progress (WIP) (backend + API; no UI). A new
`@magna-carta/costs` package captures hard and soft disbursements into a per-firm `cost_entry` WIP
store that is independently tracked and never posts to the double-entry ledger (a cost converges onto
an invoice only at billing, 3·4), and moves each entry Draft → (optional Submitted → Approved) →
Billed under the same column-level freeze contract time entries use. The slice extracts that shared
lifecycle out of `@magna-carta/timekeeping` into a new `@magna-carta/billing-core` package — the
`BillableStatus` state machine, the `isFrozen`/`canTransition`/`assertTransition` freeze contract,
and the `billing.approval_required` review-gate definition — so time and costs share ONE workflow
(and 3·4 billing inherits it); timekeeping's `lifecycle.ts` is now a thin re-export that aliases
`BillableStatus` as `TimeEntryStatus`, and 3·1's suite re-verifies green. Costs also land a
generalized recoverable-charge seam: a producer that fronts a billable charge on a matter's behalf
emits a canonical `RecoverableChargeEvent` instead of reaching into the cost tables, with a closed
`pass_through` vs `platform_fee` kind — a third-party charge the firm fronted is always recovered as
a client disbursement, while a Magna-Carta-absorbed fee (e-signature, messaging, shipping handling)
is recovered only under a per-category firm policy (`cost.recover_platform_fee.<category>`, default
off). Shipping (`shipment.purchased`) is the only wired producer (postage unblended from the firm
service fee); e-signature, messaging, and voice are documented seams. Consuming that seam is the
codebase's first per-firm queue consumer — a topic dispatch over the single bound per-firm queue,
keyed on `message.topic`, resolving the firm database by a two-hop (`firmId` → control-plane
`database_identifier` → bound D1), acking-and-ignoring topics it does not own (a deliberate
divergence from the control-plane sweep's throw-on-unknown), and posting recovered disbursements
idempotently behind a per-line `${shipmentId}:${category}` key and the `cost_entry` `recovery_ref`
unique index. A billable cost on an electronic-billing matter requires a UTBMS expense code at
capture, except a system-recovered cost, which lands as uncoded draft WIP rather than being dropped
(the coding requirement re-enforces at the 3·4 bill gate). Migration `0022_burly_piledriver`;
permissions `costs:track` and `costs:approve`; routes ride the chokepoint with a regenerated OpenAPI
snapshot and extended conformance; load-profile `CostVolume`. Deferred to deploy-activation: the
wrangler `consumers` declaration that subscribes the Worker to the per-firm queue (the dispatch
branch is dormant until then). Deferred to 3·4: the `cost.recorded` emission, the cost → A/R posting,
and how recovered costs get LEDES-coded.
- Support access framework — the backend rails for help-desk access to a firm's instance (backend +
API; UI follows). Access is pull-not-push: a firm member's request mints a time-boxed, audited grant,
and a named platform-staff member redeems it for a short-lived session — help desk can never let
themselves in. Two scopes ride the existing request chokepoint as an alternate, expiring principal: a
**diagnostic** scope that sees only non-privileged system state (status, schema version, storage,
member counts) and carries no decryption capability at all, and a **privileged** scope, hard-limited
to exactly what the requesting member can already see themselves (with an optional firm setting to
require an administrator's co-sign). The firm's owners are notified of every session and can revoke it
at any time; every request, grant, and redemption is recorded in a firm-visible audit trail attributed
to the named staff member. The firm's encryption key is never handed out — decryption stays on our
servers and a session simply stops working the moment its grant expires or is revoked.
- AI-Text Detection (Tools) — a vendor-agnostic core that estimates the likelihood a document was machine-generated, presented as a calibrated signal with explicit reliability caveats, never a definitive verdict. Built on the integration ports-and-adapters framework with a deferred adapter; a concrete detection vendor is wired in a follow-on.
- **Engine-host harness** — a shared `magna-carta-engine-host` crate giving the pure-Rust document engines one runtime seam (magic-byte format detection, the wasm32 JS-marshalling edge, and the axum container skeleton) instead of re-implementing it per engine.
- **File Type Verifier tool.** Identify a file's true content type, flag when its extension lies about the
content, and recommend the correct extension when it is missing or wrong. Powered by Google Magika,
running as an identification capability of the untrusted-byte scan subsystem. Detection runs in the
sealed scan Container (no network egress); verdict assembly (`match` / `mismatch` / `no-extension` /
`unverifiable`) and extension-mismatch reporting are handled by `@magna-carta/file-type` in the app
Worker.
- PDF assembly — combine, split, rotate, and watermark. The PDF engine can now merge several
PDFs into one (carrying their bookmarks, form fields, and named links across), split a PDF
into separate documents by page range, rotate pages, and stamp a watermark — diagonal text
such as "CONFIDENTIAL" or an image/logo — across every page. Watermarking and rotation are
additive and reversible: they draw on top and remove nothing. Everything runs on the device.
The assembly tools surface in a later release.
- **`@magna-carta/design-system` — Sidebar collapse is composited (no seam tearing); a platform-wide motion principle (slice 0·7a Phase D, owner UX review)**: the owner flagged the rail collapse/expand as "not acceptable" — a shimmer/tear along the sidebar↔work-canvas vertical seam, worst at fractional display scaling (Windows 150%). Profiling showed it was not a frame-rate problem (steady ~60fps) but a sub-pixel **paint seam**: the collapse animated **layout** properties (the rail `inline-size`, the menu-button `grid-template-columns`, the label `padding`), so the 1px border edge between the dark rail and the light canvas re-rasterized every frame at a fractional device pixel. Fixed by making the collapsed-state widths/tracks change **instantly** and compositing the transition with the **View Transitions API** (the project's chosen motion stack — Svelte built-ins + View Transitions, 0 kB): a new `internal/view-transition.ts` helper (`runViewTransition`, feature-detected, reduced-motion-aware) wraps the Trigger's state flip, `.mc-sidebar` takes a `view-transition-name`, and the work canvas takes one too so it morphs rather than ghosting. The browser tweens the before/after layouts on the GPU, so the seam is sampled, never repainted — it cannot tear; reduced-motion / unsupported browsers get an instant collapse. **Establishes the UX rule (now in the design-system `CLAUDE.md` and [`docs/conventions/ui-design.md`](docs/conventions/ui-design.md)): animate only compositor properties (`transform`/`opacity`), never `width`/`height`/`grid-template`/`margin`; wrap an unavoidable layout change in `runViewTransition`.** Also tidied the app-shell brand wordmark to fade with the rail (no clipped "M"). `svelte-check`, the fitness/purity gates, and the Sidebar/App-Shell story play+axe tests green; verified live in Storybook.
- **`@magna-carta/design-system` — identity-at-the-edges pass: edge chrome, the app shell, and the subtle status register (slice 0·7a Phase D, owner-review round 3)**: an owner design review reset the design language onto one law — **identity lives at the edges that frame the work, the work surface stays calm** (now a review rule in [`docs/conventions/ui-design.md`](docs/conventions/ui-design.md)). **Edge chrome:** a new dark "ink" token group (`chrome.surface`/`-hover`/`text`/`-muted`/`-strong`/`border`/`accent`, following the brand ramp so the chrome travels with the theme) and a gilt accent register (`accent.strong`/`-strong-foreground`, theme-independent gold); the **app shell** composition (Layout A) renders it — a dark Sidebar with the gold brand mark in the top-LEFT corner and a gold active destination, a top bar starting to its right (a quiet `⌘K` keycap in muted chrome, a gilt **New** Button, a notification bell, the avatar) framing a light, calm matters table. Chancery is now the default theme (the full gallery still offered). **The subtle status register:** every status hue gained a SUBTLE trio (`status.<v>-subtle` pale tint + `-subtle-foreground` deep same-hue text + `-subtle-border` soft same-hue hairline) — the calm default for work-surface status. **Badge** reshaped to a full-radius pill with pale-tint `neutral`/`success`/`warning`/`danger`/`info`/`accent` variants (the matters table's Open/Pending/Closed now read as calm chips), and **Alert** + **Toast** moved off their saturated solid panels onto the same subtle trio with a leading Lucide status glyph, so an inline callout and its matching toast read identically and recede on the work canvas. A selected table row lost its gold wash for a neutral fill + a thin gold leading-edge bar (identity at the edge, not across the data). All token gates (golden re-pinned), off-token/purity fitness, `svelte-check`, and the story play/axe gates green; verified live across the theme gallery. Built by Opus 4.8 (Fable-5 re-review + owner Storybook sign-off pending — model-split policy).
- **`@magna-carta/design-system` — DataTable filtering/appearance + animated Sidebar collapse (slice 0·7a Phase D, owner-review round 2)**: **DataTable** gains a composable **View/Settings menu** (`DataTable.ViewMenu`) holding column visibility AND appearance — zebra striping, column dividers, density (comfortable/compact), applied as `data-*` attributes the mc-table recipes key off; **format-aware global search** (`typedGlobalFilterFn`) that matches the displayed value, so a date is searchable as "Mar 1, 2025" and money as "$2,125.00" (table-core would skip the Date column and match money's raw number); **type-aware per-column filters** (`DataTable.ColumnFilter`) — a header funnel opens the control that fits the column's `meta` (a contains box, a faceted distinct-value list, a min/max range, or a date from/to), driven off the faceted row model, each with a Clear action; and a more correct **shift-click selection** (applies the anchor's resulting state to the range, so toggling off then shift-clicking deselects the span) that no longer resizes its row on check (the checkbox gained `vertical-align: middle`). **Sidebar** collapse is now **animated** rather than snapping: the width animates (the sidebar takes `flex-shrink: 0` so the flex algorithm stops overriding it), the menu button's grid label column interpolates `1fr`→`0fr` with a fixed icon track (auto tracks aren't animatable), the label fades via `color: transparent` (opacity is gate-banned), and the icon glides to a centred rail. Two new dimension tokens (`size.popover`, plus the earlier `size.sidebar`/`-rail`) and one purity-gate allowance (grid `fr` factors are structural, like `auto`). **Refined in a follow-up review:** the filter funnel shrank and the popover took on the Excel/Sheets shape (a column heading; the facet becomes a value-search + "Select all" + checklist on the uncheck-to-filter model; range/date gained Min/Max + From/To labels); money search now also matches the bare number ("2125" / "2,125" / "$2,125"); a selected row gained a brand accent bar on its leading edge so it stays distinct from the zebra stripe (hover/zebra/selected are now three tints); and the sidebar brand no longer wraps while collapsing (the header height stays constant). **And again:** the sidebar icons no longer slide sideways on collapse (the recentre is gone; the rail narrows to 52px so a left-aligned icon already reads centred, and the brand mark aligns with the nav icons); zebra striping moved to `surface-raised` (neutral-50), deliberately lighter than the selection fill (neutral-100) they used to share; text columns can now be faceted too (Client offers a distinct-value checklist); and the date filter uses the styled DateRangePicker rather than the native date input (the popover grows to fit). Story/axe/fitness gates + `pnpm check` green; built by Opus 4.8 (Fable-5 re-review pending).
- **`@magna-carta/design-system` — DataTable + Sidebar owner-review refinements (slice 0·7a Phase D)**: from a Storybook review of the Tier-4 satellites. **DataTable:** **typed columns** — a column declares a value `type` in its meta and the table formats + aligns it (`Fees` renders as right-aligned tabular money, `Opened` as a date) via `defaultColumn.cell = typedCell` + `columnAlign`, with `formatMoney`/`formatNumber`/`formatDate` helpers (Intl, display-only; authoritative money stays in `@magna-carta/money`); a **composable toolbar** driving the shared table instance — `DataTable.Search` (global filter) and `DataTable.ColumnMenu` (a dropdown of checkbox items, replacing the row of bare checkboxes); **shift-click range selection** (an anchor row + the live shift state); and the **row-no-longer-resizes-on-select fix** — the checkbox gained `vertical-align: middle` so an empty box and a checked box (which gains the Check glyph) sit on the line identically (the glyph was shifting the line box and resizing the whole row), plus `border-collapse: separate` with the hairline on cells. **Sidebar:** collapsing no longer shifts the icons (group labels keep their height as transparent text rather than `display:none`; the showcase brand does the same), and the collapse **Trigger now says "Collapse"/"Expand"** with a state icon (a labelled menu-button, sr-only + Tooltip in the rail). `pnpm check` + the story/axe/fitness gates green.
- **`@magna-carta/design-system` — slice 0·7a Phase E (CI enforcement + docs close-out; the slice's build complete)** (ADR-0076; plan Tasks 28–29): three design-system CI gates wired into [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — the **token drift gate** (`tz build` then `git diff --exit-code` on `generated/`, the authoritative half of the golden gate), the **static Storybook catalog build** (a per-PR build-error gate), and the **visual-regression job** running the story×theme×mode screenshot sweep inside the pinned Playwright container, with the container tag derived from the `@playwright/test` catalog pin (a prior job's output) so the browser build can't silently drift from the test runner (the harness skips until the first container-rendered baselines exist, so the gate is inert until then). The flagged **no-emoji gate** is resolved as the **fifth off-token fitness scanner** — it bans the pictographic Unicode ranges (emoji planes U+1F000–1FAFF + Misc Symbols U+2600–26FF, where an emoji's base always falls) across the UI-source sweep, deliberately leaving the text symbols the codebase uses in comments (arrows → ↔, the dingbat ✕) alone. Docs close-out: [`docs/conventions/ui-design.md`](docs/conventions/ui-design.md) promoted from stub to the **practitioner standard** (how to add a token / author a theme, the component-build loop + idioms, the machine-checked rules vs. the review-only ones, the definition of done, the VRT baseline discipline). Built by Opus 4.8 during the Fable-access gap (Fable-5 re-review pending — model-split policy).
- **`@magna-carta/design-system` — Tier 3 & Tier 4 components + the Tier-4 satellites (slice 0·7a Phase D, complete)** (ADR-0076; plan Tasks 20–27): the floating, composition-heavy, and app-shell tiers. **Tier 3 (floating):** the **Dialog** exemplar + **AlertDialog, Sheet, Popover, DropdownMenu, Toast** (svelte-sonner styled to `mc-*`), all on the floating module's two-level wrapper rule + token z-scale + presence constants; the **CSP scroll-lock `pnpm patch`** (`patches/bits-ui@2.18.1.patch`, rewriting Bits' restore to the CSP-clean `style.cssText`) landed with the first scroll-locking float and is asserted by the re-runnable spike (re-check on every bits-ui/svelte bump). **Tier 4 (composition):** the **Select** exemplar (the bits listbox parts Combobox reuses; `allowDeselect`, list-order multiple value, the generic floating-anchor sizing), **Command** (the Cmd+K palette hosted in a Dialog; the matcher a seam), **Combobox** (consumer-controlled, data-safe `inputValue`, virtualized past ~200 rows via the `internal/virtual-list` wrapper over `virtua`), **Calendar / DatePicker / DateRangePicker** (typed `CalendarDate` per ADR-0055; native month/year jump-selects; `minValue`/`maxValue` pass-through; drag-to-select range with the grey per-side endpoint rings + the grey-blended rounded "today"), and the **Form field family** (formsnap + superforms field components over our inputs, Standard-Schema/zod contract, the SvelteKit `$app/*` Storybook stubs, email-TLD validation against the IANA `tlds` list — the same list the app's form schemas import). **Tier-4 satellites:** the **DataTable** — a thin Svelte-5 runes adapter over `@tanstack/table-core` (`createSvelteTable` bridging table-core's imperative state into `$state`/`$effect.pre`; `FlexRender` + `renderComponent`/`renderSnippet`) with styled `<table>` primitives, sorting (+ `aria-sort`), row selection, column visibility, and dense/empty/skeleton states over a 100-row matters table — and the **app shell**: a **Sidebar** (page-archetypes Layout A — a `<nav>` landmark that animates to a collapsed icon rail; labels go `sr-only` so links keep their accessible name and a Tooltip surfaces the name on hover/focus; new `size.sidebar`/`size.sidebar-rail` dimension tokens so the recipe carries no literal width) and **Resizable** split panes (paneforge `PaneGroup/Pane/PaneResizer`, the handle orienting off `data-direction` and brightening to the focus colour while dragging). Every component story-first with per-story axe; `svelte-check` + `pnpm check` + the fitness gates green. Built by Opus 4.8 during the Fable-access gap (Fable-5 re-review + the per-tier NVDA passes + owner Storybook sign-off pending — model-split policy).
- **`@magna-carta/design-system` — Tier 2 components (slice 0·7a Phase D, the first Bits-UI-backed tier)** (ADR-0076; plan Tasks 18–19): the **Tabs** exemplar plus **Switch, Checkbox, RadioGroup, Accordion, Tooltip, Avatar, Progress** — each a thin wrapper over a Bits UI v2 primitive (behaviour + a11y from Bits) styled by a token-only `mc-*` recipe keyed off Bits' `data-state`, story-first (svelte-csf v5) with per-story axe. **Patterns the tier establishes:** the thin-wrapper idiom (`WithoutChild`/`WithoutChildren` + `bind:ref`); recipes driven by `data-[state]`/`:disabled`; **Bits stories MUST whitelist controls** (`parameters.controls.include`) because Bits' `Without<…>` prop types materialize every HTML attribute as a control (Tabs.Root showed 439 rows before the whitelist); **a control only applies live if its prop is in `args`** (not just `argTypes`); **disabled mutes colour at rest** (not just `cursor`), with `:disabled` rules ordered after the active/checked rules to win specificity; Lucide deep-imports for icons (Checkbox check/minus, Accordion chevron — `@lucide/svelte` added to the package). **Tooltip** is the first floating component: portaled, the floating module's z-layer + fade presence, Floating-UI collision avoidance + `collisionPadding` + `max-w-xs` so it never overflows, and a `Tooltip.Provider` (in each story; apps put one at the root). **Tabs** ships horizontal + vertical orientation. **Deferred:** the Accordion open/close height animation (needs Bits' runtime content-height var, which the purity-gated `components.css` can't hold — it's the first JS-driven animation and lands with the `prefersReducedMotion` JS gate). Package `svelte-check` clean; 458 tests green. Every story `play` reads as a labelled checklist — its assertions are wrapped in named `step()` calls, so the Interactions panel and the behaviour-test output both narrate what the component guarantees. Built by Opus 4.8 (owner-directed continuation; Fable-5 review pending — model-split policy). The Tier 2 NVDA pass + owner Storybook sign-off are the batch-close gate before Tier 3.
- **`@magna-carta/design-system` — catalog reorganized into semantic categories** (slice 0·7a Phase D): story titles moved from a flat `Components/*` to `Inputs` / `Compound Inputs` / `Actions` / `Data Display` / `Feedback` / `Layout` / `Foundations` (+ a future `Overlays`). Done while the catalog was small and no VRT baselines were committed (re-titling changes story IDs). The **Input** `type` became a closed `InputType` union with one story per type (each carrying its real validation/input-mode), a `tel`→"Telephone" display-label map, and a `type` dropdown; **FileInput** (styled `type="file"`) was added as its own Tier 1 component; the Card/Skeleton/Label stories' bare-`<Story>`-children double-render was fixed (explicit `{template}` snippet). The Compound-Inputs inventory (Money/Phone/Password/Date/Country/County/Address/Payment/National-ID/ColorPicker) and future families (Slider, DropdownMenu, ContextMenu, AI) are flagged in the package `CLAUDE.md`.
- **`@magna-carta/design-system` — Tier 1 components (slice 0·7a Phase D, first tier)** (ADR-0076; plan Tasks 16–17): the styled component layer — each a native element (no Bits at this tier) with a token-only `mc-*` recipe, story-first (svelte-csf v5) and per-story axe. **Button** (primary/secondary/destructive/ghost × sm/default/lg/icon; renders `<button type="button">`, or an `<a>` when given `href` — no text-"link" variant, a button always looks like a button; props are a relaxed button/anchor intersection, not a union, which keeps svelte-check happy), **Input** (text-like types only, as a closed exported `InputType` union driven by a `control: "select"` dropdown — file/checkbox/radio/range/color and the button types are out, the recipe being a text field), **FileInput** (the styled `type="file"` control — its value is user-set and read-only so it does not two-way bind, with its only reliably-styleable part `::file-selector-button` dressed to the secondary-button look; the bare control only, the full upload UX — drop zone, file list, progress, validation, R2 — building on it in slice 2·1), **Textarea** (vertical-only resize), **Label** (native for/id association), **Badge** (typed variant record: primary/secondary/destructive/outline), **Card** (six-part composition Root/Header/Title/Description/Content/Footer, flat + hairline, no shadow), **Separator** (decorative role="none" vs semantic role="separator"+orientation), **Skeleton** (a pulse between two token colours — opacity literals are banned and there is no opacity token — with a `prefers-reduced-motion` guard; a visible neutral base so it reads on near-white surfaces), **Alert** (Root/Title/Description; info/success/warning/danger as **solid status panels** on the AA-gated `status.<v>`/`status.<v>-foreground` pairing, ARIA role derived from the variant — assertive for danger/warning, polite for info/success), and **Keyboard** (mono, sunken keycap; the element stays `<kbd>`, the component spelled out per golden rule 12). **House conventions:** the multi-part **namespace index** (bare + prefixed exports), layout width as a `w-full`/`h-full` utility (the recipe owns visual design; `%` is not tokenizable), a single **merged-edge focus on every control** (border + outline one shape at zero offset — no detached ring), and the 1px `--mc-border-width-default` hairline token. **Catalog model (owner-settled):** one story per variant (per orientation/state where there is no variant axis; single-instance components get one story), **no Playground** — the first story is the autodocs Docs-page Primary the Controls panel drives; every non-variant prop (`size`, `disabled`, `href`, `placeholder`, `type`) is a **Control, not a story**. Controllable native attributes are declared as **JSDoc'd props on the component** (not left to the attribute spread) so docgen lists them under the one "Properties" group with descriptions — no floating controls, no second category. Each component's **Docs page is the single review surface** (description → controllable Primary + Controls → the "Properties" table → every instance as its own block); behaviour a showcase story can't show rides a hidden `!dev`/`!autodocs` test story. Built Opus 4.8 across an extended owner design review (2026-06-13) that drove the merged focus, the styled file input, Badge's `default`→`primary` rename, the Skeleton-visibility fix, removal of the Button `link` variant, the Keyboard rename, and the per-instance catalog model. Package `svelte-check` + `pnpm check` clean. The Tier 1 NVDA pass + owner Storybook sign-off are the batch-close gate before Tier 2.
- **`@magna-carta/design-system` — Storybook docs + visual-tests addons** (slice 0·7a Phase D): `@storybook/addon-docs` drives an autodocs Docs page per component (enabled globally via the `autodocs` tag in `preview.ts`) — the catalog's single review surface; and `@chromatic-com/storybook` adds the Visual Tests panel, **installed but inert** until a Chromatic token is configured (the repo's primary visual regression remains the self-hosted Playwright harness, with Argos the recorded SaaS upgrade — revisit which is adopted).
- **`@magna-carta/design-tokens` — `border-width.default` (1px) hairline primitive** (slice 0·7a Phase D): a mode-invariant dimension token the Tier 1 control recipes consume for the design language's 1px hairline structure (design-language doc §6), so `components.css` carries no literal border widths. Mirrors the focus-ring width/offset precedent; the design-system boundary self-check already anticipated `--mc-border-width-default`. Regenerated `generated/tokens.css` and re-pinned the golden in the same commit (`tailwind-theme.css` unchanged — recipes consume the var directly); all five token gates green.
- **`@magna-carta/design-system` — the component-layer foundation, scaffolded with its catalog and enforcement (slice 0·7a Phase C)** (ADR-0076; spec + plan as below): the styled layer's infrastructure, built and reviewed before any component exists. **Utilities:** `mergeClasses` (clsx + tailwind-merge with empirically-verified token-namespace registrations — named duration/z scales need `extend.classGroups`, discovered and tested; a theme-derived suite demands a merge case for every generated namespace), the bits-ui wrapper type helpers (re-exported), the theme-preference seam (localStorage until slice 0·7b; the pure `applyThemeToDocument` shared by app and catalog; a boot-script-mirror test mechanically pins `apps/web/src/app.html` to the module's literals). **App wiring:** Tailwind v4 + the three token CSS imports + `@source` through the pnpm symlink, the root `+layout.svelte`, and the inline no-FOUC boot script — pipeline proven in a real production build. **Storybook 10 live** (`tools/open-storybook.cmd`): svelte-csf v5, a theme×mode toolbar driving `applyThemeToDocument`, the Token Board as front page; stories triple as Vitest browser-mode behavior tests and per-story axe checks with violations enforced as failures; owner launcher folder `tools/` (ASCII-only `.cmd` rule learned the hard way — multibyte characters shear cmd.exe under codepage 65001; `.gitattributes` now pins `*.cmd` CRLF). **CSP spike verdict** (`test/csp-spike/VERDICT.md`, three engines): Floating UI positioning is CSP-clean (CSSOM, not attributes); the sole violation is Bits' scroll-lock restore `setAttribute("style")` — severe under strict `style-src` (page freezes post-close in Chromium/WebKit); mitigation = a one-line `pnpm patch` scheduled with the first Tier 3 component; the probe asserts the verdict and fails on upstream change. **Floating module** (`src/lib/internal/floating.ts`): the token z-scale as the only z home, six presence constants from motion tokens with `motion-reduce:transition-none` structural, `floatingContentClasses()` as the canonical Tier 3/4 builder; the missing duration/z Tailwind namespaces were source-verified against installed Tailwind (`--transition-duration-*`, `--z-index-*`) and mapped. **Visual-regression harness** (`visual-regression/`): dynamic story×theme×mode matrix over the static catalog, `reducedMotion` + animations disabled, container-only baseline discipline (no Docker locally — explicit named skip until CI generates the first baselines). **Golden-rule-2 fitness gates** (`test/fitness/`): Tailwind arbitrary values (with the data/aria-variant carve-out), raw color literals, raw `z-`/`duration-` numerals, the bits-ui import boundary, Lucide deep-import form, and components.css token purity — every gate mutation-verified with file:line failure output; a justification-required `fitness-allow` escape whose inventory is itself asserted (currently zero allowances). Package 325 tests; repo 724; area `CLAUDE.md` carries the accumulated review notes (focus-ring tokenization required before the Button exemplar; the unimplemented no-emoji gate decided at CI wiring; the dropdown-vs-sticky z-order workshop item). **Phase B (the owner brand + design-language workshop) now gates Phase D's components.**
- **`@magna-carta/design-tokens` — the design-token package, built (slice 0·7a Phase A)** (ADR-0076; spec [`docs/specs/2026-06-10-design-system-foundation-design.md`](docs/specs/2026-06-10-design-system-foundation-design.md); plan [`docs/specs/2026-06-10-design-system-foundation-implementation-plan.md`](docs/specs/2026-06-10-design-system-foundation-implementation-plan.md)): the single source of design truth, realized. **Source:** spec-pure DTCG 2025.10 (purity-gated — no `$extensions`, no vendor keys, every token carries its own `$type`) — generated 12-stop OKLCH neutral/brand ramps + 5-stop status mini-ramps, `tokens/semantic.json` as the light/default truth (aliases only), the **shared `tokens/modes/dark.json` overlay** (re-points semantic aliases to ramp positions; themes swap ramp values only — a structure the review forced honest, replacing a duplicated light file and a false per-theme-overlay promise), and a DTCG resolver document (theme × mode contexts; provisional `slate` theme). **Build:** Terrazzo 2.3.0 (pinned exact) emits committed `generated/tokens.css` (context blocks per theme×mode + gamut media refinements) and the Tailwind v4 theme — where review caught the plugin inlining light-frozen alias targets and the fix landed the shadcn-proven **hand-authored `@theme inline`** block (semantic colors + elevation map to cascading `--mc-*` variables; primitive color utilities deliberately inexpressible). **Gates (140 tests):** spec-purity (incl. resolver vendor-key absence), completeness (every theme×mode resolves every semantic token; the semantic-to-template coupling; the mode-overlay-subset check that closes the silent half-theming class; strict context-matrix equality), **WCAG 2.2 contrast over every theme×mode** (13-pair contract in `src/contrast-pairs.ts` with typed minimums; APCA computed advisory-only; provisional values tuned by alias re-pointing — all text pairs ≥ 5.17), golden-file byte pins (the Style-Dictionary-escape-hatch insurance; formatter-exempt alongside `generated/`), and generator invariants. **Theme engine** (`scripts/generate-theme.ts`): anchor options (brand hue/chroma, neutral tint) → fixed-lightness-ladder, gamut-mapped ramps; generation-time contrast validation against the real semantic/mode/pair files with named violations; `--validate <file>` re-check mode for hand-tweaked themes; slate's neutral/brand ramps regenerated through the engine and **pinned generated-not-hand-drifted**. Slice 0·7a runs as Phase 0's parallel UI-foundation lane on branch `slice-0.7a-design-system`; Phase B (the owner brand + design-language workshop) is provisioned by three research reports in [`docs/research/`](docs/research/) (motion stack — Svelte built-ins + View Transitions at 0 kB core, GSAP lazy for signature moments; brand typography — P22 Morris Troy the researched front-runner, outlined-SVG wordmark architecture; Magna Carta text motif — owner approved the 1297-statute-lineage texture + the cited foundational-law quote collection).
- **Network-resilience standard.** A forward-binding convention for behaving well on slow, metered,
high-latency, and intermittent connections — resumable transfer through the established R2 seam
(multipart-resumable upload, presigned-GET download, HTTP Range serving) over any monolithic in-app
fetch, no hardcoded timeouts that cache-bust a transfer still making progress, last-known-value
rendering with honest transfer status, and a per-route cold-load transfer budget. The backend transfer
paths already realise the resumable seam, so the standard codifies the reference and names the forward
seams (a shared client transport chokepoint, a load-profile transfer-weight measurement, the budget
fitness function) rather than retrofitting shipped code.
- **Incremental TypeScript type-checking (project-references build graph).** A generated
`tsconfig.build.json` per package (`tooling/tsconfig-refs`) plus a `vp run typecheck` task
(`tsc -b`) give the workspace a package-granular, cached type-check that scales with changed code
rather than total code — the foundation for the TypeScript 7 native compiler (`tsgo`) later. Landed
non-gating (not yet wired into `pnpm check`) while pre-existing latent type errors it surfaced are
fixed. Rationale and rollout: [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md).
- - **Account Settings surface.** A person-scoped identity and credentials surface at `/account`,
  reached from the profile menu — Profile (name, email, avatar) and Security (password, two-factor,
  active sessions). It stands apart from the workspace: a stripped secure shell with no app sidebar
  or top-bar tools, entered from the profile menu and left by the brand mark (Home) or Close (back).
  Every control is an honest seam today; the surface, its rail, and the flow are live, and each
  control activates when authentication ships. The secure shell is built to be reused by the
  firm-user administration surface.
- AI-Text Detection (Pangram) — the AI-Text Detection tool now works end to end: paste text and get a calibrated likelihood band (a signal, not proof). Detection is platform-managed, off by default per firm (an admin enables it in settings before any text is sent to the provider), and metered per firm. Backend only; the interface arrives with the design-system shell.
- **The real App Shell (slice 0·7b, stage 1).** `apps/web` stops being a stub: the assembled chrome (ink sidebar with the brand corner + the canonical destination registry, data-driven and hide-in-place filtered; the new design-system `TopBar` family) frames a routed work canvas. The Ctrl+K command palette works (Dialog-hosted Command with navigation as its first provider), Home greets with the serif masthead + the compact quote-of-the-day colophon over an honest heritage empty state, Matters lands on its empty state, and **Settings · Appearance is live** — theme/mode/density/motion pickers over the wired personalization axes, applying instantly and persisting. Route errors get the archetype error pattern (`+error.svelte`, Retry + the Error ID slot). New design-system pieces: `TopBar` (Root/Search/Actions/IconButton, the quiet chrome keycap), `EmptyState` (the heritage watermark pattern), a `size.prose` readable-measure token — and a real fix: the Dialog/Sheet/Popover/DropdownMenu Root wrappers claimed `open` was bindable but never declared `$bindable`, so every controlled overlay silently failed; all four now forward the bind (AlertDialog already did).
- **Build stamp overlay (developer tooling).** A new Settings · Developer control pins a small floating badge to the screen showing the live clock beside the running build's commit, mode, and build time — so a screen recording or a bug screenshot always carries "when, and which build". Drag it (or arrow-key it while focused) to any of the four corners; the chosen corner persists per browser. Development builds only: it is compiled out of production entirely and gated behind the developer-settings master switch.
- **Individual tools are now searchable in the command palette.** Pressing Ctrl+K and typing a tool's name — "speed", "whois", "metadata" — used to surface only the Tools destination, never the tool itself. The palette now renders a Tools group derived from the tool catalog and its presentation layer, the same registry the Tools listing shows: a built tool navigates straight to its page, and a not-yet-built one appears as a disabled "— soon" row. Each entry is findable by more than its name — its description, subject, and lay synonyms feed the search, so "bandwidth" reaches the Network Speed Test and "domain" reaches the WHOIS lookup.
- **A compliance control baseline maps the platform's technical controls to SOC 2, GDPR, PCI DSS, and ISO 27001.**
New standard [`docs/conventions/compliance.md`](docs/conventions/compliance.md) cross-walks the existing controls
— tenancy isolation, envelope encryption + crypto-shred, RBAC, redact-by-default telemetry, backup/DR, PCI
SAQ A — to each external framework requirement and registers the open gaps (subject-level erasure/DSAR, data
residency, breach-notification workflow, audit viewer/retention). The controls are engineered now; formal
attestation/certification stays an owner/legal track. Payments are pinned to PCI **SAQ A** via a hosted payment
modal (card data never enters the app). See `ADR-0166`,
`ADR-0181`, and the Proposed `ADR-0190` /
`ADR-0168`.
- **File unlock & password recovery — open a locked file you have the password for, or recover one you don't, without the bytes ever leaving the firm boundary.** A new Tools-area utility handles encrypted PDF, ZIP, and OOXML (Office) files two ways. **Unlock** strips the encryption from a file when you supply the password and returns the cleartext copy. **Recover** attacks an unknown password: it extracts only the file's password _hash_ — never the file itself — and runs a dictionary-and-rules search for it across a fan-out of isolated compute shards, returning the password to you the moment one shard finds it and cancelling the rest. Recovery is triaged by how the file was encrypted: modern slow-key-derivation formats that a CPU cannot brute-force in reasonable time are reported as needing GPU hardware (a later escalation rung) rather than run to a futile timeout. Every operation is button-initiated (nothing ever cracks on its own), gated by a `tools:decryption` permission and a per-file authorization attestation, and audited with the outcome only — the recovered password and the extracted hash are never written to an audit row, a log, or an error, and the file is never stored. A recovered password is shown once to the person who started the job, bound to their identity (another firm member holding the job link cannot read it), and purged from storage after a short retention window. The engine is a single in-house Rust core (compiled to WebAssembly for the app and to native for the search shards) with no C/C++ dependency. The end-user interface follows in a later pass.
- - **`vp run bootstrap` — make a fresh worktree runnable in one command.** The Rust→WASM artefacts that
  `packages/{pdf,decryption,email}` import are generated and git-ignored, so a new worktree began life
  unable to type-check or test those packages until someone rediscovered why. Bootstrap builds only the
  artefacts whose Rust inputs changed, is a no-op when they are current, and points cargo at a target
  directory shared across worktrees so the second worktree's build is a cache hit rather than a cold
  dependency compile. The pinned-Docker `vp run rust-wasm-build` remains the canonical build for the
  deploy pipeline.
- **`pnpm check:scoped` — the inner-loop quality gate, and now the pre-push hook.** Runs only what the
  current diff can break: format and lint on the changed paths, the incremental `tsc -b` type-check, and
  `svelte-check` or the Rust gate only when a `.svelte` file or a crate was actually touched, reporting
  whatever it skipped. The pre-push hook runs this scoped gate for fast local feedback; the exhaustive
  whole-repo gate now lives in CI (see below).
- **GitHub Actions is the whole-repo gate of record** (`.github/workflows/gate.yml`). It runs the full
  `pnpm check` + `vp test`, the governance lints, migration integrity, all four contract-drift checks,
  and the changed-container acceptance suites on every pull request into `main` and every push to `main`
  — reproducing the Docker WASM build and the Playwright browser the vitest runner needs. Moving the
  exhaustive sweep off the developer's machine and into CI keeps cloud pushes fast (the hook does the
  seconds-long scoped subset) while `main` still only advances on a green whole-repo run.
- **The developer console goes modular; error pages get version tracing; the top bar settles.** The flask panel is now a console shell over a typed module registry — a future tool is one component plus one registry entry — with the motion module as first resident, grown three ways: a motion-surface picker (sidebar, command palette, menus, sheets, tooltips, gilt draw, signature moments) that focuses the controls on one animation and replays it through the real production path where one exists; a fourth editable easing (`decelerate`, which the gilt tab-underline draw actually consumes); and **Copy motion report** — a paste-ready shipped-versus-tuned diff ending in the exact token values to make permanent. Error pages now carry build identity (`build: <commit> (<mode>, built <time>)` baked in at build time) in the copyable trace block, plus the browser line — one paste pins exactly which build misbehaved. Top-bar motion: the right-side actions hold still during sidebar collapse (own view-transition group), the palette trigger sits flush on the sidebar seam and is the one element that travels with it, and the white flash at the screen edge during slow toggles is gone (static root snapshots while a sidebar transition runs). Fixed along the way: `Tabs.Root` never forwarded `bind:value` (the Dialog-family `$bindable` defect, one more instance) and the motion module's Reset all crashed on `structuredClone` of a reactive proxy — the owner's "settle/standard corruption" root cause.
- **The developer menu (dev builds only) + a directional fix for the sidebar conveyor.** A flask in the top bar (left of the profile circle) opens developer-only controls — the first residents tune the app's motion live through the token indirection: a logarithmic transition-speed multiplier with presets and a live per-rung duration readout, plus an interactive cubic-bezier graph (draggable gilt handles, paired number fields) over the settle/travel/standard easing tokens, with per-browser persistence, replay, and reset. None of it ships to production (`import.meta.env.DEV`-gated dynamic import). The panel's own slow-motion immediately earned its keep: the sidebar collapse was stacking the incoming icon rail ON TOP of the outgoing labels (their first letters vanished under the ink), and the brand wordmark faded in after the slide while everything else was revealed by it. View-transition snapshot stacking is now directional (`runViewTransition` stamps the direction on `<html>`; collapsing keeps the old wide rail on top so labels stay whole under the sweeping seam) and the wordmark/label colour flips are instant, so the conveyor is the only motion in both directions.
- **The developer console gains a Resources module** (development builds): a live, honest browser-resource monitor — memory where the browser truly exposes it (labeled as approximate; "unavailable" stated plainly elsewhere), responsiveness as event-loop lag, long tasks, and frame intervals (with the candor that browsers expose no CPU percentage), storage quota, a recent-network window, and a cross-tab count of open Magna Carta tabs. Every sampler runs only while the console is open — the monitor costs nothing when nobody is watching. An Active Work section ships as an honest seam for the account activity inventory (open editing sessions, scans, conversions, queued jobs) that lights up when its endpoint exists.
- The Directory can now hold each person's and organization's email addresses and resolve an address back to the entity that owns it. A contact email is labelled and can be marked primary (at most one primary per entity, enforced on write), is kept as a soft-deletable temporal row, and — when an entity is merged into another — resolves through the merge to the surviving record. This address-to-entity lookup is the capability email filing uses to match a captured message's participants to the people and organizations already in the Directory.
- Docs maintenance automation — fragment assembly now runs on every push to `main` (`.github/workflows/assemble-docs.yml`), so the changelog, Decision-Log register, and STATUS render with each merged PR; the judgment half (coverage audit, drafting, roadmap rollup) ships as the weekly propose-only docs-sync routine (ADR-0058 realized). The roadmap's future source of truth lands with it: the `roadmap.d/` feature ledger — every white-paper capability as a status-carrying node, initially populated by a verified audit of the whole tree. System home `docs/maintenance/`; ledger format `roadmap.d/README.md`; procedure `.claude/skills/docs-sync/`; verified baseline `docs/maintenance/reports/2026-07-14-baseline.md`.
- **Email files can now be inspected.** A `.eml`, `.msg` (Outlook), or mbox file dropped into the new **Email Inspector** tool is read into a structured report — sender and recipients, subject and dates, the full ordered header list, the attachment list, and the authenticity evidence a message carries (its DKIM signature, authentication results, and delivery chain), all shown verbatim with no verdict attached. Nothing is stored; the file is parsed and the report returned.

Underneath sits a new pure-Rust parse engine that reads all three formats, extracts each attachment on demand rather than holding a whole mailbox's attachments in memory at once, and is hardened against malformed input — it runs where a crash would take down the whole request handler, so every structural fault in a hostile file becomes an ordinary error instead. It is the foundation the coming email-into-matters capture and discovery features are built on, and it is deliberately honest about what it does not yet do: an Outlook message whose only body is compressed RTF shows no body text until that decoder is added, and turning an email into a PDF remains a separate future step.
- **A new `EyebrowLink` design-system component** — a masthead eyebrow that navigates: the subtle letterspaced small-caps kicker rendered as an anchor, with a consumer-supplied leading icon and label. Unlike a button repurposed as a link it is a label, not a control, so it carries no control height — the ink sits flush with the block-start edge of its box, and a page frame's equal padding reads symmetrically (a leading arrow lands the same distance from the frame's top as from its start). The 24x24 pointer target (WCAG 2.5.8) comes from a transparent overlay that enlarges the hit area without enlarging the box. The Tools page's back-link now composes it, retiring the inline letter-spacing and negative-margin workarounds it needed while built on the button.
- **The four-step upload ceremony now runs locally end to end under `wrangler dev`.** Direct-to-R2 upload is a presigned-PUT (or multipart) ceremony whose bytes reach storage only when a presigned R2 host resolves and an R2 object-create event feeds the ingest queue — neither of which local object storage provides, so an upload never landed and ingest never ran off production. Off production (no real R2 S3 credential set) the upload presigner now points its PUT and part URLs back at the Worker itself, and a development-only route (`/api/__dev/r2/object`, `/api/__dev/r2/part`) accepts those writes to the Miniflare `R2` binding and enqueues the ingest message directly — standing in for the R2 event notification. The client runs the identical ceremony in both environments; nothing is stubbed client-side, and a version now transitions from pending to clean (or quarantined) locally. The dev route is guarded three ways — it serves only when the real R2 credential set is absent (the same fail-closed signal that selects the dev presigner, so production answers a bare 404), it sits behind the session + `files:upload` chokepoint, and it writes only the object key the firm's upload session minted. Being same-origin it exercises no CORS, so it cannot prove the production cross-origin path; the first R2 bucket CORS configuration is checked in (`apps/worker/r2-cors.json`) with its out-of-band apply step in the operations runbook. Download/preview presigning is unchanged.
- **Matter file manager — a folder tree read, an upload-status poll, and ingest outcome in the file list.** The file-manager contract now lets a client browse and observe what the backend already stores. `GET /api/v1/folders?matterId=` returns a matter's folder tree in adjacency-list form. `GET /api/v1/uploads/{id}` reports an upload session's progress — how far the direct-to-R2 ceremony got and what ingest decided about the bytes (pending, clean, quarantined, or abandoned), with the quarantine reason when a file was rejected as malware. `files.list` and `files.get` now paint each row from its display version (version number, size, sniffed type, scan verdict, status) in one call with no per-row fan-out to the version history, and `files.list` gains an opt-in `includePendingAndQuarantined` flag that also surfaces a first upload still processing or rejected — so a flagged file says so where the user dropped it, rather than silently never appearing. A rejected row always carries a null `currentVersionId` and cannot be downloaded. The default file listing is unchanged: only files with a committed clean version appear.
- **FileIcon, Breadcrumb, ContextMenu, Tree, and Dropzone — design-system primitives for the file manager.** FileIcon maps a file's content type and/or name to a Lucide glyph (PDF, Word, Excel, PowerPoint, image, video, audio, archive, text, code, email, plus open/closed folder variants and an unknown fallback), sized by its recipe rather than a prop, and decorative by default so the file name beside it carries the label. Breadcrumb renders a folder path as a navigation landmark with an `aria-current` leaf, collapsing the middle of a deep path behind an ellipsis affordance that reveals the full trail in place — the current folder is always kept readable, never truncated. ContextMenu adds right-click row actions — the sibling of DropdownMenu, wrapping the same Bits UI menu behaviour and a11y with the same part shape and recipe look, summoned over a trigger region at the pointer. Tree is a folder tree with the full WAI-ARIA tree view keyboard model — roving tabindex, arrow keys to move, expand, collapse, descend and ascend, Home/End, and first-character typeahead — with a bindable expansion set the consumer persists; it is built without a Bits primitive because the pinned bits-ui ships none. Dropzone is the drag-and-drop upload surface layered over the FileInput control: a distinct drag-over state, dropped files handed to the consumer, full keyboard and screen-reader operation through the underlying input, and no validation or rejection of its own. Each ships a Storybook catalog entry with named-step behaviour tests — including explicit Tree keyboard coverage and Dropzone drag/drop — and joins the visual-regression matrix.
- File Repair & Salvage can now save its output into a matter: repair a corrupt
file and attach the result as a new version of an existing file (or a new
file), or carve embedded files out of a damaged container and attach each as a
new file. Saved output passes the same malware gate as any upload — a flagged
reconstruction is quarantined, never silently committed — and each saved
version carries an honest, durable record of what the recovery could and could
not reconstruct.
- File Repair & Salvage — a tool that recovers content from structurally
corrupted, truncated, or damaged files. Diagnose a file's recoverability, then
repair it (ZIP/OOXML, CFB/OLE2, PDF cross-reference rebuild) or carve embedded
files out of a damaged container. Every recovery reports an honest loss
manifest — what was recovered, what was lost, and what was synthesized — and
never claims more than it can prove. Reconstructed output is re-scanned through
the malware engine before it is returned; anything the scan flags is withheld.
This first release is stateless (nothing is persisted); attaching salvaged
output to a matter follows.
- **Firms now carry a `data_region` that pins their storage jurisdiction.** A new control-plane column
(`us` default, `eu` supported) is threaded through provisioning: an `eu` firm's R2 bucket — and its
object-create notification rules — are placed under Cloudflare's EU jurisdiction, and the firm-database
Durable Object addressor is made jurisdiction-capable. Wiring that capability to every data-access call
site is a follow-up activation step, so no firm is end-to-end EU-resident yet. Set once at provisioning;
no cross-region moves. `us` is North-America placement; Canada is reserved.
- **Password-recovery GPU benchmark harness — the first step toward cracking modern encryption on rented cloud GPUs.** The file-recovery tool's CPU rung tops out at common-password guessing; modern slow-key-derivation formats (Office 2013+, PDF R6, 7-Zip) need a GPU, which Cloudflare does not rent. A new internal tool (`@magna-carta/gpu-benchmark`) measures real hashcat throughput for every recovery hash-mode on rented [vast.ai](https://vast.ai) GPUs and records the numbers into a committed rig-profiles table — the empirical input that decides which rigs the production GPU rung rents and how deep it can search. It rents the cheapest verified offer for each candidate GPU by **renting a public hashcat image and provisioning our thin layer at runtime** (no custom image, build, or registry — the component's lifecycle stays git-driven, and a public base means no registry credentials on the rented box), runs the benchmark, and **guarantees the rig is torn down** even on failure. Teardown is a dead-man's switch: a guaranteed per-run destroy, a reconciliation sweep at the start and end of every run, and a manual `--reconcile` command — the authoritative kill always stays with the key-holder, never on the untrusted rig. A rig that fails to boot is destroyed and retried on the next-cheapest offer so one bad host never fails the run, and rigs are restricted to the firm's data-region geography. The vast.ai integration is validated against the **live** API, and real measured throughput is recorded (RTX 5090 chosen as the best value; datacenter cards excluded as measured-slower-and-pricier). The design (rented-GPU rung driven by a Durable Object coordinator, hashcat as the engine, tiered escalation within a dollar-and-time cap, and a hash-only confidentiality boundary that keeps file bytes and client identity off rented hardware) is recorded; wiring the rung into the recover flow follows.
- **Outlook messages whose only body is rich text now show that body.** A `.msg` file often stores its body as compressed RTF; the Email Inspector previously showed nothing for such a message. That body is now decompressed and surfaced. It is shown as-is, not converted or rendered, and a corrupt or oversized body is skipped rather than failing the whole message.
- **Network Speed Test — the Tools area's first working tool.** It measures the connection you are on: download and upload speed, latency, and jitter, on the same measurement engine Cloudflare's own speed test uses, so the numbers are comparable. Download and upload each draw a line-and-area chart with a 90th-percentile rule under the headline figure, and the run earns a Cloudflare AIM quality rating for streaming, gaming, and video calls once it finishes. Beside all of it sits the round trip to Magna Carta, measured as a real authenticated request — the answer to the question a slow morning actually raises: is it the internet, or is it us? A full test transfers around 200 MB and never begins until you press Start; a low-internet-usage mode in the overflow menu trades comparability for a fraction of the data, and a finished run can be saved as a plain-text report. Nothing is stored, sent, or attached to a matter.
- **OCR — a pure-Rust text-recognition engine reads scanned pages into searchable facts.** `POST /api/v1/ocr` (gated by a new `tools:ocr` permission) accepts an image or a PDF and returns per-page recognized text, word-level bounding boxes, confidence, and orientation, with provenance stamped onto every result. Which PDF pages get recognized is decided by what a reader actually sees, not by the mere presence of a glyph: a page whose text already covers it is left alone, while a scanned page carrying only a Bates stamp in the corner is still recognized — so stamping a production never silently discards the pages it stamps. An outsize exhibit (an E-size survey or CAD drawing) is rastered at whatever density fits the pixel budget rather than refused, while a page whose declared geometry is a memory bomb is refused outright rather than recognized into confident-looking nonsense. `?force=true` re-recognizes every page, so a document can be re-OCR'd with a newer model. The engine runs in its own firm-agnostic container (PaddleOCR PP-OCRv6, small tier, through the Rust `ort` binding to ONNX Runtime) that never learns which firm it serves and never fabricates a result — an inference fault surfaces as a retryable error, not a blank page, and a region detection found but recognition could not read is reported as undecoded rather than dropped, so a page of unreadable text is never mistaken for a blank one. The end-user interface follows in a later pass.
- Text-preserving redaction now handles pages whose content stream cannot be
faithfully re-encoded (inline images and other constructs the PDF library
cannot round-trip). Instead of flattening the whole page to a raster, the engine
copies the original stream bytes verbatim and re-encodes only the operators it
edits, so unrepresentable content passes through byte-identical while the marked
text is removed. The existing redaction path is unchanged for pages it already
handled; the new path is reached only where the page would otherwise have been
flattened, and every result still passes the outcome gate.
- PDF engine: a crate-wide decompression-bomb guard. Every operation now rejects
oversize input and streams that inflate past safe caps, surfacing a typed
`DecompressionBombError` to callers.
- **A PII/erasure registry now attributes every personal-data table to a data subject.** A declarative
manifest (`PII_TABLES`, sibling to `PROTECTED_COLUMNS`) plus a coverage fitness function force every
per-firm table to be classified as PII or explicitly non-PII, so every per-firm table is consciously
classified as PII or non-PII — the seam GDPR subject-level erasure (Art. 17) will traverse. A drift tripwire
keeps it a superset of the Directory merge's reference set. The erasure orchestrator itself is deferred.
- **Searchable PDFs from scans — an invisible OCR text layer makes an image-only page selectable and searchable.** `POST /ocr/searchable` recognizes a scanned PDF and returns it with the recognized text written back over each page in an invisible render mode: copy, select, and full-text search now work, with nothing new visible. The layer is strictly additive — every existing byte of the document is preserved, and a page that already carries real text is left untouched — and deterministic, so re-running the same document produces the same bytes. Text extraction rides a `ToUnicode` map rather than a rendered glyph, so Latin, CJK, and Greek all come back correctly, and the written text is itself findable by redaction. The end-user interface and the ingest-pipeline wiring follow later.
- **Service status — Cloudflare + third-party provider aggregation, operator-posted events, a public feed that survives an outage.** A new service-status system now tracks whether the platform and the outside providers it depends on are working: a component matrix for our own primitives (green by default, moving to a problem state only on real evidence — an operator declaration, an error-rate signal, or a failed health probe — never by guessing), and upstream aggregation of Cloudflare, GitHub, and other Statuspage-based providers' own published status. Platform operators (a new, MFA-required, individually-granted role) can declare a service event, post rolling updates, and resolve it, all attributed to the operator who acted. The public feed (`status.json`, plus a placeholder page) is served by a new, deliberately isolated status worker that has no dependency on the main application, its database, or any per-firm data — so the status page stays up precisely when an app-wide incident is happening. Rendered UI (the in-app banner, the styled public page) follows in a later pass.
- **Settings become a system; the profile menu becomes a place; the last white line dies.** Settings now run on the approved interaction model's foundation: the section registry carries scope, band, and commit mode (mode follows scope — personal settings apply instantly, firm policy will stage and save), the nav renders two bands ("My settings" / "Firm settings", sticky, with a tightened, sidebar-cousin section list that holds up in dark mode), the developer master switch pulls double duty (off hides AND zeroes every developer control; on reveals them), and theme/developer preferences now sync across browser tabs through storage events. New **Settings · Versions** page: every versioned platform component in one ledger table — the application build renders real data now; the scan engine's three parts, containers, and engines are honest seams until the aggregated versions endpoint ships (requirement filed). The profile icon now opens a real menu: identity seam, a Websites submenu of the Magna Carta ecosystem (status, forums, about, API documentation, changelog — "Soon"-badged dead links by design), **Report a bug** (a dialog assembling a paste-ready trace-grade report; in-app submission arrives with the ingest endpoint), and a Request-assistance seam recording the bug-first support funnel. The command palette lists settings under their band headings, and the search field now recedes into the header at rest (transparent, hairline-marked) while the palette opens geometry-matched over it — same rect, same radius — keeping its own light panel. The intermittent white line at the screen's top-right during sidebar toggles is actually gone now: pixel-verified root cause was the canvas snapshot pair's overflow clip rasterizing one device pixel short at fractional display scaling; the pair is unclipped (it only ever cut off-screen pixels) and 49-step sweeps at both display scales show zero light pixels. Also fixed app-wide: the muted-text utility was a silent no-op (`text-muted` never existed; every occurrence now uses the real `text-text-muted`), restoring text hierarchy in both light and dark modes.
- **Settings become an engraved, modular system: three bands, three postures, one anatomy.** Every settings page now shares a three-story composition — a pinned header carrying the page name, a posture badge ("Applies Immediately" / "Applies on Save" / "Managed by the Firm", plus "Preview" where demonstration values do not govern behavior yet), a per-page documentation seam, and the change-history pull-out; the settings themselves as an engraved table (category plates framed by rules, hairline rows, a shared control column, full-row hover) scrolling in their own container; and on firm draft pages a footer exit pinned to the screen bottom — a "Changes Pending" count badge that opens a jump-to-row recap, a Cancel that turns red once something is staged, and a gilt Save whose every commit passes through a confirmation recap. Staged rows mark themselves with a full-height gilt gutter bar and a quiet "Was: previous value · Revert" line in permanently reserved space — nothing on a settings page moves when state changes, only ink. The machinery underneath: a per-setting definitions registry mirroring the backend's firm-setting shape (only settings with real backend counterparts ship; time rounding now matches the backend's three-way enum), a page draft store, an append-only change ledger (Restore re-applies an old value as a new entry — history is never rewritten) synced live across browser tabs, a mock permission seam, and per-row **Request a Change** on read-only firm rows — pre-scoped with the current value and addressed via a search picker to chosen administrators. A standard settings page is now a registry entry plus definitions; CI fitness checks enforce mode purity and canvas ink purity. The nav reads as three icon-headed bands — My Settings (Theme, Accessibility with a real end-to-end High Contrast axis, Text), Firm Settings (Firm Profile, Users, Matter Numbering, Billing, File Safety & Scanning), and Platform (Beta Access, Versions, Developer) — with quiet "View" tags on pages the member can read but not edit, and honest Soon seams on every designed-but-unwired surface.
- **The shell now shows where Magna Carta is going.** The sidebar carries the platform's full destination map in a draft order — Calendar, Intake, Conflicts Check, Contacts, Messaging, Documents, Forms, Discovery, Custodian (the safe), Time, Billing, Trust, Tools, Reports — each an honest Soon entry that lights up everywhere (sidebar, palette) the day its slice ships, with gilt scroll hints marking hidden depth in the rail's invisible-scrollbar list, and the wordmark now links home. The top bar gains the resting shape of the **Time Keeper** — the future run-from-anywhere timer chip with its elapsed readout — and the search bar quiets to "Search…", teaching its keyboard shortcuts only inside the freshly opened palette and standing down once you type. The profile menu adds the **Account Settings** seam (identity and credentials are deliberately a separate, higher-ceremony surface from work preferences), bug reporting becomes **Report an Issue** with optional in-office recipients and an email-me-a-copy flag, and the 404 page offers a guarded Go Back. Everywhere, designed-but-unwired actions now ship visible and Soon-marked rather than omitted — the shape of what is coming is part of the product.
- **The status page is a real page.** The isolated status worker's placeholder JSON dump becomes a proper public status page, rendered server-side from the live snapshot and readable with zero JavaScript — built to work precisely when everything else is broken (one self-contained response, no external assets, a meta refresh keeping it current). A verdict band answers the only question in one second, active incidents pin beneath it with their updates newest-first in UTC, components render in two calm columns by group, third-party providers state their own weather without ever reading as our outage, resolved incidents remain as the permanent history, and a staleness strip appears whenever the snapshot itself has gone quiet. Provider rows link out to each provider's own status page; there is deliberately no footer yet (that region develops separately). Uptime history bars are deliberately absent until a real per-day history store exists: this page does not fabricate greenness.
- **A way back from a tool page to the listing.** A tool sub-page (for example the network speed test) now shows a subtle back affordance at the top of the canvas — a leading arrow and the destination name "Tools" — so returning to the tools directory no longer means the browser back button or hunting the sidebar. A new `tools` route layout renders it above every tool page and suppresses it on the `/tools` listing itself, so present and future tools inherit the affordance for free. The affordance is a reusable `BackLink` (design-system Button in its ghost register, rendered as an anchor) inside a `Breadcrumb` navigation landmark, with an accessible name ("Back to Tools") that reads unambiguously out of context beside a page masthead.
- Tools — the Tools page now lists every tool the firm offers, grouped by subject, as either a grid of tiles or a dense list; the toggle remembers which you prefer. Each tool states plainly what it does and how finished it is, and a tool that is not ready yet says so rather than pretending to open. Work done here runs outside any matter.
- **Malware Scan joins the Tools catalog.** The file utilities gain a matter-free malware scan: point it at a file and it runs the file through the malware-scan engine and reports the verdict, storing nothing. It is searchable in the command palette today and listed as "— soon" until its page is built.
- Docker-free wasm dev build (`vp run rust-wasm-build-dev`) — builds the pdf-core, decryption-core, and email-core WebAssembly artefacts with the host Rust toolchain + wasm-pack instead of the pinned Docker images, for dev environments that cannot pull the base image (e.g. a cloud session whose egress policy blocks Docker Hub / ghcr blob pulls). It refuses under CI: the canonical `rust-wasm-build` (Docker) stays authoritative for anything shipped, since the host rustc may emit different wasm bytes than the pinned image.
- **Wellbeing resources directory.** `@magna-carta/wellbeing-resources`: a typed, verified dataset of per-jurisdiction lawyer mental-health and emotional-support resources (State Bar Lawyer Assistance Programs and affiliated hotlines, peer networks, and clinical vendors) across all 50 states, DC, and five territories, with a permanent national safety net (988, SAMHSA, ABA CoLAP) returned for every jurisdiction. Data is generated from a provenance-tracked research corpus; the in-app surface lands in a later slice.
- WHOIS Lookup tool page: look up the registration record for a domain or IP address — registrar,
registration and expiry dates, name servers, and registry status. Structured RDAP results are shown
as a parsed card; the few country-code registries that answer only over legacy WHOIS return raw text
shown verbatim and labelled unparsed. A registry that answers with no details reads as "nothing
found" rather than a blank card, and a failed lookup surfaces a correlated Error ID.
- **Conflicts checks surface co-party matches, flagged distinctly.** When a conflicts check's search
lands on an entity that is itself one of the check's own subject parties — the opposing party turns out
to be the client's parent company, or two named parties share a name or identifier — that hit is now
recorded and shown, flagged as a co-party surfacing rather than dropped. An entity still never conflicts
with itself, but a positional conflict between two _different_ parties of the same matter is exactly the
kind of thing a conflicts check exists to catch, so it is surfaced and tagged (`coParty`) so a reviewer
triages it apart from a conflict with a prior or unrelated client.
- **Conflicts matching engine — firm-wide conflicts-of-interest checks with no scorer.** A new `@magna-carta/conflicts` package runs deterministic conflicts checks over the Directory graph: every candidate the blocking channels surface is shown to a reviewer, ranked by a deterministic evidence tier (exact identifier match, exact normalized name, phonetic code, trigram overlap) plus the graph path that connected it — nothing is ever hidden by a numeric score or threshold. Strictness (`balanced` / `over_inclusive`) is a recall knob, not a cutoff: the over-inclusive setting is a strict superset of balanced, so raising it can only surface more candidates, never fewer. A typed source registry decides what a check searches — Party (Directory entities and role-links, always on), Graph (traversal over typed edges to a configured depth, with corporate-family relationships followed regardless of depth), Imputation (a firm member being a party, matched by identity join rather than name similarity — a partner sharing a surname with a client is not a conflict), and Content (email and document text, registered for the log but not yet available) — governed by a firm-set floor that a per-run request may only add sources above, never subtract below. Every check writes an immutable, append-only log across three per-firm tables (`conflicts_check`, `conflicts_hit`, `conflicts_disposition`); no row is ever updated or deleted, enforced by database triggers and proven by a fitness probe, and identifiers are recorded by reference only — no plaintext identifier value ever enters the log. Reviewers record a disposition (cleared, waiver obtained, wall erected, or representation declined) as a new row, so a later reversal leaves both acts visible rather than overwriting the first. New worker routes and permissions (`conflicts:run`, `conflicts:dispose`) expose the check and disposition flows.
- **Email filing & capture (slice 1) — capture the firm's email into matters as first-class, thread-aware records.** A new `@magna-carta/email-filing` package and its worker surface capture email to matters over one convergent pipeline: an authenticated `file this MIME to matter` API (`POST /api/v1/matters/{id}/emails`, the endpoint the future add-in's Save & File posts to) and a Cloudflare Email Worker (`apps/email-worker`) forward/CC entrance both converge on one `captureEmail` operation over the built email parse engine and the built ingest/quarantine chokepoint — no second parser, no parallel data path. The record model is five per-firm tables (`email_message`, an `email_thread` DAG, the `email_matter_link` multi-matter junction, `email_participant`, `email_attachment`) plus a capture-address token store: a message is stored once and linked to many matters, deduped per firm on its `Message-ID` (with a normalized-header+body content-hash fallback when an identifier is stripped) so two people filing the same email converge on one record rather than duplicating it. Real attachments are extracted into the matter's File Manager as first-class quarantined documents while a decorative inline image is recorded but not made a document; the verbatim original is kept whole in R2. A wall-safe "already filed" signal prevents double-filing without ever revealing a matter the caller is walled from, and the same absence-not-existence rule governs the multi-matter "also on…" list. Capture lands staged for staff to accept; new `emails:*` permissions gate filing, reading, link management, and capture-address administration. Directory participant resolution is wired through the merged reverse address→entity lookup, and the filing-time conflict/ethical-wall hook, the notifications raise-point, and the DKIM-verdict boundary are placed as seams for later phases. Parse, hash, and attachment extraction run off the request path on a queue consumer.
- **Convert a scanned PDF into a searchable one through the file converter.** The conversion registry
now has a `pdf → searchable-pdf` edge served by the OCR engine: submit a scanned PDF as a conversion job
and get back the same document with an invisible, selectable text layer over every scanned page (a page
that already has text is left untouched). Because the converter composes multi-hop paths, a scanned
image reaches a searchable PDF too — wrapped into a PDF and then recognized — once the image-to-PDF
engine is deployed. The OCR engine runs as its own already-live service, so this hop works today without
waiting on the dedicated conversion worker; the job coordinator, queue, and polling are the same ones
every conversion uses.
- **The Certificate of Completion is assembled and rendered.** `@magna-carta/signing` gains the ESIGN/UETA
defensibility artifact that travels with a sealed document: `assembleCertificateOfCompletion` builds it
from the sealed document's SHA-256, the seal time, and the server-observed signer records — refusing to
emit an incomplete record (no signers, a non-SHA-256 hash, or a missing seal time) — and
`renderCertificateOfCompletion` produces a stable, deterministic plain-text record naming each signer's
attribution, adopted signature, affirmed intent, and consent to transact electronically. Pure and
reproducible; the signing workflow that captures the acts feeds it, the way the seal engine feeds
`sealDocument`.
- **The platform seal is reachable from the app: `POST /api/v1/documents/seal`.** A firm member with the
new `esign:seal` permission (seeded to Owner/Admin and Attorney) can submit a PDF and receive it sealed
— the PAdES CMS signature embedded, plus the sealed-range digest and a Certificate of Completion. The
route runs through the standard chokepoint (tenancy → authn → RBAC → idempotency → rate-limit) and
forwards to the dedicated `sign-worker` over a `SIGN_SERVICE` service binding through a reusable
`SealPort` adapter, so the signing key never leaves that one worker. The signing time and the observed
signer IP are server-authoritative (never client self-reported); nothing is stored here — only a
redacted `esign.sealed` audit row (digest + signer count + actor, never document content). Until the
sign worker's signing identity is configured the route honestly returns `503`, matching the deferred
activation of the scan, OCR, and conversion engines.
- - **Forward/CC capture addresses can now be minted, rotated, and revoked — the forward path works.**
  The email filing slice shipped the inbound Email Worker, the token index, and the capture consumer,
  but nothing that WROTE a token: the routing index stayed empty and every forwarded message bounced.
  Six routes close that gap, all behind `emails:manageCaptureAddresses` (Owner/Admin): mint and list a
  matter's capture addresses, rotate one, revoke one, and mint or revoke the firm-wide catch-all.
  Minting returns the address to forward or CC mail to — `<token>@in.magnacarta.esq` — and that is the
  only time the token is ever shown, because the token is itself the credential; lists return a
  four-character prefix and metadata.
- **Rotation replaces an over-shared address in one step.** Rotate retires the old token and returns a
  fresh one for the same matter; replaying the same `Idempotency-Key` returns that same new token
  rather than rotating twice.
- **The two halves of a capture address are written in deliberately opposite orders.** Minting commits
  the firm's address row and its outbox row in one atomic batch and lets the relay register the routing
  token, so a brand-new address exists but is briefly not yet routable — mail sent in that window
  bounces rather than landing anywhere unexpected, and the mint response says so. Revoking and
  rotating write the routing index FIRST, so a revoked address stops receiving mail the moment the
  request returns.
- **The shared per-firm job queue is now a declared consumer.** The per-firm outbox relay has always
  published to it, but nothing consumed it, so per-firm outbox effects were never applied in
  production. Deploying this requires the `magna-carta-production-platform-jobs-deadletter` queue to
  exist alongside the queue itself.
- **The platform seal gets a typed service contract (`SealPort`).** `@magna-carta/signing` gains the
`SealPort` interface and its shared wire codec — the reuse seam for the dedicated sealing service: a
request (document + seal metadata + signer records + signing time) in, a response (sealed PDF +
document hash + Certificate of Completion + rendered text) out, with `encode`/`decode` helpers so both
sides of the service binding serialize identically and never drift. Binary fields cross base64-encoded
in a JSON envelope (chunked base64 helpers added to the bytes util). `@magna-carta/pdf` now also exports
its compiled WASM as a subpath so a Worker can import it as a `WebAssembly.Module` (the established
email/decryption route mechanic). This is the contract the sign-worker implements and the app worker
forwards to.
- **The PAdES seal's signing backend is settled and proven: pkijs over WebCrypto, in the Worker.** The
detached CMS/PKCS#7 that fills the seal primitive's reserved `/Contents` is built in TypeScript with
pkijs, running on the Cloudflare Workers WebCrypto runtime, with the firm's signing key held as a
non-extractable `CryptoKey` — the key does only a raw signature over the CMS digest and never leaves the
host or becomes extractable. The pure-Rust `pdf-core` engine keeps owning the PDF structure and takes
the CMS as an opaque blob, so no cryptography enters the engine. A workerd test proves the path end to
end: a detached CMS with signed attributes (contentType, messageDigest, signingTime) over an external
byte range verifies, and a tampered range is rejected. Chosen over a Rust CMS crate in the engine (no
first-class host-side-key signer) and over `@signpdf` (basic level, no native long-term-validation path);
pkijs also carries the timestamp/revocation primitives the later PAdES levels need. Independent-validator
(pyHanko/DSS) conformance and the `@magna-carta/signing` product layer follow.
- **The PAdES seal now carries the ESS signing-certificate-v2 attribute — the baseline is complete.** The
detached CMS gains the `signing-certificate-v2` signed attribute (RFC 5035): a hash of the signer
certificate's DER, bound into what the signature covers, so the seal is tied to _this_ certificate and
not just its issuer-and-serial (closing the certificate-substitution gap a PAdES-baseline signature must
close). pkijs has no `SigningCertificateV2` type, so the `SigningCertificateV2`/`ESSCertIDv2`/`IssuerSerial`
structure is built directly, omitting the `hashAlgorithm` for the SHA-256 default per DER and including it
for SHA-384/512. Verified in node and on the Worker runtime: the attribute's hash matches the certificate,
and the seal still verifies end to end.
- **The PAdES seal is wired end to end: the WASM engine drives the real seal.** `@magna-carta/pdf` now
exposes the seal primitive at its edge — `prepareSignature`, `embedSignature`, and `createSealEngine`,
which packages them (with a pure `signedBytes` slice) as the `SealEngine` that `@magna-carta/signing`'s
`sealDocument` orchestrates. So a real PDF flows prepare (WASM, prefix-preserving incremental update) →
sign the byte range host-side (WebCrypto/pkijs) → embed the CMS (WASM), and the sealed document
verifies. An end-to-end test proves it on a real document: the seal verifies, the sealed PDF still
parses through the render engine (hayro), and a tampered range fails. The cryptography stays host-side;
no key enters the engine. Remaining before a firm can rely on it: ESS signing-certificate-v2,
platform-certificate provisioning, and independent-validator (pyHanko/DSS) conformance.
- **PDF signing gains its structural foundation — the PAdES seal primitive.** The pure-Rust PDF
engine can now prepare a document for signing without disturbing a byte of it: `prepare_signature`
appends a PAdES signature dictionary, an AcroForm, and an invisible signature widget as a true
incremental update, so the original file survives verbatim as the literal prefix of the output —
the property every signature depends on and that the additive Bates/searchable writers (which
re-serialize) deliberately do not provide. It writes an exact `/ByteRange` covering the whole file
except the reserved `/Contents`, exposes the bytes a signer must digest (`signed_bytes`), and splices
a caller-supplied detached CMS into the reservation (`embed_signature`) without moving a signed byte —
so embedding the signature can never invalidate the digest it signs. Multiple signatures chain, each
preserving the prior signed revision. The cryptography stays the caller's, host-side, by design: no
private key enters the engine. Classic and cross-reference-stream base documents are both handled (the
update always appends a classic table chained via `/Prev`). This is the engine half of first-party
e-signature; the CMS builder, platform certificate, and the ESIGN/UETA product layer follow.
- **The platform seal can be provisioned: one command mints the signing identity.**
`pnpm run platform-seal-certificate` generates the RSA-3072 signing key and the self-signed X.509 v3
certificate the seal is applied with, then prints the two `wrangler secret put` commands that activate
the sign worker. The certificate carries what a document-signing certificate is expected to carry —
`basicConstraints` (not a CA), `keyUsage` restricted to digitalSignature + contentCommitment,
`extendedKeyUsage` of id-kp-documentSigning (RFC 9336), a subject key identifier computed without
SHA-1 (RFC 7093), a random positive serial, and a proper one-attribute-per-RDN name. The private key is
written to a `0600` file and never printed, so it never passes through a shell argument, scrollback, or
a transcript. The generator is a tested library function (`@magna-carta/signing/platform-certificate`),
not a script: its test re-imports the exported key non-extractably and proves the resulting CMS
verifies, so what provisioning produces is known to seal before it ever reaches a secret store.
- **The platform seal has a home: the dedicated `sign-worker`.** A new internal Worker
(`magna-carta-sign`) applies the PAdES seal — the pure-Rust PDF engine (prepare/embed) and the pkijs
CMS run in-process, and it holds the platform signing key (`PLATFORM_SEAL_KEY` / `PLATFORM_SEAL_CERT`
Worker secrets) so the key lives in exactly one minimal-surface worker. Its only surface is
`POST /seal`, reached over a service binding, returning the `SealPort` wire shape (sealed PDF +
document hash + Certificate of Completion). Activation is deferred: the worker deploys without the
secrets and returns `503 seal-not-configured` until an operator sets them, then seals — no redeploy.
Proven in the real Worker runtime: pool-workers (workerd) tests seal a real PDF and verify the embedded
CMS end to end (the first WASM-only dedicated worker here), and the worker bundles to ~2.6 MB gzip,
well under the Workers limit.
- **`@magna-carta/signing` — the e-signature product layer, first increment.** A new package that owns the
PAdES seal's CMS and the ESIGN/UETA model, sitting above the pure-Rust PDF engine (which owns the
signature structure). It ships: the detached CMS/PKCS#7 builder and verifier over WebCrypto
(`buildDetachedCms`/`verifyDetachedCms`) — the firm key stays a non-extractable `CryptoKey`, only ever
signing the CMS digest; the `SealEngine` port mirroring the engine's `prepare`/`signedBytes`/`embed`, so
the seal orchestration is testable without the WASM binding; `sealDocument`, which threads prepare →
sign-host-side → embed into one call and reports the document hash for the Certificate of Completion;
and the ESIGN/UETA model — the four elements (intent, consent, association, attribution), the attribution
assurance ladder (`attributionMeets`), and the Certificate-of-Completion shape. Verified in node and on
the Workers runtime (workerd). Deferred: the real `@magna-carta/pdf` WASM adapter for `SealEngine`, ESS
signing-certificate-v2, platform-certificate provisioning, RFC 3161 timestamping / long-term validation,
and independent-validator (pyHanko/DSS) conformance.
- **Discovery keyword search — querying a split by ranged reads (`crates/search-core`).** The split format
was built to be stored in per-firm R2 and queried without downloading the whole index; this adds the
access path that makes that real. A read-only Tantivy directory serves the engine's reads straight off
the split's footer offset table through a new `RangeReader` seam: each read the engine issues for a term
dictionary block, a postings list, or a stored-field block becomes one ranged read of exactly those
bytes. In production the `RangeReader` is an HTTP range GET against the split's object in R2 (the adapter
lives in the search worker, kept out of this pure crate); a query over a large index then transfers a
small fraction of it, so per-query cost tracks the query's selectivity rather than the corpus size. An
instrumented in-memory reader proves it: a rare-term query reads well under half a split (and the
fraction shrinks as the corpus grows), reading a split's footer touches only its tail, and the ranged
path returns results identical to querying the whole split in memory. The directory is strictly
read-only — splits are immutable, so every write path is refused.
- **Discovery keyword search — the index core (`crates/search-core`).** The first buildable slice of the
search-index design: a pure-Rust crate (Tantivy 0.26, no C dependency) that builds a keyword index from
extracted passages and packages it as a self-contained **split** — the index's files bundled into one
byte string with a footer that locates each file and records the document count and schema generation.
A split is how the index leaves the machine that built it: one blob that can be stored under a single
per-firm R2 key and enumerated without listing the bucket, written once and never mutated. The crate
builds splits, queries them (BM25 keyword and phrase search, merged across multiple splits into one
ranked list), reads a split's footer without opening the index, and refuses a split from an
incompatible schema generation rather than misreading it. Hits carry only the pointers needed to
hydrate a passage through the data-access layer, never its text — the index is a term index, not a
document store. No user-facing surface yet; the crate is the engine the search worker will wrap.
- **Discovery hybrid search — the keyword + semantic composition.** `runHybridSearch` runs the keyword half
(the Tantivy engine through the per-firm catalog) and the semantic half (Vectorize) concurrently and
fuses their rankings by reciprocal rank. A half that succeeds contributes its hits; a half that is
deferred or errors contributes nothing and the other half still answers — so hybrid degrades to
keyword-only or semantic-only without any score calibration, and only reports a failure when both halves
are unavailable. The semantic half is a deferred seam today (its Vectorize binding and per-firm namespace
are a deploy-time step, like the search engine and conversion engines), so a hybrid call currently
returns keyword results; when the Vectorize adapter is wired it drops into the same composition. Covered
by tests for the both-halves fusion, graceful degradation each way, the limit cap, and the deferred
default.
- **Discovery search-index catalog — the per-firm record of live index splits.** A new `index_split` table
in the per-firm database (the `FirmDatabase` Durable Object's self-migrating lineage) records one row per
immutable Tantivy split stored in the firm's R2: its object key, document count, size, schema generation,
and creation instant. This is the authority a query enumerates to learn which splits are live for a
matter — never an R2 bucket list, which would be slower and would not carry firm scoping structurally.
Because the index is durable per-firm data (unlike transient scan or conversion artifacts), the catalog
lives in the per-firm database, access-gated with the matter it belongs to. Splits are immutable: a row
is inserted on publish and marked superseded by compaction (kept until its object is garbage-collected,
so an in-flight query against the old split still resolves), never mutated in place. New data-access
statements cover the full lifecycle — insert a split, list a matter's live splits, mark one superseded,
and delete a superseded row — with an `IndexSplitId` identifier type.
- **Discovery search — the `SearchIndexPort` seam (`@magna-carta/search`).** The single domain interface
every search feature reaches the index through: `index` a document's passages, `remove` a document, and
`query` a matter (keyword, semantic, or hybrid). It follows the same discipline as the conversion and
inference ports — every operation returns a typed outcome, never a thrown error, so a caller
pattern-matches an engine or transport failure rather than catching it, and `engine-not-implemented` is a
first-class result while the engine Container is deferred. The port is the boundary between the app
Worker (which owns the per-firm catalog and firm scoping) and the future dedicated search Worker's
Container (which owns the Tantivy engine): a query carries the live split object keys the caller resolved
from the catalog, so the engine range-reads exactly those and never reaches the per-firm database. No
user-facing surface yet; the interface and its typed outcomes are covered by tests.
- **Discovery keyword search — the catalog-to-engine wiring.** The app Worker can now run a keyword search
over a matter's live corpus end to end (short of the engine Container itself): `runKeywordSearch` resolves
the matter's live splits from the per-firm catalog through the firm-scoped data-access layer, hands their
R2 object keys to the `SearchIndexPort`, and returns the ranked hits. Firm scoping and catalog
enumeration stay in the Worker behind the data-access layer, so the engine is a stateless range-reader
that only ever sees splits the firm's own catalog named. `resolveSearchIndexPort` returns a
service-binding adapter to the dedicated search worker (`magna-carta-search`) when its binding is present,
and a deferred port (`engine-not-implemented`) when it is absent — every test environment and production
until that worker is deployed — exactly as the conversion subsystem is wired-but-dormant. The adapter
never throws: a non-2xx or transport failure becomes a first-class adapter error. Covered by tests for
the catalog-to-engine split-key hand-off, the deferred fallback, and the adapter's forward/parse and
error mapping.
- **Discovery hybrid search — reciprocal rank fusion.** The keyword half (Tantivy/BM25) and the semantic
half (Vectorize/cosine) rank hits in incomparable score spaces — a BM25 magnitude and a cosine
similarity cannot be added — so a hybrid query fuses them by reciprocal rank instead: a passage
contributes `1/(k + rank)` from each list it appears in, and the fused score is the sum. This needs no
score calibration between the halves, is robust to one half returning nothing, and lifts a passage both
halves surface above one only a single half found. The fusion is a pure function in
`@magna-carta/search` (`reciprocalRankFusion`), fusing at the passage (document + chunk) level with
deterministic tie-breaking, ready for the worker to combine the two halves once the semantic engine is
wired.
- **Discovery search write pipeline — documents now become index splits.** The half of the search
subsystem that was missing: nothing previously turned a matter's documents into splits and catalog rows,
so a query resolved an empty catalog no matter how much had been filed. A committed document version now
flows ingest → extract → build → catalog, driven by a queue consumer off the ingest path in the shape the
conversion subsystem already models (a `SearchIndexJob` Durable Object keyed `firmId:documentId:version`
over a `search-index` queue with its own dead-letter queue).

**One split per document version, so a retry converges instead of duplicating.** The split id is
_derived_ — a content-addressed handle from `documentId + version` (new `deriveIdentifier` in
`@magna-carta/identifiers`) — which fixes both the split's identity and its R2 key
(`search/<matterId>/splits/<splitId>.split`). Every attempt at the same version therefore writes the
same object and replaces the same catalog row: a retried job overwrites its own half-finished work
rather than leaving a second copy behind. Publishing is a delete-then-insert of the document's rows in
one atomic batch, and the `index_split` table gains `document_id` + `version` columns with a **partial**
unique index over the live per-document rows — so a duplicate delivery that raced past the delete still
cannot leave two live splits indexing one version, while the many-document splits a later compaction
publishes stay outside the constraint. New data-access statements cover the document lifecycle:
`listSplitsForDocument`, `deleteSplitsForDocumentStatement`, and `replaceDocumentSplitStatements`.
Superseded splits' R2 objects are reaped before their rows, so a re-index leaks no orphaned bytes.

**A deferred engine parks a job instead of failing it.** Neither engine is deployed yet — the index
Container is unbuilt and the text-extraction port resolves to the recognition service — and a pipeline
that retried against them would burn each message's attempts and dead-letter documents that were merely
early. The consumer's outcomes are therefore three, not two: `indexed`, `deferred` (acked, recorded on the
job, and re-startable so deploying an engine and replaying the enqueue drains the backlog naturally), and
`failed` (either terminal for unreadable bytes, or rethrown so the queue retries and finally
dead-letters). No document ever leaves the pipeline unaccounted for — a document silently missing from
discovery is a defensibility failure, not a cache miss.

**Gated per firm, enqueued at the ingest seam.** A new `search.indexing_enabled` firm setting (off by
default) is read at enqueue time on the ingest path, so a firm that has not opted in never has its
documents extracted or written to R2. The enqueue hangs off the clean commit in the files-ingest
consumer — the first moment a version is durable, scanned, and current — and is best-effort, so a
failure to enqueue can never unwind an ingest that already succeeded. A new `TextExtractionPort` covers
the extract stage over the recognition engine, with typed outcomes that let the consumer tell "no engine
yet" from "these bytes are unreadable".
- **The LibreOffice conversion engine — the four registered office edges now have a body.**
`docx→pdf`, `odt→pdf`, `docx→odt`, and `wpd→odt` have been declared conversions for two months and
resolved to a deferred port that failed every job; `wpd→pdf` chains across them. `containers/libreoffice`
is the engine that runs them: a Rust supervisor with an axum surface, plus a pool of warm worker child
processes that each load LibreOffice once through a `dlopen`'d C ABI and convert one document at a time.

The suite is owner-consented C++ under the memory-safety rule — no Rust library reads those formats with
anything approaching this fidelity — and the consent buys exactly one thing: loading a shared library at
run time. Everything around it is Rust, the container has no outbound network, and the suite always runs
as an isolated child process, so a wedged or segfaulting conversion kills its own child and nothing else.
A worker is replaced (never rebuilt in place — the binding segfaults if an instance is recreated) when it
crosses its conversion budget, its resident-set ceiling, its deadline, or dies; a scheduled replacement is
warmed alongside the outgoing worker, so recycling is not charged to the request that triggered it.

`/ready` is honest: 503 until a worker has actually finished suite initialisation, which takes tens of
seconds, so the container never hands that delay to the first user request as an unexplained stall. A
failure is always a status, never an empty success — 415 for a format pair this engine does not serve, 422
for a document that reached the suite and could not be converted (including a password-protected one,
which is never guessed at), 503 when no worker was available, 504 on the conversion deadline.

Carlito and Caladea ship in the image and the acceptance suite asserts the embedded font names, so a
Calibri or Cambria document that silently fell back to Liberation — a layout shift, not an error — turns
the build red instead. The supervisor's whole state machine is proved by `cargo test` against a fake
worker that can be told to hang, crash, abort on a signal, run away with memory, or answer with garbage,
so the part most likely to be wrong is covered on any machine with no office suite installed.

Deploy is ordered: the convert worker carries the new Container class before the app worker starts routing
the engine. Still to come on this container: the email-to-PDF render engine, which consumes the job-package
seam and adds one dispatch arm.
- **A user guide for capture-address management.** Minting, rotating, and revoking the forward/CC address
a matter files mail through — plus what the firm-wide catch-all does and why a firm holds only one —
now have written guidance in _Filing email to a matter_, including the two things that surprise people:
the address is shown exactly once, and a brand-new one bounces mail for a moment before it starts
delivering.
- **Design spec and implementation plan for document automation (slice 2·6).** The last unbuilt
promise in Phase 2 now has an implementation-grade design. A template is a `.docx` stored in per-firm
R2 and catalogued in per-firm D1, versioned exactly like a file — immutable versions, content hash,
the same quarantine status gate, the same supersede-to-Infrequent-Access tiering — so an assembled
document can always name the exact template version that produced it. Placeholders are `{{key}}` text
delimiters (Word `MERGEFIELD` constructs are recognized as an equivalent authoring form), and the
fiddly half of DOCX templating — finding a placeholder Word split across five runs — is paid **once,
at template registration**, not on every assembly: registration normalizes each placeholder into one
contiguous run, records a field manifest, refuses macro-bearing packages, and scrubs the template's
authoring history so no tracked change or comment can propagate into a filed document.

Merge fields resolve through a declarative data dictionary over matter, Locations, firm, Directory
party, and custom-field sources, with one hard rule stated as a test rather than a convention: a
merge field never issues a query, so a 150-field template costs the same reads as a four-field one.
Custom fields bind by handle, never by name — the property the custom-fields engine was built to have
— and the reciprocal obligation slice 1·4 deferred is taken up here: the custom-field hard-delete
guard gains its template-binding arm. Location fields resolve from **the matter's** home office, so a
document assembled by one office on another's matter carries the correct letterhead and remit-to.
Money renders from `amount_minor` by moving a decimal point, never by multiplying; a merge field bound
to a `protected()` value resolves only through the decrypt-permission-plus-audit chokepoint and fails
by name rather than emitting a blank.

The assembly engine is built in-house in TypeScript over `fflate` and `fast-xml-parser` — the same
substrate the metadata inspector and scrubber already use to rewrite OOXML safely — and runs in a
Worker queue consumer behind a `DocumentAssemblyJob` Durable Object. docxtemplater's MIT core was the
real alternative and is recorded as a scoped fallback behind the same port; it was declined because it
would bring a second zip stack beside `fflate`, because image insertion (the letterhead logo, next
slice) sits behind a paid module, and because its richer expressions are evaluated from template
content — where this design deliberately keeps the expression language non-executable, so a
firm-authored `.docx` can never become an execution surface. Driving the consented LibreOffice
container's mail merge was rejected outright: it is the only memory-unsafe route and would push party
names, settlement amounts, and decrypted identifiers through the one C++ dependency, for no fidelity
gain when input and output are both `.docx`. LibreOffice keeps exactly the job the conversion design
gave it, DOCX to PDF.

The assembled document enters the **normal ingest chokepoint, scan included, with no bypass** — the
moment there are two ways for a version to reach `clean`, the invariant that every file read filters
on status stops being enforceable by construction. Absence is a declared decision per field
(`blank` / `placeholder` / `fail`, defaulting to a visible placeholder) because a blank where a party
name should be, filed without anyone noticing, is the failure mode that matters. Resolved merge values
live in memory for the life of the job and are never persisted, logged, or placed on a queue; the
provenance row stores which keys were absent, never what the present ones held.

Nine owner decisions are flagged, including the placeholder syntax (user-visible, and a migration to
change later), court-form and clause-library scope, the expression ceiling that separates a template
a paralegal maintains from one that needs a developer, and whether merge fields may bind to protected
identifiers at all.

Specs: `docs/specs/2026-08-04-document-automation-design.md` and
`docs/specs/2026-08-04-document-automation-implementation-plan.md`. Decisions:
`docs/decisions/pending/document-automation-assembly-engine.md` and
`docs/decisions/pending/document-automation-template-model.md`.
- **Design spec and implementation plan for Custodian (slice 4·2).** The second half of the Phase 4
deliverable now has an implementation-grade design: the register of physical originals a firm holds
in safekeeping — wills, deeds, share certificates, keys, sealed instructions — with the location tree,
the movement ledger, and the compliance seams specified against what is already on `main`.

**A packet is the unit of custody; an item is the unit of description.** A packet is the envelope or
deed box that physically moves and carries the number, the location, the owners, and the optional
matter link; an item is one thing inside it, with a type drawn from a per-firm catalog and an
intrinsic-value flag a human asserts. An item never moves between packets by an edit — re-packeting
is a ledger entry, because "when did the will move out of the family envelope" has to have an answer.
**Ownership anchors at a Directory entity and is mandatory**, not at a matter: a firm holds a will for
a client whose last matter closed eleven years ago, for the adult child of a client, for an estate,
and rooting custody at the matter would make every one of those either impossible or a fake matter.
The catastrophic outcome in safe custody is not a misplaced packet but an unattributable one, so
orphan prevention is structural rather than a reminder.

**One recursive location tree, rooted optionally at a firm Location** — the sentence the Locations
model has carried since slice 1·1, made enforceable for the first time. A root bound to a Location is
an office root, which is what makes "which office physically holds this original" answerable for a
multi-office practice; a root of kind `offsite` or `bank` is an external custody site, because a bank
vault is not a firm office and minting a Location for one would corrupt the letterhead picker and the
per-office reporting dimension every other subsystem reads. Capacity is explicitly out of scope with
no column reserved: it is a count for a pigeonhole rack, a volume for a safe, a weight for a shelf,
and a contractual allowance for a bank, and a schema that picks one is wrong for the other three.

**The movement ledger is append-only, enforced by database triggers, and `POST /movements` is the only
state-change path in the whole subsystem.** There is no check-out route, no check-in route, no move
route, no mark-lost route — all of them are one movement kind, so one place enforces the invariant,
writes the derived status in the same atomic batch, and composes the audit row. A correction is a new
compensating row, never an edit. `occurred_at` and `recorded_at` are separate columns so back-dating a
Friday event on a Monday is supported and visible rather than indistinguishable from falsification.
Borrower is three-way (firm member, Directory entity, or an external name) because forcing a courier
into the Directory would pollute the conflicts corpus, and `due_back_on` ships in the first slice
because an overdue check-out is _the_ operational signal a custody register produces and retrofitting
the column leaves every earlier check-out permanently silent. A movement can reference a `shipment`,
so the offsite transport leg reuses the shipping subsystem — carrier, tracking, signature on delivery,
insured value — rather than growing a second one.

**Custody numbers reuse the matters allocation-ledger idiom** (ensure-row, guarded increment,
allocation claim, bounded retry) rather than re-deriving the race, with a fixed number shape instead
of a second segment-template engine. **Scanned copies are ordinary File Manager files** behind the
ordinary quarantine chokepoint with no bypass, linked through a `custody_scan` row; the awkward part —
`file.matter_id` is `NOT NULL` and a custody owner may have no matter — is resolved by filing a
matterless packet's scans onto a per-firm `system` holding matter rather than weakening an invariant
seven subsystems depend on. A scan never satisfies any destruction gate: "we have a scan" is precisely
the reasoning that destroys an original will.

**Retention ships as mechanism with no policy.** Holds (`legal`, `discovery`, `client_instruction`,
`dispute`, `unclaimed`) block release and destruction while still permitting a move to a fireproof
safe, and become the first real consumer of the Custodian hold blocker the deleted-file lifecycle was
written against. Destruction is a two-person request-and-approval workflow, refused under any hold and
refused outright on an intrinsic-value item with **no override in the API**. But no retention periods
ship, no jurisdiction catalog ships, and no destruction sweep exists: retention for client property is
the most jurisdiction-bound fact in the subsystem — five years under the model rule and Texas, seven
in New York and Illinois, fifteen in Ontario, ten under one liability fund's guidance — while the
guidance that governs originals of intrinsic value says they sit outside the routine clock entirely.
A platform default there is a platform opinion about when to destroy a client's irreplaceable property.

The earlier brainstorm on `main` (`docs/specs/2026-06-16-safe-custody-design.md`) is evaluated rather
than inherited: its MVP-first framing, the Location-rooted tree, mandatory ownership, and the deferred
will-on-death engine are kept; its flat item model, its invented co-ownership enum, and its
per-item-type retention defaults are discarded, each with the reason stated. Eleven owner decisions
are flagged, including the packet/item split, whether the mandatory owner link admits any exception,
the scan-filing shape, and whether the will-on-death statutory engine — the largest piece of deferred
value and the clearest separation from the incumbents — is wanted at all.

Specs: `docs/specs/2026-08-04-custodian-design.md` and
`docs/specs/2026-08-04-custodian-implementation-plan.md`. Decisions:
`docs/decisions/pending/custodian-register-model.md` and
`docs/decisions/pending/custodian-retention-jurisdiction-posture.md`.
- **Custodian — the safe-custody register (slice 4·2·1).** The second half of the Phase 4 deliverable
now has code behind it: a firm can build its physical container tree, log a packet owned by a
Directory entity with no matter, itemize it, link a scan, check it out to a named borrower with a
due-back date, see it turn up on the overdue list, check it back in, and read a history that tells the
whole story in order. The new `@magna-carta/custodian` package sits on the established
structure-versus-access seam — pure TypeScript, no binding, no clock, no `env` — and the whole surface
is nineteen routes through the one chokepoint.

**Eleven per-firm tables, and two structural invariants the schema and the write path defend
together.** `custody_location` is one recursive tree whose root either binds a firm office or stands
for an external site (a bank vault, an offsite records vendor) — a bank is not one of the firm's
offices, so it never becomes a `location` row and never pollutes the letterhead picker or the
per-office reporting dimension. `custody_packet` is the unit of custody and `custody_item` the unit of
description, with `custody_owner` as the temporal link to the Directory. **A packet cannot exist
without at least one owner link** — enforced on the one creation path, with no "log it now, attribute
it later" escape hatch, because the catastrophic outcome in safe custody is not a misplaced envelope
but an unattributable one, and ending the last current owner is refused for the same reason.

**The movement ledger is genuinely append-only.** `custody_movement` carries `BEFORE UPDATE`, `BEFORE
DELETE`, and a `BEFORE INSERT … WHEN EXISTS` replace-guard that each `RAISE(ABORT)`, proved by
migration tests that attempt all three against real SQLite; a source-scan fitness test refuses any
`UPDATE` or `DELETE` naming the table so the failure lands at review rather than at runtime. A
correction is a new compensating row that names the row it corrects — there is no edit path anywhere.
`occurred_at` and `recorded_at` are separate columns, so a Friday collection typed in on Monday is
recorded honestly instead of being indistinguishable from falsification.

**`POST /movements` is the only state-change path in the subsystem.** There is no check-out route, no
check-in route, no move route and no mark-lost route: every one is a movement kind, so a single place
enforces the append-only invariant, writes the derived packet or item status in the same atomic batch,
and composes the audit row. Because D1 has no interactive transaction, each movement composes a
precondition fence first — an insert that collides with the row's own primary key exactly when the
status is not what the caller observed — so a concurrent movement aborts the whole batch instead of
letting a guarded `UPDATE` match zero rows in silence. Borrower is three-way (firm member, Directory
entity, or an external name), and `due_back_on` ships now rather than later because an overdue
check-out is _the_ signal a custody register produces and a retrofitted column leaves every earlier
check-out permanently silent.

**Custody numbers reuse the matters allocation-ledger idiom** — ensure-row, guarded increment,
allocation claim on the drawn value, bounded retry — with a fixed number shape rather than a second
segment-template engine. Concurrent draws yield distinct sequential numbers; a manually assigned
number carried in from a paper deeds register touches no counter and takes no allocation row, so a
firm migrating thirty years of physical labels does not have to re-label a safe.

**Holds block release and destruction, and deliberately do not block a move** — a held original still
has to be movable to a fireproof safe. Placing and releasing each append a movement, so the ledger
stays the complete story, and `readActiveCustodyHoldsForFile` is the blocker read a hold-aware
destruction sweep calls: a scan bound to a held packet is not destroyable.

**Scanned copies are ordinary File Manager files.** There is no upload route in Custodian at all —
bytes ride the existing presigned-upload and quarantine chokepoint, and `custody_scan` links the
resulting handle, so a custody scan is previewable, convertible, searchable, and holdable like any
other document. The awkward part (`file.matter_id` is `NOT NULL`, and a custody owner may have no
matter) is answered by a per-firm **system holding matter**: `matter.system_key` marks it, a partial
unique index makes two concurrent first uses collapse onto one row, and `listMatters` excludes it —
rather than relaxing an invariant seven subsystems depend on.

**No retention policy ships, and that is the decision.** `custody_destruction_request` lands as a
schema seam with its two-person constraint checked at the database, but no retention period, no
default, no derived date, and no sweep — a purity test fails the build on anything that looks like
one. Retention for client property is the most jurisdiction-bound fact in the subsystem, and the
guidance governing originals of intrinsic value places them outside the routine clock entirely; a
platform default there is a platform opinion about when to destroy a client's irreplaceable property.

Two permissions, `custody:read` and `custody:manage`, both binding `resource: "firm"` — a deliberate
call against the `files:*` precedent, because a packet may have no matter by construction and binding
to `"matter"` would name a resource half the rows do not have. `custody:read` is seeded to every
default role (a billing clerk answering "do we hold the deed" needs it); `custody:manage` reaches only
the roles trusted with the safe. Telemetry declares one event and four counters in which no custody
number, packet handle, location name, borrower, or item description has a slot to exist in: the
register is a list of the most sensitive things a firm holds, and its metadata alone is a disclosure.

Deferred to later custodian slices: review dates and their reminders, the destruction workflow itself,
labels and barcodes, register reports, gated release and receipts, portal visibility, stocktake, and
the will-on-death jurisdiction engine.

Design: `docs/specs/2026-08-04-custodian-design.md`. User guide:
`docs/user/features/safe-custody-register.md`.
- **The merge-field input infrastructure — the user-facing half of document automation, built against a contract rather than a backend.** A new pure package `@magna-carta/merge-field-catalog-contract` declares what a merge-field catalog entry and a template version's field manifest are — key, human label, group, value type, example rendering, availability and where the value comes from, sensitivity, legal formats — and ships a mock provider over a realistic fixture catalog, so every consuming surface takes a `MergeFieldCatalogProvider` and holds only the interface. Three design-system components join the catalog: **MergeFieldPicker**, a grouped searchable picker composed from the existing Popover and Command (rows lead with the human label, search matches label, key, group, and description, and every typed term must match so a second word narrows); **MergeFieldChip**, the token for an inserted field, whose status says in colour, glyph, and words whether the reader has to do anything about it; and **MergeFieldReviewList**, where placeholders detected in an uploaded document are presented one at a time for confirmation — every row a proposal, with no state that could render as a conversion that already happened. In the web app, an assembly input area lays a template's fields against the catalog and renders a form grouped by source: a control typed to each value a person must supply, read-only context for the fields that fill themselves, per-field guidance saying where each value comes from, and a validation summary that errors on a missing required value and only warns where the matter's own data may still cover it. Reachable as a staged display page at `/forms/assemble` (sample data throughout — nothing reads or writes a matter); the visual design is deliberately plain and left for owner review.
- **Document automation — template catalogue and merge assembly.** A firm can register a `.docx`
template, and assemble it against a matter into a filed document. Templates live in their own
firm-level catalogue with immutable versions (`document_template`, `document_template_version`), and
every assembly records the exact version it came from (`document_assembly`). The merge engine is
in-house TypeScript over the same OOXML substrate the metadata inspector uses — no new runtime, no
container hop.

Registration does the expensive work once, while a human is looking at the result: placeholders Word
split across runs are reassembled into one run each, the document's drafting history is scrubbed, and
the bytes are scanned before the version can be assembled from. Two things it reports rather than
doing silently — **macro projects are removed and the removal is reported**, and **Word merge fields
are detected and listed but converted only when you ask for it** (`convertMergeFields` on the
registration request). A stripped package is independently re-verified as macro-free before it can
register at all.

An assembled document enters the matter through the same upload-and-scan path every other file
crosses; there is no second route to a clean version. Merge values exist in memory for the life of the
job and are never persisted, logged, or placed on a queue — the provenance row records which fields
were _absent_, never what the present ones held.

New permissions: `templates:manage` (Owner/Admin) and `documents:assemble` (the practising roles).
Conditional and repeating blocks, custom-field bindings, letterhead images, and PDF output are later
slices.
- **Cloudflare Agents platform assessment (research).** [`docs/research/2026-08-04-cloudflare-agents-assessment.md`](docs/research/2026-08-04-cloudflare-agents-assessment.md) — what Cloudflare's Agents platform is, what community signal exists, an honest per-candidate fit assessment against the Durable Objects / Queues / Workflows / `@magna-carta/inference` foundation already in place, and a sequenced next-steps list. Grounded in a complete crawl of the Agents documentation (all 123 pages read as raw markdown), which **corrected three load-bearing claims from the first pass**: AI Gateway is first-class from inside an Agent via the same `AI` binding plus `gateway` options the inference package already uses; `AgentClient` is framework-agnostic (only the `useAgent` hooks are React), so a Svelte SPA is not shut out; and `getAgentByName()` lets an agent sit behind the existing request chokepoint with the instance name derived server-side from the session. The one architectural conflict that survives is message persistence — `AIChatAgent` writes conversation history to the agent's own SQLite with a redaction hook but no pluggable storage backend, so privileged transcripts cannot be redirected to the firm-scoped data-access layer. Recommends adopting nothing from the SDK now, taking Durable-Object-native hibernation WebSockets for job push-progress instead, prototyping only a fenced chat-transport shell on synthetic fixtures, deferring the Think harness while it stays experimental, and refusing the managed Agent Memory / AI Search stores and any agentic authority over conflicts, the ledger, or deadlines. Includes a per-class verdict on migrating the seven existing Durable Objects to the Agent class (not worth it for any; actively harmful for `FirmDatabase`, whose firm database would gain framework-reserved tables). Research only — no decision, no code.
- **Custodian: review dates with a real reminder feed, the register reports, and printable barcode labels.** The safe-custody register now answers the two questions it could not: what needs looking at again, and what the firm holds in aggregate. A packet or an item carries `review_on` and `review_interval_months` — set by the firm, defaulted by nothing — and recording a completed review appends a `reviewed` entry to the append-only ledger and rolls the date forward on its **anniversary** rather than a period after today, so a review done eight months late does not drag a five-year cycle with it. `GET /api/v1/custody/reminders` is the one place a review that has come round and a check-out that has not come back are decided, in one shape, oldest first; when the Notifications registry lands, delivery subscribes to that rather than growing a second definition of what is due. Three register reports join the shipped overdue list: holdings per owner (packets held, out, itemized, and under hold — as directory handles, never names), the container tree with direct and subtree occupancy counts, and every hold in force. `GET /api/v1/custody/labels` returns a true-size A4 label sheet as SVG, with a Code 128 barcode carrying each object's **identifier handle** — a custody number is a string a firm can re-render, and a scan has to resolve through no lookup rule that can change under labels already stuck to boxes in a safe.

**The destruction workflow is still not built, and the platform still ships no retention periods.** `custody_destruction_request` remains a table with no service, no route, and no code path that writes it; there is no `retention_until` column, no default, no derived date, and no sweep. Retention for client property is the most jurisdiction-bound fact in the subsystem, and the guidance that governs its actual contents says originals of intrinsic value sit outside any routine clock — a platform default here would be a platform opinion about when to destroy a client's irreplaceable property.

**One migration statement is not additive, and it is why the migration is hand-written.** Adding `reviewed` to the movement vocabulary means replacing `custody_movement`'s kind CHECK, which SQLite can only do by rebuilding the table. The rebuild is safe precisely because the ledger was designed to carry no referential dependency — `corrects_movement_id` is a self-reference with no foreign key — and the append-only triggers are dropped and recreated around it, with the guarantee re-proved against the table that came out of the rebuild rather than the one that went in.
- **`pnpm fix:scoped` — the formatter, pointed at the diff instead of the repository.** A bare
`vp check --fix` takes no paths and rewrites everything; it has three times landed dozens of files
nobody in the change had touched, including the `sort()` → `toSorted()` autofix that breaks a package
whose compile target predates it. `pnpm fix:scoped` (`tooling/check-scoped/fix.mjs`) applies the
formatter and the lint autofixes to exactly the change set `pnpm check:scoped` verifies — markdown and
the other prose/data formats included — and the two now share one change-set implementation, so the
files fixed and the files checked cannot drift apart. Each pass receives only the paths its tools can
parse (`.svelte` is lint-only, markdown/JSON/CSS/HTML/YAML/TOML format-only, scripts both);
`--no-lint` formats without autofixing and `--base <ref>` re-scopes the diff, as on the gate.

Also in this batch: `magna-carta-engine-host`'s magic-byte detection gained a **constant-stack
regression guard** — `detect` now runs in a test on a deliberately 64 KiB thread stack, so an
implementation that recurses into a container or copies its input into a frame fails on every machine
rather than as an occasional stack overflow on a loaded one.
- **Trust accounting (slice 3·2) analysis for owner review (research).** [`docs/research/2026-08-04-trust-accounting-analysis.md`](docs/research/2026-08-04-trust-accounting-analysis.md) — the ledger-model options for trust (account-tree shape and sub-ledger granularity, the firm-funds-for-bank-charges carve-out, the three-way bank/book/client reconciliation), the invariants that must hold by construction (no negative client balance on the `account_balance` bounds CHECK, no commingling as a distinct structural guard, fees-never-touch-trust as a composition guard 3·4 and the payments phase inherit, trust-to-operating transfer rules, void-not-delete extended to the tables hung around the ledger, and holds for disputed funds), the jurisdiction variance that must never be defaulted, the integration points against the built 3·1 time and 3·3 costs subsystems plus 3·4 billing and the payments phase, what the pre-alpha per-firm schema baseline collapse means for sequencing, the audit and reporting obligations the state rules impose, and a five-part slice breakdown in which each sub-slice names the owner decisions that must be answered before it can start. Records two findings about the current state: the approved 2026-07-09 jurisdiction-profile design is unbuilt and its typed corpus has not been vendored from the research archive (what `docs/research/trust-rules/` holds today is the earlier narrative catalog), and the phase-3 slice map's chart-of-accounts coordination pin reaches 3·2 as well as 3·4 because trust creates the first real product ledger accounts. Seventeen owner-decision flags and an explicit owner-review checklist. **Analysis only — no code, no schema, no decision; nothing proceeds to spec, plan, or build without owner approval.**
- The design for **natural-language document search** — asking a question in ordinary words and getting back
the passages from the firm's own files that answer it, each with the document, version, and page it came
from. Design and plan only; no product code, and nothing is enabled for any firm.

**It finds; it does not answer.** What comes back is the firm's own words, ranked, with a citation on each
one. Nothing is composed. If nothing matches, the result is empty and says so rather than assembling a
paragraph out of whatever was nearest. The reason is not caution for its own sake: a composed answer moves
the checking onto the reader, who cannot see the passage that was left out, and in a legal product the
failure mode is not an embarrassing sentence but a confident wrong one about a client's matter, sourced to
the client's own file. A search that hands over four passages and says where each one is has actually saved
the work. Adding composed answers later would be a separate decision with its own consent, not a setting
that gets switched on.

**Turning it on is the firm's decision, and off by default.** Nothing is indexed and no index even exists
for a firm until an administrator switches it on and accepts a disclosure. What the disclosure says is
short and checkable: the text pulled out of the firm's documents is copied into storage Cloudflare manages,
outside the firm's own; no outside model company is involved at any point and nothing is sent to one; the
question a member types is turned into numbers by a model to be matched, and that happens on the same
infrastructure everything else already runs on. Two things it deliberately does **not** promise, because
they cannot be verified: where in the world that copy is held, and that switching the feature off erases
every trace from Cloudflare's side. What the platform can prove it deletes, it deletes and can enumerate;
what it cannot prove, it declines to claim. A firm whose obligations require either guarantee is told, in
the disclosure, not to enable this.

**The index is fed deliberately, never pointed at a bucket.** A firm's storage holds far more than its own
working files — material received from the other side in litigation, half-finished edits nobody has saved,
machine-readable index files. Handing all of that to a search index would put an opponent's production into
a search of the firm's own work, which is precisely what the platform reorganized its index scoping to
prevent. So only one thing produces material for this index, and it produces exactly one kind: the text of
a committed document version. Everything else is missing because nothing can put it there, not because a
rule excludes it. **Magnus transcripts cannot reach it at all** — they live in the firm's database, not in
file storage, and there is no path from one to the other.

**A filter is not a wall, so the wall is somewhere else.** The obvious way to keep one matter's documents
out of another matter's search is to attach a condition to the query. That works right up until the day
somebody's code builds the condition wrong, and then there is nothing behind it. So the condition is
treated as a way to get better results rather than as the thing keeping matters apart: every result that
comes back is looked up again in the firm's own records and checked against what the person asking is
actually allowed to see, before a single word of it is shown. Anything that fails is dropped, and the drop
is treated as a serious fault to be investigated rather than a normal occurrence. The firm's own records
are the authority on who may see what, and the search index is never asked.

**And the part that is unknown is being tested before it is trusted, not after.** Cloudflare's own
documentation disagrees with itself about what these conditions can express. Rather than guess, a fenced
experiment on entirely made-up data runs first: two invented matters, a thousand questions deliberately
written to pull the wrong matter's documents to the top, and a hard rule written down in advance — one
wrong result and the feature is not built. It also tests the thing nobody thinks to test, whether a
condition the system does not understand is rejected or quietly ignored, because a condition that is
ignored is worse than no condition at all.

**The index runs behind, and every result says how far.** Material becomes searchable on a schedule
measured in hours, not seconds, which is a real limitation and not a setting anyone can tune away. Because
the platform knows exactly what it has handed over and when, every answer carries a plain sentence — how
current the index is, and how many documents filed since then are not in it yet — stated even when the
answer is none, so that a zero is reassurance rather than silence. A search that quietly omits this
morning's filing is worse than one that admits it is an hour behind.

Also settled: one firm gets one index of its own, because sharing one between firms is refused and the
alternatives run out of room at a hundred firms; searches cover one matter at a time to begin with, with
searching everything a person can see held back until the filtering can be shown to work well enough to be
useful; a matter can be kept out entirely, and keeping it out deletes what was already handed over rather
than merely stopping more; material received in litigation is never fed at any point; a result-caching
feature stays off because it keys on the question text and could hand one matter's passages to a question
asked about another; and no real firm is switched on until Cloudflare stops calling the product a beta and
publishes final prices.
- AI Search slice 0, local half: the filter-semantics wall experiment's runnable protocol harness
(`packages/search/test/natural-language-filter-wall/` — 34 tests). The E1 exclusion probe and E2
fail-open probe run as written against a reference model of the documented filter semantics and are
sensitivity-proven against deliberately broken engines (filter ignored, unknown field dropped,
malformed filter discarded, deletes never landing, query-text cache bleeding across matters); the
matter-scoped two-key filter, the feed-object key layout, and the catalog-driven delete/reassign
discipline are byte-pinned ahead of slice 1. **E1/E2 verdicts remain open** — the live run against a
fenced Cloudflare account is specified as a pass/fail checklist in
`docs/research/2026-08-07-ai-search-filter-wall-experiment.md`, and the retrieval route stays gated
until it passes.
- **The asset register now records every kind of thing an estate owns.** Vehicles carry make, model,
year, identification number and plate; firearms carry make, model, calibre or gauge and serial;
business interests carry the company, where it was organised and what form it takes, optionally
pointing at the directory record the firm already has; insurance policies carry the carrier, the face
amount and who is insured; money owed to the estate carries the debtor, the principal, the rate and
when it falls due; digital assets carry the platform, the public handle, and whether the account is
held by a platform or self-custodied. Each kind brings a starting type list the firm extends.
Identifiers that appear on a public record — a vehicle identification number, a plate, a firearm
serial — are ordinary searchable fields, because searching by them is the point; a full account number
is not, and stays encrypted with only its last four characters readable. **The digital-asset record
has no field a recovery phrase could go in**, and a request naming one is still refused by name.

**What is secured against something is recorded, and equity falls out of it.** A mortgage, a deed of
trust, a lien, a judgment, a security interest, a tax lien, a pledge — with who holds it and the
reference it was recorded under. A balance is not a box on that form: it is a dated figure recorded
against the charge exactly the way a value is recorded against the thing, so a mortgage that was one
number at the date of death and a smaller one at the date of sale has both, dated, on the same
permanent record. Ask what something is worth as of a date and the register subtracts every charge in
force on that date. **It refuses to guess**: a charge whose balance nobody has recorded makes the
equity unavailable rather than being treated as nil, and a dollar value charged by a pound mortgage
nets to nothing at all rather than to an invented exchange rate. Negative equity is shown as
negative. Releasing a charge writes a date and removes nothing, so a schedule read as of the date of
death still shows a lien cleared the following spring.

**The estate schedule.** Everything on a matter's register as of a date you pick, grouped by kind of
thing, each row with what it was worth, the date that figure actually speaks to, what it rests on,
the charges in force and the equity left over — with subtotals per kind and per currency, never
across currencies, and the count of assets nobody has valued yet stated rather than hidden. **The
date is required and has no default**, because the date of death and today give different answers
over the same rows and a schedule with a date nobody chose is the mistake most worth preventing. It
is not a court form, it is not a saved document, and it decides nothing about what is in the estate —
it groups by what a person recorded and reports what is undetermined as its own group.

**A scheduled asset can be linked to the safe-custody item that physically holds it.** The asset
detail then shows where the object is, its status, and whether a hold is on it, read from the custody
register at the moment you look. Neither side copies the other: the custody register's declared value
is what the object costs to replace, the register's valuation is what the property is worth to the
estate as of a date, and a signed first edition has both. The same held object can be scheduled on
two matters, which the estate and its related trust routinely need.

**Assets fill documents.** Eleven new merge subjects — one per kind of thing plus one for the whole
register — arrive as **lists** rather than single fields, so a schedule of real property is a
repeating block over the property list. That is deliberate: an estate with two houses is the ordinary
case, so a single "the property's parcel number" field would have nothing to fill in on most matters.
**A value always prints with the date it speaks to**, the two being provided together. Totals are
worked out in the template and refuse visibly on mixed currencies rather than adding them up. A full
account or policy number has no merge field at all; the last four characters do. All eleven subjects
are filled by **one** read of the register, so adding a twelfth kind of thing costs no read.
- Auto-file rules for captured email — design. A specification for filing mail to the right matter
without a person present, built over the capture pipeline and the matter-suggestion machinery that
already ship.

The design starts from an observation about what is already there: **a matter's forward/CC capture
address is already an auto-file rule.** Someone minted a credential naming a matter and handed it to a
correspondent, and every message sent there routes to that matter with no further judgement — and the
platform still lands the result staged for a person to confirm. That is not an oversight. It is the
subsystem saying that even a perfect answer to _which matter_ does not by itself authorize an
unattended filing, and every rule in this design inherits that split: a rule carries a routing
condition and, separately, whether it may file or only stage.

**Three rule kinds and nothing else.** Replies to a conversation already filed to a matter; mail from
a named sender to a named matter; and the firm's own matter number written in the subject line, matched
exactly. Rules are learned from real filing — the offer made after someone files a message by hand —
rather than authored in an abstract editor, because a rule created that way inherits a real person's
real decision as its justification.

**What was asked for and refused:** keyword and regular-expression subject rules (a pattern cannot be
explained to the person reviewing why a message filed itself, and a rule for "Smith" files the
newsletter about locksmithing), and sender-domain rules — refused not as risky but as self-defeating,
since the counterparties whose domains a firm would want a rule for, a bank or an insurer or a large
opposing firm, are precisely the ones corresponding about many matters at once.

**The guardrails are the feature.** A rule never fires when the precise evidence points at more than
one matter. A rule never files past a conflict or ethical-wall hold — automatic filing goes through
the same check a person's filing does, so the conflicts engine will cover both with no extra work. A
rule fires only into a matter its creator could reach when they made it and can still reach now; a
rule whose creator has been walled off is suspended and shown, never quietly deleted. A rule never
contradicts a person: not on a message somebody already filed elsewhere, and not on one somebody
removed. A rule never files into a closed matter. And a rule that suddenly starts firing far more
often than usual — a mailing list, a bounce loop, an autoresponder — stops filing on its own and asks.

**Signature checking becomes a condition on the machine, not on the mail.** A sender's authenticated
signature is required before a rule that trusts sender identity may act unattended, because the "from"
line on an email is trivially forged. Nothing about the message changes: it is still captured, still
recorded, still suggested, still one click from filed. What is withheld is only the machine's
permission to act unaccompanied. A practical consequence, stated rather than papered over: forwarding
breaks signatures, so sender rules never fire on forwarded mail at all — on that path the platform can
tell who forwarded a message but not who sent it.

**Auto-filing lands staged by default.** A rule puts the message on the right matter with its reasons
attached and leaves the confirming click to a person; filing outright is a per-rule choice, available
only after an administrator turns it on for the firm, so no one member can opt a firm into unattended
filing. That default is not a token: on the firm-wide catch-all address, where mail arrives today with
no matter at all, a staging rule turns "someone has to go find the matter" into "it is already on the
right matter, one click from filed."

Every automatic filing records which rule fired and why, in plain language, so the question asked
weeks later has an answer that does not depend on re-deriving anything. Near-misses are recorded too —
what a rule would have done and why it was stopped — which is what lets a firm see how the rules have
actually been behaving before granting them more freedom. Undoing an automatic filing is the ordinary
unlink, unchanged, and it is also the feedback: a rule being undone repeatedly suspends itself.

Two specs, one decision record, and eight owner decisions. No product code, no user interface, no
notification delivery, and no machine-learned ranking in this cycle.
- Auto-file rules for captured email — the rule model and the decision that guards it. A firm can now
hold auto-file rules, and the guardrail function can be handed a captured message's evidence and
asked what it would do with it. **Nothing evaluates during a capture yet:** no capture path, no
route, and no screen changes, so every message is filed exactly as it was before.

**What a rule is.** A typed, matter-bound, revocable delegation — a person who could have filed a
narrow class of messages by hand telling the platform to do it for the ones that arrive later. Two
kinds and no more: replies to a conversation already filed to a matter, and mail from a named sender
to a named matter. There is no pattern language, no keyword rule, and no way to write one; a rule is
a comparison whose meaning the guardrails can reason about, which is exactly what a pattern is not.
Every rule carries two independent answers — which matter, and whether the resulting link may be
filed rather than staged — because those are separable questions and the platform has always answered
them separately.

**The guardrails are the substance, and they fail closed.** A rule never fires when the precise
evidence points at more than one matter — two rules disagreeing, a rule contradicted by a matter
number in the subject line, a conversation that resolves to two matters. It never fires into a matter
its creator can no longer open, and never into one that is closed, prospective, or platform-owned. It
never files past a conflict hold; it stages instead, on the same check a person's filing already
traverses. It never contradicts a person: not on a message somebody already filed elsewhere, and
never — the sharpest edge of the rule — on one somebody deliberately removed from that matter. A
sender rule requires an authenticated signature from the rule address's own domain, which means it
structurally cannot fire on forwarded mail, where the platform can tell who forwarded a message but
not who sent it. And a rule firing far more often than a person would, or whose recent filings keep
being undone, stops filing on its own and asks. Anything that cannot be worked out at all counts as
"no", never as "yes".

**Staged by default stays true.** A rule's own posture, the firm's ceiling, a conflict hold, and the
circuit breaker can each turn a filing into a staged link; none of them can turn a staged link into a
filing. Direct filing needs two explicit acts by two different kinds of person — an administrator
enabling it for the firm, and a member choosing it for one rule — and the firm ceiling is off until
somebody turns it on.

Also lands the evaluation ledger's tables and its bounded reads, so the platform can report what a
rule did and what stopped it in plain language with no message content recorded anywhere, and a new
`emails:manageAutoFileRules` capability held separately from "may file mail" — because configuring
the machine that files mail is a different grant, and a firm should be able to hand out one without
the other.

Fixed alongside: the `@magna-carta/email-filing` package declared a subpath export for an
`already-filed` module that never existed. The already-filed read lives in the worker's email routes
over the email-filing statements, so the stale entry is removed.
- Auto-file rules now act. The guardrail engine that shipped with the rule model was firing from
nothing; it is wired into the email-capture path, so a message that arrives with no matter — the firm
catch-all, an unrouted forward — has its rules evaluated and lands on the right matter with its
reasons attached.

**Where it runs, and why that is off the hot path.** Evaluation happens inside the capture consumer,
the queue worker that already parses, hashes, deduplicates and thread-links every captured message.
The capture route did not grow a rules pass: it still stages the raw bytes and enqueues, exactly as
before. Reached through an optional port on the capture core, the decision is made at the point the
matter and the link state are chosen, so the automatic link rides the capture's existing atomic write
batch and its existing idempotency record — a redelivered job replays the decision it already made
rather than deciding again, and the ledger row explaining a filing can never survive a batch that
rolled back. The read budget is fixed and small, and none of it grows with the firm's rule count
(rules are found by match value, never scanned), its mail volume, or a conversation's length.

**Staged by default, and the ceiling is real.** A rule places the message on the matter and leaves the
filing to a person unless two different kinds of principal have both asked otherwise: an administrator
raising the firm's ceiling, and a member choosing direct filing for that one rule. The firm switch is
new here — off until somebody turns it on, and a ceiling rather than a default, so a rule that asks to
file still only stages while it is down, with the policy recorded as the reason. Turning it on changes
the next capture and reaches back for nothing already captured.

**What the guardrails do in the wired path.** Evidence naming more than one matter files nothing.
A sender rule on forwarded mail never fires, because forwarding breaks the signature the rule's own
condition rests on. A message somebody already filed elsewhere, or deliberately removed from the
matter, is left alone. A closed matter is refused and the stale rule that named it is suspended. A
rule whose delegating member can no longer open the matter stops. Nothing reaches `filed` without
traversing the same filing-time conflict hook a person's accept does — a hold demotes an automatic
filing to staged exactly as it demotes a manual one. And a rule firing far more often than a person
would goes back to staging and takes itself out of service.

**The visibility the opt-in depends on now populates.** Every evaluation where something happened —
a rule matched, or a match was suppressed — writes a ledger row naming the rule, the matter, the
outcome and the reason, so a firm can see what its rules have been proposing before deciding whether
to let them act. A capture no rule looked at writes nothing, which is what keeps that record
proportional to rule activity rather than to the firm's mail. Every automatic link names the rule that
made it, and an automatic filing writes the same shape of audit row a manual one does. No subject, no
address and no display name reaches any of it — identifiers and enums only, with the sentences a
person reads rendered from them.
- **A template can name the other people on a matter, not just the client.** The opposing party, opposing
counsel, a guardian, and a witness are merge fields now — `{{opposingParty.displayName}}` reads the way
`{{client.displayName}}` always has, each role also offering whether that party is a person or an
organisation so a sentence can read differently for a company. The roles resolve through the matter's
own party links in the Directory, and how a firm wrote the role down does not matter: "Opposing Party",
`opposing_party`, and `opposing-party` are the same role, because spacing, capitals, hyphens, and
underscores are ignored when a link is matched to a field.

**A matter with two opposing parties gets an answer, not a guess.** A field naming _the_ opposing party
fills in only when the matter links exactly one. When it links three, nothing is filled in, the document
shows the usual visible marker, and the result says there were three — a document naming the wrong
defendant is the one mistake nobody catches by reading it. That reason travels with the absence
everywhere an absence already travelled, including into a condition that could not be worked out, so an
author reading the failure is told what is ambiguous rather than only which field went unanswered. For
the "list them all" case each role carries its own collection, walked with the repeating block that
already exists: `{{#each opposingParty.all}}`.

Every role is answered from the party read the merge context already issued. A template naming four
roles costs exactly what a template naming one does, and what a template naming none did — no new query,
no new index, and no change to the four measured operations' plans, all of which remain index walks.
- **A template can now name a client's protected details, and reading one is still a permission and a
record.** The client's Social Security number, Employer Identification Number, date of birth, driver's
license number, account number, and Social Security last-four are merge fields —
`{{client.socialSecurityNumber}}` reads the way `{{client.displayName}}` always has. These values live
encrypted, and nothing about putting them in a document changes who may see them: the value is filled in
only for a member permitted to decrypt it, and every one that is filled in writes the same record a
direct read of that value writes, naming the same field and the same member.

**A member who may not read the value still gets the document.** Where the value would have been, the
draft carries the usual visible marker, and the result says why: the field that was withheld and the
permission it needs. The assembly completes and is reported as needing review, exactly as any other
gap is — one detail nobody may read is not a reason to refuse a letter, and a silent blank in its place
would be a document that reads as finished and is not. Nothing that was withheld appears in the
document, in the assembly's record of what it did, or in anything the product hands back.

**A field that holds a protected value now says so before anyone assembles anything.** The merge-field
list and a template's own field list both mark it, so an author choosing the field knows what it is, and
a firm can see which of its templates ask for protected details. Binding one needs no special
permission — naming a field is not reading it — and a matter whose client the Directory cannot pin down
to exactly one record decrypts nothing at all.
- Billing and invoicing — design. The specification for the slice where time, costs, and trust converge
into a bill, and the answer to the question the trust subsystem shipped without: what evidence
permits money to leave a client's trust account.

**A draft bill is a working document; a finalized one is an evidentiary record.** Before finalization
everything is editable — lines re-worded, entries added and removed, the whole thing thrown away.
Finalization happens in a single all-or-nothing step: an invoice number is drawn, every time and cost
entry on the bill locks, the receivable posts to the books, and the amount owed becomes a figure that
cannot be exceeded. After that nothing about the invoice is ever edited. A bill issued in error is
corrected by a credit note — a second permanent record rather than the erasure of the first — and
"sent" is deliberately not a status, because a bill can be delivered several times by several
channels and a re-send is not a change to a financial record.

**Taking earned fees out of trust now requires a finalized invoice with enough unpaid balance on that
matter, with no override.** The transfer names the invoice it is paying, and the amount is checked
not by looking first but by a database constraint that rides the same transaction — so a payment or a
credit note landing a moment earlier aborts the whole thing rather than letting the firm take money
twice. Partial applications are the normal case: an evergreen retainer pays what it can and the rest
stays owed. The transfer itself is still composed by the trust subsystem, which needed no change at
all to accept the new rule — billing supplies the evidence and never touches a trust record.

**The hard case is stated rather than solved.** When a firm credits a bill after the fee has already
been transferred out of trust, the trust ledger is not rewound: the transfer was valid, the entries
are permanent, and the client's money genuinely moved. What is left is money in the firm's operating
account that the firm has conceded is not its own. The platform records that as an open credit the
firm cannot lose track of, names the three real ways to discharge it — refund it, return it to the
client's trust ledger, or apply it to a future bill — and moves no money on its own, because which of
those is right is a decision about firm funds and not an invoicing question.

**Taxes take the same refusing posture as everything jurisdiction-specific here.** The platform ships
the machinery to charge tax and encodes no knowledge of when tax is owed: no rate table, no
taxability catalog, no default. A firm that has configured nothing gets no tax line, which is the
correct outcome for most law firms, and a firm that owes tax configures its own rates.

Bills combine hourly fees, flat fees, advanced costs, discounts, and tax; one bill covers one client
and may span several of that client's matters, with every line naming its own matter so trust money
applies to the right one. Contingency and retainer arrangements are recorded now and compute nothing
— settlement disbursement statements, with their lien priorities, wait for verified sources rather
than being invented.

Two specs, one decision record, four build sub-slices, and fourteen owner decisions each carrying a
recommended default. No product code in this cycle.
- Billing — all four fee models, on the invoice spine. How a matter is billed is now something the
firm records rather than something the platform assumes: an hourly matter bills exactly as before, a
flat-fee matter bills its agreed amount, a contingency matter bills a share of what was actually
recovered, and a retainer matter watches its trust balance against a floor.

**The fee agreement is a versioned record, and a fee change is a new version.** Each matter carries
at most one agreement in force; amending it keeps the old version with the dates it governed, and
every bill composed under an agreement names the exact version — so what a finalized invoice was
computed under stays answerable years later, however many times the deal changed. A matter with no
recorded agreement is billed hourly, as every matter always has been.

**A flat fee shows the client one line and still tracks the work.** The fee line carries the agreed
amount (or a stated instalment of it), and the time it covered is claimed at zero — attributed for
profitability and realization, locked as billed when the invoice finalizes, and never what the
client is charged. Charging a flat-fee matter by the hour is refused outright, naming the agreement.
Billing instalments past the agreed total is possible on purpose and reported by a fitness query
rather than silently blocked.

**A contingency fee is computed, never stored — and never billed twice.** The firm records the
recovery — the settlement, judgment, or award — and the fee is derived at the moment the bill is
composed: the agreed share, against the gross recovery or the recovery net of advanced costs as the
agreement elects (only costs the firm has stood behind count). Each bill charges only what earlier
finalized bills have not already taken, so a later recovery bills exactly its own share, and a bill
with nothing left to charge is refused. A wrongly entered recovery is voided with a reason, never
edited — and if that leaves a finalized fee larger than the surviving recoveries support, a fitness
report says so by name. There is no settlement disbursement statement here: money in trust still
leaves only through the existing earned-fee application against the finalized bill.

**An evergreen retainer has a floor the firm can act on.** The agreement records the target balance
and the replenishment threshold; the platform reads the matter's available trust balance (money
under a hold does not count), says where it stands, and can record a replenishment request — the
observed balance, the shortfall, who asked. The request moves no money and sends nothing; one is
open per matter at a time, and the below-floor automation belongs to a later slice over the same
event this emits.

**A bill spanning several matters renders per-matter pages plus a summary, at the firm's choice.**
The firm sets its default (per-matter pages ships as the default), any single bill can override it
at finalization, and the choice is snapshot onto the invoice like the letterhead — changing the
default later never re-shapes a bill already sent. The per-page derivation is readable now; the PDF
itself is separate work against the same model.
- Billing — the invoice spine. The first working bill: a firm can now assemble a draft from unbilled
time and costs, review what the client will be told, and turn it into a financial record.

**A draft is a working document; finalizing it is the only interesting moment.** While a bill is a
draft, lines can be added, re-worded, trimmed, or thrown away, and the work on it is only claimed —
still editable, still the timekeeper's to correct. Finalizing happens in a single all-or-nothing
step: the next invoice number is drawn, the letterhead and client details are copied onto the bill,
every claimed entry locks as billed, the amount each matter owes is created with a ceiling nothing
can exceed, and the receivable posts to the firm's books. If any part of that fails, no number is
used up, no work is locked, and nothing is posted — which is what makes the invoice sequence gapless
rather than merely careful. After it, the bill cannot be edited at all: the database refuses, and a
bill issued in error will be corrected by a credit note rather than erased.

**Two drafts cannot bill the same hour.** Pulling an entry onto a draft claims it, and the claim is
enforced by the database rather than by checking first — so when two people reach for the same work,
one gets it and the other is told plainly, instead of both quietly composing a line over it.
Removing a line, or throwing a draft away, hands every entry back to unbilled work and leaves the
record that it was once on that draft.

**Bill review edits the bill, not the timekeeper's record.** Trimming a line's hours or rewording it
changes what the client is told and leaves the underlying time entry exactly as the timekeeper wrote
it. Both are true, both are worth keeping, and it is what lets a finalized bill be re-rendered years
later without reading a single row from anywhere else.

**A bill will not post into an account the firm has not named.** Before a firm can finalize anything,
it says which of its ledger accounts is the receivable, which is fee income, which holds costs
advanced on a client's behalf. Until it does, finalizing refuses and says which one is missing and
where to set it — rather than posting real money somewhere plausible. Advanced hard costs credit
Client Costs Advanced and recognize no income, because the firm is being repaid rather than earning.

One bill belongs to one client and may cover several of that client's matters, with every line naming
its own matter and the amount owed tracked per matter — the shape an earned-fee transfer out of trust
will need. What is owed, and how overdue it is, are worked out when you ask rather than stored, so a
bill settled this morning is never reported as late.

Also extracts the sequence-numbering machinery matter numbers already used into a package billing and
matters now share, so the subtlety that makes a number draw race-proof lives in one place instead of
two copies.
- Billing — taking earned fees out of trust. The transfer that moves a client's money to the firm has
been refused by the platform since trust accounting shipped, on the stated grounds that what evidence
permits money to leave trust had not been settled. It is settled now, and this is the answer: **a
finalized bill, with enough still owing on the specific matter the money sits against.**

**Money leaves trust only against a bill the client has actually been charged, and there is no
override.** A bill that is still a draft is refused. A bill for a different client is refused. A bill
that does not charge the matter whose ledger the money is in is refused. An amount above what that
matter still owes on that bill is refused. Each refusal says which of those it was, so a member can
act on it rather than guess. This is the operation where real-world trust violations happen, and the
friction is deliberate: the honest cost is that a firm billing out of band — in a spreadsheet, or
through an insurer's portal — has to finalize the bill here before it can take its own fees, and
finalizing one here is cheap and does not require the platform to have produced it.

**The guarantee is structural, not a check that ran first.** Every condition above is read before the
money moves so the refusal reads as a sentence, but what actually holds the line is the ceiling on
what each matter owes, enforced by the database in the same all-or-nothing write as the money
movement. If a payment or another transfer consumes the balance in the instant between looking and
acting, the entire thing is abandoned — the money never leaves the client's ledger, no record of a
transfer is written, and nothing is half-done. Both halves are needed: one produces an answer a
person can use, the other is what makes it true.

**Applying part of a bill is ordinary.** A retainer replenishment that covers two thousand of a
six-and-a-half-thousand bill applies two thousand and leaves the rest owing, exactly, to the penny;
the next replenishment applies more. Nothing about the bill itself changes — it was evidence the
moment it was finalized, and what has been paid against it is a separate, permanent record of its
own. One transfer can settle several of the same client's bills at once.

**Trust's own rules still decide what trust permits.** Money under a disputed-funds hold cannot be
taken even when the balance looks sufficient; a closed account, an office with no recorded
jurisdiction, and a matter holding no client ledger each refuse in trust's own words. None of those
rules were restated, relaxed, or routed around to make this work — no trust code changed at all,
which is the test that the boundary was drawn in the right place.

Correcting a bill after fees have already been taken out of trust is deliberately **not** built yet.
When a firm concedes it did not earn part of what it has already moved, the money is sitting in the
firm's own account and giving it back is a decision about firm funds — a refund, a return to the
client's trust ledger, or a credit against a later bill — with real differences between them. The
platform will record that obligation and let the firm choose; it will not choose on its own, and it
will not pretend the trust ledger can be rewound.
- Calendar slice 2 — design. The owner's docket sent the calendar back for a second slice: firm
events, room and resource availability, links between events, and honest continuance semantics.
This is the specification and implementation plan for all four; no product code in this cycle.

**Firm events.** The calendar stops assuming every event belongs to a case. A firm meeting, an
office closure, training, a firm holiday — these get their own table with the same civil-date,
wall-clock-time, and per-row time-zone model hearings use, plus one thing hearings never needed: an
audience switch, so a firm-wide entry is on everyone's calendar without enumerating every member
into a list that decays with each hire. Firm events appear on the one firm calendar interleaved
with matter events under the same cursor, and never on a matter's timeline, because they belong to
none.

**Rooms and resources.** Conference rooms, pool cars, and equipment become first-class firm
resources — their own register, not Directory entries (the Directory is the conflicts corpus, and a
conference room does not belong next to opposing counsel) — and a booking ties a resource to
exactly one event, with its own window (booking the room from half past eight for a nine o'clock
deposition is real) in the resource's own zone. A booking blocks the room only while its event is
live: cancelling the event frees the room by derivation, with no second record to forget.
**Double-booking is recorded and reported, never refused.** Firms double-book on purpose —
tentative holds, shared rooms — and the front desk resolves rooms, not the software; the write
succeeds and both sides see the conflict, on the booking, on the grid, and in the response. A
room's schedule spans every matter, so the grid shows windows and kinds, never titles.

**Event links and continuance.** Events can be linked — a prep session to its deposition — and one
link kind carries real machinery: a continued hearing becomes a **new setting pointing at the
vacated one**. The old row keeps its date, its participants, and its history untouched; its status
says that setting will not occur and why; the new row is the hearing as it now stands; and the
schema itself holds the chain to a chain — one predecessor, one successor, no forks. Nothing is
rewritten and nothing is hidden: the timeline shows every setting in order, which is the procedural
history a litigator actually needs. A typo remains a simple edit — correcting a record and
rescheduling reality are different acts, and the platform now has a verb for each. Continuing a
hearing moves **no deadline**: the response lists the deadlines that referenced the old setting for
a person to review, because what a continuance does to a briefing schedule is a legal judgement,
not arithmetic.

Five per-firm tables, one additive column, one new federated source, four declared notification
emission points wired to nothing, and three owner flags — all confirmations, the scope itself
already owner-directed.
- Calendar slice 2 — firm events, rooms and resources, event links, and honest continuance. The
owner-directed second slice, built through every layer: five new per-firm tables, one additive
column, one new federated source, and fifteen new routes.

**Firm events.** The calendar stops assuming every event belongs to a case. A firm meeting, an
office closure, training, a firm holiday, or a reservation gets its own `firm_event` table — never
a nullable matter on the case-event table — with the same civil-date, wall-clock-time, and per-row
zone model, plus an **audience** switch: an all-members event is on every member's calendar without
a list that decays with each hire. Firm events interleave on the one firm calendar (a new `scope`
filter narrows to either side) and never appear on any matter's timeline. The federated read gains
the declared `visibilityAnchor` contract field: matter-anchored sources compose the visible-matter
predicate exactly as before, fitness-enforced, and the firm-anchored source sits on a reviewed
allowlist — an honest declaration, never a silent exemption.

**Rooms and resources.** Conference rooms, pool cars, and equipment become first-class firm
resources, and a booking ties one resource to exactly one event with its own window (the room from
half past eight for a nine o'clock deposition) in the resource's own zone, frozen at the write. A
booking blocks its resource **only while its event is live** — cancelling or continuing an event
frees its rooms by derivation, with no release step to forget. **Double-booking warns and allows:**
the write succeeds, the response carries the conflicts it created, and the availability read
pre-pairs every overlap — the platform reports what it sees and does not referee rooms. The grid
shows windows and kinds, never titles.

**Event links and continuance.** Events link (`related`, with a note), and a continued hearing
becomes a **new setting pointing at the vacated one**: the old row keeps every historical byte, its
status says that setting will not occur and why (`status_reason`, additive on the shipped table),
and the schema itself holds the chain to a chain — one predecessor, one successor, no forks, even
under racing writes. The full procedural history of a hearing is walkable in order from any
setting. A typo remains a one-row edit: correcting a record and rescheduling reality are different
acts, and the platform now has a verb for each. Continuing moves **no deadline** — the response
lists the deadlines that referenced the old setting as pure information, because what a continuance
does to a briefing schedule is a legal judgement.

Four notification emission points declared and wired to nothing; five firm-scope platform event
types seeded, and a firm event takes one of those firm-category types — the shared catalog's
category is what separates the two scopes, so typing the all-hands as a "Hearing" is refused by
name rather than filed as procedural history; the five load-profile bounds asserted over the fixtures corpus (a year of weekly firm
events, eight resources, deliberate overlaps, a five-node continuance chain). Owner flags R1
(warn-and-allow), R2 (closed resource kinds), R3 (no freestanding bookings) built as confirmed.
- Case calendar and matter timeline — design. A specification for the backend a calendar surface reads:
what happened on a case, what is coming, and where each of those facts lives.

The design's central call is **derived where the fact already lives, recorded where the fact is
born**. Most of what "transpired in the case" is already recorded — mail filed to the matter,
documents produced, assemblies run, originals moved in and out of the safe, money moved through
trust, time and costs booked, conflicts run, the matter opened and closed — across eleven per-firm
tables that each already carry a timestamp and, in most cases, an index built for exactly this filter
and sort. Those are read **in place** through a source registry rather than copied into a calendar
table: nothing is backfilled, nothing drifts, no privileged fact gets a second copy, and the timeline
cannot disagree with the custody register because it _is_ the custody register. Only the facts that
exist nowhere today — litigation events and deadlines — get tables of their own.

Litigation events are member-entered and first-class: a hearing, a filing, service, an order, a
deposition, with a type catalog a firm can extend, participants who may be a firm member, a Directory
entity, or someone external to both (a judge does not have to be added to the Directory to appear on
the record), a courtroom as free text, and a date that may be all-day, timed, or a range.

Deadlines are modelled separately, because a deadline can be satisfied and an event cannot: a due
date and optional time, who satisfied it and what filing discharged it, and a reason on the record
when one is vacated. A deadline past its date and still open reads as **overdue** — computed when it
is read, never written down. The platform reports what it can see; it never records that a firm
missed anything, because the deadline may have been extended, satisfied elsewhere, or vacated that
morning.

**The platform does not calculate deadlines, and the design says so as a position rather than a
to-do.** No business-day arithmetic, no court-holiday calendars, no "three days for mailing", no
cascade when a trigger date moves. Missed deadlines are the largest single source of malpractice
claims, and that argues for visibility rather than arithmetic: a computed deadline that is wrong is
worse than none, because it will be trusted precisely because it was computed. Where a verified
statutory catalog eventually exists, it **proposes** and a person **confirms**, with the catalog
entry and its version frozen onto the row so an amended statute surfaces as something to review
rather than as a date that moved while nobody was looking.

Hearings finally get real time zones. A date is stored as a calendar date and a time separately, so
an all-day filing is not an event at midnight, and the zone lives on the event rather than on the
office — a Nevada firm appearing in a California court has a hearing in California's zone, and
nothing about the firm says so. Offices gain a time-zone setting as part of this, which is also what
lets assembled documents stop rendering every date in a normalized zone.

Reads are bounded and keyset-paginated: one statement per source, all issued together, merged in
order, with a single cursor that works across all of them. Nothing is filtered after a page is cut,
and every read composes one visible-matter rule in the query itself — today it keeps the platform's
internal holding matter off a firm's calendar, and it is the single place a future confidentiality
screen attaches without touching a source.

Two specs, one decision record, and seven owner decisions. No product code, no user interface, and no
court integrations in this cycle.
- The case calendar and matter timeline — the backend a firm's calendar reads. Two questions that sound
like one and are not: what has happened in the litigation, and what the firm must do next.

**What is recorded here.** Litigation events (hearings, filings, service, orders, depositions,
mediations, trials, client meetings) and deadlines, neither of which the platform had any way to hold
before. An event carries a **civil date** and a separate optional wall-clock time — because "all day"
is what a filing is, and storing midnight-local-as-UTC is the daylight-saving off-by-one that moves a
hearing by a day when the clocks change. Its **time zone is required and lives on the row**: a Nevada
firm appearing in a California court has a hearing in Los Angeles, and no property of the firm, the
matter, or the office says so. Participants can be a firm member, a Directory entity, or somebody
external to both, so nobody is forced to create a Directory record for a judge in order to name one. A
continued hearing is the **same hearing on a new date** — one row, edited, with the move on the audit
trail, rather than two hearings on the calendar and a question about which one counts.

**The timeline is federated, and nothing is projected, copied, or backfilled.** Everything the firm
already recorded about a case — documents filed, mail captured, documents assembled, originals moved
in and out of the safe, client money through trust, time and costs booked, conflicts checks run, and
the matter's own opening and closing — is read **in place** through a registry of thirteen declared
sources, merged under one comparable ISO-8601 sort key and the platform's existing cursor. A source
is a read-side declaration: a statement builder, a projection, and a decision about whether it has a
non-privileged label. It is never a write-side obligation on the subsystem that owns the rows. The
property that buys is the one worth having — a federated timeline **cannot disagree** with the
register it is built from, because it is that register; the bug where the calendar says one thing and
the custody ledger says another cannot be written. It also means a custody movement back-dated to
Friday and typed on Monday sorts on **Friday**, which a projection over write-time timestamps would
have got wrong for every physical-world event in the system.

**The platform does not calculate deadlines, and that is a position rather than a gap.** No
business-day arithmetic, no court-holiday calendar, no service-method offsets, no cascade when a
trigger date moves, no default deadline when a matter opens. Missed deadlines are the largest single
source of malpractice claims, and that cuts toward visibility and against arithmetic: a computed
deadline that is wrong is worse than none, because it is trusted precisely because it was computed and
the firm that would have looked the rule up does not. A deadline records the date a person supplied,
the authority **they** state, who recorded it, and — where there is one — a link to the event that
started the clock, which is a record and never an input to a calculation. The columns a verified,
jurisdiction-keyed catalog would one day write through a propose-and-confirm path are reserved and
refused until such a catalog exists.

**Overdue is derived and never written.** A deadline still open past its due instant — resolved in its
own zone — is reported overdue every time a page is read. There is no column, no sweep, and no state
transition, because a platform that writes "missed" onto a firm's record has asserted something about
that firm's conduct it is not in a position to assert: the deadline may have been extended by a
stipulation nobody has typed in, met under another matter, or vacated by an order that arrived this
morning.

**Every source composes the visible-matter predicate into SQL before its `LIMIT`**, as a required
argument rather than an optional one, so a source that forgets is a type error before it is a test
failure — and post-filtering, which under-fills a page and turns the page size into an existence
oracle, is structurally impossible. Today the predicate excludes the platform-owned custody holding
matter, which is a genuine filter doing genuine work; when an information-barrier overlay is built it
is one more clause in that one predicate and every registered source inherits it untouched.

Four per-firm tables, one `location.time_zone` column (which finally makes `timeZoneForLocation` in
document assembly return the office's real zone instead of UTC), two composite indexes on shipped
tables, two permissions, and seventeen routes.
- **Research: can Cloudflare AI Search back our search, and what does natural-language search actually
buy?** An assessment of AI Search (formerly AutoRAG) written from a full crawl of its current
documentation and the recent Cloudflare blog posts, mapped onto the three things we have or have
designed: the built keyword write pipeline, the unbuilt Vectorize semantic half, and the AI-consent
posture. The recommendation is **adopt-partially, and not for the thing the question points at** —
refuse it as the discovery keyword engine, keep it live as the leading candidate for the unbuilt
semantic half, and prove it on a smaller surface we have no plan for: a retrieval-only
natural-language search over a firm's own working documents.

Three findings carry it. **The keyword half is not a contest** — AI Search documents BM25 over chunks
with a tokenizer choice and an all-or-any match mode, and no phrase, proximity, wildcard,
field-scoped, or grouped boolean query at all, which is exactly what e-discovery search is; it also
returns a chunk and a score, never a highlight offset into the source document. **The decisive
constraint is in our own code** — the R2 object key is `files/{fileId}/{versionId}`, flat, with no
matter in the path, so AI Search's built-in `folder` attribute cannot express "this matter" against
the bucket as laid out today; the only route is one of five custom metadata fields, set at put time,
which we do not set. And **the confidentiality posture is better than expected**: retrieval-only AI
Search (`search()` rather than `chatCompletions()`, query rewriting off) makes no third-party frontier
model call at all, so it sits on the safe side of the ADR-0109 gate rather than behind it.

Corrects one claim in the [Cloudflare Agents assessment](docs/research/2026-08-04-cloudflare-agents-assessment.md),
which refused AI Search in a line partly on the grounds that it would "break the pin": AI Search
supports `@cf/baai/bge-large-en-v1.5` at 1,024 dimensions and fixes the embedding model at instance
creation, which is the same pin, enforced by the platform. Records the arithmetic the one-line refusal
skipped — the 100-namespace and 5,000-instance account caps that leave instance-per-firm as the only
allocation that scales, the 4 MB file limit, the 6-hour default sync that breaks index-on-commit, and
preview pricing published the same day that puts AI Search storage at roughly 130x R2's rate. Research
only — no decision, no code, nothing adopted; four owner flags with recommended defaults, and eleven
things explicitly not to conclude without testing.
- **Research: can the quality gate run on Cloudflare instead of GitHub Actions?** A per-job evaluation of
`.github/workflows/gate.yml` against Cloudflare Workers Builds, written from the primary documentation
tree and from measured gate-run data. The recommendation is to keep the gate on GitHub Actions and keep
deploys on Workers Builds: the two platforms are each already running the half they are built for, and
a migration would move about a tenth of the bill. Workers Builds' 20-minute build timeout and 8 GB
memory ceiling each independently disqualify the type-aware lint job — 26 minutes measured at its cheap
tier and 43% of a run's billable minutes — and there is no job graph, matrix, artefact passing,
arbitrary caching, merge-commit trigger, or aggregate required status to build a gate out of. Records
two findings worth keeping regardless: Workers Builds ships an **undocumented Docker daemon** that the
deploy pipeline already depends on for the Rust-to-WASM builds and every Container image, and GitHub's
own **$0.002/minute Linux 1-core runner** is a 3x rate cut on the gate's short jobs for a one-line
change per job. Research only — no decision, no configuration changed.
- The design for the **community surfaces** — a public changelog, feature voting, and a community board —
modelled on ClickUp at the owner's direction and studied against ClickUp's live surfaces rather than
from memory. Design and five decision records only; no product code, no schema, no package.

**The public changelog renders from the source that already exists, once that source can say who it is
for.** Every notable change here is already written as a fragment in plain user-facing prose, so a
second hand-written public changelog would be a second home for the same fact and would drift within a
month. What stops the fragments being published as they stand is that a quarter of them are design
documents, at least fourteen say in their own words that they ship no product code, and one is a
build-platform evaluation ending "research only — no configuration changed." Publishing those would
advertise features that do not exist, breaking the one property the bundled-changelog model was chosen
to guarantee, in the opposite direction from the one it guarded. So the fragment contract gains a
required `audience` key with **no default in either direction** — public publishes a research note the
first time someone forgets, and internal fails silently and the changelog quietly dies — plus a public
prose block in the same file, and a fitness function that fails the build on either omission. The
eighty-seven existing fragments migrate in one pass, an hour now and a per-file judgement call at eight
hundred. Entries publish dated and curated into thematic roll-ups, two-level as ClickUp does, with
likes and a feed — but self-hosted rather than on Canny, category-filterable rather than carrying a
single label, free of the emoji prefixes ClickUp uses, and **linking back to the request that asked for
each shipped item, which ClickUp does not do**.

**The forum question resolved in an unexpected direction: ClickUp does not have one.** Its community
page lists a Facebook group, a subreddit and a university; users asked for a real forum in 2018 and
again in 2023, and the second request was closed "Not on the roadmap" in August 2025 after staff pointed
to Facebook — the poster objecting that those are "social media walls you have to scroll through rather
than an organised searchable forum with different boards." What ClickUp runs under the word forum is a
category-structured, status-tracked, publicly readable board with comment threads that stay alive for
years. That shape sits outside the confidentiality analysis that made an earlier draft of this design
recommend against a forum, because the subject is the software rather than a representation — so the
design builds it, as **one board with two post kinds**: votable requests with a status pipeline, and
threaded questions with votable answers, where a question that turns out to be a missing capability
converts to a request in one action and carries its thread. **The scoping is held by structure rather
than by rules:** every category is a product area and there is no general category, no off-topic, no
practice-management and no ask-a-lawyer, so a question seeking legal advice has nowhere to go and the
composer asks which part of the software this is about before accepting a word. Three failure modes are
named rather than absorbed — the question that is bivalent depending on whether the facts come with it,
the long tail of specificity that no rule separates, and **screenshots, which is the serious one**,
because a screen capture of legal software carries a client name, a matter number and a ledger balance
and defeats every text-based control at once. Attachments are therefore off at launch, with a "send this
to support instead" control taking their place.

**Identity moved toward ClickUp's and away from an earlier recommendation of forced pseudonymity:** real
display names by default with an account-level pseudonym permitted, because with the subject scoped to
software a name discloses nothing, and because the firm — never displayed, here or on ClickUp — was
always the sharper edge, since firm plus practice area plus question is the inference path. The board is
public to read and login-to-write as ClickUp's is, but **never indexed and with the voter list never
rendered**, because ClickUp's public voter list of real names was located through a web search, which is
the harm demonstrated rather than theorised. Votes carry the firm that cast them and the board ranks by
**distinct firms**, so a hundred ballots from one firm rank as high as one. ClickUp's six statuses are
adopted, with a mandatory reasoned decline and a thirty-day triage clock added — ClickUp's own board
demonstrates both failures, a 2018 request marked Completed for something never built and a 2022 thread
still accumulating comments in 2026.

Also settled: two moderation postures rather than one, because the failures are not alike. Spam
**degrades** — a read-only kill switch in KV, one operator write and no deploy, built with the first
write endpoint rather than retrofitted during the incident that needed it. Confidentiality **removes
first and asks later**, inverting normal moderation because a false positive costs a lawyer an
eight-hour wait and a false negative is permanent: one-click instant author delete, a single reader flag
that hides a post, and a format-only detector that never touches firm data because doing so would cross
the boundary the package isolation exists to hold. So at 3am the post is already hidden, and a human
decides at 9am. Fourteen decisions that are cheap today and impossible later close the spec.

**Where they live is settled: `magnacarta.esq`, with `magna-carta.com` staying marketing only.** The
changelog takes up the reservation the hosts table already holds for the public product-updates pages —
`magnacarta.esq/changelog`, on the one hostname that should accrue search authority, since it is the
only surface here that wants to be indexed. The board gets its own host at `community.magnacarta.esq`,
because it is permanently unindexed, serves user-authored content from its own worker, and is the
surface most likely to need turning off; `community` rather than `feedback` because it carries questions
as well as requests. Both sit beside the status page, so every operational-transparency surface is in
one place. One consequence came free and was verified rather than assumed: `.esq` is HSTS-preloaded at
the top level by its registry, so both pages are HTTPS-only in every major browser with no header from
us and no configuration step for anyone to forget.
- Custodian — the destruction workflow, and the first jurisdiction in the will-deposit duty catalog.

**Destroying a client's original now takes two people, and it takes them by construction.** A person
raises a request naming the packet or one item inside it and writing down the reason and the authority
they assert; a **different** person approves it; a third call records that it was carried out. The
requester and the approver being two people is enforced at the database by triggers as well as by the
service — including the case a column check cannot see, where a request records no requester at all
and any approver would otherwise satisfy it. A request that has been refused, executed, or withdrawn
is terminal: it is re-raised, never re-decided. Execution appends a `destroyed` entry through the
register's one movement write path, so the destruction of a client's property carries a person's name
on the same append-only ledger every other event does, and the request row records which ledger entry
it produced.

**Two refusals have no override anywhere on the surface.** A hold in force forbids both raising the
request and carrying it out — asked twice, because a hold placed in the window between them is exactly
what a hold is for. And an item recorded as an irreplaceable original is **never** destructible: there
is no force flag, no override field, no privileged caller, and no second endpoint. That refusal now
also binds the ordinary movement path and the database itself, so it holds for a write path nobody has
built yet; the only way an original becomes destructible is for a person to change the record about
that specific object, which is a deliberate, audited change to a fact rather than a way around a rule.
Still deliberately absent: any retention period, default, derived date, or automatic sweep.

**Closing a matter now surfaces the physical originals the firm still holds against it — and never
blocks.** This is the deliberate opposite of the trust close rule: money left in a client ledger
refuses a close outright, but a firm holds a client's will for decades after the last matter for that
client closed, and that is the steady state of a safe-custody register rather than a loose end. The
close response carries the notice; there is no arm of the contract on which it becomes a refusal, and
the notice reports a count and nothing that names the property, its owner, or its number.

**The will-deposit duty catalog ships with Nevada encoded, and refuses every jurisdiction that is
not.** Asking for a jurisdiction with no verified entry raises a named refusal rather than falling
back to a baseline, resolving to the most common answer, or returning an empty list somebody would
read as "nothing applies" — and "nobody recorded a jurisdiction" stays a different refusal from
"nobody has verified that jurisdiction", because they are fixed differently. Nevada carries **NRS
136.050(1)**'s 30-day delivery duty with the statute quoted verbatim and cited, the clock starting at
_knowledge_ of the death rather than the death, both delivery targets the statute offers, the civil
liability under subsection 3, and the consequence that delivering to the clerk makes the will a public
record. The named personal representative's own duty and the court-ordered production under NRS
136.060 sit beside it — the latter carrying no interval at all, because the statute says the court
names the time. The verified **absence** of any lifetime court deposit in Nevada is encoded as an
explicit negative, because uniform-act deposit language that Nevada never enacted circulates as though
it were Nevada law. The original-will lodging requirement is a **local court rule**, so it is keyed
below the state — Clark County and Washoe County only — and Nevada's other nine judicial districts
refuse on their own terms, since a local rule nobody checked is not the same as one that does not
exist.

The catalog carries what the statute says and never an interpretation of it: the open questions the
research left open — whether "knowledge of the death" reaches constructive knowledge, what answers the
"reasonable cause" defence — stay open, and a due date is computed only from a date a person recorded.
The register records no date of death today, so that computation ships as a seam rather than as a
number nobody supplied.

Also: the location tree's depth cap of eight is proven at both sides of the boundary and on both write
paths, and the ownership label on an owner link is validated against the firm's **own** catalog when
the firm has configured one (and against nothing when it has not) — never against a platform list of
tenancy forms.

Six routes over the existing `custody:read` and `custody:manage` permissions (no new permission), five
columns and nine triggers on the existing destruction-request table, and four problem types:
`custody-approver-must-differ`, `custody-intrinsic-value-not-destructible`,
`custody-destruction-not-actionable`, and `custody-jurisdiction-unavailable`.
- Custodian — gated release. An original no longer leaves a firm's custody until the authority it
leaves on and the identity check made on the person collecting it are both on the record. The gate is
a precondition on the one movement write path that already records the borrower, so there is still no
release route, no release service, and no second place the append-only invariant has to hold; a
`released` movement now has to name who collected the property and carry the capture, and the capture
is frozen on the ledger row itself, which can never be edited or deleted. Two-signatory release is a
per-firm policy, off by default, and the two signatories must be two people. Three `BEFORE INSERT`
triggers make all of that structural rather than a service convention — triggers rather than CHECK
constraints deliberately, so releases recorded before the gate existed stay exactly as they were
recorded instead of being made to pass a rule nobody applied at the time. The authority itself is
free text a firm writes: what document suffices to release an original varies by jurisdiction, and
the register encodes none of it. Adds the `custody-release-not-authorized` problem type and the
`custody.releaseGated` counter. The daily check-out stays frictionless and is deliberately not gated.
- Custodian — stocktake. A firm can now take a physical count of its custody register, or of one branch
of its container tree and everything beneath it, and get back a reconciliation of what the register
claims against what a person actually saw: originals expected and not found (missing), originals
found somewhere other than where the register said (misplaced), originals found where the register
did not expect them at all (unexpected), and objects on the shelf the register has no row for
(unregistered). Observations are recorded in batches, the way a person walking a safe with a scanner
produces them, and each one freezes the location the register expected at the moment it was made — so
"sighted on the wrong shelf" stays true after somebody moves the packet to the right one.

**A stocktake observes and reports. It does not dispose, relocate, or correct.** Nothing on this path
writes the movement ledger, a packet, or an item: a count that wrote the register into agreement with
itself would erase the difference the count exists to find, and would put a movement in an
append-only ledger that no person asserted. The reconciliation names the corrective movement a person
would record — a move to where it was actually seen, a `found` for an original the register believed
was out — as a proposal on a report, and a person records it through the one movement write path or
does not. A missing original proposes nothing at all: the honest answer to an empty shelf is an
investigation, not a ledger entry closing the record on the exact failure that most needs one open.
Destruction and retention are untouched and remain owner-gated.

Sighting rows are evidentiary — a named person's assertion that they saw a specific original on a
specific shelf on a specific day — so they carry the movement ledger's append-only discipline at the
database: `RAISE(ABORT)` triggers on update and delete, the INSERT-OR-REPLACE bypass closed by a
BEFORE INSERT guard, and a further trigger refusing an observation recorded against a count that has
already closed. A mistake is corrected by recording the later, truer observation; both stay on the
record, because both are what happened. Closing a count freezes what it found on the stocktake row,
so the number a firm reports cannot drift as the register is subsequently put right; a count begun
and never finished closes as abandoned instead, freezing nothing — the reconciliation of a half-done
walk reads as a safe full of missing originals, which would be alarming and wrong.

Seven routes over the existing `custody:read` and `custody:manage` permissions (no new permission),
two per-firm tables, and the `custody-stocktake-closed` problem type.
- **A person in the Directory can have their pronouns on file, and documents use them.** A person entry
now carries the pronouns that person stated — she/her, he/him, they/them, or any set at all, including
one this software has never heard of. Nothing is ever worked out from a name or a title: a firm
records what it was told, or the field stays empty. It is optional everywhere, and leaving it empty is
an ordinary thing to do rather than a gap the record is nagging anyone to fill.

The set is recorded whole — the five ways a pronoun appears in a sentence ("she signed", "we served
her", "her signature", "the signature is hers", "she represented herself"), plus whether the set goes
with "is" or with "are". That is what lets a template write any of them correctly without the person
writing the template knowing which set is in play, and it is why the field is not a short list of
options to pick from: a list has to leave someone off, and the people it leaves off are the ones most
used to seeing their pronouns come out wrong.

**Two new things a template can write.** `pronoun(client, "subject")` puts that person's pronoun in
the position named — subject, object, possessive determiner, possessive pronoun, or reflexive.
`pronounVerb(client, "signs", "sign")` picks the verb form that agrees with them, because "they" takes
"sign" where "she" takes "signs" — the template supplies both forms and the person's own record
decides. There is no grammar engine guessing at verbs; the words on the page are words the author
wrote.

**A person with nothing on file is written they/them.** Not a blank, not a "[CLIENT PRONOUNS]" marker
in the middle of a sentence, and never a guess from their name. Most people never state a set, so this
is the ordinary case and it has to read correctly — and it does for an organisation, and for a matter
where the role covers more than one person, both of which get the same neutral wording for the same
reason: nobody is being described, so nobody is described wrongly.

Where a document wants to PRINT someone's pronouns rather than use them — a cover sheet, a signature
block — every party and staffing subject now has a `pronouns` field that shows them as "she/her". That
one is blank when the record states none, because a field that reports a fact should not invent one.

Pronouns are personal data: they are erased with the rest of a person's record and never appear in a
log. They are not a gender field, and the software holds no such field — the two are different facts
and neither is worked out from the other.
- The discovery engine — the pure-Rust core that reads a document a firm did not write. The first
built piece of Discovery, and deliberately the piece with no Cloudflare, no database, and no worker
in it: everything the rest of the subsystem does is a function over what this engine says about a
document.

**It reads the bytes, and it cannot read the name.** A production's file names are wrong often
enough that routing on them is how a spreadsheet gets read as a picture — and a name is also the one
part of a hostile file the other side controls most cheaply. So identification takes bytes and
nothing else: there is no parameter a file name could arrive through. Comparing the two answers is a
separate call whose result is **reported and never acted on**, so a spreadsheet renamed `.jpg` still
identifies as a spreadsheet and the lie ends up in the record instead of in the routing. A ZIP is
refined into the package it actually is — a Word document, a workbook, a presentation, an
OpenDocument package, or a plain archive of loose files — and a compound file into a legacy Word,
Excel, or PowerPoint document, an Outlook message, or an encrypted Office package, all from entry
names, with nothing decompressed to learn it. A format the engine cannot read is named anyway,
because "we could not read this, and it was a legacy WordPerfect document" is a defensible sentence
and "extraction failed" is not.

**A born-digital PDF now extracts its real text.** The platform's extraction port shipped backed
only by recognition, which skips pages that already carry a text layer — so the single most common
document in a law firm extracted to nothing and was recorded unextractable. This engine reads the
page's own glyphs, and reports per page which pages have words only as pixels, so a document whose
text is already there is never photographed and guessed at. A scan still goes to recognition; a
contract with a scan appended sends only the scanned half. That is a platform-wide correctness fix
that happens to have been forced by discovery.

**Everything derived is derived from one canonical form.** Line endings, canonical composition,
typographic and non-breaking spaces, invisible zero-width characters, and stray control bytes all
settle in one place before anything is chunked, hashed, or fingerprinted — because two copies of one
document that render identically must deduplicate, and a document with joiners smuggled between its
letters must not be able to evade that. The passage chunker moved out of TypeScript into the shared
engine **byte for byte**, carrying its own test corpus with it: the desktop client and the server run
the same engine over the same document into one index, and an index that disagrees with itself about
what a document says is not an index.

**Archives open, under five guards, in exactly one place.** A production received from another party
arrives as a zip, and a discovery subsystem that cannot open one cannot ingest an external production
at all. So the opaque-archive rule narrows to the File Manager, and the discovery path expands —
under nesting-depth, total-bytes, expansion-ratio, and entry-count ceilings, plus unconditional
rejection of any entry whose path tries to escape, every one of them checked before a decompressed
byte is kept. A zip bomb trips the ratio guard rather than memory. An encrypted entry is reported and
its nine thousand siblings still load. An archive nested past the ceiling is described honestly
rather than opened or dropped. An archive can also be listed without decompressing anything at all,
which is what lets an unexpanded one still be accounted for rather than shrugged at.

Also: the five digests e-discovery load files ask for (including MD5 and SHA-1, carried as
legacy-interop exactly as the platform already labels them) in one pass over the bytes; a
deterministic near-duplicate fingerprint computed where the text is already in memory, because
retrofitting it across a production is not a migration but a second processing run; each format's
best available document date, reported verbatim with the source named rather than converted; and a
page count where the format actually has pages, because Bates numbering will need it and it cannot be
recovered later without re-reading every byte.

**Every parser in it is memory-safe, and that is enforced rather than intended.** Discovery ingests
hostile files at scale — the worst case the rule exists for, not an edge case — so no C-backed codec
feature is selected on any path, and a test that reads the engine's own manifest fails if one ever
is. A malformed, truncated, encrypted, or absurd input is always a named error and never a panic, and
a sweep runs every fixture through truncation, bit-flips, and inflated length fields against every
entry point on every test run.

The engine is hosted by its own container and worker rather than sharing the search container, whose
whole premise is staying warm for sub-second queries: a bulk load that made review search slow is the
one combination a discovery user would actually hit. It has no outbound network access.

Nothing calls this engine yet. The review-set model it produces facts for, the queue lane that feeds
it, and the wiring into the search pipeline are the sub-slices after it.
- The review set — the object the whole of Discovery is a function over. Every deferred discovery
feature (filters, tagging, threading, near-duplicates, the privilege log, production) is a question
asked of one thing nobody had built: **these are the documents under review in this matter, this is
where each one came from, this is whose records they were, and this is what happened when we
processed them.** This builds that, fills it from the firm's own records, and stops before anyone
reviews it.

**A review document is a pointer, and it never becomes a copy.** It names a file version or an email
message the firm already holds — with the hash already computed at ingest and the scan verdict
already recorded — so pulling a thousand of a matter's documents into a corpus moves no bytes and
re-reads none. One blob store, one scan gate, one version model, one hold mechanism, one destruction
policy. And it pins the **version**, not the file: a document that gains a new version tomorrow does
not quietly change what a firm has already certified as the corpus under review. A newer version
enters only through a new load, which is a recorded act with its own record of who did it and when.

**Whose records these were is a first-class fact, and it is two words.** The platform already ships a
register of physical client originals a firm holds in safekeeping — and a lawyer calls the person on
that register a custodian too. One word meaning two different things in the same matter, sometimes on
the same screen, is a defect waiting to be written, so discovery says **record custodian** and never
the bare word, in code, in schema, in comments, and in anything a person reads. A source scan enforces
it both ways. Record custodians belong to their review set rather than to the firm, because the same
name in two matters is not assertably the same person, and asserting it wrongly is not a duplication
problem — it is something a firm gets asked about under oath.

**Every load says whether the firm's own assistant transcripts are in scope, and there is no
default.** A transcript is the firm's work product — its reasoning about the matter, not the client's
records — and whether it belongs in a corpus the firm is about to certify the contents of is a
decision a person makes on purpose. So the field is required, in both directions: a silent exclusion
decides as much for somebody as a silent inclusion would, it just fails the other way, and a firm that
believed transcripts were in scope would learn otherwise after producing. The answer is recorded on
the load itself, so the record can state what the corpus was **drawn from** and not only what landed
in it. Asking to include them is currently answered by name — the lane that reaches them arrives with
the review surface — rather than by silently dropping the request or by claiming a sweep that did not
happen.

**Nothing is dropped quietly, and the counts have to add up.** A document ends in exactly one of two
states: processed, or excepted with a named reason from a closed list of fifteen — because "we could
not read this, and it was a legacy WordPerfect document" is a sentence a firm can stand behind and
"extraction failed" is not. There is no third state and no path that reaches neither, and a load
cannot be marked finished while what arrived does not equal what was processed plus what was
excepted. The database refuses it, not just the code.

**The limit is a refusal, not a slow failure.** A review set carries a document ceiling, and a load
that would carry it past is refused when it is declared — with the count and the ceiling both in the
message, so a firm knows how much to split off rather than guessing. The alternative is a firm
finding out at four hundred thousand documents that its database is full, which is an outage with no
good exit.

**A closed review set gives back its working files and keeps its records.** Closing releases the
extracted text, the metadata, and the search index for collection — all rebuildable from the
originals at any time — while every row, every load manifest, and every exception report stays.
There is no reopen, deliberately: a corpus that could be reopened is a corpus whose contents depend
on when you looked at it.

Also: a load fans out from a coordinator that keeps its place in durable storage rather than in
memory, so a deploy or an eviction partway through a quarter-million-document load resumes where it
actually got to instead of starting over or skipping the rest; an email and its attachments enter as
one family and stay together, because a production that splits them is a production that gets
challenged; a quarantined or unscanned file is refused **by name** rather than skipped, because a
firm that selected fifty documents and silently received forty-eight has a corpus it cannot certify;
and discovery is its own permission scope, so full access to a matter reaches no review set on it —
material another party produced may be attorney's-eyes-only under a protective order, and matter
access must not carry it.

Nothing processes the corpus yet. Reading a document's text, deduplicating, indexing, and the
exception report a litigator actually reads are the sub-slices after this one.
- Discovery — ingest and processing — design. The specification for the first built slice of
e-discovery, over a large amount of machinery that already shipped switched off: the search index
format, the write pipeline, text recognition, email parsing, PDF reading, and evidence-grade hashing
were all waiting for something that did not exist.

**What was missing was not an engine — it was the corpus.** Nothing in the platform said "these are
the documents under review in this matter, this is where each one came from, this is whose records
they were, and this is what happened when we processed them." Every discovery feature still to come —
filtering, tagging, threading, near-duplicate detection, the privilege log, producing documents to the
other side — is a function over that one object. This design builds it: a **review set** that
documents and email are **loaded** into, one recorded load at a time, each load carrying a manifest of
what arrived, from whom, on whose authority, and with what hashes.

**Whose files these were is recorded, and the word for it is chosen carefully.** The platform already
has a Custodian register — the firm's safekeeping of physical originals — and discovery's "custodian"
means something completely different. Rather than let one word mean two things in the same matter,
discovery says **record custodian**, in two words, everywhere: it reads naturally to a litigator and
cannot be mistaken for the safekeeping register on screen or in the code.

**Nothing is dropped quietly, and nothing is deduplicated away.** Every document ends in one of
exactly two states — processed, or excepted with a named reason — and a load only completes when the
counts reconcile. Encrypted, corrupt, unsupported, and unreadable documents appear by name in an
exception report the firm can hand to opposing counsel; "we produced everything we could read" becomes
a document rather than an assertion. Duplicate copies are grouped so the expensive work happens once,
but the duplicate is kept and stays attributed to the custodian it came from, because "which
custodians held this document" is a question asked under oath and "we deleted that" is not an answer.

**Files from the other side are treated as hostile, because they are.** Every externally loaded byte
crosses the same gate the platform already uses — real-format checking, hashing, malware scanning,
quarantine as a status rather than a deletion, because an infected file in discovery is evidence.
Archives received in a production are opened, which they previously never were, under hard limits on
nesting, size, expansion ratio, and entry count that are checked before anything is decompressed. A
new document-reading engine is written entirely in Rust, compiled once for the server and once for the
desktop so both produce identical results, and the design introduces no new memory-unsafe dependency.

**Scale is stated in numbers instead of adjectives.** A small production is 10,000 documents; a
moderate matter is several hundred thousand — orders of magnitude beyond everything else the platform
stores, and the only data whose volume is set by an outside party. Document text never goes in the
database, review sets have a document ceiling that is refused rather than silently exceeded, bulk
loading runs in its own lane so it cannot slow ordinary file uploads, and a resumable coordinator
survives restarts mid-load. Semantic search over a review set is opt-in, because embedding hundreds of
thousands of documents costs real money whether or not anyone runs a semantic query.

Two specs, one decision record, four build sub-slices, and ten owner decisions each carrying a
recommended default. No product code in this cycle.
- The design for the **discovery review workflow** — what happens between loading a corpus and handing
the other side a production. Design and slice plan only; no product code, and coding ships first.

**Coding that cannot lie about itself.** A review set gets a coding panel: groups of tags, where a
group is either a single choice (a document is responsive or it is not — never both, and the
database itself refuses the second answer) or a set of flags. The machine reads a tag's declared
meaning, never its name, so a firm can rename every label without changing what gets produced.
Every application and removal keeps its row forever with who did it and when; a bulk operation
freezes the exact list of documents it ran over before it starts, and undoing it removes precisely
what it applied and nothing anyone else did since. "Who tagged what, when, and how" is answerable
years later in one read, which is the question a meet-and-confer actually asks.

**Privilege review that produces the log, not just the label.** Marking a document privileged is
ordinary coding — same panel, same bulk tools, same record — and it opens a claim: which privileges,
and the described basis. The privilege log is generated from those claims plus the dates, authors,
and recipients already extracted at load time, and the generator is built so it cannot read document
content at all — a log entry describes the ground for withholding, never the substance withheld.
Clawbacks in both directions are recorded acts: a production received and clawed back leaves by a
recorded reversal, and a document we produced and claw back stays in the production record with the
clawback written beside it, because the numbers were served and are cited.

**Productions that are evidence.** A production freezes its membership into an explicit list before
anything renders, draws its Bates numbers as a block from a per-matter register so two productions
can never overlap, renders images with redactions burned by the engine that fails closed on any
verification doubt, hashes every artifact with the digest set opposing tooling verifies, and then
never changes again — corrections are new productions that say what they replace. Withheld
privileged documents appear on the log and never in the volume; a redacted document's produced text
comes from the redacted image or not at all, never from the original extraction; and the load file
names every Custodian of Record who held each document, including the ones whose copies were
deduplicated,
because "which custodians held this" is asked under oath.

Also settled: the review surface arrives together with the per-review-set access list that enforces
who may see it, every document read re-checks authorization at the moment of reading, walled review
sets are absent rather than greyed out, and nothing the review workflow writes can reach the firm's
natural-language search index — productions and coding live where that index structurally cannot
look. Four questions stay open for the owner: whether privilege coding needs its own permission
tier, whether withheld documents consume Bates numbers or placeholders, what happens by default when
privilege splits an email family, and the privilege log's delivery format.
- **The mail-client add-in's client API is complete: the firm's mail client can now ask where a message
belongs, file it, and read back what happened.** Filing itself already worked — an add-in posts the
open message to its matter and reads the wall-safe "already filed" indicator — but three things it
needs were missing, and each is now a route.

**Where should this go?** A new matter-suggestion read ranks the matters an open message probably
belongs to, so the pane can pre-select one instead of making an attorney search mid-triage. Four
signals combine, ordered by how hard each is to be wrong about: the conversation is already filed to a
matter (the strongest — it is the thread itself, not a guess about who is on it), the subject line
carries the firm's own matter number, a correspondent on the message is a party on a matter (live now
that Directory resolves an address to an entity), and last and weakest, whatever the member typed —
delegated to the same free-text matter search the caseload list uses, so "search" means one thing
across the product. Each suggestion carries its confidence and the reasons behind it in plain language,
and the response flags when the top candidates tie, so a client knows not to pre-select anything.

**Every suggested matter is one the member can already see.** Suggestions are the one place in the
subsystem where the server proposes matters nobody asked for by name, so the narrowing happens before
the ranking, not after: a matter the member is walled from contributes no suggestion, no reason, and no
count, and its absence is indistinguishable from having no evidence at all. The message facts ride the
request body rather than a URL — a subject line and a client's correspondents are the firm's mail and
do not belong in a log.

**What happened to what I filed?** Filing a message returns a job identifier and finishes off the
request path, and until now that identifier led nowhere. A capture-status read turns it back into the
answer: which record the message became, whether it was filed outright or staged for a person to
accept, and whether the firm already held it and the capture converged on the existing record rather
than writing a second one. The capture worker records its outcome on the same atomic write as the
capture itself, so a status can never describe a filing that rolled back. A job whose result sits on a
matter the caller cannot access is reported as absent — never as somebody else's matter.

**What do I show this member?** A filing-context read gives the pane everything it needs before the
member chooses anything: the matters they have most recently filed mail to (their own filings — a
shortcut list is a personal working set, not a window onto what colleagues are busy with), whether each
has a live forward/CC capture address, whether the firm has a catch-all, the zone those addresses live
under, and the size ceiling a message must fit under so a too-large message is refused on the desk
rather than after the upload. Capture tokens stay write-once: the response says an address exists, never
what it is.

All three are reads bound to the existing `emails:read` capability — nothing new to grant, and a member
who can read the firm's filed mail can be told where to put the next message. One index-only migration
backs the recent-filings list so it walks one member's own filings instead of scanning the firm's.
- **Captured email is now checked against its DKIM signature, and the filing API is hardened for the
add-in.** A message filed to a matter carries a recorded verdict on whether its signature verifies,
which domain signed it, and — when it does not verify — why: unsigned mail, a message file with no
signable original, a signing key that has rotated away, and a resolver outage are each recorded
distinctly rather than collapsed into one answer. The verdict is **informational**: nothing is
dropped, quarantined, refused, or auto-filed on the strength of it, and a forwarded copy failing
verification (forwarding rewrites headers, which breaks the original signature) says nothing against
the sender. Verification is RFC 6376 over WebCrypto inside the platform, off the request path — no new
dependency, and the mail parser keeps its parse-only, network-free boundary.

The authenticated `file this email to a matter` endpoint — the one the native add-in's Save & File will
post to — now honours an `Idempotency-Key`, so a retry from a mail client on a flaky network converges
on the capture it already started instead of staging a second copy, and a key reused with different
bytes is refused rather than answered with the first capture. It also refuses, at the door and
with a reason the caller can act on, a payload that is not an email, a message past the capture size
limit (measured from the bytes received, not a declared length), and a matter the caller cannot resolve
— all previously accepted and left to fail out of sight in the background consumer. Both capture
entrances now share one size ceiling, and a client can declare itself as the add-in so a capture that
preserved the original message is distinguishable from a manual upload.
- The design for **exhibits and exhibit lists** — building the set of exhibits attached to a motion,
reordering them freely while everything that cites them keeps up, and then filing it, after which
nothing can renumber it. Design only; no product code.

**The whole problem is that three things move independently and one of them is invisible.** An
exhibit has an attachment (a document, with its own versions), a label (Exhibit A, Exhibit 3 — which
is just a position, so inserting one renumbers everything after it), and every sentence in the brief
that says "as shown in Exhibit C". The first two are on a screen where somebody would notice. The
third is scattered through prose a person wrote weeks ago, and a citation that quietly starts pointing
at the medical records is worse than having no feature at all, because the document still looks
finished. So the design's first move is to stop treating those three as one fact. **The exhibit is a
thing** — the employment agreement — with a short name that is minted once and never changes again,
even when somebody retitles the exhibit to "Executed Employment Agreement (2019)". **The position is a
row in a set.** **The label is arithmetic**, worked out from the position every time it is read, and
never written down anywhere it could go stale.

**References cite the thing, not the number.** A citation in the document says, in effect, "the
employment agreement", and the number appears only when the document is produced. Move the exhibit and
every citation in that document follows in the same instant — there is no button to press and no field
to refresh, which is exactly where Word's own cross-references let people down. And a citation to
several exhibits lists them by name rather than as a range: writing "Exhibits B through D" as a span
is a citation that survives an insertion and quietly acquires an exhibit nobody meant to cite, so the
design makes that unwriteable. Naming three exhibits prints "Exhibits B through D" today and "Exhibits
B, D, and F" after somebody inserts two in the middle — which is what the author meant both times.
Inserting one is a picker, not a syntax: you choose the exhibit and read "Exhibit C" in place, and what
the document actually stores is the name.

**Once it is filed, it is frozen, and that is a real state and not a warning.** Reordering exhibits
after a motion is served cannot renumber a document sitting on a docket — opposing counsel has it, and
the filed copy is the authority. So a set has exactly two states. While it is a draft it is a plan:
rearrange it all you like. When it goes out, every label, every title, and the exact version of every
attachment is written down and locked by the database itself, and the set can never gain a member,
lose one, or renumber. Because the platform has no connection to any court's filing system and will not
pretend to, saying "this went out" is something a person records, with a date and whether it was filed,
served, exchanged, or lodged — and it cannot be taken back. Fixing a genuine mistake about what was
filed is still possible and is deliberately narrow; changing what was actually filed is a **new** set
that supersedes the old one, with the old one kept exactly as it was, because both filings really
happened. That is the same line the calendar already draws between correcting a hearing that was
recorded wrongly and recording a hearing the court actually moved.

**Pulling an exhibit after filing does not free up its letter.** It is marked withdrawn and stays in
place, and the letter is retired for good — two different documents both correctly cited as "Exhibit C"
is a mix-up nobody reading the record can untangle. A later filing that continues the numbering starts
after the retired letter, not on top of it.

**Nothing about numbering is hardwired to a jurisdiction, and the reason is Nevada itself.** Two
departments of the same Las Vegas courthouse currently direct incompatible schemes — one says numbers
for the plaintiff and letters for the defendant, another says the plaintiff starts at 1 and the
defendant at 500. A built-in rule would be confidently wrong inside one building. So the numbering
scheme belongs to the set: the word ("Exhibit", "Attachment", "Tab"), anything in front of it
("Plaintiff's"), letters or numerals or roman numerals, and where the count starts. The platform can
offer starter presets to copy, and will never treat one as a rule.

Also settled: exhibits come from files that already exist — a matter file, a scan of a physical
original the firm holds, a document from discovery, or something the platform assembled — and never
through a second way of getting files into the system. The exhibit list is produced twice on purpose,
as a live table on screen that is always current, and as a real document assembled from a template a
firm can edit, because that is what gets filed. Separator sheets (Nevada requires "Exhibit \_\_\_" centred
in 24-point type) are generated fresh every time a package is built and are deliberately never saved as
documents, because a saved separator sheet is a stale label waiting to be filed. And an exhibit's label
and a Bates number are kept firmly apart: reordering exhibits never touches a Bates number, and where an
exhibit came from a production its Bates range travels with it as a column on the list.

The first slice is deliberately the useful half without the clever half: build a set, reorder it, print
the list, record that it was filed. In-text references, the compiled exhibit package with its separator
sheets, and citations across filings follow.
- Joining the platform — registering, being invited, and the honest count of attempts you have left.

**You can now create a workspace without anyone provisioning it for you.** Registration asks which
of three things you are: a client of a law firm, someone who works at one, or someone starting a
new one. The first two are joined by invitation, because who belongs to a firm is that firm's
decision and never a stranger's, so those answers point you at redemption. The third sends you a
confirmation email, and only once you follow that link is a workspace actually built — until then
your registration is a single row, which is what keeps the open front door uninteresting to abuse.

**Registering never reveals whether an address already has an account.** A free address and one
that is already in use get exactly the same answer. The difference is in the mail: if the address
is already registered, the person who owns it is told someone tried to use it, which is how they
find out rather than how a stranger does. For a law firm, "does this person have an account here"
is itself a confidential fact.

**Invitations are redeemed with a code, your surname and your date of birth.** The code travels by
email and email gets forwarded, printed and left open, so two things the firm already knows about
you stand between a forwarded message and an account. If any of the three is wrong you get one
sentence — the same sentence for a code that does not exist, a surname that does not match, a
birthday that does not match, and an invitation that has already been used. That is deliberate:
naming the field that was wrong would turn the form into a way of confirming that a particular
person was invited to a particular firm, one guess at a time. The form forgives the ways people
actually type: the code is case-insensitive and you can hyphenate it, and a surname matches whether
you write it O'Brien-Walsh, obrien walsh or OBrienWalsh.

**An invitation locks itself after five wrong attempts,** whoever is making them, so a birthday
cannot be guessed patiently from a lot of different places.

**The sign-in screen can finally tell you how many attempts you have left.** The count and the
lockout countdown were designed and drawn months ago but were left blank on purpose, because the
server did not publish the numbers and a count it does not agree with is worse than no count. It
publishes them now, and they are one shared budget: the password, the authenticator code and the
recovery code all draw on the same five attempts, so the number you see is the number that is
actually left rather than a per-screen tally that hides how close you are.

**Recovery codes now begin with `MC`.** Codes get printed and put in a safe next to codes from
other services, and a prefix is what tells you which pile is which. They avoid the characters that
get mistyped off paper — capital I, lowercase l, one, capital O and zero never appear — and the
random part is no shorter than before, because a prefix that everyone shares is not secrecy.
- **Research: is Cloudflare's Kitesurf browser worth adopting, and where would it ride?** An assessment
of Kitesurf — announced 2026-08-06 as part of Agents Week — written from the Browser Run product
documentation rather than the announcement, and mapped onto the one browser consumer we ship (the Safe
Website Viewer) and the one we have designed and not built (the email-to-PDF render stage). Kitesurf is
not a product or a library: it is **an alternate browser engine, written from scratch in Rust and
running in Workers V8 isolates, selectable on the existing Browser Run service** by appending
`browser=kitesurf` to an endpoint. The recommendation is **adopt later** — and, unusually, with
**nothing to build in the meantime**, because ADR-0119 already left `BrowserRenderer` as an injected
port and a second adapter is a day's work whenever the triggers fire.

Three findings carry it. **The cost claim does not survive the pricing page** — the blog says Kitesurf
"wins on the memory and CPU that drive your bill", but Browser Run bills browser _hours_ and concurrent
browsers, and Kitesurf's own table puts it at 1.7–1.8× slower in wall time, so on the published meter it
is roughly twice as expensive per render once the free beta ends. **The confidentiality answer is
favourable and structural** — Browser Run is Cloudflare, the same trust boundary as Workers, D1, R2 and
Workers AI, so this is in-platform processing that does not trigger ADR-0109's consent gate, and the FAQ
states content is processed ephemerally with exactly two retention exceptions (`/crawl` results held 14
days, opt-in session recording held 30) that we neither use nor should. **And the two things Kitesurf
cannot do are the two the shipped consumer needs** — it cannot negotiate a bot-challenge TLS handshake
and does not render pixel-perfectly, which is precisely wrong for a tool whose job is showing a user
what a suspicious link really looks like.

Records the golden-rule-14 inversion worth having on file: Kitesurf drags no C or C++ into our
dependency graph because it drags nothing in at all — it is a service, not a library — yet it is the
best answer we have to the rule's underlying reasoning, replacing C++ Blink with safe Rust in the one
place where the bytes being parsed are chosen by an adversary on purpose. Ranks seven candidate uses
(two real, one real-but-later, three stretches, one refusal — rendering our own invoices, which is what
the marketing points at and fits us worst), names six revisit triggers including binding parity and a
published post-beta price, notes two pre-existing gaps found along the way (the Browser Rendering to
Browser Run rename still in ADR-0119 and the safe-browse files, and Browser Run having no row in the
operating-cost register despite shipping), and closes with eleven things not to conclude. Research only
— no decision, no ADR, no code, nothing adopted.
- **A firm's own fields as merge fields.** Every custom field a firm has defined on matters is now a
merge field a template can bind, written `{{custom.<field handle>}}`. Binding is by the field's
**handle, never its name**, so renaming "Retainer cap" to "Engagement cap" changes nothing a
registered template has to be re-registered for. The catalogue is derived per firm at read time, so
the field list a template is authored against, the check that runs at registration, and the check that
runs at assembly all see the same fields — which is what makes drift detectable: a template bound in
March to a field archived in June fails in September naming the field, rather than quietly leaving a
hole. An archived field resolves as a reported absence and shows a visible marker. Values render at
the scale their own definition declared, reusing the custom-fields engine's value model rather than
restating it: the same stored `500` prints as `500` on a number field and `$5.00` on a currency field,
and a declared decimal scale renders by moving the point rather than by dividing. Picklist and
reference values print the option's or the referenced record's **label**, never the handle they store.
A whole template's custom fields cost **one** database read, however many it binds.

A custom field a document template binds can no longer be hard-deleted: like a field that holds
values, it is `field-in-use` and routes the administrator to Archive, where the binding stays
resolvable as a reported absence instead of leaving templates naming a field nobody can look up.

**The letterhead logo.** An office can now carry its firm's mark, and a template draws it with
`{{location.letterheadLogo}}` — resolved from the **matter's own office**, so a document assembled by
a member of one office on another office's matter carries the correct letterhead. The image must be a
PNG or a JPEG, decided by reading the file rather than by what the upload calls it; SVG, EMF, WMF, GIF,
BMP and TIFF are refused, and the reasoning is that a raster is all a printed mark needs while an image
format that is itself a document or a replayed record stream would put a markup and parser surface
inside every assembled document. The office sets only a printed **width**: the height follows from the
image's own proportions, so no template can print a stretched logo, and replacing a wide mark with a
tall one re-lays every letterhead out correctly without touching a single template. An office with no
logo set, or whose asset has gone, assembles with a visible marker rather than silently losing its
letterhead.

This is the assembly engine's first image work, so the emitted package is checked structurally rather
than textually: the image part, its declared content type, its relationship on the part that draws it,
and the drawing's reference to that relationship are each asserted, because a document whose words are
all correct and whose picture wiring is not is a document no reader will open — and nothing in a text
assertion can see it.
- The design for **Magnus**, the assistant a firm member can talk to — the conversation record, the
consent gates, the path from a typed question to an answer, and the seams later work attaches to.
Design and plan only; no product code, and nothing is enabled for any firm.

**Magnus does not get an AI connection of its own.** The platform already has exactly one place a model
can be reached, and everything that keeps that safe — no caching, no logging, the firm identity derived
by the server rather than taken from the caller, and a check that refuses outright to send anything to
a model that has not committed to retaining nothing — is a handful of settings in a single function.
The strength of those settings comes entirely from there being one of them. So Magnus becomes the first
real user of that one path rather than a second path beside it. The single change is one addition: the
existing path could send a question, and now it can send a conversation, with the platform's own words
for who said what and the platform's own instructions kept structurally apart from anything a member
typed, so nobody can talk their way into the instruction seat.

**A conversation is a record the firm keeps.** Transcripts live in the firm's own database, are kept
the way correspondence is kept, are readable by the person who wrote them and by administrators holding
a separate permission for exactly that, and are never shown to clients. A member can delete a
conversation whenever they like and the deletion is on the audit trail. The cost of this is real and
worth saying out loud: a question a member would once have thought and not written down is now written
down. It is accepted because a firm that cannot see what its people asked cannot supervise the thing at
all, because every neighbouring part of the platform already keeps its records, and because if somebody
relies on an answer that turns out to be wrong, the transcript — with the exact model version recorded
against it — is the only thing that helps. What was deliberately not built is an off-the-record mode,
because the question "why was that one off the record" is worse than any answer to it.

**Turning it on takes three separate yeses.** The firm must already permit AI processing at all; the
firm must then enable Magnus specifically, which is a different question and is off by default; and the
member must hold the permission and have read and accepted a disclosure. The disclosure is versioned,
which sounds like bookkeeping and is not: the day Magnus can do something new, every member is asked
again automatically, because the thing they agreed to has changed. Switching Magnus off stops questions
that are already in flight rather than letting them finish quietly.

**What the firm is told, it is told plainly.** That what members type is sent to a model provider
outside the platform; which provider and model; that the provider keeps nothing and trains on nothing,
along with the honest residual that a retention guarantee is not the same as nothing existing anywhere
for any interval; that Magnus can see nothing but the conversation itself; that Magnus can do nothing
at all; that transcripts are kept and who can read them; and that whether the firm's own client
agreements permit any of this is the firm's judgement and not the platform's. Members are additionally
told the thing an administrator does not need told — that Magnus can be wrong, that nothing it says is
legal advice, and that checking it is their job.

**Magnus starts able to see nothing and do nothing, on purpose.** It cannot read matter files, the
calendar, or the directory, and it cannot create, edit, file, send, or delete anything. The narrow
start is what lets the disclosure be a sentence a firm can actually weigh — "what you type is what is
sent" — rather than a description of whatever a search layer happened to pick out of their files. The
places retrieval and actions will attach are built and empty, so adding them later changes one piece
and not the whole design.

**Answers come back the way every other slow job's results already do.** A question is accepted
immediately and answered in the background, so one firm's long question cannot occupy capacity everyone
else is queuing for, and the live connection that pushes the answer to the screen carries no
conversation content of its own — it reads the record and shows it, so there is exactly one copy of a
transcript anywhere. There is a hard limit on how much can be sent in one message and how much of an
older conversation is carried forward, and when older parts are dropped the member is told, because an
answer confidently built on something the member believed was included is worse than a visible gap.

Also settled: what the firm's spending record looks like when the model gateway is configured to log
absolutely nothing (the platform's own per-firm token record is the only source, which is what it was
already designed to be), and that the gateway's content-moderation feature must stay off permanently,
because it works by logging the prompts and responses it inspects.
- Magnus — the conversational assistant backend, build slice 1. The record a firm member's
conversation with the assistant becomes, the consent gates that must be opened before a byte of it
leaves the platform, the path from a submitted message to an answer, the transport that returns it,
and the audit and cost record it leaves behind. **No user interface, and nothing reaches a model
provider**: both firm-level consent settings default closed and the shipped adapter is a
deterministic stub. This builds the thing that is later switched on; it does not switch it on.

**The seam is reused, not rebuilt.** The assistant gets no model port of its own. It consumes the
shipped `InferencePort`, whose confidentiality controls — caching off, logging off, firm metadata
derived server-side, a fail-closed eligibility guard before dispatch — are four literal fields on one
object in one function. Their strength comes entirely from there being exactly one place they are set,
so the assistant adds one operation to that port (`generateConversation`) rather than a second port,
and a source scan now enforces that no module outside the inference package can reach the model
binding or construct a gateway options object at all.

**A conversation is the firm's work product, not a session.** Protected, deletable, archivable:
transcripts live in the firm's own database under the firm-scoped data-access layer, visible to their
author and to administrators holding a named permission, never to a client, deletable by their author
with the deletion audited — and registered in the erasure registry, with conversation-level deletion
named as the instrument for the free text inside a message, which no column-level rule can reach. They
are discoverable in the way email is, which is why a firm must be able to say whether transcripts are
in scope when something searches across its records rather than having them swept in silently; that
include-or-exclude control belongs to the discovery surface and lands with it. There is deliberately
no per-conversation off-the-record mode: the question "why was that one off the record" is worse than
any answer. The
Durable Object behind the live-updating transport stores **nothing** — it reads a turn's state back
from the firm's database and pushes it — so exactly one copy of a transcript exists.

**A member cannot occupy the system role.** The platform-authored instruction travels on its own
field, structurally separate from the conversation, and the role vocabulary is the platform's
(`member` / `assistant`) with no system member to be mapped onto.

**Nothing about a conversation is ever logged** — not into the diagnostics pipeline, not into audit
metadata, not into a problem detail, not into a queue payload. The audit builders are structurally
content-free: every input is identifiers, numbers, and closed labels, so logging what somebody typed
would take changing a type signature. Gateway Guardrails are prohibited on this gateway (they log
prompts and responses), and gateway log collection stays off — which means the gateway dashboard shows
nothing for this traffic by design, and the authoritative spend record is the in-repo one.

Also here: a per-firm daily message allowance with a real, finite default, checked before anything is
enqueued; per-message size caps that are what keep a transcript a database row rather than an object
store; a bounded request window (at most twenty messages and 128 KiB, always ending on the newest
question) that tells the member when earlier messages did not fit; two new permissions seeded to the
seats that do legal work, with reading every member's conversation kept as a separate grant; and a
general-purpose deterministic `InferencePort` stub in the inference package that every future AI
feature inherits.
- **A matter can keep a register of what the client or the estate owns.** Two specs land: the design
for a dedicated asset register on any matter, and the phased plan that builds it. Properties with an
address, a parcel number, a legal description and a county; bank and brokerage accounts; vehicles
with their identification number and plate; firearms with make, model, calibre and serial; business
interests, insurance policies, money owed to the estate, digital assets, and ordinary personal
property. Each one takes documents — the deed, the title, the statement, the appraisal, the bill of
sale — and those stay ordinary matter documents at the same time, so nothing is filed twice and
nothing leaves the matter's file list.

**Every value carries the date it was true.** Instead of one number that gets overwritten, an asset
keeps a history: a date-of-death appraisal, a bank statement, a broker's figure, the price it
actually sold for — each with the date it speaks to, what it was based on, and the document behind
it. A wrong figure is corrected by a new entry rather than by rewriting the old one, so a schedule
filed in March and the register in September never quietly disagree. Mortgages and liens carry their
own balances the same way, so an estate schedule as of any date shows value, what is owed against
it, and the equity between them.

**Logging is meant to be fast.** Two fields make a row — what kind of thing it is and a description
— and a value can be typed in the same breath. Twenty items from a client questionnaire go in as one
submission. Nothing is ever blocked for being incomplete; the schedule simply says how many assets
have no value yet.

**Types grow without waiting for us.** A small fixed set of asset kinds carries the structured facts
that make search and merge fields work, and underneath each one a firm keeps its own list —
condominium, timeshare, mineral interest under property; checking, brokerage, individual retirement
account under accounts — plus its own custom fields on top. A firm is never stuck because we did not
think of something.

**Sensitive numbers are handled by what they are.** A parcel number, a vehicle identification number
and a firearm serial appear on public records, so they are ordinary searchable fields. Full account,
policy and tax numbers are encrypted, show only their last four digits everywhere, take a deliberate
permissioned read to see in full, and never reach a generated document. Passwords, seed phrases and
safe combinations are refused outright — for a self-custodied digital asset the phrase _is_ the
asset, and the right home for that is a sealed envelope in the custody register.

**Firearms are recorded, not adjudicated.** The register logs what an estate holds and says so
plainly: transfers are governed by federal and state law, and it does not determine who may receive
anything. No deadlines, no eligibility checks, no classifications — the same posture the platform
takes everywhere a rule varies by jurisdiction, where nothing is encoded until it has been verified
against the primary text.

**It joins what the firm already has.** An item held in the safe can be linked to the asset it is,
without either side copying the other's facts. Assets flow into document automation as lists a
template can walk, so an inventory or schedule assembles from the register — and a value never
prints without the date it belongs to.
- **A matter can now keep a register of what the client or the estate owns.** Add a property with its
address, county, parcel number, legal description and recording reference; add a bank or brokerage
account with the institution that holds it; add anything else as ordinary personal property. Two
fields make a row — what kind of thing it is and a description — so nothing is ever blocked for being
incomplete, and a value can be typed in the same breath as the thing. Twenty items from a client
questionnaire go in as one submission, and re-submitting the same list does not produce a second copy
of everything.

**Every value carries the date it was true.** Instead of one number that gets overwritten, an asset
keeps a history: a date-of-death appraisal, a bank statement, a broker's figure, the price it
actually sold for — each with the date it speaks to, what it was based on, and the document behind
it. Ask what something was worth as of a date and the answer comes back with the date it actually
speaks to, so you can see how current it is; ask for a date before the first figure and the answer is
nothing at all, because something acquired after the date of death was not in the estate at the date
of death. A wrong figure is fixed by recording a correction that names the entry it replaces, which
supersedes it everywhere while both stay on the record — so an inventory filed in March and the
register read in September can never quietly disagree. There is no route that edits or deletes a
recorded value, and the database refuses one.

**Documents attach without leaving the matter's file list.** Link the deed, the title, a statement,
an appraisal, a bill of sale. The document is not copied or moved: it stays exactly where it was,
previewable, searchable, and under any legal hold, and it has simply gained an association. One
statement can evidence four accounts, so it is attached once and linked to each. Detaching leaves the
document untouched.

**Interests are recorded as fractions, and nothing is inferred from them.** Record who from the
directory holds a stake, under a label from the firm's own list, with a share as a fraction so three
siblings' shares add up to the whole rather than to 99.99 percent on a filing. Ending an interest
writes a date and removes nothing. How an asset is held and whether it forms part of the probate
estate stay two separate facts a person records — the register never derives one from the other.

**Sensitive numbers are handled by what they are.** A parcel number is on the assessor's public roll,
so it is an ordinary searchable field. Full account, policy, certificate and tax numbers are
encrypted: every list, detail and report shows the last four characters only, seeing the whole number
is a deliberate act needing the same permission as a contact's sensitive identifiers, and every such
read is recorded. Recording only the last four is a complete record. Passwords, passphrases, seed and
recovery phrases, private keys, personal identification numbers and safe combinations are refused
outright, with a message saying where such a secret belongs — a sealed envelope in the safe custody
register, where it has a location, a hold, and a record of every hand it has passed through.

**Kinds of thing grow without waiting for us.** A fixed set of asset classes carries the structured
fields that make search work, and under each one the firm keeps its own list — single-family
residence, condominium, timeshare and mineral interest under property; checking, savings, brokerage,
certificate of deposit and retirement accounts under financial accounts — extendable by the firm and
deactivated rather than deleted, so every asset already filed under a type keeps its meaning.

Two new permissions, `matterAssets:read` and `matterAssets:manage`, seeded to the seats that
administer an estate. Reading the register and moving originals in the safe stay separate grants, and
so do reading the register and opening a full account number.
- **The merge-field catalogue is designed for the size a real document set needs.** Two specs land: how
the catalogue grows from the twenty-nine fields shipped with document automation to the several
hundred a firm's letters, pleadings, and probate filings actually name, and the phased plan that
builds it. The design is a scaling-up of the shipped engine rather than a rework — one batched read
per source, absence as a declared decision, ambiguity answered rather than guessed, and everything
checked when a template is registered all stay exactly as they are.

The catalogue stops being a written-out list and becomes a **cross product**: a small registry of
subjects a document talks about (the matter, the client, the opposing party, opposing counsel,
co-counsel, a guardian ad litem, a trustee, the responsible attorney, the court, the estate, this
office) crossed with a small registry of facts about each (its name, its address, its email address,
its capacity, its title). About forty declared rows produce about two hundred and sixty fields, and
adding a role — or adding a fact that every role should carry — is one row either way.

**Ways of formatting stay formats, not more fields.** A different fact gets its own field; the same
fact written differently gets a suffix, so a name is one field that can be written "Rowan Ashcroft",
"Ashcroft, Rowan", "Dr. Rowan T. Ashcroft Jr.", "R.T.A.", or in capitals for a caption — and an
address is one field that can be a letterhead block or a single line. Dates keep the styles they
have and gain a few; money gains the words-and-figures form a settlement statement and a promissory
note use. A rendering the record cannot support — a surname-first form for a company, a courtesy
title nobody recorded — produces the usual visible marker and a sentence saying why, never a
plausible-looking wrong name.

**Attorneys on both sides get an answer.** Our side becomes matter staffing — the responsible,
originating, supervising, and billing attorney and the assigned paralegal, each with a name, title,
signature block, and direct dial; the other side is the party mechanism that already exists, widened.
Two attorneys in one role still resolves to nothing with the count named, and "list them all" is
still the repeating block. **The estate becomes a first-class identity on a matter** — the decedent,
the style a court fixed, the short style a letter's second reference uses — and a capacity phrase
like "as Administrator of the Estate of Rowan Ashcroft, Deceased" is composed once, as one field with
one marker when something is missing, rather than three placeholders that leave stray punctuation
behind.

Everything a template already binds keeps working: a shipped field is permanent, its default
rendering is frozen, a withdrawn field is deprecated rather than deleted, and the number of database
reads an assembly costs goes from six to twelve while the number of fields it can name goes up
roughly ninefold.
- **Trust: Nevada's trust-accounting rules are encoded, and they do not yet resolve.** The platform
  now carries Nevada's records-retention period, IOLTA regime, overdraft-notification regime,
  unclaimed-funds mechanism, annual-compliance duty, and advance-fee treatment, each with the citation
  and the verbatim rule text it was taken from. Every one of them refuses to answer until a licensed
  attorney has reviewed the profile and that review is recorded against the revision they read —
  encoded is not verified, and a compliance answer nobody has stood behind is worse than no answer.
  Nevada ships **not verified**. A firm can still see what the platform has, marked as unverified,
  which is what makes getting it reviewed possible at all.
- **Nevada is the only encoded jurisdiction, and there is no baseline behind it.** Every other
  jurisdiction refuses exactly as before, with a refusal that says nobody has researched it rather
  than one that implies an answer. There is deliberately no fallback profile and no "most states
  require" default: a wrong jurisdiction fact is a wrong statement about a lawyer's obligations, and
  a firm shown a confident wrong answer will act on it.
- **Research: Nevada's unclaimed-client-funds and escheat regime, from the primary sources.** What
Nevada actually requires when a firm holding client money in trust cannot locate the owner —
established from the Nevada Revised Statutes (chapter 120A, the Uniform Unclaimed Property Act),
the Nevada Administrative Code, the Rules of Professional Conduct, and the Supreme Court Rules,
with the enrolled session bills read where the history mattered. **The reframing finding: designated
client trust accounts do not escheat to the State at all** — NRS 120A.500(6)(f) has exempted "a
trust account established on behalf of a client" from the abandonment presumption continuously
since 2009, and the State Treasurer's own holder manual declines IOLTA funds. The operative path
is NRPC 1.15(f) (effective April 19, 2021): a continuing duty of reasonable efforts to locate and
distribute — floored at regular _and_ certified mail, telephone, and email — and, five years **from
receipt of the property**, a **permissive** option to remit to the State Bar's Clients' Security
Fund with a certification and documentary evidence of the search; the remittance is terminal, with
a good-faith safe harbor against discipline. The firm remains an ordinary NRS 120A holder for
non-trust property (one-to-three-year dormancy, before-November-1 reports, 60-to-120-day owner
notices, annual negative reports, seven-year post-report records, 18-percent interest plus per-day
penalties), and the document keeps the two regimes strictly apart. Also records where sources
conflict — a search-engine restatement of a subsection deleted in 2023, the Treasurer miscited rule,
the State Bar's 2019 handbook predating paragraph (f) entirely — and what could not be verified.
Research only — no decision, nothing built, nothing encoded, and an explicit
not-verified-by-counsel banner gates every finding.
- **Research: Nevada's statutory basis for the custodian will-on-death engine.** Primary-source findings —
the official Nevada Revised Statutes, Nevada court rules, and the Nevada Rules of Professional Conduct as
published by the Nevada Legislature — establishing what a will-holder owes on a testator's death, written
to gate what the jurisdiction-keyed deadline catalog is allowed to encode. **The operative rule: NRS
136.050(1) gives any person in possession of a will 30 days after knowledge of the testator's death to
deliver it either to the clerk of the district court with jurisdiction or to the personal representative
named in the will** — "any person," with no attorney carve-out — and NRS 136.050(3) makes a holder who
neglects that duty without reasonable cause liable to every interested person for the resulting damages.
Records four further verified findings: delivery to the clerk makes the will a permanent, publicly
inspectable court record whether or not probate is ever petitioned; **Nevada has no lifetime will-deposit
procedure at all**, established by a full-text search of every chapter of NRS Title 12 plus the clerk,
recorder, and court-rule sources, and specifically distinguished from the uniform-act language
that search engines return as though it were Nevada law; the requirement to lodge the _original_ will with
a probate petition is a **county-level court rule** (Eighth and Second Judicial Districts), not a statute;
and NRS 133.300-133.340 create an opt-in qualified-custodian role for electronic wills with real storage,
notice, and destruction duties and a venue consequence. Each catalog-ready fact is mapped to the shape the
catalog needs, with a maintenance note keyed to Nevada's biennial odd-year session and the published
revision stamp, and an explicit list of what could not be verified. Research only — no decision, nothing
built, nothing encoded.
- Notifications, the delivery half — slice 1: the record, the registry, the subscriber, and a member's
own read API. The thing worth saying first is what did **not** have to be built.

**The emission half was already there, and nobody had said so.** An inventory found forty-four places
in the platform that already decide something notification-worthy happened, and thirty-one of them
already write a durable row **in the same atomic batch as the change it describes** — the
transactional outbox, shipped, swept every five minutes, published onto a per-firm queue that already
resolves the firm's database and dispatches by topic. So this subsystem does not own a topic and does
not ask a single producing package to change: it **subscribes**, as a second non-exclusive pass in
the existing dispatcher. A topic may have both a business consumer and a notification and neither can
suppress the other; an unrecognized topic stays acked and ignored, because the bus is open by design;
and a translator failure is caught and counted where an owning handler's still propagates — a missed
notification is an annoyance and a re-driven cost posting is a double charge, so the weaker one
yields. Nine kinds are registered to start: trust postings, invoices finalized and voided, files
quarantined and re-scanned infected, check-in conflicts, matters closed and reopened, and filed
incidents.

**A notification row carries no string a person typed.** Not the matter title, not the client name,
not the filename, not the email subject line, not a free-text note. What it holds is identifiers,
counts, closed labels, and dates, and a validated grammar makes that structural rather than a review
note: a type that declares a text field cannot be written. What the reader sees — "a matter you are
responsible for was closed — 8181-3" — is assembled **at read time** from the kind plus the matter
number, resolved by the same join that enforces visibility. Three reasons, in the order they bind:
the row outlives the access check that justified it, and a row holding a title still holds it after
the reader stops being entitled to it; a stored title is a stale title, wrong invisibly because the
row still looks authoritative; and resolving at read costs nothing, because the read was already
joining the matter.

**Visibility binds when a notification is READ, not when it is raised.** Access changes after the
fact: a member taken off a matter on Tuesday must stop seeing Monday's notifications about it on
Tuesday, and one added should see what is still live. Enforcing at emission gives neither — it gives
a recipient list frozen at the moment of the event plus a revocation sweep that has to be perfect
forever. So the feed page, the unread count, and (when the digest lands) the digest all compose one
predicate in SQL **before the page is cut**, through one shared function, so "the digest respects the
wall" will describe one implementation rather than two that can drift. Nothing is ever deleted or
rewritten because access changed; rows are filtered, and reappear if access returns. A filtered row
leaves no placeholder and no gap in the count — "one item you cannot see" is an existence oracle.

**Retention is the firm's to set, between thirty days and a year, defaulting to ninety, swept
nightly.** A notification is a pointer and never a record — the ledger entry, the invoice, the
deadline, and the audit-log row beside each of them are the record and keep their own retention — so
sweeping one destroys no evidence. That is what makes a platform default defensible here where the
custody register refuses one outright. But **the sweep does not quietly drop what nobody had read
yet.** It tallies, per member, how much aged out unread and how far back it reaches, and the unread
count reports that beside the live count, so somebody back from three weeks' leave is told there is a
gap rather than shown a zero. Clearing it is the same act as marking the feed read.

**Five reads and writes, all of them the member's own.** One page of the feed (cursor-paginated, with
category and state filters, and an unknown category refused rather than quietly ignored), the unread
count, marking one item read or dismissed, and a "mark everything I have seen" that is **bounded by a
cursor from a page the caller actually rendered** — so it cannot silently clear what arrived while
they were looking, and cannot become an unbounded update over a member's whole history. Every one is
scoped to the session's own user and never to a value in the URL, so one member can never reach
another's feed by handing over a handle; a row that is not theirs is _not found_, never _forbidden_.
The capability, `notifications:read`, is seeded to every default role including Read-only: reading
your own feed is not a privilege, and a firm whose staff cannot see their own deadlines is a firm
this feature has failed.

Also shipped: the email content setting as a **member's choice under a firm's ceiling** — the firm
caps how much a mailed summary may say and a member may only choose something _more_ private, never
less — with per-category counts as the platform default. Email sending itself is a later sub-slice;
the setting shape lands now because a firm's stored choice must not be silently rewritten when it
does.

No user interface: the notification centre and the preference screens stay the stubs they are, and
their user guide is written when they ship. Web push, SMS, desktop-native presentation, external
calendar feeds, outbound webhooks, per-kind preference grain, and a per-matter team audience remain
named seams with nothing built.
- Notifications — the delivery half — design. A specification for how a raised notification reaches a
person: the record, the channels, preferences, the delivery mechanics, and who is allowed to read the
result.

The design starts from an inventory, and the inventory is the reason it is small. **Forty-four places
in the platform already decide that something notification-worthy happened, and none of them was
connected to anything.** Thirty-one of those already write a durable message in the same atomic commit
as the change it describes — that is the transactional outbox, shipped, swept every five minutes, and
already publishing onto a per-firm queue that resolves the firm's database and dispatches by topic.
Six more are declared constants in the calendar. One is a query in the safe-custody register. One is a
placed no-op in email filing. Five are background-job coordinators that already announce their own
completion. So the work is not building a pipeline; it is **subscribing to the one that exists**, and
deciding the policy questions nobody had answered.

**Nothing that emits changes.** The notification consumer becomes a second, non-exclusive pass on the
queue that is already there, so no write path in billing, trust, matters, documents, files, or the
directory gains a line. The emission points that are comparisons rather than events — a deadline that
is due, a deadline that is overdue, a custody review that has come round, a check-out that has not come
back — are read by the existing nightly sweep calling the functions those subsystems already export,
bucketed by civil date so a permanently-true comparison raises once a day instead of once every five
minutes. The safe-custody register's promise that delivery would subscribe to its one collection point
rather than grow a second definition of what is due is kept exactly.

**A notification carries no sentence anybody typed.** Identifiers, counts, dates, and labels from
declared lists — and no matter title, client name, filename, or email subject line, enforced by a
value grammar rather than by review. The card a member reads is assembled when they read it, from the
kind of thing that happened plus a matter lookup that is already filtered by what they may see. That
is both the strongest privacy posture and the only one that cannot go stale: a stored title survives a
rename and a renumber, and is wrong in a way that looks authoritative.

**An email says how much is waiting, never what it is about.** A fixed subject, per-category counts,
and one link back into the app — no matter numbers, no titles, no dates, no amounts. The reasoning is
that email is the one channel that cannot be taken back: everything else the platform delivers is
re-filtered every time it is read, so a person removed from a matter stops seeing it, while an email
sent yesterday is simply out there, in a mailbox the firm may not administer, on a lock screen, in
somebody's backup. Content that never depended on access is the only content safe against access
changing, and a count is exactly that. Sign-in alerts, password resets, and invitations are about the
person reading them rather than about a client, and keep their full content.

Preferences reuse the settings machinery already in place, per category rather than per event type,
with email as a daily or weekly digest and no per-event mail. Trust and security notifications cannot
be silenced in the app. A firm can require that a category reaches its people in-app, and deliberately
cannot force email on anyone — mandating email means pushing case-adjacent metadata into a mailbox
beyond the firm's reach. A firm may name partners who receive every trust notification, and being
named is not a grant of access: where the matter is screened from them, nothing is delivered and no
placeholder appears, because "one item you cannot see" tells you it exists.

Two specs, one decision record, and five owner decisions — the email content boundary being the one
that is a matter of taste rather than of correctness. No product code, no user interface, and no push
or SMS in this cycle.
- **Push-based job progress for bulk downloads and file conversions.** A client can now subscribe to a
job over a WebSocket and be told the moment it changes — `building`/`queued`, `running`, and the
settled state with its freshly signed download URL — instead of polling until the answer moves. Built
on the Durable Objects hibernation WebSocket API on the existing coordinator objects, so a subscriber
waiting on a long build costs nothing while it waits and its keepalives never wake the object. The
existing polling endpoints are unchanged and remain a complete fallback: both transports resolve a job
through the same function, so they cannot report it differently. Subscribing traverses the same
chokepoint as every other route, with the same session-derived firm scoping — `GET
/api/v1/downloads/bundles/{manifestHash}/events` and `GET /api/v1/conversions/{jobId}/events`.
- **Every file the platform stores now carries, on the file itself, which matter it belongs to and what
kind of thing it is.** Until now that answer lived only in the firm's database: the storage key is
deliberately meaningless (`files/<opaque>/<opaque>`), so that renaming a document or moving it to
another matter moves no bytes and costs nothing. The price of that choice was that anything looking at
the stored file alone — a search index reading the firm's storage, a storage report, someone answering
"what of ours is in here" — could not tell whose matter it was.

**Why now, when nothing yet reads it.** Because the cost of adding it runs the other way from almost
everything else: writing it as each file is stored is free, and adding it later means rewriting the
metadata of every file every firm has ever stored. It is the same reasoning that put the storage
encoding on file versions before there was anything to encode. The natural-language document search
design depends on it and copies it rather than working it out again, but it earns its place without
that: a fact about a file that travels with the file is useful to everything that ever meets the file.

**It cannot be quietly forgotten.** Uploads go straight from the browser to storage and never pass
through the platform, so for those the stamp is part of what the upload's signature covers: an upload
that leaves it off is refused outright rather than landing a file nobody can place. Everywhere the
platform writes a file itself, an automated check over the source code fails the build if a new
storage path is added without one. And a file that belongs to no single matter — a download bundle
spanning several, a template the whole firm draws on, an email original that the same message may be
filed from onto three different matters — records exactly that, so "no matter" is an answer rather
than an omission.

**What already exists is repaired in the background.** A nightly pass finds files stored before any of
this and fills in what they were missing, a bounded number at a time so it never becomes a burst,
picking up wherever it left off if anything fails. Nothing about the file itself changes — the bytes,
the type, and the storage tier are carried across untouched — and the pass simply finds nothing to do
once a firm is caught up. From then on it doubles as a standing check: a count that stops being zero
means a new storage path forgot, on the day it shipped rather than months later.
- Review — the second campaign's automation, email, and extraction work, read adversarially and
recorded at [`docs/reviews/2026-08-06-campaign-2-automation.md`](docs/reviews/2026-08-06-campaign-2-automation.md).
Documentation only: no source changed and no behaviour moved.

Sixteen findings, three of them high. The template expression language's `addDays` is the one date
helper that does not check its result against the calendar range its two siblings check, and an
out-of-range date it produces is neither refused nor rendered — the computed field collapses to an
empty string while the assembly reports a clean substitution, and a comparison against it answers
backwards because date ordering is a string comparison on the ISO form. Both are the failure the
absence model exists to prevent: a blank nobody notices, and a clause silently dropped. The
re-extraction sweep's convergence argument holds only for documents that succeed — a version that
ends `deferred` (the ordinary state wherever the recognition engine is unbound) or `failed` never
gains a split, so it stays a candidate forever, and because candidates are drawn oldest-first under a
per-firm cap, a firm whose oldest documents are scans re-enqueues the same set every day and never
reaches the rest of its back catalogue. And the DKIM verifier accepts a signature whose `h=` omits
`From`, which the RFC requires precisely so that a verdict is a statement about the sender; that
verdict is informational today and becomes the precondition for unattended filing the moment the
auto-file wiring lands.

The report also records what held up. The expression sandbox's structural claims are accurate to the
code — no traversal production, no dynamic dispatch, no prototype-reachable lookup, every walk
bounded, every money intermediate checked before the operation. The protected-value path has no
second read path, catches the chokepoint's refusal by identity rather than re-deriving the
permission, and cannot record a decrypt that did not happen. The auto-file guardrails compose: no
combination reaches an unattended file past ambiguity, a human decision, a withdrawn access, a closed
matter, or the firm ceiling. Two standing facts frame all of it — the ethical-wall filter is still
the identity function, and the auto-file engine is not yet wired to anything — so several findings
describe defects that are invisible now and live on the day those seams are connected, which is the
cheapest moment to have them written down.
- The design for **opening the front door** — a firm signing itself up instead of being set up for it, and a
small free workspace to try the product in before deciding anything. Design only; no product code, and
nothing is switched on for anyone.

**Signing up costs nothing until somebody confirms they are real.** Filling in the form creates a single
record and sends an email — no storage is set aside, no workspace is built, nothing is reserved. Only
clicking the link in that email starts the actual setting-up, which then runs in the background rather
than while the page waits. That ordering is doing real work: it means a flood of fake sign-ups costs
almost nothing to absorb, and it means the word "active" continues to mean a workspace a person actually
confirmed.

**The free workspace is the whole product with a few things held back, not a stripped-down imitation.**
Matters, contacts, conflict checking, time, costs, documents and editing, the calendar, the register of
originals held in safekeeping, notifications, file storage up to a limit, and search all work normally. A
short list is held back, and each item is held back for one of exactly two reasons, which are not the same
reason and do not behave the same way.

Some things are held back **because nobody has checked the firm is real.** Trust accounting is the clearest
case: it tracks money belonging to clients, the rules governing it vary by jurisdiction and the platform
already refuses to act on rules it has not had reviewed, and a ledger of client money is not something a
stranger should be able to start keeping on a whim. Finalising an invoice, applying the platform's own
signature seal to a document, and opening a client portal are held back for the same kind of reason — each
one produces something that leaves the building and makes a claim about who produced it. These unlock by
**proving the firm is a practice**, not by paying.

Other things are held back **because they cost real money every time they run** — loading another party's
documents for review, the assistant, natural-language search, and the tools that convert, repair or read
text out of files. These unlock by **paying**. Keeping the two reasons apart matters: it is why a real firm
can prove itself and get the first group without paying, and why a paying customer gets the second group
immediately without waiting on anyone.

**A limit is only ever written down in one place.** What a free workspace can hold, and what it can do, come
from one piece of configuration that the sign-up screen, the upgrade panel, the message you see when you
hit a limit, and the enforcement itself all read. A number cannot be right on the pricing page and wrong in
the product, because there is only one number.

**Being told "no" now says which kind of no it is.** Until now the product had one refusal: your role does
not allow this. There is now a second, and the difference is not cosmetic — telling the owner of a firm that
their role is insufficient, when they hold every role there is, is both unhelpful and untrue. The new
refusal says the workspace's plan does not include this and points at how to change that. Underneath, this
is deliberately _not_ a second set of rules running alongside the existing one: the same list of
capabilities the product has always used is simply narrowed for a free workspace before the one existing
check runs. There is still exactly one place in the product that decides whether you may do something.

**Upgrading moves nothing.** No export, no import, no migration, no downtime, no new workspace to move into.
The workspace a firm has been using is the workspace it keeps; the only thing that changes is what it is
allowed to do, and that takes effect within about a minute.

**And lapsing is handled honestly, because it is the case that actually hurts people.** A firm whose payment
fails is not treated as an abandoned trial. It keeps working normally for a month while reminders go out —
a declined card must not lock a lawyer out of a calendar full of hearing dates — and after that the
workspace becomes read-only with everything still there and exportable, indefinitely. It is never
downgraded to the free limits, because squeezing forty gigabytes into a free allowance would mean either
deleting somebody's files or leaving them permanently stuck; the files simply stay. Reading trust and
billing records survives all of it: a firm is never shut out of _seeing_ its own records of client money,
whatever it owes. Paying again restores everything by changing one thing.

**An abandoned free workspace is wound down slowly, loudly, and on the record.** Nothing is deleted quietly
and nothing is deleted on a timer alone. Inactivity is measured by whether anyone signs in or does
anything — not by whether the workspace looks empty — and the sequence is a warning at two months, another
at three, a hibernation at four that costs the platform nothing further and that signing in immediately
undoes, a final warning a month before anything changes, then read-only, then an export bundle mailed to
the owner, and only then deletion. That ordering is deliberate: the running cost is recovered four months
before anything is destroyed, so there is never a financial reason to rush the ending.

When deletion does come, it is a recorded act rather than a sweep. A workspace nobody ever signed into
holds nothing by definition and is cleared automatically; anything that was actually used requires a named
person to approve it. A workspace holding client money, or holding original documents in safekeeping, or
under any legal hold, is never put forward for deletion at all. A final warning that bounced does not count
as a warning — it stops the clock. And the record of what happened, and when each warning went out,
survives the deletion permanently, because the one thing nobody can be handed is a deletion nobody can
explain.
- The sign-in screen — the first real screen of the product, and the door everything else is behind.

**It asks for one thing at a time.** The screen opens asking only who you are; the password comes
next, on a card that shows the address you gave so a typo is visible before it costs an attempt.
Where an account carries an authenticator, the code is asked for after that. All three steps happen
at the same web address on purpose: a separate page for the code step would put "this account has
two-factor turned on" — and which step just failed — into the address bar, the browser history, and
anywhere that history is shared.

**A rejected sign-in never says which half was wrong.** "That email and password combination doesn't
match our records" is the whole answer, whether the address is unknown, the password is wrong, or the
account is not yet activated. Distinguishing those turns the front door into a way to test whether a
particular person works at the firm, one address at a time. An outage says something different —
it never implies you typed something wrong — and hitting a rate limit says that plainly instead of
claiming a valid code was bad.

**Nobody can give themselves an account.** There is no sign-up link and no registration path; the
card says so in as many words. Access is provisioned by the firm's administrator, and the only
side doors on the screen — reset a password, use a recovery code — lead to holding pages until those
flows are built, rather than to nothing.

**Staying signed in and trusting a device are two different choices, asked separately.** "Keep me
signed in on this device" is about this session; "Trust this device for 30 days" is about skipping
the authenticator next time. Both are real settings sent to the server, and the number of days in
that label is read from the configuration rather than written into the sentence, so the screen
cannot promise a window the server does not honour.

The code entry is a real one-time-code field: six cells that fill as you type, step back on
backspace, take a pasted code whole, and let a phone or password manager fill it in one go. Every
control on the screen is reachable and operable from the keyboard alone, announces its own state to a
screen reader, and carries a visible focus ring; the screen is drawn entirely from the design system,
so it is correct in both the light and dark settings without a second design.
- The **sign-in screens as they were designed**, moved out of a standalone mockup and into the product,
plus the developer page that replaces the mockup as the place to review them.

**Sign in is now one screen.** Email and password sit together. The old first step collected only an
address, and it existed so the server could decide what to show next — but anything it could reveal
(a firm name, "this account signs in elsewhere", "no such account") is exactly what would let a
stranger confirm which addresses belong to a firm, so the second screen could only ever show the
same neutral form. One screen is one round trip, one password-manager fill, and one fewer place to
leak. The same reasoning is why an address is never resolved as it loses focus: whether a firm signs
in through its own identity provider is worked out when the credential is submitted, not before.

**Entering a recovery code works.** It was a card explaining that the screen did not exist yet; it is
now the real entry, over the codes the two-factor plugin already issues, reached from the code screen
and living on the same URL as the rest of sign-in — a separate address for the second step would
announce to anyone reading a browser history which accounts carry one.

**A code field now matches whatever issued the code.** An authenticator and a spoken telephone code
are both six digits, so those entries stay numeric and raise a keypad. A texted or emailed code is
eight characters and can contain letters, and a numeric-only field silently ate every one of them —
which reads, to the person holding a perfectly good code, as the code being wrong.

**Every screen has a quiet way back**, above the heading rather than buried under the button, so the
heading lands in the same place whether or not there is anywhere to return to.

**What the server cannot do yet is stated rather than mimed.** Passkeys, one-time email links, firm
identity providers, human verification, choosing between second factors, workspace selection and
registration are all designed and all rendered — but none has a route behind it, so none appears on
the live sign-in surface. A button that does nothing is worse than an absent one. Each gap is
recorded once, in one place, with what is actually missing on the server side.

**The developer console gained a screen-state page** listing every signed-out screen in every state
it can take — including the ones that are awkward to reach on purpose, like a lockout, a fifth failed
attempt, or a passkey prompt someone cancelled. It renders the real components through the real
design system, so it cannot drift from the product the way a hand-styled mockup does, and every
specimen says whether the product can reach it today.

Registration, invitation redemption, the two-factor enrolment screens, recovery-code issuance and the
reset-password screen are designed but not built here; the screen-state page names them.
- **Totals across a repeating collection in a template.** `sum`, `minimum`, and `maximum` now work across
the items of a list — `{{= sum(matter.parties.amount)}}` — so a settlement statement or a schedule of
disbursements can carry its own total, earliest date, or largest amount. The calculation names the
collection and the field it wants, and nothing else: it cannot filter, sort, or work anything out
per item, and it costs the assembly exactly what a repeating block over the same collection costs.
Money totals are integer-exact through `@magna-carta/money` and still refuse to cross currencies;
a total of money is money, and the earliest of a column of dates is a date. Which fields can be
totalled is settled when the template is registered, so a total of a name or of a yes-or-no is named
then rather than at assembly time. **A collection with no items leaves the answer blank rather than
printing zero** — as does an item with nothing on file for the field — because the smallest of nothing
has no answer and a total of no amounts has no currency; ask `isEmpty(collection)` first, or supply a
fallback with `default(…)`, when a template means "nothing on file means nothing owed".
- **Template conditions, repeats, and calculations.** A Word template can now carry clauses that appear
only sometimes (`{{#if}}` / `{{#unless}}`), sections that repeat once per item (`{{#each}}`), and
worked-out values (`{{= expression}}`) — over a closed, total expression language that is checked at
registration rather than at assembly time. Conditions and repeats operate on whole paragraphs and whole
table rows, so list numbering and table banding survive a removed or repeated unit. Money arithmetic is
integer-exact through `@magna-carta/money`: division is not an operator, and `divideExact`,
`divideRounded`, `applyRate`, `percentOf`, and `allocate` each state their rounding, with banker's
rounding the only mode a template author sees and `allocate`'s parts summing exactly to the input.
Date math is over calendar dates in the matter's office time zone with end-of-month clamping. An
unresolved **condition** fails the assembly naming the field, because a missing clause is invisible; an
unresolved **calculation** renders a visible placeholder, the bias the absence model already takes. An
expression is never executable template-supplied code: there is no production for property traversal,
indexing, assignment, iteration, or a call to anything but a fixed helper allowlist, and the claim is
held honest by a seeded fuzz harness, a committed denied-construct corpus, an independent arithmetic
oracle, and one test per declared resource bound. First list-valued merge source, `matter.parties`,
resolved by one batched read for the whole collection.
- The design for **translation services** — pasting in foreign-language text or handing over a document and
getting an English rendering back, side by side with the original, with a record of exactly how it was
produced. Design only; no product code, and nothing is enabled for any firm.

**It translates. It does not certify, and it is built so that it cannot pretend to.** A certified
translation is a person's signed statement that they know both languages and that this particular
translation is complete and accurate. That is an act by a human being, and no machine can perform it — the
federal immigration regulation and the way courts admit translated exhibits both come to the same place
from opposite directions, and Nevada state practice has no local rule filling the gap, which means the
practitioner needs a person to sign either way. So the product draws the line in the artifact itself. What
it produces is a **Translation Provenance Record**: which engine ran, which model and which pinned version
of it, on what date, at whose request, on which matter, against a document whose exact bytes are
fingerprinted, and — page by page — whether the text came from the document's own text layer or from a
machine reading a picture of the page. Every one of those is a fact about the process. None of them is a
claim about whether the translation is right. The record opens by saying, in as many words, that it is not
a certificate and that nobody has attested to anything, it carries no seal and no signature line, and a
list of forbidden words is checked against the template by an automated test so that the day somebody
edits it to say "certified" the build refuses.

**The engine choice is the firm's, and the strictest option is the default.** The everyday engine runs on
the same infrastructure the rest of the product already runs on: no outside model company sees anything,
and the provider's published position is that inference content is discarded rather than kept and is never
trained on. It is honestly described as what it is — good for reading an incoming letter, not good enough
to be the draft a professional signs — because a firm discovering that for itself, on a client's contract,
is the wrong way to learn it. A firm that wants the substantially better frontier model can have it, but
that route sends content to an outside provider, so it sits behind three separate switches that all
default to off, and the firm is told what leaves and where it goes in the same words the assistant feature
already uses. Three commercial translation services were looked at and turned down for now: their handling
terms are mostly good, but each one adds another company into the chain of people holding privileged
material, for quality the frontier route already provides.

**Every person who uses it is told the one sentence that matters**, whichever engine is in effect and
before their first run: this is machine output, it can be wrong in ways that read perfectly fluently, and
it may not be filed anywhere a certified translation is required.

**Almost none of it is new machinery.** Deciding whether a PDF is real text or a scan, and running
recognition on only the scanned pages, is something the platform already does per page for search — and
the translation record is finally a reader for a distinction that pipeline has been computing and throwing
away. Converting an odd old format into something usable, and turning the finished document back into a
PDF, is the existing conversion path. The two-column side-by-side document is the existing document
assembly engine filling a table, which has the useful side effect of leaving the result editable, so a
reviewer can correct it. Long jobs run on the same queue-and-progress machinery as every other long job.

**A translation is a sibling of the original, not a new version of it.** They are two documents, both
current, in two languages — and quietly replacing "the latest version" of a Spanish contract with an
English one is the kind of surprise that ends up in front of a client. They are linked instead, so each
can be found from the other, and the translation carries exactly the same matter and confidentiality
markings as the document it came from, so whatever access boundaries get built later apply to both without
anyone having to go back and find them.

Also settled: the first slice is deliberately tiny — pasted text, the on-platform engine, an on-screen
side-by-side and the provenance record, and not a single generated file; document upload, the printable
side-by-side, and the frontier engine come after; and a properly human-signed certificate of accuracy, by
a named member who has actually read the thing, is held as its own later piece of work, because that is
the feature that turns this from a reading aid into something a firm can file, and it deserves to be built
against a real artifact rather than a guess.
- **Design: who may release money from a client's trust ledger, and who a payment waits for.** The
owner's direction is that a member with the authority to approve trust payments can make one on
their own, and a member without that authority sends the payment to somebody who has it. Above an
amount the firm chooses, even a member with authority needs a second person, and a firm can require
that second person to hold the authority too. A firm with only one such member is not locked out of
paying its clients' money out.

The design settles how that is expressed without changing the record-keeping the platform already
does. Nothing new is stored: the posture a firm already sets — whether payments take two people,
above what amount, and whether whoever releases the money must hold the authority to act — already
says all of it, and the firm's own settings page will name the resulting postures in plain words.
Every firm now starts on the authority-based posture as a visible, dated entry in its own history of
posture changes, rather than as an unwritten default, and a firm that wants a ceiling or wants every
payment reviewed writes that change the same way it always would. A payment already waiting for a
decision keeps the rules it was submitted under, in both directions, exactly as before.

No behaviour ships in this change: it is the design and the decision record. The build slice that
follows adds the seeded starting posture, teaches the payment and earned-fee screens to send a
payment for approval instead of refusing it, and states on each approval — in the client ledger and
in the audit trail — whether it was released alone, approved by a second person, or approved under
the sole-authorizer exception.
- **Disbursement authorization is now the firm's own policy.** Whether money leaving a client trust
ledger takes a second person becomes per-firm configuration — off, above a threshold amount, or
always — with an independent option requiring that whoever lets money go holds the authority to act
on client money (the new `trust:authorize` capability, seeded to Owner/Admin and Attorney). The
shipped default is the strict posture every firm already had: always two-person, no authority
requirement — nothing relaxes on migrate, and relaxing is an explicit, versioned, audited act
recording who changed the posture, when, and from what.

**The earned-fee application follows the same policy.** Taking earned fees out of trust against
finalized invoices now rides the same approval queue as a disbursement: a pending application
request names its invoices, another member approves it, and the approval re-checks everything —
invoice finality, the client's identity, the matter's unpaid share, the available balance — against
the world as it stands then. Under a relaxed posture the direct single-actor application returns.

**A pending request keeps the policy it was submitted under**, in both directions: relaxing the
posture does not unlock a request proposed under the strict one, and tightening it does not strand a
request the old policy exempted. Every rule — the second person, the exactness of the recorded
basis, the authority requirement, the stamp itself — is enforced by database triggers, not route
discipline, exactly as the two-person rule was before it became a policy.
- Trust accounting — the trust ledger schema and its by-construction invariants. A three-level
sub-ledger tree over the existing double-entry ledger (trust-account liability root, a client node
per trust client, a matter leaf under it), with `min_balance_minor = 0` written onto every matter
leaf in the same batch that creates it, so an overdraw aborts the whole posting batch at the database
rather than at a check a caller has to remember. The new `@magna-carta/trust` package owns the single
composition guard every trust entry passes through: it refuses commingling and, with it, a processor
fee netted out of a trust deposit; refuses postings to a roll-up tier; and refuses any entry touching
more than one client, which makes a client-to-client movement unrepresentable. Disputed-funds holds
reduce an available balance without moving money and are append-only (a release is a new linked row);
the transfer out of trust posts two linked entries, is limited by available balance rather than by a
positive one, and refuses outright until an earned-fee precondition is supplied. Jurisdiction fields
refuse to resolve rather than falling back to any baseline. Adds `trust:read` and `trust:manage`.
- Trust accounting — a matter whose client trust ledger still holds money no longer closes. The matter
shell has carried a close hook since the lifecycle landed and nothing had ever registered against
it; trust is its first rule, and it is a hard block rather than a warning, because a closed matter
with somebody else's money in it is precisely how funds become unclaimed and the firm that closed it
is the one that answers for them. The refusal is written to be acted on rather than merely obeyed: it
names what the ledger holds, which trust account it sits in, how much of it is under an active
disputed-funds hold, and the two movements that legitimately empty it — disburse the remaining funds
to the client, or transfer earned fees to the operating account. A matter that never held client
money closes exactly as before; the absence of a trust ledger is not a refusal, and the gate never
creates one to find out.

The rule is proven twice, because a read cannot be atomic with the write that follows it: the check
produces the refusal a person can read, and a guard riding the close batch itself re-asks the same
question where the answer is the committed one, so a deposit that lands between the two aborts the
whole close — its audit row, its event, and its idempotency record with it — instead of closing a
matter over money that arrived a moment earlier. Refused closes now answer with their own problem
type rather than a generic validation failure, naming each rule that refused.
- Trust accounting — the movement operations over the trust ledger: deposits, disbursements, and
transfers between two matters of one client, each with an HTTP surface that requires an
idempotency key, because a retried request that posted twice would be a second real movement of
somebody else's money. Beside every trust entry the platform now writes a client-ledger record
carrying what the ledger has no column for and the record-keeping rules require — the source or the
payee, the purpose, the payment method as a value rather than as prose, the check or wire reference,
who entered the record, and, for money leaving a client ledger, who authorized it. That record is
append-only at the database, and its shape is a constraint: an internal reallocation cannot claim a
bank method or an external payee, a bank movement cannot hide as internal, and a disbursement
without a named authorizer will not store. A disbursement is measured against the ledger's
_available_ balance rather than its stored balance, so a positive balance whose disputed portion is
under hold is not money the firm can pay out. A matter-to-matter transfer posts no bank line at all,
because no bank movement happened — the two matters' balances move against each other and the
reconciliation gains nothing that could never clear. Movements refuse outright on a trust account
whose office recorded no jurisdiction, distinctly from a jurisdiction whose rules are not encoded.
- **Research: how could we implement VPN services for our users?** An assessment prompted by the owner's question and sharpened by the goal he then named directly — _"I want to assist firms in accessing their files securely over insecure wifi."_ Separates three unrelated products the phrase covers (a network control gating access to us, a general-purpose VPN we operate, and coexisting with the VPNs firms already buy) and lands on a recommendation rather than a menu: **do not build or operate a VPN in either sense; ship the package that addresses the actual goal, and support what firms already own.**

The finding that reframes the request is that **the stated problem is already solved by the transport we have**. A connection from a hotel lobby is TLS 1.3 to Cloudflare's edge, and `.esq` is on the HSTS preload list **as an entire zone** — Google Registry preloads its top-level domains, verified live against the `hstspreload.org` API — so every browser refuses plaintext to `app.magnacarta.esq` before the first packet leaves, with no header from us and no configuration a firm can get wrong. The FTC's current guidance says the general case plainly (_"things have changed... connecting through a public Wi-Fi network is usually safe"_) and does not mention VPNs at all. A tunnel would wrap an encrypted channel in a second one.

**A "VPN to the platform" is also a category error here** — we are four public Cloudflare hostnames over Workers, a Durable-Object-fronted per-firm database and R2, with no private network for a tunnel to reach, and Cloudflare's own documentation confirms protecting a public hostname requires neither a tunnel nor a client install. What a firm actually wants is policy before session creation, which is federation: we become a SAML 2.0 / OIDC service provider (Better Auth's SSO plugin) so the firm's Cloudflare Access, Okta or Entra applies device posture and conditional access in **their** account, on **their** seats, with **their** logs, and we hold nothing.

**The confidentiality analysis is the crux and is close to dispositive.** Gateway's own logging reference shows a VPN operator holds a per-lawyer, per-device, timestamped record of every hostname and full URL a firm's staff reach — which discloses unfiled matters, undisclosed representations and the firm's relationship to adversaries, none of which the firm ever gave us. That record is **non-content** under the Stored Communications Act and therefore reachable on a **subpoena** rather than a warrant, which moves the fight from the party who holds the privilege and has an obligation to quash to a third party who holds neither: we would become the cheapest available route to a law firm's confidences, deliberately. It is also the one dataset our architecture cannot cover — `protected()` encrypts declared fields written through the data-access layer and crypto-shred destroys a key, but neither reaches routing telemetry generated continuously by the act of forwarding traffic. Reselling is separately barred by Cloudflare's Zero Trust service-specific terms on pain of material breach of the account the whole platform runs in.

Ranks what actually threatens a lawyer on hotel wifi — credential phishing, session-cookie theft, device compromise, shoulder-surfing, and only then eavesdropping — and notes that a tunnel defeats none of the top three while **passkeys** (origin-bound, already in the stack) and **Device Bound Session Credentials** (two server endpoints; generally available in Chrome on Windows since Chrome 145/146) defeat the first two. Also covers HSTS, certificate pinning and DNS-over-HTTPS as cheaper partial answers to the metadata problem; why the client portal must never take a network control (per-grant assurance is the designed answer for unmanaged external devices); why the Tauri shell is the one place a genuine connection-integrity story fits within ADR-0023 parity (pinning, which the browser cannot do since HPKP's removal); and why memory safety is **not** among the reasons to refuse a client binary (WARP's datapath is BoringTun and MASQUE, both Rust) — the reasons are confidentiality and cost, and they suffice.

Closes with six things to re-verify before acting (including the unconfirmed $7-per-seat Zero Trust price, which no Cloudflare-authored page would confirm) and eleven things not to conclude. Two decision fragments accompany it, both **Proposed**. Research only — nothing built, nothing adopted, no ADR ratified.

### Fixed

- **Slice 1·3 Directory — 7-angle adversarial review fixes** (14 confirmed findings, all fixed): the non-destructive merge no longer aborts when master and subordinate share a category (the `directory_entity_category` composite-PK collision) — duplicate category/edge/party references are absorbed and recorded in the `entity_merge` event; `addName`/`addIdentifier` reject a non-existent entity (404) instead of writing an orphan row; the duplicate-candidate phonetic channel gains a code-leading index (follow-on migration `0011`) — candidate-generation drops ~64ms→~1.7ms, guarded by a load-bearing plan-scan probe; a typed `MergeUnknownFieldError` (422) replaces a generic 500 on a bad survivorship key; the protected-identifier read surfaces a structured 403; the `matter_party` INSERT is centralized in a statement builder and the `entity-kind` helpers reused; and process-ref/CLAUDE.md doc drift is cleared. Angles 1 (tenancy) and 2 (crypto/access-control) found nothing.
- **`vp check` no longer descends into session worktrees.** `.claude/worktrees/` (parallel sessions' duplicate checkouts) was untracked but not gitignored, so the gitignore-respecting Oxc walkers formatted/linted/type-checked other sessions' mid-TDD states against the main tree's baseline — a half-finished worktree failed every session's gated commit (the documented stale-worktree gotcha, observed live with the slice 0·5 worktree). Fixed two-layered: `.claude/worktrees/` in `.gitignore` (also silences the `?? .claude/` status noise) plus an explicit `ignorePatterns` entry in `oxlintrc.json`. Proven both directions: `vp check` green with the 0·5 worktree's red test in place (243 → 121 checked files), and a deliberately injected formatted type error in real package code still fails the gate. Coverage is unchanged — each worktree validates itself from inside its own checkout, and CI never saw `.claude/worktrees/` (untracked, never pushed).

- **Slice 0·3 post-build adversarial review pass — ten verified findings fixed** (7 finder angles over the whole slice diff, every correctness candidate proven or refuted by an independent empirical verifier on real SQLite; fixes TDD'd same-day). **Ledger correctness:** float accumulation near 2^53 let a genuinely unbalanced entry validate as net 0 (proven empirically) — closed by an **entry magnitude cap** (`entry-too-large`: total line magnitudes ≤ `Number.MAX_SAFE_INTEGER`, under which every net and per-account-delta partial sum is provably exact in plain `number` arithmetic; a BigInt-accumulator fix was applied first, then replaced — the cap keeps the codebase bigint-free, refuses ~$90T garbage entries by name instead of posting them, and skips per-line BigInt allocation on the future billing hot path); an empty entry gets the named `too-few-lines` refusal instead of a snapshot-read programmer error; **`@magna-carta/money` now owns the code→currency registry** (`currencyFromCode`/`isRegisteredCurrencyCode`) — `createAccount` refuses unregistered codes (`unsupported-currency`; a typo'd `'usd'` account was permanently unpostable with no repair path) and `reverseEntry`'s USD-hardcoded stub became a real dispatch (a committed EUR entry was permanently irreversible; EUR round-trip now proven); **the leaf-only invariant's promised backstop now exists** — `parentAccountsWithPostingsStatement` plus `assertLedgerFitness` (the createAccount/postEntry TOCTOU race's documented mitigation was never built; the corruption was invisible to both shipped fitness queries and uncorrectable), with the fitness SQL's debit-normal list **generated from `normalBalanceFor`** instead of restated; snapshot loads **chunk at D1's 100-bound-parameter cap** (a >100-account entry passed every local test and would throw only on production D1 — node:sqlite allows ~32k); `ledger_account.type` got the **DDL CHECK** the same slice gave `direction` (an untyped writer landing `'Asset'` silently inverted every balance delta with zero fitness signal) plus a runtime `unknown-account-type` refusal and a cross-package `ACCOUNT_TYPES`↔drizzle-enum pin; and the spec-promised **append-only source scan** shipped (deferred by the plan to this review pass), matching literal and constant-interpolated table names. **Fixtures:** the demo firm advances costs **before** the settlement recovers them (Client Costs Advanced rested at −56500 — money "recovered" that was never advanced — now pinned non-negative; "Demo, LLP" becomes a real firm in slice 0·4); `boundsRejection` only accepts the **bounds-CHECK error** as proof (a bare catch counted any commit failure); fixtures read business tables **through exported ledger statements** (new `selectAccountBalanceStatement`) inside the schema-name-sync net, the seed summary is tallied in code and cross-checked, and `seedDemoFirm` ends with `assertLedgerFitness` so every execution context gets the invariant proof. **Cleanup:** `createMigratedNodeDatabase` in `@magna-carta/database` replaces six copies of the node:sqlite setup; identifiers' FNV-1a `hashSeed` exported and the fixtures copy (whose comment falsely claimed it "differed subtly") deleted; ledger's minor-unit guard delegates to money's `assertSafeInteger`; `aBalancedEntryInput` got its missing test; node-sqlite's cross-database comment corrected (workerd's D1 shim has no statement-identity check either — the adapter is D1-faithful). **Docs:** the design spec's determinism claim amended for the outbox-id exception (white paper sentence aligned), and its present-tense dependency-cruiser claim corrected to the documented coherence-tooling deferral. Efficiency candidates the finders raised (read coalescing in `reverseEntry`/`createAccount`, prepared-statement caching, chart-seed batching) are deliberately **not** applied — golden rule 10: measure against the load-profile harness first. Suites after the pass: ledger 53, fixtures 16, money 50, database 40, identifiers 32 — all green.
- **`apps/web` type-checking wired into the quality gate.** `svelte-check` was silently broken (4 errors — missing `@types/node`, no `allowImportingTsExtensions`) and not part of any gate, while `vp check` covers only format + lint (tsgolint type-check is not yet enabled). Added `@types/node` (catalog-pinned to 25.9.1, matching Node 25) and `allowImportingTsExtensions: true` to `apps/web/tsconfig.json` so the deliberate `.ts`-extension import style type-checks; the root `check` script now runs `vp check && pnpm --filter @magna-carta/web check`, so `pnpm check`/CI type-check the SPA. Replaced the `process.cwd()` SvelteKit-plugin guard's `node:url`/`node:path` imports with `import.meta.dirname` (the guard stays — vp's lint pass loads every workspace `vite.config.ts` with `command="build"`, indistinguishable from a real build except by cwd) and removed the redundant per-package `apps/web/.oxlintrc.json` (the root config is auto-discovered). See [`docs/conventions/typescript.md`](docs/conventions/typescript.md) for the current gate reality.
- **Idempotency-conflict contract on the common path, find-first provisioning resume, prototype-safe binding resolution, behavioral authentication sweep — five adversarial-review findings (slice 0·4 follow-up):** (R3) the data-access idempotency middleware's pre-decision answered the in-progress 409 / fingerprint-mismatch 422 as generic `{error}` JSON while the mounting routes declare `application/problem+json` — and the pre-decision IS the common conflict path (the handler-race path through `runIdempotentEffect` is the rare one); the middleware gained an optional `conflictResponse` hook (the established `deriveStoredKey` seam pattern, defaulting to the generic JSON), both required-idempotency routes pass `problemResponseForIdempotencyConflict`, and that mapping's parameter was widened to kind-only so the hook and the handler race outcomes share literally one home; the previously untested authorized reused-key-different-payload 422 and seeded in-progress 409 pre-decisions are now pinned over the real HTTP surface as RFC 9457 problems. (CF1) The Cloudflare REST resource adapter parsed every API response as JSON before any status inspection, so an HTML edge error page (502/520) surfaced as an opaque `SyntaxError` losing the operation name and HTTP status; `callApi` now reads text first and a non-JSON body throws the described-failure shape (operation + status). (CF2) Idempotent provisioning resume hinged on matching the vendor's duplicate-error prose (`/already (exists|own)/i` — D1 carries no stable duplicate code), so a vendor copy-edit could wedge a crashed provisioning at `provisioning` forever (the crash window between a successful create and the firm row's claim UPDATE is real — separate commits); creation is now **find-first** — probe the deterministic resource name (D1 list-by-name, R2 bucket GET), create only when absent — demoting the message-regex to a benign fallback for the narrow probe-create race. (R2) `resolveFirmDatabase` indexed a plain object literal, so a prototype-chain identifier (`constructor`/`toString`/`__proto__`) resolved non-nullish junk → TypeError → 500, violating its own unknown → null → ADR-0052 404 contract; the lookup is now `Object.hasOwn`-guarded, with a hostile-name micro test. (R4) The conformance fitness asserted `x-mc-authenticated` METADATA only — a route declaring it while omitting its authorize middleware passed every sweep while shipping publicly mutable; the e2e conformance sweep now fires a credential-less request at every declared-authenticated operation and demands the 401 problem behaviorally (firms.provision's platform-admin guard answers the same 401 on a missing key; the slice 0·5 metadata-driven chokepoint migration must keep this green).
- **Outbox relay & request-path hardening against five adversarial-review findings (slice 0·4 follow-up):** (S1) `parseMemberProvisionPayload` now requires `roleName` to be **explicitly present** as `string | null` — an absent field is malformed and dead-letters, where an earlier polish commit had coerced a missing field to `null` and would silently mirror a **roleless owner** (a locked-out firm the reconciliation backstop can't detect, since it only sees missing member rows). (S2) Dead-lettering (`status='failed'`) is terminal by design but nothing could revive a row stranded by a transient per-firm outage; added `requeueDeadLetteredMessageStatement` (guarded `UPDATE … WHERE status='failed'`) as the documented operator-intervention seam until an admin surface exists, corrected the inaccurate "the relay is the repair mechanism" comment (the relay repairs **pending** rows; dead-lettered rows need the requeue seam), and recorded the recovery in [`docs/conventions/security.md`](docs/conventions/security.md). (S3) The per-firm queue message now carries **`firmId`** — per-firm messages cross the single shared `env.QUEUE`, so the first per-firm consumer (slice 0·5+) can resolve the originating tenant (control-plane topics, consumed directly, need no tag); the queue-shape pin test moved to the six-field contract. (S4) The reconciliation backstop's per-firm `SELECT … FROM "user" WHERE firm_id = ?` (an N+1 across the fleet) is now **one grouped control-plane query** bucketed by `firm_id` in JS; the per-firm member reads stay per firm (separate physical D1 instances). (R1) Provision and invite committed the outbox row then emailed the activation link immediately, but only the `*/5` cron swept the outbox — a fast-activating owner/invitee got `permissions: []` and 403s until the next cron fire; both executed arms now schedule a **best-effort request-path sweep** via `executionCtx.waitUntil(runScheduledSweep(...).catch(...))` (the cron remains the at-least-once guarantee; overlapping sweeps are safe per the relay's guarded transitions). Tested with `worker.fetch` + `waitOnExecutionContext` (the only way to await a `waitUntil` in the workers pool — `SELF` cannot); existing SELF-surface assertions that read sweep-mutated state were made robust to the now-possible request-path consumption.
- **Deactivated members lose all permissions at the read path (slice 0·4 adversarial-review follow-up):** the per-firm `member` table always modeled `status: 'active' | 'deactivated'`, but the permission reads never consulted it — a deactivated member with a live session kept every role permission and direct grant (could invite members; `/v1/me` answered normally). Both reads in `selectMemberPermissionsStatements` now join through `member` and require `status = 'active'` (proven on real SQLite: a deactivated member's role and grant reads both return empty), `GET /api/v1/me` answers a deactivated member with the ADR-0052 404 (absent — never an existence oracle; a never-mirrored user deliberately keeps the 200-with-empty-permissions bootstrap, because the outbox sweep-lag window is transient and self-heals while deactivation is a deliberate state), and a deactivated inviter's `POST /api/v1/members` falls out as 403 at the existing permission gate. Delivers the design spec's "deactivated/foreign context → 404" testing promise — the deactivation API itself is a later slice; the read path is correct ahead of it. Recorded in [`docs/conventions/security.md`](docs/conventions/security.md).
- **Firm provisioning hardened against three adversarial-review findings (slice 0·4 follow-up):** (1) the firm name is **canonicalized at the route boundary** (trim + Unicode NFC, empty-after-trim rejected) — the provisioner's resume identity is the byte-exact UNIQUE `firm.name`, so a trailing space or an NFD variant now resumes the existing row instead of inserting a second provisioning firm and claiming a second dev-pool database; (2) the final activation batch carries an **activation fence** (an `INSERT ... SELECT` that collides with the firm row's own PRIMARY KEY unless `status` is still `'provisioning'` — proven on SQLite and Miniflare D1), closing the concurrent different-owner double-commit where a second run adopted the first run's recorded resources and both activation batches committed (two Owner/Admins); the loser's whole batch rolls back and the route answers a 409 `Concurrent provisioning completed` problem, retry observes the active firm; (3) the firm table **records its owner** (`owner_user_id`, set in the same activation batch; control-plane migration `0001` regenerated, fold-don't-stack) and the already-active no-op matches the requested owner against it — a mere invited member's email now answers the documented 409 instead of a 201 presenting that member as owner. `svelte-check` was silently broken (4 errors — missing `@types/node`, no `allowImportingTsExtensions`) and not part of any gate, while `vp check` covers only format + lint (tsgolint type-check is not yet enabled). Added `@types/node` (catalog-pinned to 25.9.1, matching Node 25) and `allowImportingTsExtensions: true` to `apps/web/tsconfig.json` so the deliberate `.ts`-extension import style type-checks; the root `check` script now runs `vp check && pnpm --filter @magna-carta/web check`, so `pnpm check`/CI type-check the SPA. Replaced the `process.cwd()` SvelteKit-plugin guard's `node:url`/`node:path` imports with `import.meta.dirname` (the guard stays — vp's lint pass loads every workspace `vite.config.ts` with `command="build"`, indistinguishable from a real build except by cwd) and removed the redundant per-package `apps/web/.oxlintrc.json` (the root config is auto-discovered). See [`docs/conventions/typescript.md`](docs/conventions/typescript.md) for the current gate reality.
- **`@magna-carta/design-system` — DataTable column filters + Sidebar brand mark (slice 0·7a Phase D, owner-review round 3)**: three reported interaction/visual defects fixed at the root, with each fix generalized so the class can't recur. **Faceted filters no longer invert:** deselecting every value (or unchecking "Select all") now means **none selected** and stays there. table-core's built-in `arrIncludesSome` auto-removes an empty-array filter (silently reverting "none" back to "all"), so faceted columns now use **`facetFilterFn`** (defines no `autoRemove`, so the empty-array "none" sentinel survives); the checklist is built from a **stable universe** — the column's distinct values over the _unfiltered_ (core) rows — so options never vanish as the selection narrows and the all/none/some test never divides by an empty set; and the checkboxes are bound with get/set **function bindings** (the Bits-UI controlled pattern) so what's shown always reflects table state rather than a stale internal toggle (the same fix applied to the table's row and select-all-rows checkboxes). The selection math is the pure, unit-tested `facet-selection.ts`. **The date column filter** now offers quick **presets** (Today / Last 7 days / 30 days / 3 months / 12 months — `date-range-presets.ts`) instead of a calendar nested inside the filter popover: that nested floating layer crashed the renderer (`Cannot read properties of undefined`). **The Sidebar brand mark** no longer collapses to a ~2px sliver in the icon rail — `flex-shrink: var(--mc-space-0)` resolved to the invalid `0px` (a flex factor must be unitless) and silently defaulted to `1`; all nine occurrences became the token-pure keyword **`flex: none`**, and a new boundary fitness function bans standalone `flex-grow`/`flex-shrink` in `components.css` (the token grammar can't express a unitless factor). New play-function regressions (faceted deselect-all → none + reselect; a date preset filters + Clear resets; the collapsed-rail brand-icon keeps full size) plus the pure-logic unit tests pin all three. `pnpm check` + `svelte-check` + the fitness and story gates green; verified live in Storybook. Built by Opus 4.8 (Fable-5 re-review pending).
- **Pickers opened inside dialogs are clickable again.** Anchored floating content — select and combobox listboxes, menus, popovers, tooltips, date pickers — used to paint beneath a modal dialog's panel, so a picker inside a dialog (like the change-request recipient search) could only be driven by keyboard. The layer scale gains a documented `anchored` layer above `modal` and below `toast` (the ecosystem norm: anchored content hosted in a dialog must float over it; notifications still win over everything), applied through the one floating-content seam so every anchored surface moved together, with a CI assertion pinning the layer order so a regression fails in tests rather than in someone's browser.
- **Navigating no longer keeps the previous page's scroll position.** The app shell's chrome (top
bar and sidebar) is fixed and only the work canvas scrolls, so the window never moves — and
SvelteKit's built-in scroll restoration scrolls the window, leaving the canvas stuck at wherever the
last page had it (land on a tool already scrolled hundreds of pixels past its masthead). The shell
now manages the canvas directly: a forward navigation (a link click or `goto`) starts the new page
at its top, back/forward restores where the reader had scrolled that entry, and an in-page hash
anchor still wins. The reset is instant, never a smooth scroll.
- Per-merge docs assembly no longer fails the gate on unformatted output. The `build-decisions` assembler rewrites `ADR-<slug>` references to their assigned `ADR-NNNN` numbers across the docs, which changes text width inside Markdown tables and breaks the column alignment the formatter enforces. The `assemble-docs` workflow now runs the formatter (`vp check --no-lint --fix`) on the assembled output before opening its pull request, so the assembly PR is always format-clean regardless of which files the assemblers touch.
- CI dependency-audit gate no longer fails repo-wide on npm's audit-endpoint brownout. npm is retiring its legacy audit endpoints (intermittent HTTP 410; retirement began 2026-07-15) and the pinned pnpm still queries them, so `pnpm audit --audit-level high` began failing at random on every pull request. The gate's governance step now passes pnpm's first-party `--ignore-registry-errors` flag, which exits 0 when the registry errors while still failing on any real high-severity advisory the registry actually reports. Harmless once pnpm moves to the bulk advisory endpoint (tracked: pnpm/pnpm#11265).
- - Pin the Rust toolchain (`rust-toolchain.toml`, 1.97.0) so every machine compiles and formats
  identically. An older stable could not build the workspace at all (`oar-ocr` requires rustc 1.95
  or newer), and its rustfmt "reformatted" 45 already-correct files in `crates/`.
- Arm the git hooks from `postinstall` instead of a manual once-per-clone step. A fresh clone
  leaves `core.hooksPath` unset, so the pre-push quality gate was silently inactive in any new
  working copy.
- Declare the Node floor the project actually builds and tests on (Node 22 or newer), rather than
  a version nothing provisions or enforces.
- PDF page observation now measures a drawn raster image over its full extent, not a single
pixel of it. The interpreter hands an image its pixel-space transform, so measuring the unit
square undercounted every multi-pixel image by its width times its height — a full-page scan
read as a sliver. This corrects the image-coverage signal the OCR page-selection gate relies
on, and hardens redaction: the rule that a vector box drawn over a raster image does not
remove the underlying pixels now applies across the whole image, not just one corner of it.
- PDF redaction: text-preserving redaction now succeeds on many more documents
instead of falling back to whole-page rasterization. Fonts whose character
widths are stored as indirect references (common in real-world PDFs, including
non-embedded and standard-14 fonts) are resolved correctly, and a stray
whitespace character left near the page origin no longer trips the safety check
that verifies text was removed. Redactions that could not be verified as
complete — including text drawn by embedded form templates — still fall back to
rasterization, so nothing sensitive is ever left behind.
- **The styled scrollbar now actually renders in Chromium, and the app shell wears it.** The
`mc-scrollbar` recipe declared both the standard `scrollbar-width`/`scrollbar-color` properties and
the `::-webkit-scrollbar` pseudo-elements; Chromium takes the standard path whenever those
properties are present and ignores every webkit rule, so our pill thumb never rendered and Chrome
drew its own scrollbar, arrow buttons and all. The standard properties are now quarantined to a
Firefox-only `@supports` guard and the default path is `::-webkit-scrollbar` pseudo-elements only
(with the arrow-button pseudo explicitly suppressed). The thumb is restyled to a floating pill —
fully rounded, `border-strong`, inset from a slim 8px track to a 6px visible width via a transparent
border plus `background-clip: content-box`. The recipe is applied where it was missing: the app
shell's work canvas (the app's single scroll region), the Settings nav column and every Settings
page's scroll area, and the developer console.
- **File tools now surface where a file is in hand.** The File Converter and the Metadata Inspector & Scrubber both act on a file but were tagged as accepting no subject, so a file-context surface could not reach them. Both now declare the file context tag, joining the other file utilities.
- - **The CI gate now runs every test suite it claimed to run.** Three coverage holes closed: (1) the
  seven standalone workers (`apps/bundle-worker`, `apps/convert-worker`, `apps/file-repair-worker`,
  `apps/magna-carta-edit`, `apps/ocr-worker`, `apps/recovery-worker`, `apps/scan-worker`) had vitest
  suites that ran nowhere — their configs were never registered in the root `test.projects` list, so
  root `vp test` and the gate both walked past them; they are now registered and run in `test-node`.
  (2) The container Cargo workspaces' unit/integration tests (scan heuristics, bundle encoders,
  recovery shard) ran nowhere — `rust-check` covers only `crates/`; the `containers` job now runs
  `cargo test` for each changed container workspace, with a cargo cache. (3) A changed container with
  no acceptance mapping passed the `containers` job green having tested nothing; an unmapped container
  now fails the job unless explicitly listed as not-yet-covered (collabora, file-repair, ocr, raster —
  each flagged with a warning on every run that touches it).
- **Scan-container integration tests now run on any host.** The first run of the newly gated suites
  surfaced a latent break: the scan router's spool writes to the fixed clamd-shared `/scan` scratch
  directory, which exists only inside the real container, so the `health` and `scan_fault` integration
  tests returned 503 on every Linux host (the Windows dev build takes the buffered path and never hit
  it). The spool directory is now overridable via `SCAN_SCRATCH_DIR` (production never sets it), and
  those tests point it at the OS temp dir.
- **The test-project registry is now a gated fitness function.** `pnpm run lint:test-registration`
  (`tooling/lint-test-registration.mjs`, run in the gate's governance job) fails when a
  `vitest*.config.ts` exists on disk that no root `test.projects` entry covers, or when a literal
  entry points at nothing — so a test suite can never again sit silently unrun.
- **Container workspaces are now fmt/clippy-clean and gated.** The scan workspace's formatting drift
  and two clippy findings (scan, ocr) are fixed, and the containers job's per-changed-workspace gate
  now runs `cargo fmt --check` + `clippy -D warnings` + `cargo test`, matching the crates/ rust gate.
- **Every gate job now carries a hang guard.** All jobs have a `timeout-minutes` cap set comfortably
  above their honest wall-clock (only the lint job had one), so a runaway fails in minutes instead of
  burning a runner toward the 6-hour default.
- **Gate classification hardened.** The `workflow_dispatch` diff base now falls back to the merge-base
  with `origin/main` (`HEAD~1` under-classified multi-commit branches and could wrongly skip the heavy
  jobs); an empty diff fails safe by running everything; a crashed `affected-lint` classifier fails the
  `changes` job — and an empty lint scope fails the `lint` job — instead of silently degrading;
  markdown-only edits inside `crates/` or `containers/` no longer trigger those areas' heavy jobs; the
  `typecheck` job's five checks are separate named steps so a red run names the failing surface.
- - **The Oxlint ruleset is now actually enforced, and broadened.** The lint rules lived in a root
  `oxlintrc.json`, but `vp lint`/`vp check` read Oxlint config from the `lint` block of
  `vite.config.ts` and never from that file — so the ruleset was **dead**, and `oxc/no-barrel-file`
  (ADR-0070) was silently unenforced. Moved the whole ruleset into `vite.config.ts` where vp reads it
  (restoring the no-barrel rule), deleted the dead `oxlintrc.json`, and dropped its now-redundant
  entry from `tooling/affected-lint` (`vite.config.ts` already forces a whole-repo re-lint). While
  there, broadened coverage: enabled the `suspicious` and `perf` rule categories as **warnings**
  (advisory — they do not fail the gate), with the one noise-flood rule turned off
  (`typescript/no-unsafe-type-assertion`, ~600 reviewed `as` at typed seams) so the high-signal tail
  stays visible. Plugins are listed explicitly (`typescript`, `unicorn`, `oxc`) — no `react`/`jsx-a11y`
  (Svelte app, zero JSX). Promoting `correctness` to a hard error and enabling
  `no-unsafe-type-assertion` are tracked as planned strictening in `docs/conventions/typescript.md`. Confirmed the type-aware pass's tsconfig `include` patterns are already
  scoped (`src/**/*.ts`), so no change was needed there. Ruleset home + rationale:
  [`docs/conventions/typescript.md`](docs/conventions/typescript.md).
- **Searchable-PDF writer: correctness hardening from an adversarial review.** Three defects in the
invisible-text-layer writer, found before it ships:

- A non-BMP character (an emoji, or a CJK Extension-B ideograph — the kind that appears in Chinese and
  Japanese proper names) was silently dropped from the searchable layer: its `ToUnicode` mapping was
  built per UTF-16 code unit, so a surrogate pair became two undecodable halves and the character
  vanished from extracted text — which redaction reads, so a name the writer could not represent could
  not be redacted. Each character now maps to one code with a correct multi-unit `ToUnicode` destination.
- The layer's font could overwrite a page's own font if that page happened to carry a resource under the
  same name; the writer now picks a name proven free on every target page.
- A single degenerate (zero-area) word box no longer drops that one word — the line falls back to
  whole-line placement so every recognized word survives.

Known remaining gap: on a page with a non-zero `/Rotate`, the invisible layer is placed in the
unrotated frame, so selection geometry is off (the text is still searchable). A rotation-aware placement
is a tracked follow-up.
- - **Retyping a custom field no longer shifts its amounts by a factor of a hundred.** Convert moved each
  stored integer to the new kind untouched, but what that integer means depends on the kind: a plain
  number field counts whole units while a currency field counts minor units. A number field holding
  `500` therefore read as **$5.00** the moment it was retyped to currency, while every later write of
  $500 stored `50000` — one field permanently holding two different scales, with no error anywhere.
  Convert now re-expresses every numeric value at the target kind's scale, moving the decimal point
  exactly rather than multiplying (no rounding, no floating-point remainder), and **parks** any value
  that cannot be re-expressed exactly — $500.50 retyped to a whole-unit number field is held aside for
  review instead of being quietly rounded, with its original preserved in history as always. The same
  rule now covers every scale-crossing pair: a checkbox or typed text converted to currency reads as the
  amount a person wrote (`"1,234.56"` becomes $1,234.56, not $12.34), and a currency field converted to
  text renders `"500.00"` rather than `"50000"`, so converting back restores the original amount. The
  preview runs the identical classification, so the clean/parked counts an administrator approves are
  exactly what applying commits.

- **A custom-field value is now checked against the field's definition before it is stored.** The value
  write composed its statements without ever reading the field it was writing to, so the "typed" field
  engine accepted values it had no type agreement with: a value stored against a field that does not
  exist (an orphan row, answered `200`), a text value on a currency field, a fractional number in a
  column that must hold whole minor units, a value written to an archived field, and a picklist choice
  that belonged to a different field or had been archived — the last of which stored a value that
  rendered blank and was destroyed the moment a later conversion read it. Each is now refused before
  anything is written, with its own reason: an unknown field is a `404`, and a kind disagreement, a
  fractional amount, an archived field, a foreign or archived picklist option, and an over-long text
  value are each a `422` naming what was wrong. A per-value text ceiling and a bound on a field's
  declared number scale keep a single record from pushing hundreds of kilobytes into a row, and keep a
  wild scale from turning every write into a rounded or infinite number.

- **Two adjacent custom-field refusals that used to surface as server errors or silent overload.**
  Previewing or applying a conversion on a reference field (or to one) raised an untyped error that
  reached the client as a `500` for an ordinary administrative action, and a reference field holding no
  values "converted" successfully into a kind that cannot hold references; both directions are now a
  clear refusal that does not depend on how many values the field holds. Retyping a field whose value
  count exceeds what one atomic pass can carry is likewise refused with the count and the ceiling, rather
  than being attempted as a single enormous commit — the background pass for larger fields is still to
  come. The confirmed-rule coercion path ("500k" → 500000) now also produces a whole number at the
  target field's scale, or refuses, instead of a fractional amount.
- - **Directory merges no longer strand chained entities, destroy absorbed relationships, or accept
  writes on merged-away records.** Three defects in the merge subsystem are closed. (1) Merging an
  entity that had already absorbed others left a two-hop chain: resolution follows exactly one hop, so
  the earlier subordinates resolved to an entity that had itself been merged away. A merge now
  repoints the merge pointer of every entity previously merged into the subordinate onto the new
  master in the same atomic batch, so `merged_into_id` always names a live entity and every historical
  entity resolves to the final master in one hop — chosen over transitive resolution because it costs
  one write per chained entity once, instead of a recursive lookup on every read path forever.
  (2) A reference that could not be repointed live during absorption — a matter-party link or an edge
  the master already carried, or an edge that would have become a self-loop — was hard-deleted,
  destroying the record that the merged-away entity ever held that relationship. Those rows now move
  to the master and land archived (soft-deleted, temporally closed) with their content intact, mirroring
  the archive-to-history handling custom-field values already used, and each absorption stays recorded
  in the `entity_merge` event. (3) The shared existence assertion ignored entity status, so names,
  identifiers, edges, category assignments, and matter-party links could still be attached to a
  merged-away entity. Those writes are now refused with a conflict that names the surviving master;
  reads are unchanged and still return the merged entity with its pointer to follow.
- **Renaming a Directory entity now verifies the entity first.** `changeName` was missing the guard its
  sibling `addName` carries, so renaming an unknown entity inserted an orphan current-flagged name row
  and its phonetic codes into the conflicts corpus and still reported success.
- **A merge no longer repoints a subordinate that another merge already claimed.** The archive write
  re-checks at write time what the guard checked at read time, so where two concurrent merges of the
  same subordinate both pass the read-time guard, the loser cannot point it at a master that received
  none of its references.
- - **The editor's live working copy is now served only to the session that owns it.** The WOPI file-access
  handlers chose between the mutable `files/{fileId}/current` object and the immutable version the access
  token names by the token's capability, so any edit token got `current` whenever the object existed. That
  object outlives the session that wrote it — an idle reap cuts a version but leaves the object in place —
  so a newly opened editing session could pick up an abandoned working copy as its base and save on top of
  it, and a token minted outside the live session could be handed bytes it was never scoped to. Both
  handlers now share one rule: read `current` only when an editing session is live, the token was minted
  for that session, and that session recorded the working copy; everyone else reads the version their token
  names, with no fallback between the two. `CheckFileInfo` applies the same rule, so the size and version it
  advertises always describe the bytes the next `GetFile` returns. Reading is still never blocked — a
  read-only viewer that joined the live session follows the live edits.
- **The document editor worker no longer boots a container for an invented hostname.** Its per-document
  routing accepted any nonempty first Host label as a container key, so any request carrying a plausible
  `Host` started an isolated multi-gigabyte Collabora container. The label is now validated against the
  shape the editor-launch actually mints — 52 lowercase hex characters of a SHA-256 digest — before
  anything addresses a container, and anything else gets a cheap 404.
- - **A file's clean verdict now binds to the bytes it was computed from.** The presigned PUT that
  delivers an upload stays valid for the rest of its lifetime, so the same URL could overwrite the
  object minutes after ingest had already committed the version clean — and the overwrite's own R2
  object-create event no-opped, because the only branch that ran for a non-pending version looked at
  the scan engine's version and never at the bytes. The swapped content was then served to every firm
  member under `scan_verdict = 'clean'` with a hash that described content that no longer existed.
  An object-create event for an already-committed version is now treated as what it is — a second
  write — and the stored bytes are re-measured against the hash recorded at commit. Matching bytes
  leave the verdict standing (an at-least-once redelivery changes nothing); differing bytes withdraw
  the version behind the status gate, scan the replacement content so the row records what arrived,
  repoint the file's current version at the newest version that is still clean, and emit the ordinary
  quarantine audit/outbox/telemetry trio. A scan that cannot run is never a reason to leave swapped
  bytes servable — the withdrawal happens either way.
- **Legacy Office documents are no longer quarantined for telling the truth.** The ingest gate
  compared the sniffed content type to the declared one with byte-exact string equality, but a
  magic-byte sniff names the container: every pre-2007 Word, Excel, PowerPoint and Outlook file sniffs
  as `application/x-cfb`, while a browser declares `application/msword` and friends from the
  extension. Each one was read as a lie and quarantined — and the sniffed container type was missing
  from the default upload policy's allowed list too, so nothing could have let it through. The
  comparison now normalizes case and parameters and consults an explicit table of container
  relationships (the compound-file family; ZIP against the OOXML/OpenDocument formats, in both
  directions, since the sniffer reports the bare archive when its markers fall outside the head
  window). Every pair outside that table still disagrees and still quarantines.
- **A gate quarantine records why it happened.** A version rejected for a type lie, a size lie or a
  policy breach persisted a null `scan_detail`, so the reason reached only the outbox message and the
  telemetry event; a reviewer opening the row later could not tell a malware hit from a size mismatch.
  The reason is now written to the row.
- **`firm.bucket_name` is UNIQUE.** The ingest consumer resolves an R2 event's bucket name back to a
  firm with `WHERE bucket_name = ?`, and the provisioner's comments already described the stored name
  as per-firm unique, but nothing enforced it — two firms sharing a name would have made that lookup
  ambiguous. Added as a control-plane migration; SQLite treats NULLs as distinct, so firms whose
  bucket is not yet provisioned are unaffected.
- - **Two matters opened at the same instant can no longer be handed the same place in the firm's
  numbering sequence.** A number draw reserved its place by re-reading a counter and then advancing it
  only if nobody else had — and where that check lost, the duplicate was expected to be caught by the
  rule that no two matters may carry the same number. That rule only sees the finished number, so it
  caught nothing whenever the firm's scheme mixes something that varies per matter into the number
  without also resetting the counter on it: a client code, staff initials, a matter-type code. Two
  matters opened together for different clients then rendered `ACME-0001` and `BRIGHTON-0001` — two
  different numbers, both claiming the firm's first file of the sequence, with the counter left at 2 so
  the duplication was invisible from then on. Each draw now records the sequence position it consumed,
  and the database refuses a second claim on a position already taken: the losing request rolls back
  whole and immediately re-draws on the next number. Numbers a firm has already assigned are untouched.

- **Opening a matter twice no longer overwrites the number it was already given.** The open path
  checked that a matter was still a prospective consultation and then wrote the new number as a
  separate step, so two opens in flight together — or an open arriving just after someone closed the
  matter — could rewrite an already-open matter's number, its opening date, and its state, with the
  displaced number simply gone. The write is now conditional on the matter still being a prospective
  consultation, and the request that loses is told the matter was opened or closed concurrently instead
  of being handed a number that ended up on no matter at all.

- **A closed matter can no longer be closed a second time.** Re-closing silently moved the recorded
  close date and announced a second closure to everything downstream — a January closure re-run in June
  moved the date that retention and archival clocks run from by five months, with nothing recording
  that it had moved. Closing an already-closed matter is now refused, and a close that arrives at the
  same moment as another close leaves the first close date standing. A retried request carrying the
  same idempotency key still replays its original response, as before.

- **Changing a matter's number now records the number it replaced.** A manual, court, or legacy number
  overwrites the previous one in place, and nothing retained the old value — so a filing or invoice
  quoting the earlier number resolved to nothing anywhere in the system. The audit entry and the change
  event now both carry the displaced number.
- - **The metadata scrubber no longer leaves revision, whole-part, or appended-data residue in a file it
  reports clean.** Accepting tracked changes now covers the entire word-processing revision
  vocabulary rather than deletions and move-out content alone: move range markers (which carry the
  reviser's name, the date, and the passage that moved), every property-change record, table row and
  cell revisions — a row or cell deleted under tracked changes is now removed rather than having its
  marker stripped while its text stays — and the revision save identifiers that link passages to
  individual writing sessions across the document, styles, and settings. Whole part classes that
  used to travel through a one-click scrub untouched and unreported are now handled: the rendered
  preview image of page one (which still showed the markup the XML pass had just removed), embedded
  custom XML data (where a document-management system stores its client and matter record), and the
  stored document variables, mail-merge data source, and attached-template path in the document
  settings — including the network locations those carry in their relationships. Dropping a part now
  also removes its content-type declaration and the relationships that point at it, so a scrubbed
  document stays valid for a strict reader; relationships are matched by what they resolve to rather
  than by the end of their address, so an external link whose URL merely ends in a removed part's
  name survives. Every rewritten part is written with a single XML declaration — a second one made
  the part malformed. For images, a JPEG scrub now ends the copy at the end of the image instead of
  carrying forward everything after it, which could be an entire embedded file, and both JPEG and PNG
  inspection report appended data; an image whose structure cannot be parsed is refused as unreadable
  instead of being returned as a header-only picture. The inspection report gained matching entries
  for the newly covered classes: embedded preview, embedded data, document settings, edit history,
  and appended image data.

- **The metadata tool's decompression guards now apply everywhere an archive is opened, at a limit the
  runtime can survive.** Format detection used to inflate the main document part with no guard at
  all, ahead of every guarded read, so a small crafted archive could exhaust the runtime before any
  cap was consulted; detection now answers whether the part exists without decompressing anything,
  under the same entry-count and declared-size caps as every other read. The total inflated-size cap
  was set above the memory available to the whole request, which meant it could never fire in time;
  it is now set well below it, with room for the buffers held at the same time. The upload endpoints
  also bound and validate the encoded body on the request schema, so an over-long or malformed upload
  is refused before it is decoded rather than allocating first or failing as an unexpected error.
- Closed two ways the PDF engine could carry content past an operation meant to remove it, both through page annotations — which sit beside a page's content stream and so are untouched by any rewrite of it. `split` left each kept page's `/Annots` as it found them, so a link, popup, or parent reference naming an excluded page pulled that page's dictionary, content streams, and resources into the output through the object-graph walk that decides what to keep: invisible to a reader, plainly readable in the bytes. Split now severs those references — dropping the out-of-range link and keeping the annotation, or dropping the annotation when it is entirely about an excluded page — and refuses to emit a range at all if an excluded page's objects somehow survive. Surgical (text-preserving) redaction removed glyphs from the content stream but never touched annotations, so a note's `/Contents`, a FreeText caption, a link URI, or an appearance stream could still carry the redacted words; it now removes every annotation standing over a redaction rectangle, together with the popup and reply annotations that repeat its text, and falls back to a raster flatten for any page whose annotations cannot be cleared. Flatten redaction, which already unlinked `/Annots`, now blanks the annotation objects themselves, so one still named from elsewhere in the file (an AcroForm field entry) cannot survive pruning with its text intact.
- - **A shipment's label PDF is now readable only by the firm that bought it.** The label download derived
  its object key straight from the URL's shipment id and streamed whatever bytes it found, with nothing
  proving the shipment belonged to the caller's firm — so any authenticated member of any firm holding
  `shipping:manage` could fetch another firm's label, and a label carries the recipient's full postal
  address. The read now resolves the label row through the caller's own firm-scoped database first and
  serves the server-recorded key from that row; a shipment outside the caller's firm finds no row and is
  answered `404` (absence, not a distinguishable refusal). Label objects are also keyed under the owning
  firm now (`labels/<firmId>/<shipmentId>.pdf`), so two firms cannot name one object even where they
  share a bucket. Labels bought before this change keep working — the read follows the key recorded on
  the label row, whatever its shape.

- **Uploads are presigned into, and read back from, one bucket.** The upload routes signed direct-to-R2
  URLs against the firm's own provisioned bucket while the ingest consumer and the storage sweeps read
  through the single bound R2 binding. On any deployment where those are not the same bucket — which is
  what firm provisioning actually creates, a per-firm `magna-carta-production-firm-<slug>` bucket — the
  bytes landed where nothing could read them: ingest would find no object, retry, and dead-letter, so
  uploads failed silently. Both ends now resolve the firm's bucket through one seam
  (`apps/worker/src/files/firm-bucket.ts`), which hands back the name a URL is signed against and the
  handle bytes are read through as a single answer, and refuses to mint a presigned URL for a bucket
  this Worker cannot read back (the new `R2_BUCKET_NAME` var names the bound bucket, since an R2 handle
  carries no name of its own). Every route that presigns or writes a firm's bytes goes through that
  resolver, pinned by a source scan.
- **Three defects fixed: usage telemetry could fail a served request, a reaped bulk-download bundle could
never be rebuilt, and the malware scanner ran on one container instead of five.** (1) The server-side
usage `reached` event resolved analytics consent and emitted _after_ the route had already committed its
response, with no error boundary — a consent-read failure turned a delivered 2xx into a 500. That work
now runs off the response path and reports any failure through the standard background-failure pipeline,
so telemetry can no longer disturb a served request. (2) The bulk-download coordinator shared any
non-failed job as-is, so once the `bundles/` R2 lifecycle rule expired an artifact the job kept reporting
`ready` with a key that no longer resolved and the bundle could never be rebuilt; the coordinator now
confirms the recorded artifact (or every volume of a split archive) still exists before sharing a `ready`
state, and rebuilds when it is gone — in-flight builds are still single-flighted exactly as before.
(3) Every request to the scan worker addressed one Durable Object name, so the five container instances
it is configured for were unreachable and concurrent scans queued behind a single container; scans are
now spread across one shard per configured instance, keyed on the file version's storage key so a retry
lands on the instance that already handled it. The engine-global histogram read, the file-type identify,
and the warm-poke cron stay on the shard the poke keeps resident.
- - **The email-filing tables are now classified in the PII/erasure registry.** The six per-firm tables
  the email filing record model added (`email_thread`, `email_message`, `email_matter_link`,
  `email_participant`, `email_attachment`, `email_capture_address`) landed unclassified, so the
  registry's coverage fitness function was red on `main`. `email_message` (frozen sender address),
  `email_participant` (each frozen from/to/cc/bcc address, plus its resolved Directory entity where one
  exists), and `email_matter_link` (which firm member filed a message to a matter) are registered as
  personal data retained under the matter corpus; `email_thread`, `email_attachment`, and
  `email_capture_address` are recorded as explicitly non-PII structure. Participants are keyed by
  frozen address value as well as by resolved entity id, so a participant the Directory never matched
  is still reachable by erasure.
- - **A retried or duplicated label purchase can no longer buy a second label.** Double-buy protection
  rested on an `Idempotency-Key` header sent to EasyPost — an API with no idempotency facility of any
  kind, so the header was simply ignored and every retry was a fresh, separately billed purchase. The
  guard now lives on our side: a shipment takes an exclusive purchase claim (a guarded status
  transition committed before any money moves), so exactly one request out of any number of concurrent
  or retried attempts reaches the carrier, and a shipment whose label is already bought answers `409`
  instead of buying again. A buy the carrier definitively refused hands the claim back so the firm can
  correct and retry; an indeterminate failure — a provider `5xx`, a dropped connection, or a failure
  after the buy returned — keeps the claim, because the label may exist and be billed.

- **Requested parcel insurance is actually purchased.** `insuranceAmountMinor` was accepted by the API,
  stored on the draft, and shown back to the firm, but was never sent to the carrier — so a parcel of
  original documents recorded as insured was in fact uninsured. The declared value now rides the label
  purchase as the carrier's own insurance parameter (a decimal-dollar string), taken from the draft
  rather than from the purchase request, so what the firm was told it insured is what is bought.

- **The purchase is checked against the draft before any money is spent.** The route bought from the
  carrier before confirming the shipment existed and never reconciled the supplied carrier-shipment id
  with the draft, so postage could be bought against a nonexistent row or attached to another draft's
  addresses. Rate shopping now records the carrier-side shipment it quoted against, and a purchase
  naming a different one is refused with `422`. A label download that fails is no longer stored and
  served forever as the label — the transfer must succeed before the bytes are kept.

- **A firm can disconnect and reconnect its postage account.** Connecting always inserted a new
  connection row against a unique `(category, principal)` index, so every connect after the first
  failed with a `500` and there was no way to remove a connection at all — a firm rotating a
  compromised API key was dead-ended with the revoked one. Connect is now an upsert that rotates the
  credential in place and re-arms a connection the health model had parked, and a new
  `DELETE /api/v1/integrations/shipping/connection` removes it. The credential is addressed by firm
  rather than by a freshly minted connection id, so a rotation replaces the old key instead of
  orphaning it.

- **The whois IP path resolves the right RDAP server.** Bootstrap matching compared CIDR blocks as text
  prefixes, which is wrong for any delegation that does not land on an octet boundary: members of a
  block were missed, and unrelated addresses that merely shared leading characters were claimed.
  Matching is now real numeric containment over masked integers, longest prefix first, for both IPv4
  and IPv6 — and a hex-bearing IPv6 literal is no longer mis-routed to the domain bootstrap.
- **Searchable-PDF writer: the invisible text layer is placed at its recognized box, not an order of
magnitude larger.** The writer applied the recognized font size twice — once through the text-font
operator and again on the text-matrix diagonal — so a run recognized at a 160×20 pt box was written
about ten times that size. Selection highlights and any position-based redaction landed far from the
visible glyphs. The text matrix is now a pure translation to the box's bottom-left; size comes from the
font operator and the width fit from the horizontal-scale operator alone. A geometry regression test
writes a run and asserts the extracted bounds sit around the recognized box.
- **Text on rotated pages lands on the visible content, on both the searchable-PDF layer and Bates
stamps.** The OCR engine reads the displayed (rotation-applied) page, so a recognized run's box is in
the displayed frame; the searchable-PDF writer now counter-rotates each run into unrotated user space
so that, once a viewer re-applies `/Rotate`, the invisible layer sits under the visible glyphs —
previously it was placed as if the page were unrotated, drifting the layer (and any selection or
position-based redaction) off the content on any rotated page.

This also fixes a latent error in the shared display-to-user coordinate matrix that both this writer and
Bates stamping use: for quarter-turn rotations (`/Rotate 90` and `270`) it swapped the page width and
height in the translation, so on a non-square page a stamp or layer was displaced by the
width–height difference — enough to push it off a portrait page entirely. The matrix now lives in one
place with the axes correct, guarded by two regression tests: a searchable-layer test and a Bates test
that each assert their text renders at the same displayed position whether the page is unrotated or
turned a quarter-turn either way.
- - **The one-logging-path rule is enforced in every Worker, not just the API worker.** The console ban
  named `apps/worker` explicitly, so the extracted workers — the malware scanner, the converter, the
  bundle builder, and every future one — sat outside it: an ad-hoc `console.*` in any of them shipped
  through a green build. The scan now enumerates the app directories rather than listing them, so a
  newly extracted worker is covered the moment it exists, with no test to remember to update. The web
  app stays outside by name, being browser code with its own in-app developer console. Two new checks
  keep the widening honest: one asserts that every app except the web app is enumerated, and one
  asserts the scan actually reaches files inside the extracted workers, so a refactor cannot quietly
  narrow the ban back to nothing.

- **Comments and names that pointed at process paperwork now explain themselves.** Several telemetry
  comments, a test name, and a comment in the document-editor container cited a slice, a plan task, or
  an architecture decision record instead of stating the reasoning or naming a file — the exact drift
  the process-reference gate exists to prevent, in the forms it cannot mechanically detect. Each now
  states why, or points at the module that settles the question.

- **The Directory area guide matches the code again.** It named four functions that do not exist,
  attributed a duplicate-candidate ordering to a line number that had moved, and cited the wrong
  fitness probe; the frozen name-normalization contract named the wrong column for its own output. The
  guide now also says plainly what a merge does _not_ move — the subordinate's own names, identifiers,
  and contact rows stay where they are and resolve through the merge pointer, which is what makes a
  merged-away alias still surface in search and conflicts.
- **The conversion queue consumer now resolves its R2 bucket through the firm-bucket seam.** It read the
source object and wrote the converted result through the bound binding directly while the conversion
routes presigned both legs through `resolveFirmBucket` — precisely the split the seam exists to prevent,
and one that would send a job's bytes to a bucket the other half never looks in the moment a firm gets
its own bucket. The firm's recorded bucket now travels on the conversion queue message (as it already
does for a bundle build), so the consumer reads and writes through the very bucket the upload was
presigned against rather than deriving one of its own, and the status route heads the result artifact
through the same resolved handle. The fitness scan that holds modules to the resolver covers both
conversion modules, so the bypass cannot come back unnoticed.

**`pnpm check:scoped` no longer diffs against a frozen `main`.** It resolved its base by trying local
`main` first and only falling back to `origin/main`, so in any worktree whose local `main` has not moved
since it was created — every agent worktree — the merge-base landed hundreds of commits behind and the
scoped gate stopped being scoped: it linted every file the trunk had touched in the meantime, slowly and
noisily, and a few hundred files was enough to take the linter down with it. The base is now the newest
of the merge-bases the trunk refs offer, ordered by ancestry rather than by commit date (a rebased commit
can carry an older date than a commit it descends from), with the previous behaviour intact whenever only
one ref resolves and `--base <ref>` still overriding both.

**`vp run bootstrap` no longer reports success over stale wasm.** Staleness was an mtime comparison
between the Rust sources and the emitted `.wasm`, which cannot see the failure that actually happens:
every worktree shares one cargo target directory, so a build can be served from a cached compilation of
sources that are not the ones on disk, wasm-bindgen re-emits the bindings from that cached artefact, and
the emitted files get a fresh mtime that reads as "current" — leaving a package missing a function it is
supposed to export, with the failure surfacing much later as `X is not a function` at runtime. Each
output now carries a stamp holding the content hash of the sources it was built from (its crate, that
crate's workspace-local path dependencies — which the mtime check never looked at — and the workspace
manifests), and no build is believed until the emitted bindings are verified to export everything the
crate's `#[wasm_bindgen]` surface declares. An artefact that comes out incomplete has its crate's cargo
cache discarded and is rebuilt once; if it is still incomplete the command fails loudly instead of
stamping a broken artefact as current.
- - **Editing (WOPI):** the two file-access callbacks now agree on what a token may reach. `GetFile`
  re-checks the file and the version the token names on every call, so a soft-deleted file, a version
  withdrawn by the custody check, or a version a re-scan has flagged is refused rather than streamed
  under a still-valid token — the same answer `CheckFileInfo` already gave. `CheckFileInfo` also
  reports the **token's** version size and identifier instead of the file's current version, so a
  version cut by another writer mid-session no longer makes the advertised metadata describe different
  bytes than the ones served.
- **Matters:** a retried `open` or `reopen` carrying the same `Idempotency-Key` now replays its stored
  response instead of being refused by the precondition its own first attempt satisfied. Close already
  behaved this way; a genuinely new request, which carries its own key, is still refused.
- **File manager:** a version left `pending` by a dead-lettered ingest — the upload finished, the
  session closed, and nothing was left to commit it — is now detected on the daily pass and re-driven
  through the ingest path, with an operator counter for the rate.
- **File manager:** the folder-move cycle check is carried inside the `UPDATE`, so two concurrent
  cross moves can no longer commit a parent cycle that permanently detaches a subtree.
- **File manager:** a blank or whitespace-only folder or file name is refused with its own code and a
  422, instead of a misleading "name taken" on create or a raw constraint failure on rename.
- **File manager:** a version-lifecycle batch (commit, check-in, no-op skip, quarantine) now fails as
  a unit when its guarded status change loses a race, rather than committing the meter delta,
  current-version pointer move, session flip, audit row, and outbox event for a change that never
  happened.
- **Automated ADR numbering is chronological again.** The `assemble-docs` workflow checked out at the
default depth of one commit, and the assembler orders pending decision fragments by the commit that
first added each file. With no history to read, every fragment scored the same and the tie-break
assigned numbers alphabetically by slug — so each bot-assembled batch of ADRs was numbered in the wrong
order, with nothing failing to signal it. The checkout now fetches full history.

**The active-work registry can see namespaced streams.** Stream notes are named after the branch they
describe, so a `claude/<name>` branch's note lives one directory down — but `vp run worktrees` listed
only the top level of `docs/active-work/`, which meant every nested note was invisible and its stream
reported as having none. The listing now walks the tree, and the twelve notes that had been flattened
to `claude-<name>.md` to work around it are back at the path their branch name dictates.
- **A soft-deleted file no longer accepts writes.** Every file mutation resolved its target through a
helper that did not look at `deleted_at`, so a rename, a move, a document-type assignment, a second
delete, a new upload version, and the return leg of an offline checkout all still succeeded against a
file in the recycle bin — changes nothing could see, until an undelete handed back a file that had
quietly moved or grown a version while it was gone. Mutations now resolve through `requireLiveFile`
and refuse a deleted file (`file-deleted`), which the routes answer with the same 404 every read of
that file gives, so a write is never the path that reveals it. The recovery surfaces are unchanged:
the deleted-inclusive listing still finds the file and the undelete still restores it.

**Upload ingest no longer buffers a body twice over to feed the scanner.** Within the
inspectable-size cap the pipeline tee'd the object into a hash branch and a malware-scan branch, which
couples nothing: whichever consumer read faster ran ahead and the runtime held every chunk the slower
one had not taken — a scan engine that read nothing pinned the whole body in memory with no bound of
its own. That lane now reads the body once and feeds both consumers from it, bounded by the cap that
already governs the lane and by the size R2 reported for the object. The over-cap lane is untouched
and still streams straight into the digest, so a multi-GB object never buffers.
- Decision-register entries can no longer render blank. Four decision fragments were authored with a Markdown title where the frontmatter belongs; the assembler's reader looked for a `---` fence, did not find one, and returned a record whose status, date, and area were all empty with the whole fragment — title included — as the body, so the register rendered four bullets with two blank fields and the title standing in for the decision text. Nothing threw, so the degraded output merged. Reading a decision file is now a validating operation: a missing frontmatter fence, an unknown frontmatter key, an empty slug/status/area, a status outside the lifecycle, a date that is not `YYYY-MM-DD`, or register text that is empty or starts with `#` all stop the assembly with a message naming the file, and the whole pending set is validated before any fragment is numbered so a bad one is a clean no-op rather than a half-consumed assembly. The same validation runs as `pnpm run lint:decisions` in the gate's governance job, so an author sees the problem on their own pull request instead of after the merge that consumes the fragment. The four affected entries were repaired in place, keeping their assigned numbers, and a corpus test now asserts every decision file in the repository renders a complete register bullet.
- **Four tooling and hygiene repairs.** **Bootstrap refuses instead of silently succeeding against the wrong checkout** — `pnpm exec vp run bootstrap` in a worktree without `node_modules` resolves `vp` from a parent checkout (worktrees live under `.claude/worktrees/`, so the binary lookup walks up into it), runs the parent's already-current bootstrap, and exits 0 while the worktree stays unbootstrapped. `tooling/bootstrap/invocation-environment.mjs` now compares the checkout the script belongs to against the one the caller's shell is standing in — nearest enclosing `pnpm-workspace.yaml`, not a path prefix, so a nested worktree is not read as part of its parent — and refuses with `run pnpm install first`; it also refuses when its own checkout has no dependencies installed. **The changelog assembler no longer doubles a leading bullet** — a fragment body written as `- **Entry.**` stacked with the `- ` the assembler prepends; `parseFragment` now strips one leading list marker (`-`, `*`, `+`), leaving nested lists and prose openers alone. **`search-core`'s selectivity test is deterministic** — `build_split` indexed on Tantivy's default thread-per-core writer, so a batch landed as two-to-eight segments depending on scheduling and both a split's size and a query's read cost varied run to run (the rare-term read ranged from 28% to 51% of the split). It now indexes on one thread, so a batch is exactly one segment, every time; extra segments were also per-query I/O the split model exists to avoid, since a searcher consults every segment's term dictionary. **Thirty-one stale `docs/active-work/` notes swept** for streams whose work is fully on `main`, with the five `status.d` fragments that pointed at them flipped to `branch: main`.
- **A staffing assignment's validity window is now recorded in whole days, and the last day counts.**
The dates a staffing assignment starts and ends are civil dates (YYYY-MM-DD) — anything else is
refused at the door rather than silently accepted, and a window that ends before it starts is
refused too. The merge engine now reads the window the way a person means it: an assignment
"through August 7" still staffs the matter for the whole of August 7, where before a document
assembled that day would already have dropped the member. Ending an assignment is unchanged — that
still takes effect at the exact moment it happens.

**When one member is staffed twice in the same role, the document result now says so.** An
assembled document that could not name "the supervising attorney" used to report "2 members" even
when both assignments were the same person; it now says the member is assigned twice and points at
ending the duplicate, and only counts members — never assignment rows — when the people genuinely
differ.
- Search — text extraction is composite and per page, so a born-digital PDF is searchable. The shipped
`TextExtractionPort` was backed only by the recognition engine, and that engine deliberately skips a
page that already carries a text layer — recognizing a born-digital page is slower, worse, and returns
a reading of a picture of the text rather than the text. Correct for a recognizer, and fatal for an
extractor: routed through recognition alone, **a born-digital PDF came back with no lines on any page
and the write pipeline recorded it `unextractable`** — no split, no catalog row, absent from every
search. That is the most common document a law firm holds, and it was the whole of the platform's
search-index write path.

Extraction now reads the document's own text layer first, in pure Rust (`crates/pdf-core`), and sends
only the pages that have no usable text layer on to recognition. **The routing is per page, not per
document**, because a scan appended to a born-digital contract is one document with pages of both
kinds: whichever way a whole-document router sent it, half of it would be lost. The result carries
per-page provenance — `native` or `ocr` — so a consumer that has to account for its corpus can tell
the characters the author typed from a recognizer's best reading of a picture of them.

Which pages still need recognizing is decided by one function in `pdf-core`, and the recognition
container now asks that same function rather than keeping its own copy. If the extractor and the
recognizer ever disagreed about a page, it would be read twice or by neither — a duplicate in the
index, or a page silently absent from the corpus. The rule itself is unchanged and still weighs text
against what it sits on, so a Bates stamp on a scanned page does not make the page look like it has a
text layer. Reading the layer, unlike measuring it, includes _invisible_ glyphs: what recognition
writes back onto a scan is an invisible layer, so skipping those would have made this product's own
searchable PDFs extract to nothing.

Reconstructing text from glyphs is where the work is. A PDF stores positioned glyphs, not words —
a space character has no outline, is never drawn, and is never observed — so every space is inferred
from the distance between the glyphs on either side of where it was. Lines are grouped on baselines
rather than box centres (a full stop shares a baseline with the capital beside it, but its centre sits
most of an x-height lower), and the word gap is measured against each line's own spacing rather than a
fixed fraction of the type size, because letters are not always set at their natural widths: the
invisible layer this product writes onto a scan stretches each recognized run to the width of the box
it was read in, and a fixed threshold reads that as one space per letter.

A document whose pages all carry their own text now extracts with **no recognition call at all**,
which for an ordinary firm's corpus is the difference between a parse and a rasterize-and-infer per
page. Measuring a page and reading it are one observation pass instead of two, so the recognition
container's own gate got cheaper as well.

**Documents already recorded unreadable are repaired.** A re-extraction sweep on the existing daily
reconciliation cron re-enqueues every committed, clean, current document version the per-firm catalog
holds no live split for — which is exactly the set that fell out of the corpus, and also repairs an
enqueue that lost its race after ingest, an engine outage that dead-lettered, and a firm that enabled
indexing after loading its documents. Nothing is deleted and nothing is marked: the catalog already
knew which documents were missing. The pass is convergent (a repaired document stops being a
candidate), bounded per firm per run so a whole back catalogue drains over several days, and it reads
the same per-firm indexing switch the ingest path does, so a firm that has not opted in is untouched.
- **The per-firm migration generator diffs against the real schema head again.** The drizzle snapshot in
`packages/database/drizzle/per-firm/meta/` had fallen eight migrations behind the journal, so
`generate-per-firm-migrations` compared the schema against a state that predated the document-automation
and custodian tables and re-emitted all of them — a migration that would have failed on every
already-provisioned firm, and the reason recent migrations were written by hand. The snapshot is now
re-derived from `per-firm-schema.ts` at the lineage head: generating against an unchanged schema emits
nothing, and a one-column change emits only that column. The control-plane lineage was audited the same
way and was already current. `refresh-snapshot.mjs` and its package scripts
(`refresh-per-firm-snapshot`, `refresh-control-plane-snapshot`, `check-snapshots`) make the repair a
single step next time a hand-written migration outruns the snapshot, and the new
`packages/database/CLAUDE.md` documents when to run it.
- Review campaign 2, the operational area — every finding applied (1 high, 6 medium, 7 low).

**A two-signatory custody release can no longer be composed by one person.** The member who checked
identity used to arrive in the request body alongside the witness, bound to nothing: one member
holding `custody:manage` could record a release and type a colleague's handle — or any well-formed
`user_…` string belonging to nobody — into the witness field, and the append-only ledger would
permanently assert that two people signed off on a handover only one person witnessed. The verifying
member is now the authenticated caller and is no longer a field on the wire at all; the witness must
be a DIFFERENT, ACTIVE member of the firm, checked against the member roster at the write path and
re-asserted by two new `BEFORE INSERT` triggers, the same footing the two-person destruction rules
already stand on. Triggers rather than CHECK constraints, so the binding is future-only: every
release recorded before it was recorded honestly under the rules that then applied, and rows already
on the ledger stay exactly as they were written.

**A closed stocktake is frozen at the database.** `custody_stocktake` — the row holding the frozen
counts and the `open` status all four sighting guards key off — carried no triggers of its own, so
the freeze rested entirely on one guarded UPDATE being the only UPDATE anybody had written. A
`BEFORE UPDATE` guard and a REPLACE-bypass guard now refuse a re-open, a second close, and any edit
to a closed count's findings.

**A truncated stocktake reconciliation says so, and cannot be frozen as a finding.**
`CustodyReconciliation` carries `truncated` and the cap that produced it, both reads request one row
past the cap to learn whether there was one, and the sighting read now runs newest-first so the cap
drops the OLDEST observations rather than the corrections the last-observation rule depends on.
Closing a count whose reconciliation truncated is refused (`custody-stocktake-truncated`) rather than
freezing a partial answer; an abandoned close records the truncation.

**The case calendar no longer disagrees with the register it federates.** The three custody-derived
timeline sources were missing status predicates their custodian equivalents carry, so a deed returned
on Tuesday kept a "due back Friday" entry forever and a released or destroyed original kept showing
"review due", named by its custody number. Each source now carries every predicate of the read it
mirrors, and a fitness test pairs the two sides so the divergence cannot recur silently.

**`overdue=true` is now the real predicate rather than a UTC-date approximation.** It was
`due_on <= <today in UTC>`, which reported a Nevada firm's live same-day deadlines as already missed
for most of the working day and let non-overdue rows consume the page. The narrowing is now composed
per zone and is exact — the same comparison `isOverdue` makes row by row — and it stays entirely in
SQL, because a post-filter under-fills the page and turns the page size into an existence oracle.

**Daylight-saving arithmetic matches what it promises.** A wall clock in the hour after a fall-back
resolved an hour early (02:14 PST became 01:14 PST), and one in a spring gap resolved BEFORE the time
somebody wrote down rather than to the instant the clock reached. Resolution is now by round trip: a
repeated hour takes its first occurrence, an unambiguous time after a transition takes itself, and a
skipped time moves forward. End-of-day is now correct in zones whose transition falls at midnight.

**Also fixed.** A deadline edit now carries the state guard its satisfy and close siblings carry,
plus a precondition fence so a losing concurrent edit aborts rather than silently rewriting a
discharged deadline. The two event reads that bypassed the visible-matter seam now compose it, and
every direct read of `matter_event` or `matter_deadline` takes the predicate as a required argument
with a fitness test over the set. The will-deposit catalog refuses an unreadable or impossible
trigger date (`custody-invalid-trigger-date`) instead of returning the same null it uses for "this
duty has no computable interval", normalizes a jurisdiction key before lookup and walks every
hyphen segment upward to name the nearest encoded ancestor, and states its verified negative in prose
rather than only in a boolean. The holdings-by-owner report replaces a correlated subquery that ran
once per owner entity in the firm with a one-pass joined aggregate. An interrupted destruction —
ledger row committed, request still `approved` — is now a list somebody can open
(`outcome=interrupted`). The keyset cursor is minted through `encodeCursor` rather than hand-rolled
at two route sites.

Contract moves: `CustodyReleaseAuthorization` drops `identityVerifiedByUserId`;
`CustodyWillCapability` replaces `summary` with `question` + `answer`; `CustodyReconciliation` gains
`truncated` and `rowLimit`; `ClosedCustodyStocktakeResponse` gains `truncated`; the destruction list
accepts `outcome=interrupted`. Adds the `custody-stocktake-truncated` problem type. Migration
`20260806T040000_operational-fixes` adds the four triggers and rebuilds nothing.
- The second review campaign's automation, email, and extraction findings, all sixteen of them, from
[`docs/reviews/2026-08-06-campaign-2-automation.md`](docs/reviews/2026-08-06-campaign-2-automation.md).

**The template expression language stops producing dates nothing can read.** `addDays` now shares the
calendar-range guard its two siblings already applied, so a day offset that leaves the four-digit
years is a `magnitude` refusal rather than a value: previously it produced a five-digit or negative
year, which the formatter's calendar-date pattern does not match — the computed field collapsed to an
empty string while the assembly counted a clean substitution — and which compared backwards against
every in-range date, because date ordering is a string comparison on the ISO form. Both failures were
silent, and both are the failure the absence model exists to prevent. Two related holes closed with
it: a value the formatter refuses at rendering time is now recorded as an absence with a reason
instead of collapsing to `""`, and the comparison arm refuses an operand that is not a calendar date
rather than answering from a string comparison that is not an ordering. A `date` custom field whose
stored text is not a calendar date now binds as text at the boundary that constructs it, so comparing
it against a date is a registration-time type error rather than a runtime lie.

**The re-extraction sweep converges over failures, not only successes.** Its candidate set is
"documents the catalog holds no live split for", which a `deferred` document (the ordinary state
wherever the recognition engine is unbound) or a `failed` one belongs to permanently — so a firm whose
oldest documents were scans re-enqueued exactly those documents every day and never reached the rest
of its catalogue. The walk now carries a cursor that advances past every candidate it examines rather
than only the ones it repaired, and the per-firm budget counts messages actually produced rather than
candidates looked at. Beside it, the index coordinator bounds re-attempts per document per engine
generation, so a document nothing can read stops costing anything after a few passes — and a deploy
that binds an engine changes the generation and resets the count, so a backlog drains rather than
being written off. A firm's whole catalogue is now reached; the fixture proves a catalogue whose
entire head is permanently failed still reaches its tail.

**A DKIM `pass` now means something about the sender.** RFC 6376 section 5.4 requires `From` in the
signed header set precisely so a verdict is a statement about who sent the message; the verifier
accepted a signature whose `h=` omitted it, which let anyone holding a message a domain had signed
rewrite `From:` and re-send it with everything still verifying. That is now a `fromNotSigned` failure,
refused before a DNS lookup is spent on it. The verification result also records how much of the body
the signature covered, and a partially-covered `pass` (the `l=` append attack) is no longer enough for
a sender-identity rule to file unattended. The number of signatures examined and the DNS lookups one
message may cause are both capped, since a correct body hash is computable by anyone holding the body
and was otherwise an amplifier pointed at the resolver. Key records carrying `t=y` no longer produce a
pass, RSA keys below 1024 bits are refused, and a non-numeric `x=` is a malformed signature rather
than a silently dropped expiry. The duplicate-`From` question the review left open is answered: the
capture record and the verifier both take the last instance, which is the one the RFC has signers
sign, and that agreement is now pinned by test on both sides.

**Extraction and filing.** One page per page index, so a repeated index from an engine can no longer
become two passages sharing a chunk id or two provenance rows disagreeing about the same page. A size
ceiling at the enqueue seam records an oversized document as `deferred` naming the ceiling, rather
than discovering it as an out-of-memory inside the queue consumer. The email add-in over-fetches
before the ethical-wall filter narrows a result set, so a walled matter can no longer consume a
member's own suggestion slots. Participant addresses resolve to directory entities in one batched
query instead of one round trip per recipient. An auto-file decision now always states a conflict
hold, even when another demotion won the ladder, and a malformed matter id in the deciding evidence is
refused rather than dropped — dropping it shrank the deciding set, which is what permits a firing. The
load-profile harness gained a probe carrying a repeating block, an aggregate, and the protected keys,
so the read plan and the serial decrypt count are measured rather than argued about.
- **`pnpm fix:scoped` no longer applies the two autofixes that are wrong in this repo, and `pnpm test`
refuses a second concurrent run instead of wedging.** Two inner-loop hazards, both recurring.

The fixer applied every lint autofix the linter offered. Two of those rewrites are not safe here:
`unicorn/no-array-sort` turns `.sort()` into `.toSorted()`, which is ES2023 and fails to compile in
packages built against `lib: ES2022` (`TS2550`, plus `TS7006` on the callback parameters — hit
repeatedly in `@magna-carta/fixtures`); and `typescript/no-unnecessary-boolean-literal-compare`
rewrites the deliberate `meta.authenticated === false` in the worker's access-control route metadata
to `!meta.authenticated`, changing what a reviewer of a security guard reads. Both are now excluded
from the fix pass and listed with their reasons in `tooling/check-scoped/unsafe-autofix-rules.mjs`,
which the fixer prints at the end of every run. The exclusion is fix-pass only: the lint ruleset in
`vite.config.ts` is untouched, so `pnpm check:scoped`, `pnpm check` and the editor still report both.
Mechanically the fixer now drives the formatter through `vp check --fix --no-lint` and the lint
autofix through `vp lint --fix -A <rule>`, because `vp check` rejects the linter's `--allow` flag.

Separately, two test runs started in one worktree contend for the same transform cache, Miniflare
state and worker pool, and wedge each other at 0% CPU — a hang that reads as slowness. `pnpm test` is
now the guarded entry point (`tooling/test-single-flight/`): the same `vp test` with every argument
passed through, behind a per-worktree single-flight lock that refuses a second run in milliseconds and
names the run already in flight. The lock is reclaimed when its holder is gone or after 90 minutes, so
a killed run cannot leave a worktree unable to test; `MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1` overrides
it. CI is unaffected — its shards each own their own container.
- **The whole-repo gate was running 40% of the test suite while reporting green.** Its `test-node` job
passed the relative paths `packages` and `tooling` to the test runner as positional filters. Those two
directories are the _parents_ of project roots, not project roots, and the runner matches a positional
filter per project against the candidate file's path relative to **that project's own root** — under
`packages/ledger` a test file is `test/posting.test.ts`, in which neither `packages` nor its reduction
`..` appears. So every package and every tooling suite dropped out of collection, the job ran the files
it did match, and exited 0. Measured on the tree before the fix: `test-node` collected **41** of the
**476** files it is named for; across the three test jobs, **435 of 719 registered test files ran
nowhere** — every `packages/*` suite, every `tooling/*` suite, and `apps/sign-worker`, which had also
never been added to the job's path list.

The gate's test jobs now filter with absolute paths (`"$PWD/packages"`), which take the runner's other
branch — a prefix test against the file's absolute path — and narrow the way the spelling implies.
`apps/sign-worker` is in the list. The three jobs collect 476 + 192 + 51 = **719** files: the whole
registry, exactly once each.

Because a filter that matches nothing is indistinguishable from a fast suite, the coverage is now
asserted rather than reviewed. A new `test-collection` gate job runs `pnpm run lint:test-collection`
(`tooling/lint-test-collection.mjs`), which re-runs each of the gate's own test invocations in
list-only mode — no test executes — and fails if the unfiltered whole-suite collection falls below a
committed floor, if the union of the jobs is not the whole suite, or if two jobs collect the same file.
It holds each invocation verbatim and checks it against `.github/workflows/gate.yml`, so editing the
workflow without the lint fails loudly instead of drifting. The floor is a generous minimum (90% of the
current count) with its update procedure recorded beside it.

The mechanism, the absolute-path rule, and a second trap found alongside it — negated `--project`
patterns are OR-ed, so two of them cancel and select everything — are written up in
`docs/conventions/build-performance.md`.
- The merge-field catalog contract declares the engine's `assets` group. The engine's group registry
gained the heading when the asset classes landed; the contract's mirror of it did not. The two
registries are pinned to each other member for member and in the same order precisely so that drift
is a failing test rather than a picker that quietly files every asset field under a heading it does
not recognize.
- **Three Nevada trust-accounting facts previously recorded in this repository were wrong, and are
  corrected against the state's published rule text.** The records-retention period is **five** years,
  not seven — seven is the pre-2021 wording, and the State Bar's own published handbook still prints
  it. The account-mechanics rule is **Supreme Court Rule 78**; Rule 78.5 was repealed in 2019, and
  every earlier reference points at a rule that no longer exists. And **Nevada mandates no
  reconciliation at all** — not monthly, not three-way; the word does not appear anywhere in the
  Nevada Rules of Professional Conduct or the Nevada Supreme Court Rules, and the guidance that
  attributes a monthly duty to a rule about interest remittance miscites it. The platform's
  reconciliation feature is unaffected and still worth using; what changed is that it is no longer
  described as something Nevada requires.
- **The public status page no longer reports Cloudflare as degraded on days Cloudflare reports itself
operational.** Cloudflare's Statuspage publishes around 470 components and most of them are
individual edge locations; several dozen are re-routed or under maintenance at any given moment, so
its whole-page rollup indicator sits at "minor" more or less permanently even with no open incidents
and every service healthy. Reading that one field made our upstream row contradict the provider it
was quoting. A provider entry can now name the component groups this platform actually depends on —
for Cloudflare, the single group holding Workers, D1, R2, Queues, Durable Objects, Vectorize,
Workers KV and Containers — and the severity is the worst of those components plus any unresolved
incident that touches them. A named group that no longer exists falls back to the whole-page
indicator rather than to "operational", so a rename upstream can never manufacture a green. The
verdict band was never affected by any of this: an upstream provider does not set this platform's
status, and an unreachable provider feed still reads as "Status unavailable" in neutral ink rather
than as an outage.

Links out to Cloudflare's status now point at `new.cloudflarestatus.com`, including the standalone
fallback page served when the status store itself cannot be read. Provider rows carry their human
status page explicitly, so the link a reader follows no longer has to be the origin of the machine
feed being polled.

The 90-day uptime bar beneath each component now speaks its record to a screen reader. The ticks
themselves stay decorative — ninety announcements per component would be unusable — but the state
they encode arrives as text: consecutive days sharing a state collapse into one phrase ("2 June 2026
to 4 August 2026 — No data"), every day in the window falls in exactly one phrase, and the uptime
percentage was already plain visible text. Days before recording began are still named as no data,
never as operational.
- **Two full-suite test races quieted at their shared root: the live queue consumers the test pool
runs.** Under `@cloudflare/vitest-pool-workers` the queue consumers declared in `wrangler.jsonc` are
real — every message a test causes to be enqueued is delivered to the actual consumer about a second
later, concurrently with the rest of the test body. Two suites raced those deliveries and lost only
under full-suite CPU contention, when their own steps stretched past the broker's batch timer.
`search-reextraction-sweep` asserted `queued` and wrote simulated verdicts while the live
search-index consumer was recording its own honest verdict for the same in-flight message (`failed`,
"source bytes not found" — the fixtures store no bytes); it now asserts enqueued-ness rather than a
state a legitimate verdict may move, and waits each in-flight verdict out before overwriting it.
`document-assembly-protected-binding` submitted through the real route, which also starts the
coordinator's own queue message — a second, competing consume that (when the delivery won) decrypted
as the submitting owner and moved the decrypt-audit counts the suite exists to pin down; it now
seeds the assembly row directly, so exactly one consume — the one under test — runs. Both verdict
state machines were checked and left alone: the search-index coordinator's overwritable
`failed`/`deferred` is what lets a queue redelivery re-verdict honestly (`indexed` was already
absorbing), and the assembly consumer's done-row guard is the deliberate redelivery defence; neither
race exists in production, where nothing manufactures a second writer. Also repaired: three per-firm
drizzle snapshots (`0034`, `0040`, `0048`) carried a `prevId` naming a snapshot that no longer
exists — parallel-branch merge leftovers, now pointed at each snapshot's actual predecessor (lineage
metadata only; runtime reads the journal and SQL, and `drizzle-kit` diffs against the head snapshot
alone). `migration-integrity.test.ts` now walks the `prevId` chain across both lineages so the next
dangling ancestor fails in CI instead of sitting wrong indefinitely.
- **The narrative trust-rules catalog no longer cites a repealed rule for the home jurisdiction, and
  every entry nobody can check is now marked as exactly that.** The 56-jurisdiction research catalog's
  Nevada entry — compiled as "verified in full" — cited SCR 78.5 throughout, a rule repealed in 2019;
  it is corrected against the primary-source research records
  (`docs/research/2026-08-07-nevada-trust-accounting-rules.md` and the unclaimed-funds/escheat
  record), including the five-year retention figure's two distinct clocks, the finding that Nevada
  mandates no reconciliation at any cadence (the State Bar handbook's monthly-reconciliation claim
  miscites a subsection about banks remitting interest), and that designated client trust accounts do
  not escheat under Nevada's unclaimed-property act — unclaimed trust funds follow NRPC 1.15(f) to
  the Clients' Security Fund, permissively, on a from-receipt clock. Every one of the 55 sibling
  entries came from the same research pass and has no primary source in the repository to check
  against, so each file now carries a banner stating those entries are NOT VERIFIED whatever their
  compiled confidence label — research leads, not findings.
- **The trust-jurisdictions review gate is hardened before anything binds to it.** An attorney review
  now binds to a revision string derived from the profile's content (authored date plus a content
  fingerprint), so an amendment that forgets the revision bump closes the gate instead of silently
  inheriting the attestation. The two newer jurisdiction refusals — rules encoded but not
  attorney-reviewed, and a reviewed jurisdiction's unresearched field — now map to the same
  trust-jurisdiction-unavailable problem type as their siblings instead of falling to the generic
  movement-refused catch-all. A source-scan fitness test guards the review-the-corpus display seam:
  a surface reaching an unreviewed value's `.value` outside the gate fails the scan unless it carries
  an explicit display-only marker. And the silence-resolved singleton values (no prohibited methods,
  no reconciliation required) are frozen, so no caller can mutate the shared answer every later
  caller receives.
- **Two endpoints that read a file from the request body now say so in the published API description.**
The file-hashing endpoint and the one-off malware-scan diagnostic both take the file's raw bytes as the
request body — that is the whole input — but the API description declared no request body for either, so
anyone building a client from the published description got a method with nowhere to put the file. Both
now declare the same raw-bytes body the other file tools declare, and the generated client accepts and
sends the bytes unaltered. No behaviour changed on either endpoint: they still stream the body straight
into the hasher or the scanner without buffering it, still refuse an empty body, and still refuse a file
over the firm's inspectable-size limit before reading it.

Both endpoints keep treating an idempotency key as optional, and that is deliberate rather than an
oversight left in place. The platform's key-required gate identifies a repeat request by reading its body
through a cache that decodes it as text, which does not preserve arbitrary bytes — so an endpoint whose
body is a file cannot use that gate without risking hashing or scanning something the caller never sent.
Neither endpoint stores anything, so a repeated request simply recomputes.

### Changed

- **Keyset-sort covering indexes for the slice 1·1 list reads — per-firm migration `0005`** (`packages/database`): the matters/consultations/files/folders list endpoints keyset-paginate by `created_at, id`; the load-profile harness showed every one materializing a `USE TEMP B-TREE FOR ORDER BY` (an index served the filter, none the sort). Added composite `(scope…, created_at, id)` indexes — `matter (created_at, id)` and `(responsible_member_id, created_at, id)`, `file (matter_id, created_at, id)` and `(folder_id, created_at, id)`, `folder (matter_id, created_at, id)` (the replaced single-column FK indexes are strict prefixes, so no coverage is lost) — and restated `listMatters`' default as `status != 'prospective'` (equivalent under the three-value CHECK) so the planner drives the `(created_at, id)` index for the sort rather than the status index. The temp B-trees are gone (verified by EXPLAIN) and the harness now **guards** it — a future sort regression fails the load-profile smoke. Safe to land as a new migration because no firm has the per-firm lineage applied yet.
- **Identifier handle prefixes spelled out in full — registry-wide** (ADR-0062 amendment; `packages/identifiers`): every prefix is now the entity type spelled out verbatim in camelCase, identical to its registry key (`matter_`, `ledgerAccount_`, `fileVersion_`, `correlation_`, `incident_`, …) — closing the last unflagged exception to golden rule 12. The prefix validator relaxed from `^[a-z]+$` to camelCase; all committed handle literals swept (test fixtures, the per-firm role-seed migrations, the OpenAPI snapshot path-param patterns + regenerated document). When the slice 1·1 branch merged up, the 0·6-era `cor_`/`inc_`/`err_` literals were swept the same way and the `0003_incident-intake` role seed repointed to the `role_`/`rolePermission_` handles the merged `0002` mints. Safe because the per-firm lineage is not yet applied to any provisioned firm.
- **Slice 1·1's per-firm migration renumbered to `0004`** (`packages/database/drizzle/per-firm`): the matters/locations/file-manager migration, authored as `0003` on a branch that predated 0·6, was regenerated as `0004_matters-locations-file-manager` on top of `main`'s `0003_incident-intake` (snapshot lineage rebuilt by drizzle-kit so a future diff is clean; the role-grant seed re-appended). Background logging in `scheduled.ts` and the files-ingest consumer moved onto the 0·6 telemetry pipeline (the console ban is structural).
- **Load-profile accretion is now audited per slice** (STATUS.md; extending ADR-0078/ADR-0083's accretion rule with enforcement): STATUS.md gains a **Load profile** stage column — default-bound for any slice touching per-firm data ([-] requires justification in Notes), checked when the slice's data joined the active profile and its volume-shaped operations joined the measured set. The how-to-extend recipe (generation probes, profile-vs-generator version bumps, the per-domain measurement-module pattern, smoke + baseline regeneration) is written in [`packages/fixtures/CLAUDE.md`](packages/fixtures/CLAUDE.md). Owner decisions recorded on the rows (2026-06-12): slice 1·2 is bound with a minimal scope (plausible incident volume + a blind-index probe + a protected-field list read); Directory-scale protected volume rides 1·3's named extension.
- **Communications layer reduced to channel transport** (white paper _Communications layer_ / _Notifications_; ADR-0047 amended by ADR-0059): the templates + automation/trigger-engine _brain_ (outbound reminder routing) moves to the new _Notifications_ subsystem; the `messaging`/`telephony`/email ports keep delivery and the telecom-compliance invariants (A2P 10DLC, TCPA, STOP/HELP, call-recording consent), which Notifications calls into rather than reimplements.
- White-paper internal cross-references converted from section numbers (`§N`) to **section titles** — inserting or reordering sections no longer breaks a reference. The cross-reference policy and the at-a-glance stack index were updated to match (section pointers dropped from the index).
- Reconciled **e-signature**: it now lives in its own _E-signature_ area under Documents (in-house, PAdES seal, ESIGN/UETA), with the _Payments_ section pointing to it; the in-house **PDF services + e-signature** design is logged as **ADR-0045** (_Proposed_ — provisional, pending verification).
- Added golden rule #11 (**implement on the latest — verify library docs first**) to `CLAUDE.md`, anchored in the white paper's _Development guidelines_.
- Toolchain: committed to **Vite+** (CLI **`vp`**) as the unified entry point (`vp dev/test/check/build/pack/run`); lint/format/type-check via **Oxlint + Oxfmt + tsgolint** (`vp check`; Prettier interim until Oxfmt is GA); **Biome dropped** (ADR-0042, after investigating Vite+/Oxc vs Biome).
- Reframed the rule hierarchy: root `CLAUDE.md` now holds only **golden rules** (broad, cross-cutting — reuse before building, all UI through the design system, firm-scoped data access, standardized error/bug logging, docs current, feature parity, no-shell, design-before-code). **Domain invariants** (financial/trust ledger rules, secrets/encryption) moved to `docs/conventions/invariants.md`, surfaced per area by local `CLAUDE.md`. Added `docs/conventions/error-logging.md` (method TBD, Phase 0) and a "not duplication" clarification of developer vs. user docs.
- **Integration platform — shared seams hoisted to platform-neutral homes.** The `HttpClient` transport seam (and its `fetch`-backed client) moved from the EasyPost adapter into `@magna-carta/integrations/http` — it is the transport every credentialed adapter builds on, not EasyPost-specific — and the per-firm secret-store seam moved from `apps/worker/src/shipping/` into `apps/worker/src/plugins/secret-store.ts`, since it backs the `CredentialStore` for every plugin. The worker core now builds the `PluginRuntime` from neutral homes and imports nothing from an individual plugin, with a new manifest-fitness guard enforcing it. No re-export shims left behind.
- **Malware-scan engine extracted to a dedicated Worker with a Cloudflare-native auto-update pipeline.** The scan Container (`containers/scan/` — clamd + yara-x + structural heuristics) has moved from the main app Worker into its own Worker (`apps/scan-worker`, service `magna-carta-scan`). The app Worker reaches it exclusively over a `SCAN_SERVICE` service binding; `resolveScanPort` selects the remote engine when the binding is present, otherwise the engine-less `unscanned` adapter — the app Worker carries no container config of its own. Signature freshness is now entirely Cloudflare-native: `magna-carta-scan` is connected to **Workers Builds** (Cloudflare-side CI, no GitHub token), so every push to the production branch triggers a fresh-`freshclam` image build and deploy; the scan worker's daily `0 7 * * *` cron POSTs a **Workers Builds Deploy Hook** (`SCAN_BUILD_DEPLOY_HOOK_URL`, set via `wrangler secret put`) to trigger an automatic nightly rebuild — a Cloudflare-native loop with no GitHub involvement. The container continues to run `enableInternet = false` (zero runtime egress); signature freshness is only ever via image rebuild.
- **Control-plane D1 migrations now apply automatically via the scheduled handler** (ADR `control-plane-migration-applier`; ops runbook in [`docs/conventions/operations.md`](docs/conventions/operations.md) § "Control-plane database migrations"). The scheduled (Cron) handler (`apps/worker/src/scheduled.ts`) runs `runPendingMigrations` against `env.DB_CONTROL` as its first action on every `*/5` tick, before the existing outbox sweep — making the cron the single-flighted sole runtime applier (one invocation per tick eliminates the concurrent-isolate race that would otherwise throw on the `_migrations` PRIMARY KEY). The control-plane migration lineage is now bundled into the worker (`apps/worker/src/control-plane-migrations.ts`, mirroring `per-firm-migrations.ts`), and the test applier (`apps/worker/test/support/apply-control-plane-migrations.ts`) delegates to the same bundle so test and production share one migration map. New additive control-plane columns are read with fail-safe defaults so the brief post-deploy window before the first cron tick is harmless (example: `/me` defaults to `channel: "stable"` if `firm.release_channel` is briefly absent). The previous manual "apply `0003_handy_rattler` before deploy" step is removed.
- **Build pipeline corrected to Cloudflare Workers Builds, and a standard that keeps builds fast.** The docs now name **Cloudflare Workers Builds** as the build-and-deploy CI/CD (it builds and deploys each Worker on push); the stale "GitHub Actions" claim is corrected across the white paper, root `CLAUDE.md`, and [`operations.md`](docs/conventions/operations.md), and the unused, failing `.github/workflows/ci.yml` is removed. Build-time performance is now a standing requirement — anything that builds repeatedly is optimized for fast builds by default — codified in [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md) and hooked into the "Build when in the area" principle. The levers: Workers Builds **Build Caching** + **Build Watch Paths** (per-Worker, enabled in the dashboard — see the operations runbook), and BuildKit cache mounts in the scan `Dockerfile` so an unchanged Cargo dependency graph is not recompiled. With GitHub Actions retired, the quality gate, tests, contract drift checks, and the scan EICAR check now run via a tracked **`pre-push` git hook** (`vp run setup-hooks` to activate) rather than a standalone CI runner — blocking a push that would deploy a broken change.
- **Per-firm database re-architected to a `FirmDatabase` Durable Object** (design [`docs/specs/2026-06-23-per-firm-database-durable-object-design.md`](docs/specs/2026-06-23-per-firm-database-durable-object-design.md)): each firm's SQLite database now lives in a `FirmDatabase` Durable Object addressed `idFromName(firmId)` and reached through a `firmDatabaseProxy` worker-side proxy — binding-free, no redeploy per firm, no binding-count cap. All ~185 data-access statement modules are unchanged; the proxy satisfies the same `SqlDatabase` contract used throughout the codebase. The chokepoint, all three queue consumers (ingest, member-provision, inference), and the cron sweep resolve a firm's database by `firmId` through the DO. Control-plane D1 (`DB_CONTROL`) and all R2 are unchanged. The retired `DB_FIRM_POOL_*` bindings, `firm-binding-resolver.ts`, and the per-firm `createDatabase` + migrate-at-provision step are removed. Supersedes the per-firm-D1 half of ADR-0003.
- **Malware scanner reports raw facts; the file verdict is decided in the application.** The scan
Container no longer combines its engines into a single verdict — it returns a `RawScanResult` (clamd
state, structural heuristic, the YARA matches each tagged with `{tier, score, isSuspicious}`, and
per-leg timings), and the application turns those facts into a `clean | flagged | unscanned` verdict
via `computeVerdict`. The full YARA corpus is baked and scanned once, so a later slice can re-tier a
firm's policy with no re-scan. The four prior quarantine verdicts (`infected` / `suspicious`) collapse
to one `scan-flagged` state. The per-firm content-dedup `scan_cache` now stores the raw result and is
keyed on the engine version derived from that same result, so a clean ingest commit repopulates the
cache and the scan-once dedup is reused by the access-triggered re-scan path. A deployed engine that
goes dark returns `clam: unavailable` with HTTP 200 and is raised to a retryable fault in the
application (never a fabricated clean); the only Container 503 is an in-process engine panic.
- **Upgraded the Cloudflare dev/test toolchain in lockstep:** `wrangler` 4.98.0 → 4.105.0, `@cloudflare/vitest-pool-workers` 0.16.13 → 0.16.20, and `@cloudflare/workers-types` 4.20260604.1 → 4.20260625.1 (catalog). The pool package hard-pins an exact `wrangler`/`miniflare` pair, so the three move together; the refreshed `miniflare` clears the transitive `undici` (now 7.28.0) and `ws` (8.21.0) advisories in the dev/test graph. `scheduleRequestPathSweep` now takes `Pick<ExecutionContext, "waitUntil">` instead of the full `ExecutionContext`, since the newer `workers-types` makes runtime-only fields such as `tracing` required — depending only on the one method used keeps the helper stable as the Workers type surface grows. (`pnpm-workspace.yaml`, `apps/worker`)
- **Design system — architecture hardening (audit fix-now batch).** The app now actually loads its fonts (`apps/web` was rendering the whole design language in the system fallback; a stylesheet-mirror test keeps the catalog and app cascades identical). Two personalization axes the design language promised are now real: **motion** (full/reduced/off as a resolver modifier re-pointing the duration ladder — `data-motion` overlay blocks, boot-script + preference-seam support, plus a `signature` 500ms rung and the register easing pair `settle`/`travel`) and **density** (comfortable/compact re-pointing new `density.control-*` aliases; every control recipe routes its geometry through them, heights became `min-block-size` so OS text-scaling can't clip labels, and the DataTable's per-table option was renamed `data-row-density` to stop colliding with the global axis). Tracking tokens went px→rem so the caps voice scales with the type under text-size accommodation. New semantic roles `surface.selected` and `surface.field` end the overloading of `action.secondary`. Type-size variables renamed `--mc-font-size-*` (Tailwind `text-*` utilities unchanged) to kill the silent collision with the `--mc-text-*` color roles. The recipe purity grammar deliberately admits `content: ""` and now bans physical box properties (RTL stays free). anime.js 4.5.0 lands behind a gated single-import seam (`internal/signature-motion.ts` — lazy, compositor-only, motion-axis-aware) with `internal/motion-preference.ts` as the one JS reader of the motion axis.
- **Design system — the Engraved Ledger register (first fold).** The owner-approved finishing voice lands in `@magna-carta/design-system`: self-hosted fonts now actually load (Atkinson Hyperlegible Next Variable for reading, Fraunces Variable for display serif at ceremonial edges, UnifrakturMaguntia for the brand mark — the catalog previously rendered in the system-ui fallback); a new `BrandMark` component (blackletter illuminated M + letterspaced MAGNA CARTA wordmark) replaces the placeholder icon in the sidebar brand corner; structural labels (sidebar group labels, table column headers, filter headings) take the letterspaced-caps voice via the new `tracking.caps` token; and the Tabs active indicator becomes a gold underline that draws in (the "gilt draw" — new `mc-draw-x`/`mc-draw-y` keyframes, reduced-motion safe). Also fixes the table sort button silently discarding the header's uppercase (UA `text-transform: none`).
- **Container subsystems extract to dedicated Workers — standing architecture rule** (ADR `container-subsystems-dedicated-workers`; rubric + worker template in [`docs/conventions/operations.md`](docs/conventions/operations.md) § "Container subsystems → dedicated workers"). A subsystem built on a heavy native runtime in a Cloudflare Container now gets its **own** Worker (no public surface, reached only by service binding, owning the Container Durable Object, `enableInternet = false`, with its own deploy/scaling/warm-poke cadence) rather than being wired into the main `magna-carta` app Worker — realized first by malware scanning (`apps/scan-worker` → `magna-carta-scan`). Extraction is gated by a five-property rubric (heavy runtime · independent deploy cadence · distinct scaling · containment · **stateless compute**) plus a compute-vs-coordination seam: only stateless compute crosses into the dedicated Worker; firm-state coordination (the editing session DO, the conversion job DO, the registry/pathfinding logic) stays in the app Worker behind the data-access layer. A subsystem whose state **is** a durable per-firm dataset (full-text search / Tantivy) fails the statelessness test and is a separate stateful-service design, not this pattern. Adopted by editing (2·2, extracting the coolwsd compute) and under evaluation by conversion (2·4, at its `ConversionPort` seam).
- Pushing or merging to `main` no longer builds or deploys anything. The
Cloudflare Workers Builds production branch is now `release` on every connected
Worker, so the trunk carries code to GitHub without changing the live
environment. Deploying is an explicit fast-forward — `git push origin
main:release` — after which each Worker's Build Watch Paths decide which
Workers rebuild.
- - **Bash is the canonical shell for this repo** (golden rule 7), with PowerShell reserved for genuinely
  Windows-native work. The two take opposite multi-line-string and path idioms, and mixing them was a
  measurable source of failed commands. Paths are written in one canonical form, passed absolutely
  rather than behind a `cd`, so a permission rule can match more than once.
- Schema migrations now use monotonic, timestamp-based IDs instead of sequential
`00NN` numbers, so migrations authored on parallel branches never collide on a
number or need renumbering at merge. The pre-production migration chain was
collapsed to one clean baseline per lineage (control-plane and per-firm),
verified schema- and data-equivalent to the full legacy chain.
- AI-Text Detection — the Pangram endpoint reconciliation is complete. The AI-Text Detection adapter now supports both the async external-API task-poll flow (`text.external-api.pangram.com`, `POST /task` → poll `GET /task/{id}`) and the synchronous endpoint (`text.api.pangram.com/v3`), selectable by configuration (async is the default). No user-visible behavior change; internal correctness fixes ensure the provenance (`version` → `vendorVersion`) is accurate and the async poll delay is injected, keeping the core package timer-free.
- - **Malware-scan Container:** the `*/20` warm-poke cron is disabled while no firms are onboarded. With
  no scan traffic it kept a `standard-1` instance resident around the clock (4 GiB memory billed
  continuously, ~$26/mo) for no benefit; the container now reaches its 30-minute `sleepAfter` and scales
  to zero, billing only while an actual scan runs. The daily signature-refresh rebuild is unchanged, and
  the poke handler stays wired so re-arming it at first-firm onboarding is a one-line cron add.
- **`STATUS.md` is now a build output assembled from per-slice fragments.** Each slice's stage status lives in its own `status.d/<slice>.md` fragment (flat frontmatter + a one-line note); `vp run status-build` renders both `STATUS.md` (the familiar per-phase matrix) and `STATUS.json` (a machine-readable index carrying each slice's stages plus dev fields — next action, branch, spec/plan/ADR links). Branches edit only their own slice's fragment, so parallel worktrees never collide on the tracker, and generated tables are width-independent so a note edit no longer re-pads every row. Validated by `pnpm run lint:status`; the fragment set mirrors the `changelog.d/` → `CHANGELOG.md` pattern but persists rather than being consumed.
- **Status page — a 90-day uptime record, and upstream providers no longer speak for us.** The public status page now carries the record every status page in its genre carries: a per-component uptime bar covering the last 90 days, one tick per day colored by the worst status observed, beside the component's own uptime percentage. Uptime is counted from the ten-minute health samples rather than summarized per day, so a brief incident costs only its true share of the figure and a day the platform never checked shows as no data rather than as a green day. Planned maintenance colors its day but never counts against uptime. The past-events archive now covers the same 90 days and accounts for the quiet remainder in a line rather than in empty rows.

Separately, an upstream provider's trouble no longer sets this platform's verdict. Previously, when Cloudflare reported degraded performance on its own status page, ours announced "Degraded performance on some services" about Magna Carta — with nothing of ours failing. The verdict is now computed only from our own components and our own declared events. A provider reporting a problem raises a distinct upstream advisory instead: its own surface, in neutral ink outside the severity family, naming whose status it reports and linking to the page that is authoritative for it. A declared service event now also colors the components it names, so a component row and the uptime bar beneath it can never disagree with the banner above them.
- **The status page is now served from an edge cache.** The public status page and its machine-readable feed are held at Cloudflare's edge for thirty seconds, so the traffic spike an incident brings is absorbed without invoking the status worker or reading its data store — the page's availability no longer depends on the availability of the one thing it reads. If that read starts failing, the edge keeps serving the last good page for up to ten minutes while retrying behind it, rather than immediately showing the bare "temporarily unavailable" stand-in. A newly published incident becomes visible within thirty seconds.
- **The type-check gate now runs incrementally and is enforced.** `pnpm check` type-checks via
`tsc -b` over the project-references graph (fast + incremental) instead of `vp check`'s whole-repo
type pass, which was too slow to complete and had been letting real type errors slip onto `main`.
`vp check` keeps fmt and lint (including type-aware lint rules); scope the type-aware pass to changed
files in the local loop. See [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md).
- **Email forward/CC capture now routes on a single zone-level catch-all with a control-plane token index, the only shape Cloudflare Email Routing actually supports.** The capture Email Worker (`apps/email-worker`) previously encoded the firm in a per-firm subdomain (`<token>@<firmId>.in.magnacarta.esq`) and resolved it against the control-plane `firm` table — but Cloudflare Email Routing offers exactly one zone-level catch-all, not per-subdomain wildcards, so that address shape could never have been provisioned. Capture addresses are now `<token>@in.magnacarta.esq`, a single opaque server-minted token in the local part, resolved to a firm against a new control-plane `email_capture_route` (token→firm) index — with the per-firm `email_capture_address` store resolving that same token to a candidate matter downstream in the consumer, exactly as before. A revoked token stops routing the instant its route row goes inactive, with no per-firm read. This aligns the worker with the accepted design's `<token>@in.magnacarta.esq` address form and makes the forward path provisionable; the `emails:manageCaptureAddresses` mint/rotate route that writes tokens into both stores remains the fast-follow (until it ships the index is empty and every capture address bounces). The authenticated `POST /api/v1/matters/{id}/emails` API entrance is unaffected.
- - **CI lint job now fails fast on a genuine type-aware deadlock.** The gate's type-aware `lint` job
  (oxlint + tsgolint) had no `timeout-minutes`, so a tsgolint deadlock or runaway would have run to
  GitHub Actions' 6-hour default before failing. Added `timeout-minutes: 45` — comfortably above the
  ~24-minute whole-repo tall pole, so normal runs are unaffected but a real hang fails visibly in
  minutes instead of burning the runner. (Diagnosed while investigating a slow local `apps/worker`
  type-aware run: it is CPU-bound, not deadlocked — the worker's type program spans ~32 packages, so
  it is simply the documented tall pole. The guard defends against a _future_ genuine deadlock.)
- The gate's affected-lint scoping no longer treats a `.github/` change as a global trigger. A workflow or action YAML edit (e.g. `gate.yml`) cannot move a type-aware lint result, so it no longer forces the ~24-minute whole-repo lint — a CI-config change now runs the fast scoped lint (or none) like any other non-lint-input change. A genuinely lintable JS/TS file under `.github/` (a JS-based action) still forces a whole-repo lint via the existing "lintable source outside any package" rule, so there is no soundness gap.
- - **The gate now runs the pass each trigger can uniquely contribute, instead of the same battery three
  times.** A pull request runs the full test battery with the type-aware lint scoped one hop deep; the
  push that merges it runs the whole-repo type-check and the **full** transitive lint closure and skips
  the test battery the pull request already ran on the identical tree; a new nightly schedule runs
  everything cold and unscoped; and a `merge_group` trigger is wired so enabling a merge queue gets full
  post-merge proof with no workflow change. The required `gate` status is unchanged — it still treats an
  intended skip as a pass and any failure or cancellation as a failure. Reasoning and the soundness
  argument for each tier: `docs/conventions/build-performance.md`.
- **Documentation and the rendered trackers no longer boot the code battery.** The `changes` job
  classified anything that was not markdown as code, so `STATUS.json` — regenerated by the per-merge
  docs-assembly commit — put every merge through the full code battery. `docs/**`, `changelog.d/**`,
  `status.d/**`, `roadmap.d/**` and `STATUS.json` are now non-code, with a file carrying a source
  extension kept in scope wherever it lives.
- **`tooling/affected-lint` takes a `--max-hops` bound** on the dependent walk (`1` = the changed
  packages plus their direct dependents; absent or `all` = the full transitive closure, unchanged
  default).
- **The gate caches the work it was repeating.** The workspace `node_modules` tree is cached on the
  exact lockfile hash, so the dozen-job fan-out stops paying a full link pass each time;
  `Swatinem/rust-cache` replaces the hand-rolled cargo caches (it also keys on the `rustc` version,
  which the old key did not — a toolchain bump could reuse artifacts built by the previous compiler);
  the container acceptance builds go through buildx with a per-container layer cache that outlives the
  runner; and the `typecheck` job persists its `.tsbuild` state so `tsc -b` is incremental in CI.
- **`test-worker` shards follow the diff** — two shards on a small change, four otherwise. `--shard=i/N`
  partitions the same file set for either count, so this trades wall-clock against each shard's fixed
  setup cost and never changes which tests run.
- **Conversion hops now resolve their engine per id, end to end.** The conversion queue consumer's
resolver seam passes each hop's engine id through (`resolveEnginePort` returns an `EngineResolver`
instead of one port for every hop), the service-binding adapter stamps `x-engine-id` on each request,
and the convert worker dispatches on that header to the executing Container — the raster Container
serves both raster interconversion and image-to-PDF; an engine id with no Container yet stays a typed
`engine-not-implemented` failure. This removes the single-engine assumption so the LibreOffice, email,
and FFmpeg engine Containers can each land as an additive dispatch entry with no orchestration change.
- - **The gate's lint hang guard is re-measured and raised — it had grown tight enough to fail honest
  runs.** The type-aware `lint` job was capped at `timeout-minutes: 45`, set when the whole-repo pass
  took ~24 minutes. Re-measured on today's tree, that pass takes **~45 minutes** (0 errors, ~820
  advisory warnings across ~1850 files, 4-core/16 GB box) — the repo has roughly doubled the tall pole
  as packages were added, so the cap had drifted from "comfortably above the honest time" to just
  under it, and the merge and scheduled tiers (the ones that pay the whole-repo pass) were at risk of
  being killed mid-run and reported as a red gate. Raised to 75 minutes, still far below GitHub's
  6-hour default, so a genuine tsgolint deadlock fails fast while an honest slow run completes. Pull
  requests are unaffected — they lint the affected packages plus one hop, which is seconds to minutes.
  Every place quoting the stale ~24-minute figure (`tooling/affected-lint`, the gate comments,
  [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md)) now carries the
  measured number and says to re-measure rather than trust it.
- **The lint ruleset's documented home matched the config again.** `docs/conventions/typescript.md`
  listed `eslint/no-await-in-loop` as off (it is on, as a `perf` warning) and called `correctness` a
  hard error in one paragraph while the next said it keeps its inherited advisory severity. Both are
  corrected against the live `vite.config.ts`, and `oxc/no-barrel-file` is now stated as the one rule
  set to error.
- **Document automation — registering a template asks before it rewrites, and remembers what you tell
it.** Three changes to how a `.docx` becomes a template.

**A document built from Word mail merge now registers.** It used to be refused until you asked for its
merge fields to be converted. Now it registers as authored, and every Word merge field in it is
recorded against the template — its name, where in the document it sits, and **the text it will
actually print**, which is whatever Word last cached in the field. The field list shows them, and
every document you assemble from that template reports them again and completes as needing review, so
a field printing text left over from the template is visible in the same place a missing value is
rather than looking finished. Converting is still opt-in, and still the way to make those fields fill
in.

**Macros are now removed only when you ask.** Before, a macro project was stripped out of any upload
that had one. Removing it changes the document you sent us, so it is now a choice you make:
`stripMacros` on the registration request removes the macro project and re-checks the result from
scratch, and an upload carrying macros without it is refused with what was found and both ways
through — ask for the removal, or upload a macro-free copy. A template is never stored carrying live
macros, and never quietly rewritten.

**Your firm's merge-field names are remembered between imports.** Confirming what a Word field name
means — by converting a template that uses it — records the mapping, and every later registration
consults it, so importing a second document from the same source arrives already mapped instead of
asking again. Nothing is ever mapped by guessing: a name your firm has not confirmed is reported as
unmapped. The library is visible and editable at `GET /api/v1/merge-field-mappings` and
`DELETE /api/v1/merge-field-mappings/{mappingId}`, both under **manage templates**.

An assembly's status now carries `frozenMergeFieldNames` beside `absentFieldKeys`, and the
registration response carries `unconvertedMergeFields`, `confirmedFieldMappings`, and `macrosStripped`.
- **The template expression ceiling grows to computed expressions — design only, no code in this
change.** Document automation's conditional and repeating blocks were designed against a deliberately
narrow expression ceiling: presence, negation, and equality against a literal. On an owner decision
that ceiling now grows to **computed expressions** — arithmetic over money and numbers, date math,
comparisons, and a fixed catalog of formatting, pluralization, ordinal, and case helpers — plus a new
computed-field placeholder, so a fee agreement can state a cap, a settlement statement can split a
recovery, and a notice can compute a deadline thirty days out without anyone reaching for a
calculator and typing the answer in.

**The line that does not move: an expression is never executable template-supplied code.** Not code
we sandbox, not code we lint — code the grammar cannot express. There is no production for a function
definition, a property access, an index, an assignment, a lambda, a regular expression, a template
include, or a call to anything but an allowlist compiled into our own source. A merge key such as
`matter.number` is **one atom, not a traversal**: names resolve by exact match through a `Map`, so
`__proto__.constructor` is a missing merge field reported at registration rather than a reachable
prototype chain. That is the structural difference from the templating libraries that evaluate
JavaScript expressions from template content, whose sandboxes are denylists over a language that can
express everything and have failed twice as such.

**Termination is structural rather than a timeout.** No loop, no recursion, no self-reference, no
includes; a finite tree of bounded depth walked once; the only variadic-cost construct is `{{#each}}`,
which iterates a finite list of the firm's own data under a cap. Expressions do not iterate — the
document construct does.

**Money stays integer-exact, and division is not an operator.** No floating point anywhere in the
evaluator, no currency conversion, and mixed currencies refuse by name. `/` has no production at all;
in its place are three helpers whose rounding is explicit — `divideExact` (the exact quotient or a
refusal), `divideRounded` / `applyRate` / `percentOf` (**banker's rounding, half to even**, through
the money package's existing ledger rounding), and `allocate` (parts that sum exactly to the input).
Date math runs over calendar dates in the **matter's office** time zone through the existing
time-zone seam; there is no instant type and therefore no time-of-day arithmetic, and no business-day
or court-deadline helper ships, because that needs a maintained per-jurisdiction holiday calendar and
a wrong answer is a missed filing.

**Type errors are registration errors, with a location.** Expressions are lexed, parsed, name-
resolved, type-checked, and limit-checked when the template version registers, and a failure carries
the part, the paragraph, and the character offset to the field inspector — never an assembly
surprise. An unresolved **condition** fails the assembly by default (a wrong branch is invisible;
nobody reads a contract and notices the paragraph that is not there) while an unresolved **computed
field** renders a visible placeholder, and `has(...)` is the one-word total form for an author who
genuinely means "omit it when we have nothing on file".

The build slice is resequenced accordingly — grammar, evaluator, conditionals, repeats, computed
fields, each independently testable, with the first two touching no document at all so the language
is proven correct before it meets an OOXML package. The security claim carries a standing fuzzing
obligation: structure-aware and byte-level generation, a committed hostile-input corpus that must
fail at parse or check rather than at evaluation, an arithmetic oracle, and one test per resource
bound.

Design: `docs/specs/2026-08-04-template-expression-language-design.md`. Plan:
`docs/specs/2026-08-04-document-automation-implementation-plan.md`.
- **A raw-bytes request body can no longer be paired with the required-idempotency gate — the platform
refuses the combination rather than trusting anyone to remember.** The gate fingerprints a request by
reading its body through a cache that decodes it as text, so bytes that are not valid UTF-8 do not
survive the round trip: an emailed `.msg`, an image, or any other binary upload would reach the handler
with every invalid sequence replaced, and a route that stored it as the firm's verbatim original would
store a corrupted copy that matches nothing. Every route on the API was audited for the pairing and
none had it — all 105 operations that require an idempotency key carry a JSON body or no body at all,
and all ten that take raw bytes already honour the key in their own handler, against the bytes they
actually received. What is new is that the hazard is now unreachable: a route declaring both fails at
startup with the reason and the supported alternative named, and two contract checks in the build back
that up — one over the published API description, one over the route sources, so a route that reads a
body raw without declaring one is covered too.

**The document-automation volume profile.** The synthetic-data harness now models a firm's template
catalogue — templates with their version history and archived tail, the confirmed field-name mapping
library, the assembly records filed documents leave behind, and a matter carrying a full party list and
a full set of the firm's own fields. Four operations are measured against it: listing the catalogue
part-way through, resolving a template's current version, building a whole merge context for the widest
template a firm's field set can produce, and reading the field catalogue the merge fields are derived
from. Every one of them reads through an index at volume, and the merge context is the measurement that
holds the line that matters: filling in a document costs the same number of database reads whether the
template has two merge fields or a hundred.
- Search — the index scope key widened from a matter to a **corpus**, while it is still free to do so.
A search index is partitioned by something, one split belongs to that something, and a split's R2
object key is **derived** from it rather than stored — so the scope key is the one part of the index
that cannot be renamed later without rewriting every object in every firm's bucket and migrating the
catalog that names them. The engine is dormant, no split has ever been published, and today the
partition happens to be a matter; the moment a firm has a live index, changing what it is becomes a
migration. So it changed now, at the cost of a type and a derivation.

A **corpus** is a discriminated union with exactly one member today — a matter — and the mapping is the
identity: a matter's corpus is that matter. `SearchIndexPort`'s `index`, `remove`, and `query` take a
corpus instead of a matter identifier, the split key derivation takes a corpus, and the write pipeline
resolves the corpus once and threads it. Nothing gained a review-set concept, a table, or a column.

**Every key that exists today is byte-identical, and that is the deliverable.** The derived key stays
`search/<corpusId>/splits/<splitId>.split`, because a corpus identifier is a self-describing handle
(`matter_…`) and adding a separate kind segment would have bought nothing while changing every key
that has ever been published — the exact outcome this change exists to prevent. The literal keys and
prefix are now pinned in a fixture, so the compatibility contract with the objects in a firm's bucket
is a test rather than an intention.

Two things stayed matter-shaped on purpose, both cheap to widen whenever a second corpus kind arrives
and neither of them derived from: the `index_split` catalog column, whose widening is a per-firm
schema migration this change is defined not to need, and the queue message, so a message enqueued
before a deploy is still readable after one. Where the catalog and a corpus meet, the compiler is the
guard — the enumeration a query runs stops type-checking the moment a corpus can be something other
than a matter, which names the one place that has to widen with it.
- **The gate's type-aware lint now scopes by measured cost instead of by graph distance, cutting the
single most expensive job out of the pull-request tier.** On a measured pull-request gate run
(2026-08-05, 17 jobs) the `lint` job billed **26 minutes of roughly 60 for the whole run — 43% of the
bill** — and it did so at the _cheap_ scoped tier, because the scope was correct and it contained
`apps/worker`.

The cause is the dependency shape. The type-aware linter builds its type program from the passed
files' import closure, so a package's lint cost tracks the size of that program; `apps/worker`'s is
**1,261 of the repository's 1,669 lintable files (75.6%)**, and the worker depends _directly_ on 39 of
the 61 workspace packages, so almost any foundational change pulled it in. The old lever — capping the
pull-request tier's dependent walk at one hop — could not help, because the expensive package sits one
hop from nearly everything.

`tooling/affected-lint` now measures that cost directly. A package is a **fan-out sink** when its
type-program weight is at least half the workspace's lintable files; on a pull request the classifier
drops the sinks from the scope **when they are in scope only as a dependent**, and every other trigger
lints them. A sink the change itself touched is never deferred, so an author's own code is always
linted on their own pull request. Every trigger now walks the full transitive dependent closure, so the
pull-request tier also gained coverage everywhere linting is cheap: a change to `@magna-carta/trust`
used to lint 2 packages one hop out, and now lints its whole closure.

Because a scope that is too narrow reports a fast green rather than a failure, the union is proved
rather than reviewed. A new `pnpm run lint:affected-scope`
(`tooling/affected-lint/scope-fitness.mjs`, wired into the gate's `governance` job) simulates a change
to **every** workspace package and fails if the changed package is not linted on its own pull request,
if the pull-request and post-merge scopes together miss any package in the true dependent closure, or
if anything but a declared sink is dropped. It derives that closure by an independent fixpoint over the
same package graph the classifier reads, and it also fails if the sink rule ever stops selecting an
outlier — no sink at all, more than two, or one weighing under 1.5x the heaviest non-sink — which is
the signal to delete the deferral rather than widen it.

Measured on a 4-core/15 GB box for a change to `@magna-carta/identifiers`: the new 28-package
pull-request scope lints 883 files in **9 seconds**, where `apps/worker` alone lints 394 files in
**2,755 seconds**. The cost model, the timings, and the two refinements measured and rejected on the
way — file-granular scoping and content-hash caching — are in `docs/conventions/build-performance.md`.
- **A trust jurisdiction can now fail in four distinguishable ways.** No state recorded on the
  account's office; no rules encoded for that state; rules encoded but not attorney-reviewed; and a
  reviewed state with one field nobody researched. Each is fixed by a different person doing a
  different thing — recording an office's state, researching a jurisdiction, having a lawyer review
  one, researching the field that was missed — so each says which it is rather than collapsing into a
  single "unavailable".
- **The gate's short jobs run on GitHub's 1-vCPU Linux runner.** `changes`, `format`, `governance`,
`contracts`, both `test-node` shards and the `gate` roll-up moved from `ubuntu-latest` to
`ubuntu-slim` — 1 vCPU / 5 GB at $0.002 a minute against the 2-core runner's $0.006, a third of the
rate for identical work. Each of those jobs measured two minutes or less and none is meaningfully
parallel; the per-job comments in `.github/workflows/gate.yml` record the measurement behind each
choice. `lint`, `typecheck`, `test-worker`, `test-stories`, `rust`, `containers` and `wasm` stay on
the 2-core runner: they either want the cores, exceed the slim runner's hard 15-minute job cap, need
more than 5 GB, or need a Docker daemon the slim runner's unprivileged container does not provide.
Nothing about what the gate checks changes.
- Review campaign 2, operational area — an adversarial read-only pass over the custody register's
operational half (stocktake, gated release, labels, reports, reviews and reminders, the destruction
workflow, the Nevada will-deposit catalog), the case calendar's recorded model and thirteen-source
federation, the matter-close advisory, and the worker routes and data-access statements over all of
it. Findings are recorded in
[`docs/reviews/2026-08-06-campaign-2-operational.md`](docs/reviews/2026-08-06-campaign-2-operational.md):
one high, six medium, seven low. No code was changed.

The one that matters most: **a two-signatory custody release is composable into one person.** Both
signatory identifiers arrive in the request body, and the only checks — at the service and at the
trigger — are that a witness is present when the firm's policy asks for one and that the two
identifiers differ. Neither is tied to the authenticated actor and neither is validated against the
firm's members, so one member can record a witnessed release of an original on an append-only ledger
that then permanently asserts two people signed. The destruction workflow's requester/approver split
is the contrast: it is genuinely two authenticated requests, and it is what the release gate should
look like.

The rest cluster into three themes. **Guards that live in one caller rather than at the database:**
the deadline edit path is the only statement in its file without the `state = 'open'` guard riding
the write, and a closed stocktake is frozen only by the absence of a re-open statement while its
sighting table carries four triggers. **A federated read that quietly disagrees with the register it
claims to be:** three custody-derived timeline sources drop the packet- and item-status predicates
the custodian's own reminder reads carry and document, so the calendar shows due-backs for originals
that came back and review dates for wills the firm has released or destroyed. **Approximations
presented as answers:** the stocktake reconciliation truncates at ten thousand rows in the direction
that drops the corrective sightings, then freezes those counts as the number a firm reports; the
deadline list's `overdue=true` filter is a UTC-date comparison with no per-row zone check behind it.

The review also records what was checked and holds — the stocktake's observe-only boundary, the
intrinsic-value refusal's three independent enforcement points, the advisory's inability to block or
leak, the visibility predicate's structural composition into every timeline source, the mixed
civil-date/instant cursor's correctness in both directions, the audit-log allowlist, and redaction
across both packages — so the next pass does not re-derive it.
- **CI cadence temporarily reduced while the GitHub Actions budget is exhausted.** The gate's nightly
whole-repo sweep, its push-to-`main` run, and its whole-repo lint tier are suspended; the pull-request
tier still runs the full battery (format, type-check, rust, the whole test suite, governance, contracts,
containers) with the type-aware lint scoped to the changed packages plus one hop, and the per-merge docs
assembly keeps running. During the window the merge bar is full local verification by the agent
(whole-repo `pnpm check` plus `vp test`, stated in the pull request) plus orchestrator review. Every
suspended site carries the marker `TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions minutes
reset`, and the revert checklist is in `docs/conventions/build-performance.md`.
- **Trust authorization is now about who a person is, not how many people there are.** A member
holding the authority to act on client money releases a payment out of a client trust ledger — or
takes earned fees against a finalized bill — on their own, in one act; a member without it raises
the same payment and it waits for somebody who has. Every firm now starts on that posture, written
into its own history as version 1 with a date, rather than carrying it as an unwritten default. A
firm that wants a ceiling above which two people are required still writes that change the same way
it always would, and above the ceiling the authority requirement binds whichever of the two releases
the money.

**A member who cannot release a payment is told who can, before they try.** Both ways money leaves a
client ledger now work out the firm's posture first and either make the payment or send it for
approval, instead of refusing the member and leaving them to work out why. Nothing about what the
platform will accept changed — the same checks refuse the same things — but an ordinary outcome no
longer wears the face of a mistake.

**A payment somebody may make alone is now one step, not two.** Proposing and releasing happen in a
single act that either fully succeeds or leaves the ledger untouched, so a payment can no longer sit
briefly waiting where another member could approve it as a two-person payment nobody asked for.

A payment already waiting for a decision keeps the rules it was submitted under, in both directions,
exactly as before, and the sole-authorizer exception still belongs strictly to the firm's one member
who holds the capability it counts.
- **Paying money out of a client's trust ledger now takes two people.** A disbursement is proposed
first and paid second: one member writes down the payee, the amount, the method, and why, and a
different member approves it before anything reaches the ledger. Until that approval, nothing has
happened — no entry, no balance change, no client-ledger record — so a request that is refused,
withdrawn, or simply never answered leaves the ledger exactly as it found it. The client ledger then
shows both people: the member who wrote the record, and the member who authorized the payment.

**The approval is measured against the money that is there when it is given, not when it was asked
for.** A request written while the ledger held enough and approved after the funds went elsewhere —
or after part of them came under a disputed-funds hold — is refused, naming the amount asked for,
what is actually available, and the held portion that explains the difference. Two members approving
the same request at the same moment produce one payment, never two.

**A refusal is a record, not a disappearance.** Rejecting a request asks for a reason and keeps it,
alongside who refused it and when. The member who submitted a request can withdraw it; anyone else
records a rejection instead. None of it can be edited or deleted afterwards, exactly like the
movements it sits beside.

**A firm with only one person who can authorize trust payments can still pay.** In that case the
submitter approves their own request and the record says so in as many words, so nobody later has to
work it out by noticing that two names match. The moment the firm has a second member who can
authorize trust payments, that path closes on its own — there is no setting to leave switched on.

The disbursement endpoint is replaced by the request-and-approval pair, so any client calling it
directly moves to the new pair.
- The TypeScript standard-library level every package compiles against moved from ES2022 to ES2023.
Nothing about the running product changes — this setting only tells the compiler which built-in
methods exist, and the emitted code is byte-for-byte what it was.

It matters because the old setting had started producing real breakage. The repository's own
autofixer rewrites `array.sort()` into the safer non-mutating `array.toSorted()`, which is exactly
the right change to make; but `toSorted` is an ES2023 method, so in a package pinned to ES2022 the
compiler then rejected the very code the linter had just written. The workaround was to remember not
to let the autofixer run in most of the repository, and to undo it by hand where it had. Thirteen
such rewrites had already slipped through, leaving the main branch unable to typecheck.

The pin was the anachronism, not the methods. This project requires Node 22 and runs on a Cloudflare
runtime dated mid-2026; both have supported these methods for years. Raising the level fixes the
thirteen sites at a stroke, and turns the autofixer from something to be worked around into something
that can simply be trusted.

### Security

- **Post-quantum cryptographic posture** (white paper _Encryption and key management_ → _Post-quantum posture_, `security.md`, ADR-0046): an agility-first readiness stance — the symmetric corpus (AES-256) is already quantum-resistant and needs no migration; harvest-now-decrypt-later on data in transit is met by Cloudflare's hybrid X25519MLKEM768 TLS; public-key signatures (passkeys, the PAdES e-signature seal) are seamed but deferred to upstream standards (ML-DSA/SLH-DSA). Mandates AES-256 everywhere, SHA-384 where free, algorithm-versioned ciphertext/signatures, and symmetric-preferred primitives.
- **Upgraded `hono` 4.12.23 → 4.12.27 (catalog).** Closes five upstream advisories in the API framework, including a high-severity one where the CORS middleware reflects any `Origin` with credentials when `origin` defaults to the wildcard, plus a `serve-static` path-traversal on Windows via encoded backslash. The Worker does not use the CORS or `serve-static` middleware, so this is a proactive bump with no behavior change. (`pnpm-workspace.yaml`, `apps/worker`, `packages/data-access`)
- **Cleared twelve HIGH osv-scanner advisories by upgrading their dependency carriers to patched versions.** The CI dependency-audit gate began failing after advisory-database drift surfaced twelve HIGH (CVSS ≥ 7) npm advisories across eight transitive/direct carriers — `better-auth`, `fast-xml-parser`, `postcss`, `undici`, `sharp`, `js-yaml`, `fast-uri`, and `brace-expansion`. Rather than accept them, each carrier was pinned forward to the version that fixes its advisory: `better-auth` 1.6.16 → 1.6.22 (catalog) and `fast-xml-parser` → ^5.10.1 (direct), with the rest pinned through the pnpm-workspace `overrides` block alongside the existing Vite+ aliases (`postcss` 8.5.18, `undici` 7.29.0, `sharp` 0.35.0, `js-yaml` 3.15.0/4.3.0, `fast-uri` 3.1.5, `brace-expansion` 1.1.18). The `better-auth` upgrade also required adopting its new `twoFactor` brute-force lockout fields (`failed_verification_count`, `locked_until`) into the control-plane schema via an additive migration, so the two-factor enable/verify flow stays green. The osv-scanner gate now reports zero HIGH/CRITICAL npm advisories.
- Hardened and consolidated the dependency-audit setup around the osv-scanner CI gate. The gate now pins the osv-scanner binary by SHA256 (verified against the release's published checksum before it runs, failing closed on any mismatch) so a swapped or compromised release asset can't execute. The pre-push git hook's local `pnpm audit` step is removed — it covered only npm, depended on npm's retiring audit endpoint, and duplicated the authoritative CI gate that now audits both the npm and Rust supply chains — and the `package.json` `pnpm.auditConfig` it read is dropped. `osv-scanner.toml` is now the single home for accepted advisories.
- CI dependency-audit gate migrated to osv-scanner, now covering the Rust supply chain alongside npm. The gate previously ran npm-only `pnpm audit`; it now runs osv-scanner (v2.4.0) over the npm lockfile and every first-party `Cargo.lock` (`crates/` + `containers/`) against the OSV database (GHSA + RUSTSEC), failing on any HIGH/CRITICAL (CVSS >= 7.0) and failing closed on a scan error. This immediately surfaced four real high-severity advisories the npm-only audit could never see — including a stack-overflow DoS (`RUSTSEC-2026-0187`, lopdf) on the untrusted-PDF-parsing path — now accepted with cause and a time-boxed `ignoreUntil` in `osv-scanner.toml` and tracked for remediation by carrier upgrades. The pre-push hook still runs `pnpm audit` for fast local feedback (migrating it is a follow-up).
- **Refreshed the npm dependency catalog and recorded verified remediation verdicts for the advisories the
audit gate still accepts.** `hono` moved 4.12.27 → 4.13.0, which crosses 4.12.34 — the release that fixed
four security defects reachable from a Worker: cross-request data disclosure in JSX, a whitespace-tolerant
CORS origin regex (ReDoS), an algorithmic-complexity denial of service in the Language middleware, and
response-header leakage in the proxy helper. Alongside it, `@hono/zod-openapi` 1.4.0 → 1.5.1,
`@tanstack/svelte-query` 6.1.34 → 6.1.38, `@internationalized/date` 3.12.2 → 3.12.3, `@lucide/svelte`
1.17.0 → 1.28.0, `@cloudflare/speedtest` 1.11.0 → 1.13.0, the three self-hosted font packages → 5.3.0, and
the dev tooling `@faker-js/faker` 10.5.0, `@types/node` 26.1.2, `@stoplight/spectral-cli` 6.16.3,
`@stoplight/prism-cli` 5.16.0, and `happy-dom` 20.11.1.

The accepted-advisory list in `osv-scanner.toml` also lost a dead entry and gained real verdicts.
`GHSA-gv7w-rqvm-qjhr` was removed: GitHub withdrew it on 2026-06-17 because the affected package was
misidentified — the flaw was in the esbuild Deno module, not the npm package — so the gate had been
carrying an ignore that matched nothing. The remaining tracked entries now record what was actually
checked rather than a bare "upgrade the carrier": the `quick-xml` advisories (RUSTSEC-2026-0194/0195) are
fixed in quick-xml 0.41.0 but reached only through `office-crypto`, which still requires `^0.38.4` as of
its newest release (0.3.0, published 2026-07-22), so no carrier upgrade can clear them; and the npm `uuid`
advisory (GHSA-w5hq-g745-h8pq) is fixed in uuid 11.1.1 but arrives through `postman-collection`, which
hard-pins uuid 8.3.2 through its newest release (5.3.1) — so an override, not an upgrade, is the only
remediation. Both entries keep their 2026-10-14 `ignoreUntil` forcing function.
- Upgraded lopdf to 0.42.0 across every first-party Rust workspace (`crates/` and the `scan`/`ocr`/`recovery`/`file-repair` containers), remediating RUSTSEC-2026-0187 — the stack-overflow denial-of-service in lopdf's PDF parser, on the untrusted-file path. The osv-scanner CI gate's accepted-advisory list drops that entry. The scan container's structural-PDF SIGABRT guards are retained as defense-in-depth. The three remaining tracked advisories (quick-xml x2, npm uuid) stay accepted with corrected, documented reasons: quick-xml is reachable only through office-crypto 0.2.0 (its latest release, which pins quick-xml 0.38, so it cannot be cleared without a newer office-crypto), and the npm uuid advisory is a transitive dev-tooling dependency of postman-collection with no production-runtime exploit path.
- **Telemetry's redact-by-default posture now holds on the counter path and against non-string values.**
The event allowlist was structural for field NAMES but not for field VALUES: a declared field typed
`FieldValue` could still be handed an object by any call site that reached the builder through `any`,
and `JSON.stringify` then wrote that object into the log line with every nested key intact — past the
allowlist, and past the scrubber, which only ever walked strings. Values are now forced back to a flat
primitive at the same boundary as the keys; anything else is replaced outright rather than serialised,
and the Workers logger raises a `telemetry.unloggable` counter naming the event and field so the call
site is visible instead of silent. As a side effect, a `bigint` or a symbol in a field can no longer
throw inside `JSON.stringify` and take the emit down with it.

`Logger.count()` was the other door, and it was unguarded end to end: free-form metric names and
free-form dimension values reached Analytics Engine with no allowlist, no scrub, and no tripwire — the
cheapest way to get privileged content into the dataset, and the one nothing would have caught. The
queue consumer's `costs.recovery.unhandled_topic` counter was already passing a value straight off a
queue message. Counters now go through a **metric catalog** (`@magna-carta/telemetry/metrics`), the
counter-side twin of the event catalog: each metric declares its ordered dimension keys, blobs are laid
out from that declaration, dimension values are scrubbed, and anything undeclared — a metric or a
dimension key — is dropped rather than guessed at, against a tripwire counter. A fitness scan over
every `apps/*/src` and `packages/*/src` fails a `count()` call site naming a metric the catalog does
not declare, or building a metric name by interpolation.

Declaring the dimension keys fixes a second, quieter problem: the Analytics Engine column contract used
to be whichever order each call site happened to write its object literal in. Reordering two keys in a
literal — an edit no reviewer would question — silently re-labelled every column of that metric in the
dataset. The layout is now one declared fact.

The scrub backstop also stopped missing the shapes people actually write. Its denylist caught an
unbroken run of nine or more digits, so a card number typed the way a payment form asks for it —
`4111 1111 1111 1111` — and any phone number at all passed through verbatim with the tripwire silent,
in `messageHead`, the one free-text field in the catalog and the one carrying a user's own words.
Separated 12-to-19-digit groups and phone numbers (dashes, dots, spaces, parenthesised area codes,
country codes) are now scrubbed and tripped.

Finally, the scrubber's minted-handle exemption no longer restates the token length and alphabet that
`@magna-carta/identifiers` owns; it and the package's own per-entity validators both build their
patterns from one exported fragment, so changing the token shape cannot leave a stale copy behind that
starts mangling Error IDs.
- **The uuid advisory is fixed rather than accepted.** `GHSA-w5hq-g745-h8pq` (missing buffer bounds
checks in uuid's `v3`/`v5`/`v6` when the caller supplies an output buffer) reached the tree only
through the API-contract tooling — `@stoplight/prism-cli` and `@stoplight/spectral-cli` pull
`postman-collection`, which hard-pins uuid 8.3.2 through its newest release, so no carrier bump
cleared it. A `pnpm-workspace.yaml` override now forces uuid 11.1.1, the newest release that still
ships a CommonJS entry point (uuid 12+ is ESM-only, and `postman-collection` does
`require('uuid').v4()`). Its accepted-advisory entry is gone from `osv-scanner.toml` rather than
carried to a later date.

**Password-protected Office uploads no longer scale an attacker's cost.** `office-crypto` parses the
agile `EncryptionInfo` descriptor with quick-xml, and every quick-xml before 0.41 scans a start tag's
attributes for duplicate names in quadratic time (`RUSTSEC-2026-0194`) — so a crafted upload with one
enormous start tag could pin a CPU core for minutes. `office-crypto` 0.3, its newest release, still
requires `quick-xml ^0.38`, so the fixed parser cannot be resolved. `crates/decryption-core` now caps
the descriptor at 64 KiB before `office-crypto` sees the bytes, which bounds the scan to well under a
second and stops the cost scaling with the uploaded file — the same defensive-perimeter pattern as the
existing `EncryptedPackage` size-prefix guard.

**The remaining quick-xml acceptances say what was checked.** Both quick-xml entries in
`osv-scanner.toml` were re-checked before their 2026-10-14 lapse and extended to 2027-02-14 with the
reachability analysis written into the file: `RUSTSEC-2026-0194` is reachable but now bounded, and
`RUSTSEC-2026-0195` is not reachable at all — it affects only quick-xml's `NsReader`, and
`office-crypto` builds a plain `Reader` that never resolves namespaces.

**The operations runbook stopped duplicating the advisory list.** Its dependency-audit section still
described the retired `pnpm audit` gate and restated two accepted advisories, one of which GitHub had
withdrawn. It now points at `osv-scanner.toml` as the single home and records the working rules for
adding, extending, and pruning entries.

**PDF handling picks up upstream decompression-bomb guards.** lopdf moved 0.42 to 0.44 across all six
lockfiles, adding bounded stream decompression, a `LoadOptions.max_decompressed_size` limit for
load-time object and cross-reference streams, and a fix that rejects incremental saves of encrypted
documents. `Document::get_page_content` is infallible in 0.44, so its five call sites in
`crates/pdf-core` dropped their `Result` handling.
- **The `office-crypto` dependency is gone; `decryption-core` decrypts Office documents itself.**
`crates/decryption-core` already owned the ECMA-376 agile verifier, the iterative password hash,
block-key derivation, its own descriptor parser, and the compound-file validation. The only thing
`office-crypto` still did was the package decryption loop, which is now implemented in-house:
MS-OFFCRYPTO agile encryption's 4096-byte segments, each an independent AES-CBC chain under an
initialization vector derived from the `keyData` salt and the segment index, plus the session-key
unwrap that precedes them. ECMA-376 **standard** encryption (Office 2007 — AES-ECB under a
SHA-1-derived key) is ported alongside it, so no document that opened before stops opening; its
legacy RC4 CryptoAPI variant is refused by name, exactly as it was before.

**This removes both quick-xml advisories from the tree rather than accepting them for another
review cycle.** `office-crypto` was quick-xml's only consumer in every audited lockfile, and no
`office-crypto` release resolves the fixed quick-xml 0.41, so replacing it was the only remediation
that existed — the exit the accepted-advisory entries themselves named. `RUSTSEC-2026-0194` and
`RUSTSEC-2026-0195` leave `osv-scanner.toml`, which now holds no accepted Rust advisory at all.
Sixteen crates leave the dependency graph (`office-crypto`, `quick-xml`, `base64`, `bytemuck`,
`derivative`, `ecb`, `packed_struct` and its codegen, `bitvec` and friends, `serde`, `syn` 1.x);
none are added — the in-house loop is built on the RustCrypto primitives already in the workspace.

**Three panic paths on untrusted input close with it.** `office-crypto` computed
`total_size - 4096` as unsigned arithmetic with no bounds check, unwrapped its XML reader outright
on a malformed descriptor, and read `spinCount` from an uploaded document with no cap — so a
crafted file could crash the process or pin a core for hours. The in-house path is checked
throughout: the size prefix is read as the 64-bit quantity it is and converted rather than cast (a
32-bit concern on the wasm32 target), a prefix promising more plaintext than there is ciphertext is
refused before a segment is decrypted, and the spin-count cap that guarded hash extraction now
guards decryption too. Every guard that already existed is kept.

**A wrong password is now refused by the ECMA-376 verifier rather than inferred.** Both schemes
carry a password verifier and both are checked before any package byte is decrypted, so a wrong
password costs one key derivation instead of a full decryption, and a genuinely corrupt document is
reported as malformed rather than as a bad password.
- Dependency audit — three new HIGH advisories are remediated by version, not accepted. `quick-xml`
moves 0.38 to 0.41 in `crates/discovery-core`, the discovery engine's OOXML and OpenDocument text
walk. 0.41.0 is the release that fixes both RUSTSEC-2026-0194, where the start-tag
duplicate-attribute check cost `O(N²)` byte comparisons so a single crafted tag could pin a core for
minutes, and RUSTSEC-2026-0195, where namespace resolution allocated one binding per `xmlns`
declaration with no upper bound, inside the reader and before the consumer ever saw the event. The
first is directly reachable here: the spreadsheet walk iterates a cell's attributes, and this
engine's whole input is files an opposing party chose. `js-yaml` moves to the 3.15.1 and 4.3.1
backports for GHSA-5p4m-2wfm-xmqj, whose `!!omap` key-uniqueness check is quadratic on the default
schema, so a plain `load` of untrusted YAML blocks the event loop for the whole document. The
earlier quick-xml acceptance is not re-opened — it left this repository when its carrier was
replaced, and the carrier today is a different one that arrived with the discovery core. There is
still no accepted Rust advisory.

### Added

- Documentation foundation: reorganized white paper (Parts + stable section numbering), Decision Log with the ADR standard and stable IDs, root `CLAUDE.md` (golden rules + orientation), `docs/conventions/` standards, `docs/specs/` scaffold, and `docs/user/` end-user & admin scaffold.
- Living trackers and a documentation standard: this changelog, the living [`ROADMAP.md`](ROADMAP.md), a definition-of-"done" documentation process (`docs/conventions/documentation.md`), and a shared writing language — change types, commit/changelog style, and a canonical glossary (`docs/conventions/documentation-style.md`).

### Removed

- Swept **64 stale stream notes** out of the active-work registry, leaving the streams that are genuinely
in flight. The registry exists so a starting stream can see what else is running and where it would
collide; at 64 entries — nearly all of them describing work that merged days or weeks earlier — it had
stopped answering that question, because a reader could no longer tell the live entries from the dead
ones. What remains is four notes: the orchestrator stream, this sweep, and two older streams that never
opened a pull request and still carry unmerged commits.

Merged-ness was established from the **merged-pull-request record**, matching each note's filename to
the head branch of the pull request that landed it, and corroborated against the files each note said it
would create. The obvious test — asking git whether a remote branch is an ancestor of `main` — is
misleading in this repository: pull requests are squash-merged and the git proxy refuses ref deletions,
so branches for long-landed work sit permanently ahead of `main`. Two notes whose streams left unmerged
commits and no pull request were kept on the principle that a stale note is untidy while a deleted note
for live work destroys the only record of what a stream was doing.

Each deletion is paired with its `status.d/<slice>.md` fragment flipped back to `branch: main` and an
empty `active-work:`, so nine slice fragments no longer point at notes that are gone — the pairing the
status fitness function enforces.

This also settles a **naming inconsistency** the docs-sync reports had flagged three runs running. Notes
are named after the branch they describe, slashes included, so a `claude/<name>` branch belongs at
`docs/active-work/claude/<name>.md`; a flattened `claude-<name>.md` is invisible to the registry's
branch-to-note lookup and reads as "no note at all". Exactly one flattened note remained, and it
belonged to a merged stream, so the sweep removed it and the two naming conventions became one.
