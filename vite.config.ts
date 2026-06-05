import { defineConfig } from "vite-plus";

export default defineConfig({
  // Formatter (Oxfmt), made explicit so a beta-tool default change can't silently reflow our code or prose.
  // printWidth and proseWrap already match Oxfmt's defaults (100 and "preserve"); endOfLine pins LF to match .gitattributes and .editorconfig.
  // Prose is never hand-wrapped (proseWrap: "preserve"); code wraps at printWidth. See conventions/code-style.md and documentation-style.md.
  fmt: {
    printWidth: 100,
    proseWrap: "preserve",
    endOfLine: "lf",
  },
  // typeCheck makes `vp check` run tsgolint TS type-checks (not just fmt+lint); a real `.ts` type error now fails the gate.
  // tsgolint does not parse `.svelte`, so the full gate (`pnpm check`) also runs svelte-check. See conventions/typescript.md.
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
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
      // NOTE: the worker's build/dev tasks (which must depend on @magna-carta/web#build because the worker serves apps/web/build) are added here when apps/worker is created in a later task (worker E3).
    },
  },
});
