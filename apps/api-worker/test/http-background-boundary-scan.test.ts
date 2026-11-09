// @repo-wide-fitness — scans every module on the Worker's HTTP side and background side for an
// import across the seam between them; the crossing import lands in whichever file is edited.
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern): the Worker has two sides and one seam.
// The HTTP side is src/http/ — the app, the chokepoint, the contracts helpers, the middleware and
// the route modules. The background side is src/background/ — the queue consumers, the Cron sweeps
// and their router. They share the bindings, the Durable Objects, the subsystem directories and the
// domain packages, and nothing else — and the seam is held here rather than trusted, because the one
// time it was trusted, 88 background files imported the env type from the composition root and
// every consumer depended on every route.
//
// TWO DIRECTIONS, TWO RULES.
// - Nothing under src/background/ imports Hono or anything under src/http/. A consumer that needs a
//   problem document, a session accessor or the router has picked up an HTTP concern; what it
//   actually needs (the env shape, the auth instance, the logger) has a module of its own at the
//   source root.
// - Nothing under src/http/routes/ imports anything under src/background/. What a route shares with
//   a consumer — a message type, an action name — belongs in the subsystem directory neither side
//   owns (emails/capture-types.ts, files/ingest-types.ts are the worked cases). The one HTTP-side
//   module that may reach the background side is src/http/request-path-sweep.ts, which hands a sweep
//   to waitUntil as a latency optimization; it is outside the route tree on purpose, and this rule
//   is scoped to the route tree so that stays a deliberate, single door.
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

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const BACKGROUND_SIDE = /(?:^|\/)src\/background\//;
const HTTP_SIDE = /(?:^|\/)src\/http\//;
const ROUTE_TREE = /(?:^|\/)src\/http\/routes\//;
const RELATIVE_IMPORT = /(?:from\s+|import\(\s*)"((?:\.\.?\/)[^"]+)"/g;
const HONO_IMPORT = /from\s+"hono(?:\/[^"]*)?"/g;

function sourceFileName(modulePath: string): string {
  return modulePath.replace(/^.*\/src\//, "src/");
}

// Resolve a relative specifier against the importing module's directory, as a src/-rooted path.
function resolveImport(modulePath: string, specifier: string): string {
  const segments = sourceFileName(modulePath).split("/");
  segments.pop();
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

export function backgroundModulesImportingHttp(sources: Record<string, string>): {
  readonly findings: string[];
  readonly backgroundModules: number;
} {
  const findings: string[] = [];
  let backgroundModules = 0;
  for (const [modulePath, source] of Object.entries(sources)) {
    if (!BACKGROUND_SIDE.test(modulePath)) continue;
    backgroundModules += 1;
    const file = sourceFileName(modulePath);
    HONO_IMPORT.lastIndex = 0;
    if (HONO_IMPORT.test(source)) {
      findings.push(
        `${file} imports Hono — a background module takes the env shape from bindings.ts, the auth instance from auth-instance.ts, the logger from worker-logger.ts, and never the HTTP side`,
      );
    }
    RELATIVE_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT.exec(source)) !== null) {
      const target = resolveImport(modulePath, match[1] ?? "");
      if (target.startsWith("src/http/")) {
        findings.push(
          `${file} imports ${target} — a background module never imports the HTTP side; what they share lives in the subsystem directory or at the source root`,
        );
      }
    }
  }
  return { findings, backgroundModules };
}

export function routeModulesImportingBackground(sources: Record<string, string>): {
  readonly findings: string[];
  readonly routeModules: number;
} {
  const findings: string[] = [];
  let routeModules = 0;
  for (const [modulePath, source] of Object.entries(sources)) {
    if (!ROUTE_TREE.test(modulePath)) continue;
    routeModules += 1;
    const file = sourceFileName(modulePath);
    RELATIVE_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT.exec(source)) !== null) {
      const target = resolveImport(modulePath, match[1] ?? "");
      if (target.startsWith("src/background/")) {
        findings.push(
          `${file} imports ${target} — a route shares a type or a constant with a consumer through the subsystem directory (as emails/capture-types.ts does), never by importing the consumer`,
        );
      }
    }
  }
  return { findings, routeModules };
}

describe("the HTTP-versus-background seam (apps/api-worker/src)", () => {
  it("nothing on the background side imports Hono or the HTTP side", () => {
    const { findings, backgroundModules } = backgroundModulesImportingHttp(SOURCES);
    expect(findings).toEqual([]);
    // Not vacuous: the scan really sees the background side.
    expect(backgroundModules).toBeGreaterThan(20);
  });

  it("nothing in the route tree imports the background side", () => {
    const { findings, routeModules } = routeModulesImportingBackground(SOURCES);
    expect(findings).toEqual([]);
    expect(routeModules).toBeGreaterThan(90);
  });

  it("both sides exist and the HTTP side holds the app", () => {
    const files = Object.keys(SOURCES).map(sourceFileName);
    expect(files.some((f) => HTTP_SIDE.test(f))).toBe(true);
    expect(files).toContain("src/http/app.ts");
    expect(files).toContain("src/background/scheduled.ts");
  });

  it("catches a crossing in each direction in a fixture", () => {
    const fixtures = {
      "../src/background/things/thing-consumer.ts":
        'import type { Context } from "hono";\nimport { createApp } from "../../http/app.ts";\nimport { things } from "../../things/things.ts";\n',
      "../src/http/routes/things/things.ts":
        'import { THING } from "../../../background/things/thing-consumer.ts";\nimport { shape } from "../../../things/things.ts";\n',
    };
    expect(backgroundModulesImportingHttp(fixtures).findings).toHaveLength(2);
    expect(routeModulesImportingBackground(fixtures).findings).toHaveLength(1);
  });
});
