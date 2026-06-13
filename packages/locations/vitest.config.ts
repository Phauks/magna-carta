import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
  // The location service and its tests land next; until then this project is intentionally empty
  // (the package is scaffolded ahead of its first module).
  test: { passWithNoTests: true },
});
