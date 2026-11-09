import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig } from "vite-plus";
// The Playwright browser provider is upstream Vitest's own package, pinned in the catalog at the
// same version as vitest (a provider from another Vitest release does not load).
import { playwright } from "@vitest/browser-playwright";

/*
 * The Storybook story-test project: every story in .storybook's glob runs as a browser-mode
 * component test in headless Chromium (Playwright), with addon-a11y axe checks failing on
 * violation (.storybook/preview.ts `a11y.test = "error"`).
 *
 * This lives in its OWN config file (not inline in ./vitest.config.ts) because it is referenced
 * from two places and Vitest ignores `test.projects` nested inside a config that is itself
 * loaded as a project:
 *   - ./vitest.config.ts `test.projects` — the package-level `vp test run`,
 *   - the repo-root vite.config.ts `test.projects` — the repo-wide `vp test`.
 *
 * Requires the Chromium browser binary:
 *   pnpm --filter @magna-carta/design-system exec playwright install chromium
 * (CI must run the same before `vp test`.)
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    // Turns the Storybook config into a test suite: one browser test per story.
    storybookTest({ configDir: `${import.meta.dirname}/.storybook` }),
  ],
  test: {
    name: "storybook",
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({}),
      instances: [{ browser: "chromium" }],
    },
  },
});
