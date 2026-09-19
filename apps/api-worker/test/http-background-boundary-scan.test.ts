// @repo-wide-fitness — scans every consumer, sweep and route module in the Worker for an import
// across the HTTP-versus-background seam; the crossing import lands in whichever file is edited.
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern): the Worker has two sides and one seam.
// The HTTP side is the Hono app, the chokepoint and the route modules; the background side is the
// queue consumers and the Cron sweeps. They share the bindings, the Durable Objects and the domain
// packages, and nothing else — and the seam is held here rather than trusted, because the one time
// it was trusted, 88 background files imported the env type from the composition root and every
// consumer depended on every route.
//
// TWO DIRECTIONS, TWO RULES.
// - A background module imports neither Hono nor the app module. A consumer that needs a problem
//   document, a session accessor or the router has picked up an HTTP concern; what it actually needs
//   (the env shape, the auth instance, the logger) has a module of its own beside app.ts.
// - A route module imports no consumer or sweep. What a route shares with a consumer — a message
//   type, an action name, a scheduling helper — belongs in a module neither side owns. The crossings
//   that exist today are named in ALLOWED_ROUTE_IMPORTS with the module the shared piece should move
//   to; the list only shrinks.
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

// What makes a module background: its name says it consumes a queue or runs a sweep.
const BACKGROUND_FILE = /(?:^|\/)(?:[a-z0-9-]+-(?:consumer|sweep|keep-alive)|scheduled)\.ts$/;
const ROUTE_FILE = /(?:^|\/)src\/routes\//;
const HTTP_IMPORT = /from\s+"(?:hono(?:\/[^"]*)?|(?:\.\.?\/)+app\.ts)"/g;
const BACKGROUND_IMPORT =
  /from\s+"((?:\.\.?\/)+(?:[a-z0-9/-]+-(?:consumer|sweep|keep-alive)|scheduled)\.ts)"/g;

// Route modules that import a background module today, with where the shared piece should live.
// Keyed `route file -> imported module`. Delete a line when the crossing is gone.
export const ALLOWED_ROUTE_IMPORTS: Readonly<Record<string, string>> = {
  "emails.ts":
    "../emails/capture-consumer.ts — the EmailsCaptureMessage type wants an emails/capture-types.ts",
  "file-scans.ts": "../files/ingest-consumer.ts — FILE_RESCAN_ACTION wants a files/ingest-types.ts",
  "firms.ts":
    "../request-path-sweep.ts — the scheduling helper is a request-path concern; rename it out of the sweep family",
  "invitations.ts": "../request-path-sweep.ts — as firms.ts",
  "members.ts": "../request-path-sweep.ts — as firms.ts",
  "onboarding.ts": "../request-path-sweep.ts — as firms.ts",
  "registrations.ts": "../request-path-sweep.ts — as firms.ts",
};

function sourceFileName(modulePath: string): string {
  return modulePath.replace(/^.*\/src\//, "");
}

export function backgroundModulesImportingHttp(sources: Record<string, string>): {
  readonly findings: string[];
  readonly backgroundModules: number;
} {
  const findings: string[] = [];
  let backgroundModules = 0;
  for (const [modulePath, source] of Object.entries(sources)) {
    const file = sourceFileName(modulePath);
    if (!BACKGROUND_FILE.test(file)) continue;
    backgroundModules += 1;
    HTTP_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HTTP_IMPORT.exec(source)) !== null) {
      findings.push(
        `${file} imports ${match[0].replace(/^from\s+/, "")} — a background module takes the env shape from bindings.ts, the auth instance from auth-instance.ts, the logger from worker-logger.ts, and never Hono or the app`,
      );
    }
  }
  return { findings, backgroundModules };
}

export function routeModulesImportingBackground(
  sources: Record<string, string>,
  allowed: Readonly<Record<string, string>>,
): { readonly findings: string[]; readonly routeModules: number } {
  const findings: string[] = [];
  let routeModules = 0;
  const used = new Set<string>();
  for (const [modulePath, source] of Object.entries(sources)) {
    if (!ROUTE_FILE.test(modulePath)) continue;
    routeModules += 1;
    const file = modulePath.replace(/^.*\/src\/routes\//, "");
    BACKGROUND_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BACKGROUND_IMPORT.exec(source)) !== null) {
      const imported = match[1] ?? "";
      const allowance = allowed[file];
      if (allowance !== undefined && allowance.startsWith(imported)) {
        used.add(file);
        continue;
      }
      findings.push(
        `${file} imports ${imported} — a route shares a type, a constant or a helper with a consumer through a module neither side owns, never by importing the consumer`,
      );
    }
  }
  for (const file of Object.keys(allowed)) {
    if (!used.has(file))
      findings.push(
        `${file} no longer imports a background module — remove its ALLOWED_ROUTE_IMPORTS entry`,
      );
  }
  return { findings, routeModules };
}

describe("the HTTP-versus-background seam (apps/api-worker/src)", () => {
  it("no consumer or sweep imports Hono or the app module", () => {
    const { findings, backgroundModules } = backgroundModulesImportingHttp(SOURCES);
    expect(findings).toEqual([]);
    // Not vacuous: the scan really sees the background side.
    expect(backgroundModules).toBeGreaterThan(20);
  });

  it("no route module imports a consumer or sweep beyond the named crossings", () => {
    const { findings, routeModules } = routeModulesImportingBackground(
      SOURCES,
      ALLOWED_ROUTE_IMPORTS,
    );
    expect(findings).toEqual([]);
    expect(routeModules).toBeGreaterThan(90);
  });

  it("catches a crossing in each direction in a fixture", () => {
    const fixtures = {
      "../src/things/thing-consumer.ts":
        'import type { Context } from "hono";\nimport { createApp } from "../app.ts";\n',
      "../src/routes/things.ts": 'import { THING } from "../things/thing-consumer.ts";\n',
    };
    expect(backgroundModulesImportingHttp(fixtures).findings).toHaveLength(2);
    expect(routeModulesImportingBackground(fixtures, {}).findings).toHaveLength(1);
    expect(
      routeModulesImportingBackground(fixtures, {
        "things.ts": "../things/thing-consumer.ts — fixture",
      }).findings,
    ).toEqual([]);
    expect(
      routeModulesImportingBackground({}, { "gone.ts": "../x-consumer.ts — stale" }).findings,
    ).toHaveLength(1);
  });
});
