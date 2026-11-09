# Slice 2·1 — Plan 1: Ingest-pipeline integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the launch ingest pipeline into a real untrusted-file pipeline — the extended scan-port contract, the hardening gates and uninspectable-file policy, interactive/bulk lane separation, and verdict observability — all behind a swappable scan port that the Plan 2 scan Container plugs into.

**Architecture:** Deltas on the working slice 1·1 file-manager seams. The pure `runIngest` (`packages/file-manager/src/ingest-core.ts`) keeps its single-read shape; this plan widens the `MalwareScanPort` return type, adds the inspectable-size short-circuit and the suspicious→quarantine / uninspectable→`unscanned`-with-detail mapping, splits ingest into two prefix-keyed queues so a bulk import never blocks an interactive upload, and records verdict counters on the telemetry pipeline. The real engine is Plan 2; this plan injects the scan port through a worker seam, defaulting to the existing `unscannedAdapter` until the Container lands.

**Tech Stack:** TypeScript (ESM, `.ts` imports), drizzle-orm (per-firm D1), zod, Cloudflare Queues + R2 event notifications, Vitest + `cloudflare:test` (Miniflare). Builds on `@magna-carta/file-manager`, `@magna-carta/data-access`, `@magna-carta/telemetry`.

## Global Constraints

- **Full names, no shorthand** (golden rule 12): `newIdentifier()` not `newId()`, "the data-access layer" never "the DAL". Storage-encoding suffixes from an accepted spec are the only exception.
- **No process references in source/tests/config** (golden rule 13, enforced by `pnpm run lint:process-refs`): no `ADR-NNNN`, "slice 2·1", "Plan 1" in code or comments. A forward-looking "the scan Container swaps in the real engine" (no slice number) is allowed. State the reasoning inline or cite a file path.
- **The quarantine gate is a status gate, not a key scheme** (`packages/file-manager/CLAUDE.md`): every `file_version` read filters `status = 'clean'`; the source-scan fitness function rejects an unguarded SELECT.
- **Ingest is one read:** `runIngest` tees a single stream; a multi-GB object never buffers. Any new branch must not add a second full read.
- **`unscanned` commits; quarantine is for failed gates and `infected`/suspicious only** — the explicit launch policy, now extended with the benign-vs-suspicious split.
- **Bulk content to R2, exact rollups in D1** (golden rule 3): no bytes through the Worker on the ingest path; the meter moves in the same atomic batch as the version it counts.
- **`pnpm check` + `pnpm run lint:process-refs` green before every commit.**

---

## File Structure

**Modified `packages/file-manager/`:**

- `src/scan-port.ts` — widen the `MalwareScanPort` result type (the central new contract); update `unscannedAdapter`.
- `src/ingest-core.ts` — the inspectable-size short-circuit, the suspicious→quarantine mapping, the uninspectable→`unscanned`+detail mapping; extend `QuarantineReason` and `IngestOutcome`.
- `src/upload-policy.ts` — new setting definitions: `inspectableSizeCap`, archive caps.
- `src/file-service.ts` — `commitVersion`/`quarantineVersion` carry `scanDetail`; `initiateUpload` accepts an `uploadKind`; `fileVersionKey` accepts a prefix.
- `src/metering-statements.ts` — reconciliation LISTs both prefixes (the bulk-lane ripple).
- `src/queries.ts` — no read changes (status gate unchanged); confirm fitness still passes.

**Modified `packages/database/`:**

- `src/per-firm-schema.ts` — `scan_detail` nullable column on `file_version`.
- generated `drizzle/per-firm/0006_*.sql` — the `scan_detail` migration (confirm the next free number at build time).

**Modified `apps/worker/`:**

- `src/background/files/ingest-consumer.ts` — inject the scan port via a worker seam; read the lane.
- `src/files/scan-port-binding.ts` (new) — resolve the active `MalwareScanPort` from the environment (defaults to `unscannedAdapter`; the Container adapter swaps in here in Plan 2).
- `src/firm-resource-provider.ts` — a second R2-event rule for the `bulk/` prefix → the bulk queue.
- `src/http/routes/files/uploads.ts` — thread `uploadKind` from the initiate request.
- `src/background/scheduled.ts` — the weekly re-scan sweep; reconciliation LISTs both prefixes.
- `src/index.ts` — bind the bulk consumer; route the new cron.
- `wrangler.jsonc` — `FILES_INGEST_BULK` producer + consumer at lower `max_concurrency`; the weekly cron trigger.

**Tests:** colocated `packages/file-manager/test/*.test.ts` and `apps/worker/test/*.test.ts` per existing convention.

---

## The central new contract (Task 1 produces; everything downstream consumes)

```typescript
// packages/file-manager/src/scan-port.ts
export type ScanResult =
  // activeContent flags PDF JavaScript / Office macros on an otherwise-clean file — committed with a
  // badge (the safe-delivery sandbox is the execution defense), never quarantined on its own
  | { verdict: "clean"; engineVersion: string; activeContent?: boolean }
  | { verdict: "infected"; engineVersion: string; signature: string | null }
  // benign-uninspectable: commits as `unscanned`, the reason surfaces as a "not scanned" badge
  | { verdict: "unscanned"; reason: "no-engine" | "encrypted"; engineVersion: string | null }
  // suspicious-uninspectable: quarantines (the inability to inspect correlates with evasion)
  | {
      verdict: "suspicious";
      reason: "decompression-bomb" | "archive-nesting" | "archive-entry-count";
      engineVersion: string;
    };

export interface MalwareScanPort {
  scan(
    body: ReadableStream<Uint8Array>,
    meta: { sizeBytes: number; sniffedContentType: string | null },
  ): Promise<ScanResult>;
}
```

`oversize` is **not** a scan reason — it is decided in `runIngest` before the engine is called (Task 3), so the engine never streams a file past the inspectable cap.

---

## Task 1: Widen the scan-port contract

**Files:**

- Modify: `packages/file-manager/src/scan-port.ts`
- Test: `packages/file-manager/test/scan-port.test.ts`

**Interfaces:**

- Produces: the `ScanResult` union above; `MalwareScanPort.scan → Promise<ScanResult>`; `unscannedAdapter` returning `{ verdict: "unscanned", reason: "no-engine", engineVersion: null }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/file-manager/test/scan-port.test.ts
import { describe, expect, it } from "vitest";
import { unscannedAdapter, type ScanResult } from "../src/scan-port.ts";

describe("unscannedAdapter", () => {
  it("drains its stream branch and reports an honest no-engine unscanned verdict", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const result: ScanResult = await unscannedAdapter.scan(body, {
      sizeBytes: 3,
      sniffedContentType: null,
    });
    expect(result).toEqual({ verdict: "unscanned", reason: "no-engine", engineVersion: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/scan-port.test.ts`
Expected: FAIL — `reason` does not exist / type error on `ScanResult`.

- [ ] **Step 3: Implement the widened contract**

Replace the body of `scan-port.ts` with the `ScanResult` union and `MalwareScanPort` from "The central new contract" above, then:

```typescript
export const unscannedAdapter: MalwareScanPort = {
  async scan(body) {
    await body.cancel();
    return { verdict: "unscanned", reason: "no-engine", engineVersion: null };
  },
};
```

- [ ] **Step 4: Run the test (PASS) and the package check**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/scan-port.test.ts` → PASS.
Run: `pnpm --filter @magna-carta/file-manager exec tsc --noEmit` → expect errors in `ingest-core.ts` (it still expects the old shape) — those are fixed in Task 3; if you are executing strictly task-by-task, Task 1's commit may leave a known downstream type error noted in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/scan-port.ts packages/file-manager/test/scan-port.test.ts
git commit -m "feat(file-manager): widen MalwareScanPort to clean/infected/unscanned/suspicious"
```

---

## Task 2: Add the `scan_detail` column

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts:510-567` (the `fileVersion` table)
- Create: `packages/database/drizzle/per-firm/000N_file-version-scan-detail.sql` (confirm N = next free at build time)
- Test: `packages/database/test/schema-fitness.test.ts` (extend the existing fitness suite)

**Interfaces:**

- Produces: `file_version.scan_detail` — nullable TEXT, the persisted reason behind an `unscanned` badge or a suspicious quarantine, or `"active-content"` on a clean file carrying PDF JavaScript / Office macros; null for a plain clean file.

- [ ] **Step 1: Add the column to the Drizzle schema**

In the `fileVersion` table definition, after `scanEngineVersion`:

```typescript
    scanVerdict: text("scan_verdict", { enum: ["unscanned", "clean", "infected"] }),
    scanEngineVersion: text("scan_engine_version"),
    // The reason behind an `unscanned` badge ("no-engine"/"encrypted"/"oversize"), an "active-content"
    // badge on an otherwise-clean file (PDF JavaScript / Office macros), or a suspicious
    // quarantine ("decompression-bomb"/"archive-nesting"/"archive-entry-count"). Null for a plain
    // clean scan. Surfaces the "not scanned" badge in read models without overloading scan_verdict.
    scanDetail: text("scan_detail"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @magna-carta/database exec drizzle-kit generate --name file-version-scan-detail`
Expected: a new `drizzle/per-firm/000N_file-version-scan-detail.sql` with `ALTER TABLE file_version ADD scan_detail text;` (expand-only, additive — safe per the expand-contract guard).

- [ ] **Step 3: Confirm the schema fitness + migration suite still passes**

Run: `pnpm --filter @magna-carta/database exec vitest run`
Expected: PASS (the new column is nullable TEXT — no float-money or handle-PK rule touched).

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/
git commit -m "feat(database): add file_version.scan_detail for the scan badge/quarantine reason"
```

---

## Task 3: Hardening gates + uninspectable policy in `runIngest`

**Files:**

- Modify: `packages/file-manager/src/ingest-core.ts`
- Test: `packages/file-manager/test/ingest-core.test.ts` (extend)

**Interfaces:**

- Consumes: `ScanResult` (Task 1); `inspectableSizeCap` passed in on `IngestInput`.
- Produces: extended `QuarantineReason` (`+ "scan-suspicious"`), `IngestOutcome.commit` carrying `scanDetail: string | null`, and `IngestOutcome` mapping per the policy below.

Mapping the gate must implement, in order, after the existing size/type/policy gates:

- `objectSize > inspectableSizeCap` → **commit** `unscanned`, `scanDetail: "oversize"` (the scan stream is cancelled, never sent to the engine).
- otherwise call `scanPort.scan`:
  - `clean` → commit `clean`, `scanDetail: scan.activeContent ? "active-content" : null` (active content commits with a badge — the safe-delivery sandbox, not quarantine, is the execution defense).
  - `unscanned` (reason `no-engine`|`encrypted`) → commit `unscanned`, `scanDetail: reason`.
  - `infected` → quarantine `scan-infected`.
  - `suspicious` (bomb/nesting/entry-count) → quarantine `scan-suspicious`, recording the sub-reason in `scanDetail`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/file-manager/test/ingest-core.test.ts  (additions)
import { describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest-core.ts";
import type { MalwareScanPort, ScanResult } from "../src/scan-port.ts";
import { DEFAULT_UPLOAD_POLICY } from "../src/upload-policy.ts";

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
const fixedScan = (result: ScanResult): MalwareScanPort => ({
  async scan() {
    return result;
  },
});

const baseInput = (bytes: Uint8Array) => ({
  objectBody: streamOf(bytes),
  objectSize: bytes.byteLength,
  version: {
    declaredSize: bytes.byteLength,
    declaredContentType: null,
    r2Key: "files/f/v",
    fileName: "x.pdf",
  },
  policy: DEFAULT_UPLOAD_POLICY,
  inspectableSizeCap: 2 * 1024 * 1024 * 1024,
});

describe("runIngest uninspectable + suspicious policy", () => {
  it("commits an oversize file as unscanned/oversize without calling the engine", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    let scanCalled = false;
    const port: MalwareScanPort = {
      async scan() {
        scanCalled = true;
        return { verdict: "clean", engineVersion: "e1" };
      },
    };
    const outcome = await runIngest({ ...baseInput(bytes), inspectableSizeCap: 3, scanPort: port });
    expect(scanCalled).toBe(false);
    expect(outcome).toMatchObject({
      kind: "commit",
      scanVerdict: "unscanned",
      scanDetail: "oversize",
    });
  });

  it("commits an encrypted file as unscanned/encrypted (benign-uninspectable)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({ verdict: "unscanned", reason: "encrypted", engineVersion: "e1" }),
    });
    expect(outcome).toMatchObject({
      kind: "commit",
      scanVerdict: "unscanned",
      scanDetail: "encrypted",
    });
  });

  it("quarantines a suspicious archive as scan-suspicious with the sub-reason", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({
        verdict: "suspicious",
        reason: "decompression-bomb",
        engineVersion: "e1",
      }),
    });
    expect(outcome).toEqual({
      kind: "quarantine",
      reason: "scan-suspicious",
      scanDetail: "decompression-bomb",
    });
  });

  it("commits a clean file with null detail", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const outcome = await runIngest({
      ...baseInput(bytes),
      scanPort: fixedScan({ verdict: "clean", engineVersion: "e1" }),
    });
    expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "clean", scanDetail: null });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/ingest-core.test.ts`
Expected: FAIL — `inspectableSizeCap` not on the input type; `scanDetail` not on the outcome; `quarantine` has no `scanDetail`.

- [ ] **Step 3: Extend the types and the pipeline**

In `ingest-core.ts`: add `readonly inspectableSizeCap: number;` to `IngestInput`; extend the union:

```typescript
export type QuarantineReason =
  | "type-mismatch"
  | "size-mismatch"
  | "policy-size"
  | "policy-type"
  | "scan-infected"
  | "scan-suspicious";

export type IngestOutcome =
  | {
      kind: "commit";
      sizeBytes: number;
      sniffedContentType: string | null;
      contentSha256: string;
      scanVerdict: "unscanned" | "clean";
      scanEngineVersion: string | null;
      scanDetail: string | null;
    }
  | { kind: "quarantine"; reason: QuarantineReason; scanDetail: string | null };
```

Replace the tee/scan section so the inspectable cap short-circuits the scan, and map the widened result:

```typescript
const [headStream, bodyStream] = input.objectBody.tee();
const sniffedContentType = await sniffHead(headStream);

// Files past the scanner's inspectable cap are benign-uninspectable: commit as `unscanned`/oversize
// and never stream them to the engine (a large legitimate file is not suspicious for being big).
if (input.objectSize > input.inspectableSizeCap) {
  const [hashStream, skipStream] = bodyStream.tee();
  await skipStream.cancel();
  const hashed = await hashAndCount(hashStream);
  if (hashed.size !== input.objectSize)
    return { kind: "quarantine", reason: "size-mismatch", scanDetail: null };
  return {
    kind: "commit",
    sizeBytes: input.objectSize,
    sniffedContentType,
    contentSha256: hashed.hash,
    scanVerdict: "unscanned",
    scanEngineVersion: null,
    scanDetail: "oversize",
  };
}

const [hashStream, scanStream] = bodyStream.tee();
const [scan, hashed] = await Promise.all([
  input.scanPort.scan(scanStream, { sizeBytes: input.objectSize, sniffedContentType }),
  hashAndCount(hashStream),
]);
```

Then keep the existing size/type/policy gates, but every `return { kind: "quarantine", reason: ... }` gains `scanDetail: null`, and replace the final scan handling:

```typescript
if (scan.verdict === "infected")
  return { kind: "quarantine", reason: "scan-infected", scanDetail: scan.signature };
if (scan.verdict === "suspicious")
  return { kind: "quarantine", reason: "scan-suspicious", scanDetail: scan.reason };
return {
  kind: "commit",
  sizeBytes: input.objectSize,
  sniffedContentType,
  contentSha256: hashed.hash,
  scanVerdict: scan.verdict === "clean" ? "clean" : "unscanned",
  scanEngineVersion: scan.engineVersion,
  scanDetail:
    scan.verdict === "clean" ? (scan.activeContent ? "active-content" : null) : scan.reason,
};
```

- [ ] **Step 4: Run the tests (PASS)**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/ingest-core.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/ingest-core.ts packages/file-manager/test/ingest-core.test.ts
git commit -m "feat(file-manager): inspectable-size cap + suspicious/uninspectable ingest policy"
```

---

## Task 4: Inspectable-size + archive cap settings

**Files:**

- Modify: `packages/file-manager/src/upload-policy.ts`
- Test: `packages/file-manager/test/upload-policy.test.ts` (extend)

**Interfaces:**

- Produces: `inspectableSizeCapDefinition` (default 2 GiB) read by the consumer (Task 6); `archiveCapsDefinition` (`{ maxDepth, maxEntries, maxUncompressedBytes, maxExpansionRatio }`) read by the scan Container in Plan 2 (defined here so the firm-tunable knobs live with the other policy settings).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/file-manager/test/upload-policy.test.ts (additions)
import { describe, expect, it } from "vitest";
import { inspectableSizeCapDefinition, archiveCapsDefinition } from "../src/upload-policy.ts";

describe("scan caps", () => {
  it("defaults the inspectable-size cap to 2 GiB", () => {
    expect(inspectableSizeCapDefinition.defaultValue).toBe(2 * 1024 * 1024 * 1024);
  });
  it("defaults the archive caps to safe limits", () => {
    expect(archiveCapsDefinition.defaultValue).toEqual({
      maxDepth: 16,
      maxEntries: 10000,
      maxUncompressedBytes: 4 * 1024 * 1024 * 1024,
      maxExpansionRatio: 100,
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run test/upload-policy.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Add the definitions**

```typescript
export const inspectableSizeCapDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.inspectableSizeCapBytes",
  schema: z.number().int().positive(),
  defaultValue: 2 * GIBIBYTE,
};

export interface ArchiveCaps {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxExpansionRatio: number;
}
export const archiveCapsDefinition: FirmSettingDefinition<ArchiveCaps> = {
  key: "fileManager.archiveCaps",
  schema: z.object({
    maxDepth: z.number().int().positive(),
    maxEntries: z.number().int().positive(),
    maxUncompressedBytes: z.number().int().positive(),
    maxExpansionRatio: z.number().int().positive(),
  }),
  defaultValue: {
    maxDepth: 16,
    maxEntries: 10000,
    maxUncompressedBytes: 4 * GIBIBYTE,
    maxExpansionRatio: 100,
  },
};
export function readInspectableSizeCap(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, inspectableSizeCapDefinition);
}
```

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add packages/file-manager/src/upload-policy.ts packages/file-manager/test/upload-policy.test.ts
git commit -m "feat(file-manager): inspectable-size + archive cap settings"
```

---

## Task 5: Carry `scanDetail` through commit/quarantine

**Files:**

- Modify: `packages/file-manager/src/file-service.ts` (`commitVersion`, `quarantineVersion`, their statement builders)
- Test: `packages/file-manager/test/file-service.test.ts` (extend)

**Interfaces:**

- Consumes: `IngestOutcome.scanDetail` (Task 3).
- Produces: `commitVersion` input gains `scanDetail: string | null` and persists it; `quarantineVersion` input gains `scanDetail: string | null`.

- [ ] **Step 1: Write the failing test** — assert a committed version row and a quarantined row both persist `scan_detail`.

```typescript
// packages/file-manager/test/file-service.test.ts (additions)
it("persists scan_detail on commit", async () => {
  // ...arrange a pending version via the existing test harness...
  await commitVersion(
    database,
    {
      versionId,
      sizeBytes: 4,
      sniffedContentType: "application/pdf",
      contentSha256: "ab",
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: "encrypted",
      now: new Date().toISOString(),
    },
    { clock, actorUserId: null },
  );
  const row = await database
    .prepare("SELECT scan_detail FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ scan_detail: string | null }>();
  expect(row?.scan_detail).toBe("encrypted");
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL (`scanDetail` not accepted / column not written).

- [ ] **Step 3: Implement** — add `scanDetail: string | null` to `CommitVersionInput` and the `quarantineVersion` input; include `scan_detail` in `commitVersionStatement` and the quarantine update. (Quarantine currently sets status + reason; add `scan_detail = ?`.)

- [ ] **Step 4: Run (PASS)** — `pnpm --filter @magna-carta/file-manager exec vitest run test/file-service.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src/file-service.ts packages/file-manager/test/file-service.test.ts
git commit -m "feat(file-manager): persist scan_detail on commit and quarantine"
```

---

## Task 6: Scan-port injection seam in the consumer

**Files:**

- Create: `apps/worker/src/files/scan-port-binding.ts`
- Modify: `apps/worker/src/files/ingest-consumer.ts`
- Test: `apps/worker/test/ingest-consumer.test.ts` (extend)

**Interfaces:**

- Consumes: `readInspectableSizeCap` (Task 4); `runIngest` (Task 3).
- Produces: `resolveScanPort(env): MalwareScanPort` — returns `unscannedAdapter` today; the Plan 2 Container adapter is selected here when its binding is present. The consumer calls `resolveScanPort(env)` and `readInspectableSizeCap(firmDatabase)` and passes both into `runIngest`.

- [ ] **Step 1: Write the failing test** — a fake env whose `resolveScanPort` returns a `clean`-verdict port drives `handleIngestMessage` to a committed `clean` version; swapping the fake to `infected` drives a quarantine. Assert the consumer reads the inspectable cap and passes it through (an oversize object commits `unscanned`/`oversize`).

- [ ] **Step 2: Run and confirm failure** — FAIL (`scan-port-binding.ts` / `inspectableSizeCap` wiring absent).

- [ ] **Step 3: Implement the seam**

```typescript
// apps/worker/src/files/scan-port-binding.ts
import { unscannedAdapter, type MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../app.ts";

// Resolve the active scan engine. Until the scan Container lands, every firm runs the engine-less
// adapter (honest `unscanned`/no-engine). The Container adapter is selected here when its binding is
// present, so the swap is one file and no consumer change.
export function resolveScanPort(_env: Bindings): MalwareScanPort {
  return unscannedAdapter;
}
```

In `ingest-consumer.ts`, replace the hardcoded `scanPort: unscannedAdapter` with `scanPort: resolveScanPort(env)` and add `inspectableSizeCap: await readInspectableSizeCap(firmDatabase)` to the `runIngest` call; thread `outcome.scanDetail` into both the `commitVersion` and `quarantineVersion` calls.

- [ ] **Step 4: Run (PASS)** — `pnpm --filter @magna-carta/worker exec vitest run test/ingest-consumer.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/files/scan-port-binding.ts apps/worker/src/files/ingest-consumer.ts apps/worker/test/ingest-consumer.test.ts
git commit -m "feat(worker): inject the scan port + inspectable cap into the ingest consumer"
```

---

## Task 7: Interactive/bulk lane separation

> **Design refinement:** the approved design says "lanes by R2 prefix." A naive read would change the `storage_meter` prefix dimension and the reconciliation LIST. To keep metering unchanged, bulk objects live under a `bulk/` key prefix **but still meter under the existing `files/` dimension** (the meter dimension is a logical bucket, not the literal key); only reconciliation gains the second LIST prefix. The lane benefit (interactive jumps bulk) comes entirely from queue topology + `max_concurrency`.

**Files:**

- Modify: `packages/file-manager/src/file-service.ts` (`fileVersionKey` accepts a prefix; `initiateUpload` accepts `uploadKind`)
- Modify: `packages/file-manager/src/metering-statements.ts` (`reconciliationDiff` LISTs both prefixes) — and `apps/worker/src/scheduled.ts` (pass both prefixes)
- Modify: `apps/worker/src/firm-resource-provider.ts` (second notification rule for `bulk/`)
- Modify: `apps/worker/src/routes/files/uploads.ts` (thread `uploadKind` from the request body)
- Modify: `apps/worker/src/index.ts` + `apps/worker/wrangler.jsonc` (the `FILES_INGEST_BULK` queue + consumer at lower `max_concurrency`)
- Test: `packages/file-manager/test/file-service.test.ts`, `apps/worker/test/uploads.test.ts`, `apps/worker/test/provisioning.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `fileVersionKey(fileId, versionId, prefix = FILES_PREFIX)`; `BULK_PREFIX = "bulk/"`; `initiateUpload` input `uploadKind?: "interactive" | "bulk"` (default `"interactive"`) selecting the prefix; the same `ingestQueue` handler bound to both `FILES_INGEST` and `FILES_INGEST_BULK`.

- [ ] **Step 1: Write the failing tests**
  - `file-service`: `initiateUpload({ uploadKind: "bulk" })` mints an r2 key under `bulk/`; default mints under `files/`.
  - `uploads` route: a request with `uploadKind: "bulk"` returns a presigned target under `bulk/`.
  - `provisioning`: the REST provider PUTs **two** notification rules (one `files/`→`FILES_INGEST`, one `bulk/`→`FILES_INGEST_BULK`).

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement**
  - `fileVersionKey(fileId, versionId, prefix = FILES_PREFIX)` → `` `${prefix}${fileId}/${versionId}` `` ; export `BULK_PREFIX = "bulk/"`.
  - `initiateUpload`: pick `const prefix = input.uploadKind === "bulk" ? BULK_PREFIX : FILES_PREFIX;` and pass it to `fileVersionKey`. `commitVersion` keeps `prefix: FILES_PREFIX` for the meter (the logical dimension is unchanged).
  - `reconciliationDiff` / the scheduled reconciliation: LIST both `FILES_PREFIX` and `BULK_PREFIX`, concatenate, then diff against the meter (still keyed on the `files/` dimension).
  - `firm-resource-provider`: add a second `RESTFirmResourceProviderOptions.bulkEventNotificationQueueId`; in `configureBucketNotifications`, PUT a second configuration to `${accountBase}/event_notifications/r2/${bucketName}/configuration/queues/${bulkQueueId}` with `rules: [{ prefix: "bulk/", actions: ["PutObject", "CompleteMultipartUpload"] }]` (mirror the existing `files/` rule's action list). The dev adapter stays a no-op.
  - `uploads` route: add `uploadKind` to the initiate request schema (optional enum), thread it into `initiateUpload`.
  - `wrangler.jsonc`: add `{ "binding": "FILES_INGEST_BULK", "queue": "magna-carta-production-files-ingest-bulk" }` to producers, and a consumer entry for that queue with a lower `"max_concurrency"` (e.g. 2) and its own dead-letter queue. Add `FILES_INGEST_QUEUE_ID`-style `bulk` deploy fact wiring per the existing pattern.
  - `index.ts`: route both queue names to `ingestQueue` (the same handler; the lane is purely the queue's concurrency).

- [ ] **Step 4: Run the affected suites (PASS)**

Run: `pnpm --filter @magna-carta/file-manager exec vitest run` and `pnpm --filter @magna-carta/worker exec vitest run test/uploads.test.ts test/provisioning.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/file-manager/src apps/worker/src apps/worker/wrangler.jsonc packages/file-manager/test apps/worker/test
git commit -m "feat: split ingest into interactive and bulk lanes by key prefix"
```

---

## Task 8: Verdict observability

**Files:**

- Modify: `apps/worker/src/files/ingest-consumer.ts` (emit a verdict counter per terminal outcome)
- Test: `apps/worker/test/ingest-consumer.test.ts` (extend)

**Interfaces:**

- Consumes: the telemetry logger already constructed in `ingestQueue` (`createWorkersLogger(env.TELEMETRY)`); an allowlist event builder for scan verdicts.
- Produces: one structured event per ingest outcome carrying `{ outcome: "commit" | "quarantine", scanVerdict, scanDetail, quarantineReason }` — redaction-structural (no file content, no name), correlate by the existing ingest correlation id.

- [ ] **Step 1: Write the failing test** — a fake `TELEMETRY` sink captures one verdict event per processed message with the verdict fields and no file-identifying content.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** — add a `scanVerdict` allowlist event builder in `@magna-carta/telemetry` (mirror the existing builders; the allowlist is the redaction — an undeclared field has no slot), and emit it from `handleIngestMessage` after the idempotent effect resolves.

- [ ] **Step 4: Run (PASS) + the worker suite + check.**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/files/ingest-consumer.ts packages/telemetry/src apps/worker/test/ingest-consumer.test.ts
git commit -m "feat(worker): emit scan-verdict telemetry counters from the ingest consumer"
```

---

## Task 9: Weekly re-scan sweep

**Files:**

- Modify: `apps/worker/src/scheduled.ts` (the weekly handler), `apps/worker/src/index.ts` (route the new cron), `apps/worker/wrangler.jsonc` (add the weekly trigger)
- Test: `apps/worker/test/scheduled.test.ts` (extend)

**Interfaces:**

- Consumes: the `FILES_INGEST` producer; a status-gated query for committed `unscanned`-verdict versions.
- Produces: `runRescanSweep(env)` — for each firm, bounded fan-out re-enqueues an R2 event for committed versions whose `scan_verdict = 'unscanned'` so a now-available engine re-evaluates them. Re-ingest is idempotent only for `pending` versions, so the sweep re-opens a fresh pending re-scan version rather than mutating the committed one — **OR** (simpler v1) it enqueues onto a dedicated re-scan path that updates `scan_verdict` in place under a per-version idempotency key. Pick the in-place update: a re-scan does not cut a new logical version.

- [ ] **Step 1: Write the failing test** — seed two committed versions (`unscanned` + `clean`); `runRescanSweep` enqueues exactly one re-scan message (the `unscanned` one), bounded by a per-run cap.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `runRescanSweep` with a bounded per-firm cap (mirror `sweepStalePendingUploads`); add a `listUnscannedCommittedVersions` query (status = 'clean' AND scan_verdict = 'unscanned' — a legitimate status-gated read, no `fitness:allow-no-status` needed); route a weekly cron (`0 4 * * 0`) in `index.ts`; add it to `wrangler.jsonc` `triggers.crons`.

- [ ] **Step 4: Run (PASS) + the worker suite + check.**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scheduled.ts apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/test/scheduled.test.ts packages/file-manager/src/queries.ts
git commit -m "feat(worker): weekly re-scan sweep for unscanned committed versions"
```

---

## Task 10: Full-suite gate + area docs

**Files:**

- Modify: `packages/file-manager/CLAUDE.md` (the widened port + the lanes + scan_detail), `STATUS.md` / `ROADMAP.md` rows for 2·1 Plan 1 (definition-of-done, golden rule 5)
- Test: the whole repo gate

- [ ] **Step 1: Run the full quality gate**

Run: `pnpm check` and `pnpm run lint:process-refs` and `pnpm --filter @magna-carta/worker exec vitest run` and `pnpm --filter @magna-carta/file-manager exec vitest run`.
Expected: all green.

- [ ] **Step 2: Update the area `CLAUDE.md`** — the scan port now returns `clean/infected/unscanned/suspicious`; ingest has the inspectable-size short-circuit; two lanes exist; `scan_detail` records the badge/quarantine reason. Keep it to the local facts (no cross-cutting rules).

- [ ] **Step 3: Update `STATUS.md` + `ROADMAP.md`** — 2·1 moves to in-progress with Plan 1's deltas listed; note the scan engine (Plan 2) and async bulk download (Plan 3) still pending.

- [ ] **Step 4: Commit**

```bash
git add packages/file-manager/CLAUDE.md STATUS.md ROADMAP.md
git commit -m "docs: record the 2·1 ingest-pipeline integration"
```

---

## Self-Review

**Spec coverage** (against the 2·1 design, Parts A-execution / B / cross-cutting):

- Scan engine _port_ widened + injection seam (Tasks 1, 6) — the engine itself is Plan 2. ✓
- Split lanes + bounded concurrency, DO gate deferred (Task 7). ✓
- Uninspectable split policy: benign→`unscanned`+badge, suspicious→quarantine (Tasks 1, 3, 5). ✓
- Caps as firm-tunable settings (Task 4); over-size = benign refinement (Task 3). ✓
- Verdict observability (Task 8); re-scan sweep (Task 9). ✓
- _Deferred to other plans:_ the Container engine (Plan 2), the async bundle build + threshold routing (Plan 3), the staff-alert-on-quarantine (the Notifications subsystem, named seam — not built here).

**Placeholder scan:** the archive caps (Task 4) are _defined_ here but _enforced_ in the Plan 2 Container — flagged explicitly, not a placeholder. No "TODO"/"handle edge cases"/"similar to Task N".

**Type consistency:** `ScanResult` (Task 1) → `runIngest` (Task 3) → `IngestOutcome.scanDetail` → `commitVersion`/`quarantineVersion` (Task 5) → consumer (Task 6) — `scanDetail: string | null` threads end to end. `fileVersionKey(…, prefix)` and `BULK_PREFIX` (Task 7) are consistent across file-service, metering, and provisioning.
