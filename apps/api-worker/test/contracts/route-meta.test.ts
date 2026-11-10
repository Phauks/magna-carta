// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// RouteMeta + defineOpenAPIRoute — the route-metadata model. Every assertion that matters runs
// over the EMITTED OpenAPI document, not the route object: the document is what the conformance
// fitness functions, Spectral, Prism, and the generated clients consume.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { idempotencyKeyHeader } from "../../src/http/contracts/common";
import {
  defineOpenAPIRoute,
  routeMetaOf,
  type RouteMeta,
} from "../../src/http/contracts/route-meta";

function sampleMeta(overrides: Partial<RouteMeta> = {}): RouteMeta {
  return {
    operationId: "matters.list",
    surface: "app",
    authenticated: true,
    permission: "firm:manageMembers",
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
    ...overrides,
  };
}

const okJsonResponse = {
  200: {
    description: "OK",
    content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
  },
} as const;

// Registers the route on a fresh app (handler echoes { ok: true }) and emits the 3.1 document.
function emitDocumentFor(route: any): Record<string, any> {
  const app = new OpenAPIHono();
  app.openapi(route, (c: any) => c.json({ ok: true }, 200));
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "test", version: "0.0.0" },
  }) as Record<string, any>;
}

describe("defineOpenAPIRoute — native fields and x-mc-* extensions in the emitted document", () => {
  it("emits the native operationId, defaulted tags, and every meta field as an x-mc-* extension", () => {
    const route = defineOpenAPIRoute(sampleMeta(), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    const operation = emitDocumentFor(route).paths["/api/v1/matters"].get;
    expect(operation.operationId).toBe("matters.list");
    expect(operation.tags).toEqual(["matters"]);
    expect(operation["x-mc-operationId"]).toBe("matters.list");
    expect(operation["x-mc-surface"]).toBe("app");
    expect(operation["x-mc-authenticated"]).toBe(true);
    expect(operation["x-mc-permission"]).toBe("firm:manageMembers");
    expect(operation["x-mc-resource"]).toBe("matter");
    expect(operation["x-mc-audited"]).toBe(false);
    expect(operation["x-mc-idempotency"]).toBe("optional");
    expect(operation["x-mc-rateLimit"]).toBe("default");
    expect(operation["x-mc-tags"]).toEqual(["matters"]);
    expect(operation["x-mc-deprecated"]).toBe(false);
  });

  it("honors explicit tags over the namespace default, natively and in x-mc-tags", () => {
    const route = defineOpenAPIRoute(sampleMeta({ tags: ["matters", "search"] }), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    const operation = emitDocumentFor(route).paths["/api/v1/matters"].get;
    expect(operation.tags).toEqual(["matters", "search"]);
    expect(operation["x-mc-tags"]).toEqual(["matters", "search"]);
  });

  it("falls back to the namespace default when tags is an empty array — an empty list never reaches the document", () => {
    const route = defineOpenAPIRoute(sampleMeta({ tags: [] }), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    const operation = emitDocumentFor(route).paths["/api/v1/matters"].get;
    expect(operation.tags).toEqual(["matters"]);
    expect(operation["x-mc-tags"]).toEqual(["matters"]);
    expect(routeMetaOf(route)?.tags).toEqual(["matters"]);
  });

  it("emits x-mc-permission as null on an unauthenticated route", () => {
    const route = defineOpenAPIRoute(
      sampleMeta({ operationId: "health.check", authenticated: false, permission: null }),
      {
        method: "get",
        path: "/api/v1/health",
        description: "Liveness probe.",
        responses: okJsonResponse,
      },
    );
    const operation = emitDocumentFor(route).paths["/api/v1/health"].get;
    expect(operation["x-mc-authenticated"]).toBe(false);
    expect(operation["x-mc-permission"]).toBeNull();
  });

  it("emits the OpenAPI-native deprecated flag (and x-mc-deprecated) when meta.deprecated is true", () => {
    const route = defineOpenAPIRoute(sampleMeta({ deprecated: true }), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    const operation = emitDocumentFor(route).paths["/api/v1/matters"].get;
    expect(operation.deprecated).toBe(true);
    expect(operation["x-mc-deprecated"]).toBe(true);
  });
});

describe("routeMetaOf", () => {
  it("round-trips the meta from the returned route object, with tags and deprecated resolved", () => {
    const route = defineOpenAPIRoute(sampleMeta(), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    expect(routeMetaOf(route)).toEqual({
      operationId: "matters.list",
      surface: "app",
      authenticated: true,
      permission: "firm:manageMembers",
      resource: "matter",
      audited: false,
      idempotency: "optional",
      rateLimit: "default",
      tags: ["matters"],
      deprecated: false,
      // The closed default: a route that says nothing about a session carrying no firm refuses
      // one. Every route in the platform but the joining ones leaves this unset, so the value
      // resolved here is the one almost the whole surface runs on.
      firmlessSession: "reject",
    });
  });

  it("returns undefined for an object that did not come from defineOpenAPIRoute", () => {
    expect(routeMetaOf({})).toBeUndefined();
  });
});

describe("operationId registration-time validation", () => {
  const malformedOperationIds = [
    "mattersList", // no namespace separator
    "Matters.list", // namespace must start lowercase
    "matters.List", // action must start lowercase
    "matters.list.archive", // exactly one separator
    "matters.", // empty action
    ".list", // empty namespace
    "matters-search.list", // only [a-zA-Z0-9] inside each segment
    "", // empty
  ];

  it.each(malformedOperationIds)("throws at definition time for %j", (operationId) => {
    expect(() =>
      defineOpenAPIRoute(sampleMeta({ operationId }), {
        method: "get",
        path: "/api/v1/matters",
        description: "Lists matters.",
        responses: okJsonResponse,
      }),
    ).toThrowError(/operationId/);
  });
});

describe("fail-closed access-control guard at definition time", () => {
  it("throws when a public route (authenticated: false) names a capability — the chokepoint ignores it, so naming one is a confused contract", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({
          operationId: "health.check",
          authenticated: false,
          permission: "firm:manageMembers",
        }),
        {
          method: "get",
          path: "/api/v1/health",
          description: "Liveness probe.",
          responses: okJsonResponse,
        },
      ),
    ).toThrowError(/health\.check/);
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({
          operationId: "health.check",
          authenticated: false,
          permission: "firm:manageMembers",
        }),
        {
          method: "get",
          path: "/api/v1/health",
          description: "Liveness probe.",
          responses: okJsonResponse,
        },
      ),
    ).toThrowError(/permission/);
  });

  it("throws when a DELETE declares no reversal — the question deletion is asked most and answered least", () => {
    expect(() =>
      defineOpenAPIRoute(sampleMeta({ operationId: "matters.remove" }), {
        method: "delete",
        path: "/api/v1/matters/{id}",
        description: "Removes a matter.",
        responses: okJsonResponse,
      }),
    ).toThrowError(/reversal/);
  });

  it("throws when a none carries no reason — the one arm that must say why", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({
          operationId: "matters.remove",
          reversal: { kind: "none", reason: "  " },
        }),
        {
          method: "delete",
          path: "/api/v1/matters/{id}",
          description: "Removes a matter.",
          responses: okJsonResponse,
        },
      ),
    ).toThrowError(/reason/);
  });

  it("emits the declaration, because the UI reads it rather than restating it", () => {
    const route = defineOpenAPIRoute(
      sampleMeta({
        operationId: "matters.remove",
        reversal: { kind: "inverse", by: "matters.restore" },
      }),
      {
        method: "delete",
        path: "/api/v1/matters/{id}",
        description: "Removes a matter.",
        responses: okJsonResponse,
      },
    );
    expect(emitDocumentFor(route).paths["/api/v1/matters/{id}"].delete["x-mc-reversal"]).toEqual({
      kind: "inverse",
      by: "matters.restore",
    });
  });

  it("leaves the extension off a route that declares nothing, so absence stays readable", () => {
    const route = defineOpenAPIRoute(sampleMeta(), {
      method: "get",
      path: "/api/v1/matters",
      description: "Lists matters.",
      responses: okJsonResponse,
    });
    expect(emitDocumentFor(route).paths["/api/v1/matters"].get).not.toHaveProperty("x-mc-reversal");
  });

  it("throws when an authenticated mutating route names a null permission — the chokepoint reads null as any-authenticated-user (privilege escalation by omission)", () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      expect(() =>
        defineOpenAPIRoute(sampleMeta({ operationId: "matters.create", permission: null }), {
          method,
          path: "/api/v1/matters",
          description: "Mutates matters.",
          responses: okJsonResponse,
        }),
      ).toThrowError(/matters\.create/);
    }
  });

  it("throws for an uppercase mutating method (case-insensitive method check)", () => {
    expect(() =>
      defineOpenAPIRoute(sampleMeta({ operationId: "matters.create", permission: null }), {
        method: "POST" as unknown as "post",
        path: "/api/v1/matters",
        description: "Mutates matters.",
        responses: okJsonResponse,
      }),
    ).toThrowError(/permission/);
  });

  it("allows a public route with a null permission (the legitimate public case)", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({ operationId: "health.check", authenticated: false, permission: null }),
        {
          method: "get",
          path: "/api/v1/health",
          description: "Liveness probe.",
          responses: okJsonResponse,
        },
      ),
    ).not.toThrow();
  });

  it("allows an authenticated GET with a null permission — the legitimate any-authenticated-user read case (e.g. GET /v1/me)", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({ operationId: "me.read", authenticated: true, permission: null }),
        {
          method: "get",
          path: "/api/v1/me",
          description: "The current user.",
          responses: okJsonResponse,
        },
      ),
    ).not.toThrow();
  });

  it("allows an authenticated mutating route with a real permission", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({
          operationId: "matters.create",
          authenticated: true,
          permission: "firm:manageMembers",
        }),
        {
          method: "post",
          path: "/api/v1/matters",
          description: "Creates a matter.",
          responses: okJsonResponse,
        },
      ),
    ).not.toThrow();
  });
});

describe("idempotency-required header documentation flip", () => {
  function createMatterRoute(idempotency: "required" | "optional") {
    return defineOpenAPIRoute(
      sampleMeta({ operationId: "matters.create", idempotency, audited: true }),
      {
        method: "post",
        path: "/api/v1/matters",
        description: "Creates a matter.",
        request: { headers: idempotencyKeyHeader },
        responses: okJsonResponse,
      },
    );
  }

  function idempotencyKeyParameterOf(document: Record<string, any>): Record<string, any> {
    return document.paths["/api/v1/matters"].post.parameters.find(
      (parameter: { name: string }) => parameter.name === "idempotency-key",
    );
  }

  it("marks the idempotency-key header parameter required: true in the emitted document when idempotency is required", () => {
    const parameter = idempotencyKeyParameterOf(emitDocumentFor(createMatterRoute("required")));
    expect(parameter).toBeDefined();
    expect(parameter.in).toBe("header");
    expect(parameter.required).toBe(true);
  });

  it("leaves the header parameter required: false when idempotency is optional", () => {
    const parameter = idempotencyKeyParameterOf(emitDocumentFor(createMatterRoute("optional")));
    expect(parameter).toBeDefined();
    expect(parameter.required).toBe(false);
  });

  it("does not contaminate the shared idempotencyKeyHeader fragment: an optional route defined after a required one still emits required: false", () => {
    createMatterRoute("required"); // would mutate the shared fragment if the flip were not a clone
    const parameter = idempotencyKeyParameterOf(emitDocumentFor(createMatterRoute("optional")));
    expect(parameter.required).toBe(false);
  });

  it("keeps the flip documentation-only: a request without the header still passes schema validation (presence belongs to the chokepoint middleware)", async () => {
    const app = new OpenAPIHono();
    app.openapi(createMatterRoute("required"), (c) => c.json({ ok: true }, 200));
    const response = await app.request("/api/v1/matters", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("still accepts a request WITH a valid idempotency-key header on an idempotency-required route — the documentation flip must never tighten runtime validation", async () => {
    const app = new OpenAPIHono();
    app.openapi(createMatterRoute("required"), (c) => c.json({ ok: true }, 200));
    const response = await app.request("/api/v1/matters", {
      method: "POST",
      headers: { "idempotency-key": "0192f0c1-2345-7890-abcd-ef0123456789" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("throws at definition time when request.headers is an array shape — the flip requires a single z.object", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({ operationId: "matters.create", idempotency: "required", audited: true }),
        {
          method: "post",
          path: "/api/v1/matters",
          description: "Creates a matter.",
          request: { headers: [idempotencyKeyHeader] },
          responses: okJsonResponse,
        },
      ),
    ).toThrowError(/single z\.object/);
  });

  it("throws at definition time when an idempotency-required route does not declare the idempotency-key header", () => {
    expect(() =>
      defineOpenAPIRoute(
        sampleMeta({ operationId: "matters.create", idempotency: "required", audited: true }),
        {
          method: "post",
          path: "/api/v1/matters",
          description: "Creates a matter.",
          responses: okJsonResponse,
        },
      ),
    ).toThrowError(/idempotency-key/);
  });
});
