---
category: Changed
audience: internal
---

**The web app's production build emits source maps without the source text** (`build.sourcemap: true` with `sourcemapExcludeSources` in `apps/web/vite.config.ts`). A stack frame in a member's browser now names the Svelte file, line and function instead of a hashed chunk and a minified identifier — the sign-in crash was diagnosed from `De.get (naXSyiPE.js:5:816)`, which says nothing. `magna-carta-web` is an assets-only Worker, so the `.map` files are public assets; carrying mappings, paths and original names but no text, a fetched map resolves a trace without giving away the code or its comments. The DevTools Sources panel on the deployed site still shows the minified chunk.
