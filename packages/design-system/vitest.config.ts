import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

// Two projects:
//   "unit"      — the package's plain tests (default node pool; happy-dom opted into per file
//                 via the `@vitest-environment happy-dom` pragma).
//   "storybook" — stories as browser-mode tests; defined in ./vitest.storybook.config.ts (its
//                 own file because the repo-root vite.config.ts must also reference it directly:
//                 Vitest ignores `test.projects` nested inside a config loaded as a project, so
//                 from the repo root THIS file only contributes the top-level fallback — root
//                 pinned, explicit include — which runs exactly the unit tests).
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
  // Also at the top level, not only on the "unit" project below: from the repo root this file
  // contributes ONLY its top-level fallback (see the note on `include`), so a plugin declared just
  // on the project is invisible to `pnpm test` and a runes module fails there while passing here.
  plugins: [svelte()],
  test: {
    // The repo-root fallback's include, EXPLICIT (mirrors the "unit" project below): Vitest's
    // default include matches **/*.spec.ts, which would sweep the Playwright visual-regression
    // suite (visual-regression/catalog.spec.ts) into `vp test` — that suite runs only via the
    // `visual-regression` package script (it needs the static catalog build + committed
    // container baselines; see visual-regression/README.md).
    include: ["test/**/*.test.ts"],
    projects: [
      {
        // No `plugins` here: an inline project extends the config that declares it, so the Svelte
        // compiler plugin above already applies. Listing it again compiles each `.svelte.ts` module
        // twice, and the second pass rejects the `$` import the first one emitted.
        test: {
          name: "unit",
          root: import.meta.dirname,
          include: ["test/**/*.test.ts"],
        },
      },
      "./vitest.storybook.config.ts",
    ],
  },
});
