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

// Run Vitest inside Miniflare so the integration test gets real Worker bindings (D1/R2/Queues/ASSETS) loaded from wrangler.jsonc.
// @cloudflare/vitest-pool-workers 0.16.x exposes the harness as the cloudflareTest() Vite plugin (the older defineWorkersConfig/poolOptions shape was removed); configPath points it at our Wrangler config so the same bindings back the test as back `wrangler dev`.
// root is pinned to this package so the pool resolves `vitest/worker` (and the wrangler config) from apps/worker even when this config is loaded as a Vitest project from the repo-root `vp test`; without it the workerd VM reports `No such module "vitest/worker"`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    cloudflareTest({
      wrangler: { configPath: `${import.meta.dirname}/wrangler.jsonc` },
      remoteBindings: false,
      // The CONVERT service binding in wrangler.jsonc references the dedicated conversion worker
      // (magna-carta-convert). Miniflare requires that worker to exist in the local test environment,
      // so we register a minimal stub here. Conversion-engine tests inject fake CONVERT fetchers
      // directly; this stub only satisfies Miniflare's startup validation — it is never called.
      miniflare: {
        workers: [
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
