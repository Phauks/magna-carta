import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { liveCookie, postJson, setCookies } from "./support/test-auth.ts";

// The development-only firm seeder (routes/dev-seed.ts), driven through the real Miniflare bindings.
// It stands up a complete signed-in-ready tenant so local dev has real data; this proves the route
// provisions firm + user + matter + files, is idempotent on a re-run, mints a real session on
// sign-in with the returned credentials, and that the seeded files list through the authenticated
// files read with their enriched version fields.

interface SeedResponse {
  firmId: string;
  firmName: string;
  matterId: string;
  fileCount: number;
  credentials: { email: string; password: string };
  signInEndpoint: string;
}

interface FileSummary {
  id: string;
  name: string;
  currentVersionId: string | null;
  versionNumber: number;
  sizeBytes: number | null;
  scanVerdict: "unscanned" | "clean" | "flagged" | null;
  status: "clean" | "pending" | "quarantined";
  quarantineReason: string | null;
}

async function seed(): Promise<SeedResponse> {
  const response = await postJson("/api/__dev/seed", {});
  expect(response.status).toBe(200);
  return (await response.json()) as SeedResponse;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("dev seed route", () => {
  it("provisions a firm, owner, matter, and files and is idempotent on a re-run", async () => {
    const first = await seed();
    expect(first.firmId).toMatch(/^firm_/);
    expect(first.matterId).toMatch(/^matter_/);
    expect(first.credentials.email).toContain("@");
    expect(first.credentials.password.length).toBeGreaterThan(0);
    expect(first.fileCount).toBe(5);

    // A second call resumes the same tenant rather than duplicating it.
    const second = await seed();
    expect(second.firmId).toBe(first.firmId);
    expect(second.matterId).toBe(first.matterId);

    // Exactly one firm and one owner user exist after two runs — the detect-and-reuse held.
    const firmCount = await env.DB_CONTROL.prepare("SELECT COUNT(*) AS n FROM firm WHERE name = ?1")
      .bind(first.firmName)
      .first<{ n: number }>();
    expect(firmCount?.n).toBe(1);
    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS n FROM "user" WHERE email = ?1',
    )
      .bind(first.credentials.email)
      .first<{ n: number }>();
    expect(userCount?.n).toBe(1);
  });

  it("signs in with the returned credentials and lists the seeded files", async () => {
    const seeded = await seed();

    const signIn = await postJson(seeded.signInEndpoint, {
      email: seeded.credentials.email,
      password: seeded.credentials.password,
    });
    expect(signIn.status).toBe(200);
    const sessionCookie = liveCookie(setCookies(signIn), "session_token");
    expect(sessionCookie).toBeDefined();
    const cookie = sessionCookie?.pair ?? "";

    // The default listing: clean files only, each carrying its enriched display-version fields.
    const listResponse = await SELF.fetch(
      `https://example.com/api/v1/files?matterId=${seeded.matterId}`,
      { headers: { cookie, origin: "https://example.com" } },
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { data: FileSummary[] };
    // Four clean files show by default (the quarantined one is excluded).
    expect(list.data).toHaveLength(4);
    for (const file of list.data) {
      expect(file.currentVersionId).not.toBeNull();
      expect(file.status).toBe("clean");
      expect(file.versionNumber).toBe(1);
      expect(file.sizeBytes).toBeGreaterThan(0);
    }
    // One of the clean-status files was flagged by a re-scan — the enriched verdict surfaces it.
    expect(list.data.some((file) => file.scanVerdict === "flagged")).toBe(true);

    // The opt-in listing also surfaces the quarantined file with its reason.
    const withQuarantined = await SELF.fetch(
      `https://example.com/api/v1/files?matterId=${seeded.matterId}&includePendingAndQuarantined=true`,
      { headers: { cookie, origin: "https://example.com" } },
    );
    expect(withQuarantined.status).toBe(200);
    const widened = (await withQuarantined.json()) as { data: FileSummary[] };
    expect(widened.data).toHaveLength(5);
    const quarantined = widened.data.find((file) => file.status === "quarantined");
    expect(quarantined).toBeDefined();
    expect(quarantined?.currentVersionId).toBeNull();
    expect(quarantined?.quarantineReason).toBeTruthy();
  });
});

// The single most important guarantee of this feature: the seed route creates a firm + owner with
// NO authentication (it is the bootstrap), so it MUST be invisible in production. It is gated on the
// same fail-closed signal the dev R2 route uses — the route is only wired when the real R2 S3
// credential set is absent (local dev). This proves that gate rather than trusting a reading of it.
describe("dev seed route — production gate", () => {
  it("answers 404 when the full R2 S3 credential set is present (production-shaped)", async () => {
    const app = createApp();
    // The pool env carries the R2_S3_* placeholders but omits CLOUDFLARE_ACCOUNT_ID; supplying it
    // completes the set, so realR2Credentials resolves and the dev seed emulation is inactive. A
    // Proxy keeps every real binding (DB, DO, telemetry) intact so ONLY the guard condition changes.
    const productionEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === "CLOUDFLARE_ACCOUNT_ID") return "prod-account-id-1234567890";
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const requestInit = {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: "{}",
    };
    const productionResponse = await app.request("/api/__dev/seed", requestInit, productionEnv);
    expect(productionResponse.status).toBe(404);

    // Contrast: under the pool env (no account id → emulation active) the SAME route IS wired and
    // seeds — a 200, not a 404 — proving the 404 above is credential-driven, not a missing route.
    const developmentResponse = await app.request("/api/__dev/seed", requestInit, env);
    expect(developmentResponse.status).toBe(200);
  });
});
