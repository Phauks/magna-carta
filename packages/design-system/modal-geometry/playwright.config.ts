/*
 * Playwright configuration for the modal geometry sweep (./geometry.spec.ts): every modal panel
 * in matrix.ts opened at every screen size there, measured against the stage's gutter rule and
 * screenshotted. It runs over the Storybook DEV server (started here if one is not already on
 * 6006), so it needs no static build and re-measures a change the moment it is saved. Run via the
 * package script:
 *
 *   pnpm --filter @magna-carta/design-system run modal-geometry
 *
 * Deliberately NOT part of `vp test`: it needs a browser and a catalog server. The visual-regression
 * harness beside it compares pixels; this one measures boxes, so it is the one to read when a
 * panel is the wrong size or in the wrong place, on any screen.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.join(harnessDirectory, "..");

export default defineConfig({
  testDir: harnessDirectory,
  outputDir: path.join(harnessDirectory, "test-results"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:6006",
    // The presence animations are CSS transitions gated on motion-reduce; forcing reduced motion
    // removes them as a source of a box measured mid-flight.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: "pnpm exec storybook dev -p 6006 --ci --no-open",
    cwd: packageDirectory,
    url: "http://127.0.0.1:6006/iframe.html",
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
