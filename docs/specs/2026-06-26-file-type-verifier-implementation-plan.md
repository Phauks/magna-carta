# File Type Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tools-area utility that identifies a file's true content type (Google Magika), flags when the filename's extension lies about the content, and recommends an extension when one is missing or wrong.

**Architecture:** Magika (native Rust crate, embedded model) runs as a second capability of the existing untrusted-byte scan subsystem — a new `/identify` route in the scan Container behind `apps/scan-worker`. The Container returns **raw identification facts**; a pure TypeScript package (`@magna-carta/file-type`) computes the extension-match verdict and recommendation in the app Worker — mirroring the scan subsystem's existing `RawScanResult` / app-side-verdict split. Design: `docs/specs/2026-06-26-file-type-verifier-design.md`.

**Tech Stack:** TypeScript (pnpm workspace, `vp`/vite-plus, Vitest, Hono + `@hono/zod-openapi`), Rust (axum, serde, the `magika` crate), Cloudflare Workers + Containers.

## Global Constraints

- **Full names, no shorthand** (golden rule 12): `@magna-carta/file-type`, `buildFileTypeReport`, `claimedExtension` — never abbreviations. Allowed: `id`, `URL`, `JSON`.
- **No process-doc references in source/tests** (golden rule 13): no "ADR", "spec", "slice N", "Task N" in code or comments. Explain reasoning inline or cite a file by path.
- **Redact by default** (golden rule 4): never log file bytes, the filename, or detected content; correlate errors by ID only.
- **Pure-package `tsconfig.json` MUST carry its own `compilerOptions`** (`allowImportingTsExtensions`, `noEmit`, `lib`, `types`) — `{extends, include}` alone breaks `.ts` imports under `tsc` (TS5097). Vitest does not typecheck; `pnpm check` runs `tsc`.
- **`noUncheckedIndexedAccess`** is on: coalesce indexed access (`bytes[i] ?? 0`) in bounded loops.
- **Permissions** go through `assertPermission(...)` / the `PERMISSIONS` registry array; the next per-firm migration number is **0025**; role IDs are the five fixed defaults from `0002_member-rbac` (listed in Task 6).
- **The scan Container cannot run under `@cloudflare/vitest-pool-workers`** (workers-sdk#10408) — the Rust/Container work (Task 11) is verified by `cargo test` + the CI `scan-container` job, never the local worker pool.
- **After adding the worker route, regenerate the OpenAPI snapshot** (`pnpm --filter @magna-carta/worker run emit-openapi`) and commit it (Task 10).
- **Commit after every task** with a Conventional-Commits message ending:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## File Structure

**New — pure package `packages/file-type/`:**

- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (copy `packages/metadata/`).
- `src/raw.ts` — `RawIdentifyResult` (the Container's wire shape).
- `src/labels.ts` — Magika-label → `{ human, extensions }` table + `humanLabel` / `canonicalExtensions`.
- `src/filename.ts` — `claimedExtensionOf(filename)`.
- `src/report.ts` — `FileTypeReport` + `buildFileTypeReport(raw, filename)`.
- `src/index.ts` — public exports.
- `test/*.test.ts` — one file per module.

**Modified:**

- `packages/access-control/src/registry.ts` — add `tools:fileTypeVerifier`.
- `packages/tools/src/catalog.ts` — one manifest row.
- `packages/database/drizzle/per-firm/0025_seed-tools-file-type-verifier.sql` — new; seed the permission.
- `apps/worker/src/per-firm-migrations.ts` — register the migration.
- `apps/scan-worker/src/index.ts` — dispatch `POST /identify`.
- `apps/scan-worker/src/forward-identify.ts` — new proxy; `apps/scan-worker/test/forward-identify.test.ts` — new test.
- `apps/worker/src/routes/files/file-type.ts` — new route module; `apps/worker/test/routes/file-type.test.ts` — new test.
- `apps/worker/src/app.ts` — register the route; update the scan stub in `apps/worker/vitest.config.ts`.
- `apps/worker/openapi/openapi.json` — regenerated.
- `containers/scan/Cargo.toml` — add the `magika` crate.
- `containers/scan/src/identify.rs` — new engine module; `containers/scan/src/lib.rs` — `/identify` route + `AppState.magika`; `containers/scan/src/main.rs` — build the session; `containers/scan/tests/identify.rs` — new.
- Docs: `ROADMAP.md`, `STATUS.md`, `changelog.d/file-type-verifier.md`, `docs/decisions/pending/file-type-verifier.md`, `packages/file-type/CLAUDE.md`.

---

### Task 1: Scaffold the `@magna-carta/file-type` pure package

**Files:**

- Create: `packages/file-type/package.json`, `packages/file-type/tsconfig.json`, `packages/file-type/vitest.config.ts`, `packages/file-type/src/index.ts`
- Test: `packages/file-type/test/smoke.test.ts`

**Interfaces:**

- Produces: `PACKAGE_NAME: string` from `@magna-carta/file-type`.

- [ ] **Step 1: Create `packages/file-type/package.json`**

```json
{
  "name": "@magna-carta/file-type",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./raw": "./src/raw.ts",
    "./report": "./src/report.ts",
    ".": "./src/index.ts"
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

- [ ] **Step 2: Create `packages/file-type/tsconfig.json`** (own `compilerOptions` — required)

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

- [ ] **Step 3: Create `packages/file-type/vitest.config.ts`**

```typescript
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 4: Create `packages/file-type/src/index.ts`**

```typescript
export const PACKAGE_NAME = "@magna-carta/file-type";
```

- [ ] **Step 5: Write the failing smoke test** — `packages/file-type/test/smoke.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@magna-carta/file-type", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@magna-carta/file-type");
  });
});
```

- [ ] **Step 6: Install + run the test**

Run: `pnpm install` (from repo root, registers the new package), then `cd packages/file-type && pnpm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add packages/file-type pnpm-lock.yaml
git commit -m "feat(file-type): scaffold the @magna-carta/file-type pure package"
```

---

### Task 2: The Magika-label → human-label + extension table

**Files:**

- Create: `packages/file-type/src/labels.ts`
- Test: `packages/file-type/test/labels.test.ts`

**Interfaces:**

- Produces:
  - `humanLabel(label: string): string` — a display label; falls back to the raw label if unmapped.
  - `canonicalExtensions(label: string): readonly string[]` — canonical extension(s) for a label, `[]` if unmapped.

- [ ] **Step 1: Write the failing test** — `packages/file-type/test/labels.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { canonicalExtensions, humanLabel } from "../src/labels.ts";

describe("labels", () => {
  it("maps a known label to a human label and canonical extensions", () => {
    expect(humanLabel("pdf")).toBe("PDF document");
    expect(canonicalExtensions("pdf")).toEqual(["pdf"]);
  });

  it("maps a Word document and its OOXML extension", () => {
    expect(humanLabel("docx")).toBe("Word document (OOXML)");
    expect(canonicalExtensions("docx")).toEqual(["docx"]);
  });

  it("maps a JPEG to both common extensions", () => {
    expect(canonicalExtensions("jpeg")).toEqual(["jpg", "jpeg"]);
  });

  it("falls back to the raw label and no extensions when unmapped", () => {
    expect(humanLabel("zorp")).toBe("zorp");
    expect(canonicalExtensions("zorp")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/file-type && pnpm test labels`
Expected: FAIL (cannot find `../src/labels.ts`).

- [ ] **Step 3: Implement `packages/file-type/src/labels.ts`**

```typescript
// Maps Magika's content-type label to a display label and the canonical filename extension(s) for that
// type. Magika's labels are the source of truth for detection; this table only adds the human label and
// the extension(s) we treat as "correct" for the recommendation. Keep entries to the types a firm
// actually handles; an unmapped label degrades gracefully (raw label, no recommendation).
interface LabelEntry {
  readonly human: string;
  readonly extensions: readonly string[];
}

const LABELS: Readonly<Record<string, LabelEntry>> = {
  pdf: { human: "PDF document", extensions: ["pdf"] },
  docx: { human: "Word document (OOXML)", extensions: ["docx"] },
  xlsx: { human: "Excel workbook (OOXML)", extensions: ["xlsx"] },
  pptx: { human: "PowerPoint deck (OOXML)", extensions: ["pptx"] },
  doc: { human: "Word document (legacy OLE)", extensions: ["doc"] },
  xls: { human: "Excel workbook (legacy OLE)", extensions: ["xls"] },
  ppt: { human: "PowerPoint deck (legacy OLE)", extensions: ["ppt"] },
  rtf: { human: "Rich Text Format document", extensions: ["rtf"] },
  jpeg: { human: "JPEG image", extensions: ["jpg", "jpeg"] },
  png: { human: "PNG image", extensions: ["png"] },
  gif: { human: "GIF image", extensions: ["gif"] },
  tiff: { human: "TIFF image", extensions: ["tif", "tiff"] },
  bmp: { human: "Bitmap image", extensions: ["bmp"] },
  webp: { human: "WebP image", extensions: ["webp"] },
  heif: { human: "HEIF/HEIC image", extensions: ["heic", "heif"] },
  zip: { human: "ZIP archive", extensions: ["zip"] },
  sevenzip: { human: "7-Zip archive", extensions: ["7z"] },
  rar: { human: "RAR archive", extensions: ["rar"] },
  gzip: { human: "gzip archive", extensions: ["gz"] },
  tar: { human: "tar archive", extensions: ["tar"] },
  txt: { human: "Plain text", extensions: ["txt"] },
  csv: { human: "CSV text", extensions: ["csv"] },
  json: { human: "JSON text", extensions: ["json"] },
  xml: { human: "XML text", extensions: ["xml"] },
  html: { human: "HTML document", extensions: ["html", "htm"] },
  markdown: { human: "Markdown text", extensions: ["md"] },
  python: { human: "Python source", extensions: ["py"] },
  javascript: { human: "JavaScript source", extensions: ["js"] },
  typescript: { human: "TypeScript source", extensions: ["ts"] },
  pe: { human: "Windows executable (PE)", extensions: ["exe", "dll"] },
  elf: { human: "Linux executable (ELF)", extensions: ["elf"] },
  macho: { human: "macOS executable (Mach-O)", extensions: [] },
};

export function humanLabel(label: string): string {
  return LABELS[label]?.human ?? label;
}

export function canonicalExtensions(label: string): readonly string[] {
  return LABELS[label]?.extensions ?? [];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/file-type && pnpm test labels`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/file-type/src/labels.ts packages/file-type/test/labels.test.ts
git commit -m "feat(file-type): Magika-label to human-label and extension table"
```

---

### Task 3: Extract the claimed extension from a filename

**Files:**

- Create: `packages/file-type/src/filename.ts`
- Test: `packages/file-type/test/filename.test.ts`

**Interfaces:**

- Produces: `claimedExtensionOf(filename: string): string | null` — the lowercased extension without the dot, or `null` if the filename has none.

- [ ] **Step 1: Write the failing test** — `packages/file-type/test/filename.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { claimedExtensionOf } from "../src/filename.ts";

describe("claimedExtensionOf", () => {
  it("returns the lowercased extension", () => {
    expect(claimedExtensionOf("Contract.PDF")).toBe("pdf");
  });

  it("uses the last segment for multi-dot names", () => {
    expect(claimedExtensionOf("archive.tar.gz")).toBe("gz");
  });

  it("returns null when there is no extension", () => {
    expect(claimedExtensionOf("README")).toBeNull();
  });

  it("returns null for a dotfile with no extension", () => {
    expect(claimedExtensionOf(".gitignore")).toBeNull();
  });

  it("returns null for a trailing dot", () => {
    expect(claimedExtensionOf("weird.")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/file-type && pnpm test filename`
Expected: FAIL (cannot find `../src/filename.ts`).

- [ ] **Step 3: Implement `packages/file-type/src/filename.ts`**

```typescript
// The extension a filename CLAIMS — lowercased, without the dot — or null when there is none. A leading
// dot with no later dot (".gitignore") is a dotfile, not an extension; a trailing dot is empty. This is
// the "claim" the content-based detection is checked against.
export function claimedExtensionOf(filename: string): string | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return null; // -1 (none) or 0 (leading-dot dotfile)
  const extension = filename.slice(lastDot + 1).toLowerCase();
  return extension.length > 0 ? extension : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/file-type && pnpm test filename`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/file-type/src/filename.ts packages/file-type/test/filename.test.ts
git commit -m "feat(file-type): claimed-extension extraction from a filename"
```

---

### Task 4: The raw type and the report builder (the core)

**Files:**

- Create: `packages/file-type/src/raw.ts`, `packages/file-type/src/report.ts`
- Modify: `packages/file-type/src/index.ts`
- Test: `packages/file-type/test/report.test.ts`

**Interfaces:**

- Consumes: `humanLabel`, `canonicalExtensions` (Task 2); `claimedExtensionOf` (Task 3).
- Produces:
  - `RawIdentifyResult = { label: string; score: number; group: string; magikaVersion: string; modelVersion: string }`
  - `ExtensionMatch = "match" | "mismatch" | "unverifiable" | "no-extension"`
  - `FileTypeReport = { detected: string | null; detectedLabel: string; group: string; confidence: number; claimedExtension: string | null; extensionMatch: ExtensionMatch; recommendedExtensions: readonly string[]; note: string }`
  - `buildFileTypeReport(raw: RawIdentifyResult, filename: string): FileTypeReport`

- [ ] **Step 1: Create `packages/file-type/src/raw.ts`**

```typescript
// The Container's verbatim Magika output — raw facts, no verdict. The app maps this to a FileTypeReport.
// Engine and model versions are carried separately so a future re-identify can reason about which model
// produced a finding (the same separability the scan engine version needs).
export interface RawIdentifyResult {
  readonly label: string; // Magika content-type label, e.g. "pdf", "python"
  readonly score: number; // Magika confidence, 0..1
  readonly group: string; // Magika group, e.g. "document", "image", "code", "executable"
  readonly magikaVersion: string; // the Magika engine/crate version
  readonly modelVersion: string; // the model identifier the engine used
}

// Magika's sentinel labels for "no usable type". The app surfaces these as `unverifiable`, never a
// false mismatch.
export const UNKNOWN_LABELS: ReadonlySet<string> = new Set(["unknown", "empty", "undefined"]);
```

- [ ] **Step 2: Write the failing test** — `packages/file-type/test/report.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import type { RawIdentifyResult } from "../src/raw.ts";
import { buildFileTypeReport } from "../src/report.ts";

function raw(over: Partial<RawIdentifyResult>): RawIdentifyResult {
  return {
    label: "pdf",
    score: 0.99,
    group: "document",
    magikaVersion: "1.0",
    modelVersion: "x",
    ...over,
  };
}

describe("buildFileTypeReport", () => {
  it("reports a match when the extension is canonical for the content", () => {
    const report = buildFileTypeReport(raw({ label: "pdf" }), "report.pdf");
    expect(report.detected).toBe("pdf");
    expect(report.detectedLabel).toBe("PDF document");
    expect(report.extensionMatch).toBe("match");
    expect(report.recommendedExtensions).toEqual(["pdf"]);
  });

  it("accepts an alternate canonical extension (jpg for a JPEG)", () => {
    const report = buildFileTypeReport(raw({ label: "jpeg", group: "image" }), "photo.jpeg");
    expect(report.extensionMatch).toBe("match");
  });

  it("flags a mismatch when the extension lies about the content", () => {
    const report = buildFileTypeReport(raw({ label: "jpeg", group: "image" }), "contract.pdf");
    expect(report.extensionMatch).toBe("mismatch");
    expect(report.recommendedExtensions).toEqual(["jpg", "jpeg"]);
    expect(report.note).toContain("JPEG image");
  });

  it("recommends an extension when the filename has none", () => {
    const report = buildFileTypeReport(raw({ label: "png", group: "image" }), "scan");
    expect(report.extensionMatch).toBe("no-extension");
    expect(report.recommendedExtensions).toEqual(["png"]);
    expect(report.note).toContain("png");
  });

  it("is unverifiable when Magika returns no usable type", () => {
    const report = buildFileTypeReport(
      raw({ label: "unknown", group: "unknown", score: 0.2 }),
      "x.pdf",
    );
    expect(report.detected).toBeNull();
    expect(report.extensionMatch).toBe("unverifiable");
    expect(report.recommendedExtensions).toEqual([]);
  });

  it("carries the confidence score through", () => {
    expect(buildFileTypeReport(raw({ score: 0.87 }), "a.pdf").confidence).toBe(0.87);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/file-type && pnpm test report`
Expected: FAIL (cannot find `../src/report.ts`).

- [ ] **Step 4: Implement `packages/file-type/src/report.ts`**

```typescript
import { claimedExtensionOf } from "./filename.ts";
import { canonicalExtensions, humanLabel } from "./labels.ts";
import { UNKNOWN_LABELS, type RawIdentifyResult } from "./raw.ts";

export type ExtensionMatch = "match" | "mismatch" | "unverifiable" | "no-extension";

export interface FileTypeReport {
  readonly detected: string | null; // null when Magika returned no usable type
  readonly detectedLabel: string;
  readonly group: string;
  readonly confidence: number;
  readonly claimedExtension: string | null;
  readonly extensionMatch: ExtensionMatch;
  readonly recommendedExtensions: readonly string[];
  readonly note: string;
}

// Map raw Magika facts + the filename to the report. Deterministic given its inputs; no detection here.
export function buildFileTypeReport(raw: RawIdentifyResult, filename: string): FileTypeReport {
  const claimedExtension = claimedExtensionOf(filename);

  // No usable type: report honestly, never a false mismatch.
  if (UNKNOWN_LABELS.has(raw.label)) {
    return {
      detected: null,
      detectedLabel: humanLabel(raw.label),
      group: raw.group,
      confidence: raw.score,
      claimedExtension,
      extensionMatch: "unverifiable",
      recommendedExtensions: [],
      note: "The file's content did not match a known type, so its extension cannot be verified.",
    };
  }

  const detectedLabel = humanLabel(raw.label);
  const recommendedExtensions = canonicalExtensions(raw.label);

  let extensionMatch: ExtensionMatch;
  let note: string;
  if (claimedExtension === null) {
    extensionMatch = "no-extension";
    note =
      recommendedExtensions.length > 0
        ? `No extension on the filename; content is ${detectedLabel}. Suggested extension: .${recommendedExtensions[0]}`
        : `No extension on the filename; content is ${detectedLabel}.`;
  } else if (recommendedExtensions.length === 0) {
    // Detected, but we hold no canonical extension to compare against.
    extensionMatch = "unverifiable";
    note = `Content is ${detectedLabel}; no canonical extension is known to compare against ".${claimedExtension}".`;
  } else if (recommendedExtensions.includes(claimedExtension)) {
    extensionMatch = "match";
    note = `Extension ".${claimedExtension}" matches the content (${detectedLabel}).`;
  } else {
    extensionMatch = "mismatch";
    note = `Named ".${claimedExtension}", but the content is ${detectedLabel}. Consider .${recommendedExtensions[0]}`;
  }

  return {
    detected: raw.label,
    detectedLabel,
    group: raw.group,
    confidence: raw.score,
    claimedExtension,
    extensionMatch,
    recommendedExtensions,
    note,
  };
}
```

- [ ] **Step 5: Update `packages/file-type/src/index.ts`**

```typescript
export const PACKAGE_NAME = "@magna-carta/file-type";
export type { RawIdentifyResult } from "./raw.ts";
export { UNKNOWN_LABELS } from "./raw.ts";
export type { ExtensionMatch, FileTypeReport } from "./report.ts";
export { buildFileTypeReport } from "./report.ts";
export { canonicalExtensions, humanLabel } from "./labels.ts";
export { claimedExtensionOf } from "./filename.ts";
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd packages/file-type && pnpm test`
Expected: PASS (all files).

- [ ] **Step 7: Typecheck**

Run: `pnpm check` (from repo root) — confirm no `tsc` errors for the new package.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/file-type/src packages/file-type/test
git commit -m "feat(file-type): raw type and buildFileTypeReport verdict logic"
```

---

### Task 5: Register the `tools:fileTypeVerifier` permission

**Files:**

- Modify: `packages/access-control/src/registry.ts`
- Test: `packages/access-control/test/file-type-verifier-permission.test.ts`

**Interfaces:**

- Produces: the registered key `"tools:fileTypeVerifier"` (usable via `assertPermission`).

- [ ] **Step 1: Write the failing test** — `packages/access-control/test/file-type-verifier-permission.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { assertPermission, isPermission } from "../src/registry.ts";

describe("tools:fileTypeVerifier permission", () => {
  it("is registered", () => {
    expect(isPermission("tools:fileTypeVerifier")).toBe(true);
    expect(assertPermission("tools:fileTypeVerifier")).toBe("tools:fileTypeVerifier");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/access-control && pnpm test file-type-verifier-permission`
Expected: FAIL (`isPermission` returns false).

- [ ] **Step 3: Add the permission** — in `packages/access-control/src/registry.ts`, insert into the `PERMISSIONS` array immediately after the `"tools:fileIntegrity",` line:

```typescript
  "tools:fileTypeVerifier", // identify a file's true content type and flag/repair an extension mismatch
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/access-control && pnpm test file-type-verifier-permission`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/file-type-verifier-permission.test.ts
git commit -m "feat(access-control): register tools:fileTypeVerifier permission"
```

---

### Task 6: Seed the permission to the default roles (per-firm migration 0025)

**Files:**

- Create: `packages/database/drizzle/per-firm/0025_seed-tools-file-type-verifier.sql`
- Modify: `apps/worker/src/per-firm-migrations.ts`, and the per-firm journal (`packages/database/drizzle/per-firm/meta/_journal.json` — follow the existing journal-entry shape for the prior migration).

**Interfaces:**

- Produces: every default role granted `tools:fileTypeVerifier`.

- [ ] **Step 1: Generate five fresh `rolePermission_` ids**

Run (from repo root, prints five identifier values to paste below):

```bash
node -e "const {newIdentifier}=await import('@magna-carta/identifiers'); for(let i=0;i<5;i++) console.log(newIdentifier('rolePermission'))"
```

If that entrypoint differs, copy the id format from `0022_seed-tools-file-integrity.sql` and mint five unique values. Record them; they are committed as literals (the seed convention).

- [ ] **Step 2: Create `packages/database/drizzle/per-firm/0025_seed-tools-file-type-verifier.sql`**

```sql
-- Seed tools:fileTypeVerifier onto every default role. Identifying a file's true type and flagging an
-- extension that lies about its content is an everyday safety utility any firm member may need without a
-- separate grant — the same broad reach as the other tools:* utilities. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<ID_1>', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<ID_2>', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<ID_3>', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<ID_4>', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileTypeVerifier');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<ID_5>', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileTypeVerifier');
```

Replace `<ID_1..5>` with the values from Step 1. (The five `role_*` ids are the fixed defaults; copy them verbatim from `0022_seed-tools-file-integrity.sql`.)

- [ ] **Step 3: Register the migration** — in `apps/worker/src/per-firm-migrations.ts`, add the import (alphabetically/with the other `seedTools*` imports) and the journal-map entry, mirroring `0022_seed-tools-file-integrity`:

```typescript
import seedToolsFileTypeVerifierSql from "@magna-carta/database/drizzle/per-firm/0025_seed-tools-file-type-verifier.sql";
```

and in the `migrationsFromJournal(perFirmJournal, { ... })` map:

```typescript
    "0025_seed-tools-file-type-verifier": seedToolsFileTypeVerifierSql,
```

Add the matching entry to `packages/database/drizzle/per-firm/meta/_journal.json` following the shape of the `0024` entry (idx, version, `when`, tag `0025_seed-tools-file-type-verifier`).

- [ ] **Step 4: Run the worker test suite's migration check**

Run: `pnpm --filter @magna-carta/worker run test`
Expected: PASS — the migration applies cleanly in the Miniflare per-firm database setup. (If a "seed test union" asserts the full set of seeded `tools:*` permissions, add `tools:fileTypeVerifier` to that expected set.)

- [ ] **Step 5: Commit**

```bash
git add packages/database/drizzle/per-firm/0025_seed-tools-file-type-verifier.sql packages/database/drizzle/per-firm/meta/_journal.json apps/worker/src/per-firm-migrations.ts
git commit -m "feat(file-type): seed tools:fileTypeVerifier to default roles (migration 0025)"
```

---

### Task 7: Add the Tools catalog row

**Files:**

- Modify: `packages/tools/src/catalog.ts`
- Test: `packages/tools/test/file-type-verifier-row.test.ts`

**Interfaces:**

- Consumes: `tools:fileTypeVerifier` (Task 5).
- Produces: a catalog manifest with `id: "file-type-verifier"`.

- [ ] **Step 1: Write the failing test** — `packages/tools/test/file-type-verifier-row.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("file-type-verifier catalog row", () => {
  it("is present, in the documents group, file/none contextual, library-backed", () => {
    const row = CATALOG.find((t) => t.id === "file-type-verifier");
    expect(row).toBeDefined();
    expect(row?.subjectGroup).toBe("documents");
    expect(row?.contextTags).toEqual(["file", "none"]);
    expect(row?.backing).toEqual({ kind: "library" });
    expect(row?.matterContext).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/tools && pnpm test file-type-verifier-row`
Expected: FAIL (row not found).

- [ ] **Step 3: Add the row** — in `packages/tools/src/catalog.ts`, insert immediately after the `file-hash-integrity` object (before the closing `];`):

```typescript
  {
    id: "file-type-verifier",
    name: "File Type Verifier",
    icon: "file-check",
    subjectGroup: "documents",
    permission: assertPermission("tools:fileTypeVerifier"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

- [ ] **Step 4: Run to verify it passes** (and the existing purity/catalog tests still pass)

Run: `cd packages/tools && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/catalog.ts packages/tools/test/file-type-verifier-row.test.ts
git commit -m "feat(tools): catalog row for the File Type Verifier"
```

---

### Task 8: scan-worker `/identify` proxy route

**Files:**

- Create: `apps/scan-worker/src/forward-identify.ts`, `apps/scan-worker/test/forward-identify.test.ts`
- Modify: `apps/scan-worker/src/index.ts`

**Interfaces:**

- Produces: `forwardIdentify(request: Request, container: ScanContainerFetcher): Promise<Response>` — POSTs the body to the Container's `/identify` and returns its response verbatim.

- [ ] **Step 1: Write the failing test** — `apps/scan-worker/test/forward-identify.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { forwardIdentify } from "../src/forward-identify.ts";

function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardIdentify", () => {
  it("forwards POST /identify to the container and returns the response verbatim", async () => {
    const rawIdentify = {
      label: "pdf",
      score: 0.99,
      group: "document",
      magikaVersion: "1.0.0",
      modelVersion: "standard_v3",
    };
    const container = fakeContainer(
      new Response(JSON.stringify(rawIdentify), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://scan-worker/identify?size=1024", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardIdentify(request, container);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rawIdentify);
  });

  it("targets the container's /identify path", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response("{}", { status: 200 });
      },
    };
    await forwardIdentify(
      new Request("http://scan-worker/identify?size=9", { method: "POST", body: "x" }),
      container,
    );
    expect(capturedUrl).toBe("http://scan/identify?size=9");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/scan-worker && pnpm test forward-identify`
Expected: FAIL (cannot find `../src/forward-identify.ts`).

- [ ] **Step 3: Implement `apps/scan-worker/src/forward-identify.ts`**

```typescript
import type { ScanContainerFetcher } from "./forward-scan.ts";

// Forward an incoming identify request to the scan Container's /identify endpoint and return its
// response verbatim. Mirrors forward-scan.ts: the service binding from the app worker is the trust
// boundary, the body is streamed (duplex: half), and any network failure throws rather than fabricating
// a result.
export async function forwardIdentify(
  request: Request,
  container: ScanContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request(`http://scan/identify${new URL(request.url).search}`, {
      method: "POST",
      body: request.body,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}
```

- [ ] **Step 4: Wire the route** — in `apps/scan-worker/src/index.ts`, add the import and the dispatch branch inside `fetch`:

```typescript
import { forwardIdentify } from "./forward-identify.ts";
```

and inside `fetch`, after the existing `/scan` branch:

```typescript
if (request.method === "POST" && url.pathname === "/identify") {
  return forwardIdentify(request, getContainer(env.SCAN_CONTAINER, "scan"));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/scan-worker && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/scan-worker/src/forward-identify.ts apps/scan-worker/src/index.ts apps/scan-worker/test/forward-identify.test.ts
git commit -m "feat(scan-worker): /identify proxy route to the scan Container"
```

---

### Task 9: App-worker `POST /api/v1/file-type/verify` route

**Files:**

- Create: `apps/worker/src/routes/files/file-type.ts`, `apps/worker/test/routes/file-type.test.ts`
- Modify: `apps/worker/src/app.ts` (register the route), `apps/worker/vitest.config.ts` (extend the scan stub to answer `/identify`)

**Interfaces:**

- Consumes: `buildFileTypeReport`, `RawIdentifyResult` from `@magna-carta/file-type`; `resolveScanPort` pattern / the `SCAN_SERVICE` binding; `readInspectableSizeCap` from `@magna-carta/file-manager`.
- Produces: `registerFileTypeRoutes(app, chokepoint)`; the route `POST /api/v1/file-type/verify` returning a `FileTypeReport` JSON body.

- [ ] **Step 1: Extend the scan stub** — in `apps/worker/vitest.config.ts`, replace the `magna-carta-scan` stub `script` so it branches on the path (the existing `/scan` stub must keep working):

```javascript
const SCAN_SERVICE_STUB_SCRIPT = `
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/identify") {
      return new Response(
        JSON.stringify({ label: "jpeg", score: 0.99, group: "image",
          magikaVersion: "test", modelVersion: "test" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ engineVersion: null, clam: { state: "unavailable" },
        heuristic: { kind: "none" }, matches: [], timings: { clamdMs: 0, yaraMs: 0 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};
`;
```

- [ ] **Step 2: Write the failing test** — `apps/worker/test/routes/file-type.test.ts`

Model the harness on `apps/worker/test/routes/file-integrity.test.ts` (same firm-context + permission-grant setup). The body asserts the happy path and the gate:

```typescript
import { describe, expect, it } from "vitest";
// Reuse the existing route-test harness used by file-integrity.test.ts (authenticated request helper,
// firm seeding with tools:* granted). Import the same helpers that file lists.
import { authedRequest, seedFirmWithPermissions } from "../support/app-harness.ts"; // match file-integrity's imports

describe("POST /api/v1/file-type/verify", () => {
  it("returns a FileTypeReport with a mismatch (stub identifies a JPEG named .pdf)", async () => {
    const ctx = await seedFirmWithPermissions(["tools:fileTypeVerifier"]);
    const res = await authedRequest(ctx, "/api/v1/file-type/verify?filename=contract.pdf", {
      method: "POST",
      body: new Uint8Array([0xff, 0xd8, 0xff]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toBe("jpeg");
    expect(body.extensionMatch).toBe("mismatch");
    expect(body.recommendedExtensions).toContain("jpg");
  });

  it("rejects without the permission", async () => {
    const ctx = await seedFirmWithPermissions([]); // no tools:fileTypeVerifier
    const res = await authedRequest(ctx, "/api/v1/file-type/verify?filename=x.pdf", {
      method: "POST",
      body: new Uint8Array([0xff, 0xd8, 0xff]),
    });
    expect(res.status).toBe(403);
  });
});
```

Note: adjust the imports/helpers to whatever `apps/worker/test/routes/file-integrity.test.ts` actually uses — read that file first and mirror its setup exactly.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @magna-carta/worker run test file-type`
Expected: FAIL (route not registered → 404).

- [ ] **Step 4: Implement `apps/worker/src/routes/files/file-type.ts`**

```typescript
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { buildFileTypeReport, type RawIdentifyResult } from "@magna-carta/file-type";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext, type AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

export const fileTypeVerifyMeta: RouteMeta = {
  operationId: "fileType.verify",
  surface: "app",
  authenticated: true,
  permission: "tools:fileTypeVerifier",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

// The Container's raw identification facts, validated at the trust boundary before we map them.
const rawIdentifySchema = z.object({
  label: z.string(),
  score: z.number(),
  group: z.string(),
  magikaVersion: z.string(),
  modelVersion: z.string(),
}) satisfies z.ZodType<RawIdentifyResult>;

const ReportSchema = z.object({
  detected: z.string().nullable(),
  detectedLabel: z.string(),
  group: z.string(),
  confidence: z.number(),
  claimedExtension: z.string().nullable(),
  extensionMatch: z.enum(["match", "mismatch", "unverifiable", "no-extension"]),
  recommendedExtensions: z.array(z.string()),
  note: z.string(),
});

const verifyRoute = defineOpenAPIRoute(fileTypeVerifyMeta, {
  method: "post",
  path: "/api/v1/file-type/verify",
  description:
    "Identify an uploaded file's true content type from its bytes, compare it to the extension the " +
    "filename claims, and recommend an extension when it is missing or wrong. Nothing is stored.",
  request: {
    query: z.object({ filename: z.string().min(1) }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    200: {
      description: "File type report",
      content: { "application/json": { schema: ReportSchema } },
    },
    403: {
      description: "Missing tools:fileTypeVerifier",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerFileTypeRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...verifyRoute, middleware: chokepointMiddleware(chokepoint, verifyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { filename } = c.req.valid("query");
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the file bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to identify inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const scan = c.env.SCAN_SERVICE;
      if (scan === undefined) {
        return problemJson(c, {
          type: "engine-unavailable",
          title: "Identification engine unavailable",
          status: 503,
          detail: "The identification engine is not currently reachable. Try again shortly.",
        });
      }
      const query = new URLSearchParams({ size: String(sizeBytes) });
      const response = await scan.fetch(
        new Request(`http://scan/identify?${query.toString()}`, {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        return problemJson(c, {
          type: "engine-unavailable",
          title: "Identification failed",
          status: 503,
          detail: "The identification engine returned an error. Try again shortly.",
        });
      }
      const raw = rawIdentifySchema.parse(await response.json());
      return c.json(buildFileTypeReport(raw, filename), 200);
    },
  );
}
```

Note: confirm the exact import paths for `requireChokepointFirmContext`, `problemJson`, `defineOpenAPIRoute`, and `readInspectableSizeCap` against `apps/worker/src/routes/files/file-integrity.ts` (they are the same symbols that file uses) before running.

- [ ] **Step 5: Register the route** — in `apps/worker/src/app.ts`, import and call `registerFileTypeRoutes(app, chokepoint)` alongside the other `register*Routes` calls (search for `registerFileIntegrityRoutes` and mirror it).

```typescript
import { registerFileTypeRoutes } from "./routes/files/file-type.ts";
// ... where the other routes are registered:
registerFileTypeRoutes(app, chokepoint);
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @magna-carta/worker run test file-type`
Expected: PASS (mismatch happy path + 403 gate).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/files/file-type.ts apps/worker/src/app.ts apps/worker/vitest.config.ts apps/worker/test/routes/file-type.test.ts
git commit -m "feat(worker): POST /api/v1/file-type/verify route"
```

---

### Task 10: Regenerate the OpenAPI contract

**Files:**

- Modify: `apps/worker/openapi/openapi.json` (generated)

- [ ] **Step 1: Regenerate**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Expected: `openapi/openapi.json` updates to include `fileType.verify` / `/api/v1/file-type/verify`.

- [ ] **Step 2: Sanity-check the diff**

Run: `git diff --stat apps/worker/openapi/openapi.json`
Expected: only additions for the new operation.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/openapi/openapi.json
git commit -m "chore(worker): regenerate OpenAPI snapshot for file-type.verify"
```

---

### Task 11: Magika identification engine in the scan Container (CI-gated)

> This task's HTTP path runs only in the `scan-container` CI job (Containers are unsupported in the local Vitest pool — `containers/scan/CLAUDE.md`). Drive it with `cargo test` (the embedded Magika model needs no network), which runs everywhere.

**Files:**

- Modify: `containers/scan/Cargo.toml`, `containers/scan/src/lib.rs`, `containers/scan/src/main.rs`
- Create: `containers/scan/src/identify.rs`, `containers/scan/tests/identify.rs`

**Interfaces:**

- Produces: `RawIdentifyResult` (Rust, serde) matching the TS shape in Task 4; a `/identify` axum route; `AppState.magika`.

- [ ] **Step 1: Add the crate** — in `containers/scan/Cargo.toml` `[dependencies]`, add (with a comment mirroring the yara-x note):

```toml
# Google Magika: ML content-type identification (embeds the standard model in the crate, so no model
# file is fetched at runtime — consistent with the container's no-egress posture). Pure-Rust inference.
magika = "0.2"
```

- [ ] **Step 2: Confirm the crate's current API** (golden rule 11 — do not assume)

Run: `cd containers/scan && cargo doc -p magika --no-deps --open` (or read https://docs.rs/magika). Confirm the constructor and the sync identify call, and the result fields (label/content-type string, score, group/MIME). Adjust the exact symbol names in Step 4 to match the installed version. The plan below uses a representative shape: `magika::Session::new()` and `session.identify_content_sync(bytes)` returning a result exposing `.label()`, `.score()`, `.group()`.

- [ ] **Step 3: Write the failing Rust test** — `containers/scan/tests/identify.rs`

```rust
use magna_carta_scan::identify::{identify_bytes, IdentifyEngine};

// The embedded model identifies a minimal PDF buffer as a PDF. No network, no external model file.
#[test]
fn identifies_a_pdf_buffer() {
    let engine = IdentifyEngine::new().expect("magika session builds with the embedded model");
    let raw = identify_bytes(&engine, b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
    assert_eq!(raw.label, "pdf");
    assert!(raw.score > 0.0);
    assert!(!raw.magika_version.is_empty());
}
```

- [ ] **Step 4: Implement `containers/scan/src/identify.rs`**

```rust
use serde::Serialize;

/// The Magika engine handle, built once and shared. Wraps the crate's session so the rest of the
/// service does not depend on the crate's types directly.
pub struct IdentifyEngine {
    session: magika::Session,
}

impl IdentifyEngine {
    /// Build the engine with Magika's embedded standard model (no network, no external file).
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self {
            session: magika::Session::new()?,
        })
    }
}

/// The raw identification facts the container returns — no verdict, no recommendation. Field names and
/// JSON shape match the app-side `RawIdentifyResult` in `@magna-carta/file-type`.
#[derive(Debug, Serialize, PartialEq)]
pub struct RawIdentifyResult {
    pub label: String,
    pub score: f64,
    pub group: String,
    #[serde(rename = "magikaVersion")]
    pub magika_version: String,
    #[serde(rename = "modelVersion")]
    pub model_version: String,
}

/// Run the model over a byte buffer and lower its output to the raw wire facts. Adjust the accessor
/// calls to the installed magika crate API confirmed in Step 2.
pub fn identify_bytes(engine: &IdentifyEngine, bytes: &[u8]) -> RawIdentifyResult {
    let outcome = engine.session.identify_content_sync(bytes);
    RawIdentifyResult {
        label: outcome.label().to_string(),
        score: outcome.score(),
        group: outcome.group().to_string(),
        magika_version: env!("CARGO_PKG_VERSION").to_string(),
        model_version: engine.session.model_name().to_string(),
    }
}
```

- [ ] **Step 5: Wire the route + state** — in `containers/scan/src/lib.rs`:
  - Add `pub mod identify;` with the other `pub mod` lines.
  - Add a field to `AppState`: `pub magika: std::sync::Arc<identify::IdentifyEngine>,`
  - Add the route in `router(...)`: `.route("/identify", post(identify))`
  - Add the handler (streams the body within the same cap as `/scan`):

```rust
async fn identify(State(state): State<AppState>, body: Body) -> Response {
    match axum::body::to_bytes(body, MAX_SCAN_BODY_BYTES).await {
        Ok(bytes) => {
            let engine = state.magika.clone();
            // Inference is CPU-bound — keep it off the async reactor, like the yara/heuristics stage.
            match tokio::task::spawn_blocking(move || identify::identify_bytes(&engine, &bytes)).await {
                Ok(raw) => Json(raw).into_response(),
                Err(_) => engines_unavailable(),
            }
        }
        Err(_) => too_large(),
    }
}
```

- Update the `#[cfg(test)] fn test_state()` helpers (in `lib.rs` tests and `tests/health.rs`) to add `magika: std::sync::Arc::new(identify::IdentifyEngine::new().unwrap()),`.

- [ ] **Step 6: Build the engine in `containers/scan/src/main.rs`** — where `AppState` is constructed, add `magika: std::sync::Arc::new(magna_carta_scan::identify::IdentifyEngine::new()?)` (the model is embedded; failure is fatal at boot, consistent with the rules-blob load).

- [ ] **Step 7: Run the Rust tests**

Run: `cd containers/scan && cargo test`
Expected: PASS — `identifies_a_pdf_buffer` and the existing suite. (First build downloads the magika crate; allow time.)

- [ ] **Step 8: Update `containers/scan/CLAUDE.md`** — add one bullet under the engine notes: the `/identify` route runs Magika with its embedded model (no egress); identification facts are raw, the app decides the extension verdict.

- [ ] **Step 9: Commit**

```bash
git add containers/scan/Cargo.toml containers/scan/Cargo.lock containers/scan/src/identify.rs containers/scan/src/lib.rs containers/scan/src/main.rs containers/scan/tests/identify.rs containers/scan/CLAUDE.md
git commit -m "feat(scan): Magika /identify engine returning raw identification facts"
```

---

### Task 12: Documentation — roadmap, status, changelog & decision fragments

**Files:**

- Modify: `ROADMAP.md`, `STATUS.md`
- Create: `changelog.d/file-type-verifier.md`, `docs/decisions/pending/file-type-verifier.md`, `packages/file-type/CLAUDE.md`

> Before editing `ROADMAP.md`/`STATUS.md`, run `vp run worktrees` (shared-file discipline). Edit only this slice's own `STATUS.md` row.

- [ ] **Step 1: `changelog.d/file-type-verifier.md`** (follow an existing fragment's frontmatter shape)

```markdown
---
category: Added
---

File Type Verifier (Tools): identify a file's true content type, flag when its extension lies about the
content, and recommend the correct extension when it is missing or wrong. Powered by Google Magika,
running as an identification capability of the untrusted-byte scan subsystem.
```

- [ ] **Step 2: `docs/decisions/pending/file-type-verifier.md`** — an ADR fragment recording: Magika over a hand-maintained signature table or `file-type` (text/source coverage); co-location in the scan subsystem per the extraction rubric; raw-facts-in-Container / verdict-in-app; probabilistic-with-confidence framing. Follow the frontmatter shape of an existing file in `docs/decisions/pending/`.

- [ ] **Step 3: `packages/file-type/CLAUDE.md`** — local notes: pure package, no detection here (it maps the Container's raw Magika facts to a report); the report verdict states (match/mismatch/no-extension/unverifiable); detection lives in `containers/scan` (Magika); keep the label table to types a firm handles.

- [ ] **Step 4: `ROADMAP.md` + `STATUS.md`** — add the File Type Verifier row (mirror the File Hash & Integrity entries' wording/placement).

- [ ] **Step 5: Final full check**

Run: `pnpm check` and `vp test` (from repo root).
Expected: PASS (Rust container HTTP integration remains CI-gated; `cargo test` covered it in Task 11).

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md STATUS.md changelog.d/file-type-verifier.md docs/decisions/pending/file-type-verifier.md packages/file-type/CLAUDE.md
git commit -m "docs(file-type): roadmap/status rows, changelog & decision fragments, package notes"
```

---

## Self-Review

**Spec coverage:**

- Pure `@magna-carta/file-type` (raw type, report builder, label table) — Tasks 1–4. ✓
- `containers/scan` Magika `identify` module + route + raw facts — Task 11. ✓
- `apps/scan-worker` `/identify` — Task 8. ✓
- App-worker `POST /api/v1/file-type/verify` + permission gate + size cap + service binding — Task 9. ✓
- Catalog row — Task 7; permission — Task 5; seed migration — Task 6. ✓
- Engine/model version separability (`magikaVersion`/`modelVersion`) — Tasks 4, 11. ✓
- Security: no-egress Container reuse, size cap, redact-by-default, raw-facts split — Tasks 9, 11. ✓
- Testing: pure unit tests (1–4), scan-worker proxy test (8), worker-pool route test with stubbed binding (9), Rust `cargo test` (11), CI-gated container integration (11). ✓
- Docs/OpenAPI — Tasks 10, 12. ✓
- Deferred seams (matter-action consumer, charset, extraction-to-dedicated-worker) — left unbuilt by design; no task, correct.

**Placeholder scan:** Two intentional fill-ins are explicit and bounded: the five minted `rolePermission_` ids (Task 6 Step 1) and confirming the exact `magika` crate API (Task 11 Step 2). Both have a runnable command/verification, not a vague "TODO".

**Type consistency:** `RawIdentifyResult` fields (`label`, `score`, `group`, `magikaVersion`, `modelVersion`) match across the TS type (Task 4), the zod schema (Task 9), and the Rust serde struct (Task 11, via `#[serde(rename = ...)]`). `FileTypeReport` fields match between `report.ts` (Task 4) and `ReportSchema` (Task 9). `forwardIdentify` signature matches its test (Task 8). `buildFileTypeReport(raw, filename)` consumed in Task 9 as defined in Task 4.
