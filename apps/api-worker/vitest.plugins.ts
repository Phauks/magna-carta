// The Vite plugins every api-worker test project shares: the `.sql`-as-text transform and the virtual
// modules that inline fixtures and package sources living outside this package's Vite root. Held apart
// from the project configs so the Workers-runtime project (vitest.config.ts) and the plain-Node project
// (vitest.node.config.ts) build test modules the same way.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin } from "vite-plus";

// The Vite-side half of the dual `.sql`-as-text bundling contract — full story in
// src/sql-modules.d.ts (the wrangler-side half is the Text module rule in wrangler.jsonc).
export function sqlAsText(): Plugin {
  return {
    name: "magna-carta:sql-as-text",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".sql")) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

// The composite text-extraction tests need real PDFs — a born-digital one, a scan, and one of each —
// and workerd has no filesystem to read them from. The fixtures live with the engine that reads them
// (crates/pdf-core/tests/fixtures), which is outside the Vite root, so this plugin inlines them as
// base64 at build time. One copy of each fixture, asserted on by both the Rust tests and these: a
// second committed copy under apps/api-worker could drift from the bytes the engine is tested against, and
// nothing would notice.
export function pdfCoreFixtures(): Plugin {
  const virtualModuleId = "virtual:pdf-core-fixtures";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const fixtureDir = path.resolve(import.meta.dirname, "../../crates/pdf-core/tests/fixtures");

  return {
    name: "magna-carta:pdf-core-fixtures",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      const fixtures: Record<string, string> = {};
      for (const entry of fs.readdirSync(fixtureDir)) {
        if (!entry.endsWith(".pdf")) continue;
        fixtures[entry] = fs.readFileSync(path.join(fixtureDir, entry)).toString("base64");
      }
      return `export default ${JSON.stringify(fixtures)};`;
    },
  };
}

// The form-template tests need the committed fillable-PDF fixture, and workerd has no filesystem to
// read it from. The fixture lives with the package whose registration and fill logic it exercises
// (packages/document-assembly/test/fixtures), which is outside the Vite root, so this plugin inlines it
// as base64 at build time — one copy of the fixture, asserted on by both suites, on exactly the terms
// pdfCoreFixtures() is on.
export function documentAssemblyFormFixtures(): Plugin {
  const virtualModuleId = "virtual:document-assembly-form-fixtures";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const fixtureDir = path.resolve(
    import.meta.dirname,
    "../../packages/document-assembly/test/fixtures",
  );

  return {
    name: "magna-carta:document-assembly-form-fixtures",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      const fixtures: Record<string, string> = {};
      for (const entry of fs.readdirSync(fixtureDir)) {
        if (!entry.endsWith(".pdf")) continue;
        fixtures[entry] = fs.readFileSync(path.join(fixtureDir, entry)).toString("base64");
      }
      return `export default ${JSON.stringify(fixtures)};`;
    },
  };
}

// The fitness scan tests (billing-wip-ledger-fitness, billing-freeze-fitness) need to scan the
// package sources where the SQL statement strings actually live — packages/timekeeping/src,
// packages/costs/src, and packages/billing-core/src — but import.meta.glob cannot resolve outside
// the Vite root (apps/api-worker). This plugin provides a virtual module that inlines those sources at
// build time, each file keyed under its own package prefix, so the scans cover all three packages
// and each can be floored for non-vacuity independently.
export function billingPackageSources(): Plugin {
  const virtualModuleId = "virtual:billing-package-sources";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const timekeepingSrcDir = path.resolve(import.meta.dirname, "../../packages/timekeeping/src");
  const costsSrcDir = path.resolve(import.meta.dirname, "../../packages/costs/src");
  const billingCoreSrcDir = path.resolve(import.meta.dirname, "../../packages/billing-core/src");

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
    name: "magna-carta:billing-package-sources",
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      const sources: Record<string, string> = {};
      Object.assign(sources, collectSources(timekeepingSrcDir, "packages/timekeeping/src"));
      Object.assign(sources, collectSources(costsSrcDir, "packages/costs/src"));
      Object.assign(sources, collectSources(billingCoreSrcDir, "packages/billing-core/src"));
      return `export default ${JSON.stringify(sources)};`;
    },
  };
}
