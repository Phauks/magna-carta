import { defineConfig } from "vitest/config";

// Plain node pool for the web app's data-module tests (registry fitness checks) — no browser,
// no SvelteKit plugin (this config never runs a dev/build, so the cwd guard dance in
// vite.config.ts does not apply here). root is pinned to this package so the repo-root
// `vp test` resolves this project's tests from here.
export default defineConfig({
  test: {
    name: "web",
    root: import.meta.dirname,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
