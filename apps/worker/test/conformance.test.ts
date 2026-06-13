// Slice 0·5b Task 10: the §3.5 conformance fitness functions (design spec, conformance fitness
// functions; ADR-0051/0067/0068). The route table is a security registry — these run structurally
// over the EMITTED document (not source text), so a route that drifts out of the posture fails CI.
//
// Each fitness function returns a list of human-readable violations; a clean contract returns []. Every
// rule is proven two ways: the committed contract satisfies it, AND a deliberately-misconfigured route
// (constructed in-test, never committed) is caught — the machinery, not just today's happy routes.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { buildOpenAPIDocument, createApp } from "../src/app.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../src/contracts/route-meta.ts";

type Operation = Record<string, unknown>;
const MUTATING_METHODS = ["post", "put", "patch", "delete"] as const;
const OPERATION_ID_SHAPE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

// authenticated: false is never implicit — every anonymous route is allow-listed here with the reason
// it carries no firm data behind no session. Adding an anonymous route without an entry fails the gate
// (decided #5 / spec §3.5 "no route is silently public").
const PUBLIC_ALLOW_LIST: Record<string, string> = {
  "health.read":
    "Liveness/readiness probe — platform plumbing, no firm data, no session (white paper Observability & diagnostics).",
};

// Subsystems whose every route must be idempotency: required (money/trust/payment/outbound-comms).
// Empty until the trust/billing/payments/comms slices land — the assertion machinery is what ships now;
// each of those slices adds its operationId namespace here as it builds (spec §3.5).
const MONEY_NAMESPACES = new Set<string>();

// x-mc-operationId is a string in every emitted operation; read it defensively (the value is typed
// unknown off the document record) so the fitness functions never stringify a non-string.
function operationIdOf(operation: Operation): string {
  const value = operation["x-mc-operationId"];
  return typeof value === "string" ? value : "";
}

// Yields every operation in the document with its path/method, operationId, and namespace.
function* operations(document: ReturnType<typeof buildOpenAPIDocument>) {
  const methods = ["get", ...MUTATING_METHODS] as const;
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (operation === undefined) continue;
      const operationId = operationIdOf(operation);
      yield { path, method, operation, operationId, namespace: operationId.split(".")[0] ?? "" };
    }
  }
}

const isMutating = (method: string): boolean =>
  (MUTATING_METHODS as readonly string[]).includes(method);

// Rule: every authenticated mutating route is audited AND names a permission; an unauthenticated
// mutating route (allow-listed public) is still audited (spec §3.5).
function auditedMutatingViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    if (!isMutating(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;
    if (operation["x-mc-audited"] !== true) {
      violations.push(`${label}: mutating route must be x-mc-audited: true`);
    }
    if (operation["x-mc-authenticated"] === true && operation["x-mc-permission"] == null) {
      violations.push(
        `${label}: authenticated mutating route must name a non-null x-mc-permission`,
      );
    }
  }
  return violations;
}

// Rule: every named permission exists in the registry, and its namespace matches the route's subsystem
// — the resource it governs, NOT the operationId tag. Route modules `members`/`firms` both belong to
// the `firm` subsystem, so the permission namespace binds to x-mc-resource (the per-subsystem registry
// of ADR-0068), which is the coherent reading of spec §3.5's "namespace matches the route's module".
function permissionRegistryViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const registry = new Set<string>(PERMISSIONS);
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const permission = operation["x-mc-permission"];
    if (permission == null) continue;
    const label = `${method.toUpperCase()} ${path}`;
    if (typeof permission !== "string" || !registry.has(permission)) {
      violations.push(
        `${label}: x-mc-permission ${JSON.stringify(permission)} is not in the registry`,
      );
      continue;
    }
    const namespace = permission.split(":")[0];
    const resource = operation["x-mc-resource"];
    if (namespace !== resource) {
      violations.push(
        `${label}: permission namespace "${namespace}" must match x-mc-resource "${String(resource)}"`,
      );
    }
  }
  return violations;
}

// Rule: every route in a money/trust/payment/comms subsystem declares idempotency: required (spec §3.5).
function moneyIdempotencyViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  moneyNamespaces: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation, namespace } of operations(document)) {
    if (!moneyNamespaces.has(namespace)) continue;
    if (operation["x-mc-idempotency"] !== "required") {
      violations.push(
        `${method.toUpperCase()} ${path}: ${namespace} is a money subsystem — x-mc-idempotency must be "required"`,
      );
    }
  }
  return violations;
}

// Rule: authenticated: false requires an explicit PUBLIC_ALLOW_LIST entry with a justification (spec §3.5).
function publicAllowListViolations(
  document: ReturnType<typeof buildOpenAPIDocument>,
  allowList: Record<string, string>,
): string[] {
  const violations: string[] = [];
  for (const { path, method, operation, operationId } of operations(document)) {
    if (operation["x-mc-authenticated"] !== false) continue;
    const justification = allowList[operationId];
    if (justification === undefined || justification.trim() === "") {
      violations.push(
        `${method.toUpperCase()} ${path}: authenticated: false requires a PUBLIC_ALLOW_LIST entry with a justification (operationId "${operationId}")`,
      );
    }
  }
  return violations;
}

// Rule: `surface` is internally consistent — valid value, and the app (cookie-session) surface is never
// anonymous (spec §3.5/§6). The mechanism-level assertion (an `app` route never bearer, a `public` route
// never cookie) attaches when the auth surfaces emit OpenAPI security schemes — deferred (ADR-0068); the
// boolean coherence is what the emitted document can enforce today.
function surfaceConsistencyViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const valid = new Set(["app", "public", "portal"]);
  const violations: string[] = [];
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const surface = operation["x-mc-surface"];
    if (typeof surface !== "string" || !valid.has(surface)) {
      violations.push(
        `${label}: x-mc-surface ${JSON.stringify(surface)} is not one of app|public|portal`,
      );
      continue;
    }
    if (surface === "app" && operation["x-mc-authenticated"] !== true) {
      violations.push(`${label}: an app-surface (cookie-session) route is never anonymous`);
    }
  }
  return violations;
}

// Rule: every operationId is unique and matches subsystem.action (spec §3.5).
function operationIdViolations(document: ReturnType<typeof buildOpenAPIDocument>): string[] {
  const violations: string[] = [];
  const seen = new Map<string, string>();
  for (const { path, method, operation } of operations(document)) {
    const label = `${method.toUpperCase()} ${path}`;
    const operationId = operation.operationId;
    if (typeof operationId !== "string" || !OPERATION_ID_SHAPE.test(operationId)) {
      violations.push(
        `${label}: operationId ${JSON.stringify(operationId)} must match subsystem.action`,
      );
      continue;
    }
    const prior = seen.get(operationId);
    if (prior !== undefined) {
      violations.push(`${label}: operationId "${operationId}" already used by ${prior}`);
    } else {
      seen.set(operationId, label);
    }
  }
  return violations;
}

// Rule (0·5a forward-obligation): every registered component NAME maps to exactly one schema shape.
// zod-to-openapi 1.4.0 silently first-write-wins on a duplicate .openapi(name), so two distinct schemas
// under one name produce a document where one masquerades as the other — invisible in the deduped
// document. We re-emit each route in isolation and compare the JSON-Schema each component name produces:
// a collision (same name, different shape across routes) is caught; correct shared reuse (Problem,
// referenced by many routes with one shape) passes.
function componentNameCollisions(app: ReturnType<typeof createApp>): string[] {
  const shapesByName = new Map<string, Set<string>>();
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== "route") continue;
    const isolated = new OpenAPIHono();
    isolated.openapi(definition.route, (c: any) => c.json({}, 200));
    const document = isolated.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "isolated", version: "0.0.0" },
    }) as { components?: { schemas?: Record<string, unknown> } };
    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      const shapes = shapesByName.get(name) ?? new Set<string>();
      shapes.add(JSON.stringify(schema));
      shapesByName.set(name, shapes);
    }
  }
  const violations: string[] = [];
  for (const [name, shapes] of shapesByName) {
    if (shapes.size > 1) {
      violations.push(
        `component "${name}" is registered under ${shapes.size} distinct schema shapes`,
      );
    }
  }
  return violations;
}

// --- Negative-control helpers: build a one-route document from arbitrary meta, never committed. ---
const okResponse = {
  200: {
    description: "OK",
    content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
  },
} as const;

function baseMeta(overrides: Partial<RouteMeta> = {}): RouteMeta {
  return {
    operationId: "widgets.list",
    surface: "app",
    authenticated: true,
    permission: "firm:manageMembers",
    resource: "firm",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
    ...overrides,
  };
}

function documentForRoute(
  meta: RouteMeta,
  route: { method: "get" | "post"; path: string },
): ReturnType<typeof buildOpenAPIDocument> {
  const app = new OpenAPIHono();
  const bundle = defineOpenAPIRoute(meta, {
    method: route.method,
    path: route.path,
    description: "A deliberately-constructed route for the conformance negative control.",
    responses: okResponse,
  });
  app.openapi(bundle, (c: any) => c.json({ ok: true }, 200));
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "neg", version: "0.0.0" },
  }) as ReturnType<typeof buildOpenAPIDocument>;
}

// Some invariants are ALSO guarded by defineOpenAPIRoute at registration time (operationId shape, a
// null permission on an authenticated mutating route), so a bad bundle can't be built through it. The
// fitness function is the document-level backstop (against a hand-edited snapshot, or a route not built
// through defineOpenAPIRoute), so its negative control feeds a raw operation document directly.
function documentWithOperations(
  routes: { method: string; path: string; operation: Record<string, unknown> }[],
): ReturnType<typeof buildOpenAPIDocument> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path, operation } of routes) {
    paths[path] = { ...paths[path], [method]: operation };
  }
  return { openapi: "3.1.0", info: { title: "raw", version: "0.0.0" }, paths } as ReturnType<
    typeof buildOpenAPIDocument
  >;
}

// A well-formed operation object carrying the x-mc-* posture, for raw negative controls to mutate.
function rawOperation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: "widgets.list",
    "x-mc-operationId": "widgets.list",
    "x-mc-surface": "app",
    "x-mc-authenticated": true,
    "x-mc-permission": "firm:manageMembers",
    "x-mc-resource": "firm",
    "x-mc-audited": true,
    "x-mc-idempotency": "optional",
    "x-mc-rateLimit": "default",
    responses: { 200: { description: "OK" } },
    ...overrides,
  };
}

describe("§3.5 conformance — the committed contract holds, and each rule catches a bad route", () => {
  const document = buildOpenAPIDocument();

  // Guards the suite against vacuity: if operations() yielded nothing, every `toEqual([])` below would
  // pass trivially. Assert the document exposes exactly the operations we expect to enforce over.
  it("exposes the known committed operations (so the positive assertions are not vacuous)", () => {
    const ids = [...operations(document)].map((entry) => entry.operationId).sort();
    expect(ids).toEqual(["firms.provision", "health.read", "me.get", "members.invite"]);
  });

  describe("authenticated mutating routes are audited and name a permission", () => {
    it("the committed contract satisfies it", () => {
      expect(auditedMutatingViolations(document)).toEqual([]);
    });
    it("flags an authenticated mutating route that is not audited", () => {
      const bad = documentForRoute(baseMeta({ audited: false }), {
        method: "post",
        path: "/api/v1/widgets",
      });
      expect(auditedMutatingViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags an authenticated mutating route with a null permission (raw — defineOpenAPIRoute guards this at registration)", () => {
      const bad = documentWithOperations([
        {
          method: "post",
          path: "/api/v1/widgets",
          operation: rawOperation({ "x-mc-permission": null }),
        },
      ]);
      expect(auditedMutatingViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("named permissions exist in the registry with a matching subsystem", () => {
    it("the committed contract satisfies it", () => {
      expect(permissionRegistryViolations(document)).toEqual([]);
    });
    it("flags a permission absent from the registry", () => {
      const bad = documentForRoute(
        baseMeta({ permission: "firm:bogusAction" as RouteMeta["permission"] }),
        { method: "post", path: "/api/v1/widgets" },
      );
      expect(permissionRegistryViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a permission whose namespace does not match the resource", () => {
      const bad = documentForRoute(
        baseMeta({ permission: "firm:manageMembers", resource: "matter" }),
        {
          method: "post",
          path: "/api/v1/widgets",
        },
      );
      expect(permissionRegistryViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("money-subsystem routes require idempotency (machinery; set empty today)", () => {
    it("the committed contract satisfies it", () => {
      expect(moneyIdempotencyViolations(document, MONEY_NAMESPACES)).toEqual([]);
    });
    it("flags a money-subsystem route declaring idempotency optional", () => {
      const bad = documentForRoute(
        baseMeta({ operationId: "payments.charge", idempotency: "optional" }),
        {
          method: "post",
          path: "/api/v1/payments",
        },
      );
      expect(moneyIdempotencyViolations(bad, new Set(["payments"])).length).toBeGreaterThan(0);
    });
  });

  describe("anonymous routes are explicitly allow-listed", () => {
    it("the committed contract satisfies it", () => {
      expect(publicAllowListViolations(document, PUBLIC_ALLOW_LIST)).toEqual([]);
    });
    it("flags an authenticated: false route that is not in the allow-list", () => {
      const bad = documentForRoute(
        baseMeta({
          operationId: "intake.submit",
          surface: "public",
          authenticated: false,
          permission: null,
        }),
        { method: "post", path: "/api/v1/intake" },
      );
      expect(publicAllowListViolations(bad, PUBLIC_ALLOW_LIST).length).toBeGreaterThan(0);
    });
  });

  describe("surface is internally consistent", () => {
    it("the committed contract satisfies it", () => {
      expect(surfaceConsistencyViolations(document)).toEqual([]);
    });
    it("flags an app-surface route that is anonymous", () => {
      const bad = documentForRoute(
        baseMeta({ surface: "app", authenticated: false, permission: null }),
        {
          method: "get",
          path: "/api/v1/widgets",
        },
      );
      expect(surfaceConsistencyViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("operationIds are unique and well-shaped", () => {
    it("the committed contract satisfies it", () => {
      expect(operationIdViolations(document)).toEqual([]);
    });
    it("flags a malformed operationId (raw — defineOpenAPIRoute guards the shape at registration)", () => {
      const bad = documentWithOperations([
        {
          method: "get",
          path: "/api/v1/widgets",
          operation: rawOperation({
            operationId: "Widgets_List",
            "x-mc-operationId": "Widgets_List",
          }),
        },
      ]);
      expect(operationIdViolations(bad).length).toBeGreaterThan(0);
    });
    it("flags a duplicate operationId across two routes (raw)", () => {
      const bad = documentWithOperations([
        { method: "get", path: "/api/v1/widgets", operation: rawOperation() },
        { method: "get", path: "/api/v1/gadgets", operation: rawOperation() },
      ]);
      expect(operationIdViolations(bad).length).toBeGreaterThan(0);
    });
  });

  describe("component names map to a single schema shape", () => {
    it("the committed contract satisfies it", () => {
      expect(componentNameCollisions(createApp())).toEqual([]);
    });
    it("flags two distinct schemas registered under one name", () => {
      const app = new OpenAPIHono();
      const first = defineOpenAPIRoute(baseMeta({ operationId: "widgets.first" }), {
        method: "get",
        path: "/api/v1/widgets/first",
        description: "First route registering the colliding component.",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": { schema: z.object({ a: z.string() }).openapi("Collide") },
            },
          },
        },
      });
      const second = defineOpenAPIRoute(baseMeta({ operationId: "widgets.second" }), {
        method: "get",
        path: "/api/v1/widgets/second",
        description: "Second route registering a DIFFERENT schema under the same name.",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": { schema: z.object({ b: z.number() }).openapi("Collide") },
            },
          },
        },
      });
      app.openapi(first, (c: any) => c.json({ a: "x" }, 200));
      app.openapi(second, (c: any) => c.json({ b: 1 }, 200));
      expect(componentNameCollisions(app as ReturnType<typeof createApp>).length).toBeGreaterThan(
        0,
      );
    });
  });
});
