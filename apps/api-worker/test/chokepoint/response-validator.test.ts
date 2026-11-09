// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// The dev-only response validator: a dev-only response-validation middleware parses outgoing
// payloads against the route's response schema to catch handler/contract divergence before it
// reaches a client. Enabled only when c.env.ENVIRONMENT === "development" (Miniflare / wrangler
// dev and tests); production is a strict pass-through with ZERO body reads — proven here with a
// body-access-spied Response.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import { describe, expect, it } from "vitest";
import {
  createResponseValidator,
  ResponseContractDivergenceError,
} from "../../src/http/chokepoint/response-validator";
import { defineOpenAPIRoute, type RouteMeta } from "../../src/http/contracts/route-meta";

function sampleMeta(overrides: Partial<RouteMeta> = {}): RouteMeta {
  return {
    operationId: "widgets.list",
    surface: "app",
    authenticated: true,
    permission: "firm:manageMembers",
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
    ...overrides,
  };
}

const Widget = z.object({ ok: z.boolean(), count: z.number().int() });

// Declares 200 application/json only — the route every divergence case below plays against.
const widgetRoute = defineOpenAPIRoute(sampleMeta(), {
  method: "get",
  path: "/api/v1/widgets",
  description: "Lists widgets.",
  responses: {
    200: {
      description: "Widgets",
      content: { "application/json": { schema: Widget } },
    },
  },
});

// Direct-invocation harness: the middleware only reads c.env at request time and c.res after
// next(), so a minimal fake context exercises every branch without an app.
function contextWithResponse(
  environment: string | undefined,
  response: Response,
): Context<{ Bindings: { ENVIRONMENT?: string } }> {
  return {
    env: environment === undefined ? {} : { ENVIRONMENT: environment },
    res: response,
  } as unknown as Context<{ Bindings: { ENVIRONMENT?: string } }>;
}

const noopNext: Next = () => Promise.resolve();

function jsonResponse(body: unknown, status: number, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

// A response that records every body access: the proxy counts any touch of a body-reading member
// (clone included — the validator's read path is clone().json()). The zero-body-read assertion
// for the production pass-through is "no body member was ever touched", not merely "a response
// came back". (A pull-spied ReadableStream body does not work here: workerd eagerly pumps a
// JavaScript-backed stream into the Response at construction, firing pull without any read.)
const BODY_READING_MEMBERS = new Set<string | symbol>([
  "body",
  "clone",
  "json",
  "text",
  "arrayBuffer",
  "blob",
  "bytes",
  "formData",
]);

function bodyReadSpyJsonResponse(serializedBody: string, status: number) {
  let bodyAccessCount = 0;
  const original = new Response(serializedBody, {
    status,
    headers: { "content-type": "application/json" },
  });
  const spied = new Proxy(original, {
    get(target, property) {
      if (BODY_READING_MEMBERS.has(property)) {
        bodyAccessCount += 1;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Response;
  return { response: spied, original, bodyWasRead: () => bodyAccessCount > 0 };
}

describe("createResponseValidator — development", () => {
  it("passes a valid declared JSON response through with the body intact for the client", async () => {
    const app = new OpenAPIHono<{ Bindings: { ENVIRONMENT?: string } }>();
    // Registration-time composition through the library's own per-route middleware slot —
    // the shape the wiring uses (meta/config resolved from the route object, never from
    // the matched route at request time; see routeMetaOf's keying constraint).
    app.openapi(
      { ...widgetRoute, middleware: [createResponseValidator(widgetRoute)] as const },
      (c) => c.json({ ok: true, count: 3 }, 200),
    );
    const response = await app.request("/api/v1/widgets", {}, { ENVIRONMENT: "development" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 3 });
  });

  it("throws ResponseContractDivergenceError with the zod issues and operationId on a divergent body", async () => {
    const app = new OpenAPIHono<{ Bindings: { ENVIRONMENT?: string } }>();
    let captured: unknown;
    app.onError((error, c) => {
      captured = error;
      return c.text("captured", 500);
    });
    app.openapi(
      { ...widgetRoute, middleware: [createResponseValidator(widgetRoute)] as const },
      (c) => c.json({ ok: "yes" } as unknown as { ok: boolean; count: number }, 200),
    );
    const response = await app.request("/api/v1/widgets", {}, { ENVIRONMENT: "development" });
    expect(response.status).toBe(500);
    expect(captured).toBeInstanceOf(ResponseContractDivergenceError);
    const divergence = captured as ResponseContractDivergenceError;
    expect(divergence.operationId).toBe("widgets.list");
    expect(divergence.status).toBe(200);
    expect(divergence.issues.length).toBeGreaterThan(0);
    expect(divergence.issues.map((issue) => issue.path.join("."))).toContain("ok");
    expect(divergence.message).toContain("widgets.list");
    expect(divergence.message).toContain("200");
  });

  it("throws on an undeclared 2xx status — the route lied about its contract", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const context = contextWithResponse("development", jsonResponse({ ok: true, count: 1 }, 201));
    await expect(middleware(context, noopNext)).rejects.toThrow(ResponseContractDivergenceError);
    await expect(
      middleware(
        contextWithResponse("development", jsonResponse({ ok: true, count: 1 }, 201)),
        noopNext,
      ),
    ).rejects.toThrow(/undeclared status 201/);
  });

  it("lets an undeclared 4xx/5xx pass — shared problem responses register separately", async () => {
    // The defaultHook/problemJson replies (422, 500, …) are not declared per-route until they are
    // registered as shared responses; until then only 2xx statuses must be declared.
    const middleware = createResponseValidator(widgetRoute);
    const problemBody = { type: "about:blank", title: "Validation failed", status: 422 };
    await expect(
      middleware(
        contextWithResponse(
          "development",
          jsonResponse(problemBody, 422, "application/problem+json"),
        ),
        noopNext,
      ),
    ).resolves.toBeUndefined();
    await expect(
      middleware(
        contextWithResponse("development", jsonResponse({ anything: true }, 500)),
        noopNext,
      ),
    ).resolves.toBeUndefined();
  });

  it("skips a declared status without JSON content (204)", async () => {
    // The reversal is the DELETE registration guard's, not this test's subject — every DELETE
    // declares one, fixtures included.
    const noContentRoute = defineOpenAPIRoute(
      sampleMeta({
        operationId: "widgets.remove",
        reversal: { kind: "inverse", by: "widgets.create" },
      }),
      {
        method: "delete",
        path: "/api/v1/widgets/current",
        description: "Removes the widget.",
        responses: { 204: { description: "Removed" } },
      },
    );
    const middleware = createResponseValidator(noContentRoute);
    await expect(
      middleware(contextWithResponse("development", new Response(null, { status: 204 })), noopNext),
    ).resolves.toBeUndefined();
  });

  it("skips a declared non-JSON media type (binary/text responses are out of scope)", async () => {
    const exportRoute = defineOpenAPIRoute(sampleMeta({ operationId: "widgets.export" }), {
      method: "get",
      path: "/api/v1/widgets/export",
      description: "Exports widgets.",
      responses: {
        200: {
          description: "Export blob",
          content: { "application/octet-stream": { schema: z.string() } },
        },
      },
    });
    const middleware = createResponseValidator(exportRoute);
    const response = new Response("binary-ish payload", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).resolves.toBeUndefined();
  });

  it("throws when the declared-JSON response body is not parseable JSON", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const response = new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).rejects.toThrow(/not parseable JSON/);
  });

  it("throws when JSON content is declared but the handler replied with a non-JSON content-type", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const response = new Response("plain text reply", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).rejects.toThrow(/text\/plain/);
  });

  it("never consumes the body the client receives — validation reads a clone", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const response = jsonResponse({ ok: true, count: 2 }, 200);
    await middleware(contextWithResponse("development", response), noopNext);
    expect(response.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ ok: true, count: 2 });
  });

  // A route declaring application/problem+json content for a 2xx — the +json suffix branch of
  // isJsonMediaType and the declaredJsonMediaTypes fallback path, the path that validates problem
  // bodies once shared problem responses are registered. application/json-only routes never
  // exercise it.
  const ProblemLike = z.object({ type: z.string(), title: z.string(), status: z.number().int() });
  const problemContentRoute = defineOpenAPIRoute(sampleMeta({ operationId: "widgets.problem" }), {
    method: "get",
    path: "/api/v1/widgets/problem",
    description: "Returns a problem-shaped body.",
    responses: {
      200: {
        description: "A problem-shaped 200",
        content: { "application/problem+json": { schema: ProblemLike } },
      },
    },
  });

  it("validates an application/problem+json declared body — conforming passes", async () => {
    const middleware = createResponseValidator(problemContentRoute);
    const response = jsonResponse(
      { type: "about:blank", title: "ok", status: 200 },
      200,
      "application/problem+json",
    );
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).resolves.toBeUndefined();
  });

  it("validates an application/problem+json declared body — divergent throws", async () => {
    const middleware = createResponseValidator(problemContentRoute);
    const response = jsonResponse(
      { type: "about:blank", title: 42, status: "nope" } as unknown,
      200,
      "application/problem+json",
    );
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).rejects.toThrow(ResponseContractDivergenceError);
  });

  it("normalizes a content-type with charset parameters (application/json; charset=utf-8) before matching", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const response = jsonResponse({ ok: true, count: 7 }, 200, "application/json; charset=utf-8");
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).resolves.toBeUndefined();
  });

  it("normalizes an uppercase content-type (Application/JSON) before matching", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const response = jsonResponse({ ok: true, count: 9 }, 200, "Application/JSON");
    await expect(
      middleware(contextWithResponse("development", response), noopNext),
    ).resolves.toBeUndefined();
  });
});

describe("createResponseValidator — production pass-through", () => {
  it("control: the body-read spy fires when the validator does read (development)", async () => {
    // Proves the zero-read assertions below are not vacuously green.
    const middleware = createResponseValidator(widgetRoute);
    const { response, bodyWasRead } = bodyReadSpyJsonResponse(
      JSON.stringify({ ok: true, count: 1 }),
      200,
    );
    await middleware(contextWithResponse("development", response), noopNext);
    expect(bodyWasRead()).toBe(true);
  });

  it("performs zero body reads when ENVIRONMENT is unset, even on a divergent body", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const { response, original, bodyWasRead } = bodyReadSpyJsonResponse(
      JSON.stringify({ ok: "diverged" }),
      200,
    );
    await expect(
      middleware(contextWithResponse(undefined, response), noopNext),
    ).resolves.toBeUndefined();
    expect(bodyWasRead()).toBe(false);
    expect(original.bodyUsed).toBe(false);
  });

  it("performs zero body reads when ENVIRONMENT is any non-development value", async () => {
    const middleware = createResponseValidator(widgetRoute);
    const { response, original, bodyWasRead } = bodyReadSpyJsonResponse(
      JSON.stringify({ ok: "diverged" }),
      200,
    );
    await expect(
      middleware(contextWithResponse("production", response), noopNext),
    ).resolves.toBeUndefined();
    expect(bodyWasRead()).toBe(false);
    expect(original.bodyUsed).toBe(false);
  });

  it("passes through without crashing when env itself is undefined (two-argument app.request)", async () => {
    // Hono's app.request(path, init) without a third argument passes env as undefined — the
    // validator must treat that as not-development, never crash reading ENVIRONMENT off it.
    const middleware = createResponseValidator(widgetRoute);
    const { response, original, bodyWasRead } = bodyReadSpyJsonResponse(
      JSON.stringify({ ok: "diverged" }),
      200,
    );
    const contextWithUndefinedEnvironment = {
      env: undefined,
      res: response,
    } as unknown as Context<{ Bindings: { ENVIRONMENT?: string } }>;
    await expect(middleware(contextWithUndefinedEnvironment, noopNext)).resolves.toBeUndefined();
    expect(bodyWasRead()).toBe(false);
    expect(original.bodyUsed).toBe(false);
  });
});
