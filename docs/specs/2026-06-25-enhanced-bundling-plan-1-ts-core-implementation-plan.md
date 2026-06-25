# Enhanced Bundling — Plan 1: TypeScript bundling core (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, dependency-light bundling model to `@magna-carta/file-manager` — bundle options, a format/capability registry, layout transforms (wrapper folder, flatten, cross-platform name sanitization), a `CONTENTS` manifest generator, and an options-aware cache key — all unit-testable without Miniflare.

**Architecture:** New pure modules alongside the existing `zip-composition.ts`. The existing pure resolver `resolveZipSelection` stays the entry point that turns a `{folderIds, fileIds}` selection into version-pinned `ZipEntry`s; the new `applyBundleLayout` composes wrapper/flatten/sanitization on top of its output. A `zod` schema defines `BundleOptions` (reused later at the API boundary); a format registry exposes per-format capabilities so callers (UI option-gating, the worker, the container) all read one source of truth. The encryption **password is never part of the options model** — it is passed separately at request time and never persisted.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), `zod` (already a dependency), Vitest. No new dependencies. No D1, no Hono, no `env`, no network, no Svelte.

## Global Constraints

- **Fully write out names — no shorthand** (golden rule 12): `newIdentifier()` not `newId()`, "the data-access layer" not "the DAL". Storage-encoding suffixes from an accepted spec are the only exception.
- **Code explains itself; cite files, not process docs** (golden rule 13): no `ADR-NNNN`, no "spec", no "Plan N", no "spike", no white-paper `§` in source/tests/consumer strings. State reasoning inline or cite a concrete file path. (This plan document may reference process; the code it produces may not.)
- **This package is pure** (`packages/file-manager/CLAUDE.md`): no D1 binding, no Hono, no `env`, no network, no UI. New modules keep that property.
- **Password is never persisted** anywhere — it is not a field of `BundleOptions` and must not appear in any serialized/hashed structure produced here.
- **Module exports are explicit** — `packages/file-manager/package.json` has an `exports` map (no barrel). Every new module that another package imports gets an `exports` entry.
- **Test runner:** `pnpm --filter @magna-carta/file-manager exec vitest run <path>` for one file; `pnpm --filter @magna-carta/file-manager test` for the package. Run `pnpm check` (fmt+lint+typecheck) before the final commit of a task.

**Reference shapes (already in `packages/file-manager/src/zip-composition.ts`):**

```ts
export interface ZipEntry {
  readonly path: string;
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number;
}
export interface ResolvedZip {
  readonly entries: readonly ZipEntry[];
  readonly fileCount: number;
  readonly totalBytes: number;
}
// private today — Task 3 exports it:
function disambiguate(path: string, taken: Set<string>): string;
export async function bundleManifestHash(entries: readonly { r2Key: string; path: string }[]): Promise<string>;
```

---

### Task 1: Bundle options model

**Files:**
- Create: `packages/file-manager/src/bundle-options.ts`
- Test: `packages/file-manager/test/bundle-options.test.ts`
- Modify: `packages/file-manager/package.json` (add `"./bundle-options": "./src/bundle-options.ts"` to `exports`)

**Interfaces:**
- Produces: `BundleFormat`, `CompressionLevel`, `BundleOptions` (type), `bundleOptionsSchema` (zod), `DEFAULT_BUNDLE_OPTIONS`, `parseBundleOptions(input: unknown): BundleOptions`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/file-manager/test/bundle-options.test.ts
import { describe, expect, it } from "vitest";
import {
  bundleOptionsSchema,
  DEFAULT_BUNDLE_OPTIONS,
  parseBundleOptions,
} from "../src/bundle-options.ts";

describe("bundle-options", () => {
  it("defaults to a plain zip with no compression, encryption, or split", () => {
    expect(DEFAULT_BUNDLE_OPTIONS).toEqual({
      format: "zip",
      compression: "store",
      encryption: null,
      split: null,
      outputName: "bundle.zip",
      wrapperFolder: null,
      layout: "preserveTree",
      manifest: false,
    });
  });

  it("parses a fully specified option set", () => {
    const parsed = parseBundleOptions({
      format: "sevenZip",
      compression: "maximum",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
      split: { maxPartBytes: 20_000_000 },
      outputName: "smith.7z",
      wrapperFolder: { name: "Smith v Jones" },
      layout: "flatten",
      manifest: true,
    });
    expect(parsed.split?.maxPartBytes).toBe(20_000_000);
    expect(parsed.encryption?.encryptFileNames).toBe(true);
  });

  it("rejects a non-positive split size", () => {
    expect(() => parseBundleOptions({ ...DEFAULT_BUNDLE_OPTIONS, split: { maxPartBytes: 0 } })).toThrow();
  });

  it("rejects an unknown format", () => {
    expect(bundleOptionsSchema.safeParse({ ...DEFAULT_BUNDLE_OPTIONS, format: "rar" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-options.test.ts`
Expected: FAIL — `Cannot find module '../src/bundle-options.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/file-manager/src/bundle-options.ts
import { z } from "zod";

// The serializable description of a bundle the user asked for. The encryption PASSWORD is intentionally
// absent: it is supplied per request and never stored or hashed, so it can never leak through an options
// value persisted in a queue message, a cache key, or a log line.

export const BUNDLE_FORMATS = ["zip", "sevenZip"] as const;
export type BundleFormat = (typeof BUNDLE_FORMATS)[number];

export const COMPRESSION_LEVELS = ["store", "normal", "maximum"] as const;
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export const bundleOptionsSchema = z.object({
  format: z.enum(BUNDLE_FORMATS),
  compression: z.enum(COMPRESSION_LEVELS),
  encryption: z
    .object({ algorithm: z.literal("aes-256"), encryptFileNames: z.boolean() })
    .nullable(),
  split: z.object({ maxPartBytes: z.number().int().positive() }).nullable(),
  outputName: z.string().min(1).max(255),
  wrapperFolder: z.object({ name: z.string().min(1) }).nullable(),
  layout: z.enum(["preserveTree", "flatten"]),
  manifest: z.boolean(),
});

export type BundleOptions = z.infer<typeof bundleOptionsSchema>;

export const DEFAULT_BUNDLE_OPTIONS: BundleOptions = {
  format: "zip",
  compression: "store",
  encryption: null,
  split: null,
  outputName: "bundle.zip",
  wrapperFolder: null,
  layout: "preserveTree",
  manifest: false,
};

export function parseBundleOptions(input: unknown): BundleOptions {
  return bundleOptionsSchema.parse(input);
}
```

- [ ] **Step 4: Add the package export**

In `packages/file-manager/package.json`, add to `exports` (keep alphabetical-ish ordering near the other entries):

```json
"./bundle-options": "./src/bundle-options.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-options.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/bundle-options.ts packages/file-manager/test/bundle-options.test.ts packages/file-manager/package.json
git commit -m "feat(bundling): bundle options model + zod schema"
```

---

### Task 2: Format capability registry

**Files:**
- Create: `packages/file-manager/src/bundle-formats.ts`
- Test: `packages/file-manager/test/bundle-formats.test.ts`
- Modify: `packages/file-manager/package.json` (`"./bundle-formats": "./src/bundle-formats.ts"`)

**Interfaces:**
- Consumes: `BundleFormat`, `BundleOptions` from `./bundle-options.ts`.
- Produces: `FormatCapabilities`, `FORMAT_CAPABILITIES`, `capabilitiesFor(format)`, `validateOptionsForFormat(options): readonly string[]` (empty = valid).

- [ ] **Step 1: Write the failing test**

```ts
// packages/file-manager/test/bundle-formats.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_BUNDLE_OPTIONS } from "../src/bundle-options.ts";
import { capabilitiesFor, validateOptionsForFormat } from "../src/bundle-formats.ts";

describe("bundle-formats", () => {
  it("zip cannot encrypt file names; 7z can", () => {
    expect(capabilitiesFor("zip").supportsHeaderEncryption).toBe(false);
    expect(capabilitiesFor("sevenZip").supportsHeaderEncryption).toBe(true);
  });

  it("accepts default plain-zip options", () => {
    expect(validateOptionsForFormat(DEFAULT_BUNDLE_OPTIONS)).toEqual([]);
  });

  it("rejects zip + encryptFileNames", () => {
    const errors = validateOptionsForFormat({
      ...DEFAULT_BUNDLE_OPTIONS,
      format: "zip",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/file name/i);
  });

  it("allows 7z + encryptFileNames + split", () => {
    expect(
      validateOptionsForFormat({
        ...DEFAULT_BUNDLE_OPTIONS,
        format: "sevenZip",
        encryption: { algorithm: "aes-256", encryptFileNames: true },
        split: { maxPartBytes: 20_000_000 },
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-formats.test.ts`
Expected: FAIL — `Cannot find module '../src/bundle-formats.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/file-manager/src/bundle-formats.ts
import type { BundleFormat, BundleOptions } from "./bundle-options.ts";

// One source of truth for what each output format can do. The UI gates its option controls off this,
// the worker validates a request against it, and the container builder reads the same table — so a new
// format is one row here, never a change spread across callers.
export interface FormatCapabilities {
  readonly extension: string; // the artifact's file extension, no dot
  readonly supportsCompression: boolean;
  readonly supportsEncryption: boolean;
  readonly supportsHeaderEncryption: boolean; // encrypt the file LIST, not just contents
  readonly supportsSplit: boolean;
}

export const FORMAT_CAPABILITIES: Record<BundleFormat, FormatCapabilities> = {
  zip: {
    extension: "zip",
    supportsCompression: true,
    supportsEncryption: true,
    supportsHeaderEncryption: false, // ZIP AES leaves the file list visible
    supportsSplit: true,
  },
  sevenZip: {
    extension: "7z",
    supportsCompression: true,
    supportsEncryption: true,
    supportsHeaderEncryption: true,
    supportsSplit: true,
  },
};

export function capabilitiesFor(format: BundleFormat): FormatCapabilities {
  return FORMAT_CAPABILITIES[format];
}

// Cross-field, capability-aware validation beyond the schema's structural checks. Returns one human
// string per violation; an empty array means the options are coherent for their format.
export function validateOptionsForFormat(options: BundleOptions): readonly string[] {
  const capabilities = capabilitiesFor(options.format);
  const errors: string[] = [];
  if (options.encryption?.encryptFileNames === true && !capabilities.supportsHeaderEncryption) {
    errors.push(`${options.format} cannot encrypt file names; only encrypts file contents`);
  }
  if (options.encryption !== null && !capabilities.supportsEncryption) {
    errors.push(`${options.format} does not support encryption`);
  }
  if (options.split !== null && !capabilities.supportsSplit) {
    errors.push(`${options.format} does not support splitting`);
  }
  return errors;
}
```

- [ ] **Step 4: Add the package export**

`"./bundle-formats": "./src/bundle-formats.ts",`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-formats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/bundle-formats.ts packages/file-manager/test/bundle-formats.test.ts packages/file-manager/package.json
git commit -m "feat(bundling): format capability registry + per-format validation"
```

---

### Task 3: Archive-path helpers (export disambiguation, add sanitization)

**Files:**
- Create: `packages/file-manager/src/bundle-paths.ts`
- Modify: `packages/file-manager/src/zip-composition.ts` (move `disambiguate` to the new module and re-import it, so both the resolver and the layout transform share one implementation)
- Test: `packages/file-manager/test/bundle-paths.test.ts`
- Modify: `packages/file-manager/package.json` (`"./bundle-paths": "./src/bundle-paths.ts"`)

**Interfaces:**
- Produces: `disambiguate(path: string, taken: Set<string>): string` (relocated), `sanitizeArchivePath(path: string): string`.
- Consumes (by `zip-composition.ts`): `disambiguate` from `./bundle-paths.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/file-manager/test/bundle-paths.test.ts
import { describe, expect, it } from "vitest";
import { disambiguate, sanitizeArchivePath } from "../src/bundle-paths.ts";

describe("disambiguate", () => {
  it("suffixes a counter before the extension on collision", () => {
    const taken = new Set<string>();
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report.pdf");
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report (1).pdf");
    expect(disambiguate("a/report.pdf", taken)).toBe("a/report (2).pdf");
  });
});

describe("sanitizeArchivePath", () => {
  it("replaces Windows-reserved characters per segment, keeping separators", () => {
    expect(sanitizeArchivePath('a/b<c>:d"e|f?g*h.txt')).toBe("a/b_c__d_e_f_g_h.txt");
  });
  it("strips a trailing dot or space on a segment (Windows refuses them)", () => {
    expect(sanitizeArchivePath("folder /name.")).toBe("folder/name");
  });
  it("renames a reserved device name", () => {
    expect(sanitizeArchivePath("CON/x.txt")).toBe("_CON/x.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-paths.test.ts`
Expected: FAIL — `Cannot find module '../src/bundle-paths.ts'`.

- [ ] **Step 3: Create `bundle-paths.ts`**

```ts
// packages/file-manager/src/bundle-paths.ts

// Shared archive-path helpers used by both the selection resolver and the bundle layout transform.

// Suffixes " (n)" before any extension when a path is already taken, so two same-named files never
// overwrite in the archive. Mutates `taken` to reserve the chosen path.
export function disambiguate(path: string, taken: Set<string>): string {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot <= 0 ? base : base.slice(0, dot);
  const ext = dot <= 0 ? "" : base.slice(dot);
  let counter = 1;
  let candidate = `${dir}${stem} (${counter})${ext}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${dir}${stem} (${counter})${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

// Windows reserves these device names regardless of extension.
const RESERVED_DEVICE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function sanitizeSegment(segment: string): string {
  // Replace characters illegal on Windows/macOS, then trim trailing dots/spaces (Windows strips them,
  // which would silently collide two distinct names). Spaces inside a name are legal and kept.
  let cleaned = segment.replace(/[<>:"/\\|?*]/g, "_").replace(/[ .]+$/g, "");
  if (cleaned.length === 0) cleaned = "_";
  const stem = cleaned.split(".")[0]?.toUpperCase() ?? "";
  if (RESERVED_DEVICE_NAMES.has(stem)) cleaned = `_${cleaned}`;
  return cleaned;
}

// Sanitizes every "/"-separated segment so the archive extracts cleanly on Windows, macOS, and Linux.
// Empty segments (from doubled or trailing slashes) are dropped.
export function sanitizeArchivePath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(sanitizeSegment)
    .join("/");
}
```

- [ ] **Step 4: Re-point `zip-composition.ts` at the shared helper**

In `packages/file-manager/src/zip-composition.ts`: delete the local `function disambiguate(...) {...}` definition and add at the top:

```ts
import { disambiguate } from "./bundle-paths.ts";
```

(`resolveZipSelection` already calls `disambiguate(path, taken)` — no call-site change.)

- [ ] **Step 5: Run the new test AND the existing resolver test**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-paths.test.ts test/zip-composition.test.ts`
Expected: PASS — the new path tests AND the pre-existing `resolveZipSelection`/`bundleManifestHash` tests (proving the `disambiguate` move was behavior-preserving).

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/bundle-paths.ts packages/file-manager/src/zip-composition.ts packages/file-manager/test/bundle-paths.test.ts packages/file-manager/package.json
git commit -m "feat(bundling): shared archive-path helpers (disambiguate + cross-platform sanitize)"
```

---

### Task 4: Layout transform (wrapper folder, flatten, sanitize)

**Files:**
- Create: `packages/file-manager/src/bundle-layout.ts`
- Test: `packages/file-manager/test/bundle-layout.test.ts`
- Modify: `packages/file-manager/package.json` (`"./bundle-layout": "./src/bundle-layout.ts"`)

**Interfaces:**
- Consumes: `ResolvedZip`, `ZipEntry` from `./zip-composition.ts`; `BundleOptions` from `./bundle-options.ts`; `disambiguate`, `sanitizeArchivePath` from `./bundle-paths.ts`.
- Produces: `applyBundleLayout(resolved: ResolvedZip, options: Pick<BundleOptions, "layout" | "wrapperFolder">): ResolvedZip`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/file-manager/test/bundle-layout.test.ts
import { describe, expect, it } from "vitest";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { ResolvedZip, ZipEntry } from "../src/zip-composition.ts";
import { applyBundleLayout } from "../src/bundle-layout.ts";

const entry = (path: string, id: string, size: number): ZipEntry => ({
  path,
  fileId: id as FileId,
  versionId: `${id}-v` as FileVersionId,
  r2Key: `files/${id}/${id}-v`,
  sizeBytes: size,
});

const resolved = (entries: ZipEntry[]): ResolvedZip => ({
  entries,
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
});

describe("applyBundleLayout", () => {
  it("preserveTree with no wrapper is a no-op on paths", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("b.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, { layout: "preserveTree", wrapperFolder: null });
    expect(out.entries.map((e) => e.path).sort()).toEqual(["Pleadings/a.pdf", "b.pdf"]);
    expect(out.totalBytes).toBe(30);
  });

  it("wraps every entry under the wrapper folder", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("b.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, {
      layout: "preserveTree",
      wrapperFolder: { name: "Smith v Jones" },
    });
    expect(out.entries.map((e) => e.path).sort()).toEqual([
      "Smith v Jones/Pleadings/a.pdf",
      "Smith v Jones/b.pdf",
    ]);
  });

  it("flatten collapses to basenames and disambiguates collisions", () => {
    const input = resolved([entry("Pleadings/a.pdf", "f1", 10), entry("Drafts/a.pdf", "f2", 20)]);
    const out = applyBundleLayout(input, { layout: "flatten", wrapperFolder: null });
    expect(out.entries.map((e) => e.path).sort()).toEqual(["a (1).pdf", "a.pdf"]);
    expect(out.fileCount).toBe(2);
  });

  it("flatten then wrap nests the flattened names under the wrapper", () => {
    const input = resolved([entry("x/a.pdf", "f1", 10)]);
    const out = applyBundleLayout(input, { layout: "flatten", wrapperFolder: { name: "Pkg" } });
    expect(out.entries.map((e) => e.path)).toEqual(["Pkg/a.pdf"]);
  });

  it("sanitizes illegal characters in the wrapper name", () => {
    const input = resolved([entry("a.pdf", "f1", 10)]);
    const out = applyBundleLayout(input, {
      layout: "preserveTree",
      wrapperFolder: { name: "Smith: v Jones?" },
    });
    expect(out.entries[0]?.path).toBe("Smith_ v Jones_/a.pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-layout.test.ts`
Expected: FAIL — `Cannot find module '../src/bundle-layout.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/file-manager/src/bundle-layout.ts
import type { BundleOptions } from "./bundle-options.ts";
import { disambiguate, sanitizeArchivePath } from "./bundle-paths.ts";
import type { ResolvedZip, ZipEntry } from "./zip-composition.ts";

// Composes the user's layout choice on top of the resolver's version-pinned entries: optionally flatten
// every entry to its base name, optionally nest everything under a single wrapper folder, and always
// sanitize the resulting paths for cross-platform extraction. Pure — sizes and identities are untouched,
// only paths change; collisions introduced by flattening are disambiguated deterministically.
export function applyBundleLayout(
  resolved: ResolvedZip,
  options: Pick<BundleOptions, "layout" | "wrapperFolder">,
): ResolvedZip {
  const wrapperPrefix =
    options.wrapperFolder === null ? "" : `${sanitizeArchivePath(options.wrapperFolder.name)}/`;

  const taken = new Set<string>();
  const entries: ZipEntry[] = resolved.entries
    .map((entry): { entry: ZipEntry; path: string } => {
      const base =
        options.layout === "flatten"
          ? (entry.path.split("/").pop() ?? entry.path)
          : entry.path;
      return { entry, path: sanitizeArchivePath(`${wrapperPrefix}${base}`) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ entry, path }) => ({ ...entry, path: disambiguate(path, taken) }));

  return { entries, fileCount: entries.length, totalBytes: resolved.totalBytes };
}
```

- [ ] **Step 4: Add the package export**

`"./bundle-layout": "./src/bundle-layout.ts",`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/bundle-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/bundle-layout.ts packages/file-manager/test/bundle-layout.test.ts packages/file-manager/package.json
git commit -m "feat(bundling): layout transform (wrapper folder, flatten, sanitize)"
```

---

### Task 5: CONTENTS manifest generator

**Files:**
- Create: `packages/file-manager/src/contents-manifest.ts`
- Test: `packages/file-manager/test/contents-manifest.test.ts`
- Modify: `packages/file-manager/package.json` (`"./contents-manifest": "./src/contents-manifest.ts"`)

**Interfaces:**
- Produces: `ManifestEntry` (`{ path: string; sizeBytes: number; sha256: string }`), `buildContentsManifest(entries: readonly ManifestEntry[]): string`.

**Note:** the per-entry `sha256` comes from the already-computed `file_version` content hash (recorded at ingest), so this manifest is built from D1 metadata alone — no byte re-read. Wiring that hash through the query is a later (worker) plan; this task only needs the deterministic text generator.

- [ ] **Step 1: Write the failing test**

```ts
// packages/file-manager/test/contents-manifest.test.ts
import { describe, expect, it } from "vitest";
import { buildContentsManifest } from "../src/contents-manifest.ts";

describe("buildContentsManifest", () => {
  it("lists entries sorted by path with size and sha256, plus a summary footer", () => {
    const text = buildContentsManifest([
      { path: "b.pdf", sizeBytes: 20, sha256: "bb" },
      { path: "a.pdf", sizeBytes: 10, sha256: "aa" },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("path\tsize_bytes\tsha256");
    expect(lines[1]).toBe("a.pdf\t10\taa");
    expect(lines[2]).toBe("b.pdf\t20\tbb");
    expect(lines).toContain("# 2 files, 30 bytes");
  });

  it("handles an empty selection", () => {
    expect(buildContentsManifest([])).toBe("path\tsize_bytes\tsha256\n# 0 files, 0 bytes\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/contents-manifest.test.ts`
Expected: FAIL — `Cannot find module '../src/contents-manifest.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/file-manager/src/contents-manifest.ts

// One verifiable line per bundled file (path, byte size, content SHA-256), tab-separated and sorted by
// path, with a summary footer. A recipient can re-hash each extracted file and compare. Pure text; the
// builder writes it into the bundle as CONTENTS.txt.
export interface ManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export function buildContentsManifest(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rows = sorted.map((entry) => `${entry.path}\t${entry.sizeBytes}\t${entry.sha256}`);
  const totalBytes = sorted.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const footer = `# ${sorted.length} files, ${totalBytes} bytes`;
  return `path\tsize_bytes\tsha256\n${rows.length > 0 ? `${rows.join("\n")}\n` : ""}${footer}\n`;
}
```

- [ ] **Step 4: Add the package export**

`"./contents-manifest": "./src/contents-manifest.ts",`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/contents-manifest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/contents-manifest.ts packages/file-manager/test/contents-manifest.test.ts packages/file-manager/package.json
git commit -m "feat(bundling): CONTENTS manifest generator"
```

---

### Task 6: Options-aware cache key

**Files:**
- Modify: `packages/file-manager/src/zip-composition.ts` (add `bundleCacheKey`)
- Test: `packages/file-manager/test/zip-composition.test.ts` (append a `describe` block; place the new imports with the existing top-of-file imports)

**Interfaces:**
- Consumes: `BundleOptions` from `./bundle-options.ts`; existing `bundleManifestHash`.
- Produces: `bundleCacheKey(entries: readonly { r2Key: string; path: string }[], options: BundleOptions): Promise<string>`.

**Why:** the existing `bundleManifestHash` keys the store-mode ZIP cache by content alone. Once two different option sets (e.g. compressed vs. stored, or different wrapper names) can target the same files, the cache must key on the options too, or they collide on one artifact. The **password and the `encryption` block are excluded** — encrypted bundles are never cached, and excluding the block keeps secrets out of the key.

- [ ] **Step 1: Write the failing test (add to the existing file)**

Add these imports to the top of `packages/file-manager/test/zip-composition.test.ts` (with the other imports), then append the `describe` block at the end:

```ts
// top-of-file imports (add alongside the existing ones)
import { bundleCacheKey } from "../src/zip-composition.ts";
import { DEFAULT_BUNDLE_OPTIONS } from "../src/bundle-options.ts";
```

```ts
// append at the end of packages/file-manager/test/zip-composition.test.ts
describe("bundleCacheKey", () => {
  const entries = [{ r2Key: "files/f1/v1", path: "a.pdf" }];

  it("differs when a non-secret option differs", async () => {
    const stored = await bundleCacheKey(entries, { ...DEFAULT_BUNDLE_OPTIONS, compression: "store" });
    const max = await bundleCacheKey(entries, { ...DEFAULT_BUNDLE_OPTIONS, compression: "maximum" });
    expect(stored).not.toBe(max);
  });

  it("is identical regardless of the encryption block (encrypted bundles are never cached)", async () => {
    const plain = await bundleCacheKey(entries, { ...DEFAULT_BUNDLE_OPTIONS });
    const encrypted = await bundleCacheKey(entries, {
      ...DEFAULT_BUNDLE_OPTIONS,
      encryption: { algorithm: "aes-256", encryptFileNames: false },
    });
    expect(plain).toBe(encrypted);
  });

  it("is a 64-char hex digest", async () => {
    expect(await bundleCacheKey(entries, DEFAULT_BUNDLE_OPTIONS)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/zip-composition.test.ts`
Expected: FAIL — `bundleCacheKey is not a function` / no export.

- [ ] **Step 3: Add the implementation to `zip-composition.ts`**

```ts
// add the import near the top of zip-composition.ts
import type { BundleOptions } from "./bundle-options.ts";

// Append at the end of zip-composition.ts:

// The cache/dedup key for an OPTIONED bundle: the content manifest hash folded together with the
// non-secret options that change the output bytes. The `encryption` block is deliberately excluded —
// encrypted bundles are never cached (their output is non-deterministic and the password must not enter
// any persisted key) — so the key stays stable whether or not encryption was requested.
export async function bundleCacheKey(
  entries: readonly { r2Key: string; path: string }[],
  options: BundleOptions,
): Promise<string> {
  const optionSignature = JSON.stringify({
    format: options.format,
    compression: options.compression,
    split: options.split,
    outputName: options.outputName,
    wrapperFolder: options.wrapperFolder,
    layout: options.layout,
    manifest: options.manifest,
  });
  const contentHash = await bundleManifestHash(entries);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${contentHash}\n${optionSignature}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/zip-composition.test.ts`
Expected: PASS (existing tests + 3 new `bundleCacheKey` tests).

- [ ] **Step 5: Full package gate**

Run: `pnpm --filter @magna-carta/file-manager test` then `pnpm check`
Expected: all file-manager tests PASS; fmt/lint/typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/zip-composition.ts packages/file-manager/test/zip-composition.test.ts
git commit -m "feat(bundling): options-aware bundle cache key (excludes secrets)"
```

---

## Self-review

- **Spec coverage (Plan 1 portion):** options model (Task 1); format/capability registry + per-format validation (Task 2); cross-platform name sanitization + shared disambiguation (Task 3); wrapper folder + flatten layout (Task 4); CONTENTS manifest (Task 5); options-aware, secret-excluding cache key (Task 6). Correctness items ZIP64 / UTF-8 / timestamps belong to the encoder (the container plan), not this pure layer; sanitization is the one correctness item realizable purely and is covered here.
- **Out of this plan (later plans):** the Rust `containers/bundle` encoder (gated on a 7z-crate evaluation), the worker `downloads/` orchestration extensions + container adapter + the encrypted in-memory-password path, and the UI bundle-options surface.
- **Placeholder scan:** none — every step carries runnable code and an exact command.
- **Type consistency:** `BundleOptions`/`BundleFormat`/`CompressionLevel` defined in Task 1 are consumed verbatim in Tasks 2/4/6; `ResolvedZip`/`ZipEntry` reused from `zip-composition.ts`; `disambiguate`/`sanitizeArchivePath` defined in Task 3 are consumed in Task 4; `bundleManifestHash` reused in Task 6.

## Follow-on plans (not part of Plan 1)

1. **Plan 2 — `containers/bundle` (Rust).** Evaluate and pin a 7z encoder crate; `Encoder` trait + `zip`/`sevenZip` adapters (Deflate/LZMA2, AES-256, ZIP64, UTF-8, timestamps, header encryption, format-native multi-volume); axum service streaming R2 → encoder → R2; CI acceptance gate (build → re-open → verify, wrong-password rejection). Mirrors `containers/scan`.
2. **Plan 3 — worker orchestration.** Extend `apps/worker/src/downloads/` (`BundleBuildCoordinator`, `bundle-build` queue, routes) to carry `BundleOptions` + multi-volume artifacts; add the container adapter; implement the encrypted path (password in-memory only, no durable queue, no cache); thread the `file_version` content hash into the manifest; keep the `client-zip` fast lane for plain ZIP.
3. **Plan 4 — UI.** A "Bundle options…" surface on the matter download/export action (design system + Bits UI), gating controls off `FORMAT_CAPABILITIES`, with the masked-password "never stored" notice.
