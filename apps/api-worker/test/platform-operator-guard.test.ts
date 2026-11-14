import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";

// platformOperatorGuard end-to-end (Miniflare), driven through the first route it guards:
// POST /api/v1/platform/status/events (declare a service event). Deferred from Task 8 because that
// route did not exist yet; it does now.
//
// Storage is SHARED across this file's tests; the control-plane migrations run once in beforeAll.
//
// Coverage note: the guard's allow-decision logic (active operator, missing 2FA, lapsed grant) is
// unit-tested directly via decidePlatformOperatorAccess in
// packages/access-control/test/platform-operator.test.ts. This file covers the two paths that
// logic alone can't reach: no session at all (401) and a signed-in user who is not a platform
// operator (403). Two end-to-end cases remain deferred here: an active seeded platform_operator
// with 2FA getting 200 with the event stamped with their userId, and a lapsed grant (expires_at in
// the past) getting 403 through the real route. The session fixture these need now exists —
// seedCredentialedUser / signInForSessionCookie (imported above, used by the 403 test) — so the
// only remaining work is seeding a platform_operator row (insertPlatformOperatorStatement, with the
// user's two_factor_enabled set) plus a lapsed variant. Add both before the first platform_operator
// is seeded in production.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function declareEventBody() {
  return {
    title: "Editing degraded",
    impact: "major",
    affectedComponentIds: ["collabora"],
    body: "Investigating reports of slow saves.",
  };
}

async function postDeclareEvent(cookie?: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/platform/status/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(declareEventBody()),
  });
}

describe("platformOperatorGuard via POST /api/v1/platform/status/events", () => {
  it("answers an unauthenticated POST (no session cookie) with a 401 problem", async () => {
    const response = await postDeclareEvent();
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      status: 401,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers a signed-in user who is not a platform operator with a 403 problem", async () => {
    const email = "not-an-operator@example.com";
    await seedCredentialedUser(email);
    const sessionCookie = await signInForSessionCookie(email);

    const response = await postDeclareEvent(sessionCookie);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/permission-denied",
      status: 403,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });
});

// The recent-errors read is the guard's first GET. It names Workers, routes and Error IDs across
// every firm on the deployment, so a member who is not a platform operator must not reach it.
describe("platformOperatorGuard via GET /api/v1/platform/recent-errors", () => {
  it("answers a request with no session with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/platform/recent-errors");
    expect(response.status).toBe(401);
  });

  it("answers a signed-in user who is not a platform operator with a 403 problem", async () => {
    const email = "not-an-operator-errors@example.com";
    await seedCredentialedUser(email);
    const cookie = await signInForSessionCookie(email);
    const response = await SELF.fetch("https://example.com/api/v1/platform/recent-errors", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });
});
