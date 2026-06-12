import { defineConfig } from "vite-plus";

// Two projects:
//   "unit"      — the package's plain tests (default node pool; happy-dom opted into per file
//                 via the `@vitest-environment happy-dom` pragma).
//   "storybook" — stories as browser-mode tests; defined in ./vitest.storybook.config.ts (its
//                 own file because the repo-root vite.config.ts must also reference it directly:
//                 Vitest ignores `test.projects` nested inside a config loaded as a project, so
//                 from the repo root THIS file only contributes the top-level fallback — root
//                 pinned, default include — which runs exactly the unit tests).
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    projects: [
      {
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
