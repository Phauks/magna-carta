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

`wrangler.jsonc` lists `secrets.required: ["AUTH_SECRET", "PLATFORM_ADMIN_KEY"]`, so a deploy **fails loudly** with a missing-secret list rather than letting auth routes 500 at runtime. Set them once per environment:

1. Dashboard → the Worker → **Settings → Variables and Secrets**, or `wrangler secret put AUTH_SECRET` / `wrangler secret put PLATFORM_ADMIN_KEY`.
2. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are **optional** deploy-time secrets for the REST `FirmResourceProvider`; absent them, the dev pool-claiming adapter runs. Secrets posture detail lives in [`security.md`](security.md).

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

## 7. Bulk-ingest queue + weekly re-scan cron (slice 2·1 Plan 1)

Two Cloudflare Queues and one new cron trigger added in slice 2·1 Plan 1 must be present before deploying.

**Queues (wrangler does not auto-create them — create once per environment):**

1. **Primary queue:** `magna-carta-production-files-ingest-bulk` — a separate, lower-concurrency bulk lane so a large import cannot starve interactive uploads (background ingests). Create via the Cloudflare dashboard (**Workers & Pages → Queues → Create queue**) or `wrangler queues create magna-carta-production-files-ingest-bulk`.
2. **Dead-letter queue:** `magna-carta-production-files-ingest-bulk-deadletter` — receives messages the bulk consumer fails to process after all retries. Create it the same way, then configure it as the dead-letter destination on the primary queue.

The interactive-lane queue (`files-ingest`) and its dead-letter already exist from slice 1·1. The two new queues above are additional; the Worker `wrangler.jsonc` binds them, but Wrangler will error on deploy if they do not yet exist in the account.

**Cron trigger:** `0 4 * * 0` (Sundays at 04:00 UTC) — the weekly re-scan sweep re-queues `unscanned` versions for re-inspection when a new scan engine becomes available. The cron is declared in `wrangler.jsonc`; it activates automatically on the next deploy. No manual dashboard step is required beyond verifying the trigger appears under the Worker's **Triggers** tab after deploy.

## 8. Async bulk-download build queue + `bundles/` lifecycle rule (slice 2·1 Plan 3)

Past the live-download threshold, a bulk ZIP is built in the background as an R2 artifact instead of streamed inline. The build needs a queue, and the artifacts need a TTL so they do not accumulate.

**Queue (wrangler does not auto-create it — create once per environment):**

1. **Primary queue:** `magna-carta-production-bundle-build` — carries one content-addressed selection per message to the build consumer (R2 object bodies streamed through `client-zip` into one R2 object). Create via the dashboard (**Workers & Pages → Queues → Create queue**) or `wrangler queues create magna-carta-production-bundle-build`.
2. **Dead-letter queue:** `magna-carta-production-bundle-build-deadletter` — receives a build the consumer fails after all retries. Create it the same way, then set it as the dead-letter destination on the primary queue.

The Worker `wrangler.jsonc` binds both; Wrangler errors on deploy if they do not yet exist.

**R2 lifecycle rule (account configuration, not code — like the Logpush retention in section 1):** add an **object-expiration lifecycle rule on the `bundles/` prefix** of each firm's bucket (suggested **~7-day** expiration). The artifacts are a regenerable cache — content-addressed by manifest hash, rebuilt on demand — so expiring them only forces a rebuild on a later identical request. Configure under **R2 → the bucket → Settings → Object lifecycle rules**, prefix `bundles/`, delete after 7 days. The signed-download URL TTL is **independent and short** (300 s, minted fresh on each poll); the lifecycle rule governs only the stored object.

**Durable Object:** the build is coordinated by `BundleBuildCoordinator` — the codebase's **first Durable Object** — declared in `wrangler.jsonc` (`durable_objects` binding + the `v1` `new_sqlite_classes` migration) and exported from `src/index.ts`. It activates automatically on deploy; no dashboard step. A second DO class (e.g. Plan 2's scan container) appends to the same `durable_objects` list and either the same or a new `migrations` tag.

**Cost:** near-zero marginal — Queues + DO invocations + R2 PUT/GET on a regenerable, TTL-expired artifact; no always-on compute. The Container escalation for outlier-large bundles is a named seam, not built here.

## 9. Malware-scan Container — deploy-time activation + signature refresh (slice 2·1 Plan 2)

The scan engine is a `linux/amd64` Container (`containers/scan/`): a long-lived clamd daemon plus a Rust HTTP service that fans each file to clamd (signatures), yara-x (heuristic rules), and structural heuristics (PDF/Office/archive). It is **built and unit-tested, but not wired into the running Worker** — the code seam `resolveScanPort` selects it only when its binding is present, and that binding is **deliberately absent everywhere until this deploy step**, because a Container cannot run under the local worker test pool (`@cloudflare/vitest-pool-workers` does not support container bindings — workers-sdk#10408). Until activation, every firm runs the engine-less adapter (an honest `unscanned`/no-engine, never a false `clean`).

**Activation (one deploy-time edit + a build):**

1. Add the three wrangler blocks to `apps/worker/wrangler.jsonc` (kept out until now so the test pool needs no Docker):
   - `"containers": [{ "class_name": "ScanContainer", "image": "../../containers/scan/Dockerfile", "max_instances": 5, "instance_type": "standard-1" }]` — `standard-1` (4 GiB) is the floor: clamd loads a ~1–2 GiB signature DB into RAM. **`entrypoint.sh` raises clamd's `StreamMaxLength`/`MaxScanSize`/`MaxFileSize` to 2048M so clamd scans the whole 2 GiB inspectable cap** — its stock limits (`StreamMaxLength` 25M, `MaxScanSize`/`MaxFileSize` 100M) would refuse anything larger over INSTREAM and degrade it to a retryable engine fault. A scan near the cap holds the full body in the Rust service **and** clamd's own copy atop the resident DB, so for reliable full-size (≈2 GiB) scanning, raise `instance_type` above `standard-1` or lower `fileManager.inspectableSizeCapBytes` — the clamd limits and the inspectable cap must stay aligned.
   - append `{ "name": "SCAN_CONTAINER", "class_name": "ScanContainer" }` to `durable_objects.bindings` (alongside `BUNDLE_COORDINATOR`).
   - append a **new** migration tag `{ "tag": "v2", "new_sqlite_classes": ["ScanContainer"] }` (never edit the shipped `v1`; a Container class is SQLite-backed).
2. `wrangler deploy` builds the image (freshclam bakes the initial signature DB at **build** time — the container runs with `enableInternet = false`, so it has **no runtime egress** to fetch signatures) and pushes it. The `*/20` warm-poke cron then keeps one instance — and clamd's resident DB — alive.

**Engine-fault handling:** a clamd fault with no other signal returns **503**, so the ingest consumer retries the message — a running container always booted with clamd ready (the entrypoint fails fast otherwise), so this is exceptional, not a steady state. A persistent fault dead-letters to `magna-carta-production-files-ingest-deadletter`, leaving the file pending (never a usable-but-unscanned object) as a loud ops signal. The Container never commits a file as `unscanned`/no-engine; that honest verdict belongs only to the engine-less launch adapter that runs before this activation.

**Signature refresh:** because there is no runtime egress, a signature update is an **image rebuild** (re-run `wrangler deploy`, which re-runs `freshclam` in the build). A scheduled signed-update job is a documented seam, not built. clamd listens on **loopback TCP `127.0.0.1:3310`** (not a Unix socket — the cross-platform client transport; loopback only, still no egress).

**Acceptance gate:** `containers/scan/tests/eicar_e2e.sh` (and the `scan-container` CI job) build the image and assert EICAR → `infected` end to end. This is the engine's proof — it runs in CI (Docker), not under the local worker pool.

**Cost:** ~$35–50/mo at MVP scale for one warm `standard-1` instance (the warm-poke keeps it from cold-starting the ~1–2 GiB DB); scales with concurrent scan volume up to `max_instances`. Self-hosted — privileged client bytes never leave our compute.
