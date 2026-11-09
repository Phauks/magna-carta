import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import {
  readSeededTenant,
  seededCredentialsPath,
  type SeededTenant,
} from "./seeded-credentials.ts";

// The seed "setup" project: stand up the local dev tenant the specs sign in against. It runs after the
// webServer (vp run worker-dev) is confirmed up and before any spec, as a dependency of the chromium
// project. It POSTs to the Worker's dev-only seed route — which provisions a firm, an owner user, a
// matter, folders, and files, idempotently (a re-run resumes the same tenant) — and writes the returned
// credentials to disk for the specs to read. Failing here fails the whole run, which is what we want:
// no spec should run without a real tenant.

setup("seed the local development firm", async ({ request }) => {
  // Bring the control-plane schema up first. In production a Cron trigger applies the control-plane
  // migrations (apps/api-worker/src/background/scheduled.ts -> runScheduledSweep); wrangler dev does NOT auto-run
  // Cron, so a fresh Miniflare D1 has no `firm` table and the seed would 500. Hitting the scheduled
  // handler runs the same migration pass. Idempotent — re-running applies nothing new.
  const migrate = await request.get("/cdn-cgi/handler/scheduled");
  expect(
    migrate.ok(),
    `Triggering /cdn-cgi/handler/scheduled to apply control-plane migrations returned ${migrate.status()}.`,
  ).toBeTruthy();

  const response = await request.post("/api/__dev/seed", {
    headers: { "content-type": "application/json", accept: "application/json" },
    data: {},
  });
  // A 404 means the seed route is gated off — i.e. real R2 S3 credentials are present, so this is not a
  // worker-dev backend. e2e is meaningless without the dev seed, so fail loudly.
  expect(
    response.ok(),
    `POST /api/__dev/seed returned ${response.status()}. The e2e suite needs the dev-only seed route, ` +
      "which serves only under `vp run worker-dev` (no real R2 S3 credentials).",
  ).toBeTruthy();

  const tenant = (await response.json()) as SeededTenant;
  expect(tenant.credentials.email, "seed response is missing credentials").toBeTruthy();

  mkdirSync(path.dirname(seededCredentialsPath), { recursive: true });
  writeFileSync(seededCredentialsPath, JSON.stringify(tenant, null, 2), "utf8");

  // Prove the round-trip: the specs read the tenant back through exactly this path.
  expect(readSeededTenant().credentials.email).toBe(tenant.credentials.email);
});
