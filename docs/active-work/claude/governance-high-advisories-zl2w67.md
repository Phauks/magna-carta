---
worktree: /home/user/magna-carta (remote session)
area: The CI gate's cost — substrate gating on the dependent closure, WASM cache seeding from main, sectioning and naming, and a cheaper docs assembly
status: review
touches: .github/workflows/gate.yml, .github/workflows/seed-caches.yml, .github/workflows/assemble-docs.yml, .github/actions/setup/action.yml, tooling/lint-cache-keys/, package.json, docs/conventions/build-performance.md, changelog.d/
---

Second stream on this branch, after the advisory fix landed. The gate's first month of real runs showed most of the bill in `test-worker` and in a WASM cache that no branch could ever restore; this stream gates the two expensive test substrates on the dependent closure `classify` already computes, seeds the WASM cache from `main`, and re-sections the workflow by tier. Anything else touching `gate.yml` or `.github/actions/setup` should merge `main` after this lands: the `changes` and `wasm` jobs are renamed (`classify`, `build-wasm`) and every consumer's preamble moved into the setup action.
