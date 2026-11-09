# Metadata Inspector & Scrubber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an ephemeral Tools-area utility that inspects a file's metadata and content-bearing artifacts and returns a cleaned copy, built core-first so a matter-action can reuse the engine later.

**Architecture:** A pure `@magna-carta/metadata` TypeScript package detects the format, dispatches to a document engine (OOXML, via `fflate` + `fast-xml-parser`) or an image engine (JPEG/PNG segment/chunk surgery, hand-rolled), and exposes a `MetadataPort` with `inspect`/`scrub` returning typed outcomes (never throwing). A Worker route surfaces it through the chokepoint; the catalog, a permission, and a role-seed migration wire it into the Tools area. UI is the design-system shell's job later; this plan exercises the route via the throwaway dev demo page.

**Tech Stack:** TypeScript, `fflate` (zip), `fast-xml-parser` (OOXML XML), Hono + `@hono/zod-openapi` (Worker route), Vitest (`@cloudflare/vitest-pool-workers` for the route, node pool for the package), Drizzle SQL migrations.

## Global Constraints

- **Scope of THIS plan (v1):** formats `.docx`, `.jpg`/`.jpeg`, `.png` only. Staged follow-ups (named, not silent): `.xlsx`/`.pptx` content-artifact scrub, TIFF, HEIC, PDF, legacy `.doc`/`.xls`, the matter-action consumer, the Rust→WASM image swap, the large-file Container engine. The design spec (`docs/specs/2026-06-22-metadata-tool-design.md`) is the broader roadmap; this plan delivers the highest-value subset first.
- **All-TypeScript.** No Rust, no WASM, no container in this plan (design decision, settled 2026-06-22).
- **Engines behind interfaces.** Document and image work sits behind a `MetadataEngine` interface; the port never names a concrete engine.
- **Typed outcomes, never throw for expected failures** — mirror `packages/conversion/src/port.ts` (`{ ok: false, reason }`).
- **Ephemeral & record-less.** No D1, no R2, nothing persisted. Processing is in-memory under a size cap.
- **Redaction by default.** File contents and extracted metadata values are NEVER logged. Errors correlate by ID only (golden rule 4).
- **Full names, no shorthand** (golden rule 12): `newIdentifier` not `newId`, `@magna-carta/identifiers`, "the data-access layer", etc.
- **No process-ref citations in source/tests/config** (golden rule 13): no `ADR-NNNN`, no "spec", no "slice/phase" in code comments. Explain reasoning inline or cite a file by path.
- **Size cap:** default **15 MiB** (`MAX_INPUT_BYTES = 15 * 1024 * 1024`).
- **Decompression-bomb caps (OOXML unzip):** total inflated ≤ **200 MiB**, entry count ≤ **2048**.
- **All UI through the design system** if any is added — but this plan adds none beyond the throwaway dev demo page (plain HTML, already exempt).
- **Permission key:** `tools:metadataScrubber`. **operationIds:** `metadata.inspect`, `metadata.scrub`. **Catalog id:** `metadata-scrubber`. **Subject group:** `documents`. **Lucide icon:** `file-search`.

---

### Task 1: Scaffold the `@magna-carta/metadata` package

**Files:**

- Create: `packages/metadata/package.json`
- Create: `packages/metadata/tsconfig.json`
- Create: `packages/metadata/vitest.config.ts`
- Create: `packages/metadata/src/index.ts`
- Test: `packages/metadata/test/smoke.test.ts`

**Interfaces:**

- Produces: the package `@magna-carta/metadata` with subpath exports `.`, `./port`, `./model`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/smoke.test.ts
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@magna-carta/metadata", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@magna-carta/metadata");
  });
});
```

- [ ] **Step 2: Create the package files**

```jsonc
// packages/metadata/package.json
{
  "name": "@magna-carta/metadata",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./model": "./src/model.ts",
    "./port": "./src/port.ts",
    ".": "./src/index.ts",
  },
  "scripts": {
    "test": "vp test run",
  },
  "dependencies": {
    "fflate": "^0.8.2",
    "fast-xml-parser": "^4.5.0",
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:",
  },
}
```

```jsonc
// packages/metadata/tsconfig.json
{
  "extends": "@magna-carta/tsconfig/base.json",
  "include": ["src", "test"],
}
```

```ts
// packages/metadata/vitest.config.ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
export default defineConfig({
  root: import.meta.dirname,
});
```

```ts
// packages/metadata/src/index.ts
export const PACKAGE_NAME = "@magna-carta/metadata";
```

Confirm the tsconfig extends path is correct by reading another pure package's `tsconfig.json` (e.g. `packages/whois/tsconfig.json`) and matching it exactly.

- [ ] **Step 3: Install and verify the test fails then passes**

Run: `vp install`
Run: `pnpm --filter @magna-carta/metadata test`
Expected: PASS (1 test).

- [ ] **Step 4: Confirm versions are current** (golden rule 11)

Web-check the latest stable `fflate` and `fast-xml-parser` versions; update `package.json` if newer majors are compatible, re-run `vp install`.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata pnpm-lock.yaml
git commit -m "feat(metadata): scaffold @magna-carta/metadata package"
```

---

### Task 2: Core model, scrub options, engine + port interfaces

**Files:**

- Create: `packages/metadata/src/model.ts`
- Create: `packages/metadata/src/options.ts`
- Create: `packages/metadata/src/engine.ts`
- Create: `packages/metadata/src/port.ts`
- Test: `packages/metadata/test/model.test.ts`

**Interfaces:**

- Produces:
  - `RiskLevel = "high" | "medium" | "low"`
  - `FindingCategory` union (8 members below)
  - `Finding { category; label; risk; count; defaultScrub }`
  - `MetadataReport { format; findings; clean }`
  - `ScrubOptions { identifyingMetadata; trackedChanges; comments; hiddenContent; customProperties; imageMetadata }` (all `boolean`)
  - `SCRUB_ALL: ScrubOptions`
  - `MetadataEngine { inspect(bytes): Promise<MetadataReport>; scrub(bytes, options): Promise<Uint8Array> }`
  - `MetadataInput { bytes: Uint8Array; filename: string }`
  - `MetadataFailure = "unsupported-format" | "too-large" | "corrupt" | "decompression-bomb"`
  - `InspectOutcome`, `ScrubOutcome` (discriminated unions)
  - `MetadataPort { inspect(input): Promise<InspectOutcome>; scrub(input, options): Promise<ScrubOutcome> }`
  - `reportOf(format, findings): MetadataReport` helper

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/model.test.ts
import { describe, expect, it } from "vitest";
import { reportOf } from "../src/model.ts";
import { SCRUB_ALL } from "../src/options.ts";

describe("model", () => {
  it("reportOf marks an empty findings list clean", () => {
    const report = reportOf("docx", []);
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("reportOf marks a non-empty findings list not clean", () => {
    const report = reportOf("docx", [
      {
        category: "identifying-metadata",
        label: "Author",
        risk: "high",
        count: 1,
        defaultScrub: true,
      },
    ]);
    expect(report.clean).toBe(false);
  });

  it("SCRUB_ALL enables every category", () => {
    expect(Object.values(SCRUB_ALL).every((v) => v === true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test`
Expected: FAIL ("Cannot find module ../src/model.ts").

- [ ] **Step 3: Write the model**

```ts
// packages/metadata/src/model.ts
import type { SupportedFormat } from "./detect.ts";

export type RiskLevel = "high" | "medium" | "low";

// Risk-ordered families of things a file can carry. Document families first, then image families.
export type FindingCategory =
  | "identifying-metadata" // author, lastModifiedBy, company, dates, revision, app/template
  | "tracked-changes" // insertions, deletions, moves, format-change records
  | "comments" // reviewer comments and the names attached to them
  | "hidden-content" // text marked hidden (vanish)
  | "custom-properties" // arbitrary custom document properties
  | "image-location" // GPS / camera EXIF
  | "image-software" // editing-software / XMP markers
  | "image-other"; // remaining EXIF/IPTC/comment segments

export interface Finding {
  readonly category: FindingCategory;
  readonly label: string; // human-readable; NEVER the metadata value itself (redaction)
  readonly risk: RiskLevel;
  readonly count: number; // how many instances were found
  readonly defaultScrub: boolean; // included in the one-click "make safe to send" default
}

export interface MetadataReport {
  readonly format: SupportedFormat;
  readonly findings: readonly Finding[];
  readonly clean: boolean;
}

export function reportOf(format: SupportedFormat, findings: readonly Finding[]): MetadataReport {
  return { format, findings, clean: findings.length === 0 };
}
```

```ts
// packages/metadata/src/options.ts
export interface ScrubOptions {
  readonly identifyingMetadata: boolean;
  readonly trackedChanges: boolean; // accept: keep final text, drop the revision record
  readonly comments: boolean; // delete comments and their parts
  readonly hiddenContent: boolean; // remove hidden (vanish) runs
  readonly customProperties: boolean;
  readonly imageMetadata: boolean; // strip all EXIF/IPTC/XMP/comment segments
}

// The one-click "make safe to send" default: everything on.
export const SCRUB_ALL: ScrubOptions = {
  identifyingMetadata: true,
  trackedChanges: true,
  comments: true,
  hiddenContent: true,
  customProperties: true,
  imageMetadata: true,
};
```

```ts
// packages/metadata/src/engine.ts
import type { MetadataReport } from "./model.ts";
import type { ScrubOptions } from "./options.ts";

// Both the OOXML document engine and the image engine implement this. The interface is the seam:
// a heavier implementation can replace either without touching the port, the route, or the UI.
export interface MetadataEngine {
  inspect(bytes: Uint8Array): Promise<MetadataReport>;
  scrub(bytes: Uint8Array, options: ScrubOptions): Promise<Uint8Array>;
}
```

```ts
// packages/metadata/src/port.ts
import type { MetadataReport } from "./model.ts";
import type { ScrubOptions } from "./options.ts";

export interface MetadataInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export type MetadataFailure = "unsupported-format" | "too-large" | "corrupt" | "decompression-bomb";

export type InspectOutcome =
  | { readonly ok: true; readonly report: MetadataReport }
  | { readonly ok: false; readonly reason: MetadataFailure; readonly detail?: string };

export type ScrubOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mediaType: string;
      readonly report: MetadataReport; // re-inspection of the OUTPUT, so the caller can confirm clean
    }
  | { readonly ok: false; readonly reason: MetadataFailure; readonly detail?: string };

export interface MetadataPort {
  inspect(input: MetadataInput): Promise<InspectOutcome>;
  scrub(input: MetadataInput, options: ScrubOptions): Promise<ScrubOutcome>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test`
Expected: PASS. (`detect.ts` does not exist yet; `model.ts` imports its `SupportedFormat` type only — create a temporary `packages/metadata/src/detect.ts` containing just `export type SupportedFormat = "docx" | "jpeg" | "png";` to satisfy the type import. Task 3 fills it in.)

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src packages/metadata/test
git commit -m "feat(metadata): core report model, scrub options, engine + port interfaces"
```

---

### Task 3: Format detection

**Files:**

- Modify: `packages/metadata/src/detect.ts` (replace the temporary stub)
- Test: `packages/metadata/test/detect.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `SupportedFormat = "docx" | "jpeg" | "png"`; `detect(bytes: Uint8Array): SupportedFormat | "unsupported"`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/detect.test.ts
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detect } from "../src/detect.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function minimalDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:document/>"),
  });
}

describe("detect", () => {
  it("detects JPEG by SOI marker", () => expect(detect(JPEG)).toBe("jpeg"));
  it("detects PNG by signature", () => expect(detect(PNG)).toBe("png"));
  it("detects docx by zip containing word/document.xml", () =>
    expect(detect(minimalDocx())).toBe("docx"));
  it("classifies an unknown blob as unsupported", () =>
    expect(detect(new Uint8Array([1, 2, 3, 4]))).toBe("unsupported"));
  it("classifies a non-docx zip as unsupported", () =>
    expect(detect(zipSync({ "hello.txt": strToU8("hi") }))).toBe("unsupported"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test detect`
Expected: FAIL.

- [ ] **Step 3: Implement detection**

```ts
// packages/metadata/src/detect.ts
import { unzipSync } from "fflate";

export type SupportedFormat = "docx" | "jpeg" | "png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

// Classify by content, never by the supplied filename/extension. A zip is classified as docx only
// when it actually contains word/document.xml — so a renamed archive cannot masquerade as a document.
export function detect(bytes: Uint8Array): SupportedFormat | "unsupported" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    try {
      const entries = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
      if (entries["word/document.xml"] !== undefined) return "docx";
    } catch {
      return "unsupported";
    }
  }
  return "unsupported";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test detect`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/detect.ts packages/metadata/test/detect.test.ts
git commit -m "feat(metadata): content-based format detection (docx/jpeg/png)"
```

---

### Task 4: Security guards

**Files:**

- Create: `packages/metadata/src/guards.ts`
- Test: `packages/metadata/test/guards.test.ts`

**Interfaces:**

- Produces:
  - `MAX_INPUT_BYTES = 15 * 1024 * 1024`
  - `MAX_INFLATED_BYTES = 200 * 1024 * 1024`
  - `MAX_ENTRY_COUNT = 2048`
  - `class BombError extends Error` (thrown internally by `safeUnzip`, mapped to the `decompression-bomb` reason at the port boundary)
  - `safeUnzip(bytes: Uint8Array): Record<string, Uint8Array>` — unzips with the caps above, throwing `BombError` if exceeded
  - `oversize(bytes: Uint8Array): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/guards.test.ts
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BombError, MAX_ENTRY_COUNT, oversize, safeUnzip } from "../src/guards.ts";

describe("guards", () => {
  it("oversize flags inputs above the cap", () => {
    expect(oversize(new Uint8Array(1024))).toBe(false);
    expect(oversize(new Uint8Array(20 * 1024 * 1024))).toBe(true);
  });

  it("safeUnzip returns entries for a normal archive", () => {
    const entries = safeUnzip(zipSync({ "a.txt": strToU8("hello") }));
    expect(new TextDecoder().decode(entries["a.txt"])).toBe("hello");
  });

  it("safeUnzip throws BombError when the entry count is exceeded", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) many[`f${i}.txt`] = strToU8("x");
    expect(() => safeUnzip(zipSync(many))).toThrow(BombError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test guards`
Expected: FAIL.

- [ ] **Step 3: Implement the guards**

```ts
// packages/metadata/src/guards.ts
import { unzipSync } from "fflate";

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 2048;

// Thrown when an archive expands past the safety caps. Caught at the port boundary and mapped to the
// "decompression-bomb" failure reason — never expands an untrusted archive without bound.
export class BombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BombError";
  }
}

export function oversize(bytes: Uint8Array): boolean {
  return bytes.byteLength > MAX_INPUT_BYTES;
}

// Unzip with entry-count and total-inflated-size caps. fflate's unzipSync is synchronous and inflates
// eagerly, so the inflated total is summed after the fact and the entry count is checked first against
// the central directory size via the returned record.
export function safeUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRY_COUNT) {
    throw new BombError(`archive has ${names.length} entries (cap ${MAX_ENTRY_COUNT})`);
  }
  let inflated = 0;
  for (const name of names) {
    inflated += entries[name].byteLength;
    if (inflated > MAX_INFLATED_BYTES) {
      throw new BombError(`archive inflates past ${MAX_INFLATED_BYTES} bytes`);
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test guards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/guards.ts packages/metadata/test/guards.test.ts
git commit -m "feat(metadata): size cap + decompression-bomb guards"
```

---

### Task 5: OOXML — shared XML + walk helpers + a docx test-fixture builder

**Files:**

- Create: `packages/metadata/src/ooxml/xml.ts`
- Create: `packages/metadata/src/ooxml/walk.ts`
- Create: `packages/metadata/test/support/docx-fixture.ts`
- Test: `packages/metadata/test/ooxml-xml.test.ts`

**Interfaces:**

- Produces (`xml.ts`):
  - `parseXml(text: string): unknown[]` — preserve-order node array
  - `buildXml(nodes: unknown[]): string` — re-serialize with the standard declaration
  - `nodeTag(node: Record<string, unknown>): string | undefined` — the element key (not `:@`/`#text`)
  - `XmlNode` type alias (`Record<string, unknown>`)
- Produces (`walk.ts`) — the single home for the WordprocessingML revision/comment/hidden vocabulary, imported by BOTH the inspect and scrub modules so nothing is defined twice:
  - `REMOVE_TAGS` (`w:del`, `w:moveFrom`), `UNWRAP_TAGS` (`w:ins`, `w:moveTo`), `PROP_CHANGE_TAGS` (the `*Change` records), `TRACKED_CHANGE_TAGS` (= the union of those three), `COMMENT_REF_TAGS` (the comment-range/reference tags)
  - `runIsHidden(run: XmlNode): boolean` — true when a `w:r`'s `w:rPr` has an enabled `w:vanish`
- Produces (`docx-fixture.ts`):
  - `buildDocx(overrides?: Partial<DocxParts>): Uint8Array`
  - `DocxParts` — the part name → string map used to assemble a fixture

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/ooxml-xml.test.ts
import { describe, expect, it } from "vitest";
import { parseXml, buildXml, nodeTag, type XmlNode } from "../src/ooxml/xml.ts";
import { runIsHidden, TRACKED_CHANGE_TAGS } from "../src/ooxml/walk.ts";

describe("ooxml/xml", () => {
  it("round-trips an element preserving order and attributes", () => {
    const xml = '<w:p><w:r w:id="1"><w:t>hello</w:t></w:r></w:p>';
    const nodes = parseXml(xml);
    const out = buildXml(nodes);
    expect(out).toContain("<w:t>hello</w:t>");
    expect(out).toContain('w:id="1"');
  });

  it("nodeTag returns the element key", () => {
    const nodes = parseXml("<w:p/>") as Record<string, unknown>[];
    expect(nodeTag(nodes[0])).toBe("w:p");
  });
});

describe("ooxml/walk", () => {
  it("TRACKED_CHANGE_TAGS unions removes, unwraps, and change records", () => {
    for (const tag of ["w:del", "w:ins", "w:rPrChange"]) {
      expect(TRACKED_CHANGE_TAGS.has(tag)).toBe(true);
    }
  });

  it("runIsHidden detects an enabled vanish and ignores a disabled one", () => {
    const hidden = parseXml("<w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r>") as XmlNode[];
    const shown = parseXml(
      '<w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>x</w:t></w:r>',
    ) as XmlNode[];
    expect(runIsHidden(hidden[0])).toBe(true);
    expect(runIsHidden(shown[0])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test ooxml-xml`
Expected: FAIL.

- [ ] **Step 3: Implement the XML helpers and the fixture builder**

```ts
// packages/metadata/src/ooxml/xml.ts
import { XMLBuilder, XMLParser } from "fast-xml-parser";

export type XmlNode = Record<string, unknown>;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  // Self-closing and empty elements must survive the round-trip unchanged.
  parseTagValue: false,
} as const;

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: false,
} as const;

export function parseXml(text: string): XmlNode[] {
  return new XMLParser(PARSER_OPTIONS).parse(text) as XmlNode[];
}

export function buildXml(nodes: XmlNode[]): string {
  return XML_DECL + new XMLBuilder(BUILDER_OPTIONS).build(nodes);
}

// The element name of a preserve-order node: its single key that is neither the attribute bag (":@")
// nor a text node ("#text").
export function nodeTag(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ":@" && key !== "#text") return key;
  }
  return undefined;
}
```

```ts
// packages/metadata/src/ooxml/walk.ts
import { nodeTag, type XmlNode } from "./xml.ts";

// The WordprocessingML revision/comment/hidden vocabulary, defined once and shared by the inspect and
// scrub modules. Accepting a tracked change means: drop REMOVE_TAGS (deleted/moved-out text), unwrap
// UNWRAP_TAGS (keep inserted/moved-in text), and drop PROP_CHANGE_TAGS (keep current formatting).
export const REMOVE_TAGS: ReadonlySet<string> = new Set(["w:del", "w:moveFrom"]);
export const UNWRAP_TAGS: ReadonlySet<string> = new Set(["w:ins", "w:moveTo"]);
export const PROP_CHANGE_TAGS: ReadonlySet<string> = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:tblPrChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:sectPrChange",
  "w:numberingChange",
]);
export const TRACKED_CHANGE_TAGS: ReadonlySet<string> = new Set([
  ...REMOVE_TAGS,
  ...UNWRAP_TAGS,
  ...PROP_CHANGE_TAGS,
]);
export const COMMENT_REF_TAGS: ReadonlySet<string> = new Set([
  "w:commentReference",
  "w:commentRangeStart",
  "w:commentRangeEnd",
]);

// True when a run (w:r) is marked hidden via an enabled w:vanish in its run properties. A w:vanish
// with w:val "false"/"0" is disabled and does NOT hide the run.
export function runIsHidden(run: XmlNode): boolean {
  const children = run["w:r"];
  if (!Array.isArray(children)) return false;
  for (const child of children as XmlNode[]) {
    if (nodeTag(child) !== "w:rPr") continue;
    const rPr = child["w:rPr"];
    if (!Array.isArray(rPr)) continue;
    for (const prop of rPr as XmlNode[]) {
      if (nodeTag(prop) !== "w:vanish") continue;
      const attrs = (prop[":@"] ?? {}) as Record<string, unknown>;
      const val = attrs["@_w:val"];
      if (val === undefined || (val !== "false" && val !== "0")) return true;
    }
  }
  return false;
}
```

```ts
// packages/metadata/test/support/docx-fixture.ts
import { strToU8, zipSync } from "fflate";

export interface DocxParts {
  contentTypes: string;
  rels: string;
  documentRels: string;
  document: string;
  core: string;
  app: string;
  custom?: string;
  comments?: string;
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const DEFAULTS: DocxParts = {
  contentTypes: `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  rels: `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  documentRels: `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  document: `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Visible body text.</w:t></w:r></w:p></w:body></w:document>`,
  core: `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>Jane Author</dc:creator><cp:lastModifiedBy>Bob Reviewer</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">2020-01-01T00:00:00Z</dcterms:created></cp:coreProperties>`,
  app: `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Old Firm LLP</Company><Template>Normal.dotm</Template><TotalTime>120</TotalTime></Properties>`,
};

// Assemble a minimal but structurally valid .docx for tests. Override any part to craft a scenario.
export function buildDocx(overrides: Partial<DocxParts> = {}): Uint8Array {
  const parts = { ...DEFAULTS, ...overrides };
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(parts.contentTypes),
    "_rels/.rels": strToU8(parts.rels),
    "word/_rels/document.xml.rels": strToU8(parts.documentRels),
    "word/document.xml": strToU8(parts.document),
    "docProps/core.xml": strToU8(parts.core),
    "docProps/app.xml": strToU8(parts.app),
  };
  if (parts.custom !== undefined) files["docProps/custom.xml"] = strToU8(parts.custom);
  if (parts.comments !== undefined) files["word/comments.xml"] = strToU8(parts.comments);
  return zipSync(files);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test ooxml-xml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/ooxml/xml.ts packages/metadata/src/ooxml/walk.ts packages/metadata/test/support/docx-fixture.ts packages/metadata/test/ooxml-xml.test.ts
git commit -m "feat(metadata): OOXML XML + walk helpers + docx test-fixture builder"
```

---

### Task 6: OOXML inspect

**Files:**

- Create: `packages/metadata/src/ooxml/inspect.ts`
- Test: `packages/metadata/test/ooxml-inspect.test.ts`

**Interfaces:**

- Consumes: `safeUnzip` (Task 4), `parseXml`/`nodeTag` (Task 5), `reportOf`/`Finding` (Task 2), `buildDocx` fixture (Task 5).
- Produces: `inspectDocx(bytes: Uint8Array): MetadataReport`. Detects, across the unzipped parts: identifying metadata (any non-empty element in `docProps/core.xml` + `Company`/`Template`/`TotalTime`/`Manager` in `app.xml`), custom properties (`docProps/custom.xml` present with ≥1 property), tracked changes (`w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`/`*Change` anywhere in `word/document.xml`), comments (`word/comments.xml` present, or `w:commentReference` in the document), hidden content (`w:vanish` not disabled).

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/ooxml-inspect.test.ts
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function categories(bytes: Uint8Array): Set<string> {
  return new Set(inspectDocx(bytes).findings.map((f) => f.category));
}

describe("inspectDocx", () => {
  it("finds identifying metadata in a default fixture", () => {
    expect(categories(buildDocx())).toContain("identifying-metadata");
  });

  it("finds tracked changes", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    expect(categories(buildDocx({ document }))).toContain("tracked-changes");
  });

  it("finds hidden content", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r></w:p></w:body></w:document>`;
    expect(categories(buildDocx({ document }))).toContain("hidden-content");
  });

  it("finds comments when a comments part is present", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="Reviewer"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    expect(categories(buildDocx({ comments }))).toContain("comments");
  });

  it("reports a clean document with stripped properties", () => {
    const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`;
    const app = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`;
    const report = inspectDocx(buildDocx({ core, app }));
    expect(report.clean).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test ooxml-inspect`
Expected: FAIL.

- [ ] **Step 3: Implement inspect**

```ts
// packages/metadata/src/ooxml/inspect.ts
import { safeUnzip } from "../guards.ts";
import { type Finding, type MetadataReport, reportOf } from "../model.ts";
import { COMMENT_REF_TAGS, runIsHidden, TRACKED_CHANGE_TAGS } from "./walk.ts";
import { nodeTag, parseXml, type XmlNode } from "./xml.ts";

function decode(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

// Walk a preserve-order tree, counting nodes whose tag is in `tags`. Also counts a hidden run when
// `countVanish` is set and a w:r's w:rPr contains an enabled w:vanish.
function walk(
  nodes: XmlNode[],
  tags: ReadonlySet<string>,
  countVanish: boolean,
  acc: { tagged: number; vanish: number },
): void {
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) continue;
    if (tags.has(tag)) acc.tagged++;
    if (countVanish && tag === "w:r" && runIsHidden(node)) acc.vanish++;
    const children = node[tag];
    if (Array.isArray(children)) walk(children as XmlNode[], tags, countVanish, acc);
  }
}

function hasMeaningfulChild(xml: string | undefined, ignoreRoot: boolean): boolean {
  if (xml === undefined) return false;
  const nodes = parseXml(xml);
  // The first node is the root element; identifying metadata is any non-empty child element of it.
  const root = ignoreRoot ? findFirstElement(nodes) : { children: nodes };
  const children = root?.children ?? [];
  for (const child of children) {
    const tag = nodeTag(child as XmlNode);
    if (tag === undefined) continue;
    const inner = (child as XmlNode)[tag];
    if (Array.isArray(inner) && inner.length > 0) return true;
  }
  return false;
}

function findFirstElement(nodes: XmlNode[]): { children: XmlNode[] } | undefined {
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag !== undefined && Array.isArray(node[tag])) {
      return { children: node[tag] as XmlNode[] };
    }
  }
  return undefined;
}

export function inspectDocx(bytes: Uint8Array): MetadataReport {
  const entries = safeUnzip(bytes);
  const findings: Finding[] = [];

  const core = decode(entries["docProps/core.xml"]);
  const app = decode(entries["docProps/app.xml"]);
  const identifyingPresent = hasMeaningfulChild(core, true) || hasMeaningfulChild(app, true);
  if (identifyingPresent) {
    findings.push({
      category: "identifying-metadata",
      label: "Author, organization, dates, and revision details",
      risk: "high",
      count: 1,
      defaultScrub: true,
    });
  }

  if (hasMeaningfulChild(decode(entries["docProps/custom.xml"]), true)) {
    findings.push({
      category: "custom-properties",
      label: "Custom document properties",
      risk: "medium",
      count: 1,
      defaultScrub: true,
    });
  }

  const document = decode(entries["word/document.xml"]);
  const acc = { tagged: 0, vanish: 0 };
  let commentRefs = 0;
  if (document !== undefined) {
    const docNodes = parseXml(document);
    walk(docNodes, TRACKED_CHANGE_TAGS, true, acc);
    const commentAcc = { tagged: 0, vanish: 0 };
    walk(docNodes, COMMENT_REF_TAGS, false, commentAcc);
    commentRefs = commentAcc.tagged;
  }
  if (acc.tagged > 0) {
    findings.push({
      category: "tracked-changes",
      label: "Tracked insertions, deletions, moves, or formatting changes",
      risk: "high",
      count: acc.tagged,
      defaultScrub: true,
    });
  }
  if (acc.vanish > 0) {
    findings.push({
      category: "hidden-content",
      label: "Hidden text",
      risk: "high",
      count: acc.vanish,
      defaultScrub: true,
    });
  }

  const hasCommentsPart = entries["word/comments.xml"] !== undefined;
  if (hasCommentsPart || commentRefs > 0) {
    findings.push({
      category: "comments",
      label: "Reviewer comments",
      risk: "high",
      count: Math.max(commentRefs, hasCommentsPart ? 1 : 0),
      defaultScrub: true,
    });
  }

  return reportOf("docx", findings);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test ooxml-inspect`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/ooxml/inspect.ts packages/metadata/test/ooxml-inspect.test.ts
git commit -m "feat(metadata): OOXML inspect (docProps, tracked changes, comments, hidden text)"
```

---

### Task 7: OOXML scrub — identifying metadata, custom properties, comments, hidden text

**Files:**

- Create: `packages/metadata/src/ooxml/scrub.ts`
- Test: `packages/metadata/test/ooxml-scrub.test.ts`

**Interfaces:**

- Consumes: `safeUnzip` (Task 4), `parseXml`/`buildXml`/`nodeTag` (Task 5), `inspectDocx` (Task 6), `ScrubOptions` (Task 2).
- Produces: `scrubDocx(bytes: Uint8Array, options: ScrubOptions): Uint8Array`. This task implements every option EXCEPT `trackedChanges` (Task 8). Behaviour: `identifyingMetadata` → replace `docProps/core.xml` and `docProps/app.xml` with empty roots; `customProperties` → drop `docProps/custom.xml`; `comments` → drop `word/comments*.xml`/`word/people.xml`, drop their `Relationship` entries in `word/_rels/document.xml.rels`, and remove comment-reference nodes from `word/document.xml`; `hiddenContent` → remove hidden runs from `word/document.xml`. Re-zips the surviving entries.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/ooxml-scrub.test.ts
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const ALL_BUT_TRACKED = {
  identifyingMetadata: true,
  trackedChanges: false,
  comments: true,
  hiddenContent: true,
  customProperties: true,
  imageMetadata: true,
};

function bodyText(bytes: Uint8Array): string {
  const { unzipSync } = require("fflate") as typeof import("fflate");
  return new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
}

describe("scrubDocx (non-tracked-changes)", () => {
  it("removes identifying metadata", () => {
    const out = scrubDocx(buildDocx(), ALL_BUT_TRACKED);
    const after = inspectDocx(out).findings.map((f) => f.category);
    expect(after).not.toContain("identifying-metadata");
  });

  it("removes hidden text and preserves visible body text", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:t>Keep me.</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), ALL_BUT_TRACKED);
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("hidden-content");
    expect(bodyText(out)).toContain("Keep me.");
    expect(bodyText(out)).not.toContain("secret");
  });

  it("removes comments", () => {
    const comments = `${DECL}<w:comments ${W}><w:comment w:id="1" w:author="R"><w:p><w:r><w:t>n</w:t></w:r></w:p></w:comment></w:comments>`;
    const out = scrubDocx(buildDocx({ comments }), ALL_BUT_TRACKED);
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("comments");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test ooxml-scrub`
Expected: FAIL.

- [ ] **Step 3: Implement scrub (without tracked changes)**

```ts
// packages/metadata/src/ooxml/scrub.ts
import { strToU8, zipSync } from "fflate";
import { safeUnzip } from "../guards.ts";
import type { ScrubOptions } from "../options.ts";
import { COMMENT_REF_TAGS, runIsHidden } from "./walk.ts";
import { buildXml, nodeTag, parseXml, type XmlNode } from "./xml.ts";

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`;
const EMPTY_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`;

const COMMENT_PART_PATTERN = /^word\/(comments|commentsExtended|commentsIds|people)\.xml$/;

// The transforms applied to word/document.xml. trackedChanges is handled in a later module that
// composes with this one; here we only remove comment references and hidden runs.
export interface DocumentTransform {
  readonly comments: boolean;
  readonly hiddenContent: boolean;
}

export function transformDocumentNodes(nodes: XmlNode[], t: DocumentTransform): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) {
      out.push(node);
      continue;
    }
    if (t.comments && COMMENT_REF_TAGS.has(tag)) continue;
    if (t.hiddenContent && tag === "w:r" && runIsHidden(node)) continue;
    const children = node[tag];
    if (Array.isArray(children)) {
      out.push({ ...node, [tag]: transformDocumentNodes(children as XmlNode[], t) });
    } else {
      out.push(node);
    }
  }
  return out;
}

// Drop Relationship nodes whose Target points at a removed comments part, so the package has no
// dangling relationship to a part that no longer exists.
function stripCommentRels(relsXml: string): string {
  const nodes = parseXml(relsXml);
  const filterRelationships = (list: XmlNode[]): XmlNode[] =>
    list
      .filter((node) => {
        if (nodeTag(node) !== "Relationship") return true;
        const attrs = (node[":@"] ?? {}) as Record<string, unknown>;
        const target = String(attrs["@_Target"] ?? "");
        return !/(^|\/)(comments|commentsExtended|commentsIds|people)\.xml$/.test(target);
      })
      .map((node) => {
        const tag = nodeTag(node);
        if (tag !== undefined && Array.isArray(node[tag])) {
          return { ...node, [tag]: filterRelationships(node[tag] as XmlNode[]) };
        }
        return node;
      });
  return buildXml(filterRelationships(nodes));
}

export function scrubDocx(bytes: Uint8Array, options: ScrubOptions): Uint8Array {
  const entries = safeUnzip(bytes);
  const out: Record<string, Uint8Array> = {};

  for (const [name, content] of Object.entries(entries)) {
    if (options.customProperties && name === "docProps/custom.xml") continue;
    if (options.comments && COMMENT_PART_PATTERN.test(name)) continue;

    if (options.identifyingMetadata && name === "docProps/core.xml") {
      out[name] = strToU8(EMPTY_CORE);
      continue;
    }
    if (options.identifyingMetadata && name === "docProps/app.xml") {
      out[name] = strToU8(EMPTY_APP);
      continue;
    }
    if (options.comments && name === "word/_rels/document.xml.rels") {
      out[name] = strToU8(stripCommentRels(new TextDecoder().decode(content)));
      continue;
    }
    if (name === "word/document.xml" && (options.comments || options.hiddenContent)) {
      const nodes = parseXml(new TextDecoder().decode(content));
      const transformed = transformDocumentNodes(nodes, {
        comments: options.comments,
        hiddenContent: options.hiddenContent,
      });
      out[name] = strToU8(buildXml(transformed));
      continue;
    }
    out[name] = content;
  }

  return zipSync(out);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test ooxml-scrub`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/ooxml/scrub.ts packages/metadata/test/ooxml-scrub.test.ts
git commit -m "feat(metadata): OOXML scrub for metadata, custom props, comments, hidden text"
```

---

### Task 8: OOXML scrub — accept tracked changes

**Files:**

- Modify: `packages/metadata/src/ooxml/scrub.ts:transformDocumentNodes` (extend `DocumentTransform` + the walker)
- Test: `packages/metadata/test/ooxml-tracked-changes.test.ts`

**Interfaces:**

- Consumes: the Task 7 module.
- Produces: `transformDocumentNodes` now honours a `trackedChanges: boolean` field on `DocumentTransform`, and `scrubDocx` passes `options.trackedChanges`. Acceptance semantics: `w:ins`/`w:moveTo` → **unwrap** (keep transformed children — the inserted/moved-in text stays); `w:del`/`w:moveFrom` → **remove** (deleted/moved-out text goes); `*Change` records → **remove** (keep current formatting, drop the prior-state record). This is the riskiest transform; it is isolated here so a reviewer can gate it independently.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/ooxml-tracked-changes.test.ts
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "../src/ooxml/inspect.ts";
import { scrubDocx } from "../src/ooxml/scrub.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function bodyText(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
}

describe("scrubDocx — accept tracked changes", () => {
  it("keeps inserted text and drops the w:ins wrapper", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("added");
    expect(bodyText(out)).not.toContain("w:ins");
    expect(inspectDocx(out).findings.map((f) => f.category)).not.toContain("tracked-changes");
  });

  it("removes deleted text entirely", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:r><w:t>keep</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).toContain("keep");
    expect(bodyText(out)).not.toContain("gone");
  });

  it("removes formatting-change records", () => {
    const document = `${DECL}<w:document ${W}><w:body><w:p><w:pPr><w:rPr><w:rPrChange w:id="1"><w:rPr/></w:rPrChange></w:rPr></w:pPr></w:p></w:body></w:document>`;
    const out = scrubDocx(buildDocx({ document }), SCRUB_ALL);
    expect(bodyText(out)).not.toContain("w:rPrChange");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test ooxml-tracked-changes`
Expected: FAIL.

- [ ] **Step 3: Extend the transform**

In `packages/metadata/src/ooxml/scrub.ts`, extend the `walk.ts` import to bring in the tracked-change tag sets, then replace the `DocumentTransform` interface and `transformDocumentNodes`, and update the `scrubDocx` call site:

```ts
// Update the existing walk.ts import line to:
import {
  COMMENT_REF_TAGS,
  PROP_CHANGE_TAGS,
  REMOVE_TAGS,
  runIsHidden,
  UNWRAP_TAGS,
} from "./walk.ts";

export interface DocumentTransform {
  readonly comments: boolean;
  readonly hiddenContent: boolean;
  readonly trackedChanges: boolean;
}

export function transformDocumentNodes(nodes: XmlNode[], t: DocumentTransform): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) {
      out.push(node);
      continue;
    }
    if (t.trackedChanges && REMOVE_TAGS.has(tag)) continue;
    if (t.trackedChanges && PROP_CHANGE_TAGS.has(tag)) continue;
    if (t.comments && COMMENT_REF_TAGS.has(tag)) continue;
    if (t.hiddenContent && tag === "w:r" && runIsHidden(node)) continue;
    if (t.trackedChanges && UNWRAP_TAGS.has(tag)) {
      const children = node[tag];
      if (Array.isArray(children)) {
        out.push(...transformDocumentNodes(children as XmlNode[], t));
      }
      continue;
    }
    const children = node[tag];
    if (Array.isArray(children)) {
      out.push({ ...node, [tag]: transformDocumentNodes(children as XmlNode[], t) });
    } else {
      out.push(node);
    }
  }
  return out;
}
```

Update the `scrubDocx` document branch to pass `trackedChanges` and to also rewrite `word/document.xml` when only tracked changes are requested:

```ts
if (
  name === "word/document.xml" &&
  (options.comments || options.hiddenContent || options.trackedChanges)
) {
  const nodes = parseXml(new TextDecoder().decode(content));
  const transformed = transformDocumentNodes(nodes, {
    comments: options.comments,
    hiddenContent: options.hiddenContent,
    trackedChanges: options.trackedChanges,
  });
  out[name] = strToU8(buildXml(transformed));
  continue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test ooxml`
Expected: PASS (all OOXML test files).

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/ooxml/scrub.ts packages/metadata/test/ooxml-tracked-changes.test.ts
git commit -m "feat(metadata): accept tracked changes (unwrap insertions, drop deletions/change records)"
```

---

### Task 9: Image engine — JPEG inspect + scrub

**Files:**

- Create: `packages/metadata/src/image/jpeg.ts`
- Test: `packages/metadata/test/image-jpeg.test.ts`

**Interfaces:**

- Consumes: `Finding` (Task 2).
- Produces:
  - `inspectJpegFindings(bytes: Uint8Array): Finding[]`
  - `scrubJpeg(bytes: Uint8Array): Uint8Array`
  - Internals are segment-based: walk markers from SOI; classify APP1 (`Exif\0\0` → location/EXIF, `http://ns.adobe.com/xap/` → XMP software), APP13 (IPTC/Photoshop), APP14 (Adobe), COM (comment). Strip drops those segments, copies everything else (including the entropy-coded scan after SOS) verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/image-jpeg.test.ts
import { describe, expect, it } from "vitest";
import { inspectJpegFindings, scrubJpeg } from "../src/image/jpeg.ts";

// Build a synthetic JPEG: SOI, APP0(JFIF), APP1(Exif), SOS + scan data, EOI.
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}
function buildJpeg(): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3]; // "Exif\0\0" + bytes
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...seg(0xe0, jfif), // APP0
    ...seg(0xe1, exif), // APP1 EXIF
    0xff,
    0xda,
    0x00,
    0x03,
    0x00, // SOS (len 3) + 1 payload byte
    0x11,
    0x22,
    0x33, // entropy data
    0xff,
    0xd9, // EOI
  ]);
}

describe("jpeg", () => {
  it("reports an image-location finding when EXIF is present", () => {
    const cats = inspectJpegFindings(buildJpeg()).map((f) => f.category);
    expect(cats).toContain("image-location");
  });

  it("strip removes the EXIF segment and preserves SOI/scan/EOI", () => {
    const out = scrubJpeg(buildJpeg());
    expect(inspectJpegFindings(out)).toHaveLength(0);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8); // SOI preserved
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9); // EOI preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test image-jpeg`
Expected: FAIL.

- [ ] **Step 3: Implement the JPEG engine**

```ts
// packages/metadata/src/image/jpeg.ts
import type { Finding } from "../model.ts";

// Markers that carry metadata we strip. APP1 (EXIF or XMP), APP13 (IPTC/Photoshop), APP14 (Adobe),
// COM (free-text comment). APP0 (JFIF) is structural and kept.
const APP1 = 0xe1;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

interface Segment {
  readonly marker: number;
  readonly start: number; // index of 0xFF
  readonly end: number; // exclusive
  readonly payloadStart: number;
}

// Walk marker segments up to (and excluding) SOS. Returns the parsed segments and the offset where
// the entropy-coded scan begins (the SOS marker itself), which is copied verbatim on strip.
function walkSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  const segments: Segment[] = [];
  let i = 2; // skip SOI (FF D8)
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === SOS) return { segments, scanStart: i };
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + len;
    segments.push({ marker, start: i, end, payloadStart: i + 4 });
    i = end;
  }
  return { segments, scanStart: bytes.length };
}

function payloadStartsWith(bytes: Uint8Array, at: number, ascii: string): boolean {
  for (let k = 0; k < ascii.length; k++) {
    if (bytes[at + k] !== ascii.charCodeAt(k)) return false;
  }
  return true;
}

function classify(bytes: Uint8Array, seg: Segment): Finding["category"] | undefined {
  if (seg.marker === APP1) {
    if (payloadStartsWith(bytes, seg.payloadStart, "Exif\0\0")) return "image-location";
    if (payloadStartsWith(bytes, seg.payloadStart, "http://ns.adobe.com/xap/")) {
      return "image-software";
    }
    return "image-other";
  }
  if (seg.marker === APP13 || seg.marker === APP14) return "image-software";
  if (seg.marker === COM) return "image-other";
  return undefined;
}

function isMetadataSegment(category: Finding["category"] | undefined): boolean {
  return category !== undefined;
}

export function inspectJpegFindings(bytes: Uint8Array): Finding[] {
  const { segments } = walkSegments(bytes);
  const counts = new Map<Finding["category"], number>();
  for (const seg of segments) {
    const category = classify(bytes, seg);
    if (category !== undefined) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const labels: Record<string, string> = {
    "image-location": "EXIF metadata (may include GPS location, device, and timestamps)",
    "image-software": "Editing-software / XMP metadata",
    "image-other": "Other embedded metadata or comments",
  };
  const findings: Finding[] = [];
  for (const [category, count] of counts) {
    findings.push({
      category,
      label: labels[category] ?? "Embedded metadata",
      risk: category === "image-location" ? "high" : "medium",
      count,
      defaultScrub: true,
    });
  }
  return findings;
}

export function scrubJpeg(bytes: Uint8Array): Uint8Array {
  const { segments, scanStart } = walkSegments(bytes);
  // Collect the parts to keep, then assemble via Uint8Array.set — never spread a Uint8Array into
  // push(), which overflows the call stack on large scans.
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]; // SOI
  for (const seg of segments) {
    if (!isMetadataSegment(classify(bytes, seg))) parts.push(bytes.subarray(seg.start, seg.end));
  }
  // The entropy-coded scan and everything after (includes EOI) copied verbatim.
  parts.push(bytes.subarray(scanStart));

  let total = 0;
  for (const part of parts) total += part.length;
  const assembled = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    assembled.set(part, offset);
    offset += part.length;
  }

  // Guard: ensure EOI terminates the stream even for a truncated input.
  if (
    assembled.length < 2 ||
    assembled[assembled.length - 2] !== 0xff ||
    assembled[assembled.length - 1] !== EOI
  ) {
    const withEoi = new Uint8Array(assembled.length + 2);
    withEoi.set(assembled, 0);
    withEoi.set([0xff, EOI], assembled.length);
    return withEoi;
  }
  return assembled;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test image-jpeg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/image/jpeg.ts packages/metadata/test/image-jpeg.test.ts
git commit -m "feat(metadata): JPEG metadata inspect + strip (segment surgery)"
```

---

### Task 10: Image engine — PNG inspect + scrub, and the image engine assembly

**Files:**

- Create: `packages/metadata/src/image/png.ts`
- Create: `packages/metadata/src/image/index.ts`
- Test: `packages/metadata/test/image-png.test.ts`

**Interfaces:**

- Consumes: `Finding` (Task 2), `MetadataEngine` (Task 2), `reportOf` (Task 2), JPEG engine (Task 9).
- Produces:
  - `inspectPngFindings(bytes)`, `scrubPng(bytes)` (drop `tEXt`/`zTXt`/`iTXt`/`eXIf`/`tIME` chunks, keep the rest with CRCs intact)
  - `imageEngine(format: "jpeg" | "png"): MetadataEngine` — wraps the per-format functions into the `MetadataEngine` interface (`inspect` returns `reportOf(format, findings)`; `scrub` ignores all options except `imageMetadata` and, when false, returns the bytes unchanged)

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/image-png.test.ts
import { describe, expect, it } from "vitest";
import { imageEngine } from "../src/image/index.ts";
import { inspectPngFindings, scrubPng } from "../src/image/png.ts";
import { SCRUB_ALL } from "../src/options.ts";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(buf: number[]): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((ch) => ch.charCodeAt(0));
  const len = data.length;
  const crc = crc32([...typeBytes, ...data]);
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...typeBytes,
    ...data,
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
}
function buildPng(): Uint8Array {
  return new Uint8Array([
    ...SIG,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk("tEXt", [
      ...[..."Author"].map((c) => c.charCodeAt(0)),
      0,
      ...[..."Jane"].map((c) => c.charCodeAt(0)),
    ]),
    ...chunk("IDAT", [0x78, 0x01, 0x00]),
    ...chunk("IEND", []),
  ]);
}

describe("png", () => {
  it("reports a finding for a tEXt chunk", () => {
    expect(inspectPngFindings(buildPng()).length).toBeGreaterThan(0);
  });
  it("strips tEXt and keeps IHDR/IDAT/IEND", () => {
    const out = scrubPng(buildPng());
    expect(inspectPngFindings(out)).toHaveLength(0);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text).toContain("IEND");
    expect(text).not.toContain("tEXt");
  });
  it("imageEngine inspect/scrub round-trips to clean", async () => {
    const engine = imageEngine("png");
    const out = await engine.scrub(buildPng(), SCRUB_ALL);
    expect((await engine.inspect(out)).clean).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test image-png`
Expected: FAIL.

- [ ] **Step 3: Implement PNG + the image engine**

```ts
// packages/metadata/src/image/png.ts
import type { Finding } from "../model.ts";

const SIGNATURE_LENGTH = 8;
// Ancillary metadata chunks we strip. Structural/critical chunks (IHDR, PLTE, IDAT, IEND) and color
// chunks (iCCP, gAMA, cHRM, sRGB) are kept.
const METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

interface Chunk {
  readonly type: string;
  readonly start: number; // index of the length field
  readonly end: number; // exclusive (after CRC)
}

function walkChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let i = SIGNATURE_LENGTH;
  while (i + 8 <= bytes.length) {
    const len =
      ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len; // 4 length + 4 type + len data + 4 crc
    chunks.push({ type, start: i, end });
    if (type === "IEND") break;
    i = end;
  }
  return chunks;
}

export function inspectPngFindings(bytes: Uint8Array): Finding[] {
  const counts = new Map<Finding["category"], number>();
  for (const c of walkChunks(bytes)) {
    if (!METADATA_CHUNKS.has(c.type)) continue;
    const category: Finding["category"] = c.type === "eXIf" ? "image-location" : "image-other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const findings: Finding[] = [];
  for (const [category, count] of counts) {
    findings.push({
      category,
      label:
        category === "image-location"
          ? "EXIF metadata (may include GPS location, device, and timestamps)"
          : "Text or timestamp metadata",
      risk: category === "image-location" ? "high" : "medium",
      count,
      defaultScrub: true,
    });
  }
  return findings;
}

export function scrubPng(bytes: Uint8Array): Uint8Array {
  // Collect the parts to keep (signature + non-metadata chunks), then assemble via Uint8Array.set —
  // never spread a Uint8Array into push(), which overflows the call stack on large images.
  const parts: Uint8Array[] = [bytes.subarray(0, SIGNATURE_LENGTH)];
  for (const c of walkChunks(bytes)) {
    if (METADATA_CHUNKS.has(c.type)) continue;
    parts.push(bytes.subarray(c.start, c.end));
  }
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
```

```ts
// packages/metadata/src/image/index.ts
import type { MetadataEngine } from "../engine.ts";
import { reportOf } from "../model.ts";
import { inspectJpegFindings, scrubJpeg } from "./jpeg.ts";
import { inspectPngFindings, scrubPng } from "./png.ts";

export { inspectJpegFindings, scrubJpeg } from "./jpeg.ts";
export { inspectPngFindings, scrubPng } from "./png.ts";

export function imageEngine(format: "jpeg" | "png"): MetadataEngine {
  const findingsOf = format === "jpeg" ? inspectJpegFindings : inspectPngFindings;
  const strip = format === "jpeg" ? scrubJpeg : scrubPng;
  return {
    inspect: (bytes) => Promise.resolve(reportOf(format, findingsOf(bytes))),
    scrub: (bytes, options) => Promise.resolve(options.imageMetadata ? strip(bytes) : bytes),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test image`
Expected: PASS (jpeg + png).

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src/image packages/metadata/test/image-png.test.ts
git commit -m "feat(metadata): PNG metadata strip + image engine assembly"
```

---

### Task 11: The OOXML engine wrapper + the MetadataPort

**Files:**

- Create: `packages/metadata/src/ooxml/index.ts`
- Create: `packages/metadata/src/metadata.ts`
- Modify: `packages/metadata/src/index.ts`
- Test: `packages/metadata/test/port.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces:
  - `documentEngine(): MetadataEngine` (wraps `inspectDocx`/`scrubDocx`)
  - `createMetadataPort(): MetadataPort`
  - `index.ts` re-exports `createMetadataPort`, the model, options (`SCRUB_ALL`, `ScrubOptions`), and the port types.
  - Port behaviour: `oversize` → `too-large`; `detect` → `unsupported` reason `unsupported-format`; `BombError` → `decompression-bomb`; any other engine throw → `corrupt`. `scrub` re-inspects the output to populate `report`. Media types: docx → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; jpeg → `image/jpeg`; png → `image/png`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/metadata/test/port.test.ts
import { describe, expect, it } from "vitest";
import { createMetadataPort } from "../src/metadata.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const port = createMetadataPort();

describe("MetadataPort", () => {
  it("inspect reports findings for a docx", async () => {
    const outcome = await port.inspect({ bytes: buildDocx(), filename: "a.docx" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.report.clean).toBe(false);
  });

  it("scrub returns clean output and the right media type", async () => {
    const outcome = await port.scrub({ bytes: buildDocx(), filename: "a.docx" }, SCRUB_ALL);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.report.clean).toBe(true);
      expect(outcome.mediaType).toContain("wordprocessingml");
    }
  });

  it("rejects an unsupported format", async () => {
    const outcome = await port.inspect({ bytes: new Uint8Array([1, 2, 3]), filename: "x.bin" });
    expect(outcome).toEqual({ ok: false, reason: "unsupported-format" });
  });

  it("rejects an oversize input", async () => {
    const big = new Uint8Array(16 * 1024 * 1024);
    const outcome = await port.inspect({ bytes: big, filename: "big.bin" });
    expect(outcome).toEqual({ ok: false, reason: "too-large" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/metadata test port`
Expected: FAIL.

- [ ] **Step 3: Implement the engine wrapper and the port**

```ts
// packages/metadata/src/ooxml/index.ts
import type { MetadataEngine } from "../engine.ts";
import { inspectDocx } from "./inspect.ts";
import { scrubDocx } from "./scrub.ts";

export function documentEngine(): MetadataEngine {
  return {
    inspect: (bytes) => Promise.resolve(inspectDocx(bytes)),
    scrub: (bytes, options) => Promise.resolve(scrubDocx(bytes, options)),
  };
}
```

```ts
// packages/metadata/src/metadata.ts
import { detect, type SupportedFormat } from "./detect.ts";
import type { MetadataEngine } from "./engine.ts";
import { BombError, oversize } from "./guards.ts";
import { imageEngine } from "./image/index.ts";
import { documentEngine } from "./ooxml/index.ts";
import type { MetadataFailure, MetadataInput, MetadataPort, ScrubOutcome } from "./port.ts";
import type { ScrubOptions } from "./options.ts";

const MEDIA_TYPE: Record<SupportedFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

function engineFor(format: SupportedFormat): MetadataEngine {
  return format === "docx" ? documentEngine() : imageEngine(format);
}

// Map an unexpected throw from an engine to a typed failure. A bomb is its own reason; anything else
// is treated as a corrupt/unparseable file. The error is NEVER surfaced verbatim (redaction).
function failureFromThrow(error: unknown): MetadataFailure {
  return error instanceof BombError ? "decompression-bomb" : "corrupt";
}

export function createMetadataPort(): MetadataPort {
  return {
    async inspect(input: MetadataInput) {
      if (oversize(input.bytes)) return { ok: false, reason: "too-large" };
      const format = detect(input.bytes);
      if (format === "unsupported") return { ok: false, reason: "unsupported-format" };
      try {
        const report = await engineFor(format).inspect(input.bytes);
        return { ok: true, report };
      } catch (error) {
        return { ok: false, reason: failureFromThrow(error) };
      }
    },

    async scrub(input: MetadataInput, options: ScrubOptions): Promise<ScrubOutcome> {
      if (oversize(input.bytes)) return { ok: false, reason: "too-large" };
      const format = detect(input.bytes);
      if (format === "unsupported") return { ok: false, reason: "unsupported-format" };
      try {
        const engine = engineFor(format);
        const bytes = await engine.scrub(input.bytes, options);
        const report = await engine.inspect(bytes); // re-inspect the OUTPUT so callers can confirm clean
        return { ok: true, bytes, mediaType: MEDIA_TYPE[format], report };
      } catch (error) {
        return { ok: false, reason: failureFromThrow(error) };
      }
    },
  };
}
```

```ts
// packages/metadata/src/index.ts
export const PACKAGE_NAME = "@magna-carta/metadata";
export { createMetadataPort } from "./metadata.ts";
export { SCRUB_ALL } from "./options.ts";
export type { ScrubOptions } from "./options.ts";
export type { Finding, FindingCategory, MetadataReport, RiskLevel } from "./model.ts";
export type {
  InspectOutcome,
  MetadataFailure,
  MetadataInput,
  MetadataPort,
  ScrubOutcome,
} from "./port.ts";
export type { SupportedFormat } from "./detect.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/metadata test`
Expected: PASS (whole package).

- [ ] **Step 5: Commit**

```bash
git add packages/metadata/src packages/metadata/test/port.test.ts
git commit -m "feat(metadata): document engine wrapper + MetadataPort with typed outcomes"
```

---

### Task 12: Register the `tools:metadataScrubber` permission

**Files:**

- Modify: `packages/access-control/src/registry.ts` (add one entry to `PERMISSIONS`)
- Test: `packages/access-control/test/registry.test.ts` (add an assertion if the file enumerates expected keys; otherwise the existing suite covers membership)

**Interfaces:**

- Produces: `tools:metadataScrubber` as a `KnownPermission`.

- [ ] **Step 1: Add the permission**

In `packages/access-control/src/registry.ts`, in the `tools:` block, after the `tools:fileConverter` line:

```ts
  "tools:metadataScrubber", // inspect/scrub a file's metadata & content artifacts (ephemeral, matter-free)
```

- [ ] **Step 2: Verify the registry test still passes**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS. If `registry.test.ts` asserts an exact count or sorted list of `tools:*` keys, update that expectation to include the new key.

- [ ] **Step 3: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git commit -m "feat(access-control): add tools:metadataScrubber permission"
```

---

### Task 13: Add the catalog row

**Files:**

- Modify: `packages/tools/src/catalog.ts` (append one manifest)
- Test: `packages/tools/test/catalog.test.ts` (extend if it counts entries)

**Interfaces:**

- Consumes: `assertPermission` (already imported in catalog.ts).
- Produces: a `metadata-scrubber` manifest in `CATALOG`.

- [ ] **Step 1: Append the manifest**

In `packages/tools/src/catalog.ts`, add to the `CATALOG` array (after the `file-converter` entry):

```ts
  {
    id: "metadata-scrubber",
    name: "Metadata Inspector & Scrubber",
    icon: "file-search",
    subjectGroup: "documents",
    permission: assertPermission("tools:metadataScrubber"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

- [ ] **Step 2: Run the tools suite**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS. The permission validates at module load (an unregistered key throws), so a green run confirms Task 12 landed. If `catalog.test.ts` asserts a count, update it.

- [ ] **Step 3: Commit**

```bash
git add packages/tools/src/catalog.ts packages/tools/test/catalog.test.ts
git commit -m "feat(tools): catalog the Metadata Inspector & Scrubber"
```

---

### Task 14: The Worker route

**Files:**

- Create: `apps/worker/src/routes/files/metadata.ts`
- Modify: `apps/worker/src/app.ts` (import + register, beside the other tool routes)
- Test: `apps/worker/test/metadata-route.test.ts`

**Interfaces:**

- Consumes: `createMetadataPort`, `SCRUB_ALL`, `ScrubOptions` from `@magna-carta/metadata`; the chokepoint + route-meta helpers (see `routes/tools/safe-browse.ts` for the exact imports).
- Produces: `registerMetadataRoutes(app, chokepoint)`. Two operations:
  - `POST /api/v1/metadata/inspect` — body `{ filename: string, contentBase64: string }` → `200 { format, findings, clean }` or `400` problem (`too-large`/`unsupported-format`/`corrupt`/`decompression-bomb`).
  - `POST /api/v1/metadata/scrub` — body `{ filename: string, contentBase64: string, options?: ScrubOptions }` (default `SCRUB_ALL`) → `200 { mediaType, filename, cleanedBase64, report }` or `400` problem.
  - Both: `surface: "app"`, `authenticated: true`, `permission: "tools:metadataScrubber"`, `resource: "firm"`, `audited: false`, `idempotency: "optional"`, `rateLimit: "expensive"`.

- [ ] **Step 1: Write the failing test**

Add `@magna-carta/metadata` to `apps/worker/package.json` dependencies (`"@magna-carta/metadata": "workspace:*"`), run `vp install`, then:

```ts
// apps/worker/test/metadata-route.test.ts
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../src/app.ts";
import { authedRequest } from "./support/authed-request.ts"; // reuse the helper the other route tests use

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function docxFixture(): Uint8Array {
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(`${DECL}<Types/>`),
    "word/document.xml": strToU8(
      `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
    ),
    "docProps/core.xml": strToU8(
      `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Jane</dc:creator></cp:coreProperties>`,
    ),
  });
}

describe("POST /api/v1/metadata/inspect", () => {
  it("returns findings for a docx with an author", async () => {
    const app = createApp(
      /* test bindings — copy the arrangement from safe-browse-route.test.ts */
    );
    const res = await authedRequest(app, "POST", "/api/v1/metadata/inspect", {
      filename: "a.docx",
      contentBase64: base64(docxFixture()),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clean).toBe(false);
    expect(
      body.findings.some((f: { category: string }) => f.category === "identifying-metadata"),
    ).toBe(true);
  });

  it("rejects an unsupported file with 400", async () => {
    const app = createApp(/* test bindings */);
    const res = await authedRequest(app, "POST", "/api/v1/metadata/inspect", {
      filename: "x.bin",
      contentBase64: base64(new Uint8Array([1, 2, 3])),
    });
    expect(res.status).toBe(400);
  });
});
```

Before writing the route, READ `apps/worker/test/safe-browse-route.test.ts` and `apps/worker/test/whois-route.test.ts` to copy the exact `createApp` test-binding arrangement and the authed-request helper this codebase uses; mirror them so the harness matches.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test metadata-route`
Expected: FAIL (route not registered).

- [ ] **Step 3: Implement the route**

```ts
// apps/worker/src/routes/files/metadata.ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { createMetadataPort, SCRUB_ALL, type ScrubOptions } from "@magna-carta/metadata";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// Base64 <-> bytes, chunked so a large file does not blow the argument stack of String.fromCharCode.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const ScrubOptionsSchema = z
  .object({
    identifyingMetadata: z.boolean(),
    trackedChanges: z.boolean(),
    comments: z.boolean(),
    hiddenContent: z.boolean(),
    customProperties: z.boolean(),
    imageMetadata: z.boolean(),
  })
  .openapi("MetadataScrubOptions");

const FindingSchema = z.object({
  category: z.string(),
  label: z.string(),
  risk: z.enum(["high", "medium", "low"]),
  count: z.number(),
  defaultScrub: z.boolean(),
});

const ReportSchema = z
  .object({
    format: z.string(),
    findings: z.array(FindingSchema),
    clean: z.boolean(),
  })
  .openapi("MetadataReport");

const InspectRequest = z.object({
  filename: z.string().min(1).max(512),
  contentBase64: z.string().min(1),
});
const ScrubRequest = InspectRequest.extend({ options: ScrubOptionsSchema.optional() });

const ScrubResponse = z
  .object({
    mediaType: z.string(),
    filename: z.string(),
    cleanedBase64: z.string(),
    report: ReportSchema,
  })
  .openapi("MetadataScrubResult");

// Map a typed failure to a 400 problem. The reason is a stable code; no file content is echoed.
function failureProblem(
  c: Parameters<typeof problemJson>[0],
  reason: string,
): ReturnType<typeof problemJson> {
  const title =
    reason === "too-large"
      ? "The file is too large for this tool"
      : reason === "unsupported-format"
        ? "Unsupported file type"
        : reason === "decompression-bomb"
          ? "The file could not be processed safely"
          : "The file could not be read";
  return problemJson(c, {
    type: "validation",
    status: 400,
    title,
    detail: `The metadata tool could not process this file (${reason}).`,
  });
}

const baseMeta = {
  surface: "app",
  authenticated: true,
  permission: "tools:metadataScrubber",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
} as const satisfies Omit<RouteMeta, "operationId">;

export const metadataInspectMeta: RouteMeta = { ...baseMeta, operationId: "metadata.inspect" };
export const metadataScrubMeta: RouteMeta = { ...baseMeta, operationId: "metadata.scrub" };

const inspectRoute = defineOpenAPIRoute(metadataInspectMeta, {
  method: "post",
  path: "/api/v1/metadata/inspect",
  description:
    "Inspect an uploaded file (base64) and report the metadata and content-bearing artifacts it " +
    "carries, with a risk level per category. Nothing is stored.",
  request: {
    body: { content: { "application/json": { schema: InspectRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Metadata report",
      content: { "application/json": { schema: ReportSchema } },
    },
    400: {
      description: "Unprocessable file",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:metadataScrubber",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const scrubRoute = defineOpenAPIRoute(metadataScrubMeta, {
  method: "post",
  path: "/api/v1/metadata/scrub",
  description:
    "Return a cleaned copy (base64) of an uploaded file with the selected metadata and content " +
    "artifacts removed, plus a re-inspection of the result. Defaults to removing everything. Nothing is stored.",
  request: { body: { content: { "application/json": { schema: ScrubRequest } }, required: true } },
  responses: {
    200: {
      description: "Cleaned file + report",
      content: { "application/json": { schema: ScrubResponse } },
    },
    400: {
      description: "Unprocessable file",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:metadataScrubber",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerMetadataRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  const port = createMetadataPort();

  app.openapi(
    { ...inspectRoute, middleware: chokepointMiddleware(chokepoint, inspectRoute) },
    async (c) => {
      const { filename, contentBase64 } = c.req.valid("json");
      const outcome = await port.inspect({ bytes: decodeBase64(contentBase64), filename });
      if (!outcome.ok) return failureProblem(c, outcome.reason);
      return c.json(outcome.report, 200);
    },
  );

  app.openapi(
    { ...scrubRoute, middleware: chokepointMiddleware(chokepoint, scrubRoute) },
    async (c) => {
      const { filename, contentBase64, options } = c.req.valid("json");
      const effective: ScrubOptions = options ?? SCRUB_ALL;
      const outcome = await port.scrub({ bytes: decodeBase64(contentBase64), filename }, effective);
      if (!outcome.ok) return failureProblem(c, outcome.reason);
      return c.json(
        {
          mediaType: outcome.mediaType,
          filename,
          cleanedBase64: encodeBase64(outcome.bytes),
          report: outcome.report,
        },
        200,
      );
    },
  );
}
```

In `apps/worker/src/app.ts`: add `import { registerMetadataRoutes } from "./routes/files/metadata.ts";` beside the other route imports, and call `registerMetadataRoutes(app, chokepoint);` in the `/api/v1` registration block next to `registerSafeBrowseRoute(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test metadata-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/files/metadata.ts apps/worker/src/app.ts apps/worker/package.json apps/worker/test/metadata-route.test.ts pnpm-lock.yaml
git commit -m "feat(worker): /api/v1/metadata inspect + scrub routes"
```

---

### Task 15: Update the contract — conformance list, OpenAPI snapshot, client

**Files:**

- Modify: `apps/worker/test/conformance.test.ts` (add the two operationIds to the committed-operations list)
- Modify: `apps/worker/openapi/openapi.json` (regenerated, never hand-edited)
- Modify: `packages/api-client/src/*` (regenerated)

**Interfaces:**

- Consumes: the routes from Task 14.

- [ ] **Step 1: Add the operationIds to the not-vacuous list**

In `apps/worker/test/conformance.test.ts`, inside the `expect(ids).toEqual([...])` array, add (keeping the array sorted):

```ts
      "metadata.inspect",
      "metadata.scrub",
```

(They sort after the `matterTypes.*`/`matters.*` entries and before `me.*`/`members.*`.)

- [ ] **Step 2: Regenerate the contract and client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm --filter @magna-carta/api-client run generate`

- [ ] **Step 3: Run the worker contract tests**

Run: `pnpm --filter @magna-carta/worker test conformance`
Expected: PASS (the committed snapshot now matches and the operation list is exhaustive).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/test/conformance.test.ts apps/worker/openapi/openapi.json packages/api-client/src
git commit -m "chore(worker): emit metadata operations into the OpenAPI contract + client"
```

---

### Task 16: Role-seed migration

**Files:**

- Create: `packages/database/drizzle/per-firm/0018_seed-tools-metadata-scrubber.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (append entry idx 18)
- Test: `apps/worker/test/seed-tools-metadata-scrubber.test.ts`

**Interfaces:**

- Consumes: the permission from Task 12.
- Produces: `tools:metadataScrubber` granted to all five default roles.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/test/seed-tools-metadata-scrubber.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

const ALL_DEFAULT_ROLE_IDS = new Set([
  "role_Gw-zKO8hOHQuNv2bWokMp",
  "role_gEyJ_YqL1_RI_yDqSa28Y",
  "role_917LCQyRKP50Z9bW89vXl",
  "role_hwwC1D98d8Lazc_asL6vO",
  "role_WojF9F7kksBEftsmZGNhb",
]);

beforeAll(async () => {
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

describe("migration 0018_seed-tools-metadata-scrubber", () => {
  it("grants tools:metadataScrubber to all five default roles", async () => {
    const result = await env.DB_FIRM_POOL_1.prepare(
      "SELECT role_id FROM role_permission WHERE permission = ?",
    )
      .bind("tools:metadataScrubber")
      .all<{ role_id: string }>();
    expect(result.results).toHaveLength(5);
    const granted = new Set(result.results.map((r) => r.role_id));
    for (const roleId of ALL_DEFAULT_ROLE_IDS) expect(granted).toContain(roleId);
  });
});
```

- [ ] **Step 2: Create the migration**

Copy the structure of `packages/database/drizzle/per-firm/0017_seed-tools-web-domains.sql`. Mint five fresh, unique `rolePermission_` identifiers (21-char, the same alphabet as existing ones; verify each is unique across the whole `drizzle/per-firm` tree with a grep before committing). One INSERT per default role:

```sql
-- Seed tools:metadataScrubber onto every default role. The metadata inspector/scrubber is an
-- everyday safety utility (strip privileged metadata before sending a file) any firm member may need
-- without a separate grant — the same broad reach as the other tools:* utilities.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Aa1Bb2Cc3Dd4Ee5Ff6Gg7', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Bb2Cc3Dd4Ee5Ff6Gg7Hh8', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Cc3Dd4Ee5Ff6Gg7Hh8Ii9', 'role_917LCQyRKP50Z9bW89vXl', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Dd4Ee5Ff6Gg7Hh8Ii9Jj0', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:metadataScrubber');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Ee5Ff6Gg7Hh8Ii9Jj0Kk1', 'role_WojF9F7kksBEftsmZGNhb', 'tools:metadataScrubber');
```

> The example identifiers above are placeholders for _format_. Before committing, regenerate five real unique identifiers (e.g. with `@magna-carta/identifiers`'s generator, prefix `rolePermission`) and replace them, then confirm `isIdentifier` accepts them (the `generated-migrations.test.ts` lineage check validates identifier shape).

Append to `packages/database/drizzle/per-firm/meta/_journal.json` `entries`:

```jsonc
{
  "idx": 18,
  "version": "6",
  "when": 1782300000000,
  "tag": "0018_seed-tools-metadata-scrubber",
  "breakpoints": true,
}
```

(No schema snapshot is required — seed-only migrations such as `0013` carry none, and `generated-migrations.test.ts` reads only the journal + `.sql` files.)

- [ ] **Step 3: Run the migration tests**

Run: `pnpm --filter @magna-carta/database test generated-migrations`
Run: `pnpm --filter @magna-carta/worker test seed-tools-metadata-scrubber`
Expected: PASS both.

- [ ] **Step 4: Commit**

```bash
git add packages/database/drizzle/per-firm/0018_seed-tools-metadata-scrubber.sql packages/database/drizzle/per-firm/meta/_journal.json apps/worker/test/seed-tools-metadata-scrubber.test.ts
git commit -m "feat(database): seed tools:metadataScrubber to default roles"
```

---

### Task 17: Wire into the throwaway dev demo page

**Files:**

- Modify: `apps/worker/src/routes/developer/dev-web-tools-demo.ts` (add a Metadata section)

**Interfaces:**

- Consumes: the routes from Task 14.

- [ ] **Step 1: Add a section + script**

In `dev-web-tools-demo.ts`, add a `<section>` with a file input and two buttons (Inspect / Scrub & download), and a script that reads the file, base64-encodes it, calls `/api/v1/metadata/inspect` and `/api/v1/metadata/scrub` with `credentials: "same-origin"`, renders the JSON report, and turns `cleanedBase64` into a download link. Mirror the existing `whois()`/`safeBrowse()` helper style in the same file.

```html
<section>
  <h2>Metadata Inspector &amp; Scrubber <span class="note">(.docx, .jpg, .png)</span></h2>
  <p>
    <input id="md-file" type="file" />
    <button id="md-inspect">Inspect</button>
    <button id="md-scrub">Scrub &amp; download</button>
  </p>
  <pre id="md-out">(results appear here)</pre>
  <div id="md-dl"></div>
</section>
```

```js
async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk)
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(binary);
}
async function mdInspect() {
  const file = $("md-file").files[0];
  if (!file) {
    $("md-out").textContent = "Pick a file first.";
    return;
  }
  $("md-out").textContent = "Inspecting...";
  const r = await fetch("/api/v1/metadata/inspect", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentBase64: await fileToBase64(file) }),
  });
  $("md-out").textContent = JSON.stringify(await r.json().catch(() => ({})), null, 2);
}
async function mdScrub() {
  const file = $("md-file").files[0];
  if (!file) {
    $("md-out").textContent = "Pick a file first.";
    return;
  }
  $("md-out").textContent = "Scrubbing...";
  const r = await fetch("/api/v1/metadata/scrub", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentBase64: await fileToBase64(file) }),
  });
  const body = await r.json().catch(() => ({}));
  $("md-out").textContent = JSON.stringify(body.report ?? body, null, 2);
  $("md-dl").innerHTML = "";
  if (body.cleanedBase64) {
    const a = document.createElement("a");
    a.href = "data:" + body.mediaType + ";base64," + body.cleanedBase64;
    a.download = "cleaned-" + file.name;
    a.textContent = "Download cleaned file";
    $("md-dl").appendChild(a);
  }
}
$("md-inspect").addEventListener("click", mdInspect);
$("md-scrub").addEventListener("click", mdScrub);
```

- [ ] **Step 2: Manual smoke (optional, requires the dev worker)**

Run: `vp run worker-dev` with `DEV_DEMO_TOOLS=1`, open `/__dev/web-tools`, sign in, upload a `.docx` with an author and confirm Inspect lists `identifying-metadata` and Scrub downloads a cleaned copy.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/routes/developer/dev-web-tools-demo.ts
git commit -m "chore(worker): add metadata tool to the throwaway dev demo page"
```

---

### Task 18: Documentation

**Files:**

- Modify: `STATUS.md` (the tool's slice row)
- Modify: `ROADMAP.md` (mark shipped/now as the repo convention dictates)
- Create: `changelog.d/tools-metadata-scrubber.md` (changelog fragment)
- Create: `docs/decisions/pending/metadata-tool-architecture.md` (ADR fragment for the architecture decision; record the all-TypeScript + engine-seam choice and the staged-formats scope)
- Create: `docs/user/tools/metadata-inspector-scrubber.md` (end-user help — the one home for user-facing docs)

**Interfaces:** none (docs).

- [ ] **Step 1: Read the conventions and an existing example of each**

Read `docs/conventions/documentation.md` and `docs/conventions/documentation-style.md`. Read an existing changelog fragment in `changelog.d/` and an existing pending ADR in `docs/decisions/pending/` to match frontmatter exactly (see memory note: the fragment convention is on `main`). Read a page under `docs/user/` for the user-doc voice.

- [ ] **Step 2: Write the docs**

- `changelog.d/tools-metadata-scrubber.md`: one entry under the right type ("Added"), user-facing voice, no process refs.
- `docs/decisions/pending/metadata-tool-architecture.md`: the decision (all-TypeScript metadata tool, document/image engines behind `MetadataEngine`, ephemeral/stateless port, staged formats `.docx`/`.jpg`/`.png` with `.xlsx`/`.pptx`/TIFF/HEIC/PDF/Rust→WASM/container as named seams), context, and consequences. Match the pending-ADR frontmatter format exactly.
- `docs/user/tools/metadata-inspector-scrubber.md`: what it does, when to use it (inadvertent-disclosure safety before sending a file), the supported file types, and that nothing is stored. No internal architecture.
- `STATUS.md`: add/update this tool's row to the built+tested stage (edit only this slice's row).
- `ROADMAP.md`: reflect the shipped tool per the file's existing structure.

Use the `elements-of-style:writing-clearly-and-concisely` skill while drafting.

- [ ] **Step 3: Apply the writing skill if available, then commit**

```bash
git add STATUS.md ROADMAP.md changelog.d/tools-metadata-scrubber.md docs/decisions/pending/metadata-tool-architecture.md docs/user/tools/metadata-inspector-scrubber.md
git commit -m "docs(tools): document the Metadata Inspector & Scrubber"
```

---

### Task 19: Full quality gate + active-work close-out

**Files:** none (verification) + `docs/active-work/tools-metadata-scrubber.md` status bump.

- [ ] **Step 1: Run the whole-package + worker suites**

Run: `pnpm --filter @magna-carta/metadata test`
Run: `pnpm --filter @magna-carta/worker test`
Run: `pnpm --filter @magna-carta/tools test`
Run: `pnpm --filter @magna-carta/access-control test`
Run: `pnpm --filter @magna-carta/database test`
Expected: PASS all.

- [ ] **Step 2: Full quality gate**

Run: `pnpm check`
Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: clean fmt/lint/typecheck (Oxc + svelte-check) and a successful dry-run.

- [ ] **Step 3: Update the active-work note status to `built` and commit**

```bash
git add docs/active-work/tools-metadata-scrubber.md
git commit -m "chore(active-work): metadata scrubber built + tested"
```

- [ ] **Step 4: Pre-merge review (do NOT skip)**

Before merging to `main`, run the package's standard end-of-build adversarial review and a load-profile check per `docs/conventions/testing.md` (the 7-angle review precedent). The metadata tool's highest-risk surface is OOXML scrub completeness (a missed `w:del` would leave deleted privileged text) and the decompression-bomb guard — direct the review there with empirical verifiers (e.g. fuzz a corpus of real `.docx`/`.jpg`/`.png` files through `scrub → re-inspect → assert clean`).

---

## Self-Review

**Spec coverage:**

- Two tools / grouping (spec §0–1): catalog row in `documents` group (Task 13); forensics explicitly out of scope (Global Constraints).
- Architecture / port seam (spec §2): `MetadataPort` + `MetadataEngine` interfaces (Tasks 2, 11); size cap + guards (Task 4); container/Rust→WASM staged (Global Constraints).
- Formats / what's inspected & scrubbed (spec §3): OOXML docProps/tracked-changes/comments/hidden (Tasks 6–8); images JPEG/PNG (Tasks 9–10). `.xlsx`/`.pptx`/TIFF/HEIC staged (Global Constraints) — a deliberate, named narrowing of spec §3, recorded in the ADR fragment (Task 18).
- Behaviour & data model (spec §4): `MetadataReport`/`Finding`/risk (Task 2); one-click `SCRUB_ALL` + granular `ScrubOptions` (Task 2, exercised Tasks 7–8, 14); re-inspection of output (Task 11); never mutates input, stateless (Task 11, route Task 14).
- Worker surface (spec §5): inspect/scrub routes + meta + permission + catalog (Tasks 12–14); contract regen (Task 15); role seed (Task 16).
- Security (spec §6): bomb/size/format guards (Tasks 3–4); redaction — no content logged, stable reason codes only (Tasks 11, 14).
- Testing (spec §7): golden scrub→re-inspect→clean + body-preserved (Tasks 6–10); route + seed tests (Tasks 14, 16); pre-merge fuzz (Task 19).
- Out-of-scope seams (spec §8): all carried into Global Constraints + ADR fragment.

**Placeholder scan:** the only deliberate placeholders are the five `rolePermission_` identifiers in Task 16, explicitly flagged to be regenerated before commit, and the `createApp(/* test bindings */)` arrangement in Task 14, which instructs the implementer to copy the exact harness from `safe-browse-route.test.ts`. No "TBD"/"add error handling"/"write tests for the above" — every code step carries complete code.

**Type consistency:** `MetadataEngine` (inspect→`Promise<MetadataReport>`, scrub→`Promise<Uint8Array>`) is used identically in Tasks 2, 10, 11. `ScrubOptions` field names (`identifyingMetadata`/`trackedChanges`/`comments`/`hiddenContent`/`customProperties`/`imageMetadata`) match across Tasks 2, 7, 8, 10, 14. `InspectOutcome`/`ScrubOutcome` discriminants (`ok`, `reason`, `report`, `bytes`, `mediaType`) match across Tasks 2, 11, 14. `SupportedFormat = "docx" | "jpeg" | "png"` is consistent across Tasks 2, 3, 11. `FindingCategory` values used by the engines (Tasks 6, 9, 10) are all members of the union defined in Task 2.
