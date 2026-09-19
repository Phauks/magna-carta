import { describe, expect, it } from "vitest";
import { buildOpenAPIDocument, createApp } from "../src/app.ts";
import { createDomainApp } from "../src/routes/domain-app.ts";

// Fitness function (the live-dispatch-table pattern, the twin of worker-first-routing-scan.ts):
// every operation the contract publishes resolves, through Hono's own router, to the route that
// declared it — never to another route whose pattern happens to match first.
//
// WHY THE ROUTER AND NOT THE DOCUMENT. The OpenAPI document is emitted from the registry, which
// records every route that was registered; it says nothing about which of two registered routes a
// request will actually reach. Hono matches in registration order, so a dynamic segment registered
// ahead of a literal one claims the literal: `GET .../time-entries/{id}` registered before
// `GET .../time-entries/rounding-policy` answers the latter with a 422 for a malformed id, while the
// document goes on describing both as reachable and the snapshot test goes on passing. That
// ordering used to be a fact about the position of a line in app.ts; as routes regroup into domain
// modules it becomes a fact about the module manifest, and either way this is the check that turns
// a wrong order into a named failure instead of a production 422.
//
// The instrument is `app.router.match`, the same call Hono's dispatch makes, over a probe path with
// every parameter filled in. The first matched handler registered for the method (middleware
// registered with `app.use` carries the method ALL and is skipped) must be the operation's own.

type RouterOf = ReturnType<typeof createApp>;

// A path template as the document prints it (`/api/v1/matters/{id}`) into the shape Hono registers
// (`/api/v1/matters/:id`), and into a concrete path a request could carry.
function honoPathOf(openApiPath: string): string {
  return openApiPath.replaceAll(/\{([^}]+)\}/g, ":$1");
}
function probePathOf(openApiPath: string): string {
  return openApiPath.replaceAll(/\{[^}]+\}/g, "probe-value");
}

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;

function* operationsOf(document: ReturnType<typeof buildOpenAPIDocument>) {
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (operation) yield { path, method, operationId: operation.operationId ?? "(anonymous)" };
    }
  }
}

// The registered path of the route a request for `method` + `path` actually reaches, or null when
// nothing registered for that method matches. Hono's match result is `[[handler, route], params][]`
// in dispatch order; the route entry carries the path and method it was registered under.
export function resolvedRoutePathFor(app: RouterOf, method: string, path: string): string | null {
  const [matched] = app.router.match(method.toUpperCase(), path);
  for (const [[, route]] of matched) {
    if (route.method !== "ALL") return route.path;
  }
  return null;
}

// Every operation whose request would reach a different route than the one that declared it.
export function shadowedOperations(
  app: RouterOf,
  document: ReturnType<typeof buildOpenAPIDocument>,
): string[] {
  const findings: string[] = [];
  for (const { path, method, operationId } of operationsOf(document)) {
    const expected = honoPathOf(path);
    const actual = resolvedRoutePathFor(app, method, probePathOf(path));
    if (actual === expected) continue;
    findings.push(
      actual === null
        ? `${operationId} (${method.toUpperCase()} ${path}) matches no registered route`
        : `${operationId} (${method.toUpperCase()} ${path}) is claimed by ${actual}, registered ahead of it — register the literal path before the pattern that shadows it`,
    );
  }
  return findings;
}

describe("every published operation resolves to its own route (the route table)", () => {
  const app = createApp();
  const document = buildOpenAPIDocument();

  it("no operation is shadowed by a route registered ahead of it", () => {
    expect(shadowedOperations(app, document)).toEqual([]);
  });

  it("is not vacuous — it walks the real operations and the real dispatch table", () => {
    const count = [...operationsOf(document)].length;
    expect(count).toBeGreaterThan(500);
    expect(resolvedRoutePathFor(app, "get", "/api/v1/me")).toBe("/api/v1/me");
  });

  it("names a literal path that a pattern registered ahead of it claims", () => {
    // The self-test: the exact failure the check exists to catch, built on a throwaway router so the
    // real app is never touched. A helper that could not see this would pass the real table for the
    // wrong reason.
    const probe = createDomainApp();
    probe.get("/probe/:id", (c) => c.text("pattern"));
    probe.get("/probe/literal", (c) => c.text("literal"));
    expect(resolvedRoutePathFor(probe, "get", "/probe/literal")).toBe("/probe/:id");

    const ordered = createDomainApp();
    ordered.get("/probe/literal", (c) => c.text("literal"));
    ordered.get("/probe/:id", (c) => c.text("pattern"));
    expect(resolvedRoutePathFor(ordered, "get", "/probe/literal")).toBe("/probe/literal");
  });
});
