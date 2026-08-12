# Deploy queue — owner actions pending

Production deploys are deliberate (`git push origin main:release`) and are
**never made by the orchestration session**. This document accumulates what is
waiting on the owner: the undeployed merge queue plus the account-side
dashboard steps that no session can perform. Kept current by the
orchestration stream; check `git log release..main` for the live commit delta.

_Last updated: 2026-08-12 (the editor deploy now gates a reachable screen)._

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

- Stale remote branch deletion (the git proxy denies ref deletions). Safe to
  delete: `osv-scanner-audit-gate`, `fix-assembly-format-output`,
  `fix-assembly-push-no-verify`, `fix-pnpm-audit-endpoint-retirement`,
  `docs-assembly-retrigger`, `claude/docs-sync-routine-setup-c3hy7m`,
  `lint-scope-ignore-workflow-yaml`, plus any branch whose pull request has
  since merged (`docs-sync/2026-07-20` after #41's closure).

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
