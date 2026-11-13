# Operations runbook

The single home for **deploy-time, non-code platform configuration** — the steps an operator performs in the Cloudflare dashboard, DNS, or `wrangler` that are not expressed in committed code. Code seams reference this file; the steps live here (one home per fact).

Each section is a numbered runbook. Where a step _activates_ committed code (a binding the code already declares, a `var` the code reads), that coupling is called out so an operator knows what flips on.

White-paper areas: _Observability and diagnostics_ · _Communications layer_ (email transport) · _Delivery model_. Decisions: ADR-0074 (telemetry baseline, email provider) · ADR-0073 (firm provisioning) · ADR-0056 (telemetry analytics tier) · ADR-0075 (deploy model).

## How this file treats live Cloudflare state — read the API, never this page

**This file records no current value of anything Cloudflare owns.** Not which Workers are connected,
not any Worker's production branch, root directory, build command, Build Watch Paths or build-caching
setting, not which hostnames or routes a Worker answers on, not when anything last deployed or whether
a build passed. Every one of those has a canonical home in the Cloudflare account, is one API call
away, and **changes without touching this repository** — an owner clicking through the dashboard leaves
no commit behind.

The reason is evidence, not taste. This file wrote those values down and **disagreed with the live
configuration four separate times** (the connected-Worker count and roster; the edit Worker's root
directory, deploy command and branch; two Build Watch Paths that matched nothing). Each disagreement
was corrected, and each correction decayed the moment the dashboard moved again. A written-down value
is not a fact here — it is a snapshot with no expiry date printed on it, and it reads exactly as
confidently when stale as when fresh.

So the rule, and it is a hard one: **if the Cloudflare API can answer a question, this file gives you
the call, not the answer.** What stays is what no API returns — the decisions and why they were made,
the procedures an operator follows, the failure modes that have cost real deploys, and the invariants
you must not violate.

**If you are about to paste current values back in because it would be convenient: that is the
mistake this section exists to stop.** Put them in the terminal instead.

Every command below assumes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are exported, and is
runnable as written. A Worker's `script_tag` (which the Builds endpoints key on, and which is **not**
the Worker's name) comes from the scripts listing:

```bash
# Every Worker on the account, with the script_tag each Builds call needs
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts?per_page=100" \
  | jq -r '.result[] | "\(.id)\t\(.tag)"'
```

Some reads need token scopes beyond Workers — zone-level `GET /zones/{zone_id}/workers/routes` and
`GET /zones/{zone_id}/dns_records` return **403 `Authentication error`** on a Workers-only token. A 403
there means _your token cannot see it_, never _there is none_; account-level
`GET /accounts/{account_id}/workers/domains/records` answers the custom-domain question without zone
scope, and is the read to reach for first.

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

The Worker declares the `send_email` binding (`SEND_EMAIL`) and the code selects the Cloudflare Email Service adapter **only when the `EMAIL_FROM` var is also set** (`apps/api-worker/src/http/app.ts` `emailAdapterForEnv`). Until then the logging adapter runs, so no send fails against an un-onboarded domain. This runbook is what makes real email work:

1. **Onboard the domain.** Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**; choose `magnacarta.esq`. The domain must use Cloudflare DNS.
2. **Accept the DNS records** Cloudflare adds on the `cf-bounce` subdomain: MX (bounce routing), TXT SPF (authorize sending), TXT DKIM (signing), TXT DMARC on `_dmarc.magnacarta.esq`. Propagation is usually 5–15 minutes. Correct DKIM/SPF is the actual deliverability lever at these volumes.
3. **Verify the destination address (beta constraint).** During the public beta, sending to a destination requires it to be a verified address in the account (the free-on-all-plans path). Verify the addresses transactional mail goes to, or complete domain verification for open sending as the beta allows.
4. **Activate the adapter.** Set the `EMAIL_FROM` var (e.g. `no-reply@magnacarta.esq`) — as a `wrangler.jsonc` `vars` entry (committed) or `wrangler secret`-adjacent var. The next deploy selects `createCloudflareEmailAdapter`; auth's reset/verification mail then flows over the binding, each send logging `email.sent` (class + outcome, never body).
5. **If deliverability disappoints**, the port seam means swapping to Resend/SES is one adapter (ADR-0074); re-verify the beta's current limits at that point.

> Do **not** set `EMAIL_FROM` before steps 1–3 are done — it would activate the adapter against an un-onboarded domain and every send would fail. The binding being present is harmless; `EMAIL_FROM` is the switch.

## 2a. Inbound email capture on `in.magnacarta.esq` (the forward/CC entrance)

The forward/CC capture path terminates on the `apps/email-worker` Cloudflare Email Worker (deploy name `magna-carta-email`), which stages the raw MIME to R2 and enqueues the `…-emails-capture` job the main worker's consumer runs. Capture addresses all live on a single zone-level catch-all: `<token>@in.magnacarta.esq`, where the whole local part is an opaque, server-minted token. The worker resolves the token to a firm against the control-plane `email_capture_route` index (it holds no per-firm handle), then hands the token to the capture consumer, which resolves it to a candidate matter against that firm's own `email_capture_address` store — a per-matter token proposes its matter; a firm catch-all token lands with no matter (staff route it); an unminted or revoked token does not route (the sender is bounced). The firm lives in a control-plane token index, **not** in the subdomain, because Cloudflare Email Routing supports exactly one zone-level catch-all — not per-subdomain wildcards. None of this is code beyond the worker; the zone setup is here.

1. **Deploy the email worker.** `wrangler deploy` from `apps/email-worker`. It binds `DB_CONTROL` (the control-plane D1), `R2` (the platform files bucket), and `EMAILS_CAPTURE` (producer). The consumer lives in the main worker, so the `…-emails-capture` queue **and** its `…-emails-capture-deadletter` must exist first (`wrangler queues create` — see §3's queue note).
2. **Route the capture zone to the worker.** Dashboard → **Email → Email Routing** on the `magnacarta.esq` zone. Add the MX + TXT records Cloudflare provides for inbound routing, then a single **catch-all rule on `in.magnacarta.esq`** that sends to a Worker → `magna-carta-email`. Cloudflare Email Routing supports one zone-level catch-all, **not** per-subdomain wildcards, so every firm's addresses share this one rule and the local-part token — resolved against the control-plane `email_capture_route` index — carries the firm. The `in.magnacarta.esq` capture subdomain **co-tenants the one `magnacarta.esq` zone** with product-send (§2) and the company Workspace (§ Company email) — it adds no new zone and no new recurring cost.
3. **Keep one DMARC for the zone.** The apex `_dmarc` record already coordinates the product sender and the company Workspace (§ Company email); inbound capture is a **receiving** path and needs no new alignment, but any change to the zone's SPF/DKIM/DMARC must stay compatible with all three senders — do not tighten alignment for capture.
4. **Mint capture addresses.** The `emails:manageCaptureAddresses` routes write the token into both stores: `POST /api/v1/matters/{matterId}/capture-addresses` (and `/rotate`, `DELETE`) for a per-matter address, `POST|DELETE /api/v1/firm/capture-address` for the firm catch-all. A mint commits the per-firm row plus an outbox row atomically and the **per-firm outbox relay** registers the control-plane route, so a fresh address becomes routable on the next `*/5` sweep, not instantly (the mint response reports `routable: false`; mail sent before then is bounced, never lost). **This is why the `…-platform-jobs` queue must be a working consumer** — see §3's queue note. Revoking and rotating write the control plane first, so an address stops receiving mail the moment the request returns. The token value is shown only in the mint/rotate response; a lost token is replaced by rotating, not recovered.
5. **Set `CAPTURE_ROOT_DOMAIN` if the capture zone is not `in.magnacarta.esq`.** It is a `vars` entry on **both** the main worker and `magna-carta-email`; both default to `in.magnacarta.esq`, so a deployment on the production zone sets neither, and a deployment on another zone must set both together or minted addresses will name a zone that does not route.

> The email worker has **no public HTTP surface** (`workers_dev: false`, `preview_urls: false`); it is reached only by Email Routing. A capture message over the ~25–40 MiB Email Routing ceiling is **bounced to the sender**, never silently dropped — large messages file through the add-in (fast-follow) or the upload path.

## 3. Deploy secrets (the `secrets.required` gate)

Any secret below may instead live in the account's Secrets Store and be bound into the Worker; §23 says how one moves and in what order.

`wrangler.jsonc` lists `secrets.required` (currently seven names), so a deploy **fails loudly** with a missing-secret list rather than letting routes 500 at runtime — or, worse, run the development adapters against real firms. Set each once per environment — Dashboard → the Worker → **Settings → Variables and Secrets**, or `wrangler secret put <NAME>` (paste the value at the prompt; keep it out of shell history and chat transcripts). `wrangler secret list` confirms the registered names.

| Secret                                                            | What it is                                                                                                                                                                                                                                                                                                          | How to produce it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rotatable?                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`                                                     | Better Auth signing key — signs sessions and the cookieless preview-delivery tokens                                                                                                                                                                                                                                 | `openssl rand -base64 32` (Windows, no openssl: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)                                                                                                                                                                                                                                                                                                                                                                                                | Yes, but rotating logs out all sessions and invalidates in-flight preview tokens (harmless pre-launch) |
| `PLATFORM_ADMIN_KEY`                                              | Bearer key guarding the platform-admin routes                                                                                                                                                                                                                                                                       | any high-entropy random string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Freely — rotate and update callers                                                                     |
| `R2_S3_ACCESS_KEY_ID` + `R2_S3_SECRET_ACCESS_KEY`                 | The R2 S3-API token the File Manager uses to presign upload/download URLs, AND the parent of every per-firm credential the object plane mints                                                                                                                                                                       | Dashboard → **R2 → Manage R2 API Tokens → Create**, an _Object Read & Write_ token with **"Apply to all buckets in this account"** — NOT scoped to one bucket. Every firm has its own bucket, created at provisioning after this token exists, so a token scoped to the platform bucket cannot sign a single per-firm upload: the presigned PUT is refused with 403, the reserve succeeds, and the file manager reports the storage refusing the write. Copy the Access Key ID + Secret Access Key (the secret is shown once) | Freely — delete + re-mint the token; only breaks in-flight (~5 min) presigned URLs                     |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` | The account the firm buckets live in, and the API token the provisioner creates each firm's bucket with and applies its notification, expiry and CORS settings through; also the parent the object plane derives each bucket-scoped credential from, and the token the upload readiness check asks the account with | Account id: Dashboard → **R2 → Overview** (right-hand column). Token: **My Profile → API Tokens → Create Token**, custom, with **Account · Workers R2 Storage · Edit** on this account. Without both, the development provisioning adapter runs, which creates no bucket — the gate refuses the deploy                                                                                                                                                                                                                        | Freely — re-mint and `wrangler secret put`; nothing in flight depends on the old token                 |
| `ROOT_KEK`                                                        | The **root key-encryption-key**: AES-KW-wraps each firm's data key (envelope encryption — see [`security.md`](security.md))                                                                                                                                                                                         | `openssl rand -base64 32` — base64 of 32 random bytes = a 256-bit key (the code `atob`-decodes it; standard base64, not base64url)                                                                                                                                                                                                                                                                                                                                                                                            | **No — generate once and back up.** See the warning                                                    |

> **`ROOT_KEK` is not freely rotatable.** It wraps every per-firm key; replacing it without a re-wrap migration makes all `protected()` data permanently unrecoverable. Generate it **once**, set it, and **back it up in ≥2 secure places** (a secrets manager + a sealed offline copy) before any firm stores protected data. Rotation machinery is not built — the ciphertext frame reserves `algo_version | key_version` as the seam, and the re-wrap sweep is a scheduled hardening build (see [`../../ROADMAP.md`](../../ROADMAP.md) → _Hardening_), gated to before the first real client or a compromise event.

`CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` / `CLOUDFLARE_ACCOUNT_ID` were optional until 2026-09-10; they are **required** now. Absent them the development adapters run — which record a bucket name for every new firm and create no bucket, and route uploads through the Worker — and a production deployment ran that way for a period with nothing reporting it: every firm it provisioned could not upload, and the fault was diagnosed from the browser three times. The gate now stops such a deploy before it serves. Locally both stay out of `.dev.vars` on purpose (their presence would select the real adapters); wrangler warns about the two missing names on a local run, and that warning is expected. Secrets posture detail lives in [`security.md`](security.md).

> The gate covers **secrets** only. The Worker's declared **Queues** must also already exist in the target account — `wrangler deploy` aborts on the first missing one. The declared queues live in `apps/api-worker/wrangler.jsonc` (`…-platform-jobs` + `…-platform-jobs-deadletter`, `…-files-ingest` + `…-files-ingest-deadletter`, `…-inference` + `…-inference-deadletter`, `…-emails-capture` + `…-emails-capture-deadletter`); create any that are absent with `wrangler queues create <name>` (or the dashboard) before deploying. The `…-emails-capture` queue has a **cross-worker** producer: the `magna-carta-email` worker enqueues onto it and the main worker consumes it, so it must exist before either deploys.
>
> `…-search-compaction` + `…-search-compaction-deadletter` carry the **split-compaction** pass, which is
> what keeps a matter's search cost tracking a threshold rather than the number of documents ever indexed
> into it. Its consumer runs at concurrency 1 on purpose: a merge reads and rewrites every byte of its
> source splits, so several at once would multiply the background R2 traffic against the query traffic
> compaction exists to reduce. A parked message here is deferred housekeeping, never a lost document —
> the corpus stays queryable, just over more splits than it should be, and the daily cron re-enqueues it.
> The pass supersedes split objects but never deletes one; the daily sweep collects them after a grace
> period, so a firm's bucket briefly holds both the merged split and the sources it replaced.
>
> `…-platform-jobs` is the **shared per-firm job queue**: every per-firm outbox row the relay sweeps crosses it, firmId-tagged, and the dispatch table in `apps/api-worker/src/background/costs/recoverable-charge-consumer.ts` routes each message to the handler owning its topic (unowned topics are acked and ignored). It was a declared **producer only** until email capture-address minting needed it, so per-firm outbox effects were published and never applied; it is now a declared consumer, and its dead-letter queue must exist before the next deploy. A parked message here means a per-firm effect has not been applied — for a capture address, that the address exists but will never receive mail until the row is revived (the operator seam in [`security.md`](security.md)).

## 4. Adding a per-firm D1 binding (beyond the starter pool)

Per ADR-0073, a firm provisioned beyond the pre-declared `DB_FIRM_POOL_*` pool needs its per-firm D1 bound into the Worker — Miniflare/Wrangler bind D1 at config time, not runtime:

1. The REST `FirmResourceProvider` creates the per-firm D1 (needs the optional credentials above).
2. Add a `d1_databases` entry to `wrangler.jsonc` (binding name = the firm's `database_identifier`, resolved by `firm-binding-resolver.ts`).
3. Commit and deploy. Until this lands, the firm's database is **absent** to the deployment (ADR-0052 — a 404, never an oracle), and the next provisioning resume picks it up.

## 5. Dependency audit allowlist (accepted advisories)

The gate's `audit` dimension (`pnpm gate`, [`tooling/gate/audit.mjs`](../../tooling/gate/audit.mjs)) runs **osv-scanner** over both supply chains — the pnpm lockfile and every first-party `Cargo.lock`, derived from disk — and fails on any remaining **HIGH or CRITICAL** finding (CVSS >= 7.0). It replaced the npm-only `pnpm audit`, and the `package.json` → `pnpm.auditConfig.ignoreGhsas` list it used to read is gone. The scanner is pinned by version and per-platform SHA256 and fetched into `node_modules/.cache` when it is not on PATH; a machine that cannot fetch it reports the dimension `NOT RUN`, which is not a pass.

**The accepted-advisory list has exactly one home: [`osv-scanner.toml`](../../osv-scanner.toml) at the repository root.** Do not restate entries here — each one carries its own cause, and the time-boxed ones carry the reachability analysis and the re-check plan alongside the `ignoreUntil` date. `pnpm gate --only audit` reproduces the gate's answer on its own.

Working rules for that file:

- Adding an entry is an explicit security decision — never a quick unblock. Every entry records _why_ the advisory is accepted, not just that it is.
- An `ignoreUntil` date is a forcing function, not a snooze button. When one approaches, re-check whether a fix has become reachable; if it has not, the extension must land with a written justification (what was checked, why no upgrade reaches it, what mitigations bound the exposure, what to re-check next time).
- An entry **leaves** the file the moment it is genuinely remediated — a carrier upgrade, a `pnpm-workspace.yaml` override, an upstream withdrawal, or **removing the carrier**: when no release of the dependency that pulls a vulnerable crate in ever resolves the fix, replacing that dependency is the only remediation there is, and it is a real one. osv-scanner reports unused ignores, so a stale entry is detectable: run the scan and prune what it names.

## 6. Dashboard one-time toggles (slice 0·6)

- **Renovate GitHub App** — enable on the repository (propose-only; `renovate.json` configures pin/weekly/drizzle-pin). Review the onboarding PR like any other.
- **GitHub secret scanning** — enable in the repository's **Settings → Code security**.

## 7. Company email & account-of-record (Google Workspace)

The firm's _operational_ mailboxes and the email identity that **owns** third-party accounts (Cloudflare, GitHub, EasyPost, Google Cloud, the domain registrar). This is distinct from §2, which is the _product's_ transactional sending (`no-reply@`, Cloudflare Email Sending) — the two co-tenant the one `magnacarta.esq` DNS zone and must be coordinated (step 5). Decision and rationale: ADR-0100. Recurring cost is tracked in the [operating-cost register](../operating-costs.md).

**As built (2026-06-18):** stood up on `magnacarta.esq`. One paid seat (the owner's mailbox); `ops@`/`billing@`/`support@`/`legal@`/`privacy@`/`security@` exist as free user-aliases forwarding into it (send-as identities auto-populate within ~24h of creation). `postmaster@`/`abuse@` are Google-reserved system addresses (auto-routed, cannot be created). DKIM is auto-enabled by Google. Super-admin 2-Step Verification is hardened (security key). New vendor logins go on `ops@` from here.

**Email authentication — as built & verified (2026-06-18).** The zone (`magnacarta.esq`, Cloudflare DNS) authenticates two independent senders and is aligned for both:

- **Apex MX** → `smtp.google.com` (Google receiving). **`cf-bounce` MX** → `route{1,2,3}.mx.cloudflare.net` (Cloudflare bounce handling). No collision.
- **SPF** — apex `v=spf1 include:_spf.google.com ~all` (Google; added by operator — Cloudflare won't add it). Cloudflare's `v=spf1 include:_spf.mx.cloudflare.net ~all` lives on `cf-bounce`. Keep `~all` (Google-recommended) while senders are still being enumerated; tightening the apex to `-all` is an optional later hardening once DMARC reports confirm every legitimate sender — **not** required for BIMI.
- **DKIM** — Google `google._domainkey` + Cloudflare `cf-bounce._domainkey`; distinct selectors, both present.
- **DMARC** — one apex `_dmarc` record, currently **`p=quarantine`**, with **Cloudflare DMARC Management** enabled (free; appends its `rua` ingestion address without overwriting, parses aggregate reports in-dashboard). Verified: a test send from the paid seat passes SPF + DKIM + DMARC. **Do not add `adkim=s`/`aspf=s`** — strict SPF alignment breaks the Cloudflare product sender (apex From, `cf-bounce` envelope), which relies on relaxed alignment.
- **DNSSEC** — enabled on the zone (2026-06-18); Cloudflare auto-publishes the DS to the `.esq` registry via CDS/CDNSKEY (no manual registrar step). **Multi-signer DNSSEC** and **multi-provider DNS** stay **off** — single-provider zone (Cloudflare only); enabling them would risk the DNSSEC chain for no benefit.

**Ramp plan:** monitor DMARC reports ~1–2 weeks → verify the product `no-reply@` sender aligns once `EMAIL_FROM` activates it (§2) → ramp `quarantine` → `reject`. **BIMI (future, gated on trademark):** needs enforced DMARC (`quarantine pct=100` or `reject`) + an SVG Tiny PS logo + a **VMC** (requires a registered logo trademark, ~$1–1.5k/yr) + a `default._bimi` record — ties to the `magnacarta.esq` trademark work (ADR-0090).

**Deferred task — move the existing Cloudflare account off a personal mailbox.** The Cloudflare account (the only pre-existing vendor login) is still on the founder's personal mailbox. Move its identity to `ops@magnacarta.esq` by **changing the account email / adding `ops@` as a Super Administrator on the _same_ account** — keeping that personal mailbox as the off-domain break-glass recovery (rule 1; `ops@` is a secondary contact, never sole recovery). Do **not** create a new Cloudflare account and migrate resources across: Cloudflare has no clean cross-account move for D1/R2/Workers, whereas an in-place identity change carries over every binding, database, bucket, and zone with zero migration. The `.esq` registrar identity moves the same way, separately. Deferred (no deadline).

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
- **Turnstile** — **no longer a checkbox here.** Server-side verification is built and shipped
  dormant (`apps/api-worker/src/http/human-verification/`), gating `POST /api/v1/registrations` and `POST
  /api/v1/invitations/redemptions`; with no secret provisioned it serves those endpoints unprotected
  and counts every unprotected pass as `human_verification.decided` / `unenforced`. Switching it on
  is an ordered activation with a UI prerequisite, not a dashboard toggle — the steps are in the
  [deploy queue](../deploy-queue.md). Free, and complements Super Bot Fight Mode (§8.2).

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

The scan engine lives in its own Worker (`apps/scan-worker`, service `magna-carta-scan`). It owns the `ScanContainer` — a `linux/amd64` Container (`containers/scan/`): a long-lived clamd daemon plus a Rust HTTP service that fans each file to clamd (signatures), yara-x (heuristic rules), and structural heuristics (PDF/Office/archive). The app Worker (`apps/api-worker`) reaches it exclusively over a `SCAN_SERVICE` service binding; `resolveScanPort` selects the remote engine when that binding is present, otherwise the engine-less `unscanned` adapter (an honest `unscanned`/no-engine verdict, never a false `clean`). The app Worker carries **no** container config of its own. The rule that put the engine in its own Worker — the five-property extraction rubric and the compute-vs-coordination seam — is §18; this section is the deploy runbook for the first subsystem that cleared it.

The scan worker was the first subsystem to be built, connected to Workers Builds and deployed (2026-06-28). Whether its `SCAN_SERVICE` binding is wired on the deployed app Worker today is live state — read the app Worker's bindings (see §14) rather than this paragraph. When it is present production runs the real engine; local/test envs use the engine-less adapter regardless (no container pool). The first-activation steps below are retained as the record of what activation entailed; the **acceptance checks** are **deferred** until a prod firm/member is provisioned (none yet — the auth UI is slice 0·7b), since they need an authenticated principal to call `POST /api/v1/scan/diagnose`. The container required a `bookworm`→`trixie` base for onnxruntime's glibc-2.38 symbols (Magika `/identify`).

### First-activation steps

1. **Connect `apps/scan-worker` to Workers Builds.** In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** (or **Connect to Git** on the existing `magna-carta-scan` Worker if already created). Select the repository and configure `apps/scan-worker` as the build root. Workers Builds is Cloudflare-side CI — there is **no `CLOUDFLARE_API_TOKEN` in GitHub**; the connection is managed entirely from the dashboard. Every push to the production branch triggers a build: `freshclam` bakes the current signature DB and `build-yara-rules` fetches + compiles the latest YARA Forge rule package, both baked into the image at build time, and the new image is deployed.

2. **Set the Deploy Hook secret on the scan worker.**

   ```sh
   wrangler secret put SCAN_BUILD_DEPLOY_HOOK_URL --name magna-carta-scan
   ```

   Paste the **Workers Builds Deploy Hook URL** for `magna-carta-scan` at the prompt (generated in the dashboard under the Worker's **Settings → Builds → Deploy Hooks → Create**). This URL is what the scan worker's daily `0 7 * * *` cron POSTs to trigger a nightly image rebuild and signature refresh. Keep the URL out of shell history and chat transcripts — treat it like a secret (it triggers a deploy).

3. **Push to the scan project's own production branch** to trigger the first Workers Builds build (§12 — the app Worker and the SPA build from `main`; this project's branch is read from its build configuration, not assumed). The build runs `freshclam` (baking the current signature DB) and `build-yara-rules` (fetching + compiling the latest YARA Forge package), then deploys `magna-carta-scan`. The `*/20` warm-poke cron then keeps one instance — and clamd's resident DB — alive.

4. **Deploy the app Worker** (`apps/api-worker`) so the `SCAN_SERVICE` binding resolves to the now-live scan service. `resolveScanPort` then selects the remote engine path on the next ingest.

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

The build-and-deploy pipeline is **Cloudflare Workers Builds** (the deploy model; ADR-0075 as amended), not GitHub Actions. Each connected Worker builds and deploys on a push to its **production branch**. Build-time performance is a standing requirement — see [`build-performance.md`](build-performance.md).

**How many Workers are connected, and which ones, is live account state — read it, do not trust a roster.** This file used to carry the count and the names, and was wrong about both (it claimed seven, and claimed `magna-carta-convert` was deployed by hand). To list the connected projects, walk the scripts listing from _How this file treats live Cloudflare state_ above and ask the Builds endpoint about each `script_tag`; a Worker that is **not** connected returns `404` there, which is how you tell "deployed by hand" from "built by Workers Builds":

```bash
# Connected? production branch? root directory? build + deploy command? watch paths? caching?
# All six come back from one call, per Worker.
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$SCRIPT_TAG" | jq .
```

### Branch control — `main` is production for the app Worker and the SPA

**A merge to `main` builds and deploys, within minutes, with no second gesture.** On **2026-08-29** the owner moved both `magna-carta` (the API Worker) and `magna-carta-web` (the SPA) onto **`main`** as their production branch, to shorten the UI review loop: a screen correction should be visible on the deployed site without a separate deploy step. That supersedes the `release` model this section described before, and with it the deliberate `git push origin main:release`, which no longer gates anything.

What follows from it, and it is the whole reason this section is read:

- **A merge is a deploy.** A migration, an API-contract change, a binding change or a `wrangler.jsonc` edit reaches real users on the strength of whatever verification ran before it landed — and that verification is `pnpm gate`, run on the branch and again as the hosted `gate` check (_Quality gates_, below). There is no undeployed queue to catch a mistake in.
- **There is no "what is live" question separate from the trunk** for those two Workers. `git log release..main` is not the undeployed queue any more; `release` survives as history and is not a deploy target.
- _Builds for non-production branches_ (`previews_enabled`) stays **off**, so a feature branch still builds nothing. Only the trunk deploys.

**The fleet may be mixed, and that is the trap — so check before you rely on it.** The ruling above named two Workers. Whether any given sibling shares their production branch is live state that has moved more than once without a commit, and **a mixed fleet is silent**: a merge to `main` can ship an app Worker expecting a sibling change the sibling never built, and nothing goes red. Before relying on a cross-Worker change landing together, read the branch of every project in one pass:

```bash
# Production branch of every connected Worker, newline-separated. Anything that is not
# your expected branch is a Worker your merge will NOT reach.
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts?per_page=100" \
  | jq -r '.result[].tag' | while read -r tag; do
      curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$tag" \
        | jq -r 'if .success then "\(.result.script_tag) \(.result.git_repository.branch)" else "not connected" end'
    done
```

**Deploy order is now a merge-time hazard, not a deploy-time one.** Cloudflare rejects a deploy whose service binding names a Worker that does not exist, so a merge that adds a `*_SERVICE` binding to `apps/api-worker/wrangler.jsonc` fails the app Worker's build the moment it lands — see §14 and §16 for the ordering rule. Under the old model that failure waited for a deliberate push; now it happens on the merge, so the target Worker (or a 503 placeholder under its final name) must exist **before** the binding merges.

To change a project's production branch, **per Worker** — dashboard **Settings → Build → Branch control**, or `PATCH /accounts/{account_id}/builds/workers/{script_tag}` with `{"git_repository":{"branch":"main"}}`. `GET` on the same path reads the whole build configuration back.

### Per-Worker build configuration (dashboard: **Workers & Pages → _the Worker_ → Settings → Builds**)

**Root directory: every Worker except `magna-carta` itself is rooted at its own `apps/<worker>`.** The
app Worker is the only one that legitimately spans the repository — it bundles the SPA, the WASM
artefacts and the whole per-firm data layer — so it alone is rooted at `/`. Every sibling is one
package plus at most one container image, and rooting it there is what makes its Watch Paths mean
something: a Worker rooted at `/` sees every path as its own and cannot be scoped by exclusion
without listing the entire repository. It also keeps its deploy command a plain `npx wrangler deploy`
rather than a `--filter` incantation that has to name the package a second time.

**The intended shape — the standard every sibling is set to, and the only per-Worker exception:**

| Field             | Intended                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| Root directory    | `apps/<the-worker>` — `/` on `magna-carta` alone, for the reason above |
| Build command     | `pnpm install --frozen-lockfile && pnpm run build`                     |
| Deploy command    | `npx wrangler deploy`                                                  |
| Build caching     | On, everywhere — the primary fast-build lever                          |
| Build Watch Paths | **The one field that legitimately differs per Worker** (see below)     |

**A merge that landed with no build behind it.** Twice on 2026-09-11 a squash merge reached `main` and no Workers Build was queued for it — once after GitHub answered the merge call with a 502 and the retry succeeded, so the commit exists but the push webhook Workers Builds listens for never fired. The symptom is the version chip's API line sitting on an older commit than `main` with no build listed for the new one. The dashboard cannot ask for a build of a given commit: **Retry build** rebuilds the commit _that_ build was for, not the head of `main`. The remedies are a **deploy hook** (Settings → Builds → Deploy hooks → Create; `curl -X POST <url>` builds the head of `main` — `magna-carta-scan` already uses one for its daily rebuild) or, from the dashboard alone, a new commit to `main` that touches the Worker's watch paths. Neither is an empty commit: the change must be real, and the repository has a standing rule against kicking CI with an empty one.

That table is the **design**, not a reading of the account. What each Worker is actually set to is
live state; the `GET /accounts/{account_id}/builds/workers/{script_tag}` call above returns all six
fields at once, and a difference from this shape is either a drift to fix or a decision nobody wrote
down. **Watch Paths have to differ per Worker**, or every push rebuilds every Worker; nothing else in
the list should.

That uniformity holds because every sibling's `package.json` already carries the same pair —
`build: node ../../packages/build-identity/scripts/generate-build-identity.mjs && wrangler deploy
--dry-run --outdir dist` and `deploy: wrangler deploy`. The build-identity step stamps the Worker
with the commit it is being built from (the version chip and `GET /api/v1/meta/versions` read it
back at runtime); it writes only under CI, so a local `pnpm run build` keeps the checked-in "dev"
placeholder and a clean tree — the mechanics live in
[`packages/build-identity/CLAUDE.md`](../../packages/build-identity/CLAUDE.md). **A Worker needing
more than that puts it in its own build script, never in the dashboard field.** `magna-carta-sign` is
the one case: it additionally inserts `vp run -w rust-wasm-build`, where `-w` selects the
workspace-root task
(without it the task does not resolve from a package directory and the build fails with
`Task "<name>" not found`). A dashboard field is invisible to review and drifts from the repository —
this file has recorded three such drifts already — so the repository is where the difference belongs.

What is genuinely per-Worker and **cannot** be read off the API — why a Worker's build is shaped the way it is, and the failure it is shaped to avoid:

- `magna-carta` — **the one Worker whose build command is not the shared `pnpm run build`**, because it is the one rooted at `/`: it drives the workspace build task, and its deploy filters to the api-worker package. **The WASM artefacts the build consumes — `@magna-carta/pdf`, `@magna-carta/decryption` and `@magna-carta/email`, all three imported by the WORKER (pdf directly, by its PDF form fill and search text extraction, and transitively through `packages/document-assembly`; decryption by its decryption and recovery routes; email by its capture consumer and inspector routes), and pdf ALSO by the SPA since 2026-09-07 (the in-browser reader's `apps/web/src/lib/documents/pdf-render.worker.ts`) — each build inside a pinned Rust Docker image** (`crates/<crate>/wasm.Dockerfile`, run by `rust-wasm-build` in `vite.config.ts` — itself a chain of the three per-crate tasks, so a Worker that imports one crate can ask for that one and not pay to compile the other two), exactly as the `scan`/`bundle`/`convert` container images build their Rust — so the runner needs only Docker (which it provides), never Rust/wasm-pack on the bare machine, and the build command stays the standard one. **This paragraph read "`@magna-carta/pdf` (imported by the SPA)" until 2026-08-21, when it was corrected to "the worker only" because `apps/web/package.json` then depended on no WASM package; the PDF reader merge put the dependency back on 2026-09-07, so the answer to "can the interface build without the Rust toolchain?" is once again no.** That is the shape to watch: which side of the SPA/worker line a crate sits on is not a settled fact about this repository, it is a fact about today's dependency graph, and it has now flipped twice. Read `apps/web/package.json` rather than this sentence. See [`docs/specs/2026-08-21-spa-worker-split-design.md`](../specs/2026-08-21-spa-worker-split-design.md). **Any new crate the app worker or SPA imports as WASM must be added to `rust-wasm-build` and given its own `wasm.Dockerfile`, or the bundle fails with `ENOENT … <crate>_bg.wasm`.** **History:** from the PDF engine merge (2026-06-23) until 2026-06-28 the wasm built with bare `wasm-pack` on the runner, which has no Rust toolchain, so every `magna-carta` build failed with `Failed to find executable wasm-pack` (no deploy succeeded in that window); moving the wasm build into Docker fixed it. The same class recurred 2026-07-04: the decryption merge added a worker import of `@magna-carta/decryption`'s wasm but `rust-wasm-build` still built only pdf-core, so the bundle failed with `ENOENT … decryption_core_bg.wasm` — fixed by adding the decryption-core Docker wasm build alongside pdf-core's. It went undetected until the trunk was pushed because the pre-push gate does not run a worker bundle. **The fourth occurrence, 2026-09-07, is the one that says the rule was still half-stated:** the PDF reader merge made the SPA import pdf-core, and `build-all` did name `rust-wasm-build` — beside `@magna-carta/web#build`, in the same `dependsOn` list. Entries in that list are siblings and run in PARALLEL, so the SPA bundle raced a Docker image pull it could only lose, and the deploy went red on `UNRESOLVED_IMPORT … ./pkg/pdf_core.js` while the wasm was still building a few feet away. `build-all` now carries the order in its command chain (wasm, then the SPA, then the worker), where a nested `vp run` is inlined as its own task rather than a child process. **So the rule, fully stated: the Worker that imports a crate's output needs a build command that reaches `rust-wasm-build` AND is ordered after it — naming it is not ordering it.**
- `magna-carta-scan` — Deploying the scan Worker builds and pushes the `containers/scan` image referenced by its Container binding.
- `magna-carta-bundle` — Deploying the bundle Worker builds and pushes the `containers/bundle` image referenced by its Container binding. The image is a separate slice's deliverable (`containers/bundle/Dockerfile`); until it exists the bundle Worker cannot deploy, so the `BUNDLE_SERVICE` binding in the app Worker stays unbound and the encrypted/heavy bundle lanes return `503` (the plain ZIP fast lane is unaffected).
- `magna-carta-recovery` — Deploying builds and pushes the `containers/recovery` image (the pure-Rust password-recovery engine) referenced by its Container binding, and applies its `RecoveryEngineContainer` DO migration. **Its build context is the repo ROOT** — the Dockerfile COPYs both `crates/decryption-core` (a path dependency) and `containers/recovery/...`, so `wrangler.jsonc` sets `image_build_context: "../../"`; the root `.dockerignore` allowlists only `crates` + `containers`. Without the explicit context, wrangler builds against a narrower default and the `COPY containers/recovery/wordlists` step fails on the runner with `"containers/recovery/wordlists": not found` (a local `docker build … .` masks it by using the root). The app Worker's `RECOVERY_SERVICE` binding **requires this Worker to exist first**: wrangler rejects a deploy whose service binding targets a missing Worker (`Service binding … references Worker … which was not found [code: 10143]`), so this Worker must be connected + deployed before the app Worker can deploy — the code's graceful fallback is runtime-only, not a deploy-time exemption. No warm-poke cron, so the `standard-1` container scales to zero at idle.
- `magna-carta-file-repair` — Deploying builds and pushes the `containers/file-repair` image (the Rust file-repair/salvage engine) and applies its `FileRepairEngineContainer` DO migration. **Same crates-sharing pattern as `magna-carta-recovery`** — `image_build_context: "../../"` plus the Dockerfile's `COPY crates crates`: the binary compiles `engine-host` + `recovery-core`, which inherit `edition` from the `crates/` workspace root, so the whole workspace must be in the build context (only those two crates actually compile). The app Worker's `FILE_REPAIR_SERVICE` binding requires this Worker to exist (same `code: 10143` rule as recovery above). No warm-poke cron, so the `standard-1` container scales to zero at idle.

- `magna-carta-sign` — The uniform three fields, like every sibling — **the one thing it needs extra lives in its own `build` script.** `apps/sign-worker/src/index.ts` imports the pdf-core WASM binary directly, `packages/pdf/src/pkg/` is a git-ignored artefact, and the only task that produces it is `rust-wasm-build`. Its own `pnpm run build` is a bare `wrangler deploy --dry-run` and never reaches that task, so a build scoped to the package fails with `ENOENT … pdf_core_bg.wasm` out of wrangler's module collector — **the third occurrence of this class**, after the bare-`wasm-pack` window (2026-06-23 to 2026-06-28) and the decryption import (2026-07-04) recorded above. So `apps/sign-worker`'s own `build` script inserts `vp run -w rust-wasm-build-pdf` between the shared build-identity stamp and the `wrangler deploy --dry-run --outdir dist`: the `-w` reaches the repository-root task from the package directory, the per-crate task builds the one crate this Worker imports rather than all three, and the dashboard command stays the plain `pnpm run build` every sibling uses. Running `build-all` instead would also work — its `dependsOn` carries the same step — but it costs the SPA and app-worker bundles to produce one `.wasm`. The price paid here instead is that a local `pnpm run build` in this package now needs Docker, which is the correct place for the cost: it falls on whoever builds this Worker rather than on every Worker's build. **The rule the earlier two occurrences left half-stated:** a crate being in `rust-wasm-build` is not enough; the Worker that imports its output needs a build command that actually REACHES that task — and, as the app Worker's entry above records, is ORDERED after it.
- `magna-carta-status` — The public status page Worker.
- `magna-carta-community` — The community board on `community.magnacarta.esq` (`apps/community-worker`, since 2026-11-13). It serves the board's API under `/api/` and `/session`, and `apps/web`'s build for every other path, so its `build` script carries the same WASM steps as `magna-carta-web`'s and needs Docker. It binds `DB_CONTROL`, and `STATUS_KV` (the status page's namespace, read only, for the board's Known Issues), and every answer carries `X-Robots-Tag: noindex`. **Secret:** `COMMUNITY_HANDOFF_SECRET`, the same value set on `magna-carta`, which mints the one-minute sign-in link; without it on both, the board is readable and nobody can sign in. **Switch:** `INSERT OR REPLACE INTO community_board_switch (id, state, changed_at, note) VALUES ('board', 'read-only', <now>, <why>)` against the control-plane database makes it read-only (`off` closes it, `open` or deleting the row reopens it), with no deploy. **Team:** the board's Moderation page and triage panel appear for a person with an unexpired `platform_operator` row; nobody else is on the team.
- `magna-carta-web` — The SvelteKit single-page application, on its own deployable. It is an **assets Worker with one small script**: no bindings beyond `ASSETS` (its own public files), no secrets, so a page request is answered by Cloudflare's asset server and invokes nothing. That emptiness is a security property, not an accident — the bytes it serves are public, and a deployable whose entire surface is "hand back a file" must have nothing bound to reach. **Keep it that way.** The script (`apps/web-worker/src/`, since 2026-11-10) runs only for `/_app/*` (`run_worker_first` in its `wrangler.jsonc`) and does two things that only work together: a content-hashed file under `/_app/immutable/` is served with `Cache-Control: public, max-age=31536000, immutable`, and a file under `/_app/` that does not exist is answered `404` with `no-store` instead of the application shell the single-page fallback would send. Before it, the asset server's default (`max-age=0, must-revalidate`) had every repeat visit re-ask about each of roughly 116 files; a `_headers` rule alone would have fixed that and let a deploy race cache HTML under a script's address for a year. **Do not add a long lifetime to `/_app/` in `apps/web/static/_headers`**, and do not remove the guard while the lifetime stands. To check a deploy: `curl -sI https://<host>/_app/immutable/<any real file>` shows the year-long header, and `curl -sI https://<host>/_app/immutable/chunks/absent.js` shows `404`. The API Worker's own copy of the build (local development and the rollback route) has neither the guard nor the lifetime, so a rollback to it returns to revalidate-every-visit, which is slower and never wrong. Its own `build` script builds the pdf-core wasm, then `@magna-carta/web` (the sibling package whose output `wrangler.jsonc` points at), then runs the usual `wrangler deploy --dry-run --outdir dist` — the dashboard command stays the plain `pnpm run build` every sibling uses. **It needs Docker, and exactly one WASM step**: `vp run -w rust-wasm-build-pdf`, because `apps/web` imports `@magna-carta/pdf` for the in-browser PDF reader as of 2026-09-07. **This entry read "it needs no Docker and no WASM step: `apps/web` reaches no crate" until then, and the merge that made it false took this Worker's build down with it** — the same failure as the app Worker's, arriving here through a different route, because this build script never reached the wasm task at all. It asks for the **pdf crate alone** (`rust-wasm-build-pdf`, not the composite): this is the Worker that rebuilds on every interface merge, and compiling decryption-core and email-core for a bundle that imports neither is exactly the repeated build cost [`build-performance.md`](build-performance.md) says to keep out. The sign Worker's WASM lesson now applies here too; what stays true is the runtime property — a build-time Docker step adds no binding, no secret, and no entrypoint, so the deployable still binds nothing but its own files.
  **Since 2026-08-31 this is the Worker that serves the application.** The app's hostname was converted from a custom domain on `magna-carta` to **route patterns on the zone**: this Worker answers every path, and `magna-carta` is routed only its own four families (`/api/*`, `/wopi/*`, `/search-objects/*`, `/__dev/*` — the same list as its `assets.run_worker_first`, and the two must stay the same list). Which hostname and which routes exist remains live routing state — read `GET /accounts/{account_id}/workers/domains/records` and the zone's `workers/routes` (below) rather than this paragraph. `apps/api-worker` still binds the same `apps/web/build` output under its own `assets` block, **deliberately**: it is the local-dev vehicle (`wrangler dev` and the Playwright e2e suite serve the whole app from it on one origin) and the one-gesture rollback (repoint the zone's `/*` route back to `magna-carta`). Do not remove it without replacements for both. **The decoupling itself is carried by Build Watch Paths** — `magna-carta` not watching `apps/web/*` is what makes an interface merge build only this Worker — and those are dashboard state: read them with the per-`script_tag` Builds call, never from here. Decision: the interface-ships-on-its-own-worker ADR (pending fold-in at time of writing; the Decision Log register carries its number once assembled).
- `magna-carta-edit` — The Collabora editing Worker. **The Worker keeps the name `magna-carta-edit`; only its directory moved** (from `apps/magna-carta-edit`, 2026-08-21) to match its own package name, `@magna-carta/edit-worker`, and its siblings' `<thing>-worker` shape. **This Worker is why the top of this file says what it says.** Its entry once recorded a root directory, a deploy command and a production branch that were all true when written, and all three were false by the time anyone read them back — the fourth time this file disagreed with the live build configuration. Nothing about its build configuration is recorded here any more; ask the API.

### Which address does a Worker answer on — the read, and why it is not in `wrangler.jsonc`

**A Worker's `wrangler.jsonc` is not the answer to this question, and reading it as one has produced
a wrong answer before.** A custom domain attached in the dashboard is account state: it does not
appear in the repository, `wrangler deploy` does not remove it, and a Worker can therefore carry
`workers_dev: true` with no `routes` block and _still_ answer a real hostname. "No `routes` in the
config" means only that the config declares no route patterns.

Three separate things decide reachability, and they are read in three different places:

```bash
# 1. Custom domains — which hostname maps to which Worker. Account-level, so no zone scope needed.
#    This is the authoritative answer to "what does a user browsing our address actually hit?"
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains/records?per_page=100" \
  | jq -r '.result[] | "\(.hostname)\t-> \(.service)\tenabled=\(.enabled)"'

# 2. Is the workers.dev URL live for this Worker? (<script>.<subdomain>.workers.dev)
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain"
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/subdomain"

# 3. Route patterns — zone-scoped, and a Workers-only token gets 403 here (see the note at the top).
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes"

# Which zones the account even holds:
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?per_page=50" | jq -r '.result[] | "\(.name)\t\(.status)\t\(.id)"'
```

**A custom domain and a route pattern are not the same mechanism.** A custom domain binds one
hostname to one Worker and takes the whole hostname; splitting one hostname between two Workers (the
SPA everywhere, the app Worker on its own path families) needs **route patterns** on a zone, which a
`workers.dev` URL cannot carry. So "can we split the SPA onto its own address?" is really two live
questions — does the account hold an active zone for it, and is the hostname already consumed by a
custom domain on another Worker — and reads 1 and 3 above answer both. Do not answer it from memory;
this file answered it wrongly from memory, in a `wrangler.jsonc` comment that is still there.

**A `curl` against the public hostname is a weak check.** Bot management can answer `403` with
`cf-mitigated: challenge` before the Worker is ever invoked, which looks like an outage and is not
one. The domains/records read above is the reliable answer; a browser is the reliable smoke test.

### The version surface reads what was deployed, so Watch Paths decide what it can say

`GET /api/v1/meta/versions` (and the version chip above it) asks every dedicated Worker what commit
it is running, over its service binding, on the `/__version` route in `packages/build-identity`.
The roster is the **whole fleet** — every `apps/*/wrangler.jsonc` worker except the app Worker
itself, pinned by a fitness test in `apps/web/test/version-overlay.test.ts` — so adding a worker
under `apps/` means rostering it in `apps/api-worker/src/http/routes/platform/meta-versions.ts` in the same
commit, and usually adding a service binding for the probe (see the version-read-only trio in the
app Worker's `services` array; a binding must name a worker that exists on the account or the app
Worker's own deploy fails, which is why `EMAIL_SERVICE` waits for `magna-carta-email` to ship). The
`magna-carta-web` mounts no route of its own (its one script only corrects answers under `/_app/`); its answer is the static
`/__version` file the SPA build emits into `apps/web/build`. A
Worker answers only if that route was in the build it was deployed from. A Worker deployed from an
earlier commit 404s the probe, which the aggregate records as `unreported` and the chip renders as
**"Not reporting"** — true, and easy to mistake for an outage, because the Worker is healthy and
serving its real work perfectly.

Each probe is raced against a fixed timeout and now reports what it cost
(`latencyMilliseconds`), so `reported` and `unreachable` stop being the only two readings of one
measurement: a Worker answering close to the timeout is marked **Slow** in the chip before the day
it flips. A Worker with no binding was never asked and carries no number rather than a zero.

**So `packages/build-identity/*` belongs in the Build Watch Paths of every Worker whose version the
aggregate reads.** Without it, a change to the version route or to the identity stamp matches no
sibling's watch paths and rebuilds nothing, so the sibling keeps answering from whatever build it
last had a reason to make — and reads as "Not reporting" until something unrelated happens to rebuild
it. The branch question above compounds it: a sibling building from a branch the route never reached
cannot pick it up at all. **Whether every sibling carries that path today is live state** — the
per-`script_tag` Builds call returns `production_settings.path_includes`, and that is the only place
the answer exists:

```bash
# Which Workers watch packages/build-identity/*, and which do not
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$SCRIPT_TAG" \
  | jq -r '.result.production_settings.path_includes'
```

**A row reading "Not deployed" is a different and truthful answer**, and is not a fault: it means the
Worker has no `*_SERVICE` binding in `apps/api-worker/wrangler.jsonc` and no connected Workers Builds
project, so there is nothing to probe. Distinguish it from "Not reporting", which means the Worker
exists and answers, just from a build predating the route. The surface is doing its job in both cases.

### The database-health read is where a firm's own provisioning becomes visible

`GET /api/v1/meta/database-health` sits beside the version read and answers the other half of "is
this working": a timed round trip to the session firm's `FirmDatabase` Durable Object, the control
plane's own answer and whether the firm's bucket exists, the applied migration lineage against the
one the running build carries, the session member's row and roles, and the backlog of
`member.provision` outbox rows for that firm.

**It is the first place a stalled member mirror shows up as itself.** A firm whose owner has no
member row yet has an empty permission set, so every permission-gated route answers 403 with the
same within-firm-denial problem a genuinely ungranted role produces — a support report of "all my
screens say I have no permission" has, until now, had no way to distinguish the two. The panel's
Database section names it, and the Provisioning line beside it says whether the row is still pending
(a sweep away) or dead-lettered.

**A dead-lettered mirror is the operator seam, not a wait.** `sweepOutbox` marks a row `failed`
terminally by design, so nothing re-dispatches it: the recovery is
`requeueDeadLetteredMessageStatement` (`packages/data-access/src/outbox-statements.ts`) flipping the
row back to `pending` for the next sweep. The read reports the count and never touches the rows.

The route carries `permission: null` on purpose. A gated version of it would refuse exactly the
session it exists to explain, which is the member whose permissions have not landed.

### Cron Triggers — two rules that have each cost a deploy

**Cloudflare numbers days of the week 1 = Sunday through 7 = Saturday.** `0` is out of range, not a
synonym for Sunday, and almost every other cron implementation disagrees. An expression carrying it is
rejected.

**The schedule write is one atomic call for the whole set**, so a single malformed expression refuses
every trigger alongside it. A configuration that works at three and fails at five is not evidence of a
count ceiling — it is evidence that one of the two added expressions is bad. Restore triggers **one at
a time**, because the atomic write does not say which one it rejected.

**The error you get says nothing.** `Some triggers failed to deploy … /schedules failed` carries no
code and no message, because wrangler puts the API's `errors[]` into a field its trigger aggregation
does not print. The absence of a code is a reporting artifact, never evidence about the response. To
see the real error, call the endpoint directly — `GET` reads what is attached, `PUT` replaces the
whole set, so capture the `GET` first.

**Omitting the `triggers` key and writing `"crons": []` are opposite gestures.** With no key at all
wrangler skips the schedule call entirely and leaves whatever is attached alone — which is the safe
way to ship code while a schedule is in question. An empty array is truthy, so it writes an empty set
and **deletes every schedule the Worker has**. On the app Worker that stops the five-minute pass, which
is the only thing in the system that applies control-plane migrations.

**And read the deployed configuration before diagnosing anything.** Seven weeks of trigger failures ended when the
already-correct trunk configuration reached the production branch; every build until then had
been carrying the older set. Read what the Worker was actually built from —
`git show origin/main:apps/api-worker/wrangler.jsonc` for a project on `main`, and the equivalent on
whatever branch a sibling project still builds from — first, not last.

**A watch path that matches nothing suppresses rebuilds _silently_** — the symptom is a Worker that quietly stops tracking its own sources, never a red build. Two real instances, kept as the shape to look for rather than as a statement about today's configuration (both were corrected in 2026-08; verify against the API, not against this paragraph):

- `magna-carta-file-repair` included `containers/file-repair-worker/*`, but the container lives at `containers/file-repair/`. No path matched, so a change to the file-repair container image never triggered a rebuild.
- `magna-carta-recovery` omitted `crates/decryption-core/*`, though its Dockerfile COPYs that crate as a path dependency. A change to `decryption-core` alone never rebuilt the recovery container.
- `magna-carta-edit` read `apps/edit-worker` with no trailing `/*`, matching no file _under_ the directory.

**The check that catches all three:** for each include pattern, confirm a path that actually exists in the repository matches it. A directory name with no `/*`, or a directory that has since been renamed, matches nothing and fails open.

Two settings to **enable/set** (the fast-build levers — see [`build-performance.md`](build-performance.md)):

- **Build Caching — turn ON for every connected Worker.** Caches dependencies and build outputs across builds (a project-wide cache), so a build does not re-download the pnpm store or rebuild unchanged outputs every run. This is the primary fast-build lever and the analog of a CI dependency cache.
- **Build Watch Paths — set per Worker** so an unrelated change does not rebuild every Worker. Patterns are repo-root-relative; a single `*` matches zero or more characters across directories; excludes are filtered first, then a build runs only if a changed path still matches an include. (Workers Builds always builds regardless of paths when a push has 0 changes, 3000+ changes, or 20+ commits.)
  - **Scope by _exclusion_ only for a Worker rooted at `/`** — it sees the whole repository as its own, so an include list would have to name all of it. Exclude what genuinely cannot affect it (documentation, container images it owns none of, scratch directories, `*.md`).
  - **Scope by _inclusion_ for every Worker rooted at its own `apps/<worker>`** — name its package, the container image it owns, each crate its Dockerfile COPYs, the lockfile and workspace manifest, and `packages/build-identity/*`. Anything omitted is a source the Worker silently stops tracking.
  - Read the live include/exclude lists with the per-`script_tag` Builds call above; do not assume them from this page.

### Quality gates — `pnpm gate` is the gate of record; the `pre-push` hook is the fast local subset

Workers Builds builds and deploys but runs no checks, so the checks live in two places, split by cost:

- **The whole-repo gate of record is `pnpm gate`** ([`tooling/gate/`](../../tooling/gate/index.mjs)), run on the branch before it merges. It runs the osv-scanner dependency audit, the full **`pnpm check`** (format, the type-aware lint over the affected closure, the type-check), the governance lints and the repo-wide fitness sweep, migration integrity, all four contract-drift checks (OpenAPI snapshot, generated client, Spectral, design-token), the Rust gate for a changed crate, a changed container's cargo checks and acceptance suite (scan EICAR, recovery, bundle, libreoffice) under Docker, the test-collection floor, and the full **`pnpm test`** — each dimension only when the change can reach it, and named in the summary when it does not. Its design, its flags and why it is a command rather than a workflow are in [`build-performance.md`](build-performance.md) under _The gate — `pnpm gate`, on the machine that made the change_. **Since 2026-08-29 the merge and the deploy are the same event on `main`** (branch control, above), so this gate is the only chance to catch a defect before real users see it. Since 2026-11-09 it runs twice: on the branch by its author, whose summary block the pull request pastes into its description, and hosted as the required `gate` check (`.github/workflows/ci.yml`) on GitHub's merge of the branch into `main`.
- **The local `pre-push` hook** (`tooling/git-hooks/pre-push`) is a fast tripwire, not the gate of record: it runs **`pnpm check:scoped`** (fmt + lint + `tsc -b` + svelte-check/Rust, scoped to the diff), the governance lints, and the migration-integrity check — the checks the current diff can actually break, finishing in seconds rather than the tens of minutes the whole-repo gate takes. It keeps the push loop quick; `pnpm gate` does the exhaustive sweep before the merge. Activate it once per clone with **`vp run setup-hooks`** (the same step that installs the post-merge auto-clean hook; `core.hooksPath` → `tooling/git-hooks`). `SKIP_PREPUSH=1 git push` bypasses it — a skipped hook is caught by the gate before the merge, not shipped.

#### The hosted gate, 2026-07-13 to 2026-09-16, and how to read what it left behind

The same checks ran as a GitHub Actions workflow (`gate.yml`) for two months, required on every pull request into `main` through an aggregate `gate` status. The account's Actions minutes ran out on 2026-08-05 and again on 2026-09-03; each time GitHub refused to start any billable job, the required status never reported, and every pull request wedged behind it until an administrator override merged it. That is why the gate is a command now: a required status that depends on a budget fails closed on the budget and open on the code. The workflow and its companions are gone; On 2026-11-09 the owner funded Actions with a spending cap and the check returned as a hosted run of `pnpm gate` (`ci.yml`, job `gate`); the settings it needs, and what to do if the cap is reached, are on the [deploy queue](../deploy-queue.md).

For reading the history of that period: a run that GitHub refused to start is indistinguishable at a glance from a red build. Its fingerprint is `runner_id: 0` and an empty `runner_name` on every job, a wall-clock of seconds with `started_at` equal to `created_at`, a log endpoint that 404s, and a red aggregate over a field of `skipped`. `gh api repos/Phauks/magna-carta/actions/runs/<run-id>/jobs --jq '.jobs[] | {name, conclusion, runner_id}'` prints a run's verdict in one line. A red check from those windows is not evidence about the code — every merge from 2026-08-05 onward landed on local verification alone, and the deploy queue's entry records which.

`oasdiff` (breaking-change vs. the base) is in neither (it is a review-time / base-branch check); run it in review if needed.

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

Control-plane D1 migrations apply **automatically** — no manual deploy step is required. The scheduled (Cron) handler (`apps/api-worker/src/background/scheduled.ts`) runs `runPendingMigrations` against `env.DB_CONTROL` as its **first action** on every cron tick, before the existing control-plane outbox sweep, so the schema is current before any other control-plane work in the same tick.

**Why the cron is the sole runtime applier — single-flight by construction.** The migration runner is not safe to run concurrently against the same database for the same pending migration. Each migration applies as one atomic `batch()` call (see `packages/database/src/d1-migration-target.ts`), and the runner fails loud on the first error with no internal retry (`packages/database/src/migration-runner.ts`). The `_migrations` table uses `tag TEXT PRIMARY KEY`, so if N worker isolates raced the same pending migration, exactly one batch would commit and every other isolate's batch would fail with a `UNIQUE constraint failed: _migrations.tag` error — a burst of N−1 thrown errors per migration-bearing deploy. The cron fires as a single invocation per tick, so making it the sole applier eliminates that concurrency in the common case; a rare overlapping fire is made safe by the error isolation around the step (the loser throws and is caught, the next tick is a no-op at head).

**Additive migrations + fail-safe reads — tolerating the deploy window.** Between a deploy and the cron tick that applies a new migration (at most one `*/5` cycle, typically under five minutes), request code may read a control-plane column that does not yet exist. The discipline that makes this safe:

- Control-plane migrations are **additive only** (expand-contract; no destructive DDL while data exists).
- Request code that reads a new additive column must **default safely** on absence rather than propagating an error. Example: `/me` reads `firm.release_channel` on every session bootstrap; if the column is briefly absent right after a deploy (or any transient read error), the handler yields `channel: "stable"` and the default flag set and returns a successful response — the bootstrap never fails fleet-wide while the schema window is open. The same pattern applies to any other endpoint that reads a new control-plane column. (Write endpoints that need the column cannot fail-safe this way; they return an error during the window and recover once the migration lands — see `docs/active-work/release-channels.md`.)

**Deploy-time application — the future zero-window hardening.** Running `runPendingMigrations` in the Workers Builds command (before `wrangler deploy`) would be single-flight by construction: the build runs once, applies the migration, then the deploy follows. That approach eliminates the window entirely (true migrate-before-serve, mirroring how per-firm migrations apply at provision time). It requires a D1-over-HTTP `MigrationTarget` adapter and an API token as a build secret. Adopt this when production firms make a zero-width schema window matter — for now the cron + fail-safe discipline covers the gap.

### A stalled migration ledger looks like a broken feature — the 2026-08-29 episode

**Symptom:** every signup answered `500`, and the control-plane `registration` table did not exist. Nothing about the registration code was wrong. The database had stopped applying migrations weeks earlier and nothing said so, because a migration pass that refuses fails **inside the cron tick**, not on the request that later trips over the missing table.

**Root cause — a strict PREFIX of a retired chain.** Production's control-plane database had applied `0000_firm-registry` through `0004_support-access`: five of the seven tags in the pre-baseline control-plane lineage the 2026-07-04 squash retired (`LEGACY_BASELINES` in `packages/database/src/legacy-baselines.ts` carries the full seven). The reconciliation that ships in `runPendingMigrations` recognizes a **complete** retired chain and rewrites the ledger to the equivalent baseline tag; it **deliberately refuses a prefix**, because a partial chain means the schema stops partway through the retired lineage, the baseline (the chain's cumulative end state) would misrepresent it, and the retired SQL no longer ships to bring it forward. So every pass since threw on the first unrecognized tag and applied nothing — the schema froze at a five-migration-old shape while the code moved on for two months.

**The recognition rule, stated once so it is not re-derived:** a complete retired chain reconciles silently; anything else — a prefix, a superset, a mixed set — refuses, loudly, for a human. The refusal is the error `database has applied migration "<tag>" which this code does not know — deploy mismatch (code older than schema)`, and its wording is misleading here: the code was _newer_ than the schema, not older. Read the error as "this ledger and this bundle disagree", never as a statement about which side is ahead.

**The diagnosis path that actually worked** — and it is one query, not a code read:

```sql
SELECT tag FROM _migrations ORDER BY tag;   -- in the D1 console, against the control-plane database
```

The applied ledger against `LEGACY_BASELINES` and the shipped journal answers it immediately: a prefix of a retired chain is visible at a glance, and no amount of reading the registration route ever would have been. Run this first whenever a table the code plainly creates is absent in production.

**How it was resolved:** the owner dropped every control-plane table, after which the `*/5` cron pass applied the current lineage from the baseline forward. That is available only because the control plane held no data worth keeping — it is **not** a general remedy, and on a database carrying real firms it would be data loss rather than a repair.

**The improvement it argues for, unbuilt.** Archive the retired migration SQL alongside the baseline so a stalled database can **catch up** — replay the remainder of the retired chain, then reconcile to the baseline — instead of refusing. The current design assumes every live database had been migrated to the chain's head before the collapse, and that assumption is what production violated. Refusing a prefix is the safe behaviour and should stay the default; what is missing is a path forward for the case that actually occurs. Until it exists, a prefix ledger is a manual repair by whoever can read this section.

## 14. Service-binding targets must exist — the placeholder mechanism, and why the roster is now empty

The `magna-carta` app worker declares sibling service bindings for every dedicated engine worker (`SCAN_SERVICE`, `BUNDLE_SERVICE`, `CONVERT`, `FILE_REPAIR_SERVICE`, `RECOVERY_SERVICE`, `OCR_SERVICE`, `SIGN_SERVICE`, `DISCOVERY_SERVICE`). Cloudflare rejects a deploy whose service binding points at a worker that does not exist, so **every** name must resolve before the app worker deploys — see §16 for the ordering rule the seal worker introduces. **Since `main` became the app Worker's production branch (2026-08-29), that constraint binds at merge time**: a pull request that adds a binding for a Worker nobody has stood up fails the app Worker's build the moment it lands, in production, rather than at a deliberate push.

**`magna-carta-bundle` and `magna-carta-convert` were 503 placeholders from 2026-06-27**, so the editing slice could deploy before the bulk-download and conversion subsystems existed. Both were later replaced by the real Worker. **Whether any placeholder stands on the account right now is live state** — a placeholder is recognisable by what it lacks, so read the deployed script's bindings and migration tag rather than trusting a roster:

```bash
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/settings" \
  | jq -r '[.result.bindings[].type] | group_by(.) | map({(.[0]): length}) | add'
```

**The mechanism is kept because the next new engine Worker needs it.** To ship an app-worker change that names a Worker not yet built, stand up a 503 placeholder under the final name, then connect a Workers Build project for the real one (dashboard, exactly as §12) — each engine carries a container image that must build on Cloudflare's runners. Deploying the real worker overwrites the placeholder and adds its container Durable Object migration cleanly (a placeholder has no Durable Object classes). No app-worker config change is needed; the binding already points at the right name.

## 15. R2 bucket CORS — browser direct-to-R2 upload (account configuration, not code)

The File Manager upload is a direct-to-R2 ceremony: the browser `PUT`s bytes straight to a presigned R2 S3 URL (`<account>.r2.cloudflarestorage.com`), never through the Worker. That is a **cross-origin** request from the app origin to the R2 endpoint, so the bucket must carry a **CORS configuration** or the browser's preflight fails and no bytes land. Multipart additionally needs the `ETag` **response** header exposed — the client reads each part's `ETag` to build the completion manifest, and a browser cannot read a response header CORS does not expose. This is bucket configuration, not committed code (like the `bundles/` lifecycle rule in §10); it is applied **out-of-band against the bucket by the owner, not by CI**, and no committed code can substitute for it.

The development R2 upload route (`apps/api-worker/src/http/routes/developer/dev-r2-upload.ts`) is **same-origin** and therefore exercises no CORS — a green local suite proves nothing about this step. **The acceptance gate is one real upload against a real bucket in a preview environment, including a file large enough to take the multipart path** (exercising `uploads.signPart` and the `ETag` read). Until that passes, CORS is unverified no matter how green the local run is.

**Who applies it, and to which bucket.** Since 2026-09-03 firm provisioning applies the policy itself: `firm-resource-provider.ts` PUTs the rule set onto every new firm's bucket in the same unconditional step as its notifications and expiry rules, so a firm provisioned from now on takes browser uploads without an operator touching the dashboard. What stays an operator step is **every bucket that existed before that date** — the shared platform bucket, and the firm buckets provisioned before the step existed. The first production upload (2026-09-03) failed on exactly this: the firm's bucket carried no policy at all, the preflight was refused, and the app could only report that nothing answered. **Reading a bucket's policy is the check** (`GET /accounts/{account}/r2/buckets/{bucket}/cors`; "The CORS configuration does not exist" means uploads from a browser cannot work against it).

**The configuration** lives in [`apps/api-worker/src/files/browser-upload-cors.ts`](../../apps/api-worker/src/files/browser-upload-cors.ts), kept in R2's dashboard shape so a person can read it as what they would paste; the provider translates it to the REST API's shape and folds in the deployment's own `APP_BASE_URL` origin, and `pnpm --filter @magna-carta/api-worker run emit-r2-cors` prints it as the JSON the dashboard accepts:

- **`AllowedOrigins`** — every origin a browser uploads from. The artifact lists the custom-domain origins (`https://magnacarta.esq`, `https://app.magnacarta.esq`) and the two `workers.dev` serving origins (`magna-carta` and `magna-carta-web` under the account's subdomain, since wrangler keeps `workers_dev: true`); **add each preview-environment origin** used for the acceptance gate. A wildcard is not used — the presigned URL already scopes the credential; the origin allow-list is a second wall.
- **`AllowedMethods`** — `GET` (presigned download/preview fetches) and `PUT` (single-shot and multipart part uploads). The multipart create/complete/abort calls are server-to-server from the Worker (Authorization-header signed), never browser-issued, so they need no CORS entry.
- **`AllowedHeaders`** — `content-type` (the presigned PUT binds Content-Type into the signature, so the browser sends it) and the two object-dimension headers, `x-amz-meta-matter` and `x-amz-meta-object_class`. Those are **signed** as well, so an upload that omits one is rejected by R2 — which is deliberate (an object nothing can scope is worse than a failed upload) but means a bucket whose CORS does not allow them fails **every** browser upload at the preflight. Adding a dimension to what the presigned PUT signs means adding its header here in the same change, and re-applying the configuration.
- **`ExposeHeaders`** — **`ETag`** (required: multipart cannot complete without the client reading each part's `ETag`).
- **`MaxAgeSeconds`** — preflight cache lifetime (`3600`).

**How it looks in the Worker log, which is the fastest way to recognise it.** The refusal happens in the BROWSER, between it and the bucket, so the Worker log holds no error at all — which is why this failure reads as "nothing is wrong" from the observability side and gets diagnosed as something else. What it leaves is a shape, not a message: `POST /api/v1/uploads` answering **201**, then **no `.../parts/.../sign` call and no `.../complete`**, then `POST /api/v1/uploads/{id}/abort` answering 200 **seven to nine seconds later**, repeating once per attempt the reader makes. The gap is the client's retry ladder (three backoffs, 0.5 s + 1.5 s + 4 s, around four fast failures) running out; a slow link or a real network fault takes far longer per attempt and usually reaches the host at least once. Reservation, silence, abort, in under ten seconds, is this. The 2026-09-08 report (a firm bucket on the `magnacarta.esq` origin) was three of those in three minutes with no other log line to show for it.

**The check that names the fault, before any of the above is read by hand.** Since 2026-09-10 an Owner/Admin opening the **version chip at the top right** has the check run for them, beside the other reads, and its **Upload readiness** section lists every check as a row, with the panel's copy control taking the whole report (`POST /api/v1/firm/upload-readiness`, `apps/api-worker/src/files/upload-readiness.ts`). From the server side — the only side where the browser's refused write has a status code — it verifies the six preconditions of that write in the order they must hold: the firm row names a bucket; the bucket exists in the account (a firm provisioned under the development adapter fails here, and the check will not create the bucket for it); the ingest notification, the expiry rules and this CORS policy are in place (each is a PUT of the whole set the code owns, so the check **re-applies** them rather than reporting a diff — an origin change or a pre-2026-09-03 bucket is repaired by pressing the button); and the S3 credential signs a request the bucket honours (a signed HEAD for an object that does not exist: 404 is the affirmative answer, and a 403 is the signature of a token scoped to one bucket, with the re-mint named in the report). Open the panel first; the paragraphs below are for the cases it names.

**To apply by hand (a pre-existing bucket):** run `pnpm --filter @magna-carta/api-worker run emit-r2-cors` and paste its output under **R2 → the bucket → Settings → CORS policy → Add CORS policy** — it is R2's dashboard format (the bare rule array) — for the shared platform bucket **and for each firm bucket provisioned before 2026-09-03** (`magna-carta-production-firm-<slug>`; the firm row's `bucket_name` names it). The same rules can instead be `PUT` via the S3 API with the Object Read & Write token from §3 (`aws s3api put-bucket-cors --endpoint-url https://<account>.r2.cloudflarestorage.com --bucket <bucket> --cors-configuration '{"CORSRules": <the printed array>}'` — the S3 API wraps the array under a `CORSRules` key). Re-apply whenever the app gains a new serving origin (custom-domain cutover, a new preview environment) — and change the rule set in the same breath, since provisioning reads it. The configuration is idempotent — re-applying replaces the whole rule set.

## 16. E-signature seal Worker — deploy order, then platform identity provisioning

The platform seal runs in its own Worker (`apps/sign-worker`, service `magna-carta-sign`): the pure-Rust PDF engine (WASM) and the pkijs CMS producer run in-process, and it holds the platform signing identity. Its only surface is `POST /seal`, reached from the app Worker over a `SIGN_SERVICE` service binding through the shared `SealPort` wire contract. The signing key lives in exactly one Worker and is never reachable from the app Worker, the browser, or any firm-scoped code path.

> **Deploy order — the app Worker will not deploy until `magna-carta-sign` exists.** Cloudflare rejects a deploy whose service binding points at a Worker that does not exist, and `apps/api-worker/wrangler.jsonc` now declares `SIGN_SERVICE → magna-carta-sign`. **Deploy `apps/sign-worker` first** (it needs no secrets to deploy — see below), then the app Worker. If the app Worker must ship before the real sign worker is ready, stand up a 503 placeholder named `magna-carta-sign`, exactly as §14 describes for `magna-carta-bundle` and `magna-carta-convert`.

**Activation is deferred and safe by construction.** The sign worker deploys _without_ its secrets: `resolvePlatformIdentity` returns `null` when either is absent, the worker answers `503 seal-not-configured`, and `POST /api/v1/documents/seal` surfaces that as a `503`. No redeploy is needed once the secrets are set — the next request picks them up. So a deploy is never blocked on provisioning, and an unprovisioned seal never fabricates a signature.

### Provisioning the platform identity

1. **Generate the identity.** From a clean checkout, on a machine you trust:

   ```sh
   pnpm run platform-seal-certificate -- --out ./platform-seal --country US
   ```

   This mints an RSA-3072 signing key and a self-signed X.509 v3 certificate valid for ten years (`--years`, `--modulus`, `--common-name`, `--organization` all override). It writes `PLATFORM_SEAL_KEY.base64` (mode `0600`), `PLATFORM_SEAL_CERT.base64`, and `platform-seal-certificate.pem`, and prints the certificate's SHA-256 fingerprint. The private key is written to a file and **never printed**, so it does not pass through a shell argument, scrollback, or a chat transcript.

2. **Load the two secrets into the sign worker**, piping the files so the values never reach shell history:

   ```sh
   wrangler secret put PLATFORM_SEAL_KEY  --name magna-carta-sign < ./platform-seal/PLATFORM_SEAL_KEY.base64
   wrangler secret put PLATFORM_SEAL_CERT --name magna-carta-sign < ./platform-seal/PLATFORM_SEAL_CERT.base64
   ```

3. **Record the fingerprint, then destroy the local copy.** Keep `platform-seal-certificate.pem` and the printed fingerprint in the account-of-record store (§7); delete the whole `./platform-seal` directory. The sign worker is the only place the private key should exist — it re-imports the PKCS#8 bytes as a **non-extractable** `CryptoKey` that can sign and nothing else.

4. **Verify.** `wrangler secret list --name magna-carta-sign` shows both names. An authenticated `POST /api/v1/documents/seal` that returned `503` before provisioning returns a sealed document after it, with no redeploy in between.

### The trust posture — self-signed is the design, not a shortcut

The seal is **tamper-evidence, not identity attestation**. ESIGN/UETA validate an electronic signature on intent, consent, association, and attribution — none of which require a publicly-chained certificate; the legal weight lives in the Certificate of Completion assembled from the server-observed audit trail, and the seal's job is to make the completed record demonstrably unaltered. A PDF validator will therefore report the signature as cryptographically intact but the signer as **untrusted** until the certificate is distributed as a trust anchor — which is why the fingerprint is published alongside it. Buying a publicly-trusted document-signing certificate would change only the trust-chain UI in a viewer, not the legal footing.

**What a public CA would buy, and when to revisit.** Adobe's AATL/CDS programs are what make a viewer show a green check without a manually installed anchor. Revisit if clients or courts begin rejecting documents on the viewer's trust banner alone, or when the timestamp/LTV levels (PAdES B-T and above, which need a TSA) land — those two decisions are naturally taken together.

**Rotation.** Generate a new identity and overwrite both secrets; documents sealed under the old certificate stay verifiable against the old certificate, which is why the PEM and fingerprint of every identity are retained rather than discarded on rotation. Without a timestamp authority, a signature cannot be proven to predate the certificate's expiry, so keep the validity window long and rotate deliberately.

## 17. AI Gateway configuration — what must stay off, and why the dashboard shows nothing

One gateway per environment (`magna-carta-inference`), reached only through the account's authenticated `AI` binding. Everything the code controls is pinned per request in one function (`packages/inference/src/gateway.ts`): caching off, log collection off, firm metadata derived server-side. Three dashboard settings are **not** reachable from code and are therefore this runbook's responsibility.

**Guardrails must remain DISABLED on this gateway, permanently.** They intercept and evaluate both prompts and responses and produce logs of user prompts and model responses. On a gateway carrying privileged client content that is a retention surface created by a settings toggle, entirely outside the code that makes the confidentiality posture fail closed — and it buys nothing here: guardrails moderate for harmful content, while a legal assistant's failure mode is being confidently wrong, which no hazard-category classifier detects. No fitness function can prevent a dashboard toggle, so this is the control.

**Log collection stays off.** The binding's logging toggle is all-or-nothing — there is no payload-only option on the binding path — so it is pinned off in code on every request, and the gateway-level setting must not contradict it. The metadata-only middle ground (`cf-aig-collect-log-payload: false`) is a `cf-aig-*` request header the binding does not read; adopting it would mean moving off the binding onto the REST surface and re-deriving the whole authenticated-gateway posture for one convenience.

**Caching stays off**, and no cache key is ever set. Under shared account credentials the default cache key carries no firm dimension, so a byte-identical prompt from two firms could collide.

**The consequence, stated plainly so it is not discovered later: the AI Gateway dashboard will show nothing for this traffic.** No logs, therefore no per-request analytics, no cost graph, and no request inspector. That is by design, and everything the firm or the platform needs about model spend comes from the in-repo record instead — the per-run token meter and, for the assistant, the per-turn provenance columns. The account-level spend rule and credit alarm still operate; they are not log-derived.

### 17.1 The same gateway carries AI Search's own model calls — and our per-request pins do not reach them

Natural-language document search runs on Cloudflare AI Search, which makes its **own** embedding and reranking calls to Workers AI while indexing and while answering a query. Those calls go through the same gateway, and they are **not** made by our code.

**That is the whole point of this subsection: the per-request options `packages/inference/src/gateway.ts` pins on every call we make — caching off, log collection off — travel on OUR requests and do not reach AI Search's.** The only control over them is the gateway's own configuration, which means the posture above is not merely a belt-and-braces duplicate of the code for this traffic; for AI Search it is the entire mechanism.

Four settings, all of which must be **off**, verified on the gateway rather than assumed:

- **Log collection — off.** AI Search embeds the member's typed question, which is a member's question about a client matter and is privileged content. A gateway log of it is a retention surface with no code path that can close it.
- **Guardrails — off.** They log prompts and responses, for the same reason as above, and moderate for a hazard class that has nothing to do with this feature's failure mode.
- **Caching — off.** Cloudflare's own documentation warns that gateway caching corrupts embeddings. Beyond that, the default cache key carries no firm dimension under shared account credentials.
- **Rate limiting — off.** It interrupts indexing rather than shedding load gracefully, and a half-indexed corpus is a search that silently omits documents.

**Verify these before turning the feature on for any firm, and re-verify after any gateway change.** There is no fitness function that can see a dashboard toggle, and unlike the assistant, there is no per-request pin standing behind it.

**Bindings.** The two AI Search bindings are declared and **commented out** in `apps/api-worker/wrangler.jsonc`. Uncommenting `ai_search_namespaces` is not a configuration step but a decision: the first instance it creates fixes an embedding model that cannot be changed afterwards without re-embedding every firm's corpus, and the platform's embedding pin still reads open (`pinState` in `packages/inference/src/catalog.ts`). Freeze that pin first. While both bindings are absent, the resolvers in `apps/api-worker/src/search/natural-language-binding.ts` return ports that report the feature unavailable — a provisioning job records a failure rather than a control-plane row claiming an instance that does not exist, and a query reports `instance-not-provisioned` rather than an empty result.

**Queues.** The conversational assistant declares `…-magnus` and `…-magnus-deadletter`; create both before deploying (the §3 note applies — a missing queue aborts the deploy).

**Turning the assistant on is three deliberate acts, in this order.** Nothing here happens by deploying the code: the shipped default reaches no provider at all.

1. Set the Worker variable `MAGNUS_INFERENCE_ADAPTER=gateway`. Absent — or any other value — resolves to the deterministic stub, which reaches no provider and returns obviously-fake answers.
2. Open the firm's general AI-processing setting (`inference.aiProcessingEligibility`). Default closed.
3. Open the firm's assistant setting (`magnus.enabled`). Default closed.

Step 1 is a platform decision and steps 2 and 3 are each firm's own. All three must be true before a single byte of a member's message leaves the platform, and the queue consumer re-reads steps 2 and 3 before every model call, so closing either one stops work already in flight.

## 18. Container subsystems → dedicated Workers (the extraction rubric)

Every other section in this runbook activates something. This one **decides** something — whether a subsystem gets a Worker of its own at all — and it lives here because the question arrives mid-slice, where re-deriving it is most expensive. The decision of record is **ADR-0167**; what follows is its living form, and a spec, a review, or a `wrangler.jsonc` comment should cite this path rather than the ADR (golden rule 13 — code cites files, not process records).

**The short form.** A subsystem earns its own Worker when its work runs on a heavy native runtime inside a Cloudflare Container **and** only the stateless half of it crosses the boundary. The coordination that holds firm state stays with the app Worker (`magna-carta`), behind the firm-scoped data-access layer.

**How this sits with "one deployable, one origin" (ADR-0069).** The fleet has grown well past one deployable, and that is not drift: what ADR-0069 fixed and what still holds is **one public origin** the browser talks to. Every Worker below is internal — no `workers.dev` URL, no route, reachable only over a service binding from the app Worker — so extraction adds deployables without adding origins. The two deliberate exceptions carry their own reasoning: `magna-carta-edit` serves the editor iframe from a cookieless content domain, and `magna-carta-status` serves the public status page.

### The five properties

A subsystem extracts when it scores high on ① through ④ **and** clears ⑤. The first four are a judgement; the fifth is a gate, and a subsystem that fails it does not get waived through — it gets a spec.

- **① Heavy native / Container runtime.** The work runs in a Dockerfile-built Container Durable Object, not in a Worker isolate. A WASM engine that fits the isolate's CPU and bundle budget is not a candidate — it stays in-process, and placement between the two is a routing decision the [engine-host seam](engine-host-seam.md) already models.
- **② Independent deploy cadence.** Its image rebuilds on a schedule decoupled from app deploys — a signature refresh, a security-patch cadence for a large native suite, a model bump. If the subsystem only ever redeploys when the app does, ② scores nothing.
- **③ Distinct scaling profile.** It wants its own `max_instances` and `instance_type`, and it must not contend with, or starve, request handling. State ③ as a sentence about contention, not as a preference: the discovery engine saturates CPU for hours during a bulk load while the search container's whole premise is staying warm for sub-second queries, so one Worker holding both would let a load make review search slow.
- **④ Containment / blast radius.** It processes untrusted bytes and wants `enableInternet = false`, no public surface, and reachability only over a service binding. This is the property that binds — not the literal absence of a route. `magna-carta-edit` is browser-facing by design and still satisfies ④, because its containment comes from a cookieless content domain plus no egress, not from being unreachable.
- **⑤ Stateless compute — the seam test.** The work that moves across the boundary holds **no firm state**. This is the decisive property: it is what let scanning split cleanly on the first try, and it is where candidates differ.

### The compute-vs-coordination seam

Only stateless compute crosses. The firm-state-bearing coordination stays in the app Worker, behind the data-access layer (ADR-0003) and the route chokepoint (ADR-0067). Editing is the clearest worked case: the **coolwsd container compute** extracted, and the `DocumentSession` Durable Object — participants, the WOPI lock, working-object metadata — did not, because it is coordination coupled to document and file logic rather than stateless compute. Conversion split the same way: the heavy engine bodies moved behind the existing `ConversionPort`, while the `ConversionJob` Durable Object, the `CONVERSION` queue, and the pure-TypeScript registry/pathfinding/placement logic stayed. Relocating a coordinator buys no isolation and adds a network hop to every state mutation.

> **Asked and settled, twice — so it is written down here rather than left to be re-derived.** Splitting the app Worker's API surface from its background orchestration was proposed and declined on 2026-08-21. Two of the original arguments against it do not survive scrutiny and should not be reused: cross-script Durable Object bindings work (`script_name` on a `durable_objects` binding), and service bindings are documented as adding no latency and no cost, so the extra hop is free. What decides it is this: seven of the ten job-coordinator Durable Objects are addressed from routes as well as from consumers — the poll and WebSocket-subscribe endpoints ARE routes talking to coordinators — so a split does not divide the binding surface, it makes both Workers bind nearly all of it. Add that `runInDurableObject` only works on classes defined in the main Worker (26 test files use it), and the coordination stays app-side.

### Failing ⑤ — durable per-firm state is a different design

A subsystem whose state **is** a durable per-firm dataset fails ⑤, and the answer is not "extract it anyway." Full-text search is the worked case: it scored ① through ④ easily and still failed the gate, because a Tantivy index is firm data, not stateless compute, and extracting it raises index storage, per-tenant isolation, and rebuild questions this rubric does not answer. It got a spec instead (ADR-0207, `docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`).

The outcome is worth reading closely, because it is easy to mistake for a counter-example. Search **does** run in a dedicated Worker today, built to the same template — but only after the design moved the state out of the container: splits live under a per-firm prefix in that firm's own R2, the split catalog lives in that firm's `FirmDatabase` Durable Object, and the container reaches its splits through outbound interception into the app Worker's token-guarded object host, holding no bucket credential of its own. The container therefore clears ⑤ after all. The rubric was not bent; a design was done that made the seam true.

### The template — the deploy-time half

The **in-repo shape** of a container Worker and its Container class — `defaultPort`, `sleepAfter`, `enableInternet`, `pingEndpoint`, the forward proxy, and the rule that the app Worker holds only the binding and never a `getContainer` call of its own — belongs to [`engine-host-seam.md`](engine-host-seam.md), along with the repo-root build context and `.dockerignore` placement its images need. It is not restated here. What this runbook owns is the deploy-time half:

- **No public surface.** `workers_dev: false` and `preview_urls: false`, reached only by a service binding from `magna-carta`. `magna-carta-edit` is the one deliberate exception (see ④ above).
- **Deploy order is a real constraint.** Cloudflare rejects a deploy whose service binding names a Worker that does not exist, so every named target must exist before the app Worker deploys — §14 for the standing placeholders, §16 for the ordering rule the seal Worker introduced. If the app Worker must ship first, stand up a 503 placeholder under the final name; the real Worker overwrites it and adds its Durable Object migration cleanly.
- **Its own Durable Object migration lineage.** The Container class is introduced by a `new_sqlite_classes` migration tag on that Worker, and the tag chain is append-only.
- **Its own crons, for at most two distinct jobs.** A `*/20` warm-poke keeps one instance and its resident state hot; a daily rebuild trigger refreshes an image that bakes perishable data (scan's `0 7 * * *` POSTs its own Workers Builds deploy hook — §11). Both are optional, and **a warm-poke stays off until traffic justifies it**: `magna-carta-scan` and `magna-carta-search` both have theirs commented out today, because pinning a `standard-1` resident bills its 4 GiB continuously for no benefit while no firm is onboarded. Re-enabling is one line, and the handler stays wired so it is never a code change.
- **Its own Workers Builds project, scoped by inclusion** (§12) — path filters narrow enough that an interface change does not rebuild a container image.
- **Its own cost line.** A warm instance is a standing monthly charge, recorded in [`../operating-costs.md`](../operating-costs.md), not discovered on an invoice.

### What has cleared the rubric — the reasoning, not a roster

The table below records **why** each Worker was extracted, which is a decision and belongs here. It is
not a statement about what exists on the account today; for that, list the scripts (top of this file).
A Worker named here that the account does not carry is a design intent that has not shipped, not a
discrepancy.

| Worker                    | Container(s) it owns                                  | Why it cleared                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `magna-carta-scan`        | `ScanContainer` (clamd + yara-x + a Rust service)     | The founding case. ② a daily image rebuild bakes current ClamAV signatures and YARA Forge rules; ③ sharded across Durable Object ids at `standard-1`; ④ untrusted bytes, no egress; ⑤ a verdict crosses back, nothing else.                                                                                                                          |
| `magna-carta-convert`     | `RasterEngineContainer`, `LibreOfficeEngineContainer` | The allowed grouping: two engines in one Worker because they share one pipeline and one cadence. Their differing `instance_type`s (`standard-1` / `standard-2`) show ③ operating within a Worker as well as between.                                                                                                                                 |
| `magna-carta-ocr`         | `OcrEngineContainer`                                  | ① a native recognition runtime with its models baked into the image, so ④ costs nothing — there is no runtime fetch to allow.                                                                                                                                                                                                                        |
| `magna-carta-edit`        | `DocumentEditorContainer` (Collabora coolwsd)         | ② the security-patch cadence of a large C++ suite; ④ one isolated instance per open document, no egress, WOPI callbacks reaching the app Worker by outbound interception rather than the network. The `DocumentSession` Durable Object stayed behind.                                                                                                |
| `magna-carta-bundle`      | `BundleContainer` (a Rust archive builder)            | ③ long CPU-bound archive builds that must not contend with request handling; ④ its R2 access is an outbound handler, not egress. The `BundleBuildCoordinator` Durable Object stayed behind.                                                                                                                                                          |
| `magna-carta-file-repair` | `FileRepairEngineContainer`                           | ① a pure-Rust repair engine on damaged files — ④ in its purest form: the bytes are both untrusted and malformed.                                                                                                                                                                                                                                     |
| `magna-carta-recovery`    | `RecoveryEngineContainer`                             | ③ a deliberately CPU-saturating workload; ⑤ trivially clear, since only a hash shard crosses the boundary and no file bytes ever transit.                                                                                                                                                                                                            |
| `magna-carta-discovery`   | `DiscoveryEngineContainer`                            | ③ stated as contention, not preference: extraction saturates CPU for hours during a bulk load while search must stay warm for sub-second queries. The `DiscoveryLoadCoordinator` stayed behind, holding the load cursor.                                                                                                                             |
| `magna-carta-search`      | `SearchIndexContainer`                                | The exception above: it failed ⑤ as first posed, got a stateful-service design, and reaches this shape only because the index state now lives in the firm's own R2 and Durable Object rather than in the container.                                                                                                                                  |
| `magna-carta-address`     | `AddressIndexContainer`, `AddressBuildContainer`      | ③ a monthly build that needs a `standard-4` for an hour beside a query engine that needs a `basic` while anyone types; ⑤ the state is public reference data in one platform bucket, so — unlike search — the worker binds that bucket itself (§20). Its daily `17 7 * * *` cron starts a build only when the index is missing or older than 30 days. |

**Workers that exist for other reasons, and did not come through this rubric.** Naming them keeps the fleet from reading as though every Worker is an extraction. `magna-carta-sign` owns no container at all — it exists so the platform signing key lives in exactly one Worker, unreachable from the app Worker, the browser, and every firm-scoped code path (§16); that is a containment argument the rubric's ① does not score. `magna-carta-email` is an Email Routing entrypoint, reached by inbound mail rather than a service binding (§2a). `magna-carta-status` is the public status page. `magna-carta-web` serves the built interface, with one script that guards `/_app/` and no bindings beyond its own files.

**What deliberately did not extract.** Every coordination Durable Object in the app Worker fails ⑤ by construction and stays: `DocumentSession`, `ConversionJob`, `BundleBuildCoordinator`, `RecoveryJobCoordinator`, `SearchIndexJob`, `SearchCompactionJob`, `DiscoveryLoadCoordinator`, `DocumentAssemblyJob`, `MagnusConversation`, `LiveTimerDurableObject`, and `FirmDatabase` — which is the clearest case of all, being the firm's data plane itself. So do the light in-Worker WASM engines: the conversion registry models "in-Worker WASM" and "container native" as two engines in one graph, so a small raster staying in-process is a routing outcome, not an exemption from the rubric.

**One caveat named for whoever hits it first.** A _pluggable_ engine that needs outbound network — a cloud OCR or conversion engine a firm supplies — cannot share the `enableInternet = false` containment every Worker above relies on, and needs a policy lane of its own rather than a quiet exception inside one of these.

## 19. Address autocomplete — switching it on (Smarty)

The street box of every address form can offer real addresses as it is typed into. It ships **off**: with no Smarty key pair set, the Worker answers every lookup `unavailable`, and the form behaves exactly as it did before autocomplete existed. Nothing calls out and nothing is billed. The owner authorised an address leaving the tenancy on 2026-09-20; setting the pair is the act that makes it happen, and it starts a per-lookup bill.

**Switching it on**

1. Create a Smarty account under `ops@magnacarta.esq` (credentials into the Bitwarden vault) with **US Address Autocomplete Pro** and **International Address Autocomplete** on the subscription. Autocomplete is priced separately from address verification, so check both are included.
2. In the Smarty dashboard, **API Keys → Secret Keys**: create a pair. It is the _secret_ pair (an `auth-id` and an `auth-token`), not an embedded key: an embedded key exists for calling Smarty straight from a browser, which this design deliberately never does — every lookup goes through the Worker, where it can be rate-limited, counted and kept out of the logs.
3. Set both on `magna-carta-api`: `wrangler secret put SMARTY_AUTH_ID`, then `wrangler secret put SMARTY_AUTH_TOKEN`. Both, or neither: half a pair is treated as none.
4. Open any address form, choose United States, and type the first few characters of a real street. Offers appear after a short pause; choosing one fills the town, state and ZIP code.

Neither name is in `secrets.required` (§3), deliberately — listing them would make every deploy fail until an account nobody has opened exists.

**Watching it**

- `addresses.lookup` in the telemetry dataset, with `operation` (`suggest` / `resolve`), `engine` (`google` / `openaddresses` / `smarty` / `deferred`) and `outcome`. The `suggest` count is what drives the bill. `engine: deferred` on a deployment you believe is switched on means the Worker is not seeing the pair.
- `outcome: failed` beginning to climb is the first sign Smarty is refusing. A spent subscription answers **402**, a revoked key **401**; the form tells the person the lookup did not answer and stops asking until they press Try Again, and the address can always be typed by hand. The status code is not in the metric — check the Smarty dashboard's usage and key pages.
- **The Smarty subscription's own quota is the only hard spending ceiling.** The Worker's rate limit is per isolate, so its effective global bound multiplies with traffic; set the subscription tier to the bill you are prepared to pay.

**What never appears anywhere.** The query is a client's address typed a few characters at a time, so the routes are POSTs (the invocation log records full URLs), no failure carries the query or the request URL (Smarty's credentials ride in its query string), and no metric dimension can hold it. Keep it that way when changing any of this.

**Switching it off.** Delete either secret (`wrangler secret delete SMARTY_AUTH_TOKEN`). The next request answers `unavailable` and every form quietly returns to plain typing; addresses already recorded are untouched, because the firm keeps what it chose.

## 19a. Address autocomplete — Google Places (the trial engine)

The owner asked on 2026-11-13 to try Google's addresses before deciding whether the platform's own index (§20) is needed. With `GOOGLE_PLACES_API_KEY` set, **Google answers every country**, ahead of the platform's index and Smarty; delete the key and the lookups go back to whichever of those is provisioned, with nothing else changed. Adapter: `packages/address-lookup/src/google.ts`.

**Switching it on**

1. In the Google Cloud console (under `ops@magnacarta.esq`, credentials in the Bitwarden vault), create or pick a project, attach a billing account, and enable **Places API (New)**. The older Places API is a different product and is not what the adapter calls.
2. **APIs & Services → Credentials → Create credentials → API key.** Restrict it: **API restrictions** to Places API (New) only. Leave application restrictions at none: the key is used from a Worker, which has no fixed IP address or referrer, and it never reaches a browser.
3. **Set a quota** under Places API (New) → Quotas (requests per day for Autocomplete and for Place Details), and a **budget alert** under Billing. Google has no hard spending cap; the quota is the ceiling.
4. `wrangler secret put GOOGLE_PLACES_API_KEY` on `magna-carta-api`.
5. Open any address form and type the first few characters of a real street. The list shows up to five offers with "Google Maps" under them; choosing one fills the town, region and postal code.

**What it costs.** Two billed calls per address: Autocomplete (New) for each settled pause in typing (the field waits 300 ms and needs three characters), and one Place Details call when an offer is chosen. The field mask (`addressComponents,postalAddress,location`) keeps Place Details in the Essentials tier; adding any other field moves every call to a dearer tier. No session tokens are sent, because a session that ends in an Essentials lookup still bills its first twelve Autocomplete requests. Prices and free monthly caps: [`docs/operating-costs.md`](../operating-costs.md).

**What Google's terms require, and what is still open**

- **Attribution:** the suggestions route answers `attribution: "google-maps"` and the address field shows "Google Maps" under the offers, untranslated. Google asks for its logo where there is room, or the text in Roboto; the field shows the text in the platform's own typeface. Settle this before Google becomes the permanent engine.
- **Storage:** Google's terms let a customer keep a place ID indefinitely and allow no other caching beyond short windows. The address a person chooses is written into a record. The owner accepted that open question for the trial; it is the first thing to settle before keeping Google.
- **No other map:** Places content may not be shown on a non-Google map. Nothing draws a map today.
- **Disclosure:** each pause in typing sends a client's partial address to Google. Nothing of it is logged here: the query is in the request body, the key in a header.

**Switching it off.** `wrangler secret delete GOOGLE_PLACES_API_KEY`. The next request goes to the platform's index or Smarty if either is provisioned, and otherwise answers `unavailable`.

## 20. Address autocomplete — the platform's own index (OpenAddresses)

The United States is answered from an index the platform builds itself, with no per-lookup bill (§19 covers Smarty, which answers every other country). Design: [`docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md`](../specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md). Three parts: `apps/address-worker` (the `magna-carta-address` Worker, reached only by service binding), its two Containers built from `containers/address` (`AddressIndexContainer` answers queries on a `basic` instance; `AddressBuildContainer` builds on a `standard-4`), and the `magna-carta-addresses` R2 bucket the index lives in.

**Switching it on, in this order** — each step needs the one before it:

1. Create the R2 bucket `magna-carta-addresses` (no public access, no CORS; nothing outside the address worker reads it).
2. Connect `apps/address-worker` to Workers Builds the way the other dedicated workers are (§12): production branch `main`, deploy command filtered to `@magna-carta/address-worker`, watch paths covering `apps/address-worker/*`, `containers/address/*` and `crates/*`. The first deploy builds the Container image.
3. Add the binding to the app worker's `wrangler.jsonc` — `{ "binding": "ADDRESS_SERVICE", "service": "magna-carta-address" }` in `services` — in a pull request. A binding to a worker that does not exist fails the app worker's deploy (§14), which is why this is the last step.
4. Wait for the first build. The address worker's daily cron (07:17 UTC) starts one whenever no index exists, so the morning after step 2 the bucket holds `us/current.json`. Until then the US answers `unavailable` and the form is a plain text box, exactly as before. To build sooner, open the `magna-carta-address` Worker's Cron Triggers in the dashboard and trigger it by hand.

**Watching it**

- `addresses.lookup` with `engine: openaddresses`. `outcome: unavailable` on that engine means the worker is bound but no index has been published yet.
- The build bills for about three hours of `standard-4`, not one: the build instance sleeps three hours after the request that started it (`sleepAfter` in `apps/address-worker/src/address-build-container.ts`), and memory and disk bill for every awake second, CPU only while busy.
- The build: the address worker's logs carry the cron's decision (missing, fresh, stale, running) and the build Container's state. A build takes about an hour. A failed build leaves the previous index answering — nothing user-facing breaks — and the next day's cron tries again once the index is more than 30 days old.
- The bucket: `us/current.json` names the live build; two builds are kept, so about 20–24 GB at steady state. `us/<build>/attribution.json` lists every source the build used.

**The licence register.** Which OpenAddresses layers are excluded, and why, is `LICENCE_EXCLUSIONS` in `containers/address/src/build_job.rs`, with the reason beside each entry; the rule is in the spec under _Data_. Changing it is a code change that takes effect at the next build. The source list the build reads carries no licence, so the register goes stale as OpenAddresses adds layers: re-read it every few months against the `license` block of each address layer under `sources/us/` in the openaddresses/openaddresses repository, and add any layer recorded as share-alike (`"share-alike": true`), non-commercial, or under a bespoke agreement. Last re-read 2026-11-13.

**What never appears anywhere.** As in §19: the query is a client's address. The Containers log no query text and no address, their error bodies carry engine vocabulary only, and the routes stay POSTs.

**Switching it off.** Remove the `ADDRESS_SERVICE` binding from the app worker. US lookups then go to Smarty if its pair is set, and to nothing otherwise. The worker, bucket and index can stay; with no queries the Containers sleep and bill nothing, and the cron keeps the index fresh for the day the binding returns. To stop the monthly build as well, remove the cron trigger from `apps/address-worker/wrangler.jsonc`.

## 21. Caller ID lookup — switching it on (Telnyx)

The call record's number field says who a typed number belongs to. The Directory match and the area code's region are free and always on. The **Look Up Caller ID** button is a paid Telnyx Number Lookup, and it ships **off**: with no `TELNYX_API_KEY`, the Worker answers the paid operation `unavailable`, no button is shown, and nothing calls out.

**Switching it on**

1. Create a Telnyx account under `ops@magnacarta.esq` (credentials into the Bitwarden vault) and add a balance. Number Lookup refuses to run on a negative balance, and only the organization owner may use it.
2. **Mission Control → API Keys**: create a key.
3. Set it on `magna-carta-api`: `wrangler secret put TELNYX_API_KEY`.
4. Open **Messaging → New Message**, type a whole US number, and press **Look Up Caller ID**. The caller ID line replaces the button; typing the same number again shows it without the button.

The name is not in `secrets.required` (§3), deliberately, for the same reason as the Smarty pair.

**Watching it**

- `communications.caller_lookup` in the telemetry dataset, with `engine` (`telnyx` / `deferred`) and `outcome` (`found` / `cached` / `not-covered` / `unavailable` / `failed`). Each `found` is a billed query (caller name plus carrier); `cached` cost nothing.
- `outcome: failed` climbing means Telnyx is refusing — usually a revoked key or an empty balance. The person is told the lookup did not answer and nothing is kept, so their next press asks again.
- **The Telnyx balance is the only hard spending ceiling.** Keep it at the amount you are prepared to spend; the Worker's rate limit is per isolate.

**What never appears anywhere.** The number is a client's: the routes are POSTs (the invocation log records full URLs), the audit row records only that a lookup was paid for, and no metric dimension can hold the number or the name.

**Switching it off.** `wrangler secret delete TELNYX_API_KEY`. The button disappears on the next read; answers already kept stay visible, because the firm paid for them.

## 22. Turning meeting recording on (recording, transcripts, summaries, live captions)

The code is deployed switched off. Nothing records until every step below is done, and until then the
start route answers `503 meeting-recording-not-configured` and no Record control is offered
(`recordingDeploymentConfigured` in `apps/api-worker/src/http/routes/communications/meetings.ts`
reads all of it). Do them in this order:

1. **Create the queue and its dead-letter queue.** `wrangler queues create magna-carta-production-meeting-recording-compose`
   and `wrangler queues create magna-carta-production-meeting-recording-compose-deadletter`. One queue
   carries all three kinds of work: composing a stopped recording into one file, transcribing it, and
   summarizing the transcript.
2. **Bind the queue, in a change of its own.** Add `MEETING_RECORDING_COMPOSE` to `queues.producers` in
   `apps/api-worker/wrangler.jsonc`, and a consumer for the same queue with `max_batch_size: 1`,
   `max_concurrency: 10` and the dead-letter queue above. It is not bound today because a deploy that
   binds a queue the account does not have fails, and a merge to `main` deploys; the comment where the
   producer goes says so.
3. **Prove the sink against the live Realtime application.** Confirm the routing service's WebSocket
   adapter dials `/internal/meeting-audio/<token>` with the path intact (the token rides the path, never
   a query string), and that the audio envelope's field numbers are 1, 2 and 5 as
   `packages/meetings/src/pcm-frame.ts` reads them.
4. **Route `/internal/*` to the app Worker.** `run_worker_first` already lists it; add the zone route if
   the hostname's routes do not reach it (section 12, _Which address does a Worker answer on_).
5. **Set the sink signing key.** `wrangler secret put MEETING_SINK_SIGNING_KEY` with a fresh random
   value. It signs the token the routing service presents when it dials the recorder.
6. **A firm switches it on.** Its Owner or Admin turns recording (and, separately, summaries and
   captions) on under Settings › Practice › Meetings. Summaries also need the firm's AI processing
   switched on.

## 23. Secrets Store — the account's one home for the platform's secrets

Cloudflare Secrets Store (open beta) keeps secrets at the account level and binds them into any
Worker; a per-Worker secret (§3) lives on one Worker only. Every Worker that reads a secret accepts
it from either place: `packages/worker-secrets` resolves a store binding named
`SECRETS_STORE_<NAME>` into the plain `<NAME>` string at the Worker's entry and falls back to the
per-Worker secret. With no store binding the code behaves exactly as before. Limits that matter
here: 100 secrets per account, one store per account, a value of at most 65,536 bytes, and a value
that cannot be viewed again once saved
([Secrets Store docs](https://developers.cloudflare.com/secrets-store/)).

**Keep a master copy of every value in the owner's password manager.** The store will not show a
value back, and `ROOT_KEK` in particular is unrecoverable if lost (§3).

### Which secret is read where

The list each Worker looks for is in code: `API_WORKER_SECRET_NAMES` in
`apps/api-worker/src/stored-secrets.ts`, `COMMUNITY_WORKER_SECRET_NAMES` in
`apps/community-worker/src/bindings.ts`, and the names passed to `resolveStoredSecrets` in
`apps/sign-worker/src/index.ts`, `apps/bundle-worker/src/index.ts` and
`apps/scan-worker/src/index.ts`. Of those, only `COMMUNITY_HANDOFF_SECRET` is read by two Workers
(`magna-carta` and `magna-carta-community`); every other secret belongs to one. Which ones are set in
the account is live state: the System Status page reports each as present or absent.

### Moving a secret into the store

The order matters, because a binding added in the dashboard does not survive the next deploy (a
deploy replaces the Worker's bindings with the ones in its `wrangler.jsonc`) and two bindings cannot
share a name.

1. **Once per account:** give the Workers Builds API token **Account · Secrets Store · Edit** (My
   Profile → API Tokens; each Worker's Settings → Build names its token). A deploy whose
   `wrangler.jsonc` carries a store binding fails with an authorization error without it, and the
   default build token does not carry it
   ([Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)).
2. **Create the secret in the store** (Secrets Store → Create secret, scope _Workers_), named exactly
   as the code names it (`AUTH_SECRET`, not a new name), with the same value the Worker has today.
3. **Commit the binding** in each Worker's `wrangler.jsonc` that reads it, under
   `secrets_store_secrets`: `{ "binding": "SECRETS_STORE_<NAME>", "store_id": "<the store's id>",
   "secret_name": "<NAME>" }`. The store id is not a secret. Merging deploys it; the per-Worker copy
   is still there, so nothing is ever without its value.
4. **Check the System Status page** reports the secret as coming from the Secrets Store.
5. **Delete the per-Worker copy** (the Worker → Settings → Variables and Secrets). For a name in
   `secrets.required` (§3), first remove it from that list in the same kind of change as step 3, or
   the next deploy refuses to run for want of a secret that now lives in the store.

**Rotating** a stored secret is one edit in the store; every Worker bound to it reads the new value
within five minutes, because each isolate keeps a value that long (`packages/worker-secrets`).
`packages/worker-secrets/*` also belongs in the Build Watch Paths of every dedicated Worker that
imports it (§12), so a change to the resolver rebuilds them.
