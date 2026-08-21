---
category: Fixed
audience: internal
---

**The `magna-carta-sign` Worker had never built.** Its bundle failed on every run with
`ENOENT … apps/sign-worker/src/@magna-carta/pdf/src/pkg/pdf_core_bg.wasm` out of the
`wrangler-module-collector` plugin, followed by `Could not resolve "./pkg/pdf_core.js"`. Nothing was
wrong with the Worker's code: `apps/sign-worker/src/index.ts` imports the pdf-core WASM binary
directly, `packages/pdf/src/pkg/` is a git-ignored build artefact (`packages/pdf/.gitignore`), and a
Workers Builds runner clones the repository without it. The Worker's build command —
`pnpm install --frozen-lockfile && pnpm run build`, from root directory `apps/sign-worker` — runs the
package's own `build` script, which is `wrangler deploy --dry-run --outdir dist` and nothing else, so
the artefact was never produced and wrangler bundled against a path that did not exist.

This is the third time this class has landed, and the first two shaped the wrong lesson. The runbook's
rule read "any new crate the app worker or SPA imports as WASM must be added to `rust-wasm-build` and
given its own `wasm.Dockerfile`" — which is true, was already satisfied here, and is not sufficient.
`pdf-core` has been in `rust-wasm-build` since the PDF engine merge and the app Worker builds fine;
what the sign Worker lacked was a **build command that reaches that task at all**. A crate covered by
the wasm build and a Worker whose build runs it are two separate conditions, and only the first one
had a rule.

The fix goes where the repository already keeps cross-package build ordering rather than in a
dashboard field nobody can review: a `sign-worker-build` task in the root `vite.config.ts`, shaped
like `build-all` one line above it, whose `dependsOn: ["rust-wasm-build"]` puts the pinned-Docker
wasm build ahead of the bundle. It is scoped to that one Worker — no SPA, no sibling workers, no
container images — for the same reason `build-all` is scoped to the app Worker: an unrelated
deployable's image failing must not fail this deploy. The Worker's own `build` script is left alone,
so it stays a plain wrangler bundle and does not acquire a Docker dependency in the local loop.

One dashboard field moves with it, and it is the only one: the `magna-carta-sign` build command
becomes `pnpm install --frozen-lockfile && pnpm exec vp run -w sign-worker-build`. Root directory
stays `apps/sign-worker` and the deploy command stays `npx wrangler deploy`; `-w` selects the
workspace-root package, so the root task resolves and runs with the repository root as its working
directory, which is what the `docker build … crates` context needs.

`docs/conventions/operations.md` records the Worker's full build configuration alongside its
siblings — commands, the WASM note, the failure signature, and Build Watch Paths
(`apps/sign-worker/*`, `packages/signing/*`, `packages/pdf/*`, `crates/pdf-core/*`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`) — and carries the generalized rule, so the next sibling Worker that imports a
crate as WASM has something to check its build command against.

Verified without Docker, which this environment does not have: `vp run -w sign-worker-build` from
`apps/sign-worker` resolves the new root task and reaches `rust-wasm-build` first, failing only at the
absent Docker daemon; with that dependency skipped and the artefacts already on disk, the same task
drives the sign Worker's bundle to a clean `Total Upload: 8346.92 KiB`. The app Worker's `build-all`
is untouched and still declares `dependsOn: ["@magna-carta/web#build", "rust-wasm-build"]`.
