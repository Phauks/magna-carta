---
category: Changed
audience: internal
---

**The web app's production build emits source maps** (`build.sourcemap: true` in `apps/web/vite.config.ts`). A stack frame in a member's browser now names the Svelte file and line instead of a hashed chunk and a minified identifier — the sign-in crash was diagnosed from `De.get (naXSyiPE.js:5:816)`, which says nothing. The trade is deliberate: `magna-carta-web` is an assets-only Worker, so the `.map` files are public assets and the frontend source is readable by anyone who fetches one; a browser bundle carries no secret, and readable production stack frames were judged worth the disclosure of code.
