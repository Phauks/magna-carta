# @magna-carta/build-identity — CLAUDE.md

**Purpose.** The build identity every deployed Worker knows about itself — the git commit it was
built from, that commit's time, and the build time — plus the tiny `GET /__version` route each
dedicated Worker exposes over its service binding so the app Worker's aggregate version endpoint
(`GET /api/v1/meta/versions`) can ask what is actually running. The web app does not use this
package: its identity is baked in by vite define (`apps/web/vite.config.ts` →
`apps/web/src/lib/build-identity.ts`).

## Key files

- `src/build-identity-values.generated.ts` — the values. **Checked in as the honest "dev"
  placeholder**; each Worker's deploy build regenerates it (throwaway CI checkout) so the
  `wrangler deploy` that follows bundles the real commit. Never commit a stamped copy.
- `src/build-identity.ts` — the `BuildIdentity` type and the resolved `BUILD_IDENTITY`.
- `src/version-route.ts` — `VERSION_ROUTE_PATH`, `isVersionRequest`, `versionResponse`.
- `scripts/generate-build-identity.mjs` — the stamping step, prepended to every Worker package's
  `build` script. Writes only under CI (`CI`/`WORKERS_CI`) or `--force`, so a local build never
  dirties the tree with an identity that would go stale.

## Invariants

- **A missing identity is "dev", never a guess.** No git, no CI → the placeholder stands. A stale
  stamped commit is a false claim; "dev" is a true one.
- **The version route is service-binding-only surface.** No sibling Worker is publicly routable;
  the route carries no auth because the binding is the trust boundary. Do not mount it on a
  publicly routed Worker without adding a guard.
- **Every Worker answers the same shape** (`commit`, `commitTime`, `buildTime`, nullable
  timestamps). The app Worker's aggregate read zod-parses it; changing the shape means changing
  the parser and every consumer in the same commit.
