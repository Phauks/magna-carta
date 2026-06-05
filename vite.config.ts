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
  // vp reads test/lint/format defaults from here; run.tasks declares the monorepo graph.
  // @ts-expect-error vp augments the Vite config with `run`; type may not be published yet
  run: {
    tasks: {
      // apps/worker build/dev/deploy depend on the SPA being built first
      "apps/worker#build": { dependsOn: ["apps/web#build"] },
      "apps/worker#dev": { dependsOn: ["apps/web#build"] },
    },
  },
});
