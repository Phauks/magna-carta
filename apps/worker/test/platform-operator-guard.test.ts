import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedCredentialedUser, signInForSessionCookie } from "./support/test-auth.ts";

// platformOperatorGuard end-to-end (Miniflare), driven through the first route it guards:
// POST /api/v1/platform/status/events (declare a service event). Deferred from Task 8 because that
// route did not exist yet; it does now.
//
// Storage is SHARED across this file's tests; the control-plane migrations run once in beforeAll.

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
