---
category: Changed
audience: internal
---

**Production stack frames name the source file, line and function.** The web build now emits source maps without the source text (`sourcemapExcludeSources`) and stops renaming identifiers (`mangle: false`, compression and whitespace removal kept), on both the page build and the Web Worker build in `apps/web/vite.config.ts`. The sign-in crash was diagnosed from `De.get (naXSyiPE.js:5:816)`, which says nothing; the minifier's map does not record the original of a renamed identifier, so a map alone left the `De`. `magna-carta-web` is an assets-only Worker, so the `.map` files are public assets: carrying mappings and paths but no text, a fetched map gives away no code and no comment. Measured cost on the day's build: 897 KB to 1.12 MB gzipped over the whole app, a fraction of that per chunk.
