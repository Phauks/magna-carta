---
category: Fixed
audience: internal
---

**The sign Worker's build configuration is recorded, and it is the app worker's.** Its Workers Build
failed on every run with `ENOENT … pdf_core_bg.wasm`: `apps/sign-worker/src/index.ts` imports the
pdf-core WASM binary, `packages/pdf/src/pkg/` is a git-ignored artefact of the `rust-wasm-build`
task, and a build scoped to the package runs only `wrangler deploy --dry-run` and never reaches it.

`pdf-core` was already covered by `rust-wasm-build` — the rule the deploy runbook states. What that
rule left half-said, across three occurrences now, is the other half: **a Worker importing WASM needs
a build command that reaches the task, not merely a crate that is listed in it.** Recorded in
[`operations.md`](../docs/conventions/operations.md) section 12 with the failure signature and the
watch paths.

No repository change was needed. `build-all` already declares `dependsOn: ["rust-wasm-build"]`, so
the fix is the app worker's own build and deploy commands, and a per-Worker task added for this one
case was withdrawn as redundant.
