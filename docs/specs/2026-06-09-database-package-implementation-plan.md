# `@magna-carta/database` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 0·2 package 3 of 4 — how the database is **defined & evolved**: Drizzle schemas in two lineages (control-plane + per-firm), a migration runner with `_migrations` tracking, a fleet rollout orchestrator (a fleet of one for now), the expand-contract guard, and the schema fitness functions (no float money columns; identifier-handle primary keys).

**Architecture:** Drizzle ORM schemas in TS are the single source of truth for types **and** migrations (`drizzle-kit generate`, ADR-0065). Two independent lineages — `control-plane` and `per-firm` — each with its own drizzle config and output directory. Runtime application is a custom runner (Workers have no filesystem; drizzle's own `migrate()` needs `node:fs`): migrations are plain data (`{ tag, statements[] }` built from the generated journal + SQL), applied through a minimal `MigrationTarget` interface whose D1 adapter uses `D1Database.batch()` — D1's only atomic primitive (`BEGIN` is disallowed on D1; never use drizzle's `db.transaction()` there). The fleet orchestrator is pure logic over injected callbacks; the Cron-Workflow wiring lands in `apps/worker` with a later slice.

**Tech Stack:** drizzle-orm 0.45.2 (stable — NOT the 1.0 RC; the docs site partly shows v1 idioms, stable still writes `NNNN_tag.sql` + `meta/_journal.json`), drizzle-kit 0.31.10, `@magna-carta/identifiers` (branded id types), `@cloudflare/workers-types` (D1 types, dev-only), Vitest via `vp test`.

**Spec:** [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) §1.1/§1.5 (money columns), §2 (identifier PKs), §3.1 + §4.1 (the two per-firm tables), §5 (migration & fleet, ADR-0065), §7 (package layout, ADR-0071).

## Decided up front (read before coding)

1. **Stable drizzle, not the v1 RC.** Pin `drizzle-orm: 0.45.2`, `drizzle-kit: 0.31.10` in the pnpm catalog (exact pins, repo convention). Stable output: `out/NNNN_<tag>.sql` + `out/meta/_journal.json` (`version: "7"`, entries `{ idx, version, when, tag, breakpoints }`), statements separated by the literal line `--> statement-breakpoint`. The v1 RC switches to per-migration folders with no journal — when we adopt it, `drizzle-kit up` converts and only `journal.ts`/the loader change.
2. **Table callback is the array form.** `sqliteTable("x", {...}, (table) => [index(...)...])` — the object-return form is deprecated in 0.45 and removed in v1.
3. **Atomicity on D1 = `batch()`.** One migration's statements **plus** its `_migrations` record insert go in a single `D1Database.batch()` call — Cloudflare documents batches as transactions (all-or-nothing). `db.transaction()` on drizzle's D1 driver issues `BEGIN`, which D1 rejects at runtime.
4. **Schema version mirror = the migration tag.** The control-plane firm registry stores the latest applied per-firm migration **tag** (`per_firm_schema_version TEXT`, null = unprovisioned). Tags are `NNNN_<words>` with a zero-padded index, so lexicographic order is application order.
5. **Timestamps are ISO-8601 UTC instants in `TEXT` columns** (ADR-0055), e.g. `created_at TEXT NOT NULL`.
6. **Naming (golden rule 12):** flat `src/` with fully spelled-out file names — `control-plane-schema.ts`, `per-firm-schema.ts`, `migration.ts`, `migration-runner.ts`, `d1-migration-target.ts`, `fleet-rollout.ts`. Singular table names (`firm`, `idempotency_key`, `outbox`), matching the spec.
7. **What is deliberately NOT here:** no query helpers, no firm-scoping, no idempotency/outbox _behavior_ (all `data-access`, package 4); no Cron/Workflow/DO wiring (lands in `apps/worker`); no real-D1 test in this package (the package stays plain-Vitest like `money`/`identifiers` — the D1 adapter is tested against a scripted stub honoring batch semantics, and end-to-end D1 application is exercised by the worker integration test when `data-access` wires it).

## File structure

```
packages/database/
  package.json
  tsconfig.json
  vitest.config.ts
  drizzle-control-plane.config.ts     # drizzle-kit config, lineage 1
  drizzle-per-firm.config.ts          # drizzle-kit config, lineage 2
  drizzle/
    control-plane/                    # generated: 0000_*.sql + meta/_journal.json (committed)
    per-firm/                         # generated: 0000_*.sql + meta/_journal.json (committed)
  src/
    control-plane-schema.ts           # firm registry table
    per-firm-schema.ts                # idempotency_key + outbox tables
    migration.ts                      # Migration type, journal types, splitSqlStatements, migrationsFromJournal
    migration-runner.ts               # MigrationTarget interface + runPendingMigrations
    d1-migration-target.ts            # MigrationTarget over a D1Database (batch-atomic)
    fleet-rollout.ts                  # rolloutMigrationsAcrossFleet (bounded concurrency, quarantine, report)
  test/
    control-plane-schema.test.ts
    per-firm-schema.test.ts
    schema-conformance.test.ts        # fitness: identifier PKs + money-column rules across BOTH schemas
    migration.test.ts
    migration-runner.test.ts
    d1-migration-target.test.ts
    fleet-rollout.test.ts
    expand-contract.test.ts           # fitness: destructive SQL needs an explicit contract marker
    generated-migrations.test.ts      # the committed journal + SQL parse into orderly migrations
```

---

### Task 1: Scaffold the package and pin dependencies

**Files:**

- Modify: `pnpm-workspace.yaml` (catalog)
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/vitest.config.ts`

- [ ] **Step 1: Add catalog pins** — in `pnpm-workspace.yaml` under `catalog:`, after the identifiers entry:

```yaml
# Database (packages/database). Stable line, NOT the 1.0 RC: 0.31.x drizzle-kit emits
# NNNN_tag.sql + meta/_journal.json, which migration.ts consumes. Bump both together.
drizzle-orm: 0.45.2
drizzle-kit: 0.31.10
```

- [ ] **Step 2: Create `packages/database/package.json`**

```json
{
  "name": "@magna-carta/database",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./control-plane-schema": "./src/control-plane-schema.ts",
    "./per-firm-schema": "./src/per-firm-schema.ts",
    "./migration": "./src/migration.ts",
    "./migration-runner": "./src/migration-runner.ts",
    "./d1-migration-target": "./src/d1-migration-target.ts",
    "./fleet-rollout": "./src/fleet-rollout.ts"
  },
  "scripts": {
    "test": "vp test run",
    "generate-control-plane-migrations": "drizzle-kit generate --config=drizzle-control-plane.config.ts",
    "generate-per-firm-migrations": "drizzle-kit generate --config=drizzle-per-firm.config.ts"
  },
  "dependencies": {
    "@magna-carta/identifiers": "workspace:*",
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "catalog:",
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "drizzle-kit": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 3: Create `packages/database/tsconfig.json`** (mirrors identifiers)

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "*.config.ts"]
}
```

- [ ] **Step 4: Create `packages/database/vitest.config.ts`** (same shape as `packages/identifiers/vitest.config.ts` — copy it verbatim and keep the `test.include` of `test/**/*.test.ts`).

- [ ] **Step 5: Install and verify**

Run: `vp install`
Expected: lockfile updates; `drizzle-orm` and `drizzle-kit` resolve at the pinned versions.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/database
git commit -m "chore(database): scaffold @magna-carta/database package + pin drizzle in catalog"
```

---

### Task 2: Control-plane schema — the firm registry

**Files:**

- Create: `packages/database/src/control-plane-schema.ts`
- Test: `packages/database/test/control-plane-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { firm } from "../src/control-plane-schema.ts";

describe("control-plane schema: firm registry", () => {
  const config = getTableConfig(firm);
  const column = (name: string) => {
    const found = config.columns.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`expected column ${name} on ${config.name}`);
    return found;
  };

  it("is the firm table with a firm_ handle TEXT primary key", () => {
    expect(config.name).toBe("firm");
    expect(column("id").primary).toBe(true);
    expect(column("id").getSQLType()).toBe("text");
  });

  it("tracks the backing D1 database and the mirrored per-firm schema version", () => {
    expect(column("database_identifier").notNull).toBe(true);
    expect(column("database_identifier").isUnique).toBe(true);
    expect(column("per_firm_schema_version").notNull).toBe(false); // null = not yet provisioned
    expect(column("created_at").getSQLType()).toBe("text"); // ISO-8601 instant (ADR-0055)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/database run test`
Expected: FAIL — `control-plane-schema.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { FirmId } from "@magna-carta/identifiers/types";

// CONTROL-PLANE LINEAGE. The firm registry: one row per tenant firm, in the single control-plane D1.
// This file is the source of truth drizzle-kit generates control-plane migrations from — schema changes
// happen HERE, never by hand-editing SQL (ADR-0065).
export const firm = sqliteTable("firm", {
  // The firm_ handle is both primary key and public id (ADR-0062).
  id: text("id").primaryKey().$type<FirmId>(),
  name: text("name").notNull(),
  // The Cloudflare D1 database backing this firm (the database UUID from the Cloudflare API).
  databaseIdentifier: text("database_identifier").notNull().unique(),
  // Mirror of the firm database's latest applied migration tag (fleet-wide visibility, ADR-0065).
  // Null = the firm database has not been provisioned yet. Tags order lexicographically (NNNN_ prefix).
  perFirmSchemaVersion: text("per_firm_schema_version"),
  // ISO-8601 UTC instant (ADR-0055).
  createdAt: text("created_at").notNull(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/database run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/control-plane-schema.ts packages/database/test/control-plane-schema.test.ts
git commit -m "feat(database): control-plane schema — firm registry with schema-version mirror"
```

---

### Task 3: Per-firm schema — `idempotency_key` + `outbox`

**Files:**

- Create: `packages/database/src/per-firm-schema.ts`
- Test: `packages/database/test/per-firm-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { idempotencyKey, outbox } from "../src/per-firm-schema.ts";

const columnOf = (table: typeof idempotencyKey | typeof outbox, name: string) => {
  const config = getTableConfig(table);
  const found = config.columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected column ${name} on ${config.name}`);
  return found;
};

describe("per-firm schema: idempotency_key (spec §3.1)", () => {
  it("matches the spec columns", () => {
    const config = getTableConfig(idempotencyKey);
    expect(config.name).toBe("idempotency_key");
    expect(columnOf(idempotencyKey, "id").primary).toBe(true);
    expect(columnOf(idempotencyKey, "key").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "fingerprint").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "status").notNull).toBe(true);
    expect(columnOf(idempotencyKey, "response_code").getSQLType()).toBe("integer");
    expect(columnOf(idempotencyKey, "created_at").getSQLType()).toBe("text");
  });

  it("enforces UNIQUE(key) — the UNIQUE insert IS the concurrency guard (ADR-0063)", () => {
    const config = getTableConfig(idempotencyKey);
    const uniqueOnKey = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some((column) => "name" in column && column.name === "key"),
    );
    expect(uniqueOnKey).toBe(true);
  });
});

describe("per-firm schema: outbox (spec §4.1)", () => {
  it("matches the spec columns", () => {
    const config = getTableConfig(outbox);
    expect(config.name).toBe("outbox");
    expect(columnOf(outbox, "id").primary).toBe(true);
    expect(columnOf(outbox, "topic").notNull).toBe(true);
    expect(columnOf(outbox, "payload").notNull).toBe(true);
    expect(columnOf(outbox, "aggregate_key").notNull).toBe(false);
    expect(columnOf(outbox, "seq").getSQLType()).toBe("integer");
    expect(columnOf(outbox, "attempts").notNull).toBe(true);
    expect(columnOf(outbox, "dispatched_at").notNull).toBe(false);
  });

  it("has the relay-sweep index on (status, created_at)", () => {
    const config = getTableConfig(outbox);
    const sweepIndex = config.indexes.find((index) =>
      index.config.columns.some((column) => "name" in column && column.name === "status"),
    );
    expect(sweepIndex).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/database run test`
Expected: FAIL — `per-firm-schema.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { IdempotencyRecordId, OutboxId } from "@magna-carta/identifiers/types";

// PER-FIRM LINEAGE. Every tenant firm's D1 carries these tables; drizzle-kit generates per-firm
// migrations from this file (ADR-0065). The BEHAVIOR over these tables (middleware, relay) lives in
// @magna-carta/data-access — this package only defines the structure.

// Idempotency records (ADR-0063, spec §3.1). The UNIQUE(key) insert inside the effect's transaction
// IS the concurrency guard — exactly-once with no separate lock.
export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    id: text("id").primaryKey().$type<IdempotencyRecordId>(), // idr_ handle (server record id)
    key: text("key").notNull(), // client-supplied Idempotency-Key
    fingerprint: text("fingerprint").notNull(), // hash(method + path + canonical body)
    status: text("status", { enum: ["in_progress", "completed"] }).notNull(),
    responseCode: integer("response_code"), // captured on completion
    responseBody: text("response_body"), // captured on completion, redacted per ADR-0038
    createdAt: text("created_at").notNull(), // ISO-8601 instant (ADR-0055); TTL purge keys off this
  },
  (table) => [
    uniqueIndex("idempotency_key_key_unique_index").on(table.key),
    index("idempotency_key_created_at_index").on(table.createdAt),
  ],
);

// Transactional outbox (ADR-0064, spec §4.1): the effect row commits in the SAME D1 transaction as the
// business change; the relay sweeps pending rows to Queues.
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().$type<OutboxId>(), // obx_ handle
    topic: text("topic").notNull(), // e.g. 'payment.capture', 'comms.send'
    payload: text("payload").notNull(), // JSON: ids + non-privileged fields ONLY (ADR-0038)
    aggregateKey: text("aggregate_key"), // ordering scope for ordered topics
    seq: integer("seq"), // monotonic within aggregate_key
    status: text("status", { enum: ["pending", "dispatched", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    dispatchedAt: text("dispatched_at"),
  },
  (table) => [index("outbox_status_created_at_index").on(table.status, table.createdAt)],
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/database run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/test/per-firm-schema.test.ts
git commit -m "feat(database): per-firm schema — idempotency_key + outbox per spec"
```

---

### Task 4: Schema-conformance fitness functions (identifier PKs + money columns)

**Files:**

- Test: `packages/database/test/schema-conformance.test.ts`

These guard EVERY table in BOTH lineages, including ones added later — new tables are picked up automatically because the test enumerates the schema modules' exports.

- [ ] **Step 1: Write the test** (it should PASS immediately — it pins invariants the Task 2/3 schemas already satisfy; watch it fail by temporarily breaking a column if you want proof it bites)

```ts
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as controlPlaneSchema from "../src/control-plane-schema.ts";
import * as perFirmSchema from "../src/per-firm-schema.ts";

// Every drizzle table exported by either lineage. New tables are enumerated automatically —
// these fitness functions bind to the whole schema surface, not a hand-kept list.
const ALL_TABLES = [...Object.values(controlPlaneSchema), ...Object.values(perFirmSchema)].filter(
  (candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable,
);

describe("schema conformance (fitness functions)", () => {
  it("found the expected tables (guards the enumeration itself)", () => {
    expect(ALL_TABLES.length).toBeGreaterThanOrEqual(3); // firm, idempotency_key, outbox
  });

  it("every table's primary key is a TEXT identifier handle named id (ADR-0062)", () => {
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      const primaryColumns = config.columns.filter((column) => column.primary);
      expect(primaryColumns, config.name).toHaveLength(1);
      expect(primaryColumns[0]?.name, config.name).toBe("id");
      expect(primaryColumns[0]?.getSQLType(), config.name).toBe("text");
    }
  });

  it("no money column is a float: *_minor and *_rate_e4 must be INTEGER (ADR-0061, spec §1.1)", () => {
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (column.name.endsWith("_minor") || column.name.endsWith("_rate_e4")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe("integer");
        }
      }
    }
  });

  it("no column anywhere is REAL — float money can never sneak in under another name (spec §1.5)", () => {
    // If a legitimately-float column ever appears (it has not yet), add an explicit allowlist HERE
    // with a comment justifying it — the default posture is no floats in a legal/financial schema.
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        expect(column.getSQLType(), `${config.name}.${column.name}`).not.toBe("real");
      }
    }
  });

  it("money-ish column names must use the storage-encoding suffixes (spec §1.1 column convention)", () => {
    const moneyName = /(amount|balance|total|price|fee|cost)(_|$)/;
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (moneyName.test(column.name)) {
          const suffixed = column.name.endsWith("_minor") || column.name.endsWith("_rate_e4");
          expect(suffixed, `${config.name}.${column.name} must be *_minor or *_rate_e4`).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm --filter @magna-carta/database run test`
Expected: PASS (all green). To watch it bite: temporarily change `outbox.seq` to `text("seq")`-style PK or add a `real()` column — the relevant assertion fails — then revert.

- [ ] **Step 3: Commit**

```bash
git add packages/database/test/schema-conformance.test.ts
git commit -m "test(database): fitness functions — identifier-handle PKs, no float money columns"
```

---

### Task 5: Drizzle configs, generated initial migrations, and the journal loader

**Files:**

- Create: `packages/database/drizzle-control-plane.config.ts`
- Create: `packages/database/drizzle-per-firm.config.ts`
- Create: `packages/database/src/migration.ts`
- Generated: `packages/database/drizzle/control-plane/**`, `packages/database/drizzle/per-firm/**` (committed)
- Test: `packages/database/test/migration.test.ts`
- Test: `packages/database/test/generated-migrations.test.ts`

- [ ] **Step 1: Write the failing unit tests for the loader** (`test/migration.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  migrationsFromJournal,
  splitSqlStatements,
  type MigrationJournal,
} from "../src/migration.ts";

describe("splitSqlStatements", () => {
  it("splits on the drizzle statement breakpoint and trims empties", () => {
    const sql = `CREATE TABLE a (id text);\n--> statement-breakpoint\nCREATE INDEX a_index ON a (id);\n`;
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE TABLE a (id text);",
      "CREATE INDEX a_index ON a (id);",
    ]);
  });

  it("returns a single statement when there is no breakpoint", () => {
    expect(splitSqlStatements("CREATE TABLE a (id text);")).toEqual(["CREATE TABLE a (id text);"]);
  });
});

describe("migrationsFromJournal", () => {
  const journal: MigrationJournal = {
    version: "7",
    dialect: "sqlite",
    entries: [
      { idx: 1, version: "6", when: 2, tag: "0001_second", breakpoints: true },
      { idx: 0, version: "6", when: 1, tag: "0000_first", breakpoints: true },
    ],
  };

  it("orders migrations by journal idx and splits each file's statements", () => {
    const migrations = migrationsFromJournal(journal, {
      "0000_first": "CREATE TABLE a (id text);",
      "0001_second":
        "ALTER TABLE a ADD col text;\n--> statement-breakpoint\nCREATE INDEX i ON a (col);",
    });
    expect(migrations.map((migration) => migration.tag)).toEqual(["0000_first", "0001_second"]);
    expect(migrations[1]?.statements).toHaveLength(2);
  });

  it("fails loud when a journal entry has no SQL", () => {
    expect(() =>
      migrationsFromJournal(journal, { "0000_first": "CREATE TABLE a (id text);" }),
    ).toThrow(/0001_second/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @magna-carta/database run test` → FAIL (`migration.ts` missing).

- [ ] **Step 3: Implement `src/migration.ts`**

```ts
// A migration as plain data — the runtime shape. Workers have no filesystem, so the generated SQL is
// imported as raw text by the consumer (Vite `?raw` / wrangler Text rule) and assembled here; this
// module never touches the filesystem itself.
export interface Migration {
  readonly tag: string;
  readonly statements: readonly string[];
}

// The drizzle-kit 0.31.x journal shape (out/meta/_journal.json). The 1.0 line drops the journal for
// per-migration snapshot folders — adopting it changes only this file and the loader below.
export interface MigrationJournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

export interface MigrationJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly MigrationJournalEntry[];
}

// drizzle-kit separates statements with this literal line; D1 prepared statements are single-statement,
// so the runner needs them split.
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// Assemble the ordered migration list from the generated journal plus a map of tag -> raw SQL text.
export function migrationsFromJournal(
  journal: MigrationJournal,
  sqlByTag: Record<string, string>,
): Migration[] {
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = sqlByTag[entry.tag];
      if (sql === undefined) {
        throw new Error(`migration "${entry.tag}" is in the journal but its SQL was not provided`);
      }
      return { tag: entry.tag, statements: splitSqlStatements(sql) };
    });
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @magna-carta/database run test` → PASS.

- [ ] **Step 5: Create the two drizzle configs**

`drizzle-control-plane.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// Control-plane lineage (ADR-0065): one D1 database for the whole platform.
// Generate: pnpm --filter @magna-carta/database run generate-control-plane-migrations
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/control-plane-schema.ts",
  out: "./drizzle/control-plane",
});
```

`drizzle-per-firm.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// Per-firm lineage (ADR-0065): every tenant firm's D1 follows this one, versioned independently of
// the control plane. Generate: pnpm --filter @magna-carta/database run generate-per-firm-migrations
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/per-firm-schema.ts",
  out: "./drizzle/per-firm",
});
```

- [ ] **Step 6: Generate the initial migrations** (named, not random tags)

Run:

```bash
pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-control-plane.config.ts --name=firm-registry
pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-per-firm.config.ts --name=foundational-tables
```

Expected: `drizzle/control-plane/0000_firm-registry.sql` + `meta/_journal.json`, and `drizzle/per-firm/0000_foundational-tables.sql` + `meta/_journal.json`. Inspect both .sql files: CREATE TABLE statements matching the schemas, `--> statement-breakpoint` between statements.

- [ ] **Step 7: Write the generated-artifact test** (`test/generated-migrations.test.ts`) — guards that the committed journal + SQL stay loadable and in sync with what the loader expects:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsFromJournal, type MigrationJournal } from "../src/migration.ts";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

async function loadLineage(lineage: "control-plane" | "per-firm") {
  const journal = JSON.parse(
    await readFile(join(DRIZZLE, lineage, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlByTag: Record<string, string> = {};
  for (const entry of journal.entries) {
    sqlByTag[entry.tag] = await readFile(join(DRIZZLE, lineage, `${entry.tag}.sql`), "utf8");
  }
  return migrationsFromJournal(journal, sqlByTag);
}

describe("generated migrations (committed artifacts)", () => {
  it("control-plane lineage loads, starts at the firm registry, and every statement is non-empty", async () => {
    const migrations = await loadLineage("control-plane");
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.tag).toMatch(/^0000_/);
    expect(migrations[0]?.statements.join("\n")).toContain("firm");
  });

  it("per-firm lineage loads and creates idempotency_key and outbox", async () => {
    const migrations = await loadLineage("per-firm");
    const allSql = migrations.flatMap((migration) => migration.statements).join("\n");
    expect(allSql).toContain("idempotency_key");
    expect(allSql).toContain("outbox");
  });
});
```

- [ ] **Step 8: Run the suite** — `pnpm --filter @magna-carta/database run test` → PASS.

- [ ] **Step 9: Commit** (generated artifacts are committed — they are the deployable migration set)

```bash
git add packages/database/drizzle-control-plane.config.ts packages/database/drizzle-per-firm.config.ts \
        packages/database/drizzle packages/database/src/migration.ts \
        packages/database/test/migration.test.ts packages/database/test/generated-migrations.test.ts
git commit -m "feat(database): two-lineage drizzle configs, initial migrations, journal loader"
```

---

### Task 6: The migration runner

**Files:**

- Create: `packages/database/src/migration-runner.ts`
- Test: `packages/database/test/migration-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { Migration } from "../src/migration.ts";
import { runPendingMigrations, type MigrationTarget } from "../src/migration-runner.ts";

const MIGRATIONS: Migration[] = [
  { tag: "0000_first", statements: ["CREATE TABLE a (id text);"] },
  { tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] },
  { tag: "0002_third", statements: ["CREATE INDEX i ON a (col);"] },
];

// In-memory target: records applications; optionally fails on a chosen tag.
function fakeTarget(initiallyApplied: string[], failOnTag?: string) {
  const applied = [...initiallyApplied];
  const target: MigrationTarget = {
    appliedMigrationTags: () => Promise.resolve([...applied]),
    applyMigration: (migration) => {
      if (migration.tag === failOnTag) return Promise.reject(new Error(`boom on ${migration.tag}`));
      applied.push(migration.tag);
      return Promise.resolve();
    },
  };
  return { target, applied };
}

describe("runPendingMigrations", () => {
  it("applies everything to a fresh database (provisioning: v0 -> apply all)", async () => {
    const { target, applied } = fakeTarget([]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(applied).toEqual(["0000_first", "0001_second", "0002_third"]);
    expect(report.appliedTags).toEqual(["0000_first", "0001_second", "0002_third"]);
    expect(report.skippedTags).toEqual([]);
  });

  it("skips already-applied migrations and applies only the pending tail (idempotent re-run)", async () => {
    const { target, applied } = fakeTarget(["0000_first"]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(report.skippedTags).toEqual(["0000_first"]);
    expect(applied).toEqual(["0000_first", "0001_second", "0002_third"]);
  });

  it("a fully-current database is a no-op", async () => {
    const { target } = fakeTarget(["0000_first", "0001_second", "0002_third"]);
    const report = await runPendingMigrations(target, MIGRATIONS);
    expect(report.appliedTags).toEqual([]);
  });

  it("stops at the first failure — later migrations are not attempted", async () => {
    const { target, applied } = fakeTarget([], "0001_second");
    await expect(runPendingMigrations(target, MIGRATIONS)).rejects.toThrow(/0001_second/);
    expect(applied).toEqual(["0000_first"]); // 0002 was never attempted
  });

  it("fails loud when the database has an applied tag the code does not know (deploy mismatch)", async () => {
    const { target } = fakeTarget(["9999_from_the_future"]);
    await expect(runPendingMigrations(target, MIGRATIONS)).rejects.toThrow(/9999_from_the_future/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`migration-runner.ts` missing).

- [ ] **Step 3: Implement `src/migration-runner.ts`**

```ts
import type { Migration } from "./migration.ts";

// The seam between "which migrations are pending" (pure, this file) and "how SQL reaches a database"
// (an adapter — see d1-migration-target.ts). applyMigration MUST be atomic: the migration's statements
// and its applied-record commit or roll back together.
export interface MigrationTarget {
  appliedMigrationTags(): Promise<string[]>;
  applyMigration(migration: Migration): Promise<void>;
}

export interface MigrationRunReport {
  readonly appliedTags: string[];
  readonly skippedTags: string[];
}

// Apply every pending migration, in journal order. Fails loud (and stops) on the first failure —
// a half-migrated database is visible in _migrations and resumable by re-running.
export async function runPendingMigrations(
  target: MigrationTarget,
  migrations: readonly Migration[],
): Promise<MigrationRunReport> {
  const applied = new Set(await target.appliedMigrationTags());
  const known = new Set(migrations.map((migration) => migration.tag));
  for (const tag of applied) {
    if (!known.has(tag)) {
      throw new Error(
        `database has applied migration "${tag}" which this code does not know — deploy mismatch (code older than schema)`,
      );
    }
  }
  const report: MigrationRunReport = { appliedTags: [], skippedTags: [] };
  for (const migration of migrations) {
    if (applied.has(migration.tag)) {
      report.skippedTags.push(migration.tag);
      continue;
    }
    await target.applyMigration(migration);
    report.appliedTags.push(migration.tag);
  }
  return report;
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/migration-runner.ts packages/database/test/migration-runner.test.ts
git commit -m "feat(database): migration runner — ordered, idempotent, fail-loud on deploy mismatch"
```

---

### Task 7: The D1 adapter (`d1MigrationTarget`)

**Files:**

- Create: `packages/database/src/d1-migration-target.ts`
- Test: `packages/database/test/d1-migration-target.test.ts`

- [ ] **Step 1: Write the failing tests** — a scripted stub honoring the D1 surface the adapter uses (`prepare().bind().run()/all()`, `batch()`); it records SQL and simulates batch atomicity:

```ts
import { describe, expect, it } from "vitest";
import { d1MigrationTarget } from "../src/d1-migration-target.ts";

// Minimal scripted D1 stub. Records every executed statement; batch() is all-or-nothing like real D1.
function stubD1(options: { appliedRows?: { tag: string }[]; failBatchContaining?: string } = {}) {
  const executed: string[] = [];
  const batches: string[][] = [];
  const makeStatement = (sql: string, bindings: unknown[] = []) => ({
    sql,
    bindings,
    bind: (...values: unknown[]) => makeStatement(sql, values),
    run: () => {
      executed.push(sql);
      return Promise.resolve({ success: true });
    },
    all: () => {
      executed.push(sql);
      return Promise.resolve({ results: options.appliedRows ?? [], success: true });
    },
  });
  const database = {
    prepare: (sql: string) => makeStatement(sql),
    batch: (statements: { sql: string }[]) => {
      const sqls = statements.map((statement) => statement.sql);
      if (
        options.failBatchContaining &&
        sqls.some((sql) => sql.includes(options.failBatchContaining))
      ) {
        return Promise.reject(new Error("D1_ERROR: batch rolled back")); // nothing recorded — atomic
      }
      batches.push(sqls);
      executed.push(...sqls);
      return Promise.resolve(sqls.map(() => ({ success: true })));
    },
  };
  return { database, executed, batches };
}

describe("d1MigrationTarget", () => {
  it("creates _migrations if missing and returns the applied tags", async () => {
    const { database, executed } = stubD1({ appliedRows: [{ tag: "0000_first" }] });
    const target = d1MigrationTarget(database as never);
    const tags = await target.appliedMigrationTags();
    expect(tags).toEqual(["0000_first"]);
    expect(executed.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS _migrations"))).toBe(
      true,
    );
  });

  it("applies a migration's statements AND its _migrations record in one batch (atomic)", async () => {
    const { database, batches } = stubD1();
    const target = d1MigrationTarget(database as never, () => "2026-06-09T00:00:00.000Z");
    await target.applyMigration({
      tag: "0001_second",
      statements: ["ALTER TABLE a ADD col text;", "CREATE INDEX i ON a (col);"],
    });
    expect(batches).toHaveLength(1); // ONE batch — the atomicity guarantee
    const batch = batches[0] ?? [];
    expect(batch).toHaveLength(3); // 2 statements + 1 record insert
    expect(batch[2]).toContain("INSERT INTO _migrations");
  });

  it("a failed batch records nothing (the stub mirrors D1 rollback)", async () => {
    const { database, executed } = stubD1({ failBatchContaining: "ALTER TABLE" });
    const target = d1MigrationTarget(database as never);
    await expect(
      target.applyMigration({ tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] }),
    ).rejects.toThrow(/batch rolled back/);
    expect(executed).toEqual([]); // statements and record both absent — never half-applied
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`d1-migration-target.ts` missing).

- [ ] **Step 3: Implement `src/d1-migration-target.ts`**

```ts
import type { D1Database } from "@cloudflare/workers-types";
import type { Migration } from "./migration.ts";
import type { MigrationTarget } from "./migration-runner.ts";

// Applied-migration tracking, per database (spec §5.2). Runner-managed, deliberately NOT a drizzle
// schema table: it must exist before any migration runs.
const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

// MigrationTarget over a real D1 database. Atomicity: D1 rejects BEGIN (no interactive transactions;
// drizzle's db.transaction() throws at runtime on D1), so the migration's statements plus its
// _migrations record go through ONE batch() call — Cloudflare executes a batch as a transaction,
// rolling the whole sequence back if any statement fails.
export function d1MigrationTarget(
  database: D1Database,
  now: () => string = () => new Date().toISOString(),
): MigrationTarget {
  return {
    async appliedMigrationTags(): Promise<string[]> {
      await database.prepare(CREATE_MIGRATIONS_TABLE).run();
      const { results } = await database
        .prepare("SELECT tag FROM _migrations ORDER BY tag")
        .all<{ tag: string }>();
      return results.map((row) => row.tag);
    },

    async applyMigration(migration: Migration): Promise<void> {
      const statements = migration.statements.map((statement) => database.prepare(statement));
      statements.push(
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)")
          .bind(migration.tag, now()),
      );
      await database.batch(statements);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/d1-migration-target.ts packages/database/test/d1-migration-target.test.ts
git commit -m "feat(database): D1 migration target — batch-atomic apply (D1 has no BEGIN)"
```

---

### Task 8: Fleet rollout orchestrator

**Files:**

- Create: `packages/database/src/fleet-rollout.ts`
- Test: `packages/database/test/fleet-rollout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { Migration } from "../src/migration.ts";
import type { MigrationTarget } from "../src/migration-runner.ts";
import { rolloutMigrationsAcrossFleet, type FirmMigrationState } from "../src/fleet-rollout.ts";

const MIGRATIONS: Migration[] = [
  { tag: "0000_first", statements: ["CREATE TABLE a (id text);"] },
  { tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] },
];

function fleetFixture(states: { firmId: string; applied: string[]; fail?: boolean }[]) {
  const firms: FirmMigrationState[] = states.map((state) => ({
    firmId: state.firmId as FirmMigrationState["firmId"],
    schemaVersion: state.applied.at(-1) ?? null,
  }));
  const appliedByFirm = new Map(states.map((state) => [state.firmId, [...state.applied]]));
  const registryWrites: { firmId: string; tag: string }[] = [];
  const targetForFirm = (firmId: string): MigrationTarget => ({
    appliedMigrationTags: () => Promise.resolve([...(appliedByFirm.get(firmId) ?? [])]),
    applyMigration: (migration) => {
      if (states.find((state) => state.firmId === firmId)?.fail) {
        return Promise.reject(new Error(`quarantine ${firmId}`));
      }
      appliedByFirm.get(firmId)?.push(migration.tag);
      return Promise.resolve();
    },
  });
  return { firms, appliedByFirm, registryWrites, targetForFirm };
}

describe("rolloutMigrationsAcrossFleet", () => {
  it("migrates firms below target, skips current firms, and mirrors the registry version", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_aaa", applied: [] },
      { firmId: "firm_bbb", applied: ["0000_first"] },
      { firmId: "firm_ccc", applied: ["0000_first", "0001_second"] }, // already current
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: (firmId, tag) => {
        fleet.registryWrites.push({ firmId, tag });
        return Promise.resolve();
      },
    });
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_aaa", "firm_bbb"]);
    expect(report.currentFirms).toEqual(["firm_ccc"]);
    expect(fleet.appliedByFirm.get("firm_aaa")).toEqual(["0000_first", "0001_second"]);
    // registry mirror written once per migrated firm, with the latest tag
    expect(fleet.registryWrites).toContainEqual({ firmId: "firm_aaa", tag: "0001_second" });
    expect(fleet.registryWrites).toContainEqual({ firmId: "firm_bbb", tag: "0001_second" });
  });

  it("quarantines a failing firm and continues the fleet (failure isolation)", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_bad", applied: [], fail: true },
      { firmId: "firm_good", applied: [] },
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(report.failedFirms.map((entry) => entry.firmId)).toEqual(["firm_bad"]);
    expect(report.failedFirms[0]?.error).toBeInstanceOf(Error);
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_good"]);
  });

  it("re-running after a partial failure is idempotent: current firms are skipped, the failed firm retries", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_good", applied: ["0000_first", "0001_second"] },
      { firmId: "firm_was_bad", applied: [] },
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(report.currentFirms).toEqual(["firm_good"]);
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_was_bad"]);
  });

  it("bounds concurrency: never more than `concurrency` firms migrating at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const states = ["firm_a", "firm_b", "firm_c", "firm_d", "firm_e"].map((firmId) => ({
      firmId,
      applied: [] as string[],
    }));
    const fleet = fleetFixture(states);
    await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: [MIGRATIONS[0] as Migration],
      concurrency: 2,
      targetForFirm: (firmId) => {
        const inner = fleet.targetForFirm(firmId);
        return {
          appliedMigrationTags: inner.appliedMigrationTags,
          applyMigration: async (migration) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            inFlight--;
            return inner.applyMigration(migration);
          },
        };
      },
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`fleet-rollout.ts` missing).

- [ ] **Step 3: Implement `src/fleet-rollout.ts`**

```ts
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Migration } from "./migration.ts";
import { runPendingMigrations, type MigrationTarget } from "./migration-runner.ts";

// One firm's row from the control-plane registry: its id and the mirrored schema version
// (latest applied per-firm migration tag; null = unprovisioned).
export interface FirmMigrationState {
  readonly firmId: FirmId;
  readonly schemaVersion: string | null;
}

export interface FleetRolloutOptions {
  readonly firms: readonly FirmMigrationState[];
  readonly migrations: readonly Migration[];
  // How SQL reaches one firm's database — in production a d1MigrationTarget over the firm's binding.
  targetForFirm(firmId: FirmId): MigrationTarget;
  // Mirror the new version onto the control-plane registry row (spec §5.2).
  recordFirmSchemaVersion(firmId: FirmId, latestTag: string): Promise<void>;
  // Bounded fan-out (spec §5.3). Default 1 — a fleet of one needs no parallelism yet.
  readonly concurrency?: number;
}

export interface FleetRolloutReport {
  readonly migratedFirms: { firmId: FirmId; appliedTags: string[] }[];
  readonly currentFirms: FirmId[];
  readonly failedFirms: { firmId: FirmId; error: Error }[];
}

// The fleet rollout (ADR-0065 §5.3): skip current firms, migrate the rest with bounded concurrency,
// quarantine failures (the fleet continues), and report. Idempotent — re-running skips firms that are
// already at the target version, so a partially-failed rollout resumes by re-running.
export async function rolloutMigrationsAcrossFleet(
  options: FleetRolloutOptions,
): Promise<FleetRolloutReport> {
  const { firms, migrations, concurrency = 1 } = options;
  const latestTag = migrations.at(-1)?.tag;
  const report: FleetRolloutReport = { migratedFirms: [], currentFirms: [], failedFirms: [] };

  const pendingFirms = firms.filter((firm) => {
    const current = latestTag !== undefined && firm.schemaVersion === latestTag;
    if (current) report.currentFirms.push(firm.firmId);
    return !current;
  });

  // Bounded worker pool over the pending list: `concurrency` workers each pull the next firm.
  let nextIndex = 0;
  async function migrateNextFirm(): Promise<void> {
    while (nextIndex < pendingFirms.length) {
      const firm = pendingFirms[nextIndex++] as FirmMigrationState;
      try {
        const run = await runPendingMigrations(options.targetForFirm(firm.firmId), migrations);
        if (latestTag !== undefined) {
          await options.recordFirmSchemaVersion(firm.firmId, latestTag);
        }
        report.migratedFirms.push({ firmId: firm.firmId, appliedTags: run.appliedTags });
      } catch (caught) {
        // Failure isolation: quarantine this firm, keep the fleet moving (spec §5.3).
        const error = caught instanceof Error ? caught : new Error(String(caught));
        report.failedFirms.push({ firmId: firm.firmId, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, pendingFirms.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => migrateNextFirm()));
  return report;
}
```

> Note the registry skip-check uses the **mirrored** version (cheap, no firm-DB roundtrip); the runner then re-checks against the firm DB's `_migrations` (the truth) — a stale mirror only costs a no-op run, never a wrong migration.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/fleet-rollout.ts packages/database/test/fleet-rollout.test.ts
git commit -m "feat(database): fleet rollout — bounded fan-out, quarantine, idempotent resume"
```

---

### Task 9: Expand-contract guard (fitness function)

**Files:**

- Test: `packages/database/test/expand-contract.test.ts`

Spec §5.4: a destructive change (DROP TABLE/COLUMN, ADD COLUMN NOT NULL without DEFAULT) must never ship silently — it is a deliberate **contract** step. The guard scans every committed migration statement; a destructive statement is allowed only when the migration file carries an explicit `-- contract:` annotation explaining the contract step.

- [ ] **Step 1: Write the test** (passes today — the initial migrations are purely additive; the inner helper is unit-tested against inline SQL so the destructive detection itself is RED-tested):

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../src/migration.ts";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");
const CONTRACT_MARKER = "-- contract:";

// Destructive patterns per spec §5.4. ADD COLUMN ... NOT NULL is destructive only without a DEFAULT
// (existing rows cannot satisfy it); plain CREATE TABLE ... NOT NULL is fine.
function destructiveReason(statement: string): string | null {
  const sql = statement.toUpperCase();
  if (/\bDROP\s+TABLE\b/.test(sql)) return "DROP TABLE";
  if (/\bDROP\s+COLUMN\b/.test(sql)) return "DROP COLUMN";
  if (
    /\bALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b[\s\S]*\bNOT\s+NULL\b/.test(sql) &&
    !/\bDEFAULT\b/.test(sql)
  ) {
    return "ADD COLUMN NOT NULL without DEFAULT";
  }
  return null;
}

describe("destructiveReason (the detector itself)", () => {
  it("flags the spec's destructive shapes", () => {
    expect(destructiveReason("DROP TABLE outbox;")).toBe("DROP TABLE");
    expect(destructiveReason("ALTER TABLE firm DROP COLUMN name;")).toBe("DROP COLUMN");
    expect(destructiveReason("ALTER TABLE firm ADD COLUMN tier text NOT NULL;")).toBe(
      "ADD COLUMN NOT NULL without DEFAULT",
    );
  });

  it("does not flag additive shapes", () => {
    expect(destructiveReason("CREATE TABLE a (id text NOT NULL);")).toBeNull();
    expect(destructiveReason("ALTER TABLE firm ADD COLUMN tier text;")).toBeNull();
    expect(
      destructiveReason("ALTER TABLE firm ADD COLUMN tier text NOT NULL DEFAULT 'standard';"),
    ).toBeNull();
  });
});

describe("expand-contract guard over the committed migrations (spec §5.4)", () => {
  it("every destructive statement in either lineage carries an explicit -- contract: annotation", async () => {
    const violations: string[] = [];
    for (const lineage of ["control-plane", "per-firm"]) {
      const files = (await readdir(join(DRIZZLE, lineage))).filter((file) => file.endsWith(".sql"));
      for (const file of files) {
        const sql = await readFile(join(DRIZZLE, lineage, file), "utf8");
        const annotated = sql.includes(CONTRACT_MARKER);
        for (const statement of splitSqlStatements(sql)) {
          const reason = destructiveReason(statement);
          if (reason && !annotated) violations.push(`${lineage}/${file}: ${reason}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the suite** — PASS (initial migrations are additive; the detector unit tests prove the guard bites).

- [ ] **Step 3: Commit**

```bash
git add packages/database/test/expand-contract.test.ts
git commit -m "test(database): expand-contract guard — destructive SQL requires a contract annotation"
```

---

### Task 10: Docs, gate, and wrap-up

**Files:**

- Modify: `CHANGELOG.md` (the `[Unreleased]` Added section — new `@magna-carta/database` entry, package 3 of 4)
- Modify: `ROADMAP.md` (slice 0·2 status: database package shipped; data-access remains)
- Modify: `docs/Decision-Log.md` — ADR-0065 note if its status line needs the "implemented (fleet of one)" touch; reference this plan
- Modify: this plan — check off tasks

- [ ] **Step 1: Run the full gate**

Run: `vp test` then `pnpm check`
Expected: all workspace tests pass; gate green.

- [ ] **Step 2: Write the CHANGELOG entry** under `[Unreleased]` → Added, after the identifiers entry: `@magna-carta/database` — two-lineage Drizzle schemas (control-plane firm registry with schema-version mirror; per-firm `idempotency_key` + `outbox`), journal loader, batch-atomic D1 migration runner with `_migrations` tracking and deploy-mismatch fail-loud, fleet rollout orchestrator (bounded fan-out, quarantine, idempotent resume — a fleet of one), expand-contract guard, and schema fitness functions (identifier-handle TEXT PKs; no float money columns; `*_minor`/`*_rate_e4` INTEGER discipline). Note the D1 atomicity fact (batch, not BEGIN) and the stable-drizzle pin rationale.

- [ ] **Step 3: Update ROADMAP.md** slice 0·2 progress (money ✓, identifiers ✓, database ✓, data-access next).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md ROADMAP.md docs/Decision-Log.md docs/specs/2026-06-09-database-package-implementation-plan.md
git commit -m "docs(database): roadmap + changelog for @magna-carta/database"
```

---

## Self-review notes (spec coverage)

- §5.1 tooling (Drizzle source of truth, two lineages): Tasks 2, 3, 5. Drizzle sits under the DAL — no query helpers exported, schemas only.
- §5.2 version tracking (`_migrations` per DB + registry mirror): Tasks 7 (adapter owns `_migrations`) and 2/8 (mirror column + `recordFirmSchemaVersion`).
- §5.3 rollout orchestrator (filter, bounded fan-out, quarantine, idempotent resume, report): Task 8. The Cron-Workflow _wiring_ is `apps/worker` work for a later slice — this package ships the pure orchestration the Workflow will call. Lazy catch-up on connect is a `data-access` concern (the DAL checks version on connect) — the runner it will call is Task 6.
- §5.4 expand-contract: Task 9 (destructive-SQL guard with explicit contract annotation).
- §5.5 safety nets: Time Travel/restore drills are ADR-0050 ops, not package code; load-profile-fixture migration tests arrive with the fixtures harness (its own Phase 0 item).
- §1.5 / §1.1 money-column enforcement and §2 identifier-PK conformance: Task 4 — enumerates all tables automatically so later tables inherit the guards.
- §3.1 / §4.1 table definitions: Task 3, column-for-column.
- §6 fleet test plan (skips current; isolates failing; resumes; provisioning v0→all): Tasks 6 + 8 tests map one-to-one. Expand-contract with old+new code tolerance is exercised when a real contract migration first exists.
- Provisioning (§5.3): the runner's fresh-database case (Task 6 first test); creating the D1 database itself is a Cloudflare API concern for the worker slice.

**Deferred (not gaps):** Cron-Workflow + Queues wiring (`apps/worker`); lazy catch-up middleware (`data-access`); real-D1 end-to-end migration test (worker integration slice, Miniflare); the migration-concurrency-bound production number (spec §8 — arrives when the fleet is more than one).
