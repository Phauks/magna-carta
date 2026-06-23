import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
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

// Stub for the magna-carta-scan service binding in tests — no real scan worker runs under the
// local pool, so the service binding must resolve to something or workerd refuses to boot.
// Returning the no-engine ScanResult matches what production returns before the engine is wired,
// so scan-path code exercised in tests sees an honest unscanned verdict rather than a fake clean.
const SCAN_SERVICE_STUB_SCRIPT = `
export default {
  fetch() {
    return new Response(
      JSON.stringify({ verdict: "unscanned", reason: "no-engine", engineVersion: null }),
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
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      miniflare: {
        workers: [
          {
            name: "magna-carta-scan",
            modules: true,
            script: SCAN_SERVICE_STUB_SCRIPT,
          },
        ],
      },
    }),
  ],
});
