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

## Owner steps

1. ~~Create `release` at the currently-deployed commit.~~ **Done 2026-07-09** — `release` exists on
   origin at `0988844` (= `origin/main`, at or ahead of every Worker's last successful deploy).
   Creating it triggered no build: `previews_enabled` is false on all seven.
2. **OWED — owner must do this.** For each of `magna-carta`, `magna-carta-scan`,
   `magna-carta-bundle`, `magna-carta-recovery`, `magna-carta-file-repair`, `magna-carta-status`,
   `magna-carta-edit`: set the production branch to `release`
   (**Settings → Build → Branch control**). _Builds for non-production branches_ is already off
   everywhere; leave it off. The repo's Cloudflare API token is **read-only** — `GET` on
   `/accounts/{account_id}/builds/workers/{script_tag}` reads the config, but the `PATCH` that
   writes `{"git_repository":{"branch":"release"}}` returns `10000: Authentication error`. Either
   use the dashboard or run the PATCH with a token carrying Workers Builds write scope.
3. Only then push `main` freely. **Until step 2 is done, a push to `main` still deploys** — and
   local `main` is one commit ahead of origin.

## Found while auditing the live build configuration (not fixed here)

- `magna-carta-edit`'s production branch is **`slice-2-2-editing`**, not `main`, and it has failed
  every build since 2026-06-28 (eight consecutive; last success 2026-06-26). The live editing Worker
  is older than the trunk. Needs its own diagnosis.
- `magna-carta-file-repair` watch paths include `containers/file-repair-worker/*` — **that directory
  does not exist** (it is `containers/file-repair/`), so the container never rebuilds on a change.
- `magna-carta-recovery` watch paths omit `crates/decryption-core/*`, a path dependency of its
  Dockerfile, so a change to that crate alone never rebuilds the recovery container.
- `magna-carta-convert` is not connected to Workers Builds at all (zero builds recorded).
- `status-lab/` was committed unformatted in `b0b00d5`, so `pnpm check` — and therefore the
  `pre-push` hook — has been failing on `main` for every worktree. Fixed on this branch.
