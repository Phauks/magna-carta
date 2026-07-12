# Task 3 review package

Range: b73385c014711055b730a87bdcb68618f9f86802..6e4562818ea2d54004ec0f020e01c7ef42e21ba2

## Commits

6e45628 feat(tools): /tools listing page with tiles/list toggle

## Diff --stat

apps/web/src/lib/navigation/destinations.ts | 4 +-
apps/web/src/lib/tools/tool-presentation.ts | 26 ++++++++-
apps/web/src/lib/tools/tool-row.svelte | 33 +++++++++++
apps/web/src/lib/tools/tool-tile.svelte | 41 ++++++++++++++
apps/web/src/routes/(app)/tools/+page.svelte | 83 ++++++++++++++++++++++++++++
5 files changed, 184 insertions(+), 3 deletions(-)

## Full diff (-U10)

```diff
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
index 8dce219..5e29183 100644
--- a/apps/web/src/lib/tools/tool-presentation.ts
+++ b/apps/web/src/lib/tools/tool-presentation.ts
@@ -21,21 +21,21 @@ import Globe from "@lucide/svelte/icons/globe";
 import Shield from "@lucide/svelte/icons/shield";
 import FileCog from "@lucide/svelte/icons/file-cog";
 import FileSearch from "@lucide/svelte/icons/file-search";
 import Fingerprint from "@lucide/svelte/icons/fingerprint";
 import LockOpen from "@lucide/svelte/icons/lock-open";
 import FileCheck from "@lucide/svelte/icons/file-check";
 import ScanText from "@lucide/svelte/icons/scan-text";
 import Wrench from "@lucide/svelte/icons/wrench";
 import { CATALOG } from "@magna-carta/tools/catalog";
 import { toolsByGroup, type GroupedTools } from "@magna-carta/tools/select";
-import type { SubjectGroup } from "@magna-carta/tools/types";
+import type { SubjectGroup, ToolManifest } from "@magna-carta/tools/types";
 // Type-only: elided at build, so the plugin-less test config never resolves the $lib alias.
 import type { MaturityStage } from "$lib/maturity/maturity.ts";

 export interface ToolPresentation {
   /** One line, plain language, what the tool does — no marketing voice. */
   readonly description: string;
   /** How finished the tool's UI surface is. `ready` → launchable, wears no badge. */
   readonly stage: MaturityStage;
 }

@@ -121,20 +121,44 @@ export const TOOL_ICONS: Record<string, Component> = {
   shield: Shield,
   "file-cog": FileCog,
   "file-search": FileSearch,
   fingerprint: Fingerprint,
   "lock-open": LockOpen,
   "file-check": FileCheck,
   "scan-text": ScanText,
   wrench: Wrench,
 };

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
 // Mock permission seam: the managing partner sees everything, so grant every permission the
 // catalog declares. The member's real grants replace this set when auth lands; the
 // toolsByGroup call site below does not change.
 const mockPermissions = new Set(CATALOG.map((tool) => tool.permission));

 // The page's data: permitted tools grouped by subject in the catalog's fixed order, empty
 // groups omitted — the same gate the contextual tool surfaces use.
 export function visibleToolGroups(): GroupedTools[] {
   return toolsByGroup(CATALOG, mockPermissions);
 }
diff --git a/apps/web/src/lib/tools/tool-row.svelte b/apps/web/src/lib/tools/tool-row.svelte
new file mode 100644
index 0000000..481feeb
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
+  <div aria-disabled="true">{@render body()}</div>
+{/if}
diff --git a/apps/web/src/lib/tools/tool-tile.svelte b/apps/web/src/lib/tools/tool-tile.svelte
new file mode 100644
index 0000000..8fe30a1
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
+  <a href={`/tools/${tool.id}`} class="block h-full rounded-lg">{@render body()}</a>
+{:else}
+  <div class="h-full" aria-disabled="true">{@render body()}</div>
+{/if}
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
```
