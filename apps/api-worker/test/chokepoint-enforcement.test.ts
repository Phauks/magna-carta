import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { BUCKETS } from "../src/http/chokepoint/rate-limiter.ts";

// Slice 0·5b Task 8b: the chokepoint wired into the REAL app, proven through the Miniflare HTTP
// surface (SELF) — metadata-DRIVEN enforcement, not per-handler discipline. The me/members/firms
// suites already cover 401 (logged-out), 403 + requestAccess (within-firm denial), 404 (structural
// absence / deactivation), and 400 (missing Idempotency-Key) through the wired chokepoint. This
// file owns the rate-limit gate, which needs an ISOLATED worker instance: the in-memory limiter is
// one-per-app, so a hammering test must not share a SELF instance with the others (this file gets
// its own isolate, so its bucket exhaustion cannot leak into another file's request budget).
//
// The target is POST /api/v1/firms — meta.rateLimit "auth" (BUCKETS.auth.limit = 10). The public
// platform surface keys the limiter by client IP; cf-connecting-ip is absent off-edge, so every
// request collapses into the one fail-closed `ip:unknown` bucket — exactly the shared bucket this
// hammer needs.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function postFirms(idempotencyKey: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/firms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
      "Idempotency-Key": idempotencyKey,
    },
    // One firm name throughout: the first request provisions it, every later (distinct-key) request
    // re-executes to the provisioner's already-active no-op — each one an EXECUTE-path request that
    // charges the limiter (a replay would short-circuit at idempotency, before the rate-limit gate).
    body: JSON.stringify({
      name: "Rate Limit Firm",
      owner: { email: "rate-limit-owner@example.com", name: "Rate Limit Owner" },
    }),
  });
}

describe("chokepoint rate-limit gate (429 + Retry-After) through the wired app", () => {
  it("denies past the auth bucket's limit with a 429 problem carrying Retry-After", async () => {
    // The first BUCKETS.auth.limit EXECUTE-path requests are allowed and the next one is denied,
    // counted from the bucket rather than written out: the auth bucket sits above the credential
    // ladder and moves with it, and a literal would stop reaching the gate the day it moved.
    // Distinct keys so each reaches the rate-limit gate (a repeated key would replay before it).
    // The over-the-bucket request never reaches the handler.
    let lastResponse: Response | undefined;
    for (let request = 0; request < BUCKETS.auth.limit + 1; request++) {
      lastResponse = await postFirms(crypto.randomUUID());
    }
    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("content-type")).toContain("application/problem+json");
    // Retry-After is the chokepoint's whole-seconds countdown until the oldest in-window timestamp
    // ages out — present and a positive integer.
    const retryAfter = lastResponse?.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter ?? "", 10)).toBeGreaterThan(0);
    const body = (await (lastResponse as Response).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/rate-limited",
      status: 429,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });
});
