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

| Secret                                            | What it is                                                                                                                  | How to produce it                                                                                                                                                                               | Rotatable?                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`                                     | Better Auth signing key — signs sessions and the cookieless preview-delivery tokens                                         | `openssl rand -base64 32` (Windows, no openssl: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)                                                                  | Yes, but rotating logs out all sessions and invalidates in-flight preview tokens (harmless pre-launch) |
| `PLATFORM_ADMIN_KEY`                              | Bearer key guarding the platform-admin routes                                                                               | any high-entropy random string                                                                                                                                                                  | Freely — rotate and update callers                                                                     |
| `R2_S3_ACCESS_KEY_ID` + `R2_S3_SECRET_ACCESS_KEY` | The R2 S3-API token the File Manager uses to presign upload/download URLs                                                   | Dashboard → **R2 → Manage R2 API Tokens → Create**, an _Object Read & Write_ token scoped to the production files bucket; copy the Access Key ID + Secret Access Key (the secret is shown once) | Freely — delete + re-mint the token; only breaks in-flight (~5 min) presigned URLs                     |
| `ROOT_KEK`                                        | The **root key-encryption-key**: AES-KW-wraps each firm's data key (envelope encryption — see [`security.md`](security.md)) | `openssl rand -base64 32` — base64 of 32 random bytes = a 256-bit key (the code `atob`-decodes it; standard base64, not base64url)                                                              | **No — generate once and back up.** See the warning                                                    |

> **`ROOT_KEK` is not freely rotatable.** It wraps every per-firm key; replacing it without a re-wrap migration makes all `protected()` data permanently unrecoverable. Generate it **once**, set it, and **back it up in ≥2 secure places** (a secrets manager + a sealed offline copy) before any firm stores protected data. Rotation machinery is not built — the ciphertext frame reserves `algo_version | key_version` as the seam, and the re-wrap sweep is a scheduled hardening build (see [`../../ROADMAP.md`](../../ROADMAP.md) → _Hardening_), gated to before the first real client or a compromise event.

`CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` / `CLOUDFLARE_ACCOUNT_ID` are **optional** deploy-time secrets for the REST `FirmResourceProvider`; absent them, the dev pool-claiming adapter runs. Secrets posture detail lives in [`security.md`](security.md).

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
  - [ ] _(Later, §8.4)_ portal-specific page matched on `Host` once custom hostnames exist.

> Re-evaluation seam: the OFF list above is correct **while the architecture stays Workers-native with no external origin**. If a future slice adds a self-hosted/third-party origin, re-open Argo and Load Balancing for that origin specifically.

## 9. Bulk-ingest queue + weekly re-scan cron (slice 2·1 Plan 1)

Two Cloudflare Queues and one new cron trigger added in slice 2·1 Plan 1 must be present before deploying.

**Queues (wrangler does not auto-create them — create once per environment):**

1. **Primary queue:** `magna-carta-production-files-ingest-bulk` — a separate, lower-concurrency bulk lane so a large import cannot starve interactive uploads (background ingests). Create via the Cloudflare dashboard (**Workers & Pages → Queues → Create queue**) or `wrangler queues create magna-carta-production-files-ingest-bulk`.
2. **Dead-letter queue:** `magna-carta-production-files-ingest-bulk-deadletter` — receives messages the bulk consumer fails to process after all retries. Create it the same way, then configure it as the dead-letter destination on the primary queue.

The interactive-lane queue (`files-ingest`) and its dead-letter already exist from slice 1·1. The two new queues above are additional; the Worker `wrangler.jsonc` binds them, but Wrangler will error on deploy if they do not yet exist in the account.

**Cron trigger:** `0 4 * * 0` (Sundays at 04:00 UTC) — the weekly re-scan sweep re-queues `unscanned` versions for re-inspection when a new scan engine becomes available. The cron is declared in `wrangler.jsonc`; it activates automatically on the next deploy. No manual dashboard step is required beyond verifying the trigger appears under the Worker's **Triggers** tab after deploy.

## 10. Async bulk-download build queue + `bundles/` lifecycle rule (slice 2·1 Plan 3)

Past the live-download threshold, a bulk ZIP is built in the background as an R2 artifact instead of streamed inline. The build needs a queue, and the artifacts need a TTL so they do not accumulate.

**Queue (wrangler does not auto-create it — create once per environment):**

1. **Primary queue:** `magna-carta-production-bundle-build` — carries one content-addressed selection per message to the build consumer (R2 object bodies streamed through `client-zip` into one R2 object). Create via the dashboard (**Workers & Pages → Queues → Create queue**) or `wrangler queues create magna-carta-production-bundle-build`.
2. **Dead-letter queue:** `magna-carta-production-bundle-build-deadletter` — receives a build the consumer fails after all retries. Create it the same way, then set it as the dead-letter destination on the primary queue.

The Worker `wrangler.jsonc` binds both; Wrangler errors on deploy if they do not yet exist.

**R2 lifecycle rule (account configuration, not code — like the Logpush retention in section 1):** add an **object-expiration lifecycle rule on the `bundles/` prefix** of each firm's bucket (suggested **~7-day** expiration). The artifacts are a regenerable cache — content-addressed by manifest hash, rebuilt on demand — so expiring them only forces a rebuild on a later identical request. Configure under **R2 → the bucket → Settings → Object lifecycle rules**, prefix `bundles/`, delete after 7 days. The signed-download URL TTL is **independent and short** (300 s, minted fresh on each poll); the lifecycle rule governs only the stored object.

**Durable Object:** the build is coordinated by `BundleBuildCoordinator` — the codebase's **first Durable Object** — declared in `wrangler.jsonc` (`durable_objects` binding + the `v1` `new_sqlite_classes` migration) and exported from `src/index.ts`. It activates automatically on deploy; no dashboard step. A second DO class (e.g. Plan 2's scan container) appends to the same `durable_objects` list and either the same or a new `migrations` tag.

**Cost:** near-zero marginal — Queues + DO invocations + R2 PUT/GET on a regenerable, TTL-expired artifact; no always-on compute. The Container escalation for outlier-large bundles is a named seam, not built here.

## 11. Malware-scan Worker — deploy-time activation + Cloudflare-native signature refresh

The scan engine lives in its own Worker (`apps/scan-worker`, service `magna-carta-scan`). It owns the `ScanContainer` — a `linux/amd64` Container (`containers/scan/`): a long-lived clamd daemon plus a Rust HTTP service that fans each file to clamd (signatures), yara-x (heuristic rules), and structural heuristics (PDF/Office/archive). The app Worker (`apps/worker`) reaches it exclusively over a `SCAN_SERVICE` service binding; `resolveScanPort` selects the remote engine when that binding is present, otherwise the engine-less `unscanned` adapter (an honest `unscanned`/no-engine verdict, never a false `clean`). The app Worker carries **no** container config of its own.

The scan worker is **built, connected to Workers Builds, and deployed** as of 2026-06-28 — the `SCAN_SERVICE` binding in the app Worker is wired and live, so production runs the real engine (local/test envs still use the engine-less adapter — no container pool). The first-activation steps below are retained as the record of what activation entailed; the **acceptance checks** are **deferred** until a prod firm/member is provisioned (none yet — the auth UI is slice 0·7b), since they need an authenticated principal to call `POST /api/v1/scan/diagnose`. The container required a `bookworm`→`trixie` base for onnxruntime's glibc-2.38 symbols (Magika `/identify`).

### First-activation steps

1. **Connect `apps/scan-worker` to Workers Builds.** In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** (or **Connect to Git** on the existing `magna-carta-scan` Worker if already created). Select the repository and configure `apps/scan-worker` as the build root. Workers Builds is Cloudflare-side CI — there is **no `CLOUDFLARE_API_TOKEN` in GitHub**; the connection is managed entirely from the dashboard. Every push to the production branch triggers a build: `freshclam` bakes the current signature DB and `build-yara-rules` fetches + compiles the latest YARA Forge rule package, both baked into the image at build time, and the new image is deployed.

2. **Set the Deploy Hook secret on the scan worker.**

   ```sh
   wrangler secret put SCAN_BUILD_DEPLOY_HOOK_URL --name magna-carta-scan
   ```

   Paste the **Workers Builds Deploy Hook URL** for `magna-carta-scan` at the prompt (generated in the dashboard under the Worker's **Settings → Builds → Deploy Hooks → Create**). This URL is what the scan worker's daily `0 7 * * *` cron POSTs to trigger a nightly image rebuild and signature refresh. Keep the URL out of shell history and chat transcripts — treat it like a secret (it triggers a deploy).

3. **Push to the production branch** to trigger the first Workers Builds build. The build runs `freshclam` (baking the current signature DB) and `build-yara-rules` (fetching + compiling the latest YARA Forge package), then deploys `magna-carta-scan`. The `*/20` warm-poke cron then keeps one instance — and clamd's resident DB — alive.

4. **Deploy the app Worker** (`apps/worker`) so the `SCAN_SERVICE` binding resolves to the now-live scan service. `resolveScanPort` then selects the remote engine path on the next ingest.

### Architecture notes

**No runtime egress — signatures and rules are image-only.** The container runs with `enableInternet = false`; there is no runtime path to fetch signatures or rules. Freshness comes entirely from image rebuilds. The daily `0 7 * * *` cron on the scan worker POSTs `SCAN_BUILD_DEPLOY_HOOK_URL`, triggering a Workers Builds rebuild+redeploy that re-runs both `freshclam` and `build-yara-rules` — a Cloudflare-native loop with no GitHub involvement.

**YARA rules source — YARA Forge `extended`, self-updating, FP-filtered.** The build fetches the latest [YARA Forge](https://yarahq.github.io/) release (the `YARA_FORGE_TIER` build ARG, default `extended`; pin `YARA_FORGE_TAG` for a reproducible build or a rollback), and `build-yara-rules` drops the false-positive-prone heuristic pocket (`_SUSP_` rules scoring below `YARA_MIN_SUSP_SCORE`, default 75), compiles the kept set with yara-x (skipping + logging any rule yara-x cannot compile, failing the build only on a systemic collapse), and serializes it into the image. The service deserializes the blob at boot — no startup recompile. The resolved release tag becomes the engine-version `yara-rules/<tag>` component, so when a nightly rebuild picks up a **new** Forge release the engine version changes and the access-triggered re-scan staleness gate re-scans the fleet against the new rules; an unchanged release leaves the version (and the fleet) untouched. A YARA hit is treated identically to a clamd signature hit (`infected`) — one quarantine path, no separate workflow.

> **Re-scan cadence.** YARA Forge publishes roughly **weekly** (date-tagged releases), so the nightly rebuild resolves a new `latest` ~once a week → a fleet-wide re-scan wave about weekly (access-triggered + cache-first, so a file nobody opens is never re-scanned and identical content reuses its verdict). If that recurring cost is unwanted, **pin `YARA_FORGE_TAG`** and bump it deliberately (matching the "engine-code bump is intentional" philosophy) — the default is unpinned `latest` so rules self-update.
>
> **Supply-chain note (accepted).** The downloaded ZIP is fetched over TLS but is **not** checksum/signature-verified — the same trust model as `freshclam`. A compromised upstream release would ship on the next nightly rebuild. This is the deliberate cost of self-updating from a trusted maintained provider; mitigations if the posture tightens are pinning `YARA_FORGE_TAG` to a reviewed release and/or adding a SHA-256 verification step before unzip.

**clamd limits and the inspectable cap must stay aligned.** `entrypoint.sh` raises clamd's `StreamMaxLength`/`MaxScanSize`/`MaxFileSize` to 2048M so clamd scans the whole 2 GiB inspectable cap. The stock clamd limits (`StreamMaxLength` 25M, `MaxScanSize`/`MaxFileSize` 100M) would refuse anything larger over INSTREAM and degrade it to a retryable engine fault. A scan near the cap holds the full body in the Rust service **and** clamd's own copy atop the resident clamd DB — plus, since rule-loading landed, the resident `Arc<yara_x::Rules>` (the ~15 MB blob expands to compiled bytecode/atom tables) and yara-x's per-scan working set over the 2 GiB buffer. `standard-1` (4 GiB) is the floor for this reason. For reliable full-size (≈2 GiB) scanning, keep `instance_type` at or above `standard-1`, or lower `fileManager.inspectableSizeCapBytes` — the clamd limits and the inspectable cap must always be consistent. (The body bytes are file-backed/mmap and reclaimable; the rules and clamd DB are resident.)

**Engine-fault handling.** A clamd fault with no other signal returns **503**, so the ingest consumer retries the message — a running container always boots with clamd ready (the entrypoint fails fast otherwise), so this is exceptional, not a steady state. A persistent fault dead-letters to `magna-carta-production-files-ingest-deadletter`, leaving the file pending (never a usable-but-unscanned object) as a loud ops signal.

**clamd transport.** clamd listens on **loopback TCP `127.0.0.1:3310`** (not a Unix socket — the cross-platform client transport; loopback only, still no egress).

### Acceptance checks (run after activation)

1. **EICAR test (live engine proof).** Send an authenticated `POST /api/v1/scan/diagnose` with an EICAR test-file body against the production app Worker. Expect a `200` response with `verdict: "infected"`. This proves the full path: app Worker → `SCAN_SERVICE` binding → scan worker → container → clamd → result.

2. **2 GiB resident-memory check.** On a scan near the 2 GiB inspectable cap, observe the container's resident memory — expect approximately 2 GiB (the body held in the Rust service plus clamd's own copy atop the ~1–2 GiB resident DB). If resident memory exceeds the `standard-1` (4 GiB) ceiling or scan throughput degrades, raise `instance_type` or lower the inspectable cap.

### Engine acceptance test (pre-merge)

`containers/scan/tests/eicar_e2e.sh` builds the image and asserts EICAR → `infected` end to end (Docker required). This is the engine's proof before merge — run it locally (or as a Workers Builds build step) on any change under `containers/scan/**`; it is independent of the live deployment acceptance checks above. It needs a Docker daemon, so it does not run inside the `vp test` Miniflare pool.

### Cost

~$35–50/mo at MVP scale for one warm `standard-1` instance (the warm-poke keeps it from cold-starting the ~1–2 GiB DB); scales with concurrent scan volume up to `max_instances`. Self-hosted — privileged client bytes never leave our compute.

---

## 12. Cloudflare Workers Builds — CI/CD pipeline + fast-build settings

The build-and-deploy pipeline is **Cloudflare Workers Builds** (the deploy model; ADR-0075 as amended), not GitHub Actions. Seven Workers are connected to the GitHub repository — `magna-carta`, `magna-carta-scan`, `magna-carta-bundle`, `magna-carta-recovery`, `magna-carta-file-repair`, `magna-carta-status`, `magna-carta-edit` — and each builds + deploys on a push to its **production branch**. (`magna-carta-convert` exists but is not connected; it is deployed by hand.) Build-time performance is a standing requirement — see [`build-performance.md`](build-performance.md).

### Branch control — the production branch is `release`, not `main`

**A push to `main` deploys nothing.** The production branch on every connected Worker is **`release`**, and _Builds for non-production branches_ (`previews_enabled`) is **off** on all seven — it always has been, so a feature branch never built. Ordinary pushes and merges to `main` therefore reach GitHub without touching the live environment. Deploying is a separate, deliberate act:

```
git push origin main:release        # fast-forward release to main — this is the deploy
```

That push is the only thing that triggers a build. Watch Paths (below) then decide which of the seven Workers actually rebuild; the rest are untouched. `release` must stay a strict fast-forward of `main` — never commit to it directly, so the deployed tree is always a commit that exists on the trunk.

Consequences to keep in mind:

- **`main` can be ahead of production.** `git log --oneline release..main` is the undeployed queue. What is live is `release`, not the trunk.
- The `pre-push` hook (below) runs on both pushes, so the gate still fires before a deploy.
- The scan Worker's nightly signature-refresh **deploy hook** is unaffected — it triggers a build of the production branch, which is now `release`. That is the intent: a nightly rebuild refreshes signatures without shipping untested trunk code.
- Deploy order still matters on a first deploy of a new Worker: a Worker targeted by a service binding must exist before the app Worker's deploy will succeed (see `magna-carta-recovery` below).

To change it, **per Worker** — dashboard **Settings → Build → Branch control**, or `PATCH /accounts/{account_id}/builds/workers/{script_tag}` with `{"git_repository":{"branch":"release"}}` — set the production branch to `release`. Create `release` at the currently-deployed commit **before** flipping the setting, so the flip itself does not queue a build of unshipped work. `GET` on the same path reads the whole build configuration (branch, commands, caching, watch paths) and is the fastest way to check the live settings against what this file claims.

### Per-Worker build configuration (dashboard: **Workers & Pages → _the Worker_ → Settings → Builds**)

Build and deploy commands are already set (do not change without cause) — recorded here so the pipeline is documented:

- `magna-carta` — build `pnpm install --frozen-lockfile && pnpm exec vp run build-all`; deploy `pnpm --filter @magna-carta/worker exec wrangler deploy`. **The WASM artefacts the build consumes — `@magna-carta/pdf` (imported by the SPA) and `@magna-carta/decryption` (imported by the worker's decryption/recovery routes) — each build inside a pinned Rust Docker image** (`crates/pdf-core/wasm.Dockerfile` and `crates/decryption-core/wasm.Dockerfile`, both run by the `rust-wasm-build` task in `vite.config.ts`), exactly as the `scan`/`bundle`/`convert` container images build their Rust — so the runner needs only Docker (which it provides), never Rust/wasm-pack on the bare machine, and the build command stays the standard one. **Any new crate the app worker or SPA imports as WASM must be added to `rust-wasm-build` and given its own `wasm.Dockerfile`, or the bundle fails with `ENOENT … <crate>_bg.wasm`.** **History:** from the PDF engine merge (2026-06-23) until 2026-06-28 the wasm built with bare `wasm-pack` on the runner, which has no Rust toolchain, so every `magna-carta` build failed with `Failed to find executable wasm-pack` (no deploy succeeded in that window); moving the wasm build into Docker fixed it. The same class recurred 2026-07-04: the decryption merge added a worker import of `@magna-carta/decryption`'s wasm but `rust-wasm-build` still built only pdf-core, so the bundle failed with `ENOENT … decryption_core_bg.wasm` — fixed by adding the decryption-core Docker wasm build alongside pdf-core's. It went undetected until the trunk was pushed because the pre-push gate does not run a worker bundle.
- `magna-carta-scan` — root directory `apps/scan-worker`; build `pnpm run build`; deploy `npx wrangler deploy`. Deploying the scan Worker builds and pushes the `containers/scan` image referenced by its Container binding.
- `magna-carta-bundle` — root directory `apps/bundle-worker`; build `pnpm run build`; deploy `npx wrangler deploy`. Deploying the bundle Worker builds and pushes the `containers/bundle` image referenced by its Container binding. The image is a separate slice's deliverable (`containers/bundle/Dockerfile`); until it exists the bundle Worker cannot deploy, so the `BUNDLE_SERVICE` binding in the app Worker stays unbound and the encrypted/heavy bundle lanes return `503` (the plain ZIP fast lane is unaffected).
- `magna-carta-recovery` — root directory `apps/recovery-worker`; build `pnpm install --frozen-lockfile && pnpm run build`; deploy `npx wrangler deploy`. Deploying builds and pushes the `containers/recovery` image (the pure-Rust password-recovery engine) referenced by its Container binding, and applies its `RecoveryEngineContainer` DO migration. **Its build context is the repo ROOT** — the Dockerfile COPYs both `crates/decryption-core` (a path dependency) and `containers/recovery/...`, so `wrangler.jsonc` sets `image_build_context: "../../"`; the root `.dockerignore` allowlists only `crates` + `containers`. Without the explicit context, wrangler builds against a narrower default and the `COPY containers/recovery/wordlists` step fails on the runner with `"containers/recovery/wordlists": not found` (a local `docker build … .` masks it by using the root). The app Worker's `RECOVERY_SERVICE` binding **requires this Worker to exist first**: wrangler rejects a deploy whose service binding targets a missing Worker (`Service binding … references Worker … which was not found [code: 10143]`), so this Worker must be connected + deployed before the app Worker can deploy — the code's graceful fallback is runtime-only, not a deploy-time exemption. **Build Watch Paths (inclusion):** `apps/recovery-worker/*`, `containers/recovery/*`, `crates/recovery-core/*`, `crates/decryption-core/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. No warm-poke cron, so the `standard-1` container scales to zero at idle.
- `magna-carta-file-repair` — root directory `apps/file-repair-worker`; build `pnpm install --frozen-lockfile && pnpm run build`; deploy `npx wrangler deploy`. Deploying builds and pushes the `containers/file-repair` image (the Rust file-repair/salvage engine) and applies its `FileRepairEngineContainer` DO migration. **Same crates-sharing pattern as `magna-carta-recovery`** — `image_build_context: "../../"` plus the Dockerfile's `COPY crates crates`: the binary compiles `engine-host` + `recovery-core`, which inherit `edition` from the `crates/` workspace root, so the whole workspace must be in the build context (only those two crates actually compile). The app Worker's `FILE_REPAIR_SERVICE` binding requires this Worker to exist (same `code: 10143` rule as recovery above). **Build Watch Paths (inclusion):** `apps/file-repair-worker/*`, `containers/file-repair/*`, `crates/engine-host/*`, `crates/recovery-core/*`, `crates/Cargo.toml`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. No warm-poke cron, so the `standard-1` container scales to zero at idle.

- `magna-carta-status` — root directory `apps/status-worker`; build `pnpm run build`; deploy `npx wrangler deploy`. The public status page Worker. **Build Watch Paths (inclusion):** `apps/status-worker/*`, `packages/status/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- `magna-carta-edit` — root directory `/`; build `pnpm install --frozen-lockfile`; deploy `pnpm --filter @magna-carta/edit-worker run deploy`. The Collabora editing Worker. **Its production branch is still `slice-2-2-editing`, not the trunk** — a leftover from the editing slice's test deploys — and **every build it has attempted since 2026-06-28 has failed** (eight consecutive; last success 2026-06-26, on that branch). Nothing has deployed from it in that window, so the live editing Worker is older than the trunk. Point it at `release` with the others and diagnose the build failure from its logs before relying on an editing deploy. **Build Watch Paths (inclusion):** `apps/magna-carta-edit/*`, `containers/collabora/*`, `pnpm-lock.yaml`.

**Two Watch Path settings drift from what this file used to claim** — read from the live build configuration, 2026-07-09, and both silently suppress rebuilds:

- `magna-carta-file-repair` includes `containers/file-repair-worker/*`, but the container lives at `containers/file-repair/`. **No path matches it**, so a change to the file-repair container image never triggers a rebuild. Correct it to `containers/file-repair/*`.
- `magna-carta-recovery` does **not** include `crates/decryption-core/*`, though its Dockerfile COPYs that crate as a path dependency. A change to `decryption-core` alone never rebuilds the recovery container.

Two settings to **enable/set** (the fast-build levers — see [`build-performance.md`](build-performance.md)):

- **Build Caching — turn ON for every connected Worker.** Caches dependencies and build outputs across builds (a project-wide cache), so a build does not re-download the pnpm store or rebuild unchanged outputs every run. This is the primary fast-build lever and the analog of a CI dependency cache.
- **Build Watch Paths — set per Worker** so an unrelated change does not rebuild every Worker. Patterns are repo-root-relative; a single `*` matches zero or more characters across directories; excludes are filtered first, then a build runs only if a changed path still matches an include. (Workers Builds always builds regardless of paths when a push has 0 changes, 3000+ changes, or 20+ commits.)
  - `magna-carta` (depends on most of the repo — scope by exclusion): **Include** `*` · **Exclude** `docs/*`, `containers/*`, `spikes/*`, `*.md`. So a docs- or scan-only change no longer rebuilds and redeploys the app Worker.
  - `magna-carta-scan` (depends only on its own package + the scan image — scope by inclusion): **Include** `apps/scan-worker/*`, `containers/scan/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` · **Exclude** (none). So a change to `apps/web` or any `packages/*` no longer triggers a scan rebuild — the largest waste today.
  - `magna-carta-bundle` (depends only on its own package + the bundle image — scope by inclusion): **Include** `apps/bundle-worker/*`, `containers/bundle/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` · **Exclude** (none).

### Quality gates (no separate CI runner) — the `pre-push` hook

With GitHub Actions retired, Workers Builds builds and deploys but runs no checks. The gates live in the tracked **`pre-push` git hook** (`tooling/git-hooks/pre-push`): it runs `pnpm audit`, `pnpm check`, the governance lints, `vp test`, the OpenAPI contract drift/Spectral gates, and — when `containers/scan/**` changed and Docker is available — the scan EICAR acceptance test (§11), blocking the push on any failure. It runs on every push, so it gates both the ordinary push to `main` (which deploys nothing) and the `main:release` fast-forward that does. Activate it once per clone with **`vp run setup-hooks`** (the same step that installs the post-merge auto-clean hook; `core.hooksPath` → `tooling/git-hooks`). `SKIP_PREPUSH=1 git push` bypasses it in a genuine emergency — fix forward. `oasdiff` (breaking-change vs. the base) and the Prism mock smoke are not in the hook (they are review-time / base-branch checks); run them in review if needed.

### Container image cache — which images comply

Every Rust Container image is required to build with BuildKit cache mounts on the Cargo registry, the git cache, and the crate `target/`, so an unchanged dependency graph is not recompiled ([`build-performance.md`](build-performance.md)). Mounts are build-local; if cold Rust dependency compiles in the Workers Build become the bottleneck, a cache-mount export is the documented upgrade path.

- `containers/scan/Dockerfile` and `containers/recovery/Dockerfile` — compliant. Both mount the caches and `cp` the built binary to `/artifacts/` inside the same `RUN`, because a cache mount is not part of an image layer and a later `COPY --from=build …/target/release/…` would find nothing.
- `containers/file-repair/Dockerfile` — **not compliant.** It runs a bare `cargo build --release`, so every rebuild re-downloads the crates.io index and recompiles the whole `engine-host` + `recovery-core` closure (about 55 s of Rust in the 2026-07-04 build). Fixing it means adding the three mounts _and_ switching the runtime stage to copy from a non-mounted `/artifacts/` path, exactly as recovery does. Owed by the `file-repair-salvage` stream, which owns `containers/file-repair/**`.

Verify a container's build cost from its build log rather than assuming: a warm build shows `CACHED` on the `cargo build` step; a cold one shows `Updating crates.io index` followed by `Compiling …`.

### Testing a container on Cloudflare (post-deploy self-test)

A container is a Docker image that cannot run under the local Miniflare test pool, and Workers Builds builds the image **remotely** — so the most faithful test is to deploy and exercise the live container, which also covers what no local stub can: the real outbound-Workers `env.R2` mediation, the Container Durable Object lifecycle (cold start, `sleepAfter`, the warm cron), the real instance sizing, and the service-binding wiring. The bundle worker ships a **guarded self-test endpoint** for exactly this; it is the template other container subsystems should copy.

`POST /self-test` on `magna-carta-bundle` runs the deployed container through `/ready`, a buffered ZIP build (R2 + inline entries, verified back in R2 — complete-ZIP + the seeded bytes actually present + reported size matches), the streaming encrypted lane (archive returned, must **not** contain the plaintext — proving encryption — and nothing persisted), and a 7z multi-volume split (volumes read back from R2 and reassembled into a real 7z) — then deletes every object it wrote and returns a JSON report (`{ ok, runId, checks[], elapsedMs }`, HTTP 200 when all checks pass, 500 otherwise). It is **disabled by default**: the route 404s unless `BUNDLE_SELF_TEST_KEY` is set on the worker **and** the request presents it as the `x-self-test-key` header (SHA-256 constant-time compare), so it is safe to ship on every environment including production.

It runs against a **dedicated container instance** (`getContainer(..., "selftest")`), isolated from the `"bundle"` instance that serves live firm builds, so a self-test never contends with customer work (it cold-starts a separate instance, which counts against `max_instances`). All objects it writes live under a per-run `selftest/<uuid>/` prefix in the files bucket; if the caller disconnects mid-run before cleanup, those few small objects can be left behind (harmless; sweep `selftest/` if desired) — a cleanup leak or failed run is also logged (redacted: runId + count) in Workers Logs.

To run it:

1. **Set the secret** (only while testing; remove it after if you prefer the route fully dark):
   `wrangler secret put BUNDLE_SELF_TEST_KEY` (or Dashboard → the Worker → Settings → Variables and Secrets). Generate a high-entropy value (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
2. **Reach the worker.** `magna-carta-bundle` is internal (`workers_dev: false`, no public routes), so pick one:
   - **Through the app worker (preferred once `BUNDLE_SERVICE` is bound):** the app worker can relay a service-binding call to `http://bundle/self-test` with the header — no public exposure of the bundle worker.
   - **Isolated (before the app worker is wired):** deploy a throwaway staging instance with `workers_dev: true` and the secret set, then `curl -X POST https://<worker>.<account>.workers.dev/self-test -H "x-self-test-key: <value>"`. Tear it down after. Keep the committed `wrangler.jsonc` at `workers_dev: false` — do not expose the production bundle worker publicly.
3. **Read the report.** A 200 with every `checks[].ok === true` means the deployed image, both build lanes, the R2 mediation, and split all work end to end. A 500 lists the failing check and its detail.

This makes the local Docker acceptance gate (`containers/bundle/tests/acceptance.sh`) optional — a fast pre-push smoke when Docker is present — rather than the only proof. The same pattern (a secret-gated `/self-test` that round-trips the container and cleans up) is the recommended post-deploy check for any future container subsystem.

---

## 13. Control-plane database migrations

Control-plane D1 migrations apply **automatically** — no manual deploy step is required. The scheduled (Cron) handler (`apps/worker/src/scheduled.ts`) runs `runPendingMigrations` against `env.DB_CONTROL` as its **first action** on every cron tick, before the existing control-plane outbox sweep, so the schema is current before any other control-plane work in the same tick.

**Why the cron is the sole runtime applier — single-flight by construction.** The migration runner is not safe to run concurrently against the same database for the same pending migration. Each migration applies as one atomic `batch()` call (see `packages/database/src/d1-migration-target.ts`), and the runner fails loud on the first error with no internal retry (`packages/database/src/migration-runner.ts`). The `_migrations` table uses `tag TEXT PRIMARY KEY`, so if N worker isolates raced the same pending migration, exactly one batch would commit and every other isolate's batch would fail with a `UNIQUE constraint failed: _migrations.tag` error — a burst of N−1 thrown errors per migration-bearing deploy. The cron fires as a single invocation per tick, so making it the sole applier eliminates that concurrency in the common case; a rare overlapping fire is made safe by the error isolation around the step (the loser throws and is caught, the next tick is a no-op at head).

**Additive migrations + fail-safe reads — tolerating the deploy window.** Between a deploy and the cron tick that applies a new migration (at most one `*/5` cycle, typically under five minutes), request code may read a control-plane column that does not yet exist. The discipline that makes this safe:

- Control-plane migrations are **additive only** (expand-contract; no destructive DDL while data exists).
- Request code that reads a new additive column must **default safely** on absence rather than propagating an error. Example: `/me` reads `firm.release_channel` on every session bootstrap; if the column is briefly absent right after a deploy (or any transient read error), the handler yields `channel: "stable"` and the default flag set and returns a successful response — the bootstrap never fails fleet-wide while the schema window is open. The same pattern applies to any other endpoint that reads a new control-plane column. (Write endpoints that need the column cannot fail-safe this way; they return an error during the window and recover once the migration lands — see `docs/active-work/release-channels.md`.)

**Deploy-time application — the future zero-window hardening.** Running `runPendingMigrations` in the Workers Builds command (before `wrangler deploy`) would be single-flight by construction: the build runs once, applies the migration, then the deploy follows. That approach eliminates the window entirely (true migrate-before-serve, mirroring how per-firm migrations apply at provision time). It requires a D1-over-HTTP `MigrationTarget` adapter and an API token as a build secret. Adopt this when production firms make a zero-width schema window matter — for now the cron + fail-safe discipline covers the gap.

## 14. Placeholder service workers — REPLACE before activating slices 2·1 / 2·4

The `magna-carta` app worker declares three sibling service bindings (`SCAN_SERVICE`, `BUNDLE_SERVICE`, `CONVERT`). Cloudflare rejects a deploy whose service binding points at a worker that does not exist, so to deploy the editing slice (2·2) without first standing up the bulk-download and conversion subsystems, two of those targets are currently **503 placeholder workers**, deployed 2026-06-27:

- **`magna-carta-bundle`** — placeholder. The real worker (`apps/bundle-worker`, with its `BundleContainer` Rust archive builder) belongs to **slice 2·1 (async bulk-download)**. Until it deploys, the app worker's bundle download lanes return 503 (the code's graceful fallback).
- **`magna-carta-convert`** — placeholder. The real worker (`apps/convert-worker`, with its `RasterEngineContainer`) belongs to **slice 2·4 (in-app conversion)**. Until it deploys, `resolveEnginePort` falls back to the deferred port.

**To replace each placeholder with the real worker:** connect a Workers Build project for it (dashboard, exactly as §12 / the `magna-carta-edit` setup), since each carries a container image that must build on Cloudflare's runners. Deploying the real worker overwrites the placeholder and adds its container DO migration cleanly (the placeholder has no DO classes). No app-worker config change is needed — the bindings already point at the right names.

**Also pending — the `magna-carta-edit` Workers Build project branch.** Its build project was pointed at the now-deleted `slice-2-2-editing` branch; repoint it to `main` (dashboard → the Worker → Settings → Builds) so future editor-worker changes redeploy on push. The currently deployed editor worker is unaffected.

## 15. R2 bucket CORS — browser direct-to-R2 upload (account configuration, not code)

The File Manager upload is a direct-to-R2 ceremony: the browser `PUT`s bytes straight to a presigned R2 S3 URL (`<account>.r2.cloudflarestorage.com`), never through the Worker. That is a **cross-origin** request from the app origin to the R2 endpoint, so the bucket must carry a **CORS configuration** or the browser's preflight fails and no bytes land. Multipart additionally needs the `ETag` **response** header exposed — the client reads each part's `ETag` to build the completion manifest, and a browser cannot read a response header CORS does not expose. This is bucket configuration, not committed code (like the `bundles/` lifecycle rule in §10); it is applied **out-of-band against the bucket by the owner, not by CI**, and no committed code can substitute for it.

The development R2 upload route (`apps/worker/src/routes/dev-r2-upload.ts`) is **same-origin** and therefore exercises no CORS — a green local suite proves nothing about this step. **The acceptance gate is one real upload against a real bucket in a preview environment, including a file large enough to take the multipart path** (exercising `uploads.signPart` and the `ETag` read). Until that passes, CORS is unverified no matter how green the local run is.

**The configuration** is the checked-in artifact [`apps/worker/r2-cors.json`](../../apps/worker/r2-cors.json) (the first R2 CORS configuration in the repo — none existed before):

- **`AllowedOrigins`** — every origin a browser uploads from. The artifact lists the intended custom-domain origins (`https://magnacarta.esq`, `https://app.magnacarta.esq`); **add the current `workers.dev` serving origin** while the app still serves there (wrangler `workers_dev: true`, until `magnacarta.esq` attaches), and **add each preview-environment origin** used for the acceptance gate. A wildcard is not used — the presigned URL already scopes the credential; the origin allow-list is a second wall.
- **`AllowedMethods`** — `GET` (presigned download/preview fetches) and `PUT` (single-shot and multipart part uploads). The multipart create/complete/abort calls are server-to-server from the Worker (Authorization-header signed), never browser-issued, so they need no CORS entry.
- **`AllowedHeaders`** — `content-type` (the presigned PUT binds Content-Type into the signature, so the browser sends it).
- **`ExposeHeaders`** — **`ETag`** (required: multipart cannot complete without the client reading each part's `ETag`).
- **`MaxAgeSeconds`** — preflight cache lifetime (`3600`).

**To apply:** paste the artifact JSON under **R2 → the production files bucket → Settings → CORS policy → Add CORS policy** — the artifact is in R2's dashboard format (the bare rule array). The same rules can instead be `PUT` via the S3 API with the Object Read & Write token from §3 (`aws s3api put-bucket-cors --endpoint-url https://<account>.r2.cloudflarestorage.com --bucket <bucket> --cors-configuration '{"CORSRules": <the array from r2-cors.json>}'` — the S3 API wraps the array under a `CORSRules` key). Re-apply whenever the app gains a new serving origin (custom-domain cutover, a new preview environment). The configuration is idempotent — re-applying replaces the whole rule set.
