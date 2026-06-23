# Per-firm Database on a Durable Object — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-firm D1 database (static binding, redeploy-per-firm) with a per-firm SQLite-backed Durable Object addressed by `firmId`, behind the unchanged `SqlDatabase`/`BatchDatabase` interface.

**Architecture:** A `FirmDatabase` Durable Object hosts each firm's SQLite via `ctx.storage.sql`, self-migrating the existing per-firm lineage on wake. The app Worker reaches it through a **proxy `BatchDatabase`** that marshals `run`/`all`/`batch` over DO RPC; the ~185 domain statement modules are untouched. The per-firm half of the cron relay re-homes into per-DO alarms. Control-plane D1 and all R2 are unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (SQLite storage), `@cloudflare/vitest-pool-workers` (Miniflare), Hono, the in-repo `MigrationTarget`/`SqlDatabase` seams.

## Global Constraints

- **Names spelled in full** (golden rule 12): `FirmDatabase`, `firmDatabase`, `doSqliteBatchDatabase` — no `db`/`fdo` shorthand. Universal externals (`sql`, `id`, `RPC`) excepted.
- **No process-doc refs in source** (golden rule 13): no `ADR-NNNN`/"slice N" in code or comments; explain reasoning inline or cite a file path.
- **Control-plane D1 and all R2 are out of scope** — do not touch `DB_CONTROL` access, `createBucket`, `configureBucketNotifications`, the presigner, or ingest's R2 reads.
- **The `SqlDatabase`/`SqlStatement`/`BatchDatabase` interfaces do not change.** Statement modules and services stay byte-for-byte unchanged; if a change to one seems needed, stop — the adapter is wrong.
- **DO SQLite specifics:** `meta.changes` comes from a `SELECT changes()` probe (never the cursor's `rowsWritten`); atomicity uses `ctx.storage.transactionSync` (never `BEGIN/COMMIT`); schema version lives in the runner's `_migrations` table (`PRAGMA user_version` is unsupported).
- **Tests run in the worker Miniflare pool** (`@cloudflare/vitest-pool-workers`); a DO under test needs its class exported from `apps/worker/src/index.ts` and declared with a `new_sqlite_classes` migration in `wrangler.jsonc`.
- **Reference implementation already exists** on branch `spike/per-firm-do-sqlite` (`apps/worker/src/spike/firm-data-spike.ts`) — the adapters in Tasks 1–2 are productionized copies of it.

---

## File Structure

**New:**
- `packages/database/src/do-sqlite-migration-target.ts` — `doSqliteMigrationTarget(storage)`: a `MigrationTarget` over `ctx.storage.sql`.
- `packages/database/src/do-sqlite-batch-database.ts` — `doSqliteBatchDatabase(storage)`: the in-DO `BatchDatabase` over `ctx.storage.sql`.
- `apps/worker/src/firm-database/firm-database-object.ts` — the `FirmDatabase` Durable Object (self-migrate-on-wake + data-plane RPC + per-firm sweep alarm).
- `apps/worker/src/firm-database/firm-database-proxy.ts` — the worker-side proxy `BatchDatabase` marshalling to a `FirmDatabase` stub.
- `apps/worker/src/firm-database/rpc-types.ts` — the RPC request/response shapes shared by object + proxy.
- Test siblings under `packages/database/test/`, `packages/data-access/test/`, `apps/worker/test/firm-database/`.

**Modified:**
- `apps/worker/wrangler.jsonc` — add the `FIRM_DATABASE` DO binding + a `new_sqlite_classes` migration; remove `DB_FIRM_POOL_1/2`.
- `apps/worker/src/index.ts` — export `FirmDatabase`.
- `apps/worker/src/app.ts` — the `Bindings` type (`FIRM_DATABASE` namespace; drop the pool).
- `apps/worker/src/chokepoint/ports.ts` — `FirmContext.firmDatabase` becomes the proxy; resolve via the DO stub.
- `apps/worker/src/files/ingest-consumer.ts`, `member-provision-consumer.ts`, `inference/inference-consumer.ts` — resolve the firm handle via the proxy.
- `apps/worker/src/scheduled.ts` — remove the per-firm sweep loop (moves into the DO alarm); keep the control-plane sweep + storage reconciliation.
- `apps/worker/src/firm-resource-provider.ts`, `firm-provisioner-wiring.ts`, `per-firm-migrations.ts` consumers — drop per-firm `createDatabase` + the migrate-at-provision step.

**Deleted:**
- `apps/worker/src/firm-binding-resolver.ts` + its test.
- `packages/database/src/fleet-rollout.ts` + its test (central iteration; replaced by self-migrate-on-wake).

---

## Phase 1 — Adapters (isolatable, spike-proven, no consumers yet)

### Task 1: `doSqliteMigrationTarget`

**Files:**
- Create: `packages/database/src/do-sqlite-migration-target.ts`
- Test: `packages/database/test/do-sqlite-migration-target.test.ts`

**Interfaces:**
- Consumes: `MigrationTarget`, `Migration` from `./migration-runner.ts` / `./migration.ts`; `DurableObjectStorage` (workers-types).
- Produces: `doSqliteMigrationTarget(storage: DurableObjectStorage, now?: () => string): MigrationTarget`.

- [ ] **Step 1: Write the failing test** (in the worker pool — DO storage is only real there; this test lives under `apps/worker/test/firm-database/` if `packages/database` lacks a workers pool — see note). Use a minimal SQLite DO defined in the test, or reuse `FirmDatabase` once Task 3 exists. For Phase 1, test the pure mapping against `node:sqlite` is NOT possible (the target needs `ctx.storage.sql`); instead test it through the DO in Task 3. **Therefore Task 1 ships its code here and its behavioral test is Task 3's first test.** Write the file:

- [ ] **Step 2: Write the implementation**

```ts
import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type { Migration } from "./migration.ts";
import type { MigrationTarget } from "./migration-runner.ts";

// MigrationTarget over a SQLite-backed Durable Object's storage. Sits beside d1-migration-target.ts.
// Atomicity uses transactionSync (the documented DO primitive); the applied-tags ledger is the same
// runner-managed _migrations table D1 uses (PRAGMA user_version is unsupported on DO SQLite).
const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

export function doSqliteMigrationTarget(
  storage: DurableObjectStorage,
  now: () => string = () => new Date().toISOString(),
): MigrationTarget {
  const sql = storage.sql;
  return {
    appliedMigrationTags(): Promise<string[]> {
      sql.exec(CREATE_MIGRATIONS_TABLE);
      const rows = sql.exec("SELECT tag FROM _migrations ORDER BY tag").toArray() as {
        tag: string;
      }[];
      return Promise.resolve(rows.map((row) => row.tag));
    },
    applyMigration(migration: Migration): Promise<void> {
      try {
        storage.transactionSync(() => {
          for (const statement of migration.statements) sql.exec(statement);
          sql.exec(
            "INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)",
            migration.tag,
            now(),
          );
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/do-sqlite-migration-target.ts
git commit -m "feat(database): doSqliteMigrationTarget over Durable Object SQLite storage"
```

### Task 2: `doSqliteBatchDatabase`

**Files:**
- Create: `packages/database/src/do-sqlite-batch-database.ts`
- Test: behavioral test lands in Task 4 (needs a live DO).

**Interfaces:**
- Consumes: `DurableObjectStorage`; the `SqlDatabase`/`SqlStatement`/`BatchDatabase` shapes (structural — mirror `packages/data-access/src/idempotency-statements.ts` and `packages/database/src/node-sqlite.ts`; do not import `D1Database`).
- Produces: `doSqliteBatchDatabase(storage: DurableObjectStorage): BatchDatabase` where `BatchDatabase` = `{ prepare(sql): SqlStatement; batch(statements): Promise<{ success: boolean }[]> }`.

- [ ] **Step 1: Write the implementation** (copy the spike, productionized — types from the shared shape, not `any`):

```ts
import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

export interface DoSqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): DoSqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface DoBatchDatabase {
  prepare(sql: string): DoSqlStatement;
  batch(statements: DoSqlStatement[]): Promise<{ success: boolean }[]>;
}

export function doSqliteBatchDatabase(storage: DurableObjectStorage): DoBatchDatabase {
  const sql = storage.sql;
  function makeStatement(text: string, bindings: readonly unknown[]): DoSqlStatement {
    return {
      sql: text,
      bindings,
      bind: (...values: unknown[]) => makeStatement(text, values),
      run: () => {
        sql.exec(text, ...(bindings as SqlStorageValue[]));
        // changes() reflects the last INSERT/UPDATE/DELETE and is NOT reset by a following SELECT —
        // this is the faithful D1Result.meta.changes mapping the guarded UPDATE/DELETE statements need.
        const changes = Number(
          (sql.exec("SELECT changes() AS c").one() as { c: number | bigint }).c,
        );
        return Promise.resolve({ meta: { changes } });
      },
      all: <T>() => {
        const results = sql.exec(text, ...(bindings as SqlStorageValue[])).toArray() as T[];
        return Promise.resolve({ results });
      },
    };
  }
  return {
    prepare: (text: string) => makeStatement(text, []),
    batch: (statements: DoSqlStatement[]) => {
      // transactionSync = all-or-nothing; a throwing statement (e.g. a UNIQUE violation) rolls the
      // whole sequence back, matching D1 batch() semantics. The throw propagates to the caller.
      try {
        storage.transactionSync(() => {
          for (const statement of statements) {
            sql.exec(statement.sql, ...(statement.bindings as SqlStorageValue[]));
          }
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve(statements.map(() => ({ success: true })));
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/do-sqlite-batch-database.ts
git commit -m "feat(database): doSqliteBatchDatabase over Durable Object SQLite storage"
```

---

## Phase 2 — The `FirmDatabase` Durable Object + RPC proxy

### Task 3: RPC types + the `FirmDatabase` object with self-migrate-on-wake

**Files:**
- Create: `apps/worker/src/firm-database/rpc-types.ts`, `apps/worker/src/firm-database/firm-database-object.ts`
- Modify: `apps/worker/src/index.ts` (export), `apps/worker/wrangler.jsonc` (binding `FIRM_DATABASE` + `new_sqlite_classes` migration tag), `apps/worker/src/app.ts` (`Bindings.FIRM_DATABASE: DurableObjectNamespace<FirmDatabase>`)
- Test: `apps/worker/test/firm-database/firm-database-migrate.test.ts`

**Interfaces:**
- Produces:
  - `interface RpcStatement { sql: string; bindings: unknown[] }`
  - `type CommitOutcome = { ok: true } | { ok: false; conflict: "idempotency_key" | "unique" }`
  - `class FirmDatabase` with RPC methods: `runRead(sql: string, bindings: unknown[]): Promise<{ results: Record<string, unknown>[] }>`, `runWrite(sql: string, bindings: unknown[]): Promise<{ changes: number }>`, `commitBatch(statements: RpcStatement[]): Promise<CommitOutcome>`.

- [ ] **Step 1: Write `rpc-types.ts`**

```ts
export interface RpcStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}
// commitBatch returns a typed outcome rather than throwing across the RPC boundary, so conflict
// detection never depends on an error message surviving serialization. The proxy reconstructs the
// thrown shape worker-side (firm-database-proxy.ts).
export type CommitOutcome = { ok: true } | { ok: false; conflict: "idempotency_key" | "unique" };
```

- [ ] **Step 2: Write the failing migrate test**

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FirmDatabase } from "../../src/firm-database/firm-database-object.ts";

describe("FirmDatabase", () => {
  it("self-migrates the per-firm lineage on wake", async () => {
    const stub = env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName("firm_x"));
    const tables = await runInDurableObject(stub, (instance: FirmDatabase) =>
      instance.tableCountForTest(),
    );
    expect(tables).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @magna-carta/worker run test test/firm-database/firm-database-migrate.test.ts` → fails (class missing).

- [ ] **Step 4: Write `firm-database-object.ts`**

```ts
import { DurableObject } from "cloudflare:workers";
import { doSqliteMigrationTarget } from "@magna-carta/database/do-sqlite-migration-target";
import { doSqliteBatchDatabase } from "@magna-carta/database/do-sqlite-batch-database";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "../app.ts";
import { perFirmMigrations } from "../per-firm-migrations.ts";
import { isUniqueConflict } from "./firm-database-proxy.ts";
import type { CommitOutcome, RpcStatement } from "./rpc-types.ts";

// One firm's per-firm database. Addressed idFromName(firmId): binding-free, created on first access,
// self-migrating on wake. The app Worker reaches it through firm-database-proxy.ts (the SqlDatabase
// the statement modules build against); this class only executes already-composed SQL + params.
export class FirmDatabase extends DurableObject<Bindings> {
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      await runPendingMigrations(doSqliteMigrationTarget(ctx.storage), perFirmMigrations());
    });
  }

  async runRead(sql: string, bindings: unknown[]): Promise<{ results: Record<string, unknown>[] }> {
    await this.ready;
    return doSqliteBatchDatabase(this.ctx.storage).prepare(sql).bind(...bindings).all();
  }

  async runWrite(sql: string, bindings: unknown[]): Promise<{ changes: number }> {
    await this.ready;
    const result = await doSqliteBatchDatabase(this.ctx.storage).prepare(sql).bind(...bindings).run();
    return { changes: result.meta.changes };
  }

  async commitBatch(statements: RpcStatement[]): Promise<CommitOutcome> {
    await this.ready;
    const database = doSqliteBatchDatabase(this.ctx.storage);
    const prepared = statements.map((s) => database.prepare(s.sql).bind(...s.bindings));
    try {
      await database.batch(prepared);
      return { ok: true };
    } catch (error) {
      // Translate the only conflict the effect path expects into a typed outcome. Anything else is a
      // real fault and must surface as a thrown RPC error (the worker maps it to a 500).
      if (isUniqueConflict(error, "idempotency_key.key")) return { ok: false, conflict: "idempotency_key" };
      throw error;
    }
  }

  tableCountForTest(): Promise<number> {
    return this.ready.then(
      () =>
        (this.ctx.storage.sql
          .exec("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
          .one() as { c: number }).c,
    );
  }
}
```

- [ ] **Step 5:** Add binding + migration to `wrangler.jsonc` (`durable_objects.bindings` += `{ "name": "FIRM_DATABASE", "class_name": "FirmDatabase" }`; `migrations` += `{ "tag": "v2", "new_sqlite_classes": ["FirmDatabase"] }`), export from `index.ts`, add `FIRM_DATABASE: DurableObjectNamespace<FirmDatabase>` to `Bindings` in `app.ts`.

- [ ] **Step 6: Run, expect PASS.** Commit.

```bash
git add apps/worker/src/firm-database apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/src/app.ts apps/worker/test/firm-database/firm-database-migrate.test.ts
git commit -m "feat(worker): FirmDatabase Durable Object with self-migrate-on-wake"
```

### Task 4: The proxy `BatchDatabase` + the round-trip behavioral test

**Files:**
- Create: `apps/worker/src/firm-database/firm-database-proxy.ts`
- Test: `apps/worker/test/firm-database/firm-database-proxy.test.ts`

**Interfaces:**
- Consumes: a `FirmDatabase` stub (`DurableObjectStub<FirmDatabase>`); `RpcStatement`/`CommitOutcome`.
- Produces:
  - `firmDatabaseProxy(stub: DurableObjectStub<FirmDatabase>): BatchDatabase` (the `SqlDatabase` + `batch()` the statement modules build against).
  - `isUniqueConflict(error: unknown, qualifiedColumn: string): boolean` (shared with the object).

- [ ] **Step 1: Write the failing test** — drive a REAL, unmodified statement module through the proxy against a real stub:

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  insertCompletedIdempotencyRecordStatement,
  isIdempotencyKeyConflict,
  purgeExpiredIdempotencyRecordsStatement,
  selectIdempotencyRecordStatement,
} from "@magna-carta/data-access/idempotency-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";
import { firmDatabaseProxy } from "../../src/firm-database/firm-database-proxy.ts";

const record = (key: string) => ({
  id: `idk_${key}` as IdempotencyRecordId,
  key, fingerprint: "fp", responseCode: 200, responseBody: null,
  createdAt: "2026-06-23T00:00:00.000Z",
});

function proxyFor(name: string) {
  return firmDatabaseProxy(env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(name)));
}

describe("firmDatabaseProxy", () => {
  it("runs an unmodified statement module with faithful meta.changes", async () => {
    const database = proxyFor("firm_proxy_changes");
    expect((await insertCompletedIdempotencyRecordStatement(database, record("k")).run()).meta.changes).toBe(1);
    const found = await selectIdempotencyRecordStatement(database, "k").all<{ key: string }>();
    expect(found.results[0]?.key).toBe("k");
    expect((await purgeExpiredIdempotencyRecordsStatement(database, "2000-01-01T00:00:00.000Z").run()).meta.changes).toBe(0);
    expect((await purgeExpiredIdempotencyRecordsStatement(database, "2100-01-01T00:00:00.000Z").run()).meta.changes).toBe(1);
  });

  it("re-throws a UNIQUE conflict so isIdempotencyKeyConflict matches and rolls back", async () => {
    const database = proxyFor("firm_proxy_conflict");
    let caught: unknown;
    try {
      await commitEffectBatch(database, { statements: [
        insertCompletedIdempotencyRecordStatement(database, record("dupe")),
        insertCompletedIdempotencyRecordStatement(database, record("dupe")),
      ], outboxMessages: [] }, { now: () => "2026-06-23T00:00:00.000Z" });
    } catch (error) { caught = error; }
    expect(isIdempotencyKeyConflict(caught)).toBe(true);
    expect((await selectIdempotencyRecordStatement(database, "dupe").all()).results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (proxy missing).

- [ ] **Step 3: Write `firm-database-proxy.ts`**

```ts
import type { DurableObjectStub } from "@cloudflare/workers-types";
import type { FirmDatabase } from "./firm-database-object.ts";

export interface ProxySqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): ProxySqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface ProxyBatchDatabase {
  prepare(sql: string): ProxySqlStatement;
  batch(statements: ProxySqlStatement[]): Promise<{ success: boolean }[]>;
}

// True when a thrown SQLite error is a UNIQUE violation on the given qualified column ("table.col").
// Shared by the object (to type the conflict) and reused by the data-access detectors' message shape.
export function isUniqueConflict(error: unknown, qualifiedColumn: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(qualifiedColumn)
  );
}

// The worker-side SqlDatabase the statement modules build against. Each run()/all() is one RPC to the
// firm's DO; a batch() is one RPC carrying the whole transactional unit. A commitBatch conflict comes
// back as a typed outcome, which this proxy re-throws as the exact SQLite message the data-access
// conflict detectors (isIdempotencyKeyConflict) already match — so neither detector nor caller changes.
export function firmDatabaseProxy(stub: DurableObjectStub<FirmDatabase>): ProxyBatchDatabase {
  function makeStatement(sql: string, bindings: readonly unknown[]): ProxySqlStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: async () => ({ meta: { changes: (await stub.runWrite(sql, [...bindings])).changes } }),
      all: async <T>() => (await stub.runRead(sql, [...bindings])) as { results: T[] },
    };
  }
  return {
    prepare: (sql: string) => makeStatement(sql, []),
    batch: async (statements: ProxySqlStatement[]) => {
      const outcome = await stub.commitBatch(
        statements.map((s) => ({ sql: s.sql, bindings: [...s.bindings] })),
      );
      if (!outcome.ok) {
        // Reconstruct the SQLite message the detectors match on; the conflict column tells us which.
        const table = outcome.conflict === "idempotency_key" ? "idempotency_key.key" : "unique";
        throw new Error(`UNIQUE constraint failed: ${table}`);
      }
      return statements.map(() => ({ success: true }));
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS.** This is the load-bearing proof the data plane is mechanical. Commit.

```bash
git add apps/worker/src/firm-database/firm-database-proxy.ts apps/worker/test/firm-database/firm-database-proxy.test.ts
git commit -m "feat(worker): worker-side proxy BatchDatabase marshalling to FirmDatabase over RPC"
```

> **Note (residual risk from the design):** if a hot handler issues many sequential reads, each is a worker→DO hop. After Task 6, run the load-profile harness against a read-heavy route; if hop count is a problem, add a DO-side composite read method and a proxy helper. Do not pre-optimize.

---

## Phase 3 — Wire the request paths onto the proxy

### Task 5: Chokepoint resolves the firm via the DO proxy

**Files:**
- Modify: `apps/worker/src/chokepoint/ports.ts`
- Test: `apps/worker/test/me.test.ts`, `apps/worker/test/chokepoint/chokepoint.test.ts` (existing — adjust the firm-resolution seed; see Task 9 recipe)

**Interfaces:**
- Changes `FirmContext.firmDatabase` from `D1Database` to `ProxyBatchDatabase`. Handlers consume it as `SqlDatabase`/`BatchDatabase`, so no handler signature changes.

- [ ] **Step 1:** In `ports.ts`, change the `FirmContext` field type and the resolver. Replace the `resolveFirmDatabase(env, firmRow.database_identifier)` line with the DO stub:

```ts
// firmRow no longer needs database_identifier; the DO is addressed by the firm id itself.
const firmRow = await env.DB_CONTROL.prepare(
  "SELECT name, bucket_name FROM firm WHERE id = ?1",
).bind(session.firmId).first<{ name: string; bucket_name: string | null }>();
if (firmRow === null) return null;
const firmDatabase = firmDatabaseProxy(env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(session.firmId)));
```

Update the `FirmContext` interface: `readonly firmDatabase: ProxyBatchDatabase;` and import `firmDatabaseProxy`/`ProxyBatchDatabase`. Remove the `resolveFirmDatabase` import.

> **Decision captured:** the "firm unreachable in this deployment" 404 branch (old `resolveFirmDatabase === null`) **disappears** — every firm is reachable by name. Structural absence is now only: firm row missing, or member deactivated. Keep both branches; delete only the binding-unreachable one.

- [ ] **Step 2:** Run `me.test.ts` and `chokepoint.test.ts` (after the Task 9 seed change they depend on — sequence Task 9 first if red). Expect PASS. Commit.

### Task 6: The three consumers resolve via the proxy

**Files:**
- Modify: `apps/worker/src/files/ingest-consumer.ts`, `apps/worker/src/member-provision-consumer.ts`, `apps/worker/src/inference/inference-consumer.ts`
- Test: `apps/worker/test/ingest-consumer.test.ts`, `members.test.ts`, `inference-isolation.test.ts`

**Interfaces:** each consumer currently calls `resolveFirmDatabase(env, <identifier>)`; replace with `firmDatabaseProxy(env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(firmId)))`. The `firmId` is already on each message/row.

- [ ] **Step 1:** For each consumer, read its current firm-resolution call, swap to the proxy, drop the `database_identifier` lookup. (member-provision-consumer reads the control plane for the firm row — keep that read but resolve the per-firm handle by id.)
- [ ] **Step 2:** Run the three tests (post Task 9). Commit per consumer.

---

## Phase 4 — Re-home the per-firm relay into the DO alarm (highest risk)

### Task 7: Per-firm sweep alarm on `FirmDatabase`

**Files:**
- Modify: `apps/worker/src/firm-database/firm-database-object.ts` (add `alarm()` + arm-on-first-write), `apps/worker/src/scheduled.ts` (remove the per-firm loop), delete `packages/database/src/fleet-rollout.ts` (+ test)
- Create: `apps/worker/test/firm-database/firm-database-sweep.test.ts`

**Interfaces:**
- The DO gains `alarm(): Promise<void>` running the outbox relay + idempotency purge + stale-pending sweep **against its own storage**, using the existing `outboxRelay`/purge statements with `doSqliteBatchDatabase(this.ctx.storage)`. It self-arms a recurring alarm (`ctx.storage.setAlarm`) the first time it serves a write, and re-arms at the end of each `alarm()`.

- [ ] **Step 1: Write the failing test** — seed an outbox row in a firm DO, run its alarm, assert the row is marked delivered and a fresh alarm is set. (Model the relay assertions on `packages/data-access/test/outbox-relay.test.ts`; the sweep logic is the same code, pointed at DO storage.)

- [ ] **Step 2: Implement** `alarm()` and arming. Read `apps/worker/src/scheduled.ts` lines for the existing per-firm sweep body (the outbox relay call, the idempotency purge cutoff, the stale-pending upload sweep) and move that exact sequence into the DO, swapping the firm `D1Database` for `doSqliteBatchDatabase(this.ctx.storage)`. Arm with `this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS)` at the end of every `alarm()` and lazily on first `commitBatch`/`runWrite` if no alarm is set (`await this.ctx.storage.getAlarm() === null`).

- [ ] **Step 3:** In `scheduled.ts`, delete the per-firm enumeration + loop (`listReachableActiveFirms` and the per-firm sweep body) and its helpers; **keep** the control-plane outbox sweep and `runStorageReconciliation`. Delete `fleet-rollout.ts` + test.

- [ ] **Step 4:** Run the new sweep test + `scheduled.test.ts` (trim its per-firm expectations). Expect PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/worker/src/firm-database apps/worker/src/scheduled.ts apps/worker/test/firm-database/firm-database-sweep.test.ts
git rm packages/database/src/fleet-rollout.ts packages/database/test/fleet-rollout.test.ts
git commit -m "feat(worker): per-firm outbox/idempotency sweep on the FirmDatabase alarm; retire central fleet rollout"
```

> **Failure-isolation invariant to preserve and test:** a firm whose sweep throws must not affect any other firm's sweep (structural with per-DO alarms — assert one firm's poison row does not stall a second firm's alarm in a two-firm test) and must retry on its next alarm (at-least-once).

---

## Phase 5 — Retire per-firm provisioning of D1

### Task 8: Drop per-firm `createDatabase` + the pool

**Files:**
- Modify: `apps/worker/src/firm-resource-provider.ts` (remove `createDatabase` from both adapters + the `FirmResourceProvider` interface), `apps/worker/src/firm-provisioner-wiring.ts` (remove `migrateFirmDatabaseToHeadForEnv`), the provisioner caller (stop recording `database_identifier`; the DO needs no creation step), `apps/worker/wrangler.jsonc` (remove `DB_FIRM_POOL_1/2`), `apps/worker/src/app.ts` (`Bindings`: drop the pool)
- Delete: `apps/worker/src/firm-binding-resolver.ts` + `apps/worker/test/firm-binding-resolver.test.ts`
- Test: `apps/worker/test/firm-resource-provider.test.ts`, `firm-provisioner.test.ts`, `auth-provisioning-e2e.test.ts`

**Interfaces:** `FirmResourceProvider` keeps `createBucket` + `configureBucketNotifications` (R2 unchanged); loses `createDatabase`. Provisioning's "migrate the new firm DB to head" step is removed — the DO self-migrates on first access.

- [ ] **Step 1:** Remove `createDatabase` from the interface and both adapters; remove the dev pool-claimer + `DEV_FIRM_DATABASE_POOL_BINDING_NAMES`.
- [ ] **Step 2:** Remove the provision-time migrate step + `database_identifier` write. Keep the `firm` row write (it still carries `name`, `bucket_name`, status). Leave `firm.database_identifier` column nullable/vestigial — do **not** migrate the control-plane schema in this slice (a column drop is a separate expand-contract change; note it as a follow-up).
- [ ] **Step 3:** Delete `firm-binding-resolver.ts` + test; remove the pool from `wrangler.jsonc` + `Bindings`.
- [ ] **Step 4:** Update the provisioning tests (drop createDatabase expectations; assert the firm DO migrates on first access via a post-provision read). Run `auth-provisioning-e2e.test.ts`. Commit.

---

## Phase 6 — Test fleet rewire + green suite

### Task 9: Rewire per-firm test seeding to the DO

**Files:** ~30 files under `apps/worker/test/**` that seed per-firm data against `env.DB_FIRM_POOL_1` via `apps/worker/test/support/apply-per-firm-migrations.ts`. Plus that support module.

**The transformation recipe** (apply to every per-firm test that seeds or asserts against the firm DB):

- Replace the seed handle. **Before:**

```ts
const database = env.DB_FIRM_POOL_1;
await applyPerFirmMigrations(database);
await database.prepare("INSERT INTO matter (...) VALUES (...)").bind(...).run();
```

**After** — seed inside the firm DO (migration runs in its constructor; use the proxy or raw `runInDurableObject`):

```ts
import { firmDatabaseProxy } from "../../src/firm-database/firm-database-proxy.ts";
const database = firmDatabaseProxy(env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(FIRM_ID)));
await database.prepare("INSERT INTO matter (...) VALUES (...)").run(); // bind via .bind(...) as before
```

- Where a test asserts firm state by reading the binding directly, read through the same proxy (`.all()`), or use `runInDurableObject(stub, (_i, state) => ...)` for raw SQL assertions.
- Update `apply-per-firm-migrations.ts`: it is no longer needed for seeding (the DO self-migrates); keep it only if a pure-node test still uses the node-sqlite path. Delete the worker-pool usages.
- The session/test-auth helper (`test/support/test-auth.ts`) that picks `database_identifier` must instead make the session's `firmId` address the DO — update it once; most tests inherit the fix.

- [ ] **Step 1:** Update `test/support/test-auth.ts` + `apply-per-firm-migrations.ts` first (shared seam). Run one representative test (`members.test.ts`) to validate the recipe end-to-end.
- [ ] **Step 2:** Apply the recipe file-by-file (high-density first: `files-routes`, `directory-e2e`, `custom-fields`). Commit in small batches (3–5 files) so a reviewer can gate each.
- [ ] **Step 3:** Run the full worker suite: `pnpm --filter @magna-carta/worker run test`. Expect all green.

### Task 10: Full gate + docs + load profile

- [ ] **Step 1:** `pnpm check` (fmt + lint + typecheck + svelte-check) and `pnpm run lint:process-refs` — green.
- [ ] **Step 2:** Run the load-profile harness against a read-heavy firm route; record the worker→DO read-hop count and latency. If acceptable, note it; if not, add the composite-read follow-up (Task 4 note).
- [ ] **Step 3:** Update `STATUS.md` (this slice's row), `ROADMAP.md`, and add a `changelog.d/<slug>.md` fragment. Move the ADR fragment's status note if needed. Update `apps/worker/CLAUDE.md` (the per-firm DB is now a DO, addressed by `firmId`; the firm-binding-resolver/pool are gone).
- [ ] **Step 4:** Commit. The package is "Built" only after the end-of-build adversarial review (the project's pre-merge bar).

---

## Self-Review (done while writing)

- **Spec coverage:** adapters (T1–2) ✓; DO + self-migrate (T3) ✓; proxy + conflict re-throw (T4) ✓; request wiring (T5–6) ✓; relay re-homing via alarm (T7) ✓; provisioner/pool retirement (T8) ✓; clean-cut test rewire (T9) ✓; 10GB/single-writer/homing risks recorded in the design and surfaced as the load-profile step + the bulk-writes-to-Queues note (T10) ✓; WfP seam — design-only, no task (correct). The discovery/custodian + audit-log 10GB ceiling is explicitly a deferred separate decision (design), so no task here — correct.
- **Placeholder scan:** every code step carries real code; the test rewire (T9) gives a complete worked example + recipe rather than 30 copies (legitimate for a mechanical fleet).
- **Type consistency:** `ProxyBatchDatabase`/`firmDatabaseProxy`/`isUniqueConflict`/`CommitOutcome`/`RpcStatement`/`FirmDatabase` used consistently across T3–T9; `FirmContext.firmDatabase` retyped once (T5) and consumed unchanged.
- **Open dependency to flag for the executor:** T5/T6 tests depend on the T9 seed-helper change — sequence the shared `test-auth.ts`/`apply-per-firm-migrations.ts` edit (start of T9) before re-running T5/T6 suites, or expect those reds until T9.
