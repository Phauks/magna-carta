// @repo-wide-fitness — walks every package's source from the repository root looking for a second
// model port, so the diff that opens one is by definition not a diff in this package.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// There is ONE model port and there will not be a second.
//
// The confidentiality guarantees the platform makes about model traffic are not policy statements —
// they are four literal fields on one object in one function in packages/inference/src/gateway.ts.
// Their strength comes entirely from there being exactly one place they are set. A second port would
// be a second place, and the failure mode is silent: nothing breaks when caching is left on, the
// answers just start coming from a cache whose key carries no firm dimension.
//
// The scan lives in this package rather than beside the worker's other suites for one practical
// reason: the worker's suites run inside the Workers pool and cannot read the repository's files.
// This package runs in the node pool, so it can.

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const workerSource = join(repositoryRoot, "apps", "api-worker", "src");
const packagesDirectory = join(repositoryRoot, "packages");

// The composition roots: the modules that exist precisely to hand the authenticated binding to the
// inference package's own factory, and to do nothing else with it. Naming them here is what turns
// every other reference into a violation rather than a judgement call.
const COMPOSITION_ROOTS = new Set(
  [
    ["inference", "call-site.ts"],
    ["background", "inference", "inference-consumer.ts"],
    ["magnus", "inference-port-binding.ts"],
  ].map((segments) => join(workerSource, ...segments)),
);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "pkg" || name === ".tsbuild") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function safeTsFiles(dir: string): string[] {
  try {
    return tsFiles(dir);
  } catch {
    return [];
  }
}

describe("no second model port (fitness)", () => {
  it("actually inspects the worker source", () => {
    expect(safeTsFiles(workerSource).length).toBeGreaterThan(50);
  });

  it("no worker module outside the composition roots names the binding or a gateway options object", () => {
    // Matched at a TOKEN boundary rather than as a bare substring. `env.AI` is the Workers AI
    // binding, and a bare `includes` also matched every longer binding name that merely starts with
    // it — `env.AI_SEARCH_NAMESPACES`, which is a different binding to a different product and
    // reaches no model of ours. Firing on that is a false positive, and a false positive on a scan
    // this load-bearing is worse than it looks: the reflex it invites is to widen the exemption list,
    // which is what would let a real second model port through.
    const forbidden = [/\benv\.AI\b/, /\bAiBinding\b/, /\bGatewayOptions\b/, /\bgatewayOptions\(/];
    for (const file of safeTsFiles(workerSource)) {
      if (COMPOSITION_ROOTS.has(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${file.replaceAll("\\", "/")} names "${pattern.source}"`).toBe(
          false,
        );
      }
    }
  });

  it("no package outside the inference package constructs a gateway options object", () => {
    for (const packageName of readdirSync(packagesDirectory)) {
      if (packageName === "inference") continue;
      for (const file of safeTsFiles(join(packagesDirectory, packageName, "src"))) {
        const text = readFileSync(file, "utf8");
        for (const needle of ["gatewayOptions(", "env.AI"]) {
          expect(text.includes(needle), `${file.replaceAll("\\", "/")} names "${needle}"`).toBe(
            false,
          );
        }
      }
    }
  });

  it("the assistant's worker modules never name a model, a provider, or a gateway", () => {
    const magnusModules = safeTsFiles(join(workerSource, "magnus"));
    expect(magnusModules.length).toBeGreaterThan(3);
    for (const file of magnusModules) {
      if (COMPOSITION_ROOTS.has(file)) continue;
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const needle of ["anthropic/", "openai", "env.ai", "gatewayoptions"]) {
        expect(text.includes(needle), `${file.replaceAll("\\", "/")} names "${needle}"`).toBe(
          false,
        );
      }
    }
  });
});

describe("seeding the permissions turns nothing on (fitness)", () => {
  it("the baseline grants the two keys and seeds neither consent gate", () => {
    const migration = readFileSync(
      join(
        repositoryRoot,
        "packages",
        "database",
        "drizzle",
        "per-firm",
        "20260908T000000_baseline.sql",
      ),
      "utf8",
    );
    expect(migration.includes("'magnus:converse'")).toBe(true);
    expect(migration.includes("'magnus:readAllConversations'")).toBe(true);
    // NO SETTING ROW TURNS MAGNUS ON. This asked whether the lineage seeded any setting at all,
    // which was a fair proxy while the migration was its own file and seeded nothing; the collapsed
    // baseline carries every seed the lineage ever wrote, so the proxy now answers about unrelated
    // catalogs. The invariant is the same and is asserted directly: a firm arrives with the two
    // permissions and a closed feature, so neither gate may be seeded at any value.
    for (const gate of ["magnus.enabled", "magnus.consent"]) {
      expect(migration.includes(`'${gate}'`), gate).toBe(false);
    }
  });

  it("the committed deploy configuration does not set the adapter switch", () => {
    const wrangler = readFileSync(
      join(repositoryRoot, "apps", "api-worker", "wrangler.jsonc"),
      "utf8",
    );
    expect(wrangler.includes("MAGNUS_INFERENCE_ADAPTER")).toBe(false);
  });
});
