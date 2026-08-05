---
category: Changed
---

**CI cadence temporarily reduced while the GitHub Actions budget is exhausted.** The gate's nightly
whole-repo sweep, its push-to-`main` run, and its whole-repo lint tier are suspended; the pull-request
tier still runs the full battery (format, type-check, rust, the whole test suite, governance, contracts,
containers) with the type-aware lint scoped to the changed packages plus one hop, and the per-merge docs
assembly keeps running. During the window the merge bar is full local verification by the agent
(whole-repo `pnpm check` plus `vp test`, stated in the pull request) plus orchestrator review. Every
suspended site carries the marker `TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions minutes
reset`, and the revert checklist is in `docs/conventions/build-performance.md`.
