import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { BrowserRenderer, RedirectProbe } from "@magna-carta/safe-browse/types";
import { SsrfRejection } from "@magna-carta/integrations/safe-target";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A fake BrowserRenderer that returns a minimal static snapshot.
function fakeRenderer(): BrowserRenderer {
  return {
    async snapshot(_url: string) {
      return {
        screenshotBase64: "aGk=",
        content: "<html><body>hi</body></html>",
        markdown: "# x",
        title: "X",
        links: ["https://x.example/"],
      };
    },
  };
}

// A fake RedirectProbe that returns a single 200 hop with no redirect.
function fakeProbe(): RedirectProbe {
  return {
    async follow(url: string) {
      return {
        chain: [{ url, status: 200 }],
        finalUrl: url,
        headers: { "content-type": "text/html" },
      };
    },
  };
}

// A RedirectProbe that throws SsrfRejection, simulating the SSRF guard rejecting a private host.
function ssrfProbe(): RedirectProbe {
  return {
    async follow(_url: string) {
      throw new SsrfRejection("private", "target resolved to a private address");
    },
  };
}

// A BrowserRenderer whose snapshot throws with "unavailable", simulating a capacity/limit failure.
function unavailableRenderer(): BrowserRenderer {
  return {
    async snapshot(_url: string) {
      throw new Error("Browser rendering service unavailable — at capacity.");
    },
  };
}

const app = createApp({
  safeBrowseDeps: { renderer: fakeRenderer(), probe: fakeProbe() },
});

// A second app instance wired with the SSRF probe for the 400 case.
const ssrfApp = createApp({
  safeBrowseDeps: { renderer: fakeRenderer(), probe: ssrfProbe() },
});

// A third app instance whose renderer throws a capacity/limit error for the 502 case.
const rendererFailureApp = createApp({
  safeBrowseDeps: { renderer: unavailableRenderer(), probe: fakeProbe() },
});

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1); // includes 0016 (all roles get tools:safeBrowse)
  poolFirmId = (
    await seedFirm({ name: "Safe Browse Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("POST /api/v1/safe-browse", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await app.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:safeBrowse", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("safebrowse-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("safebrowse-noperm@example.com");
    const response = await app.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the snapshot for an Owner member with tools:safeBrowse", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-ok@example.com", {
      userName: "Safe Browse OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Safe Browse OK"); // Owner carries tools:safeBrowse (0016)
    const cookie = await signInForSessionCookie("safebrowse-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      screenshotBase64: string;
      finalUrl: string;
      requestedUrl: string;
    };
    expect(body.screenshotBase64).toBe("aGk=");
    expect(body.finalUrl).toBeDefined();
    expect(body.requestedUrl).toBe("http://example.com");
  });

  it("returns 400 when the SSRF guard rejects a private-IP URL", async () => {
    // The SSRF probe throws SsrfRejection — captureSafeView propagates it; the handler maps it to 400.
    const { userId } = await seedCredentialedUser("safebrowse-ssrf@example.com", {
      userName: "SSRF User",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "SSRF User");
    const cookie = await signInForSessionCookie("safebrowse-ssrf@example.com");
    const response = await ssrfApp.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ url: "http://127.0.0.1" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    // The response must not contain the raw URL or host — SSRF details are redacted.
    const body = await response.text();
    expect(body).not.toContain("127.0.0.1");
    expect(body).not.toContain("127");
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await app.request("https://example.com/api/openapi.json", {}, env);
    const document = (await response.json()) as {
      paths: Record<string, { post?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/safe-browse"]?.post;
    expect(operation?.["operationId"]).toBe("safeBrowse.post");
    expect(operation).toMatchObject({
      "x-mc-operationId": "safeBrowse.post",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:safeBrowse",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });

  it("returns 502 when the browser renderer is unavailable, without leaking the URL", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-502@example.com", {
      userName: "Renderer Failure",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Renderer Failure");
    const cookie = await signInForSessionCookie("safebrowse-502@example.com");
    const targetUrl = "https://suspect.example.com/page";
    const response = await rendererFailureApp.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie,
        },
        body: JSON.stringify({ url: targetUrl }),
      },
      env,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    // The response body must not contain the url or host — redaction must hold.
    const body = await response.text();
    expect(body).not.toContain("suspect.example.com");
    expect(body).not.toContain(targetUrl);
  });
});
