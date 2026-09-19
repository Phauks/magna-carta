// @repo-wide-fitness — scans every route module for the three shapes a route may not take; a diff
// that adds a route elsewhere in the tree is exactly the one this has to see.
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern, twin of r2-object-dimension-scan.ts): the
// three rules that keep a route module honest, held over the source rather than trusted to review.
//
// 1. NO ROUTE MODULE CONSTRUCTS `OpenAPIHono` ITSELF. `defaultHook` — the hook that turns a zod
//    validation failure into the 422 problem document — is per instance, so a router built at a
//    second site would silently answer a malformed request with the library's default body while the
//    contract goes on declaring the 422. src/routes/domain-app.ts is the one constructor.
// 2. EVERY `app.openapi(` REGISTRATION CARRIES THE CHOKEPOINT. `chokepointMiddleware` is where the
//    registration-time meta assertion runs (a route without meta, or naming an unregistered
//    permission, throws at startup) and where the enforcement chain is composed. A registration that
//    passes its own middleware array instead is a route with per-handler auth discipline, which is
//    the thing the chokepoint exists to make impossible. A genuine exception — none exists today —
//    carries an inline `fitness:allow-no-chokepoint` marker with its reason on the line above.
// 3. A DOMAIN MODULE NEVER IMPORTS ANOTHER DOMAIN'S ENTRY. Once routes live in
//    src/routes/<domain>/, a module reaching into a sibling's index.ts is two domains fused by an
//    import; what they share goes under src/routes/shared/ instead.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so
// the sources are pulled in as raw text at build time. import.meta.glob is a Vite build-time macro: it
// inlines the matched files and MUST be referenced by its full literal name, so it cannot be aliased.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const ROUTE_SOURCES = import.meta.glob("../src/routes/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const CONSTRUCTOR_MODULE = "domain-app.ts";
// A registration is `app.openapi(` on the module's router parameter: every module names it `app`
// (617 registrations today, none spelled otherwise). Schema metadata is `.openapi({ description })`
// on a zod value and is never on `app`, which is what keeps this pattern from seeing it.
const REGISTRATION_PATTERN = /\bapp\.openapi\(/g;
// From the registration to the handler's arrow is the route object plus its middleware — the window
// the chokepoint call has to appear in.
const HANDLER_ARROW = "=>";
const ALLOW_MARKER = "fitness:allow-no-chokepoint";
const MARKER_LOOKBEHIND = 200;

function routeFileName(modulePath: string): string {
  return modulePath.replace(/^.*\/src\/routes\//, "");
}

export function directConstructions(sources: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [modulePath, source] of Object.entries(sources)) {
    const file = routeFileName(modulePath);
    if (file === CONSTRUCTOR_MODULE) continue;
    if (/\bnew OpenAPIHono\b/.test(source)) {
      findings.push(
        `${file} constructs OpenAPIHono directly — build the router with createDomainApp() from src/routes/domain-app.ts`,
      );
    }
  }
  return findings;
}

export function registrationsWithoutChokepoint(sources: Record<string, string>): {
  readonly findings: string[];
  readonly registrations: number;
} {
  const findings: string[] = [];
  let registrations = 0;
  for (const [modulePath, source] of Object.entries(sources)) {
    const file = routeFileName(modulePath);
    REGISTRATION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REGISTRATION_PATTERN.exec(source)) !== null) {
      registrations += 1;
      const arrow = source.indexOf(HANDLER_ARROW, match.index);
      const window = source.slice(match.index, arrow === -1 ? undefined : arrow);
      if (window.includes("chokepointMiddleware(")) continue;
      const lookbehind = source.slice(Math.max(0, match.index - MARKER_LOOKBEHIND), match.index);
      if (lookbehind.includes(ALLOW_MARKER)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(
        `${file}:${line} registers a route without chokepointMiddleware — pass \`middleware: chokepointMiddleware(chokepoint, route)\` (src/chokepoint/register.ts)`,
      );
    }
  }
  return { findings, registrations };
}

export function crossDomainImports(sources: Record<string, string>): string[] {
  const findings: string[] = [];
  const importPattern = /from\s+"\.\.\/([a-z0-9-]+)\/(?:index\.ts)?"/g;
  for (const [modulePath, source] of Object.entries(sources)) {
    const file = routeFileName(modulePath);
    const segments = file.split("/");
    if (segments.length < 2) continue; // a flat route file has no domain to cross yet
    const domain = segments[0];
    let match: RegExpExecArray | null;
    importPattern.lastIndex = 0;
    while ((match = importPattern.exec(source)) !== null) {
      const target = match[1];
      if (target === domain || target === "shared") continue;
      findings.push(
        `${file} imports the ${target} domain's entry — move what they share under src/routes/shared/`,
      );
    }
  }
  return findings;
}

describe("route hygiene (src/routes)", () => {
  it("no route module constructs OpenAPIHono; createDomainApp is the one constructor", () => {
    expect(directConstructions(ROUTE_SOURCES)).toEqual([]);
    expect(
      Object.keys(ROUTE_SOURCES).some((path) => routeFileName(path) === CONSTRUCTOR_MODULE),
    ).toBe(true);
  });

  it("every app.openapi registration carries the chokepoint", () => {
    const { findings, registrations } = registrationsWithoutChokepoint(ROUTE_SOURCES);
    expect(findings).toEqual([]);
    // Not vacuous: the scan really sees the route surface.
    expect(registrations).toBeGreaterThan(500);
  });

  it("no domain module imports another domain's entry", () => {
    expect(crossDomainImports(ROUTE_SOURCES)).toEqual([]);
  });

  it("catches each shape in a fixture, so a passing scan is a scan that looked", () => {
    const fixtures = {
      "../src/routes/probe/index.ts":
        'import { OpenAPIHono } from "@hono/zod-openapi";\nimport { registerOther } from "../other/index.ts";\nconst app = new OpenAPIHono();\napp.openapi(\n  { ...route, middleware: [] },\n  async (c) => c.json({}),\n);\n',
      "../src/routes/probe/allowed.ts":
        "// fitness:allow-no-chokepoint — a self-test fixture\napp.openapi(\n  { ...route },\n  async (c) => c.json({}),\n);\n",
    };
    expect(directConstructions(fixtures)).toHaveLength(1);
    expect(registrationsWithoutChokepoint(fixtures).findings).toHaveLength(1);
    expect(registrationsWithoutChokepoint(fixtures).registrations).toBe(2);
    expect(crossDomainImports(fixtures)).toHaveLength(1);
  });
});
