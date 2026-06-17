# Tools catalog package (`@magna-carta/tools`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure `@magna-carta/tools` catalog — the single source of truth for the Tools area (`ToolManifest` + the catalog of existing tools + the `toolsByGroup`/`toolsFor` selectors) — fully headless and testable, ahead of the design-system shell that will render it.

**Architecture:** A new pure package (mirrors `@magna-carta/property-links`): types, a declarative catalog array, and two pure selector functions. It depends only on `@magna-carta/access-control` for the `Permission` type and validation; it imports no UI and no tool-logic package. Integration-backed tools store only an integration `category` string — this layer never touches the integration framework or credentials. A new `tools:` permission namespace is added to the access-control registry.

**Tech Stack:** TypeScript (strict, ESM, `.ts` extension imports), Vitest (node pool), Vite+ (`vp`) toolchain, pnpm workspace.

**Scope boundary:** This plan covers the pure package and its permission keys **only**. Out of scope (gated on the design-system shell, slice 0·7a): the Tools sidebar UI, the `id → Svelte component` map, the integration `Dispatch`/health branching, role-seeding the new permissions, and the worker-side "every integration category resolves in the registry" fitness. These are documented follow-ons in the design (`docs/specs/2026-06-16-tools-area-design.md`).

## Global Constraints

- **Pure package:** no D1, no Hono, no `env`, no Svelte, no network. (Spec §1.)
- **Full names, no shorthand:** package is `@magna-carta/tools`; spell names out in full (golden rule 12).
- **No process references in source:** source/tests/config carry no `ADR-NNNN`, no "spec", no "slice N" citations (golden rule 13). `CLAUDE.md` (a doc) may cite the spec/ADR, mirroring `packages/property-links/CLAUDE.md`.
- **Package layout** mirrors `packages/property-links`: `package.json` (`type: module`, `sideEffects: false`, subpath `exports`, `"test": "vp test run"`), `tsconfig.json` extends `../tsconfig/base.json`, `vitest.config.ts` pins `root`.
- **Permission keys** are `<namespace>:<action>` lowercase-led camelCase (access-control registry regex `^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$`).
- **Per-package tests:** `pnpm --filter <pkg> test` (runs that package's `vp test run`).
- **Catalog `permission` values** are constructed with `assertPermission(...)` so they carry the branded `Permission` type and fail loud at module load if unregistered.

---

### Task 1: Register the `tools:` permission namespace

Adds one block to the access-control permission registry. Independently testable against the access-control suite. The three `PERMISSIONS` cross-checks elsewhere (worker route conformance, database seed-migration fitness) are forward-only — they reject *seeded/route-bound* keys missing from the registry, never registered keys that are unseeded — so adding an unseeded namespace is safe.

**Files:**
- Modify: `packages/access-control/src/registry.ts` (insert the `tools:` block before the closing `] as const;`)
- Test: `packages/access-control/test/registry.test.ts` (add one `it`)

**Interfaces:**
- Produces: registry keys `tools:propertyListings`, `tools:propertyRecords`, `tools:businessLookup`, `tools:attorneyLicense`, `tools:shipping` — consumed by Task 2's catalog and Task 3's tests via `assertPermission`.

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the `describe("permission registry", …)` in `packages/access-control/test/registry.test.ts` (after the `files` namespace test):

```ts
  it("permissionsForNamespace('tools') returns exactly the tools keys, in registry order", () => {
    expect(permissionsForNamespace("tools")).toEqual([
      "tools:propertyListings",
      "tools:propertyRecords",
      "tools:businessLookup",
      "tools:attorneyLicense",
      "tools:shipping",
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: FAIL — `permissionsForNamespace('tools')` returns `[]` (keys not yet registered).

- [ ] **Step 3: Add the registry block**

In `packages/access-control/src/registry.ts`, insert immediately before the line `] as const;` (after the `files:manageDocumentTypes` entry):

```ts
  // Tools — the cross-cutting Tools area: general-purpose utilities surfaced in the sidebar and
  // contextually. One key per tool; gates visibility on both surfaces. Role-seeding lands with the
  // Tools UI shell.
  "tools:propertyListings", // external property-listing links (Zillow/Redfin/…)
  "tools:propertyRecords", // county assessor/recorder record links
  "tools:businessLookup", // Secretary-of-State business-entity lookup links
  "tools:attorneyLicense", // attorney-license lookup links
  "tools:shipping", // shipping & postage (the shipping integration)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS — including the new `tools` namespace test, the unchanged camelCase-shape test, and the no-duplicate-keys test.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git commit -m "feat(access-control): register the tools: permission namespace"
```

---

### Task 2: Scaffold `@magna-carta/tools` with types + catalog

Creates the package and delivers a tested catalog of the tools that exist today.

**Files:**
- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/vitest.config.ts`
- Create: `packages/tools/src/types.ts`
- Create: `packages/tools/src/catalog.ts`
- Test: `packages/tools/test/catalog.test.ts`

**Interfaces:**
- Consumes: `Permission`, `isPermission`, `assertPermission` from `@magna-carta/access-control/registry` (Task 1's keys).
- Produces:
  - `type SubjectGroup = "property" | "business-entities" | "people-licenses" | "mailing-shipping" | "printing" | "diagnostics"` and `const SUBJECT_GROUP_ORDER` (a `readonly` tuple in that order).
  - `type ContextTag = "address" | "person" | "company" | "matter" | "none"`.
  - `type ToolBacking = { kind: "library" } | { kind: "integration"; category: string }`.
  - `type MatterContext = "required" | "optional" | "none"`.
  - `interface ToolManifest { id: string; name: string; icon: string; subjectGroup: SubjectGroup; permission: Permission; contextTags: readonly ContextTag[]; backing: ToolBacking; matterContext: MatterContext }`.
  - `const CATALOG: readonly ToolManifest[]` — consumed by Task 3.

- [ ] **Step 1: Create the package manifest and config**

`packages/tools/package.json`:

```json
{
  "name": "@magna-carta/tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./catalog": "./src/catalog.ts",
    "./select": "./src/select.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/access-control": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/tools/tsconfig.json`:

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/tools/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 2: Link the new package into the workspace**

Run: `vp install`
Expected: completes; `@magna-carta/tools` resolves `@magna-carta/access-control` via `workspace:*`.

- [ ] **Step 3: Write the failing catalog test**

`packages/tools/test/catalog.test.ts`:

```ts
import { isPermission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";
import { SUBJECT_GROUP_ORDER } from "../src/types.ts";

describe("tool catalog", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every manifest is well-formed: name, known group, registered permission, >=1 context tag", () => {
    for (const tool of CATALOG) {
      expect(tool.name.length, tool.id).toBeGreaterThan(0);
      expect(SUBJECT_GROUP_ORDER, tool.id).toContain(tool.subjectGroup);
      expect(isPermission(tool.permission), tool.id).toBe(true);
      expect(tool.contextTags.length, tool.id).toBeGreaterThan(0);
    }
  });

  it("every integration-backed tool names a non-empty category", () => {
    for (const tool of CATALOG) {
      if (tool.backing.kind === "integration") {
        expect(tool.backing.category.length, tool.id).toBeGreaterThan(0);
      }
    }
  });

  it("includes the tools that exist today", () => {
    expect(CATALOG.map((tool) => tool.id)).toEqual([
      "property-listing-links",
      "county-property-records",
      "business-entity-lookup",
      "attorney-license-lookup",
      "shipping",
    ]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/tools test`
Expected: FAIL — cannot resolve `../src/catalog.ts` / `../src/types.ts` (not yet created).

- [ ] **Step 5: Write `src/types.ts`**

`packages/tools/src/types.ts`:

```ts
import type { Permission } from "@magna-carta/access-control/registry";

// One subject per group. This order is the fixed render order of the Tools sidebar.
export const SUBJECT_GROUP_ORDER = [
  "property",
  "business-entities",
  "people-licenses",
  "mailing-shipping",
  "printing",
  "diagnostics", // connectivity / system tests — no legal subject (e.g. a network speed test)
] as const;

export type SubjectGroup = (typeof SUBJECT_GROUP_ORDER)[number];

// What real-world input a tool acts on — drives contextual surfacing. `none` = general-only.
export type ContextTag = "address" | "person" | "company" | "matter" | "none";

// `library` = self-contained, no connection and no credential — a pure link generator OR an
// interactive client-side widget; the difference is purely UI, handled by the shell. `integration`
// names an integration category whose connection state the shell reflects; this package stores only
// the string and never touches the framework or credentials.
export type ToolBacking =
  | { readonly kind: "library" }
  | { readonly kind: "integration"; readonly category: string };

// Whether a tool's output/cost/audit attaches to a matter. A seam: the behaviour is decided per tool
// when its UI is built. Default "none".
export type MatterContext = "required" | "optional" | "none";

export interface ToolManifest {
  readonly id: string; // stable, kebab-case
  readonly name: string; // display label
  readonly icon: string; // Lucide icon name; the shell resolves it to a component
  readonly subjectGroup: SubjectGroup; // primary grouping in the sidebar
  readonly permission: Permission; // gates visibility on BOTH surfaces
  readonly contextTags: readonly ContextTag[]; // >=1; what the tool accepts
  readonly backing: ToolBacking;
  readonly matterContext: MatterContext;
}
```

- [ ] **Step 6: Write `src/catalog.ts`**

`packages/tools/src/catalog.ts`:

```ts
import { assertPermission } from "@magna-carta/access-control/registry";
import type { ToolManifest } from "./types.ts";

// The single source of truth for the Tools area. The sidebar renders this grouped by subject;
// contextual surfaces query it by context tag. Adding a tool is one row here (and, for the UI, one
// id->component mapping in the shell). Each permission is validated at module load — an unregistered
// key fails loud here rather than rendering a tool no one can be granted.
export const CATALOG: readonly ToolManifest[] = [
  {
    id: "property-listing-links",
    name: "Property Listing Links",
    icon: "house",
    subjectGroup: "property",
    permission: assertPermission("tools:propertyListings"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "county-property-records",
    name: "County Property Records",
    icon: "landmark",
    subjectGroup: "property",
    permission: assertPermission("tools:propertyRecords"),
    contextTags: ["address"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "business-entity-lookup",
    name: "Business Entity Lookup",
    icon: "building-2",
    subjectGroup: "business-entities",
    permission: assertPermission("tools:businessLookup"),
    contextTags: ["company"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "attorney-license-lookup",
    name: "Attorney License Lookup",
    icon: "badge-check",
    subjectGroup: "people-licenses",
    permission: assertPermission("tools:attorneyLicense"),
    contextTags: ["person"],
    backing: { kind: "library" },
    matterContext: "none",
  },
  {
    id: "shipping",
    name: "Shipping & Postage",
    icon: "package",
    subjectGroup: "mailing-shipping",
    permission: assertPermission("tools:shipping"),
    contextTags: ["address"],
    backing: { kind: "integration", category: "shipping" },
    matterContext: "none",
  },
];
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — all four catalog tests.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/package.json packages/tools/tsconfig.json packages/tools/vitest.config.ts packages/tools/src/types.ts packages/tools/src/catalog.ts packages/tools/test/catalog.test.ts pnpm-lock.yaml
git commit -m "feat(tools): scaffold @magna-carta/tools with the manifest types and catalog"
```

---

### Task 3: The selectors (`toolsByGroup`, `toolsFor`)

The two pure queries that feed the general (sidebar) and contextual surfaces.

**Files:**
- Create: `packages/tools/src/select.ts`
- Test: `packages/tools/test/select.test.ts`

**Interfaces:**
- Consumes: `ToolManifest`, `SubjectGroup`, `ContextTag`, `SUBJECT_GROUP_ORDER` (Task 2); `Permission`, `assertPermission` (Task 1).
- Produces:
  - `interface GroupedTools { readonly group: SubjectGroup; readonly tools: ToolManifest[] }`.
  - `toolsByGroup(catalog: readonly ToolManifest[], permissions: ReadonlySet<Permission>): GroupedTools[]` — groups in fixed order, empty groups omitted, tools in catalog order.
  - `toolsFor(catalog: readonly ToolManifest[], tag: ContextTag, permissions: ReadonlySet<Permission>): ToolManifest[]` — permitted tools accepting `tag`, in catalog order.

- [ ] **Step 1: Write the failing test**

`packages/tools/test/select.test.ts`:

```ts
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { describe, expect, it } from "vitest";
import { toolsByGroup, toolsFor } from "../src/select.ts";
import type { ToolManifest } from "../src/types.ts";

function makeTool(
  over: Partial<ToolManifest> & Pick<ToolManifest, "id" | "permission">,
): ToolManifest {
  return {
    id: over.id,
    name: over.name ?? over.id,
    icon: over.icon ?? "circle",
    subjectGroup: over.subjectGroup ?? "property",
    permission: over.permission,
    contextTags: over.contextTags ?? ["none"],
    backing: over.backing ?? { kind: "library" },
    matterContext: over.matterContext ?? "none",
  };
}

const propertyListings = assertPermission("tools:propertyListings");
const businessLookup = assertPermission("tools:businessLookup");
const shipping = assertPermission("tools:shipping");

const catalog: ToolManifest[] = [
  makeTool({ id: "a", permission: propertyListings, subjectGroup: "property", contextTags: ["address"] }),
  makeTool({ id: "b", permission: businessLookup, subjectGroup: "business-entities", contextTags: ["company"] }),
  makeTool({ id: "c", permission: shipping, subjectGroup: "mailing-shipping", contextTags: ["address"] }),
];

const allPermissions = new Set<Permission>([propertyListings, businessLookup, shipping]);

describe("toolsByGroup", () => {
  it("groups permitted tools in fixed subject order, omitting empty groups", () => {
    const grouped = toolsByGroup(catalog, allPermissions);
    expect(grouped.map((entry) => entry.group)).toEqual([
      "property",
      "business-entities",
      "mailing-shipping",
    ]);
    expect(grouped[0].tools.map((tool) => tool.id)).toEqual(["a"]);
  });

  it("hides tools the principal lacks permission for, and drops a group that empties", () => {
    const grouped = toolsByGroup(catalog, new Set<Permission>([businessLookup]));
    expect(grouped.map((entry) => entry.group)).toEqual(["business-entities"]);
  });

  it("returns [] when the principal holds nothing", () => {
    expect(toolsByGroup(catalog, new Set<Permission>())).toEqual([]);
  });
});

describe("toolsFor", () => {
  it("returns permitted tools accepting the tag, in catalog order", () => {
    expect(toolsFor(catalog, "address", allPermissions).map((tool) => tool.id)).toEqual(["a", "c"]);
  });

  it("excludes tools the principal cannot access", () => {
    expect(toolsFor(catalog, "address", new Set<Permission>([propertyListings])).map((tool) => tool.id)).toEqual([
      "a",
    ]);
  });

  it("returns [] when nothing matches the tag", () => {
    expect(toolsFor(catalog, "person", allPermissions)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/tools test`
Expected: FAIL — cannot resolve `../src/select.ts`.

- [ ] **Step 3: Write `src/select.ts`**

`packages/tools/src/select.ts`:

```ts
import type { Permission } from "@magna-carta/access-control/registry";
import { SUBJECT_GROUP_ORDER, type ContextTag, type SubjectGroup, type ToolManifest } from "./types.ts";

export interface GroupedTools {
  readonly group: SubjectGroup;
  readonly tools: ToolManifest[];
}

// A tool is visible iff the principal holds its permission. Both surfaces share this gate.
function permitted(tool: ToolManifest, permissions: ReadonlySet<Permission>): boolean {
  return permissions.has(tool.permission);
}

// The general (sidebar) surface: permitted tools grouped by subject, groups in the fixed order,
// empty groups omitted, tools in catalog order within a group.
export function toolsByGroup(
  catalog: readonly ToolManifest[],
  permissions: ReadonlySet<Permission>,
): GroupedTools[] {
  const grouped: GroupedTools[] = [];
  for (const group of SUBJECT_GROUP_ORDER) {
    const tools = catalog.filter(
      (tool) => tool.subjectGroup === group && permitted(tool, permissions),
    );
    if (tools.length > 0) grouped.push({ group, tools });
  }
  return grouped;
}

// The contextual surface: permitted tools that accept `tag`, in catalog order. A Location page calls
// toolsFor("address"); a Directory person calls toolsFor("person"); a new matching tool added to the
// catalog appears there with no change to the calling page.
export function toolsFor(
  catalog: readonly ToolManifest[],
  tag: ContextTag,
  permissions: ReadonlySet<Permission>,
): ToolManifest[] {
  return catalog.filter((tool) => tool.contextTags.includes(tag) && permitted(tool, permissions));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — all `toolsByGroup` and `toolsFor` tests, plus the Task 2 catalog tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/select.ts packages/tools/test/select.test.ts
git commit -m "feat(tools): add the toolsByGroup and toolsFor selectors"
```

---

### Task 4: Purity fitness function + local notes + quality gate

A source-scan guard that the catalog stays a pure presentation layer (no UI, no tool-logic package), the package's `CLAUDE.md`, and the full repo quality gate.

**Files:**
- Test: `packages/tools/test/purity.test.ts`
- Create: `packages/tools/CLAUDE.md`

**Interfaces:**
- Consumes: the `src/` files from Tasks 2–3 (read from disk, not imported).

- [ ] **Step 1: Write the fitness test**

`packages/tools/test/purity.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDir = join(import.meta.dirname, "..", "src");
const importPattern = /import[^"']*["']([^"']+)["']/g;
const allowedPackage = "@magna-carta/access-control/registry";

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) specifiers.push(match[1]);
  return specifiers;
}

// The catalog is a presentation/IA layer above the tool packages, never below them: it must not
// import a tool-logic package (property-links, government-links, shipping) or any UI. Keeping it pure
// is what lets both surfaces read it without dragging credentials or vendor code into the catalog.
describe("the tools catalog stays a pure presentation layer (fitness)", () => {
  it("imports only relative modules and the access-control registry", () => {
    for (const name of readdirSync(sourceDir)) {
      if (!name.endsWith(".ts")) continue;
      for (const specifier of importSpecifiers(join(sourceDir, name))) {
        const allowed =
          specifier.startsWith("./") ||
          specifier.startsWith("../") ||
          specifier === allowedPackage;
        expect(allowed, `${name} imports ${specifier}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — `src/types.ts`, `src/catalog.ts`, `src/select.ts` import only relative modules and `@magna-carta/access-control/registry`. (If it fails, an `src/` file imports something it must not — fix the import, do not relax the test.)

- [ ] **Step 3: Write `CLAUDE.md`**

`packages/tools/CLAUDE.md`:

```markdown
# @magna-carta/tools — local notes

Pure presentation/IA layer for the Tools area — the single catalog feeding both the Tools sidebar
and contextual entry points. No D1, no Hono, no `env`, no Svelte, no network. Depends only on
`@magna-carta/access-control` (the `Permission` type + validation).

- A `ToolManifest` is `{ id, name, icon, subjectGroup, permission, contextTags, backing, matterContext }`.
  Adding a tool is one row in `src/catalog.ts` (and, for the UI, one id->component mapping in the shell).
- `backing: "library"` = self-contained (a link generator OR an interactive widget) — no connection.
  `backing: { kind: "integration", category }` stores only the category string; the shell reflects that
  integration's connection state. This layer never touches the integration framework or credentials.
- `toolsByGroup` feeds the sidebar (grouped by subject, fixed order, empty groups omitted);
  `toolsFor(tag)` feeds contextual surfaces (e.g. a Location calls `toolsFor("address")`). Both gate on
  the principal's permission set.
- The fitness test (`test/purity.test.ts`) forbids importing any tool-logic package or UI — keep the
  catalog above the tools, never below them.

Seams (see `docs/specs/2026-06-16-tools-area-design.md`, ADR-0097): the sidebar/contextual UI + the
id->component map + the integration Dispatch/health branching land with the design-system shell; role-
seeding the `tools:` permissions and the "every integration category resolves" fitness are worker-side
follow-ons. Future catalog rows: an Avery template printer (printing) and a network speed test
(diagnostics), added when those tools are built.
```

- [ ] **Step 4: Run the full quality gate**

Run: `pnpm check`
Expected: PASS (fmt + lint + typecheck across the repo, including the new package). If the formatter reports diffs, apply the toolchain's formatting and re-run until clean.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/test/purity.test.ts packages/tools/CLAUDE.md
git commit -m "test(tools): add the catalog-purity fitness function and local notes"
```

---

### Task 5: Record the decision and update living docs

Golden rule 5 (docs in the same change) and golden rule 8 (decisions as ADRs). This records ADR-0097 and adds the execution-tracking rows for the pure-package portion.

**Files:**
- Modify: `docs/Decision-Log.md` (add ADR-0097)
- Modify: `ROADMAP.md` (a Cross-cutting row)
- Modify: `STATUS.md` (a stage row)
- Modify: `CHANGELOG.md` (an entry)

- [ ] **Step 1: Add ADR-0097 to the Decision Log**

In `docs/Decision-Log.md`, add an entry following the existing ADR format:

> **ADR-0097** · Accepted · 2026-06-16 · Tools area — **a presentation/IA catalog above the integration framework.** A top-level Tools area surfaces first-party utilities both generally (a sidebar grouped by subject) and contextually (queried by context tag), from one pure `@magna-carta/tools` catalog. **Decision:** the Tools layer is a thin presentation layer *above* the existing packages, not part of the integration framework — `library`-backed tools (link generators and interactive widgets) are self-contained; `integration`-backed tools reference an integration `category` and reflect its `Dispatch`/health, while the Tools layer itself never touches credentials. Honors the framework's "pure utilities are libraries, not plugins" boundary. **Consequences:** the pure package (types + catalog + selectors + the `tools:` permission namespace) builds independently of the UI; the sidebar/contextual rendering, the id->component map, the integration health branching, and role-seeding land with the design-system shell. Concretizes ADR-0015 on the presentation side; builds on ADR-0091/0092 (integration port system) and ADR-0068 (access control). Spec: `docs/specs/2026-06-16-tools-area-design.md`.

- [ ] **Step 2: Add the ROADMAP row**

In `ROADMAP.md`, under **Cross-cutting — phase-independent**, add a row noting: the Tools area design (ADR-0097), the pure `@magna-carta/tools` catalog built (types + catalog + selectors + the `tools:` namespace), with the sidebar/contextual UI gated on the design-system shell (slice 0·7a).

- [ ] **Step 3: Add the STATUS row**

In `STATUS.md`, add a row for the Tools area: spec ✓, plan ✓, pure package built ✓ / tested ✓; UI pending 0·7a.

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, add an entry under the appropriate heading: `@magna-carta/tools` pure catalog (manifest types, the catalog of existing tools, `toolsByGroup`/`toolsFor` selectors, the catalog-purity fitness) + the `tools:` permission namespace.

- [ ] **Step 5: Commit**

```bash
git add docs/Decision-Log.md ROADMAP.md STATUS.md CHANGELOG.md
git commit -m "docs(tools): record ADR-0097 and update roadmap/status/changelog"
```

---

## Self-Review

**1. Spec coverage** (against `docs/specs/2026-06-16-tools-area-design.md`):
- §1 module placement (pure `@magna-carta/tools`, files `types`/`catalog`/`select`, depends only on access-control) → Task 2/3.
- §2 the `ToolManifest` shape (all fields incl. `backing`, `contextTags`, `matterContext` seam) → Task 2.
- §3 the two surfaces' selector behavior (grouped fixed-order/omit-empty; context-tag filter; permission gate) → Task 3.
- §4 the pure selectors → Task 3.
- §5 integration boundary (library vs integration; category-string only) → Task 2 catalog + §8 purity fitness Task 4.
- §6 seams (matter attachment as a field; connection-management/UI deferred) → represented as fields/notes; UI explicitly out of scope.
- §7 build sequencing (pure package now, manifests for existing tools) → whole plan.
- §8 testing & fitness: catalog well-formedness + unique ids + integration category non-empty (Task 2); selector tests (Task 3); import-purity fitness (Task 4). The "every integration category resolves in the registry" fitness is worker-side and explicitly deferred (scope boundary).
- §9 docs (ADR-0097, ROADMAP/STATUS/CHANGELOG) → Task 5.
- New permission keys (needed for §2's `permission` field) → Task 1.

**2. Placeholder scan:** no TBD/TODO; every code step shows complete code; every command shows expected output. Clean.

**3. Type consistency:** `ToolManifest`/`SubjectGroup`/`ContextTag`/`ToolBacking`/`MatterContext`/`SUBJECT_GROUP_ORDER` are defined in Task 2 and used verbatim in Task 3; `GroupedTools`, `toolsByGroup`, `toolsFor` signatures match between the interface block, the test, and the implementation; `permission` is `Permission` everywhere and always built via `assertPermission`; the five registry keys in Task 1 match the five `assertPermission(...)` calls in Task 2's catalog and the namespace test. Consistent.
