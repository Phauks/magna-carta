# Magna Carta — White Paper

**Status:** Draft for review
**Last updated:** 2026-06-04
**Owner:** Trevor Goldsmith (chief worker)
**Domain:** magnacarta.esq

This white paper is the top-level design and decision record for Magna Carta, a legal practice-management platform. It locks the technology stack, infrastructure, security model, and feature map. Each subsystem named here will receive its own detailed spec → implementation plan → build cycle. Every decision below is recorded as an Architecture Decision Record (see the [Decision Log](./Decision-Log.md)) so future work never relitigates settled choices.

Sections are grouped into **Parts** for navigation. Cross-references use **section titles** (e.g. _Trust accounting_), not numbers — so inserting or reordering sections never breaks a reference. Decision identities live in the separate Decision Log.

---

## Technology stack (at a glance)

A consolidated index of the concrete languages, libraries, and services named in this paper — a reference, not the rationale (each is decided in its respective section).

- **Languages:** TypeScript (primary) · Rust (Tauri shell, Tantivy, the shared WASM+native core) · SQL (D1).
- **Cloudflare platform:** Workers (API + static-asset hosting) · D1 (control-plane + per-firm) · R2 (per-firm) · Durable Objects · Queues · Vectorize · KV · Containers · Workers AI (transcription) · Workers Logs/Logpush + Analytics Engine.
- **Backend / API:** Hono · OpenAPI 3.1 code-as-contract · zod · Better Auth · CI spec tooling (Spectral, oasdiff, SDK-gen; a Prism mock server on demand, not as a dependency). **API library decided: `@hono/zod-openapi`** (`OpenAPIHono` + `createRoute`, Zod 4, OpenAPI 3.1 via `doc31`) with a **spec-first codegen** client (Hey API → typed client + Svelte Query v6; no Hono `hc` inference); oRPC/ts-rest/chanfana evaluated and rejected (ADR-0066; _API contract & route conventions_ spec).
- **Frontend:** Svelte 5 / SvelteKit (SPA, `adapter-cloudflare`) · Tailwind CSS v4 · `@magna-carta/design-system` on headless Bits UI · Storybook (catalog) · Lucide icons · DTCG design tokens via Terrazzo · Vidstack (media) · Web Workers · BroadcastChannel · service worker (app-shell).
- **Desktop:** Tauri 2.
- **Search:** Tantivy (full-text) · Vectorize (semantic).
- **Documents & media (Containers):** Collabora Online + WOPI · LibreOffice headless · libvips (ImageMagick fallback) · a pure-Rust audio/video transcode engine (no FFmpeg) · OCR pipeline.
- **Security & crypto:** Web Crypto (AES-KW, AES-GCM, HKDF, HMAC) · Argon2id · WebAuthn/passkeys · TOTP. **Crypto-agile, post-quantum-aware:** the symmetric corpus is AES-256 (already quantum-resistant); transport rides Cloudflare's hybrid PQC TLS; ciphertexts and signatures are algorithm-versioned for a later ML-KEM/ML-DSA rotation (see _Encryption and key management_; ADR-0046).
- **Toolchain:** **Vite+** (CLI **`vp`**; VoidZero's unified toolchain — manages the package manager (pnpm) and Node version, and is the single entry point for dev, build/pack, test, lint, format, type-check, and monorepo task running) · lint/format/TS type-check via **Oxlint** + **Oxfmt** + **tsgolint** (`vp check`; Prettier interim until Oxfmt is GA). tsgolint does not parse `.svelte`, so the SvelteKit app's `.svelte` source is type-checked by **svelte-check**; the full gate is `pnpm check` (= `vp check` + svelte-check). · rustfmt/clippy · Miniflare/Wrangler (local Workers dev).
- **Source control & CI/CD:** **GitHub** (repos, branch protection, PRs, review, issues) + **Cloudflare Workers Builds** — the integrated CI/CD that builds each Worker on push (`vp run build-all`) and **deploys to Cloudflare via Wrangler** (`wrangler deploy`). The quality gate (`pnpm check`), tests, and the OpenAPI spec toolchain run pre-push (locally and as a Workers Builds build step), not in a separate GitHub Actions pipeline.
- **Testing:** **Vite+ integrated testing** (unit + Svelte component behavior) · Playwright (e2e + visual-regression screenshots across every theme×mode; Argos CI the named upgrade) · Storybook (component catalog; stories double as behavior tests + axe checks) · faker + write-path fixtures.
- **Integrations / adapters:** Payments — Helcim (launch); Stripe/Dwolla/Adyen/Confido/Gravity Legal (swappable). Email — Gmail/Outlook (matter mail); Resend/Postmark/Mailgun or Cloudflare Email (transactional). Messaging & voice — Telnyx (launch: SMS/MMS/RCS + voice/telephony); Twilio/Bandwidth/Plivo (swappable). Transcription — Cloudflare Workers AI (Whisper / Deepgram Nova-3), in-house. Future plugins — QuickBooks, banks, Pirate Ship, Lexis, Westlaw/CoCounsel, PACER, password managers (Bitwarden, etc.).
- **Standards & formats:** OpenAPI 3.1 · W3C DTCG (tokens) · LEDES 1998B / XML 2.0–2.1 + UTBMS (e-billing) · ZIP64 (bulk export) · `.docx`.
- **Community/feedback (deferred):** leaning self-hosted **Fider** (open-source); alternatives UserJot / Featurebase; Canny rejected (per-tracked-user pricing).

---

## Part I — Foundations & Architecture

---

## 1. Vision and goals

Build legal software the firm controls — fast, reliable, and free of the failures of Clio (cost that scales painfully per license) and LEAP (chronic bugs, stagnant development). The firm is the sole user until the product is ready, but the system is designed from day one so additional firms can be onboarded as a multi-tenant SaaS. This is a **greenfield build** — no existing system to preserve, no live users, nothing legacy carried in — so development carries **no backward-compatibility burden** (_Guiding principles_ — _Greenfield_).

**Primary goals:**

- One coherent platform covering matters, contacts, time, trust, billing, costs, conflicts, discovery, custodian, document automation, and reports — plus the client-facing and operational tooling competitors ship.
- Speed everywhere; correctness where money and ethics are involved.
- Extensibility through a clean plugin system for third-party integrations.
- Diagnostics and observability treated as a first-class pillar, not an afterthought.
- Strong, enforceable development guidelines so AI-assisted and human work stays consistent.

---

## 2. Guiding principles

- **Confidentiality is structural, not procedural.** Client data isolation is enforced by architecture (separate databases and buckets per firm), not by remembering to filter queries.
- **Correctness through immutability.** All money movement and all sensitive actions are recorded on an append-only ledger / audit log. Nothing is mutated; corrections are new, balancing entries.
- **Diagnose without exfiltrating content.** Telemetry captures _what happened and where_ (actions, IDs, errors) — never privileged content.
- **Separable and improvable.** Integrations are isolated plugins behind typed interfaces; subsystems have clear boundaries.
- **Design for the superset, ship the subset.** Architect so future scale (more firms, larger discovery, more jurisdictions) is an evolution, not a rewrite.
- **Greenfield — no legacy, no live clients yet.** This is a clean build: **no legacy codebase, no backward-compatibility debt, and no production client data** to preserve while we develop. The firm is the sole, _future_ user and the platform is **pre-launch**, so until launch the schema, API, and data model may change **freely and destructively** — nothing deployed depends on them, so we always build the _right_ thing rather than a compatible patch. The forward-compatibility machinery the platform still builds — expand-contract fleet migrations (_Schema migration & the database fleet_), algorithm-versioned ciphertexts (_Encryption and key management_), API breaking-change detection (_Delivery model_) — is for the platform's **future** multi-tenant life, not a present constraint. The one legacy _input_ is the eventual one-time **LEAP data import** (_LEAP migration_): a deferred ETL that maps old data into the clean model and is **never allowed to shape the core architecture** — we conform the legacy data to the design, never the design to the legacy data.
- **The plan is the default, not a cage — evidence can change it, silence cannot.** The white paper, specs, and ADRs are the agreed plan, and we build to what we agreed. As implementation surfaces new information, we do what is genuinely best rather than follow a settled choice off a cliff — but a settled decision is changed _deliberately and visibly_, never silently: the change is raised to the other party and recorded as a superseding ADR (an accepted one is never quietly edited). The bias is toward what we agreed; the only escape hatch is evidence, made explicit — so the plan and the build never quietly diverge.
- **Performance is foundational.** Speed is designed in, not optimized in later: work runs in the right tier (edge vs. container vs. client vs. Rust core), nothing heavy blocks the request hot path or the UI main thread, and optimization follows measurement, not guesswork (_Performance & concurrency model_).
- **Web/desktop parity.** No feature is exclusive to one platform; the desktop only _accelerates_ shared features and adds OS integration. This directly fixes LEAP's fragmentation, where features existed in only one of the two clients.
- **No emojis. Lucide icons only.**
- **Docs change in the same commit as code.** Stale documentation is a bug.

---

## 3. Delivery model and application architecture

**Web-first, API-first.**

- **Backend:** Cloudflare **Workers** exposing a **REST API documented by OpenAPI 3.1**, built on **Hono**. The contract is **code-as-contract**: each endpoint is defined once with **zod**, deriving _both_ a typed TypeScript client _and_ an emitted OpenAPI 3.1 spec — no hand-maintained YAML, no drift. CI runs the full spec toolchain on the emitted spec: **Spectral** linting, **SDK generation** (for non-TS mobile and third-party plugin developers), and **oasdiff** breaking-change detection. A **Prism** mock server (frontend/mobile/third parties build before the backend exists) is run on demand from the snapshot rather than carried as a dependency: nothing in the repository ran it, and its Postman-collection layer pinned a faker release with an advisory no override could reach. The implementing library is **`@hono/zod-openapi`** (`OpenAPIHono` + `createRoute`), with the typed client produced by **spec-first codegen** (Hey API → Svelte Query v6) rather than Hono `hc` RPC inference — resolved in the _API contract & route conventions_ spec (ADR-0066, ADR-0067); oRPC, ts-rest, and chanfana were evaluated and rejected. Internal plugin↔core calls use **service bindings (native Worker RPC)**, separate from this public surface; Better Auth mounts as HTTP routes. (tRPC and GraphQL were rejected — tRPC is TS-only with no OpenAPI; GraphQL is overkill for this mostly-CRUD/workflow app.)
- **Frontend:** **Svelte 5 / SvelteKit in SPA mode** (`adapter-cloudflare`), served as **Workers static assets**. (Cloudflare Pages is legacy; new hosting is Workers with static assets.) The app is login-gated, so dropping SSR costs nothing and yields a cleaner, more testable client/server split — and SPA is what lets the _same bundle_ run inside Tauri (enabling local compute and offline), which SSR would forfeit. "SPA" is a delivery model (one bundle, client-side routing), **not** a single-view limit: the app has unlimited deep-linkable routes, and SvelteKit's automatic **per-route code-splitting** keeps it fast as it grows.
- **Multi-tab / multi-window by design:** legal work means many tabs open at once (matters, directory, documents side by side). Engineered for it: a **real, deep-linkable URL per view** (middle-click new tab, bookmark, "copy link to this matter"), **cross-tab state sync** via the **BroadcastChannel** API + the data-layer cache (an edit in one tab updates the others), and optional **pop-out windows** for documents/matters. Public surfaces (help center, public intake forms) are rendered separately (static/SSR) for SEO, so the login-gated app need not be SSR.
- **Desktop:** a **Tauri 2** shell reusing the same Svelte frontend, shipped **after the web MVP**, talking to the same Workers API. Tauri's Rust layer adds local accelerations and OS integration; the cloud remains the source of truth. Tauri 2 keeps a future iOS/Android path open from the same base.
- **Web/desktop parity (enforced).** Every feature is complete on the web; the desktop runs the _identical_ bundle + API and adds only _optional local accelerations and OS integrations that fall back to a server path on web_. **No feature is desktop-exclusive or web-exclusive** — the direct fix for LEAP's fragmentation — enforced structurally by the single bundle + single API + shared Rust core, not by discipline. The one unavoidable UX asymmetry is **direct _local_ scanner access** (the browser sandbox cannot reach a desktop-attached scanner): on web you upload a scan, on desktop you scan in-app — same outcome (a scanned document attached), different trigger. (Networked **copy-room MFP/copier** capture is a separate, larger problem — a _receiving/routing_ concern with a complete web path, not a device-access asymmetry — flagged in the note below the table.) Desktop enhancements, each with a complete web path:

  | Work                    | Web path (complete)                                                   | Desktop adds                                                                |
  | ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | Bulk file/folder ingest | Browser multi-file upload                                             | Drag a folder/drive; process in place, no upload                            |
  | OCR & extraction        | Server Container OCR via Queues                                       | On-device OCR — the **same engine + models**, run locally (faster, private) |
  | Search indexing         | Server Tantivy (Container)                                            | Local Tantivy index (instant over large local sets)                         |
  | Credentials / 2FA       | WebAuthn/passkeys in browser                                          | OS keychain (+ offline token persistence)                                   |
  | Save/open files         | Upload/download, File System Access API                               | Native filesystem, save anywhere                                            |
  | Notifications           | Web notifications                                                     | Native notifications, tray, shortcuts                                       |
  | Scanning                | Scan externally → upload; **MFP scan-to-email → ingest** (note below) | Desktop-attached scanner (TWAIN/eSCL) **+ on-LAN MFP bridge**               |
  | Offline                 | App-shell only (service worker)                                       | Robust offline + sync                                                       |

  Concrete desktop-only opportunities that surface **during** the web build — new accelerations for the table above, plus minor OS-only environmental readouts the browser sandbox cannot provide (e.g. the physical network medium, Wi‑Fi/Ethernet, which desktop can show and web cannot) — accumulate in [`docs/desktop-build-avenues.md`](desktop-build-avenues.md), to be picked up when the Tauri build begins.

> **Needs development — MFP/copier scan-to-matter (a fair bit of work).** The parity row above covers a _desktop-attached_ scanner; the firm's real scanning hardware is the shared **copy-room MFP** (Xerox/Canon/Ricoh/Konica Minolta/HP/Sharp/Lexmark/Kyocera), whose embedded app platforms (Canon **MEAP**, Xerox **EIP/ConnectKey**, Ricoh **ESA/SOP**, HP **OXP/Workpath**, Konica **OpenAPI/bEST**, Sharp **OSA**, Lexmark **eSF**, Kyocera **HyPAS**) are mutually incompatible, per-vendor firmware. The framing that shapes everything: **treat this as a _receiving + routing_ problem, not a device-access one — Magna Carta is a _destination_ speaking the protocols every MFP already supports (scan-to-email, scan-to-folder, eSCL/WSD), never an _app_ running on each vendor's panel.** Building on vendor firmware is **rejected up front** as an unbounded per-vendor integration tax (the LEAP-fragmentation failure mode). Likely its own subsystem spec.
>
> **Design from the get-go (a seam now is cheap; retrofitting is not):**
>
> - **A source-agnostic ingest/quarantine chokepoint.** A scan, a _Client portal_ upload, and an inbound email must converge on **one** incoming pipeline — staged → scan/`inlinePlayable` verdict (_Inline file preview_) → **staff-accept onto a matter** (the portal's upload-quarantine model, _Client portal_). Build that pipeline source-agnostic now so scan capture is a new _source_, not a parallel path.
> - **An inbound-capture + matter-routing model.** The platform has **no inbound-to-matter path today** (the _Communications layer_ email is outbound + logging only) — this is net-new. Decide the routing model as a seam: firm-wide intake queue → staff assign (v1), a **barcode/QR cover sheet** for vendor-agnostic auto-filing (the high-value path — intelligence in the page, not the firmware), and/or per-matter intake aliases. Receiving scan-to-email on Cloudflare via an **Email Worker** (PostalMime) reuses this directly; mind the **~25 MiB** Email Routing ceiling.
> - **A scan-capture plugin port.** Per ports-and-adapters (_Plugin / Add-on system_): one typed capture port so a Cloudflare Email Worker, a desktop **on-LAN bridge** (eSCL/WSD/hot-folder — _Delivery model_ parity), or a deferred single-vendor panel app each slot in as adapters with no core change.
> - **Parity-framing correction.** ADR-0023's "scanning = the one TWAIN-trigger asymmetry" is too narrow; revise it to **"MFP-receiving destination + desktop LAN bridge,"** which keeps a complete web path (scan-to-email) and so is _not_ a true platform asymmetry.
>
> **Deferred to the build:** per-vendor panel apps (optional, single dominant device only — never core); the barcode-routing implementation; the **large-scan fallback** for documents over the Email Worker ceiling (desktop bridge or a chunked/direct-upload path); and the desktop LAN-bridge protocol set (eSCL/WSD/SMB/WebDAV — note Workers are HTTP-inbound only, so SMB/FTP capture must terminate on the desktop or a WebDAV/HTTPS endpoint, never directly on a Worker).

- **Rust — definitive usage:**
  - _Definite:_ the **Tauri desktop shell** (Tauri's backend is Rust); the **Tantivy** search engine (server-side in a Container _and_ local on desktop, so search behaves identically); local desktop processing (bulk ingest, extraction, OCR orchestration, local indexing).
  - _Scoped shared core_ (write once → **WASM** for web/Workers, **native** for Tauri): the **document generation/merge engine** and **discovery extraction/parsing**. This shared core is what guarantees behavioral parity for compute-heavy features.
  - _Heaviest server work_ runs as **native Rust in Containers** (no Worker CPU/size limits), not WASM-in-Workers.
  - _TypeScript for everything else_ (API handlers, business logic, workflows, UI). Hot-path logic (conflicts matching, ledger math) moves to Rust→WASM only if profiling demands it. Automerge (Rust CRDT) only if native collaborative docs are added later.
- **Web caching:** a **service worker caches the app shell/assets only** — fast loads, **no client-data caching**, cleared on logout. The web app is **not** an installable PWA; **Tauri is the sole installable app**, avoiding any "which app am I running?" confusion.

Rationale: live collaboration, multi-firm rollout, and cloud-hosted files all favor web; the user's stated preference (cloud-hosted files, no local download to work) removed the main argument for desktop-first. API-first makes desktop and mobile near-free additional targets.

**URL & navigation architecture.** Every view has a **real, deep-linkable, permalink URL** (the multi-tab/pop-out requirement above). Underneath, every matter carries an **immutable opaque handle** that never changes and is always resolvable — the stable plumbing — but the **canonical, human-facing URL is the matter number by default** (`/matters/8181-3`): staff think in matter numbers, and a number reveals **no client identity** the way a party name/caption would (which is why name slugs are _not_ used). The scheme is **firm-configurable** (_Settings & configuration_): matter-number is the **default**, a firm may choose **opaque** for maximum confidentiality, and an individual **sealed/sensitive matter can be forced opaque** regardless of the firm default. Resolution is **firm-bound** — a matter number need only be unique within the firm (_Tenancy and data isolation_), so two firms may both have `8181-3` without collision.

- **Stability across renumbering.** Matter numbers can change (location-prefix moves, configurable schemes, LEAP-preserved numbers), so prior numbers are **kept as aliases that 301-redirect** to the current one, and the opaque handle underneath always resolves — a renumbered _or_ renamed matter **never breaks a saved link or a "copy link to this matter."** An **un-numbered matter** — an intake, or a consultation before it opens (the matter number is assigned at _Open_) — uses its opaque handle until it has one.
- **URL-safe numbers.** Because the number sits in the path, the matter-numbering configuration (_Matters and File Manager_) is constrained to **URL-safe characters** (digits, letters, `-`, `.`, `_`); a scheme that would emit a `/` or a space is rejected or percent-encoded.
- **Hosts (firm never in the URL).** `app.magnacarta.esq` (staff SPA) · `api.magnacarta.esq` (the public/SDK OpenAPI surface — **reserved**) · `portal.magnacarta.esq` (client portal, a _distinct external-principal_ auth surface — _Client portal_) · `magnacarta.esq`/`www` (marketing + help center + intake + the public product-updates pages — _Product updates_). The firm is resolved from the **session** (_Tenancy and data isolation_), never from the address — there is no firm segment to spoof. The first-party app calls a **same-origin `/api`** (cookie auth — httpOnly/Secure/SameSite + CSRF), while `api.magnacarta.esq` is **token-authenticated** for third parties (no cookies, no CSRF surface), keeping the two auth models separated by host. A **white-label custom-domain** seam (Cloudflare for SaaS, `app.firm.com` → firm) is shaped but deferred — hostname→firm is one indirection, so firm still comes from a lookup, not a trusted URL segment. Per-firm **vanity subdomains are rejected** (they reintroduce a mutable firm slug in the URL for branding that custom domains deliver better).
- **Path = addressable state; query = ephemeral refinement.** Which matter, which tab, which sub-record goes in the **path** (a link reproduces it); filters, sort, search text, pagination cursor, and calendar view/date go in the **query**. Canonical, **no trailing slash**.
- **Tabs nest; entities stay flat.** A parent's sub-_views_ (no identity of their own) nest — `/matters/8181-3/documents`, `/matters/8181-3/time`; an **entity with its own identity that can move** stays shallow at its own identifier — `/documents/{id}`, `/directory/{id}` — so re-filing a document changes only its breadcrumb, never its URL. Entities **without a human number stay opaque** (documents, Directory entities, calendar events); numbered records (matters, invoices) use their number. Rule: **the last identifier in a path is what resolves; earlier segments are advisory context** — a stale parent or a superseded number **301-redirects to canonical**.
- **Reserved route namespace.** Top-level host and path names are a **maintained reserved list** (`api`, `auth`, `portal`, `admin`, `settings`, `files`, `.well-known`, the feature roots, static-asset paths…), so feature routes never collide and any user-influenced segment (a matter number, a firm's public intake-form path, help-center articles) can't shadow a system route.
- **Access enforcement is server-side; the SPA guard is UX only.** Loading any deep link runs the same gate on every API request: **valid session → the user's firm → RBAC + ethical walls** (_Authentication, access control & encryption_). The SPA route guard only decides whether to render or bounce to `/login?return=…`; it is **never** the security boundary — the API is the sole data source, so the client never holds data it was not authorized to fetch. The consequences fall out cleanly: a **logged-out** request → **401** → login (then return-to); a matter **belonging to another firm** is simply **absent from your firm's database** (a separate D1 — _Tenancy and data isolation_) → **404**, with **no cross-database path to forget**; and unauthorized-but-existing resources (including an **ethical-walled** matter in your own firm) return **404, not 403**, so the response is **not an existence oracle**. Matter numbers are **enumerable by design, which grants nothing** — every request is gated regardless, so guessing a number only ever reveals _volume_ to someone already inside that firm, never a name and never access; a firm that must deny even that picks the opaque scheme (or force-opaque on the matter). Independently, **`Referrer-Policy: same-origin`** keeps any URL — number or opaque — from riding along to third-party links.

Example session (page headers carry the full caption the URL omits):

```
app.magnacarta.esq/matters/8181-3              # canonical (firm default): header "8181-3 · Smith v. Jones"
app.magnacarta.esq/matters/8181-3/documents    # the matter's File Manager (a sub-view -> nested)
app.magnacarta.esq/documents/Dn4Rb9Lp          # a document (no human number -> opaque, flat, re-file-safe)
app.magnacarta.esq/matters/8Kf3pQ2v            # a sealed matter forced opaque (or a firm that chose opaque)
app.magnacarta.esq/matters?status=open&sort=recent   # filters are ephemeral -> query
api.magnacarta.esq/v1/matters/8181-3           # public API (token auth); the app uses same-origin /api
portal.magnacarta.esq/shared/Gr7nQ2cb          # a PortalGrant, assurance-checked
```

**Client data & state architecture.** Client state splits **three ways, each with one owner**, so nothing is cached twice: **URL state** (which matter/tab, filters/sort) in the router (above); **server state** (cached API responses) in **TanStack Query** (`@tanstack/svelte-query` v6, Svelte 5 runes-native) — caching, deduplication, refetch-on-focus, **optimistic mutations with rollback** (surfacing the _Observability and diagnostics_ Error ID on failure), and structured invalidation, with query keys and typed hooks derived from the **code-as-contract** client (above); and **local/UI state** (form inputs, open panels, selections) in **Svelte 5 runes**. Cross-tab and pop-out-window coherence rides the **BroadcastChannel** sync (above) — a mutation broadcasts cache invalidations so every tab and window converges. **Realtime is deliberately minimal:** this is not a live-collaborative app at the data layer (the one live surface, document co-editing, is Collabora's own channel). Freshness is **refetch-on-focus + cross-tab broadcast**, plus **per-feature live channels** built on the **Durable-Object-per-job** primitive (_Performance & concurrency model_) only where genuinely needed — long-running **job progress** (conversion, OCR, discovery, export) and the cross-device **live timer** (_Time tracking_). A **global server-push layer is rejected for v1** and kept as a seam (extend the same DO-channel primitive to a per-matter/per-firm channel only if a real need appears). **Offline follows parity** (the _Delivery model_ table): the web cache is **in-memory only, cleared on logout** (consistent with the app-shell-only service worker), while **Tauri** adds a cache **persister + an outbound mutation queue** that syncs on reconnect, slotting in behind the same call sites. A full **local-first sync engine** (TanStack DB / Zero / Triplit) is **rejected as the default** — it fights the server-authoritative ledger and the per-firm-D1 model — and kept only as a seam. (ADR-0054)

---

## 4. Design system, UI consistency & design quality

Good UI here has two independent requirements, both **engineered rather than left to chance**: **consistency** — the app feels like one product, no drift between screens — and **design quality** — it is distinctive, legible, and genuinely usable, never the generic "assembled-by-AI" look. They are the two halves of not looking AI-made: consistency defeats _jumbled together_, quality defeats _generically AI-themed_. Consistency is a **structural** problem, solved by construction and CI (_Consistency — drift prevented by construction_); quality is a **judgment** problem — the thing AI does worst — solved by a human-set design foundation that agents conform to and a review step enforces (_Design quality & the design process_).

### 4.1 Consistency — drift prevented by construction

UI consistency — not behavior — is the historical bottleneck, and CSS **drift** between components is the failure mode. Discipline does not prevent drift; structure does. The system is central and the app is _required_ to conform to it, with the wrong thing made hard to write and caught in CI. Four enforced layers:

1. **Design tokens — the single source of truth.** Every color, spacing step, radius, shadow, type-scale value, z-index, motion duration, and breakpoint is a named token; no raw values anywhere else. Authored in the **W3C Design Tokens (DTCG) format** (stable since 2025.10), **spec-pure with the Resolver module carrying all theming** — the curated theme gallery × light/dark are resolver contexts, so themes are pure data (a firm's theme choice and a user's mode choice are two attributes on `<html>`; adding a theme is a new resolver input, zero component changes) — and generated by **Terrazzo** to **CSS custom properties**. One source enables the gallery, future **per-firm branding** (generated accessible palettes — a built-but-unexposed Culori script), and feeding the Tauri/mobile targets — without file duplication. (Terrazzo is newer than Style Dictionary — bus-factor risk accepted because spec-purity + golden-file output snapshots make the source portable to Style Dictionary in days; ADR-0076.)
2. **Styling engine — Tailwind v4**, configured (`@theme`) to consume _only_ the generated tokens, so off-scale values can't be expressed naturally.
3. **Component library — the only primitives.** The in-house **`@magna-carta/design-system`**, styled directly on headless **Bits UI v2** (Svelte 5 runes-native; behavior + accessibility upstream, every styled pixel ours): one Button, one Input, one Card, etc., with typed variants (plain typed variant functions — no churning variant DSL). The app _composes_ these; raw styled elements and direct `bits-ui` imports outside the package are disallowed. This eliminates the largest drift source — re-implemented primitives — while keeping the visual language fully owned. (shadcn-svelte, the original ADR-0028 choice, was replaced by ADR-0076 after an adversarial stress test — its look lives in vendored class strings and its token vocabulary conflicts with ours; its source remains an uninstalled reference corpus.) **Lucide icons only; no emojis.**
4. **Machine enforcement (full).** Strict **lint forbids arbitrary/off-token values** (`p-[13px]` fails CI); a **component catalog** (Storybook — Histoire died without Svelte 5 support) is the single place components are defined and reviewed, its stories tripling as behavior tests and axe accessibility checks; **visual-regression tests** (Playwright screenshots across every theme×mode; Argos CI the named upgrade) catch unintended cross-component drift. The per-area `CLAUDE.md` mandates "tokens + components only," so AI-generated code conforms too.

Net: drift is prevented _by construction_ (token constraint + one component source) and _caught in CI_ (lint + visual regression), never left to discipline. vanilla-extract was rejected on maintenance risk; Panda CSS was the runner-up (stronger compile-time type safety, smaller ecosystem).

### 4.2 Design quality & the design process

Consistency keeps the app from looking _jumbled_; it does nothing to keep it from looking _generically AI-made_ — default-styled primitives, flat hierarchy, uniform card grids, consumer-app whitespace where power-users need density, vague microcopy, no point of view. That is a problem of **judgment**, which AI performs poorly, so the governing rule mirrors the consistency layer: **AI applies an opinionated design well but invents one badly — so the design judgment is set once, up front, by a human with taste; agents conform to it; and a review step enforces it.** Distinctiveness and usability are engineered into a foundation, never improvised per screen.

**Foundation first — the foundational step, authored before any feature UI.** Two artifacts are decided deliberately (a human deciding, an agent assisting); everything else conforms:

- **A distinctive, restrained design language** — a deliberate type system and scale, a palette with intent, a **density suited to legal power-users** (high-volume, keyboard-first work like time entry, not airy consumer spacing), functional rather than decorative motion, and one or two signature elements that make the product feel _designed_ — anchored to explicit best-in-class references so agents aim at a real target, not the generic default.
- **Page archetypes, not just components.** The component library (_Consistency — drift prevented by construction_) supplies primitives (one Button, one Input); the AI look comes from assembling primitives with no higher-order pattern. A small set of canonical **page templates** — List/Index, Record Detail, Editor, Form/Wizard, Dashboard — each fixes a layout grammar, an information hierarchy, and the full set of states (empty / loading / error / dense). The app _composes archetypes_, so hundreds of screens read as one product — the same data-driven discipline as the component catalog and the settings/format registries (_Architectural integrity & coherence_).

**The UI build pipeline (per feature slice)** runs through staged roles with a **critic**, the same prevent-then-catch shape as the consistency layer:

1. **Interaction design** — input is the user's _task/flow_ (the job-to-be-done from the slice's spec and _User-facing documentation_), not "build a screen"; output is a layout choosing an archetype, fixing the hierarchy (what is primary), and enumerating every state.
2. **Implementation** — built against the design system and chosen archetype, structurally unable to drift off-token.
3. **Design critique** — judged against an explicit **anti-generic + usability rubric** (distinctiveness, hierarchy, scannability, archetype conformance, real-data density, microcopy quality, "does this read as default AI output?") — the judgment gate a linter cannot be.
4. **Accessibility** — keyboard-first and WCAG; for power-user software, keyboard ergonomics _is_ usability, not only compliance.
5. **Visual-regression** — screenshot tests over the component catalog (_Consistency — drift prevented by construction_) catch unintended drift.

**Two project-specific multipliers.** UI is built and reviewed on the **load-profile fixtures** (_Synthetic data & fixtures_) — real density, long values, empty states, large lists — never toy data, the most common reason AI UIs look fake. And **microcopy is domain-grounded**, drawn from the canonical glossary (_User-facing documentation_); generic copy is an instant tell, while domain-fluent copy reads as built by people who know legal work.

**Anti-pattern.** Distinctiveness is _not_ bought by customizing primitives per screen — that reintroduces the drift the consistency layer exists to prevent. It comes from the foundation (design language + archetypes) applied uniformly; restraint is what reads as professional. (ADR-0053)

---

## 5. Architectural integrity & coherence

Magna Carta is large and built largely by AI across many sessions that **start with no memory of the last** — so the platform's defining risk is not any single feature but **incoherence accumulating as it grows**: a utility reinvented because its existence was unknown, a new feature that forgets to wire into a cross-cutting concern, a settled decision quietly relitigated, work left half-finished by a session no successor can see. The _Design system & UI consistency_ approach — "drift prevented _by construction_, caught in CI, never left to discipline" (ADR-0028) — is the answer, here generalized from CSS to the **whole architecture**.

**The ordering principle.** A session knows only what it reads, so coherence is engineered as a property of the codebase, not something anyone must remember. Mechanisms rank by how little they depend on the builder choosing correctly:

1. **Make the wrong thing impossible** — structure/types so it cannot be expressed.
2. **Make the wrong thing fail loudly** — CI/tests that reject it before merge.
3. **Make the right thing cheap to discover** — read-first artifacts found at the point of work.

Memory and discipline are the weakest tier and are never the strategy. Four mechanisms implement the top three:

**Chokepoint seams.** Each cross-cutting concern is a _property of a path that must be traversed_, not a step to remember. The firm-scoped **DAL** (firm isolation; _Tenancy and data isolation_, ADR-0003) and the **`protected()`** field type (encryption + audited decrypt + blind index; _Encryption and key management_, ADR-0026) are the originals; the same move binds the immutable audit log to every money/sensitive write, conflicts re-checking to _adding a party_ (_Conflicts Check_), and outbound contact to the _Communications layer_ ports. The test of a real seam: _can the dangerous thing be done without touching it?_ If yes, it is not yet a chokepoint — and that gap is what a fitness function should fail on.

**Registry-first.** Anything that is "a growing list of similar things" is a **declarative registry**, not bespoke per-item code — making each addition uniform, discoverable, and machine-introspectable at once. Already so: the _Settings & configuration_ registry (ADR-0040), the conversion **format registry** (_In-app file conversion_, ADR-0030), design tokens (ADR-0028), and the plugin **category ports** (_Plugin / Add-on system_, ADR-0015). New categories — report types, notification templates, matter-type fields, court-rule sets — take the same shape rather than growing parallel code. A registry is the substrate that makes the next two mechanisms nearly free for its whole category.

**Architectural fitness functions.** Automated checks whose subject is the _architecture itself_, run in CI, in four tiers of decreasing determinism: (1) **boundary/dependency rules** — only the DAL imports the D1 client, no cross-firm import, UI never imports an adapter, and no convenience barrel files or deep cross-package imports (packages are touched only through their declared `exports`, ADR-0070) — via dependency-cruiser / ts-arch plus the Oxlint no-barrel rule; (2) **custom AST lint rules** via Oxlint JS plugins (ADR-0042; alpha-accepted under the same OSS/ESLint fallback as the toolchain); (3) **conformance tests over the registries and the emitted OpenAPI contract** — asserting structured metadata, not source text (every mutating route is audited and role-gated; every `protected()` field declares a role; every port has an adapter) — the most robust tier, and uniquely cheap because registry-first already exposes the data; and (4) **LLM-as-fitness-function**, the _Maintenance agents_ pattern (ADR-0016) pointed inward, **propose-only**, for the fuzzy rules no deterministic check expresses ("reused or reinvented?"). Seams _prevent_; fitness functions _prove no path escaped_ — belt and suspenders.

**Generated read-first indexes.** A capability map answering "what already exists to reuse?" — the non-UI analogue of the Storybook component catalog (_Design system & UI consistency_). It is **generated from the registries and module surfaces, never hand-maintained** (a hand-kept index drifts, then lies — worse than none), regenerated in CI with fail-on-drift, and surfaced **read-first** by each area's `CLAUDE.md` at the point of work. Where a capability lives in a registry, emitting the index is nearly free.

**Carried across sessions** by the **spec → plan → execute** workflow (_Development guidelines, CLAUDE.md, and ADRs_): each vertical slice has a written plan that persists in the repo, so a new session resumes from the plan, not from scratch — the amnesia fix, essentially free because the plan is written anyway.

**Rejected: bespoke memory infrastructure.** No vector database, knowledge graph, or custom "context server" — these rot, demand babysitting, and duplicate what the **codebase + git history + generated indexes** already are. The leverage is in seams, registries, fitness functions, and generated indexes, not in memory machinery that itself needs maintaining. (ADR-0051)

---

## 6. Tenancy and data isolation

Three tiers:

1. **Control-plane D1** (central): the canonical user **identity** (credentials, 2FA, sessions) and the **firm registry** (which firm maps to which database/bucket). **Each user belongs to exactly one firm** (Better Auth organization), recorded here as the user's single `firm_id`. Holds **no client or matter content** — only identity and routing. This is where the auth library lives.
2. **Per-firm D1 database**: that firm's structured business data (Directory, matters, ledgers, time, tasks, calendar, etc.), plus a firm-scoped **`member` table** mirroring that firm's users by their global `user_id` — firm-local role, location, rate, and display identity — so every business row references a _local_ user and no query reaches across databases.
3. **Per-firm R2 bucket**: that firm's files, documents, originals, email archives — versioned.

**Why per-firm isolation (verified against Cloudflare):**

- D1 is explicitly designed for database-per-tenant; static bindings reach ~5,000 databases per Worker, the account default is 50,000 (raisable to millions), and each D1 is its own Durable Object (performance isolation too).
- R2's default limit is **1 million buckets per account**, so bucket-per-firm is equally viable.
- Hard isolation gives a confidentiality story Clio/LEAP cannot match, plus per-firm backup/export/delete and per-firm 10 GB headroom.

**Invariant:** bulk content always goes to R2, never D1 — keeping each firm's D1 well under the 10 GB per-database hard cap. A **firm-scoped data-access layer** is adopted from day one, so today's single firm becomes N cleanly. The only real cost (migration fan-out, routing) does not appear until firm #2.

**User-data placement.** Authentication is central; application identity is firm-local. The control-plane D1 owns credentials/sessions and the one-and-only `firm_id` per user; each per-firm D1 owns that user's **`member`** row (keyed by the global `user_id`) carrying firm-scoped role, location, rate, and display name. The global `user_id` is the join key — per-firm tables foreign-key to the local `member`, never across to the control plane. Provisioning or deactivating a user writes both places: a small, write-rare **sync seam**, the same class of cost as the per-firm fan-out. Single-firm membership keeps this trivial — no membership join table, one `firm_id` per user — and keeps firm-confidential role/rate data inside the isolation boundary. Per-firm user counts are small (tens), so the `member` mirror earns its place through local referential integrity and isolation, not query performance.

**Firm vs. location.** A firm may operate from **multiple offices/locations** (e.g., a multi-state practice). The **firm — not the location — is the unit of tenancy, isolation, crypto-shred, and conflicts.** Locations are a **dimension inside the per-firm D1**, never a separate database/bucket: all offices share one firm-scoped Directory, matter set, and the firm-wide conflicts graph (conflicts impute across every office). A **Location** is a first-class entity (see _Locations_) referenced by matters, trust accounts, users, and Custodian roots. Modeling an office as a separate tenant was rejected (it would break the shared Directory and firm-wide conflicts and multiply isolation cost); modeling it as a Directory `Organization` was rejected (conflates internal firm structure with external contacts); placing it in the control-plane registry was rejected (office data lives in per-firm D1).

### 6.1 Database backup & disaster recovery

Two layers, because a single mechanism cannot cover both "undo a mistake" and "survive a disaster":

- **Layer 1 — Time Travel (operational recovery, free, always on).** D1's **Time Travel** retains the write-ahead log and restores any database to **any minute within the last 30 days** — no setup, no snapshots to manage, no cost. This is the first response to the common failures: a bad migration, a fat-finger bulk write, an accidental delete. It does **not** cover anything older than 30 days or the loss of the database itself.
- **Layer 2 — export snapshots (long-term + disaster recovery).** A **Cron-triggered Workflow** fans out across firms, calls the **D1 export REST API** per database, and streams each SQL dump into **that firm's own R2 bucket** under a `backups/` prefix — preserving per-firm isolation, landing in the same at-rest-encrypted store as the firm's files (the field-level `protected()` ciphertext stays encrypted _inside_ the dump, so per-firm **crypto-shred** still renders backed-up secrets unreadable — _Encryption and key management_). The **control-plane D1** (firm registry, identity) is backed up the same way as a first-class target. Restore is an **import** of the SQL into a fresh D1 (REST/Wrangler), exercised by **periodic restore drills** so the path is known-good before it is needed. Dumps are **zstd-compressed as they stream** (ADR-0078): SQL text compresses ~85–95%, and neither of the no-compression rationales in _Document versioning & storage tiering_ applies here (a dump is not pre-compressed media and is never range-streamed); the restore drills exercise the compressed path. If measurement ever warrants more, `zstd --patch-from` deltas against the GFS weekly/monthly fulls as keyframes are the named option.

**Retention — GFS, ~7+ years.** Daily snapshots kept 30 days → weekly kept 1 year → monthly/yearly kept **7+ years** (aligned to matter-retention windows). Aged snapshots **tier to Infrequent Access** through the same lifecycle as document versions and deleted files (_Document versioning & storage tiering_) — the cold long tail costs ~33% less and is the fastest-growing segment.

**Immutability — R2 bucket locks.** Backup prefixes carry **R2 bucket-lock** retention rules (prefix-scoped, set per GFS tier — lock dailies 30 days, monthlies 7 years, etc.), so a snapshot **cannot be deleted, accidentally or maliciously, before it ages out**. This is the primary defense against the deletion/blast-radius risk of keeping primary and backup in **one Cloudflare account** (a separate backup account was considered and **declined** for operational simplicity). Two honest limits remain: bucket locks are _retention policies_, not certified WORM (no SEC 17a-4-grade immutability), and the lock rules are themselves account-managed — so a full **off-Cloudflare export seam** is **designed-but-deferred** to cover the residual tail (a Cloudflare-wide catastrophe, account loss, or a future certified-WORM requirement), built only if scale or a firm's compliance obligation demands it. Everyday durability and the realistic failure modes are met on-Cloudflare.

---

## 7. Authentication, access control, and encryption

- **First-party login** built on **Better Auth** (TypeScript-first, maintained; Lucia is deprecated and now a learn-from-scratch resource). Better Auth provides passkeys/WebAuthn, TOTP, email OTP, and organization/RBAC plugins, and runs on Cloudflare Workers + D1 via a Drizzle/Kysely adapter. It lives in the control-plane D1, with **firm = organization** and exactly **one organization per user** (_Tenancy and data isolation_); a user's firm-scoped role/profile is mirrored to that firm's per-firm **`member`** row, not stored centrally.
- **2FA:** passkeys/WebAuthn and TOTP as primary factors; email codes and SMS as secondary/recovery (SMS supported but flagged weakest — SIM-swap risk — and never a sole second factor). SMS codes are **generated by Better Auth and merely delivered through the Communications layer messaging port** (_Communications layer_) — no third-party "Verify" product, so there is one OTP path the platform owns.
- **Hardening:** Argon2id hashing, secure D1/KV sessions, rate limiting, account lockout, email verification, password reset, and an immutable **auth audit log**.
- **Access control — a trusted-insider model.** The working assumption is a firm of **mutually trusted members**: anyone with a login is authorized to **access and assist**, so information is **open among insiders** and access control governs **what you may do**, not what you may see. The layers: **firm isolation** (separate DB — the only hard boundary, so a cross-firm resource is a **404**, never an existence oracle) → **RBAC** over _actions_ → a **future ethical-wall** overlay screening _content_ for the rare conflict (deferred — below). Role assignments live on the per-firm **`member`** row (_Tenancy and data isolation_), inside the isolation boundary.
  - **Permissions** are a fixed platform **registry**, one namespace per subsystem (`<subsystem>:<action>`, e.g. `trust:disburse`, `matter:edit`), mirroring the per-subsystem API route modules and frontend areas; every route declares one and a fitness function cross-checks it (_API contract & route conventions_, ADR-0067).
  - **Roles are data, not enums** — `role → permissions` and `member → roles` rows, seeded with editable defaults (Owner/Admin, Attorney, Paralegal, Billing, Read-only); the role-editor UI is a later additive seam. A member's **effective permissions = the roles they hold ∪ any direct grants**.
  - **Access requests:** a member who can _see_ a resource but lacks the action permission gets a **403 + request access**; an approver writes an optionally time-boxed **direct grant**. Within a firm every denial is a **403** (everything is visible to insiders); **404 is reserved for the cross-firm case**.
  - **Location is a view/reporting filter, not an access gate** — data is available firm-wide; users may _filter_ lists, search, and reports by office (users still belong to one or more offices, one primary — _Locations_). Hard per-location separation is a **reserved seam**.
  - **Ethical walls are deferred** — named as the future content-screening layer (a screened user would see a matter's _header_ but not its confidential _contents_), **not designed until a concrete use case exists**; conflicts clearance still records outcomes in the immutable conflicts log (_Conflicts Check_).

> **Status — RBAC decided (ADR-0068); walls deferred.** The model above (trusted-insider RBAC, the per-subsystem permission registry, roles-as-data, access requests, and location-as-filter) is settled at the white-paper level. **Ethical-wall mechanics and the external-principal enforcement detail are intentionally deferred** — no concrete use case yet — and kept as seams; a follow-up subsystem spec is written only when one of them is built.

### 7.1 Encryption and key management

Application-level encryption is **scoped narrowly and enforced structurally.** D1 and R2 are already encrypted at rest by Cloudflare, so app-level encryption is not for "data at rest" — it exists to give the crown-jewel secrets an **audited, role-gated read chokepoint** and a per-firm confidentiality guarantee the platform alone cannot.

- **What is encrypted — and what is not.** Only a narrow secret set: sensitive identifiers (SSN, DOB, driver's license, financial IDs), per-firm plugin credentials, and TOTP seeds. Everything else (names, addresses, notes, matter data) relies on platform at-rest encryption — encrypting it would break search, sort, fuzzy dedup, and conflicts matching for no real gain.
- **Key model — envelope encryption, two stored keys.** A single 256-bit **root KEK** is held as a **Worker secret** (outside D1, so a database dump alone decrypts nothing). It wraps a **per-firm key** stored _wrapped_ in the control-plane firm registry; that firm key **HKDF-derives** purpose keys (`pii`, `secrets`, `index`) on demand — no data-encryption keys are ever stored. Primitives are native Workers Web Crypto: **AES-KW** (key wrap), **AES-GCM** (payloads), **HKDF** (derivation), **HMAC** (blind index). All verified available in the Workers runtime.
- **Enforcement — one chokepoint, no separate service.** Encryption lives **in the firm-scoped data-access layer**, not a separate crypto Worker (which would add a hop and a deployable while giving only illusory isolation for an online decrypt path — the caller receives plaintext regardless). A declarative **`protected()` field type** encrypts on write, decrypts on read _only_ with the permitted role _and_ writes an audit entry, and maintains an HMAC **blind index** so Conflicts (_Conflicts Check_) can match encrypted identifiers without decrypting them. The same module exposes `getSecret`/`putSecret` for per-firm plugin credentials (ciphertext in per-firm D1; the core Worker decrypts and passes plaintext to plugin Workers, which never see key material). This makes encryption a _property of the field type_, not a step anyone must remember — the same structural enforcement as firm-scoping.
- **Per-firm crypto-shred.** Destroying a firm's wrapped key renders its entire encrypted corpus permanently unreadable — instant per-firm delete/offboard with no data scrubbing (supports the per-firm delete/export in _Tenancy and data isolation_).
- **Rotation.** The wrapped structure permits root rotation (rewrap firm keys) and per-firm rotation (re-encrypt that firm's small sensitive set) without re-encrypting everything; the machinery is deferred until needed, only the seam is built now.
- **Post-quantum posture — symmetric-safe by design, agility for the rest.** The encrypted corpus is entirely symmetric/hash-based (AES-256-GCM payloads, AES-KW wrap, HKDF derivation, HMAC blind index), and that is **quantum-resistant already**: Shor's algorithm breaks public-key crypto, not symmetric ciphers, and Grover only halves effective strength (AES-256 → 128-bit, still infeasible; CNSA 2.0 approves AES-256). So there is **no bulk cipher to replace** — the quantum-vulnerable surface is _public-key key-exchange and signatures_, never our data at rest. Two consequences follow. (1) **Harvest-now-decrypt-later** (record ciphertext today, decrypt once a quantum computer exists) is a threat to data _in transit_, not at rest — mitigated at the transport layer by Cloudflare's hybrid **X25519MLKEM768** TLS (on for inbound and, by default, Worker→origin egress; third-party plugin endpoints that won't yet negotiate PQC TLS are an inherited gap that is _logged_, not silently accepted). (2) Public-key **signatures** (passkeys/WebAuthn, the e-signature PAdES seal) are forge-able only _once_ a quantum computer exists — a migrate-before-then concern, not a retroactive one — so they are **seamed but deferred**, riding upstream standards (FIPS 204 ML-DSA / 205 SLH-DSA / 206 FN-DSA; COSE algorithm IDs for the WebAuthn path; ETSI/CA support for PAdES ML-DSA). The structural defense is **crypto-agility**: every ciphertext, wrapped key, and signature carries an explicit **algorithm-version identifier**, so adopting a hybrid ML-KEM key-wrap or an ML-DSA/SLH-DSA signature later is a versioned rotation behind the existing `protected()` chokepoint and the e-signature port — never a rewrite. AES stays **256-bit everywhere**; session signing stays **HMAC** (symmetric, already quantum-safe). (ADR-0046)
- **Honest limits.** Root-KEK compromise is total compromise — inherent to any key hierarchy. The only stronger anchor is an **external KMS/HSM**, which Cloudflare does **not** offer for application data (its only HSM story is Keyless SSL for TLS keys), so an **AWS-KMS-rooted KEK is a backlog hardening item, not Phase 0** (and, when added, "supports PQC-wrapped keys" becomes a selection criterion — see _Post-quantum posture_). **TOTP seeds** are the one exception to the DAL chokepoint (decided — ADR-0084): they live in Better Auth's own tables and stay under **Better Auth's at-rest encryption**, empirically verified against the pinned version (a test asserts the stored value is never the raw seed) with the `encryptionKeys` rotation array configured and the auth secret tracked in the managed-secrets inventory. Rationale: seeds are user-owned auth credentials read at login, before firm context exists — and per-firm crypto-shred must never break a user's login. The hook-into-our-module path remains available if a future Better Auth version fails the verification test.

---

## 8. Cloudflare primitive mapping

| Need                                                 | Primitive                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API + app hosting (static assets)                    | **Workers**                                                                                                                                                    |
| Structured data (per firm)                           | **D1** (+ control-plane D1)                                                                                                                                    |
| User identity vs. firm membership                    | Identity (credentials, sessions, one `firm_id`) in **control-plane D1**; firm-scoped **`member`** mirror in **per-firm D1** (see _Tenancy and data isolation_) |
| Files, originals, email archives, versioned          | **R2** (per firm)                                                                                                                                              |
| Live collaboration & container control               | **Durable Objects**                                                                                                                                            |
| Async work (extraction, doc-gen, conflicts, reports) | **Queues**                                                                                                                                                     |
| Semantic search                                      | **Vectorize**                                                                                                                                                  |
| Cache / config                                       | **KV**                                                                                                                                                         |
| Heavy services                                       | **Containers** — Collabora (editing), Tantivy (discovery search), OCR/extraction, LibreOffice headless (DOCX↔PDF)                                              |
| System secrets (anchors)                             | **Worker secret** — root KEK, session-signing key, transactional-email key (Secrets Store not used; see _Encryption and key management_)                       |
| Per-firm credentials & sensitive fields              | **Encrypted columns in per-firm D1** — envelope encryption, keys never stored beside ciphertext (see _Encryption and key management_)                          |
| Telemetry                                            | Workers Logs / Logpush → R2 / Tail Workers / Analytics Engine                                                                                                  |

---

## 9. Foundational data & runtime conventions

A handful of **cross-cutting data and runtime decisions** bind every subsystem and are expensive to retrofit, so they are settled here, once, as conventions the whole platform conforms to — the data-layer counterpart of the _Design system, UI consistency & design quality_ (for UI) and _Architectural integrity & coherence_ (for structure). Each is enforced structurally where possible — a DAL type, a domain primitive, a coherence fitness function — rather than left to per-feature discipline; subsystems reference this section by name. All members are now settled below: the **time model**, **durability on close**, **money representation**, **identifier strategy**, **idempotency**, the **transactional outbox**, and the **schema-migration / fleet model**.

### 9.1 Time, dates & timezones

Legal work is deadline-driven and multi-jurisdiction, so time is modeled **by kind**, not as one universal timestamp — the distinction the **Temporal API** (TC39 Stage 4 / ES2026; native in current Chromium/Firefox/Edge, **polyfilled** elsewhere and in the Workers runtime) makes first-class, and the reason it is adopted over a `Date`-era library.

- **Instants — _when something happened_** (audit entries, `created_at`/`updated_at`, ledger posting time, message sent, login). Stored as **UTC** (`Temporal.Instant`), rendered in the viewer's or the relevant entity's zone. Local time is **never** stored for an instant.
- **Civil dates / deadlines — _a calendar date in a jurisdiction_** (filing due date, statute-of-limitations date, hearing date, trust-reconciliation period). Stored as a **`Temporal.PlainDate` plus an explicit jurisdiction zone**, never a UTC timestamp — storing "midnight-local-as-UTC" is the classic off-by-one-DST defect. **Docketing** (_Calendar and rules-based docketing_) computes these in the **court's zone** against its business-day/holiday calendar, independent of where the user sits.
- **Wall-clock recurrences — _a local time that repeats_** (a 9am reminder). Stored as local time + zone; concrete instants are materialized per occurrence.
- **Durations / quantities** — time entries (0.1 h increments, _Time tracking_) are **quantities** (minutes), not times-of-day; the entry's date is a `PlainDate` in the timekeeper's zone.

**Zone context has explicit homes** (_Locations_, _Settings & configuration_): each **Location carries an IANA zone** (`America/Los_Angeles`, never a fixed UTC offset — offsets break across DST), supplying the default zone and jurisdiction for matters routed through it; each **user carries a display-zone preference** for rendering instants. A deadline is computed and stored against the **court/jurisdiction** zone and shown with that context (optionally alongside the user's local equivalent), so a Nevada deadline reads correctly for a user sitting in New York.

**Enforced, not trusted:** a single UI **formatting layer** always renders in an explicit zone (never the implicit browser default), and a coherence **fitness function** (_Architectural integrity & coherence_) forbids a naive local datetime ever being stored where an instant (UTC) or a civil date (`PlainDate`) belongs. This rides the fixtures' **fixed-clock** discipline (_Synthetic data & fixtures_), which already bans wall-clock time. (ADR-0055)

### 9.2 Durability on close / graceful shutdown

No close is ever trusted to be graceful. "Losing data on close" is precisely **client-held state the server has not yet durably accepted** — the cloud is the source of truth (_Tenancy and data isolation_), so a write is safe the moment it is acknowledged, and the whole problem reduces to never discarding an unacknowledged write and never relying on a shutdown hook to save one. Durability is engineered **before** the close, not during it: a hook (browser `beforeunload`, Tauri `close-requested`) is best-effort UX, never the correctness mechanism — correctness must survive a power cut or `kill -9`. Same prevent → loud → discipline ordering as _Architectural integrity & coherence_:

1. **Loss made impossible.** An acknowledged write is durable server-side; **idempotency keys** and the **transactional outbox** (queued members above) make replay-on-reconnect safe, so a client may resend anything it is unsure landed. The **desktop (Tauri) outbound mutation queue is on-disk** (_Delivery model_), so unsynced writes survive quit _and_ crash and replay on next launch. **Durable Object state — the cross-device live timer (_Time tracking_), job orchestration (_Performance & concurrency model_) — lives in DO durable storage, not memory**, so hibernation, eviction, and deploy are lossless. **Queues are at-least-once with idempotent consumers**, so a job interrupted mid-flight (OCR, conversion, discovery, export) is retried, not dropped; long local desktop jobs (bulk ingest, OCR, indexing) **checkpoint** so an interrupted run resumes rather than corrupts.
2. **Loss made loud.** A close or logout carrying unacknowledged client state trips a guard — web `beforeunload`/`visibilitychange`, Tauri `close-requested` — that **flushes in-flight work first, then warns only if loss is genuinely unavoidable** (truly offline with a non-persistable draft). Editor and form input **autosaves as server-side drafts** on an interval, so unsaved input is never purely tab-local.
3. **Discipline last, per surface.** **Web tab/window close** — guard + draft autosave; the live timer is already DO-backed, so it survives the tab. **Desktop quit** — intercept, drain or persist the queue and confirm checkpoints; an offline quit is safe by construction (the queue is durable and resumes next launch). **Server (Workers/DO)** — stateless handlers complete-or-fail under idempotent retry, with DO and Queue durability as above; no in-flight correctness depends on a clean instance teardown. **Logout / session end** — clearing the in-memory cache (_Delivery model_) is **gated on the outbound queue being drained or persisted**, so ending a session never discards a pending write.

**Enforced, not trusted:** the close/logout guard is a **single shared client primitive**, not re-implemented per screen, and a coherence **fitness function** (_Architectural integrity & coherence_) asserts that live-timer and job state is written through DO durable storage rather than held only in memory. Per-tier flush, checkpoint, and autosave intervals are deferred to the build — the _convention_ binds now, the _numbers_ arrive with the code, the same intentional seam as the _Performance & concurrency model_. (ADR-0057)

### 9.3 Money & currency

Money is exact or it is wrong. Every monetary value is an **integer in minor units** — never a float, which both the firm-scoped DAL and a coherence **fitness function** (_Architectural integrity & coherence_) forbid — at one of two fixed scales: **amounts** (balances, ledger postings, invoice-line totals, payments, trust entries) at **2 decimal places (cents)**, and **rates / unit prices** (hourly rates, expense unit costs such as per-mile mileage) at **4 decimal places**, the extra precision kept so a rate×quantity product does not lose money before rounding. Every value carries an **ISO-4217 currency** (always `USD` now; ledger accounts are single-currency and a posting inherits its account's currency) — the field exists so multi-currency is a later evolution, but **no FX machinery is built** ("design for the superset, ship the subset", _Guiding principles_).

Arithmetic runs through **one engine behind one seam.** **Dinero.js v2** (`Dinero<bigint>` — bigint amounts, so no float and no precision ceiling) does the calculation, wrapped by a thin in-house **`money` module** that owns the branded `Money`/`Rate`/ratio types, the two-scale storage convention, currency tagging, the formatting layer, and DAL enforcement — so the library sits behind a swappable adapter (the same ports posture as _Payments_ and the _Communications layer_) and could later yield to an in-house or Rust→WASM core (_Delivery model_ — ledger math) without touching a stored row, because the only part expensive to migrate is the **representation** (integer minor units in D1), which is library-agnostic. Percentages and ratios (tax rate, interest rate, contingency share) are a **dimensionless decimal, never `Money`**.

**Rounding is named per boundary, never global** — the correct mode differs by context and one of them is legally fixed. The `money` module exposes intent-named helpers: **tax → round-half-up** (the Streamlined Sales & Use Tax §324 statutory rule; Nevada is a member state), **invoice-line totals → half-up** (client expectation, consistent with the tax line), **GL / financial-statement aggregation → banker's (half-even)** (GAAP-accepted, eliminates the cumulative upward bias of half-up), and **splits/allocations** (contingency client/fee/cost/lien, payment application across invoices) → **largest-remainder**, which sums to the whole exactly so no penny is created or lost. Raw rounding takes an explicit mode (no silent default); a fitness function flags rounding done outside the named helpers, and rounding happens only at these boundaries, never mid-calculation. This keeps the ledger sum-to-zero and no-negative-trust invariants (_Financial Core_, _Trust accounting_) penny-exact and three-way reconciliation reconcilable by construction. (ADR-0061)

### 9.4 Identifiers

Every row is identified by **one opaque handle that is also its primary key**: a **type-prefixed, CSPRNG-random, URL-safe token** (`mat_…`, `doc_…`, `dir_…`, `inv_…`, `usr_…`, `firm_…`) — this _is_ the immutable opaque handle the URL scheme already relies on (_Delivery model_). The handle is **purely random, never time-encoded** — UUIDv7, ULID, and Snowflake are rejected because their embedded timestamp leaks record-creation time and growth rate and allows prediction, a real leak for a confidentiality-first platform. Random generation through a **CSPRNG** (`crypto.getRandomValues`; a **seeded PRNG** in fixtures, _Synthetic data & fixtures_, so determinism survives) makes handles unguessable, closing the enumeration/IDOR surface the server-side-only access gate (_Delivery model_ — 404-not-403) already assumes; entropy is sized for **guess-resistance** (~126 bits), not merely collision-avoidance.

**Non-overlap is a guarantee, not a probability:** the type prefix partitions the space (a `mat_` can never equal a `doc_`), per-firm-D1 scoping (_Tenancy and data isolation_) shrinks it, and a `UNIQUE` constraint with **retry-on-collision** in the generator makes uniqueness a correctness property regardless of entropy. Prefixes are a **registry** (_Architectural integrity & coherence_) — self-describing in logs and the Error-ID trail (_Observability and diagnostics_) and defense-in-depth against passing the wrong id, reinforced by **branded TypeScript id types** (`MatterId` ≠ `DocumentId`) the compiler enforces. Cross-database references (the control-plane `usr_`/`firm_` handles referenced by per-firm `member` rows, _Tenancy and data isolation_) use the same scheme, since random handles cross DB boundaries where integer keys cannot. The **matter number** stays a separate, human, mutable alias with redirect aliasing (_Delivery model_), never the key.

The single-handle-as-key model is chosen over an integer-PK-plus-handle split because at per-firm-D1 scale (bulk content lives in R2, D1 stays lean) the integer key's performance edge is negligible and speculative (_measure before optimizing_, _Performance & concurrency model_), while the split would tax every API boundary with handle↔key translation and an N+1 risk; the SQLite "random PK fragments the index" concern is a non-issue (D1's hidden rowid is the clustered index). If scale ever changes that calculus, the handle is the stable external reference, so introducing internal integer keys later is a pure internal migration that breaks no URL or contract. (ADR-0062)

### 9.5 Idempotency

Money must move **exactly once** under retries, double-clicks, and dropped connections. Every mutation accepts a client-generated **`Idempotency-Key`** (the IETF `draft-ietf-httpapi-idempotency-key-header` field, Stripe semantics): the SvelteKit client (TanStack Query mutations, _Delivery model_) mints one key per logical operation and reuses it on every retry; the public API (_Delivery model_ — `api.`) takes the same header from third parties. A per-firm D1 `idempotency_key` table records key + request fingerprint (a method+path+body hash) + status + the captured response. A repeat with the **same key and fingerprint replays the stored response** without re-executing; an **in-progress** match returns `409`; the **same key with a different fingerprint** returns `422` (a client bug, surfaced not masked).

Atomicity is the crown-jewel part: the idempotency row and the actual effect (ledger postings, _Financial Core_) **commit in one D1 transaction**, and the row's `UNIQUE` key _is_ the concurrency guard — two simultaneous identical requests race to insert, one wins and the other is served as a duplicate — so exactly-once posting needs no separate lock (reusing the UNIQUE-insert idiom of _Identifiers_). Idempotency is a **chokepoint** (_Architectural integrity & coherence_): it lives in the API/DAL mutation path, each mutating route declares `idempotency: required | optional` in its metadata (**required** on money, trust, payment, and outbound-communication routes), and a conformance fitness function asserts every side-effectful route requires it. Keys are per-firm, retained ~24h (a Cron job purges them — they are ephemeral dedup state, not the record of truth, which is the append-only ledger), and **passed through to the payment processor** (Helcim/Stripe honor them) so the external charge dedups too. Inbound dedup here, the **transactional outbox** below, and idempotent consumers together give end-to-end **effectively-once** effects. (ADR-0063)

### 9.6 Transactional outbox

A committed database change often must trigger an effect elsewhere — capture a payment, send email/SMS/voice (_Communications layer_), re-run conflicts (_Conflicts Check_), update the search index or a read model — but a **D1 transaction spans a single database only** (never D1+Queues, D1+R2, or D1+an external service), so writing the row and firing the effect cannot be one atomic act. The **outbox** closes that dual-write gap: the intended effect is written as a row in an **`outbox` table in the same D1 transaction** as the business change (and the audit row), so the effect is recorded if and only if the change commits. A **relay** then publishes pending outbox rows to **Cloudflare Queues**, and consumers perform the real effect.

Emitting an effect is a **chokepoint** (_Architectural integrity & coherence_): a handler that has written to D1 may not enqueue or call an external service directly — it goes through the outbox, and a boundary fitness function fails CI on any bypass (genuinely independent async work, whose job row _is_ its state, may enqueue directly). The relay's **correctness floor** is a **Cron-triggered Workflow** that sweeps each firm's outbox and publishes — the same cross-firm fan-out used for backups (_Database backup & disaster recovery_) — with a post-commit poke to a per-firm relay **Durable Object** as a latency seam layered on top (prompt drain, but correctness never depends on the poke landing). Because Queues are **at-least-once and unordered**, consumers are **idempotent** (deduping on the outbox id, reusing the _Idempotency_ machinery) and ordering-sensitive topics apply by an aggregate sequence; max-attempts dead-letters to observability (_Observability and diagnostics_). The outbox is a **reliable-dispatch primitive, not event-sourcing** — D1 tables, the ledger, and the audit log stay the system of record; **multi-step external flows** (charge → post → receipt) compose as **sagas via Workflows** with compensating actions, built on the outbox + idempotency primitives. (ADR-0064)

### 9.7 Schema migration & the database fleet

One firm is one D1 database (_Tenancy and data isolation_), so evolving the schema is a **fleet operation across thousands of databases plus the control-plane D1**, not a single migration — "add a column" becomes thousands of `ALTER TABLE`s to apply, track, and recover, with a window where firms run different schema versions. The schema is defined once in **Drizzle** (TypeScript) — the single source of truth for **both** the generated types the DAL consumes **and** the migrations `drizzle-kit` emits, so types and migrations never drift (the failure mode of keeping them separate). Drizzle sits **under** the firm-scoped DAL, which still owns firm-scoping, `protected()`, audit, the outbox, and idempotency. There are two schema lineages — **control-plane** and **per-firm** — versioned independently.

The **rollout orchestrator** is a **Cron-triggered Workflow** iterating firms (the recurring fleet-fan-out primitive shared with backups and the outbox relay): it applies each firm's pending migrations and records the new version in the **control-plane firm registry** (which already tracks which databases exist and which firm they serve — schema version is one more column, giving fleet-wide visibility), with **bounded concurrency, per-firm failure isolation** (a failed firm is quarantined and alerted, the fleet continues), **idempotent/resumable** application (already-current firms are skipped), and a migration-state report. Active firms migrate eagerly in the fan-out; **dormant firms catch up lazily** on next access (the DAL applies pending migrations on connect) — Cloudflare's "migrate active tenants, dormant ones when they return." **Expand-contract is the discipline** that makes a non-atomic fleet safe: every migration is backward-compatible with currently-deployed code, in the order _expand migration → deploy code tolerant of both schemas → backfill → contract migration_, so running code never meets an incompatible schema; a fitness function flags a destructive change shipped with the same release as the code that needs it. A new firm is provisioned at the current schema (the runner's "v0 → apply all" path); per-database **Time Travel** (_Database backup & disaster recovery_) is the instant-recovery net, migrations are tested against the **load-profile fixtures** (_Synthetic data & fixtures_) and dry-run in CI, and the whole apparatus is **built now though one firm exercises it as a fleet of one** — the fan-out is the only real cost of per-firm isolation and is cheaper to build before firm #2 than after. (ADR-0065)

---

## Part II — Platform & Cross-Cutting Systems

---

## 10. Plugin / Add-on system

- **Ports-and-adapters:** the core defines typed **category ports** (legal research, court & filing, accounting, banking, shipping, email/calendar, **messaging (SMS/MMS/RCS)**, **voice/telephony**, payments, e-signature, **password manager / secrets vault**); each vendor is an **adapter**.
- **Password manager / secrets vault (future):** staff credential sync — shared firm logins for vendor portals and court systems, surfaced in-app, backed by the firm's existing vault. **Bitwarden** the candidate launch adapter, others swappable. Scope — read-only retrieval vs. full management, and how items link to Directory/matter entities — TBD.
- **Manifest-driven registration (ADR-0096).** Each integration package exports one declarative `IntegrationManifest` — the single description of an integration's identity, credential shape, capability, permission gate, and route wiring. The platform core holds a central registry that enumerates manifests and drives all wiring from them: route mounting through the ADR-0067 chokepoint, per-request adapter resolution, and (in Spec 2) the marketplace catalog. Adding or removing an integration touches only that integration's package plus one registry line; the core names no individual plugin. `PluginRuntime` is the uniform dependency seam the core hands to every plugin's route wiring, replacing the previous per-plugin fields on the options object — it is also the exact seam the C-transition (below) replaces with RPC. Intrinsic shared-resource concerns — the per-firm migration lineage, the permission registry, and identifier prefixes — remain core-side; those cannot be a plugin's private concern.
- **Transport progression — the C seam (ADR-0097).** The manifest contract is transport-agnostic: (C0, current) plugins run in-process in the same Worker, `PluginRuntime` is direct calls; (C1) a service-binding model moves each plugin to its own Worker with `PluginRuntime` as RPC; (C2) Workers for Platforms isolates untrusted third-party plugins in a dispatch namespace — Cloudflare's confirmed model for deploying customer-authored Workers. The trigger for advancing is the first untrusted/third-party plugin or a plugin requiring an independent deploy cadence, not a calendar date. The hard problems that must be solved at C are documented in ADR-0097 (per-firm D1 across Workers, firm-key custody, distributed migration ownership, chokepoint-across-boundary, aggregated OpenAPI). What stays platform-owned in all three stages: tenancy resolution, the single chokepoint, the per-firm migration lineage, and the encryption custody root.
- **First-party now**, with the C seam open to a third-party marketplace (Workers for Platforms) later. Pure non-integration utilities are shared libraries, not plugins.
- **First adapter: email/calendar.** Then accounting/banking, then legal research/courts, plus payments and e-signature, and **messaging/voice** (_Communications layer_) — **Telnyx the launch adapter, swappable to Twilio/Bandwidth/Plivo**, following the same _design the port now_ rule.
- **Shipping & postage (backend built).** The first credentialed adapter to land: **EasyPost** behind a typed `ShippingPort` (address validation, live rate-shopping, label purchase, tracking, refund). A firm connects its own EasyPost account; the API key is held as a firm secret, and the firm-facing routes draft a shipment, rate-shop, buy a label (the bought PDF copied into the firm's own storage), track it, and refund it. **Certified mail** — USPS Certified Mail with return receipt and signature — is modeled as a first-class shipment option, the differentiator that makes this legal-grade postage rather than generic shipping. EasyPost was chosen over Pirate Ship for its public API, certified-mail support, multi-carrier network, and a billing model that centralizes every firm's postage on the firm's own account. Tracking is pull-on-demand at launch (push-webhook ingress is a seam); postage costs are recorded against the matter for cost-recovery when the financial core lands.
- **Legal-research adapters** (CoCounsel/Westlaw, Lexis, PACER) follow a _design the port now, license the adapter when vendor access is confirmed_ rule. Vendor entitlement/licensing is separate from building the port — e.g., Thomson Reuters gates CoCounsel/Westlaw **API/MCP connector access** apart from the regular subscription (confirmed during setup: a connector authorization failed pending entitlement). Treat each legal-research vendor's API access as a procurement prerequisite, not an engineering one.

- **Build-in or plugin?** Default to **built-in** when a capability is easy enough to build or adds enough value to justify owning it — a native feature is one coherent product the firm controls, with no per-vendor procurement and no data crossing an integration boundary. Reach for a **plugin/adapter** when the capability is genuinely external (licensed vendor data or service) or not worth building natively.

- **Tools area (how utilities surface).** First-party utilities — pure link/lookup helpers (property and government-portal links, attorney-license lookup) and integration-backed tools (shipping/postage) alike — reach users through one **Tools** catalog: a left-nav section for general access, plus contextual entry points where a tool is relevant (an address tool on a Location, a person tool on a Directory entity, a Diagnostics group for firm usage and connectivity). The catalog is a thin **presentation/IA layer _above_ this plugin framework**, not part of it — it reflects an integration-backed tool's connection health (offering a "Connect…" path when unconnected) but never holds credentials, and pure utilities stay shared libraries, never plugins. The catalog is the single source of truth feeding both surfaces; adding a tool is one manifest entry. (ADR-0101.) The catalog now includes a **Websites & Domains** group: a WHOIS Lookup that retrieves public domain and IP registration data (RDAP-first, with a legacy port-43 fallback for ccTLDs), and a Safe Website Viewer that renders a suspect URL in an isolated remote browser and returns a snapshot — screenshot, redirect chain, extracted text, and outbound links — so the live page never loads in the user's browser. It has two modes: **Static** opens each address in a fresh remote browser and returns a picture of it, and **Live** streams one held remote browser per member to their screen and forwards their pointer and keyboard to it, so a link's steps can be clicked through with cookies intact, closing it after a short idle period. Either way the page runs only on the remote machine: Static returns inert data, Live returns frames of the remote screen and takes input as data, never markup or script. In Live every document the remote browser requests for the whole session — each redirect and each navigation the page starts itself — is checked against the shared SSRF guard, not only the address typed. Both tools are firm-internal security-hygiene utilities, not matter work, and are available to all staff roles. The shared SSRF guard that validates every user-supplied outbound target before any fetch or render is a platform invariant for all future outbound tools.

**Candidate future ports (catalogued, not yet built).** Beyond the launch ports above, the categories below are tracked as future integration candidates. Like legal research, each follows _design the port now, license the adapter when vendor access is confirmed_ — provider access, terms, and historical-data depth are procurement-gated, not engineering blockers. The disposition tag marks whether a category leans **built-in** (a native feature, with external data pulled through an adapter only where a provider's infrastructure requires it) or **plugin** (its own Worker behind a port). Naming a vendor is illustrative, not a selection.

- **Public records · people search · skip tracing** — _built-in, high priority_ (LexisNexis Accurint/CLEAR, TLOxp, Tracers, IDI). Service of process, asset and witness location, and **conflicts/intake enrichment** (_Conflicts Check_, _Client intake / CRM_); pairs with the property-data ports. The feature is native; data is sourced through an adapter unless a provider's access model forces a plugin boundary.
- **Document comparison · proofreading · metadata scrubbing** — _built-in_ (capability modeled on Litera/DraftWise/Workshare): redline, proofread, and strip metadata on every outbound document. Belongs with _Documents_, not a plugin.
- **Transcription · dictation** — _built-in, tied to the telephony port_ (_Communications layer_): extends call recording and transcription to deposition and dictation capture → text → time entries and draft notes; the speech engine is swappable behind the feature.
- **Practitioner wellbeing · work-session nudges** — _built-in_ (health-data adapters illustrative: Apple Health, Google Health Connect, Fitbit, Garmin, Oura): notice a long unbroken working session — the signal is already in-house, from timekeeping timers and app activity — and suggest a proportionate action: stand and stretch, step outside, hydrate, take a real meal break, stop for the day. Sustained patterns escalate to the resources already carried in `@magna-carta/wellbeing-resources` (the per-jurisdiction lawyer-assistance and mental-health directory), so a nudge can hand off to real help rather than dead-end at a reminder. Two hard constraints, because the same timer data is what the firm bills from: the feature is **user-scoped and opt-in, and its observations are never visible to management** — this is a wellbeing surface, not a productivity-surveillance one — and wearable or biometric data, if a user connects it, is pulled through an adapter, treated as its own sensitivity class, and never enters telemetry.
- **Process serving** — _plugin, high priority_ (ABC Legal, Proof, First Legal): order and track service of process, with the affidavit of service returned to the matter.
- **Identity / AML · KYC · sanctions & PEP screening** — _plugin_ (ComplyAdvantage, LSEG World-Check, Onfido, Persona, Trulioo): client due diligence at intake, feeding _Conflicts Check_ — a compliance gap most US competitors leave open.
- **AI drafting / legal-AI assistant** — _plugin_ (Harvey, Spellbook, CoCounsel, Gavel): a drafting and review surface distinct from the legal-research port and from native document assembly (_Document Automation_).
- **Automation bridge** — _plugin_ (Zapier, Make, outbound webhooks): a no-code catch-all over the OpenAPI surface for the long tail of integrations not built natively.
- **Property data** — _plugin_: parcel/APN lookup and point-in-time AVM valuation (date-of-death, date-of-separation); provider landscape and legal use cases in [`docs/research/property-data-integrations.md`](research/property-data-integrations.md).
- **Practice-area-gated plugins** — remote online notarization (Proof, NotaryCam, OneNotary, complementing e-signature); court reporting / deposition scheduling (Veritext, Steno); medical-records retrieval (ChartSquad, Ontellus, Arctrieval — personal-injury / mass-tort); translation / interpretation (LanguageLine, Stratus Video); expert-witness directories (JurisPro, SEAK).
- **Operational connectors** — _plugins, lower differentiation_: accounting beyond QuickBooks (Xero, Sage), BI / reporting export (Power BI, Tableau), HR / payroll (Gusto, ADP), tax 1099/W-9 (Track1099), e-fax (Documo, SRFax), and marketing / reviews (CallRail, Birdeye).

---

## 11. Maintenance agents

Scheduled Claude agents + CI tooling, all **propose-only** (open PRs/reports, never auto-merge), with trust/ledger/conflicts paths always requiring human review.

- **Security agent** (pnpm/cargo audit, CVE triage, secret scanning)
- **Dependency + language/framework upgrade agent** (Svelte, Rust, Tauri, Workers)
- **Cloudflare platform-watch agent** (D1/Workers/Containers changes)
- **Compliance-watch agent** (bar/IOLTA rule changes → keep the trust catalog current)
- **Competitive-watch agent** (competitor changelogs/feature pages → flag new features and gaps)
- **Diagnostics agent** (triage incoming bug reports, correlate to traces)
- **Docs-maintenance agent** (draft `[Unreleased]` changelog entries from merged PRs and roll roadmap status up from the changelog; flag docs-coverage gaps — a user-visible change with no `docs/user/` guide, a design change with no ADR, a dangling `ADR-NNNN` reference)

**Boundary (ADR-0058).** The docs-maintenance agent does **mechanical drafting and coverage-gap flagging only** — it never originates design narrative or user-guide prose (that ships **in-commit** with the change author, per _Development guidelines_ and the docs-in-commit rule) and never auto-merges. **Deterministic doc hygiene is CI, not the agent:** the cross-reference rule (a `§N` reference from outside this paper), dead/broken links, and an empty-`[Unreleased]`-on-a-user-facing-PR gate are `vp check` lint rules — cheaper and more reliable than an LLM. The agent carries only the judgment-bearing residue.

---

## 12. Observability and diagnostics (first-class pillar)

Designed around one principle: **diagnose without exfiltrating privileged content.**

- **Three data classes:** technical metadata (always logged), opaque identifiers (pseudonymous, safe), content (never in telemetry raw).
- **Redact-by-default (allowlist, not blocklist):** events are assembled from explicitly-allowed fields; a scrubbing pass at the boundary is the second line of defense.
- **Correlation over content:** every request carries a correlation ID; errors surface a user-visible **Error ID** mapping to the server-side trace.
- **Per-firm scoped telemetry**; only non-sensitive technical aggregates roll up globally.
- **No session replay.** **Diagnostics access is itself audited**, with retention limits.

### 12.1 Two layers

- **Operational telemetry — always on.** Redacted structured server logs/traces (Workers Logs/Logpush → R2 / Analytics Engine), keyed by correlation/Error ID. This is infrastructure monitoring, not "reporting errors to developers": it records _what happened and where_ so that, when a user does report, the Error ID resolves to a trace.
- **Incidents — user-initiated only.** The developer-visible, agent-actioned **report** is created **only when a user chooses to send it.** Nothing about a specific failure escalates to developers or agents without the user's action (or their standing consent — see _User-configurable diagnostics_).

### 12.2 Client capture & "Send to developer"

An **in-house client reporter** (no third-party SDK, so privileged stacks/context never egress): a Svelte **error boundary** plus global `onerror`/`unhandledrejection` handlers catch failures, generate and display a short **Error ID**, and maintain a **client-side breadcrumb ring buffer** — recent actions and IDs, never field content. Two surfaces:

- **On a crash:** the error screen/toast shows the Error ID and a prominent **"Send to developer"** button.
- **Always available:** a **"Report a problem"** affordance in the help menu, usable when nothing errored (a confusing flow, wrong-looking data) — no Error ID in that case.

### 12.3 The report (incident)

On send, the payload is: the **Error ID(s)** · the **redacted breadcrumb buffer** · the user's **free-text description** · an **opt-in, user-redactable screenshot** · context metadata (route, app version, timestamp). No privileged field content; the description and screenshot are the only user-authored parts and are treated as sensitive. Transport is a POST to a **bug-report Worker**; the incident is a **firm-scoped** D1 row (screenshot to R2), linked by Error ID to the already-captured server trace. Description/screenshot are **access-gated and audited**; only redacted technical aggregates roll up across firms. Staff _and_ client-portal reporting use this same path, both redacted.

### 12.4 Diagnostics agent pipeline

Submitting a report enqueues the **diagnostics agent** (the _Maintenance agents_ diagnostics agent, now specified), which acts autonomously but **propose-only**:

1. **Triage** — classify, deduplicate against known/similar incidents, correlate to the server trace by Error ID, set severity.
2. **Diagnose** — draft a root-cause analysis from trace + breadcrumbs, naming the likely faulty code path.
3. **Propose a fix** — open a **draft PR** (never auto-merged; money/trust/conflicts paths always require human review).
4. **Acknowledge the user** — post receipt and, later, resolution status back to the reporter in-app/portal, closing the loop.

### 12.5 User-configurable diagnostics

A **diagnostics setting** (per firm, with per-user override) controls **whether** diagnostics are sent and at **what detail level** — one control, one pipeline:

- **Off / strict (default):** user-initiated only; minimal payload.
- **Standard:** user-initiated, with the full breadcrumb buffer attached.
- **Verbose / auto:** **standing consent** to auto-submit crashes with fuller breadcrumbs — the **beta-testing posture** (high signal during beta while production defaults stay strict). The difference is one consent level, not a separate system.

### 12.6 Confidentiality & stack

**In-house, Cloudflare-native:** the client reporter (ours), the bug-report Worker, **D1** incidents, **R2** screenshots, and a **Queue → diagnostics agent**. **No third-party error SaaS** — privileged content and stacks never leave to a vendor (the same confidentiality logic as in-house file conversion); **self-hosted Sentry** stays a deferred option only if richer grouping is later wanted. User-initiated by default, redact-by-default, screenshots opt-in/redactable, access-gated + audited, no session replay.

### 12.7 Telemetry analytics tier (ADR-0056)

The always-on operational telemetry (_12.1_) ships to **Workers Logs/Logpush → R2** and **Analytics Engine**; Analytics Engine is the **MVP query path** and stays so. Beyond it sits the **Logpush → Pipelines → R2 Data Catalog** tier: register the redacted structured logs already landing in R2 as **Apache Iceberg** tables via **R2 Data Catalog** (Cloudflare's managed Iceberg REST catalog — Parquet; JSON also available), then query them with DuckDB/Spark/external BI at **zero egress**. The point is the **seam**, not the build — it sits on data Logpush already writes, so adopting it is a configuration step, not a re-architecture. **Compaction and snapshot expiration (including data-file cleanup) are now automated** on this tier. Analytics Engine retention is **~90 days (verify current)**.

**Scope is deliberately narrow:** this tier reads only **redacted, cross-firm aggregate operational telemetry** — exactly the class the pillar already permits to roll up globally (_12_) — so it never touches per-firm privileged data and stays clear of the tenancy/isolation boundary (_Tenancy and data isolation_). Any future per-firm Iceberg use would demand strict per-firm table scoping and is **out of scope here**.

**Adopt when** Analytics Engine's ceilings actually bind: (1) **retention** past ~90 days (long-horizon ops/incident trend mining); (2) **sampling fidelity** — exact, unsampled counts where Analytics Engine adaptively samples under load; (3) **query power** — rich joins or external engines/BI over telemetry; or (4) **cost at scale** — cataloging the existing Logpush-in-R2 data beats scaling Analytics Engine writes. Reuses the **Cron-triggered Workflow → per-firm R2** fan-out pattern already established for backups (_Database backup & disaster recovery_).

### 12.8 Product-usage analytics

Product-usage analytics answers which features are actually used — the `usage.feature` event category, which records `reached` (a user arrived at a feature surface) and `completed` (a firm-level workflow completed), on the same one telemetry path as the operational events above. The events are **content-free**: no matter IDs, no party names, no document titles — only `{ feature, phase, surface }` drawn from a versioned feature taxonomy.

**Consent is opt-out, mirroring the diagnostics setting (_12.5_).** Usage analytics is always-on per firm (`usage_analytics.enabled`, default true) with a per-user escape hatch (`member.opted_out_of_usage_analytics`). Both flags are resolved at emit time, off the hot path via a cached consent resolver.

**Identifiers are pseudonymous.** `firmId` and `userId` are HMAC-pseudonymized under a server-held pepper before any event is written. A missing pepper causes the event to be dropped (fail-closed) — plaintext identifiers never reach the dataset.

**Queries are cross-firm aggregate only**, with small-n suppression (`k = 5`): any cell drawn from fewer than five distinct firms is suppressed and its count reported separately, never silently hidden. Live aggregate counts flow through the **Analytics Engine `usage` dataset** (the same MVP path as operational telemetry). Full-fidelity per-firm/per-user analytics — funnel drop-off, feature retention, dead-feature by distinct users — run over the shared **Iceberg tier** (_12.7_) once the Logpush→Pipelines step is provisioned (a later Cloudflare-infra step). Canonical queries: [`docs/analytics/usage-queries.md`](analytics/usage-queries.md).

**The client beacon** — emitting `reached` events for pure-client surfaces with no server round-trip — is a **documented seam, deferred until there is client traffic**. Server-side `reached` (route→feature middleware) and `completed` (outbox sweep, topic→feature) are built and live now (ADR-0106).

---

## 13. Performance & concurrency model

Speed is a stated goal (_Vision and goals_) and a guiding principle (_Guiding principles_); this is how it is engineered, not bolted on. The model is **deliberate compute placement + a measure-first discipline** — not generic "multi-threading." On this stack, concurrency and parallelism live in specific tiers, and the foundation's job is to put each unit of work in the right one.

**Compute-placement model — what runs where:**

- **Request handlers (Workers):** latency-sensitive CRUD and orchestration only; lean, within the per-request CPU/memory budget. **Never buffer large data in a Worker — stream** (as the bulk-download zip already does). Concurrency at the edge is the platform's (many isolated instances); you do not thread a Worker.
- **Heavy / CPU-bound work → Containers + Queues:** OCR, search indexing, document generation, conversion, and discovery extraction run as **native Rust in Containers** (real threads, no Worker limits), fanned out through **Queues**, with a **Durable Object per job** tracking progress (the conversion/discovery pattern).
- **Untrusted-input processing is sandbox-hardened (the primary malware defense).** These Containers run native parsers (LibreOffice, FFmpeg, libvips/ImageMagick, ghostscript, qpdf) over **untrusted uploaded files** (_Matters and File Manager_ threat model), whose recurring malformed-input RCE class is the one malware threat that targets _our_ infrastructure rather than a downstream user. Containment, not detection, is the main control, scoped so that a fully-compromised job gains nothing: **no egress** (Cloudflare Containers `enableInternet = false`, or a strict `allowedHosts` allowlist — DNS resolves only to Cloudflare, so no DNS-tunnel exfiltration); **least-privilege per job** — the instance gets the single file it processes, never firm-wide R2 credentials, D1 access, or any encryption key (keys never enter the processing path — _Encryption and key management_); **ephemeral** (reset/destroyed per job, so a warm instance never leaks across jobs or firms); **resource caps + timeouts** (a malformed file that spins or OOMs is contained, not a DoS); and **assume-escape** (the above hold even past a container break-out). Where _we_ author the parser, the **Rust→WASM core** is itself a sandbox (memory-safe, no syscalls) — native tools are where this hardening earns its keep. Practitioner home: [`security.md`](conventions/security.md) _Untrusted file handling_.
- **Stateful coordination → Durable Objects:** single-threaded by design — live timers, Collabora doc sessions, job orchestration. Used for correctness/serialization, not compute.
- **Shared Rust core (WASM + native):** the compute-heavy parity features (document engine, discovery parsing) — tight memory control and parallelism where it pays, identical on web and desktop.
- **Browser:** keep the **UI main thread free** — **Web Workers** for CPU-bound work, **virtualization** for large lists, per-route **code-splitting**, no client-data caching.
- **Desktop (Tauri):** real multi-threaded Rust for local accelerations (bulk ingest, OCR, local Tantivy index).

**Resource discipline (RAM/CPU):** stream, don't buffer; paginate; avoid N+1 (batch/join in the DAL); keep Worker memory bounded and offload past the budget to Containers; bound queue concurrency. These are defaults, enforced in review.

**Measure-first:** optimize against evidence, not speculation — **no speculative pre-threading or micro-optimization.** The fixtures **load profile** (_Synthetic data & fixtures_, thousands of matters) is the standing performance/scaling harness; profiling decides when hot-path logic is promoted to Rust→WASM (_Delivery model_). **Concrete per-tier budgets and CI performance gates are deferred** until there is code to measure — the _model and discipline_ are foundational now; the _numbers_ arrive with the code (the seam is intentional).

---

## 14. Settings & configuration

Configuration is spread across the platform (trust profiles, rate cards, increments, matter numbering, locations, branding, plugin credentials, diagnostics, notifications, personal preferences). Settings are engineered as a **framework, not a pile of pages** — so they scale manageably and stay consistent.

**Declarative settings registry (the formula).** Each setting is declared **once** with a standard shape: `key`, label/description, type, **scope**, **default**, **access** (view role + edit role), validation, and `audited` / `effective-dated` flags. The Settings UI is **generated from the registry** — adding a setting is a registry entry, not a new screen. One renderer, no bespoke per-setting pages; the same data-driven discipline as the conversion format registry and design tokens. This is what keeps settings from sprawling as they multiply.

**Scope & resolution.** Settings resolve along a precedence chain, most-specific wins — mirroring rate resolution (_Time tracking_): **entity override (matter/client) → user → location (_Locations_) → firm default → system default.** Each setting opts into only the scopes it needs (a theme is user-only; trust rules bind per account; increments are firm default with per-client/matter override).

**Access by user level.** Each setting declares the **role required to view** and to **edit** (RBAC — _Authentication, access control & encryption_). Firm, financial, and security settings → Owner/Admin; personal preferences → the user; some are visible-but-read-only to lower roles. The generated UI shows only what the user may see and locks what they may not change — **enforced server-side in the firm-scoped DAL**, never UI-only.

**Storage (no duplication).** Placement follows the tenancy model (_Tenancy and data isolation_): identity-level user preferences in the control-plane; per-user firm-scoped settings (role, rate, location, personal app prefs) on the **`member`** row; firm business settings in per-firm D1. Settings is a **surface + framework over data the subsystems already own** — trust profiles (_Trust accounting_), rate cards (_Time tracking_), matter numbering (_Matters and File Manager_), locations (_Locations_), plugin credentials (_Plugin system_), the diagnostics setting (_User-configurable diagnostics_) — it registers and renders them, it does not copy them.

**The Settings area.** Registry-driven categories, each shown per access: **My Account** (profile, 2FA/security, notifications, personal app preferences); **Firm** (profile, locations, users & roles, matter numbering, branding); **Financial** (rate cards, increments/rounding, billing, trust jurisdiction profiles); **Documents & templates**; **Integrations** (plugin credentials); **Diagnostics**; **Appearance** (theme/tokens).

**Change discipline.** Settings writes go through the DAL; financial, security, and firm settings are **audited** (who/what/when) and **effective-dated** where it matters (rates), consistent with the immutability principle (_Guiding principles_).

---

## 15. Notifications

A notification has two separable concerns the platform keeps in **one home**: the **decision** — an event happened, _who_ hears it, through _which_ channels, does that recipient _want_ it, is it _read_ — and the **delivery** — rendering a template and pushing it out. Notifications owns the decision and the in-app delivery, and **delegates external delivery to the _Communications layer_ ports** (email/SMS/voice), reusing existing primitives for the rest. This gives the scattered triggers a single home: the deadline/payment/report-ready reminders the _Communications layer_ sketched as a "trigger engine," task assignment + escalation (_Tasks and workflows / matter plans_), docketing reminders (_Calendar and rules-based docketing_), job-completion (_In-app file conversion_), custodian release reminders (_Custodian_), conflicts hits (_Conflicts Check_), portal activity (_Client portal_), and diagnostics acknowledgements (_Observability and diagnostics_) all become **notification types**, not parallel per-feature code. This relocates the trigger-engine _brain_ out of the _Communications layer_, which becomes pure channel transport Notifications drives (ADR-0047 amended).

### 15.1 The notification registry

Every notification is a declarative **type** in a registry — the "notification templates" category _Architectural integrity & coherence_ anticipated, the same data-driven discipline as the _Settings & configuration_ registry and the conversion format registry. Each type declares: a `key` and `category` (`tasks`, `deadlines`, `trust`, `billing`, `security`, `jobs`, `portal`, `conflicts`, `system`); an **audience** — **internal** (a firm `member`) and/or **external** (a _Directory_ entity) — the single field that unifies the staff bell and the client appointment-reminder under one model; a **severity** and whether the type is **mandatory** (non-silenceable) or opt-out-able; the **channels** it is eligible for, each with a **default routing**; channel-aware **templates** (in-app card, email subject/body, SMS body) drawn from the canonical glossary for domain-fluent microcopy; a **cadence** (immediate / scheduled / digest-eligible); and an `audited` flag. Adding a notification is a registry entry, machine-introspectable by the coherence **fitness functions** (_Architectural integrity & coherence_) — every declared channel has a template; mandatory categories declare no opt-out; a notifiable-looking event that does not route through the registry is flagged.

### 15.2 Recipients & preferences

Recipient resolution yields either a firm **`member`** (internal) or a **Directory entity** (external — always a known, conflict-checkable entity, never a shadow list, consistent with the _Client portal_). Per-recipient channel routing is a **My Account** category in the _Settings & configuration_ registry, resolving along the standard scope chain (**user → firm default → system default**): a per-user matrix of type/category × channel. **Mandatory categories** (security, trust-compliance) **cannot be silenced** — they mirror the non-optional stance of the audit log and the security factors; the generated UI shows them locked, enforced server-side in the firm-scoped DAL. External routing additionally honors the _Communications layer_ ports' **STOP/HELP opt-out and TCPA consent** state — Notifications requests a channel, the port enforces eligibility.

### 15.3 Delivery — the in-app center & channels

Every notification is a **per-firm D1 row** (firm-scoped DAL) the instant its event fires: recipient, type, a rendered payload of **IDs + non-sensitive display fields** (never privileged content), severity, `createdAt` (UTC `Temporal.Instant`), per-recipient `seenAt`/`readAt`, and a **canonical deep-link** target (_URL & navigation architecture_). The staff **notification center** ("the bell") is the live aggregation of a user's rows — unread badge, grouped/filterable list (by category/matter), mark-read, click-through. Bulk content never enters the row; a notification _references_ a document/email/invoice, never embeds it.

Channels, **v1 subset vs. seams**:

- **In-app** (v1) — the center above; the one channel Notifications delivers directly.
- **Email** (v1) — via the _Communications layer_: the transactional provider for system/billing, the matter mailbox where it belongs to a thread.
- **SMS/MMS** (v1, where type + recipient warrant) — via the `messaging` port (appointment/deadline/payment reminders).
- **Web push** (seam) — Push API subscriptions + VAPID; the app-shell service worker (_Delivery model_) is the hook, subscription infrastructure deferred.
- **Desktop-native / tray** (seam, rides Tauri) — the _Delivery model_ parity row's native notifications: the same rows, a different presenter, with the web in-app center as the fallback (parity preserved).

### 15.4 Raising events, scheduling & freshness

A single **`notify(type, context)`** port raises a notification — but a port one can forget to call is not a seam (_Architectural integrity & coherence_), so the high-value raises are **co-located with an existing unbypassable path**: money/sensitive notifications (payment received, trust below-replenishment, reconciliation due) raise from **the same write that lands the audit-log entry**; task assignment raises from the task write path; a conflicts hit, a portal upload, a computed deadline, and job completion each raise from their own seam. Fan-out runs **off the hot path** (_Performance & concurrency model_): resolve recipients → resolve enabled channels → persist the in-app row → enqueue external dispatches through the ports via **Queues**, so raising never blocks the request handler.

Two production paths feed the registry. **Immediate** notifications raise synchronously from a domain event. **Scheduled** reminders (deadline "3 days before," will-release-on-death, retainer-below-threshold, reconciliation-due) are materialized by a **Cron-triggered Workflow** that sweeps due reminders per firm (the fan-out pattern of _Database backup & disaster recovery_); deadline dates are computed in the **court's zone** (_Foundational data & runtime conventions_) so a reminder fires correctly regardless of which office a user sits in. **Digest** rollup ("5 new items" → one summary) is a cadence the type model carries but a v1 **seam**.

**Freshness honors the deliberately-minimal realtime stance** (_Delivery model_ → Client data & state architecture): delivery is **always durable** (the row exists regardless of presence), and the bell refreshes through the existing mechanisms — **refetch-on-focus + cross-tab BroadcastChannel invalidation + a cheap unread-count poll** — bounding staleness to seconds with no global push layer. **Job-completion notifications ride the per-job Durable Object channel that already exists** for instant delivery (reuse before building). A **per-user Durable Object push channel** is the documented seam — extending the DO-per-job primitive the _Delivery model_ already names — adoptable later behind the same call sites without touching producers.

### 15.5 Confidentiality, isolation & enforcement

A notification is telemetry-adjacent and must not become a leak (_Observability and diagnostics_). **External channels carry no privileged content** — an SMS/email reads _"A new document is ready in matter 8181-3"_ with a deep link, never the content or a privileged caption; bodies are assembled allowlist-style from non-sensitive fields + IDs. **In-app** notifications may show more (rendered behind firm auth + RBAC + ethical walls) but still reference rather than embed. Crucially, **visibility re-checks access at read time** through the firm-scoped DAL: an ethical-walled or since-revoked user never sees a notification for a matter they can no longer access — a stale row is filtered, never an existence oracle (the 404-not-403 logic of _URL & navigation architecture_). Rows are **per-firm and recipient-scoped** — no notification crosses firms. Preference changes and the dispatch of audited categories (trust/security/billing) are themselves **audited** (metadata only). (ADR-0059)

---

## 15a. AI / inference

**The shared model chokepoint — `@magna-carta/inference`.**

Every AI feature in the platform reaches the model through a single credential-less pure package (`@magna-carta/inference`) that owns the confidentiality, tenant-isolation, and fairness control plane. No feature talks to the gateway directly.

- **`InferencePort`** names two operation families: text generation (streaming for interactive first-token-latency paths; durable/Workflow-invocable for long or agentic runs that need resumption) and a platform-fixed embedding operation. The reasoning model id is an explicit operation parameter, read per call site through the firm-scoped data-access layer; the embedding model is a platform constant pinned to the Vectorize index version — per-firm embedding variation is unrepresentable in the signature by design (a swap would invalidate the index and force a full reindex).
- **Curated model catalog.** An in-repo, `ToolManifest`-style data table — the single source of truth for which models exist, what they retain, and which slot they may fill. Every reasoning entry carries `zdrEligible: true`; a non-ZDR reasoning entry cannot enter the catalog. Module-load validation (zod) makes a malformed or non-ZDR entry fail loud at import, not at first inference. `claude-fable-5` is excluded (mandates 30-day retention; non-ZDR by construction).
- **Per-firm model selection.** The firm's primary reasoning model is stored in the per-firm `setting` table via an inference-owned `FirmSettingDefinition`; the schema is a refinement over the ZDR-eligible reasoning subset, so an off-catalog or non-ZDR model id is rejected at the write path. Reads are total — a firm that never configured the setting gets the safe default.
- **Confidentiality control plane (pinned on every request).** ZDR is on at the gateway level; `collectLog: false` is pinned via the AI binding's `gateway` options on every request (the binding toggle is all-or-nothing — no prompt or response body is ever logged); `skipCache: true` is pinned on every request (the default cache key carries no firm dimension under Unified Billing — a cross-firm cache collision is otherwise possible). A fail-closed per-request ZDR guard runs before dispatch and rejects with a non-retryable problem on a miss — it never silently downgrades. ZDR is a diligence obligation backed by named Cloudflare/Anthropic procurement artifacts; those artifacts gate the first real AI feature, not this plumbing layer.
- **Tenant isolation.** Firm metadata (`firm_id`, `slot`, `env`) is derived in the implementation, never caller-supplied; keys are opaque ids, ≤5, never client/matter text. Authoritative per-request token usage is captured from the inference response (not the logs) and written through the firm-scoped data-access layer as the durable, reconcilable metering record — it feeds the firm-usage diagnostics surface (_Observability and diagnostics_). Gateway spend limits and metadata dimensions are real-time guardrails only, never the billing source.
- **Multi-tenant fairness.** All firms share one gateway per environment (the 20-gateways-per-account cap forecloses gateway-per-firm). Inference dispatches off the hot path via a Queue so a single firm cannot exhaust the shared gateway rate cap or credit pool synchronously. A firm-scoped spend rule keyed to the `firm_id` metadata dimension is the real-time per-firm guardrail; an account-level credit alarm fires below exhaustion. The named scaling switch point is per-firm BYOK (rate-exempt) or an Enterprise rate lift when firm count grows.
- **BYOK credentialed adapter (deferred seam).** Built when a firm attestation requires it or the shared rate cap is measured-binding. It is the one place the integration framework's `ConnectionStore`/`CredentialStore`/`needs_reauth` lifecycle actually applies. The Unified-Billing↔BYOK crossover is a per-firm config switch, not a code change (_AI / inference_ in `docs/operating-costs.md`).
- **Client-consent model (open decision — ADR-0109 Proposed).** ABA Formal Op. 512 / Rule 1.6 make third-party-AI disclosure a confidentiality decision. Whether privileged matter content may go to a third-party frontier model, and under what consent, is an explicit owner decision recorded as ADR-0109 and required before the first AI feature ships. The strictest firms default to the on-Cloudflare Workers-AI path through the same gateway — the model-slot selection mechanism, not separate machinery.

_Document Automation_ (template generation, merge fields, PDF form-filling) and _Discovery_ (semantic search over the Vectorize index, retrieval-augmented assistance) and _Search_ (semantic query expansion) each reference this subsystem by topic name. The first concrete AI feature (drafting / retrieval-augmented assistance / discovery AI review) is the named consumer of these seams and owns its own spec, the consent UI, and the per-matter enforcement layer. (ADR-0111, ADR-0110, ADR-0113, ADR-0112, ADR-0109)

---

## 15b. Release channels

The platform can expose unfinished work to willing audiences before it reaches everyone — to de-risk releases, reward engaged firms with early access, dogfood internally, and gather structured feedback. The release-channel mechanism serves all four.

**The model — one firm attribute, three channels.** A single `firm.release_channel` column on the control-plane `firm` table (the same row that carries `status`, `per_firm_schema_version`, and `owner_user_id`) holds the value `stable | beta | alpha`. Nesting is `alpha ⊇ beta ⊇ stable`: an alpha firm sees everything beta sees. Default is `stable`. Channel is a property of the **firm**, not the user — every member of a firm shares one channel. This keeps audit and ledger entries coherent; mixed channels inside one firm would let an alpha user write data through in-progress code that stable colleagues see with no UI, an integrity hazard in a legal platform.

**Channels gate behavior, never schema.** The platform runs one fleet: the schema-migration runner marches every firm's database to the latest migration (a single `per_firm_schema_version` mirrors this on the control plane). That is a correctness invariant — a firm's trust ledger must never run unvetted code against real money. Release channels must not break it. The answer: **schema stays the single additive fleet union**. New features' columns and tables land in the one fleet schema up front — additive, nullable, unused until lit. Feature code ships dark to the entire fleet, gated off by a flag. Changing a firm's channel changes which flags evaluate to `on`; it does not fork the schema, diverge migrations, or produce a different build. A change that genuinely cannot hide behind an additive flag goes through the normal careful fleet rollout, not a channel.

**Two doors to one column, with different trust boundaries.** Both doors write `firm.release_channel`; they differ in who can reach them and what they may write.

- **Beta door — firm self-serve.** A dedicated firm endpoint (`PUT /api/v1/firm/release-channel`) accepts only `{ stable, beta }` — `alpha` is rejected at the door, so the alpha boundary is enforced structurally, not by convention. The endpoint is backed by a new RBAC permission `firm:manageReleaseChannel` (seeded to Owner / firm admin), enforced server-side in the firm-scoped data-access layer. Opting into beta requires an explicit consent acknowledgment in the request — who, when, the exact text and version of the statement — recorded in the per-firm `audit_log` alongside the channel change (event `firm.release_channel_changed`). Opting a legal firm's live data onto pre-release software is not a silent toggle: the acknowledgment is the gate. Leaving beta (back to stable) needs no consent. The Settings UI surfaces this endpoint as a bespoke section in a later frontend slice, not as a generated setting.
- **Alpha door — developer-only.** A secret-guarded platform endpoint writes any channel value including `alpha`. The same trust lane as `firm:provision` — no firm-facing surface can reach it. Dedicated internal firms are pinned to alpha for dogfooding; a real client firm reaches alpha only by deliberate developer grant. The audit home is the control-plane `auth_audit` (event `firm.release_channel_set_alpha`, `user_id` null, metadata `{ firmId, oldChannel, newChannel }`).

**Flagship and the `@magna-carta/feature-flags` wrapper.** Cloudflare Flagship is the flag engine: it supports custom targeting attributes, gradual percentage rollout with consistent hashing, typed variants, and audit history, and evaluates via the `env.FLAGS` Worker binding against KV and Durable Objects with no outbound HTTP — off the request hot path by construction. A thin `@magna-carta/feature-flags` package wraps the native binding; it centralizes evaluation-context construction, safe-default enforcement, and the flag catalog (`FLAG_CATALOG`) in one place, and lets tests substitute an in-memory fake without a live binding. All feature flags are declared in `FLAG_CATALOG`; each entry carries a `stage` (`alpha | beta | stable`). To gate a new feature, add an entry to `FLAG_CATALOG` and add a corresponding Flagship flag with the standard targeting rule: serve `on` when `channel in [beta, alpha]` (or `[alpha]` for alpha-only), optionally with a `%` rollout to ramp within a channel. Flipping exposure is a Flagship dashboard change — no deploy.

**Fail-safe defaults.** Every evaluation supplies a default equal to stable behavior (feature off). If Flagship is unreachable or a flag is missing, the default wins — a flag outage is invisible to users. The local Miniflare test pool does not support the Flagship binding shape; the optional binding declaration means it is absent in tests, and `resolveFlagEvaluator` falls back to all-off automatically. This keeps every test environment safe without special setup.

**Session and SPA delivery.** Session context reads `release_channel` from the control-plane `firm` row per request and builds the evaluation context `{ firmId, channel, role, userId }` — only non-privileged identifiers travel to Flagship. The resolved flag set for the current session is delivered to the SPA through the `/me` bootstrap response alongside the existing permissions payload, so UI gates need no second round-trip. One SPA bundle serves all channels.

**Alpha/beta visibility in the UI (Plan 2, frontend slice).** Any feature that is on because it is pre-stable must be visibly marked as in active development and carry a feedback affordance. The marker is stage-labeled — an alpha feature reads "Alpha," a beta feature reads "Beta" — because the two set different expectations. The enabling metadata is a backend rails concern (each `FLAG_CATALOG` entry carries `stage`); the UI treatment is a frontend decision. When a feature graduates, its `stage` flips to `stable` (or the flag is removed) and every marker disappears automatically — the visibility lifecycle is the rollout lifecycle.

**Spec:** [`docs/specs/2026-06-25-release-channels-design.md`](specs/2026-06-25-release-channels-design.md). Decisions: ADR for _Flagship as the flag engine_ and ADR for _channels gate behavior not schema_ (both recorded as pending fragments, numbered at merge).

---

## Part III — Core Domain

---

## 16. Core domain: Directory, Matters & Locations

### 16.1 Directory (renamed from LEAP's "Cards")

The single source of truth for every person and organization — modeled as a **graph of entities and typed edges**, not a flat list.

**Entities (nodes):**

- **Person** and **Organization** — distinct types, **equal data depth**. Every entity carries the full contact core (multiple typed emails/phones/addresses, notes) regardless of role. The types stay distinct; cases like a sole proprietor/DBA, a trust with trustees, or a court with judges are expressed through _relationships_, never by merging types.
- **Categories + custom fields:** an entity's category (attorney, judge, court, expert, vendor, medical provider, client…) is a per-firm classification label, not a schema variant; anything category-specific — a bar number for an attorney, jurisdiction for a court, specialty/rate for an expert — is a **custom field** the firm defines through the shared custom-fields engine that also serves matter types. Custom fields are typed, searchable, reportable, and usable in document automation, and carry stable identity: renaming one never breaks stored data or templates, retyping is non-destructive (a guided, reversible convert), and retiring one archives it without losing history. Custom fields _add_, never subtract — equal data depth is preserved.

**Names (done legally):** structured names (prefix/first/middle/last/suffix), plus **aliases/AKAs, maiden & former names** and a preferred/display name; organizations get legal name + **DBAs/trade names + former names**. **Name-change history** is retained — conflicts must still match a party who changed their name.

**Edges (typed):**

- **Affiliations** (person↔org): typed, dated (officer, employee, partner, member, registered agent, attorney-at-firm), with contact flags (primary, billing, do-not-contact). You contact whom you choose, never a whole org automatically.
- **Relationships** (person↔person, org↔org): first-class typed edges — spouse/family, guardian/ward, trustee, beneficiary, business partner (people); parent/subsidiary, successor (merger/rename), affiliate (orgs). These feed conflicts (related parties), estate planning (family trees), and corporate work.
- **Representation edges:** counsel _represents_ a party (within a matter).
- **Role assignments** (entity↔matter): role on the _link_, not the entity; one entity can hold multiple roles in one matter ("many hats").

**Identifiers & sensitive fields:** a typed identifier list — bar number, EIN/Tax ID (1099s), SSN, DOB, driver's license — used for conflicts, billing, and document generation. Sensitive fields (SSN, **EIN**, DOB, financial) get **field-level encryption and access control** (visible only to permitted roles, access logged), beyond record-level RBAC. Encryption is enforced structurally by the data-access layer's `protected()` field type, with an HMAC **blind index** so Conflicts can still match encrypted identifiers without decrypting them (see _Encryption and key management_).

**SSOT integrity:** **duplicate detection** on entry and import (fuzzy name + identifier match → "possible duplicate?"); **non-destructive merge** tooling that relinks every reference and preserves both histories — the subordinate is archived (never hard-deleted) and every repointed reference is recorded, so nothing is irrecoverable; a **guarded unmerge** safety net for reversing a recent, still-clean merge (once a merged entity has accrued new activity it cannot be cleanly split — post-merge data has no recoverable attribution to a former side; ADR-0086); and **soft-delete/archival** (never hard-delete an entity referenced by a matter or the conflicts log). Essential for the SSOT promise and for de-duplicating the LEAP import.

**Temporal history & audit:** key fields (names, addresses, affiliations, roles) are **time-bounded** (valid-from/valid-to) so the system can answer "what was true _then_" (the address at time of service; the corporate parent at deal time). Every change is audited (who/what/when), consistent with the immutable-audit principle.

**Legacy source-system ID** on every entity for LEAP migration traceability.

### 16.2 Matters and File Manager

- **Matter is the top-level access unit** and the cost center; you open matters directly (client is a Directory link, not a parent folder).
- Parties via Directory role-links; **configurable matter numbering** (the scheme may include an optional **location segment/prefix**); flexible **matter types** carrying type-specific fields, templates, and workflows (mixed practice).
- **Optional home Location:** a matter may be assigned to one of the firm's offices, which then supplies its number prefix, letterhead/remit-to on generated documents and bills, and per-location reporting; unassigned matters fall back to a firm default.
- **Lifecycle:** Intake → Consultation → Open ⇄ On Hold → Closed (ADR-0080, extended by the owner's rulings of 2026-09-05 and 2026-09-06). **Intake** is the walk from first contact to a consultation: the matter exists from the first call (so the caller is in the conflicts corpus and every intake step has a matter to be answered on) but carries no number of any kind, lives on the **Intake desk** rather than the docket, and _graduates_ when the firm's per-matter-type **intake procedure** lets it through. **Consultation** (the status formerly spelled _prospective_) draws its consultation number at graduation, is kept out of the main matter list, and is surfaced in a per-attorney **Consultations folder** (a virtual view, not a container) — each consultation is its own lightweight matter so its files never move on retention and its parties feed conflicts permanently (conflicts run at intake). **Open** (the client retained the firm) draws the matter number (ADR-0079). **On Hold** is an open matter the firm has stopped working without closing it — a client who has stopped paying, a party gone quiet, an instruction to wait — for a recorded reason; it keeps its number (no number is ever drawn or surrendered for a hold), stays on the docket wearing its status, leaves the active lists, and returns to Open when released. **Closed = archived but additive** — leaves active lists yet still accepts late-arriving documents and notes; closing runs a named **close-precondition hook** (empty until the Financial Core registers "all bills paid, no remaining balance"). Stale consultations are flagged by a per-firm age policy and bulk-closed; closed prospectives are retained forever as conflict history.
- **File Manager** = navigation over the matter's versioned R2 files (folders, document types, drag/drop).
- **Every stored object records its content hash** (SHA-256, computed at write time — ADR-0078): evidence-grade fixity for discovery and chain-of-custody, the _Document versioning_ delta-verification hash, duplicate-detection UX, an upload short-circuit ("these bytes are already held"), malware-scan verdict caching, and a no-op version skip (an explicit Save with unchanged content cuts no version). Retrofitting hashes later means re-reading every byte ever stored, so this lands with the File Manager itself (the build-when-in-the-area principle). **Cross-matter blob dedup is deliberately not decided** — sharing bytes across matters collides with ethical walls, refcounted destruction, and hold semantics; it gets its own design if measurement ever justifies it.
- **Bulk download (zip):** select files/folders or a whole matter → download as a single archive. A Worker **streams** R2 objects into the archive (never buffered in memory, so archive size is not bounded by Worker memory), **store mode** (legal files are already compressed — deflate burns CPU for ~0 gain), **ZIP64** always on (no 4 GB / 65,535-file ceiling), with each file's R2 object version **pinned at request time** for a consistent snapshot. Firm-scoped and access-checked (same RBAC + ethical-wall gate as viewing the files); client-portal downloads reuse the same engine behind portal auth; every export is **audit-logged** (metadata only, no content). A single-file selection downloads directly rather than being wrapped in a zip. A documented **seam** switches very large bundles (past a configurable file-count/size threshold) to an **async job → R2 artifact → signed URL**; v1 ships the live-stream path only.

> **Inbound large-file upload path — decided (ADR-0081; slice 1·1 design).** Uniform **direct-to-R2**: bytes never transit the Worker — it authorizes, mints single-key short-TTL presigned URLs, and records metadata. Two transfer modes behind one client library (Uppy, pinned): presigned PUT for small files, **resumable S3 multipart** (parallel parts, per-part retry, resume) above a configurable threshold — so large discovery/video ingest and flaky connections work from the File Manager's first release, and the _Client portal_ and _Discovery_ ingest reuse the path unchanged. Per-firm max-size/content-type policy (a _Settings & configuration_ registry entry) is enforced twice: refused at presign time, re-verified against the real bytes at the quarantine gate. Bytes land at their final key with **quarantine as a status gate** (not servable until the ingest consumer clears them — see the untrusted-file pipeline below); one consumer read performs magic-byte gates, SHA-256, the malware-scan port, and the version commit. tus rejected (no native R2 endpoint; reserved). Detail: the slice 1·1 spec in [`docs/specs/`](specs/).

> **Needs development — untrusted file handling (upload malware scanning et al.).** Every uploaded byte (File Manager, _Client portal_ contributed files, _Discovery_ ingest — the latter two arrive from _external / adversarial_ parties) is untrusted. **Threat model (the why):** a malicious file is **inert at rest** — it cannot corrupt, execute, or spread inside R2 — so storage integrity is not a threat; the file only matters when something **processes, serves, or forwards** it. Three realistic harms: **(1) server-side RCE** when _our_ native parsers (LibreOffice / FFmpeg / libvips·ImageMagick / ghostscript / qpdf) hit malformed input — the only threat aimed at _our own_ infrastructure; **(2) distribution** — we hand an infected file to a client, co-counsel, or a court (portal share, discovery production); **(3) stored XSS** — a malicious SVG / HTML / scripted-PDF runs script in _another user's_ browser on preview. The "their own bucket, their own problem" intuition holds only for the rare self-upload-then-self-download case; in this product files cross between principals and through our pipelines, so the victims are other staff, clients, co-counsel, and _us_.
>
> **The two threats that target us (1, 3) are defended _structurally_, not by detection — and those controls are built anyway** for conversion and preview, so they are the primary defense: **(1) → sandbox-hardened processing** (no-egress, least-privilege-per-job, ephemeral Containers — _Performance & concurrency model_); **(3) → safe delivery** (separate cookieless sandbox origin + CSP + `<iframe sandbox>` + safe-rendition preview — _Inline file preview_). Per-firm isolation caps cross-tenant blast radius. **Malware scanning is the remaining, thinner layer**, addressing mainly **(2)** — protecting downstream recipients and meeting the security-review / cyber-insurance expectation; with the structural controls in place it is defense-in-depth, not the linchpin. (If distribution risk is judged low, scanning can stay minimal — even WAF-edge-only — and lean on recipients' endpoint AV.)
>
> **Governing principle — borrow outside _expertise_, never outside _custody_.** Leaning on a security vendor (engine, signatures, CDR, threat intel, support) is right — we are not AV specialists — but for privileged legal files, shipping bytes to a third-party scanning **SaaS API** (attachmentAV, VirusTotal, etc.) is a **confidentiality / legal-ethics exposure** (a subprocessor holding client confidences), the same egress ruled out for _In-app file conversion_ and _Observability and diagnostics_. The filter on every option is therefore: **does privileged data leave infrastructure we control?** — not "in-house vs. commercial." A commercial engine run **on our own compute** is welcomed; a SaaS that holds the bytes is not.
>
> **Decision (now): build the scanner as a swappable port; defer the concrete engine.** Scanning is one layer of the untrusted-file pipeline below (the structural controls above are primary); no single scanner suffices (ClamAV ~60% detection; even commercial engines miss zero-days):
>
> 1. **Pre-acceptance gates** — authenticated upload; per-firm **size + content-type allow-list** (_Settings & configuration_ registry); **magic-byte** validation (not extension); decompression-bomb / nested-archive guards (zips are already stored opaque, _Discovery_); filename sanitization.
> 2. **Quarantine-on-arrival** — bytes land in R2 (via the direct-to-R2 path above) **not visible / not servable / not indexed** until cleared; scanning is **async** (object → **R2 event notification → Queue → scanner**), since direct-to-R2 means no Worker sees the bytes inline.
> 3. **Scan** — one or more engines behind the port (deferred choice below); **verdict stored as file metadata** (the `inlinePlayable`-at-ingest pattern, _Inline file preview_).
> 4. **CDR rendition (optional, document types)** — a **disarmed copy** (Glasswall SDK, or a Dangerzone-style pixel-rebuild via the existing LibreOffice/PDF render Containers) while the **original is preserved byte-for-byte** for evidence; catches the zero-days signatures miss.
> 5. **Safe delivery (structural, threat #3)** — separate cookieless sandbox origin + CSP + safe-rendition preview; full detail at its home, _Inline file preview_.
> 6. **Continuous & evidence-correct** — **re-scan sweep** on signature updates (today-clean ≠ forever-clean) via a **Cron Workflow** (the _Database backup & disaster recovery_ fan-out); audit every verdict; alert staff on hits; and **quarantine, never auto-delete** — an infected file in discovery/Custodian is **evidence**, destruction blocked by legal holds (_Document versioning & storage tiering_). The generic R2/S3 "delete-infected" default is wrong here.
>
> **Engine options behind the port (designed into later), ranked by data custody:** (a) **WAF content scanning** (_malicious uploads detection_) — Cloudflare's AV at the edge on proxy-transiting HTTP uploads; cheap, vendor-run, **detect-only**, **50 MB cap**, Enterprise add-on, and **does not see direct-to-R2 or at-rest objects** — so a useful **Layer-0 pre-filter** for portal/API form uploads, not the pipeline. (b) **Commercial engine in our own Cloudflare Container** (Sophos SAVDI, Bitdefender OEM SDK, Kaspersky Scan Engine, or OPSWAT MetaDefender) — outside expertise, zero egress, stays on Cloudflare; a _single_ engine fits the Container envelope (~12 GiB/instance), full MetaDefender multiscanning likely does not. (c) **Managed, in our own cloud account** (AWS GuardDuty Malware Protection for S3, or bucketAV-Sophos) — lowest burden on us and solves the large-file cap (Sophos scans to ~5 TB vs ClamAV's ~2 GB), but needs an **AWS/Azure ingest bucket** (a second cloud, since R2 has no native/managed scanning). (d) **ClamAV + premium unofficial signatures** (SaneSecurity/Securiteinfo) **+ YARA** — cheap on-Cloudflare baseline to validate the pipeline; needs a **private signature mirror** (`cvdupdate`, since freshclam's CDN rate-limits >10 hosts) and falls back behind the cap. Its own ADR. Tracked in _Hardening_ on [`ROADMAP.md`](../ROADMAP.md).

### 16.3 Locations (offices)

A first-class entity in the per-firm D1 representing one of the firm's physical offices — a multi-state practice runs several. The firm remains the tenancy/isolation/conflicts boundary (_Tenancy and data isolation_); a Location is a _dimension within_ it, referenced wherever physical location or office identity matters: matters, trust accounts, Custodian roots, users, and generated documents.

**Fields:** name/label; status (active/closed); one or more **physical addresses** + contact info; **jurisdiction** (state/territory, informational/default); **letterhead & branding assets** (logo, address block, footer, **remit-to**) for document automation and billing; an optional **matter-number prefix/segment**; and **staff assignment** (users belong to one or more locations, one designated **primary**).

**Usage across subsystems:**

- **Matters:** a matter **optionally** references a home Location; when set it supplies the number prefix, letterhead/remit-to, and per-location reporting. Unset matters use the firm default.
- **Trust accounts:** each trust account is **associated with a Location**; the jurisdiction trust-rule profile binds **per account**, so a firm can run several jurisdictions at once.
- **Custodian:** the physical-location hierarchy is **rooted at a Location** (Location → safe → box → position).
- **Documents & billing:** Location fields feed the data dictionary so generated documents and invoices carry the correct office identity.
- **Access control:** Location is a **view/reporting filter, not an access gate** — matters and data are available firm-wide (open by default), and users may filter lists, search, and reports by office. Hard per-location separation is a **reserved seam**. (Model: _Authentication, access control & encryption_; ADR-0068.)

**Soft-delete only:** a Location referenced by a matter, trust account, or custody record is closed/archived, never hard-deleted (consistent with the Directory SSOT discipline).

---

## Part IV — Financial Core

---

## 17. Financial Core

Built on a single **append-only, double-entry ledger** in D1. Transactions are never edited — only reversed with new balancing entries. This yields provable correctness, a full audit trail, trivial reconciliation, and complete history. The same ledger serves trust, billing, costs, and operating accounting.

### 17.1 Time tracking

The **daily driver** — every lawyer touches it constantly, so it is engineered for speed and keyboard-first capture above all. Time is tracked on **every** matter (billed on hourly matters; captured internally on flat-fee/contingency for profitability/realization).

**Entry methods:**

- **Single active live timer** — one timer runs at a time, bound to a matter (+ optional UTBMS code + narrative), with start/pause/stop; starting a new timer stops the current one. Timer state **persists server-side**, so it survives a tab close and **follows you across devices** (start on web, stop on desktop) and works **offline in Tauri** then syncs. A running timer is always visible in a global timer bar.
- **Manual entry** — duration _or_ start–end, free backdating, and a one-line **quick-add** ("0.5 Smith — drafted demand letter").
- **Weekly timesheet grid** — matters × days, for catching up a whole week at once.
- **Calendar-derived drafts** — turn a calendar event (meeting, hearing — _Calendar and rules-based docketing_) into a one-click entry (user-initiated; this is not passive capture).

**Anatomy of an entry:** date, timekeeper, matter (required), duration, narrative, billable flag, resolved rate, optional **UTBMS task/activity codes**, and a non-billable category for internal/admin time. Every change is **audited** (who/what/when).

**Increments & rounding:** configurable minimum increment (default **0.1 hr / 6 min**) and rounding rule; firm default with per-client/per-matter override.

**Rate resolution (effective-dated, with history):** matter rate → client rate → timekeeper standard → role default, supporting multiple **rate cards** (e.g., standard vs. insurance-capped). An entry keeps the rate in force on its date even after rates change.

**Narrative ergonomics:** snippet/abbreviation expansion, recent-narrative reuse, and per-task-code templates — minimizing keystrokes on the firm's most repeated action.

**Lifecycle — Draft → Billed, with an optional review gate:** **Draft (freely editable) → Billed (locked)** by default — no submit/approve step, so the daily driver stays frictionless. A firm may turn on an **optional review gate** (Draft → **Submitted** → **Approved** → Billed): the timekeeper submits, a reviewer approves or kicks back, and only approved entries bill. The gate is **off by default**, firm-configurable, and also hosts the future passive-capture draft-approve queue. Once an entry lands on a finalized invoice it locks; post-bill corrections are new adjusting entries (the entry freezes at billed/void — a column-level freeze, distinct from the ledger's append-only rule).

**Time is WIP, not a ledger posting.** Unbilled time lives in a **work-in-progress** store and does **not** touch the append-only double-entry ledger; at invoicing, billable time converts to an A/R receivable ledger entry. This keeps the ledger purely money-movement while WIP is independently tracked.

**Daily-driver visibility:** a **"My Day"** view with running billable/non-billable totals; **missing-time detection** ("5.3 of 8.0 h logged today"); billable-hour **targets** (daily/monthly/annual) per timekeeper; per-matter and calendar-overlay views. **Utilization & realization** roll up into _Reports_.

**UTBMS codes** on entries feed **LEDES e-billing** in _Billing_; matters flagged for e-billing require and validate codes. **Passive/automatic time capture remains backlogged** — the manual + timer experience is deep enough to stand alone, and the seam stays open for later.

### 17.2 Trust accounting

- Per-client trust ledgers with a hard **no-negative-balance** invariant (prevents commingling-by-overdraft).
- No commingling of firm and client funds.
- **Jurisdiction-configurable trust compliance engine** — a rules _profile_ per state/territory, parameterized along the dimensions where states differ (governing rule citation, retention period, reconciliation cadence, firm-funds-in-trust allowance, IOLTA model, advance/flat-fee treatment, overdraft reporting, electronic-payment handling, separate-account thresholds). Seeded with Nevada. **Rule numbers are never hard-coded** — confirmed by research, states use wildly different citations (OR 1.15-1/-2, NM 16-115, SC Rules 407/412/417, NY 22 NYCRR Part 1200).
- **Multiple active jurisdictions, profile bound per account.** A firm with offices in several states runs **several profiles at once**: each trust account is opened in a state and **carries its own jurisdiction profile + governing-rule citation**, and is **associated with a Location**. The matter's trust activity flows through the relevant account (defaulting from the matter's home location when set). This is exactly what the trust-rules catalog (_Open research workstreams_, 56 jurisdictions) exists to supply.
- **Interactive trust reconciliation workflow:** monthly bank reconciliation (manual entry or banking-plugin import) → match cleared items → flag outstanding/discrepancies → generate and archive a signed **three-way reconciliation** (bank = book = sum of client ledgers). **Reconciliation runs per trust account** — inherently per-jurisdiction/per-location — and the no-negative-balance invariant holds per client ledger within each account.

### 17.3 Billing

Supports hourly, flat/fixed fee, contingency (settlement disbursement statements splitting client share/fee/costs/liens), and retainer/evergreen (auto-replenishment alerts below threshold). Bills combine time/fees + costs + taxes. Invoices carry the **home Location's letterhead and remit-to** when the matter is location-assigned.

- **LEDES e-billing (v1).** For institutional/insurance-defense clients that require electronic billing: export invoices in **LEDES 1998B** and **LEDES XML 2.0/2.1**, with **UTBMS task/activity/expense codes** carried through from time and cost entries, **validation against client billing guidelines** (rate caps, block-billing/increment rules, required codes) before submission, and a path to electronic submission. Per-matter e-billing flag drives code-required validation upstream in _Time tracking_/_Costs and expenses_.

### 17.4 Costs and expenses (disbursements)

- Firm **advances hard costs** (third-party: court filing, recording, service, experts, postage/shipping) as a client receivable, then bills them back.
- **Soft/in-house costs** (printing, copies) tracked separately.
- Per-matter entries: type, vendor (Directory link), date, hard/soft, billable, optional **UTBMS expense (E-) code** (for LEDES e-billing, _Billing_). Markup and pay-from-trust are not enabled now but are easy to add. Integration auto-capture (PACER → filing fees, Pirate Ship → shipping, banking → operating disbursements) arrives with those plugins.

### 17.5 Operating accounting / general ledger

The append-only double-entry ledger extends to full firm operating books — chart of accounts, accounts payable, and financial statements. QuickBooks becomes an optional _sync_, not the system of record.

---

## Part V — Documents & Automation

---

## 18. Documents

### 18.1 Editing (Collabora & WOPI)

- **Editing:** **Collabora Online** on Cloudflare Containers — high-fidelity `.docx` editing with built-in real-time collaboration, storing real `.docx` in R2. Containers are spun up on demand by a Durable Object and sleep when idle. **Collabora is the sole editor:** one document model (real `.docx` as source of truth), one collaboration story (Collabora's built-in real-time editing), one thing to operate. A native Yjs/CRDT editor was considered and **deliberately not built** — a second editor would mean two document models and a permanent lossy `.docx ↔ CRDT` conversion seam, justified only if lightweight working-doc volume ever made per-session containers too costly. The seam stays open (native could slot in later as a _separate_ doc type with a one-way "finalize to `.docx`" handoff), but it is not on the roadmap.
- **Revision history:** **app-managed version objects**, not R2 native versioning (see _Document versioning_). Collabora handles in-document collaboration; our WOPI host decides when an edit becomes a retained version.
- Microsoft/WOPI was ruled out (licensing + vendor lock-in).

### 18.2 Document versioning & storage tiering

Revision history is **app-managed**, not delegated to R2 native object versioning. Native versioning is rejected for two confirmed reasons: R2 lifecycle has **no noncurrent-version action** (it cannot transition or expire previous versions — conditions are prefix + age/date on current objects only), so native versions accumulate ungoverned and every old version is billed; and we want **per-version storage class**, which native versioning does not allow us to control. App-managed keys give full retention control, clean semantics, and per-version tiering.

**Two decoupled concerns — the churning file vs. the retained version:**

- **Current working file** — a single key (`matters/{m}/docs/{doc}/current`) **overwritten in place on every save**, always **Standard** storage. It churns freely and never accumulates.
- **Versions** — immutable snapshots (`matters/{m}/docs/{doc}/v000042`) cut **deliberately**, never one-per-autosave.

**Why this matters with Collabora (autosave reality):** Collabora's WOPI `PutFile` callback fires every ~5 min for a doc with unsaved changes, every ~30 s for an _idle_ changed doc, once on last-editor disconnect, and immediately on explicit Save. Treating each `PutFile` as a version would mint hundreds of junk snapshots per session. Instead, autosaves only overwrite the churning `current` object; **version-cutting is a policy we own**, driven by the `X-COOL-WOPI-IsAutosave` header Collabora sends on every save:

- **Explicit user Save** (`IsAutosave: false`) → always cut a version (user signaled a state worth keeping).
- **Session-close save** (last editor disconnects) → cut a version (one clean snapshot per editing session).
- **Autosaves** (`IsAutosave: true`) → do **not** cut a version by default; optionally cut a **debounced** checkpoint at most once every N minutes as crash protection.

A heavy multi-hour session thus yields a handful of meaningful versions, not hundreds.

**Storage tiering — old versions to Infrequent Access, by transition not deletion:** a version is cold the instant it is superseded (history is read at most ~once a year). The moment a new version supersedes the prior one, the prior object is transitioned **Standard → Infrequent Access** via an **S3 `CopyObject`** with `x-amz-storage-class: STANDARD_IA` (same source/dest key — server-side, no bytes through the Worker, **no retrieval fee** since the source is Standard, one ~$0.0000045 Class A op). IA cuts version-history storage ~33% ($0.015 → $0.010/GB-mo) on the fastest-growing, coldest segment of the corpus. This is **tiering, never pruning**: every version is kept forever, IA is equally durable and instantly available, so it is safe under legal hold, Custodian, and discovery holds and is consistent with the append-only/immutability principle. Restore = copy an archived `vN` back to a new `current` (reading from IA pays one retrieval fee — rare, acceptable). No compression is applied to the **active corpus** — `current` and the latest version (already-compressed `.docx`/PDF/media; compression also breaks the direct-range-stream preview path in _Inline file preview_); superseded versions are eligible for the deferred delta-storage design below.

**Version-history delta storage — designed, deferred (ADR-0077):** successive versions of the same document are highly redundant, and superseded snapshots accumulate forever (tiering, never pruning), so storing old `vN` objects as binary deltas instead of full bytes is a real, compounding saving at platform scale — but not before measured churn exists (golden rule 10: at IA's $0.01/GB-mo with no minimum object size, a firm's full snapshots must reach ~100 GB before costing $1/month). The catch that shapes the design: `.docx`/`.xlsx`/`.pptx` are deflated ZIP containers, so a one-word edit scrambles the compressed byte stream and defeats any naive binary delta. The deferred pipeline attaches to the existing supersede-to-IA hook as an **async Queue/Container job** (never the Worker request path): re-pack the ZIP with entries _stored_ rather than deflated (the ReZipDoc insight — ~30 lines against any zip library, not a dependency), compute a **zstd `--patch-from`** delta against a base version (one tool for every format — normalized OOXML, PDF, images, generic binaries; Rust bindings fit the shared Rust doc core), **verify a roundtrip content hash**, then swap the IA object. The **latest version always stays a full object** and a **full keyframe every K versions** bounds reconstruction chains — no corrupted base may strand unbounded descendants, and the recorded hash keeps every version independently verifiable (the legal-hold/discovery defensibility bar). Recorded trade-off: a delta-encoded old version cannot be range-streamed for preview — history preview reconstructs first (acceptable at ~once-a-year reads). What is reserved _now_, because it is the only expensive-to-retrofit part: version metadata carries a **`storage_encoding`** discriminator (`full` today; later a patch encoding + base-version reference), and **nothing outside the firm-scoped data-access layer may assume a version object is raw file bytes** — the slice 1·1 File Manager spec carries this seam. Content-defined chunking (cross-document dedup — attractive for templated legal work) was considered and deferred harder: it multiplies object counts and operational complexity; revisit at discovery scale if measurement justifies.

**Storage metering — adopt-when triggers are observed, not hoped for (ADR-0078):** a per-firm rollup of bytes and object counts by storage class and key prefix lands with the File Manager (slice 1·1 — the build-when-in-the-area principle), feeding the existing Analytics Engine path (_Observability and diagnostics_). It is the instrument that fires this section's deferred gates — delta storage's ~100 GB/firm threshold, destruction economics at platform scale — and doubles as the per-firm billing/capacity number. Without a measurer, "adopt when measured" gates never fire.

**WOPI correctness:** the `current`-overwrite step is **timestamp-guarded** — the WOPI host honors `X-COOL-WOPI-Timestamp` and returns **HTTP 409 / `COOLStatusCode 1010`** when the stored file's timestamp doesn't match Collabora's expectation, preventing a stale clobber.

**Deleted files — trash → Infrequent Access → policy-driven destruction (capability built, default indefinite):** deletion is a **soft-delete** — a firm-scoped DAL state change that hides the record from the File Manager, never an immediate purge of bytes (consistent with the soft-delete discipline elsewhere — _Core domain_ Locations, _Directory_). The R2 object then moves through three stages:

- **Trash window (Standard, recoverable in place).** For a short grace period (**default 30 days**) the deleted object stays on **Standard** at its existing key, restored by clearing the flag — no copy, no retrieval fee. The window is sized to IA's **30-day minimum-storage charge** on purpose, so the common delete-then-undo churn never pays an IA penalty.
- **Cold retention (Infrequent Access).** After the trash window the object transitions **Standard → IA** in place via the **same server-side `CopyObject`** (`x-amz-storage-class: STANDARD_IA`) used for superseded versions — no bytes through the Worker, no retrieval fee (source is Standard), ~33% cheaper storage on a segment that is, by definition, no longer read.
- **Destruction (policy-driven, blocked by holds).** A per-record **retention/destruction date** can trigger a true **hard-delete** — the one place the platform deletes file bytes — but the **default retention is indefinite**, so out of the box every deleted file is kept forever (the _tiering, never pruning_ posture of version history). Destruction is **blocked by any legal/discovery/Custodian hold** (_Discovery_, _Custodian_) and audited like any irreversible act.

**Why build the destroy lever if it ships off:** at single-firm scale IA storage is cheap either way (~$0.12/GB-yr, egress free), but across the multi-tenant platform an unbounded "never destroy" pile becomes a **multi-petabyte, $1M+/yr-and-climbing** cost _and_ a latent legal exposure (an ever-growing discovery surface) — while bar **retention rules**, **client purge instructions**, and **privacy-law erasure** (GDPR/CCPA) can _require_ destruction the firm must be able to honor. Building the trash → IA → destroy machinery now, with retention defaulted to indefinite, gives keep-by-default behavior today and a switch the firm throws **per matter/jurisdiction** when an obligation actually arises — no re-architecture. This complements version tiering: **versions tier on supersession, deleted files tier on trash-window expiry**; both end in IA via the same `CopyObject` path, both honor legal hold. (Per-firm **crypto-shred** — _Authentication & encryption_ — remains the separate, whole-firm destruction path.)

### 18.3 Inline file preview (video first)

Files are **viewed in place, not download-first** — a video attached anywhere (matter files, discovery, Directory, Custodian) plays inline, with download always available alongside. This is one slice of a general "preview any file inline" capability, built video-first.

- **Delivery:** originals stream from R2 via a short-lived, **authorization-gated signed URL** (minted only after matter/RBAC checks), using native progressive playback. R2 egress is free, so playback costs effectively nothing. **Cloudflare Stream was rejected** — roughly 10x R2's storage cost plus metered per-minute delivery, buying only transcoding/adaptive-bitrate not yet needed.
- **Safe delivery of untrusted bytes (the stored-XSS defense).** Uploaded files are untrusted content (_Matters and File Manager_ threat model), and previewing them is a **client-side** execution risk that server-side sandboxing cannot touch — a malicious SVG/HTML/scripted-PDF runs script in the _viewer's_ browser. So untrusted bytes are served from a **separate, cookieless sandbox origin** (a `files.*`/user-content host, never `app.magnacarta.esq` — the model behind Google's `googleusercontent.com` and GitHub's raw host), with **`Content-Disposition: attachment` + correct `Content-Type` + `X-Content-Type-Options: nosniff`**, a restrictive **CSP**, and **`<iframe sandbox>`** around any inline render. **Active formats are never handed raw to the browser** — preview a **derived safe view** (rasterized/transcoded rendition produced by the sandboxed processing tier below), not the live file. Practitioner home: [`security.md`](conventions/security.md) _Untrusted file handling_.
- **Player:** **Vidstack** (MIT, web-component, Svelte-native), themed with Lucide icons for one consistent control bar across WebView2/WKWebView instead of inconsistent native controls. Plays progressive MP4 now; its HLS support stays dormant for the future transcoding path, so adding transcoding later needs no player swap.
- **Compatibility as data:** every file gets an **`inlinePlayable` verdict** at ingest (cheap container+codec sniff, no FFmpeg) — MP4/H.264/AAC and WebM are inline-playable, others show a download-only note. **Reports** rolls the verdict up firm-wide ("X% inline-playable") to target future compatibility work; no per-view logging.
- **Transcoding** for non-web formats runs in a **pure-Rust transcode engine** (a Container, MP4 rendition written back to R2) rather than Stream, to avoid metered fees, and rather than FFmpeg, so no C codec library parses untrusted video (the owner's 2026-11-10 "Rust only" ruling). It reads MP4, QuickTime and Matroska carrying H.264 or HEVC with AAC, MP3, PCM or FLAC sound; a format with no proven Rust decoder (WMV/WMA, MPEG-2, MPEG-4 Part 2, ProRes, AC-3) stays download-only until one exists. **Deferred:** clip/timestamp/annotation tools; transcript sync; adaptive bitrate.

### 18.4 In-app file conversion

A general **any-format → any-format** converter surfaced in the file manager — a differentiator no incumbent (Clio/LEAP) offers. Built **in-house** for three reasons: **confidentiality** (privileged files never egress — bytes go R2 → our Container → R2, never to CloudConvert/Zamzar), **margin** (reuses Containers/Queues already paid for; no metered third-party per-conversion fees), and **integration** (right-click → Convert, right where the file lives). The original is never mutated — every conversion writes a new object.

- **Coverage:** documents / spreadsheets / presentations (**LibreOffice headless** — already running for editing & automation), images and image↔PDF (**libvips**, ImageMagick fallback), PDF operations including **scanned PDF → searchable PDF** (the discovery **OCR** pipeline), audio/video transcodes (the **pure-Rust transcode engine** — the same engine that makes the preview's playable copy), and **email MSG/EML → PDF** (high value for producing email as exhibits).
- **Engine:** a unified **conversion orchestrator** (Worker) over a declarative **format registry** — a `(source → target) → {engine, recipe}` table with **multi-hop chains** (e.g. `WPD → ODT → PDF`) computed when no direct path exists. The registry is the single source of format knowledge: it both runs the job and answers "what can this file become?", so the **Convert to…** menu is data-driven, never hardcoded in the UI.
- **Execution (hybrid):** small jobs (a DOCX→PDF, one image) run in-band and feel instant; large or batch jobs (a multi-GB deposition video, a whole folder) become a tracked background job — a **Durable Object per job** holding queued → running → per-item progress → done, spinning Containers up on demand and sleeping them when idle (the Collabora pattern), with a completion notification.
- **Output is the user's choice per job:** **save into the matter** (a versioned R2 sibling of the original, audit-logged) or **download a copy**; single file or batch — download always available alongside, consistent with the "files live in the matter" principle.
- **Authorization:** every conversion passes the same matter/RBAC gate as inline preview before any bytes are read.

### 18.5 PDF services

The platform needs a broad set of PDF operations — fill, draw, stamp/watermark, merge/split, rotate, flatten, secure (password/permissions), redact, Bates-number, and seal/sign — today scattered across conversion (_In-app file conversion_), document automation (_Document Automation_), and discovery (_Discovery_). They are unified here as one **PDF service** under a single rule.

**Client-side by default.** PDF manipulation runs in the browser (and identically in Tauri) via WASM, so **privileged bytes never leave the device** — the strongest reading of the confidentiality principle (_Guiding principles_), and the _Delivery model_ "same bundle" parity story applied to PDFs. The server touches a PDF only in four principled cases:

1. **The platform must vouch for the result** — the e-signature seal + audit trail (_E-signature_), which need the firm's private certificate and server-observed attribution and so cannot run in a client.
2. **No client is present** — automated/scheduled generation (matter-plan documents — _Tasks and workflows_; invoice/report PDFs — _Billing_/_Reports_; intake-triggered sends — _Communications layer_).
3. **The engine is server-only** — Office-format fidelity (DOCX↔PDF) is bound to LibreOffice/Collabora (_Editing_); no production-grade client equivalent exists.
4. **Batch / ingest-scale on web** — ingest-time OCR feeding the search index and large discovery productions (Bates + redaction burn-in + hashing across tens of thousands of pages, _Discovery_). On **desktop these run locally** (the _Delivery model_ parity table already places OCR/indexing on the Tauri client), so this is a web-only server fallback.

**Engine roster — compose, don't adopt a bundle.** No single open-source library covers the whole surface (even the all-in-one tools bundle several engines internally), so the service composes a small, permissively-licensed set behind a registry of the _In-app file conversion_ form (`(operation) → {engine, recipe}`):

| Engine                       | License    | Runs                    | Role                                                                                                                                                                                        |
| ---------------------------- | ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@cantoo/pdf-lib**          | MIT        | Client WASM + Worker    | High-level workhorse: fill forms, draw, merge/split, rotate, flatten, **encrypt**. (The original `pdf-lib` is unmaintained since 2021; this is the maintained fork — revisit if it stalls.) |
| **PDFium** (`pdfium-render`) | BSD-3      | Client WASM + Container | Render-to-raster (preview, flatten), robust form-fill incl. XFA, low-level authoring.                                                                                                       |
| **qpdf**                     | Apache-2.0 | Container (JSON-job)    | Structural surgery, repair, linearize, AES-256 secure.                                                                                                                                      |
| **@signpdf**                 | MIT        | **Server only**         | Applies the PAdES platform seal with the firm certificate (_E-signature_).                                                                                                                  |

**Pre-built bundles rejected as the engine, kept as references.** _Stirling-PDF_ (one self-hosted API doing everything) is held as a documented fallback but rejected as primary — it bundles a JVM + PDFBox + LibreOffice + Tesseract + ImageMagick, redundant with the engines _In-app file conversion_ already runs and a second runtime to operate (consistent with ADR-0030's rejection of bundling Stirling-PDF). _Documenso / DocuSeal_ (open-source DocuSign clones) are **reference implementations only**: both are **AGPLv3** (a poison pill for a commercial multi-tenant SaaS) and are stateful Node/Rails-plus-Postgres apps that fight the Workers/D1/R2 model and break per-firm isolation (_Tenancy and data isolation_). That Documenso is itself built on `pdf-lib` + a signing fork is evidence the compose path is sound.

**Deferred — true redaction.** Legally-sound redaction must _remove_ the underlying content, not draw black rectangles, and is malpractice-critical for _Discovery_ production. The permissive engines above do not do content-level redaction well; the engines that do (PyMuPDF/MuPDF, Ghostscript) are **AGPL** — the same wall whether redaction runs client-side or server-side. Three named routes — commercial-license an AGPL engine, run PDFBox via a Stirling sidecar, or compose via PDFium rasterize-and-reassemble — are carried to the **Discovery** build (_Discovery_), not resolved here.

### 18.6 E-signature

First-party e-signature for engagement letters, authorizations, consents, and documents — **in-house primary**, built on the PDF engine (_PDF services_), not a vendor product. (The _Client portal_'s `esign` capability and the _Plugin system_ e-signature port both resolve here.)

**Why in-house.** The same three reasons as in-app conversion (_In-app file conversion_): **confidentiality** (engagement letters and settlement/medical authorizations never egress to DocuSign), **margin** (per-envelope vendor fees are high-volume in a firm — the Clio-cost trap), and **integration** (a sign request fires from inside a matter, the signed PDF lands as a versioned R2 object on that matter (_Document versioning_), completion drives a _Tasks and workflows_ workflow). The _Plugin system_ e-signature **port seam is kept** so a vendor adapter can slot in for the narrow PKI/notarial long tail (certified court filing, remote online notarization) where a registered trust-service provider is required.

**Electronic, not PKI — what the law requires.** ESIGN (federal) and UETA (Nevada: NRS Ch. 719) validate an electronic signature on four elements — **intent, consent** to transact electronically (a disclosure + checkbox), **association** of signature with record, and **attribution** — none requiring per-signer cryptography. A recorded signing act + audit trail is a valid signature, covering the firm's predominant use. Tamper-evidence makes it _defensible_, not _valid_.

**Client-side except the seal.** Field placement (sender), signing UI, and signature adoption (type/draw/upload) run **client-side** (_PDF services_). Two steps are server-side by necessity: the **PAdES platform seal**, applied once with Magna Carta's own certificate (`@signpdf`), making the completed PDF tamper-evident; and the **audit trail** — server-observed signer IP, timestamp, consent, document hash — which a client cannot be trusted to self-report. A **Certificate of Completion** is assembled from that authoritative log and stored with the document; events use the immutable audit log (_Observability and diagnostics_) and notifications use the Communications layer.

**Attribution as a configurable spectrum**, keyed to document risk: internal signers are already authenticated (Better Auth, _Authentication, access control & encryption_ — strongest); external signers tier from tokenized-email-link (possession baseline) → email/SMS access code → ID/KBA for high-stakes; **client-portal** signers (_Client portal_, per-share assurance) sign while authenticated, stronger than a vendor's emailed-link default.

**Honest limit.** The firm owns the defensibility burden the first time a signature is challenged — mitigated by the platform seal + hash chain + rigorous certificate, and bounded by these being mostly the firm's _own_ documents with its _own_ clients. The port seam covers cases where a named third-party provider is genuinely required.

> **Needs development — heavy revision, verify every aspect.** This PDF/e-signature area (_PDF services_–_E-signature_) is a first design pass and is **not settled**; treat every specific as provisional pending verification. Open items to confirm before build: (1) **library licenses and maintenance** — re-verify `@cantoo/pdf-lib` (maintained-fork risk), PDFium/`pdfium-render`, qpdf, and `@signpdf` versions/licenses at build time; (2) the **signing-in-Worker constraint** — confirm the PAdES seal must run in a Container (reported Worker crypto limits) and design that path; (3) **true redaction** — resolve the AGPL-vs-permissive routes (carried to the _Discovery_ build); (4) **ESIGN/UETA specifics** — consent-disclosure wording, retention, and any per-jurisdiction divergence beyond Nevada; (5) the **Certificate of Completion** contents/format and **tamper-evidence/hash-chain** scheme to a defensible standard; (6) **attribution/assurance binding** to the _Client portal_ per-share-assurance model; (7) the **client-side vs. server boundary** for each operation, and how the four server cases are triggered and audited; (8) PKI/notarial **port-adapter** scope. Likely its own subsystem spec. **All cross-references, licenses, and legal claims here must be independently verified.**

---

## 19. Document Automation

- **Conditional document assembly** (HotDocs/Documate-style): merge fields + conditional clauses/sections driven by matter data.
- **Templates authored as `.docx`** (perfect formatting control) bound to a **data dictionary** (Directory/Matter/Location/custom/financial fields) — **Location fields** (office name, address, letterhead, remit-to, jurisdiction) resolve from the matter's home location so generated documents carry the correct office identity.
- **Generation engine:** light templating in a Worker (Rust/WASM docx); heavy DOCX↔PDF via the LibreOffice/Collabora engine in a Container.
- **Dedicated PDF form-filling** for court/government fillable PDFs (via the PDF engine, _PDF services_).
- This resolves filing-grade fidelity: court documents are _generated_ from vetted templates (and optionally tweaked in Collabora), not co-edited from scratch.

---

## Part VI — Litigation & Matter Support

---

## 20. Discovery (e-discovery)

Built for moderate scale (thousands–tens of thousands of docs/matter) with seams so large scale is an evolution, not a rewrite.

- **Pipeline:** ingest → R2 → queue-driven **extraction/OCR** in Containers → index. The **OCR engine is the PaddleOCR PP-OCRv6 _models_ run as ONNX through a Rust `ort` pipeline** (not the PaddlePaddle framework) — one engine + one pinned, **versioned** model set compiled native for **both** the server Container and the Tauri desktop, so OCR output is identical wherever it runs (the search index and evidentiary hashes stay reproducible regardless of processing location). **Tesseract** is the conservative fallback and **`ocrs`** the pure-Rust escape hatch; the specific Rust crate resolved to **`oar-ocr`** and the small model tier was settled by benchmark when the standalone engine was built. Full decision and rejected alternatives (PaddlePaddle runtime, Surya/OpenRAIL-M, docTR-as-primary, GPU/hallucination-prone VLM OCR, cloud APIs): **ADR-0060**.
- **Archive (zip) handling:** uploaded archives are stored **opaque** — versioned, hashed, on the matter — and are **not expanded server-side**. We write no extraction code, so there is no zip-bomb / password / nested-archive read pipeline to defend. **Deferred but not designed-out:** indexing, reviewing, and producing the _contents_ of an archive — expected via client/desktop-side extraction → upload of loose files, keeping the original archive as the as-received evidence copy. Until then a zip is an opaque attachment, invisible to search/tag/redact/produce.
- **Search:** **Tantivy** (Rust) behind a swappable interface, plus **Vectorize** for semantic search.
- **Review:** filter by date/custodian/party/keyword, tag (responsive/privileged/confidential), redact, email-thread, near-duplicate detection.
- **Production workflow (full):** Bates numbering, applied redactions, privilege log — with **defensibility built in** (per-doc hashing, content-addressed storage, chain of custody, audit log).
- **Deferred but not designed-out:** index sharding, massively parallel OCR, TAR/predictive coding. The Tauri desktop app can perform local ingest/OCR/indexing for speed.

---

## 21. Conflicts Check

- **Triggers:** intake (the matter in its intake or consultation status) and whenever a party is added. Optional periodic re-scans.
- **Scope: firm-wide** (conflicts impute across the firm, **spanning every office/location** — locations never partition the conflicts graph), scanning the whole Directory + matter role-links, including affiliations.
- **Configurable matching strictness:** balanced default; over-inclusive (fuzzy/phonetic/alias) available to enable.
- **Configurable search depth:** structured Directory/matter by default; optional document-content scan.
- **Human clears**; every check and clearance (waiver obtained, or ethical wall erected) is recorded in an **immutable, defensible conflicts log**.

> **Needs development.** The matching engine itself is under-specified for an ethics-critical feature. To specify: the candidate-generation + scoring model (exact vs. fuzzy vs. phonetic vs. alias/blind-index match over names and identifiers), how related-party edges (_Directory_) expand the search, the strictness/score thresholds and how a reviewer adjudicates, and the exact contents/format of the immutable conflicts log entry. Expand in a follow-up spec.

---

## 22. Custodian

Register of physical originals held in safekeeping.

- Full **physical-location hierarchy rooted at a Location** — **Location (office) → safe → box → position** — so a multi-office firm tracks which office physically holds each original; immutable **check-in/out custody log** (records the holding location), printable **labels/barcodes**.
- Attached **R2 digital scans**; retention/destruction dates and **will release-on-death reminders**.
- Links to owning Directory entry and/or matter.

---

## 23. Calendar and rules-based docketing

- A calendar surface for matters, deadlines, and appointments, with **two-way Google/Outlook sync** (via the email/calendar plugin).
- **Rules-based docketing:** compute court dates and deadlines from court rules (the highest-value litigation feature and a malpractice-risk reducer); the rule set can default from the matter's jurisdiction or home Location. Reminders feed the Communications layer.

> **Needs development.** Rules-based docketing is called the highest-value litigation feature but is only sketched. To specify: where rule sets come from and how they are encoded/maintained (per jurisdiction/court), the trigger→deadline computation model (court holidays, service-method offsets, chained deadlines), recalculation when a trigger date moves, the reviewer confirmation step, and how computed dates flow to reminders. Likely its own subsystem spec — court-rule sets are jurisdiction-keyed reference data of the same kind as the trust-rules catalog (_Open research workstreams_).

---

## 24. Tasks and workflows / matter plans

- Task lists with assignments and due dates.
- **Matter plans:** templated task/event/document sequences per matter type, auto-instantiated when a matter is opened — pairing directly with document automation and the calendar.

> **Needs development.** The workflow model needs detail before build: matter-plan template authoring, task dependencies/sequencing, assignment + reassignment, due-date derivation (including from _Calendar and rules-based docketing_), notification/escalation, and completion tracking. Expand in a follow-up spec.

---

## Part VII — Client-Facing & Communications

---

## 25. Client portal

Secure, external-facing surface for everyone the firm collaborates with — **clients, co-counsel, experts, adjusters, and other Directory contacts** — covering document sharing, invoice viewing and **payment** (_Payments and e-signature_), secure messaging, **e-signature** (_E-signature_), and **bug reporting** (same redaction discipline as staff, _Observability and diagnostics_). **Per-firm isolation extends to the portal.** Recipients are always **Directory entities** (_Directory_) — there is no shadow user list; every external collaborator is a known, conflict-checkable entity.

### 25.1 The unified grant model

Every share — a whole matter, a folder, or a single file — is one first-class **`PortalGrant`** record, differing only by scope. Granularity is **data, not a separate code path**, and a recipient's portal is the live **aggregation** of all their active grants: one client sees all their matters, while a single expert sees only the two folders shared with them, through the same surface.

A grant carries: the **recipient** (Directory entity); a **scope** (`matter | folder | file`, with an optional R2 version pin); a **capability set**; a required **assurance level**; an optional **expiry**; and **status** (active/revoked/expired), with `grantedBy`/`grantedAt` and a full audit trail.

### 25.2 Scope semantics — opt-in folders

- **File scope:** exactly that file, optionally **version-pinned** to a _Document versioning_ `vN` object so "the PDF I sent" never silently changes.
- **Folder scope:** the folder's current and future files appear **live**, but **child folders stay private until individually shared** — new child/sibling folders never auto-leak.
- **Matter scope:** shares every folder _currently marked shareable_; newly created folders default private. "Share whole matter" is sugar for granting the matter's existing shareable folders — **not** a standing grant over everything ever added.
- **Shareability is a visible property** on each folder/file in the File Manager (_Matters and File Manager_), so staff always see what is exposed — drift prevented by visibility, not discipline.

### 25.3 Capabilities (per-grant subset)

`view` (inline via the _Inline file preview_ viewer), `download` (reuses the _Matters and File Manager_ streaming-zip engine behind portal auth), `upload` (recipient contributes into the scoped container), `comment`/`message` (secure messaging), and `esign` (_E-signature_). A view-only grant withholds `download`. **Uploads quarantine** into a staff-reviewed incoming queue, receive the same ingest treatment (scan + `inlinePlayable` verdict, _Inline file preview_), and require **staff acceptance** before becoming matter documents — a contribution never silently mutates matter files.

### 25.4 Identity & per-share assurance

Each grant names a required **assurance level** — **magic-link** (short-expiry, one-off), **account** (Better Auth, email-OTP), or **account + 2FA** (passkey/TOTP, ongoing clients) — and the portal escalates the session challenge to the strongest assurance among the grants being accessed. Portal accounts live in the **control-plane D1** as a **distinct external principal type** (never staff RBAC), linked to the per-firm Directory entity through the firm registry.

### 25.5 Lifecycle

- **Instant revocation:** flipping `status: revoked` cuts access on the next request; preview/download URLs are already short-lived (_Inline file preview_), so nothing meaningfully outlives revocation.
- **Optional expiry:** default none (ongoing relationships); set a date for one-off shares; auto-transitions to `expired`.
- **Full audit:** grant creation, every view/download/upload, revocation, and expiry write to the matter's immutable audit log — **metadata only, never content** (_Observability and diagnostics_).

### 25.6 Enforcement & invariants

Enforced in the firm-scoped **data-access layer** alongside RBAC + ethical walls, not bolted on:

- **Per-firm isolation** — a grant may only reference its own firm's entities and files.
- **Ethical-wall / least-privilege invariant** — a grant can **never expose more than the sharer's own current access**; staff screened off a matter (_Authentication, access control & encryption_) cannot create or hold grants on it. Sharing is bounded by the sharer's RBAC.
- **Upload safety** — contributed files quarantine for staff acceptance, as above.

### 25.7 Reuse, not new infrastructure

Bulk download is the _Matters and File Manager_ engine; inline preview is _Inline file preview_ signed URLs + Vidstack; messaging, e-sign, invoice payment, and bug reporting are the existing _E-signature_/_Client portal_/_Payments and e-signature_/_Observability and diagnostics_ surfaces, now **scoped by grant**. The only genuinely new pieces are the **`PortalGrant` entity + DAL enforcement**, the **external-principal auth type**, and the **recipient-facing aggregated portal UI**.

**Deferred (seams open):** per-recipient watermarking, ad-hoc non-Directory email recipients, and per-file exclusions _within_ a shared folder (folder-level opt-in already covers the privilege case).

---

## 26. Payments

Payments are a **port** (_Plugin system_) with swappable vendor adapters; the goal is the **lowest possible fees**, which is more an architecture problem than a vendor one.

- **Interchange is the floor.** The Visa/Mastercard interchange behind every card transaction (~1.5–2.0% on credit; regulated debit capped at 0.05% + 22¢) is set by the networks — **no processor prices below it**; "interchange-plus" only makes the markup transparent. So minimizing fees means moving money **off cards**, not shopping for a cheaper card rate.
- **Two rails, ACH-default.** Bank transfer (**"direct deposit" / ACH**) is the **default, prominent** option — **no interchange**, just a small flat/capped fee, so a $5k retainer costs single-digit dollars instead of ~$150. **Card is the convenience fallback.** This ACH-steering is the single biggest cost lever.
- **Fees never touch trust** — the non-negotiable correctness property. Trust/IOLTA deposits land **gross**; any card fee is debited **separately from the operating account**, never netted from the trust deposit. Enforced structurally by routing trust vs. operating payments to **separate deposit destinations** and billing fees only to operating.
- **Surcharge on operating only, where legal.** For earned-fee/invoice (operating) **card** payments, an optional **surcharge/convenience fee** passes interchange back to the payer — gated by the **trust-engine's jurisdiction config** (surcharging is banned in some states, capped ~3–4%, must be disclosed + network-registered, and **debit is never surcharged**). Never applied to trust deposits.
- **Launch adapter — Helcim.** Interchange-plus with **no monthly/statement/PCI/annual fees** and automatic volume discounts; cards at interchange + ~0.50% + 25¢ (online), **ACH at 0.5% + 25¢ capped $6** — one adapter covers both rails at launch. Swappable behind the port: **Stripe or Dwolla** for cheaper/flat ACH at scale (Stripe ACH caps at $5; Dwolla ~$0.25–0.50 flat), **Adyen** for interchange++ once card volume is high, **Confido / Gravity Legal** as a turnkey trust-compliance fallback if owning the split becomes burdensome.
- **PCI scope minimized:** card data is entered **only inside the processor's hosted payment modal** — Helcim's **HelcimPay.js** iframe, which our page never reads and which returns an opaque **`cardToken`** — so no cardholder data reaches our DOM, page, or server; we store the token plus last-four/brand and **never a PAN, never a CVV**, keeping the firm at **SAQ A**. The **in-DOM tokenizer (`Helcim.js`) is rejected**: it renders card fields in the merchant's own DOM and lands at the larger **SAQ A-EP**, for no experience gain over the modal (the raw-card API would be SAQ D). The payment surface carries **no third-party or analytics scripts**, which keeps PCI v4.0.1's payment-page script-inventory and script-integrity requirements trivially satisfiable. (ADR-0181, refining ADR-0032.)
- **E-signature** is a documents/PDF capability and has moved to its own area — see _E-signature_ (built on the _PDF services_ engine).

---

## 27. Communications layer

The firm's communication across **three channels — email, messaging (SMS/MMS/RCS), and voice/telephony** — unified behind one templating + trigger engine and logged to the matter/Directory. Email exists today; messaging and voice are added as **plugin ports** (_Plugin / Add-on system_), so the carrier is swappable and never owns the data.

**Email — dual send paths.** Matter correspondence routes through the firm's **own mailbox** (Gmail/Outlook via the email plugin — real address, threads in the mailbox, logs to the matter); billing/system mail routes through a **transactional provider** (Resend/Postmark/Mailgun or Cloudflare Email).

**Email — inbound capture to matters.** The higher-value direction is capturing the firm's _own_ email correspondence **into** matters as first-class, thread-aware records — not hosting a mailbox (the product is never an email host). The capture posture is **add-in-led and CASA-free**: a native Outlook/Gmail "Save & File" / "Send & File" add-in reads the open message and files it in one click, needing no full-mailbox OAuth scope and so no CASA audit; a **forward/CC capture address** over a Cloudflare **Email Worker** reaches any client on any device as the universal fallback; and an authenticated **`file this MIME to matter` API** is the shared server target for both the add-in and manual `.eml`/`.msg` upload. All entrances converge on **one capture pipeline and one record** over the pure-Rust email parse core and the existing ingest/quarantine chokepoint — no parallel path. The record model is **thread-aware and relational** (a message record, a thread DAG, a multi-matter junction so one message links to many matters without copies), deduped by **`Message-ID`** across every recipient's copy (content-hash fallback when an identifier is stripped), with attachments extracted as first-class quarantined File Manager documents while the verbatim original is kept whole for fidelity and evidence. A wall-safe **"already filed"** signal prevents double-filing without ever revealing a walled matter's existence. **Full mailbox sync** (zero-click auto-capture + send-as) is the **later credentialed tier** — the CASA-gated OAuth adapter on the integration port system — feeding the same record and dedup, not a competing integration; the add-in and forward paths come first because they front-load value and defer the procurement gate.

**Messaging (SMS/MMS/RCS) — a CPaaS behind a `messaging` port.** Serves outbound notifications (appointment/deadline/payment reminders, invoice- and report-ready), the **SMS 2FA factor** (_Authentication, access control & encryption_), **e-signature and portal access codes** (_E-signature_, _Client portal_), and **two-way client texting** (inbound + outbound conversations threaded and logged to the matter/Directory — the formerly-backlogged "client texting"). **Self-hosting the carrier is rejected:** SMS/MMS require a registered aggregator, RCS exists only through Google's RBM + carrier agreements, and an SMPP gateway (e.g. Jasmin, kept only as a documented fallback) is an off-Cloudflare persistent host that fights the Workers/D1/R2 model — so control comes from the **swappable adapter + per-firm scoped secrets**, not from owning the carrier.

**Voice & telephony — a `telephony` port.** Inbound call handling for the **receptionist intake** workflow: a call is recorded to per-firm R2 and a **media stream (WebSocket) forks the audio** for transcription, producing a **call log + transcript** on the Directory/matter and feeding **intake capture** (_Client intake / CRM_).

**Transcription — Cloudflare-native, in-house.** Call audio is transcribed on **Cloudflare Workers AI** (Whisper / Deepgram Nova-3), **not** the carrier's hosted transcription, so **privileged audio never egresses** to a third party — the same confidentiality logic as in-house file conversion (_In-app file conversion_) and the no-third-party-error-SaaS rule (_Observability and diagnostics_). The same capability also serves the deferred transcript-sync of _Inline file preview_ and discovery/deposition media (_Discovery_).

**Launch adapter — Telnyx; swappable.** Telnyx owns its IP network (voice quality/latency for the receptionist line), is lowest-cost, covers **SMS/MMS/RCS + voice** under one number inventory, exposes **bidirectional media streaming** (the clean fork into Workers AI), and signs inbound webhooks with **Ed25519** (public-key verification in a Worker — no shared secret to distribute). Swappable behind the port: **Twilio** (turnkey fallback, most mature RCS), **Bandwidth** (owned Tier-1 US voice + E911 strength), **Plivo** (cost at scale) — the same "launch adapter, swap in days" posture as Payments' Helcim. RCS is treated as **progressive enhancement over SMS/MMS** (verified branded sender; auto-fallback to SMS).

**Templates + automation/trigger engine.** Channel-aware templates feed one trigger engine. First automations: **invoices & statements, payment reminders, scheduled reports & deadline reminders** (trust-replenishment requests supported, lower priority).

**Compliance invariants (enforced in the ports, not bolted on):**

- **A2P 10DLC / toll-free / RCS-brand registration** is a **procurement prerequisite** (weeks of lead time; per-campaign fees set by The Campaign Registry, identical across vendors) — treated like the legal-research connector entitlement (_Plugin / Add-on system_), not an engineering task.
- **TCPA consent + STOP/HELP opt-out** is enforced in the messaging port.
- **Call-recording consent** is gated by the **jurisdiction-profile machinery** already built for trust rules (_Trust accounting_) and payment-surcharge legality (_Payments_) — Nevada is one-party, ~12 states are all-party; reuse the config, do not rebuild it.
- **E911** is a latent decision: a pure inbound intake line sidesteps it; a real outbound office line triggers emergency-calling registration (Bandwidth's strength) — recorded as a seam, not solved now.

All communication across all three channels is logged to the matter/Directory, under the platform-wide redaction discipline — telemetry never carries privileged content (_Observability and diagnostics_).

---

## 28. Client intake / CRM

The **Intake desk** (built: every intake in flight, firm-wide; starting one; completing it into a consultation once the firm's intake procedure is clear; scheduling the consultation), a lead pipeline with stages feeding it, plus **public intake forms** (served from Workers) that capture prospects into the Directory. Top-of-funnel tooling competitors monetize heavily.

**Receptionist call intake.** Inbound calls (_Communications layer_) produce a recorded, transcribed **call log** that a receptionist turns into a Directory prospect + an intake — capturing the caller as a known, conflict-checkable entity at first contact, with the transcript attached so nothing said on the call is lost.

> **Needs development.** One paragraph for a feature competitors monetize heavily. To specify: the pipeline stages and lead lifecycle, the public intake-form builder (fields, validation, spam control) and how submissions land as Directory prospects + intakes, the **receptionist call-intake capture flow** (call log/transcript → prospect + intake, _Communications layer_), conflict-check-at-intake hookup (_Conflicts Check_), CRM fields/activities, and lead→matter conversion. Expand in a follow-up spec.

---

## Part VIII — Reporting & Community

---

## 29. Reports

- Projections over the append-only ledger (consistent with the books, reproducible for any past date).
- **Standard library:** mandatory **trust-compliance** reports (three-way reconciliation, client ledgers, journal), financial (WIP, A/R aging, realization, profitability), productivity, operational.
- **Per-location roll-ups/filtering:** financial and productivity reports filter and subtotal by office; trust-compliance reports are per-account and therefore inherently per-location/per-jurisdiction.
- **Scheduled/automated** generation + archival (optional email delivery).
- **Exports:** PDF, Excel/CSV, print.
- Custom report builder and live dashboards are deferred.

---

## 30. Community & feedback forum

A public surface where users **discuss with each other, see known issues, and request and vote on features** — combined with bug reporting (_Observability and diagnostics_) and the help center (_User-facing documentation_). **Delivery decided (ADR-0044, amended): a native build on Cloudflare as a clean, extractable `@magna-carta/community` package** (the government-links / property-links pattern) — superseding the earlier self-hosted-Fider lean, which a 2026-06-17 tool survey showed a poor fit (Postgres + mandatory SMTP, AGPL-3.0, no changelog/roadmap UI). **Implementation is deferred to a later slice;** see [`docs/specs/2026-06-17-community-feedback-board-design.md`](specs/2026-06-17-community-feedback-board-design.md).

- **Purpose:** feature requests with **popularity-ranked voting**, peer discussion, a public roadmap and known-issues view, and changelog — giving users a voice and cutting duplicate reports.
- **Confidentiality boundary (non-negotiable):** the forum is **platform-level, public, and cross-firm — it never touches per-firm confidential data or privileged content.** Posting is always **opt-in and user-authored**; nothing flows automatically from private matters or the private bug-reporting pipeline (_Observability and diagnostics_) into the public forum.
- **Ties to existing surfaces:** a user may **opt to escalate** a private report (_Observability and diagnostics_) into a public feature request, or check whether an issue is already known; shipped items sync to the **changelog**; popular requests inform the **roadmap (_Build roadmap_)**; the help center (_User-facing documentation_) and community Q&A sit together. The **maintenance/diagnostics agents (_Maintenance agents_ / _Observability and diagnostics_)** may post public status on known issues — propose-only, never exposing privileged detail.
- **Delivery — native build (ADR-0044, amended 2026-06-17).** A 2026-06-17 tool survey settled the earlier open question against buying/hosting: **Fider** needs an off-Cloudflare **Postgres + mandatory SMTP**, is **AGPL-3.0**, and ships **no changelog and no roadmap/kanban UI**; hosted options (UserJot/Featurebase) sit outside the firm-controlled boundary; **per-tracked-user pricing (Canny) stays rejected**. Fider's real surface is small (posts → votes → comments → tags → 6 statuses → 3 roles), so a **native build is less work than operating an off-Cloudflare host** and the only path that keeps everything on **control-plane D1 + Cloudflare-email** and honors the confidentiality boundary. **Honest caveat:** standing up a board is easy, but **running a public board is a permanent moderation, spam/abuse, and security commitment** — native means we own that load directly, with no off-Cloudflare host to patch.
- **Build shape:** a clean, extractable **`@magna-carta/community`** package (the government-links / property-links pattern), platform-level and isolated from the per-firm data-access layer — the isolation _is_ the confidentiality boundary and keeps a future repo-split cheap. **Board first** (feature requests + upvote + comments + status pipeline + roadmap-as-filtered-view-by-status), with a **dormant `discussion` seam** for an open forum later; **display-name identity** (real name/firm never shown publicly, aggregate vote counts only); SSO via **Better Auth**; the one-way **escalation bridge** from private reports (_Observability and diagnostics_) is unchanged.

---

## Part IX — Process, Delivery & Records

---

## 31. Product updates (changelog, release notes & roadmap)

In-app and public access to **what changed, what's new, what's coming, and what's currently broken** — a changelog, curated release notes, the roadmap, and a live known-issues / service-status banner. This is **platform-level** content (cross-firm, identical for everyone), distinct from per-entity audit/temporal history (_Directory_, _Guiding principles_) and from any per-firm activity feed (explicitly out of scope). Transparency is deliberate: the read content is **public**, doubling as a credibility/acquisition surface. It is the in-product counterpart of the _Community & feedback forum_ and **shares that surface's sources rather than competing with them.**

**The core decision — bundle the versioned content, centralize only the live content.** Versioned content (changelog, release notes, roadmap) **ships with the build** as a structured static asset; live content (known issues / service status) lives in **control-plane KV**. The split falls directly out of the golden rules:

- **One home per fact + docs-in-commit.** `CHANGELOG.md` and `ROADMAP.md` (_Living docs_, ADR-0037) stay the single authoring home; a build step _derives_ a structured artifact from them. There is **no CMS** — authoring stays in git/PR, with the propose-only **docs-maintenance agent** (_Maintenance agents_; ADR-0058) drafting entries for approval, never authoring narrative.
- **Version-accuracy by construction.** Because the changelog ships _inside_ the build that implements those changes, the running app can never advertise a feature it does not contain — a hazard a central content store invites by drifting ahead of the deployed build.
- **Offline-native parity.** The bundled artifact renders with no network, identically on web and Tauri (_Delivery model_).
- **KV is the right primitive for the live content** — platform-level, read-mostly, edge-replicated config (_Cloudflare primitive mapping_), not per-firm D1. Keeping status on Cloudflare KV (not the off-Cloudflare forum host) also means the **status banner never depends on the very tool that may be down during an incident.**

**Sources of truth → read surfaces (nothing double-authored):**

| Content                               | System of record            | In-app surface                                  | Public / forum                     |
| ------------------------------------- | --------------------------- | ----------------------------------------------- | ---------------------------------- |
| Changelog                             | `CHANGELOG.md` → artifact   | reads bundled artifact                          | public static page; forum links in |
| Release notes                         | curated, with the changelog | reads bundled artifact                          | public static page                 |
| Roadmap                               | `ROADMAP.md` → artifact     | reads bundled artifact (+ optional vote counts) | public static page; forum voting   |
| Known issues / status                 | control-plane **KV**        | live banner                                     | mirrored to forum known-issues     |
| Feature requests / votes / discussion | the **forum tool**          | links out via SSO                               | native (login-gated)               |

**The structured artifact.** A build step generates `product-updates.json` from the markdown homes — versioned entries (semver + date), Keep-a-Changelog categories, curated release-note highlights, and roadmap items (now/next/shipped/backlog). The generator is **tool-agnostic**: a parser today, or the Phase-0 release tooling (Conventional Commits + git-cliff / changesets, ADR-0037) emitting it directly — the _schema is the contract_. Malformed input **fails the CI build** rather than shipping broken content. The same artifact is also published to KV at deploy, so the public pages and the future forum read one source.

**Known issues / service status (live).** An incident/known-issue banner is written to **control-plane KV** through a small **owner/admin RBAC-gated endpoint** (and, propose-only, by the diagnostics/maintenance agents — _Observability and diagnostics_, _Maintenance agents_), needing **no deploy**. The in-app banner reads it (and hides silently offline, being inherently live); the forum's known-issues view mirrors it.

**Per-user state.** A `lastSeenProductUpdate` marker — an identity-level user preference registered in the **Settings framework** (_Settings & configuration_, control-plane storage) — drives the "What's New" unread badge, computed client-side against the artifact's latest version; viewing the surface marks-seen.

**Surfaces.** An authenticated, deep-linkable `/updates` route (_Delivery model_) with **What's New** (highlights, default), **Changelog** (filterable by version/category), and **Roadmap** tabs, plus a help-menu entry carrying the unread badge and the global status banner — all built only from the design system (`@magna-carta/design-system` components, Lucide, no emojis; _Design system_). The **public** (logged-out) changelog/roadmap/status render as **Workers static pages** from the published artifact + KV status (SEO-friendly, presentation identical to in-app), so the canonical public view does **not** depend on the deferred forum tool.

**Roadmap audience.** The internal roadmap is shown **as-is** while the firm is the sole tenant. The artifact schema reserves an optional `audience` field as a **non-breaking seam**, so an internal/public filter switches on when the platform goes multi-firm — no later reshaping.

**Forum integration (seams, wired when the native board lands — _Community & feedback forum_, ADR-0044).** We own changelog/roadmap/status; the board owns requests/votes/discussion. The seams are native **SSO** deep-links from the in-app surface into the board, optional read-only **vote counts** enriching roadmap items ("popular requests inform the roadmap"), and the one-way **escalation bridge** from private reports (_Observability and diagnostics_). Until the board lands, the in-app and public surfaces are fully functional standalone.

**What it is not.** Not the per-entity audit/temporal history (already designed), not a per-firm activity feed, and not a CMS — the only content authored without a deploy is the live status.

Decided as **ADR-0048**; extends ADR-0037 (living docs) and ADR-0044 (community forum), and reuses the Settings framework (ADR-0040), KV (_Cloudflare primitive mapping_), and the maintenance agents (ADR-0016).

---

## 32. User-facing documentation

- **Public help center** (Workers static assets, SEO-friendly), **in-app contextual help**, and separate **admin docs** for the firm owner.
- Maintained under the same rule as code: docs change in the same commit as the feature.

---

## 33. Development guidelines, CLAUDE.md, and ADRs

Layered, co-located documentation:

- **Short root `CLAUDE.md`:** stack, run/test/build, non-negotiables (no emojis; Lucide icons; append-only ledger invariants; no-negative-trust-balance; secrets never in core; plugin isolation), and pointers to specialized docs.
- **Nested per-area `CLAUDE.md` / guides** co-located with the code they govern.
- **ADRs:** every settled decision recorded in the **[Decision Log](./Decision-Log.md)** with context + rationale; the log defines the ADR format, status lifecycle, and numbering standard.
- **`docs/conventions/`:** language standards, UI/design (Lucide), testing, security.
- **Tooling:** **Vite+** (CLI **`vp`**) is the standard unified toolchain and single entry point — package/runtime management, dev server (`vp dev`), **build/pack** (`vp build` / `vp pack`, Rolldown-powered), **test** (`vp test`, Vitest), and the one-shot static-check command **`vp check`** = format (**Oxfmt**) + lint (**Oxlint**) + TS type-check (**tsgolint**, via `lint.options.typeCheck`); **Prettier** is the interim formatter until Oxfmt is GA. tsgolint covers `.ts` only — the full quality gate is `pnpm check` (`vp check` + **svelte-check** for `.svelte` source). Monorepo tasks via `vp run`. Rust uses `rustfmt`/`clippy`. Vite+ is **free at our tier** (individual/small-firm; tiered, source-available) and its underlying tools (Vite, Vitest, Rolldown, Oxc) are MIT, so every command has an OSS fallback; it is past alpha (v0.1.x, MIT) and Cloudflare-owned following VoidZero's acquisition in early 2026; the OSS fallback to the underlying tools remains intact.
- **Source control & code management: GitHub** — repositories, branch protection, **pull requests** (the maintenance and diagnostics agents open _draft_ PRs — _Maintenance agents_), code review, and issues.
- **CI/CD: Cloudflare Workers Builds** — the integrated CI/CD, connected to the GitHub repository. On push it runs the build (`pnpm install --frozen-lockfile && vp run build-all`) and **deploys to Cloudflare via Wrangler** (`wrangler deploy`) for each Worker (`magna-carta`, `magna-carta-scan`). Faster builds come from its native **Build Caching** (deps + build outputs cached across builds) and **Build Watch Paths** (per-Worker monorepo path scoping). The full quality gate (`pnpm check` = `vp check` + svelte-check), tests (`vp test`, Playwright, visual-regression), and the OpenAPI spec toolchain (Spectral/oasdiff/SDK-gen) run **pre-push** — locally and, where wired, as a Workers Builds build step — not in a standalone GitHub Actions pipeline. _(This reverses the earlier intent to use GitHub Actions for CI/CD: Workers Builds is the integrated, single-vendor path that builds and deploys without a separate CI runner or stored Cloudflare credentials.)_
- **Testing:** **Vite+ integrated testing** is the unit + Svelte **component** layer (behavior: props/events/state, accessibility assertions; Vite-native, so components test against the same SvelteKit pipeline with no extra build config). **Playwright** for end-to-end + **visual-regression** (over the Storybook catalog, _Design system_); integration tests run against **Miniflare** (local D1 + R2) using the write-path **fixtures** (_Synthetic data & fixtures_). Test data is always generated through real domain write-paths — never raw inserts.

- **Implement on the latest.** Before coding with or upgrading a library, verify its **current** docs and use the latest stable API/patterns (Svelte 5 runes, Tailwind v4, etc.) rather than memory — this avoids retroactive migrations. The dependency/upgrade maintenance agent (_Maintenance agents_) keeps it current over time.

**Inherited conventions (from the owner's existing setup):**

- **No shell for file operations** — dedicated tools only; shell reserved for git, pnpm, cargo, rustup, process management.
- **Docs update in the same commit as code.**
- **Autonomous + terse during implementation**; comprehensive fixes, not incremental patches. (Design/brainstorming remains collaborative.)
- Stack (TypeScript, Svelte, Rust) already matches the owner's skills.

---

## 34. Synthetic data & fixtures (test & demo seeding)

Magna Carta can't be seeded with random rows — the domain has hard invariants (balanced double-entry ledger, no-negative trust, computed conflicts blind-index, `protected()` fields, valid role-links, temporal validity). So the rule is: **mock data is generated through the real domain write-paths, never raw inserts.** A `fixtures` package of typed factories/builders calls the same service APIs the app uses (`openMatter`, `addParty`, `postLedgerEntry`, `putDocument`), so synthetic data is **valid by construction**, can't drift from the schema, and doubles as integration coverage of those write-paths.

- **Determinism — one seed.** A single injectable seed drives faker, a **fixed clock**, and **seeded ID generation**; same seed → byte-identical data (outbox row ids excepted — minted unseeded inside the data-access layer; the documented seam, see the ledger-and-fixtures spec). `crypto.randomUUID` and wall-clock time are banned in fixtures (they'd break reproducibility, and temporal history, matter numbering, and ledger dates all key off the clock).
- **Layered content.** Procedural data for entities/financials; **real `.docx` templates** (retainer, complaint, discovery requests, settlement statement) filled with the generated parties and written to R2 as genuine documents Collabora opens — plus a small discovery corpus, a sample inline-playable MP4, and mixed file types so e-discovery, video preview (_Inline file preview_), and conversion (_In-app file conversion_) all have inputs.
- **One engine, three entry points:** named **scenarios** (small, deterministic, asserted — `conflictHit`, `trustOverdraftBlocked`, `nameChangeMatch`, three-way reconciliation); a curated **demo-firm bundle** (a dozen varied matters for manual eval/demos); a volume-parameterized **load profile** (thousands of matters for query/scaling tests), **snapshotted** to a fixtures artifact (JSON manifest + R2 blobs) for instant, cheap replay.
- **Tenancy & safety.** All mock data lives in a dedicated **demo tenant** ("Demo, LLP"); load data in a throwaway env. Generation is **guarded so it can never run in production**. Data is purely synthetic — no real client content; the eventual LEAP anonymized import (_LEAP migration_) is a _separate_ scrubbing pipeline, out of scope here.
- **Where it runs:** local dev (`wrangler dev` / Miniflare with local D1 + R2), ephemeral CI, and a guarded non-prod "seed demo tenant" admin action.

---

## 35. LEAP migration (deferred workstream)

- **Approach:** a schema-mapping **ETL import tool** built as a migration adapter — extract LEAP export → map entities (cards→Directory, matters→Matters, time/trust/billing→ledger entries, documents→R2, Custodian) → dry-run + validation → reconcile.
- **Trust balances are the hard gate:** every cent must reconcile against LEAP before cutover.
- **Now:** legacy source-system ID fields are baked into core entities; configurable matter numbering preserves LEAP matter numbers. Field-level mapping is deferred until export access is available.

---

## 36. Build roadmap

A clean, greenfield sequence (_Guiding principles_ — _Greenfield_): with no legacy system and no live clients, every phase is pure forward delivery, carries no migration or back-compat constraint, and earlier phases may be revised freely as later ones inform them. Each phase is a **vertical slice** — complete through every layer (schema → firm-scoped DAL → API → UI → tests → docs) and perf-tested against the load-profile fixtures (_Synthetic data & fixtures_) as built. The ordering spine is the owner's: **file/document management is finished first, the Financial Core immediately after**, then litigation, then client-facing, then integrations.

- **Phase 0 — Foundation.** _Deliverable: an empty but production-shaped platform a feature can be built on._ Repo + Vite+/`vp` toolchain + CLAUDE.md/docs/ADRs; Cloudflare scaffold (control-plane + per-firm D1, per-firm R2, Queues, Workers static-asset hosting); the firm-scoped **DAL** with its chokepoints (`protected()`, audit, idempotency, the transactional outbox) and the **append-only ledger core**; the **schema-migration / fleet runner** (a fleet of one); first-party **auth** (Better Auth) + **RBAC skeleton**; the **OpenAPI code-as-contract** pipeline; CI (`vp check`, tests, spec toolchain, visual-regression) → Wrangler deploy; transactional email; the **fixtures / synthetic-data harness** (domain-write-path factories, seeded + deterministic) stood up alongside the first write-paths; diagnostics/telemetry baseline; security/dependency agents online.
- **Phase 1 — Core domain.** _Deliverable: model the firm and open matters._ Directory (graph entities, legal names, typed edges, duplicate-detection/merge) → **Locations (offices)** → **Matters & File Manager** (matters carry an optional home Location; versioned R2 files, folders, streaming bulk-download zip).
- **Phase 2 — Documents & file management (finished first).** _Deliverable: the complete document lifecycle — create, edit, version, preview, convert, assemble, sign._ Collabora editing + WOPI host + **app-managed versioning & storage tiering**; **inline preview** (video-first, cookieless safe-delivery sandbox); **in-app conversion** (format registry); **PDF services** (the compose-don't-bundle engine roster) + **e-signature**; **Document Automation** (conditional assembly + PDF form-filling). The inbound large-file/upload path and the untrusted-file scanning pipeline (_Matters and File Manager_) land here.
- **Phase 3 — Financial Core (immediately after).** _Deliverable: the firm can run on the books — capture time, hold trust correctly, bill, and report._ **Time** (deep daily-driver: single cross-device live timer, manual + weekly timesheet grid, rate cards/increments, WIP, targets & missing-time) → **Trust** (+ reconciliation; jurisdiction catalog seeded, **Nevada verified**; per-account jurisdiction profiles; trust accounts associated with Locations) → **Billing** (per-location letterhead/remit-to; **UTBMS codes + LEDES e-billing** export/validation) → **Costs** → **Operating accounting / GL** → **trust-compliance & financial Reports** (+ per-location roll-ups) → billing automations.
- **Phase 4 — Conflicts & Custodian.** _Deliverable: ethics-critical intake screening and physical-original custody._ Conflicts (firm-wide matching over the Directory graph + role-links; immutable conflicts log) + Custodian (custody hierarchy rooted at Location; immutable check-in/out log).
- **Phase 5 — Discovery.** _Deliverable: ingest, search, review, and produce discovery at moderate scale._ ingest → OCR (PaddleOCR PP-OCRv6 via ONNX/`ort`) → Tantivy + Vectorize index → review (tag / redact / email-thread / near-duplicate) → production (Bates, applied redactions, privilege log, defensible per-doc hashing).
- **Phase 6 — Client-facing & scheduling.** _Deliverable: clients and the calendar._ Calendar & rules-based docketing → Tasks & workflows / matter plans → Client portal (the `PortalGrant` model) → Payments + e-signature → Intake / CRM (incl. receptionist call intake).
- **Phase 7 — Integrations.** _Deliverable: the plugin marketplace seam, populated._ email/calendar → accounting/banking → legal research/courts → messaging/voice (Telnyx) — each a Worker behind its port.
- **Ongoing:** maintenance agents, ADRs, user + developer docs, the load-profile performance harness. **When available:** the one-time **LEAP migration** (the sole legacy input; trust balances are the hard reconciliation gate before any cutover).

_Sequencing rationale._ Document/file management ships before the Financial Core at the owner's direction — the firm wants document handling finished first — with the ledger core itself built in Phase 0 as infrastructure so the Financial Core slots straight onto it. Conflicts, Custodian, and Discovery follow the Financial Core; client-facing and integrations come last. Because there is **no legacy system and no live clients** (_Guiding principles_ — _Greenfield_), the sequence carries no migration or backward-compatibility constraint — the only legacy touchpoint is the deferred LEAP import, built when export access exists.

---

## 37. Open research workstreams

- **Trust-rules catalog (50 states + DC + 5 territories).** Draft status, marked _Draft for attorney review_, in `docs/research/trust-rules/`:
  - Group 1 (AL–IN): complete, confidence-flagged. Low-confidence: AZ, AR, IN, CO, IL.
  - Group 2 (IA–NV): complete. **Nevada (home jurisdiction) verified in full** (RPC 1.15 + SCR 78.5/216–221, HIGH confidence); Iowa, Minnesota, and Massachusetts also fully verified; Michigan partial. Citation-confident but field-detail low (bot-gated portals): KS, KY, LA, MD, ME, MS, MO, MT, NE.
  - Group 3 (NH–TN): complete. Low-confidence: NM, ND, SD, OK, RI.
  - Group 4 (TX–territories): complete. Low-confidence: WY and the five territories.
  - **Verification pass (completed/stopped):** the Playwright pass added **15 jurisdictions** to `docs/research/trust-rules/group-5-verification-pass.md` — HIGH confidence for KS, KY, LA, MD, ME, MS, MO, MT, NE, AZ, IN, IL, ND; MEDIUM for AR; MEDIUM-LOW for CO. Net catalog status: **~38 of 56 jurisdictions HIGH-confidence and citable, ~5 partial, ~12 outstanding.**
  - **Still outstanding (need follow-up):** New Mexico, South Dakota, Oklahoma, Rhode Island, Wyoming, and the five territories (Puerto Rico, Guam, USVI, American Samoa, N. Mariana Islands); plus low/partial: Arkansas, Colorado. Common blocker: Lexum-hosted JS-gated court sites (AR, NM, CO) and thin/unreachable territory rules.
  - **Partial (verified with gaps):** Michigan (rule text), New York/New Jersey/Tennessee/South Carolina (flat-fee + reconciliation), Maryland (advance-fee detail).
  - **To finish the outstanding 12:** best via **CoCounsel/Westlaw** (pending Thomson Reuters connector entitlement, ref `ofid_436b60c622da81a1`) or manual attorney lookup — not worth further scraping.
- **Competitive analysis:** complete, in `docs/research/competitive-analysis.md`. Backlogged candidates: passive/automatic time capture, court e-filing, precedent library. (**LEDES/UTBMS e-billing promoted into v1** — see _Time tracking_/_Billing_; **client texting promoted into the _Communications layer_** as two-way messaging over the CPaaS messaging port, ADR-0047.)

---

## 38. Decision Log (ADR index seed)

The decision log lives in its own document: **[`docs/Decision-Log.md`](./Decision-Log.md)** (currently 59 decisions, through the Notifications subsystem decision). It is the authoritative status ledger and defines the ADR format, status lifecycle, and numbering standard; this white paper holds the narrative design and rationale. New decisions are appended there in the same commit as the change that settles them.
