/*
 * Playwright end-to-end configuration for apps/web: the login flow and the (app) session guard driven
 * against a REAL running Worker (Miniflare-backed D1/R2/Queues), not a mocked backend. This is the web
 * behavioural layer the node-environment unit tests cannot reach — the login page and the guard render
 * only in a browser against a live /api.
 *
 * Deliberately NOT wired into `vp test`: the webServer boots `vp run worker-dev`, which builds the SPA
 * and then starts wrangler dev — heavy, the same reason the design-system visual-regression sweep is a
 * separate command. Run it on its own:
 *
 *   pnpm --filter @magna-carta/web run test:e2e
 *
 * Seeding is a "setup" project (a dependency of the chromium project), not a globalSetup hook, so it is
 * guaranteed to run AFTER the webServer is confirmed up — Playwright waits for the webServer url before
 * running any project, setup projects included. It POSTs to the dev-only /api/__dev/seed route (see
 * apps/api-worker/src/http/routes/developer/dev-seed.ts) and writes the returned credentials for the specs to read.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
// The workspace root: apps/web/e2e -> apps/web -> apps -> root. `vp run worker-dev` is a root task.
const repositoryRoot = path.resolve(harnessDirectory, "../../..");

export default defineConfig({
  testDir: harnessDirectory,
  outputDir: path.join(harnessDirectory, "test-results"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:8787",
    trace: "on-first-retry",
  },
  projects: [
    // Provisions the local dev tenant once, before the specs, and writes its credentials to disk.
    { name: "setup", testMatch: /seed\.setup\.ts$/ },
    // Chromium only; the login flow is engine-agnostic and a cross-engine matrix adds cost without
    // covering anything new here.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    // Builds the SPA, then runs wrangler dev (Miniflare: local D1/R2/Queues) on :8787. The dev-only
    // seed route is reachable here because no real R2 S3 credentials are present under worker-dev.
    command: "vp run worker-dev",
    cwd: repositoryRoot,
    url: "http://localhost:8787",
    // worker-dev builds the SPA before wrangler comes up — a cold build needs well over a minute.
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
