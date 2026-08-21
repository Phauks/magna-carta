---
worktree: (none — this stream runs in the primary checkout)
area: Deploy pipeline — the `magna-carta-sign` Worker's Workers Builds task graph
status: review
touches: vite.config.ts, docs/conventions/operations.md, changelog.d/
---

Fixes the `magna-carta-sign` Workers Build, which failed on every run: `apps/sign-worker/src/index.ts`
imports `@magna-carta/pdf/src/pkg/pdf_core_bg.wasm`, that directory is a git-ignored build artefact,
and the Worker's build command ran its own `build` script rather than anything that reaches
`rust-wasm-build`. Adds a `sign-worker-build` root task with `dependsOn: ["rust-wasm-build"]` and
records the Worker's build configuration in the deploy runbook.

A concurrent stream editing the `run.tasks` block of the root `vite.config.ts`, or the per-Worker
build-configuration list in `docs/conventions/operations.md`, will collide here. The `build-all` task
and the app Worker's entry are read but not changed.
