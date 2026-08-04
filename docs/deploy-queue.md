# Deploy queue — owner actions pending

Production deploys are deliberate (`git push origin main:release`) and are
**never made by the orchestration session**. This document accumulates what is
waiting on the owner: the undeployed merge queue plus the account-side
dashboard steps that no session can perform. Kept current by the
orchestration stream; check `git log release..main` for the live commit delta.

_Last updated: 2026-08-04._

## Position

- Production is `release` @ `0988844` (2026-07-04). `main` is several hundred
  commits ahead and growing; everything below rides the next push.

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
