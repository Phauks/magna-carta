# Slice 0·3 — Ledger Core + Fixtures Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the append-only double-entry ledger (`@magna-carta/ledger`, four new per-firm tables) and the deterministic fixtures harness (`@magna-carta/fixtures`) per the approved spec [`2026-06-09-ledger-core-and-fixtures-design.md`](2026-06-09-ledger-core-and-fixtures-design.md) (ADR-0072).

**Architecture:** Schema lands in `@magna-carta/database`'s per-firm lineage (Drizzle + a generated migration). `@magna-carta/ledger` — the first domain package — validates in memory and composes statements into the slice 0·2 `composeEffectBatch` chokepoint; one atomic `batch()` carries `[idempotency record?, entry, lines, balance updates, outbox row]`, and a violated `account_balance` CHECK aborts the whole transaction (the D1 batch-abort mechanism). `@magna-carta/fixtures` drives the real domain write paths from one seed (seeded faker + fixed clock + seeded identifiers).

**Tech Stack:** TypeScript, Drizzle (pinned orm 0.45.2 / kit 0.31.10), Vitest via `vp`, `node:sqlite` for real-SQL tests, `@faker-js/faker` (new catalog entry), the existing `@magna-carta/{money,identifiers,database,data-access}` packages.

---

## Decided up front (read before coding)

1. **Line encoding** is `direction TEXT ('debit'|'credit')` + `amount_minor INTEGER CHECK (> 0)`. Balances are stored in **normal-balance terms** (positive = normal). Normal balance: asset/expense → debit; liability/equity/income → credit. Derived in code, never a column.
2. **Balance math inside validation/composition uses plain integer arithmetic on minor units** (`toMinor` values). Rationale: the sum-to-zero check needs signed nets across directions, and `sum()` from the money package cannot mean anything on an empty side; minor units are exact safe integers, and no rounding is involved, so ADR-0061 is respected. `Money` remains the only type accepted at the API surface.
3. **`ClockPort`** is `{ now(): string; today(): string }` — `now()` an ISO-8601 UTC instant, `today()` a `YYYY-MM-DD` civil date. Production wiring supplies the real clock later (apps/worker); fixtures supply the fixed clock. The ledger package never reads wall-clock time.
4. **Outbox topic** is `ledger.entry.posted` with payload `{ entryId }` (plus `reversesEntryId` when set) — ids only (ADR-0038). `aggregateKey` is the constant `"ledger"`: one ordered sequence per firm, cheap at per-firm scale, gives consumers total order.
5. **Known determinism caveat:** `insertOutboxMessageStatement` mints its `obx_` id with the CSPRNG internally — outbox row ids are NOT seeded. The fixtures determinism test compares the four ledger tables fully and the outbox rows **excluding `id`**. Documented as a seam; acceptable because the outbox is dispatch state, not domain data.
6. **The node:sqlite D1-shaped adapter lives in `@magna-carta/database`** (`./node-sqlite` export): it sits beside `d1-migration-target.ts` as "adapt a database to the runner/batch shape", and both `ledger` (tests) and `fixtures` (runtime local seeding) consume it without a package cycle. Node-only, dev/test-only — never imported by Worker code.
7. **`reverseEntry` re-validates via `validateEntry`**, so today it would refuse lines on an inactive account. No closing service exists yet so the state is unreachable; when account closing is built, revisit whether reversals bypass the `active` check (corrections must always be possible). Code comment marks this.
8. **Commits** are per-task, conventional style (`feat(ledger): …`, `feat(fixtures): …`, `feat(database): …`, `docs: …`), ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer used throughout this repo.
9. **Run tests per package:** `pnpm --filter @magna-carta/<package> test`. Full gate at the end: `pnpm check` from the repo root.
10. **drizzle-kit and CHECK constraints:** orm 0.45.2 / kit 0.31.10 support `check()` (added in kit 0.27). Task 3 verifies the generated SQL actually contains the CHECKs; if any are missing, STOP and fix the schema definition (do not hand-edit the snapshot) — hand-editing only the `.sql` file would desync drizzle's snapshot and corrupt the next `generate`.

## File structure

```
packages/identifiers/src/registry.ts            MODIFY  + ledgerAccount/ledgerLine prefixes
packages/identifiers/src/types.ts               MODIFY  + LedgerAccountId/LedgerLineId aliases
packages/identifiers/test/ledger-prefixes.test.ts CREATE
packages/money/src/format.ts                    MODIFY  + currencyCode()
packages/money/test/currency-code.test.ts       CREATE
packages/database/src/per-firm-schema.ts        MODIFY  + 4 ledger tables
packages/database/src/node-sqlite.ts            CREATE  D1-shaped adapter + disk migration loader
packages/database/test/ledger-schema.test.ts    CREATE
packages/database/test/node-sqlite.test.ts      CREATE
packages/database/test/generated-migrations.test.ts MODIFY + ledger assertions
packages/database/drizzle/per-firm/0001_ledger-core.sql  GENERATED (committed)
packages/ledger/                                CREATE  package (src: types, normal-balance, validate,
                                                statements, post-entry, create-account, reverse-entry,
                                                fitness; test/*; CLAUDE.md)
packages/fixtures/                              CREATE  package (src: context, local-database, guard,
                                                demo-chart-of-accounts, factories, scenarios, demo-firm;
                                                test/*; CLAUDE.md)
pnpm-workspace.yaml                             MODIFY  + @faker-js/faker catalog pin
docs/conventions/invariants.md                  MODIFY  + ledger-core invariants
ROADMAP.md / CHANGELOG.md                       MODIFY  same-commit docs
```

---

### Task 1: Identifier prefixes + money `currencyCode` (preludes in existing packages)

**Files:**

- Modify: `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`
- Create: `packages/identifiers/test/ledger-prefixes.test.ts`
- Modify: `packages/money/src/format.ts`
- Create: `packages/money/test/currency-code.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/identifiers/test/ledger-prefixes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES } from "../src/registry.ts";
import type { LedgerAccountId, LedgerLineId } from "../src/types.ts";

describe("ledger identifier prefixes (slice 0·3, ADR-0072)", () => {
  it("registers acct and lln prefixes", () => {
    expect(ENTITY_PREFIXES.ledgerAccount).toBe("acct");
    expect(ENTITY_PREFIXES.ledgerLine).toBe("lln");
  });

  it("mints handles with the new prefixes and the branded aliases compile", () => {
    const accountId: LedgerAccountId = newIdentifier("ledgerAccount");
    const lineId: LedgerLineId = newIdentifier("ledgerLine");
    expect(accountId).toMatch(/^acct_[A-Za-z0-9_-]{21}$/);
    expect(lineId).toMatch(/^lln_[A-Za-z0-9_-]{21}$/);
  });
});
```

`packages/money/test/currency-code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currencyCode } from "../src/format.ts";
import { money, USD, EUR } from "../src/money.ts";

describe("currencyCode (ledger validation boundary)", () => {
  it("returns the ISO-4217 code of a Money", () => {
    expect(currencyCode(money(500000, USD))).toBe("USD");
    expect(currencyCode(money(1, EUR))).toBe("EUR");
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `pnpm --filter @magna-carta/identifiers test` and `pnpm --filter @magna-carta/money test`
Expected: FAIL — `ledgerAccount` not in `ENTITY_PREFIXES`; `currencyCode` not exported.

- [ ] **Step 3: Implement**

In `registry.ts`, add to `ENTITY_PREFIXES` (after `ledgerEntry: "led",`):

```ts
  ledgerAccount: "acct",
  ledgerLine: "lln",
```

In `types.ts`, add after `LedgerEntryId`:

```ts
export type LedgerAccountId = Identifier<"ledgerAccount">;
export type LedgerLineId = Identifier<"ledgerLine">;
```

In `packages/money/src/format.ts`, add:

```ts
// Ledger/validation boundary: the ISO-4217 code a Money is tagged with (ADR-0061 — every value
// carries its currency). Read-only; constructing Money with a currency stays money()'s job.
export function currencyCode(value: Money): string {
  return snapshot(value).currency.code;
}
```

- [ ] **Step 4: Run tests to verify both packages pass** (same commands; expected: PASS, all suites green)

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers packages/money
git commit -m "feat(identifiers,money): ledger prefixes acct/lln + currencyCode accessor (ADR-0072)"
```

---

### Task 2: Per-firm schema — the four ledger tables

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts`
- Create: `packages/database/test/ledger-schema.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/database/test/ledger-schema.test.ts`:

```ts
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { accountBalance, ledgerAccount, ledgerEntry, ledgerLine } from "../src/per-firm-schema.ts";

describe("ledger tables (ADR-0072)", () => {
  it("ledger_account: TEXT handle PK, type enum, parent seam, active flag", () => {
    const config = getTableConfig(ledgerAccount);
    expect(config.name).toBe("ledger_account");
    const columns = Object.fromEntries(config.columns.map((column) => [column.name, column]));
    expect(columns["id"]?.primary).toBe(true);
    expect(columns["parent_account_id"]?.notNull).toBe(false);
    expect(columns["active"]?.notNull).toBe(true);
  });

  it("ledger_entry: dual dates, UNIQUE reverses_entry_id, non-empty description CHECK", () => {
    const config = getTableConfig(ledgerEntry);
    expect(config.name).toBe("ledger_entry");
    const columnNames = config.columns.map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining(["effective_date", "recorded_at", "reverses_entry_id"]),
    );
    expect(
      config.uniqueConstraints.length + config.indexes.filter((i) => i.config.unique).length,
    ).toBeGreaterThanOrEqual(1);
    expect(config.checks.map((check) => check.name)).toContain(
      "ledger_entry_description_nonempty_check",
    );
  });

  it("ledger_line: direction + positive amount CHECK, UNIQUE(entry_id, line_index)", () => {
    const config = getTableConfig(ledgerLine);
    expect(config.name).toBe("ledger_line");
    expect(config.checks.map((check) => check.name)).toContain(
      "ledger_line_amount_minor_positive_check",
    );
  });

  it("account_balance: bounds CHECK present (the D1 batch-abort mechanism)", () => {
    const config = getTableConfig(accountBalance);
    expect(config.name).toBe("account_balance");
    expect(config.checks.map((check) => check.name)).toContain("account_balance_bounds_check");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @magna-carta/database test` → FAIL (tables not exported).

- [ ] **Step 3: Implement the tables**

In `per-firm-schema.ts`, extend the imports and append the tables:

```ts
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  IdempotencyRecordId,
  LedgerAccountId,
  LedgerEntryId,
  LedgerLineId,
  OutboxId,
} from "@magna-carta/identifiers/types";
```

```ts
// Append-only double-entry ledger (ADR-0008, posting model ADR-0072). Structure only — the posting
// service, validation, and balance composition live in @magna-carta/ledger.

// The structural account model — no chart-of-accounts product (Phase 3 adds it on this schema).
// Normal balance is DERIVED IN CODE from `type` (asset/expense = debit-normal), never a column.
export const ledgerAccount = sqliteTable(
  "ledger_account",
  {
    id: text("id").primaryKey().$type<LedgerAccountId>(), // acct_ handle
    name: text("name").notNull(),
    type: text("type", {
      enum: ["asset", "liability", "equity", "income", "expense"],
    }).notNull(),
    currency: text("currency").notNull(), // ISO-4217; always USD now; lines inherit (ADR-0061)
    parentAccountId: text("parent_account_id")
      .$type<LedgerAccountId>()
      .references((): AnySQLiteColumn => ledgerAccount.id), // subledger seam; children share type+currency
    active: integer("active").notNull().default(1), // soft close — accounts are never deleted
    createdAt: text("created_at").notNull(), // UTC instant (ADR-0055)
  },
  (table) => [
    index("ledger_account_parent_account_id_index").on(table.parentAccountId),
    check("ledger_account_name_nonempty_check", sql`length(${table.name}) > 0`),
  ],
);

// The transaction header. APPEND-ONLY: no UPDATE/DELETE ever targets this table; reversed status is
// derived from the reverses link, never a mutated flag.
export const ledgerEntry = sqliteTable(
  "ledger_entry",
  {
    id: text("id").primaryKey().$type<LedgerEntryId>(), // led_ handle
    description: text("description").notNull(),
    effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD civil date — backdatable bookkeeping fact
    recordedAt: text("recorded_at").notNull(), // UTC instant — system-set, immutable audit truth
    reversesEntryId: text("reverses_entry_id")
      .$type<LedgerEntryId>()
      .references((): AnySQLiteColumn => ledgerEntry.id),
  },
  (table) => [
    // UNIQUE makes double-reversal structurally impossible — a racing duplicate's batch rolls back.
    // SQLite UNIQUE permits many NULLs, so unreversed entries are unaffected.
    uniqueIndex("ledger_entry_reverses_entry_id_unique_index").on(table.reversesEntryId),
    index("ledger_entry_effective_date_index").on(table.effectiveDate),
    check("ledger_entry_description_nonempty_check", sql`length(${table.description}) > 0`),
  ],
);

// The money. Direction is DATA + amounts are always positive: a sign-flip cannot be expressed
// (ADR-0072 — the line-encoding decision). Currency is inherited from the account.
export const ledgerLine = sqliteTable(
  "ledger_line",
  {
    id: text("id").primaryKey().$type<LedgerLineId>(), // lln_ handle
    entryId: text("entry_id")
      .notNull()
      .$type<LedgerEntryId>()
      .references(() => ledgerEntry.id),
    accountId: text("account_id")
      .notNull()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    lineIndex: integer("line_index").notNull(), // stable display/export order
    direction: text("direction", { enum: ["debit", "credit"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(), // 2dp minor units (ADR-0061)
  },
  (table) => [
    uniqueIndex("ledger_line_entry_id_line_index_unique_index").on(table.entryId, table.lineIndex),
    index("ledger_line_account_id_index").on(table.accountId),
    check("ledger_line_amount_minor_positive_check", sql`${table.amountMinor} > 0`),
  ],
);

// Materialized balance in NORMAL-BALANCE terms (positive = normal), one row per account, created in
// the same batch as the account. The CHECK is the enforcement mechanism: a bounds violation inside a
// posting batch aborts the WHOLE transaction — D1's only batch-abort primitive (ADR-0072/ADR-0009).
export const accountBalance = sqliteTable(
  "account_balance",
  {
    accountId: text("account_id")
      .primaryKey()
      .$type<LedgerAccountId>()
      .references(() => ledgerAccount.id),
    balanceMinor: integer("balance_minor").notNull().default(0),
    minBalanceMinor: integer("min_balance_minor"), // NULL = unbounded; trust sets 0 in Phase 3
    maxBalanceMinor: integer("max_balance_minor"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "account_balance_bounds_check",
      sql`(${table.minBalanceMinor} IS NULL OR ${table.balanceMinor} >= ${table.minBalanceMinor}) AND (${table.maxBalanceMinor} IS NULL OR ${table.balanceMinor} <= ${table.maxBalanceMinor})`,
    ),
  ],
);
```

- [ ] **Step 4: Run tests** — `pnpm --filter @magna-carta/database test` → ledger-schema PASSES. Also check `schema-conformance.test.ts` output: if it enumerates tables explicitly, add the four new tables to its list; if it introspects exports, it picks them up automatically. All green either way.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat(database): ledger_account/ledger_entry/ledger_line/account_balance per-firm tables (ADR-0072)"
```

---

### Task 3: Generate + verify migration `0001_ledger-core`

**Files:**

- Generated: `packages/database/drizzle/per-firm/0001_ledger-core.sql` + updated `meta/`
- Modify: `packages/database/test/generated-migrations.test.ts`

- [ ] **Step 1: Extend the failing migration test** — in the per-firm test of `generated-migrations.test.ts`, append:

```ts
expect(allSql).toContain("ledger_account");
expect(allSql).toContain("ledger_entry");
expect(allSql).toContain("ledger_line");
expect(allSql).toContain("account_balance");
// The CHECKs are the point — bounds enforcement and positive amounts must exist in the DDL.
expect(allSql).toContain("account_balance_bounds_check");
expect(allSql).toContain("ledger_line_amount_minor_positive_check");
```

Run: `pnpm --filter @magna-carta/database test` → FAIL (no migration yet).

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-per-firm.config.ts --name=ledger-core
```

Expected: a new `drizzle/per-firm/0001_ledger-core.sql` + journal entry. **Inspect the SQL**: four `CREATE TABLE`s, the two UNIQUE indexes, the three CHECK constraints, the FK clauses. If a CHECK is missing, fix the schema definition and regenerate (delete the bad migration + its journal entry first) — never hand-edit only the SQL (snapshot desync).

- [ ] **Step 3: Run all database tests** — `pnpm --filter @magna-carta/database test` → PASS (incl. the expand-contract guard: this migration is purely additive).

- [ ] **Step 4: Commit**

```bash
git add packages/database/drizzle packages/database/test
git commit -m "feat(database): generated per-firm migration 0001_ledger-core"
```

---

### Task 4: `@magna-carta/database` node:sqlite adapter (`./node-sqlite`)

**Files:**

- Create: `packages/database/src/node-sqlite.ts`
- Create: `packages/database/test/node-sqlite.test.ts`
- Modify: `packages/database/package.json` (exports map)

- [ ] **Step 1: Write the failing test**

```ts
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "../src/node-sqlite.ts";

function freshPerFirmDatabase() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return raw;
}

describe("node:sqlite D1-shaped adapter (dev/test only)", () => {
  it("applies the committed per-firm migrations — ledger tables exist", () => {
    const raw = freshPerFirmDatabase();
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((table) => table.name);
    for (const expected of [
      "account_balance",
      "idempotency_key",
      "ledger_account",
      "ledger_entry",
      "ledger_line",
      "outbox",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("prepare/bind/run/all round-trips and batch() is atomic (all-or-nothing)", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const goodInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("acct_aaaaaaaaaaaaaaaaaaaaa", "Operating Bank", "2026-01-05T09:00:00.000Z");
    // Second statement violates the name CHECK — the whole batch must roll back.
    const badInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("acct_bbbbbbbbbbbbbbbbbbbbb", "", "2026-01-05T09:00:00.000Z");
    await expect(database.batch([goodInsert, badInsert])).rejects.toThrow(/CHECK/);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account")
      .bind()
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0); // nothing committed
  });
});
```

Run: `pnpm --filter @magna-carta/database test` → FAIL (module missing).

- [ ] **Step 2: Implement `src/node-sqlite.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { migrationsFromJournal, type Migration, type MigrationJournal } from "./migration.ts";

// DEV/TEST ONLY — node-only. A D1-shaped adapter over node:sqlite so the data-access batch write
// path (composeEffectBatch / commitEffectBatch) runs against real SQLite in plain Vitest and in the
// fixtures harness. Never import from Worker code: Workers have no node:sqlite and no filesystem.
// Sits beside d1-migration-target.ts as "adapt a database to the shared shape".

export interface NodeSqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): NodeSqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface NodeBatchDatabase {
  prepare(sql: string): NodeSqlStatement;
  batch(statements: NodeSqlStatement[]): Promise<unknown>;
}

export function nodeSqliteBatchDatabase(database: DatabaseSync): NodeBatchDatabase {
  function makeStatement(sql: string, bindings: readonly unknown[]): NodeSqlStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: () => {
        const result = database.prepare(sql).run(...(bindings as SQLInputValue[]));
        return Promise.resolve({ meta: { changes: Number(result.changes) } });
      },
      all: <T>() => {
        const results = database.prepare(sql).all(...(bindings as SQLInputValue[])) as T[];
        return Promise.resolve({ results });
      },
    };
  }
  return {
    prepare: (sql: string) => makeStatement(sql, []),
    batch: (statements: NodeSqlStatement[]) => {
      // D1 batch semantics: one transaction, all-or-nothing, statements run in order.
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...(statement.bindings as SQLInputValue[]));
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
      return Promise.resolve(statements.map(() => ({ success: true })));
    },
  };
}

// Load the committed migration artifacts from this package's drizzle/ directory (filesystem — hence
// node-only; the Worker path imports SQL as ?raw text instead, see migration.ts).
export function loadMigrationsFromDisk(lineage: "control-plane" | "per-firm"): Migration[] {
  const root = join(import.meta.dirname, "..", "drizzle", lineage);
  const journal = JSON.parse(
    readFileSync(join(root, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlByTag: Record<string, string> = {};
  for (const entry of journal.entries) {
    sqlByTag[entry.tag] = readFileSync(join(root, `${entry.tag}.sql`), "utf8");
  }
  return migrationsFromJournal(journal, sqlByTag);
}

export function applyMigrations(database: DatabaseSync, migrations: readonly Migration[]): void {
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      database.exec(statement);
    }
  }
}
```

Add to `packages/database/package.json` exports: `"./node-sqlite": "./src/node-sqlite.ts"`.

- [ ] **Step 3: Run tests** — `pnpm --filter @magna-carta/database test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/database
git commit -m "feat(database): node:sqlite D1-shaped batch adapter + disk migration loader (dev/test)"
```

---

### Task 5: Scaffold `@magna-carta/ledger`

**Files:**

- Create: `packages/ledger/package.json`, `packages/ledger/tsconfig.json`, `packages/ledger/vitest.config.ts`, `packages/ledger/CLAUDE.md`

- [ ] **Step 1: Create the package files**

`packages/ledger/package.json`:

```json
{
  "name": "@magna-carta/ledger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./normal-balance": "./src/normal-balance.ts",
    "./validate": "./src/validate.ts",
    "./statements": "./src/statements.ts",
    "./post-entry": "./src/post-entry.ts",
    "./create-account": "./src/create-account.ts",
    "./reverse-entry": "./src/reverse-entry.ts",
    "./fitness": "./src/fitness.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/database": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/money": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "drizzle-orm": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/ledger/tsconfig.json` — copy `packages/data-access/tsconfig.json` verbatim.

`packages/ledger/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

`packages/ledger/CLAUDE.md` (from the area template, with the binding invariants):

```markdown
# @magna-carta/ledger — area rules

The append-only double-entry ledger domain module (ADR-0008, ADR-0072; spec
`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`). The first domain package: it validates
in memory and composes statements into @magna-carta/data-access's `composeEffectBatch` — it never
runs logic mid-transaction (D1 has no interactive transactions) and never calls external services.

## Invariants that bind here

- **Append-only.** No UPDATE/DELETE ever targets `ledger_entry` or `ledger_line`. Corrections are
  new reversing entries via `reverseEntry` (`reverses_entry_id`, UNIQUE). The sanctioned UPDATEs are
  `account_balance` (in-batch delta) and, later, `ledger_account.active` (soft close).
- **Balanced entries.** ≥ 2 lines, one currency, debits = credits — enforced in `validate.ts` before
  composition and re-provable by `fitness.ts`.
- **Positive amounts + direction as data.** Never re-introduce signed amounts; the schema CHECK and
  the `Direction` type are the sign-flip defense.
- **Balances in normal-balance terms.** `normal-balance.ts` is the only home of the derivation.
- **Money discipline (ADR-0061).** `Money` in, `toMinor` integers at the statement boundary; no
  floats, no rounding here (the ledger stores what it is given).
- **Clock injection.** No wall-clock reads — `ClockPort` only (`recorded_at`, future-dating check).
```

- [ ] **Step 2: Install + verify the workspace links** — Run: `vp install`. Expected: lockfile updates, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ledger pnpm-lock.yaml
git commit -m "feat(ledger): scaffold @magna-carta/ledger domain package"
```

---

### Task 6: Domain types + normal-balance derivation

**Files:**

- Create: `packages/ledger/src/types.ts`, `packages/ledger/src/normal-balance.ts`
- Test: `packages/ledger/test/normal-balance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { balanceDelta, normalBalanceFor } from "../src/normal-balance.ts";

describe("normal balance derivation (the only home of the rule)", () => {
  it("asset/expense are debit-normal; liability/equity/income are credit-normal", () => {
    expect(normalBalanceFor("asset")).toBe("debit");
    expect(normalBalanceFor("expense")).toBe("debit");
    expect(normalBalanceFor("liability")).toBe("credit");
    expect(normalBalanceFor("equity")).toBe("credit");
    expect(normalBalanceFor("income")).toBe("credit");
  });

  it("balanceDelta is +amount when direction matches normal balance, else -amount", () => {
    expect(balanceDelta("asset", "debit", 500000)).toBe(500000); // debit a bank account: grows
    expect(balanceDelta("asset", "credit", 500000)).toBe(-500000);
    expect(balanceDelta("liability", "credit", 500000)).toBe(500000); // credit trust liability: grows
    expect(balanceDelta("liability", "debit", 500000)).toBe(-500000);
  });
});
```

Run: `pnpm --filter @magna-carta/ledger test` → FAIL.

- [ ] **Step 2: Implement**

`src/types.ts`:

```ts
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import type { Money } from "@magna-carta/money/money";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type Direction = "debit" | "credit";

export interface EntryLineInput {
  readonly accountId: LedgerAccountId;
  readonly direction: Direction;
  readonly amount: Money;
}

export interface PostEntryInput {
  readonly description: string;
  readonly effectiveDate: string; // YYYY-MM-DD civil date (ADR-0055)
  readonly lines: readonly EntryLineInput[];
}

// Injected time — the ledger never reads wall-clock. now() is an ISO-8601 UTC instant; today() is
// the caller's resolved civil date (zone resolution is a boundary concern, ADR-0055/ADR-0072).
export interface ClockPort {
  now(): string;
  today(): string;
}

// What validation needs to know about an account, loaded pre-batch (ADR-0063 pre-check pattern).
export interface AccountSnapshot {
  readonly id: LedgerAccountId;
  readonly type: AccountType;
  readonly currency: string;
  readonly active: boolean;
  readonly hasChildren: boolean; // postings land on leaves only — parents are roll-ups
  readonly hasBalanceRow: boolean; // a missing balance row is corruption, surfaced loud pre-batch
}
```

`src/normal-balance.ts`:

```ts
import type { AccountType, Direction } from "./types.ts";

// THE home of the normal-balance rule (ADR-0072): derived in code, never a column.
export function normalBalanceFor(type: AccountType): Direction {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

// One line's contribution to its account's materialized balance, in normal-balance terms
// (positive = normal): +amount when the line direction matches the account's normal balance.
export function balanceDelta(type: AccountType, direction: Direction, amountMinor: number): number {
  return direction === normalBalanceFor(type) ? amountMinor : -amountMinor;
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): domain types + normal-balance derivation"
```

---

### Task 7: Entry validation (`validate.ts`)

**Files:**

- Create: `packages/ledger/src/validate.ts`
- Test: `packages/ledger/test/validate.test.ts`

- [ ] **Step 1: Write the failing tests** — one accept case + one test per rejection code:

```ts
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { money, USD, EUR } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import type { AccountSnapshot, PostEntryInput } from "../src/types.ts";
import { LedgerValidationError, validateEntry } from "../src/validate.ts";

const TODAY = "2026-06-09";

function account(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    id: newIdentifier("ledgerAccount"),
    type: "asset",
    currency: "USD",
    active: true,
    hasChildren: false,
    hasBalanceRow: true,
    ...overrides,
  };
}

function snapshotMap(...accounts: AccountSnapshot[]): ReadonlyMap<string, AccountSnapshot> {
  return new Map(accounts.map((snapshot) => [snapshot.id, snapshot]));
}

function balancedInput(a: AccountSnapshot, b: AccountSnapshot): PostEntryInput {
  return {
    description: "Retainer deposit",
    effectiveDate: "2026-06-01",
    lines: [
      { accountId: a.id, direction: "debit", amount: money(500000, USD) },
      { accountId: b.id, direction: "credit", amount: money(500000, USD) },
    ],
  };
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof LedgerValidationError) return error.code;
    throw error;
  }
  throw new Error("expected validateEntry to throw");
}

describe("validateEntry — the ledger invariants (ADR-0072 §3.3)", () => {
  it("accepts a balanced two-line single-currency entry on active leaf accounts", () => {
    const a = account();
    const b = account({ type: "liability" });
    expect(() => validateEntry(balancedInput(a, b), snapshotMap(a, b), TODAY)).not.toThrow();
  });

  it("rejects every invariant violation with its named code", () => {
    const a = account();
    const b = account({ type: "liability" });

    const oneLine = { ...balancedInput(a, b), lines: balancedInput(a, b).lines.slice(0, 1) };
    expect(codeOf(() => validateEntry(oneLine, snapshotMap(a, b), TODAY))).toBe("too-few-lines");

    const blank = { ...balancedInput(a, b), description: "   " };
    expect(codeOf(() => validateEntry(blank, snapshotMap(a, b), TODAY))).toBe("empty-description");

    const badDate = { ...balancedInput(a, b), effectiveDate: "2026-02-30" };
    expect(codeOf(() => validateEntry(badDate, snapshotMap(a, b), TODAY))).toBe(
      "invalid-effective-date",
    );

    const future = { ...balancedInput(a, b), effectiveDate: "2026-06-10" };
    expect(codeOf(() => validateEntry(future, snapshotMap(a, b), TODAY))).toBe(
      "future-effective-date",
    );

    const zeroAmount = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(0, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(0, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(zeroAmount, snapshotMap(a, b), TODAY))).toBe(
      "non-positive-amount",
    );

    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a), TODAY))).toBe(
      "unknown-account",
    );

    const inactive = account({ id: b.id, type: "liability", active: false });
    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, inactive), TODAY))).toBe(
      "inactive-account",
    );

    const parent = account({ id: b.id, type: "liability", hasChildren: true });
    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, parent), TODAY))).toBe(
      "non-leaf-account",
    );

    const noBalanceRow = account({ id: b.id, type: "liability", hasBalanceRow: false });
    expect(
      codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, noBalanceRow), TODAY)),
    ).toBe("missing-balance-row");

    const euroLine = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(500000, EUR) },
        { accountId: b.id, direction: "credit" as const, amount: money(500000, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(euroLine, snapshotMap(a, b), TODAY))).toBe(
      "currency-mismatch",
    );

    const lopsided = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(500000, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(499999, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(lopsided, snapshotMap(a, b), TODAY))).toBe("unbalanced");
  });

  it("backdating is allowed (effective date in the past)", () => {
    const a = account();
    const b = account({ type: "liability" });
    const backdated = { ...balancedInput(a, b), effectiveDate: "2024-01-15" };
    expect(() => validateEntry(backdated, snapshotMap(a, b), TODAY)).not.toThrow();
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `src/validate.ts`**

```ts
import { isPositive } from "@magna-carta/money/compare";
import { currencyCode, toMinor } from "@magna-carta/money/format";
import type { AccountSnapshot, PostEntryInput } from "./types.ts";

// Every refusal carries a stable machine-readable code: callers (API layer, fixtures assertions)
// branch on codes, never on message text. Codes for account creation and reversal live here too —
// one error type for the whole domain module.
export type LedgerValidationCode =
  | "too-few-lines"
  | "empty-description"
  | "invalid-effective-date"
  | "future-effective-date"
  | "non-positive-amount"
  | "unknown-account"
  | "inactive-account"
  | "non-leaf-account"
  | "missing-balance-row"
  | "currency-mismatch"
  | "unbalanced"
  | "empty-account-name"
  | "unknown-parent-account"
  | "parent-mismatch"
  | "unknown-entry"
  | "already-reversed";

export class LedgerValidationError extends Error {
  constructor(
    readonly code: LedgerValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real ISO calendar date — the round-trip catches rollovers like 2026-02-30 without a Temporal
// dependency (UTC parse, so no zone can shift the date).
export function isValidCalendarDate(date: string): boolean {
  if (!ISO_CALENDAR_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// The ledger invariants (ADR-0072 §3.3) — what makes the ledger a ledger; consumer rules (trust
// bounds values, period close) bind elsewhere. Pure: accounts arrive as pre-loaded snapshots.
export function validateEntry(
  input: PostEntryInput,
  accounts: ReadonlyMap<string, AccountSnapshot>,
  today: string,
): void {
  if (input.lines.length < 2) {
    throw new LedgerValidationError("too-few-lines", "an entry needs at least 2 lines");
  }
  if (input.description.trim().length === 0) {
    throw new LedgerValidationError("empty-description", "an entry needs a description");
  }
  if (!isValidCalendarDate(input.effectiveDate)) {
    throw new LedgerValidationError(
      "invalid-effective-date",
      `not a calendar date (YYYY-MM-DD): ${input.effectiveDate}`,
    );
  }
  // ISO dates compare lexicographically. Backdating is by design; future-dating is not — a ledger
  // records what happened (scheduled transactions are a workflow concern, Phase 3+).
  if (input.effectiveDate > today) {
    throw new LedgerValidationError(
      "future-effective-date",
      `effective date ${input.effectiveDate} is after today (${today})`,
    );
  }

  // Sum-to-zero over signed minor units: integers are exact and the money sum() cannot express an
  // empty side. No rounding occurs — ADR-0061 holds.
  let net = 0;
  let entryCurrency: string | undefined;
  for (const line of input.lines) {
    if (!isPositive(line.amount)) {
      throw new LedgerValidationError("non-positive-amount", "line amounts must be positive");
    }
    const account = accounts.get(line.accountId);
    if (!account) {
      throw new LedgerValidationError("unknown-account", `no such account: ${line.accountId}`);
    }
    if (!account.active) {
      throw new LedgerValidationError("inactive-account", `account is closed: ${account.id}`);
    }
    if (account.hasChildren) {
      throw new LedgerValidationError(
        "non-leaf-account",
        `postings land on leaf accounts; ${account.id} has children (parents are roll-ups)`,
      );
    }
    if (!account.hasBalanceRow) {
      throw new LedgerValidationError(
        "missing-balance-row",
        `account ${account.id} has no balance row — corruption, refusing to post`,
      );
    }
    const lineCurrency = currencyCode(line.amount);
    if (lineCurrency !== account.currency) {
      throw new LedgerValidationError(
        "currency-mismatch",
        `line currency ${lineCurrency} != account currency ${account.currency}`,
      );
    }
    entryCurrency ??= lineCurrency;
    if (lineCurrency !== entryCurrency) {
      throw new LedgerValidationError("currency-mismatch", "all lines must share one currency");
    }
    const minor = toMinor(line.amount);
    net += line.direction === "debit" ? minor : -minor;
  }
  if (net !== 0) {
    throw new LedgerValidationError("unbalanced", `entry does not balance (net ${net} minor)`);
  }
}
```

(Verify `isPositive` is exported from `@magna-carta/money/compare`; it is listed in the slice 0·2 changelog. If the name differs, match the actual export.)

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): entry validation — the ledger invariants with named codes"
```

---

### Task 8: Statement builders (`statements.ts`)

**Files:**

- Create: `packages/ledger/src/statements.ts`
- Test: `packages/ledger/test/statements.test.ts`

- [ ] **Step 1: Write the failing test** — run the real SQL against the real schema via the Task 4 adapter:

```ts
import { DatabaseSync } from "node:sqlite";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import {
  applyBalanceDeltaStatement,
  insertAccountStatement,
  insertBalanceRowStatement,
  selectAccountSnapshotsStatement,
  setAccountBoundsStatement,
} from "../src/statements.ts";

const NOW = "2026-01-05T09:00:00.000Z";

function freshDatabase() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return nodeSqliteBatchDatabase(raw);
}

describe("ledger statement builders against the real schema", () => {
  it("insert account + balance row, then snapshot query reports leaf/active/balance-row", async () => {
    const database = freshDatabase();
    const parentId = newIdentifier("ledgerAccount");
    const childId = newIdentifier("ledgerAccount");
    await database.batch([
      insertAccountStatement(database, {
        id: parentId,
        name: "Client Trust Liability",
        type: "liability",
        currency: "USD",
        parentAccountId: null,
        createdAt: NOW,
      }),
      insertBalanceRowStatement(database, parentId, NOW),
      insertAccountStatement(database, {
        id: childId,
        name: "Dana Smith",
        type: "liability",
        currency: "USD",
        parentAccountId: parentId,
        createdAt: NOW,
      }),
      insertBalanceRowStatement(database, childId, NOW),
    ]);
    const { results } = await selectAccountSnapshotsStatement(database, [parentId, childId]).all<
      Record<string, unknown>
    >();
    const byId = new Map(results.map((row) => [row["id"], row]));
    expect(byId.get(parentId)?.["has_children"]).toBe(1);
    expect(byId.get(childId)?.["has_children"]).toBe(0);
    expect(byId.get(childId)?.["has_balance_row"]).toBe(1);
    expect(byId.get(childId)?.["active"]).toBe(1);
  });

  it("balance delta applies, and the bounds CHECK aborts a violating batch atomically", async () => {
    const database = freshDatabase();
    const accountId = newIdentifier("ledgerAccount");
    await database.batch([
      insertAccountStatement(database, {
        id: accountId,
        name: "Dana Smith",
        type: "liability",
        currency: "USD",
        parentAccountId: null,
        createdAt: NOW,
      }),
      insertBalanceRowStatement(database, accountId, NOW),
    ]);
    await database.batch([applyBalanceDeltaStatement(database, accountId, 500000, NOW)]);
    await database.batch([setAccountBoundsStatement(database, accountId, 0, null, NOW)]);
    // Overdraw: -600000 takes the balance to -100000 < min 0 → CHECK fires → batch rejected.
    await expect(
      database.batch([applyBalanceDeltaStatement(database, accountId, -600000, NOW)]),
    ).rejects.toThrow(/CHECK|account_balance_bounds_check/);
    const { results } = await database
      .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
      .bind(accountId)
      .all<{ balance_minor: number }>();
    expect(results[0]?.balance_minor).toBe(500000); // untouched — the rollback proof
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/statements.ts`**

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId, LedgerEntryId, LedgerLineId } from "@magna-carta/identifiers/types";
import type { AccountType, Direction } from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const LEDGER_ACCOUNT_TABLE = "ledger_account";
export const LEDGER_ENTRY_TABLE = "ledger_entry";
export const LEDGER_LINE_TABLE = "ledger_line";
export const ACCOUNT_BALANCE_TABLE = "account_balance";

export interface InsertAccountRow {
  readonly id: LedgerAccountId;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly parentAccountId: LedgerAccountId | null;
  readonly createdAt: string;
}

export function insertAccountStatement(database: SqlDatabase, row: InsertAccountRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_ACCOUNT_TABLE} (id, name, type, currency, parent_account_id, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
    )
    .bind(row.id, row.name, row.type, row.currency, row.parentAccountId, row.createdAt);
}

// The balance row is created WITH the account (same batch), unbounded, at zero.
export function insertBalanceRowStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${ACCOUNT_BALANCE_TABLE} (account_id, balance_minor, min_balance_minor, max_balance_minor, updated_at) VALUES (?1, 0, NULL, NULL, ?2)`,
    )
    .bind(accountId, updatedAt);
}

export interface InsertEntryRow {
  readonly id: LedgerEntryId;
  readonly description: string;
  readonly effectiveDate: string;
  readonly recordedAt: string;
  readonly reversesEntryId: LedgerEntryId | null;
}

export function insertEntryStatement(database: SqlDatabase, row: InsertEntryRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_ENTRY_TABLE} (id, description, effective_date, recorded_at, reverses_entry_id) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(row.id, row.description, row.effectiveDate, row.recordedAt, row.reversesEntryId);
}

export interface InsertLineRow {
  readonly id: LedgerLineId;
  readonly entryId: LedgerEntryId;
  readonly accountId: LedgerAccountId;
  readonly lineIndex: number;
  readonly direction: Direction;
  readonly amountMinor: number;
}

export function insertLineStatement(database: SqlDatabase, row: InsertLineRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_LINE_TABLE} (id, entry_id, account_id, line_index, direction, amount_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(row.id, row.entryId, row.accountId, row.lineIndex, row.direction, row.amountMinor);
}

// The in-batch balance write. A bounds violation makes the CHECK fire and the WHOLE batch roll
// back — the enforcement mechanism of ADR-0072/ADR-0009. delta is in normal-balance terms.
export function applyBalanceDeltaStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  deltaMinor: number,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${ACCOUNT_BALANCE_TABLE} SET balance_minor = balance_minor + ?2, updated_at = ?3 WHERE account_id = ?1`,
    )
    .bind(accountId, deltaMinor, updatedAt);
}

// The Phase-3 trust seam primitive (ADR-0009): setting bounds on an account whose current balance
// already violates them fails the CHECK immediately — bounds can never be born violated.
export function setAccountBoundsStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  minBalanceMinor: number | null,
  maxBalanceMinor: number | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${ACCOUNT_BALANCE_TABLE} SET min_balance_minor = ?2, max_balance_minor = ?3, updated_at = ?4 WHERE account_id = ?1`,
    )
    .bind(accountId, minBalanceMinor, maxBalanceMinor, updatedAt);
}

// Pre-batch reads (ADR-0063 pre-check pattern). has_children: parents take no postings.
// has_balance_row: a missing row would make the in-batch UPDATE a silent no-op — refused upstream.
export function selectAccountSnapshotsStatement(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): SqlStatement {
  const placeholders = accountIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT a.id, a.type, a.currency, a.active, EXISTS(SELECT 1 FROM ${LEDGER_ACCOUNT_TABLE} c WHERE c.parent_account_id = a.id) AS has_children, (b.account_id IS NOT NULL) AS has_balance_row FROM ${LEDGER_ACCOUNT_TABLE} a LEFT JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = a.id WHERE a.id IN (${placeholders})`,
    )
    .bind(...accountIds);
}

export function selectEntryStatement(database: SqlDatabase, entryId: LedgerEntryId): SqlStatement {
  return database
    .prepare(
      `SELECT id, description, effective_date, recorded_at, reverses_entry_id FROM ${LEDGER_ENTRY_TABLE} WHERE id = ?1`,
    )
    .bind(entryId);
}

export function selectLinesForEntryStatement(
  database: SqlDatabase,
  entryId: LedgerEntryId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, entry_id, account_id, line_index, direction, amount_minor FROM ${LEDGER_LINE_TABLE} WHERE entry_id = ?1 ORDER BY line_index`,
    )
    .bind(entryId);
}

// Reversed-status is DERIVED from the link (never a flag): an entry is reversed iff some entry names
// it here. The UNIQUE index makes the concurrent double-reversal race lose at commit time.
export function selectReversalOfStatement(
  database: SqlDatabase,
  entryId: LedgerEntryId,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${LEDGER_ENTRY_TABLE} WHERE reverses_entry_id = ?1`)
    .bind(entryId);
}
```

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Add the schema-name-sync test** — `packages/ledger/test/schema-name-sync.test.ts` (mirrors data-access's: pins the SQL strings to the drizzle schema so a rename breaks loudly):

```ts
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  accountBalance,
  ledgerAccount,
  ledgerEntry,
  ledgerLine,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BALANCE_TABLE,
  LEDGER_ACCOUNT_TABLE,
  LEDGER_ENTRY_TABLE,
  LEDGER_LINE_TABLE,
} from "../src/statements.ts";

describe("schema name sync (ledger SQL pinned to @magna-carta/database)", () => {
  it("table names match the drizzle schema", () => {
    expect(getTableConfig(ledgerAccount).name).toBe(LEDGER_ACCOUNT_TABLE);
    expect(getTableConfig(ledgerEntry).name).toBe(LEDGER_ENTRY_TABLE);
    expect(getTableConfig(ledgerLine).name).toBe(LEDGER_LINE_TABLE);
    expect(getTableConfig(accountBalance).name).toBe(ACCOUNT_BALANCE_TABLE);
  });
});
```

Run → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): statement builders + bounds-CHECK batch-abort proven on real SQLite"
```

---

### Task 9: `postEntry`

**Files:**

- Create: `packages/ledger/src/post-entry.ts`
- Test: `packages/ledger/test/post-entry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { postEntry } from "../src/post-entry.ts";
import { insertAccountStatement, insertBalanceRowStatement } from "../src/statements.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = {
  now: () => "2026-06-09T15:00:00.000Z",
  today: () => "2026-06-09",
};

async function setup() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  const database = nodeSqliteBatchDatabase(raw);
  const trustBank = newIdentifier("ledgerAccount");
  const smith = newIdentifier("ledgerAccount");
  await database.batch([
    insertAccountStatement(database, {
      id: trustBank,
      name: "Trust Bank — IOLTA",
      type: "asset",
      currency: "USD",
      parentAccountId: null,
      createdAt: clock.now(),
    }),
    insertBalanceRowStatement(database, trustBank, clock.now()),
    insertAccountStatement(database, {
      id: smith,
      name: "Dana Smith",
      type: "liability",
      currency: "USD",
      parentAccountId: null,
      createdAt: clock.now(),
    }),
    insertBalanceRowStatement(database, smith, clock.now()),
  ]);
  return { database, trustBank, smith };
}

describe("postEntry — the posting write path (ADR-0072)", () => {
  it("commits entry + lines + balance updates + outbox row in one batch", async () => {
    const { database, trustBank, smith } = await setup();
    const { entryId, effect } = await postEntry(
      database,
      {
        description: "Retainer deposit — Dana Smith",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(500000, USD) },
          { accountId: smith, direction: "credit", amount: money(500000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const entry = (
      await database
        .prepare("SELECT * FROM ledger_entry WHERE id = ?1")
        .bind(entryId)
        .all<Record<string, unknown>>()
    ).results[0];
    expect(entry?.["recorded_at"]).toBe("2026-06-09T15:00:00.000Z");
    expect(entry?.["reverses_entry_id"]).toBeNull();

    const lines = (
      await database
        .prepare(
          "SELECT direction, amount_minor, line_index FROM ledger_line WHERE entry_id = ?1 ORDER BY line_index",
        )
        .bind(entryId)
        .all<{ direction: string; amount_minor: number; line_index: number }>()
    ).results;
    expect(lines).toEqual([
      { direction: "debit", amount_minor: 500000, line_index: 0 },
      { direction: "credit", amount_minor: 500000, line_index: 1 },
    ]);

    // Both balances grow by 500000 in normal-balance terms (debit-normal asset debited;
    // credit-normal liability credited).
    const balances = (
      await database
        .prepare("SELECT account_id, balance_minor FROM account_balance ORDER BY account_id")
        .bind()
        .all<{ account_id: string; balance_minor: number }>()
    ).results;
    expect(balances.map((row) => row.balance_minor)).toEqual([500000, 500000]);

    const outbox = (
      await database
        .prepare("SELECT topic, payload, aggregate_key, seq FROM outbox")
        .bind()
        .all<{ topic: string; payload: string; aggregate_key: string; seq: number }>()
    ).results;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.topic).toBe("ledger.entry.posted");
    expect(outbox[0]?.aggregate_key).toBe("ledger");
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({ entryId });
  });

  it("refuses an unbalanced entry before composing anything", async () => {
    const { database, trustBank, smith } = await setup();
    await expect(
      postEntry(
        database,
        {
          description: "Broken",
          effectiveDate: "2026-06-09",
          lines: [
            { accountId: trustBank, direction: "debit", amount: money(100, USD) },
            { accountId: smith, direction: "credit", amount: money(99, USD) },
          ],
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "unbalanced" });
  });

  it("a violated balance bound aborts the WHOLE posting batch (entry, lines, outbox)", async () => {
    const { database, trustBank, smith } = await setup();
    // Fund Smith with 1000, then bound at min 0.
    const funded = await postEntry(
      database,
      {
        description: "Deposit",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: trustBank, direction: "debit", amount: money(1000, USD) },
          { accountId: smith, direction: "credit", amount: money(1000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, funded.effect, { now: clock.now });
    const { setAccountBoundsStatement } = await import("../src/statements.ts");
    await database.batch([setAccountBoundsStatement(database, smith, 0, null, clock.now())]);

    // Overdraw: debit Smith 2000 (liability debited = balance falls to -1000 < 0).
    const overdraw = await postEntry(
      database,
      {
        description: "Disbursement too large",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: smith, direction: "debit", amount: money(2000, USD) },
          { accountId: trustBank, direction: "credit", amount: money(2000, USD) },
        ],
      },
      { clock },
    );
    await expect(
      commitEffectBatch(database, overdraw.effect, { now: clock.now }),
    ).rejects.toThrow();

    // NOTHING from the failed batch landed.
    const entryCount = (
      await database.prepare("SELECT COUNT(*) AS n FROM ledger_entry").bind().all<{ n: number }>()
    ).results[0];
    expect(entryCount?.n).toBe(1);
    const outboxCount = (
      await database.prepare("SELECT COUNT(*) AS n FROM outbox").bind().all<{ n: number }>()
    ).results[0];
    expect(outboxCount?.n).toBe(1);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/post-entry.ts`**

```ts
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { toMinor } from "@magna-carta/money/format";
import { balanceDelta } from "./normal-balance.ts";
import {
  applyBalanceDeltaStatement,
  insertEntryStatement,
  insertLineStatement,
  selectAccountSnapshotsStatement,
} from "./statements.ts";
import type { AccountSnapshot, AccountType, ClockPort, PostEntryInput } from "./types.ts";
import { validateEntry } from "./validate.ts";

export const LEDGER_ENTRY_POSTED_TOPIC = "ledger.entry.posted";
// One ordered outbox sequence per firm — total order for ledger consumers, cheap at per-firm scale.
export const LEDGER_AGGREGATE_KEY = "ledger";

export interface PostEntryOptions {
  readonly clock: ClockPort;
  readonly randomSource?: RandomSource; // fixtures pass the seeded source (ADR-0034)
}

export interface PostedEntry {
  readonly entryId: LedgerEntryId;
  readonly effect: EffectWrite;
}

interface SnapshotRow {
  id: string;
  type: AccountType;
  currency: string;
  active: number;
  has_children: number;
  has_balance_row: number;
}

export async function loadAccountSnapshots(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): Promise<Map<string, AccountSnapshot>> {
  const { results } = await selectAccountSnapshotsStatement(
    database,
    accountIds,
  ).all<SnapshotRow>();
  return new Map(
    results.map((row) => [
      row.id,
      {
        id: row.id as LedgerAccountId,
        type: row.type,
        currency: row.currency,
        active: row.active === 1,
        hasChildren: row.has_children === 1,
        hasBalanceRow: row.has_balance_row === 1,
      },
    ]),
  );
}

// Validate in memory, then COMPOSE statements — no logic runs mid-transaction (D1 single-batch
// reality, ADR-0063/0064 amendments). The caller commits via the data-access chokepoint
// (commitEffectBatch / runIdempotentEffect), which is what makes the write idempotency-capable.
export async function postEntry(
  database: SqlDatabase,
  input: PostEntryInput,
  options: PostEntryOptions,
): Promise<PostedEntry> {
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const accounts = await loadAccountSnapshots(database, accountIds);
  validateEntry(input, accounts, options.clock.today());
  return composePostedEntry(database, input, accounts, options, null);
}

// Shared with reverseEntry (which sets reversesEntryId). Internal on purpose — not exported.
export function composePostedEntry(
  database: SqlDatabase,
  input: PostEntryInput,
  accounts: ReadonlyMap<string, AccountSnapshot>,
  options: PostEntryOptions,
  reversesEntryId: LedgerEntryId | null,
): PostedEntry {
  const recordedAt = options.clock.now();
  const entryId = newIdentifier("ledgerEntry", options.randomSource);

  const statements = [
    insertEntryStatement(database, {
      id: entryId,
      description: input.description,
      effectiveDate: input.effectiveDate,
      recordedAt,
      reversesEntryId,
    }),
    ...input.lines.map((line, lineIndex) =>
      insertLineStatement(database, {
        id: newIdentifier("ledgerLine", options.randomSource),
        entryId,
        accountId: line.accountId,
        lineIndex,
        direction: line.direction,
        amountMinor: toMinor(line.amount),
      }),
    ),
  ];

  // One balance UPDATE per touched account, deltas aggregated in normal-balance terms.
  const deltas = new Map<string, number>();
  for (const line of input.lines) {
    const account = accounts.get(line.accountId);
    if (!account) throw new Error(`unreachable: validated account missing ${line.accountId}`);
    const delta = balanceDelta(account.type, line.direction, toMinor(line.amount));
    deltas.set(line.accountId, (deltas.get(line.accountId) ?? 0) + delta);
  }
  for (const [accountId, delta] of deltas) {
    statements.push(
      applyBalanceDeltaStatement(database, accountId as LedgerAccountId, delta, recordedAt),
    );
  }

  const payload: Record<string, string> = { entryId };
  if (reversesEntryId) payload["reversesEntryId"] = reversesEntryId;
  const outboxMessages: OutboxMessage[] = [
    { topic: LEDGER_ENTRY_POSTED_TOPIC, payload, aggregateKey: LEDGER_AGGREGATE_KEY },
  ];

  return { entryId, effect: { statements, outboxMessages } };
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): postEntry — validate in memory, compose into the atomic batch"
```

---

### Task 10: `createAccount`

**Files:**

- Create: `packages/ledger/src/create-account.ts`
- Test: `packages/ledger/test/create-account.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/create-account.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };

function freshDatabase() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return nodeSqliteBatchDatabase(raw);
}

describe("createAccount", () => {
  it("creates account + zero unbounded balance row in one batch", async () => {
    const database = freshDatabase();
    const { accountId, effect } = await createAccount(
      database,
      { name: "Operating Bank", type: "asset", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    const { results } = await database
      .prepare(
        "SELECT a.active, b.balance_minor, b.min_balance_minor FROM ledger_account a JOIN account_balance b ON b.account_id = a.id WHERE a.id = ?1",
      )
      .bind(accountId)
      .all<{ active: number; balance_minor: number; min_balance_minor: number | null }>();
    expect(results[0]).toEqual({ active: 1, balance_minor: 0, min_balance_minor: null });
  });

  it("child accounts must share the parent's type and currency", async () => {
    const database = freshDatabase();
    const parent = await createAccount(
      database,
      { name: "Client Trust Liability", type: "liability", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, parent.effect, { now: clock.now });
    await expect(
      createAccount(
        database,
        { name: "Dana Smith", type: "asset", currency: "USD", parentAccountId: parent.accountId },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "parent-mismatch" });
    await expect(
      createAccount(
        database,
        {
          name: "Ghost child",
          type: "liability",
          currency: "USD",
          parentAccountId: "acct_doesnotexist000000000" as never,
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "unknown-parent-account" });
  });

  it("refuses an empty name", async () => {
    const database = freshDatabase();
    await expect(
      createAccount(database, { name: "  ", type: "asset", currency: "USD" }, { clock }),
    ).rejects.toMatchObject({ code: "empty-account-name" });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/create-account.ts`**

```ts
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { loadAccountSnapshots } from "./post-entry.ts";
import { insertAccountStatement, insertBalanceRowStatement } from "./statements.ts";
import type { AccountType, ClockPort } from "./types.ts";
import { LedgerValidationError } from "./validate.ts";

export interface CreateAccountInput {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly parentAccountId?: LedgerAccountId;
}

export interface CreatedAccount {
  readonly accountId: LedgerAccountId;
  readonly effect: EffectWrite;
}

// Account + its balance row commit together: postings may assume the row exists (validateEntry
// surfaces a missing one as corruption). No outbox message — account creation has no external
// consequence yet (YAGNI; the seam is one OutboxMessage away).
export async function createAccount(
  database: SqlDatabase,
  input: CreateAccountInput,
  options: { clock: ClockPort; randomSource?: RandomSource },
): Promise<CreatedAccount> {
  if (input.name.trim().length === 0) {
    throw new LedgerValidationError("empty-account-name", "an account needs a name");
  }
  if (input.parentAccountId) {
    const parents = await loadAccountSnapshots(database, [input.parentAccountId]);
    const parent = parents.get(input.parentAccountId);
    if (!parent) {
      throw new LedgerValidationError(
        "unknown-parent-account",
        `no such parent account: ${input.parentAccountId}`,
      );
    }
    if (parent.type !== input.type || parent.currency !== input.currency) {
      throw new LedgerValidationError(
        "parent-mismatch",
        "a child account must share its parent's type and currency",
      );
    }
  }
  const createdAt = options.clock.now();
  const accountId = newIdentifier("ledgerAccount", options.randomSource);
  return {
    accountId,
    effect: {
      statements: [
        insertAccountStatement(database, {
          id: accountId,
          name: input.name,
          type: input.type,
          currency: input.currency,
          parentAccountId: input.parentAccountId ?? null,
          createdAt,
        }),
        insertBalanceRowStatement(database, accountId, createdAt),
      ],
      outboxMessages: [],
    },
  };
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): createAccount — account + balance row in one batch"
```

---

### Task 11: `reverseEntry`

**Files:**

- Create: `packages/ledger/src/reverse-entry.ts`
- Test: `packages/ledger/test/reverse-entry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/create-account.ts";
import { postEntry } from "../src/post-entry.ts";
import { reverseEntry } from "../src/reverse-entry.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };

async function setupWithPostedEntry() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  const database = nodeSqliteBatchDatabase(raw);
  const bank = await createAccount(
    database,
    { name: "Trust Bank", type: "asset", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, bank.effect, { now: clock.now });
  const smith = await createAccount(
    database,
    { name: "Dana Smith", type: "liability", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, smith.effect, { now: clock.now });
  const posted = await postEntry(
    database,
    {
      description: "Deposit posted to the wrong client",
      effectiveDate: "2026-06-08",
      lines: [
        { accountId: bank.accountId, direction: "debit", amount: money(500000, USD) },
        { accountId: smith.accountId, direction: "credit", amount: money(500000, USD) },
      ],
    },
    { clock },
  );
  await commitEffectBatch(database, posted.effect, { now: clock.now });
  return { database, bank: bank.accountId, smith: smith.accountId, originalId: posted.entryId };
}

describe("reverseEntry — first-class corrections (ADR-0072)", () => {
  it("posts the exact mirror, links it, and balances return to zero", async () => {
    const { database, originalId } = await setupWithPostedEntry();
    const reversal = await reverseEntry(
      database,
      { entryId: originalId, description: "Correction: wrong client", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, reversal.effect, { now: clock.now });

    const link = (
      await database
        .prepare("SELECT reverses_entry_id FROM ledger_entry WHERE id = ?1")
        .bind(reversal.entryId)
        .all<{ reverses_entry_id: string }>()
    ).results[0];
    expect(link?.reverses_entry_id).toBe(originalId);

    const mirroredLines = (
      await database
        .prepare(
          "SELECT direction, amount_minor FROM ledger_line WHERE entry_id = ?1 ORDER BY line_index",
        )
        .bind(reversal.entryId)
        .all<{ direction: string; amount_minor: number }>()
    ).results;
    expect(mirroredLines).toEqual([
      { direction: "credit", amount_minor: 500000 }, // original debit, flipped
      { direction: "debit", amount_minor: 500000 },
    ]);

    const balances = (
      await database
        .prepare("SELECT balance_minor FROM account_balance")
        .bind()
        .all<{ balance_minor: number }>()
    ).results;
    expect(balances.every((row) => row.balance_minor === 0)).toBe(true);
  });

  it("refuses to reverse twice (polite pre-check) and the UNIQUE survives a race", async () => {
    const { database, originalId } = await setupWithPostedEntry();
    const first = await reverseEntry(
      database,
      { entryId: originalId, description: "Correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    // Compose a SECOND reversal BEFORE the first commits — both passed the pre-check (the race).
    const second = await reverseEntry(
      database,
      { entryId: originalId, description: "Concurrent correction", effectiveDate: "2026-06-09" },
      { clock },
    );
    await commitEffectBatch(database, first.effect, { now: clock.now });
    // The loser's WHOLE batch fails on the UNIQUE — schema-level double-reversal defense.
    await expect(commitEffectBatch(database, second.effect, { now: clock.now })).rejects.toThrow(
      /UNIQUE/,
    );
    // And after commit, the pre-check refuses politely.
    await expect(
      reverseEntry(
        database,
        { entryId: originalId, description: "Again", effectiveDate: "2026-06-09" },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "already-reversed" });
  });

  it("refuses an unknown entry", async () => {
    const { database } = await setupWithPostedEntry();
    await expect(
      reverseEntry(
        database,
        {
          entryId: "led_doesnotexist00000000" as never,
          description: "x",
          effectiveDate: "2026-06-09",
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "unknown-entry" });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/reverse-entry.ts`**

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { fromMinor } from "@magna-carta/money/format";
import type { NumberCurrency } from "@magna-carta/money/money";
import { USD } from "@magna-carta/money/money";
import {
  composePostedEntry,
  loadAccountSnapshots,
  type PostedEntry,
  type PostEntryOptions,
} from "./post-entry.ts";
import {
  selectEntryStatement,
  selectLinesForEntryStatement,
  selectReversalOfStatement,
} from "./statements.ts";
import type { Direction, EntryLineInput, PostEntryInput } from "./types.ts";
import { LedgerValidationError, validateEntry } from "./validate.ts";

export interface ReverseEntryInput {
  readonly entryId: LedgerEntryId;
  readonly description: string;
  readonly effectiveDate: string;
}

interface LineRow {
  account_id: string;
  line_index: number;
  direction: Direction;
  amount_minor: number;
}

// Compose the EXACT mirror of an existing entry (directions flipped, amounts identical), linked via
// reverses_entry_id. The pre-check refuses politely; the UNIQUE index settles the concurrent race —
// the losing batch rolls back whole. Reversing a reversal is allowed (it re-instates).
// NOTE: re-validates via validateEntry, so a line on an inactive account would refuse — unreachable
// today (no closing service); revisit when account closing exists (corrections must stay possible).
export async function reverseEntry(
  database: SqlDatabase,
  input: ReverseEntryInput,
  options: PostEntryOptions,
): Promise<PostedEntry> {
  const { results: entries } = await selectEntryStatement(database, input.entryId).all();
  if (entries.length === 0) {
    throw new LedgerValidationError("unknown-entry", `no such entry: ${input.entryId}`);
  }
  const { results: reversals } = await selectReversalOfStatement(database, input.entryId).all();
  if (reversals.length > 0) {
    throw new LedgerValidationError("already-reversed", `entry already reversed: ${input.entryId}`);
  }
  const { results: lines } = await selectLinesForEntryStatement(
    database,
    input.entryId,
  ).all<LineRow>();

  const accountIds = [...new Set(lines.map((line) => line.account_id))] as LedgerAccountId[];
  const accounts = await loadAccountSnapshots(database, accountIds);

  const mirroredLines: EntryLineInput[] = lines.map((line) => {
    const currency = accounts.get(line.account_id)?.currency;
    // USD-only today (ADR-0061); the currency tag still flows from the account row.
    const numberCurrency: NumberCurrency = currency === "USD" ? USD : USD;
    return {
      accountId: line.account_id as LedgerAccountId,
      direction: line.direction === "debit" ? "credit" : "debit",
      amount: fromMinor(line.amount_minor, numberCurrency),
    };
  });

  const mirrored: PostEntryInput = {
    description: input.description,
    effectiveDate: input.effectiveDate,
    lines: mirroredLines,
  };
  validateEntry(mirrored, accounts, options.clock.today());
  return composePostedEntry(database, mirrored, accounts, options, input.entryId);
}
```

**Note on the currency lookup:** USD-only today, so the `currency === "USD" ? USD : USD` line is deliberately a single-currency resolution with the shape of the future registry lookup; when a second currency arrives (never in this phase), the money package will own a `currencyFromCode` map. Keep the comment, keep it honest.

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): reverseEntry — linked mirror corrections, UNIQUE race-proof"
```

---

### Task 12: Fitness queries (`fitness.ts`)

**Files:**

- Create: `packages/ledger/src/fitness.ts`
- Test: `packages/ledger/test/fitness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/create-account.ts";
import { inconsistentBalancesStatement, unbalancedEntriesStatement } from "../src/fitness.ts";
import { postEntry } from "../src/post-entry.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };

describe("ledger fitness queries (ADR-0051) — prove the whole table, not one write", () => {
  it("a healthy ledger yields zero rows from both queries", async () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
    const database = nodeSqliteBatchDatabase(raw);
    const bank = await createAccount(
      database,
      { name: "Bank", type: "asset", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, bank.effect, { now: clock.now });
    const income = await createAccount(
      database,
      { name: "Fee Income", type: "income", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, income.effect, { now: clock.now });
    const posted = await postEntry(
      database,
      {
        description: "Fee received",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: bank.accountId, direction: "debit", amount: money(25000, USD) },
          { accountId: income.accountId, direction: "credit", amount: money(25000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, posted.effect, { now: clock.now });

    expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
    expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
  });

  it("detects a corrupted balance row (simulated drift)", async () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
    const database = nodeSqliteBatchDatabase(raw);
    const bank = await createAccount(
      database,
      { name: "Bank", type: "asset", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, bank.effect, { now: clock.now });
    // Corrupt the materialized balance directly (the very thing the query exists to catch).
    raw.prepare("UPDATE account_balance SET balance_minor = 999").run();
    const drifted = (await inconsistentBalancesStatement(database).all()).results;
    expect(drifted).toHaveLength(1);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/fitness.ts`**

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { ACCOUNT_BALANCE_TABLE, LEDGER_ACCOUNT_TABLE, LEDGER_LINE_TABLE } from "./statements.ts";

// Fitness queries (ADR-0051): re-prove the invariants over the WHOLE table. Zero rows = healthy.
// Run in tests after every scenario; later wired into CI / an admin diagnostic.

// Every entry must sum to zero across its lines.
export function unbalancedEntriesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT entry_id, SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END) AS net FROM ${LEDGER_LINE_TABLE} GROUP BY entry_id HAVING net <> 0`,
    )
    .bind();
}

// Every materialized balance must equal the recomputed sum of its lines in normal-balance terms.
// The normal-balance CASE here mirrors normal-balance.ts — the schema-level statement of the same
// single rule (asset/expense debit-normal).
export function inconsistentBalancesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT b.account_id, b.balance_minor, COALESCE(computed.total, 0) AS computed FROM ${ACCOUNT_BALANCE_TABLE} b LEFT JOIN (SELECT l.account_id, SUM(CASE WHEN l.direction = (CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END) THEN l.amount_minor ELSE -l.amount_minor END) AS total FROM ${LEDGER_LINE_TABLE} l JOIN ${LEDGER_ACCOUNT_TABLE} a ON a.id = l.account_id GROUP BY l.account_id) computed ON computed.account_id = b.account_id WHERE COALESCE(computed.total, 0) <> b.balance_minor`,
    )
    .bind();
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): fitness queries — table-wide sum-to-zero + balance consistency"
```

---

### Task 13: Scaffold `@magna-carta/fixtures` (+ faker catalog pin)

**Files:**

- Modify: `pnpm-workspace.yaml`
- Create: `packages/fixtures/package.json`, `tsconfig.json`, `vitest.config.ts`, `CLAUDE.md`

- [ ] **Step 1: Pin faker** — Run `pnpm view @faker-js/faker version`, then add to the catalog (Fixtures section) with that exact version, e.g.:

```yaml
# Fixtures (packages/fixtures). Seeded via faker.seed(); locale en.
"@faker-js/faker": <exact version from pnpm view>
```

- [ ] **Step 2: Create the package** — `packages/fixtures/package.json`:

```json
{
  "name": "@magna-carta/fixtures",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./context": "./src/context.ts",
    "./local-database": "./src/local-database.ts",
    "./guard": "./src/guard.ts",
    "./demo-chart-of-accounts": "./src/demo-chart-of-accounts.ts",
    "./factories": "./src/factories.ts",
    "./scenarios": "./src/scenarios.ts",
    "./demo-firm": "./src/demo-firm.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@faker-js/faker": "catalog:",
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/database": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/ledger": "workspace:*",
    "@magna-carta/money": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

`tsconfig.json` and `vitest.config.ts`: same as Task 5's. `CLAUDE.md`:

```markdown
# @magna-carta/fixtures — area rules

The deterministic synthetic-data harness (ADR-0034, ADR-0072; white paper _Synthetic data &
fixtures_). Factories call REAL domain write paths — `createAccount`/`postEntry`/`reverseEntry` —
never raw inserts; data is valid by construction and scenarios double as integration tests.

## Invariants that bind here

- **One seed carries all determinism.** Seeded faker + the fixed clock + `seededRandomSource` —
  nothing else may produce randomness or read wall-clock time. Same seed → byte-identical rows
  (outbox `id` excepted — minted unseeded inside data-access; documented seam).
- **Real write paths only.** A raw business-table INSERT in this package is a bug. (Direct SQL is
  allowed only to _corrupt_ state on purpose in tests, or via `setAccountBoundsStatement` — the
  Phase-3 seam primitive.)
- **Never in production.** Every seeding entry point goes through `guard.ts`; this package is never
  imported by production worker code (boundary rule, ADR-0070).
- **The demo chart of accounts is demo data** — explicitly NOT the Phase-3 product CoA template.
```

- [ ] **Step 3: Install + commit**

```bash
vp install
git add pnpm-workspace.yaml pnpm-lock.yaml packages/fixtures
git commit -m "feat(fixtures): scaffold @magna-carta/fixtures + faker catalog pin"
```

---

### Task 14: `FixtureContext` + local database + guard

**Files:**

- Create: `packages/fixtures/src/context.ts`, `packages/fixtures/src/local-database.ts`, `packages/fixtures/src/guard.ts`
- Test: `packages/fixtures/test/context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { assertSeedingAllowed } from "../src/guard.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";

describe("FixtureContext — one seed carries all determinism (ADR-0034)", () => {
  it("same seed → identical ids, names, and clock readings", () => {
    const a = fixtureContext("demo-llp-1");
    const b = fixtureContext("demo-llp-1");
    expect(newIdentifier("ledgerAccount", a.randomSource)).toBe(
      newIdentifier("ledgerAccount", b.randomSource),
    );
    expect(a.faker.person.fullName()).toBe(b.faker.person.fullName());
    expect(a.clock.now()).toBe(b.clock.now());
  });

  it("different seeds diverge", () => {
    const a = fixtureContext("demo-llp-1");
    const b = fixtureContext("demo-llp-2");
    expect(newIdentifier("ledgerAccount", a.randomSource)).not.toBe(
      newIdentifier("ledgerAccount", b.randomSource),
    );
  });

  it("the fixed clock starts at the anchor and advances only explicitly", () => {
    const context = fixtureContext("demo-llp-1");
    expect(context.clock.now()).toBe("2026-01-05T09:00:00.000Z");
    expect(context.clock.today()).toBe("2026-01-05");
    context.clock.advanceMinutes(90);
    expect(context.clock.now()).toBe("2026-01-05T10:30:00.000Z");
    context.clock.advanceMinutes(24 * 60); // across midnight
    expect(context.clock.today()).toBe("2026-01-06");
  });

  it("guard refuses without the explicit opt-in", () => {
    expect(() => assertSeedingAllowed({ allowSeeding: false })).toThrow(/seeding/i);
    expect(() => assertSeedingAllowed({ allowSeeding: true })).not.toThrow();
  });
});
```

Run: `pnpm --filter @magna-carta/fixtures test` → FAIL.

- [ ] **Step 2: Implement**

`src/context.ts`:

```ts
import { Faker, en } from "@faker-js/faker";
import { seededRandomSource, type RandomSource } from "@magna-carta/identifiers/random";
import type { ClockPort } from "@magna-carta/ledger/types";

// All fixture time flows from this anchor; wall-clock reads are banned in fixtures (ADR-0034).
export const FIXTURE_EPOCH = "2026-01-05T09:00:00.000Z";

export interface FixtureClock extends ClockPort {
  advanceMinutes(minutes: number): void;
}

export interface FixtureContext {
  readonly seed: string;
  readonly faker: Faker;
  readonly clock: FixtureClock;
  readonly randomSource: RandomSource;
}

// FNV-1a: a deterministic string → uint32 for faker.seed(). Not cryptographic — doesn't need to be.
function seedNumber(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fixtureContext(seed: string): FixtureContext {
  const faker = new Faker({ locale: [en] });
  faker.seed(seedNumber(seed));
  let currentMs = Date.parse(FIXTURE_EPOCH);
  const clock: FixtureClock = {
    now: () => new Date(currentMs).toISOString(),
    today: () => new Date(currentMs).toISOString().slice(0, 10),
    advanceMinutes: (minutes: number) => {
      currentMs += minutes * 60_000;
    },
  };
  return { seed, faker, clock, randomSource: seededRandomSource(seed) };
}
```

(Verify `seededRandomSource`'s exact export name in `@magna-carta/identifiers/random` — the slice 0·2 changelog names `seededRandomSource(string | number)`.)

`src/local-database.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
  type NodeBatchDatabase,
} from "@magna-carta/database/node-sqlite";

export interface LocalDatabase {
  readonly database: NodeBatchDatabase; // D1-shaped; feed to the domain services + commitEffectBatch
  readonly raw: DatabaseSync; // escape hatch for assertions / deliberate corruption in tests
}

// An in-memory per-firm database at the CURRENT committed schema — the local/test stand-in for a
// firm's D1 (node-only; Miniflare/Workers contexts get the real D1 binding instead).
export function createLocalPerFirmDatabase(): LocalDatabase {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return { database: nodeSqliteBatchDatabase(raw), raw };
}
```

`src/guard.ts`:

```ts
// Generation can NEVER run in production (white paper _Synthetic data & fixtures_). Two layers:
// the explicit opt-in below, and the boundary rule that production worker code never imports this
// package (ADR-0070). NODE_ENV is checked when present (Node contexts); Workers have no process.
export interface SeedingOptions {
  readonly allowSeeding: boolean;
}

export function assertSeedingAllowed(options: SeedingOptions): void {
  if (options.allowSeeding !== true) {
    throw new Error("fixtures: seeding requires the explicit { allowSeeding: true } opt-in");
  }
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[
    "NODE_ENV"
  ];
  if (nodeEnv === "production") {
    throw new Error("fixtures: seeding is forbidden in production");
  }
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): FixtureContext (seeded faker + fixed clock + seeded ids), local database, production guard"
```

---

### Task 15: Demo chart of accounts + primitive factories

**Files:**

- Create: `packages/fixtures/src/demo-chart-of-accounts.ts`, `packages/fixtures/src/factories.ts`
- Test: `packages/fixtures/test/demo-chart-of-accounts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { DEMO_ACCOUNT_KEYS, seedDemoChartOfAccounts } from "../src/demo-chart-of-accounts.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

describe("demo chart of accounts (DEMO DATA — not the Phase-3 product CoA)", () => {
  it("seeds through createAccount; trust children hang under Client Trust Liability", async () => {
    const { database } = createLocalPerFirmDatabase();
    const context = fixtureContext("demo-llp-1");
    const accounts = await seedDemoChartOfAccounts(database, context);
    for (const key of DEMO_ACCOUNT_KEYS) expect(accounts.has(key)).toBe(true);

    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account WHERE parent_account_id = ?1")
      .bind(accounts.get("clientTrustLiability"))
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(2); // Dana Smith + Marcus Webb demo client subledgers

    const balances = await database
      .prepare("SELECT COUNT(*) AS n FROM account_balance")
      .bind()
      .all<{ n: number }>();
    expect(balances.results[0]?.n).toBe(DEMO_ACCOUNT_KEYS.length); // every account got its row
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`src/demo-chart-of-accounts.ts`:

```ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { NodeBatchDatabase } from "@magna-carta/database/node-sqlite";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import type { AccountType } from "@magna-carta/ledger/types";
import type { FixtureContext } from "./context.ts";

// DEMO DATA ONLY — a tiny small-law-firm chart so scenarios read realistically. This is explicitly
// NOT the Phase-3 product CoA template; the product chart gets designed in Phase 3 (ADR-0072 spec
// §5.3 boundary). ~14 accounts, stable keys, seeded in declaration order for determinism.
interface DemoAccount {
  readonly key: string;
  readonly name: string;
  readonly type: AccountType;
  readonly parentKey?: string;
}

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { key: "operatingBank", name: "Operating Bank Account", type: "asset" },
  { key: "trustBank", name: "Trust Bank Account (IOLTA)", type: "asset" },
  { key: "accountsReceivable", name: "Accounts Receivable", type: "asset" },
  { key: "clientCostsAdvanced", name: "Client Costs Advanced", type: "asset" },
  { key: "clientTrustLiability", name: "Client Trust Liability", type: "liability" },
  {
    key: "trustSmith",
    name: "Trust — Dana Smith",
    type: "liability",
    parentKey: "clientTrustLiability",
  },
  {
    key: "trustWebb",
    name: "Trust — Marcus Webb",
    type: "liability",
    parentKey: "clientTrustLiability",
  },
  { key: "ownersEquity", name: "Owner's Equity", type: "equity" },
  { key: "feeIncome", name: "Fee Income", type: "income" },
  { key: "costRecoveryIncome", name: "Cost Recovery Income", type: "income" },
  { key: "rentExpense", name: "Rent Expense", type: "expense" },
  { key: "salariesExpense", name: "Salaries Expense", type: "expense" },
  { key: "officeSuppliesExpense", name: "Office Supplies Expense", type: "expense" },
  { key: "barDuesExpense", name: "Bar Dues Expense", type: "expense" },
];

export const DEMO_ACCOUNT_KEYS: readonly string[] = DEMO_ACCOUNTS.map((account) => account.key);

export async function seedDemoChartOfAccounts(
  database: NodeBatchDatabase,
  context: FixtureContext,
): Promise<Map<string, LedgerAccountId>> {
  const accounts = new Map<string, LedgerAccountId>();
  for (const demo of DEMO_ACCOUNTS) {
    const parentAccountId = demo.parentKey ? accounts.get(demo.parentKey) : undefined;
    if (demo.parentKey && !parentAccountId) {
      throw new Error(`demo CoA: parent ${demo.parentKey} must be declared before ${demo.key}`);
    }
    const { accountId, effect } = await createAccount(
      database,
      { name: demo.name, type: demo.type, currency: "USD", parentAccountId },
      { clock: context.clock, randomSource: context.randomSource },
    );
    await commitEffectBatch(database, effect, { now: context.clock.now });
    accounts.set(demo.key, accountId);
  }
  return accounts;
}
```

`src/factories.ts`:

```ts
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { money } from "@magna-carta/money/money";
import { USD } from "@magna-carta/money/money";
import type { PostEntryInput } from "@magna-carta/ledger/types";
import type { FixtureContext } from "./context.ts";

// Primitive factory: a plausible balanced two-line entry. Faker supplies the narrative; the clock
// supplies the date; amounts default to a faker-drawn realistic figure. Overrides win.
export function aBalancedEntryInput(
  context: FixtureContext,
  input: {
    debitAccountId: LedgerAccountId;
    creditAccountId: LedgerAccountId;
    amountMinor?: number;
    description?: string;
  },
): PostEntryInput {
  const amountMinor = input.amountMinor ?? context.faker.number.int({ min: 5000, max: 2_000_000 });
  return {
    description: input.description ?? `${context.faker.company.buzzPhrase()}`,
    effectiveDate: context.clock.today(),
    lines: [
      { accountId: input.debitAccountId, direction: "debit", amount: money(amountMinor, USD) },
      { accountId: input.creditAccountId, direction: "credit", amount: money(amountMinor, USD) },
    ],
  };
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): demo chart of accounts + primitive entry factory"
```

---

### Task 16: Named scenarios

**Files:**

- Create: `packages/fixtures/src/scenarios.ts`
- Test: `packages/fixtures/test/scenarios.test.ts`

- [ ] **Step 1: Write the failing test** — each scenario runs end-to-end and the fitness queries stay clean:

```ts
import { describe, expect, it } from "vitest";
import {
  inconsistentBalancesStatement,
  unbalancedEntriesStatement,
} from "@magna-carta/ledger/fitness";
import { fixtureContext } from "../src/context.ts";
import { seedDemoChartOfAccounts } from "../src/demo-chart-of-accounts.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";
import {
  boundsRejection,
  multiLineSettlement,
  retainerDeposit,
  trustCorrection,
} from "../src/scenarios.ts";

async function setup() {
  const local = createLocalPerFirmDatabase();
  const context = fixtureContext("scenario-test");
  const accounts = await seedDemoChartOfAccounts(local.database, context);
  return { ...local, context, accounts };
}

async function expectFitnessClean(database: Awaited<ReturnType<typeof setup>>["database"]) {
  expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
  expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
}

describe("named scenarios — short stories through the real write paths, assertions baked in", () => {
  it("retainerDeposit: trust bank and client subledger both grow by the deposit", async () => {
    const { database, context, accounts } = await setup();
    const result = await retainerDeposit(database, context, accounts);
    expect(result.entryId).toMatch(/^led_/);
    await expectFitnessClean(database);
  });

  it("trustCorrection: post + reverse restores both balances and links the pair", async () => {
    const { database, context, accounts } = await setup();
    const result = await trustCorrection(database, context, accounts);
    expect(result.reversalEntryId).toMatch(/^led_/);
    await expectFitnessClean(database);
  });

  it("boundsRejection: the overdraw batch fails whole and the ledger is untouched", async () => {
    const { database, context, accounts } = await setup();
    const result = await boundsRejection(database, context, accounts);
    expect(result.rejected).toBe(true);
    await expectFitnessClean(database);
  });

  it("multiLineSettlement: a 4-line balanced entry posts clean", async () => {
    const { database, context, accounts } = await setup();
    await multiLineSettlement(database, context, accounts);
    await expectFitnessClean(database);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/scenarios.ts`**

```ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { NodeBatchDatabase } from "@magna-carta/database/node-sqlite";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { money, USD } from "@magna-carta/money/money";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import { setAccountBoundsStatement } from "@magna-carta/ledger/statements";
import type { FixtureContext } from "./context.ts";

// Named scenarios (ADR-0034/ADR-0072): deterministic short stories told through the REAL write
// paths, with assertions baked in — running them IS integration coverage. They throw plain Errors
// (not vitest) so they also run as seeding code outside a test runner.

type DemoAccounts = ReadonlyMap<string, LedgerAccountId>;

function accountOf(accounts: DemoAccounts, key: string): LedgerAccountId {
  const id = accounts.get(key);
  if (!id) throw new Error(`scenario: demo account "${key}" missing`);
  return id;
}

async function balanceOf(database: NodeBatchDatabase, accountId: LedgerAccountId): Promise<number> {
  const { results } = await database
    .prepare("SELECT balance_minor FROM account_balance WHERE account_id = ?1")
    .bind(accountId)
    .all<{ balance_minor: number }>();
  const balance = results[0]?.balance_minor;
  if (balance === undefined) throw new Error(`scenario: no balance row for ${accountId}`);
  return balance;
}

function assertScenario(condition: boolean, message: string): void {
  if (!condition) throw new Error(`scenario assertion failed: ${message}`);
}

const serviceOptions = (context: FixtureContext) => ({
  clock: context.clock,
  randomSource: context.randomSource,
});

// Dana Smith pays a $5,000.00 retainer into trust.
export async function retainerDeposit(
  database: NodeBatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ entryId: LedgerEntryId }> {
  const trustBank = accountOf(accounts, "trustBank");
  const smith = accountOf(accounts, "trustSmith");
  const before = await balanceOf(database, smith);
  const { entryId, effect } = await postEntry(
    database,
    {
      description: "Retainer deposit — Dana Smith",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(500000, USD) },
        { accountId: smith, direction: "credit", amount: money(500000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, effect, { now: context.clock.now });
  context.clock.advanceMinutes(7);
  assertScenario(
    (await balanceOf(database, smith)) === before + 500000,
    "Smith's trust subledger grew by the deposit",
  );
  return { entryId };
}

// A deposit lands on the wrong client; the correction is a linked reversing entry, then a re-post.
export async function trustCorrection(
  database: NodeBatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ originalEntryId: LedgerEntryId; reversalEntryId: LedgerEntryId }> {
  const trustBank = accountOf(accounts, "trustBank");
  const webb = accountOf(accounts, "trustWebb");
  const smith = accountOf(accounts, "trustSmith");

  const wrong = await postEntry(
    database,
    {
      description: "Retainer deposit — posted to Marcus Webb in error",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(250000, USD) },
        { accountId: webb, direction: "credit", amount: money(250000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, wrong.effect, { now: context.clock.now });
  context.clock.advanceMinutes(30);

  const reversal = await reverseEntry(
    database,
    {
      entryId: wrong.entryId,
      description: "Correction: deposit belonged to Dana Smith",
      effectiveDate: context.clock.today(),
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, reversal.effect, { now: context.clock.now });
  context.clock.advanceMinutes(2);

  const repost = await postEntry(
    database,
    {
      description: "Retainer deposit — Dana Smith (corrected)",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: trustBank, direction: "debit", amount: money(250000, USD) },
        { accountId: smith, direction: "credit", amount: money(250000, USD) },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, repost.effect, { now: context.clock.now });
  context.clock.advanceMinutes(2);

  assertScenario((await balanceOf(database, webb)) === 0, "Webb's subledger restored to zero");
  assertScenario(
    (await balanceOf(database, smith)) >= 250000,
    "Smith's subledger holds the deposit",
  );
  return { originalEntryId: wrong.entryId, reversalEntryId: reversal.entryId };
}

// The ADR-0009 mechanism, proven: bound Smith's subledger at min 0, attempt an overdraw, and the
// WHOLE batch must be rejected with the ledger untouched.
export async function boundsRejection(
  database: NodeBatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ rejected: boolean }> {
  const trustBank = accountOf(accounts, "trustBank");
  const smith = accountOf(accounts, "trustSmith");
  await retainerDeposit(database, context, accounts); // fund Smith with 500000 first
  await database.batch([setAccountBoundsStatement(database, smith, 0, null, context.clock.now())]);
  const before = await balanceOf(database, smith);

  const overdraw = await postEntry(
    database,
    {
      description: "Disbursement exceeding Dana Smith's trust balance",
      effectiveDate: context.clock.today(),
      lines: [
        { accountId: smith, direction: "debit", amount: money(before + 100000, USD) },
        { accountId: trustBank, direction: "credit", amount: money(before + 100000, USD) },
      ],
    },
    serviceOptions(context),
  );
  let rejected = false;
  try {
    await commitEffectBatch(database, overdraw.effect, { now: context.clock.now });
  } catch {
    rejected = true;
  }
  assertScenario(rejected, "the overdraw batch was rejected by the bounds CHECK");
  assertScenario((await balanceOf(database, smith)) === before, "Smith's balance is untouched");
  return { rejected };
}

// A settlement-style 4-line entry: operating bank receives, fee income + cost recovery credited,
// costs-advanced receivable cleared. Exercises multi-line balance and multi-account deltas.
export async function multiLineSettlement(
  database: NodeBatchDatabase,
  context: FixtureContext,
  accounts: DemoAccounts,
): Promise<{ entryId: LedgerEntryId }> {
  const { entryId, effect } = await postEntry(
    database,
    {
      description: "Settlement received — fees, recovered costs",
      effectiveDate: context.clock.today(),
      lines: [
        {
          accountId: accountOf(accounts, "operatingBank"),
          direction: "debit",
          amount: money(1_000000, USD),
        },
        {
          accountId: accountOf(accounts, "feeIncome"),
          direction: "credit",
          amount: money(850000, USD),
        },
        {
          accountId: accountOf(accounts, "costRecoveryIncome"),
          direction: "credit",
          amount: money(50000, USD),
        },
        {
          accountId: accountOf(accounts, "clientCostsAdvanced"),
          direction: "credit",
          amount: money(100000, USD),
        },
      ],
    },
    serviceOptions(context),
  );
  await commitEffectBatch(database, effect, { now: context.clock.now });
  context.clock.advanceMinutes(5);
  return { entryId };
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): named scenarios — retainerDeposit, trustCorrection, boundsRejection, multiLineSettlement"
```

---

### Task 17: `seedDemoFirm` + determinism proof

**Files:**

- Create: `packages/fixtures/src/demo-firm.ts`
- Test: `packages/fixtures/test/demo-firm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { seedDemoFirm } from "../src/demo-firm.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";
import {
  inconsistentBalancesStatement,
  unbalancedEntriesStatement,
} from "@magna-carta/ledger/fitness";

// Outbox `id` is minted unseeded inside data-access (documented seam, plan §Decided-up-front 5):
// compare outbox rows without it; everything else byte-identical.
function dumpDeterministicState(raw: ReturnType<typeof createLocalPerFirmDatabase>["raw"]) {
  return {
    accounts: raw.prepare("SELECT * FROM ledger_account ORDER BY id").all(),
    entries: raw.prepare("SELECT * FROM ledger_entry ORDER BY id").all(),
    lines: raw.prepare("SELECT * FROM ledger_line ORDER BY id").all(),
    balances: raw.prepare("SELECT * FROM account_balance ORDER BY account_id").all(),
    outbox: raw
      .prepare(
        "SELECT topic, payload, aggregate_key, seq, status, attempts, created_at FROM outbox ORDER BY seq, created_at",
      )
      .all(),
  };
}

describe("seedDemoFirm — the demo bundle, deterministic by seed", () => {
  it("requires the explicit opt-in", async () => {
    const { database } = createLocalPerFirmDatabase();
    await expect(
      seedDemoFirm(database, fixtureContext("demo-llp-1"), { allowSeeding: false }),
    ).rejects.toThrow(/seeding/i);
  });

  it("seeds a coherent story and the fitness queries hold", async () => {
    const { database } = createLocalPerFirmDatabase();
    const summary = await seedDemoFirm(database, fixtureContext("demo-llp-1"), {
      allowSeeding: true,
    });
    expect(summary.entryCount).toBeGreaterThanOrEqual(12);
    expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
    expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
  });

  it("same seed → identical rows; different seed → different rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    const third = createLocalPerFirmDatabase();
    await seedDemoFirm(first.database, fixtureContext("demo-llp-1"), { allowSeeding: true });
    await seedDemoFirm(second.database, fixtureContext("demo-llp-1"), { allowSeeding: true });
    await seedDemoFirm(third.database, fixtureContext("demo-llp-2"), { allowSeeding: true });
    expect(dumpDeterministicState(first.raw)).toEqual(dumpDeterministicState(second.raw));
    expect(JSON.stringify(dumpDeterministicState(first.raw))).not.toBe(
      JSON.stringify(dumpDeterministicState(third.raw)),
    );
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/demo-firm.ts`**

```ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { NodeBatchDatabase } from "@magna-carta/database/node-sqlite";
import { money, USD } from "@magna-carta/money/money";
import { postEntry } from "@magna-carta/ledger/post-entry";
import type { FixtureContext } from "./context.ts";
import { seedDemoChartOfAccounts } from "./demo-chart-of-accounts.ts";
import { assertSeedingAllowed, type SeedingOptions } from "./guard.ts";
import { multiLineSettlement, retainerDeposit, trustCorrection } from "./scenarios.ts";

export interface DemoFirmSummary {
  readonly accountCount: number;
  readonly entryCount: number;
}

// The demo-firm bundle ("Demo, LLP" — becomes a real provisioned firm in slice 0·4): the demo CoA
// plus a coherent dozen-entry story. Stays MINIMAL until matters/clients exist to hang richness on
// (ADR-0072 spec §5.5). Every write goes through the real domain services.
export async function seedDemoFirm(
  database: NodeBatchDatabase,
  context: FixtureContext,
  options: SeedingOptions,
): Promise<DemoFirmSummary> {
  assertSeedingAllowed(options);
  const accounts = await seedDemoChartOfAccounts(database, context);
  const post = async (
    description: string,
    lines: Parameters<typeof postEntry>[1]["lines"],
    advanceMinutes: number,
  ) => {
    const { effect } = await postEntry(
      database,
      { description, effectiveDate: context.clock.today(), lines },
      { clock: context.clock, randomSource: context.randomSource },
    );
    await commitEffectBatch(database, effect, { now: context.clock.now });
    context.clock.advanceMinutes(advanceMinutes);
  };
  const id = (key: string) => {
    const accountId = accounts.get(key);
    if (!accountId) throw new Error(`demo firm: missing account ${key}`);
    return accountId;
  };

  // Opening: the owner funds the firm.
  await post(
    "Owner capital contribution",
    [
      { accountId: id("operatingBank"), direction: "debit", amount: money(5_000000, USD) },
      { accountId: id("ownersEquity"), direction: "credit", amount: money(5_000000, USD) },
    ],
    60,
  );

  // Trust activity: two deposits, one correction story, one settlement.
  await retainerDeposit(database, context, accounts);
  await trustCorrection(database, context, accounts);
  await multiLineSettlement(database, context, accounts);

  // Operating month: rent, salaries, supplies, bar dues, a fee billed and received, costs advanced.
  await post(
    "Office rent — monthly",
    [
      { accountId: id("rentExpense"), direction: "debit", amount: money(450000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(450000, USD) },
    ],
    45,
  );
  await post(
    "Salaries",
    [
      { accountId: id("salariesExpense"), direction: "debit", amount: money(1_200000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(1_200000, USD) },
    ],
    45,
  );
  await post(
    "Office supplies",
    [
      { accountId: id("officeSuppliesExpense"), direction: "debit", amount: money(23000, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(23000, USD) },
    ],
    30,
  );
  await post(
    "State bar dues",
    [
      { accountId: id("barDuesExpense"), direction: "debit", amount: money(54500, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(54500, USD) },
    ],
    30,
  );
  await post(
    "Fee billed — hourly matter",
    [
      { accountId: id("accountsReceivable"), direction: "debit", amount: money(380000, USD) },
      { accountId: id("feeIncome"), direction: "credit", amount: money(380000, USD) },
    ],
    90,
  );
  await post(
    "Client payment on account",
    [
      { accountId: id("operatingBank"), direction: "debit", amount: money(380000, USD) },
      { accountId: id("accountsReceivable"), direction: "credit", amount: money(380000, USD) },
    ],
    60,
  );
  await post(
    "Filing fee advanced for client",
    [
      { accountId: id("clientCostsAdvanced"), direction: "debit", amount: money(43500, USD) },
      { accountId: id("operatingBank"), direction: "credit", amount: money(43500, USD) },
    ],
    30,
  );

  const { results } = await database
    .prepare(
      "SELECT (SELECT COUNT(*) FROM ledger_account) AS accounts, (SELECT COUNT(*) FROM ledger_entry) AS entries",
    )
    .bind()
    .all<{ accounts: number; entries: number }>();
  return { accountCount: results[0]?.accounts ?? 0, entryCount: results[0]?.entries ?? 0 };
}
```

- [ ] **Step 3: Run tests** → PASS (entry count: 1 opening + 1 retainer + 3 correction-story + 1 settlement + 7 operating = 13). **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): seedDemoFirm — guarded, deterministic demo bundle"
```

---

### Task 18: Docs, invariants, full gate

**Files:**

- Modify: `docs/conventions/invariants.md`, `ROADMAP.md`, `CHANGELOG.md`

- [ ] **Step 1: Extend `invariants.md`** — under _Money & accounting_, after the append-only bullet:

```markdown
- **Balanced entries on leaf accounts.** Every ledger entry has ≥ 2 same-currency lines whose debits
  equal credits, posted to active leaf accounts only (parents are roll-ups); line amounts are always
  positive — direction is data, never a sign. (_Financial Core_; ADR-0072)
- **Materialized balances are derived state.** `account_balance` rows update only inside the posting
  batch and must always equal the recomputed sum of lines (fitness query); bounds violations abort
  the whole batch. (_Financial Core_; ADR-0072, prepares ADR-0009)
```

- [ ] **Step 2: Update ROADMAP + CHANGELOG** — ROADMAP "Now" slice 0·3 bullet: designed → **built** (packages + test counts, per the slice 0·2 precedent). CHANGELOG `[Unreleased]` → `### Added`: a `@magna-carta/ledger` + `@magna-carta/fixtures` entry (mirror the design entry already there, now as shipped implementation with test counts).

- [ ] **Step 3: Full gate**

```bash
pnpm check
pnpm --filter @magna-carta/identifiers test
pnpm --filter @magna-carta/money test
pnpm --filter @magna-carta/database test
pnpm --filter @magna-carta/data-access test
pnpm --filter @magna-carta/ledger test
pnpm --filter @magna-carta/fixtures test
```

Expected: all green. (`vp run build-all` is NOT required here — no app changes; avoid the OneDrive EPERM gotcha.)

- [ ] **Step 4: Commit**

```bash
git add docs/conventions/invariants.md ROADMAP.md CHANGELOG.md
git commit -m "docs(ledger): invariants, roadmap, changelog — slice 0·3 ledger core + fixtures shipped"
```

---

## After the plan

Per the established workflow (memory: package-build-and-review): after all tasks land, run the **7-angle adversarial review with empirical verifiers** over the new packages, fix findings, and update docs in the same commit. Candidate review angles: batch atomicity edges (partial-failure injection), seq/outbox interaction under multi-entry batches, balance-delta aggregation on entries touching one account twice, determinism under locale/platform variation, boundary rules (no barrel, exports map), CHECK coverage vs. the spec table, append-only source scan (no UPDATE/DELETE on entry/line tables outside the sanctioned list).

## Self-review notes (plan coverage)

- Spec §1 tables → Tasks 2–3; §1.4 CHECK mechanism → Tasks 8–9 (proven on real SQLite twice: statement-level and write-path-level). Spec §2 services → Tasks 9–11; §2.1 batch order → `composePostedEntry` + `composeEffectBatch` ordering (idempotency record first, outbox last). Spec §3 validation → Task 7 (every code tested); §3.2 schema CHECKs → Tasks 2–3. Spec §4 time model → `ClockPort` (Tasks 6, 14). Spec §5 fixtures → Tasks 13–17 (context/factories/scenarios/demo-firm/guard); §5.3 demo-CoA boundary → comments + CLAUDE.md. Spec §6 fitness → Task 12 (+ append-only source scan deferred to the review pass, noted above). Spec §7 test plan → per-task tests; §9 docs → Task 18.
- Known seams stated, not hidden: outbox id non-determinism (§Decided 5), reverseEntry × inactive accounts (§Decided 7), single-currency resolution in reverseEntry (Task 11 note).
- Type-consistency pass done: `ClockPort`/`PostedEntry`/`AccountSnapshot`/`NodeBatchDatabase` names match across tasks; `composePostedEntry` is exported from `post-entry.ts` and consumed by `reverse-entry.ts`.
