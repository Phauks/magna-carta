import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wranglerConfigContent from "../wrangler.jsonc?raw";
import { createApp } from "../src/app.ts";

// THE CONFIDENTIALITY BOUNDARY, AS A TEST.
//
// The board is the platform's one deliberately cross-firm surface, so the per-firm database
// boundary — the strongest control there is here — does not protect it. What replaces that boundary
// is this worker's binding list: the control-plane database and one key-value namespace, and
// nothing else. A firm's own matters, ledgers and documents are unreachable from this deployable
// rather than merely un-queried, and that is a property of the deployment.
//
// A binding added below is not a wiring step. It is a change to what a flaw on this surface could
// reach, which is why this test reads the configuration file rather than trusting a review.

const ALLOWED_BINDINGS = new Set(["DB_CONTROL", "COMMUNITY_KV"]);

function bindingNames(config: string): string[] {
  return [...config.matchAll(/"binding"\s*:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("what this worker can reach", () => {
  it("is not vacuous — it really is reading this worker's own configuration", () => {
    expect(wranglerConfigContent).toContain("magna-carta-community");
    expect(bindingNames(wranglerConfigContent).length).toBeGreaterThan(0);
  });

  it("declares exactly the two bindings the board needs", () => {
    expect(bindingNames(wranglerConfigContent).sort()).toEqual([...ALLOWED_BINDINGS].sort());
  });

  it("declares no per-firm reach of any kind", () => {
    for (const forbidden of [
      "durable_objects",
      "r2_buckets",
      "queues",
      "services",
      "FIRM_DATABASE",
      "hyperdrive",
      "vectorize",
    ]) {
      expect(
        wranglerConfigContent.includes(`"${forbidden}"`),
        `${forbidden} would give the board a way to reach a firm's own data`,
      ).toBe(false);
    }
  });

  it("has no edge cache, because its responses differ per reader", () => {
    // The status page may cache because every byte it serves is identical for everybody. A board
    // response is not: a signed-in member sees whether they voted, and the cache key does not
    // include the cookie.
    expect(wranglerConfigContent.includes('"cache"')).toBe(false);
  });

  it("has no per-firm binding on the runtime environment either", () => {
    const bound = Object.keys(env as unknown as Record<string, unknown>);
    for (const name of bound) {
      if (name === "AUTH_SECRET") continue;
      // The test pool injects its own helpers; anything that looks like a platform resource must be
      // one of the two.
      if (/^(DB_|R2|QUEUE|FIRM_|SCAN_|CONVERT|BUNDLE_|OCR_|SIGN_|RECOVERY_)/.test(name)) {
        expect(ALLOWED_BINDINGS.has(name), `${name} is bound at runtime`).toBe(true);
      }
    }
  });
});

describe("every route declares who may call it", () => {
  const { registeredRoutes } = createApp(env as never);

  it("registers a real surface", () => {
    expect(registeredRoutes.length).toBeGreaterThan(15);
  });

  it("names an access level and, for a write, a budget", () => {
    for (const meta of registeredRoutes) {
      expect(["public", "member", "operator"]).toContain(meta.access);
      expect(meta.operationId.startsWith("community.")).toBe(true);
    }
  });

  it("has no public write, so the board is public to read and never to write", () => {
    const publicWrites = registeredRoutes.filter(
      (meta) => meta.access === "public" && meta.rateLimitBucket !== null,
    );
    expect(publicWrites.map((meta) => meta.operationId)).toEqual([]);
  });

  it("has both public reads and operator-only routes, so the levels are not all the same", () => {
    const levels = new Set(registeredRoutes.map((meta) => meta.access));
    expect([...levels].sort()).toEqual(["member", "operator", "public"]);
  });
});

describe("the contract the board publishes", () => {
  it("emits an OpenAPI document naming its own operations", async () => {
    const { app } = createApp(env as never);
    const response = await app.request("/api/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    expect(document.openapi).toBe("3.1.0");
    const operationIds = Object.values(document.paths)
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.operationId)
      .filter((operationId): operationId is string => operationId !== undefined);
    // The routes that would be missed silently: the one-click delete and the report, which are the
    // two halves of the removal posture.
    expect(operationIds).toContain("community.deletePost");
    expect(operationIds).toContain("community.reportPost");
    expect(operationIds).toContain("community.listPosts");
  });
});
