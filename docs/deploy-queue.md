# Deploy queue — owner actions pending

Production deploys are deliberate (`git push origin main:release`) and are
**never made by the orchestration session**. This document accumulates what is
waiting on the owner: the undeployed merge queue plus the account-side
dashboard steps that no session can perform. Kept current by the
orchestration stream; check `git log release..main` for the live commit delta.

_Last updated: 2026-08-15 (the CI outage was traced to an account billing block, not a workflow bug;
its owner step is the section immediately below and it gates every merge, not just every deploy)._

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

**Do not "fix" this by editing the workflow.** The runner labels in `gate.yml` are correct and were
verified against GitHub's current runner reference; `ubuntu-slim` is generally available. The outage
reproduces identically on `ubuntu-latest`, and predates `ubuntu-slim` entering the repository.

## Tools catalog — five steps, and the first one gates every other deploy

From the audit in [`docs/research/2026-08-15-tools-reality-check.md`](research/2026-08-15-tools-reality-check.md),
which exercised all nineteen catalog tools against a local worker and the real internet. Listed in
the order they have to happen. Nothing here duplicates the LibreOffice, search, bundle, sign or
email-capture steps already on this queue.

1. **Confirm `magna-carta-ocr` exists — do this before ANY app-worker deploy.**
   `apps/worker/wrangler.jsonc` declares `OCR_SERVICE -> magna-carta-ocr`, and Cloudflare rejects a
   deploy whose service binding names a Worker that does not exist (the same rule §14 and §16 of
   `docs/conventions/operations.md` state for the bundle, convert and sign workers). But
   `magna-carta-ocr` is in **none** of the three places such a worker is recorded: not the seven
   Workers Builds connections in §12, not the placeholder list in §14, and not this queue. So either
   it exists and nothing says so, or the next push is rejected outright — which would block every
   tool in the catalog, not only OCR. `apps/ocr-worker` and `containers/ocr` are both committed and
   buildable; if it does not exist, connect it as a Workers Build (or stand up a 503 placeholder of
   that name, the `magna-carta-bundle` precedent) before the app worker goes.

2. **Deploy `magna-carta-scan` carrying `/identify`.** One deploy unblocks two catalog tools that
   both answer errors today: the **file type verifier** (`POST /api/v1/file-type/verify` → 503) and
   the **malware scan** (`POST /api/v1/scan/diagnose` → 500). The route is already in the image
   (`containers/scan/src/lib.rs`, `.route("/identify", post(identify))`); the worker is already
   connected to Workers Builds, so this rides its next build. No new binding, no new secret.

   **Note the malware scan's failure shape, so nobody reads it as a regression.** With the binding
   declared but the engine unreachable the diagnostic returns a 500 with an Error ID, not the
   `unscanned` verdict its own description promises — `resolveScanPort` selects the engine-less
   adapter on the binding's **absence**, and the binding is never absent once declared. That is the
   documented treatment of a bound-but-faulty engine (a fault, never a fabricated verdict), but it
   means a placeholder or unhealthy scan worker shows up as a server error rather than a graceful
   degradation.

3. **Deploy `magna-carta-file-repair` — but fix its Build Watch Paths first.** The **file repair &
   salvage** tool answers 503 until this worker is live. Its inclusion list names
   `containers/file-repair-worker/*` while the container actually lives at `containers/file-repair/`,
   so **no path matches the image** and a change to the repair engine never triggers a rebuild
   (already recorded in `operations.md` §12; repeated here because deploying without correcting it
   ships the old image). Correct it to `containers/file-repair/*`, then deploy.

4. **Enable Browser Rendering on the account.** The **safe website viewer** is the only tool in the
   catalog whose dependency is an account entitlement rather than a worker, a container or a secret
   — `env.BROWSER` with `quickAction()` (the current `compatibility_date` already satisfies the
   `>= 2026-03-24` requirement). There is nothing in the repository to deploy for it and nothing
   local can exercise it: Miniflare exposes a `BROWSER` binding whose receiver has no `quickAction`,
   so the route answers 500 in every local run no matter what changes.

5. **Set `PANGRAM_API_KEY` — last, and only when a firm has asked.** **AI-text detection** refuses
   twice today, both correctly: `422` because the firm's consent setting is off, and `422` again if
   it were on with no key. The consent gate runs before any provider call, so no client text can
   leave the platform on a firm that has not opted in. The secret is worth setting only after a firm
   turns the setting on.

**One thing on this list is NOT a deploy step, and no amount of deploying fixes it.** Shipping cannot
connect a postage account at all — `firmSecretStoreNotYetAvailable` in
`apps/worker/src/plugins/secret-store.ts` reports the per-firm credential read as unbuilt, an
absence awaiting the marketplace slice. Connecting a real EasyPost key and deploying everything above
would leave it exactly as it is. Connect, rate-shop, purchase, tracking and refund answer `501
not-implemented` (they returned `500` until 2026-08-15); draft creation still succeeds, because a
draft is the firm's own addresses and parcel and needs no carrier.

## Search engine activation — a new worker, a new container image, one binding

`apps/search-worker` (`magna-carta-search`) and `containers/search` now exist: the
Tantivy engine, its R2 range-read adapter, and the object host it reads through. Nothing
about them is live — `resolveSearchIndexPort` returns the deferred port until the app
worker has a `SEARCH_SERVICE` binding, so every index job still parks in `deferred` and
no query reaches an engine.

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

## Split compaction — one queue pair to create before the app worker deploys

Search split compaction landed with a new queue, its deadletter, and a new Durable
Object class. **Create the queues first.** A declared consumer whose queue does not
exist fails the deploy outright, the same hazard the email-capture activation below
carries:

1. Create `magna-carta-production-search-compaction` **and**
   `magna-carta-production-search-compaction-deadletter`.
2. Deploy the app worker. Its `wrangler.jsonc` already carries the producer binding, the
   consumer at concurrency 1, the `SEARCH_COMPACTION_JOB` Durable Object binding, and
   migration tag `v8-search-compaction-job`. Nothing else to set.

No new secret and no bucket step: merged splits are written into the firm's existing
bucket under the prefix the per-document splits already use.

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

## Discovery processing lane — a queue pair, then a container worker, in that order

The discovery processing slice landed with a new queue, its deadletter, and a service
binding to the discovery engine worker. **The queue pair comes first and is not
optional:** a declared consumer whose queue does not exist fails the deploy outright,
the same hazard the compaction activation above carries.

1. Create `magna-carta-production-discovery-process` **and**
   `magna-carta-production-discovery-process-deadletter`.
2. Deploy `magna-carta-discovery` — the standalone engine worker that owns the
   `DiscoveryEngineContainer`. Its image builds in Cloudflare Workers Builds from
   `containers/discovery/Dockerfile` with the repo root as build context. Validate the
   config first with
   `pnpm --filter @magna-carta/discovery-worker exec wrangler deploy --dry-run --containers-rollout=none`.
3. Deploy the app worker. Its `wrangler.jsonc` already carries the `DISCOVERY_PROCESS`
   producer binding, the consumer at concurrency 4, and the `DISCOVERY_SERVICE` service
   binding to `magna-carta-discovery`. No new secret, no new bucket.

**Step 3 will fail while step 2 is undone.** A service binding naming a worker that does
not exist is a deploy-time error, not a runtime fallback — unlike an _absent_ binding,
which the extraction port handles by falling back. Deploy the engine worker or remove the
binding; do not deploy the app worker against a name with nothing behind it.

**The order between 2 and 3 is not cosmetic.** With the queue live and the engine worker
absent, every review document parks `pending` with a reason on its row and its load will
not reach `complete` — visible, recoverable, and exactly the state the design intends
while an engine is undeployed. Re-running the load's dispatch after step 2 drains it.

**Why concurrency 4, so nobody raises it as a knob.** Extraction runs in the discovery
Container, which is sized for this burst (`max_instances: 20`) and scales to zero between
loads, so the Container's own ceiling is what bounds throughput. This number bounds how
much of the account's 250-invocation consumer budget one bulk load may take, which is the
whole reason the lane is separate from files ingest in the first place.

**Not yet activated by this deploy:** the LibreOffice conversion engine (its own section
below). Until `CONVERT` is bound and that container is deployed, a legacy `.doc`, `.xls`
or `.ppt` in a review set parks rather than being recorded unreadable.

## New configuration the next deploy must carry

- **`R2_BUCKET_NAME`** — new `wrangler.jsonc` var on the app worker (landed with the
  bucket-resolution unification). It must stay byte-identical to
  `r2_buckets[0].bucket_name`; the resolver uses it to refuse presigning into a
  bucket the Worker cannot read. Already committed in the config — no dashboard
  step, listed so a manual `wrangler secret`/vars review does not strip it.
- Note: before that fix, enabling the full R2 S3 credential set in production
  would have broken every upload (presign wrote to per-firm buckets, ingest read
  the bound platform bucket). Fixed on `main`; do not deploy any pre-fix commit
  with real presigning credentials.

## Behaviour changes the next deploy carries (no dashboard step)

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

## Position

- Production is `release` @ `0988844` (2026-07-04). `main` is several hundred
  commits ahead and growing; everything below rides the next push.

## `magna-carta-edit` now gates a screen a person can reach

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

## Status page — the upstream-severity fix needs BOTH workers deployed

No new binding, no new secret, no dashboard step. But the fix spans the two
sides of `STATUS_KV` and only shows once both have shipped:

- **`apps/worker`** (the cron) computes the provider severity and writes
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

1. **`magna-carta-sign` must exist before the app worker deploys.** The app
   worker's `wrangler.jsonc` binds `SIGN_SERVICE -> magna-carta-sign`;
   Cloudflare rejects a deploy whose service binding names a missing Worker.
   Deploy `apps/sign-worker` first (or stand up a 503 placeholder of that
   name, the `magna-carta-bundle`/`magna-carta-convert` precedent). Runbook:
   `docs/conventions/operations.md` section 16.
2. After the sign worker exists: provision the platform seal identity with
   `pnpm run platform-seal-certificate` and set the emitted
   `wrangler secret put` values. The seal route serves 503 until then — safe.

## LibreOffice conversion engine activation

The engine (`containers/libreoffice`) gives bodies to the four registered office
edges. Everything is committed; the steps below are the deploy, in order.

1. **Deploy `apps/convert-worker` first, with the new Container class.** Its
   `wrangler.jsonc` now carries a second `containers` entry
   (`LibreOfficeEngineContainer`, `standard-2`), its Durable Object binding
   (`LIBREOFFICE_ENGINE`), and migration tag `v2`. The app worker's
   `CONVERT_WORKER_ENGINE_IDS` already names `libreoffice`, so deploying the app
   worker first would route the engine id at a convert worker that does not know
   it: a 501 the adapter maps to `adapter-error` and the job fails cleanly. That
   is a degradation rather than an outage, which makes the order a strong
   preference rather than a hazard — but it is free to get right.
2. **Expect a long first build.** This image bakes an office suite and lands
   around a gigabyte — an order of magnitude above every other container here —
   so its first Workers Builds run will take substantially longer than any build
   in this project so far. It fits: the limit is the instance disk (twelve
   gigabytes on `standard-2`) against a fifty-gigabyte account image allowance.
3. **No new bucket step.** The `conversions/` R2 lifecycle rule already on this
   queue covers this engine's outputs too.
4. **Verify readiness honestly.** This container's `/ready` answers 503 until a
   worker has finished suite initialisation (tens of seconds), so a freshly
   deployed instance reporting not-ready for half a minute is correct behaviour,
   not a fault. If it never becomes ready, `docker logs` on the instance carries
   the worker's initialisation error — the most likely causes are a missing
   system library (the build gates on that with `ldd`, so it should be caught
   earlier) or a suite that could not write its user profile.

## Email capture activation (after the mint route ships)

Runbook: `docs/conventions/operations.md` section 2a.

1. Create the `emails-capture` queue **and its deadletter** first.
2. Deploy `apps/email-worker`.
3. Add the single zone-level catch-all on `in.magnacarta.esq`.
4. Forward/CC capture stays inert until the capture-address mint route is
   deployed with the rest of the app worker.

## Verification the owner reported but no session has confirmed

- `magna-carta-convert`: connected to Workers Builds on `release`; unverified
  that the deployed worker is the real one (settings should show the
  `RASTER_ENGINE` Durable Object binding + container image) and that its
  first build went green. The `conversions/` R2 lifecycle rule (~24h) is a
  separate dashboard step, also unverified.
- `magna-carta-edit`: repointed to `release`; verify the first post-repoint
  build is green (8 consecutive failures through 2026-06-28 before that).
- Adding read-only `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`
  (Workers Builds Read, Workers Scripts Read, R2 Read) to the Claude Code
  environment would let a session close these checks itself.

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
