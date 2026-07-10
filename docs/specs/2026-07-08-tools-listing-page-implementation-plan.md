# Tools Listing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/tools` page — every tool the firm offers, grouped by subject, rendered as either a card grid or a dense list (owner's choice via a persisted toggle), each entry reading against the maturity system.

**Architecture:** The domain catalog (`@magna-carta/tools`) stays the source of truth for tool identity; a new app-side `lib/tools/` module supplies presentation (descriptor, maturity stage, icon component, subject-group label) and the mock-gated grouping. Two small presentational components (`ToolTile`, `ToolRow`) each own the launchable seam; the page picks between them by the persisted view preference. Pure logic lives in plain `.ts` (unit-tested under the plugin-less node vitest); the rune store and `.svelte` views are browser-verified.

**Tech Stack:** SvelteKit (Svelte 5 runes), `@magna-carta/design-system` (Card, Button, Masthead), `@lucide/svelte`, the existing `maturity/` module, Vitest.

## Global Constraints

- **All UI through the design system.** Tailwind utilities + `@magna-carta/design-system` components + design tokens only; no raw CSS, no off-token colors, no direct `bits-ui` imports. Lucide icons; no emojis.
- **Canvas voice.** Standard tokens, no `chrome-*` register — theming stays at the edges.
- **Motion.** Animate only transform/opacity; wrap any unavoidable layout change in `runViewTransition`. (No motion is required by this plan.)
- **Full names, no shorthand.** `@magna-carta/tools`, "the data-access layer", etc.
- **No process-doc references in source.** No ADR/spec/slice citations in code or consumer strings; explain reasoning inline or cite a file path. A forward-looking "when tool pages are built" schedule note is allowed.
- **Tests live in `apps/web/test/**/*.test.ts`** (the web vitest config includes only that glob) and import app modules by **relative path** (no `$lib` alias in the test config).
- **Domain package `packages/tools` is not modified** by this plan.

---

### Task 1: Tool presentation module + dependency wiring

**Files:**
- Modify: `apps/web/package.json` (add the `@magna-carta/tools` workspace dependency)
- Create: `apps/web/src/lib/tools/tool-presentation.ts`
- Test: `apps/web/test/tools-presentation.test.ts`

**Interfaces:**
- Consumes: `CATALOG` (`@magna-carta/tools/catalog`), `toolsByGroup` + `GroupedTools` (`@magna-carta/tools/select`), `SubjectGroup` + `SUBJECT_GROUP_ORDER` (`@magna-carta/tools/types`), `MaturityStage` (`$lib/maturity/maturity.ts`, type-only).
- Produces: `ToolPresentation` interface; `TOOL_PRESENTATION: Record<string, ToolPresentation>`; `SUBJECT_GROUP_LABELS: Record<SubjectGroup, string>`; `TOOL_ICONS: Record<string, Component>`; `visibleToolGroups(): GroupedTools[]`.

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json`, add to `dependencies` (alphabetical, beside `@magna-carta/design-system`):

```json
"@magna-carta/tools": "workspace:*",
```

Then link it:

Run: `vp install`
Expected: completes; `apps/web/node_modules/@magna-carta/tools` resolves to the workspace package.

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/tools-presentation.test.ts`:

```ts
/*
 * Fitness checks for the Tools listing's presentation layer: every catalog tool has exactly
 * one descriptor + stage, every catalog icon name resolves to a component, every subject group
 * has a label, and the mock-gated grouping surfaces the whole catalog in canonical order. These
 * are the guards that keep a newly-added catalog tool from rendering blank or vanishing.
 */
import { describe, expect, it } from "vitest";
import { CATALOG } from "@magna-carta/tools/catalog";
import { SUBJECT_GROUP_ORDER } from "@magna-carta/tools/types";
import {
  SUBJECT_GROUP_LABELS,
  TOOL_ICONS,
  TOOL_PRESENTATION,
  visibleToolGroups,
} from "../src/lib/tools/tool-presentation.ts";

const catalogIds = CATALOG.map((tool) => tool.id).sort();

describe("tool presentation completeness", () => {
  it("has a presentation entry for every catalog tool and no extras", () => {
    expect(Object.keys(TOOL_PRESENTATION).sort()).toEqual(catalogIds);
  });

  it("resolves an icon component for every catalog icon name", () => {
    for (const tool of CATALOG) {
      expect(TOOL_ICONS[tool.icon], `missing icon for ${tool.icon}`).toBeDefined();
    }
  });

  it("labels every subject group", () => {
    for (const group of SUBJECT_GROUP_ORDER) {
      expect(SUBJECT_GROUP_LABELS[group], `missing label for ${group}`).toBeTruthy();
    }
  });
});

describe("visibleToolGroups (mock all-permissions)", () => {
  it("returns every non-empty group in canonical order", () => {
    const expectedOrder = SUBJECT_GROUP_ORDER.filter((group) =>
      CATALOG.some((tool) => tool.subjectGroup === group),
    );
    expect(visibleToolGroups().map((entry) => entry.group)).toEqual(expectedOrder);
  });

  it("surfaces the whole catalog exactly once", () => {
    const listed = visibleToolGroups()
      .flatMap((entry) => entry.tools.map((tool) => tool.id))
      .sort();
    expect(listed).toEqual(catalogIds);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts`
Expected: FAIL — cannot resolve `../src/lib/tools/tool-presentation.ts` (module not created yet).

- [ ] **Step 4: Create the presentation module**

Create `apps/web/src/lib/tools/tool-presentation.ts`:

```ts
/*
 * The Tools listing's presentation layer. The domain catalog (@magna-carta/tools) owns tool
 * identity; this module owns how a tool READS on the page — its one-line descriptor, how
 * finished its UI surface is (the maturity stage), the icon component its catalog icon-name
 * resolves to, and the human label for each subject group. A covering test asserts this layer
 * stays complete against the catalog, so a tool added to the catalog cannot render blank.
 *
 * Every tool is `soon` today: no tool has its own page yet. As each tool's page is built, its
 * entry advances (alpha/beta/ready) and the listing entry becomes launchable — nothing here is
 * faked meanwhile.
 */
import type { Component } from "svelte";
import House from "@lucide/svelte/icons/house";
import Landmark from "@lucide/svelte/icons/landmark";
import Building2 from "@lucide/svelte/icons/building-2";
import BadgeCheck from "@lucide/svelte/icons/badge-check";
import Package from "@lucide/svelte/icons/package";
import Gauge from "@lucide/svelte/icons/gauge";
import ChartPie from "@lucide/svelte/icons/chart-pie";
import Globe from "@lucide/svelte/icons/globe";
import Shield from "@lucide/svelte/icons/shield";
import FileCog from "@lucide/svelte/icons/file-cog";
import FileSearch from "@lucide/svelte/icons/file-search";
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import LockOpen from "@lucide/svelte/icons/lock-open";
import FileCheck from "@lucide/svelte/icons/file-check";
import ScanText from "@lucide/svelte/icons/scan-text";
import { CATALOG } from "@magna-carta/tools/catalog";
import { toolsByGroup, type GroupedTools } from "@magna-carta/tools/select";
import type { SubjectGroup } from "@magna-carta/tools/types";
// Type-only: elided at build, so the plugin-less test config never resolves the $lib alias.
import type { MaturityStage } from "$lib/maturity/maturity.ts";

export interface ToolPresentation {
  /** One line, plain language, what the tool does — no marketing voice. */
  readonly description: string;
  /** How finished the tool's UI surface is. `ready` → launchable, wears no badge. */
  readonly stage: MaturityStage;
}

// Keyed by ToolManifest.id. The completeness test pins this to the catalog id set.
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {
  "property-listing-links": {
    description: "Open a property address across the major listing sites.",
    stage: "soon",
  },
  "county-property-records": {
    description: "Jump to the county assessor and recorder for an address.",
    stage: "soon",
  },
  "business-entity-lookup": {
    description: "Find a company's registration in the state business registry.",
    stage: "soon",
  },
  "attorney-license-lookup": {
    description: "Check a lawyer's bar standing and discipline history.",
    stage: "soon",
  },
  shipping: { description: "Rate and buy postage for a mailing.", stage: "soon" },
  "network-speed-test": {
    description: "Measure this connection's speed to the platform.",
    stage: "soon",
  },
  "firm-usage": { description: "See the firm's storage and platform consumption.", stage: "soon" },
  "whois-lookup": { description: "Look up who registered a domain, and when.", stage: "soon" },
  "safe-website-viewer": {
    description: "Open an untrusted website at arm's length.",
    stage: "soon",
  },
  "file-converter": { description: "Convert a file from one format to another.", stage: "soon" },
  "metadata-scrubber": {
    description: "Inspect and strip hidden metadata from a file.",
    stage: "soon",
  },
  "file-hash-integrity": {
    description: "Compute a file's hash and confirm it hasn't changed.",
    stage: "soon",
  },
  "file-decryption": {
    description: "Unlock a protected file or recover its password.",
    stage: "soon",
  },
  "file-type-verifier": {
    description: "Confirm what a file really is, whatever its extension says.",
    stage: "soon",
  },
  "ai-text-detection": {
    description: "Estimate whether a passage was written by AI.",
    stage: "soon",
  },
};

// SubjectGroup → engraved section label.
export const SUBJECT_GROUP_LABELS: Record<SubjectGroup, string> = {
  property: "Property",
  "business-entities": "Business Entities",
  "people-licenses": "People & Licenses",
  "mailing-shipping": "Mailing & Shipping",
  printing: "Printing",
  "web-domains": "Web & Domains",
  documents: "Documents & Files",
  diagnostics: "Diagnostics",
};

// Catalog icon-name string → imported Lucide component. Explicit imports (the destinations.ts
// idiom), not dynamic import; the completeness test asserts every catalog icon appears here.
export const TOOL_ICONS: Record<string, Component> = {
  house: House,
  landmark: Landmark,
  "building-2": Building2,
  "badge-check": BadgeCheck,
  package: Package,
  gauge: Gauge,
  "chart-pie": ChartPie,
  globe: Globe,
  shield: Shield,
  "file-cog": FileCog,
  "file-search": FileSearch,
  fingerprint: Fingerprint,
  "lock-open": LockOpen,
  "file-check": FileCheck,
  "scan-text": ScanText,
};

// Mock permission seam: the managing partner sees everything, so grant every permission the
// catalog declares. The member's real grants replace this set when auth lands; the
// toolsByGroup call site below does not change.
const mockPermissions = new Set(CATALOG.map((tool) => tool.permission));

// The page's data: permitted tools grouped by subject in the catalog's fixed order, empty
// groups omitted — the same gate the contextual tool surfaces use.
export function visibleToolGroups(): GroupedTools[] {
  return toolsByGroup(CATALOG, mockPermissions);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts`
Expected: PASS (4 tests). If the `@magna-carta/tools` subpath fails to resolve, confirm Step 1's dependency + `vp install` completed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/tools/tool-presentation.ts apps/web/test/tools-presentation.test.ts
git commit -m "feat(tools): presentation layer for the tools listing"
```

---

### Task 2: Persisted view preference

**Files:**
- Create: `apps/web/src/lib/tools/tools-view-preference.ts` (pure — parsing/defaults)
- Create: `apps/web/src/lib/tools/tools-view-preference.svelte.ts` (the rune store)
- Test: `apps/web/test/tools-view-preference.test.ts`

**Interfaces:**
- Produces (pure): `type ToolsView = "tiles" | "list"`; `DEFAULT_VIEW: ToolsView`; `TOOLS_VIEW_STORAGE_KEY: string`; `parseToolsView(raw: string | null): ToolsView`.
- Produces (store): `toolsView(): ToolsView`; `setToolsView(view: ToolsView): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/tools-view-preference.test.ts`:

```ts
/*
 * The view-preference PARSE rule, pinned: only the two known views survive a read; anything
 * else (null, a stale/hand-edited value) falls back to the default. The rune store and its
 * localStorage/cross-tab wiring are browser-verified — this pins the one branch worth a unit.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseToolsView } from "../src/lib/tools/tools-view-preference.ts";

describe("parseToolsView", () => {
  it("keeps a valid stored view", () => {
    expect(parseToolsView("tiles")).toBe("tiles");
    expect(parseToolsView("list")).toBe("list");
  });

  it("falls back to the default for null or unknown values", () => {
    expect(parseToolsView(null)).toBe(DEFAULT_VIEW);
    expect(parseToolsView("grid")).toBe(DEFAULT_VIEW);
    expect(parseToolsView("")).toBe(DEFAULT_VIEW);
  });

  it("defaults to tiles", () => {
    expect(DEFAULT_VIEW).toBe("tiles");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-view-preference.test.ts`
Expected: FAIL — cannot resolve `../src/lib/tools/tools-view-preference.ts`.

- [ ] **Step 3: Create the pure module**

Create `apps/web/src/lib/tools/tools-view-preference.ts`:

```ts
/*
 * The Tools page's view choice — a card grid ("tiles") or a dense list ("list"). This pure
 * module holds the shape, the default, the storage key, and the read-time validation; the rune
 * store beside it (tools-view-preference.svelte.ts) owns the reactive state and localStorage.
 * The split keeps this logic unit-testable under the plugin-less web test config.
 */
export type ToolsView = "tiles" | "list";

export const DEFAULT_VIEW: ToolsView = "tiles";

export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";

/** Normalize a stored value: only the two known views survive; everything else is the default. */
export function parseToolsView(raw: string | null): ToolsView {
  return raw === "tiles" || raw === "list" ? raw : DEFAULT_VIEW;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-view-preference.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the rune store**

Create `apps/web/src/lib/tools/tools-view-preference.svelte.ts`:

```ts
/*
 * The reactive Tools view preference — a per-browser choice, stored in localStorage and synced
 * across tabs by the storage event (the sidebar-preferences pattern). SSR/prerender-safe: module
 * init never assumes a browser. Reads and writes go through parseToolsView so a stale value
 * normalizes on read.
 */
import {
  DEFAULT_VIEW,
  TOOLS_VIEW_STORAGE_KEY,
  parseToolsView,
  type ToolsView,
} from "./tools-view-preference.ts";

function readStored(): ToolsView {
  if (typeof localStorage === "undefined") return DEFAULT_VIEW;
  try {
    return parseToolsView(localStorage.getItem(TOOLS_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

function persist(view: ToolsView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

const state = $state<{ view: ToolsView }>({ view: readStored() });

// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== TOOLS_VIEW_STORAGE_KEY) return;
    state.view = readStored();
  });
}

/** Read reactively in markup. */
export function toolsView(): ToolsView {
  return state.view;
}

export function setToolsView(view: ToolsView): void {
  if (state.view === view) return;
  state.view = view;
  persist(view);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tools/tools-view-preference.ts apps/web/src/lib/tools/tools-view-preference.svelte.ts apps/web/test/tools-view-preference.test.ts
git commit -m "feat(tools): persisted tiles/list view preference"
```

---

### Task 3: Tile + row components, the page, and the destination flip

No unit test — `apps/web` has no component-render harness (its vitest is a plain node pool for data-module checks). This task's deliverable is verified in the browser (Step 8), the point of the slice: the owner compares the two views.

**Files:**
- Create: `apps/web/src/lib/tools/tool-tile.svelte`
- Create: `apps/web/src/lib/tools/tool-row.svelte`
- Create: `apps/web/src/routes/(app)/tools/+page.svelte`
- Modify: `apps/web/src/lib/navigation/destinations.ts` (the `tools` entry)

**Interfaces:**
- Consumes: `ToolManifest` (`@magna-carta/tools/types`), `ToolPresentation` + `TOOL_PRESENTATION` + `TOOL_ICONS` + `SUBJECT_GROUP_LABELS` + `visibleToolGroups` (`$lib/tools/tool-presentation.ts`), `toolsView` + `setToolsView` (`$lib/tools/tools-view-preference.svelte.ts`), `MaturityBadge` (`$lib/maturity/maturity-badge.svelte`), design-system `Card` / `Button` / `Masthead`.
- Both components take the same props: `{ tool: ToolManifest; presentation: ToolPresentation; icon: Component }`.

- [ ] **Step 1: Create the tile component**

Create `apps/web/src/lib/tools/tool-tile.svelte`:

```svelte
<script lang="ts">
  /*
   * One tool as a card tile. A `ready` tool's whole tile links to its page; below `ready` the
   * tile is inert and quieter, its maturity badge carrying the "not yet" meaning — no disabled
   * styling that would read as broken. Every tool is `soon` until its page is built.
   */
  import type { Component } from "svelte";
  import type { ToolManifest } from "@magna-carta/tools/types";
  import * as Card from "@magna-carta/design-system/card";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import type { ToolPresentation } from "./tool-presentation.ts";

  let {
    tool,
    presentation,
    icon: Icon,
  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();

  const launchable = $derived(presentation.stage === "ready");
</script>

{#snippet body()}
  <Card.Root class="h-full">
    <div class="flex items-start justify-between gap-3">
      <span class="flex items-center gap-3">
        <Icon class="size-5 text-text-muted" aria-hidden="true" />
        <Card.Title>{tool.name}</Card.Title>
      </span>
      <MaturityBadge stage={presentation.stage} />
    </div>
    <Card.Description class="mt-2">{presentation.description}</Card.Description>
  </Card.Root>
{/snippet}

{#if launchable}
  <a href={`/tools/${tool.id}`} class="block h-full rounded-lg">{@render body()}</a>
{:else}
  <div class="h-full" aria-disabled="true">{@render body()}</div>
{/if}
```

- [ ] **Step 2: Create the row component**

Create `apps/web/src/lib/tools/tool-row.svelte`:

```svelte
<script lang="ts">
  /*
   * One tool as a dense list row — the same content and launchable rule as the tile, laid out
   * on a single line: leading icon, name, descriptor trailing muted, maturity badge at the end.
   */
  import type { Component } from "svelte";
  import type { ToolManifest } from "@magna-carta/tools/types";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import type { ToolPresentation } from "./tool-presentation.ts";

  let {
    tool,
    presentation,
    icon: Icon,
  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();

  const launchable = $derived(presentation.stage === "ready");
</script>

{#snippet body()}
  <div class="flex items-center gap-3 px-4 py-3">
    <Icon class="size-5 shrink-0 text-text-muted" aria-hidden="true" />
    <span class="font-medium">{tool.name}</span>
    <span class="truncate text-sm text-text-muted">{presentation.description}</span>
    <span class="ml-auto shrink-0"><MaturityBadge stage={presentation.stage} /></span>
  </div>
{/snippet}

{#if launchable}
  <a href={`/tools/${tool.id}`} class="block hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div aria-disabled="true">{@render body()}</div>
{/if}
```

- [ ] **Step 3: Create the page**

Create `apps/web/src/routes/(app)/tools/+page.svelte`:

```svelte
<script lang="ts">
  /*
   * Tools — the ethereal workbench's directory. Every tool the firm offers, grouped by subject,
   * shown as a card grid or a dense list (the toggle in the masthead, a persisted per-member
   * choice). Runs outside any matter: the standing line states it. Every entry is `soon` until
   * its own page is built — nothing here is faked.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Button from "@magna-carta/design-system/button";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import {
    SUBJECT_GROUP_LABELS,
    TOOL_ICONS,
    TOOL_PRESENTATION,
    visibleToolGroups,
  } from "$lib/tools/tool-presentation.ts";
  import { setToolsView, toolsView } from "$lib/tools/tools-view-preference.svelte.ts";
  import ToolTile from "$lib/tools/tool-tile.svelte";
  import ToolRow from "$lib/tools/tool-row.svelte";

  const groups = visibleToolGroups();
  const view = $derived(toolsView());
</script>

<svelte:head><title>Tools · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-12">
  <Masthead.Heading>
    <Masthead.Title>Tools</Masthead.Title>
    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <div class="flex items-center gap-1" role="group" aria-label="Choose a view">
      <Button
        variant={view === "tiles" ? "secondary" : "ghost"}
        aria-label="Tile view"
        aria-pressed={view === "tiles"}
        onclick={() => setToolsView("tiles")}
      >
        <LayoutGrid class="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant={view === "list" ? "secondary" : "ghost"}
        aria-label="List view"
        aria-pressed={view === "list"}
        onclick={() => setToolsView("list")}
      >
        <List class="size-4" aria-hidden="true" />
      </Button>
    </div>
  </Masthead.Actions>
</Masthead.Root>

{#each groups as { group, tools } (group)}
  <section class="mb-12">
    <h2 class="mb-4 text-sm font-medium text-text-muted" style="font-variant: small-caps">
      {SUBJECT_GROUP_LABELS[group]}
    </h2>
    {#if view === "tiles"}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each tools as tool (tool.id)}
          <ToolTile {tool} presentation={TOOL_PRESENTATION[tool.id]} icon={TOOL_ICONS[tool.icon]} />
        {/each}
      </div>
    {:else}
      <ul class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
        {#each tools as tool (tool.id)}
          <li><ToolRow {tool} presentation={TOOL_PRESENTATION[tool.id]} icon={TOOL_ICONS[tool.icon]} /></li>
        {/each}
      </ul>
    {/if}
  </section>
{/each}
```

- [ ] **Step 4: Flip the `tools` destination to shipped**

In `apps/web/src/lib/navigation/destinations.ts`, change the `tools` entry (around line 314) — set `shipped: true`, add `stage: "alpha"`, and remove the `announced: true` line (a shipped surface is no longer an announcement):

```ts
  {
    id: "tools",
    label: "Tools",
    href: "/tools",
    icon: Wrench,
    description: "Standalone utilities — inspect, verify, repair, and convert files.",
    group: "firm",
    shipped: true,
    stage: "alpha",
    defaultStarred: true,
  },
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm check`
Expected: PASS — no TypeScript, Svelte, lint, or process-ref errors. Fix any surfaced (e.g. an unused import) before proceeding.

- [ ] **Step 6: Confirm the data tests still pass**

Run: `pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts test/tools-view-preference.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tools/tool-tile.svelte apps/web/src/lib/tools/tool-row.svelte "apps/web/src/routes/(app)/tools/+page.svelte" apps/web/src/lib/navigation/destinations.ts
git commit -m "feat(tools): /tools listing page with tiles/list toggle"
```

- [ ] **Step 8: Browser verification**

Start the dev server and open `/tools` (use the `run` skill / claude-in-chrome). Confirm, capturing a screenshot of each view:

1. **Tiles view** renders every non-empty subject group (Property, Business Entities, People & Licenses, Mailing & Shipping, Web & Domains, Documents & Files, Diagnostics — "Printing" has no tools and is absent), each tile showing icon + name + descriptor + a "Soon" badge.
2. **List view** (toggle to List) renders the same groups as dense rows.
3. The toggle switches views, the active button reads pressed, and the choice **survives a page reload** (localStorage).
4. Nothing is launchable (every entry `soon`); no tile/row is a link yet.
5. The masthead shows "Tools" with the "Runs outside any matter" line.

Report screenshots to the owner for the tiles-vs-list decision.

---

## Self-Review

**Spec coverage:** Purpose (directory of all tools) → Tasks 1+3. Domain catalog untouched → confirmed (no `packages/tools` edits). Presentation app-side → Task 1. Maturity system → `MaturityBadge` in Task 3. Honest `soon` first state → all stages `soon` in Task 1. Permission gate via `toolsByGroup` → `visibleToolGroups` in Task 1. Two views + toggle → Tasks 2+3. Group labels / icon map → Task 1. Destination flip → Task 3 Step 4. Testing (completeness, grouping, preference parse, browser) → Tasks 1, 2, 3 Step 8. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code step shows complete content; the browser step lists concrete expected results.

**Type consistency:** `ToolsView`, `DEFAULT_VIEW`, `TOOLS_VIEW_STORAGE_KEY`, `parseToolsView` defined in Task 2's pure module and consumed unchanged by the store; `visibleToolGroups`/`TOOL_PRESENTATION`/`TOOL_ICONS`/`SUBJECT_GROUP_LABELS` defined in Task 1 and consumed by Task 3; both components share the `{ tool, presentation, icon }` prop shape. `toolsView`/`setToolsView` names match between store and page.
