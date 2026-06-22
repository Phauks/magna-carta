# Operations runbook

The single home for **deploy-time, non-code platform configuration** — the steps an operator performs in the Cloudflare dashboard, DNS, or `wrangler` that are not expressed in committed code. Code seams reference this file; the steps live here (one home per fact).

Each section is a numbered runbook. Where a step _activates_ committed code (a binding the code already declares, a `var` the code reads), that coupling is called out so an operator knows what flips on.

White-paper areas: _Observability and diagnostics_ · _Communications layer_ (email transport) · _Delivery model_. Decisions: ADR-0074 (telemetry baseline, email provider) · ADR-0073 (firm provisioning) · ADR-0056 (telemetry analytics tier) · ADR-0075 (deploy model).

---

## 1. Workers Logs + Logpush → R2 (the durable telemetry archive)

The telemetry Workers logger (`@magna-carta/telemetry`) emits one structured-JSON line per event; **Workers Logs** captures them. `wrangler.jsonc` already declares `observability: { enabled: true, head_sampling_rate: 1 }` (full sampling at current volumes) — no dashboard step is needed for Workers Logs themselves.

**Logpush → R2** is the durable archive the deferred analytics tier (ADR-0056, R2 Data Catalog / Iceberg) reads later. It is account configuration, not code:

1. In the Cloudflare dashboard, go to **Workers & Pages → your account → Logs → Logpush** (or **Account Home → Analytics & Logs → Logpush**).
2. Create a Logpush job with **Workers** as the dataset, destination **R2**, targeting a dedicated bucket (suggested name `magna-carta-production-telemetry-archive`, created first under **R2**).
3. Use a date-partitioned object-key prefix (e.g. `workers-logs/{DATE}/`) so the analytics tier can prune by day.
4. Retention: keep raw logs ~92 days on the bucket's lifecycle rule (the ADR-0056 trigger boundary); the Iceberg tier, when adopted, reads from this same prefix.

Until the analytics tier is built, this archive simply accumulates — nothing consumes it. Adopt the tier when an ADR-0056 trigger binds (retention past ~92 days, exact/unsampled counts, rich joins, or cost-at-scale).

## 2. Email Sending on `magnacarta.esq` (the deliverability lever + adapter activation)

The Worker declares the `send_email` binding (`SEND_EMAIL`) and the code selects the Cloudflare Email Service adapter **only when the `EMAIL_FROM` var is also set** (`apps/worker/src/app.ts` `emailAdapterForEnv`). Until then the logging adapter runs, so no send fails against an un-onboarded domain. This runbook is what makes real email work:

1. **Onboard the domain.** Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**; choose `magnacarta.esq`. The domain must use Cloudflare DNS.
2. **Accept the DNS records** Cloudflare adds on the `cf-bounce` subdomain: MX (bounce routing), TXT SPF (authorize sending), TXT DKIM (signing), TXT DMARC on `_dmarc.magnacarta.esq`. Propagation is usually 5–15 minutes. Correct DKIM/SPF is the actual deliverability lever at these volumes.
3. **Verify the destination address (beta constraint).** During the public beta, sending to a destination requires it to be a verified address in the account (the free-on-all-plans path). Verify the addresses transactional mail goes to, or complete domain verification for open sending as the beta allows.
4. **Activate the adapter.** Set the `EMAIL_FROM` var (e.g. `no-reply@magnacarta.esq`) — as a `wrangler.jsonc` `vars` entry (committed) or `wrangler secret`-adjacent var. The next deploy selects `createCloudflareEmailAdapter`; auth's reset/verification mail then flows over the binding, each send logging `email.sent` (class + outcome, never body).
5. **If deliverability disappoints**, the port seam means swapping to Resend/SES is one adapter (ADR-0074); re-verify the beta's current limits at that point.

> Do **not** set `EMAIL_FROM` before steps 1–3 are done — it would activate the adapter against an un-onboarded domain and every send would fail. The binding being present is harmless; `EMAIL_FROM` is the switch.

## 3. Deploy secrets (the `secrets.required` gate)

`wrangler.jsonc` lists `secrets.required` (currently five names), so a deploy **fails loudly** with a missing-secret list rather than letting routes 500 at runtime. Set each once per environment — Dashboard → the Worker → **Settings → Variables and Secrets**, or `wrangler secret put <NAME>` (paste the value at the prompt; keep it out of shell history and chat transcripts). `wrangler secret list` confirms the registered names.

| Secret | What it is | How to produce it | Rotatable? |
| --- | --- | --- | --- |
| `AUTH_SECRET` | Better Auth signing key — signs sessions and the cookieless preview-delivery tokens | `openssl rand -base64 32` (Windows, no openssl: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) | Yes, but rotating logs out all sessions and invalidates in-flight preview tokens (harmless pre-launch) |
| `PLATFORM_ADMIN_KEY` | Bearer key guarding the platform-admin routes | any high-entropy random string | Freely — rotate and update callers |
| `R2_S3_ACCESS_KEY_ID` + `R2_S3_SECRET_ACCESS_KEY` | The R2 S3-API token the File Manager uses to presign upload/download URLs | Dashboard → **R2 → Manage R2 API Tokens → Create**, an _Object Read & Write_ token scoped to the production files bucket; copy the Access Key ID + Secret Access Key (the secret is shown once) | Freely — delete + re-mint the token; only breaks in-flight (~5 min) presigned URLs |
| `ROOT_KEK` | The **root key-encryption-key**: AES-KW-wraps each firm's data key (envelope encryption — see [`security.md`](security.md)) | `openssl rand -base64 32` — base64 of 32 random bytes = a 256-bit key (the code `atob`-decodes it; standard base64, not base64url) | **No — generate once and back up.** See the warning |

> **`ROOT_KEK` is not freely rotatable.** It wraps every per-firm key; replacing it without a re-wrap migration makes all `protected()` data permanently unrecoverable. Generate it **once**, set it, and **back it up in ≥2 secure places** (a secrets manager + a sealed offline copy) before any firm stores protected data. Rotation machinery is not built — the ciphertext frame reserves `algo_version | key_version` as the seam, and the re-wrap sweep is a scheduled hardening build (see [`../../ROADMAP.md`](../../ROADMAP.md) → _Hardening_), gated to before the first real client or a compromise event.

`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are **optional** deploy-time secrets for the REST `FirmResourceProvider`; absent them, the dev pool-claiming adapter runs. Secrets posture detail lives in [`security.md`](security.md).

> The gate covers **secrets** only. The Worker's declared **Queues** must also already exist in the target account — `wrangler deploy` aborts on the first missing one. The declared queues live in `apps/worker/wrangler.jsonc` (`…-platform-jobs`, `…-files-ingest` + `…-files-ingest-deadletter`, `…-inference` + `…-inference-deadletter`); create any that are absent with `wrangler queues create <name>` (or the dashboard) before deploying.

## 4. Adding a per-firm D1 binding (beyond the starter pool)

Per ADR-0073, a firm provisioned beyond the pre-declared `DB_FIRM_POOL_*` pool needs its per-firm D1 bound into the Worker — Miniflare/Wrangler bind D1 at config time, not runtime:

1. The REST `FirmResourceProvider` creates the per-firm D1 (needs the optional credentials above).
2. Add a `d1_databases` entry to `wrangler.jsonc` (binding name = the firm's `database_identifier`, resolved by `firm-binding-resolver.ts`).
3. Commit and deploy. Until this lands, the firm's database is **absent** to the deployment (ADR-0052 — a 404, never an oracle), and the next provisioning resume picks it up.

## 5. Dependency audit allowlist (accepted advisories)

The CI `pnpm audit --audit-level high` gate fails on any **new** high+ advisory. Two pre-existing **transitive dev/build-tooling** advisories are accepted in `package.json` → `pnpm.auditConfig.ignoreGhsas`, neither with a production-runtime exploit path:

- **`GHSA-gv7w-rqvm-qjhr`** (esbuild — dev-server CORS): esbuild is build-time only (Vite/Wrangler bundling); the Worker runs no esbuild dev server. Arrives via `vitest-pool-workers`, `vite-plus`, `drizzle-kit`.
- **`GHSA-r5fr-rjxr-66jc`** (lodash — `_.template` code injection): transitive via `better-auth` / `drizzle-kit`; the vulnerable template path is not invoked by our usage.

Each entry **drops** when Renovate upgrades the carrying dependency past the fix. Adding a new entry is an explicit security decision — never a quick unblock.

## 6. Dashboard one-time toggles (slice 0·6)

- **Renovate GitHub App** — enable on the repository (propose-only; `renovate.json` configures pin/weekly/drizzle-pin). Review the onboarding PR like any other.
- **GitHub secret scanning** — enable in the repository's **Settings → Code security**.

## 7. Company email & account-of-record (Google Workspace)

The firm's _operational_ mailboxes and the email identity that **owns** third-party accounts (Cloudflare, GitHub, EasyPost, Google Cloud, the domain registrar). This is distinct from §2, which is the _product's_ transactional sending (`no-reply@`, Cloudflare Email Sending) — the two co-tenant the one `magnacarta.esq` DNS zone and must be coordinated (step 5). Decision and rationale: ADR-0100. Recurring cost is tracked in the [operating-cost register](../operating-costs.md).

**As built (2026-06-18):** stood up on `magnacarta.esq`. Paid seat `trevor.goldsmith@`; `ops@`/`billing@`/`support@`/`legal@`/`privacy@`/`security@` exist as free user-aliases forwarding into it (send-as identities auto-populate within ~24h of creation). `postmaster@`/`abuse@` are Google-reserved system addresses (auto-routed, cannot be created). DKIM is auto-enabled by Google. Super-admin 2-Step Verification is hardened (security key). New vendor logins go on `ops@` from here.

**Email authentication — as built & verified (2026-06-18).** The zone (`magnacarta.esq`, Cloudflare DNS) authenticates two independent senders and is aligned for both:

- **Apex MX** → `smtp.google.com` (Google receiving). **`cf-bounce` MX** → `route{1,2,3}.mx.cloudflare.net` (Cloudflare bounce handling). No collision.
- **SPF** — apex `v=spf1 include:_spf.google.com ~all` (Google; added by operator — Cloudflare won't add it). Cloudflare's `v=spf1 include:_spf.mx.cloudflare.net ~all` lives on `cf-bounce`. Keep `~all` (Google-recommended) while senders are still being enumerated; tightening the apex to `-all` is an optional later hardening once DMARC reports confirm every legitimate sender — **not** required for BIMI.
- **DKIM** — Google `google._domainkey` + Cloudflare `cf-bounce._domainkey`; distinct selectors, both present.
- **DMARC** — one apex `_dmarc` record, currently **`p=quarantine`**, with **Cloudflare DMARC Management** enabled (free; appends its `rua` ingestion address without overwriting, parses aggregate reports in-dashboard). Verified: a test send from `trevor.goldsmith@` passes SPF + DKIM + DMARC. **Do not add `adkim=s`/`aspf=s`** — strict SPF alignment breaks the Cloudflare product sender (apex From, `cf-bounce` envelope), which relies on relaxed alignment.
- **DNSSEC** — enabled on the zone (2026-06-18); Cloudflare auto-publishes the DS to the `.esq` registry via CDS/CDNSKEY (no manual registrar step). **Multi-signer DNSSEC** and **multi-provider DNS** stay **off** — single-provider zone (Cloudflare only); enabling them would risk the DNSSEC chain for no benefit.

**Ramp plan:** monitor DMARC reports ~1–2 weeks → verify the product `no-reply@` sender aligns once `EMAIL_FROM` activates it (§2) → ramp `quarantine` → `reject`. **BIMI (future, gated on trademark):** needs enforced DMARC (`quarantine pct=100` or `reject`) + an SVG Tiny PS logo + a **VMC** (requires a registered logo trademark, ~$1–1.5k/yr) + a `default._bimi` record — ties to the `magnacarta.esq` trademark work (ADR-0090).

**Deferred task — move the existing Cloudflare account off personal Gmail.** The Cloudflare account (the only pre-existing vendor login) is still on the founder's personal Gmail. Move its identity to `ops@magnacarta.esq` by **changing the account email / adding `ops@` as a Super Administrator on the _same_ account** — keeping personal Gmail as the off-domain break-glass recovery (rule 1; `ops@` is a secondary contact, never sole recovery). Do **not** create a new Cloudflare account and migrate resources across: Cloudflare has no clean cross-account move for D1/R2/Workers, whereas an in-place identity change carries over every binding, database, bucket, and zone with zero migration. The `.esq` registrar identity moves the same way, separately. Deferred (no deadline).

Two rules bind regardless of the steps below:

- **Recovery stays off the domain it depends on.** `*@magnacarta.esq` mail only resolves while Cloudflare DNS and the Cloudflare account are reachable, so the **Cloudflare account and the `.esq` registrar keep an independent break-glass recovery mailbox _outside_ `magnacarta.esq`** (a personal mailbox) — never their sole recovery on `@magnacarta.esq`, which is a lock-yourself-out loop. Accounts that do **not** serve this domain's DNS (GitHub, EasyPost, Google Cloud, npm) move fully onto `ops@magnacarta.esq`.
- **Infra/API accounts use role addresses, not a person.** Third-party logins go on `ops@`/`billing@`, never a personal `name@`, so recovery and handoff are not tied to one human.

Runbook:

1. **Stand up Workspace.** Google Workspace Business Starter, domain `magnacarta.esq`. Verify domain ownership (the TXT record Google issues, added in Cloudflare DNS).
2. **One paid seat; role addresses as free aliases.** The single paid seat is the human mailbox; `ops@`, `billing@`, `support@`, `legal@`, `privacy@`, `security@`, plus the RFC-expected `postmaster@`/`abuse@`, are aliases/Groups forwarding into it (Google bills per seat, not per alias). `no-reply@magnacarta.esq` is **reserved by the product sender** (§2) — do not create it as a Workspace mailbox.
3. **Harden the keystone.** Enforce a security key or TOTP (not SMS) on the Google account; store recovery codes offline. This one account gates everything — protect it hardest.
4. **Migrate the non-DNS third parties** (GitHub, EasyPost, Google Cloud, npm, …) onto `ops@`. For **Cloudflare + the registrar**, keep the independent break-glass mailbox as recovery (rule 1); `ops@` may be added only as a _secondary_ contact, never the sole recovery.
5. **Coordinate DNS with §2 (the gotcha).** Both Google Workspace and the product's Cloudflare Email Sending authenticate on this one zone:
   - **MX** — Google's on the **apex**; Cloudflare's bounce MX on the **`cf-bounce`** subdomain. Different names, no collision.
   - **SPF** — apex SPF is Google's (`include:_spf.google.com`); Cloudflare's SPF lives on `cf-bounce`. No collision.
   - **DMARC** — there is exactly **one** `_dmarc.magnacarta.esq` record for the whole zone. Set it once to cover **both** senders; do not let either setup overwrite the other's DMARC.

> **Future hardening (seam, not now):** promote `ops@` to its own seat with independent 2FA once a team forms, so a compromise of the human seat is not also a compromise of the infra account-of-record.

## 8. Cloudflare zone Pro plan — enablement, usage & deliberate non-use

The `magnacarta.esq` **zone** is on the **Pro** plan (acquired 2026-06-20). This is a per-domain subscription and is a **separate billing track** from **Workers Paid** (already active — the floor the whole platform runs on: Workers, per-firm D1/R2, Queues, Durable Objects, Vectorize, Containers). The two stack independently; nothing here touches the Workers bill. Recurring cost is tracked in the [operating-cost register](../operating-costs.md), not here.

Architectural reality that decides what to use: Magna Carta is **Workers-native** — the app runs at every edge PoP, there is **no traditional origin**. So the zone's _origin-optimization_ machinery (Argo Smart Routing, Load Balancing, Polish) has little to act on, while the zone's _security and Rules_ layer is where Pro earns its keep. The phases below are ordered by value, and §8.5 lists what to deliberately leave **off** so an operator does not enable cost or complexity that buys nothing here.

Each box is an operator action in the Cloudflare dashboard. Where a step couples to committed code, it is called out.

### 8.1 Phase 0 — free zone hygiene (independent of Pro; do first)

These are free on every plan and easy to miss. A legal SaaS should have them on regardless.

- [ ] **TLS floor** — **SSL/TLS → Edge Certificates**: Minimum TLS Version **1.2**, **TLS 1.3** on, **Always Use HTTPS** on, **Automatic HTTPS Rewrites** on, **Opportunistic Encryption** on.
- [ ] **HSTS** — enable with a long max-age + `includeSubDomains`; only after confirming every hostname (incl. future custom hostnames, §8.4) is HTTPS-only, since HSTS is hard to walk back.
- [ ] **Modern Rules engine, not legacy Page Rules** — author **Cache Rules** (per-path cache control), **Configuration Rules** (scope zone settings per-route), **Transform Rules** (request/response header rewrites), and **Compression Rules** as needed. Migrate any legacy Page Rules onto these — Page Rules are being sunset.
- [ ] **Tiered Cache + Smart Tiered Cache** — **Caching → Tiered Cache**: enable both (free on all plans). Modest benefit for a Workers app, but free and harmless; set a cloud-region hint only if an external origin appears.
- [ ] **Turnstile** — stand up on auth / intake / payment / portal forms. Free; a build seam and skill already exist (`cloudflare:turnstile-spin`). Complements Super Bot Fight Mode (§8.2).

### 8.2 Phase 1 — the Pro security layer, enable now (the actual reason for Pro)

These protect dev/staging too, carry low blast radius, and don't depend on real traffic or real users — so turn them on now. (The two traffic-/user-shaped items — rate limiting and custom error pages — are deferred to the pre-beta gate, §8.6.)

- [ ] **WAF Managed Rulesets** — **Security → WAF → Managed rules**: deploy the **Cloudflare Managed Ruleset** and the **Cloudflare OWASP Core Ruleset** (both Pro-gated; Free only had the thin Free Managed Ruleset). The Free Managed Ruleset is then redundant with the Cloudflare Managed Ruleset — do not run both.
  - **Gotcha — tune before enforcing.** The OpenAPI/zod JSON API will trip generic OWASP signatures. Start the OWASP ruleset in a low-paranoia / log-or-anomaly-score mode, watch **Security → Events** for false positives on legitimate JSON request bodies, then ramp to block. Scope exceptions with the ruleset engine per-route rather than disabling rules zone-wide.
- [ ] **Exposed-Credentials Check** — enable (Pro-gated). Flags logins using known-leaked credentials; high value for the portal.
- [ ] **Super Bot Fight Mode** — **Security → Bots**: turn **off** plain Bot Fight Mode and turn **on Super Bot Fight Mode** (Pro-gated; the two are mutually exclusive). Configure separate handling for _definite_ vs _likely_ bots, keep the verified-bot allowlist, and decide static-resource handling.

### 8.3 Phase 1 verification — confirm the now-gates actually flipped

- [ ] Hit a known-malicious pattern against a staging route → appears in **Security → Events** under the managed ruleset.
- [ ] Confirm the **current Pro monthly price** and **WAF custom-rules count for Pro** in the dashboard, and record the price in the [operating-cost register](../operating-costs.md) (numbers shift; do not hard-code them here).
- [ ] (Rate-limit + custom-error verification lives with the §8.6 gate, since those are deferred.)

### 8.4 Phase 2 — Cloudflare for SaaS (multi-tenant custom hostnames)

Gated on the client-portal-on-custom-domain feature landing (firms using `portal.theirfirm.com`). Independent of the Pro tier — available on every plan — but listed here because it is the multi-tenant edge primitive.

- [ ] When that feature is built, adopt **custom hostnames**: 100 included, then **$0.10/hostname** (track in the cost register). SSL issuance + routing fall under this one zone.
- [ ] **Verify WAF/bot coverage extends to custom hostnames** at the Pro tier before promising tenant-facing protection — some advanced WAF-on-custom-hostname behavior has historically needed higher tiers. Confirm against current docs at build time.

### 8.5 Deliberately OFF — do not enable (they buy nothing here, or cost extra for no gain)

- **Argo Smart Routing** — optimizes origin round-trips; a Workers-native app has no origin to route to. Separate usage-based add-on, not part of Pro. **Leave off.**
- **Load Balancing** — balances across origin pools; you have none (Workers + Containers run on Cloudflare). Separate add-on. **Leave off** until/unless an external origin is introduced, then revisit.
- **Polish (and WebP/AVIF delivery)** — Polish only acts on the **origin-pull cache path** (images Cloudflare fetches from a traditional origin and caches). Two reasons that lane is empty here: (1) Workers-native — the SPA's images ship as **Workers static assets** served by the runtime, not pulled from an origin, so Polish has nothing to optimize (Cloudflare also says don't run Polish with the Images binding, which we already use); (2) the high-volume images are **privileged client documents/exhibits** served through authenticated routes that must **never** be edge-cached (tenancy/confidentiality). So **lossy vs lossless is moot** — and on evidentiary imagery lossy is _actively wrong_ (silent degradation) and even lossless metadata-stripping can harm provenance. **Leave Polish off entirely.** Modern-format delivery is still wanted, but done at the seams we control: **build-time** AVIF/WebP with `<picture>` fallbacks for static/design-system assets, and the **Images binding (`env.IMAGES`)** for user-derived images (AVIF-first → WebP → original, `Accept`-negotiated, under auth; originals untouched for documents/evidence). "Switch to WebP" globally would be a step _back_ from AVIF.
- **Cache Reserve** — R2-backed, usage-billed. **Defer** until cacheable-asset volume justifies it (golden rule 10: measure first).
- **Waiting Room** — Business+, not Pro; aimed at thundering-herd consumer events a B2B legal tool will not see. **Skip.**
- **Snippets** (Pro: 25) — lightweight edge JS for zones that **don't already run a Worker**, or that front a third-party origin. We are Workers-native: the app Worker handles every request and **is** the origin, so anything a Snippet could do the Worker already does — in TypeScript, tested, typed, under CI/`pnpm check`/the process-ref lint and the standard error pipeline. A dashboard Snippet would fragment request handling across an un-versioned surface outside those gates (one-home-per-fact). **Skip.** For edge-only needs, reach for declarative **Transform / Redirect / WAF** rules first, then the Worker; revisit Snippets only if a hostname without a Worker ever appears.

### 8.6 Pre-beta / pre-release gate — rate limiting + custom errors (deferred 2026-06-20)

Both need things that don't exist yet during early build: **real endpoint traffic** (to set thresholds without throttling ourselves) and **real users** (beta testers who'd actually see a branded error/challenge page). Do this batch as part of standing up the beta — not before. Verification (the §8.3 checks that were deferred) happens here: exceed a threshold → Managed Challenge fires; force a 404/500 → branded page renders.

**Rate Limiting Rules** — **Security → Security rules → Create rule → Rate limiting rules** (older nav: Security → WAF → Rate limiting rules). Pro: **10** rules + Managed-Challenge/Challenge/Log actions (not just Block), counts **by IP only**, period up to **1 min** (10/15/20/30/40/45/60s), mitigation timeout up to **1 hr**, matching on Host/URI/Path/Full URI/Query/Verified Bot.

- **Framing:** CF rate limiting is the **unauthenticated front door** (login, password reset, MFA verify) — endpoints with no user identity yet. **Authenticated** per-user/per-firm abuse belongs **in the Worker** (keyed by user/firm id), since IP counting can't tell users apart. **Public signup is disabled** (`auth.ts` `disableSignUp: true`; membership is invite-only), so there is **no** signup rule; invite creation is `POST /api/v1/members`, already behind auth + the chokepoint + an idempotency key + `firm:manageMembers` — not an anonymous front door, so it needs no dedicated IP limit.
- **NAT gotcha (binds the thresholds):** a law-firm office usually egresses **one IP**, so tight IP limits throttle a whole firm. Set generous thresholds and prefer **Managed Challenge** over **Block** (NAT'd legit users get challenged, not locked out); reserve Block for clearly abusive volume.
- Auth lives under `/api/auth/*` (Better Auth, `twoFactor()` plugin enabled — `auth.ts`). Confirm exact sub-paths against live traffic before pinning. Per rule: name → matching **expression** → **With the same characteristics as** = **IP** → **When rate exceeds** requests/period → **Action** → **Duration** → Deploy. Starter set (uses ~6 of 10; specific rules first, coarse rule last):
  - [ ] **Login** — `POST` `/api/auth/sign-in/email` → 10 / 1 min → Managed Challenge, 1 hr.
  - [ ] **Forgot password** (sends mail → email-bombing vector) — `POST` `/api/auth/forget-password` → 5 / 1 min → Managed Challenge, 1 hr.
  - [ ] **Reset password** (token submit → token brute force) — `POST` `/api/auth/reset-password` → 5 / 1 min → Managed Challenge, 1 hr.
  - [ ] **2FA verify** (OTP/backup brute force) — `POST` `/api/auth/two-factor/verify-totp` (and `/verify-backup-code`) → 10 / 1 min → Managed Challenge, 1 hr.
  - [ ] **Verification-email resend** (email-bombing vector) — `POST` `/api/auth/send-verification-email` → 5 / 1 min → Managed Challenge, 1 hr.
  - [ ] **Coarse API-write backstop** — `starts_with "/api" and http.request.method in {"POST" "PUT" "PATCH" "DELETE"}` → ~200 / 1 min (tune) → **Log first**, observe real office-NAT volume, then ramp to Managed Challenge. Don't broadly limit `GET` reads.

**Custom Errors / Error Pages** — Pro: **25** error assets + rules. Three distinct mechanisms, different jobs:

- **Error Pages** (**Rules → Settings**, zone-level; account-level also exists, zone overrides) — whole-class pages and the **only** way to brand **challenge / security-action** pages (WAF block, rate-limit Managed Challenge). Cannot customize 500/501/503/505.
- **Custom Error Rules** (**Rules → Overview**) — conditional (ruleset engine), fire on HTTP **400+ incl. 5xx (except 520–527) and 1xxx Worker errors**; priority over Error Pages; do **not** apply to security/challenge actions.
- **Custom Error Assets** (**Rules → Settings**) — reusable, **self-contained** HTML/CSS/JS referenced by rules.
- **Coupling (golden rule 4):** the Worker handles its own 4xx/5xx in code (JSON for `/api/*`, app shell for browser routes) and attaches the user-facing **Error ID**. Custom Errors are for failures that **bypass or precede the Worker** (edge 5xx, Worker crash/over-CPU/timeout 1101/1102/1027, challenges) — those pages **cannot carry an Error ID** (the Worker never ran), so make them static, reassuring, and point to `support@magnacarta.esq`; do not fake a correlation ID.
  - [ ] Create two self-contained assets (inline CSS; no external fonts/scripts that could also be down): `mc-error-page-generic` (browser) and `mc-error-api-json` (JSON body with `support@` contact).
  - [ ] Custom Error Rule 1 — `http.request.uri.path starts_with "/api"` + error → serve `mc-error-api-json` (add a Response Header Transform Rule for `Content-Type: application/json` if needed).
  - [ ] Custom Error Rule 2 — browser catch-all → serve `mc-error-page-generic`.
  - [ ] Error Pages (zone) — brand the **Managed Challenge / challenge** page (what rate-limit + WAF challenge actions show; Custom Error Rules can't touch it).
  - [ ] *(Later, §8.4)* portal-specific page matched on `Host` once custom hostnames exist.

> Re-evaluation seam: the OFF list above is correct **while the architecture stays Workers-native with no external origin**. If a future slice adds a self-hosted/third-party origin, re-open Argo and Load Balancing for that origin specifically.
