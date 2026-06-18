# Firm usage diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the headless, no-credential half of a per-firm usage snapshot — pure reads over our own per-firm D1 (storage from `storage_meter`; entity counts for matters/files/versions/folders/locations) — plus the Tools catalog wiring, leaving the aggregate worker route, the Cloudflare-analytics compute seam, and the UI for later.

**Architecture:** Each domain package gains a pure read of _its own_ tables (golden rule 3 — no cross-domain query): `@magna-carta/file-manager` reads storage + file/version/folder counts, `@magna-carta/matters` reads matter counts by status, `@magna-carta/locations` reads the location count. Reads take an injected `SqlDatabase` and return plain data; a pure `summarizeStorageMeterRows` does the in-memory aggregation. A `tools:firmUsage` permission + a `firm-usage` Diagnostics manifest wire it into the Tools catalog. No aggregate snapshot type or worker route is built — they land with the consumer.

**Tech Stack:** TypeScript (strict, ESM, `.ts` imports), Vitest + node:sqlite (`createMigratedNodeDatabase`), pnpm workspace, Vite+ (`vp`).

## Global Constraints

- **Reads through the firm-scoped data-access layer, own tables only:** each read takes an injected `SqlDatabase` (`@magna-carta/data-access/idempotency-statements`); no `env`, no Hono, no D1 binding held in a package; a package queries only the tables it owns (golden rule 3 / ADR-0003).
- **Full names, no shorthand** (golden rule 12). **No process references** in source/tests (no `ADR-NNNN`/"spec"/"slice N"; golden rule 13) — `CLAUDE.md`/docs may cite them.
- **Permission keys** are `<namespace>:<action>` lowercase-led camelCase (registry regex `^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$`).
- **Catalog `permission` values** are built via `assertPermission(...)`.
- **Per-package tests:** `pnpm --filter <pkg> test`. Test DB: `createMigratedNodeDatabase("per-firm").database` (a fully migrated per-firm SQLite with every table).
- **Commit hygiene:** a parallel workstream commits to this branch. Stage ONLY the files each task names; never `git add -A`/`-a`.

---

### Task 1: Register the `tools:firmUsage` permission

**Files:**

- Modify: `packages/access-control/src/registry.ts` (add one key after `tools:speedTest`, before `] as const;`)
- Test: `packages/access-control/test/registry.test.ts` (extend the `tools` namespace expectation)

**Interfaces:**

- Produces: registry key `tools:firmUsage` — consumed by Task 4's manifest via `assertPermission`.

- [ ] **Step 1: Extend the failing test**

In `packages/access-control/test/registry.test.ts`, update the `tools` namespace assertion to add the new key as the last entry:

```ts
      "tools:attorneyLicense",
      "tools:shipping",
      "tools:speedTest",
      "tools:firmUsage",
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: FAIL — `permissionsForNamespace('tools')` returns 6 keys, the test expects 7.

- [ ] **Step 3: Add the registry key**

In `packages/access-control/src/registry.ts`, insert immediately before the line `] as const;` (after the `tools:speedTest` entry):

```ts
  "tools:firmUsage", // firm usage snapshot — storage + entity counts (read-only, per-firm)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/access-control test`
Expected: PASS — the `tools` namespace test plus the unchanged camelCase-shape and no-duplicate-keys tests.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git commit -m "feat(access-control): register the tools:firmUsage permission"
```

---

### Task 2: file-manager usage reads (storage + counts)

**Files:**

- Create: `packages/file-manager/src/usage.ts`
- Modify: `packages/file-manager/package.json` (add `"./usage": "./src/usage.ts"` to `exports`)
- Test: `packages/file-manager/test/usage.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase` from `@magna-carta/data-access/idempotency-statements`; table constants `STORAGE_METER_TABLE` (`./metering-statements.ts`), `FILE_TABLE` + `FILE_VERSION_TABLE` (`./file-statements.ts`), `FOLDER_TABLE` (`./folder-statements.ts`).
- Produces:
  - `interface StorageClassTotals { readonly bytes: number; readonly objects: number }`
  - `interface StorageUsage { readonly totalBytes: number; readonly totalObjects: number; readonly byStorageClass: Record<"standard" | "infrequent_access", StorageClassTotals> }`
  - `interface StorageMeterRow { readonly storageClass: string; readonly bytes: number; readonly objectCount: number }`
  - `summarizeStorageMeterRows(rows: readonly StorageMeterRow[]): StorageUsage`
  - `readStorageUsage(database: SqlDatabase): Promise<StorageUsage>`
  - `readFileCount(database: SqlDatabase): Promise<number>` (non-deleted), `readCleanVersionCount(database: SqlDatabase): Promise<number>` (`status = 'clean'`), `readFolderCount(database: SqlDatabase): Promise<number>`

- [ ] **Step 1: Write the failing test**

`packages/file-manager/test/usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { meterCommitStatements } from "../src/metering-statements.ts";
import {
  readCleanVersionCount,
  readFileCount,
  readFolderCount,
  readStorageUsage,
  summarizeStorageMeterRows,
} from "../src/usage.ts";
import { freshDatabase, seedMatter } from "./support.ts";

const STANDARD = { storageClass: "standard", artifactRole: "original", prefix: "files" };
const IA = { storageClass: "infrequent_access", artifactRole: "original", prefix: "files" };

describe("summarizeStorageMeterRows", () => {
  it("returns zeros for no rows", () => {
    expect(summarizeStorageMeterRows([])).toEqual({
      totalBytes: 0,
      totalObjects: 0,
      byStorageClass: {
        standard: { bytes: 0, objects: 0 },
        infrequent_access: { bytes: 0, objects: 0 },
      },
    });
  });

  it("sums per class and overall", () => {
    const usage = summarizeStorageMeterRows([
      { storageClass: "standard", bytes: 1000, objectCount: 2 },
      { storageClass: "infrequent_access", bytes: 500, objectCount: 1 },
    ]);
    expect(usage.totalBytes).toBe(1500);
    expect(usage.totalObjects).toBe(3);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 1000, objects: 2 });
    expect(usage.byStorageClass.infrequent_access).toEqual({ bytes: 500, objects: 1 });
  });

  it("surfaces an unexpected class in the totals (never silently dropped)", () => {
    const usage = summarizeStorageMeterRows([
      { storageClass: "glacier", bytes: 9, objectCount: 1 },
    ]);
    expect(usage.totalBytes).toBe(9);
    expect(usage.totalObjects).toBe(1);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 0, objects: 0 });
  });
});

describe("readStorageUsage", () => {
  it("reads zero on an empty firm", async () => {
    const database = freshDatabase();
    expect(await readStorageUsage(database)).toEqual({
      totalBytes: 0,
      totalObjects: 0,
      byStorageClass: {
        standard: { bytes: 0, objects: 0 },
        infrequent_access: { bytes: 0, objects: 0 },
      },
    });
  });

  it("sums the storage_meter rollup by class", async () => {
    const database = freshDatabase();
    await database.batch(meterCommitStatements(database, STANDARD, 1000));
    await database.batch(meterCommitStatements(database, STANDARD, 200));
    await database.batch(meterCommitStatements(database, IA, 500));
    const usage = await readStorageUsage(database);
    expect(usage.totalBytes).toBe(1700);
    expect(usage.totalObjects).toBe(3);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 1200, objects: 2 });
    expect(usage.byStorageClass.infrequent_access).toEqual({ bytes: 500, objects: 1 });
  });
});

describe("entity counts", () => {
  it("counts non-deleted files, clean versions, and folders", async () => {
    const database = freshDatabase();
    await seedMatter(database); // member 'user_a' + matter 'matter_a'
    const t = "2026-01-01T00:00:00.000Z";
    await database
      .prepare(
        "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES ('folder_a','matter_a',NULL,'F',?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES ('file_a','matter_a',NULL,'a.txt',NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES ('file_b','matter_a',NULL,'b.txt',NULL,NULL,?1,?1,?1)",
      )
      .bind(t)
      .run(); // soft-deleted
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES ('ver_a','file_a',1,'k1',100,NULL,NULL,NULL,'clean',NULL,'clean','user_a',?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES ('ver_b','file_a',2,'k2',100,NULL,NULL,NULL,NULL,NULL,'pending','user_a',?1,NULL)",
      )
      .bind(t)
      .run();

    expect(await readFileCount(database)).toBe(1); // file_b is soft-deleted
    expect(await readCleanVersionCount(database)).toBe(1); // ver_b is pending
    expect(await readFolderCount(database)).toBe(1);
  });

  it("counts zero on an empty firm", async () => {
    const database = freshDatabase();
    expect(await readFileCount(database)).toBe(0);
    expect(await readCleanVersionCount(database)).toBe(0);
    expect(await readFolderCount(database)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/file-manager test`
Expected: FAIL — cannot resolve `../src/usage.ts`.

- [ ] **Step 3: Write `src/usage.ts`**

`packages/file-manager/src/usage.ts`:

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { FILE_TABLE, FILE_VERSION_TABLE } from "./file-statements.ts";
import { FOLDER_TABLE } from "./folder-statements.ts";
import { STORAGE_METER_TABLE } from "./metering-statements.ts";

export interface StorageClassTotals {
  readonly bytes: number;
  readonly objects: number;
}

// The two storage classes the meter and schema CHECK allow. byStorageClass is keyed to exactly these;
// any other class still counts in the totals (surfaced, never silently dropped from the snapshot).
export interface StorageUsage {
  readonly totalBytes: number;
  readonly totalObjects: number;
  readonly byStorageClass: Record<"standard" | "infrequent_access", StorageClassTotals>;
}

export interface StorageMeterRow {
  readonly storageClass: string;
  readonly bytes: number;
  readonly objectCount: number;
}

export function summarizeStorageMeterRows(rows: readonly StorageMeterRow[]): StorageUsage {
  const byStorageClass = {
    standard: { bytes: 0, objects: 0 },
    infrequent_access: { bytes: 0, objects: 0 },
  };
  let totalBytes = 0;
  let totalObjects = 0;
  for (const row of rows) {
    totalBytes += row.bytes;
    totalObjects += row.objectCount;
    if (row.storageClass === "standard" || row.storageClass === "infrequent_access") {
      byStorageClass[row.storageClass].bytes += row.bytes;
      byStorageClass[row.storageClass].objects += row.objectCount;
    }
  }
  return { totalBytes, totalObjects, byStorageClass };
}

// Sum the authoritative per-firm rollup over (artifact_role, prefix), grouped by storage class.
export async function readStorageUsage(database: SqlDatabase): Promise<StorageUsage> {
  const { results } = await database
    .prepare(
      `SELECT storage_class, SUM(bytes) AS bytes, SUM(object_count) AS objects FROM ${STORAGE_METER_TABLE} GROUP BY storage_class`,
    )
    .all<{ storage_class: string; bytes: number; objects: number }>();
  return summarizeStorageMeterRows(
    results.map((row) => ({
      storageClass: row.storage_class,
      bytes: row.bytes,
      objectCount: row.objects,
    })),
  );
}

async function count(database: SqlDatabase, sql: string): Promise<number> {
  const { results } = await database.prepare(sql).all<{ c: number }>();
  return results[0]?.c ?? 0;
}

export function readFileCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FILE_TABLE} WHERE deleted_at IS NULL`);
}

export function readCleanVersionCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FILE_VERSION_TABLE} WHERE status = 'clean'`);
}

export function readFolderCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FOLDER_TABLE}`);
}
```

- [ ] **Step 4: Add the package export**

In `packages/file-manager/package.json`, add to the `exports` object (after `"./metering-statements"`):

```json
    "./usage": "./src/usage.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/file-manager test`
Expected: PASS — all `usage.test.ts` cases plus the existing file-manager suite.

- [ ] **Step 6: Commit**

```bash
git add packages/file-manager/src/usage.ts packages/file-manager/package.json packages/file-manager/test/usage.test.ts
git commit -m "feat(file-manager): firm storage usage + entity-count reads"
```

---

### Task 3: matters + locations count reads

**Files:**

- Modify: `packages/matters/src/queries.ts` (add `MatterCounts` + `readMatterCounts`)
- Test: `packages/matters/test/matter-counts.test.ts`
- Modify: `packages/locations/src/statements.ts` (add `readLocationCount`)
- Test: `packages/locations/test/location-count.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase` (`@magna-carta/data-access/idempotency-statements`); `MATTER_TABLE` (`../src/matter-statements.ts`), `LOCATION_TABLE` (`../src/statements.ts`).
- Produces:
  - `interface MatterCounts { readonly total: number; readonly prospective: number; readonly open: number; readonly closed: number }`
  - `readMatterCounts(database: SqlDatabase): Promise<MatterCounts>` (exported from `@magna-carta/matters/queries`)
  - `readLocationCount(database: SqlDatabase): Promise<number>` (exported from `@magna-carta/locations/statements`)

- [ ] **Step 1: Write the failing matters test**

`packages/matters/test/matter-counts.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import { readMatterCounts } from "../src/queries.ts";

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

async function insertMatter(
  database: ReturnType<typeof freshDatabase>,
  id: string,
  status: string,
) {
  const t = "2026-01-01T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1,'T',NULL,?2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?3,?3)",
    )
    .bind(id, status, t)
    .run();
}

describe("readMatterCounts", () => {
  it("is all zeros on an empty firm", async () => {
    expect(await readMatterCounts(freshDatabase())).toEqual({
      total: 0,
      prospective: 0,
      open: 0,
      closed: 0,
    });
  });

  it("counts by status and totals them", async () => {
    const database = freshDatabase();
    await insertMatter(database, "m1", "prospective");
    await insertMatter(database, "m2", "open");
    await insertMatter(database, "m3", "open");
    await insertMatter(database, "m4", "closed");
    expect(await readMatterCounts(database)).toEqual({
      total: 4,
      prospective: 1,
      open: 2,
      closed: 1,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @magna-carta/matters test`
Expected: FAIL — `readMatterCounts` is not exported from `../src/queries.ts`.

- [ ] **Step 3: Add `readMatterCounts` to matters**

In `packages/matters/src/queries.ts`, add (ensure `SqlDatabase` is imported from `@magna-carta/data-access/idempotency-statements` and `MATTER_TABLE` from `./matter-statements.ts` — add the imports if absent):

```ts
export interface MatterCounts {
  readonly total: number;
  readonly prospective: number;
  readonly open: number;
  readonly closed: number;
}

// Per-firm matter counts, grouped by lifecycle status. An unexpected status still adds to total.
export async function readMatterCounts(database: SqlDatabase): Promise<MatterCounts> {
  const { results } = await database
    .prepare(`SELECT status, COUNT(*) AS c FROM ${MATTER_TABLE} GROUP BY status`)
    .all<{ status: string; c: number }>();
  const counts = { total: 0, prospective: 0, open: 0, closed: 0 };
  for (const row of results) {
    counts.total += row.c;
    if (row.status === "prospective" || row.status === "open" || row.status === "closed") {
      counts[row.status] += row.c;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run it to verify matters passes**

Run: `pnpm --filter @magna-carta/matters test`
Expected: PASS — the matter-counts cases plus the existing matters suite.

- [ ] **Step 5: Write the failing locations test**

`packages/locations/test/location-count.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import { readLocationCount } from "../src/statements.ts";

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("readLocationCount", () => {
  it("is zero on an empty firm", async () => {
    expect(await readLocationCount(freshDatabase())).toBe(0);
  });

  it("counts every location regardless of status", async () => {
    const database = freshDatabase();
    const t = "2026-01-01T00:00:00.000Z";
    await database
      .prepare(
        "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_a','A','active',NULL,NULL,NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_b','B','closed',NULL,NULL,NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    expect(await readLocationCount(database)).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @magna-carta/locations test`
Expected: FAIL — `readLocationCount` is not exported from `../src/statements.ts`.

- [ ] **Step 7: Add `readLocationCount` to locations**

In `packages/locations/src/statements.ts`, add (it already imports `SqlDatabase` and defines `LOCATION_TABLE`):

```ts
// Per-firm count of all locations (active and closed alike).
export async function readLocationCount(database: SqlDatabase): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS c FROM ${LOCATION_TABLE}`)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
}
```

- [ ] **Step 8: Run it to verify locations passes**

Run: `pnpm --filter @magna-carta/locations test`
Expected: PASS — the location-count cases plus the existing locations suite.

- [ ] **Step 9: Commit**

```bash
git add packages/matters/src/queries.ts packages/matters/test/matter-counts.test.ts packages/locations/src/statements.ts packages/locations/test/location-count.test.ts
git commit -m "feat(matters,locations): per-firm matter-count and location-count reads"
```

---

### Task 4: Tools catalog manifest for firm usage

**Files:**

- Modify: `packages/tools/src/catalog.ts` (add the `firm-usage` manifest after `network-speed-test`)
- Test: `packages/tools/test/catalog.test.ts` (extend the expected-ids list)

**Interfaces:**

- Consumes: `assertPermission` (`@magna-carta/access-control/registry`) — the `tools:firmUsage` key from Task 1.

- [ ] **Step 1: Extend the failing test**

In `packages/tools/test/catalog.test.ts`, update the "includes the tools that exist today" expectation to add the new id as the last entry:

```ts
      "shipping",
      "network-speed-test",
      "firm-usage",
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/tools test`
Expected: FAIL — `CATALOG` has 6 entries, the test expects 7.

- [ ] **Step 3: Add the manifest**

In `packages/tools/src/catalog.ts`, append this entry to the `CATALOG` array (after the `network-speed-test` object, before the closing `];`):

```ts
  {
    id: "firm-usage",
    name: "Firm Usage",
    icon: "chart-pie",
    subjectGroup: "diagnostics",
    permission: assertPermission("tools:firmUsage"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS — the catalog id list, well-formedness, purity, and selector tests all green (the manifest loads because `tools:firmUsage` is registered).

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/catalog.ts packages/tools/test/catalog.test.ts
git commit -m "feat(tools): add the firm-usage diagnostics catalog manifest"
```

---

### Task 5: Record the decision and update living docs

**Files:**

- Modify: `docs/Decision-Log.md` (add ADR-0103)
- Modify: `ROADMAP.md` (extend the Tools-area cross-cutting bullet)
- Modify: `STATUS.md` (note the firm-usage reads under the Tools row)
- Modify: `CHANGELOG.md` (add an entry)
- Modify: `packages/tools/CLAUDE.md` (move firm usage from "future" to built-headless)

- [ ] **Step 1: Add ADR-0103 to the Decision Log**

In `docs/Decision-Log.md`, add an entry following the existing ADR format:

> **ADR-0103** · Accepted · 2026-06-17 · Tools / Diagnostics — **Firm usage snapshot: a read-only, per-firm usage view assembled from our own D1.** **Decision:** storage (summed from the `storage_meter` rollup) + entity counts (matters by status, non-deleted files, clean versions, folders, locations), read per-firm from D1 with no API token; each domain package owns the read of its own tables (no cross-domain query). **Deferred seams:** per-firm compute/activity (Workers CPU time, request volume) needs the Cloudflare Analytics Engine query + an API-token credential — designed as a seam, not built; the aggregate `FirmUsageSnapshot` type + worker read route land with the consumer; the UI rides the design-system shell. Builds on ADR-0101 (the Tools layer), ADR-0078/0083 (storage metering + load-profile accretion), ADR-0003 (tenancy), ADR-0068 (access control). Spec: `docs/specs/2026-06-17-firm-usage-diagnostics-design.md`.

- [ ] **Step 2: Extend the ROADMAP Tools bullet**

In `ROADMAP.md`, in the Tools-area cross-cutting bullet, note that the firm-usage diagnostics reads are built headless (storage + entity counts from per-firm D1; `tools:firmUsage` + the `firm-usage` Diagnostics manifest), with the worker route, the Cloudflare-analytics compute seam, and the UI deferred (ADR-0103).

- [ ] **Step 3: Note it in STATUS**

In `STATUS.md`, under the Tools-area row, add that the firm-usage diagnostics reads are built + tested (UI/route pending).

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, add an entry under `### Added`: the firm-usage diagnostics headless reads — `@magna-carta/file-manager` `readStorageUsage`/`summarizeStorageMeterRows` + file/version/folder counts, `@magna-carta/matters` `readMatterCounts`, `@magna-carta/locations` `readLocationCount`; the `tools:firmUsage` permission + `firm-usage` Diagnostics manifest. Per-firm compute/activity (Cloudflare Analytics API + token), the aggregate worker route, and the UI deferred (ADR-0103).

- [ ] **Step 5: Update the tools CLAUDE.md**

In `packages/tools/CLAUDE.md`, in the seams paragraph, note that firm usage (diagnostics) now has its headless reads + `firm-usage` manifest built; only its worker route + UI are pending.

- [ ] **Step 6: Commit**

```bash
git add docs/Decision-Log.md ROADMAP.md STATUS.md CHANGELOG.md packages/tools/CLAUDE.md
git commit -m "docs(tools): record ADR-0103 and update roadmap/status/changelog for firm usage"
```

---

## Self-Review

**1. Spec coverage** (against `docs/specs/2026-06-17-firm-usage-diagnostics-design.md`):

- §1 storage + entity counts → Tasks 2 (storage + file/version/folder), 3 (matters by status, locations).
- §2 data sources (storage_meter, matter, file/version/folder, location) → the exact tables queried in Tasks 2–3.
- §3 architecture (each domain owns its own read; no aggregator/route now) → Tasks 2–3 add reads to owning packages; no aggregate type built.
- §4 the built increment (pure reads + `tools:firmUsage` + `firm-usage` manifest) → Tasks 1, 2, 3, 4. Deferred items (worker route, compute seam, UI) explicitly NOT built.
- §5 testing (pure summarizer; zero + non-zero; soft-deleted excluded; clean-only versions; status breakdown) → Task 2 and Task 3 tests.
- §6 docs (ADR-0103 + ROADMAP/STATUS/CHANGELOG) → Task 5.

**2. Placeholder scan:** no TBD/TODO; every code step shows complete code; every command states expected output. Clean.

**3. Type consistency:** `StorageUsage`/`StorageMeterRow`/`StorageClassTotals`/`summarizeStorageMeterRows`/`readStorageUsage`/`readFileCount`/`readCleanVersionCount`/`readFolderCount` are defined in Task 2 and used verbatim in its test; `MatterCounts`/`readMatterCounts` and `readLocationCount` match between Task 3's test and implementation; `tools:firmUsage` is registered in Task 1 and consumed by Task 4's `assertPermission`; the catalog id `firm-usage` matches between Task 4's manifest and test. All `SqlDatabase` reads use `database.prepare(sql).all<T>()` returning `{ results }`, consistent with the existing `metering-statements.test.ts` execution pattern. Consistent.
