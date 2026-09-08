---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-worker-build-0953gb
area: Deploy build ordering — the wasm the SPA now imports
status: review
touches: vite.config.ts, apps/web-worker/package.json, pnpm-lock.yaml, docs/conventions/operations.md, docs/conventions/build-performance.md, changelog.d
---

Repairs the production build failure of 2026-09-07: `build-all` listed `rust-wasm-build` beside
`@magna-carta/web#build` in one `dependsOn`, which runs them in parallel, so the SPA bundle raced the
wasm it began importing with the in-browser PDF reader. Orders the chain, gives `magna-carta-web`'s
own build script the pdf-core artefact it never reached, and splits `rust-wasm-build` into three
per-crate tasks so the interface Worker compiles one crate instead of three. Touches the root
`vite.config.ts` task graph and two conventions files — sync before editing either.
