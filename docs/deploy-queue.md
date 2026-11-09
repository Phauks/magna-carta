# Owner action queue — the steps no session can perform

**There is no queue of undeployed code any more.** On 2026-08-29 the owner moved both `magna-carta` (the API Worker) and `magna-carta-web` (the SPA) onto **`main`** as their Workers Builds production branch, so **a merge to `main` builds and deploys within minutes** — the deliberate `git push origin main:release` is gone, `release` survives only as history, and `git log release..main` is no longer a meaningful reading of anything. The branch model is in [`operations.md`](conventions/operations.md) under _Cloudflare Workers Builds_; this file does not restate it.

> **Every dated "API-confirmed" marker below is history, not status.** It records why an item was
> closed on the day it was closed. It is **not** a claim about the account now, and it does not become
> one by being the most recent line on the page — the dashboard changes without touching this
> repository. Before acting on any item, re-read the live configuration; `operations.md` under _How
> this file treats live Cloudflare state_ has every command, and explains why neither file writes the
> answers down any more.

What this document is for now: **the account-side actions that no session can perform** — Cloudflare dashboard steps, DNS, R2 lifecycle rules, secrets, account entitlements, repository settings, and the GitHub Actions billing block. Every one of them is a step the repository cannot take on its own no matter what merges. Kept current by the orchestration stream.

**The move raised the stakes on everything below.** While a deploy was a separate gesture, a mistake had two chances to be caught: the merge and the push. Now a migration, a contract change or a binding change reaches real users on the strength of whatever verification ran before it landed — and that verification is `pnpm gate`: run on the branch by whoever made the change and, from 2026-11-09, run again hosted as the `gate` check on every pull request. The first two entries below record the settings that hosted run needs and why there is still no second run on the exact tree that lands.

## Turn the hosted gate on — fund Actions with a cap, require `gate` again (2026-11-09)

**What to do.** Four repository and account settings, in this order, once the pull request that adds `ci.yml`, `pr-upkeep.yml` and `preview-cleanup.yml` has merged:

1. **Set an Actions spending limit.** GitHub → Settings (the account's, not the repository's) → Billing and licensing → Budgets and alerts: a budget on Actions with _Stop usage when budget limit is reached_ on. This is the cap the owner chose on 2026-11-09; without _stop usage_ a budget only alerts.
2. **Let workflows open pull requests.** Repository → Settings → Actions → General → Workflow permissions → _Allow GitHub Actions to create and approve pull requests_. `assemble-docs.yml` needs it.
3. **Allow auto-merge.** Repository → Settings → General → Pull Requests → _Allow auto-merge_. The thread rules in the root `CLAUDE.md` and `assemble-docs.yml` both turn it on per pull request.
4. **Require `gate` again.** Repository → Settings → Rules → Rulesets → the ruleset on `main` → _Require status checks to pass_ → add `gate` (the job name in `ci.yml`). Leave _Require a pull request before merging_ as it is. Add the same rule to a `beta` ruleset when that branch exists.

Optional, for the Preview cleanup: repository secrets `CLOUDFLARE_API_TOKEN` (a Cloudflare API token with Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow runs and does nothing, and it deletes nothing until a `beta` Preview exists anyway.

**Why.** The quality gate left the runner on 2026-09-16 because the Actions budget ran dry and the required `gate` check wedged every pull request ([`build-performance.md`](conventions/build-performance.md) under _The gate — `pnpm gate`, on the machine that made the change_ has the history). With several threads now opening pull requests in parallel against a `main` that deploys on merge, a gate that only runs when someone remembers to run it is the larger risk, so the owner funded Actions with a cap and the gate returned as a hosted run of the same command. **If the budget runs out again**, the `gate` check stops reporting and every pull request waits on it: remove `gate` from the required checks (step 4, reversed) until the budget resets, and fall back to `pnpm gate` locally. Nothing in the repository can change a ruleset or a budget.

**Also worth doing while there:** close the stale docs-assembly pull request (#457) if it is still open; the next `assemble-docs` run opens a fresh one.

_Position, 2026-08-29: `main` is production for the app Worker and the SPA. Everything else about the account is read live, not recorded here — including which projects are connected, what branch each builds from, and what is deployed on any of them. The 2026-08-24 API pass that this file used to treat as its "evidentiary floor" is exactly the thing that stopped being one: it was accurate on the day and had decayed within the week, and a floor that decays silently is worse than no floor. Read the account instead._

_2026-08-27 — the owner fixed the dashboard items that pass raised, and a session re-read the live
configuration to confirm every one: the `magna-carta` deploy command now filters
`@magna-carta/api-worker`, its watch paths again cover `packages/*` and `apps/web/*`, and the
file-repair, recovery and edit inclusion lists are corrected. Still open account-side: the
`conversions/` and `templates/staging/` lifecycle rules, the platform seal secrets, and everything
below that never depended on the token._

_2026-08-29 — the control-plane migration ledger was stalled, which is why `registration` did not
exist and every signup answered 500. The owner resolved it by dropping the control-plane tables; the
`*/5` cron then applied the current lineage. The diagnosis, the recognition rule that produced the
refusal, and the improvement it argues for are recorded once, in
[`operations.md`](conventions/operations.md) under_ Control-plane database migrations _— read that
before diagnosing any "the code creates this table and production does not have it" report._

## No merge queue on `main` — GitHub does not offer one to this repository, and the owner declined the move (2026-09-03)

**Why it was wanted.** On 2026-09-02, the first day the gate ran a full battery in a month, every
failure it found was the same defect: two branches that merged minutes apart, each green against the
`main` it had seen, never tested together. A permission list that did not know a key another merge
added; a story still clicking a button another merge removed; a lint rule and the screen that trips
it landing the same afternoon. The pull-request tier cannot see this by construction. A merge queue
can: it builds the exact tree that will land and runs the gate on that, so the interleaving is caught
before the deploy rather than by the next branch to run. The workflow side was wired for it in #488:
the hosted gate of the time carried a `merge_group` trigger, resolved its diff base from the queue's
payload, and deferred the fan-out sinks on that tier (that workflow was removed on 2026-09-16; a
queue would run `pnpm gate` in a workflow of its own).

**Why it cannot be clicked.** GitHub offers merge queues in public repositories owned by an
organization, and in private repositories owned by organizations on Enterprise Cloud. This repository
is private and owned by a user account, so **Require merge queue** does not appear in its rulesets or
its branch protection, and no plan change on a user account adds it. The routes that would: transfer
the repository to an organization and make it public, or transfer it and pay for Enterprise Cloud.
Either re-binds Workers Builds, the GitHub App installs and the connector access to the new owner.

**Decision, 2026-09-03.** The owner declined the transfer: it eats time the project does not have,
and the failures it would prevent are dealt with as they come. Nothing in the repository changes —
the `merge_group` trigger, its base resolution and its sink deferral stay wired, so the tier is ready
the day the ownership changes. What stands in is a habit: **merge one pull request at a time, and
sync the next branch onto the `main` the last merge produced before it lands.** The ruleset option
_Require branches to be up to date before merging_ would enforce that habit, and is deliberately left
off: with two or three streams open it forces a full battery per stream per merge, which is the
budget pressure the austerity exists to avoid, and it still cannot stop two branches updated from the
same `main` from landing back to back. If interleaved-merge failures recur at the 2026-09-02 rate,
the number to decide against is the runner-minutes that option would spend against the minutes those
fixes cost.

**Two things written for the queue that stay.** The docs-assembly workflow enables auto-merge with
`gh pr merge --auto --rebase`; without a queue that is plain auto-merge. And the values a queue would
take — squash; build concurrency 1; group size 1 to 5 with a five-minute wait; a 60-minute check
timeout; up-to-date-before-merge off — are in this file's history at #488, should the transfer ever
happen (the `gate` status it named as the one required check no longer exists; a queue would run
`pnpm gate` in a workflow of its own).

**The hosted gate is gone (2026-09-16), and this is why.** The Actions block recurred on
**2026-09-03**: every `gate` run from then reported `failure` with the fingerprint in
[`operations.md`](conventions/operations.md) under _Quality gates_ — jobs whose `started_at` equalled
`created_at`, a log endpoint that 404d on runs seconds old, a red aggregate over a field of
`skipped`. Run #1037 on 2026-09-03 was the last green one. Every merge from 2026-09-12 (#602, #603,
#604) and the rounds of 2026-09-09 to 2026-09-14 (#605, #606) landed on local verification alone, on
an administrator override past a required status that never reported, and each of them deployed. A
gate that is present one month in three is a gate people learn to work around, so the owner removed
it and kept its checks: `pnpm gate` is the gate of record, and the entry above is the setting that
still has to follow.

**History.** The first block stood from 2026-08-05 to 2026-09-01: GitHub had refused to start any
billable job for the repository, so the gate executed nothing for a month. The billing step cleared
it (jobs with real runner ids from 2026-09-01), and three days later it was blocked again. The
recognition rule for that state stays in [`operations.md`](conventions/operations.md) under _Quality
gates_, because it is the only way to read a red check from those windows correctly.

**What it cost, and it went up on 2026-08-29.** Every merge since 2026-08-05 landed on the strength of
local verification alone. Since the branch move, every merge also **deploys** on the strength of
local verification alone. That is now the design rather than an outage — `pnpm gate` on the branch
is the whole of the verification, and a pull request states its summary — so the cost has become a
discipline: a pull request with no gate summary is a pull request whose verification is unknown. Two
specific checks were CI-authoritative and remain unanswered — see the scan-policy item under
_Deferred — operational setup_ in [`ROADMAP.md`](../ROADMAP.md).

A third cost surfaced on 2026-08-25 and is now paid forward rather than accruing: the build register's
trend series (`docs/register-history.json`) advances only when the per-merge assembly workflow runs, so
it sat frozen from 2026-08-17. The two defects that would have kept it frozen even with a working
runner are fixed, and the workflow now names the trunk explicitly — so the first assembly run after
this block clears brings the series current by itself, with no direct push and no step for the owner.

**The last reading of the fingerprint, 2026-09-15.** Pull request #615 put three runs through it.
Runs #1210 and #1211 were 40 and 32 seconds end to end; in #1211 `classify`, `format` and
`governance` all carried `started_at` equal to `created_at` and lasted 21, 11 and 12 seconds; all
eleven jobs behind them were `skipped`, several with a `completed_at` EARLIER than their own
`started_at`, which is not a thing a job that ran can report; and the log endpoint 404d on a job
hours old. The branch's own `pnpm check:scoped` was green on that head, so the red on #615 was the
outage rather than anything in the change. The runner labels were never the cause — the outage
reproduced identically on `ubuntu-latest` and predated `ubuntu-slim` entering the repository — and
the workflow is gone now regardless, so there is no longer a workflow to "fix".

## Reconcile the production branch across the fleet — check before acting, and expect it to be done

The 2026-08-29 move to `main` named `magna-carta` and `magna-carta-web`. Whether the sibling projects
share that branch is **live account state and this file does not record it** — read it first, because
this item may already be closed:

```bash
# Prints every connected Worker's production branch. Uniform output = nothing to do here.
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts?per_page=100" \
  | jq -r '.result[].tag' | while read -r tag; do
      curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$tag" \
        | jq -r 'if .success then "\(.result.script_tag) \(.result.git_repository.branch)" else "not connected" end'
    done
```

**Why a split fleet is worth a pass rather than a shrug.** It breaks cross-Worker changes silently: a
merge deploys the app Worker immediately while a sibling change sits on a branch nothing builds, so the
app Worker runs against an engine that has not shipped its half. Nothing errors at merge time; the
symptom is a runtime fault in whichever engine lagged.

**The step, if the read shows a split.** Per project, dashboard → the Worker → **Settings → Build →
Branch control** (the read-only token in the Claude Code cloud environment can read but not write;
the change needs the owner). Decide deliberately: **one branch on everything** keeps the fleet in step
and is the simplest rule to hold, and Watch Paths — not the branch — are what stop an engine image
rebuilding on merges it does not care about. The one project with a reason to think twice is
`magna-carta-scan`, whose nightly deploy hook rebuilds its production branch to refresh signatures: off
the trunk that hook refreshed signatures without shipping untested trunk code; on the trunk it ships
whatever the trunk holds.

## Tools catalog — what the 2026-08-21 push settled, and what remains

From the audit in [`docs/research/2026-08-15-tools-reality-check.md`](research/2026-08-15-tools-reality-check.md),
which exercised all nineteen catalog tools against a local worker and the real internet. Listed in
the order they were queued. Nothing here duplicates the LibreOffice, search, bundle, sign or
email-capture steps already on this queue.

1. **`magna-carta-ocr` is real — API-confirmed 2026-08-24.** The owner's report now has evidence
   behind it: the worker exists on the account, it is connected to Workers Builds with root
   directory `apps/ocr-worker` and watch paths covering `containers/ocr/*` and the OCR crates, and
   the deployed script carries the `OCR_ENGINE -> OcrEngineContainer` Durable Object binding — the
   real worker, not a placeholder. Nothing about OCR blocks an app-worker deploy. Its production
   branch is not recorded here; the branch-reconciliation item above has the read.

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

4. **Enable Browser Rendering on the account — CLOSED 2026-09-18, and it had been enabled all
   along.** The **safe website viewer** was the only tool in the catalog whose dependency is an
   account entitlement rather than a worker, a container or a secret — `env.BROWSER` with
   `quickAction()`. This entry stood open for weeks on the reasoning that captures were failing and
   the entitlement was the one thing nobody could check from the repository. That reasoning was
   sound and the conclusion was wrong: the entitlement was serving, and the captures were failing on
   a wait for `networkidle2` that a page holding a socket never reaches, which the service reported
   as a 422 and the route then reported to members as a capacity outage. A capture returned a
   screenshot on 2026-09-18, which is the only evidence that ever settled it.

   **What the episode is worth remembering for** is the shape of the mistake, because this file
   invites it: an item here names something no session can verify, so a failure that _could_ be that
   item gets attributed to it, and the attribution is never re-tested. The renderer's own refusals
   were being collapsed into one message and never logged, so for weeks there was nothing to read.
   Before blaming an open entry here for a live failure, make the failure readable first.

   Still true, and unchanged by the closure: nothing local can exercise it — Miniflare exposes a
   `BROWSER` binding whose receiver has no `quickAction`, so that path is stubbed in every local
   run. Interactive live browsing would need Browser Sessions on top of this, which is a larger
   surface than quick actions and has not been exercised.

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

1. **Connect `magna-carta-search` to Workers Builds** — production branch `main`, matching
   `magna-carta` — and let it build the
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

## Address engine activation — a bucket, a new worker, one binding (2026-10-02)

`apps/address-worker` (`magna-carta-address`) and `containers/address` now exist: the
platform's own US address index, built monthly from OpenAddresses. Nothing about them is
live until the app worker has an `ADDRESS_SERVICE` binding; until then US lookups go to
Smarty if its pair is set and to nothing otherwise. The full runbook is
[`operations.md`](conventions/operations.md) §20; the account steps, in order:

1. **Create the R2 bucket `magna-carta-addresses`** — private, no CORS. The worker binds it
   as `ADDRESS_INDEX`; a deploy fails while it is missing.
2. **Connect `magna-carta-address` to Workers Builds** — production branch `main`, deploy
   command filtered to `@magna-carta/address-worker`, watch paths `apps/address-worker/*`,
   `containers/address/*`, `crates/*`. One image (`containers/address/Dockerfile`, build
   context = repository root) runs as two Container classes: `AddressIndexContainer`
   (`basic`) and `AddressBuildContainer` (`standard-4`), migration tag `v1`. No secret, no
   queue.
3. **Add `ADDRESS_SERVICE`** (`"service": "magna-carta-address"`) to the app worker's
   `services` in a pull request, after step 2 has deployed — a binding to a worker that
   does not exist fails the app worker's deploy (§14 of the runbook).
4. **Nothing to trigger.** The daily cron builds the first index the morning after step 2
   (or trigger it from the dashboard). Expect about an hour of `standard-4` time and about
   10–12 GB in the bucket per build; two builds are kept.

**One ruling is the owner's.** Sources whose only recorded licence is an indemnification
clause (26 US layers, among them San Diego County, Fulton County and San Antonio) are
included; share-alike, non-commercial and bespoke-agreement layers are excluded. Reversing
the indemnification call is an edit to `LICENCE_EXCLUSIONS` in `containers/address/src/build_job.rs`.

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
(`apps/api-worker/src/http/human-verification/`). It gates the two anonymous writes — `POST
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

## Version visibility — the owner is now seeing what this entry predicted (2026-08-30)

**The report:** every source in the version chip reads "Not reporting" or "Not deployed". Both
answers are true, and neither is a code fault — the mechanism is in
[`operations.md`](conventions/operations.md) under _Cloudflare Workers Builds_, and this entry is
only the steps. In short: a sibling Worker answers the version probe only if the route was in the
build it was deployed from. The route landed 2026-08-29; a sibling last deployed before that answers
nothing, and stays that way until something rebuilds it — which needs both the right branch and a
Watch Path that names the package the route lives in.

Two dashboard steps, in this order, and both are needed — either one alone leaves the chip exactly as
it is. **Read the current settings first (the branch-reconciliation item above has the command); both
steps may already be done, and neither the branch nor the watch paths are recorded in this
repository:**

1. **Put the sibling projects on the branch the version route is on.** The route exists only on the
   trunk; a project building from anywhere else cannot pick it up at all.
2. **Ensure `packages/build-identity/*` is in every sibling Worker's Build Watch Paths.** Each of
   those Workers bundles the package, so a change to the version route or the identity stamp should
   rebuild them; without the path it matches nothing and redeploys nothing. Check with
   `jq -r '.result.production_settings.path_includes'` on the per-`script_tag` Builds read. (A
   project whose includes already cover `packages/*` is covered by that.)

Then any push touching a sibling's own paths rebuilds it and its row lights up with a real commit.
To light them all up at once without waiting for an unrelated change, use each project's **Retry
build** (or its deploy hook) after step 1.

**No new secrets, vars, or bindings.** The stamp runs inside the existing `pnpm run build` commands.

**Keyword Search stays "Not deployed", correctly.** `magna-carta-search` is not a connected project
and `SEARCH_SERVICE` is not in the app Worker's `services` array; that row is reporting the truth and
changes when the Worker ships (_Search engine activation_ above).

**Update 2026-08-31 — the roster is now the whole fleet, and that adds two dashboard checks.** The
aggregate lists every worker under `apps/` (the edit, email, status and web workers joined it), each
row named by its deployed Worker, and the app Worker gained three version-read-only service bindings
(`EDIT_SERVICE`, `STATUS_SERVICE`, `WEB_SERVICE`). What that changes here:

1. **The merge carrying those bindings requires `magna-carta-edit`, `magna-carta-status` and
   `magna-carta-web` to exist on the account when it lands** (the code-10143 rule in
   `operations.md`; all three are recorded as existing — edit API-confirmed 2026-08-24, status
   holding its hostname, web connected on `main` since 2026-08-29 — but existence is live state:
   verify with the scripts listing before merging if in doubt).
2. **The new rows answer only after their own projects rebuild from a commit carrying this change**,
   so steps 1 and 2 above (branch + `packages/build-identity/*` in Watch Paths) now apply to the
   edit and status projects too; until then their rows read "Not reporting", truthfully. The web
   row reports once `magna-carta-web` rebuilds (its answer is a static `/__version` file the SPA
   build now emits); its project watches `apps/web/*`, which this change touches, so its next build
   picks it up.
3. **`magna-carta-email` reads "Not deployed", correctly** — the worker is not on the account
   (_Email capture activation_ above). When it ships, add
   `{ "binding": "EMAIL_SERVICE", "service": "magna-carta-email" }` to the app Worker's `services`
   array in the same change; the worker already carries the version-only `fetch` surface.

The overlay's Refresh control now forces a fresh probe (`?fresh=true`), so "press Refresh and watch
the row light up" is a real acceptance check after each project rebuilds.

## The interface ships on its own Worker — the cutover happened (2026-08-31); one dashboard step delivers the payoff

The owner converted the app's hostname from a custom domain on `magna-carta` to **route patterns on
the zone**: `magna-carta-web` serves every path, `magna-carta` only its four families (`/api/*`,
`/wopi/*`, `/search-objects/*`, `/__dev/*`). Decision and shape: the
`the-interface-ships-on-its-own-worker` ADR; mechanism notes live in `operations.md` and both
Workers' `wrangler.jsonc`. What happened, and what remains:

1. **Done, account side:** routes created; custom domain removed; the apex DNS record restored as a
   proxied placeholder. The one incident in the window: the placeholder record was briefly missing,
   so the apex returned ENODATA and the site was unreachable until it was added — resolvers then
   healed within the zone's 1800-second negative-cache TTL. If this conversion is ever repeated on
   another hostname, add the record in the same minute the custom domain is removed.
2. **Done, repository side:** the version overlay states the new topology and its page-versus-API
   "Different Builds" warning is retired (a normal state under separate deploys); comments, runbook
   and the split design's status record the cutover. The app Worker's `assets` block deliberately
   SURVIVES as the local-dev vehicle and the rollback fallback — see the ADR before touching it.
3. **Still open — the one dashboard step that delivers the actual payoff:** remove `apps/web/*`
   from the `magna-carta` project's Build Watch Paths (per-`script_tag` Builds settings). Until
   then a UI merge still rebuilds the API alongside `magna-carta-web`; after it, a UI merge
   deploys in the couple of minutes `magna-carta-web` takes, touching nothing else. (The two
   earlier watch-path items — `crates/*` + the lockfiles on `magna-carta`, `packages/api-client/*`
   on `magna-carta-web` — are recorded in the _Version visibility_ entry above and matter more now:
   the web project's includes are the interface's whole deploy trigger.)
4. **Verification:** the site serving normally after the next `magna-carta` deploy is itself the
   proof that the `/*` route names `magna-carta-web` (the two Workers serve identical files, so
   only a deploy that changes one of them distinguishes the router's answer). The version overlay
   shows each Worker's commit; the update notice appearing in an open tab a minute after a UI
   merge is the end-to-end check of the new path.
5. **Rollback:** repoint the zone's `/*` route to `magna-carta` (which still carries the SPA as
   assets). No redeploy needed in either direction.

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
  `pnpm --filter @magna-carta/api-worker exec wrangler deploy`, so the package rename resolves
  cleanly. (It read `--filter @magna-carta/worker` until then, which would have failed the deploy
  step the moment the rename shipped — and under the current model that failure would have landed
  on a merge, in production.)
- **The watch paths are broadened** — same confirmation: the inclusion list now reads
  `apps/api-worker/*`, `packages/*`, `apps/web/*` with the standard excludes (`docs/*`,
  `containers/*`, `spikes/*`, `*.md`), so package and SPA changes rebuild the app worker again.

One residual gap in that inclusion list, small and dashboard-only: it names no `crates/*` and no
`pnpm-lock.yaml`/`pnpm-workspace.yaml`. The app worker's build bakes WASM from `crates/pdf-core` and
`crates/decryption-core`, so a push touching only a crate — or only a dependency bump — would not
rebuild it. §12's recorded shape (include `*`, exclude the four patterns) covered both; adding
`crates/*`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` to the includes closes it just as well.
**This gap matters more than it did:** a merge that touches only a crate or only a lockfile now
silently does not deploy, and there is no later push to sweep it up. The large-push exemption that
used to cover it (Workers Builds always builds a push of 20+ commits) does not apply to the
one-merge pushes `main` now receives. **Still open — the one dashboard step in this entry.**

The `magna-carta-edit` half of the old "repoint both in one pass" is **done** — API-confirmed
2026-08-24: root `apps/edit-worker`, latest builds green. Its
watch-path drift is gone too: the inclusion entry reads `apps/edit-worker/*` since 2026-08-27.

## Behaviour already in production — no owner action, kept as the record of what changed

**Nothing in this section is pending.** Every migration and endpoint named below shipped with the
2026-08-21 push, was verified against the deployed tree on 2026-08-24, and is live on `main` today.
The entries are written in the future tense of a push that has since happened — read every "before
the push" and "after the push" as a description of behaviour that is **already running**, and the
counters named as things worth reading now. The one exception inside the permissions entry is also
resolved: `magna-carta-edit` deployed in the same push, so the editor frame the entry says "stays
blank" should now fill.

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

## Position — what is live

**`main` is live**, for `magna-carta` and `magna-carta-web`, within minutes of any merge. There is nothing to record here per push and no commit delta to track; the trunk is the answer.

Two items survive from the 2026-08-29 build wave that preceded the branch move, both **unverified since**:

- **`magna-carta-convert` did not build** from `a4f2724`. Its build was terminated two seconds into initialization with a Cloudflare **internal error** ("An internal error occurred. Please retry your build.") — a platform fault, not a build-config or code fault. The 2026-08-21 convert deploy (from `19d02cf`) stayed live, so nothing regressed. Whether a later push has since built it green is unknown; a read of the convert project's latest build settles it, and a dashboard retry is the remedy if not (a read-only token cannot perform one).
- **`magna-carta-web` lagged the trunk** through 2026-08-29, having received no push-triggered build from `a4f2724`. The branch move was expected to resolve it by itself. **Do not read that expectation as a status** — check the project's own latest build before treating the standalone web worker as current:

  ```bash
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/builds/workers/$SCRIPT_TAG/builds?per_page=5" \
    | jq -r '.result[] | "\(.created_on) \(.build_outcome)"'
  ```

  How much it matters depends on **which Worker answers the hostname users browse**, which is live
  routing state, not a property of this file — `operations.md` under _Which address does a Worker
  answer on_ has the read. If the app Worker is the one answering, a stale `magna-carta-web` is
  invisible to users; if it is not, a stale `magna-carta-web` is the site.

_Why this file no longer tracks what is deployed:_ it carried `0988844` (2026-07-04) as the live commit long after the owner had deployed past it, and an API pass found every project green from a much newer push. A deployed-commit list in a repository is stale the moment somebody deploys, and nothing makes a reader suspect it. The build-history read above answers it in one call; that is the only answer worth having.

## `magna-carta-edit` — deployed 2026-08-21; the screen it gated should now fill

The empty-frame state this section describes ended when the edit worker deployed carrying
`DOCUMENT_EDITOR -> DocumentEditorContainer` and its `APP_WORKER` service binding back to
`magna-carta` (2026-08-21). Confirm the bindings on the deployed script rather than trusting this
paragraph — the settings read in `operations.md` §14 does it. What remains below is the record of why
it mattered, and two smaller items that still travel.

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

## Two per-firm migrations were re-stamped, one firm database had applied them, and the runtime now reconciles it (2026-09-15, resolved 2026-09-16)

Two migrations carried timestamp ids that sorted BELOW the migration they were merged after, so a
freshly provisioned firm would have applied them in an order no already-migrated firm ever used. They
were re-stamped to restore one apply order:

| Was                                                                | Is now                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `20260911T000000_office-email-address-lines-and-firm-brand-images` | `20260911T120001_office-email-address-lines-and-firm-brand-images` |
| `20260914T090000_event-conference-link`                            | `20260914T120001_event-conference-link`                            |

**A migration id is immutable once a database has applied it**, which is the rule
`packages/database/src/legacy-baselines.ts` states about its own list. The runner refuses a database
holding an applied tag it does not recognise — `database has applied migration "…" which this code
does not know` — so any per-firm database that applied either old id stopped waking the moment the
rename deployed.

**The premise the rename was taken on did not hold, and the entry that stood here said it did.** It
read: no firm is onboarded (per `operations.md`), the `DB_FIRM_POOL_*` databases are empty
pre-provisioning pools per ADR-0135, so the cost of the rename falls to zero and any affected
database is simply recreated. A firm database had applied the first of the two old ids. It refused
to wake from the 2026-09-15 deploy onwards, and the build-information panel reported it as
`Firm database: Not answering` with the runner's sentence for an unknown tag —
`deploy mismatch (code older than schema)` — which named the opposite of what had happened. The
deployment was _newer_ than the rename. Whether that database had also applied the second old id is
not visible from the outside and does not change the remedy: the runner reports only the FIRST
unknown tag in sort order, and reconciliation handles each independently.

**The remedy is no longer recreation.** `packages/database/src/re-stamped-migrations.ts` records the
two renames as data, and `runPendingMigrations` consults it before it refuses: the retired ledger row
is rewritten to the id the migration carries now, in one transaction, running no schema SQL. A
re-stamp moves the id and not the SQL, so the database already has the schema the new id names. Any
affected database — the firm's, a `tooling/seed-dev-firm.mjs` development firm, a preview
environment — reconciles itself on its next wake with no action here and nothing to preserve or
restore. **There is no owner action left in this item.**

**What to take from it.** "The affected databases can just be recreated" is a claim about the entire
fleet, checked once, at the moment it is most tempting to believe — and the per-firm database is a
firmId-addressed Durable Object, so acting on that claim means wiping durable storage or moving the
firm to a new id, not a drop and a re-provision. Treat the reconciling ledger rewrite as the remedy
and the recreation as the fallback, not the other way round. Renaming a deployed tag stays the last
resort: `tooling/migration-integrity` refuses an inverted apply order on every pull request, which is
the window where a rename is genuinely free, because nothing has applied it yet.

## Order-sensitive deploy hazards

1. **Retired — `magna-carta-sign` exists.** API-confirmed 2026-08-24: the sign worker is on the
   account and connected to Workers Builds.
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

   **Narrowed, 2026-09-01.** This is now a step for the SHARED platform bucket only. Per-firm buckets
   get `bundles/` (7 d), `conversions/` (24 h) and an abandoned-multipart abort (24 h) applied at
   provisioning by `apps/api-worker/src/firm-resource-provider.ts`, so a firm provisioned from here on
   needs no dashboard visit. The platform bucket predates that code and is not provisioned by it.

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

   **It is also Better Auth's `baseURL`, and that makes it worth setting on its own**, ahead of and
   independently of anything about mail. Unset, the library logs `Base URL is not set … callbacks and
   redirects may not work correctly` on every cold start and derives the origin from each incoming
   request — which is exactly what a background pass has no way to do. `createAuth` reads it when
   present and falls back to the request-derived default when absent (`apps/api-worker/src/auth.ts`),
   so local development and the test pool, which are reached at whatever host serves them, keep
   working unconfigured. Setting this var is what silences that warning in production.

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
- `magna-carta-edit`: **confirmed repointed and green.** The `slice-2-2-editing` leftover branch is
  gone and its root directory is `apps/edit-worker`; the branch it builds from now is not recorded
  here (branch-reconciliation item above). One drift found in exchange — its watch-path inclusion list read
  `apps/edit-worker` with no trailing `/*`, matching no file **under** the directory — and the
  owner fixed it on 2026-08-27 (now `apps/edit-worker/*`, API-confirmed). The same 2026-08-27 pass
  fixed the file-repair and recovery watch lists and the `magna-carta` deploy command; see their
  own entries.

## Blocked-in-environment owner chores

- Stale remote branch deletion — the definitive sweep, 2026-08-29. The git proxy denies ref
  deletions (a `git push --delete` returns 403 for every branch, not just some), so a session can
  classify but never delete; deletion happens in the web UI from
  <https://github.com/Phauks/magna-carta/branches>. Every remote branch was classified with the
  durable landing test in `tooling/branch-landing/` (where did the content land — an answer that
  survives squash-merges and never expires), cross-checked against GitHub pull-request merge
  records. Of 345 candidate branches (everything except `main`, `release`, and the stream that
  wrote this): **319 are safe to delete**, 4 are live, and 22 hold work that never landed and need
  an owner's judgment. This list replaces the shorter 2026-08-24 one, whose every entry it
  re-verified.

  **The one-time fix is a repository setting, not a chore.** Turning on GitHub's
  _Automatically delete head branches_ (Settings → General → Pull Requests) retires this item
  permanently: every future merge cleans up after itself, no session needs a permission it cannot
  have, and this list never regrows. Worth doing before the deletion pass, so this sweep is the
  last one.

  **Do not delete — live right now (4):**
  - `claude/community-board` — open PR #213 awaits the owner's two decisions
  - `claude/passive-dev-orchestrator-m7f9jw` — open PR #319; active stream in the registry
  - `docs-sync/2026-08-24` — open PR #382 (the pending docs-sync run)
  - `slice-0-7b-app-shell` — active stream in the registry (App Shell / auth UI, status building)

  **Owner to judge — never landed, deleting loses the work (22).** Each still holds content
  `main` does not have; delete only what is consciously abandoned:
  - `claude/worker-decoupling` — holds the merged squashes of #368 (auth-wiring split), #371 (PDF
    engine extraction) and #372 (decryption extraction); none of that is on `main`
    (`apps/api-worker/src/auth-wiring.ts` and `packages/pdf/src/service.ts` are absent there). The
    head of the undelivered extraction stack.
  - `claude/api-worker-rename` — PR #367 closed unmerged (the rename itself re-landed via
    `claude/api-worker-rename-v2` in `e5766cb8b`, #378), but it carries #368's squash, which never
    reached `main`
  - `claude/last-wasm-extractions` — follow-on to the extraction stack (2026-08-22), no PR
  - `claude/always-commit-ingest` — ingest fix (2026-08-22), no PR, nothing on `main`
  - `claude/sign-worker-wasm-build` — sign-Worker wasm build fix (2026-08-21), no PR
  - `claude/archive-reader-spec` — archive-reader design spec (2026-08-22), no PR, not on `main`
  - `claude/file-api-gaps` — file-manager API-gaps design (2026-08-22), no PR; stacked on the
    unlanded rename, so its diff is huge but its own content is the design docs
  - `claude/file-api-gaps-build` — the matching build (2026-08-22), no PR, same stack
  - `claude/file-manager-unknowns` — "six questions answered" doc (2026-08-22), no PR
  - `claude/ui-file-manager` — file-manager screen stream note (2026-08-21), no PR, same stack;
    likely superseded by the file-manager work that landed in #404, but not provably
  - `claude/vocabulary-listing-bounds` — (2026-08-21) same subject as what landed in `1c381258e`
    (#373); probably superseded, not provably
  - `claude/ui-workflow-research` — research decision (2026-08-11), no PR, its files not on `main`
  - `claude/github-actions-minutes-optimization-z0sfc1` — CI-minutes work (2026-07-17), no PR;
    likely superseded by the later CI austerity and gate-tiering merges
  - `docs-sync/2026-08-17` — PR #301 closed unmerged; its window is re-claimed by open PR #382, so
    it becomes safe the moment #382 merges
  - `file-surface-web` — its own registry note says abandoned, partly landed, superseded; judge
  - `file-inspector-spec` (2026-07-10), `ocr-raster-cap-and-skip-gate` (2026-07-12),
    `property-links-assessor` (2026-06-16), `safe-custody-design` (2026-06-16),
    `slice-3-5-operating-general-ledger` (2026-07-09), `subject-erasure-orchestrator` (2026-07-09),
    `whois-report-enrichment` (2026-07-12) — parked pre-August workspaces, no PRs, never landed

  **Safe to delete — the branch holds nothing `main` or a surviving branch lacks (11):**
  - `claude/discovery-5-1-2` — tip is a commit already on `main`
  - `claude/green-main-batch` — tip is a commit already on `main`
  - `claude/r2-matter-dimension` — tip is a commit already on `main`
  - `claude/sign-in-screen` — tip is a commit already on `main`
  - `claude/teardown-race` — held only its own registry note; the fix landed via
    `claude/teardown-fix` in `c96df603b` (#231)
  - `claude/decryption-engine-extraction` — PR #372 merged into `claude/worker-decoupling`
    2026-08-22; its content lives there (delete only together with a decision on that branch)
  - `claude/pdf-engine-extraction` — PR #371 merged into `claude/worker-decoupling` 2026-08-22;
    same dependency
  - `claude/discovery-search-index` — tip is an ancestor of `claude/search-write-pipeline`, which
    landed in `0d72292e8` (#61)
  - `docs-assembly` — bot workspace, force-pushed anew by `assemble-docs.yml` each run; latest
    PR #172 closed 2026-08-12
  - `docs-sync/2026-07-20` — PR #41 closed unmerged 2026-08-04; window re-claimed by later merged
    runs
  - `docs-sync/2026-08-10` — PR #186 closed unmerged 2026-08-12; window re-claimed by the merged
    2026-08-12 run

  **Safe to delete — landed (308; the named commit is where the branch's content entered
  `main`):**
  - `claude/2-5-analysis-prep-0n2kxw` — landed in `679841052` (#58)
  - `claude/account-role-widening` — landed in `b2d1cd328` (#401)
  - `claude/active-work-sweep` — landed in `6ea04e8f0` (#200)
  - `claude/advisories` — landed in `d5dd7199f` (#212)
  - `claude/advisory-resolution` — landed in `c69ece9c5` (#77)
  - `claude/ai-search-1` — landed in `314856235` (#290)
  - `claude/ai-search-wall-experiment` — landed in `ffe04e0f0` (#176)
  - `claude/api-worker-rename-v2` — landed in `e5766cb8b` (#378)
  - `claude/assets-next` — landed in `067cd52f1` (#286)
  - `claude/auth-routes` — landed in `1194c26d1` (#203)
  - `claude/auto-file-management` — landed in `80f9e186d` (#325)
  - `claude/auto-file-review-exact-counts` — landed in `37e682b13` (#355)
  - `claude/auto-file-rules-design` — landed in `707f7c706` (#134)
  - `claude/auto-file-rules-slice-1` — landed in `57a0b6795` (#142)
  - `claude/auto-file-wiring` — landed in `6ff4a7ee3` (#166)
  - `claude/automation-conditionals-slice` — landed in `a98c78dfa` (#100)
  - `claude/automation-consent-refinements` — landed in `08efa6035` (#94)
  - `claude/automation-directory-role-sources` — landed in `31d189510` (#121)
  - `claude/automation-letterhead-custom-fields` — landed in `6f422b1d3` (#109)
  - `claude/automation-protected-value-binding` — landed in `645f20476` (#129)
  - `claude/automation-tail` — landed in `c277d8293` (#214)
  - `claude/awaiting-owner-sweep` — landed in `d35ae5161` (#260)
  - `claude/billing-3-4-2-trust-application` — landed in `d0d12791f` (#161)
  - `claude/billing-3-4-design` — landed in `5e611bea7` (#135)
  - `claude/billing-automations-design` — landed in `d17b40fb1` (#293)
  - `claude/billing-fee-models` — landed in `846dbd4e2` (#185)
  - `claude/billing-listing-bounds` — landed in `6655e73bc` (#350)
  - `claude/billing-slice-1` — landed in `c97d8bdd6` (#143)
  - `claude/bound-the-unbounded-reads` — landed in `21642d0ed` (#344)
  - `claude/bounded-matter-listings` — landed in `53b529d6c` (#342)
  - `claude/build-register` — landed in `12cf5e1c1` (#230)
  - `claude/calendar-listing-bounds` — landed in `d88b6f3d6` (#353)
  - `claude/calendar-slice-2` — landed in `681f4b987` (#187)
  - `claude/calendar-slice-2-design` — landed in `8dd7764db` (#179)
  - `claude/case-calendar-design` — landed in `c63d92650` (#131)
  - `claude/case-calendar-slice-1` — landed in `7bee08017` (#144)
  - `claude/catalog-follow-ups` — landed in `5f0f26839` (#182)
  - `claude/catalog-slices-2-4` — landed in `8d98eca03` (#177)
  - `claude/check-order` — landed in `cc5479fdb` (#281)
  - `claude/ci-austerity` — landed in `0c18ef102` (#103)
  - `claude/ci-cost-reduction` — landed in `6b684e8c4` (#47)
  - `claude/ci-fail-fast` — landed in `a4f2724b5` (#404)
  - `claude/ci-runner` — landed in `51d46e4c7` (#275)
  - `claude/clean-squash-merge` — landed in `c32fcee03` (#221)
  - `claude/closure-and-batch-bounds` — landed in `fcb7fad7a` (#269)
  - `claude/cloudflare-agents-research` — landed in `1efee24c3` (#91)
  - `claude/cloudflare-ai-search-research` — landed in `40a87ac4c` (#155)
  - `claude/cloudflare-ci-evaluation` — landed in `7596e91b6` (#104)
  - `claude/community-design` — landed in `60d5b0bf6` (#201)
  - `claude/community-slice-1` — landed in `bc01a6932` (#209)
  - `claude/composite-text-extraction` — landed in `b7e015475` (#140)
  - `claude/conflicts-4` — landed in `e01afeeaf` (#291)
  - `claude/conflicts-deepening` — landed in `8fcdb8aef` (#217)
  - `claude/conflicts-slice-1` — landed in `a71fdef10` (#220)
  - `claude/conflicts-slice-2` — landed in `e104255df` (#226)
  - `claude/conflicts-traversal` — landed in `5995edb01` (#268)
  - `claude/conformance-inventory` — landed in `1c381258e` (#373)
  - `claude/console-ban` — landed in `ec8500e1d` (#276)
  - `claude/content-controls` — landed in `ff1f49e36` (#255)
  - `claude/credit-notes` — landed in `ee1d92bf6` (#215)
  - `claude/cron-trigger-bypass` — landed in `4adf7d543` (#365)
  - `claude/custodian-4-2-4-stocktake` — landed in `c2dac01b7` (#118)
  - `claude/custodian-build-slice-1` — landed in `c3e260ab9` (#86)
  - `claude/custodian-build-slice-2` — landed in `a97e0bf76` (#98)
  - `claude/custodian-build-slice-3` — landed in `f03fb4d52` (#110)
  - `claude/custodian-design` — landed in `93435534f` (#81)
  - `claude/custodian-destruction-c8-catalog` — landed in `946e42bcf` (#138)
  - `claude/custody-listing-bounds` — landed in `86e99a07e` (#346)
  - `claude/dead-seams` — landed in `67f393333` (#263)
  - `claude/decision-register-repair` — landed in `ccdb05f05` (#84)
  - `claude/dependency-refresh` — landed in `f08d57cfb` (#48)
  - `claude/deploy-queue-0825` — landed in `3df57822c` (#400)
  - `claude/deploy-queue-2026-08-24` — landed in `d31c2dc66` (#389)
  - `claude/deploy-queue-pagination-envelopes` — landed in `0832f34d6` (#352)
  - `claude/deploy-queue-refresh` — landed in `36c38e6be` (#377)
  - `claude/deploy-unblock` — landed in `54f8d5861` (#357)
  - `claude/directory-pronouns` — landed in `953e9a0c4` (#196)
  - `claude/discovery-5-1-1` — landed in `0377a9b9f` (#150)
  - `claude/discovery-5-1-4` — landed in `528d2a8d8` (#321)
  - `claude/discovery-5-1-design` — landed in `75d948f8f` (#136)
  - `claude/discovery-5-2-1` — landed in `1e73ca7ed` (#195)
  - `claude/discovery-5-2-design` — landed in `bda5eb48c` (#184)
  - `claude/discovery-listing-bounds` — landed in `45a606826` (#348)
  - `claude/discovery-processing` — landed in `477158b38` (#272)
  - `claude/discovery-remainder` — landed in `cd1f54361` (#287)
  - `claude/doc-and-tooling-fixes` — landed in `a888b038d` (#256)
  - `claude/docs-pipeline-followups` — landed in `ff3676b0f` (#72)
  - `claude/docs-sync-routine-setup-c3hy7m` — landed in `79ecde769` (direct commit: fix(ci): assembly fails loudly on missing PR permissions;...)
  - `claude/document-automation-design` — landed in `b3d2a1313` (#78)
  - `claude/document-automation-slice-1` — landed in `3573106da` (#88)
  - `claude/document-surface` — landed in `c164cc0c1` (#204)
  - `claude/drizzle-snapshot-repair` — landed in `fec8e67f1` (#102)
  - `claude/edit-worker-rename` — landed in `d728f1348` (#359)
  - `claude/email-add-in-client-api` — landed in `6f39969ae` (#123)
  - `claude/email-capabilities-analysis-y06ji3` — landed in `623443f92` (#31)
  - `claude/email-capture-mint-route` — landed in `c31485390` (#56)
  - `claude/email-filing-capture-slice-1-h03vp5` — landed in `645be7a15` (#37)
  - `claude/email-filing-fast-follows` — landed in `5ae076e7a` (#106)
  - `claude/escheat-research` — landed in `380ef0fe1` (#181)
  - `claude/evidence-absence-rule` — landed in `6a5dc585c` (#258)
  - `claude/exhibit-lists` — landed in `2aa79d24a` (#202)
  - `claude/expression-aggregates` — landed in `18c239158` (#111)
  - `claude/expression-grammar-design` — landed in `f3d0ae2d3` (#92)
  - `claude/extraction-rubric-home` — landed in `b628d3aa4` (#369)
  - `claude/field-input-infrastructure` — landed in `f320eeadf` (#87)
  - `claude/file-manager-error-view` — landed in `aefcf3655` (#384)
  - `claude/file-manager-in-the-app` — landed in `acd14e24b` (#386)
  - `claude/file-manager-live-fixes` — landed in `a4f2724b5` (#404)
  - `claude/file-manager-residue` — landed in `5c286837a` (#75)
  - `claude/file-manager-round-eight` — landed in `80340a131` (#385)
  - `claude/file-manager-round-seven` — landed in `ad72a8f6d` (#380)
  - `claude/file-manager-rulings` — landed in `ecfddb838` (#375)
  - `claude/file-manager-search` — landed in `7b3233db2` (#381)
  - `claude/file-version-uploader-pii` — landed in `f88203e55` (#370)
  - `claude/financial-reporting` — landed in `7db7f6500` (#216)
  - `claude/financial-reporting-1` — landed in `cb9225bb5` (#248)
  - `claude/fitness-gate` — landed in `cda21cea6` (#288)
  - `claude/fix-batch-r1-financial` — landed in `927526d06` (#154)
  - `claude/fix-batch-r2-operational` — landed in `1dc729667` (#157)
  - `claude/fix-custom-fields-value-integrity` — landed in `06188cbdd` (#51)
  - `claude/fix-directory-merge-integrity` — landed in `67799cac2` (#52)
  - `claude/fix-editing-wopi-guards` — landed in `dbba9bc6b` (#55)
  - `claude/fix-federation-typecheck` — landed in `7293f289e` (#194)
  - `claude/fix-ingest-custody` — landed in `b44b5d067` (#60)
  - `claude/fix-matters-numbering` — landed in `4914686ee` (#57)
  - `claude/fix-metadata-scrub-hardening` — landed in `64fed3ead` (#53)
  - `claude/fix-pdf-core-annots` — landed in `aa9223557` (#49)
  - `claude/fix-scoped-autofix-vp-test` — landed in `50d53aa6f` (#114)
  - `claude/fix-shipping-whois` — landed in `d36fa5e50` (#62)
  - `claude/fix-tenancy-shipping-uploads` — landed in `06f14facf` (#45)
  - `claude/fix-usage-bundle-scan-trio` — landed in `7231610cd` (#44)
  - `claude/format-main-six` — landed in `7c3ef7054` (#193)
  - `claude/gate-collection-audit` — landed in `2e5f1ee6e` (#119)
  - `claude/gate-integrity` — landed in `81d66c190` (#296)
  - `claude/gate-yml-review-e5q19j` — landed in `a4f2724b5` (#404)
  - `claude/general-ledger-design` — landed in `aeb7ce208` (#309)
  - `claude/handover-verify-recipe` — landed in `a4f2724b5` (#404)
  - `claude/harness-honesty` — landed in `e5d60bd0d` (#313)
  - `claude/honest-signals` — landed in `e003ea13a` (#311)
  - `claude/idempotency-audit-load-profile` — landed in `15f46deb1` (#112)
  - `claude/index-fixes` — landed in `8eed71c61` (#243)
  - `claude/index-scope-key-widening` — landed in `aae4ece25` (#147)
  - `claude/intake-design` — landed in `85140ca76` (#257)
  - `claude/invitation-oracle` — landed in `dab17fe3b` (#207)
  - `claude/invoice-delivery` — landed in `1161e54ce` (#303)
  - `claude/kitesurf-assessment` — landed in `82589900e` (#190)
  - `claude/ledger-accuracy` — landed in `d54995918` (#249)
  - `claude/ledger-flag-visibility` — landed in `f8c294ef0` (#320)
  - `claude/ledger-staleness` — landed in `4feb0ed56` (#238)
  - `claude/ledger-status-reconciliation` — landed in `c006c9a58` (#324)
  - `claude/ledger-verification-sweep` — landed in `6e4af19c0` (#323)
  - `claude/legacy-form-fields` — landed in `489d4225a` (#251)
  - `claude/libreoffice-engine-build` — landed in `5a4338c81` (#66)
  - `claude/libreoffice-engine-design` — landed in `f65a8f809` (#59)
  - `claude/lint-dependency-fanout` — landed in `97233438a` (#132)
  - `claude/linter-evaluation-yugrzm` — landed in `84a3bde67` (#32)
  - `claude/linter-ruleset-reconciled` — landed in `d76330925` (#80)
  - `claude/load-profile-gap` — landed in `e3ab95ed9` (#241)
  - `claude/login-polish` — landed in `9b24c67d9` (#358)
  - `claude/magnus-design` — landed in `15e4aee84` (#156)
  - `claude/magnus-slice-1` — landed in `8fd3ea9ae` (#159)
  - `claude/matter-assets-design` — landed in `0703e8195` (#130)
  - `claude/matter-assets-slice-1` — landed in `324664c94` (#149)
  - `claude/matter-calendar-reachable` — landed in `8b9af7818` (#338)
  - `claude/matter-costs-reachable` — landed in `64bf9f44f` (#335)
  - `claude/matter-parties-reachable` — landed in `f5429ecba` (#330)
  - `claude/matter-read-widening` — landed in `c666062a0` (#331)
  - `claude/matter-screens-handover` — landed in `5c47ffc77` (#387)
  - `claude/matter-sections-stale-state` — landed in `187ab189d` (#340)
  - `claude/matter-time-reachable` — landed in `4d69bb56b` (#333)
  - `claude/merge-field-catalog-design` — landed in `f98d503fc` (#127)
  - `claude/merge-field-catalog-slice-1` — landed in `dd078b99c` (#146)
  - `claude/missing-ledger-nodes` — landed in `6beeb58ef` (#265)
  - `claude/model-pin-rot` — landed in `c692886aa` (#240)
  - `claude/nevada-court-forms` — landed in `af86c70bb` (#247)
  - `claude/nevada-trust-corpus` — landed in `132b66145` (#174)
  - `claude/nevada-will-custody-research` — landed in `d6a95737c` (#128)
  - `claude/notes-and-tasks-design` — landed in `dd2ac00dc` (#259)
  - `claude/notification-dedupe` — landed in `5ac8797ec` (#305)
  - `claude/notifications-2` — landed in `04a49fc94` (#273)
  - `claude/notifications-3` — landed in `9da23568b` (#278)
  - `claude/notifications-4` — landed in `f5a327458` (#284)
  - `claude/notifications-delivery-1` — landed in `450038142` (#175)
  - `claude/notifications-delivery-design` — landed in `37ea40c92` (#162)
  - `claude/ocr-creation-next-steps-6yko0b` — landed in `014938a4b` (#30)
  - `claude/one-core-runners` — landed in `5077a2e54` (#107)
  - `claude/overnight-small-batch` — landed in `04ff6c5da` (#93)
  - `claude/owner-answered-batch` — landed in `f4b90ecad` (#236)
  - `claude/owner-docket-answers` — landed in `110003ea8` (direct commit: docs: record the owner's complete decision-docket answers...)
  - `claude/payments-design` — landed in `5184145ef` (#254)
  - `claude/pdf-active-content-analysis` — landed in `a4f2724b5` (#404)
  - `claude/pdf-form-templates` — landed in `39e1a9ec8` (#299)
  - `claude/pii-registry-email-tables` — landed in `08544e221` (#43)
  - `claude/pin-prefer-set-has` — landed in `a4f2724b5` (#404)
  - `claude/public-roadmap` — landed in `3022b4b3e` (#227)
  - `claude/push-progress-websockets` — landed in `10344b98b` (#101)
  - `claude/reconciliation-defects` — landed in `41ca91033` (#246)
  - `claude/register-artifact` — landed in `db62ca519` (#298)
  - `claude/register-history` — landed in `112c13a37` (#245)
  - `claude/register-history-rebuild` — landed in `a62656648` (#398)
  - `claude/register-missing-nodes` — landed in `3efca761e` (#250)
  - `claude/registration-screens` — landed in `90e175edb` (#206)
  - `claude/registry-liveness` — landed in `fc110f24a` (#271)
  - `claude/replace-office-crypto` — landed in `3239d7839` (#95)
  - `claude/repo-status-roadmap-xhdvyb` — landed in `eb5522105` (#54)
  - `claude/retire-account-role-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-auto-file-review-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-billing-listing-bounds` — landed in `a4f2724b5` (#404)
  - `claude/retire-bounded-listings-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-calendar-listing-bounds` — landed in `a4f2724b5` (#404)
  - `claude/retire-costs-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-custody-listing-bounds` — landed in `a4f2724b5` (#404)
  - `claude/retire-discovery-listing-bounds` — landed in `a4f2724b5` (#404)
  - `claude/retire-discovery-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-landed-notes` — landed in `a4f2724b5` (#404)
  - `claude/retire-landed-notes-0825` — landed in `8fcf94d84` (#393)
  - `claude/retire-matter-calendar-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-matter-read-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-parties-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-register-history-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-silent-caps-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-stale-state-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-time-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-ui-loop-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-unbounded-reads-note` — landed in `a4f2724b5` (#404)
  - `claude/retire-unpaged-note` — landed in `a4f2724b5` (#404)
  - `claude/review-campaign-2-automation` — landed in `78ab265e9` (#152)
  - `claude/review-campaign-2-financial` — landed in `120367c23` (#153)
  - `claude/review-campaign-2-operational` — landed in `ad6721dd3` (#151)
  - `claude/roadmap-condense` — landed in `b779e5d41` (#252)
  - `claude/roadmap-currency` — landed in `556bb001c` (#280)
  - `claude/save-new-version-analysis` — landed in `c9832cc2e` (#383)
  - `claude/search-compaction` — landed in `5eaa67525` (#223)
  - `claude/search-perf-stats` — landed in `801f4233c` (#222)
  - `claude/search-r2-adapter` — landed in `f30366ad0` (#232)
  - `claude/search-write-pipeline` — landed in `0d72292e8` (#61)
  - `claude/self-serve-tier-design` — landed in `a48a02c58` (#191)
  - `claude/semantic-convergence` — landed in `dc5083194` (#235)
  - `claude/shipment-refusal` — landed in `07e3e6d1f` (#266)
  - `claude/sign-in-password-placeholder` — landed in `c33b5683f` (#364)
  - `claude/sign-in-transposition` — landed in `d1305300e` (#198)
  - `claude/signals-that-lie` — landed in `f9fba9448` (#270)
  - `claude/silent-caps` — landed in `de295a5ff` (#396)
  - `claude/small-fixes` — landed in `769c0c38c` (#239)
  - `claude/snapshot-format` — landed in `a4f2724b5` (#404)
  - `claude/snapshot-gate` — landed in `ef7f59508` (#279)
  - `claude/snapshot-provenance` — landed in `eb1129f27` (#242)
  - `claude/spa-worker-split-design` — landed in `fdfeee638` (#360)
  - `claude/stale-absence-comments` — landed in `6a6e5f6e5` (#262)
  - `claude/stale-branch-report` — landed in `8f3c4ecad` (#391)
  - `claude/stale-truths` — landed in `4ccc82292` (#307)
  - `claude/statement-import-design` — landed in `5be4e097c` (#244)
  - `claude/status-page-uptime` — landed in `f325b2e88` (#192)
  - `claude/status-pointers` — landed in `e4a09ce2e` (#283)
  - `claude/status-render-gate` — landed in `74b33d5be` (#253)
  - `claude/stub-masked-wiring` — landed in `1a2d3f1d0` (#267)
  - `claude/teardown-fix` — landed in `c96df603b` (#231)
  - `claude/telemetry-runtime-batch` — landed in `d42cdeadb` (#74)
  - `claude/telemetry-sweep-ledger` — landed in `4e2c941e9` (#64)
  - `claude/test-race-pair` — landed in `a55502c4f` (#180)
  - `claude/test-typecheck` — landed in `905cad042` (#282)
  - `claude/tooling-friction` — landed in `1760fb520` (#302)
  - `claude/tooling-hygiene-batch` — landed in `13534cd48` (#82)
  - `claude/tooling-seams-batch` — landed in `e2f95b812` (#68)
  - `claude/tools-reality-check` — landed in `9bd40bd75` (#264)
  - `claude/translation-services-design` — landed in `f96a7e0f1` (#188)
  - `claude/trust-3-2-2-movements` — landed in `3031ed5f4` (#115)
  - `claude/trust-accounting-analysis` — landed in `26cfcce52` (#97)
  - `claude/trust-authority` — landed in `bafaf62d8` (#199)
  - `claude/trust-authority-design` — landed in `b3c99fdb1` (#189)
  - `claude/trust-authorization-policy` — landed in `93eee6c50` (#178)
  - `claude/trust-follow-ups` — landed in `f3285e9af` (#183)
  - `claude/trust-ledger-slice-1` — landed in `a0130bbf3` (#105)
  - `claude/trust-matter-close-precondition` — landed in `c83525c3c` (#124)
  - `claude/trust-reconciliation` — landed in `f4a6b84e2` (#139)
  - `claude/trust-routes` — landed in `9b6018ef2` (#210)
  - `claude/trust-tier1` — landed in `e19cb99d1` (#208)
  - `claude/trust-two-person-authorization` — landed in `4cf722bd0` (#137)
  - `claude/tsconfig-refs-fix` — landed in `a4f2724b5` (#404)
  - `claude/turnstile` — landed in `3a75b0315` (#274)
  - `claude/typecheck-gap` — landed in `fe7ba53a1` (#277)
  - `claude/ui-build-loop` — landed in `fd50acaf6` (#328)
  - `claude/undeclared-body-contract-fix` — landed in `3b4f6301c` (#117)
  - `claude/ungranted-permissions` — landed in `456468672` (#327)
  - `claude/unified-identity` — landed in `a9ddc965d` (#219)
  - `claude/unpaged-listings-remainder` — landed in `7f3f5e2ea` (#394)
  - `claude/unwritable-settings` — landed in `5b40f7518` (#326)
  - `claude/vpn-assessment` — landed in `0b8b69b0a` (#197)
  - `claude/waiting-on-you-order` — landed in `45396f306` (#261)
  - `claude/web-lib-alias` — landed in `a4f2724b5` (#404)
  - `claude/web-worker-split` — landed in `efe965f38` (#361)
  - `claude/worker-first-routing` — landed in `cb190170e` (#362)
  - `claude/worker-followups-batch` — landed in `7cbfb2034` (#69)
  - `claude/worker-topology-spec` — landed in `444a9aa0c` (#366)
  - `claude/worker-typecheck` — landed in `3724983f8` (#285)
  - `conflicts-co-party-hits` — landed in `20036e4db` (#33)
  - `deps/coupled-major-bumps` — landed in `a2d8194da` (#15)
  - `docs-sync/2026-08-04` — landed in `31f5b5f79` (#63)
  - `docs-sync/2026-08-12` — landed in `a4f2724b5` (#404)
  - `fix-assembly-format-output` — landed in `91b857323` (direct commit: fix(ci): format assembled docs output before opening the ...)
  - `fix-assembly-push-no-verify` — landed in `a4f2724b5` (#404)
  - `fix-pnpm-audit-endpoint-retirement` — landed in `9b87b7211` (direct commit: fix(ci): use pnpm's --ignore-registry-errors instead of a...)
  - `lint-scope-ignore-workflow-yaml` — landed in `0ee43b8a9` (#39)
  - `osv-gate-hardening` — landed in `62b1aec78` (direct commit: security: harden the osv-scanner audit gate and retire lo...)
  - `osv-scanner-audit-gate` — landed in `8358f9274` (direct commit: feat(ci): audit both supply chains with osv-scanner (npm ...)
  - `remediate-lopdf-advisory` — landed in `ed2723b6b` (#35)
  - `slice-4-1-conflicts` — landed in `1500135bd` (#22)
  - `sweep-active-work-conflicts-co-party` — landed in `a4f2724b5` (#404)

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
(`runDirectoryNameIndexBackfill` in `apps/api-worker/src/background/scheduled.ts`, 500 name rows per firm per
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
(`apps/api-worker/src/background/assemblies/template-orphan-sweep.ts`) therefore **skips the staging prefix by
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
