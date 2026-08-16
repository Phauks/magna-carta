// @repo-wide-fitness — scans every app's and package's source for counter call sites, so the diff
// that adds an undeclared metric is almost never a diff in this package.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { defineMetric, METRIC_NAMES, metricDefinition } from "../src/metrics.ts";

// The counter side of the one-logging-path rule (docs/conventions/error-logging.md), made
// structural. The Workers logger DROPS a point whose metric is not in the catalog — the fail-closed
// choice, because an undeclared metric has no column contract and no allowlist for its dimensions.
// Dropping silently would be its own defect, so this scan is the safety net: every count() call site
// in the repo must name a metric the catalog declares, and no call site may build the name by
// interpolation (an interpolated name cannot be declared, so it could only ever be dropped).
//
// It lives beside the console-ban scan for the same reasons: the telemetry package owns the logging
// path, and this suite runs in the node pool where the filesystem is available.

// packages/telemetry/test -> repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

// A `.count(` call whose first argument is a quoted string, capturing the literal. Template literals
// are matched too (the backtick alternative) precisely so an interpolated name can be rejected
// rather than quietly missed by a scan that only looked for quotes.
const COUNT_CALL = /\.count\(\s*(["'`])((?:[^\\]|\\.)*?)\1/g;

// Metric names in browser code are not this pipeline's — the web app logs through the in-app
// developer console, exactly as the console ban has it.
const UNSCANNED_APPS = new Set(["web"]);

async function sourceRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const entry of await readdir(join(REPO_ROOT, "apps"), { withFileTypes: true })) {
    if (entry.isDirectory() && !UNSCANNED_APPS.has(entry.name)) {
      roots.push(join(REPO_ROOT, "apps", entry.name, "src"));
    }
  }
  for (const entry of await readdir(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(join(REPO_ROOT, "packages", entry.name, "src"));
  }
  return roots;
}

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return; // a package without a src/ dir
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", "test"].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }
  }
  for (const root of await sourceRoots()) await walk(root);
  return files;
}

interface CallSite {
  readonly file: string;
  readonly metric: string;
}

async function countCallSites(): Promise<CallSite[]> {
  const sites: CallSite[] = [];
  for (const file of await sourceFiles()) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(COUNT_CALL)) {
      sites.push({
        file: relative(REPO_ROOT, file).split(sep).join("/"),
        metric: match[2] ?? "",
      });
    }
  }
  return sites;
}

describe("metric catalog (the counter-side allowlist, made structural)", () => {
  it("every count() call site in the repo names a DECLARED metric", async () => {
    const sites = await countCallSites();
    const undeclared = sites
      .filter((site) => metricDefinition(site.metric) === undefined)
      .map((site) => `${site.file}: ${site.metric}`);
    expect(undeclared).toEqual([]);
    // Vacuity guard: the scan found real call sites, not zero.
    expect(sites.length).toBeGreaterThan(5);
  });

  it("no call site builds a metric name by interpolation (such a name can never be declared)", async () => {
    const interpolated = (await countCallSites())
      .filter((site) => site.metric.includes("${"))
      .map((site) => `${site.file}: ${site.metric}`);
    expect(interpolated).toEqual([]);
  });

  it("the detector reads content, catching both quote styles and an interpolated name", () => {
    const sample = [
      'logger.count("usage", { feature });',
      "logger.count('costs.recovery.rejected', { code });",
      "logger.count(`backfill.${name}`, {}, affected);",
    ].join("\n");
    const found = [...sample.matchAll(COUNT_CALL)].map((match) => match[2]);
    expect(found).toEqual(["usage", "costs.recovery.rejected", "backfill.${name}"]);
  });
});

describe("metric declarations", () => {
  it("declares each metric name exactly once", () => {
    expect(new Set(METRIC_NAMES).size).toBe(METRIC_NAMES.length);
  });

  it("gives every declared metric a duplicate-free ordered dimension tuple", () => {
    for (const name of METRIC_NAMES) {
      const keys = metricDefinition(name)?.dimensionKeys ?? [];
      expect(new Set(keys).size, name).toBe(keys.length);
    }
  });

  it("keeps the usage blob layout the canonical queries read", () => {
    // docs/analytics/usage-queries.md reads blob1 as the metric name, then feature, phase, surface.
    expect(metricDefinition("usage")?.dimensionKeys).toEqual(["feature", "phase", "surface"]);
  });

  it("defineMetric carries the name and the declared order verbatim", () => {
    const definition = defineMetric("test.metric", ["second", "first"] as const);
    expect(definition.metricName).toBe("test.metric");
    expect(definition.dimensionKeys).toEqual(["second", "first"]);
    // A metric declared locally is NOT in the catalog — only the declarations in metrics.ts are.
    expect(metricDefinition("test.metric")).toBeUndefined();
  });
});
