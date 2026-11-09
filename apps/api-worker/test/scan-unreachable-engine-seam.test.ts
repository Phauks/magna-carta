import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The scan surface with the PRODUCTION wiring — createApp() takes no scan override, so the route
// resolves its port from the bound SCAN_SERVICE exactly as a deployment does. What the pool's own
// stub cannot show is the state a deployment actually spends time in: the service is bound (a service
// binding to a worker that does not exist is refused at deploy), and the worker behind it answers 5xx
// because it is a placeholder or its Container is not up. files-routes.test.ts covers the other side
// of this seam — the stub answering an honest engine-less result — and that is the case that made the
// route look truthful while this one returned a server error.
const placeholderScanService: Fetcher = {
  fetch: () => Promise.resolve(new Response("placeholder", { status: 503 })),
} as unknown as Fetcher;

const app = createApp();

let firmId: FirmId;
let cookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Scan Seam Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const { userId } = await seedCredentialedUser("scan-seam@example.com", {
    userName: "Scan Seam User",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Scan Seam User", firmId);
  cookie = await signInForSessionCookie("scan-seam@example.com");
});

const base = "https://example.com/api/v1";

function scanRequest(bytes: Uint8Array): [string, RequestInit] {
  return [
    `${base}/scan/diagnose`,
    {
      method: "POST",
      headers: {
        cookie,
        origin: "https://example.com",
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    },
  ];
}

describe("scan diagnose against a bound-but-unreachable engine", () => {
  it("refuses with a typed 503 rather than a server error", async () => {
    const [url, init] = scanRequest(new TextEncoder().encode("hello world"));
    const response = await app.request(url, init, {
      ...env,
      SCAN_SERVICE: placeholderScanService,
    });

    // The defect this pins: a member who asked whether a file is safe was told the platform had
    // broken, with an Error ID to quote at support, over a Container that is simply not up.
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await response.json()) as { type: string; title: string; detail: string };
    expect(problem.type).toContain("service-unavailable");
    // Never a verdict: an engine that did not answer has not pronounced a file clean or anything else.
    expect(problem.detail).toContain("not been scanned");
  });

  it("still answers an honest unscanned where no engine is wired at all", async () => {
    // The two states are different answers and must stay different: nothing wired is a verdict the
    // firm can read (`unscanned`, reason `no-engine`), and an unreachable engine is a refusal.
    const [url, init] = scanRequest(new TextEncoder().encode("hello world"));
    const response = await app.request(url, init, { ...env, SCAN_SERVICE: undefined });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { verdict: string; reason: string | null };
    expect(body.verdict).toBe("unscanned");
    expect(body.reason).toBe("no-engine");
  });
});
