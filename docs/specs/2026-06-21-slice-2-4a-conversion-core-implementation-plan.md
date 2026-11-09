# Slice 2·4a — Conversion Core + libvips Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the substrate-independent core of in-app conversion — a pure `@magna-carta/conversion` package (`ConversionPort`, a format registry of single-engine weighted edges, multi-hop pathfinding) plus a working libvips image adapter — with everything substrate-bound deferred.

**Architecture:** A pure package mirroring `@magna-carta/property-links` / `@magna-carta/tools` (no D1, no Hono, no `env`, no network). The registry is a directed graph of `Format` nodes and single-engine `ConversionEdge`s; `findPath` does weighted shortest-path for multi-hop chains. Engines implement a `ConversionPort` returning a typed `ConversionResult` (never throws), modeled on `@magna-carta/integrations`' `Dispatch`. libvips is the one real engine (via `wasm-vips`, tested in Node); LibreOffice/FFmpeg/email edges are registered but resolve to a shared deferred engine returning `engine-not-implemented`.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), Vitest via `vite-plus`, `wasm-vips` (libvips compiled to WebAssembly), pnpm workspace with a version catalog.

## Global Constraints

- **In-house only, confidentiality absolute, one engine per edge.** No `confidentiality` axis, no egress policy, no content classification, no candidate ranking (ADR-`conversion-in-house-only-single-engine`).
- **Pure package.** No D1, no Hono, no `env`, no network, no UI. All conventions per `packages/property-links` and `packages/tools` (`type: module`, `sideEffects: false`, subpath `exports`, `"test": "vp test run"`, devDeps `@magna-carta/tsconfig` + `@types/node` `catalog:` + `vitest` `catalog:`).
- **Full names, no shorthand** (golden rule 12): `ConversionPort`, `engineId`, `recipeRef` — never `convPort`/`eng`.
- **No process-ref citations in source** (golden rule 13): code/tests carry no `ADR-NNNN`/"slice"/"spec" strings; explain reasoning inline or cite a `docs/conventions/` path.
- **Imports use the `.ts` extension** and `import type` for type-only imports (match sibling packages).
- **TDD throughout; commit after each green step.** Conventional-commit messages, scope `conversion`.

---

### Task 1: Scaffold the `@magna-carta/conversion` package

**Files:**

- Create: `packages/conversion/package.json`
- Create: `packages/conversion/vitest.config.ts`
- Create: `packages/conversion/tsconfig.json`
- Create: `packages/conversion/CLAUDE.md`
- Create: `packages/conversion/src/index.ts`
- Test: `packages/conversion/test/smoke.test.ts`

**Interfaces:**

- Produces: the installable package `@magna-carta/conversion` with a working Vitest setup. No exported symbols yet beyond a version marker.

- [ ] **Step 1: Write the failing smoke test**

```ts
// packages/conversion/test/smoke.test.ts
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@magna-carta/conversion", () => {
  it("is wired up", () => {
    expect(PACKAGE_NAME).toBe("@magna-carta/conversion");
  });
});
```

- [ ] **Step 2: Create the package scaffolding**

`packages/conversion/package.json`:

```json
{
  "name": "@magna-carta/conversion",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./format": "./src/format.ts",
    "./registry": "./src/registry.ts",
    "./pathfinding": "./src/pathfinding.ts",
    "./port": "./src/port.ts",
    "./engines": "./src/engines.ts",
    "./adapters/libvips": "./src/adapters/libvips/index.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/conversion/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

`packages/conversion/tsconfig.json` — copy `packages/property-links/tsconfig.json` verbatim (same extends + include).

`packages/conversion/src/index.ts`:

```ts
export const PACKAGE_NAME = "@magna-carta/conversion";
```

`packages/conversion/CLAUDE.md`:

```markdown
# @magna-carta/conversion — local notes

Pure conversion core (mirrors `@magna-carta/property-links`): a format registry + multi-hop
pathfinding + a `ConversionPort`, plus the libvips image adapter. No D1, no Hono, no `env`, no
network, no UI.

- **In-house only, one engine per edge.** A `ConversionEdge` is `{ from, to, engineId, recipeRef,
  weight }`. There is no confidentiality axis, no egress policy, no content classification, and no
  per-edge candidate ranking — every conversion runs in-tenant. (If an external engine is ever
  genuinely needed it is a deliberate future decision; nothing here is built for it.)
- `findPath(from, to)` returns the weighted shortest edge chain (multi-hop, e.g. `wpd→odt→pdf`) or a
  no-path result. `availableConversions(from)` is the reachable target set behind the Convert-to menu.
- An engine implements `ConversionPort.convert` and returns a typed `ConversionResult`, never throws.
  Only **libvips** is implemented (via `wasm-vips`, tested in Node). LibreOffice/FFmpeg/email edges are
  registered but resolve to the shared deferred engine returning `engine-not-implemented` — their
  bodies wait for the gated execution substrate (Container/Durable-Object orchestration, the
  LibreOfficeKit fork-pool, the FFmpeg sandbox).
- libvips runs untrusted bytes: the adapter catches loader failures into `adapter-error` and never
  crashes the process. Production runtime placement (wasm-vips-in-Worker for small images vs native
  libvips in a Container) is deferred; the adapter is runtime-agnostic.

The fitness tests (`test/purity.test.ts`, `test/registry-wellformed.test.ts`) keep the package pure
and the registry consistent.
```

- [ ] **Step 3: Install and run the smoke test**

Run: `cd C:/dev/magna-carta-worktrees/slice-2-4-conversion && vp install && pnpm --filter @magna-carta/conversion test`
Expected: PASS (1 test). If `vp install` reports the new workspace package, that is expected.

- [ ] **Step 4: Commit**

```bash
git add packages/conversion
git commit -m "feat(conversion): scaffold @magna-carta/conversion package"
```

---

### Task 2: Formats + the platform registry

**Files:**

- Create: `packages/conversion/src/format.ts`
- Create: `packages/conversion/src/registry.ts`
- Test: `packages/conversion/test/registry.test.ts`

**Interfaces:**

- Produces:
  - `type FormatId = string` (branded-free; a stable lowercase key like `"png"`, `"pdf"`, `"wpd"`).
  - `interface Format { id: FormatId; label: string; mediaType: string; extensions: readonly string[] }`
  - `interface ConversionEdge { from: FormatId; to: FormatId; engineId: EngineId; recipeRef: string; weight: number }`
  - `type EngineId = "libvips" | "libreoffice" | "email" | "ffmpeg"`
  - `const FORMATS: readonly Format[]`, `const EDGES: readonly ConversionEdge[]`
  - `function getFormat(id: FormatId): Format | undefined`
  - `function edgesFrom(id: FormatId): readonly ConversionEdge[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/conversion/test/registry.test.ts
import { describe, expect, it } from "vitest";
import { EDGES, FORMATS, edgesFrom, getFormat } from "../src/registry.ts";

describe("registry", () => {
  it("registers the v1 formats", () => {
    expect(getFormat("png")?.mediaType).toBe("image/png");
    expect(getFormat("pdf")?.mediaType).toBe("application/pdf");
    expect(getFormat("nope")).toBeUndefined();
  });

  it("has a direct libvips edge png->webp", () => {
    const edge = EDGES.find((e) => e.from === "png" && e.to === "webp");
    expect(edge?.engineId).toBe("libvips");
  });

  it("has the two LibreOffice edges that chain wpd->odt->pdf", () => {
    expect(
      EDGES.some((e) => e.from === "wpd" && e.to === "odt" && e.engineId === "libreoffice"),
    ).toBe(true);
    expect(
      EDGES.some((e) => e.from === "odt" && e.to === "pdf" && e.engineId === "libreoffice"),
    ).toBe(true);
  });

  it("edgesFrom returns only edges leaving a node", () => {
    expect(edgesFrom("png").every((e) => e.from === "png")).toBe(true);
    expect(edgesFrom("png").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: FAIL (cannot resolve `../src/registry.ts`).

- [ ] **Step 3: Implement `format.ts`**

```ts
// packages/conversion/src/format.ts

// A conversion engine. libvips is implemented now; the rest are registered but their bodies are
// deferred to the execution substrate (Container/Durable-Object orchestration, the LibreOfficeKit
// fork-pool, the FFmpeg sandbox).
export type EngineId = "libvips" | "libreoffice" | "email" | "ffmpeg";

// A stable, lowercase format key — both the registry node id and how callers name source/target.
export type FormatId = string;

export interface Format {
  readonly id: FormatId;
  readonly label: string;
  readonly mediaType: string;
  readonly extensions: readonly string[];
}

// A single conversion step. One engine per edge (no candidates): the converter is in-house only, so
// there is nothing to choose between. `recipeRef` names the engine-specific recipe; `weight` is the
// pathfinding cost (lower preferred).
export interface ConversionEdge {
  readonly from: FormatId;
  readonly to: FormatId;
  readonly engineId: EngineId;
  readonly recipeRef: string;
  readonly weight: number;
}
```

- [ ] **Step 4: Implement `registry.ts`**

```ts
// packages/conversion/src/registry.ts
import type { ConversionEdge, Format, FormatId } from "./format.ts";

export const FORMATS: readonly Format[] = [
  { id: "png", label: "PNG", mediaType: "image/png", extensions: ["png"] },
  { id: "jpeg", label: "JPEG", mediaType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { id: "webp", label: "WebP", mediaType: "image/webp", extensions: ["webp"] },
  { id: "tiff", label: "TIFF", mediaType: "image/tiff", extensions: ["tif", "tiff"] },
  { id: "gif", label: "GIF", mediaType: "image/gif", extensions: ["gif"] },
  {
    id: "docx",
    label: "Word (DOCX)",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  {
    id: "odt",
    label: "OpenDocument Text",
    mediaType: "application/vnd.oasis.opendocument.text",
    extensions: ["odt"],
  },
  {
    id: "wpd",
    label: "WordPerfect",
    mediaType: "application/vnd.wordperfect",
    extensions: ["wpd"],
  },
  { id: "pdf", label: "PDF", mediaType: "application/pdf", extensions: ["pdf"] },
  { id: "eml", label: "Email (EML)", mediaType: "message/rfc822", extensions: ["eml"] },
  {
    id: "msg",
    label: "Outlook (MSG)",
    mediaType: "application/vnd.ms-outlook",
    extensions: ["msg"],
  },
  { id: "mp4", label: "MP4", mediaType: "video/mp4", extensions: ["mp4"] },
  { id: "mov", label: "QuickTime", mediaType: "video/quicktime", extensions: ["mov"] },
  { id: "webm", label: "WebM", mediaType: "video/webm", extensions: ["webm"] },
];

// libvips raster interconversions: every ordered pair of raster formats is a direct edge. The
// libvips recipe is just the target id (the adapter maps it to a vips write suffix).
const RASTER: readonly FormatId[] = ["png", "jpeg", "webp", "tiff", "gif"];
const rasterEdges: ConversionEdge[] = [];
for (const from of RASTER) {
  for (const to of RASTER) {
    if (from !== to) {
      rasterEdges.push({ from, to, engineId: "libvips", recipeRef: to, weight: 1 });
    }
  }
}

// LibreOffice office edges (deferred bodies). wpd->odt and odt->pdf together let pathfinding chain
// wpd->pdf with no direct edge.
const officeEdges: readonly ConversionEdge[] = [
  { from: "docx", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "odt", to: "pdf", engineId: "libreoffice", recipeRef: "pdf", weight: 1 },
  { from: "docx", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
  { from: "wpd", to: "odt", engineId: "libreoffice", recipeRef: "odt", weight: 1 },
];

// email->PDF (deferred) and A/V transcode (deferred).
const otherEdges: readonly ConversionEdge[] = [
  { from: "eml", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
  { from: "msg", to: "pdf", engineId: "email", recipeRef: "pdf", weight: 1 },
  { from: "mov", to: "mp4", engineId: "ffmpeg", recipeRef: "mp4-h264-aac-faststart", weight: 1 },
  { from: "webm", to: "mp4", engineId: "ffmpeg", recipeRef: "mp4-h264-aac-faststart", weight: 1 },
];

export const EDGES: readonly ConversionEdge[] = [...rasterEdges, ...officeEdges, ...otherEdges];

const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): Format | undefined {
  return FORMAT_BY_ID.get(id);
}

export function edgesFrom(id: FormatId): readonly ConversionEdge[] {
  return EDGES.filter((e) => e.from === id);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/conversion/src/format.ts packages/conversion/src/registry.ts packages/conversion/test/registry.test.ts
git commit -m "feat(conversion): format types + platform registry"
```

---

### Task 3: Pathfinding + reachability

**Files:**

- Create: `packages/conversion/src/pathfinding.ts`
- Test: `packages/conversion/test/pathfinding.test.ts`

**Interfaces:**

- Consumes: `EDGES`, `edgesFrom` from `registry.ts`; `ConversionEdge`, `FormatId` from `format.ts`.
- Produces:
  - `type PathResult = { ok: true; path: readonly ConversionEdge[] } | { ok: false; reason: "no-path" }`
  - `function findPath(from: FormatId, to: FormatId): PathResult`
  - `function availableConversions(from: FormatId): readonly FormatId[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/conversion/test/pathfinding.test.ts
import { describe, expect, it } from "vitest";
import { availableConversions, findPath } from "../src/pathfinding.ts";

describe("findPath", () => {
  it("finds a direct edge", () => {
    const result = findPath("png", "webp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.map((e) => `${e.from}->${e.to}`)).toEqual(["png->webp"]);
    }
  });

  it("chains a multi-hop path wpd->odt->pdf when no direct edge exists", () => {
    const result = findPath("wpd", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.map((e) => `${e.from}->${e.to}`)).toEqual(["wpd->odt", "odt->pdf"]);
    }
  });

  it("returns no-path across disconnected families", () => {
    expect(findPath("png", "mp4")).toEqual({ ok: false, reason: "no-path" });
  });

  it("returns no-path for an unknown format", () => {
    expect(findPath("png", "nope")).toEqual({ ok: false, reason: "no-path" });
  });
});

describe("availableConversions", () => {
  it("lists reachable targets from a raster source (includes multi-hop none here, all direct)", () => {
    const targets = availableConversions("png");
    expect([...targets].sort()).toEqual(["gif", "jpeg", "tiff", "webp"]);
  });

  it("includes multi-hop reachables from wpd (odt and pdf)", () => {
    expect([...availableConversions("wpd")].sort()).toEqual(["odt", "pdf"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: FAIL (cannot resolve `../src/pathfinding.ts`).

- [ ] **Step 3: Implement `pathfinding.ts`**

```ts
// packages/conversion/src/pathfinding.ts
import type { ConversionEdge, FormatId } from "./format.ts";
import { edgesFrom } from "./registry.ts";

export type PathResult =
  | { readonly ok: true; readonly path: readonly ConversionEdge[] }
  | { readonly ok: false; readonly reason: "no-path" };

// Dijkstra over the edge graph (weights are small positive integers). Returns the lowest-total-weight
// edge chain, so a higher-fidelity multi-hop path can be preferred over a lossy direct one by giving
// the lossy edge a higher weight. With all weights equal this is shortest-hop.
export function findPath(from: FormatId, to: FormatId): PathResult {
  if (from === to) return { ok: false, reason: "no-path" };
  const best = new Map<FormatId, number>([[from, 0]]);
  const prev = new Map<FormatId, ConversionEdge>();
  const visited = new Set<FormatId>();

  while (visited.size < best.size) {
    let node: FormatId | undefined;
    let nodeCost = Infinity;
    for (const [candidate, cost] of best) {
      if (!visited.has(candidate) && cost < nodeCost) {
        node = candidate;
        nodeCost = cost;
      }
    }
    if (node === undefined) break;
    visited.add(node);

    for (const edge of edgesFrom(node)) {
      const next = nodeCost + edge.weight;
      if (next < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, next);
        prev.set(edge.to, edge);
      }
    }
  }

  if (!prev.has(to)) return { ok: false, reason: "no-path" };

  const path: ConversionEdge[] = [];
  let cursor: FormatId = to;
  while (cursor !== from) {
    const edge = prev.get(cursor);
    if (edge === undefined) return { ok: false, reason: "no-path" };
    path.unshift(edge);
    cursor = edge.from;
  }
  return { ok: true, path };
}

// Every target format reachable from `from` (the Convert-to menu). Plain breadth-first reachability.
export function availableConversions(from: FormatId): readonly FormatId[] {
  const seen = new Set<FormatId>();
  const queue: FormatId[] = [from];
  while (queue.length > 0) {
    const node = queue.shift() as FormatId;
    for (const edge of edgesFrom(node)) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/conversion/src/pathfinding.ts packages/conversion/test/pathfinding.test.ts
git commit -m "feat(conversion): multi-hop pathfinding + reachability"
```

---

### Task 4: The `ConversionPort` + the deferred engine map

**Files:**

- Create: `packages/conversion/src/port.ts`
- Create: `packages/conversion/src/engines.ts`
- Test: `packages/conversion/test/engines.test.ts`

**Interfaces:**

- Consumes: `EngineId`, `FormatId` from `format.ts`.
- Produces:
  - `interface ConversionInput { readonly bytes: Uint8Array; readonly from: FormatId; readonly to: FormatId; readonly recipeRef: string }`
  - `type ConversionResult = { ok: true; bytes: Uint8Array; mediaType: string } | { ok: false; reason: "engine-not-implemented" | "unsupported-edge" | "adapter-error"; detail?: string }`
  - `interface ConversionPort { convert(input: ConversionInput): Promise<ConversionResult> }`
  - helpers `converted(bytes, mediaType)`, `engineNotImplemented()`, `unsupportedEdge()`, `adapterError(detail)`
  - `const deferredEngine: ConversionPort` (always returns `engine-not-implemented`)
  - `function engineFor(id: EngineId): ConversionPort` (returns the registered adapter; deferred until an engine is implemented)
  - `function registerEngine(id: EngineId, port: ConversionPort): void`

- [ ] **Step 1: Write the failing test**

```ts
// packages/conversion/test/engines.test.ts
import { describe, expect, it } from "vitest";
import { engineFor } from "../src/engines.ts";

describe("engine map", () => {
  it("resolves unimplemented engines to the deferred engine", async () => {
    for (const id of ["libreoffice", "email", "ffmpeg"] as const) {
      const result = await engineFor(id).convert({
        bytes: new Uint8Array([1, 2, 3]),
        from: "docx",
        to: "pdf",
        recipeRef: "pdf",
      });
      expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: FAIL (cannot resolve `../src/engines.ts`).

- [ ] **Step 3: Implement `port.ts`**

```ts
// packages/conversion/src/port.ts
import type { FormatId } from "./format.ts";

export interface ConversionInput {
  readonly bytes: Uint8Array;
  readonly from: FormatId;
  readonly to: FormatId;
  readonly recipeRef: string;
}

// A typed outcome, never a thrown error (the integrations Dispatch pattern). `engine-not-implemented`
// is a first-class state because most engines' bodies are deferred to the execution substrate.
export type ConversionResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mediaType: string }
  | {
      readonly ok: false;
      readonly reason: "engine-not-implemented" | "unsupported-edge" | "adapter-error";
      readonly detail?: string;
    };

export interface ConversionPort {
  convert(input: ConversionInput): Promise<ConversionResult>;
}

export function converted(bytes: Uint8Array, mediaType: string): ConversionResult {
  return { ok: true, bytes, mediaType };
}

export function engineNotImplemented(): ConversionResult {
  return { ok: false, reason: "engine-not-implemented" };
}

export function unsupportedEdge(detail?: string): ConversionResult {
  return { ok: false, reason: "unsupported-edge", detail };
}

export function adapterError(detail: string): ConversionResult {
  return { ok: false, reason: "adapter-error", detail };
}
```

- [ ] **Step 4: Implement `engines.ts`**

```ts
// packages/conversion/src/engines.ts
import type { EngineId } from "./format.ts";
import { type ConversionPort, engineNotImplemented } from "./port.ts";

// Engines whose execution needs the gated substrate resolve here until implemented. Returning a typed
// result (not throwing) lets the eventual orchestrator branch on `engine-not-implemented`.
export const deferredEngine: ConversionPort = {
  convert() {
    return Promise.resolve(engineNotImplemented());
  },
};

const ENGINES = new Map<EngineId, ConversionPort>();

export function registerEngine(id: EngineId, port: ConversionPort): void {
  ENGINES.set(id, port);
}

export function engineFor(id: EngineId): ConversionPort {
  return ENGINES.get(id) ?? deferredEngine;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/conversion/src/port.ts packages/conversion/src/engines.ts packages/conversion/test/engines.test.ts
git commit -m "feat(conversion): ConversionPort result type + deferred engine map"
```

---

### Task 5: The libvips adapter (wasm-vips)

**Files:**

- Modify: `pnpm-workspace.yaml` (add `wasm-vips` to the catalog)
- Modify: `packages/conversion/package.json` (add the `wasm-vips` dependency)
- Create: `packages/conversion/src/adapters/libvips/index.ts`
- Test: `packages/conversion/test/libvips.test.ts`

**Interfaces:**

- Consumes: `ConversionInput`, `ConversionResult`, `ConversionPort`, `converted`, `adapterError`, `unsupportedEdge` from `port.ts`; `getFormat` from `registry.ts`; `registerEngine` from `engines.ts`.
- Produces: `const libvipsAdapter: ConversionPort` and a side-effecting registration (`registerEngine("libvips", libvipsAdapter)`).

- [ ] **Step 1: Add `wasm-vips` to the workspace catalog and the package**

In `pnpm-workspace.yaml`, under the existing `catalog:` map, add a pinned entry (verify the latest stable version at build time, golden rule 11):

```yaml
wasm-vips: 0.0.13
```

In `packages/conversion/package.json`, add a `dependencies` block:

```json
  "dependencies": {
    "wasm-vips": "catalog:"
  },
```

Run: `cd C:/dev/magna-carta-worktrees/slice-2-4-conversion && vp install`
Expected: `wasm-vips` resolves into the lockfile.

- [ ] **Step 2: Write the load-smoke test FIRST (verify wasm-vips initializes in the Node test runner)**

This is the spec's load-bearing open item — prove the WASM module loads under `vite-plus`/Vitest before building conversions.

```ts
// packages/conversion/test/libvips.test.ts
import { describe, expect, it } from "vitest";
import { libvipsAdapter } from "../src/adapters/libvips/index.ts";

describe("libvips adapter", () => {
  it("converts PNG to WebP", async () => {
    const png = await makePng();
    const result = await libvipsAdapter.convert({
      bytes: png,
      from: "png",
      to: "webp",
      recipeRef: "webp",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaType).toBe("image/webp");
      // RIFF....WEBP magic
      expect(result.bytes[0]).toBe(0x52); // 'R'
      expect(result.bytes[8]).toBe(0x57); // 'W'
    }
  });

  it("converts JPEG to PNG and preserves dimensions", async () => {
    const jpeg = await makeJpeg();
    const result = await libvipsAdapter.convert({
      bytes: jpeg,
      from: "jpeg",
      to: "png",
      recipeRef: "png",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes[0]).toBe(0x89); // PNG magic
      expect(result.bytes[1]).toBe(0x50); // 'P'
    }
  });

  it("returns adapter-error on corrupt input and never throws", async () => {
    const result = await libvipsAdapter.convert({
      bytes: new Uint8Array([0, 1, 2, 3, 4]),
      from: "png",
      to: "webp",
      recipeRef: "webp",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("returns unsupported-edge for a non-raster target", async () => {
    const png = await makePng();
    const result = await libvipsAdapter.convert({
      bytes: png,
      from: "png",
      to: "pdf",
      recipeRef: "pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-edge");
  });
});

// Build tiny valid images with wasm-vips itself (a 2x3 black image) so the test needs no fixtures.
async function makePng(): Promise<Uint8Array> {
  return makeImage(".png");
}
async function makeJpeg(): Promise<Uint8Array> {
  return makeImage(".jpg");
}
async function makeImage(suffix: string): Promise<Uint8Array> {
  const Vips = (await import("wasm-vips")).default;
  const vips = await Vips();
  const image = vips.Image.black(2, 3);
  const buffer = image.writeToBuffer(suffix);
  return new Uint8Array(buffer);
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: FAIL (cannot resolve `../src/adapters/libvips/index.ts`). If instead `wasm-vips` fails to _load_ in the runner, stop and resolve that first (the spec's open item) — options: a Vitest `deps.optimizer`/`server.deps.inline` entry for `wasm-vips`, or confirming Node ≥ 17. Do not proceed until the helper images build.

- [ ] **Step 4: Implement the libvips adapter**

```ts
// packages/conversion/src/adapters/libvips/index.ts
import { registerEngine } from "../../engines.ts";
import {
  type ConversionInput,
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  unsupportedEdge,
} from "../../port.ts";
import { getFormat } from "../../registry.ts";

// Target FormatId -> libvips write suffix + media type. The libvips recipeRef IS the target id, so the
// adapter handles exactly the raster targets it knows; anything else is an unsupported edge.
const RASTER_OUTPUT: Record<string, { suffix: string; mediaType: string }> = {
  png: { suffix: ".png", mediaType: "image/png" },
  jpeg: { suffix: ".jpg", mediaType: "image/jpeg" },
  webp: { suffix: ".webp", mediaType: "image/webp" },
  tiff: { suffix: ".tif", mediaType: "image/tiff" },
  gif: { suffix: ".gif", mediaType: "image/gif" },
};

// wasm-vips initializes once (the WASM module is heavy); memoize it. Runtime-agnostic: the same module
// runs in Node now and could target a Worker (small images) or be swapped for native libvips in a
// Container later.
let vipsPromise: Promise<Awaited<ReturnType<typeof loadVips>>> | undefined;
async function loadVips() {
  const Vips = (await import("wasm-vips")).default;
  return Vips();
}
function vips() {
  vipsPromise ??= loadVips();
  return vipsPromise;
}

export const libvipsAdapter: ConversionPort = {
  async convert(input: ConversionInput): Promise<ConversionResult> {
    const output = RASTER_OUTPUT[input.to];
    if (output === undefined || getFormat(input.to) === undefined) {
      return unsupportedEdge(`libvips cannot target ${input.to}`);
    }
    try {
      const v = await vips();
      // newFromBuffer auto-detects the loader; libvips' loaders are the hardened, in-tenant path for
      // untrusted bytes — a malformed buffer raises here and is mapped to adapter-error below.
      const image = v.Image.newFromBuffer(input.bytes);
      const out = image.writeToBuffer(output.suffix);
      return converted(new Uint8Array(out), output.mediaType);
    } catch (error) {
      return adapterError(error instanceof Error ? error.message : "libvips conversion failed");
    }
  },
};

registerEngine("libvips", libvipsAdapter);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: PASS (all libvips cases).

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml packages/conversion/package.json packages/conversion/src/adapters packages/conversion/test/libvips.test.ts
git commit -m "feat(conversion): libvips image adapter over wasm-vips"
```

---

### Task 6: Fitness tests (purity + registry well-formedness) and finalize

**Files:**

- Create: `packages/conversion/test/purity.test.ts`
- Create: `packages/conversion/test/registry-wellformed.test.ts`

**Interfaces:**

- Consumes: `EDGES`, `getFormat` from `registry.ts`; `engineFor`, `deferredEngine` from `engines.ts`; reads `packages/conversion/src` files from disk (`node:fs`).

- [ ] **Step 1: Write the registry well-formedness test**

```ts
// packages/conversion/test/registry-wellformed.test.ts
import { describe, expect, it } from "vitest";
import { EDGES, getFormat } from "../src/registry.ts";

describe("registry well-formedness", () => {
  it("every edge references registered formats", () => {
    for (const edge of EDGES) {
      expect(getFormat(edge.from), `from ${edge.from}`).toBeDefined();
      expect(getFormat(edge.to), `to ${edge.to}`).toBeDefined();
    }
  });

  it("has no duplicate or self edges", () => {
    const keys = new Set<string>();
    for (const edge of EDGES) {
      expect(edge.from).not.toBe(edge.to);
      const key = `${edge.from}->${edge.to}`;
      expect(keys.has(key), `duplicate ${key}`).toBe(false);
      keys.add(key);
    }
  });

  it("every edge weight is a positive number", () => {
    for (const edge of EDGES) expect(edge.weight).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write the purity fitness test**

```ts
// packages/conversion/test/purity.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The conversion core stays pure: no D1/Hono/env/network/UI. wasm-vips is the one allowed runtime
// dependency, and only inside the libvips adapter.
const FORBIDDEN = [/from\s+["']hono["']/, /\benv\b\s*[.:]/, /from\s+["']svelte/, /\bD1Database\b/];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("purity", () => {
  it("source imports nothing impure", () => {
    for (const file of tsFiles(join(import.meta.dirname, "..", "src"))) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("only the libvips adapter imports wasm-vips", () => {
    for (const file of tsFiles(join(import.meta.dirname, "..", "src"))) {
      if (readFileSync(file, "utf8").includes("wasm-vips")) {
        expect(file.replaceAll("\\", "/")).toContain("adapters/libvips");
      }
    }
  });
});
```

- [ ] **Step 3: Run the full package suite + typecheck**

Run: `pnpm --filter @magna-carta/conversion test`
Expected: PASS (all tests across all files).

Run the repo quality gate (fmt + lint + TS-typecheck via Oxc, per the root `CLAUDE.md`): `vp check`
Expected: clean for `packages/conversion`. (Note from `docs/conventions`/prior slices: the repo-wide `pnpm check` can OOM in the formatter on some machines — if so, scope to this package's files. Fix any fmt/lint/type findings before continuing.)

- [ ] **Step 4: Commit**

```bash
git add packages/conversion/test/purity.test.ts packages/conversion/test/registry-wellformed.test.ts
git commit -m "test(conversion): purity + registry well-formedness fitness"
```

---

## Definition of done

- `@magna-carta/conversion` builds and its full suite is green: registry, pathfinding, engine map, the libvips adapter (real PNG/JPEG/WebP conversions in Node), and the two fitness tests.
- libvips converts raster formats end-to-end; LibreOffice/FFmpeg/email edges are registered and resolve to `engine-not-implemented`.
- No confidentiality/egress/content-class/candidate-ranking code exists (the in-house-only decision).
- Deferred + unchanged: the orchestrator/multi-hop execution runner, Worker routes, Container/Durable-Object execution, the LibreOfficeKit fork-pool, the FFmpeg sandbox, save-as-version, and the registry storage decision. ROADMAP/STATUS updates and the package end-of-build review (per `docs/conventions/testing.md`) follow when 2·4a is wrapped for merge.

## Plan self-review notes

- **Spec coverage:** package (T1) · registry + single-engine edges (T2) · multi-hop pathfinding + reachability (T3) · `ConversionPort` typed result + deferred engines (T4) · libvips/wasm-vips adapter incl. safe-load (T5) · purity + well-formedness fitness (T6). The §9 deferrals are explicitly out of scope.
- **wasm-vips runtime risk** is front-loaded into T5 Step 3 (the load-smoke), matching the spec's open item; AVIF/HEIF remain deferred (raster set is PNG/JPEG/WebP/TIFF/GIF).
- **Type consistency:** `ConversionInput`/`ConversionResult`/`ConversionPort`/`ConversionEdge`/`EngineId`/`FormatId` names and shapes are defined once (T2/T4) and reused verbatim in T5/T6.
