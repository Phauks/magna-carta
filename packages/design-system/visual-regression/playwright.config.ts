/*
 * Playwright configuration for the visual-regression sweep (./catalog.spec.ts): screenshots of
 * every story x theme x mode over the STATIC catalog build (storybook-static/), served by the
 * dependency-free ./serve-static.mjs. Run via the package scripts:
 *
 *   pnpm --filter @magna-carta/design-system run visual-regression          # compare
 *   pnpm --filter @magna-carta/design-system run visual-regression-update   # rewrite baselines
 *
 * Deliberately NOT part of `vp test`: it needs the static build and authoritative baselines from
 * the pinned Playwright container (see ./README.md — baseline discipline). Local non-container
 * runs are advisory; cross-OS font rasterization differences are expected.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: harnessDirectory,
  outputDir: path.join(harnessDirectory, "test-results"),
  // Baseline names carry NO platform/project suffix (Playwright's default appends e.g. -win32):
  // there is exactly one authoritative rendering environment — the pinned Linux container — so
  // every run, on any host, compares against the same committed baseline set.
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations/transitions and hide the caret at capture time, so screenshots
      // never race an in-flight transition. ("disabled" is Playwright's default; pinned
      // explicitly because the determinism of every baseline depends on it.)
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:6007",
    // Forces prefers-reduced-motion in the browser context — exercises the motion-reduce token
    // gate, and removes motion as a screenshot-flakiness source at the source. (reducedMotion is
    // a context option, not a direct TestOption — Playwright 1.60 exposes it via contextOptions;
    // verified against the installed playwright/types/test.d.ts.)
    contextOptions: { reducedMotion: "reduce" },
  },
  // Chromium only for now; the cross-engine rendering matrix is an Argos-CI-era upgrade
  // (spec: "Catalog, testing & enforcement", docs/specs/2026-06-10-design-system-foundation-design.md).
  projects: [{ name: "chromium" }],
  webServer: {
    command: "node serve-static.mjs",
    cwd: harnessDirectory,
    port: 6007,
    reuseExistingServer: !process.env.CI,
  },
});
