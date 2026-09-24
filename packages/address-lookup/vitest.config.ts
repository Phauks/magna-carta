import { defineConfig } from "vite-plus";

// Pure package: default node pool, no Cloudflare Workers runtime.
// root is pinned here so the repo-root `vp test` resolves this project's tests from this package.
export default defineConfig({
  root: import.meta.dirname,
});
