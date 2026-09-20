import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { liveCookie, postJson, setCookies } from "./support/test-auth.ts";

// The development-only firm seeder (routes/developer/dev-seed.ts), driven through the real Miniflare bindings.
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
    // Five documents plus the browsable archive sample the file manager reads inside.
    expect(first.fileCount).toBe(6);

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
    // Five clean files show by default (the quarantined one is excluded): the four seeded
    // documents and the committed zip that browsing inside an archive needs.
    expect(list.data).toHaveLength(5);
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
    expect(widened.data).toHaveLength(6);
    const quarantined = widened.data.find((file) => file.status === "quarantined");
    expect(quarantined).toBeDefined();
    expect(quarantined?.currentVersionId).toBeNull();
    expect(quarantined?.quarantineReason).toBeTruthy();
  });
});

// The seed's convergence guarantee, driven the way a developer hits it: warm `.wrangler` state that
// already holds the dev user, but holds it WITHOUT a credential. That is not a contrived state — the
// invite route creates a user and leaves the credential to the activation reset, and a run of this
// route that failed between its two writes leaves the same thing behind. The old find-branch
// returned early on the user row, so the second seed printed a password for an account that had
// none: a success report for an account nobody can sign into.
describe("dev seed route — a re-seed converges an unsignable account", () => {
  it("re-creates a missing credential rather than skipping the existing user", async () => {
    const first = await seed();

    // Take the credential away, leaving exactly the shape a user-before-credential path leaves.
    const userRow = await env.DB_CONTROL.prepare('SELECT id FROM "user" WHERE email = ?1')
      .bind(first.credentials.email)
      .first<{ id: string }>();
    expect(userRow).not.toBeNull();
    await env.DB_CONTROL.prepare(
      "DELETE FROM account WHERE user_id = ?1 AND provider_id = 'credential'",
    )
      .bind(userRow?.id)
      .run();

    // Proving the setup bites: without a credential, sign-in fails.
    const broken = await postJson(first.signInEndpoint, {
      email: first.credentials.email,
      password: first.credentials.password,
    });
    expect(broken.status).not.toBe(200);

    // Re-seed, and the credentials the route prints work again — on the SAME user row, so the
    // repair is a repair rather than a second account.
    const second = await seed();
    expect(second.firmId).toBe(first.firmId);
    const repaired = await postJson(second.signInEndpoint, {
      email: second.credentials.email,
      password: second.credentials.password,
    });
    expect(repaired.status).toBe(200);

    const userCount = await env.DB_CONTROL.prepare(
      'SELECT COUNT(*) AS n FROM "user" WHERE email = ?1',
    )
      .bind(second.credentials.email)
      .first<{ n: number }>();
    expect(userCount?.n).toBe(1);
  });

  it("leaves a firmless existing account attached to the dev firm", async () => {
    const first = await seed();
    // `user.firm_id` is nullable — the joining surface makes a person before it resolves a firm — so
    // a warm row can authenticate and then resolve no firm at all. A re-seed has to fix that too, or
    // the developer signs in successfully and the app renders nothing.
    await env.DB_CONTROL.prepare('UPDATE "user" SET firm_id = NULL WHERE email = ?1')
      .bind(first.credentials.email)
      .run();

    const second = await seed();
    const attached = await env.DB_CONTROL.prepare('SELECT firm_id FROM "user" WHERE email = ?1')
      .bind(second.credentials.email)
      .first<{ firm_id: string | null }>();
    expect(attached?.firm_id).toBe(second.firmId);
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
