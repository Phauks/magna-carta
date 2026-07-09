# Slice 3·5 — Operating accounting / general ledger — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the append-only double-entry ledger to the firm's operating books — chart of accounts, account resolver, posting dimensions, fiscal-period close, accounts payable, and financial-statement read models.

**Architecture:** Two new packages. `@magna-carta/accounting-periods` is a pure leaf holding the period-lock guard that trust, billing, and the general ledger all call before composing a posting. `@magna-carta/general-ledger` owns the chart, the resolver, vendor bills, the close service, and the statement read models. Services stay pure — they read, validate in memory, and return `{ effect: EffectWrite }`; the route commits through `runIdempotentEffect`. A hard-cost vendor bill's ledger entry and its `cost_entry` row are composed into one D1 batch **by the route**, so neither package imports the other.

**Tech Stack:** TypeScript, Drizzle (schema + migrations), D1 / Miniflare, Hono + zod OpenAPI, Vitest.

**Design:** [`2026-07-09-slice-3-5-operating-general-ledger-design.md`](2026-07-09-slice-3-5-operating-general-ledger-design.md).

## Global Constraints

Every task's requirements implicitly include this section.

- **No process references in source.** Code, tests, config, and OpenAPI `description`s carry no `ADR-NNNN`, no "spec", no "slice 3·5", no "Phase N" citation. State the reasoning inline. The only allowed exception is a forward-looking schedule note ("the QuickBooks adapter lands in Phase 7·2"). CI enforces this: `pnpm run lint:process-refs`.
- **No shorthand names.** `@magna-carta/general-ledger`, never `gl`. `accountsPayable`, never `ap`. `resolveAccount`, never `resolveAcct`. Only documented storage-encoding suffixes (`amount_minor`) and universal external terms (`id`, `URL`, `SQL`) are exempt.
- **Column-name gate.** `packages/database/test/schema-conformance.test.ts` refuses any column matching `/(amount|balance|total|price|fee|cost)(_|$)/` that does not end in `_minor` or `_rate_e4`. A column named `cost_entry_id` fails. Use `disbursement_entry_id`.
- **No barrel files.** Each package's `package.json` `exports` maps one subpath per source file. Cross-package imports use those subpaths only.
- **Expand-contract migrations.** New columns are nullable or defaulted. Never narrow an existing CHECK. Never `DROP COLUMN` in the same migration as the code that stops using it.
- **Money discipline.** Integer minor units at the SQL boundary; no floats. Statement aggregation rounds **half-even** via `@magna-carta/money`; the half-up mode belongs to invoice and tax boundaries, not here.
- **Explicit CHECKs on enums.** Drizzle text enums are type-level only. Every enumerated column gets a DDL `check(...)`.
- **Purity.** Services take `(database, input, options)` where `options` carries `clock`, `actorUserId`, and an optional `randomSource`. No ambient clock, identity, or randomness.
- **Quality gate.** `pnpm check` (formatting, lint, TypeScript project-references typecheck, svelte-check) must pass before every commit.

## File Structure

**Created**

- `packages/accounting-periods/` — `package.json`, `src/posting-window.ts` (the guard), `src/posting-window-error.ts`, `test/posting-window.test.ts`
- `packages/general-ledger/` — `package.json`, `CLAUDE.md`, and under `src/`: `chart-statements.ts`, `product-chart.ts`, `account-resolver.ts`, `general-ledger-validation.ts`, `period-statements.ts`, `period-service.ts`, `vendor-bill-statements.ts`, `vendor-bill-service.ts`, `statement-read-models.ts`, `fitness.ts`
- `apps/worker/src/routes/ledger.ts`, `apps/worker/src/routes/accounts-payable.ts`
- Tests mirroring each source file, plus `apps/worker/test/e2e/slice-3-5-e2e.test.ts`

**Modified**

- `packages/database/src/per-firm-schema.ts` — chart columns on `ledger_account`; dimensions on `ledger_line`; four new tables; widen `cost_entry.source`
- `packages/identifiers/src/registry.ts` and `src/types.ts` — three new handles
- `packages/access-control/src/registry.ts` — seven new permissions
- `apps/worker/src/per-firm-migrations.ts` — register each generated migration
- `apps/worker/src/app.ts` — register the two route modules
- `packages/fixtures/src/load-profile/` — `GeneralLedgerVolume`

---

### Task 1: The period-lock guard (`@magna-carta/accounting-periods`)

A pure leaf, modelled on `@magna-carta/billing-core`. It knows nothing about databases — the caller resolves the lock dates and passes them in, exactly as `validateEntry` already receives `today` rather than reading a clock.

**Files:**
- Create: `packages/accounting-periods/package.json`
- Create: `packages/accounting-periods/src/posting-window-error.ts`
- Create: `packages/accounting-periods/src/posting-window.ts`
- Test: `packages/accounting-periods/test/posting-window.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertPostingAllowed(input: PostingWindow): void`, where
  `PostingWindow = { effectiveDate: string; lockedThrough: string | null; hardLockedThrough: string | null }`;
  `PostingPeriodLockedError` with `code: "closed-period" | "hard-locked-period"` and fields `effectiveDate`, `lockedThrough`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/accounting-periods/test/posting-window.test.ts
import { describe, expect, it } from "vitest";
import { PostingPeriodLockedError } from "../src/posting-window-error.ts";
import { assertPostingAllowed } from "../src/posting-window.ts";

const open = { lockedThrough: null, hardLockedThrough: null };

describe("assertPostingAllowed", () => {
  it("permits any effective date when nothing is locked", () => {
    expect(() => assertPostingAllowed({ effectiveDate: "2020-01-01", ...open })).not.toThrow();
  });

  it("refuses a posting on the lock date itself", () => {
    expect(() =>
      assertPostingAllowed({
        effectiveDate: "2026-03-31",
        lockedThrough: "2026-03-31",
        hardLockedThrough: null,
      }),
    ).toThrow(PostingPeriodLockedError);
  });

  it("permits a posting the day after the lock date", () => {
    expect(() =>
      assertPostingAllowed({
        effectiveDate: "2026-04-01",
        lockedThrough: "2026-03-31",
        hardLockedThrough: null,
      }),
    ).not.toThrow();
  });

  it("reports closed-period with both dates so the caller can explain the refusal", () => {
    try {
      assertPostingAllowed({
        effectiveDate: "2026-02-14",
        lockedThrough: "2026-03-31",
        hardLockedThrough: null,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PostingPeriodLockedError);
      const locked = error as PostingPeriodLockedError;
      expect(locked.code).toBe("closed-period");
      expect(locked.effectiveDate).toBe("2026-02-14");
      expect(locked.lockedThrough).toBe("2026-03-31");
    }
  });

  it("distinguishes a hard lock, which no permission reopens", () => {
    try {
      assertPostingAllowed({
        effectiveDate: "2025-12-31",
        lockedThrough: null,
        hardLockedThrough: "2025-12-31",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as PostingPeriodLockedError).code).toBe("hard-locked-period");
    }
  });

  it("prefers the hard lock when both would refuse", () => {
    try {
      assertPostingAllowed({
        effectiveDate: "2025-06-30",
        lockedThrough: "2026-03-31",
        hardLockedThrough: "2025-12-31",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as PostingPeriodLockedError).code).toBe("hard-locked-period");
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @magna-carta/accounting-periods test`
Expected: FAIL — the package does not resolve (`Cannot find module '../src/posting-window.ts'`).

- [ ] **Step 3: Create the package manifest**

```json
{
  "name": "@magna-carta/accounting-periods",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./posting-window": "./src/posting-window.ts",
    "./posting-window-error": "./src/posting-window-error.ts"
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

No runtime dependencies. That is the point of the leaf: trust, billing, and the general ledger can all depend on it without any of them depending on each other.

- [ ] **Step 4: Write the error type**

```ts
// packages/accounting-periods/src/posting-window-error.ts

// Callers branch on `code`, never on the message text.
export type PostingWindowCode = "closed-period" | "hard-locked-period";

export class PostingPeriodLockedError extends Error {
  readonly code: PostingWindowCode;
  readonly effectiveDate: string;
  readonly lockedThrough: string;

  constructor(code: PostingWindowCode, effectiveDate: string, lockedThrough: string) {
    super(`effective date ${effectiveDate} falls in a closed period (locked through ${lockedThrough})`);
    this.name = "PostingPeriodLockedError";
    this.code = code;
    this.effectiveDate = effectiveDate;
    this.lockedThrough = lockedThrough;
  }
}
```

- [ ] **Step 5: Write the guard**

```ts
// packages/accounting-periods/src/posting-window.ts
import { PostingPeriodLockedError } from "./posting-window-error.ts";

// The lock is a monotonic high-water mark, not a set of period rows: every effective date at or
// before it is closed. Encoding it as a scalar makes "March closed while February is open"
// unrepresentable rather than merely forbidden.
export interface PostingWindow {
  readonly effectiveDate: string;
  readonly lockedThrough: string | null;
  // Refuses even with the reopen permission. No route sets this today; the comparison exists so a
  // jurisdiction demanding inalterability does not require touching every posting path.
  readonly hardLockedThrough: string | null;
}

// ISO-8601 calendar dates compare correctly as strings, which is why the ledger's own
// future-dating refusal is a plain string comparison too.
export function assertPostingAllowed(window: PostingWindow): void {
  const { effectiveDate, lockedThrough, hardLockedThrough } = window;

  // The hard lock is checked first: when both would refuse, the caller must learn the refusal is
  // not reopenable.
  if (hardLockedThrough !== null && effectiveDate <= hardLockedThrough) {
    throw new PostingPeriodLockedError("hard-locked-period", effectiveDate, hardLockedThrough);
  }
  if (lockedThrough !== null && effectiveDate <= lockedThrough) {
    throw new PostingPeriodLockedError("closed-period", effectiveDate, lockedThrough);
  }
}
```

- [ ] **Step 6: Install and run the tests**

Run: `vp install && pnpm --filter @magna-carta/accounting-periods test`
Expected: PASS — 6 tests.

- [ ] **Step 7: Quality gate**

Run: `pnpm check`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/accounting-periods
git commit -F - <<'MESSAGE'
feat(accounting-periods): guard postings against a closed fiscal period

A pure leaf that trust, billing, and the general ledger all call before
composing a posting. The lock is a monotonic scalar, so a closed period can
never sit above an open one. Reversals stay possible because reverseEntry
takes a fresh effective date rather than copying the original's.
MESSAGE
```

---

### Task 2: Chart columns and posting dimensions

**Files:**
- Modify: `packages/database/src/per-firm-schema.ts` (`ledgerAccount`, `ledgerLine`)
- Create: `packages/database/drizzle/per-firm/<generated>.sql`
- Modify: `apps/worker/src/per-firm-migrations.ts`
- Test: `packages/database/test/chart-of-accounts-migration.test.ts`

**Interfaces:**
- Produces: `ledger_account.code`, `.semantic_key`, `.statement_section`, `.system_account`; `ledger_line.matter_id`, `.location_id`.

- [ ] **Step 1: Write the failing migration test**

```ts
// packages/database/test/chart-of-accounts-migration.test.ts
import { describe, expect, it } from "vitest";
import { applyPerFirmMigrations, openTestDatabase } from "./support/per-firm-database.ts";

describe("chart-of-accounts columns", () => {
  it("accepts a semantic key on an account", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    database
      .prepare(
        `INSERT INTO ledger_account (id, name, type, currency, parent_account_id, active, created_at, code, semantic_key, statement_section, system_account)
         VALUES ('ledgerAccount_a', 'Accounts Receivable', 'asset', 'USD', NULL, 1, '2026-07-09T00:00:00Z', '1300', 'accountsReceivable', 'current_asset', 1)`,
      )
      .run();
    const row = database
      .prepare(`SELECT semantic_key, system_account FROM ledger_account WHERE id = 'ledgerAccount_a'`)
      .get() as { semantic_key: string; system_account: number };
    expect(row.semantic_key).toBe("accountsReceivable");
    expect(row.system_account).toBe(1);
  });

  it("refuses two accounts sharing a semantic key", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const insert = (id: string) =>
      database
        .prepare(
          `INSERT INTO ledger_account (id, name, type, currency, parent_account_id, active, created_at, semantic_key)
           VALUES (?, 'Fee Income', 'income', 'USD', NULL, 1, '2026-07-09T00:00:00Z', 'feeIncome')`,
        )
        .run(id);
    insert("ledgerAccount_b");
    expect(() => insert("ledgerAccount_c")).toThrow(/UNIQUE/);
  });

  it("allows many accounts with no semantic key", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const insert = (id: string) =>
      database
        .prepare(
          `INSERT INTO ledger_account (id, name, type, currency, parent_account_id, active, created_at, semantic_key)
           VALUES (?, 'Sundry', 'expense', 'USD', NULL, 1, '2026-07-09T00:00:00Z', NULL)`,
        )
        .run(id);
    insert("ledgerAccount_d");
    expect(() => insert("ledgerAccount_e")).not.toThrow();
  });

  it("carries matter and location dimensions on a line", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const columns = database.prepare(`PRAGMA table_info(ledger_line)`).all() as { name: string }[];
    const names = columns.map((column) => column.name);
    expect(names).toContain("matter_id");
    expect(names).toContain("location_id");
  });
});
```

The partial unique index — unique where non-null — is what lets an unlimited number of ordinary accounts carry no semantic key while the well-known ones stay unique. `matter.matter_number` already uses this shape.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @magna-carta/database test chart-of-accounts-migration`
Expected: FAIL — `table ledger_account has no column named semantic_key`.

- [ ] **Step 3: Add the chart columns to `ledgerAccount`**

Inside the `ledgerAccount` column object, after `createdAt`:

```ts
    // The chart-of-accounts product. Normal balance stays derived from `type` in code — these
    // columns classify and address an account, they never restate its arithmetic.
    code: text("code"), // account number; firms renumber freely, so this is not an identity
    // The rename-proof handle a posting service resolves. Firms rename "Fee Income" at will; the
    // key `feeIncome` is what the finalize path actually looks up.
    semanticKey: text("semantic_key"),
    statementSection: text("statement_section"), // drives balance-sheet / income-statement placement
    systemAccount: integer("system_account").notNull().default(0), // seeded; renameable, never deactivated
```

And in the table's index array:

```ts
    // Unique only where present: the well-known accounts are addressable, ordinary accounts are
    // unconstrained. Mirrors the matter_number partial index.
    uniqueIndex("ledger_account_semantic_key_unique_index")
      .on(table.semanticKey)
      .where(sql`${table.semanticKey} IS NOT NULL`),
    check("ledger_account_system_account_check", sql`${table.systemAccount} IN (0, 1)`),
```

- [ ] **Step 4: Add the dimensions to `ledgerLine`**

Inside the `ledgerLine` column object, after `amountMinor`:

```ts
    // Posting dimensions. They segment; they do not constrain. A per-client trust subledger stays a
    // child account row because the no-negative bound is a CHECK on that account's balance row, and
    // a dimension column cannot carry one. These serve matter profitability, per-office roll-ups,
    // and the per-matter advanced-cost subledger. Dimensions sit on the LINE because one vendor
    // bill can carry lines for two matters.
    matterId: text("matter_id")
      .$type<MatterId>()
      .references(() => matter.id),
    locationId: text("location_id")
      .$type<LocationId>()
      .references(() => location.id),
```

And in the index array:

```ts
    index("ledger_line_matter_id_index").on(table.matterId),
    index("ledger_line_location_id_index").on(table.locationId),
```

- [ ] **Step 5: Generate and register the migration**

```bash
pnpm --filter @magna-carta/database run generate-per-firm-migrations
```

The generator stamps a monotonic UTC-timestamp identifier automatically (`scripts/timestamp-latest-migration.mjs`); never hand-name the file. Note the generated basename, then add it to `apps/worker/src/per-firm-migrations.ts` — one import plus one entry in the `migrationsFromJournal` map, keyed by the identifier. `migrationsFromJournal` fails loud when the journal gains a migration the map does not carry, so a missed registration surfaces immediately.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS, including `schema-conformance` (no new column trips the money-name gate: `code`, `semantic_key`, `statement_section`, `system_account`, `matter_id`, `location_id` all pass).

- [ ] **Step 7: Quality gate and commit**

```bash
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(database): add chart-of-accounts columns and posting dimensions

ledger_account gains code, semantic_key, statement_section, and
system_account without widening the five-value type CHECK; normal balance
stays derived in code. ledger_line gains nullable matter_id and location_id.

Accounts enforce bounds, dimensions enable segmentation. The trust subledger
keeps its child accounts because the no-negative bound is a CHECK on an
account's balance row, which a dimension column cannot carry.
MESSAGE
```

---

### Task 3: The general-ledger package and the account resolver

**Files:**
- Create: `packages/general-ledger/package.json`, `packages/general-ledger/src/general-ledger-validation.ts`, `packages/general-ledger/src/chart-statements.ts`, `packages/general-ledger/src/account-resolver.ts`
- Test: `packages/general-ledger/test/account-resolver.test.ts`

**Interfaces:**
- Consumes: Task 2's `ledger_account.semantic_key`.
- Produces: `SEMANTIC_ACCOUNT_KEYS` (readonly tuple), `type SemanticAccountKey`, `resolveAccount(database, key): Promise<LedgerAccountId>`, `GeneralLedgerValidationError` with `code: "unknown-semantic-account" | "closed-period" | "hard-locked-period" | "unbalanced-bill" | "unknown-account"`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/general-ledger/test/account-resolver.test.ts
import { describe, expect, it } from "vitest";
import { GeneralLedgerValidationError } from "../src/general-ledger-validation.ts";
import { resolveAccount } from "../src/account-resolver.ts";
import { openSeededDatabase } from "./support/database.ts";

describe("resolveAccount", () => {
  it("finds a seeded account by its semantic key", async () => {
    const database = await openSeededDatabase();
    const accountId = await resolveAccount(database, "accountsReceivable");
    expect(accountId).toMatch(/^ledgerAccount_/);
  });

  it("still finds the account after the firm renames it", async () => {
    const database = await openSeededDatabase();
    database
      .prepare(`UPDATE ledger_account SET name = 'Client Receivables' WHERE semantic_key = 'accountsReceivable'`)
      .run();
    await expect(resolveAccount(database, "accountsReceivable")).resolves.toMatch(/^ledgerAccount_/);
  });

  it("refuses an unknown key rather than returning null", async () => {
    const database = await openSeededDatabase();
    await expect(resolveAccount(database, "accountsReceivable" as never)).resolves.toBeDefined();
    database.prepare(`DELETE FROM ledger_account WHERE semantic_key = 'accountsReceivable'`).run();
    await expect(resolveAccount(database, "accountsReceivable")).rejects.toThrow(
      GeneralLedgerValidationError,
    );
  });
});
```

The resolver throws rather than returning `null` because every caller is posting money and none can proceed without an account. A nullable return would push that decision to call sites that have no better answer.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @magna-carta/general-ledger test`
Expected: FAIL — package does not resolve.

- [ ] **Step 3: Create the package manifest**

```json
{
  "name": "@magna-carta/general-ledger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./account-resolver": "./src/account-resolver.ts",
    "./chart-statements": "./src/chart-statements.ts",
    "./fitness": "./src/fitness.ts",
    "./general-ledger-validation": "./src/general-ledger-validation.ts",
    "./period-service": "./src/period-service.ts",
    "./period-statements": "./src/period-statements.ts",
    "./product-chart": "./src/product-chart.ts",
    "./statement-read-models": "./src/statement-read-models.ts",
    "./vendor-bill-service": "./src/vendor-bill-service.ts",
    "./vendor-bill-statements": "./src/vendor-bill-statements.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/accounting-periods": "workspace:*",
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/ledger": "workspace:*",
    "@magna-carta/money": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/database": "workspace:*",
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

`@magna-carta/costs` is deliberately absent. The vendor-bill-to-cost-entry link is composed by the route, not by this package.

- [ ] **Step 4: Write the domain error**

```ts
// packages/general-ledger/src/general-ledger-validation.ts

export type GeneralLedgerValidationCode =
  | "unknown-semantic-account"
  | "closed-period"
  | "hard-locked-period"
  | "unbalanced-bill"
  | "unknown-account";

export class GeneralLedgerValidationError extends Error {
  readonly code: GeneralLedgerValidationCode;

  constructor(code: GeneralLedgerValidationCode, message: string) {
    super(message);
    this.name = "GeneralLedgerValidationError";
    this.code = code;
  }
}
```

- [ ] **Step 5: Write the chart statements**

```ts
// packages/general-ledger/src/chart-statements.ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

export const LEDGER_ACCOUNT_TABLE = "ledger_account";

export function selectAccountBySemanticKeyStatement(
  database: SqlDatabase,
  semanticKey: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id FROM ${LEDGER_ACCOUNT_TABLE} WHERE semantic_key = ?1 AND active = 1`,
    )
    .bind(semanticKey);
}
```

- [ ] **Step 6: Write the resolver**

```ts
// packages/general-ledger/src/account-resolver.ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import { selectAccountBySemanticKeyStatement } from "./chart-statements.ts";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";

// The well-known accounts a posting service addresses by meaning rather than by id. A firm may
// rename or renumber any of them; the key is what stays stable.
export const SEMANTIC_ACCOUNT_KEYS = [
  "operatingCash",
  "trustCash",
  "accountsReceivable",
  "clientCostsAdvanced",
  "accountsPayable",
  "clientTrustLiability",
  "ownersEquity",
  "feeIncome",
  "costRecoveryIncome",
  "taxPayable",
] as const;

export type SemanticAccountKey = (typeof SEMANTIC_ACCOUNT_KEYS)[number];

// Throws rather than returning null: every caller is posting money and none can proceed without an
// account, so a nullable return would only push the decision somewhere with less context.
export async function resolveAccount(
  database: SqlDatabase,
  semanticKey: SemanticAccountKey,
): Promise<LedgerAccountId> {
  const row = await selectAccountBySemanticKeyStatement(database, semanticKey).first<{
    id: string;
  }>();
  if (!row) {
    throw new GeneralLedgerValidationError(
      "unknown-semantic-account",
      `no active account carries the semantic key ${semanticKey}`,
    );
  }
  return row.id as LedgerAccountId;
}
```

- [ ] **Step 7: Run the tests**

Run: `vp install && pnpm --filter @magna-carta/general-ledger test`
Expected: PASS — 3 tests.

- [ ] **Step 8: Quality gate and commit**

```bash
pnpm check
git add packages/general-ledger
git commit -F - <<'MESSAGE'
feat(general-ledger): resolve well-known accounts by semantic key

A firm renames "Fee Income" freely; the posting path looks up `feeIncome`.
The resolver throws on an unknown key rather than returning null, because
every caller is posting money and none can proceed without an account.
MESSAGE
```

---

### Task 4: The product chart and its seeding

**Files:**
- Create: `packages/general-ledger/src/product-chart.ts`
- Test: `packages/general-ledger/test/product-chart.test.ts`

**Interfaces:**
- Consumes: `SEMANTIC_ACCOUNT_KEYS` (Task 3), `createAccount` from `@magna-carta/ledger/create-account`.
- Produces: `PRODUCT_CHART: readonly ProductChartAccount[]`, `seedProductChart(database, options): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/general-ledger/test/product-chart.test.ts
import { describe, expect, it } from "vitest";
import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
import { SEMANTIC_ACCOUNT_KEYS } from "../src/account-resolver.ts";
import { PRODUCT_CHART, seedProductChart } from "../src/product-chart.ts";
import { openMigratedDatabase, testOptions } from "./support/database.ts";

describe("the product chart", () => {
  it("defines an account for every semantic key", () => {
    const seeded = new Set(PRODUCT_CHART.flatMap((a) => (a.semanticKey ? [a.semanticKey] : [])));
    for (const key of SEMANTIC_ACCOUNT_KEYS) expect(seeded).toContain(key);
  });

  it("declares every parent before its children", () => {
    const seen = new Set<string>();
    for (const account of PRODUCT_CHART) {
      if (account.parentKey) expect(seen).toContain(account.parentKey);
      seen.add(account.key);
    }
  });

  it("treats hard costs as an asset, never an expense", () => {
    const advanced = PRODUCT_CHART.find((a) => a.semanticKey === "clientCostsAdvanced");
    expect(advanced?.type).toBe("asset");
  });

  it("seeds a chart that satisfies the ledger fitness proof", async () => {
    const database = await openMigratedDatabase();
    await seedProductChart(database, testOptions());
    await expect(assertLedgerFitness(database)).resolves.toBeUndefined();
  });

  it("marks every semantically-keyed account as a system account", async () => {
    const database = await openMigratedDatabase();
    await seedProductChart(database, testOptions());
    const rows = database
      .prepare(`SELECT system_account FROM ledger_account WHERE semantic_key IS NOT NULL`)
      .all() as { system_account: number }[];
    expect(rows.length).toBe(SEMANTIC_ACCOUNT_KEYS.length);
    expect(rows.every((row) => row.system_account === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @magna-carta/general-ledger test product-chart`
Expected: FAIL — `Cannot find module '../src/product-chart.ts'`.

- [ ] **Step 3: Write the chart**

```ts
// packages/general-ledger/src/product-chart.ts
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createAccount, type CreateAccountOptions } from "@magna-carta/ledger/create-account";
import type { AccountType } from "@magna-carta/ledger/types";
import type { SemanticAccountKey } from "./account-resolver.ts";

export interface ProductChartAccount {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly statementSection: string;
  readonly semanticKey?: SemanticAccountKey;
  readonly parentKey?: string;
}

// A default, not a lock. Firms rename, renumber, add, and deactivate non-system accounts. No
// canonical industry numbering exists — published law-firm charts agree on the account set and
// disagree on the numbers — so this scheme is ours and firms may replace it.
//
// Client Costs Advanced is an ASSET. A hard cost paid on a client's behalf is an advance
// recoverable from the client, not the firm's expense; booking it to expense misstates both the
// balance sheet and the firm's deductions. Soft costs, which the firm consumes regardless, are
// ordinary expenses whose reimbursement is income.
//
// Parents must precede children: seeding walks this list in order.
export const PRODUCT_CHART: readonly ProductChartAccount[] = [
  { key: "operatingCash", code: "1000", name: "Operating Bank Account", type: "asset", statementSection: "current_asset", semanticKey: "operatingCash" },
  { key: "clientCostsAdvanced", code: "1200", name: "Client Costs Advanced", type: "asset", statementSection: "current_asset", semanticKey: "clientCostsAdvanced" },
  { key: "accountsReceivable", code: "1300", name: "Accounts Receivable", type: "asset", statementSection: "current_asset", semanticKey: "accountsReceivable" },
  { key: "trustCash", code: "1900", name: "Client Trust Account", type: "asset", statementSection: "trust_asset", semanticKey: "trustCash" },

  { key: "accountsPayable", code: "2000", name: "Accounts Payable", type: "liability", statementSection: "current_liability", semanticKey: "accountsPayable" },
  { key: "taxPayable", code: "2200", name: "Taxes Payable", type: "liability", statementSection: "current_liability", semanticKey: "taxPayable" },
  // Per-client trust subledgers are created as children of this account. The no-negative bound is a
  // CHECK on each child's balance row, which is why the subledger is accounts rather than a dimension.
  { key: "clientTrustLiability", code: "2900", name: "Client Trust Funds Held", type: "liability", statementSection: "trust_liability", semanticKey: "clientTrustLiability" },

  { key: "ownersEquity", code: "3000", name: "Owners Equity", type: "equity", statementSection: "equity", semanticKey: "ownersEquity" },

  { key: "feeIncome", code: "4000", name: "Fee Income", type: "income", statementSection: "revenue", semanticKey: "feeIncome" },
  { key: "costRecoveryIncome", code: "4200", name: "Cost Recovery Income", type: "income", statementSection: "revenue", semanticKey: "costRecoveryIncome" },

  { key: "rent", code: "5000", name: "Rent", type: "expense", statementSection: "operating_expense" },
  { key: "salaries", code: "5100", name: "Salaries", type: "expense", statementSection: "operating_expense" },
  { key: "copyingAndPrinting", code: "5200", name: "Copying and Printing", type: "expense", statementSection: "operating_expense" },
  { key: "barDues", code: "5300", name: "Bar Dues", type: "expense", statementSection: "operating_expense" },
];

// Seeds through createAccount, never a raw INSERT, so the leaf-only and parent-match guards run.
export async function seedProductChart(
  database: BatchDatabase,
  options: CreateAccountOptions,
): Promise<Map<string, string>> {
  const identifiers = new Map<string, string>();
  for (const account of PRODUCT_CHART) {
    const parentAccountId = account.parentKey ? identifiers.get(account.parentKey) ?? null : null;
    const created = await createAccount(
      database,
      {
        name: account.name,
        type: account.type,
        currency: "USD",
        parentAccountId: parentAccountId as never,
        code: account.code,
        semanticKey: account.semanticKey ?? null,
        statementSection: account.statementSection,
        systemAccount: account.semanticKey !== undefined,
      },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: options.clock.now });
    identifiers.set(account.key, created.accountId);
  }
  return identifiers;
}
```

- [ ] **Step 4: Extend `createAccount` to carry the new columns**

`packages/ledger/src/create-account.ts` and `packages/ledger/src/statements.ts` must accept and persist `code`, `semanticKey`, `statementSection`, and `systemAccount`. Add them to `InsertAccountRow` and to `insertAccountStatement`'s column list and bindings, and to `CreateAccountInput`. All four are optional on the input and default to `null` / `false`, so existing callers — fixtures, the demo chart — compile unchanged.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @magna-carta/general-ledger test && pnpm --filter @magna-carta/ledger test`
Expected: PASS. The ledger suite must stay green — the new parameters are additive.

- [ ] **Step 6: Quality gate and commit**

```bash
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(general-ledger): seed a forkable law-firm chart of accounts

A default, not a lock: firms rename, renumber, add, and deactivate non-system
accounts, and the semantic keys keep the well-known ones findable afterwards.

Client Costs Advanced is an asset. A hard cost paid on a client's behalf is an
advance recoverable from the client, not the firm's expense.

Seeds through createAccount so the leaf-only and parent-match guards run.
MESSAGE
```

---

### Task 5: Period-lock schema

**Files:**
- Modify: `packages/database/src/per-firm-schema.ts` (add `accountingLock`, `periodCloseEvent`)
- Modify: `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`
- Modify: `apps/worker/src/per-firm-migrations.ts`
- Test: `packages/database/test/period-close-migration.test.ts`

**Interfaces:**
- Produces: tables `accounting_lock` (single row) and `period_close_event` (append-only); `PeriodCloseEventId`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/test/period-close-migration.test.ts
import { describe, expect, it } from "vitest";
import { applyPerFirmMigrations, openTestDatabase } from "./support/per-firm-database.ts";

describe("period-close schema", () => {
  it("holds at most one accounting_lock row", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const insert = () =>
      database.prepare(`INSERT INTO accounting_lock (id, locked_through, hard_locked_through, updated_at) VALUES (1, NULL, NULL, '2026-07-09T00:00:00Z')`).run();
    insert();
    expect(insert).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it("refuses an unknown close action", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    expect(() =>
      database
        .prepare(
          `INSERT INTO period_close_event (id, action, closed_through, previous_locked_through, actor_user_id, reason, created_at)
           VALUES ('periodCloseEvent_a', 'unlock', '2026-03-31', NULL, 'user_a', NULL, '2026-07-09T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it("accepts close and reopen", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    for (const [id, action] of [["periodCloseEvent_b", "close"], ["periodCloseEvent_c", "reopen"]]) {
      expect(() =>
        database
          .prepare(
            `INSERT INTO period_close_event (id, action, closed_through, previous_locked_through, actor_user_id, reason, created_at)
             VALUES (?, ?, '2026-03-31', NULL, 'user_a', 'month end', '2026-07-09T00:00:00Z')`,
          )
          .run(id, action),
      ).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @magna-carta/database test period-close-migration`
Expected: FAIL — `no such table: accounting_lock`.

- [ ] **Step 3: Add the tables**

```ts
// The lock is one row. A firm setting would be reachable by the generic settings route, and a lock
// any settings write can move is not a lock — this table is written only by the close service.
export const accountingLock = sqliteTable(
  "accounting_lock",
  {
    id: integer("id").primaryKey(), // always 1 — one book per firm database
    lockedThrough: text("locked_through"), // ISO date; every effective date at or before is closed
    hardLockedThrough: text("hard_locked_through"), // no permission reopens this; unset today
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("accounting_lock_single_row_check", sql`${table.id} = 1`)],
);

// Append-only. The scalar above is what enforcement reads; this is who closed what, when, and why.
export const periodCloseEvent = sqliteTable(
  "period_close_event",
  {
    id: text("id").primaryKey().$type<PeriodCloseEventId>(),
    action: text("action", { enum: ["close", "reopen"] }).notNull(),
    closedThrough: text("closed_through").notNull(),
    previousLockedThrough: text("previous_locked_through"),
    actorUserId: text("actor_user_id").notNull().$type<UserId>(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("period_close_event_action_check", sql`${table.action} IN ('close', 'reopen')`),
    index("period_close_event_created_at_index").on(table.createdAt),
  ],
);
```

- [ ] **Step 4: Add the identifier**

In `packages/identifiers/src/registry.ts`, add `periodCloseEvent: "periodCloseEvent",` to `ENTITY_PREFIXES` — the prefix equals the key, spelled out in full. In `types.ts`, add `export type PeriodCloseEventId = Identifier<"periodCloseEvent">;`.

- [ ] **Step 5: Generate, register, test, commit**

```bash
pnpm --filter @magna-carta/database run generate-per-firm-migrations
# add the generated file to apps/worker/src/per-firm-migrations.ts
pnpm --filter @magna-carta/database test
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(database): add the accounting lock and its append-only close log

The lock is a scalar high-water mark, so a closed period can never sit above
an open one. The event log carries who closed what, when, and why; the scalar
is what every posting path reads.
MESSAGE
```

---

### Task 6: The close service and the period fitness proof

**Files:**
- Create: `packages/general-ledger/src/period-statements.ts`, `packages/general-ledger/src/period-service.ts`, `packages/general-ledger/src/fitness.ts`
- Test: `packages/general-ledger/test/period-service.test.ts`

**Interfaces:**
- Consumes: `assertPostingAllowed` (Task 1), `accounting_lock` (Task 5).
- Produces: `loadPostingWindow(database, effectiveDate): Promise<PostingWindow>`, `closePeriod(database, input, options)`, `reopenPeriod(database, input, options)`, `entriesInClosedPeriodStatement(database)`, `assertGeneralLedgerFitness(database)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/general-ledger/test/period-service.test.ts
import { describe, expect, it } from "vitest";
import { PostingPeriodLockedError } from "@magna-carta/accounting-periods/posting-window-error";
import { assertPostingAllowed } from "@magna-carta/accounting-periods/posting-window";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { closePeriod, loadPostingWindow, reopenPeriod } from "../src/period-service.ts";
import { openMigratedDatabase, testOptions } from "./support/database.ts";

describe("period close", () => {
  it("reports an open window before any close", async () => {
    const database = await openMigratedDatabase();
    const window = await loadPostingWindow(database, "2020-01-01");
    expect(window.lockedThrough).toBeNull();
    expect(() => assertPostingAllowed(window)).not.toThrow();
  });

  it("closes a period and refuses a posting inside it", async () => {
    const database = await openMigratedDatabase();
    const { effect } = await closePeriod(database, { closedThrough: "2026-03-31", reason: "month end" }, testOptions());
    await commitEffectBatch(database, effect, { now: () => "2026-04-01T00:00:00Z" });

    const inside = await loadPostingWindow(database, "2026-03-15");
    expect(() => assertPostingAllowed(inside)).toThrow(PostingPeriodLockedError);

    const after = await loadPostingWindow(database, "2026-04-02");
    expect(() => assertPostingAllowed(after)).not.toThrow();
  });

  it("reopens, restoring the previous lock, and logs both events", async () => {
    const database = await openMigratedDatabase();
    const closed = await closePeriod(database, { closedThrough: "2026-03-31", reason: "month end" }, testOptions());
    await commitEffectBatch(database, closed.effect, { now: () => "2026-04-01T00:00:00Z" });
    const reopened = await reopenPeriod(database, { reopenTo: null, reason: "late adjustment" }, testOptions());
    await commitEffectBatch(database, reopened.effect, { now: () => "2026-04-02T00:00:00Z" });

    const window = await loadPostingWindow(database, "2026-03-15");
    expect(window.lockedThrough).toBeNull();

    const events = database.prepare(`SELECT action FROM period_close_event ORDER BY created_at`).all() as { action: string }[];
    expect(events.map((event) => event.action)).toEqual(["close", "reopen"]);
  });

  it("refuses to close backwards, since the lock is a high-water mark", async () => {
    const database = await openMigratedDatabase();
    const closed = await closePeriod(database, { closedThrough: "2026-03-31", reason: null }, testOptions());
    await commitEffectBatch(database, closed.effect, { now: () => "2026-04-01T00:00:00Z" });
    await expect(
      closePeriod(database, { closedThrough: "2026-02-28", reason: null }, testOptions()),
    ).rejects.toThrow(/high-water|already closed/i);
  });
});
```

The backwards-close refusal is what keeps the scalar monotonic. Moving the lock *back* is a reopen, which is a separate, separately-permissioned operation with its own audit row.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @magna-carta/general-ledger test period-service`
Expected: FAIL — `Cannot find module '../src/period-service.ts'`.

- [ ] **Step 3: Write `period-statements.ts`**

Statement builders: `selectAccountingLockStatement` (`SELECT locked_through, hard_locked_through FROM accounting_lock WHERE id = 1`); `upsertAccountingLockStatement` (`INSERT INTO accounting_lock (id, locked_through, hard_locked_through, updated_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET locked_through = ?1, updated_at = ?3`); `insertPeriodCloseEventStatement`. Keeping the SQL here puts it inside the schema-name-sync net.

- [ ] **Step 4: Write `period-service.ts`**

`loadPostingWindow(database, effectiveDate)` reads the lock row (absent row means nothing is locked) and returns a `PostingWindow`. `closePeriod` reads the current lock, throws `GeneralLedgerValidationError("closed-period", …)` when `closedThrough <= lockedThrough` (the high-water rule), then composes the upsert plus a `close` event row into one `EffectWrite`. `reopenPeriod` composes the upsert to the new, earlier value plus a `reopen` event carrying `previous_locked_through`. Both take `options.actorUserId` and write it to the event; neither reads a clock.

- [ ] **Step 5: Write `fitness.ts`**

```ts
// packages/general-ledger/src/fitness.ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Zero rows = healthy, matching the ledger's own fitness convention.

// The lock is read before the batch composes, so a close committing in between is a
// time-of-check race that no cross-row predicate can abort inside a D1 batch. This is where that
// corruption surfaces.
export function entriesInClosedPeriodStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT e.id, e.effective_date FROM ledger_entry e
       JOIN accounting_lock l ON l.id = 1
       WHERE l.locked_through IS NOT NULL AND e.effective_date <= l.locked_through`,
    )
    .bind();
}

// A hard-cost bill line must carry the cost entry that makes it billable. The two rows are written
// in one batch, so a row here means a call site composed the ledger statements and omitted the
// cost capture — a coding error, not drift.
export function hardCostLinesWithoutDisbursementEntryStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT id FROM vendor_bill_line WHERE disbursement_class = 'hard' AND disbursement_entry_id IS NULL`,
    )
    .bind();
}

const FITNESS_STATEMENTS = [
  ["entries in a closed period", entriesInClosedPeriodStatement],
  ["hard-cost lines without a disbursement entry", hardCostLinesWithoutDisbursementEntryStatement],
] as const;

export async function assertGeneralLedgerFitness(database: SqlDatabase): Promise<void> {
  for (const [name, statement] of FITNESS_STATEMENTS) {
    const { results } = await statement(database).all();
    if (results.length > 0) {
      throw new Error(`general-ledger fitness failed: ${name} returned ${results.length} row(s)`);
    }
  }
}
```

The second query is written now and only becomes reachable once Task 7 creates `vendor_bill_line`; sequence Task 7 before running the full fitness proof.

- [ ] **Step 6: Run, gate, commit**

```bash
pnpm --filter @magna-carta/general-ledger test
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(general-ledger): close and reopen fiscal periods

Closing moves a monotonic scalar forward and appends an audit event; reopening
moves it back under a separate permission and appends its own. Closing
backwards is refused, which is what keeps the scalar a high-water mark.

A fitness query re-proves table-wide that no entry sits in a closed period,
because the guard reads before its batch commits and no cross-row predicate
can abort a D1 batch.
MESSAGE
```

---

### Task 7: Accounts-payable schema

**Files:**
- Modify: `packages/database/src/per-firm-schema.ts` (add `vendorBill`, `vendorBillLine`; widen `costEntry.source`)
- Modify: `packages/identifiers/src/registry.ts`, `src/types.ts`
- Modify: `apps/worker/src/per-firm-migrations.ts`
- Test: `packages/database/test/vendor-bill-migration.test.ts`

**Interfaces:**
- Produces: tables `vendor_bill`, `vendor_bill_line`; `VendorBillId`, `VendorBillLineId`; `cost_entry.source` accepts `vendorBill`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/test/vendor-bill-migration.test.ts
import { describe, expect, it } from "vitest";
import { applyPerFirmMigrations, openTestDatabase } from "./support/per-firm-database.ts";

describe("vendor bill schema", () => {
  it("refuses an unknown disbursement class", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    expect(() =>
      database
        .prepare(
          `INSERT INTO vendor_bill_line (id, vendor_bill_id, line_index, amount_minor, disbursement_class, matter_id, disbursement_entry_id, ledger_account_id, description)
           VALUES ('vendorBillLine_a', 'vendorBill_a', 0, 100, 'capital', NULL, NULL, 'ledgerAccount_a', '')`,
        )
        .run(),
    ).toThrow(/CHECK|FOREIGN KEY/);
  });

  it("accepts vendorBill as a cost-entry source", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const sources = database
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cost_entry'`)
      .get() as { sql: string };
    expect(sources.sql).toContain("vendorBill");
  });

  it("refuses a non-USD bill", async () => {
    const database = openTestDatabase();
    await applyPerFirmMigrations(database);
    const columns = database.prepare(`PRAGMA table_info(vendor_bill)`).all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("amount_minor");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @magna-carta/database test vendor-bill-migration`
Expected: FAIL — `no such table: vendor_bill_line`.

- [ ] **Step 3: Add the tables**

`vendorBill`: `id`, `vendorId` (nullable Directory entity id, matching `cost_entry.vendor_id`'s shape), `billNumber`, `billDate`, `dueDate`, `amountMinor`, `currency` (CHECK `IN ('USD')`), `status` (CHECK `IN ('draft','posted','paid','void')`), `ledgerEntryId` (references `ledgerEntry.id`, nullable until posted), `createdAt`, `updatedAt`, `createdBy`.

`vendorBillLine`: `id`, `vendorBillId` (references `vendorBill.id`), `lineIndex`, `amountMinor`, `disbursementClass` (CHECK `IN ('hard','soft')`), `matterId` (nullable, references `matter.id`), `disbursementEntryId` (nullable, references `costEntry.id`), `ledgerAccountId` (references `ledgerAccount.id`), `description`. Unique index on `(vendorBillId, lineIndex)`; CHECK `amountMinor > 0`.

Name the link `disbursement_entry_id`, not `cost_entry_id`: the schema conformance gate refuses any column matching `(amount|balance|total|price|fee|cost)(_|$)` unless it ends in `_minor`. Slice 3·3 named `disbursement_class` for the same reason.

- [ ] **Step 4: Widen the cost-entry source CHECK**

Change the `costEntry.source` enum and CHECK to `IN ('manual','grid','recovery','vendorBill')`. This is an expand-contract widening of a CHECK on a table slice 3·3 owns; it admits a value and forbids nothing that was previously legal. SQLite cannot alter a CHECK in place, so drizzle-kit will emit a table rebuild — inspect the generated SQL and confirm it preserves every existing row and index before registering it.

- [ ] **Step 5: Add the identifiers**

`vendorBill` and `vendorBillLine` in `ENTITY_PREFIXES`, plus `VendorBillId` / `VendorBillLineId` in `types.ts`.

- [ ] **Step 6: Generate, register, test, gate, commit**

```bash
pnpm --filter @magna-carta/database run generate-per-firm-migrations
# inspect the generated rebuild of cost_entry before registering it
pnpm --filter @magna-carta/database test
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(database): add vendor bills and widen the cost-entry source

vendor_bill records what the firm owes a vendor; cost_entry records what the
firm may bill a client. Slice 3·3 already models the vendor link and the
disbursement class, so these tables reuse rather than restate them.

The link column is disbursement_entry_id, not cost_entry_id: the schema
conformance gate refuses money-ish column names lacking a storage suffix.
MESSAGE
```

---

### Task 8: The vendor-bill service and disbursement routing

**Files:**
- Create: `packages/general-ledger/src/vendor-bill-statements.ts`, `packages/general-ledger/src/vendor-bill-service.ts`
- Test: `packages/general-ledger/test/vendor-bill-service.test.ts`

**Interfaces:**
- Consumes: `resolveAccount` (Task 3), `loadPostingWindow` (Task 6), `postEntry` from `@magna-carta/ledger/post-entry`.
- Produces: `recordVendorBill(database, input, options)` returning
  `Promise<{ vendorBillId: VendorBillId; ledgerEntryId: LedgerEntryId; hardCostLines: readonly HardCostLine[]; effect: EffectWrite }>`,
  where `HardCostLine = { vendorBillLineId: VendorBillLineId; matterId: MatterId; amountMinor: number; description: string }`.
  Each input line is `{ amountMinor: number; disbursementClass: "hard" | "soft"; matterId: MatterId | null; expenseAccountId?: LedgerAccountId; description: string }`.

  `hardCostLines` exists so Task 11's route can capture one cost entry per hard line and link it back,
  without re-deriving which lines were hard. A soft line never appears here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/general-ledger/test/vendor-bill-service.test.ts
import { describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { PostingPeriodLockedError } from "@magna-carta/accounting-periods/posting-window-error";
import { resolveAccount } from "../src/account-resolver.ts";
import { recordVendorBill } from "../src/vendor-bill-service.ts";
import { balanceOf, openSeededDatabase, testOptions } from "./support/database.ts";

const hardCostBill = {
  vendorId: null,
  billNumber: "INV-1",
  billDate: "2026-05-01",
  dueDate: "2026-05-31",
  effectiveDate: "2026-05-01",
  lines: [
    { amountMinor: 200_000, disbursementClass: "hard" as const, matterId: "matter_smith", description: "expert witness" },
  ],
};

describe("recordVendorBill", () => {
  it("debits Client Costs Advanced for a hard cost, never an expense", async () => {
    const database = await openSeededDatabase();
    const { effect } = await recordVendorBill(database, hardCostBill, testOptions());
    await commitEffectBatch(database, effect, { now: () => "2026-05-01T00:00:00Z" });

    const advanced = await resolveAccount(database, "clientCostsAdvanced");
    const payable = await resolveAccount(database, "accountsPayable");
    expect(await balanceOf(database, advanced)).toBe(200_000);
    expect(await balanceOf(database, payable)).toBe(200_000);
  });

  it("leaves the profit-and-loss untouched for a hard cost", async () => {
    const database = await openSeededDatabase();
    const { effect } = await recordVendorBill(database, hardCostBill, testOptions());
    await commitEffectBatch(database, effect, { now: () => "2026-05-01T00:00:00Z" });

    const income = database
      .prepare(
        `SELECT COALESCE(SUM(b.balance_minor), 0) AS total FROM account_balance b
         JOIN ledger_account a ON a.id = b.account_id WHERE a.type IN ('income', 'expense')`,
      )
      .get() as { total: number };
    expect(income.total).toBe(0);
  });

  it("tags the hard-cost line with its matter", async () => {
    const database = await openSeededDatabase();
    const { effect } = await recordVendorBill(database, hardCostBill, testOptions());
    await commitEffectBatch(database, effect, { now: () => "2026-05-01T00:00:00Z" });
    const advanced = await resolveAccount(database, "clientCostsAdvanced");
    const line = database
      .prepare(`SELECT matter_id FROM ledger_line WHERE account_id = ?`)
      .get(advanced) as { matter_id: string };
    expect(line.matter_id).toBe("matter_smith");
  });

  it("debits an expense account for a soft cost", async () => {
    const database = await openSeededDatabase();
    const copying = database
      .prepare(`SELECT id FROM ledger_account WHERE code = '5200'`)
      .get() as { id: string };
    const { effect } = await recordVendorBill(
      database,
      {
        ...hardCostBill,
        lines: [
          { amountMinor: 4_000, disbursementClass: "soft" as const, matterId: null, expenseAccountId: copying.id, description: "copies" },
        ],
      },
      testOptions(),
    );
    await commitEffectBatch(database, effect, { now: () => "2026-05-01T00:00:00Z" });
    expect(await balanceOf(database, copying.id)).toBe(4_000);
  });

  it("refuses a bill dated into a closed period", async () => {
    const database = await openSeededDatabase();
    database
      .prepare(`INSERT INTO accounting_lock (id, locked_through, hard_locked_through, updated_at) VALUES (1, '2026-05-31', NULL, '2026-06-01T00:00:00Z')`)
      .run();
    await expect(recordVendorBill(database, hardCostBill, testOptions())).rejects.toThrow(
      PostingPeriodLockedError,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @magna-carta/general-ledger test vendor-bill-service`
Expected: FAIL — `Cannot find module '../src/vendor-bill-service.ts'`.

- [ ] **Step 3: Implement the service**

```ts
// packages/general-ledger/src/vendor-bill-service.ts (shape; statements live in the sibling module)

// A vendor bill is two obligations at once: money owed to the vendor, and — for a hard cost — an
// advance recoverable from the client. The disbursement class routes the debit:
//
//   hard  Dr Client Costs Advanced (matter-tagged)  Cr Accounts Payable    (no profit-and-loss impact)
//   soft  Dr <expense account>                      Cr Accounts Payable
//
// A hard cost is an advance, not the firm's expense. Booking it to expense would misstate both the
// balance sheet and the firm's deductions, so the routing below is a correctness rule, not a
// presentation preference.
export async function recordVendorBill(database, input, options) {
  // 1. assertPostingAllowed(await loadPostingWindow(database, input.effectiveDate))
  // 2. Resolve accountsPayable once; resolve clientCostsAdvanced only if a hard line exists.
  // 3. Build one debit line per bill line (matter-tagged when hard) and a single credit to
  //    Accounts Payable for the summed amount, so the entry balances with the fewest lines.
  // 4. postEntry(...) — it re-validates balance, leaf-only, and refuses future dating.
  // 5. Compose: postEntry's statements, the vendor_bill insert, and one vendor_bill_line insert
  //    per line, into a single EffectWrite. Return { vendorBillId, ledgerEntryId, effect }.
}
```

`disbursementEntryId` on each hard line is left `null` by this service and is filled by the route in Task 11, which composes `captureCost` into the same batch. The fitness query from Task 6 is what proves no call site skips it.

- [ ] **Step 4: Run, gate, commit**

```bash
pnpm --filter @magna-carta/general-ledger test
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(general-ledger): record vendor bills, routing the debit by disbursement class

A hard cost debits Client Costs Advanced and touches no income or expense
account: it is an advance recoverable from the client, not the firm's expense.
A soft cost debits an expense account, and its later reimbursement is income.
Both credit Accounts Payable.

Posting is refused inside a closed period.
MESSAGE
```

---

### Task 9: Financial-statement read models

**Files:**
- Create: `packages/general-ledger/src/statement-read-models.ts`
- Test: `packages/general-ledger/test/statement-read-models.test.ts`

**Interfaces:**
- Produces: `trialBalance(database, asOf)`, `balanceSheet(database, asOf)`, `incomeStatement(database, from, to)`, `accountsPayableAging(database, asOf)`.

- [ ] **Step 1: Write the failing test**

Assert: a trial balance's debits equal its credits; a balance sheet balances (assets = liabilities + equity + computed retained earnings); retained earnings equals `Σ(income − expense)` up to `asOf` **with no closing entry posted**; an entry dated after `asOf` is excluded; and every read keys on `effective_date`, proven by posting two entries with the same `recorded_at` and different `effective_date` and asserting only one appears.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @magna-carta/general-ledger test statement-read-models`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

All four queries filter on `ledger_entry.effective_date <= ?`, never `recorded_at`, which is what makes a statement reproducible for any past date. Aggregate with the money package's half-even rounding helper; half-up carries a cumulative upward bias that is acceptable at an invoice boundary and not in a financial statement.

Retained earnings is computed, never posted:

```ts
// Retained earnings is a pure function of an append-only ledger: the net of income and expense up
// to the cutoff. Posting real closing entries would create rows that must be unwound whenever a
// period reopens, and would leave the income statement reading zero for a closed year.
```

- [ ] **Step 4: Run, gate, commit**

```bash
pnpm --filter @magna-carta/general-ledger test
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(general-ledger): assemble trial balance, balance sheet, income statement, and payables aging

Every read keys on effective_date, never recorded_at, so a statement is
reproducible for any past date. Retained earnings is computed rather than
posted: it is the net of income and expense up to the cutoff, and a posted
closing entry would have to be unwound whenever a period reopens.

Aggregation rounds half-even; half-up's cumulative bias belongs to invoice
boundaries, not financial statements.
MESSAGE
```

---

### Task 10: Ledger routes

**Files:**
- Create: `apps/worker/src/routes/ledger.ts`
- Modify: `apps/worker/src/app.ts`, `packages/access-control/src/registry.ts`
- Test: `apps/worker/test/ledger-routes.test.ts`

**Interfaces:**
- Produces: the ten `/v1/ledger/*` operations from the design's route table.

- [ ] **Step 1: Add the permissions**

In `packages/access-control/src/registry.ts`: `"ledger:viewStatements"`, `"ledger:post"`, `"ledger:manageAccounts"`, `"ledger:closePeriod"`, `"ledger:reopenPeriod"`. Reads are gated separately from writes — a bookkeeper who may read a trial balance must not thereby be able to post to the ledger.

- [ ] **Step 2: Write the failing route tests**

Cover: an unauthenticated request is refused; `GET /v1/ledger/trial-balance` with only `ledger:viewStatements` succeeds; `POST /v1/ledger/entries` with only `ledger:viewStatements` is refused with 403; posting into a closed period returns **409** with an RFC 9457 problem whose `type` names the closed-period condition; `POST /v1/ledger/periods/reopen` requires `ledger:reopenPeriod`, not `ledger:closePeriod`.

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @magna-carta/worker test ledger-routes`
Expected: FAIL — 404 on every path.

- [ ] **Step 4: Implement the routes**

Each is a `defineOpenAPIRoute(meta, {...})` with full `RouteMeta` and zod schemas for every response status, mounted with `chokepointMiddleware`. Map `GeneralLedgerValidationError` and `PostingPeriodLockedError` to problems: `closed-period` and `hard-locked-period` → 409; `unknown-semantic-account` → 422. Register the new problem types in `apps/worker/src/contracts/problem-types.ts`. Never validate a secret-bearing field through a body validator — the `defaultHook` leaks the failing value into the 422 body.

- [ ] **Step 5: Regenerate the contract**

```bash
pnpm --filter @magna-carta/worker run emit-openapi
pnpm run generate-client
pnpm --filter @magna-carta/worker test conformance
```

Never hand-edit `apps/worker/openapi/openapi.json` or `packages/api-client`.

- [ ] **Step 6: Gate and commit**

```bash
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(worker): expose the ledger's first HTTP surface

Chart management, manual journal entries and reversals, the three financial
statements, and period close and reopen. Reads are gated by
ledger:viewStatements and writes by ledger:post, so reading the books never
implies the ability to post to them. A posting into a closed period is a 409.
MESSAGE
```

---

### Task 11: Accounts-payable routes and the two-service batch

This is the task the design turns on. It is also the only place the vendor bill and the cost entry meet.

**Files:**
- Create: `apps/worker/src/routes/accounts-payable.ts`
- Modify: `apps/worker/src/app.ts`, `packages/access-control/src/registry.ts`
- Test: `apps/worker/test/accounts-payable-routes.test.ts`, `apps/worker/test/e2e/slice-3-5-e2e.test.ts`

**Interfaces:**
- Consumes: `recordVendorBill` (Task 8), `captureCost` from `@magna-carta/costs/cost-entry-service`.
- Produces: `POST /v1/accounts-payable/bills`, `GET /v1/accounts-payable/aging`.

- [ ] **Step 1: Add the permissions**

`"accountsPayable:manageBills"` and `"accountsPayable:viewBills"`.

- [ ] **Step 2: Write the failing end-to-end test**

```ts
// apps/worker/test/e2e/slice-3-5-e2e.test.ts — the assertions that matter
//
// 1. POST a hard-cost bill for matter Smith, 2000.00, one line.
// 2. Exactly one ledger_entry exists, with two lines: a debit to clientCostsAdvanced tagged
//    matter_id = Smith, and a credit to accountsPayable.
// 3. Exactly one cost_entry exists, with source = 'vendorBill', disbursement_class = 'hard',
//    status = 'draft', and matter_id = Smith.
// 4. vendor_bill_line.disbursement_entry_id equals that cost_entry's id.
// 5. The sum of all income and expense balances is 0 — the profit-and-loss is untouched.
// 6. assertGeneralLedgerFitness and assertLedgerFitness both pass.
// 7. Atomicity: force captureCost to throw, POST again, and assert NO ledger_entry, NO
//    vendor_bill, and NO cost_entry were written. One batch, or nothing.
```

Assertion 7 is the point of the whole design. If the two writes were split across an outbox, it would fail.

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm --filter @magna-carta/worker test slice-3-5-e2e`
Expected: FAIL — 404 on `POST /v1/accounts-payable/bills`.

- [ ] **Step 4: Implement the route's composition**

```ts
// apps/worker/src/routes/accounts-payable.ts — the handler's core

// The ledger entry and the cost entry both land in this firm's database, so one batch commits
// both. Composing here rather than inside either package keeps general-ledger and costs
// independent of one another: the route knows about both, neither knows about the other.
const bill = await recordVendorBill(database, billInput, serviceOptions);

const statements = [...bill.effect.statements];
const outboxMessages = [...bill.effect.outboxMessages];

for (const line of bill.hardCostLines) {
  const captured = await captureCost(
    database,
    {
      matterId: line.matterId,
      vendorId: billInput.vendorId,
      incurredDate: billInput.billDate,
      amountMinor: line.amountMinor,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: line.description,
      source: "vendorBill",
    },
    serviceOptions,
  );
  statements.push(...captured.effect.statements);
  outboxMessages.push(...captured.effect.outboxMessages);
  statements.push(linkDisbursementEntryStatement(database, line.vendorBillLineId, captured.costEntryId));
}

await runIdempotentEffect(database, idempotency, {
  effect: async () => ({ statements, outboxMessages }),
});
```

This mirrors `apps/worker/src/routes/files.ts`, which already merges three services' effects into one batch.

- [ ] **Step 5: Regenerate the contract, run everything**

```bash
pnpm --filter @magna-carta/worker run emit-openapi
pnpm run generate-client
vp test
```

Expected: the full suite green, including `slice-3-5-e2e` and the conformance snapshot.

- [ ] **Step 6: Gate and commit**

```bash
pnpm check
git add -A
git commit -F - <<'MESSAGE'
feat(worker): post a vendor bill and its recoverable cost in one batch

A hard-cost bill writes a ledger entry and a cost_entry. Both live in this
firm's database, so the route composes them into a single D1 batch: they
cannot diverge because they cannot be written apart. The route knows about
both packages; neither knows about the other.

The end-to-end test asserts the profit-and-loss stays untouched, and that a
failure in the cost capture leaves no ledger entry behind.
MESSAGE
```

---

### Task 12: Load profile and the integration seam

**Files:**
- Create: `packages/fixtures/src/load-profile/general-ledger-volume.ts`
- Modify: the load-profile registry; `packages/integrations/src/` (register the `accounting` category)
- Test: `packages/fixtures/test/general-ledger-volume.test.ts`

- [ ] **Step 1: Write the failing test** — a `GeneralLedgerVolume` profile generates N accounts, M entries with dimensions, and K vendor bills through the real write paths (never raw SQL, which would bypass the ledger invariants), and both fitness proofs pass over the generated data.
- [ ] **Step 2: Run and watch it fail.** Run: `pnpm --filter @magna-carta/fixtures test general-ledger-volume`
- [ ] **Step 3: Implement the profile**, seeded and clock-fixed, mirroring `CostVolume`.
- [ ] **Step 4: Register the `accounting` integration category** with a CapabilityDescriptor. No adapter, no credentials, no sync engine — the QuickBooks adapter Worker is built in Phase 7·2, and this slice only reserves the category and names `LEDGER_ENTRY_POSTED_TOPIC` as its change feed.
- [ ] **Step 5: Run, gate, commit.**

---

### Task 13: Documentation, decisions, and status

**Files:**
- Create: `packages/general-ledger/CLAUDE.md`, `packages/accounting-periods/CLAUDE.md`
- Create: four fragments in `docs/decisions/pending/`, one in `changelog.d/`, one in `status.d/`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write both area `CLAUDE.md` files** from the template, stating the invariants that bind locally: append-only, balanced entries on leaf accounts, the lock is a monotonic scalar, hard costs are assets, statements read `effective_date`, and half-even aggregation.

- [ ] **Step 2: Write the four ADR fragments** in `docs/decisions/pending/`, one file each:
  1. `posting-dimensions-on-ledger-line.md` — amends ADR-0072. Accounts enforce bounds; dimensions enable segmentation; the trust subledger keeps child accounts because a bound is a CHECK on a balance row.
  2. `fiscal-period-close-lock-date.md` — a monotonic scalar over period rows; soft close, permissioned and audited; retained earnings computed, never posted.
  3. `chart-of-accounts-product-and-account-resolver.md` — seed-and-fork with stable semantic keys; closes the slice map's chart/resolver coordination pin by landing before billing.
  4. `accounts-payable-liability-subledger.md` — disbursement-class debit routing; the payable and the recoverable cost are separate records committed in one batch by the route; Cloudflare Workflows considered and rejected because one D1 transaction covers both writes.

- [ ] **Step 3: Write the changelog and status fragments.** Never edit `CHANGELOG.md`, the Decision-Log register, or `STATUS.md` directly on a branch — they are build outputs assembled on `main`.

- [ ] **Step 4: Update `ROADMAP.md`** — move 3·5 into the landed-slices list with its spec and plan links.

- [ ] **Step 5: Delete `docs/active-work/slice-3-5-operating-general-ledger.md`** as part of the merge, together with the worktree and branch.

- [ ] **Step 6: Run the full gate and commit**

```bash
pnpm check && vp test && pnpm run lint:process-refs
git add -A
git commit -F - <<'MESSAGE'
docs(general-ledger): record the slice 3·5 decisions and area guides
MESSAGE
```

---

## Self-Review

**Spec coverage.** Chart-of-accounts product → Tasks 2, 4. Account resolver → Task 3. Posting dimensions → Task 2. Period close (scalar lock, close-event log, reopen permission, hard lock honoured) → Tasks 1, 5, 6. Computed retained earnings → Task 9. Accounts payable with disbursement routing → Tasks 7, 8. The one-batch composition → Task 11. Statement read models → Task 9. Integration seam → Task 12. Permissions, identifiers, settings → folded into Tasks 5, 7, 10, 11. Three fitness functions → Task 6 (closed-period, hard-cost link) and Task 12 (`SUM(lines) = balance` under dimensions, exercised by the load profile against the existing `assertLedgerFitness`). Migration ID discipline → Tasks 2, 5, 7.

**Gap found and closed.** The spec's `ledger.fiscal_year_start` firm setting had no task, because nothing in this slice reads it — enforcement is the scalar lock date, not the calendar. Rather than build a setting no code consumes, the design was amended: §9 now records that the slice ships no settings, and §12 defers the setting to 3·6, its first reader.

**Placeholder scan.** Task 8 Step 3 and Task 9 Step 3 give the service shape and the invariants as commented outlines rather than complete bodies, because both are long and mechanical once the statements module exists. Task 12's steps are compressed. These are the weakest points in the plan; an implementer following subagent-driven development will need the sibling statements module in context. Everything else carries runnable code and exact commands.

**Type consistency.** `assertPostingAllowed` / `PostingWindow` / `PostingPeriodLockedError` are used identically in Tasks 1, 6, 8. `resolveAccount(database, key)` matches across 3, 4, 8. `SemanticAccountKey` is produced in Task 3 and consumed in Task 4. `disbursement_entry_id` — never `cost_entry_id` — is used in Tasks 6, 7, 8, 11. `recordVendorBill` returns `{ vendorBillId, ledgerEntryId, effect }` in Task 8 and Task 11 additionally reads `bill.hardCostLines`; **Task 8's Produces block must declare `hardCostLines: readonly { vendorBillLineId, matterId, amountMinor, description }[]`.** Corrected here rather than left to the implementer.
