import { defineConfig } from "vite-plus";
import { nodeRuntimeTestFiles } from "./vitest.node-runtime.ts";
import {
  billingPackageSources,
  documentAssemblyFormFixtures,
  pdfCoreFixtures,
  sqlAsText,
} from "./vitest.plugins.ts";

// The api-worker test files that declare `@node-runtime`, run in the default Node pool with no
// workerd VM and no app preload. The Workers project (vitest.config.ts) excludes exactly these files,
// so every file runs in one project or the other. The rule for opting in and the measured reason
// it pays live in vitest.node-runtime.ts.
//
// root is pinned to this package for the same reason as the Workers project: the project is loaded
// from the repo-root `vp test`, and include paths are relative to it.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    sqlAsText(),
    billingPackageSources(),
    pdfCoreFixtures(),
    documentAssemblyFormFixtures(),
  ],
  test: {
    name: "@magna-carta/api-worker (node)",
    include: nodeRuntimeTestFiles(),
    passWithNoTests: true,
  },
});
