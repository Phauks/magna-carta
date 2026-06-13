import { defineConfig } from "vite-plus";

export default defineConfig({
  // Formatter (Oxfmt), made explicit so a beta-tool default change can't silently reflow our code or prose.
  // printWidth and proseWrap already match Oxfmt's defaults (100 and "preserve"); endOfLine pins LF to match .gitattributes and .editorconfig.
  // Prose is never hand-wrapped (proseWrap: "preserve"); code wraps at printWidth. See conventions/code-style.md and documentation-style.md.
  fmt: {
    printWidth: 100,
    proseWrap: "preserve",
    endOfLine: "lf",
    // Generated artifacts whose exact bytes are fixed by their generator and re-derived/diff-gated by
    // CI (code-as-contract): the OpenAPI snapshot (apps/worker/scripts/emit-openapi.mts) and the Hey
    // API client (packages/api-client/openapi-ts.config.mjs). Never hand-edit them, and never let the
    // formatter reflow them out from under the generate/diff contract.
    ignorePatterns: ["apps/worker/openapi/openapi.json", "packages/api-client/src/**"],
  },
  // typeCheck makes `vp check` run tsgolint TS type-checks (not just fmt+lint); a real `.ts` type error now fails the gate.
  // tsgolint does not parse `.svelte`, so the full gate (`pnpm check`) also runs svelte-check. See conventions/typescript.md.
  lint: {
    // The Hey API generated client is not our code to style-lint; exclude it from the lint rules (its
    // tsc type-check still runs, so the "generated client compiles" gate holds, and the compile-check
    // test exercises the public surface). The OpenAPI snapshot is data, not linted source.
    ignorePatterns: ["packages/api-client/src/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // Per-package test projects. apps/worker runs its tests inside Miniflare via @cloudflare/vitest-pool-workers, which only activates when its own config (apps/worker/vitest.config.ts) is loaded, so it is registered as a Vitest project here; otherwise root `vp test` would run the worker test under the default pool and `cloudflare:test` would not resolve.
  test: {
    projects: ["apps/worker/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
  // vp reads test/lint/format defaults from here; run.tasks declares the monorepo graph.
  // Task keys are plain task names with a `command`; the `package#task` form is only valid inside `dependsOn` (see viteplus.dev/config/run).
  run: {
    tasks: {
      // Build the whole app in dependency order: the SPA first, then (later) the worker that serves apps/web/build.
      // Named `build-all` (not `build`) so it does not collide with the root package.json `build` script.
      // The command builds every app package (filter excludes the root, which has no buildable entry); `dependsOn` uses the cross-package `package#task` notation to force apps/web's build first.
      "build-all": {
        command: 'vp run --filter "./apps/*" build',
        dependsOn: ["@magna-carta/web#build"],
      },
      // The worker serves apps/web/build, so its build and dev both depend on the SPA build (cross-package package#task notation).
      // Named worker-build / worker-dev (not build / dev) so they do not collide with the root package.json build / dev scripts.
      "worker-build": {
        command: 'vp run --filter "@magna-carta/worker" build',
        dependsOn: ["@magna-carta/web#build"],
      },
      "worker-dev": {
        command: 'vp run --filter "@magna-carta/worker" dev',
        dependsOn: ["@magna-carta/web#build"],
      },
    },
  },
});
