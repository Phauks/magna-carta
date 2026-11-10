---
category: Changed
audience: internal
---

**The hosted gate divides the test battery across four machines and writes its caches even when a
run is red.** `ci.yml` was one job that ran `pnpm gate` end to end: 60 to 86 minutes on 2026-11-09,
of which the battery was 52 to 74. It is now `prepare` (the plan, and one build of the WASM
artefacts when no cached copy matches), `checks` (`pnpm gate --skip tests`), four `tests` jobs
(`pnpm gate --only wasm,tests`, each with one slice of the suite) and `gate`, the required check,
which is green only when the others are. The gate reads the slice from `MAGNA_CARTA_TEST_SHARD`
(`tooling/gate/plan.mjs`, `parseShard`) and hands it to the test runner as `--shard`; unset, as on a
laptop, it runs the whole suite as before.

**The WASM cache was never being written.** The combined cache step saves only when its job
succeeds, and no hosted run had succeeded, so every run compiled the artefacts from cold (251 to 320
seconds). Each cache is now saved by its own step right after the build, the fifth artefact
(`packages/segmentation/src/pkg`) is in the cached paths, and the cargo cache is kept on failure.
Home: `docs/conventions/build-performance.md`, _The hosted run_.
