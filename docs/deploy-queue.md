# Deploy queue — owner actions pending

Production deploys are deliberate (`git push origin main:release`) and are
**never made by the orchestration session**. This document accumulates what is
waiting on the owner: the undeployed merge queue plus the account-side
dashboard steps that no session can perform. Kept current by the
orchestration stream; check `git log release..main` for the live commit delta.

_Last updated: 2026-08-25 — **37 commits undeployed** (`git log release..main`). `main` is green. The ten merges since the last refresh are an API-contract pass and repository hygiene: every list endpoint is now either cursor-paged or recorded with what bounds it, three capped reads stopped cutting their answers silently, and the build register's trend series was repaired and started moving again. **Two of those changed the API contract** (#394, #396) — `openapi.json` and the generated client both moved, and no screen reads the affected endpoints yet, so nothing in the SPA changes with them. **One shipped no change at all** (#392): it verified against `main` that the PDF scrub leaves document JavaScript and open-actions intact, and wrote the analysis behind a question that was already open on the Decision Desk — the posture is a security call and was not taken here. The dashboard-repoint sentence this paragraph once carried is superseded by the 2026-08-27 note below: the owner has done them. The GitHub Actions billing block still gates every merge, not only every deploy._

_2026-08-24 — production turned out newer than this file believed: `release` was pushed to `19d02cf` (#363) on 2026-08-21 and every connected project built green from it. The owner confirmed `magna-carta-ocr` exists (see the tools-catalog entry below), and
clarified the Actions block's real blast radius: deploys ride Cloudflare Workers Builds, which do
not involve GitHub Actions, so a `git push origin main:release` builds and deploys regardless of the
billing block — what the block silences is the gate of record, meaning such a deploy ships on local
verification alone._

_2026-08-24, later — the read-only Cloudflare credentials the queue asked for are in the Claude Code
cloud environment and work: the token verifies active (expires 2026-10-31), and Workers Scripts,
Workers Builds, R2 and Queues all answer reads. This is the first API-verified pass over the queue;
every claim below marked "API-confirmed 2026-08-24" carries that evidence. The headline findings:
**twelve** Workers Builds projects are connected (not the seven `operations.md` §12 records — the
convert, discovery, ocr, sign and web workers are all connected too), every one's production branch
is `release`, every one's build caching is on, and every one's latest build is green from `19d02cf`
(2026-08-21). All thirteen production queue pairs exist, deadletters included. `operations.md` §12's
connection list, its `magna-carta-edit` branch claim, and §14's placeholder roster are stale against
this; the next docs pass owns reconciling them._

_2026-08-27 — the owner fixed the dashboard items that pass raised, and a session re-read the live
configuration to confirm every one: the `magna-carta` deploy command now filters
`@magna-carta/api-worker`, its watch paths again cover `packages/*` and `apps/web/*`, and the
file-repair, recovery and edit inclusion lists are corrected. The next `main:release` push is no
longer blocked on any dashboard step. Still open account-side: the `conversions/` and
`templates/staging/` lifecycle rules, the platform seal secrets, and everything below that never
depended on the token._

## GitHub Actions is blocked account-side — one billing step, and it gates all CI

**Nothing in the repository can fix this and no session can perform it.** Since 2026-08-05 GitHub has
refused to start any billable job for `Phauks/magna-carta`, so the gate of record has not executed a
single step in that time. The diagnosis and its evidence are in
[`operations.md`](conventions/operations.md) under _Quality gates_; this entry is only the step.

**What to click.** GitHub → **Settings** → **Billing and licensing** → **Budgets and alerts** (and the
**Payment information** tab beside it). Check, in this order:

1. **A valid payment method is on file and no recent charge has failed.** A failed payment blocks
   Actions on its own, and settling it is what unblocks it — raising a limit will not.
2. **The Actions spending limit is greater than $0.** The account is on the Free plan, which includes
   2,000 Actions minutes a month for private repositories; `magna-carta` is private, so every gate
   minute is billed against that allotment. Once it is spent, a $0 limit is a hard stop, and GitHub's
   documented behaviour with no valid payment method is that "usage is blocked once you use up your
   quota."
3. **Whether the monthly allotment has simply reset.** The block began 2026-08-05. If the billing
   month has since rolled over and jobs still do not start, the cause is item 1 or 2, not the quota.

**How to confirm it worked**, without guessing: re-run any gate workflow and look at a job's
`runner_id`. A job that GitHub refused to start reports `runner_id: 0` with an empty `runner_name` and
has no logs to fetch; a job that genuinely ran reports a real runner id. That check is the subject of
the recognition rule in `operations.md`, and it is the only way to tell this outage from a red build.

**What it is costing.** Every merge since 2026-08-05 has landed on the strength of local verification
alone. Two specific checks are CI-authoritative and remain unanswered — see the scan-policy item under
_Deferred — operational setup_ in [`ROADMAP.md`](../ROADMAP.md).

A third cost surfaced on 2026-08-25 and is now paid forward rather than accruing: the build register's
trend series (`docs/register-history.json`) advances only when the per-merge assembly workflow runs, so
it sat frozen from 2026-08-17. The two defects that would have kept it frozen even with a working
runner are fixed, and the workflow now names the trunk explicitly — so the first assembly run after
this block clears brings the series current by itself, with no direct push and no step for the owner.

**Do not "fix" this by editing the workflow.** The runner labels in `gate.yml` are correct and were
verified against GitHub's current runner reference; `ubuntu-slim` is generally available. The outage
reproduces identically on `ubuntu-latest`, and predates `ubuntu-slim` entering the repository.

## Tools catalog — what the 2026-08-21 push settled, and what remains

From the audit in [`docs/research/2026-08-15-tools-reality-check.md`](research/2026-08-15-tools-reality-check.md),
which exercised all nineteen catalog tools against a local worker and the real internet. Listed in
the order they were queued. Nothing here duplicates the LibreOffice, search, bundle, sign or
email-capture steps already on this queue.

1. **`magna-carta-ocr` is real — API-confirmed 2026-08-24.** The owner's report now has evidence
   behind it: the worker exists on the account, it is connected to Workers Builds with root
   directory `apps/ocr-worker` and watch paths covering `containers/ocr/*` and the OCR crates, its
   production branch is `release`, its latest build is green (2026-08-21, from `19d02cf`), and the
   deployed script carries the `OCR_ENGINE -> OcrEngineContainer` Durable Object binding — the real
   worker, not a placeholder. Nothing about OCR blocks an app-worker deploy, and nothing here needs
   a dashboard glance any more.

2. **`magna-carta-scan` deployed carrying `/identify` on 2026-08-21.** The deploy this step waited
   on has happened: `release` @ `19d02cf` contains the route (`containers/scan/src/lib.rs`,
   `.route("/identify", post(identify))`) and the scan project's build from that push is green
   (API-confirmed 2026-08-24). What a read-only token cannot do is exercise the two endpoints —
   the **file type verifier** (`POST /api/v1/file-type/verify`) and the **malware scan**
   (`POST /api/v1/scan/diagnose`) — against the live container; if either still answers an error,
   read it with the failure-shape note below in hand rather than assuming the deploy missed.

   **Note the malware scan's failure shape, so nobody reads it as a regression.** With the binding
   declared but the engine unreachable the diagnostic returns a 500 with an Error ID, not the
   `unscanned` verdict its own description promises — `resolveScanPort` selects the engine-less
   adapter on the binding's **absence**, and the binding is never absent once declared. That is the
   documented treatment of a bound-but-faulty engine (a fault, never a fabricated verdict), but it
   means a placeholder or unhealthy scan worker shows up as a server error rather than a graceful
   degradation.

3. **`magna-carta-file-repair` is deployed, and its watch paths are fixed.** The worker built green
   from `19d02cf` on 2026-08-21 and the deployed script carries
   `FILE_REPAIR_ENGINE -> FileRepairEngineContainer` (API-confirmed 2026-08-24). The watch-path
   drift is gone: the owner corrected the inclusion list to `containers/file-repair/*` on
   2026-08-27, and the same pass fixed `magna-carta-recovery` (now includes
   `crates/decryption-core/*`) — both API-confirmed the same day. Nothing here is open any more;
   `operations.md` §12's two-drift note is now historical.

4. **Enable Browser Rendering on the account.** The **safe website viewer** is the only tool in the
   catalog whose dependency is an account entitlement rather than a worker, a container or a secret
   — `env.BROWSER` with `quickAction()` (the current `compatibility_date` already satisfies the
   `>= 2026-03-24` requirement). There is nothing in the repository to deploy for it and nothing
   local can exercise it: Miniflare exposes a `BROWSER` binding whose receiver has no `quickAction`,
   so the route answers 500 in every local run no matter what changes. One fact the API pass adds
   (2026-08-24): the deployed app worker does carry the `BROWSER` binding, so the binding side is
   live; whether the entitlement actually serves `quickAction()` is only answerable by exercising
   the route.

5. **Set `PANGRAM_API_KEY` — last, and only when a firm has asked.** **AI-text detection** refuses
   twice today, both correctly: `422` because the firm's consent setting is off, and `422` again if
   it were on with no key. The consent gate runs before any provider call, so no client text can
   leave the platform on a firm that has not opted in. The secret is worth setting only after a firm
   turns the setting on.

**One thing on this list is NOT a deploy step, and no amount of deploying fixes it.** Shipping cannot
connect a postage account at all — `firmSecretStoreNotYetAvailable` in
`apps/api-worker/src/plugins/secret-store.ts` reports the per-firm credential read as unbuilt, an
absence awaiting the marketplace slice. Connecting a real EasyPost key and deploying everything above
would leave it exactly as it is. Connect, rate-shop, purchase, tracking and refund answer `501
not-implemented` (they returned `500` until 2026-08-15); draft creation still succeeds, because a
draft is the firm's own addresses and parcel and needs no carrier.

## Search engine activation — a new worker, a new container image, one binding

`apps/search-worker` (`magna-carta-search`) and `containers/search` now exist: the
Tantivy engine, its R2 range-read adapter, and the object host it reads through. Nothing
about them is live — `resolveSearchIndexPort` returns the deferred port until the app
worker has a `SEARCH_SERVICE` binding, so every index job still parks in `deferred` and
no query reaches an engine. API-confirmed still open in full (2026-08-24):
`magna-carta-search` is not on the account and the deployed app worker has no
`SEARCH_SERVICE` binding — this whole section stands. (The `SEARCH_INDEX` queue pair
already exists, alongside every other production queue.)

**A new container is its own Workers Build**, and the order matters because each step
depends on the one before it:

1. **Connect `magna-carta-search` to Workers Builds on `release`** and let it build the
   container image (`containers/search/Dockerfile`, build context = repository root).
   It declares the `SEARCH_INDEX` Durable Object binding, migration tag `v1`, and an
   `APP_WORKER` service binding to `magna-carta`. No secret, no queue, no R2 binding —
   the engine holds no credentials by design.
2. **Deploy the app worker**, which mounts the split-object host the engine reads
   through (`/search-objects/*`). This has to be live BEFORE the engine is reachable, or
   the container's first read is forwarded to a worker with no route for it.
3. **Add the `SEARCH_SERVICE` binding** to the app worker's `wrangler.jsonc`, pointing at
   `magna-carta-search`, and deploy again. That single binding is what flips the port
   from deferred to live; there is no code change, and the parked `deferred` jobs drain
   on their next pass.
4. **Arm the warm cron** (`"*/20 * * * *"` in `apps/search-worker/wrangler.jsonc`) once a
   firm actually has `search.indexing_enabled` on. It is off deliberately: with no
   queries, pinning a `standard-1` instance bills its 4 GiB continuously for nothing.

**No R2 lifecycle rule for the split prefix, deliberately.** Splits are a derived cache
and are rebuildable, but they are also the only thing a query reads — expiring them
would silently empty a matter's search. Retirement of superseded splits is already the
compaction sweep's job, on a grace period.

**Nothing here needs a bucket step.** Splits are written into the firm's existing bucket
under the prefix the write pipeline already uses, stamped `object_class: search-split`.

**The same binding activates discovery review sets, and that widens what step 4 turns
on.** A review set is its own corpus now: its splits live under its own prefix in the
same bucket, its catalog rows are the same table keyed by corpus, and its documents park
`deferred` exactly as a matter's do. So the one `SEARCH_SERVICE` binding drains two
backlogs, and on a firm that has loaded a production the discovery one is by far the
larger — a review set at the ceiling is a quarter of a million documents, against a
matter's few thousand files. Turn the warm cron on with that in mind, and expect the
first drain after activation to be a bulk pass rather than a trickle. What a review set
still owes the index is visible before you start:
`GET /api/v1/review-sets/{reviewSetId}/index-status`.

## Split compaction — done: the queues exist and the worker shipped (API-confirmed 2026-08-24)

Both `magna-carta-production-search-compaction` and its deadletter exist, and the app
worker deployed from `19d02cf` (2026-08-21) carries the producer binding, the consumer,
and the `SEARCH_COMPACTION_JOB` Durable Object at migration tag
`v8-search-compaction-job`. Nothing here waits on the owner any more; the two
paragraphs below stay as the record of why the lane is shaped the way it is.

**Why the concurrency is 1, so nobody raises it as an optimization.** A merge reads and
rewrites every byte of its sources. Several at once would multiply the R2 traffic of
background housekeeping against exactly the query traffic compaction exists to reduce.
Per-corpus single-flighting is the coordinator's job; this lane bounds how much merging
the whole worker does at a time.

**What it is worth, measured rather than assumed.** A query over 5,000 per-document
splits issued 186,293 ranged reads — one R2 range GET each in a deployment — against 45
for the same documents merged. That is why this is a deploy-blocking capability for
search rather than a later tuning pass. Figures come from
`crates/search-eval`; how to reproduce them is in that crate's README.

## Discovery processing lane — done end to end (API-confirmed 2026-08-24)

All three steps this section carried have happened. The queue pair exists
(`magna-carta-production-discovery-process` and its deadletter); `magna-carta-discovery`
is on the account with the `DISCOVERY_ENGINE -> DiscoveryEngineContainer` Durable Object
and built green from `19d02cf` (2026-08-21); and the deployed app worker carries the
`DISCOVERY_PROCESS` producer and consumer plus the `DISCOVERY_SERVICE` service binding.
The caveat this section used to close on is also gone: `CONVERT` is bound and the convert
worker's deployed script carries `LibreOfficeEngineContainer`, so a legacy `.doc`, `.xls`
or `.ppt` in a review set reaches an engine rather than parking.

**Why concurrency 4, so nobody raises it as a knob.** Extraction runs in the discovery
Container, which is sized for this burst (`max_instances: 20`) and scales to zero between
loads, so the Container's own ceiling is what bounds throughput. This number bounds how
much of the account's 250-invocation consumer budget one bulk load may take, which is the
whole reason the lane is separate from files ingest in the first place.

## Turnstile activation — the order matters, and the widget comes before the secret

Server-side human verification is built and ships **dormant**
(`apps/api-worker/src/human-verification/`). It gates the two anonymous writes — `POST
/api/v1/registrations` (founding a firm) and `POST /api/v1/invitations/redemptions`. With no secret
set it does nothing to either endpoint except count: one `human_verification.decided` point per
request, outcome `unenforced`. Nothing below is required for the next deploy; the app worker deploys
and behaves identically whether these steps have happened or not.

**Do them in this order. Setting the secret (step 3) before the widget exists (step 1) shuts the
platform's only self-serve front door.**

1. **Build the widget into the joining forms — this is UI work, and it is the prerequisite.** The
   server refuses a request that carries no challenge solution the moment a secret exists. The
   registration screens at `/register` and the redemption screen are live and mint no token today,
   so setting the secret first turns every real signup into a `403`. The client must render a
   Turnstile widget and send its solution in the `X-Human-Verification-Token` request header. The
   sign-in screen's existing Turnstile row is a static placeholder, not a widget — it mints nothing.
2. **Create the widget in the Cloudflare dashboard** — **Turnstile → Add widget**. Free on every
   plan.
   - **Mode: Managed.** Managed is the mode all four merged designs name: it shows a challenge only
     to the small minority of attempts that warrant one, which is what makes the extra row on the
     form honest. Not Invisible (a signup form should be able to show a person why it paused) and
     not Non-Interactive.
   - **Hostnames:** the app origin(s) the joining forms are served from. Not the cookieless
     user-content domain, which serves no forms.
   - Keep the **site key** (public — it goes in the client) and the **secret key** (never leaves the
     dashboard and the Worker).
3. **Set the secret on the app worker** — `wrangler secret put TURNSTILE_SECRET_KEY`, or **Worker →
   Settings → Variables and Secrets**. Setting it is what switches enforcement on; there is no other
   flag. Deliberately absent from `wrangler.jsonc`'s `secrets.required`, so a deploy without it
   succeeds rather than failing on a credential nobody has provisioned yet.
4. **Which endpoints light up:** the two named above, and only those. The Better Auth credential
   endpoints (`/api/auth/*` — sign-in, password reset) are **not** gated: their shipped screen mints
   no token, so gating them today would break a working surface. Mounting Better Auth's own captcha
   plugin over them is the identity slice's job, once the widget exists.
5. **Optional, and only if the posture is being changed:** `HUMAN_VERIFICATION_POSTURE` is already in
   `apps/api-worker/wrangler.jsonc`, set to `fail-open`; changing that one line to `fail-closed` makes
   those two endpoints refuse with a `503` when **no** secret is provisioned, instead of serving
   unprotected. `fail-open` is the recorded decision — see the pending ADR
   `an-unprovisioned-human-check-fails-open-and-counts-itself`, which is **awaiting owner
   ratification**. The variable has no effect once a secret is set.

**How to tell it is working.** The `human_verification.decided` counter carries `route`, `outcome`
(`verified` / `refused` / `unenforced` / `unavailable`) and a closed-set `reason`. Before step 3 the
whole volume is `unenforced`; after it, `unenforced` should fall to zero. A standing
`unavailable`/`verifier-credential-rejected` count means the secret is wrong — the endpoint is
answering `503`, and no visitor is being told it is their fault.

## New configuration — carried by the 2026-08-21 push

- **`R2_BUCKET_NAME`** — `wrangler.jsonc` var on the app worker (landed with the
  bucket-resolution unification), **live on the deployed worker** (API-confirmed
  2026-08-24). It must stay byte-identical to
  `r2_buckets[0].bucket_name`; the resolver uses it to refuse presigning into a
  bucket the Worker cannot read. No dashboard
  step, listed so a manual `wrangler secret`/vars review does not strip it.
- Note: before that fix, enabling the full R2 S3 credential set in production
  would have broken every upload (presign wrote to per-firm buckets, ingest read
  the bound platform bucket). Fixed on `main`; do not deploy any pre-fix commit
  with real presigning credentials.

## The `magna-carta` project — the repoint this file asked for was the wrong fix; the deploy filter is the real one

`apps/worker` is now `apps/api-worker` on `main`, and the package inside it is now
`@magna-carta/api-worker` (it was still `@magna-carta/worker` at `release` @ `19d02cf`, which is why
the 2026-08-21 build deployed cleanly). The **Cloudflare script name is unchanged** (`magna-carta`),
nothing in production moves, and no Durable Object namespace is affected. What the API pass found
(2026-08-24), against what this entry used to instruct:

- **The root directory is `/`, and that is correct — do not repoint it.** The app worker alone spans
  the repository (build command `pnpm exec vp run build-all` bundles the SPA and the WASM
  artefacts), which is exactly the shape `operations.md` §12 records; rooting it at
  `apps/api-worker` would break the build, not fix it. The earlier instruction here was wrong.
- **The deploy command is fixed** — API-confirmed 2026-08-27: it now reads
  `pnpm --filter @magna-carta/api-worker exec wrangler deploy`, so the package rename riding the
  next `main:release` push resolves cleanly. (It read `--filter @magna-carta/worker` until then,
  which would have failed the deploy step the moment the rename shipped.)
- **The watch paths are broadened** — same confirmation: the inclusion list now reads
  `apps/api-worker/*`, `packages/*`, `apps/web/*` with the standard excludes (`docs/*`,
  `containers/*`, `spikes/*`, `*.md`), so package and SPA changes rebuild the app worker again.

One residual gap in that inclusion list, small and dashboard-only: it names no `crates/*` and no
`pnpm-lock.yaml`/`pnpm-workspace.yaml`. The app worker's build bakes WASM from `crates/pdf-core` and
`crates/decryption-core`, so a push touching only a crate — or only a dependency bump — would not
rebuild it. §12's recorded shape (include `*`, exclude the four patterns) covered both; adding
`crates/*`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` to the includes closes it just as well. The
next release push is safe either way (Workers Builds always builds a push of 20+ commits, and 27
are queued).

The `magna-carta-edit` half of the old "repoint both in one pass" is **done** — API-confirmed
2026-08-24: root `apps/edit-worker`, production branch `release`, latest builds green. Its
watch-path drift is gone too: the inclusion entry reads `apps/edit-worker/*` since 2026-08-27.

## Behaviour changes — shipped by the 2026-08-21 push (no dashboard step)

**These are live, not pending.** Every migration and endpoint named below is at `release` @
`19d02cf` — verified against the deployed tree on 2026-08-24, when the API pass surfaced the
2026-08-21 push this file had not recorded — so the "before the push" heads-ups below are current
duties, and the counters named are worth reading now. The one exception inside the permissions
entry is also resolved: `magna-carta-edit` deployed in the same push, so the editor frame the entry
says "stays blank" should now fill.

- **Twenty list endpoints changed the SHAPE of their answer.** The campaign
  behind `pnpm run lint:list-pagination` worked the unpaged-listing baseline from
  forty-seven down to thirty-three, and every endpoint it touched changed its
  response envelope. Three shapes now exist and a client has to read which one it
  got: `{ data, nextCursor }` where a caller can walk the whole record,
  `{ data, capped }` where the answer is the best or most recent N and `capped`
  says the firm holds more, and the bare `{ data }` that remains only where a
  read is bounded by something checkable — a firm-configured vocabulary, a unique
  index, a physical tree.

  **Nothing in the product breaks on the push**, because none of these endpoints
  has a shipped screen: the affected surfaces are custody, discovery, billing and
  the matter listings, and only the last has UI, which already reads the paged
  envelope. What changes is the contract an integration would read — the emitted
  `openapi.json` carries all of it, and an external consumer written against the
  old bare-array shape would need the one-line change to `.data`.

  No migration, no binding, no secret. Two reads that money depends on were
  deliberately left whole and now say so in their own names: the contingency fee
  still derives from every recovery on the matter, never from a page.

- **Notification preferences become live, and every category starts on.** The
  matrix ships with the recommended defaults — every category reaching the feed,
  and a daily mail for everything except `jobs` and `system` — so **nothing about
  what a firm currently receives changes on the push**: no member has stored a
  preference and every default is on. What arrives is the ability to change it,
  through `GET`/`PATCH /api/v1/notifications/preferences`, plus a firm-tier
  `GET`/`PUT /api/v1/firm/notifications/trust-compliance-recipients` under
  `trust:manage`. There is **no screen** — this is API only, and the notification
  centre and the preference surface are still unbuilt, so in practice nothing is
  reachable by a member until a UI slice lands. One migration
  (`20260816T002417_notification-in-app-suppression`, one new table, no rebuild)
  runs itself on the per-firm Durable Object's next wake. No new binding, no new
  secret, no new queue.

  Two things worth knowing. **The email cadence is stored and nothing reads it
  yet** — the digest is the next slice, so setting a category to `weekly` today
  records a wish rather than changing any mail. And **two categories cannot be
  silenced in app**: `security` and `trust` are written to the feed whatever a
  member or a firm sets, mirroring the non-optional stance of the audit log; a
  member may still set their email cadence off. If a firm ever needs that
  relaxed, it is a change to `MANDATORY_CATEGORIES` and a decision, not a
  setting.

  **New counter to watch after the push:**
  `notifications.suppressed_by_preference`, dimensioned by category and by whose
  choice it was. It should read zero until somebody changes a setting; a non-zero
  reading with nobody having touched their preferences would mean a firm-tier row
  was written by something other than the API, which is worth looking at.

- **The daily cron pass starts raising deadline and custody notifications.** The
  `0 3 * * *` trigger now runs a per-firm comparison sweep before the retention
  sweep: overdue deadlines, deadlines due today, custody reviews that have come
  round, and check-outs that have not come back become feed rows for the matter's
  team (deadlines) or for whoever holds `custody:manage` (the register). No new
  binding, no new secret, no new queue, no migration — the tables and the cron
  expression already exist. Two things worth knowing before the push. **A firm
  with a backlog is told about it on the first pass**, capped at 200 findings per
  kind, so a firm that has never looked at its overdue list will see a large
  first batch; the cap's clamp is reported on the `notifications.comparison_clamped`
  counter, which is the signal that a firm is being told about some of its overdue
  work and not the rest. And **the pass is once a day at 03:00 UTC**, which is the
  evening before, locally, for the American zones — the dedupe key buckets by the
  deadline's own civil day so the row lands on the correct date either way, but if
  a morning arrival matters, adding a second daily cron (e.g. `0 15 * * *`) to
  `apps/api-worker/wrangler.jsonc` is the whole fix: the second pass writes nothing
  the first already wrote.

  Deliberately still silent: `calendar.deadline.horizon`, the "entering the lead
  window" reminder, which needs a firm-configured lead window that no setting
  defines. It wants one number and a bound from you, on the retention window's
  pattern.

- **Discovery review sets narrow to their creator on migration.** The
  review-coding migration
  (`20260808T000000_discovery-review-coding-and-access`) introduces the
  per-review-set access list, which is **fail-closed**: a review set nobody is
  listed on is reachable by nobody. The migration backfills exactly one row per
  existing review set, for the member who created it, so no corpus becomes
  orphaned — but anyone else who was reviewing one must be added back through
  `PUT /api/v1/review-sets/{reviewSetId}/access/{memberUserId}`
  (`discovery:produce`). That is deliberate rather than a gap: inferring who was
  cleared for a corpus from who was staffed on the matter would assert something
  nobody decided, and a protective order is exactly where that assertion
  matters. Worth a heads-up to any firm already using discovery before the push.
  No new binding, no new secret, no queue: the migration runs itself on the
  per-firm Durable Object's next wake, and the bulk-selection objects go to the
  already-bound `R2` bucket under the existing `discovery/` prefix.

- **A discovery load's manifest and exception report must never be given a
  lifecycle rule.** They land in the already-bound `R2` bucket under
  `discovery/<reviewSetId>/loads/`, stamped `object_class:
review-load-record` — deliberately a different class from the
  `review-extracted-text` and `review-document-metadata` objects beside them,
  which ARE a derived cache and are released when a review set closes. If an
  expiry rule is ever added under the `discovery/` prefix (there is none today),
  it must exclude `loads/`. These two documents are what a firm handed to
  another party, and they are kept for as long as the matter is. No new binding,
  no new secret, no new queue: deduplication, container families and the record
  artifacts all ride the lane and the bucket that are already there, and the
  additive per-firm migration
  (`20260816T090000_discovery-dedup-and-report`) runs itself on the Durable
  Object's next wake.

- **Nine permissions that no role could hold get their seeds, and members gain
  capabilities on the push.** The additive per-firm migration
  (`20260819T220000_seed-document-editing-and-tools-permissions`, thirty
  `INSERT`s into `role_permission`, no schema statement) runs itself on the
  Durable Object's next wake, and permissions are resolved per request, so a
  member sees the change on their next request with no re-login. No new binding,
  no new secret, no new queue, and **no dashboard step at all** — but it is a
  visible behaviour change and worth knowing before the push rather than after.

  **Four are the co-editing surface** — `documents:edit`,
  `documents:checkout`, `documents:forceReleaseLock`, `documents:reconcile` —
  which have been enforced at the chokepoint since June and granted to nobody,
  so the editor launch, the offline checkout, the check-in, the reconcile and
  the force-release have been answering 403 to every member of every firm.
  Nothing is taken away: this is the first time any of it is reachable. The
  editor frame itself still needs `magna-carta-edit` deployed (its own entry
  above), so a firm that pushes this without that worker gets a launch that
  succeeds and a panel that stays blank, which the screen already explains.

  **Five are Tools tiles** — property listings, county property records,
  business-entity lookup, attorney-licence lookup, and shipping. `toolsByGroup`
  renders only the tools a member's permission set covers, so four whole subject
  groups have never appeared on `/tools` for any seat. After the push they
  appear; four of the five still read "Soon" until their own page is built,
  which is the same state eleven already-seeded tools are in.

  **Who gets what**: edit and checkout reach Owner/Admin, Attorney and Paralegal
  (where `files:upload` already sits); reconcile reaches Owner/Admin and
  Attorney; force-release reaches Owner/Admin alone; the four link tiles reach
  every default role including Read-only; the shipping tile reaches Owner/Admin,
  matching `shipping:manage`. Widening any of these later is one more additive
  migration — there is still no surface by which a firm can grant a permission
  itself, which is the standing gap behind all of this.

## Position

- Production is `release` @ `19d02cf` (2026-08-21, "Next Batch" #363). This file carried
  `0988844` (2026-07-04) until the API pass on 2026-08-24 found all twelve Workers Builds
  projects green from the newer push — the owner had deployed and the queue had not
  recorded it. `main` is 27 commits ahead; anything merged before #363 is live, and
  "the next deploy" below means the next `main:release` push.

## `magna-carta-edit` — deployed 2026-08-21; the screen it gated should now fill

**API-confirmed 2026-08-24:** the edit worker built green from `19d02cf` and the deployed script
carries `DOCUMENT_EDITOR -> DocumentEditorContainer` plus its `APP_WORKER` service binding back to
`magna-carta`. The empty-frame state this section describes ended with that push — what remains
below is the record of why it mattered, and two smaller items that still travel.

This moved up the queue on 2026-08-12 and the reason is worth stating plainly:
until now the Collabora editor was a capability nobody could get to, so its
deploy was housekeeping. The matter document surface changed that. A person can
open a matter, pick a document, and press the control that opens the editor —
and the operation behind it is **entirely real**: the document moves to
co-editing, the open is written to the audit log, and a signed token scoped to
that one version is minted. Only the editor's own interface is missing, because
it is served by a per-document container in the `magna-carta-edit` worker, which
exists only once deployed.

The screen does not pretend otherwise — it carries a badge saying the editor is
a deployed-only step, and `apps/web/src/lib/documents/document-loop-availability.ts`
records which steps are `live` and which are `deployed-only` so no consumer has
to rediscover it. But the honest state is still an empty frame, and the deploy is
what fills it. Two smaller things travel with it:

- `dev-seed` registers no template, so **build-from-template is a real endpoint
  with a genuinely empty list** on any fresh environment. Seeding one is queued
  work, not a deploy step, but it is the other half of "the loop is clickable".
- The registration confirmation mail sends the **bare token as its whole body**
  with no link and no landing URL. The screen already accepts a typed code and
  reads `?token=`, so it works the day the mail carries a link — until then the
  only path through is copy-paste.

## Status page — both workers shipped 2026-08-21

**API-confirmed 2026-08-24:** `magna-carta` and `magna-carta-status` both built green from
`19d02cf`, so the upstream-severity fix is live on both sides of `STATUS_KV` and the page should
have corrected itself within one cron cycle of that push. Kept as the record of why both deploys
were needed:

- **`apps/api-worker`** (the cron) computes the provider severity and writes
  `status:derived`. Until it redeploys, the stored snapshot still carries the
  old whole-page reading and the page will keep rendering Cloudflare as
  degraded no matter how current the status worker is.
- **`apps/status-worker`** (the page) renders the provider link and the
  uptime bar's spoken record. It is a **separate deployable with its own
  Workers Build** — deliberately not part of `vp run build-all` — so it does
  not ride along with the app worker's deploy and needs its own step.

Order does not matter; both are needed. The page corrects itself within one
cron cycle (10 minutes) of the app worker deploying, plus the 30-second edge
cache window.

## Order-sensitive deploy hazards

1. **Retired — `magna-carta-sign` exists.** API-confirmed 2026-08-24: the sign worker is on the
   account, connected to Workers Builds on `release`, and built green from `19d02cf` (2026-08-21).
   The `SIGN_SERVICE` binding on the deployed app worker resolves, so the missing-Worker rejection
   this hazard guarded against cannot fire.
2. Still open: provision the platform seal identity with
   `pnpm run platform-seal-certificate` and set the emitted
   `wrangler secret put` values. API-confirmed 2026-08-24 that the deployed sign worker holds **no**
   secrets, so the seal route serves `503 seal-not-configured` — safe, and owner-only. Runbook:
   `docs/conventions/operations.md` section 16.

## LibreOffice conversion engine activation — the deploy happened; one bucket rule turns out to be missing

The engine (`containers/libreoffice`) gives bodies to the four registered office
edges. **The deploy is done** — API-confirmed 2026-08-24: the convert worker built green from
`19d02cf` (2026-08-21) and its deployed script carries both `RASTER_ENGINE ->
RasterEngineContainer` and `LIBREOFFICE_ENGINE -> LibreOfficeEngineContainer` at migration tag
`v2`, in the right order (the convert worker before the app worker, both in the same push).

1. **The bucket step this section waved off is real after all.** It said the `conversions/` R2
   lifecycle rule "already on this queue covers this engine's outputs too" — but the API pass found
   that rule **does not exist**: the platform files bucket carries exactly two rules, `bundles/` at
   seven days and an incomplete-multipart abort at seven days. Until the owner adds a
   `conversions/` expiry, conversion outputs accumulate. Same class of dashboard step as the
   `templates/staging/` rule at the bottom of this queue.
2. **Verify readiness honestly.** This container's `/ready` answers 503 until a
   worker has finished suite initialisation (tens of seconds), so a freshly
   deployed instance reporting not-ready for half a minute is correct behaviour,
   not a fault. If it never becomes ready, `docker logs` on the instance carries
   the worker's initialisation error — the most likely causes are a missing
   system library (the build gates on that with `ldd`, so it should be caught
   earlier) or a suite that could not write its user profile.

## Notification digest activation — three values, in this order, and nothing is mailed until all three exist

The digest is built and dormant. `resolveNotificationDigestSendPort`
(`apps/api-worker/src/notifications/digest-send-port.ts`) checks three things and, if any is missing,
reports a typed reason, counts `notifications.digest_unavailable`, and exits the hourly pass before
it reads a single firm. **Nobody receives anything and no watermark moves** — deliberately, so that
turning this on later delivers the backlog rather than discovering it was silently discarded.

Do them in this order; each one is inert without the ones before it.

1. **Verify a sending domain in Cloudflare Email Service** (Cloudflare dashboard → **Email** →
   **Email Sending** → add and verify the domain the firm will send from, completing its DNS
   records). This is the long pole — DNS propagation and verification, not a click.
2. **Bind the app worker to it.** The `send_email` binding is what `env.SEND_EMAIL` resolves to. The
   binding already exists for password-reset and verification mail; if it is present, this step is
   done. Missing binding → reason `send-binding-not-configured`. **It is present** — API-confirmed
   2026-08-24 on the deployed worker, so this step is done. Steps 3 and 4 are not: the deployed
   vars carry no `EMAIL_FROM` and no `APP_BASE_URL`, and the digest's hourly cron is not attached
   yet (live schedules are `*/5`, `*/10` and `0 3` only — the digest code itself rides a future
   push).
3. **Set `EMAIL_FROM`** to an address on the verified domain (a `wrangler.jsonc` var, not a secret —
   it is public configuration). Missing → reason `sender-address-not-configured`. Note that this
   variable also switches password-reset and verification mail off the dev logging adapter, so
   setting it changes more than the digest.
4. **Set `APP_BASE_URL`** to the deployment's public origin, e.g. `https://app.magnacarta.esq` — a
   `wrangler.jsonc` var, not a secret. Every request-serving path derives its own origin from the
   request; this exists for the background passes that have no request, and the digest's one link
   back into the product cannot be built without it. Missing → reason
   `app-base-url-not-configured`.

**A new Cron trigger rides this deploy.** `wrangler.jsonc` gains `"0 * * * *"` alongside the existing
`*/5`, `*/10` and `0 3` expressions. Hourly is the granularity a firm-local morning needs and no
finer; firms whose local hour it is not cost two small setting reads. It deploys with the worker —
there is no dashboard step — but it is listed here because a manual Cron review would otherwise read
it as unexplained.

**How to confirm it worked**, without sending test mail to a real firm: watch
`notifications.digest_unavailable` stop being reported at the top of each hour. While any of the
three values is missing it is counted every pass; once all three exist the counter goes silent and
`notifications.digest_sent` starts reporting on the hour that matches a firm's configured local
hour (default 07:00 in the firm's own zone, from its default office).

**What a digest will say when it does go out:** a subject of the form
`Magna Carta — 6 items need your attention`, a body of per-category counts and one link. No matter
title, number, client name, filename, date or amount — see `docs/user/features/notification-emails.md`
for the member-facing description.

## Email capture activation (after the mint route ships)

Runbook: `docs/conventions/operations.md` section 2a.

1. Done — `magna-carta-production-emails-capture` and its deadletter both exist
   (API-confirmed 2026-08-24).
2. Deploy `apps/email-worker` — still to do: `magna-carta-email` is not on the account.
3. Add the single zone-level catch-all on `in.magnacarta.esq`.
4. Forward/CC capture stays inert until the capture-address mint route is
   deployed with the rest of the app worker.

## Verification the owner reported — closed by the API pass, 2026-08-24

The read-only credentials the last bullet of this section asked for arrived, and a session used
them the same day. Everything the section held is now confirmed, with one new fact each:

- `magna-carta-convert`: **confirmed real.** Connected to Workers Builds on `release`, root
  `apps/convert-worker`, watch paths covering both container images; latest build green
  (2026-08-21, from `19d02cf`); the deployed script carries `RASTER_ENGINE ->
RasterEngineContainer` **and** `LIBREOFFICE_ENGINE -> LibreOfficeEngineContainer`, migration tag
  `v2`. **The `conversions/` R2 lifecycle rule is NOT there** — the platform files bucket carries
  exactly two rules (`bundles/` at seven days, incomplete-multipart abort at seven days), so that
  dashboard step moves back to open, on the LibreOffice entry above. Nothing expires under
  `discovery/`, which is the required state.
- `magna-carta-edit`: **confirmed repointed and green.** Production branch `release` (the
  `slice-2-2-editing` leftover is gone), root directory `apps/edit-worker`, and its last two builds
  are green (both 2026-08-21). One drift found in exchange — its watch-path inclusion list read
  `apps/edit-worker` with no trailing `/*`, matching no file **under** the directory — and the
  owner fixed it on 2026-08-27 (now `apps/edit-worker/*`, API-confirmed). The same 2026-08-27 pass
  fixed the file-repair and recovery watch lists and the `magna-carta` deploy command; see their
  own entries.

## Blocked-in-environment owner chores

- Stale remote branch deletion. The git proxy denies ref deletions: a
  `git push --delete` returns 403 for every branch, not just some. Safe to delete:
  `osv-scanner-audit-gate`, `fix-assembly-format-output`,
  `fix-assembly-push-no-verify`, `fix-pnpm-audit-endpoint-retirement`,
  `docs-assembly-retrigger`, `claude/docs-sync-routine-setup-c3hy7m`,
  `lint-scope-ignore-workflow-yaml`, plus any branch whose pull request has
  since merged (`docs-sync/2026-07-20` after #41's closure).

  **The one-time fix is a repository setting, not a chore.** Turning on GitHub's
  _Automatically delete head branches_ (Settings → General → Pull Requests)
  retires this item permanently: every future merge cleans up after itself, and
  no session needs a permission it cannot have. Worth doing before the next
  batch sweep rather than after, so the sweep is the last one.

## Before the first firm goes live — verify the trust authorization posture

The authority-based trust posture ships seeded as version-1 data: whoever holds the
authority releases money alone, and whoever does not raises a request to someone who
does. That is the owner's directed rule and it is deliberate.

**The seed relaxes any firm that already exists with no policy row** — from
always-two-person to authority-solo. It is guarded by `WHERE NOT EXISTS`, so a firm
that has already chosen a posture keeps it; the exposure is limited to firms created
before the policy feature that never set one. The design's safety argument is that no
such firm exists, and the repository cannot prove that.

So before a real firm is served, run the check rather than trusting the argument:
confirm no firm row lacks a stored authorization policy, and if one does, set its
posture deliberately instead of letting the seed decide. A control that weakens
without anyone choosing it is the one outcome this subsystem must not produce.

Related and still open for the owner: the lone-holder exception counts `trust:manage`
rather than `trust:authorize`. Switching would take a firm with several managers and
one authority holder from two-person to solo — a reduction, so it waits for a decision.

## After the conflicts matching-depth deploy — watch the name-index backfill drain

The two organization match keys are derived at write time for every new name and filled for
existing corpora by a **bounded, resumable pass on the daily cron**
(`runDirectoryNameIndexBackfill` in `apps/api-worker/src/scheduled.ts`, 500 name rows per firm per
pass). Until a firm's pass has finished, the names it has not reached are invisible to those two
blocking channels — while a conflicts check reports them as channels that ran.

That is the one window in which the platform says it looked somewhere it did not look, and it
closes on its own; it just needs to be seen to close. Two things for the owner after the deploy:

- **Watch the drain finish.** The daily sweep logs the `directory-name-index` backfill's rows
  affected per pass; a firm with hundreds of thousands of names takes days at 500 rows a pass. When a
  firm's pass reports zero rows affected, that firm is filled.
  `countNamesAwaitingIndexBackfill` in `@magna-carta/directory` answers the same question directly
  for one firm's database.
- **Raise the per-pass budget only if a large firm is drifting.** The number is a parameter, not a
  constant. Raising it is a code change to one default; leaving it is safe, because the channels the
  sweep feeds are additive and nothing else depends on them.

Nothing here blocks the deploy, and nothing needs doing before it.

## An R2 lifecycle rule for the template staging prefix — the half the orphan sweep does not reach

`POST /api/v1/templates/upload` mints a staging key under `templates/staging/<firmId>/` and hands
back a presigned PUT. Registration reads those bytes and deletes them; a caller who uploads and never
comes back leaves them. That is deliberate — a member handed a `503` because the scan engine is down
is expected to retry against the same staged bytes rather than upload the file again — so the staged
object cannot be reaped by anything that runs on a scale of minutes.

The daily sweep over template objects no row names
(`apps/api-worker/src/assemblies/template-orphan-sweep.ts`) therefore **skips the staging prefix by
rule**, and abandoned staging is left to expire on its own. Nothing expires it yet: the bucket
carries no lifecycle rule for that prefix.

That sweep **measures and does not delete** — a template key carries no firm segment and every firm
resolves to the same bound bucket, so deciding an orphan takes the whole fleet's version rows, and a
per-firm database addressed under a name it does not answer to returns zero rows rather than
throwing. Arming it is an open owner question on the
`document-automation.template-storage-reclamation` node. So this rule is not the smaller half of a
solved problem: today it is the only thing that would reclaim anything under `templates/` at all.

**The step.** Add an R2 lifecycle rule expiring `templates/staging/` — a generous window, days rather
than hours, since it must comfortably outlive a member who was told to try again shortly. It is the
same class of rule as the `bundles/` and `conversions/` expiries in the deploy runbook, and it is
account-side: no code change accompanies it, and nothing in the repository can perform it.

Nothing breaks without it. The cost is storage for uploads nobody registered — the same cost the
sweep counts on the other half of the prefix and, for now, only counts.
