import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime and no browser.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
