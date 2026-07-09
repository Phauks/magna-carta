# deploy-release-branch

**Branch:** `deploy-release-branch` · **Off:** main (cc84264) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-09

## Scope

Decouple source control from deployment. The Workers Builds production branch moves from `main` to
`release` on all seven connected Workers, so a push or merge to `main` reaches GitHub without
rebuilding or redeploying anything on Cloudflare. Deploying becomes the explicit fast-forward
`git push origin main:release`.

Docs-only on this branch — the switch itself is a per-Worker dashboard setting the owner applies.

## Files I expect to touch

- `docs/conventions/operations.md` — new "Branch control" subsection; the connected-Worker list
  corrected to all seven (adds `magna-carta-status`, `magna-carta-edit`; notes `magna-carta-convert`
  is not connected)
- `docs/decisions/pending/deploy-production-branch-release.md` (ADR fragment)
- `changelog.d/deploy-production-branch-release.md`

## Coordination

Touches a cross-cutting file (`docs/conventions/operations.md`) — §12 only, no overlap declared by
another stream. **Every other stream is affected once this lands:** merging to `main` stops
deploying, so anyone expecting a merge to ship must fast-forward `release`.

## Owner steps (dashboard — cannot be done from here; the Cloudflare token in-repo is read-only)

Order matters. Do 1 before 2, or the flip queues a build of unshipped trunk work.

1. Create `release` at the currently-deployed commit: `git push origin <deployed-sha>:refs/heads/release`
   (as of this writing the deployed commit is `0988844`, which is `origin/main`).
2. For each of `magna-carta`, `magna-carta-scan`, `magna-carta-bundle`, `magna-carta-recovery`,
   `magna-carta-file-repair`, `magna-carta-status`, `magna-carta-edit`:
   **Settings → Build → Branch control** → production branch `release`; uncheck
   _Builds for non-production branches_ (verify, do not assume — `magna-carta-edit` has a recorded
   build from branch `slice-2-2-editing`).
3. Only then push `main` freely.

## Found while auditing (not fixed here)

- `magna-carta-edit` has **failed every `main` build since 2026-06-28** (eight consecutive; last
  success 2026-06-26). The live editing Worker is older than the trunk. Needs its own diagnosis.
- `magna-carta-convert` is not connected to Workers Builds at all (zero builds recorded).
