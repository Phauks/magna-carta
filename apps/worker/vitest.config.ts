import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite-plus";

// The Vite-side half of the dual `.sql`-as-text bundling contract — full story in
// src/sql-modules.d.ts (the wrangler-side half is the Text module rule in wrangler.jsonc).
function sqlAsText(): Plugin {
  return {
    name: "magna-carta:sql-as-text",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".sql")) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

// The fitness scan tests (timekeeping-wip-ledger-fitness, timekeeping-freeze-fitness) need to scan
// packages/timekeeping/src/**/*.ts, but import.meta.glob cannot resolve outside the Vite root
// (apps/worker). This plugin provides a virtual module that inlines those sources at build time so
// the scans cover the package where the SQL statement strings actually live.
function timekeepingPackageSources(): Plugin {
  const virtualModuleId = "virtual:timekeeping-package-sources";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const packageSrcDir = path.resolve(import.meta.dirname, "../../packages/timekeeping/src");

  function collectSources(dir: string, prefix: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        Object.assign(result, collectSources(fullPath, key));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        result[key] = fs.readFileSync(fullPath, "utf8");
      }
    }
    return result;
  }

  return {
    name: "magna-carta:timekeeping-package-sources",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      const sources = collectSources(packageSrcDir, "packages/timekeeping/src");
      return `export default ${JSON.stringify(sources)};`;
    },
  };
}

// Stub for the magna-carta-scan service binding in tests — no real scan worker runs under the
// local pool, so the service binding must resolve to something or workerd refuses to boot.
// Returning the no-engine RawScanResult matches what production returns before the engine is wired,
// so scan-path code exercised in tests sees an honest unscanned verdict rather than a fake clean.
const SCAN_SERVICE_STUB_SCRIPT = `
export default {
  fetch() {
    return new Response(
      JSON.stringify({
        engineVersion: null,
        clam: { state: "unavailable" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 0, yaraMs: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;

// Run Vitest inside Miniflare so the integration test gets real Worker bindings (D1/R2/Queues/ASSETS) loaded from wrangler.jsonc.
// @cloudflare/vitest-pool-workers 0.16.x exposes the harness as the cloudflareTest() Vite plugin (the older defineWorkersConfig/poolOptions shape was removed); configPath points it at our Wrangler config so the same bindings back the test as back `wrangler dev`.
// root is pinned to this package so the pool resolves `vitest/worker` (and the wrangler config) from apps/worker even when this config is loaded as a Vitest project from the repo-root `vp test`; without it the workerd VM reports `No such module "vitest/worker"`.
// miniflare.workers registers an auxiliary stub worker named "magna-carta-scan" so the SCAN_SERVICE
// service binding declared in wrangler.jsonc resolves without a real scan worker running in the pool.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    timekeepingPackageSources(),
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      // Two service bindings in wrangler.jsonc reference dedicated workers that do not run under the
      // local pool — magna-carta-scan (SCAN_SERVICE) and magna-carta-convert (CONVERT). Miniflare
      // requires both to exist, so register minimal stubs. The scan stub returns the no-engine
      // RawScanResult (an honest unscanned, never a fake clean); the convert stub only satisfies startup
      // validation (conversion-engine tests inject fake CONVERT fetchers directly, never call it).
      miniflare: {
        workers: [
          {
            name: "magna-carta-scan",
            modules: true,
            script: SCAN_SERVICE_STUB_SCRIPT,
          },
          {
            name: "magna-carta-convert",
            modules: true,
            script: `export default { fetch() { return new Response("stub", { status: 501 }); } };`,
          },
        ],
      },
    }),
  ],
});
