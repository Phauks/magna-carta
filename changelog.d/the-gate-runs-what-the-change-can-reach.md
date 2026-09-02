---
category: Changed
audience: internal
---

**The gate runs the test substrates a change can reach, restores its WASM artefacts from `main`, and is sectioned by tier.** The first month of real gate runs showed where the bill goes: `test-worker` (two to four 2-core shards of eight to ten minutes each) was the largest single item on every pull request, and every branch's first run paid a ~7-minute cold Docker build of the WASM packages because nothing had saved that cache on `main` since the push-to-main tier was suspended — a pull request can only restore what its own branch or `main` saved.

Three changes in `.github/workflows/gate.yml` and beside it:

- **Substrate gating.** `classify` (the job formerly called `changes`) now emits whether the Miniflare suites (`apps/api-worker`, `apps/status-worker`) and the Storybook suite (`packages/design-system`) are reachable from the change, read off the same undeferred dependent closure the lint scope already uses; `test-worker` and `test-stories` are skipped when they are not. A UI-only change never boots a Workers runtime and an api-only change never boots Chromium. The reading is fail-safe: `ALL` and `NONE` (a crate, a container, a workflow) both run everything, and only a concrete package list that omits the substrate's package skips it. `lint` is likewise skipped at the job level on a `NONE` scope instead of paying a 2-core runner to print that.
- **`seed-caches.yml`.** On every push to `main`, restore-or-build the WASM artefacts under the gate's own cache key, so a branch's first run hits. `pnpm run lint:cache-keys` (`tooling/lint-cache-keys`) holds the two key expressions identical, because a seed under a different key warms nothing.
- **Named and sectioned.** Jobs are grouped under banners by tier — classify, always-on guards, WASM artefacts, consumers, Rust and containers, aggregate — and named for what they do (`classify`, `build-wasm`). The four-step preamble every consumer repeated (checkout, setup, download the artefact, untar it) is now `./.github/actions/setup` with `wasm: "true"`, so each job's steps are what that job checks.

`assemble-docs.yml` moves to the 1-vCPU runner and installs the workspace only once the dependency-free assemblers have produced something to format; its second run per merge, which finds nothing, now costs a checkout. Standard: `docs/conventions/build-performance.md`.
