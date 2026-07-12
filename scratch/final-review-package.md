# Final whole-branch review package (Tools listing feature)

Range: 82f61a2..6436858d7fe53e3659587ec77c942c5db98b2b1c

## Commits

6436858 fix(tools): consistent hover affordance on a launchable tile; drop inert aria-disabled
6e45628 feat(tools): /tools listing page with tiles/list toggle
b73385c feat(tools): persisted tiles/list view preference
41985e1 fix(tools): put file-decryption on the files subject group
646e37f feat(tools): presentation layer for the tools listing
85fc363 docs(tools): implementation plan for the /tools listing page
08cfa11 docs(tools): add tiles/list view toggle to the listing page spec
ee032e2 docs(tools): design spec for the /tools listing page

## Diff --stat

apps/web/package.json | 3 +-
apps/web/src/lib/navigation/destinations.ts | 4 +-
apps/web/src/lib/tools/tool-presentation.ts | 164 ++++++
apps/web/src/lib/tools/tool-row.svelte | 33 ++
apps/web/src/lib/tools/tool-tile.svelte | 41 ++
.../src/lib/tools/tools-view-preference.svelte.ts | 51 ++
apps/web/src/lib/tools/tools-view-preference.ts | 16 +
apps/web/src/routes/(app)/tools/+page.svelte | 83 +++
apps/web/test/tools-presentation.test.ts | 51 ++
apps/web/test/tools-view-preference.test.ts | 24 +
apps/web/vitest.config.ts | 11 +
docs/active-work/slice-0-7b-app-shell.md | 7 +
docs/specs/2026-07-08-tools-listing-page-design.md | 173 ++++++
...07-08-tools-listing-page-implementation-plan.md | 643 +++++++++++++++++++++
packages/tools/src/catalog.ts | 2 +-
pnpm-lock.yaml | 3 +
16 files changed, 1305 insertions(+), 4 deletions(-)

## Full diff (-U10)

````diff
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
diff --git a/apps/web/src/lib/navigation/destinations.ts b/apps/web/src/lib/navigation/destinations.ts
index 82b1d7c..23a2754 100644
--- a/apps/web/src/lib/navigation/destinations.ts
+++ b/apps/web/src/lib/navigation/destinations.ts
@@ -310,22 +310,22 @@ export const DESTINATIONS: readonly Destination[] = [
     defaultStarred: true,
   },
   // Firm
   {
     id: "tools",
     label: "Tools",
     href: "/tools",
     icon: Wrench,
     description: "Standalone utilities — inspect, verify, repair, and convert files.",
     group: "firm",
-    shipped: false,
-    announced: true,
+    shipped: true,
+    stage: "alpha",
     defaultStarred: true,
   },
   {
     id: "reports",
     label: "Reports",
     href: "/reports",
     icon: ChartColumn,
     description: "The firm's numbers, sliced and exported.",
     group: "firm",
     shipped: false,
diff --git a/apps/web/src/lib/tools/tool-presentation.ts b/apps/web/src/lib/tools/tool-presentation.ts
new file mode 100644
index 0000000..5e29183
--- /dev/null
+++ b/apps/web/src/lib/tools/tool-presentation.ts
@@ -0,0 +1,164 @@
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
+import type { SubjectGroup, ToolManifest } from "@magna-carta/tools/types";
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
+// Both lookups are keyed by a plain string (Record<string, T>), so an indexed read types as
+// possibly-undefined under this project's noUncheckedIndexedAccess — even though the
+// completeness test above guarantees every catalog tool resolves both. These two accessors are
+// the one place that guarantee is asserted, so call sites (tool-tile.svelte, tool-row.svelte,
+// the /tools page) read a plain ToolPresentation/Component, never an optional.
+
+/** A catalog tool's presentation entry. Throws only if the catalog outran this module's table. */
+export function toolPresentation(tool: ToolManifest): ToolPresentation {
+  const presentation = TOOL_PRESENTATION[tool.id];
+  if (presentation === undefined) {
+    throw new Error(`No presentation entry for tool "${tool.id}".`);
+  }
+  return presentation;
+}
+
+/** A catalog tool's icon component. Throws only if the catalog outran this module's icon map. */
+export function toolIcon(tool: ToolManifest): Component {
+  const icon = TOOL_ICONS[tool.icon];
+  if (icon === undefined) {
+    throw new Error(`No icon component for icon "${tool.icon}".`);
+  }
+  return icon;
+}
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
diff --git a/apps/web/src/lib/tools/tool-row.svelte b/apps/web/src/lib/tools/tool-row.svelte
new file mode 100644
index 0000000..2d32432
--- /dev/null
+++ b/apps/web/src/lib/tools/tool-row.svelte
@@ -0,0 +1,33 @@
+<script lang="ts">
+  /*
+   * One tool as a dense list row — the same content and launchable rule as the tile, laid out
+   * on a single line: leading icon, name, descriptor trailing muted, maturity badge at the end.
+   */
+  import type { Component } from "svelte";
+  import type { ToolManifest } from "@magna-carta/tools/types";
+  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
+  import type { ToolPresentation } from "./tool-presentation.ts";
+
+  let {
+    tool,
+    presentation,
+    icon: Icon,
+  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();
+
+  const launchable = $derived(presentation.stage === "ready");
+</script>
+
+{#snippet body()}
+  <div class="flex items-center gap-16 px-16 py-12">
+    <Icon class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
+    <span class="font-medium">{tool.name}</span>
+    <span class="truncate text-sm text-text-muted">{presentation.description}</span>
+    <span class="ml-auto shrink-0"><MaturityBadge stage={presentation.stage} /></span>
+  </div>
+{/snippet}
+
+{#if launchable}
+  <a href={`/tools/${tool.id}`} class="block hover:bg-surface-raised">{@render body()}</a>
+{:else}
+  <div>{@render body()}</div>
+{/if}
diff --git a/apps/web/src/lib/tools/tool-tile.svelte b/apps/web/src/lib/tools/tool-tile.svelte
new file mode 100644
index 0000000..95eec46
--- /dev/null
+++ b/apps/web/src/lib/tools/tool-tile.svelte
@@ -0,0 +1,41 @@
+<script lang="ts">
+  /*
+   * One tool as a card tile. A `ready` tool's whole tile links to its page; below `ready` the
+   * tile is inert and quieter, its maturity badge carrying the "not yet" meaning — no disabled
+   * styling that would read as broken. Every tool is `soon` until its page is built.
+   */
+  import type { Component } from "svelte";
+  import type { ToolManifest } from "@magna-carta/tools/types";
+  import * as Card from "@magna-carta/design-system/card";
+  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
+  import type { ToolPresentation } from "./tool-presentation.ts";
+
+  let {
+    tool,
+    presentation,
+    icon: Icon,
+  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();
+
+  const launchable = $derived(presentation.stage === "ready");
+</script>
+
+{#snippet body()}
+  <Card.Root class="h-full">
+    <Card.Header>
+      <div class="flex items-start justify-between gap-8">
+        <span class="flex items-center gap-8">
+          <Icon class="size-16 text-text-muted" aria-hidden="true" />
+          <Card.Title>{tool.name}</Card.Title>
+        </span>
+        <MaturityBadge stage={presentation.stage} />
+      </div>
+      <Card.Description>{presentation.description}</Card.Description>
+    </Card.Header>
+  </Card.Root>
+{/snippet}
+
+{#if launchable}
+  <a href={`/tools/${tool.id}`} class="block h-full rounded-lg hover:bg-surface-raised">{@render body()}</a>
+{:else}
+  <div class="h-full">{@render body()}</div>
+{/if}
diff --git a/apps/web/src/lib/tools/tools-view-preference.svelte.ts b/apps/web/src/lib/tools/tools-view-preference.svelte.ts
new file mode 100644
index 0000000..749a5ba
--- /dev/null
+++ b/apps/web/src/lib/tools/tools-view-preference.svelte.ts
@@ -0,0 +1,51 @@
+/*
+ * The reactive Tools view preference — a per-browser choice, stored in localStorage and synced
+ * across tabs by the storage event (the sidebar-preferences pattern). SSR/prerender-safe: module
+ * init never assumes a browser. Reads and writes go through parseToolsView so a stale value
+ * normalizes on read.
+ */
+import {
+  DEFAULT_VIEW,
+  TOOLS_VIEW_STORAGE_KEY,
+  parseToolsView,
+  type ToolsView,
+} from "./tools-view-preference.ts";
+
+function readStored(): ToolsView {
+  if (typeof localStorage === "undefined") return DEFAULT_VIEW;
+  try {
+    return parseToolsView(localStorage.getItem(TOOLS_VIEW_STORAGE_KEY));
+  } catch {
+    return DEFAULT_VIEW;
+  }
+}
+
+function persist(view: ToolsView): void {
+  if (typeof localStorage === "undefined") return;
+  try {
+    localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, view);
+  } catch {
+    // Storage unavailable; the live preference still works for the session.
+  }
+}
+
+const state = $state<{ view: ToolsView }>({ view: readStored() });
+
+// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
+if (typeof window !== "undefined") {
+  window.addEventListener("storage", (event) => {
+    if (event.key !== null && event.key !== TOOLS_VIEW_STORAGE_KEY) return;
+    state.view = readStored();
+  });
+}
+
+/** Read reactively in markup. */
+export function toolsView(): ToolsView {
+  return state.view;
+}
+
+export function setToolsView(view: ToolsView): void {
+  if (state.view === view) return;
+  state.view = view;
+  persist(view);
+}
diff --git a/apps/web/src/lib/tools/tools-view-preference.ts b/apps/web/src/lib/tools/tools-view-preference.ts
new file mode 100644
index 0000000..6410505
--- /dev/null
+++ b/apps/web/src/lib/tools/tools-view-preference.ts
@@ -0,0 +1,16 @@
+/*
+ * The Tools page's view choice — a card grid ("tiles") or a dense list ("list"). This pure
+ * module holds the shape, the default, the storage key, and the read-time validation; the rune
+ * store beside it (tools-view-preference.svelte.ts) owns the reactive state and localStorage.
+ * The split keeps this logic unit-testable under the plugin-less web test config.
+ */
+export type ToolsView = "tiles" | "list";
+
+export const DEFAULT_VIEW: ToolsView = "tiles";
+
+export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";
+
+/** Normalize a stored value: only the two known views survive; everything else is the default. */
+export function parseToolsView(raw: string | null): ToolsView {
+  return raw === "tiles" || raw === "list" ? raw : DEFAULT_VIEW;
+}
diff --git a/apps/web/src/routes/(app)/tools/+page.svelte b/apps/web/src/routes/(app)/tools/+page.svelte
new file mode 100644
index 0000000..b7e4169
--- /dev/null
+++ b/apps/web/src/routes/(app)/tools/+page.svelte
@@ -0,0 +1,83 @@
+<script lang="ts">
+  /*
+   * Tools — the ethereal workbench's directory. Every tool the firm offers, grouped by subject,
+   * shown as a card grid or a dense list (the toggle in the masthead, a persisted per-member
+   * choice). Runs outside any matter: the standing line states it. Every entry is `soon` until
+   * its own page is built — nothing here is faked.
+   */
+  import * as Masthead from "@magna-carta/design-system/masthead";
+  import Button from "@magna-carta/design-system/button";
+  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
+  import List from "@lucide/svelte/icons/list";
+  import {
+    SUBJECT_GROUP_LABELS,
+    toolIcon,
+    toolPresentation,
+    visibleToolGroups,
+  } from "$lib/tools/tool-presentation.ts";
+  import { setToolsView, toolsView } from "$lib/tools/tools-view-preference.svelte.ts";
+  import ToolTile from "$lib/tools/tool-tile.svelte";
+  import ToolRow from "$lib/tools/tool-row.svelte";
+
+  const groups = visibleToolGroups();
+  const view = $derived(toolsView());
+</script>
+
+<svelte:head><title>Tools · Magna Carta</title></svelte:head>
+
+<Masthead.Root class="mb-24">
+  <Masthead.Heading>
+    <Masthead.Title>Tools</Masthead.Title>
+    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
+  </Masthead.Heading>
+  <Masthead.Actions>
+    <div class="flex items-center gap-4" role="group" aria-label="Choose a view">
+      <Button
+        variant={view === "tiles" ? "secondary" : "ghost"}
+        size="icon"
+        aria-label="Tile view"
+        aria-pressed={view === "tiles"}
+        onclick={() => setToolsView("tiles")}
+      >
+        <LayoutGrid class="size-16" aria-hidden="true" />
+      </Button>
+      <Button
+        variant={view === "list" ? "secondary" : "ghost"}
+        size="icon"
+        aria-label="List view"
+        aria-pressed={view === "list"}
+        onclick={() => setToolsView("list")}
+      >
+        <List class="size-16" aria-hidden="true" />
+      </Button>
+    </div>
+  </Masthead.Actions>
+</Masthead.Root>
+
+<div class="flex flex-col gap-32">
+  {#each groups as { group, tools } (group)}
+    <section class="flex flex-col gap-16">
+      <h2
+        class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
+        style="letter-spacing: var(--mc-tracking-caps)"
+      >
+        {SUBJECT_GROUP_LABELS[group]}
+      </h2>
+      {#if view === "tiles"}
+        <div class="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
+          {#each tools as tool (tool.id)}
+            <ToolTile {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} />
+          {/each}
+        </div>
+      {:else}
+        <ul
+          class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default"
+        >
+          {#each tools as tool (tool.id)}
+            <li><ToolRow {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} /></li>
+          {/each}
+        </ul>
+      {/if}
+    </section>
+  {/each}
+</div>
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
diff --git a/apps/web/test/tools-view-preference.test.ts b/apps/web/test/tools-view-preference.test.ts
new file mode 100644
index 0000000..3a7ba4e
--- /dev/null
+++ b/apps/web/test/tools-view-preference.test.ts
@@ -0,0 +1,24 @@
+/*
+ * The view-preference PARSE rule, pinned: only the two known views survive a read; anything
+ * else (null, a stale/hand-edited value) falls back to the default. The rune store and its
+ * localStorage/cross-tab wiring are browser-verified — this pins the one branch worth a unit.
+ */
+import { describe, expect, it } from "vitest";
+import { DEFAULT_VIEW, parseToolsView } from "../src/lib/tools/tools-view-preference.ts";
+
+describe("parseToolsView", () => {
+  it("keeps a valid stored view", () => {
+    expect(parseToolsView("tiles")).toBe("tiles");
+    expect(parseToolsView("list")).toBe("list");
+  });
+
+  it("falls back to the default for null or unknown values", () => {
+    expect(parseToolsView(null)).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("grid")).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("")).toBe(DEFAULT_VIEW);
+  });
+
+  it("defaults to tiles", () => {
+    expect(DEFAULT_VIEW).toBe("tiles");
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
diff --git a/docs/active-work/slice-0-7b-app-shell.md b/docs/active-work/slice-0-7b-app-shell.md
index 6f4aa60..0ff65b8 100644
--- a/docs/active-work/slice-0-7b-app-shell.md
+++ b/docs/active-work/slice-0-7b-app-shell.md
@@ -9,16 +9,23 @@ theme/mode/density/motion axes.
 **Files touched:** `apps/web/**` (routes, shell composition, app.css/app.html already carry the
 boot + cascade), `packages/design-system/**` (small part additions as the shell demands — TopBar
 parts, register polish), design-lab mockups (untracked working artifacts in this worktree).

 **Added 2026-07-06 — matter detail screen skeleton** (spec:
 `docs/specs/2026-07-06-matter-detail-skeleton-design.md`): new routes under
 `apps/web/src/routes/(app)/matters/[id]/` (header + section nav layout, overview, twelve
 section pages), matter fixtures + header/nav components in `apps/web/src/lib/`. Fixture-driven
 only — no worker/schema/data-access edits.

+**Added 2026-07-08 — Tools listing page** (spec:
+`docs/specs/2026-07-08-tools-listing-page-design.md`): new `apps/web/src/routes/(app)/tools/`
+listing page + `apps/web/src/lib/tools/` presentation seam (descriptor + maturity stage per
+tool, subject-group labels). Renders `packages/tools` `CATALOG` via `toolsByGroup`; domain
+package untouched. Flips the `tools` destination to shipped in `navigation/destinations.ts`.
+Listing only — no drop zone, per-tool pages, or run surface.
+
 **Coordination:** backend is read-only for this stream (UI brief); auth consumes the committed
 contract as-is. No cross-cutting edits expected beyond this note, ROADMAP stage updates, and the
 STATUS 0·7b row.

 **Worktree note:** this directory is the former `slice-0-7a-design-system` worktree, repurposed
 after 0·7a merged — the folder name lags the branch (`slice-0-7b-app-shell`).
diff --git a/docs/specs/2026-07-08-tools-listing-page-design.md b/docs/specs/2026-07-08-tools-listing-page-design.md
new file mode 100644
index 0000000..04e1290
--- /dev/null
+++ b/docs/specs/2026-07-08-tools-listing-page-design.md
@@ -0,0 +1,173 @@
+# Tools listing page (design)
+
+**Date:** 2026-07-08 · **Stream:** `slice-0-7b-app-shell` · **Status:** approved, building
+
+## Purpose
+
+Give the Tools area its first screen: a `/tools` page that lists every tool the firm
+offers, grouped by subject, in either a tile grid or a dense list (owner's choice via a
+toggle), each entry reading honestly against the maturity system.
+This is the announced-but-unbuilt `tools` destination made real. It is a directory of
+what the Tools area holds — not yet a workbench: there is no file drop, no per-tool page,
+and no run surface in this slice. Those arrive tool-by-tool as each tool's own page is
+built.
+
+The Tools area is deliberately ethereal: matter-grade work done without committing to a
+matter. The listing page states that plainly and never implies otherwise.
+
+## Decisions
+
+1. **Listing only.** The page lists tools and shows how finished each one is. No drop
+   zone, no per-tool pages, no run stage, no recents/favorites/history. (History is a
+   deliberate non-feature — privacy and the ethereal principle, not a deferral.)
+2. **The domain catalog stays pure.** `packages/tools/CATALOG` owns tool *identity*
+   (name, icon, subject group, permission, context tags, backing). No user-facing prose
+   and no UI-lifecycle state is added to the domain package.
+3. **Presentation lives app-side.** A new `apps/web/src/lib/tools/` module supplies the
+   per-tool descriptor and maturity stage, plus the human labels for subject groups —
+   the same shape `navigation/destinations.ts` uses for nav entries. A tool needs a row
+   in the catalog *and* a presentation entry; a covering test asserts the two id-sets
+   match, so a tool added to the catalog with no presentation entry fails CI rather than
+   drifting silently. (Build-time completeness would require typing `CATALOG` `as const`
+   to derive a literal `ToolId` union — a domain-package change held out of this slice.)
+4. **Maturity system, not a bespoke chip.** Each tile carries a `MaturityStage`
+   (`soon`/`alpha`/`beta`/`ready`) rendered with the existing `MaturityBadge`. A `ready`
+   tool wears no badge and links to its page; anything below `ready` shows its stage
+   badge and is inert. This is the same vocabulary the sidebar and matter nav already use.
+5. **Honest first state.** No tool has a UI page yet, so every entry is `soon` today. As
+   each tool's page is built in a later slice, its presentation entry advances and the
+   entry becomes launchable. Nothing is faked — the Home-page principle.
+6. **Permission-gated through the shared selector.** The page renders
+   `toolsByGroup(CATALOG, permissions)` — the same gate the contextual surfaces use — so
+   a member only sees tools their grants allow, groups render in the fixed
+   `SUBJECT_GROUP_ORDER`, and empty groups are omitted. Permissions come from the shell's
+   existing permission seam (today a mock granting the managing partner everything, the
+   same posture as Settings).
+7. **Two views, one toggle.** The same grouped, permission-gated data renders in either a
+   **tiles** view (the card grid) or a **list** view (dense rows), chosen by a segmented
+   toggle in the masthead. This lets the owner compare the two treatments directly. The
+   choice is a persisted per-member preference (default **tiles**), modelled on the
+   existing sidebar preference store. The two views differ only in presentation — same
+   grouping, same tile/row content, same launchable seam — so if the owner later settles
+   on one, the other view and the toggle drop out with no data or logic change.
+
+## Route & files
+
+Under `apps/web/`:
+
+| File                                            | Role                                                       |
+| ----------------------------------------------- | ---------------------------------------------------------- |
+| `src/routes/(app)/tools/+page.svelte`           | The listing page — masthead, view toggle, grouped views    |
+| `src/lib/tools/tool-presentation.ts`            | id → `{ description, stage }`; group labels; icon map; `visibleToolGroups()` |
+| `src/lib/tools/tools-view-preference.svelte.ts` | Persisted `"tiles" \| "list"` view preference (default tiles) |
+| `src/lib/tools/tool-tile.svelte`                | One tool as a card tile                                     |
+| `src/lib/tools/tool-row.svelte`                 | One tool as a dense list row                                |
+
+Building this page flips `tools` from `shipped: false` to `shipped: true` (with a `stage`)
+in `navigation/destinations.ts`. Ready-tool links target `/tools/<id>` — a defined seam;
+no such route exists until a tool page is built.
+
+## Presentation seam — `tool-presentation.ts`
+
+```ts
+export interface ToolPresentation {
+  /** One line, plain language, what the tool does — no marketing voice. */
+  readonly description: string;
+  /** How finished the tool's UI surface is. `ready` → launchable, no badge. */
+  readonly stage: MaturityStage;
+}
+
+// Keyed by ToolManifest.id (string). A covering test asserts the key set
+// exactly matches the catalog ids — see tool-presentation.test.ts.
+export const TOOL_PRESENTATION: Record<string, ToolPresentation> = { /* … */ };
+
+// SubjectGroup → engraved section label.
+export const SUBJECT_GROUP_LABELS: Record<SubjectGroup, string> = {
+  property: "Property",
+  "business-entities": "Business Entities",
+  "people-licenses": "People & Licenses",
+  "mailing-shipping": "Mailing & Shipping",
+  printing: "Printing",
+  "web-domains": "Web & Domains",
+  documents: "Documents & Files",
+  diagnostics: "Diagnostics",
+};
+
+// Catalog icon-name string → imported Lucide component (explicit imports, no dynamic
+// import). A covering test asserts every catalog icon appears here.
+export const TOOL_ICONS: Record<string, Component> = { house: House, /* … */ };
+
+// The page's data: permitted tools grouped in fixed order. The mock permission set (the
+// managing partner sees everything) is derived from the catalog; the real member grants
+// replace it when auth lands, leaving this call site unchanged.
+export function visibleToolGroups(): GroupedTools[] { /* toolsByGroup(CATALOG, mockPermissions) */ }
+```
+
+Descriptors (all `stage: "soon"` at this slice):
+
+| Tool                              | Descriptor                                                    |
+| --------------------------------- | ------------------------------------------------------------- |
+| Property Listing Links            | Open a property address across the major listing sites.       |
+| County Property Records           | Jump to the county assessor and recorder for an address.      |
+| Business Entity Lookup            | Find a company's registration in the state business registry. |
+| Attorney License Lookup           | Check a lawyer's bar standing and discipline history.         |
+| Shipping & Postage                | Rate and buy postage for a mailing.                           |
+| Network Speed Test                | Measure this connection's speed to the platform.              |
+| Firm Usage                        | See the firm's storage and platform consumption.              |
+| WHOIS Lookup                      | Look up who registered a domain, and when.                    |
+| Safe Website Viewer               | Open an untrusted website at arm's length.                    |
+| File Converter                    | Convert a file from one format to another.                    |
+| Metadata Inspector & Scrubber     | Inspect and strip hidden metadata from a file.                |
+| File Hash & Integrity             | Compute a file's hash and confirm it hasn't changed.          |
+| File Decryption & Recovery        | Unlock a protected file or recover its password.              |
+| File Type Verifier                | Confirm what a file really is, whatever its extension says.    |
+| AI-Text Detection                 | Estimate whether a passage was written by AI.                 |
+
+## Layout & anatomy
+
+Canvas voice throughout (standard tokens, no chrome register — theming stays at the edges).
+
+- **Masthead.** "Tools" with the standing line *"Runs outside any matter."* — the ethereal
+  principle stated at the page's ceremonial edge, in the Engraved Ledger register. The
+  **view toggle** sits in `Masthead.Actions`: a two-option segmented control (Tiles /
+  List) built from design-system `Button`s with Lucide `layout-grid` / `list` icons,
+  `aria-pressed` reflecting the active view, bound to the persisted preference.
+- **Sections.** One per non-empty subject group, in `SUBJECT_GROUP_ORDER`, each opening
+  with a small-caps engraved group label. The same sections render in both views; only the
+  child layout changes — a responsive grid of `ToolTile` (tiles) or a hairline-separated
+  stack of `ToolRow` (list).
+- **Icon resolution.** `manifest.icon` is a Lucide name string; a `TOOL_ICONS` map in
+  `tool-presentation.ts` resolves each catalog icon name to its imported component (the
+  explicit-import idiom `destinations.ts` uses — no dynamic import). A covering test
+  asserts every catalog icon has a map entry.
+- **Tool tile** (`tool-tile.svelte` — `card` + `MaturityBadge`): icon, Title Case name,
+  one-line descriptor, and the stage badge (absent when `ready`).
+- **Tool row** (`tool-row.svelte`): a denser single line — leading icon, name, descriptor
+  (muted, trailing off the name), stage badge at the row's end; hairline rule between rows.
+- **Launchable seam (both shapes).** `ready` → the whole tile/row is a link to
+  `/tools/<id>`; below `ready` → inert and visibly quieter, the badge carrying the "not
+  yet" meaning (no disabled styling that reads as broken). Each component owns this branch
+  so the page body stays declarative.
+
+## Testing
+
+Pure-logic tests under `apps/web/test/` (the established pattern — no component-render
+harness exists in `apps/web`; the rendered page is checked in the browser).
+
+- **Completeness** (`apps/web/test/tools-presentation.test.ts`): the `TOOL_PRESENTATION`
+  key set exactly matches the `CATALOG` ids (no missing, no extra); every catalog
+  `manifest.icon` has a `TOOL_ICONS` entry; every `SubjectGroup` has a `SUBJECT_GROUP_LABELS`
+  entry.
+- **Grouping** (`visibleToolGroups()`): with the mock all-permissions set, returns every
+  catalog group that has tools, in `SUBJECT_GROUP_ORDER`, with the right tool counts; a
+  restricted set omits gated tools and any now-empty group.
+- **View preference**: defaults to `"tiles"`; setting to `"list"` persists and reloads.
+- **Browser verification** (owner-facing, the point of this slice): both views render, the
+  toggle switches between them and the choice survives a reload, every tile/row reads
+  `soon`, and nothing is launchable yet.
+
+## Out of scope (named, not forgotten)
+
+Drop zone / file staging · per-tool pages and run surfaces · recents/favorites/history
+(a non-feature) · contextual surfacing from other pages (`toolsFor` already exists; no new
+consumer here) · matter-action seam ("File to a Matter" belongs to each tool's page).
diff --git a/docs/specs/2026-07-08-tools-listing-page-implementation-plan.md b/docs/specs/2026-07-08-tools-listing-page-implementation-plan.md
new file mode 100644
index 0000000..f239b4f
--- /dev/null
+++ b/docs/specs/2026-07-08-tools-listing-page-implementation-plan.md
@@ -0,0 +1,643 @@
+# Tools Listing Page Implementation Plan
+
+> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
+
+**Goal:** Build the `/tools` page — every tool the firm offers, grouped by subject, rendered as either a card grid or a dense list (owner's choice via a persisted toggle), each entry reading against the maturity system.
+
+**Architecture:** The domain catalog (`@magna-carta/tools`) stays the source of truth for tool identity; a new app-side `lib/tools/` module supplies presentation (descriptor, maturity stage, icon component, subject-group label) and the mock-gated grouping. Two small presentational components (`ToolTile`, `ToolRow`) each own the launchable seam; the page picks between them by the persisted view preference. Pure logic lives in plain `.ts` (unit-tested under the plugin-less node vitest); the rune store and `.svelte` views are browser-verified.
+
+**Tech Stack:** SvelteKit (Svelte 5 runes), `@magna-carta/design-system` (Card, Button, Masthead), `@lucide/svelte`, the existing `maturity/` module, Vitest.
+
+## Global Constraints
+
+- **All UI through the design system.** Tailwind utilities + `@magna-carta/design-system` components + design tokens only; no raw CSS, no off-token colors, no direct `bits-ui` imports. Lucide icons; no emojis.
+- **Canvas voice.** Standard tokens, no `chrome-*` register — theming stays at the edges.
+- **Motion.** Animate only transform/opacity; wrap any unavoidable layout change in `runViewTransition`. (No motion is required by this plan.)
+- **Full names, no shorthand.** `@magna-carta/tools`, "the data-access layer", etc.
+- **No process-doc references in source.** No ADR/spec/slice citations in code or consumer strings; explain reasoning inline or cite a file path. A forward-looking "when tool pages are built" schedule note is allowed.
+- **Tests live in `apps/web/test/**/*.test.ts`** (the web vitest config includes only that glob) and import app modules by **relative path** (no `$lib` alias in the test config).
+- **Domain package `packages/tools` is not modified** by this plan.
+
+---
+
+### Task 1: Tool presentation module + dependency wiring
+
+**Files:**
+- Modify: `apps/web/package.json` (add the `@magna-carta/tools` workspace dependency)
+- Create: `apps/web/src/lib/tools/tool-presentation.ts`
+- Test: `apps/web/test/tools-presentation.test.ts`
+
+**Interfaces:**
+- Consumes: `CATALOG` (`@magna-carta/tools/catalog`), `toolsByGroup` + `GroupedTools` (`@magna-carta/tools/select`), `SubjectGroup` + `SUBJECT_GROUP_ORDER` (`@magna-carta/tools/types`), `MaturityStage` (`$lib/maturity/maturity.ts`, type-only).
+- Produces: `ToolPresentation` interface; `TOOL_PRESENTATION: Record<string, ToolPresentation>`; `SUBJECT_GROUP_LABELS: Record<SubjectGroup, string>`; `TOOL_ICONS: Record<string, Component>`; `visibleToolGroups(): GroupedTools[]`.
+
+- [ ] **Step 1: Add the dependency**
+
+In `apps/web/package.json`, add to `dependencies` (alphabetical, beside `@magna-carta/design-system`):
+
+```json
+"@magna-carta/tools": "workspace:*",
+```
+
+Then link it:
+
+Run: `vp install`
+Expected: completes; `apps/web/node_modules/@magna-carta/tools` resolves to the workspace package.
+
+- [ ] **Step 2: Write the failing test**
+
+Create `apps/web/test/tools-presentation.test.ts`:
+
+```ts
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
+```
+
+- [ ] **Step 3: Run test to verify it fails**
+
+Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts`
+Expected: FAIL — cannot resolve `../src/lib/tools/tool-presentation.ts` (module not created yet).
+
+- [ ] **Step 4: Create the presentation module**
+
+Create `apps/web/src/lib/tools/tool-presentation.ts`:
+
+```ts
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
+  documents: "Documents & Files",
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
+```
+
+- [ ] **Step 5: Run test to verify it passes**
+
+Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts`
+Expected: PASS (4 tests). If the `@magna-carta/tools` subpath fails to resolve, confirm Step 1's dependency + `vp install` completed.
+
+- [ ] **Step 6: Commit**
+
+```bash
+git add apps/web/package.json apps/web/src/lib/tools/tool-presentation.ts apps/web/test/tools-presentation.test.ts
+git commit -m "feat(tools): presentation layer for the tools listing"
+```
+
+---
+
+### Task 2: Persisted view preference
+
+**Files:**
+- Create: `apps/web/src/lib/tools/tools-view-preference.ts` (pure — parsing/defaults)
+- Create: `apps/web/src/lib/tools/tools-view-preference.svelte.ts` (the rune store)
+- Test: `apps/web/test/tools-view-preference.test.ts`
+
+**Interfaces:**
+- Produces (pure): `type ToolsView = "tiles" | "list"`; `DEFAULT_VIEW: ToolsView`; `TOOLS_VIEW_STORAGE_KEY: string`; `parseToolsView(raw: string | null): ToolsView`.
+- Produces (store): `toolsView(): ToolsView`; `setToolsView(view: ToolsView): void`.
+
+- [ ] **Step 1: Write the failing test**
+
+Create `apps/web/test/tools-view-preference.test.ts`:
+
+```ts
+/*
+ * The view-preference PARSE rule, pinned: only the two known views survive a read; anything
+ * else (null, a stale/hand-edited value) falls back to the default. The rune store and its
+ * localStorage/cross-tab wiring are browser-verified — this pins the one branch worth a unit.
+ */
+import { describe, expect, it } from "vitest";
+import { DEFAULT_VIEW, parseToolsView } from "../src/lib/tools/tools-view-preference.ts";
+
+describe("parseToolsView", () => {
+  it("keeps a valid stored view", () => {
+    expect(parseToolsView("tiles")).toBe("tiles");
+    expect(parseToolsView("list")).toBe("list");
+  });
+
+  it("falls back to the default for null or unknown values", () => {
+    expect(parseToolsView(null)).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("grid")).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("")).toBe(DEFAULT_VIEW);
+  });
+
+  it("defaults to tiles", () => {
+    expect(DEFAULT_VIEW).toBe("tiles");
+  });
+});
+```
+
+- [ ] **Step 2: Run test to verify it fails**
+
+Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-view-preference.test.ts`
+Expected: FAIL — cannot resolve `../src/lib/tools/tools-view-preference.ts`.
+
+- [ ] **Step 3: Create the pure module**
+
+Create `apps/web/src/lib/tools/tools-view-preference.ts`:
+
+```ts
+/*
+ * The Tools page's view choice — a card grid ("tiles") or a dense list ("list"). This pure
+ * module holds the shape, the default, the storage key, and the read-time validation; the rune
+ * store beside it (tools-view-preference.svelte.ts) owns the reactive state and localStorage.
+ * The split keeps this logic unit-testable under the plugin-less web test config.
+ */
+export type ToolsView = "tiles" | "list";
+
+export const DEFAULT_VIEW: ToolsView = "tiles";
+
+export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";
+
+/** Normalize a stored value: only the two known views survive; everything else is the default. */
+export function parseToolsView(raw: string | null): ToolsView {
+  return raw === "tiles" || raw === "list" ? raw : DEFAULT_VIEW;
+}
+```
+
+- [ ] **Step 4: Run test to verify it passes**
+
+Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-view-preference.test.ts`
+Expected: PASS (3 tests).
+
+- [ ] **Step 5: Create the rune store**
+
+Create `apps/web/src/lib/tools/tools-view-preference.svelte.ts`:
+
+```ts
+/*
+ * The reactive Tools view preference — a per-browser choice, stored in localStorage and synced
+ * across tabs by the storage event (the sidebar-preferences pattern). SSR/prerender-safe: module
+ * init never assumes a browser. Reads and writes go through parseToolsView so a stale value
+ * normalizes on read.
+ */
+import {
+  DEFAULT_VIEW,
+  TOOLS_VIEW_STORAGE_KEY,
+  parseToolsView,
+  type ToolsView,
+} from "./tools-view-preference.ts";
+
+function readStored(): ToolsView {
+  if (typeof localStorage === "undefined") return DEFAULT_VIEW;
+  try {
+    return parseToolsView(localStorage.getItem(TOOLS_VIEW_STORAGE_KEY));
+  } catch {
+    return DEFAULT_VIEW;
+  }
+}
+
+function persist(view: ToolsView): void {
+  if (typeof localStorage === "undefined") return;
+  try {
+    localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, view);
+  } catch {
+    // Storage unavailable; the live preference still works for the session.
+  }
+}
+
+const state = $state<{ view: ToolsView }>({ view: readStored() });
+
+// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
+if (typeof window !== "undefined") {
+  window.addEventListener("storage", (event) => {
+    if (event.key !== null && event.key !== TOOLS_VIEW_STORAGE_KEY) return;
+    state.view = readStored();
+  });
+}
+
+/** Read reactively in markup. */
+export function toolsView(): ToolsView {
+  return state.view;
+}
+
+export function setToolsView(view: ToolsView): void {
+  if (state.view === view) return;
+  state.view = view;
+  persist(view);
+}
+```
+
+- [ ] **Step 6: Commit**
+
+```bash
+git add apps/web/src/lib/tools/tools-view-preference.ts apps/web/src/lib/tools/tools-view-preference.svelte.ts apps/web/test/tools-view-preference.test.ts
+git commit -m "feat(tools): persisted tiles/list view preference"
+```
+
+---
+
+### Task 3: Tile + row components, the page, and the destination flip
+
+No unit test — `apps/web` has no component-render harness (its vitest is a plain node pool for data-module checks). This task's deliverable is verified in the browser (Step 8), the point of the slice: the owner compares the two views.
+
+**Files:**
+- Create: `apps/web/src/lib/tools/tool-tile.svelte`
+- Create: `apps/web/src/lib/tools/tool-row.svelte`
+- Create: `apps/web/src/routes/(app)/tools/+page.svelte`
+- Modify: `apps/web/src/lib/navigation/destinations.ts` (the `tools` entry)
+
+**Interfaces:**
+- Consumes: `ToolManifest` (`@magna-carta/tools/types`), `ToolPresentation` + `TOOL_PRESENTATION` + `TOOL_ICONS` + `SUBJECT_GROUP_LABELS` + `visibleToolGroups` (`$lib/tools/tool-presentation.ts`), `toolsView` + `setToolsView` (`$lib/tools/tools-view-preference.svelte.ts`), `MaturityBadge` (`$lib/maturity/maturity-badge.svelte`), design-system `Card` / `Button` / `Masthead`.
+- Both components take the same props: `{ tool: ToolManifest; presentation: ToolPresentation; icon: Component }`.
+
+- [ ] **Step 1: Create the tile component**
+
+Create `apps/web/src/lib/tools/tool-tile.svelte`:
+
+```svelte
+<script lang="ts">
+  /*
+   * One tool as a card tile. A `ready` tool's whole tile links to its page; below `ready` the
+   * tile is inert and quieter, its maturity badge carrying the "not yet" meaning — no disabled
+   * styling that would read as broken. Every tool is `soon` until its page is built.
+   */
+  import type { Component } from "svelte";
+  import type { ToolManifest } from "@magna-carta/tools/types";
+  import * as Card from "@magna-carta/design-system/card";
+  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
+  import type { ToolPresentation } from "./tool-presentation.ts";
+
+  let {
+    tool,
+    presentation,
+    icon: Icon,
+  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();
+
+  const launchable = $derived(presentation.stage === "ready");
+</script>
+
+{#snippet body()}
+  <Card.Root class="h-full">
+    <div class="flex items-start justify-between gap-3">
+      <span class="flex items-center gap-3">
+        <Icon class="size-5 text-text-muted" aria-hidden="true" />
+        <Card.Title>{tool.name}</Card.Title>
+      </span>
+      <MaturityBadge stage={presentation.stage} />
+    </div>
+    <Card.Description class="mt-2">{presentation.description}</Card.Description>
+  </Card.Root>
+{/snippet}
+
+{#if launchable}
+  <a href={`/tools/${tool.id}`} class="block h-full rounded-lg">{@render body()}</a>
+{:else}
+  <div class="h-full" aria-disabled="true">{@render body()}</div>
+{/if}
+```
+
+- [ ] **Step 2: Create the row component**
+
+Create `apps/web/src/lib/tools/tool-row.svelte`:
+
+```svelte
+<script lang="ts">
+  /*
+   * One tool as a dense list row — the same content and launchable rule as the tile, laid out
+   * on a single line: leading icon, name, descriptor trailing muted, maturity badge at the end.
+   */
+  import type { Component } from "svelte";
+  import type { ToolManifest } from "@magna-carta/tools/types";
+  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
+  import type { ToolPresentation } from "./tool-presentation.ts";
+
+  let {
+    tool,
+    presentation,
+    icon: Icon,
+  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();
+
+  const launchable = $derived(presentation.stage === "ready");
+</script>
+
+{#snippet body()}
+  <div class="flex items-center gap-3 px-4 py-3">
+    <Icon class="size-5 shrink-0 text-text-muted" aria-hidden="true" />
+    <span class="font-medium">{tool.name}</span>
+    <span class="truncate text-sm text-text-muted">{presentation.description}</span>
+    <span class="ml-auto shrink-0"><MaturityBadge stage={presentation.stage} /></span>
+  </div>
+{/snippet}
+
+{#if launchable}
+  <a href={`/tools/${tool.id}`} class="block hover:bg-surface-raised">{@render body()}</a>
+{:else}
+  <div aria-disabled="true">{@render body()}</div>
+{/if}
+```
+
+- [ ] **Step 3: Create the page**
+
+Create `apps/web/src/routes/(app)/tools/+page.svelte`:
+
+```svelte
+<script lang="ts">
+  /*
+   * Tools — the ethereal workbench's directory. Every tool the firm offers, grouped by subject,
+   * shown as a card grid or a dense list (the toggle in the masthead, a persisted per-member
+   * choice). Runs outside any matter: the standing line states it. Every entry is `soon` until
+   * its own page is built — nothing here is faked.
+   */
+  import * as Masthead from "@magna-carta/design-system/masthead";
+  import Button from "@magna-carta/design-system/button";
+  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
+  import List from "@lucide/svelte/icons/list";
+  import {
+    SUBJECT_GROUP_LABELS,
+    TOOL_ICONS,
+    TOOL_PRESENTATION,
+    visibleToolGroups,
+  } from "$lib/tools/tool-presentation.ts";
+  import { setToolsView, toolsView } from "$lib/tools/tools-view-preference.svelte.ts";
+  import ToolTile from "$lib/tools/tool-tile.svelte";
+  import ToolRow from "$lib/tools/tool-row.svelte";
+
+  const groups = visibleToolGroups();
+  const view = $derived(toolsView());
+</script>
+
+<svelte:head><title>Tools · Magna Carta</title></svelte:head>
+
+<Masthead.Root class="mb-12">
+  <Masthead.Heading>
+    <Masthead.Title>Tools</Masthead.Title>
+    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
+  </Masthead.Heading>
+  <Masthead.Actions>
+    <div class="flex items-center gap-1" role="group" aria-label="Choose a view">
+      <Button
+        variant={view === "tiles" ? "secondary" : "ghost"}
+        aria-label="Tile view"
+        aria-pressed={view === "tiles"}
+        onclick={() => setToolsView("tiles")}
+      >
+        <LayoutGrid class="size-4" aria-hidden="true" />
+      </Button>
+      <Button
+        variant={view === "list" ? "secondary" : "ghost"}
+        aria-label="List view"
+        aria-pressed={view === "list"}
+        onclick={() => setToolsView("list")}
+      >
+        <List class="size-4" aria-hidden="true" />
+      </Button>
+    </div>
+  </Masthead.Actions>
+</Masthead.Root>
+
+{#each groups as { group, tools } (group)}
+  <section class="mb-12">
+    <h2 class="mb-4 text-sm font-medium text-text-muted" style="font-variant: small-caps">
+      {SUBJECT_GROUP_LABELS[group]}
+    </h2>
+    {#if view === "tiles"}
+      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
+        {#each tools as tool (tool.id)}
+          <ToolTile {tool} presentation={TOOL_PRESENTATION[tool.id]} icon={TOOL_ICONS[tool.icon]} />
+        {/each}
+      </div>
+    {:else}
+      <ul class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
+        {#each tools as tool (tool.id)}
+          <li><ToolRow {tool} presentation={TOOL_PRESENTATION[tool.id]} icon={TOOL_ICONS[tool.icon]} /></li>
+        {/each}
+      </ul>
+    {/if}
+  </section>
+{/each}
+```
+
+- [ ] **Step 4: Flip the `tools` destination to shipped**
+
+In `apps/web/src/lib/navigation/destinations.ts`, change the `tools` entry (around line 314) — set `shipped: true`, add `stage: "alpha"`, and remove the `announced: true` line (a shipped surface is no longer an announcement):
+
+```ts
+  {
+    id: "tools",
+    label: "Tools",
+    href: "/tools",
+    icon: Wrench,
+    description: "Standalone utilities — inspect, verify, repair, and convert files.",
+    group: "firm",
+    shipped: true,
+    stage: "alpha",
+    defaultStarred: true,
+  },
+```
+
+- [ ] **Step 5: Typecheck and lint**
+
+Run: `pnpm check`
+Expected: PASS — no TypeScript, Svelte, lint, or process-ref errors. Fix any surfaced (e.g. an unused import) before proceeding.
+
+- [ ] **Step 6: Confirm the data tests still pass**
+
+Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts test/tools-view-preference.test.ts`
+Expected: PASS.
+
+- [ ] **Step 7: Commit**
+
+```bash
+git add apps/web/src/lib/tools/tool-tile.svelte apps/web/src/lib/tools/tool-row.svelte "apps/web/src/routes/(app)/tools/+page.svelte" apps/web/src/lib/navigation/destinations.ts
+git commit -m "feat(tools): /tools listing page with tiles/list toggle"
+```
+
+- [ ] **Step 8: Browser verification**
+
+Start the dev server and open `/tools` (use the `run` skill / claude-in-chrome). Confirm, capturing a screenshot of each view:
+
+1. **Tiles view** renders every non-empty subject group (Property, Business Entities, People & Licenses, Mailing & Shipping, Web & Domains, Documents & Files, Diagnostics — "Printing" has no tools and is absent), each tile showing icon + name + descriptor + a "Soon" badge.
+2. **List view** (toggle to List) renders the same groups as dense rows.
+3. The toggle switches views, the active button reads pressed, and the choice **survives a page reload** (localStorage).
+4. Nothing is launchable (every entry `soon`); no tile/row is a link yet.
+5. The masthead shows "Tools" with the "Runs outside any matter" line.
+
+Report screenshots to the owner for the tiles-vs-list decision.
+
+---
+
+## Self-Review
+
+**Spec coverage:** Purpose (directory of all tools) → Tasks 1+3. Domain catalog untouched → confirmed (no `packages/tools` edits). Presentation app-side → Task 1. Maturity system → `MaturityBadge` in Task 3. Honest `soon` first state → all stages `soon` in Task 1. Permission gate via `toolsByGroup` → `visibleToolGroups` in Task 1. Two views + toggle → Tasks 2+3. Group labels / icon map → Task 1. Destination flip → Task 3 Step 4. Testing (completeness, grouping, preference parse, browser) → Tasks 1, 2, 3 Step 8. All spec sections covered.
+
+**Placeholder scan:** No TBD/TODO; every code step shows complete content; the browser step lists concrete expected results.
+
+**Type consistency:** `ToolsView`, `DEFAULT_VIEW`, `TOOLS_VIEW_STORAGE_KEY`, `parseToolsView` defined in Task 2's pure module and consumed unchanged by the store; `visibleToolGroups`/`TOOL_PRESENTATION`/`TOOL_ICONS`/`SUBJECT_GROUP_LABELS` defined in Task 1 and consumed by Task 3; both components share the `{ tool, presentation, icon }` prop shape. `toolsView`/`setToolsView` names match between store and page.
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
````
