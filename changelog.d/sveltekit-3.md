---
category: Security
audience: internal
---

**SvelteKit 3.** apps/web moves from SvelteKit 2.70.4 to 3.2.0, with `@sveltejs/adapter-static` 4 and `sveltekit-superforms` 3. This clears GHSA-3r8g-jcqq-3p5j (CVSS 7.5, fixed only in 3.1.1), which failed the dependency audit on every pull request, along with two low SvelteKit records and the cookie 0.6 record. SvelteKit's configuration now lives in the `sveltekit()` plugin in `apps/web/vite.config.ts` (`svelte.config.js` is gone), `apps/web/tsconfig.json` extends `$app/tsconfig`, `$lib` is kept through the plugin's `alias`, `goto` calls use `reset: false` where they passed `keepFocus`/`noScroll`, reads of `page.url` copy it before handing it to a helper that takes a `URL`, `$app/environment` is `$app/env`, and the client `handleError` hook reads the new `{ kind, error }` shape. The design-system Storybook stubs `$app/state` for superforms 3.
