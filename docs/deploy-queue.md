# Deploy queue — owner actions pending

Production deploys are deliberate (`git push origin main:release`) and are
**never made by the orchestration session**. This document accumulates what is
waiting on the owner: the undeployed merge queue plus the account-side
dashboard steps that no session can perform. Kept current by the
orchestration stream; check `git log release..main` for the live commit delta.

_Last updated: 2026-08-04 (second pass — tenancy fixes merged)._

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

- Stale remote branch deletion (the git proxy denies ref deletions). Safe to
  delete: `osv-scanner-audit-gate`, `fix-assembly-format-output`,
  `fix-assembly-push-no-verify`, `fix-pnpm-audit-endpoint-retirement`,
  `docs-assembly-retrigger`, `claude/docs-sync-routine-setup-c3hy7m`,
  `lint-scope-ignore-workflow-yaml`, plus any branch whose pull request has
  since merged (`docs-sync/2026-07-20` after #41's closure).
