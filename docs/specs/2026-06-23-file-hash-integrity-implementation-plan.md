# File Hash & Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ethereal Tools-area utility that computes a file's cryptographic digests (MD5, SHA-1, SHA-256, SHA-384, SHA-512 in one streaming pass) and verifies a stored file still matches the SHA-256 baseline recorded at ingest, with a chain-of-custody audit row and a downloadable hash receipt.

**Architecture:** A new pure TypeScript package `@magna-carta/file-integrity` owns the streaming multi-digest core, the baseline comparison, and the receipt builder — all I/O (the digest backend, R2 reads, the clock) injected. Two Worker routes through the chokepoint expose it: a stateless `hash` over a streamed request body, and a `verify` that re-reads a file's bytes from R2, compares to the stored baseline, and records a `file.integrity_verified` audit row. The Tools catalog gains one row and a new `file` context tag (the first per-file contextual action).

**Tech Stack:** TypeScript (ESM, `.ts` extensionful imports), Cloudflare Workers (`crypto.DigestStream`, R2 binding `env.R2`), Hono + `@hono/zod-openapi`, Vitest (node pool for the pure package; Cloudflare Workers pool under `apps/worker/test/` for the routes), Drizzle SQL migrations.

## Global Constraints

- **Pure package rule:** `@magna-carta/file-integrity` has no D1, no Hono, no `env`, no Svelte, no network. All effects injected. (golden rule 3, 10)
- **Full names, no shorthand:** `@magna-carta/file-integrity`, `tools:fileIntegrity`, `hashAll`, `compareToBaseline`, `buildReceipt`. Never `hash`/`fi`/abbreviations. (golden rule 12)
- **No process-doc references in source:** no `ADR-NNNN`, no "slice/phase N", no "spec §N" in code, tests, or OpenAPI `description`s. State reasoning inline or cite a file path. (golden rule 13)
- **Redact by default:** never log or persist file contents or names; digests and byte sizes are non-privileged and may appear in the audit row and receipt. Errors correlate by ID only. (golden rule 4)
- **ESM imports use the `.ts` extension** (e.g. `import { hashAll } from "./hash.ts"`). `type: "module"`, `allowImportingTsExtensions`.
- **Algorithm set is fixed and always computed together:** `["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"]`. One read, all five.
- **Commit after every task.** Conventional-commit messages, no emojis, end with the `Co-Authored-By` trailer used on this branch.
- **Branch/worktree:** all work happens in the `tools-file-integrity` worktree at `C:/dev/magna-carta-worktrees/tools-file-integrity`.

---

## File Structure

**New pure package `packages/file-integrity/`:**

- `package.json` — workspace package manifest (mirrors `packages/whois`).
- `tsconfig.json` — extends the shared base.
- `vitest.config.ts` — node pool, root-pinned.
- `src/types.ts` — `HashAlgorithm`, `HASH_ALGORITHMS`, `ALGORITHM_RESULT_KEY`, `DigestSink`, `CreateDigestSink`, `HashResult`, `BaselineComparison`, `VerifyResult`, `ReceiptInput`, `ReceiptPayload`.
- `src/hash.ts` — `hashAll(stream, createSink)`: the single-pass fan-out.
- `src/compare.ts` — `compareToBaseline(computedSha256, baselineSha256)`.
- `src/receipt.ts` — `buildReceipt(input)` + `renderReceiptText(payload)`.
- `src/index.ts` — public re-exports.
- `test/node-sink.ts` — a test-only `node:crypto`-backed `DigestSink` factory so `hashAll` runs in the node pool.
- `test/hash.test.ts`, `test/compare.test.ts`, `test/receipt.test.ts`.
- `CLAUDE.md` — local area notes.

**Worker (`apps/worker/`):**

- `src/file-integrity/worker-sink.ts` — the real `crypto.DigestStream`-backed `DigestSink` factory + `toHex`.
- `src/routes/files/file-integrity.ts` — the `hash` and `verify` routes + `registerFileIntegrityRoutes`.
- `src/app.ts` — register the routes (one line).
- `test/file-integrity.test.ts` — Workers-pool route tests.

**File-manager (`packages/file-manager/`):**

- `src/queries.ts` — add `getCurrentVersionForIntegrity(database, fileId)` and its `exports` entry is already `./queries`.

**Access control (`packages/access-control/`):**

- `src/registry.ts` — one new `tools:fileIntegrity` line.
- `test/registry.test.ts` — add it to the `tools` enumeration.

**Tools catalog (`packages/tools/`):**

- `src/types.ts` — add `"file"` to `ContextTag`.
- `src/catalog.ts` — one new row.
- `test/select.test.ts` — a `toolsFor("file")` assertion (if the file exists; else add to the existing catalog test).

**Database (`packages/database/`):**

- `drizzle/per-firm/0021_seed-tools-file-integrity.sql` — role seed.
- `drizzle/per-firm/meta/_journal.json` — new entry (idx 21).

**Worker migration registration:**

- `apps/worker/src/per-firm-migrations.ts` — import + map entry.

**Docs:**

- `STATUS.md`, `ROADMAP.md`, `changelog.d/file-hash-integrity.md`, `docs/decisions/pending/file-hash-integrity-architecture.md`.

---

## Task 1: Scaffold the pure package + algorithm metadata and types

**Files:**

- Create: `packages/file-integrity/package.json`
- Create: `packages/file-integrity/tsconfig.json`
- Create: `packages/file-integrity/vitest.config.ts`
- Create: `packages/file-integrity/src/types.ts`
- Create: `packages/file-integrity/src/index.ts`
- Test: `packages/file-integrity/test/types.test.ts`

**Interfaces:**

- Produces: `HASH_ALGORITHMS: readonly ["MD5","SHA-1","SHA-256","SHA-384","SHA-512"]`; `type HashAlgorithm`; `ALGORITHM_RESULT_KEY: Record<HashAlgorithm, "md5"|"sha1"|"sha256"|"sha384"|"sha512">`; `interface DigestSink { write(chunk: Uint8Array): Promise<void> | void; close(): Promise<string> }`; `type CreateDigestSink = (algorithm: HashAlgorithm) => DigestSink`; `interface HashResult { md5; sha1; sha256; sha384; sha512: string; sizeBytes: number }`; `type BaselineComparison = "match"|"mismatch"|"no-baseline"`; `interface VerifyResult { hashes: HashResult; baselineSha256: string | null; comparison: BaselineComparison }`.

- [ ] **Step 1: Create the package manifest**

`packages/file-integrity/package.json`:

```json
{
  "name": "@magna-carta/file-integrity",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./hash": "./src/hash.ts",
    "./compare": "./src/compare.ts",
    "./receipt": "./src/receipt.ts",
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

- [ ] **Step 2: Create the tsconfig**

`packages/file-integrity/tsconfig.json`:

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

- [ ] **Step 3: Create the vitest config**

`packages/file-integrity/vitest.config.ts`:

```typescript
import { defineConfig } from "vite-plus";

// Pure package: the default node pool. hashAll is exercised here with a node:crypto-backed sink
// (test/node-sink.ts); the real Workers crypto.DigestStream is exercised by the route tests in
// apps/worker/test, where the Miniflare pool is configured.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 4: Write the failing test for the algorithm metadata**

`packages/file-integrity/test/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ALGORITHM_RESULT_KEY, HASH_ALGORITHMS } from "../src/types.ts";

describe("algorithm metadata", () => {
  it("lists the five algorithms in a fixed order", () => {
    expect(HASH_ALGORITHMS).toEqual(["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"]);
  });

  it("maps each algorithm to its lowercase result key", () => {
    expect(HASH_ALGORITHMS.map((algorithm) => ALGORITHM_RESULT_KEY[algorithm])).toEqual([
      "md5",
      "sha1",
      "sha256",
      "sha384",
      "sha512",
    ]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/file-integrity test`
Expected: FAIL — cannot resolve `../src/types.ts`.

- [ ] **Step 6: Implement the types**

`packages/file-integrity/src/types.ts`:

```typescript
// The fixed algorithm set. Every hash run computes all five in one pass — MD5 and SHA-1 are retained
// for eDiscovery/legacy interop (load files and opposing-party tooling still specify them) and are
// labelled as legacy-interop, not security-grade, in the UI. SHA-256 is the primary digest and the
// one with an ingest baseline to compare against.
export const HASH_ALGORITHMS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

// Each algorithm's field name in HashResult.
export const ALGORITHM_RESULT_KEY = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
} as const satisfies Record<HashAlgorithm, string>;

// A streaming digest backend for ONE algorithm. `write` is fed every chunk; `close` finalises and
// returns the lowercase-hex digest. The Worker backs this with crypto.DigestStream; tests back it
// with node:crypto. Injecting it keeps this package pure and node-testable.
export interface DigestSink {
  write(chunk: Uint8Array): Promise<void> | void;
  close(): Promise<string>;
}
export type CreateDigestSink = (algorithm: HashAlgorithm) => DigestSink;

export interface HashResult {
  readonly md5: string;
  readonly sha1: string;
  readonly sha256: string;
  readonly sha384: string;
  readonly sha512: string;
  readonly sizeBytes: number;
}

export type BaselineComparison = "match" | "mismatch" | "no-baseline";

export interface VerifyResult {
  readonly hashes: HashResult;
  readonly baselineSha256: string | null;
  readonly comparison: BaselineComparison;
}
```

- [ ] **Step 7: Create the package entry point**

`packages/file-integrity/src/index.ts`:

```typescript
export {
  ALGORITHM_RESULT_KEY,
  HASH_ALGORITHMS,
  type BaselineComparison,
  type CreateDigestSink,
  type DigestSink,
  type HashAlgorithm,
  type HashResult,
  type VerifyResult,
} from "./types.ts";
export { hashAll } from "./hash.ts";
export { compareToBaseline } from "./compare.ts";
export {
  buildReceipt,
  renderReceiptText,
  type ReceiptInput,
  type ReceiptPayload,
} from "./receipt.ts";
```

> Note: `src/index.ts` references `hash.ts`, `compare.ts`, `receipt.ts` created in later tasks. Run the test for THIS task against the `test/types.test.ts` file directly; the full package typecheck happens once those files exist (Task 4).

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Install workspace + commit**

```bash
pnpm install
git add packages/file-integrity/package.json packages/file-integrity/tsconfig.json packages/file-integrity/vitest.config.ts packages/file-integrity/src/types.ts packages/file-integrity/src/index.ts packages/file-integrity/test/types.test.ts
git commit -m "feat(file-integrity): scaffold pure package with algorithm metadata and types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The streaming multi-digest core (`hashAll`)

**Files:**

- Create: `packages/file-integrity/src/hash.ts`
- Create: `packages/file-integrity/test/node-sink.ts`
- Test: `packages/file-integrity/test/hash.test.ts`

**Interfaces:**

- Consumes: `HASH_ALGORITHMS`, `ALGORITHM_RESULT_KEY`, `CreateDigestSink`, `HashResult` (Task 1).
- Produces: `hashAll(stream: ReadableStream<Uint8Array>, createSink: CreateDigestSink): Promise<HashResult>`. Reads the stream once, feeds every chunk to all five sinks, counts bytes, returns the five hex digests + `sizeBytes`. `createNodeDigestSink(algorithm)` (test helper).

- [ ] **Step 1: Write the test-only node-crypto sink**

`packages/file-integrity/test/node-sink.ts`:

```typescript
import { createHash } from "node:crypto";
import type { DigestSink, HashAlgorithm } from "../src/types.ts";

const NODE_ALGORITHM_NAME: Record<HashAlgorithm, string> = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

// A node:crypto-backed DigestSink so hashAll can be exercised in the default node pool. The Worker
// uses a crypto.DigestStream-backed sink instead (apps/worker/src/file-integrity/worker-sink.ts);
// both satisfy the same DigestSink contract.
export function createNodeDigestSink(algorithm: HashAlgorithm): DigestSink {
  const hash = createHash(NODE_ALGORITHM_NAME[algorithm]);
  return {
    write: (chunk) => {
      hash.update(chunk);
    },
    close: async () => hash.digest("hex"),
  };
}
```

- [ ] **Step 2: Write the failing test with known vectors**

`packages/file-integrity/test/hash.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hashAll } from "../src/hash.ts";
import { createNodeDigestSink } from "./node-sink.ts";

// Build a ReadableStream that emits the given byte chunks, so the multi-chunk streaming path is real.
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const encoder = new TextEncoder();

describe("hashAll", () => {
  it("computes all five digests for 'abc' (known vectors) in one pass", async () => {
    const result = await hashAll(streamOf(encoder.encode("abc")), createNodeDigestSink);
    expect(result).toEqual({
      md5: "900150983cd24fb0d6963f7d28e17f72",
      sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha384:
        "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
      sha512:
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
      sizeBytes: 3,
    });
  });

  it("is chunk-boundary independent: 'a'+'bc' equals 'abc'", async () => {
    const split = await hashAll(
      streamOf(encoder.encode("a"), encoder.encode("bc")),
      createNodeDigestSink,
    );
    expect(split.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(split.sizeBytes).toBe(3);
  });

  it("handles the empty stream", async () => {
    const result = await hashAll(streamOf(), createNodeDigestSink);
    expect(result.sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(result.md5).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(result.sizeBytes).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/hash.test.ts`
Expected: FAIL — cannot resolve `../src/hash.ts`.

- [ ] **Step 4: Implement `hashAll`**

`packages/file-integrity/src/hash.ts`:

```typescript
import {
  ALGORITHM_RESULT_KEY,
  HASH_ALGORITHMS,
  type CreateDigestSink,
  type HashResult,
} from "./types.ts";

// Read the byte stream exactly once and fan every chunk into one sink per algorithm. The cost is a
// single pass over the bytes regardless of how many algorithms are requested; nothing is buffered
// beyond the current chunk. The five digests finalise together.
export async function hashAll(
  stream: ReadableStream<Uint8Array>,
  createSink: CreateDigestSink,
): Promise<HashResult> {
  const sinks = HASH_ALGORITHMS.map((algorithm) => ({ algorithm, sink: createSink(algorithm) }));
  const reader = stream.getReader();
  let sizeBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      await Promise.all(sinks.map(({ sink }) => sink.write(value)));
    }
  } finally {
    reader.releaseLock();
  }
  const digests = await Promise.all(
    sinks.map(
      async ({ algorithm, sink }) => [ALGORITHM_RESULT_KEY[algorithm], await sink.close()] as const,
    ),
  );
  const byKey = Object.fromEntries(digests) as Record<string, string>;
  return {
    md5: byKey.md5,
    sha1: byKey.sha1,
    sha256: byKey.sha256,
    sha384: byKey.sha384,
    sha512: byKey.sha512,
    sizeBytes,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/file-integrity/src/hash.ts packages/file-integrity/test/node-sink.ts packages/file-integrity/test/hash.test.ts
git commit -m "feat(file-integrity): single-pass five-algorithm streaming hash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Baseline comparison (`compareToBaseline`)

**Files:**

- Create: `packages/file-integrity/src/compare.ts`
- Test: `packages/file-integrity/test/compare.test.ts`

**Interfaces:**

- Consumes: `BaselineComparison` (Task 1).
- Produces: `compareToBaseline(computedSha256: string, baselineSha256: string | null): BaselineComparison`.

- [ ] **Step 1: Write the failing test**

`packages/file-integrity/test/compare.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { compareToBaseline } from "../src/compare.ts";

const A = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("compareToBaseline", () => {
  it("returns match when the recomputed SHA-256 equals the baseline", () => {
    expect(compareToBaseline(A, A)).toBe("match");
  });

  it("is case-insensitive on hex", () => {
    expect(compareToBaseline(A.toUpperCase(), A)).toBe("match");
  });

  it("returns mismatch when they differ", () => {
    expect(compareToBaseline(A, A.replace(/.$/, "0"))).toBe("mismatch");
  });

  it("returns no-baseline when the stored baseline is null or empty", () => {
    expect(compareToBaseline(A, null)).toBe("no-baseline");
    expect(compareToBaseline(A, "")).toBe("no-baseline");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/compare.test.ts`
Expected: FAIL — cannot resolve `../src/compare.ts`.

- [ ] **Step 3: Implement `compareToBaseline`**

`packages/file-integrity/src/compare.ts`:

```typescript
import type { BaselineComparison } from "./types.ts";

// Compare a freshly recomputed SHA-256 against the digest recorded at ingest. A null/empty baseline
// (e.g. an oversize file committed unscanned, whose content_sha256 was never set) is reported as
// no-baseline rather than a false mismatch — the caller states plainly that no baseline exists.
export function compareToBaseline(
  computedSha256: string,
  baselineSha256: string | null,
): BaselineComparison {
  if (baselineSha256 === null || baselineSha256 === "") return "no-baseline";
  return computedSha256.toLowerCase() === baselineSha256.toLowerCase() ? "match" : "mismatch";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/compare.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/file-integrity/src/compare.ts packages/file-integrity/test/compare.test.ts
git commit -m "feat(file-integrity): baseline SHA-256 comparison with no-baseline case

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The hash receipt (`buildReceipt` + `renderReceiptText`)

**Files:**

- Create: `packages/file-integrity/src/receipt.ts`
- Test: `packages/file-integrity/test/receipt.test.ts`

**Interfaces:**

- Consumes: `HashResult`, `BaselineComparison` (Task 1).
- Produces: `interface ReceiptInput`, `type ReceiptPayload = ReceiptInput`, `buildReceipt(input: ReceiptInput): ReceiptPayload`, `renderReceiptText(payload: ReceiptPayload): string`.

- [ ] **Step 1: Write the failing test**

`packages/file-integrity/test/receipt.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildReceipt, renderReceiptText, type ReceiptInput } from "../src/receipt.ts";

const HASHES = {
  md5: "900150983cd24fb0d6963f7d28e17f72",
  sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  sha384:
    "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
  sha512:
    "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  sizeBytes: 3,
};

const VERIFY_INPUT: ReceiptInput = {
  tool: { name: "File Hash & Integrity", version: "1" },
  firmName: "Example Firm",
  file: { name: "complaint.pdf", fileId: "file_abc", versionId: "fileVersion_def" },
  hashes: HASHES,
  verification: {
    baselineSha256: HASHES.sha256,
    comparison: "match",
    verifiedBy: "user_ghi",
    auditLogId: "auditLog_jkl",
  },
  computedAt: "2026-06-23T12:00:00.000Z",
};

describe("buildReceipt", () => {
  it("returns the structured payload unchanged", () => {
    expect(buildReceipt(VERIFY_INPUT)).toEqual(VERIFY_INPUT);
  });
});

describe("renderReceiptText", () => {
  it("renders a verify receipt with every digest, the result, and the audit correlation", () => {
    const text = renderReceiptText(buildReceipt(VERIFY_INPUT));
    expect(text).toContain("File Hash & Integrity");
    expect(text).toContain("complaint.pdf");
    expect(text).toContain(`SHA-256  ${HASHES.sha256}`);
    expect(text).toContain(`MD5      ${HASHES.md5}`);
    expect(text).toContain("Baseline match: MATCH");
    expect(text).toContain("Audit record: auditLog_jkl");
    expect(text).toContain("2026-06-23T12:00:00.000Z");
  });

  it("omits verification lines for a standalone receipt", () => {
    const text = renderReceiptText(
      buildReceipt({
        ...VERIFY_INPUT,
        file: { name: "dropped.bin", fileId: null, versionId: null },
        verification: null,
      }),
    );
    expect(text).toContain("dropped.bin");
    expect(text).not.toContain("Baseline match");
    expect(text).not.toContain("Audit record");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/receipt.test.ts`
Expected: FAIL — cannot resolve `../src/receipt.ts`.

- [ ] **Step 3: Implement the receipt**

`packages/file-integrity/src/receipt.ts`:

```typescript
import { HASH_ALGORITHMS, type BaselineComparison, type HashResult } from "./types.ts";

export interface ReceiptInput {
  readonly tool: { readonly name: string; readonly version: string };
  readonly firmName: string | null;
  readonly file: {
    readonly name: string | null;
    readonly fileId: string | null;
    readonly versionId: string | null;
  };
  readonly hashes: HashResult;
  // null for the standalone surface (no in-system file, no baseline, no audit record).
  readonly verification: {
    readonly baselineSha256: string | null;
    readonly comparison: BaselineComparison;
    readonly verifiedBy: string | null;
    readonly auditLogId: string | null;
  } | null;
  readonly computedAt: string;
}

export type ReceiptPayload = ReceiptInput;

// The structured receipt is the input verbatim — a single shape returned as JSON by the API and
// rendered to text for download. Kept as a function so a future signed/PDF receipt slots in here.
export function buildReceipt(input: ReceiptInput): ReceiptPayload {
  return input;
}

const RESULT_LABEL: Record<BaselineComparison, string> = {
  match: "MATCH",
  mismatch: "MISMATCH — bytes differ from the recorded baseline",
  "no-baseline": "NO BASELINE — no ingest digest recorded for this version",
};

const DIGEST_FIELD: Record<(typeof HASH_ALGORITHMS)[number], keyof HashResult> = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

// A fixed-width, human-readable receipt suitable for a .txt download or printing. Contains digests,
// byte size, the server timestamp, and (for a verify) the baseline result and audit correlation —
// never file contents.
export function renderReceiptText(payload: ReceiptPayload): string {
  const lines: string[] = [];
  lines.push(`${payload.tool.name} (v${payload.tool.version}) — hash receipt`);
  if (payload.firmName !== null) lines.push(`Firm: ${payload.firmName}`);
  if (payload.file.name !== null) lines.push(`File: ${payload.file.name}`);
  if (payload.file.fileId !== null) lines.push(`File ID: ${payload.file.fileId}`);
  if (payload.file.versionId !== null) lines.push(`Version ID: ${payload.file.versionId}`);
  lines.push(`Size: ${payload.hashes.sizeBytes} bytes`);
  lines.push(`Computed at: ${payload.computedAt}`);
  lines.push("");
  for (const algorithm of HASH_ALGORITHMS) {
    lines.push(`${algorithm.padEnd(8)} ${payload.hashes[DIGEST_FIELD[algorithm]]}`);
  }
  if (payload.verification !== null) {
    lines.push("");
    lines.push(`Baseline match: ${RESULT_LABEL[payload.verification.comparison]}`);
    if (payload.verification.baselineSha256 !== null) {
      lines.push(`Baseline SHA-256: ${payload.verification.baselineSha256}`);
    }
    if (payload.verification.verifiedBy !== null) {
      lines.push(`Verified by: ${payload.verification.verifiedBy}`);
    }
    if (payload.verification.auditLogId !== null) {
      lines.push(`Audit record: ${payload.verification.auditLogId}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/file-integrity exec vitest run test/receipt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full package typecheck + tests**

Run: `pnpm --filter @magna-carta/file-integrity test`
Expected: PASS (all tests). Then `pnpm --filter @magna-carta/file-integrity exec tsc --noEmit` (or the repo `vp check` scoped to the package) — Expected: no type errors (`src/index.ts` now resolves all referenced modules).

- [ ] **Step 6: Add the area CLAUDE.md and commit**

`packages/file-integrity/CLAUDE.md`:

```markdown
# @magna-carta/file-integrity — local notes

Pure core for the File Hash & Integrity tool. No D1, no Hono, no `env`, no Svelte, no network — all
effects injected.

- `hashAll(stream, createSink)` reads a byte stream once and fans every chunk into one `DigestSink`
  per algorithm (`MD5`, `SHA-1`, `SHA-256`, `SHA-384`, `SHA-512`). One pass, five digests; nothing
  buffered beyond the current chunk.
- `DigestSink` is the injected seam. The Worker backs it with `crypto.DigestStream`
  (`apps/worker/src/file-integrity/worker-sink.ts`); tests back it with `node:crypto`
  (`test/node-sink.ts`). The package itself never imports either runtime.
- `compareToBaseline(computedSha256, baselineSha256)` → `match` | `mismatch` | `no-baseline`. Only
  SHA-256 has an ingest baseline (`file_version.content_sha256`).
- `buildReceipt` / `renderReceiptText` produce the structured + text hash receipt. A signed or PDF
  receipt slots in behind `buildReceipt` later.
```

```bash
git add packages/file-integrity/src/receipt.ts packages/file-integrity/test/receipt.test.ts packages/file-integrity/CLAUDE.md
git commit -m "feat(file-integrity): hash receipt builder and text rendering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Register the `tools:fileIntegrity` permission

**Files:**

- Modify: `packages/access-control/src/registry.ts` (the `tools:*` block)
- Modify: `packages/access-control/test/registry.test.ts` (the `permissionsForNamespace("tools")` expectation)

**Interfaces:**

- Produces: the string `"tools:fileIntegrity"` as a registered `Permission`, usable by `assertPermission(...)`.

- [ ] **Step 1: Update the registry test (failing) first**

In `packages/access-control/test/registry.test.ts`, add `"tools:fileIntegrity"` to the end of the `tools` expectation array:

```typescript
it("permissionsForNamespace('tools') returns exactly the tools keys, in registry order", () => {
  expect(permissionsForNamespace("tools")).toEqual([
    "tools:propertyListings",
    "tools:propertyRecords",
    "tools:businessLookup",
    "tools:attorneyLicense",
    "tools:shipping",
    "tools:speedTest",
    "tools:firmUsage",
    "tools:whois",
    "tools:safeBrowse",
    "tools:fileConverter",
    "tools:metadataScrubber",
    "tools:fileIntegrity",
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: FAIL — `permissionsForNamespace("tools")` is missing `"tools:fileIntegrity"`.

- [ ] **Step 3: Add the permission to the registry**

In `packages/access-control/src/registry.ts`, append to the `tools:*` block (after `"tools:metadataScrubber"`):

```typescript
  "tools:fileIntegrity", // compute a file's cryptographic digests + verify a stored file against its ingest baseline
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git commit -m "feat(access-control): register tools:fileIntegrity permission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add the `file` context tag and the catalog row

**Files:**

- Modify: `packages/tools/src/types.ts` (the `ContextTag` union)
- Modify: `packages/tools/src/catalog.ts` (one new row)
- Test: `packages/tools/test/select.test.ts` (a `toolsFor("file")` assertion) — if this file does not exist, add the test to the existing catalog/selector test file in `packages/tools/test/`.

**Interfaces:**

- Consumes: `toolsFor(catalog, tag, permissions)` and `ToolManifest` (existing in `@magna-carta/tools`).
- Produces: `ContextTag` now includes `"file"`; the catalog contains a `file-hash-integrity` row tagged `["file", "none"]`.

- [ ] **Step 1: Write the failing selector test**

Add to `packages/tools/test/select.test.ts` (create it if absent, mirroring the existing selector-test imports in `packages/tools/test/`):

```typescript
import { describe, expect, it } from "vitest";
import { assertPermission } from "@magna-carta/access-control/registry";
import { CATALOG } from "../src/catalog.ts";
import { toolsFor } from "../src/select.ts";

describe("file context tag", () => {
  it("surfaces file-hash-integrity for the 'file' context when permitted", () => {
    const permissions = new Set([assertPermission("tools:fileIntegrity")]);
    const ids = toolsFor(CATALOG, "file", permissions).map((tool) => tool.id);
    expect(ids).toContain("file-hash-integrity");
  });

  it("hides it without the permission", () => {
    const ids = toolsFor(CATALOG, "file", new Set()).map((tool) => tool.id);
    expect(ids).not.toContain("file-hash-integrity");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/tools test`
Expected: FAIL — `"file"` is not assignable to `ContextTag`, and the catalog has no `file-hash-integrity` row.

- [ ] **Step 3: Add `"file"` to the `ContextTag` union**

In `packages/tools/src/types.ts`:

```typescript
// What real-world input a tool acts on — drives contextual surfacing. `none` = general-only.
export type ContextTag = "address" | "person" | "company" | "matter" | "website" | "file" | "none";
```

Also update the inline comment on `SUBJECT_GROUP_ORDER`'s `"documents"` entry if helpful (no order change — `file-hash-integrity` uses the existing `documents` group).

- [ ] **Step 4: Add the catalog row**

In `packages/tools/src/catalog.ts`, append a row after the `file-converter` entry:

```typescript
  {
    id: "file-hash-integrity",
    name: "File Hash & Integrity",
    icon: "fingerprint",
    subjectGroup: "documents",
    permission: assertPermission("tools:fileIntegrity"),
    contextTags: ["file", "none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — including the existing `test/purity.test.ts` (the row adds no import of a tool-logic package, so purity holds).

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/types.ts packages/tools/src/catalog.ts packages/tools/test/select.test.ts
git commit -m "feat(tools): add file context tag and File Hash & Integrity catalog row

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: File-manager query for the integrity baseline

**Files:**

- Modify: `packages/file-manager/src/queries.ts` (add `getCurrentVersionForIntegrity`)
- Test: `packages/file-manager/test/queries.test.ts` (add a case) — use the existing queries test file; if integrity needs the Workers pool it instead lives in `apps/worker/test` (see note).

**Interfaces:**

- Consumes: the existing `selectCurrentCleanVersionStatement` pattern + `FileId`, `FileVersionId`, `SqlDatabase`.
- Produces: `getCurrentVersionForIntegrity(database: SqlDatabase, fileId: FileId): Promise<VersionIntegrity | undefined>` where `interface VersionIntegrity { id: FileVersionId; r2Key: string; sizeBytes: number | null; contentSha256: string | null }`.

- [ ] **Step 1: Add the query (read the existing `getCurrentCleanVersion` first for the exact statement helper)**

In `packages/file-manager/src/queries.ts`, add an exported function that selects the current clean version including `content_sha256`. Mirror `getCurrentCleanVersion` (which already selects from the current clean version) but add the `content_sha256` column:

```typescript
export interface VersionIntegrity {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly contentSha256: string | null;
}

// The current clean version's R2 key plus the SHA-256 recorded at ingest — the integrity baseline.
// Returns undefined when the file has no clean current version (e.g. still pending or quarantined).
export async function getCurrentVersionForIntegrity(
  database: SqlDatabase,
  fileId: FileId,
): Promise<VersionIntegrity | undefined> {
  const { results } = await selectCurrentCleanVersionStatement(database, fileId).all<{
    id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
    content_sha256: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256,
  };
}
```

> If `selectCurrentCleanVersionStatement`'s SELECT does not already include `content_sha256`, add that column to its column list (it is a non-breaking addition — existing callers ignore extra columns). Confirm by reading the statement before editing.

- [ ] **Step 2: Add a test** in the existing file-manager queries test (node pool with the in-memory SQLite test database the package already uses). Seed a committed clean version with a known `content_sha256`, then assert `getCurrentVersionForIntegrity` returns `{ id, r2Key, contentSha256 }` and `undefined` for a file with only a pending version. Follow the existing seeding helpers in that test file.

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/file-manager/src/queries.ts packages/file-manager/test/queries.test.ts
git commit -m "feat(file-manager): query the current clean version's integrity baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Worker digest sink + the `hash` route

**Files:**

- Create: `apps/worker/src/file-integrity/worker-sink.ts`
- Create: `apps/worker/src/routes/files/file-integrity.ts` (the `hash` route + `registerFileIntegrityRoutes`; the `verify` route is added in Task 9)
- Modify: `apps/worker/src/app.ts` (register the routes)
- Test: `apps/worker/test/file-integrity.test.ts`

**Interfaces:**

- Consumes: `hashAll` (Task 2), `HashAlgorithm`/`DigestSink` (Task 1), the chokepoint helpers (`chokepointMiddleware`, `requireChokepointFirmContext`), `defineOpenAPIRoute`/`RouteMeta`, `readInspectableSizeCap`.
- Produces: `createWorkerDigestSink(algorithm: HashAlgorithm): DigestSink`; `registerFileIntegrityRoutes(app, chokepoint)`; `POST /api/v1/file-integrity/hash`.

- [ ] **Step 1: Write the Workers-pool route test (failing)**

`apps/worker/test/file-integrity.test.ts` (mirror the existing route tests in `apps/worker/test/` for app construction, the authenticated/permitted session helper, and the firm fixture):

```typescript
import { describe, expect, it } from "vitest";
// Reuse this suite's existing harness: how peer route tests build the app and a permitted session.
import { buildTestApp, permittedSession } from "./helpers/app.ts"; // match the real helper path/names

describe("POST /api/v1/file-integrity/hash", () => {
  it("returns all five digests for the streamed body", async () => {
    const { app, env } = await buildTestApp();
    const session = await permittedSession(env, ["tools:fileIntegrity"]);
    const response = await app.request(
      "/api/v1/file-integrity/hash",
      {
        method: "POST",
        headers: {
          ...session.headers,
          "content-type": "application/octet-stream",
          "content-length": "3",
        },
        body: new TextEncoder().encode("abc"),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.algorithms.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(body.algorithms.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(body.sizeBytes).toBe(3);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { app, env } = await buildTestApp();
    const response = await app.request(
      "/api/v1/file-integrity/hash",
      { method: "POST", body: new TextEncoder().encode("abc") },
      env,
    );
    expect(response.status).toBe(401);
  });
});
```

> Adjust `buildTestApp`/`permittedSession` to the actual helper names used by the neighbouring tests in `apps/worker/test/` (read one peer test first). The assertions on digests/size are the contract.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/file-integrity.test.ts`
Expected: FAIL — route not found (404) / module missing.

- [ ] **Step 3: Implement the Worker digest sink**

`apps/worker/src/file-integrity/worker-sink.ts`:

```typescript
import type { DigestSink, HashAlgorithm } from "@magna-carta/file-integrity/types";

// crypto.DigestStream is a Workers runtime extension absent from @types/node's Crypto. Reach it
// through a precisely-typed accessor; the real implementation is workerd's, exercised in the Workers
// test pool, where streaming a multi-GB object never buffers.
interface DigestStreamConstructor {
  new (algorithm: string): WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
}
const DigestStream = (crypto as unknown as { DigestStream: DigestStreamConstructor }).DigestStream;

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// A DigestSink backed by the native streaming digest. The algorithm names this tool uses
// (MD5, SHA-1, SHA-256, SHA-384, SHA-512) are exactly those crypto.DigestStream accepts.
export function createWorkerDigestSink(algorithm: HashAlgorithm): DigestSink {
  const stream = new DigestStream(algorithm);
  const writer = stream.getWriter();
  return {
    write: (chunk) => writer.write(chunk),
    close: async () => {
      await writer.close();
      return toHex(await stream.digest);
    },
  };
}
```

- [ ] **Step 4: Implement the `hash` route + registration**

`apps/worker/src/routes/files/file-integrity.ts`:

```typescript
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { hashAll } from "@magna-carta/file-integrity/hash";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { createWorkerDigestSink } from "../file-integrity/worker-sink.ts";

const Algorithms = z.object({
  md5: z.string(),
  sha1: z.string(),
  sha256: z.string(),
  sha384: z.string(),
  sha512: z.string(),
});

const HashResponse = z
  .object({
    algorithms: Algorithms,
    sizeBytes: z.number(),
    computedAt: z.string(),
    expectedMatch: z.enum(["md5", "sha1", "sha256", "sha384", "sha512"]).nullable(),
  })
  .openapi("FileIntegrityHashResponse");

export const fileIntegrityHashMeta: RouteMeta = {
  operationId: "fileIntegrity.hash",
  surface: "app",
  authenticated: true,
  permission: "tools:fileIntegrity",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const fileIntegrityHashRoute = defineOpenAPIRoute(fileIntegrityHashMeta, {
  method: "post",
  path: "/api/v1/file-integrity/hash",
  description:
    "Compute MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests of the request body in a single pass. Optionally report which algorithm matches an expected digest. Nothing is stored.",
  request: {
    query: z.object({ expected: z.string().min(1).max(128).optional() }),
  },
  responses: {
    200: {
      description: "The five digests and byte size of the supplied body",
      content: { "application/json": { schema: HashResponse } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:fileIntegrity",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "The body exceeds the firm's inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type FileIntegrityApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function matchExpected(
  algorithms: { md5: string; sha1: string; sha256: string; sha384: string; sha512: string },
  expected: string | undefined,
): "md5" | "sha1" | "sha256" | "sha384" | "sha512" | null {
  if (expected === undefined) return null;
  const wanted = expected.toLowerCase();
  for (const key of ["md5", "sha1", "sha256", "sha384", "sha512"] as const) {
    if (algorithms[key] === wanted) return key;
  }
  return null;
}

export function registerFileIntegrityRoutes(app: FileIntegrityApp, chokepoint: Chokepoint): void {
  // POST /api/v1/file-integrity/hash — stream the request body straight through the five-algorithm
  // digest. No request-body schema (the bytes are binary), so the raw stream reaches the hasher
  // unbuffered; the size cap is enforced from Content-Length before hashing.
  app.openapi(
    {
      ...fileIntegrityHashRoute,
      middleware: chokepointMiddleware(chokepoint, fileIntegrityHashRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
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
          title: "File too large to hash inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const hashes = await hashAll(body, createWorkerDigestSink);
      const { expected } = c.req.valid("query");
      return c.json(
        {
          algorithms: {
            md5: hashes.md5,
            sha1: hashes.sha1,
            sha256: hashes.sha256,
            sha384: hashes.sha384,
            sha512: hashes.sha512,
          },
          sizeBytes: hashes.sizeBytes,
          computedAt: new Date().toISOString(),
          expectedMatch: matchExpected(hashes, expected),
        },
        200,
      );
    },
  );
}
```

- [ ] **Step 5: Register the routes in `app.ts`**

In `apps/worker/src/app.ts`, import and call (placing it near the other tool route registrations such as `registerWhoisRoute`):

```typescript
import { registerFileIntegrityRoutes } from "./routes/files/file-integrity.ts";
// ... in the registration body, alongside registerFirmUsageRoute(app, chokepoint); :
registerFileIntegrityRoutes(app, chokepoint);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/file-integrity.test.ts`
Expected: PASS (the hash + 401 cases).

- [ ] **Step 7: Regenerate the OpenAPI contract + client**

```bash
pnpm --filter @magna-carta/worker run emit-openapi
pnpm --filter @magna-carta/api-client run generate
```

Expected: the contract gains `fileIntegrity.hash`; the client regenerates without error.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/file-integrity/worker-sink.ts apps/worker/src/routes/files/file-integrity.ts apps/worker/src/app.ts apps/worker/test/file-integrity.test.ts
git add -A apps/worker/src/contracts apps/worker/openapi packages/api-client  # whatever the regen touched — verify with git status first
git commit -m "feat(worker): file-integrity hash route (streamed body, five digests)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Before staging the regen output, run `git status` and add only the generated contract/client files that actually changed.

---

## Task 9: The `verify` route (R2 read, baseline compare, audit row, receipt)

**Files:**

- Modify: `apps/worker/src/routes/files/file-integrity.ts` (add the `verify` route to `registerFileIntegrityRoutes`)
- Test: `apps/worker/test/file-integrity.test.ts` (add verify cases)

**Interfaces:**

- Consumes: `getCurrentVersionForIntegrity` (Task 7), `hashAll` (Task 2), `compareToBaseline` (Task 3), `buildReceipt` (Task 4), `createWorkerDigestSink` (Task 8), `insertAuditLogStatement`/`commitEffectBatch`/`newIdentifier`, `requireChokepointFirmContext`/`requireChokepointUserId`.
- Produces: `POST /api/v1/file-integrity/verify`.

- [ ] **Step 1: Write the failing verify tests**

Add to `apps/worker/test/file-integrity.test.ts`:

```typescript
describe("POST /api/v1/file-integrity/verify", () => {
  it("matches a stored file's bytes against its ingest baseline and records an audit row", async () => {
    const { app, env } = await buildTestApp();
    const session = await permittedSession(env, ["tools:fileIntegrity"]);
    // Seed a committed clean file whose R2 object bytes hash to its recorded content_sha256.
    const { fileId } = await seedCleanFile(env, { bytes: new TextEncoder().encode("abc") }); // match the suite's file-seeding helper
    const response = await app.request(
      "/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: { ...session.headers, "content-type": "application/json" },
        body: JSON.stringify({ fileId }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.comparison).toBe("match");
    expect(body.algorithms.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(body.receipt.verification.auditLogId).toBeTruthy();

    const audit = await env.DB; /* the firm db handle the suite exposes */
    // Assert one file.integrity_verified row exists for this file (use the suite's firm-db query helper).
  });

  it("reports mismatch when the stored bytes were altered after ingest", async () => {
    const { app, env } = await buildTestApp();
    const session = await permittedSession(env, ["tools:fileIntegrity"]);
    const { fileId, r2Key } = await seedCleanFile(env, { bytes: new TextEncoder().encode("abc") });
    await env.R2.put(r2Key, new TextEncoder().encode("tampered")); // overwrite the object bytes
    const response = await app.request(
      "/api/v1/file-integrity/verify",
      {
        method: "POST",
        headers: { ...session.headers, "content-type": "application/json" },
        body: JSON.stringify({ fileId }),
      },
      env,
    );
    const body = await response.json();
    expect(body.comparison).toBe("mismatch");
  });
});
```

> Use the suite's real file-seeding and firm-db query helpers (read a peer test that commits a file). The behavioural assertions (`comparison`, the audit row, the receipt's `auditLogId`) are the contract.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/file-integrity.test.ts`
Expected: FAIL — `/verify` returns 404.

- [ ] **Step 3: Add the verify route**

Extend `apps/worker/src/routes/files/file-integrity.ts`. Add imports at the top:

```typescript
import { compareToBaseline } from "@magna-carta/file-integrity/compare";
import { buildReceipt } from "@magna-carta/file-integrity/receipt";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { newIdentifier } from "@magna-carta/identifiers";
import { getCurrentVersionForIntegrity } from "@magna-carta/file-manager/queries";
import { requireChokepointUserId } from "../chokepoint/context-accessors.ts";
```

> Confirm the exact import specifiers against the real `exports` maps (`@magna-carta/data-access` for `effect-batch`/`audit-statements`, `@magna-carta/identifiers` for `newIdentifier`) by reading a route that already uses them, e.g. `apps/worker/src/routes/files/downloads.ts`.

Add the schemas and the route definition:

```typescript
const VerifyRequest = z.object({ fileId: z.string().min(1) });

const VerifyResponseSchema = z
  .object({
    algorithms: Algorithms,
    sizeBytes: z.number(),
    baselineSha256: z.string().nullable(),
    comparison: z.enum(["match", "mismatch", "no-baseline"]),
    computedAt: z.string(),
    receipt: z.unknown(),
  })
  .openapi("FileIntegrityVerifyResponse");

export const fileIntegrityVerifyMeta: RouteMeta = {
  operationId: "fileIntegrity.verify",
  surface: "app",
  authenticated: true,
  permission: "tools:fileIntegrity",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const fileIntegrityVerifyRoute = defineOpenAPIRoute(fileIntegrityVerifyMeta, {
  method: "post",
  path: "/api/v1/file-integrity/verify",
  description:
    "Recompute a stored file's digests from its bytes at rest and compare the SHA-256 to the digest recorded at intake, recording the check. Returns the digests, the baseline result, and a hash receipt.",
  request: {
    body: { content: { "application/json": { schema: VerifyRequest } } },
  },
  responses: {
    200: {
      description: "The recomputed digests, the baseline comparison, and the receipt",
      content: { "application/json": { schema: VerifyResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:fileIntegrity",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No clean current version exists for the file",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description:
        "The stored file exceeds the firm's inspectable-size cap for inline verification",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});
```

Inside `registerFileIntegrityRoutes`, after the hash route's `app.openapi(...)`, add:

```typescript
// POST /api/v1/file-integrity/verify — recompute a stored file's digests from R2 and compare the
// SHA-256 to the ingest baseline, recording a chain-of-custody audit row.
app.openapi(
  {
    ...fileIntegrityVerifyRoute,
    middleware: chokepointMiddleware(chokepoint, fileIntegrityVerifyRoute),
  },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const { fileId } = c.req.valid("json");

    const version = await getCurrentVersionForIntegrity(firm.firmDatabase, fileId);
    if (version === undefined) {
      return problemJson(c, {
        type: "not-found",
        title: "No verifiable version",
        status: 404,
        detail: "The file has no clean current version to verify.",
      });
    }

    const cap = await readInspectableSizeCap(firm.firmDatabase);
    if (version.sizeBytes !== null && version.sizeBytes > cap) {
      return problemJson(c, {
        type: "upload-not-allowed",
        title: "File too large to verify inline",
        status: 413,
        detail: `The stored file exceeds this firm's inspectable-size cap (${cap} bytes).`,
      });
    }

    const object = await c.env.R2.get(version.r2Key);
    if (object === null) {
      return problemJson(c, {
        type: "not-found",
        title: "Stored bytes unavailable",
        status: 404,
        detail: "The file's stored object could not be read.",
      });
    }

    const hashes = await hashAll(object.body, createWorkerDigestSink);
    const comparison = compareToBaseline(hashes.sha256, version.contentSha256);
    const computedAt = new Date().toISOString();

    const auditLogId = newIdentifier("auditLog");
    await commitEffectBatch(
      firm.firmDatabase,
      {
        statements: [
          insertAuditLogStatement(firm.firmDatabase, {
            id: auditLogId,
            event: "file.integrity_verified",
            actorUserId: userId,
            subjectId: fileId,
            metadata: {
              versionId: version.id,
              baselineSha256: version.contentSha256,
              computed: {
                md5: hashes.md5,
                sha1: hashes.sha1,
                sha256: hashes.sha256,
                sha384: hashes.sha384,
                sha512: hashes.sha512,
              },
              result: comparison,
              sizeBytes: hashes.sizeBytes,
              verifiedAt: computedAt,
            },
            now: computedAt,
          }),
        ],
        outboxMessages: [],
      },
      { now: () => computedAt },
    );

    const receipt = buildReceipt({
      tool: { name: "File Hash & Integrity", version: "1" },
      firmName: firm.firmName ?? null,
      file: { name: null, fileId, versionId: version.id },
      hashes,
      verification: {
        baselineSha256: version.contentSha256,
        comparison,
        verifiedBy: userId,
        auditLogId,
      },
      computedAt,
    });

    return c.json(
      {
        algorithms: {
          md5: hashes.md5,
          sha1: hashes.sha1,
          sha256: hashes.sha256,
          sha384: hashes.sha384,
          sha512: hashes.sha512,
        },
        sizeBytes: hashes.sizeBytes,
        baselineSha256: version.contentSha256,
        comparison,
        computedAt,
        receipt,
      },
      200,
    );
  },
);
```

> `firm.firmName` may not exist on the firm context; if not, pass `null` (the receipt's firm line is optional). Read `requireChokepointFirmContext`'s return type and use the available firm-name field, or `null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/file-integrity.test.ts`
Expected: PASS (hash + verify match + verify mismatch + 401).

- [ ] **Step 5: Regenerate the contract + client**

```bash
pnpm --filter @magna-carta/worker run emit-openapi
pnpm --filter @magna-carta/api-client run generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/files/file-integrity.ts apps/worker/test/file-integrity.test.ts
git add -A   # plus the regen output — verify with git status first
git commit -m "feat(worker): file-integrity verify route with chain-of-custody audit and receipt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Seed the permission to roles (migration)

**Files:**

- Create: `packages/database/drizzle/per-firm/0021_seed-tools-file-integrity.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (add idx 21)
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + map entry)
- Test: the worker per-firm migration test / any all-roles seed test (run the suite; update enumerations if present)

**Interfaces:**

- Produces: every default role granted `tools:fileIntegrity` (an everyday file utility, the same broad reach as `tools:whois`/`tools:safeBrowse`/`tools:fileConverter`).

- [ ] **Step 1: Create the migration**

`packages/database/drizzle/per-firm/0021_seed-tools-file-integrity.sql` — grant to all five default roles (the role* ids are the defaults from the member-rbac seed, identical to the web-domains seed). Mint five fresh unique `rolePermission*` ids:

```sql
-- Seed tools:fileIntegrity onto every default role. Computing a file's digests and verifying a stored
-- file against its ingest baseline is an everyday file utility any firm member may need without a
-- separate grant — the same broad reach as tools:whois / tools:safeBrowse / tools:fileConverter. The
-- rolePermission_ handles below were minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Fh7Kp2qRnLtVc3xWbE4dJ', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Gj8Lq3rSpMuWd4yXcF5eKm', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Hk9Mr4sTqNvXe5zYdG6fLn', 'role_917LCQyRKP50Z9bW89vXl', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Jm2Ns5tUrPwYf6aZeH7gMp', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:fileIntegrity');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Kn3Pt6uVsQxZg7bAfJ8hNq', 'role_WojF9F7kksBEftsmZGNhb', 'tools:fileIntegrity');
```

> The five `rolePermission_` ids above must be unique across the migration history and use the project's identifier alphabet (base58, no `0`/`O`/`I`/`l`). If in doubt, mint each via the repo's `newIdentifier("rolePermission")` once and paste the literals. The five `role_id` values are the exact defaults reused by `0017_seed-tools-web-domains.sql` — copy them from that file to be certain.

- [ ] **Step 2: Add the journal entry**

In `packages/database/drizzle/per-firm/meta/_journal.json`, append to `entries` (after idx 20):

```json
{
  "idx": 21,
  "version": "6",
  "when": 1782300200000,
  "tag": "0021_seed-tools-file-integrity",
  "breakpoints": true
}
```

(Add a comma after the idx-20 object's closing brace.)

- [ ] **Step 3: Register the migration in the Worker**

In `apps/worker/src/per-firm-migrations.ts`, add the import (after the `0020` import):

```typescript
import seedToolsFileIntegritySql from "@magna-carta/database/drizzle/per-firm/0021_seed-tools-file-integrity.sql";
```

and the map entry (after the `"0020_seed-tools-metadata-scrubber"` entry):

```typescript
    "0021_seed-tools-file-integrity": seedToolsFileIntegritySql,
```

- [ ] **Step 4: Run the migration + worker tests**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS — the per-firm migration suite applies `0021` cleanly; the verify-route test (which seeds a firm and a permitted session) still passes with the permission granted via the seed. If a test enumerates seeded permissions or role grants, update it to include `tools:fileIntegrity`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/drizzle/per-firm/0021_seed-tools-file-integrity.sql packages/database/drizzle/per-firm/meta/_journal.json apps/worker/src/per-firm-migrations.ts
git commit -m "feat(database): seed tools:fileIntegrity to default roles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full quality gate, docs, and changelog/decision fragments

**Files:**

- Modify: `STATUS.md` (the Tools area / this slice's row only)
- Modify: `ROADMAP.md` (a line under the Tools area)
- Create: `changelog.d/file-hash-integrity.md`
- Create: `docs/decisions/pending/file-hash-integrity-architecture.md`

**Interfaces:** none (docs + gate).

- [ ] **Step 1: Run the full quality gate**

Run:

```bash
pnpm check
vp test
```

Expected: fmt + lint + typecheck + svelte-check pass; the full unit/integration suite passes (including the Miniflare worker integration test). Fix anything that fails before continuing.

- [ ] **Step 2: Run the process-reference fitness check**

Run: `pnpm run lint:process-refs`
Expected: PASS — no `ADR-NNNN` / "spec §N" / "slice/phase N" strings in the new source, tests, or OpenAPI descriptions.

- [ ] **Step 3: Add the changelog fragment**

`changelog.d/file-hash-integrity.md`:

```markdown
### Added

- **File Hash & Integrity tool.** Compute a file's MD5, SHA-1, SHA-256, SHA-384 and SHA-512 digests in
  one pass, and verify a stored file still matches the SHA-256 recorded when it was ingested — with a
  chain-of-custody record and a downloadable hash receipt. Available as a standalone Tools utility and
  as a per-file action.
```

- [ ] **Step 4: Add the decision fragment**

`docs/decisions/pending/file-hash-integrity-architecture.md` — follow the frontmatter shape of an existing file in `docs/decisions/pending/` (read one first). Record: the pure streaming multi-digest core (one read → five digests), server-side compute on every surface (forensic attestability + MD5), verification against the ingest baseline recorded to `audit_log`, the new `file` context tag, and the deferred seams (async large-file verify, client-side standalone hashing, signed/PDF receipts).

- [ ] **Step 5: Update STATUS.md and ROADMAP.md**

In `STATUS.md`, add (or update) the File Hash & Integrity row to reflect spec ✓ / plan ✓ / built ✓ / tested ✓. In `ROADMAP.md`, add a one-line shipped/now entry under the Tools area. Edit only this slice's row in `STATUS.md` (append-don't-collide).

> Run `vp run worktrees` before editing `STATUS.md`/`ROADMAP.md` (declared touch-overlap with tools-metadata-scrubber) and sync `main` if it has advanced.

- [ ] **Step 6: Commit**

```bash
git add STATUS.md ROADMAP.md changelog.d/file-hash-integrity.md docs/decisions/pending/file-hash-integrity-architecture.md
git commit -m "docs(tools): file-hash-integrity changelog, decision, status, roadmap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Pre-merge adversarial review

**Files:** none (review).

- [ ] **Step 1:** Run the end-of-build / pre-merge multi-angle adversarial review with empirical verifiers, per `docs/conventions/testing.md` (the package build & review standard). Focus angles: the streaming fan-out correctness under chunk boundaries and backpressure; the size-cap enforcement (Content-Length spoofing — a body larger than its declared length); SSRF/tenancy (the verify route only ever reads a firm-scoped, server-resolved R2 key); redaction (no file content or name in the audit row, receipt, or logs); the `no-baseline` path; and the OpenAPI binary-body route emitting cleanly.
- [ ] **Step 2:** Triage findings (must-fix / should-fix / defer), apply must-fixes, and re-run `pnpm check` + `vp test`.
- [ ] **Step 3:** Use the `superpowers:finishing-a-development-branch` skill to merge `tools-file-integrity`, then remove the worktree, delete the branch, and delete `docs/active-work/tools-file-integrity.md` in one step.

---

## Self-Review

**Spec coverage:**

- Pure core (`hashAll` one-read-five-hashes) → Task 2. `compareToBaseline` → Task 3. `buildReceipt`/receipt → Task 4. ✓
- Server-side compute on every surface → the worker sink (Task 8) is the only digest backend the routes use; the standalone hash route streams the body server-side. ✓
- Three surfaces: standalone hash (Task 8), per-file verify (Task 9); matter-action seam stays deferred (`matterContext: "none"`, Task 6). ✓
- New `file` context tag + catalog row → Task 6. ✓
- `tools:fileIntegrity` permission + role seed → Tasks 5 + 10. ✓
- Chain-of-custody `audit_log` row (`file.integrity_verified`, exact metadata shape) → Task 9. ✓
- Hash receipt (.txt/.json; the API returns the structured payload, the UI renders text) → Task 4 + returned by Task 9. ✓
- Baseline from `file_version.content_sha256` → Task 7. ✓
- Large-file inline cap (default = inspectable-size cap) + 413 → Tasks 8 + 9; async-Queue path stays deferred. ✓
- Security: size cap, redaction, firm-scoped R2 key → Tasks 8/9 + review Task 12. ✓
- Testing: golden vectors, baseline cases, route happy paths + tamper→mismatch + permission gating → Tasks 2/3/4/8/9. ✓
- OpenAPI contract regen → Tasks 8/9. ✓
- Docs/changelog/decision/STATUS/ROADMAP → Task 11. ✓
- UI shell (sidebar widget + right-click action + id→component map) is explicitly deferred to the design-system Tools shell, exactly as the other tools' widgets are — not in this plan's scope (the routes are exercised via tests until the shell lands).

**Placeholder scan:** No "TBD"/"implement later". The few environment-determined values (the five `rolePermission_` ids, the test-helper names in `apps/worker/test`, the exact `firmName` field) are called out with explicit instructions to read the neighbouring real code and the contract to confirm — not left vague.

**Type consistency:** `HashResult` fields (`md5`/`sha1`/`sha256`/`sha384`/`sha512`/`sizeBytes`), `BaselineComparison` (`match`/`mismatch`/`no-baseline`), `DigestSink` (`write`/`close`), `CreateDigestSink`, and `ReceiptInput.verification` shape are used identically across Tasks 1–4, 8, 9. `hashAll(stream, createSink)`, `compareToBaseline(computedSha256, baselineSha256)`, `getCurrentVersionForIntegrity(database, fileId)` signatures match their call sites.
