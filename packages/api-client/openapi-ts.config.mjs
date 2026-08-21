// Hey API client generation: the typed client + TanStack Svelte Query factories are
// generated from the committed OpenAPI snapshot, never from Hono's `hc` RPC inference (whole-app type
// inference degrades tsc as routes grow). The .gen.ts output is committed; CI regenerates and
// diff-fails on drift. apps/web-worker imports @magna-carta/api-client without a local generation step.
//
// Plain-object config, not defineConfig(): importing defineConfig from @hey-api/openapi-ts fails under
// its jiti config loader (ERR_PACKAGE_PATH_NOT_EXPORTED — docs/conventions/api.md).

/** @type {import('@hey-api/openapi-ts').UserConfig} */
export default {
  input: "../../apps/api-worker/openapi/openapi.json",
  output: "./src",
  plugins: [
    "@hey-api/client-fetch",
    // exportFromIndex re-exports the Svelte Query factories (…Options/…Mutation) through the package's
    // single "." export; without it the plugin emits them outside the index barrel.
    { name: "@tanstack/svelte-query", exportFromIndex: true },
  ],
};
