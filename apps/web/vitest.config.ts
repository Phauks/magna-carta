import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Plain node pool for the web app's data-module tests (registry fitness checks) — no browser,
// no SvelteKit plugin (this config never runs a dev/build, so the cwd guard dance in
// vite.config.ts does not apply here). root is pinned to this package so the repo-root
// `vp test` resolves this project's tests from here.
//
// The base Svelte compiler plugin (not SvelteKit's) is still needed: data modules like
// tool-presentation.ts import Lucide icon components, and @lucide/svelte's icon subpaths
// (icons/*) re-export a raw .svelte source file rather than compiled JS. Without a transform for
// ".svelte", Vite's default SSR externalization hands that import straight to Node, which throws
// ERR_UNKNOWN_FILE_EXTENSION.
export default defineConfig({
  plugins: [svelte()],
  // The build identity vite.config.ts bakes in. A component test that reaches the failure screen
  // reaches build-identity.ts through the trace block, and an undefined global there throws before
  // the first assertion; fixed values keep a trace assertable rather than dependent on the checkout.
  define: {
    __MC_BUILD_COMMIT__: JSON.stringify("test"),
    __MC_BUILD_COMMIT_TIME__: JSON.stringify(null),
    __MC_BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
    __MC_SOURCE_REPOSITORY__: JSON.stringify("https://github.com/example/magna-carta"),
  },
  // `$lib` is SvelteKit's alias, and SvelteKit's plugin is deliberately absent here (see above), so
  // nothing resolves it: any module under test that imports `$lib/...` fails to load with
  // ERR_MODULE_NOT_FOUND. Thirty-six modules in src/lib use the alias, and the suite only noticed
  // when one test finally reached one of them. Declaring it here keeps this config independent of
  // SvelteKit while matching what `.svelte-kit/tsconfig.json` maps for the type-checker.
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      // A component that reads SvelteKit's page state has nothing to read without the plugin, and a
      // `.svelte` importer fails at import analysis before a `vi.mock` can answer for it. The stub
      // is a plain object a test sets the address on (test/stubs/app-state.ts).
      "$app/state": fileURLToPath(new URL("./test/stubs/app-state.ts", import.meta.url)),
      // Its twin, for the same reason: a component that navigates imports `$app/navigation`, and a
      // test cannot mock what Vite cannot resolve. The stub records where a component went
      // (test/stubs/app-navigation.ts) and goes nowhere itself.
      "$app/navigation": fileURLToPath(new URL("./test/stubs/app-navigation.ts", import.meta.url)),
    },
    // A test that mounts a component (opted into happy-dom per file) needs Svelte's CLIENT build:
    // under the default node conditions `svelte` resolves to its server entry, where `mount` is
    // "not available on the server". The data-module tests are indifferent to the condition — an
    // icon component compiles the same either way — so it is set once here rather than per file.
    conditions: ["browser"],
  },
  test: {
    name: "web",
    root: import.meta.dirname,
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      // bits-ui for the same reason: a component test that mounts a design-system part reaches its
      // raw .svelte sources (portal.svelte first), and Node cannot load those unpreprocessed. Its
      // two Svelte helpers ride along because an externalized helper loads Node's own `svelte`
      // while the inlined code uses Vite's, and two copies fail as "setContext(...) can only be
      // used during component initialisation" — a misleading name for a duplicated module. A
      // path pattern rather than three names: a module specifier naming bits-ui outside the design
      // system is what the bits-ui boundary gate forbids, and this is a test-loader setting, not an
      // import. @tanstack/svelte-query is the same case: its root entry re-exports
      // HydrationBoundary.svelte, so any page that imports the query client reaches raw Svelte
      // source; Vitest 5 externalizes it like any other package unless it is named here.
      deps: {
        inline: [
          "@lucide/svelte",
          "@tanstack/svelte-query",
          /[\\/]node_modules[\\/](?:bits-ui|runed|svelte-toolbelt)[\\/]/,
        ],
      },
    },
  },
});
