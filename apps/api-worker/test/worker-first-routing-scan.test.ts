import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import wranglerConfigText from "../wrangler.jsonc?raw";

// Fitness function (the twin of r2-object-dimension-scan.ts, one instrument up): every path family
// this Worker actually serves is named in `assets.run_worker_first`, so the request reaches the Hono
// app instead of the static-asset server.
//
// WHY THIS CANNOT BE LEFT TO REVIEW. The SPA is bound as Workers Static Assets with
// `not_found_handling: "single-page-application"`. Cloudflare tries the asset server FIRST for every
// path `run_worker_first` does not name; when no asset matches, the single-page-application handling
// answers `/index.html` with a 200. So a route the Worker registers under an unnamed prefix does not
// 404 and does not error — it answers with the app shell, with a success status, and the handler is
// never entered. Nothing about that failure looks like a failure: the caller (an editor container, a
// search engine, a browser) receives HTML where it expected a document, a byte range, or a page.
//
// The rule the config states and this test enforces: EVERY top-level path family registered on the
// Hono app is worker-first. Only two paths are not — the global middleware wildcard and the
// asset fallthrough at the end of src/http/app.ts, which IS the asset server's own door. The arrangement
// deliberately keeps the array explicit rather than inverting to worker-first-everything: the SPA's
// own files (scripts, styles, fonts, the shell) stay on the asset server, off the Worker's CPU and
// off its invocation count, which is the whole reason the assets are bound this way.
//
// The instrument is the app's LIVE DISPATCH TABLE, not a source scan: `app.routes` is what Hono will
// actually route on, so a family added by any registration path — a route module, a plugin in the
// registry, a bare `app.get` — is seen here the moment it exists. A source scan would have to
// recognize every spelling of a registration to stay honest, and would miss the plugins entirely.

// The wrangler configuration is JSONC (comments, trailing commas), and the Worker test pool has no
// filesystem, so the file arrives as build-time text and is parsed here. String state is tracked
// while stripping so a `//` inside a value is never mistaken for a comment.
function parseJsonWithComments(text: string): unknown {
  let stripped = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
        stripped += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (inString) {
      stripped += character;
      if (character === "\\") {
        stripped += next ?? "";
        index++;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      stripped += character;
      continue;
    }
    if (character === "/" && next === "/") {
      inLineComment = true;
      index++;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index++;
      continue;
    }
    stripped += character;
  }
  return JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1"));
}

interface AssetsConfiguration {
  readonly run_worker_first?: boolean | readonly string[];
  readonly not_found_handling?: string;
}

const wranglerConfiguration = parseJsonWithComments(wranglerConfigText) as {
  readonly assets?: AssetsConfiguration;
};
const assets = wranglerConfiguration.assets;
const runWorkerFirst = assets?.run_worker_first;

// A route pattern as Cloudflare reads it: it begins with `/` or `!/`, and `*` is a wildcard that
// spans any characters, path separators included. A `!` pattern excludes what it matches from
// worker-first handling, so a family is only covered when some pattern matches it and no exception
// pattern takes it back.
function patternMatches(pattern: string, pathname: string): boolean {
  const body = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

function isCovered(pathname: string, patterns: readonly string[]): boolean {
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excluded = patterns.filter((pattern) => pattern.startsWith("!"));
  if (!included.some((pattern) => patternMatches(pattern, pathname))) return false;
  return !excluded.some((pattern) => patternMatches(pattern, pathname));
}

// A registered Hono path turned into a concrete pathname a request could carry: parameters and
// wildcards become an ordinary segment, because what is being asked is whether the FAMILY reaches the
// Worker, not whether one identifier does.
function probePathnameFor(honoPath: string): string {
  return honoPath
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "probe";
      if (segment.includes("*")) return "probe";
      return segment;
    })
    .join("/");
}

// The wildcard entries are the two things in the table that are NOT a surface of their own: the
// app-wide middleware (telemetry, usage, the noindex header) and the asset fallthrough that ends
// src/http/app.ts. Everything else is a path this Worker answers on and therefore has to reach it.
function isGlobalWildcard(honoPath: string): boolean {
  return honoPath === "*" || honoPath === "/*" || honoPath === "/";
}

function topLevelPrefixOf(honoPath: string): string {
  return `/${honoPath.split("/").find((segment) => segment.length > 0) ?? ""}`;
}

function uncoveredPaths(
  app: ReturnType<typeof createApp>,
  patterns: readonly string[],
): { readonly prefixes: string[]; readonly examples: string[] } {
  const prefixes = new Set<string>();
  const examples: string[] = [];
  for (const { path } of app.routes) {
    if (isGlobalWildcard(path)) continue;
    if (isCovered(probePathnameFor(path), patterns)) continue;
    const prefix = topLevelPrefixOf(path);
    if (prefixes.has(prefix)) continue;
    prefixes.add(prefix);
    examples.push(
      `${prefix}: ${path} is registered on the Hono app but no run_worker_first pattern names it — ` +
        `the asset server answers it with the SPA shell and the handler never runs`,
    );
  }
  return { prefixes: [...prefixes], examples };
}

describe("every path family the Worker serves is worker-first in the assets configuration", () => {
  const app = createApp();
  const patterns = Array.isArray(runWorkerFirst) ? runWorkerFirst : [];

  it("the assets binding still routes by an explicit pattern list", () => {
    // `true` would make every request worker-first, which covers the families this test is about but
    // pays for the SPA's own files in Worker invocations; `false` or an absent key would strand every
    // API call behind the asset server. Either is a decision, not a slip, so it fails here and is
    // answered rather than discovered in production.
    expect(
      Array.isArray(runWorkerFirst),
      `run_worker_first is ${JSON.stringify(runWorkerFirst)}`,
    ).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("is not vacuous — it sees the real dispatch table and the real configuration", () => {
    const registered = new Set(app.routes.map((route) => route.path));
    expect(registered.has("/wopi/files/:fileId")).toBe(true);
    expect(registered.has("/search-objects/*")).toBe(true);
    expect(registered.has("/api/openapi.json")).toBe(true);
    expect(app.routes.length).toBeGreaterThan(50);
    expect(assets?.not_found_handling).toBe("single-page-application");
  });

  it("no registered path family falls through to the static-asset server", () => {
    const { examples } = uncoveredPaths(app, patterns);
    expect(examples, examples.join("\n")).toEqual([]);
  });

  it("flags a new top-level family that the configuration does not name", () => {
    // The negative control: the class of bug this exists to stop is a surface added outside /api and
    // never added to the list. A throwaway app carrying exactly that mistake must be reported.
    const withNewFamily = createApp();
    withNewFamily.get("/probe-surface/:objectId", (c) => c.json({ ok: true }));
    const { prefixes } = uncoveredPaths(withNewFamily, patterns);
    expect(prefixes).toContain("/probe-surface");
  });

  it("names no pattern that matches nothing the Worker registers", () => {
    // The other direction, and it is hygiene rather than safety: a pattern left behind after its
    // surface was deleted sends live traffic to the Worker to be answered by the asset fallthrough,
    // paying for an invocation to serve a file the asset server would have served for nothing.
    const stale = patterns
      .filter((pattern) => !pattern.startsWith("!"))
      .filter(
        (pattern) =>
          !app.routes.some(
            (route) =>
              !isGlobalWildcard(route.path) &&
              patternMatches(pattern, probePathnameFor(route.path)),
          ),
      );
    expect(stale, `run_worker_first names a pattern no route uses: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
