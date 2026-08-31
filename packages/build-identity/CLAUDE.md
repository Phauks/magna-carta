# @magna-carta/build-identity — CLAUDE.md

**Purpose.** The build identity every deployed Worker knows about itself — the git commit it was
built from, that commit's time, and the build time — plus the tiny `GET /__version` route each
dedicated Worker exposes so the app Worker's aggregate version endpoint
(`GET /api/v1/meta/versions`) can ask what is actually running. The web app does not use the
package's runtime exports: its identity is baked in by vite define (`apps/web/vite.config.ts` →
`apps/web/src/lib/build-identity.ts`), but that define, the SPA's static `/__version` asset
(`apps/web/scripts/emit-version-asset.mjs` — the assets-only `magna-carta-web` Worker's version
answer), and the SvelteKit version-poll name (`apps/web/svelte.config.js`) all resolve the commit
through this package's `scripts/commit-identity.mjs`, the one shared resolution.

## Key files

- `src/build-identity-values.generated.ts` — the values. **Checked in as the honest "dev"
  placeholder**; each Worker's deploy build regenerates it (throwaway CI checkout) so the
  `wrangler deploy` that follows bundles the real commit. Never commit a stamped copy.
- `src/build-identity.ts` — the `BuildIdentity` type and the resolved `BUILD_IDENTITY`.
- `src/version-route.ts` — `VERSION_ROUTE_PATH`, `isVersionRequest`, `versionResponse`.
- `scripts/commit-identity.mjs` — the shared "which commit is this build from" resolution (git
  first, the build runner's commit variable second), used by the stamp below, the web app's vite
  define, its static version asset, and its version-poll name. Its hand-written declaration
  (`commit-identity.d.mts`) must be kept in step.
- `scripts/generate-build-identity.mjs` — the stamping step, prepended to every Worker package's
  `build` script. Writes only under CI (`CI`/`WORKERS_CI`) or `--force`, so a local build never
  dirties the tree with an identity that would go stale.

## Invariants

- **A missing identity is "dev", never a guess.** No commit source, no CI → the placeholder stands.
  A stale stamped commit is a false claim; "dev" is a true one. Two sources count as naming the
  commit, in order: git in the checkout, then the build runner's own variable
  (`WORKERS_CI_COMMIT_SHA`, `GITHUB_SHA`) for a runner whose tree git cannot answer for. The second
  is the checkout system stating what it checked out, not an inference — and it abbreviates to its
  own length, which is why the overlay compares commits by prefix rather than by equality.
- **The version route carries no auth; what that means depends on where it is mounted.** On the
  internal siblings the service binding is the trust boundary. Two publicly routable Workers mount
  it deliberately: `magna-carta-status` (the public status page) and `magna-carta-edit` (the
  browser loads the editor from it). Both answer a build commit and two timestamps — the same
  identity the web app already shows signed-out visitors on the sign-in screen's chip — so the
  disclosure is nothing new; a Worker whose identity would say more than that still needs a guard
  before mounting it publicly. The assets-only `magna-carta-web` cannot mount a route at all: its
  answer is the static `/__version` file the SPA build emits (also served, harmlessly, on the app
  origin by the app Worker's asset layer).
- **A Worker only reports a version if it was built with the version route in it.** A sibling
  deployed from a commit that predates `src/version-route.ts` answers 404 on `/__version`, which
  the aggregate reads as `unreported` and the overlay renders as "Not reporting" — an honest
  answer, and a confusing one, because the Worker is healthy. Whatever brings the route into a
  Worker's build must therefore reach it: `packages/build-identity/*` belongs in every dedicated
  Worker's Cloudflare Build Watch Paths, or a change here never rebuilds them. See
  [`docs/conventions/operations.md`](../../docs/conventions/operations.md), _Cloudflare Workers
  Builds_.
- **Every Worker answers the same shape** (`commit`, `commitTime`, `buildTime`, nullable
  timestamps). The app Worker's aggregate read zod-parses it; changing the shape means changing
  the parser and every consumer in the same commit.
