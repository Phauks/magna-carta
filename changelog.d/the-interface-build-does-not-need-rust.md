---
category: Changed
audience: internal
---

**Design proposed for moving the single-page application onto its own Worker**, so an interface change
stops rebuilding and redeploying the API:
[`docs/specs/2026-08-21-spa-worker-split-design.md`](../docs/specs/2026-08-21-spa-worker-split-design.md).
Design only, and gated on a measurement — two reversible settings on the existing Worker may close
most of the gap first, in which case the proposal should be withdrawn rather than built.

**Corrects a claim in [`operations.md`](../docs/conventions/operations.md) that had stood since
2026-06-28:** that `@magna-carta/pdf` is "imported by the SPA". It is not. `apps/web` depends on none
of the three WebAssembly packages; every importer of the pdf package is server-side. The sentence
mattered because it is why "can the interface build without the Rust toolchain?" carried an answer of
no for two months without anyone reading the dependency graph.

Also recorded there: the assets binding declares `run_worker_first: ["/api/*"]` while the Worker also
serves `/wopi/*` and `/search-objects/*`, so by the configuration as written a public request to
either would be answered by the single-page-application fallback rather than by its handler. Whether
that is reachable depends on service-binding behaviour this repository has not tested, so it is filed
as a finding rather than a fix. The split would make it moot; without the split the repair is to add
both prefixes.
