import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Plain node pool for the web app's data-module tests (registry fitness checks) — no browser,
// no SvelteKit plugin (this config never runs a dev/build, so the cwd guard dance in
// vite.config.ts does not apply here). root is pinned to this package so the repo-root
// `vp test` resolves this project's tests from here.
//
// The base Svelte compiler plugin (not SvelteKit's) is still needed: data modules like
// tool-presentation.ts import Lucide icon components, and @lucide/svelte's icon subpaths
// (icons/*) re-export a raw .svelte source file rather than compiled JS. Without a transform for
// ".svelte", Vite's default SSR externalization hands that import straight to Node, which throws
// ERR_UNKNOWN_FILE_EXTENSION.
export default defineConfig({
  plugins: [svelte()],
  test: {
    name: "web",
    root: import.meta.dirname,
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      deps: { inline: ["@lucide/svelte"] },
    },
  },
});
