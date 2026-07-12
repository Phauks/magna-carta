# Task 1 review package

Range: 85fc36309cf7bd9e3c9a5d32bab373cc2d617639..41985e113c9e8f8a917cbfd35da98863c7ae2f4b

## Commits

41985e1 fix(tools): put file-decryption on the files subject group
646e37f feat(tools): presentation layer for the tools listing

## Diff --stat

apps/web/package.json | 3 +-
apps/web/src/lib/tools/tool-presentation.ts | 140 ++++++++++++++++++++++++++++
apps/web/test/tools-presentation.test.ts | 51 ++++++++++
apps/web/vitest.config.ts | 11 +++
packages/tools/src/catalog.ts | 2 +-
pnpm-lock.yaml | 3 +
6 files changed, 208 insertions(+), 2 deletions(-)

## Full diff (-U10)

```diff
diff --git a/apps/web/package.json b/apps/web/package.json
index d69cff5..bdbecf3 100644
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -6,21 +6,22 @@
   "sideEffects": false,
   "scripts": {
     "build": "vp build",
     "dev": "vp dev",
     "check": "svelte-check --tsconfig ./tsconfig.json",
     "prepare": "svelte-kit sync || echo ''"
   },
   "dependencies": {
     "@lucide/svelte": "catalog:",
     "@magna-carta/design-system": "workspace:*",
-    "@magna-carta/design-tokens": "workspace:*"
+    "@magna-carta/design-tokens": "workspace:*",
+    "@magna-carta/tools": "workspace:*"
   },
   "devDependencies": {
     "@sveltejs/adapter-static": "catalog:",
     "@sveltejs/kit": "catalog:",
     "@sveltejs/vite-plugin-svelte": "catalog:",
     "@tailwindcss/vite": "catalog:",
     "@types/node": "catalog:",
     "svelte": "catalog:",
     "svelte-check": "catalog:",
     "tailwindcss": "catalog:"
diff --git a/apps/web/src/lib/tools/tool-presentation.ts b/apps/web/src/lib/tools/tool-presentation.ts
new file mode 100644
index 0000000..8dce219
--- /dev/null
+++ b/apps/web/src/lib/tools/tool-presentation.ts
@@ -0,0 +1,140 @@
+/*
+ * The Tools listing's presentation layer. The domain catalog (@magna-carta/tools) owns tool
+ * identity; this module owns how a tool READS on the page — its one-line descriptor, how
+ * finished its UI surface is (the maturity stage), the icon component its catalog icon-name
+ * resolves to, and the human label for each subject group. A covering test asserts this layer
+ * stays complete against the catalog, so a tool added to the catalog cannot render blank.
+ *
+ * Every tool is `soon` today: no tool has its own page yet. As each tool's page is built, its
+ * entry advances (alpha/beta/ready) and the listing entry becomes launchable — nothing here is
+ * faked meanwhile.
+ */
+import type { Component } from "svelte";
+import House from "@lucide/svelte/icons/house";
+import Landmark from "@lucide/svelte/icons/landmark";
+import Building2 from "@lucide/svelte/icons/building-2";
+import BadgeCheck from "@lucide/svelte/icons/badge-check";
+import Package from "@lucide/svelte/icons/package";
+import Gauge from "@lucide/svelte/icons/gauge";
+import ChartPie from "@lucide/svelte/icons/chart-pie";
+import Globe from "@lucide/svelte/icons/globe";
+import Shield from "@lucide/svelte/icons/shield";
+import FileCog from "@lucide/svelte/icons/file-cog";
+import FileSearch from "@lucide/svelte/icons/file-search";
+import Fingerprint from "@lucide/svelte/icons/fingerprint";
+import LockOpen from "@lucide/svelte/icons/lock-open";
+import FileCheck from "@lucide/svelte/icons/file-check";
+import ScanText from "@lucide/svelte/icons/scan-text";
+import Wrench from "@lucide/svelte/icons/wrench";
+import { CATALOG } from "@magna-carta/tools/catalog";
+import { toolsByGroup, type GroupedTools } from "@magna-carta/tools/select";
+import type { SubjectGroup } from "@magna-carta/tools/types";
+// Type-only: elided at build, so the plugin-less test config never resolves the $lib alias.
+import type { MaturityStage } from "$lib/maturity/maturity.ts";
+
+export interface ToolPresentation {
+  /** One line, plain language, what the tool does — no marketing voice. */
+  readonly description: string;
+  /** How finished the tool's UI surface is. `ready` → launchable, wears no badge. */
+  readonly stage: MaturityStage;
+}
+
+// Keyed by ToolManifest.id. The completeness test pins this to the catalog id set.
+export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {
+  "property-listing-links": {
+    description: "Open a property address across the major listing sites.",
+    stage: "soon",
+  },
+  "county-property-records": {
+    description: "Jump to the county assessor and recorder for an address.",
+    stage: "soon",
+  },
+  "business-entity-lookup": {
+    description: "Find a company's registration in the state business registry.",
+    stage: "soon",
+  },
+  "attorney-license-lookup": {
+    description: "Check a lawyer's bar standing and discipline history.",
+    stage: "soon",
+  },
+  shipping: { description: "Rate and buy postage for a mailing.", stage: "soon" },
+  "network-speed-test": {
+    description: "Measure this connection's speed to the platform.",
+    stage: "soon",
+  },
+  "firm-usage": { description: "See the firm's storage and platform consumption.", stage: "soon" },
+  "whois-lookup": { description: "Look up who registered a domain, and when.", stage: "soon" },
+  "safe-website-viewer": {
+    description: "Open an untrusted website at arm's length.",
+    stage: "soon",
+  },
+  "file-converter": { description: "Convert a file from one format to another.", stage: "soon" },
+  "metadata-scrubber": {
+    description: "Inspect and strip hidden metadata from a file.",
+    stage: "soon",
+  },
+  "file-hash-integrity": {
+    description: "Compute a file's hash and confirm it hasn't changed.",
+    stage: "soon",
+  },
+  "file-decryption": {
+    description: "Unlock a protected file or recover its password.",
+    stage: "soon",
+  },
+  "file-type-verifier": {
+    description: "Confirm what a file really is, whatever its extension says.",
+    stage: "soon",
+  },
+  "ai-text-detection": {
+    description: "Estimate whether a passage was written by AI.",
+    stage: "soon",
+  },
+  "file-repair": {
+    description: "Repair and salvage a damaged or corrupted file.",
+    stage: "soon",
+  },
+};
+
+// SubjectGroup → engraved section label.
+export const SUBJECT_GROUP_LABELS: Record<SubjectGroup, string> = {
+  property: "Property",
+  "business-entities": "Business Entities",
+  "people-licenses": "People & Licenses",
+  "mailing-shipping": "Mailing & Shipping",
+  printing: "Printing",
+  "web-domains": "Web & Domains",
+  files: "Documents & Files",
+  diagnostics: "Diagnostics",
+};
+
+// Catalog icon-name string → imported Lucide component. Explicit imports (the destinations.ts
+// idiom), not dynamic import; the completeness test asserts every catalog icon appears here.
+export const TOOL_ICONS: Record<string, Component> = {
+  house: House,
+  landmark: Landmark,
+  "building-2": Building2,
+  "badge-check": BadgeCheck,
+  package: Package,
+  gauge: Gauge,
+  "chart-pie": ChartPie,
+  globe: Globe,
+  shield: Shield,
+  "file-cog": FileCog,
+  "file-search": FileSearch,
+  fingerprint: Fingerprint,
+  "lock-open": LockOpen,
+  "file-check": FileCheck,
+  "scan-text": ScanText,
+  wrench: Wrench,
+};
+
+// Mock permission seam: the managing partner sees everything, so grant every permission the
+// catalog declares. The member's real grants replace this set when auth lands; the
+// toolsByGroup call site below does not change.
+const mockPermissions = new Set(CATALOG.map((tool) => tool.permission));
+
+// The page's data: permitted tools grouped by subject in the catalog's fixed order, empty
+// groups omitted — the same gate the contextual tool surfaces use.
+export function visibleToolGroups(): GroupedTools[] {
+  return toolsByGroup(CATALOG, mockPermissions);
+}
diff --git a/apps/web/test/tools-presentation.test.ts b/apps/web/test/tools-presentation.test.ts
new file mode 100644
index 0000000..919ba0d
--- /dev/null
+++ b/apps/web/test/tools-presentation.test.ts
@@ -0,0 +1,51 @@
+/*
+ * Fitness checks for the Tools listing's presentation layer: every catalog tool has exactly
+ * one descriptor + stage, every catalog icon name resolves to a component, every subject group
+ * has a label, and the mock-gated grouping surfaces the whole catalog in canonical order. These
+ * are the guards that keep a newly-added catalog tool from rendering blank or vanishing.
+ */
+import { describe, expect, it } from "vitest";
+import { CATALOG } from "@magna-carta/tools/catalog";
+import { SUBJECT_GROUP_ORDER } from "@magna-carta/tools/types";
+import {
+  SUBJECT_GROUP_LABELS,
+  TOOL_ICONS,
+  TOOL_PRESENTATION,
+  visibleToolGroups,
+} from "../src/lib/tools/tool-presentation.ts";
+
+const catalogIds = CATALOG.map((tool) => tool.id).sort();
+
+describe("tool presentation completeness", () => {
+  it("has a presentation entry for every catalog tool and no extras", () => {
+    expect(Object.keys(TOOL_PRESENTATION).sort()).toEqual(catalogIds);
+  });
+
+  it("resolves an icon component for every catalog icon name", () => {
+    for (const tool of CATALOG) {
+      expect(TOOL_ICONS[tool.icon], `missing icon for ${tool.icon}`).toBeDefined();
+    }
+  });
+
+  it("labels every subject group", () => {
+    for (const group of SUBJECT_GROUP_ORDER) {
+      expect(SUBJECT_GROUP_LABELS[group], `missing label for ${group}`).toBeTruthy();
+    }
+  });
+});
+
+describe("visibleToolGroups (mock all-permissions)", () => {
+  it("returns every non-empty group in canonical order", () => {
+    const expectedOrder = SUBJECT_GROUP_ORDER.filter((group) =>
+      CATALOG.some((tool) => tool.subjectGroup === group),
+    );
+    expect(visibleToolGroups().map((entry) => entry.group)).toEqual(expectedOrder);
+  });
+
+  it("surfaces the whole catalog exactly once", () => {
+    const listed = visibleToolGroups()
+      .flatMap((entry) => entry.tools.map((tool) => tool.id))
+      .sort();
+    expect(listed).toEqual(catalogIds);
+  });
+});
diff --git a/apps/web/vitest.config.ts b/apps/web/vitest.config.ts
index 18c9f0a..4274b4d 100644
--- a/apps/web/vitest.config.ts
+++ b/apps/web/vitest.config.ts
@@ -1,14 +1,25 @@
+import { svelte } from "@sveltejs/vite-plugin-svelte";
 import { defineConfig } from "vitest/config";

 // Plain node pool for the web app's data-module tests (registry fitness checks) — no browser,
 // no SvelteKit plugin (this config never runs a dev/build, so the cwd guard dance in
 // vite.config.ts does not apply here). root is pinned to this package so the repo-root
 // `vp test` resolves this project's tests from here.
+//
+// The base Svelte compiler plugin (not SvelteKit's) is still needed: data modules like
+// tool-presentation.ts import Lucide icon components, and @lucide/svelte's icon subpaths
+// (icons/*) re-export a raw .svelte source file rather than compiled JS. Without a transform for
+// ".svelte", Vite's default SSR externalization hands that import straight to Node, which throws
+// ERR_UNKNOWN_FILE_EXTENSION.
 export default defineConfig({
+  plugins: [svelte()],
   test: {
     name: "web",
     root: import.meta.dirname,
     environment: "node",
     include: ["test/**/*.test.ts"],
+    server: {
+      deps: { inline: ["@lucide/svelte"] },
+    },
   },
 });
diff --git a/packages/tools/src/catalog.ts b/packages/tools/src/catalog.ts
index 923ea55..d7256dd 100644
--- a/packages/tools/src/catalog.ts
+++ b/packages/tools/src/catalog.ts
@@ -123,21 +123,21 @@ export const CATALOG: readonly ToolManifest[] = [
     subjectGroup: "files",
     permission: assertPermission("tools:fileIntegrity"),
     contextTags: ["file", "none"],
     backing: { kind: "library" },
     matterContext: "none",
   },
   {
     id: "file-decryption",
     name: "File Decryption & Recovery",
     icon: "lock-open",
-    subjectGroup: "documents",
+    subjectGroup: "files",
     permission: assertPermission("tools:decryption"),
     contextTags: ["file"],
     backing: { kind: "library" },
     matterContext: "none",
   },
   {
     id: "file-type-verifier",
     name: "File Type Verifier",
     icon: "file-check",
     subjectGroup: "files",
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 65486b6..c564a9d 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -407,20 +407,23 @@ importers:
     dependencies:
       '@lucide/svelte':
         specifier: 'catalog:'
         version: 1.17.0(svelte@5.56.2)
       '@magna-carta/design-system':
         specifier: workspace:*
         version: link:../../packages/design-system
       '@magna-carta/design-tokens':
         specifier: workspace:*
         version: link:../../packages/design-tokens
+      '@magna-carta/tools':
+        specifier: workspace:*
+        version: link:../../packages/tools
     devDependencies:
       '@sveltejs/adapter-static':
         specifier: 'catalog:'
         version: 3.0.10(@sveltejs/kit@2.63.0(@sveltejs/vite-plugin-svelte@7.1.2(svelte@5.56.2)(vite@8.0.16(@types/node@25.9.1)(esbuild@0.28.1)(jiti@2.7.0)(tsx@4.22.4)(yaml@2.9.0)))(svelte@5.56.2)(typescript@6.0.3)(vite@8.0.16(@types/node@25.9.1)(esbuild@0.28.1)(jiti@2.7.0)(tsx@4.22.4)(yaml@2.9.0)))
       '@sveltejs/kit':
         specifier: 'catalog:'
         version: 2.63.0(@sveltejs/vite-plugin-svelte@7.1.2(svelte@5.56.2)(vite@8.0.16(@types/node@25.9.1)(esbuild@0.28.1)(jiti@2.7.0)(tsx@4.22.4)(yaml@2.9.0)))(svelte@5.56.2)(typescript@6.0.3)(vite@8.0.16(@types/node@25.9.1)(esbuild@0.28.1)(jiti@2.7.0)(tsx@4.22.4)(yaml@2.9.0))
       '@sveltejs/vite-plugin-svelte':
         specifier: 'catalog:'
         version: 7.1.2(svelte@5.56.2)(vite@8.0.16(@types/node@25.9.1)(esbuild@0.28.1)(jiti@2.7.0)(tsx@4.22.4)(yaml@2.9.0))
```
