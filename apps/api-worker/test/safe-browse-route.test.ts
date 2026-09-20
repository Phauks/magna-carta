import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { BrowserRenderer, RedirectProbe } from "@magna-carta/safe-browse/types";
import { RendererFailure } from "@magna-carta/safe-browse";
import { SsrfRejection } from "@magna-carta/integrations/safe-target";
import { createApp } from "../src/app.ts";
import { createBrowserRenderer } from "../src/routes/tools/safe-browse.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
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

// A BrowserRenderer whose snapshot reports the PAGE failing to render — the 422 a real capture
// against a live site actually met.
function pageFailureRenderer(): BrowserRenderer {
  return {
    async snapshot(_url: string) {
      throw new RendererFailure(422, 6004);
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

// A BrowserRenderer whose snapshot throws the refusal the service makes when it is momentarily
// unable to serve a render — a 503 with no code. This is the only shape that still answers 502.
function unavailableRenderer(): BrowserRenderer {
  return {
    async snapshot(_url: string) {
      throw new RendererFailure(503, null);
    },
  };
}

// A BrowserRenderer whose snapshot throws the refusal the service makes about the CALLER rather
// than its own capacity — the 401 an account without the entitlement draws. Waiting does not fix
// it, so it must not be reported as capacity.
function refusingRenderer(): BrowserRenderer {
  return {
    async snapshot(_url: string) {
      throw new RendererFailure(401, 10000);
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

// A third app instance whose renderer reports a momentary failure, for the 502 case.
const rendererFailureApp = createApp({
  safeBrowseDeps: { renderer: unavailableRenderer(), probe: fakeProbe() },
});

// A fourth whose renderer refuses on configuration grounds, for the non-transient case.
const rendererRefusalApp = createApp({
  safeBrowseDeps: { renderer: refusingRenderer(), probe: fakeProbe() },
});

// A fifth whose renderer reports the page failing to render.
const pageFailureApp = createApp({
  safeBrowseDeps: { renderer: pageFailureRenderer(), probe: fakeProbe() },
});

// A quickAction binding recording every call, answering from a scripted queue of responses. Used
// to drive createBrowserRenderer directly — the retry lives there, below every route.
function scriptedBrowser(responses: { status: number; body: unknown }[]): {
  binding: { quickAction(action: string, options: Record<string, unknown>): Promise<Response> };
  calls: { action: string; options: Record<string, unknown> }[];
} {
  const calls: { action: string; options: Record<string, unknown> }[] = [];
  let next = 0;
  return {
    calls,
    binding: {
      async quickAction(action: string, options: Record<string, unknown>) {
        calls.push({ action, options });
        // The links companion call is not what these tests drive; answer it emptily.
        if (action !== "snapshot") {
          return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
        }
        const scripted = responses[next] ?? responses.at(-1);
        next += 1;
        return new Response(JSON.stringify(scripted?.body ?? {}), {
          status: scripted?.status ?? 500,
        });
      },
    },
  };
}

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
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
    await mirrorMemberWithOwnerRole(userId, "Safe Browse OK", poolFirmId); // Owner carries tools:safeBrowse (0016)
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
    await mirrorMemberWithOwnerRole(userId, "SSRF User", poolFirmId);
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
    await mirrorMemberWithOwnerRole(userId, "Renderer Failure", poolFirmId);
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

  it("answers a failed render with 422 page-render-failed, not an Error ID", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-page@example.com", {
      userName: "Page Failure",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Page Failure", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-page@example.com");
    const targetUrl = "https://suspect.example.com/slow";
    const response = await pageFailureApp.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ url: targetUrl }),
      },
      env,
    );
    // A page that would not load is neither the member's address nor our outage.
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("page-render-failed");
    expect(body).not.toContain("suspect.example.com");
    expect(body).not.toContain(targetUrl);
  });

  it("answers a configuration refusal with 500, not the capacity 502", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-refusal@example.com", {
      userName: "Renderer Refusal",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Renderer Refusal", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-refusal@example.com");
    const targetUrl = "https://suspect.example.com/page";
    const response = await rendererRefusalApp.request(
      "https://example.com/api/v1/safe-browse",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ url: targetUrl }),
      },
      env,
    );
    // An entitlement that is not enabled is not capacity: saying "try again shortly" would send
    // the member back to a control that can never succeed.
    expect(response.status).toBe(500);
    // Redaction holds on the path that now propagates the failure to the global pipeline.
    const body = await response.text();
    expect(body).not.toContain("suspect.example.com");
    expect(body).not.toContain(targetUrl);
  });
});

describe("POST /api/v1/safe-browse/stream", () => {
  it("streams stage lines and ends with the complete view", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-stream@example.com", {
      userName: "Stream OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Stream OK", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-stream@example.com");
    const response = await app.request(
      "https://example.com/api/v1/safe-browse/stream",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { stage: string; [key: string]: unknown });
    expect(lines[0]).toEqual({ stage: "probing" });
    expect(lines[1]).toMatchObject({ stage: "probed", redirectCount: 0 });
    const terminal = lines.at(-1) as { stage: string; view?: { screenshotBase64: string } };
    expect(terminal.stage).toBe("complete");
    expect(terminal.view?.screenshotBase64).toBe("aGk=");
  });

  it("answers a clean 400 problem before the stream for a private target", async () => {
    // The guard runs ahead of the stream, so a rejected target never sees a 200 that fails one
    // line in — and the redacted problem document never echoes the address.
    const { userId } = await seedCredentialedUser("safebrowse-stream-ssrf@example.com", {
      userName: "Stream SSRF",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Stream SSRF", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-stream-ssrf@example.com");
    const response = await app.request(
      "https://example.com/api/v1/safe-browse/stream",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ url: "http://127.0.0.1" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.text()).not.toContain("127.0.0.1");
  });

  it("delivers a renderer failure as the failed terminal line once the stream has begun", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-stream-502@example.com", {
      userName: "Stream Renderer Failure",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Stream Renderer Failure", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-stream-502@example.com");
    const response = await rendererFailureApp.request(
      "https://example.com/api/v1/safe-browse/stream",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const terminal = JSON.parse(text.trim().split("\n").at(-1) ?? "{}") as {
      stage: string;
      problem?: { status: number };
    };
    expect(terminal).toEqual({ stage: "failed", problem: { status: 502 } });
    // Redaction holds inside the stream too.
    expect(text).not.toContain("suspect");
  });

  it("does not report a configuration refusal as capacity, and carries an Error ID", async () => {
    const { userId } = await seedCredentialedUser("safebrowse-stream-refusal@example.com", {
      userName: "Stream Renderer Refusal",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Stream Renderer Refusal", poolFirmId);
    const cookie = await signInForSessionCookie("safebrowse-stream-refusal@example.com");
    const response = await rendererRefusalApp.request(
      "https://example.com/api/v1/safe-browse/stream",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com", cookie },
        body: JSON.stringify({ url: "http://example.com" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const terminal = JSON.parse(text.trim().split("\n").at(-1) ?? "{}") as {
      stage: string;
      problem?: { status: number; errorId?: string };
    };
    // 502 would tell the member to wait for a fault that waiting cannot clear.
    expect(terminal.problem?.status).toBe(500);
    expect(terminal.problem?.errorId).toBeTypeOf("string");
  });
});

describe("createBrowserRenderer", () => {
  const ok = {
    status: 200,
    body: { success: true, result: { screenshot: "aGk=", markdown: "# x" }, meta: { title: "X" } },
  };
  const pageFailure = { status: 422, body: { success: false, errors: [{ code: 6004 }] } };

  it("waits for load rather than a network-idle condition", async () => {
    const { binding, calls } = scriptedBrowser([ok]);
    await createBrowserRenderer(binding).snapshot("https://example.com/");
    const goto = calls[0]?.options.gotoOptions as { waitUntil?: string } | undefined;
    // networkidle2 never settles on a page holding a socket or a poll, so the wait ran to its own
    // timeout and every capture against a live commercial page came back 422.
    expect(goto?.waitUntil).toBe("load");
  });

  it("retries a failed render once with everything expensive turned off", async () => {
    const { binding, calls } = scriptedBrowser([pageFailure, ok]);
    const view = await createBrowserRenderer(binding).snapshot("https://example.com/");
    expect(view.screenshotBase64).toBe("aGk=");
    const snapshots = calls.filter((call) => call.action === "snapshot");
    expect(snapshots).toHaveLength(2);
    const second = snapshots[1]?.options as Record<string, unknown>;
    expect(second.addScriptTag).toBeUndefined();
    expect(second.screenshotOptions).toEqual({ fullPage: false });
  });

  it("gives up after the second attempt rather than retrying forever", async () => {
    const { binding, calls } = scriptedBrowser([pageFailure, pageFailure]);
    await expect(createBrowserRenderer(binding).snapshot("https://example.com/")).rejects.toThrow(
      RendererFailure,
    );
    expect(calls.filter((call) => call.action === "snapshot")).toHaveLength(2);
  });

  it("does not retry a fault that would fail the same way twice", async () => {
    // A configuration refusal and a capacity shortage are identical on a second ask; retrying
    // spends a second render to learn nothing.
    for (const status of [401, 503]) {
      const { binding, calls } = scriptedBrowser([
        { status, body: { success: false, errors: [{ code: 10000 }] } },
      ]);
      await expect(createBrowserRenderer(binding).snapshot("https://example.com/")).rejects.toThrow(
        RendererFailure,
      );
      expect(calls.filter((call) => call.action === "snapshot")).toHaveLength(1);
    }
  });
});
