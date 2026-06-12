# Load-Profile Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the load-profile harness — volume profiles, snapshot/replay, and the query-level measurement runner — inside `@magna-carta/fixtures`, per the design in [`2026-06-11-load-profile-harness-design.md`](2026-06-11-load-profile-harness-design.md) (ADR-0083).

**Architecture:** A new `src/load-profile/` module in `@magna-carta/fixtures` (separate export paths, off the scenario/demo import surface) generates volume data through the real domain write-paths under the one-seed `FixtureContext`, persists the populated `node:sqlite` database + a JSON manifest to a gitignored content-keyed cache, and replays it by file copy. A measurement runner times named domain operations (median/p95) against a replayed working copy and captures `EXPLAIN QUERY PLAN` to flag full scans. One small addition to `@magna-carta/database` (open an existing SQLite file as the D1-shaped adapter, plus a `node:sqlite` `backup()` pin test) carries the persistence.

**Tech Stack:** TypeScript, `node:sqlite` (`DatabaseSync` + `backup()`), `node:crypto` (cache key hash), Vitest (per-package: `pnpm --filter <package> test`), existing packages: `@magna-carta/ledger`, `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, `@magna-carta/money`, `@faker-js/faker`.

---

## Conventions that bind every task

- **Golden rule 12 — no shorthand.** `database`, not `db`; `statement`, not `stmt`. Match the surrounding code.
- **Real write paths only** (fixtures invariant): volume generation calls `createAccount`/`postEntry`/`reverseEntry` + `commitEffectBatch` — a raw business-table INSERT in this package is a bug.
- **One seed carries all determinism** for _generated data_. The measurement runner is the **sanctioned exception** for wall-clock reads (`performance.now()`): timing is observation, never data — document this at the read site.
- **Tests:** per-package invocation from the repo root: `pnpm --filter @magna-carta/fixtures test` / `pnpm --filter @magna-carta/database test`.
- **Commits:** stage explicit paths only (concurrent sessions share this tree — never `git add -A`), gated: `vp check && git commit …`. If `vp check` fails on files this plan never touched, report it — do not "fix" another session's in-flight work.
- **No emojis** anywhere.

## File structure

| File                                                                                                 | Responsibility                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/src/node-sqlite.ts` (modify)                                                      | Add `openNodeDatabaseFile(path)` — open an existing SQLite file as the D1-shaped adapter (no migrations applied).          |
| `packages/database/test/node-sqlite-file.test.ts` (create)                                           | Pin test: `node:sqlite` `backup()` + `openNodeDatabaseFile` round-trip.                                                    |
| `packages/fixtures/src/load-profile/profile.ts` (create)                                             | Profile types, the `ledgerVolume` default, `scaleProfile`, `GENERATOR_VERSION`.                                            |
| `packages/fixtures/src/load-profile/generate.ts` (create)                                            | The volume chart + archetype-driven entry generation through real write paths; records probe identifiers.                  |
| `packages/fixtures/src/load-profile/snapshot.ts` (create)                                            | Manifest, content-keyed cache, `loadProfileSnapshot` (generate-or-replay, working-copy semantics).                         |
| `packages/fixtures/src/load-profile/runner.ts` (create)                                              | `runMeasurements` (warmup + timed iterations → min/median/p95), `explainStatement` + `findFullScans`, `writeBaselineFile`. |
| `packages/fixtures/src/load-profile/ledger-measurements.ts` (create)                                 | The v1 measured set (the slice 0·3 efficiency-candidate operations).                                                       |
| `packages/fixtures/src/load-profile/measure-cli.ts` (create)                                         | `pnpm --filter @magna-carta/fixtures run measure` — produce/refresh the committed baseline.                                |
| `packages/fixtures/test/load-profile-profile.test.ts` (create)                                       | Profile scaling + cache-key identity tests.                                                                                |
| `packages/fixtures/test/load-profile-generate.test.ts` (create)                                      | Tiny-scale generation: counts, fitness, determinism, guard.                                                                |
| `packages/fixtures/test/load-profile-snapshot.test.ts` (create)                                      | Cache miss generates; cache hit replays; manifest mismatch regenerates.                                                    |
| `packages/fixtures/test/load-profile-runner.test.ts` (create)                                        | Runner statistics, scan flagging, baseline file shape.                                                                     |
| `packages/fixtures/test/load-profile-smoke.test.ts` (create)                                         | The CI smoke: tiny-scale end-to-end, no timing assertions, hot statements scan-free.                                       |
| `packages/fixtures/package.json` (modify)                                                            | `./load-profile/*` export entries + the `measure` script.                                                                  |
| `packages/fixtures/CLAUDE.md` (modify)                                                               | Load-profile local rules (generator-version bump discipline; the sanctioned wall-clock read; measurement seed derivation). |
| `packages/fixtures/baselines/ledgerVolume-v1.json` (create, final task)                              | The first committed baseline (owner machine).                                                                              |
| `ROADMAP.md` / `STATUS.md` / `CHANGELOG.md` / `docs/conventions/performance.md` (modify, final task) | Built-stage flips + the how-to-run pointer.                                                                                |

---

### Task 1: `openNodeDatabaseFile` + the `node:sqlite` `backup()` pin test (`@magna-carta/database`)

The snapshot layer needs two primitives: persist an in-memory database to a file (`node:sqlite`'s `backup()`), and open an existing file as the D1-shaped adapter _without_ re-applying migrations. The pin test proves the Node API behaves as the harness assumes (the established pin-test pattern for `node:sqlite`).

**Files:**

- Modify: `packages/database/src/node-sqlite.ts`
- Create: `packages/database/test/node-sqlite-file.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/database/test/node-sqlite-file.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase, openNodeDatabaseFile } from "../src/node-sqlite.ts";

// Pin test: the snapshot layer of the fixtures load-profile harness persists an in-memory
// database with node:sqlite's backup() and reopens the file WITHOUT re-applying migrations.
// This proves both halves against the real Node API (the node:sqlite pin-test pattern).
describe("node-sqlite file persistence", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backs an in-memory database up to a file and reopens it with data intact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-node-sqlite-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "snapshot.sqlite");

    const source = createMigratedNodeDatabase("per-firm");
    source.raw
      .prepare(
        "INSERT INTO idempotency_key (key, endpoint, fingerprint, status, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("key_pin", "/pin", "fp", "completed", 200, "{}", "2026-01-05T09:00:00.000Z");

    await backup(source.raw, filePath);

    const reopened = openNodeDatabaseFile(filePath);
    const { results } = await reopened.database
      .prepare("SELECT key FROM idempotency_key WHERE key = ?1")
      .bind("key_pin")
      .all<{ key: string }>();
    expect(results).toEqual([{ key: "key_pin" }]);

    // The reopened handle is batch-capable (the D1-shaped contract the harness relies on).
    const batchResult = await reopened.database.batch([reopened.database.prepare("SELECT 1")]);
    expect(batchResult).toHaveLength(1);
  });
});
```

Note: if the `idempotency_key` column list above does not match the committed per-firm schema, read `packages/database/drizzle/per-firm/0000_*.sql` and use that table's real columns — the test's subject is `backup()` + reopen, not that table.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/database test`
Expected: FAIL — `openNodeDatabaseFile` is not exported.

- [ ] **Step 3: Implement `openNodeDatabaseFile`**

Append to `packages/database/src/node-sqlite.ts`:

```typescript
// Open an EXISTING database file as the D1-shaped adapter — no migrations applied (the file is
// already at some schema; callers own staleness, e.g. the fixtures snapshot manifest). Node-only,
// like everything in this module.
export function openNodeDatabaseFile(path: string): MigratedNodeDatabase {
  const raw = new DatabaseSync(path);
  return { database: nodeSqliteBatchDatabase(raw), raw };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS (all existing database tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/node-sqlite.ts packages/database/test/node-sqlite-file.test.ts
vp check && git commit -m "feat(database): openNodeDatabaseFile + node:sqlite backup() pin test for the load-profile snapshot layer"
```

---

### Task 2: Profile module — types, the `ledgerVolume` default, `scaleProfile` (`@magna-carta/fixtures`)

**Files:**

- Create: `packages/fixtures/src/load-profile/profile.ts`
- Create: `packages/fixtures/test/load-profile-profile.test.ts`
- Modify: `packages/fixtures/package.json` (export entry)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fixtures/test/load-profile-profile.test.ts
import { describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";

describe("load-profile profiles", () => {
  it("ships the ledgerVolume default with plausible-firm parameters", () => {
    expect(ledgerVolume.name).toBe("ledgerVolume");
    expect(ledgerVolume.entryCount).toBeGreaterThanOrEqual(10_000);
    expect(ledgerVolume.trustSubledgerCount).toBeGreaterThanOrEqual(100);
    expect(ledgerVolume.reversalRate).toBeGreaterThan(0);
    expect(ledgerVolume.reversalRate).toBeLessThan(0.2);
  });

  it("scales counts by the multiplier without mutating the source profile", () => {
    const smoke = scaleProfile(ledgerVolume, 0.01);
    expect(smoke.entryCount).toBe(Math.max(20, Math.round(ledgerVolume.entryCount * 0.01)));
    expect(smoke.trustSubledgerCount).toBe(
      Math.max(3, Math.round(ledgerVolume.trustSubledgerCount * 0.01)),
    );
    // Non-count parameters pass through; identity parameters are untouched.
    expect(smoke.version).toBe(ledgerVolume.version);
    expect(smoke.reversalRate).toBe(ledgerVolume.reversalRate);
    expect(ledgerVolume.entryCount).toBeGreaterThanOrEqual(10_000); // source unchanged
  });

  it("floors the scaled counts so a tiny multiplier still produces a generatable profile", () => {
    const tiny = scaleProfile(ledgerVolume, 0.000001);
    expect(tiny.entryCount).toBe(20);
    expect(tiny.trustSubledgerCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: FAIL — module `../src/load-profile/profile.ts` does not exist.

- [ ] **Step 3: Implement the profile module**

```typescript
// packages/fixtures/src/load-profile/profile.ts

// Bump when GENERATION LOGIC changes in a way that alters produced rows for the same profile +
// seed (new archetype, changed faker call order, …) — it participates in snapshot identity, so a
// stale cached artifact can never be measured against silently (design §3.2). Profile parameter
// changes bump the profile's own `version` instead.
export const GENERATOR_VERSION = 1;

// Transaction archetypes, weighted (faker.helpers.weightedArrayElement). The settlement archetype
// is the multi-line tail; the rest are two-line entries. Weights are profile PARAMETERS, never
// generator constants (design §3.1).
export interface ArchetypeWeights {
  readonly trustDeposit: number;
  readonly trustDisbursement: number;
  readonly feeBilled: number;
  readonly paymentReceived: number;
  readonly operatingExpense: number;
  readonly settlement: number;
}

export interface LedgerVolumeProfile {
  readonly name: "ledgerVolume";
  // Profile identity: bump on ANY parameter change — baselines measured against different data
  // must never masquerade as comparable (design §3.1).
  readonly version: number;
  readonly trustSubledgerCount: number;
  readonly entryCount: number;
  // Entries spread their effective dates across this span via fixed-clock advances.
  readonly postingSpanDays: number;
  // Fraction of operating-expense entries immediately reversed (trust entries are never reversed —
  // keeps the generator's in-memory trust tracking one-directional and simple).
  readonly reversalRate: number;
  readonly archetypeWeights: ArchetypeWeights;
}

// A plausible established small firm: a few years of posting activity over a 200-client trust book.
export const ledgerVolume: LedgerVolumeProfile = {
  name: "ledgerVolume",
  version: 1,
  trustSubledgerCount: 200,
  entryCount: 25_000,
  postingSpanDays: 1_095,
  reversalRate: 0.02,
  archetypeWeights: {
    trustDeposit: 20,
    trustDisbursement: 12,
    feeBilled: 22,
    paymentReceived: 18,
    operatingExpense: 23,
    settlement: 5,
  },
};

// One profile, every scale: CI smoke (~0.01), local working scale (1), deliberate stress runs
// (>1). Floors keep a tiny multiplier generatable (enough entries/subledgers for every archetype).
export function scaleProfile(
  profile: LedgerVolumeProfile,
  multiplier: number,
): LedgerVolumeProfile {
  return {
    ...profile,
    entryCount: Math.max(20, Math.round(profile.entryCount * multiplier)),
    trustSubledgerCount: Math.max(3, Math.round(profile.trustSubledgerCount * multiplier)),
  };
}
```

- [ ] **Step 4: Add the export entry**

In `packages/fixtures/package.json`, extend `"exports"` (keep existing entries):

```json
"./load-profile/profile": "./src/load-profile/profile.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fixtures/src/load-profile/profile.ts packages/fixtures/test/load-profile-profile.test.ts packages/fixtures/package.json
vp check && git commit -m "feat(fixtures): load-profile volume profiles - ledgerVolume default + scaleProfile"
```

---

### Task 3: Volume generation through the real write paths

The generator: a volume chart (core operating accounts + N trust subledgers under one parent), then `entryCount` archetype-driven entries with in-memory realism tracking (trust subledgers never overdrawn, payments never exceed receivables), reversals on operating expenses, and the fixed clock advancing so effective dates disperse across the posting span. Probes (the busiest subledger, a sample entry) are recorded for the measurement layer.

**Files:**

- Create: `packages/fixtures/src/load-profile/generate.ts`
- Create: `packages/fixtures/test/load-profile-generate.test.ts`
- Modify: `packages/fixtures/package.json` (export entry)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fixtures/test/load-profile-generate.test.ts
import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../src/context.ts";
import { generateLedgerVolume } from "../src/load-profile/generate.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { createLocalPerFirmDatabase } from "../src/local-database.ts";

const TINY = scaleProfile(ledgerVolume, 0.002); // 50 entries, 3 subledgers — fast in CI

describe("load-profile generation", () => {
  it("refuses to run without the seeding opt-in", async () => {
    const local = createLocalPerFirmDatabase();
    await expect(
      generateLedgerVolume(local.database, fixtureContext("guard"), TINY, {
        allowSeeding: false,
      }),
    ).rejects.toThrow(/allowSeeding/);
  });

  it("generates the requested volume through the real write paths and passes fitness", async () => {
    const local = createLocalPerFirmDatabase();
    const result = await generateLedgerVolume(local.database, fixtureContext("volume"), TINY, {
      allowSeeding: true,
    });

    const { results: entryCountRows } = await local.database
      .prepare("SELECT COUNT(*) AS entry_count FROM ledger_entry")
      .all<{ entry_count: number }>();
    // entryCount archetype entries + the opening contribution + any reversals on top.
    expect(entryCountRows[0]!.entry_count).toBeGreaterThanOrEqual(TINY.entryCount + 1);
    expect(result.entryCount).toBe(entryCountRows[0]!.entry_count);

    // Probes point at real rows.
    expect(result.probes.busySubledgerAccountId).toMatch(/^acct_/);
    expect(result.probes.operatingBankAccountId).toMatch(/^acct_/);
    expect(result.probes.feeIncomeAccountId).toMatch(/^acct_/);
    expect(result.probes.sampleEntryId).toMatch(/^led_/); // the registry's ledgerEntry prefix

    // The whole generated book satisfies every table-wide ledger invariant.
    await assertLedgerFitness(local.database);

    // Trust subledgers were never overdrawn (the generator's realism tracking held).
    const { results: negativeTrust } = await local.database
      .prepare(
        `SELECT account_balance.account_id FROM account_balance
         JOIN ledger_account ON ledger_account.id = account_balance.account_id
         WHERE ledger_account.parent_account_id IS NOT NULL AND account_balance.balance_minor < 0`,
      )
      .all();
    expect(negativeTrust).toEqual([]);
  });

  it("is deterministic: the same seed produces identical business rows", async () => {
    const first = createLocalPerFirmDatabase();
    const second = createLocalPerFirmDatabase();
    await generateLedgerVolume(first.database, fixtureContext("twice"), TINY, {
      allowSeeding: true,
    });
    await generateLedgerVolume(second.database, fixtureContext("twice"), TINY, {
      allowSeeding: true,
    });
    // Business tables compare byte-identical. Outbox rows compare EXCLUDING id (minted unseeded
    // inside data-access — the documented seam, fixtures CLAUDE.md).
    for (const table of ["ledger_account", "ledger_entry", "ledger_line", "account_balance"]) {
      const rowsOf = (raw: typeof first.raw) =>
        raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(rowsOf(first.raw)).toEqual(rowsOf(second.raw));
    }
    const outboxOf = (raw: typeof first.raw) =>
      raw.prepare("SELECT topic, payload, aggregate_key, seq FROM outbox ORDER BY seq").all();
    expect(outboxOf(first.raw)).toEqual(outboxOf(second.raw));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: FAIL — `generate.ts` does not exist.

- [ ] **Step 3: Implement the generator**

```typescript
// packages/fixtures/src/load-profile/generate.ts
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { LedgerAccountId, LedgerEntryId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { ArchetypeWeights, LedgerVolumeProfile } from "./profile.ts";

// Probe identifiers the measurement layer binds real queries to (recorded in the snapshot
// manifest — design §3.3): deterministic for a given profile + seed.
export interface VolumeProbes {
  readonly operatingBankAccountId: LedgerAccountId;
  readonly trustBankAccountId: LedgerAccountId;
  readonly clientTrustLiabilityAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly busySubledgerAccountId: LedgerAccountId; // most postings — the hot balance row
  readonly sampleEntryId: LedgerEntryId;
}

export interface VolumeGenerationResult {
  readonly entryCount: number; // total ledger_entry rows written (archetypes + opening + reversals)
  readonly probes: VolumeProbes;
}

interface CoreChart {
  readonly operatingBank: LedgerAccountId;
  readonly trustBank: LedgerAccountId;
  readonly accountsReceivable: LedgerAccountId;
  readonly clientCostsAdvanced: LedgerAccountId;
  readonly clientTrustLiability: LedgerAccountId;
  readonly ownersEquity: LedgerAccountId;
  readonly feeIncome: LedgerAccountId;
  readonly costRecoveryIncome: LedgerAccountId;
}

const EXPENSE_NAMES = [
  "Rent Expense",
  "Salaries Expense",
  "Office Supplies Expense",
  "Bar Dues Expense",
  "Continuing Education Expense",
] as const;

type ArchetypeName = keyof ArchetypeWeights;

// Volume generation: the load-profile entry point (white paper _Synthetic data & fixtures_,
// design §3.1). Every write rides the real domain services — valid at any scale by construction.
export async function generateLedgerVolume(
  database: BatchDatabase,
  context: FixtureContext,
  profile: LedgerVolumeProfile,
  options: SeedingOptions,
): Promise<VolumeGenerationResult> {
  assertSeedingAllowed(options);
  const serviceOptions = { clock: context.clock, randomSource: context.randomSource };
  const commit = (effect: Parameters<typeof commitEffectBatch>[1]) =>
    commitEffectBatch(database, effect, { now: () => context.clock.now() });

  const newAccount = async (
    name: string,
    type: "asset" | "liability" | "equity" | "income" | "expense",
    parentAccountId?: LedgerAccountId,
  ): Promise<LedgerAccountId> => {
    const { accountId, effect } = await createAccount(
      database,
      { name, type, currency: "USD", parentAccountId },
      serviceOptions,
    );
    await commit(effect);
    return accountId;
  };

  // --- The volume chart: core accounts + N trust subledgers under one parent. ---
  const chart: CoreChart = {
    operatingBank: await newAccount("Operating Bank Account", "asset"),
    trustBank: await newAccount("Trust Bank Account (IOLTA)", "asset"),
    accountsReceivable: await newAccount("Accounts Receivable", "asset"),
    clientCostsAdvanced: await newAccount("Client Costs Advanced", "asset"),
    clientTrustLiability: await newAccount("Client Trust Liability", "liability"),
    ownersEquity: await newAccount("Owner's Equity", "equity"),
    feeIncome: await newAccount("Fee Income", "income"),
    costRecoveryIncome: await newAccount("Cost Recovery Income", "income"),
  };
  const expenseAccounts: LedgerAccountId[] = [];
  for (const name of EXPENSE_NAMES) {
    expenseAccounts.push(await newAccount(name, "expense"));
  }
  const subledgers: LedgerAccountId[] = [];
  for (let index = 0; index < profile.trustSubledgerCount; index += 1) {
    subledgers.push(
      await newAccount(
        `Trust — ${context.faker.person.fullName()}`,
        "liability",
        chart.clientTrustLiability,
      ),
    );
  }

  // --- In-memory realism tracking (generator-side only; the ledger enforces nothing here in v1 —
  // trust bounds are Phase 3). Subledgers never overdraw; payments never exceed receivables;
  // settlements never recover costs that were not advanced. ---
  const trustHeldMinor = subledgers.map(() => 0);
  const subledgerPostings = subledgers.map(() => 0);
  let receivableMinor = 0;
  let costsAdvancedMinor = 0;
  let totalEntries = 0;

  const post = async (description: string, lines: EntryLineInput[]): Promise<LedgerEntryId> => {
    const posted = await postEntry(
      database,
      { description, effectiveDate: context.clock.today(), lines },
      serviceOptions,
    );
    await commit(posted.effect);
    totalEntries += 1;
    return posted.entryId;
  };

  // Opening capital sized to the volume so the operating account plausibly funds the expense
  // stream (heuristic; nothing enforces operating-balance sign in v1).
  await post("Owner capital contribution", [
    {
      accountId: chart.operatingBank,
      direction: "debit",
      amount: money(profile.entryCount * 25_000, USD),
    },
    {
      accountId: chart.ownersEquity,
      direction: "credit",
      amount: money(profile.entryCount * 25_000, USD),
    },
  ]);

  // Effective dates disperse across the posting span: a fixed advance per entry.
  const minutesPerEntry = Math.max(
    1,
    Math.floor((profile.postingSpanDays * 24 * 60) / profile.entryCount),
  );

  const weighted = (Object.entries(profile.archetypeWeights) as [ArchetypeName, number][]).map(
    ([value, weight]) => ({ value, weight }),
  );
  const amount = (minimum: number, maximum: number) =>
    context.faker.number.int({ min: minimum, max: maximum });
  const pickSubledger = (): number =>
    context.faker.number.int({ min: 0, max: subledgers.length - 1 });

  let sampleEntryId: LedgerEntryId | null = null;

  for (let index = 0; index < profile.entryCount; index += 1) {
    let archetype = context.faker.helpers.weightedArrayElement(weighted);
    // Fallbacks keep the stream realistic when a bounded archetype has no headroom.
    if (archetype === "trustDisbursement" && !trustHeldMinor.some((held) => held > 0)) {
      archetype = "trustDeposit";
    }
    if (archetype === "paymentReceived" && receivableMinor === 0) {
      archetype = "feeBilled";
    }

    let entryId: LedgerEntryId;
    switch (archetype) {
      case "trustDeposit": {
        const subledger = pickSubledger();
        const depositMinor = amount(50_000, 2_000_000);
        entryId = await post(`Trust deposit — ${context.faker.company.buzzPhrase()}`, [
          { accountId: chart.trustBank, direction: "debit", amount: money(depositMinor, USD) },
          {
            accountId: subledgers[subledger]!,
            direction: "credit",
            amount: money(depositMinor, USD),
          },
        ]);
        trustHeldMinor[subledger]! += depositMinor;
        subledgerPostings[subledger]! += 1;
        break;
      }
      case "trustDisbursement": {
        // Deterministic pick among FUNDED subledgers only.
        const funded = trustHeldMinor
          .map((held, subledgerIndex) => ({ held, subledgerIndex }))
          .filter((candidate) => candidate.held > 0);
        const choice = funded[context.faker.number.int({ min: 0, max: funded.length - 1 })]!;
        const disbursementMinor = amount(1, choice.held); // min 1: a barely-funded subledger must still disburse validly
        entryId = await post("Trust disbursement to client", [
          {
            accountId: subledgers[choice.subledgerIndex]!,
            direction: "debit",
            amount: money(disbursementMinor, USD),
          },
          {
            accountId: chart.trustBank,
            direction: "credit",
            amount: money(disbursementMinor, USD),
          },
        ]);
        trustHeldMinor[choice.subledgerIndex]! -= disbursementMinor;
        subledgerPostings[choice.subledgerIndex]! += 1;
        break;
      }
      case "feeBilled": {
        const feeMinor = amount(50_000, 3_000_000);
        entryId = await post("Fee billed — hourly matter", [
          {
            accountId: chart.accountsReceivable,
            direction: "debit",
            amount: money(feeMinor, USD),
          },
          { accountId: chart.feeIncome, direction: "credit", amount: money(feeMinor, USD) },
        ]);
        receivableMinor += feeMinor;
        break;
      }
      case "paymentReceived": {
        const paymentMinor = Math.min(amount(50_000, 3_000_000), receivableMinor);
        entryId = await post("Client payment on account", [
          { accountId: chart.operatingBank, direction: "debit", amount: money(paymentMinor, USD) },
          {
            accountId: chart.accountsReceivable,
            direction: "credit",
            amount: money(paymentMinor, USD),
          },
        ]);
        receivableMinor -= paymentMinor;
        break;
      }
      case "operatingExpense": {
        // One in five expense entries advances client costs instead (feeds the settlement
        // archetype's recovery line so it never recovers money that was not advanced).
        const advancesCosts = context.faker.number.int({ min: 1, max: 5 }) === 1;
        const expenseMinor = amount(5_000, 1_500_000);
        const debitAccount = advancesCosts
          ? chart.clientCostsAdvanced
          : expenseAccounts[context.faker.number.int({ min: 0, max: expenseAccounts.length - 1 })]!;
        entryId = await post(
          advancesCosts ? "Costs advanced — client matters" : "Operating expense",
          [
            { accountId: debitAccount, direction: "debit", amount: money(expenseMinor, USD) },
            {
              accountId: chart.operatingBank,
              direction: "credit",
              amount: money(expenseMinor, USD),
            },
          ],
        );
        if (advancesCosts) {
          costsAdvancedMinor += expenseMinor;
        } else if (context.faker.number.float({ min: 0, max: 1 }) < profile.reversalRate) {
          // Reversals exercise the reverse path at volume. Only plain operating expenses are
          // reversed: trust and receivable archetypes would need their in-memory tracking unwound.
          const reversal = await reverseEntry(
            database,
            {
              entryId,
              description: "Posted in error — reversed",
              effectiveDate: context.clock.today(),
            },
            serviceOptions,
          );
          await commit(reversal.effect);
          totalEntries += 1;
        }
        break;
      }
      case "settlement": {
        // The multi-line tail: operating bank receives; fee income, cost recovery, and (when
        // costs are outstanding) the costs-advanced receivable make 3-4 credit lines.
        const feePartMinor = amount(100_000, 2_000_000);
        const recoveryPartMinor = amount(10_000, 200_000);
        const costsPartMinor = Math.min(amount(10_000, 300_000), costsAdvancedMinor);
        const lines: EntryLineInput[] = [
          {
            accountId: chart.operatingBank,
            direction: "debit",
            amount: money(feePartMinor + recoveryPartMinor + costsPartMinor, USD),
          },
          { accountId: chart.feeIncome, direction: "credit", amount: money(feePartMinor, USD) },
          {
            accountId: chart.costRecoveryIncome,
            direction: "credit",
            amount: money(recoveryPartMinor, USD),
          },
        ];
        if (costsPartMinor > 0) {
          lines.push({
            accountId: chart.clientCostsAdvanced,
            direction: "credit",
            amount: money(costsPartMinor, USD),
          });
          costsAdvancedMinor -= costsPartMinor;
        }
        entryId = await post("Settlement received — fees and recovered costs", lines);
        break;
      }
      default: {
        // Exhaustiveness: every ArchetypeWeights key has a case above; a new archetype without a
        // case must fail loudly, not skip an entry.
        throw new Error(`load-profile: unhandled archetype ${String(archetype)}`);
      }
    }
    sampleEntryId ??= entryId!;
    context.clock.advanceMinutes(minutesPerEntry);
  }

  if (sampleEntryId === null) throw new Error("load-profile: profile generated no entries");
  let busyIndex = 0;
  for (let index = 1; index < subledgerPostings.length; index += 1) {
    if (subledgerPostings[index]! > subledgerPostings[busyIndex]!) busyIndex = index;
  }

  return {
    entryCount: totalEntries,
    probes: {
      operatingBankAccountId: chart.operatingBank,
      trustBankAccountId: chart.trustBank,
      clientTrustLiabilityAccountId: chart.clientTrustLiability,
      feeIncomeAccountId: chart.feeIncome,
      busySubledgerAccountId: subledgers[busyIndex]!,
      sampleEntryId,
    },
  };
}
```

- [ ] **Step 4: Add the export entry**

In `packages/fixtures/package.json` `"exports"`:

```json
"./load-profile/generate": "./src/load-profile/generate.ts"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: PASS — including fitness over the generated book and the seed-twice determinism proof. If the determinism test fails, the generator has a faker-call-order dependence on mutable state — find the non-deterministic branch (it is always a conditional that consumes a different number of faker draws per run with the same seed; the fallback re-draws are deterministic because the faker stream itself is seeded).

- [ ] **Step 6: Commit**

```bash
git add packages/fixtures/src/load-profile/generate.ts packages/fixtures/test/load-profile-generate.test.ts packages/fixtures/package.json
vp check && git commit -m "feat(fixtures): load-profile volume generation through the real write paths"
```

---

### Task 4: Snapshot & replay — manifest, content-keyed cache, working copies

**Files:**

- Create: `packages/fixtures/src/load-profile/snapshot.ts`
- Create: `packages/fixtures/test/load-profile-snapshot.test.ts`
- Modify: `packages/fixtures/package.json` (export entry)

- [ ] **Step 1: Check for an existing canonical-JSON helper (reuse before building)**

Run: `rg -n "canonical|stableStringify|sortKeys" packages/data-access/src packages/identifiers/src`
If `@magna-carta/data-access` exports a canonical-JSON stringifier (the idempotency fingerprint uses one), import and use it in Step 4 instead of the local `stableStringify` below — delete the local copy. If it is not exported (internal to the fingerprint module), keep the local helper; do not widen another package's API for a fixtures nicety (the established precedent).

- [ ] **Step 2: Write the failing test**

```typescript
// packages/fixtures/test/load-profile-snapshot.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { loadProfileSnapshot } from "../src/load-profile/snapshot.ts";

const TINY = scaleProfile(ledgerVolume, 0.002);

describe("load-profile snapshots", () => {
  const temporaryDirectories: string[] = [];
  const newCacheDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-load-profile-cache-"));
    temporaryDirectories.push(directory);
    return directory;
  };
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates on a cache miss, replays on a hit, and the replayed data is intact", async () => {
    const cacheDirectory = newCacheDirectory();
    let generations = 0;
    const options = {
      allowSeeding: true as const,
      cacheDirectory,
      onGenerate: () => {
        generations += 1;
      },
    };

    const first = await loadProfileSnapshot(TINY, "snap-seed", options);
    expect(generations).toBe(1);
    expect(existsSync(join(cacheDirectory, `${first.cacheKey}.sqlite`))).toBe(true);
    expect(existsSync(join(cacheDirectory, `${first.cacheKey}.json`))).toBe(true);
    const { results: firstCount } = await first.database
      .prepare("SELECT COUNT(*) AS n FROM ledger_entry")
      .all<{ n: number }>();
    first.close();

    const second = await loadProfileSnapshot(TINY, "snap-seed", options);
    expect(generations).toBe(1); // replayed, not regenerated
    const { results: secondCount } = await second.database
      .prepare("SELECT COUNT(*) AS n FROM ledger_entry")
      .all<{ n: number }>();
    expect(secondCount).toEqual(firstCount);
    expect(second.manifest.probes.busySubledgerAccountId).toBe(
      first.manifest.probes.busySubledgerAccountId,
    );
    second.close();
  });

  it("regenerates when snapshot identity changes (profile version bump)", async () => {
    const cacheDirectory = newCacheDirectory();
    let generations = 0;
    const options = {
      allowSeeding: true as const,
      cacheDirectory,
      onGenerate: () => {
        generations += 1;
      },
    };
    const first = await loadProfileSnapshot(TINY, "ident-seed", options);
    first.close();
    const bumped = { ...TINY, version: TINY.version + 1 };
    const second = await loadProfileSnapshot(bumped, "ident-seed", options);
    second.close();
    expect(generations).toBe(2);
    expect(second.cacheKey).not.toBe(first.cacheKey);
  });

  it("hands out an isolated working copy — writes never touch the cached artifact", async () => {
    const cacheDirectory = newCacheDirectory();
    const options = { allowSeeding: true as const, cacheDirectory };
    const first = await loadProfileSnapshot(TINY, "copy-seed", options);
    // Mutate the working copy directly (sanctioned: deliberate corruption in tests).
    first.raw.prepare("DELETE FROM outbox").run();
    first.close();
    const second = await loadProfileSnapshot(TINY, "copy-seed", options);
    const { results } = await second.database
      .prepare("SELECT COUNT(*) AS n FROM outbox")
      .all<{ n: number }>();
    expect(results[0]!.n).toBeGreaterThan(0); // the cached artifact was untouched
    second.close();
  });

  it("refuses without the seeding opt-in", async () => {
    await expect(
      loadProfileSnapshot(TINY, "guard-seed", {
        allowSeeding: false,
        cacheDirectory: newCacheDirectory(),
      }),
    ).rejects.toThrow(/allowSeeding/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: FAIL — `snapshot.ts` does not exist.

- [ ] **Step 4: Implement the snapshot layer**

```typescript
// packages/fixtures/src/load-profile/snapshot.ts
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import {
  createMigratedNodeDatabase,
  loadMigrationsFromDisk,
  openNodeDatabaseFile,
  type MigratedNodeDatabase,
} from "@magna-carta/database/node-sqlite";
import { fixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import { generateLedgerVolume, type VolumeProbes } from "./generate.ts";
import { GENERATOR_VERSION, type LedgerVolumeProfile } from "./profile.ts";

// Snapshot identity (design §3.2): the resolved profile parameters, the generation seed, the
// per-firm schema state (migration journal tags), and the generator version. Any mismatch is a
// different artifact — stale snapshots structurally cannot be replayed.
export interface SnapshotManifest {
  readonly profile: LedgerVolumeProfile;
  readonly seed: string;
  readonly schemaTags: readonly string[];
  readonly generatorVersion: number;
  readonly entryCount: number;
  readonly probes: VolumeProbes;
}

export interface LoadedSnapshot extends MigratedNodeDatabase {
  readonly cacheKey: string;
  readonly manifest: SnapshotManifest;
  readonly workingPath: string; // the isolated copy measurements run against
  close(): void;
}

export interface SnapshotOptions extends SeedingOptions {
  readonly cacheDirectory?: string;
  readonly onGenerate?: () => void; // testability: observe cache misses
}

// Default cache: node_modules/.cache — gitignored by construction, no .gitignore edit to forget
// (design §3.2: cache, don't commit).
const DEFAULT_CACHE_DIRECTORY = join(
  import.meta.dirname,
  "..",
  "..",
  "node_modules",
  ".cache",
  "load-profile",
);

// Minimal canonical JSON for the cache key (objects get sorted keys; arrays keep order). If
// @magna-carta/data-access exports its canonical-JSON helper, use that instead (reuse first).
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function snapshotCacheKey(profile: LedgerVolumeProfile, seed: string): string {
  const schemaTags = loadMigrationsFromDisk("per-firm").map((migration) => migration.tag);
  const identity = stableStringify({
    generatorVersion: GENERATOR_VERSION,
    profile,
    schemaTags,
    seed,
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

// Generate-or-replay (design §3.2): cache miss generates through the real write paths and
// persists artifact + manifest; cache hit copies the artifact to an isolated working file —
// measurement writes never touch the cache.
export async function loadProfileSnapshot(
  profile: LedgerVolumeProfile,
  seed: string,
  options: SnapshotOptions,
): Promise<LoadedSnapshot> {
  assertSeedingAllowed(options);
  const cacheDirectory = options.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY;
  mkdirSync(cacheDirectory, { recursive: true });
  const cacheKey = snapshotCacheKey(profile, seed);
  const artifactPath = join(cacheDirectory, `${cacheKey}.sqlite`);
  const manifestPath = join(cacheDirectory, `${cacheKey}.json`);

  if (!existsSync(artifactPath) || !existsSync(manifestPath)) {
    options.onGenerate?.();
    const generated = createMigratedNodeDatabase("per-firm");
    const result = await generateLedgerVolume(
      generated.database,
      fixtureContext(seed),
      profile,
      options,
    );
    const manifest: SnapshotManifest = {
      profile,
      seed,
      schemaTags: loadMigrationsFromDisk("per-firm").map((migration) => migration.tag),
      generatorVersion: GENERATOR_VERSION,
      entryCount: result.entryCount,
      probes: result.probes,
    };
    await backup(generated.raw, artifactPath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    generated.raw.close();
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  const workingDirectory = mkdtempSync(join(tmpdir(), "mc-load-profile-"));
  const workingPath = join(workingDirectory, "working.sqlite");
  copyFileSync(artifactPath, workingPath);
  const opened = openNodeDatabaseFile(workingPath);
  return {
    ...opened,
    cacheKey,
    manifest,
    workingPath,
    close: () => opened.raw.close(),
  };
}
```

- [ ] **Step 5: Add the export entry**

In `packages/fixtures/package.json` `"exports"`:

```json
"./load-profile/snapshot": "./src/load-profile/snapshot.ts"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fixtures/src/load-profile/snapshot.ts packages/fixtures/test/load-profile-snapshot.test.ts packages/fixtures/package.json
vp check && git commit -m "feat(fixtures): load-profile snapshot artifacts - content-keyed cache + working-copy replay"
```

---

### Task 5: Measurement runner — timing statistics, plan capture, baselines

**Files:**

- Create: `packages/fixtures/src/load-profile/runner.ts`
- Create: `packages/fixtures/test/load-profile-runner.test.ts`
- Modify: `packages/fixtures/package.json` (export entry)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fixtures/test/load-profile-runner.test.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  explainStatement,
  findFullScans,
  runMeasurements,
  writeBaselineFile,
  type Measurement,
} from "../src/load-profile/runner.ts";

describe("load-profile measurement runner", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs warmup + timed iterations and reports ordered statistics", async () => {
    let calls = 0;
    const measurement: Measurement<null> = {
      name: "noop",
      operation: () => {
        calls += 1;
        return Promise.resolve();
      },
    };
    const [result] = await runMeasurements(null, [measurement], {
      warmupIterations: 2,
      iterations: 10,
    });
    expect(calls).toBe(12);
    expect(result!.name).toBe("noop");
    expect(result!.iterations).toBe(10);
    expect(result!.minMs).toBeLessThanOrEqual(result!.medianMs);
    expect(result!.medianMs).toBeLessThanOrEqual(result!.p95Ms);
  });

  it("passes prepared per-iteration state to the operation, untimed", async () => {
    const prepared: number[] = [];
    const operated: number[] = [];
    let counter = 0;
    const measurement: Measurement<null, number> = {
      name: "stateful",
      prepare: () => {
        counter += 1;
        prepared.push(counter);
        return Promise.resolve(counter);
      },
      operation: (_handle, state) => {
        operated.push(state);
        return Promise.resolve();
      },
    };
    await runMeasurements(null, [measurement], { warmupIterations: 1, iterations: 3 });
    expect(prepared).toEqual([1, 2, 3, 4]);
    expect(operated).toEqual([1, 2, 3, 4]);
  });

  it("captures query plans and flags full scans, honoring the allowlist", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("CREATE TABLE scanned (id TEXT PRIMARY KEY, payload TEXT)");
    const scanning = explainStatement(raw, "SELECT payload FROM scanned WHERE payload = ?1", ["x"]);
    const indexed = explainStatement(raw, "SELECT payload FROM scanned WHERE id = ?1", ["x"]);
    expect(findFullScans([{ label: "by-payload", details: scanning }])).toEqual(["by-payload"]);
    expect(findFullScans([{ label: "by-id", details: indexed }])).toEqual([]);
    expect(findFullScans([{ label: "by-payload", details: scanning }], ["by-payload"])).toEqual([]);
    raw.close();
  });

  it("writes a stable, human-diffable baseline file", () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-baseline-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "baseline.json");
    writeBaselineFile(path, {
      profileName: "ledgerVolume",
      profileVersion: 1,
      cacheKey: "abc123",
      results: [
        { name: "zeta", iterations: 5, minMs: 1, medianMs: 2, p95Ms: 3 },
        { name: "alpha", iterations: 5, minMs: 1, medianMs: 2, p95Ms: 3 },
      ],
    });
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      results: { name: string }[];
    };
    // Results are sorted by name so re-measuring yields minimal diffs.
    expect(written.results.map((result) => result.name)).toEqual(["alpha", "zeta"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: FAIL — `runner.ts` does not exist.

- [ ] **Step 3: Implement the runner**

```typescript
// packages/fixtures/src/load-profile/runner.ts
import { writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

// THE SANCTIONED WALL-CLOCK READ. The fixtures determinism rule bans wall-clock reads in DATA
// generation (ADR-0034); the runner only OBSERVES — timing samples never feed generated rows.
// performance.now() is monotonic, which Date.now() is not (NTP steps would corrupt samples).
const nowMs = (): number => performance.now();

export interface Measurement<Handle, State = undefined> {
  readonly name: string;
  // Untimed per-iteration setup (e.g. post the entry a reverse-entry measurement consumes —
  // an entry cannot be reversed twice, so each iteration needs a fresh one).
  readonly prepare?: (handle: Handle) => Promise<State>;
  readonly operation: (handle: Handle, state: State) => Promise<void>;
}

export interface MeasurementResult {
  readonly name: string;
  readonly iterations: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

export interface RunnerOptions {
  readonly warmupIterations: number;
  readonly iterations: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function percentile(sortedSamples: readonly number[], fraction: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(fraction * sortedSamples.length) - 1),
  );
  return sortedSamples[index]!;
}

// Warmup + timed iterations → min/median/p95 (design §3.3). Numbers are RELATIVE — local
// node:sqlite is not production D1 (the design's honesty clause); they decide regressions,
// growth curves, and plan shapes, never absolute latencies.
export async function runMeasurements<Handle>(
  handle: Handle,
  measurements: readonly Measurement<Handle, never>[] | readonly Measurement<Handle, unknown>[],
  options: RunnerOptions,
): Promise<MeasurementResult[]> {
  const results: MeasurementResult[] = [];
  for (const measurement of measurements) {
    const samples: number[] = [];
    const total = options.warmupIterations + options.iterations;
    for (let iteration = 0; iteration < total; iteration += 1) {
      const state = measurement.prepare ? await measurement.prepare(handle) : undefined;
      const startedMs = nowMs();
      await measurement.operation(handle, state as never);
      const elapsedMs = nowMs() - startedMs;
      if (iteration >= options.warmupIterations) samples.push(elapsedMs);
    }
    samples.sort((left, right) => left - right);
    results.push({
      name: measurement.name,
      iterations: options.iterations,
      minMs: round(samples[0]!),
      medianMs: round(percentile(samples, 0.5)),
      p95Ms: round(percentile(samples, 0.95)),
    });
  }
  return results;
}

export interface QueryPlanRow {
  readonly detail: string;
}

export interface LabeledPlan {
  readonly label: string;
  readonly details: readonly string[];
}

// EXPLAIN QUERY PLAN for one statement. Plan shape is timing-noise-free: it catches missing
// indexes and N+1 patterns structurally (golden rule 10's mechanical no-N+1 detector).
export function explainStatement(
  raw: DatabaseSync,
  sql: string,
  bindings: readonly unknown[],
): string[] {
  const rows = raw
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(bindings as never[])) as unknown as QueryPlanRow[];
  return rows.map((row) => row.detail);
}

// A `SCAN <table>` detail line is a full table scan (an index walk reads `SEARCH … USING INDEX` /
// `USING INTEGER PRIMARY KEY`). Table-wide aggregates (the fitness queries) scan by nature —
// allowlist them by label.
export function findFullScans(
  plans: readonly LabeledPlan[],
  allowlist: readonly string[] = [],
): string[] {
  return plans
    .filter((plan) => !allowlist.includes(plan.label))
    .filter((plan) => plan.details.some((detail) => detail.startsWith("SCAN")))
    .map((plan) => plan.label);
}

export interface BaselineFile {
  readonly profileName: string;
  readonly profileVersion: number;
  readonly cacheKey: string;
  readonly results: readonly MeasurementResult[];
}

// Small, sorted, committed, human-diffed (design §3.3) — never CI-gated in this slice.
export function writeBaselineFile(path: string, baseline: BaselineFile): void {
  const sorted: BaselineFile = {
    ...baseline,
    results: [...baseline.results].sort((left, right) => left.name.localeCompare(right.name)),
  };
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
```

- [ ] **Step 4: Add the export entry**

In `packages/fixtures/package.json` `"exports"`:

```json
"./load-profile/runner": "./src/load-profile/runner.ts"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fixtures/src/load-profile/runner.ts packages/fixtures/test/load-profile-runner.test.ts packages/fixtures/package.json
vp check && git commit -m "feat(fixtures): load-profile measurement runner - timing statistics, plan capture, baselines"
```

---

### Task 6: The v1 ledger measurement set + the CI smoke test

The measured operations are the slice 0·3 deferred efficiency candidates plus the hot reads. Critical detail: the measurement context derives its seed as `${seed}:measure` — replaying the GENERATION seed would mint the same identifier sequence the snapshot already holds and collide on UNIQUE primary keys.

**Files:**

- Create: `packages/fixtures/src/load-profile/ledger-measurements.ts`
- Create: `packages/fixtures/test/load-profile-smoke.test.ts`
- Modify: `packages/fixtures/package.json` (export entry)

- [ ] **Step 1: Write the failing test (this IS the CI smoke — tiny scale, no timing assertions)**

```typescript
// packages/fixtures/test/load-profile-smoke.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hotPathPlans,
  ledgerMeasurements,
  measurementHandle,
  PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/ledger-measurements.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { findFullScans, runMeasurements } from "../src/load-profile/runner.ts";
import { loadProfileSnapshot } from "../src/load-profile/snapshot.ts";

// The CI smoke (design §2): the harness stays green end-to-end at tiny scale. NO timing
// assertions — budgets are deferred until stable numbers exist (performance.md).
describe("load-profile smoke", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("snapshots, measures every v1 operation, and keeps hot-path statements scan-free", async () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), "mc-smoke-cache-"));
    temporaryDirectories.push(cacheDirectory);
    const snapshot = await loadProfileSnapshot(scaleProfile(ledgerVolume, 0.002), "smoke-seed", {
      allowSeeding: true,
      cacheDirectory,
    });
    const handle = measurementHandle(snapshot, "smoke-seed");

    const results = await runMeasurements(handle, ledgerMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(results.map((result) => result.name).sort()).toEqual(
      [
        "balance-read.busy-subledger",
        "create-account.trust-subledger",
        "ledger-fitness.table-wide",
        "post-entry.two-line",
        "reverse-entry.two-line",
      ].sort(),
    );
    for (const result of results) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The structural no-N+1/no-missing-index check on the hot-path statements.
    const scans = findFullScans(hotPathPlans(snapshot), PLAN_SCAN_ALLOWLIST);
    expect(scans).toEqual([]);

    snapshot.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: FAIL — `ledger-measurements.ts` does not exist.

- [ ] **Step 3: Implement the measurement set**

```typescript
// packages/fixtures/src/load-profile/ledger-measurements.ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { LedgerEntryId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { assertLedgerFitness } from "@magna-carta/ledger/fitness";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import { selectAccountBalanceStatement } from "@magna-carta/ledger/statements";
import { money, USD } from "@magna-carta/money/money";
import { fixtureContext, type FixtureContext } from "../context.ts";
import type { Measurement, LabeledPlan } from "./runner.ts";
import { explainStatement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

export interface LedgerMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
}

// The measurement context derives a DIFFERENT seed: replaying the generation seed would mint the
// exact identifier sequence the snapshot already contains → UNIQUE primary-key collisions on the
// first measured write. `${seed}:measure` keeps determinism with a disjoint stream.
export function measurementHandle(snapshot: LoadedSnapshot, seed: string): LedgerMeasurementHandle {
  return { snapshot, context: fixtureContext(`${seed}:measure`) };
}

const serviceOptions = (context: FixtureContext) => ({
  clock: context.clock,
  randomSource: context.randomSource,
});

async function postMeasurementEntry(handle: LedgerMeasurementHandle): Promise<LedgerEntryId> {
  const { probes } = handle.snapshot.manifest;
  const posted = await postEntry(
    handle.snapshot.database,
    {
      description: "Load-profile measurement entry",
      effectiveDate: handle.context.clock.today(),
      lines: [
        { accountId: probes.operatingBankAccountId, direction: "debit", amount: money(12345, USD) },
        { accountId: probes.feeIncomeAccountId, direction: "credit", amount: money(12345, USD) },
      ],
    },
    serviceOptions(handle.context),
  );
  await commitEffectBatch(handle.snapshot.database, posted.effect, {
    now: () => handle.context.clock.now(),
  });
  return posted.entryId;
}

// The v1 measured set = the slice 0·3 deferred efficiency candidates + the hot reads
// (design §5): read coalescing in reverseEntry/createAccount, the posting write path, the
// materialized balance read, and the table-wide fitness sweep at volume.
export const ledgerMeasurements: readonly Measurement<LedgerMeasurementHandle, unknown>[] = [
  {
    name: "balance-read.busy-subledger",
    operation: async (handle) => {
      await selectAccountBalanceStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.probes.busySubledgerAccountId,
      ).all();
    },
  },
  {
    name: "post-entry.two-line",
    operation: async (handle) => {
      await postMeasurementEntry(handle);
    },
  },
  {
    name: "reverse-entry.two-line",
    // An entry reverses exactly once (UNIQUE reverses_entry_id) — each iteration prepares a
    // fresh one, untimed; only the reverse is on the clock.
    prepare: (handle) => postMeasurementEntry(handle),
    operation: async (handle, state) => {
      const reversal = await reverseEntry(
        handle.snapshot.database,
        {
          entryId: state as LedgerEntryId,
          description: "Load-profile measurement reversal",
          effectiveDate: handle.context.clock.today(),
        },
        serviceOptions(handle.context),
      );
      await commitEffectBatch(handle.snapshot.database, reversal.effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
  {
    name: "create-account.trust-subledger",
    operation: async (handle) => {
      const { accountId: _accountId, effect } = await createAccount(
        handle.snapshot.database,
        {
          name: `Trust — ${handle.context.faker.person.fullName()}`,
          type: "liability",
          currency: "USD",
          parentAccountId: handle.snapshot.manifest.probes.clientTrustLiabilityAccountId,
        },
        serviceOptions(handle.context),
      );
      await commitEffectBatch(handle.snapshot.database, effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
  {
    name: "ledger-fitness.table-wide",
    operation: async (handle) => {
      await assertLedgerFitness(handle.snapshot.database);
    },
  },
];

// Fitness queries are table-wide aggregates — scans by nature, allowlisted by label. The hot-path
// reads must walk an index or the primary key.
export const PLAN_SCAN_ALLOWLIST: readonly string[] = ["ledger-fitness"];

export function hotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { probes } = snapshot.manifest;
  const balanceStatement = selectAccountBalanceStatement(
    snapshot.database,
    probes.busySubledgerAccountId,
  );
  return [
    {
      label: "balance-read.busy-subledger",
      details: explainStatement(snapshot.raw, balanceStatement.sql, balanceStatement.bindings),
    },
    {
      label: "entry-read.by-id",
      details: explainStatement(snapshot.raw, "SELECT * FROM ledger_entry WHERE id = ?1", [
        probes.sampleEntryId,
      ]),
    },
    {
      label: "lines-read.by-entry",
      details: explainStatement(snapshot.raw, "SELECT * FROM ledger_line WHERE entry_id = ?1", [
        probes.sampleEntryId,
      ]),
    },
  ];
}
```

Note on `balanceStatement.sql` / `.bindings`: those fields exist on the node-sqlite adapter's `NodeSqlStatement`. If `vp check` rejects the access because the ledger statement type (`SqlStatement`) does not declare them, capture the plan with the literal SQL instead: `explainStatement(snapshot.raw, "SELECT balance_minor FROM account_balance WHERE account_id = ?1", [probes.busySubledgerAccountId])` — and note that the literal lives outside the schema-name-sync net (the smoke test will fail loudly on a rename, which is acceptable for an EXPLAIN probe).

If `lines-read.by-entry` reports a `SCAN` (no index on `ledger_line.entry_id` exists yet), that is the detector working — do NOT add a migration in this slice (schema changes ride domain slices); move that label to `PLAN_SCAN_ALLOWLIST` with a comment naming it a known finding for the ledger's next open slice, and record it in the final task's CHANGELOG entry.

- [ ] **Step 4: Add the export entry**

In `packages/fixtures/package.json` `"exports"`:

```json
"./load-profile/ledger-measurements": "./src/load-profile/ledger-measurements.ts"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/fixtures test`
Expected: PASS — the full suite, including the smoke.

- [ ] **Step 6: Commit**

```bash
git add packages/fixtures/src/load-profile/ledger-measurements.ts packages/fixtures/test/load-profile-smoke.test.ts packages/fixtures/package.json
vp check && git commit -m "feat(fixtures): v1 ledger measurement set + load-profile CI smoke"
```

---

### Task 7: The `measure` script — produce the committed baseline

**Files:**

- Create: `packages/fixtures/src/load-profile/measure-cli.ts`
- Modify: `packages/fixtures/package.json` (script)
- Create: `packages/fixtures/baselines/ledgerVolume-v1.json` (by running the script)

- [ ] **Step 1: Implement the script**

```typescript
// packages/fixtures/src/load-profile/measure-cli.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  hotPathPlans,
  ledgerMeasurements,
  measurementHandle,
  PLAN_SCAN_ALLOWLIST,
} from "./ledger-measurements.ts";
import { ledgerVolume } from "./profile.ts";
import { findFullScans, runMeasurements, writeBaselineFile } from "./runner.ts";
import { loadProfileSnapshot } from "./snapshot.ts";

// Produce/refresh the committed baseline for the full-scale ledgerVolume profile. Local-only,
// owner-run; numbers are machine-relative (the design's honesty clause) — compare across commits
// on ONE machine, never across machines. First run generates the snapshot (minutes); replays are
// instant.
const BASELINE_SEED = "ledger-volume-baseline";

const snapshot = await loadProfileSnapshot(ledgerVolume, BASELINE_SEED, { allowSeeding: true });
console.log(
  `snapshot ${snapshot.cacheKey}: ${snapshot.manifest.entryCount} entries (profile v${snapshot.manifest.profile.version})`,
);

const scans = findFullScans(hotPathPlans(snapshot), PLAN_SCAN_ALLOWLIST);
if (scans.length > 0) {
  console.error(`full table scans on hot paths: ${scans.join(", ")}`);
}

const results = await runMeasurements(
  measurementHandle(snapshot, BASELINE_SEED),
  ledgerMeasurements,
  {
    warmupIterations: 3,
    iterations: 30,
  },
);
for (const result of results) {
  console.log(
    `${result.name}: median ${result.medianMs}ms · p95 ${result.p95Ms}ms · min ${result.minMs}ms (${result.iterations} iterations)`,
  );
}

const baselineDirectory = join(import.meta.dirname, "..", "..", "baselines");
mkdirSync(baselineDirectory, { recursive: true });
const baselinePath = join(baselineDirectory, `${ledgerVolume.name}-v${ledgerVolume.version}.json`);
writeBaselineFile(baselinePath, {
  profileName: ledgerVolume.name,
  profileVersion: ledgerVolume.version,
  cacheKey: snapshot.cacheKey,
  results,
});
console.log(`baseline written: ${baselinePath}`);
snapshot.close();
```

- [ ] **Step 2: Add the script**

In `packages/fixtures/package.json` `"scripts"`:

```json
"measure": "node src/load-profile/measure-cli.ts"
```

(Node 25 runs erasable-syntax TypeScript natively. If module resolution of the `@magna-carta/*` workspace specifiers fails under plain `node`, fall back to `"measure": "vitest run --no-file-parallelism test/measure-entry.ts"` with a thin test wrapper gated on `process.env["MEASURE"] === "1"` — but try plain `node` first.)

- [ ] **Step 3: Run it and verify the baseline exists**

Run: `pnpm --filter @magna-carta/fixtures run measure`
Expected: snapshot generation (first run takes minutes at 25k entries), then per-measurement lines, then `baseline written: …/baselines/ledgerVolume-v1.json`. Verify the JSON parses and `results` has the five names.

The `console.log` calls here predate the slice 0·6 console-ban fitness function; when 0·6 lands, `measure-cli.ts` either moves onto the telemetry logger or gets an explicit exemption (it is a dev-only CLI, never Worker code) — leave a one-line comment noting this at the first `console.log`.

- [ ] **Step 4: Commit (script + the generated baseline)**

```bash
git add packages/fixtures/src/load-profile/measure-cli.ts packages/fixtures/package.json packages/fixtures/baselines/ledgerVolume-v1.json
vp check && git commit -m "feat(fixtures): measure script + first committed ledgerVolume baseline"
```

---

### Task 8: Documentation closeout (same-commit discipline)

**Files:**

- Modify: `packages/fixtures/CLAUDE.md`
- Modify: `docs/conventions/performance.md`
- Modify: `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`

- [ ] **Step 1: Extend `packages/fixtures/CLAUDE.md`**

Add to "Key files / entry points":

```markdown
- `src/load-profile/` — the volume harness (ADR-0083): profiles, generation, snapshot cache,
  measurement runner, the v1 ledger measurement set, and the `measure` script
```

Add to "Invariants that apply here":

```markdown
- **Load-profile identity is versioned.** Changing generation logic for the same profile + seed
  requires a `GENERATOR_VERSION` bump (profile parameter changes bump the profile's own
  `version`) — snapshot cache keys and committed baselines depend on it.
- **The runner's `performance.now()` is the sanctioned wall-clock read.** Timing is observation,
  never data; nothing it returns may feed generated rows.
- **Measurement contexts derive `${seed}:measure`.** Replaying the generation seed against a
  snapshot replays its identifier stream → UNIQUE collisions on the first measured write.
- **Baselines are relative.** Compare across commits on one machine; never across machines, and
  never as production latencies (the design's honesty clause).
```

- [ ] **Step 2: Update `docs/conventions/performance.md`**

In the "Measure-first" section, change:

```markdown
- The fixtures **load profile** (white paper _Synthetic data & fixtures_) is the standing performance/scaling harness.
```

to:

```markdown
- The fixtures **load profile** (white paper _Synthetic data & fixtures_; ADR-0083) is the standing performance/scaling harness: `pnpm --filter @magna-carta/fixtures run measure` produces the committed baselines; the CI smoke keeps it green. Numbers are relative (local `node:sqlite`, not production D1) — regressions and plan shapes, not absolute latencies.
```

- [ ] **Step 3: Flip the trackers**

- `STATUS.md` (Cross-cutting row): set **Built** to `[x]`; update the note to "Built — `pnpm --filter @magna-carta/fixtures run measure`; v1 = harness machinery + ledger volume profile; every later domain slice extends it in-area."
- `ROADMAP.md` (Cross-cutting subsection): mark built with the date, note the committed baseline and any plan-scan findings (e.g. a `ledger_line.entry_id` scan recorded for the ledger's next open slice).
- `CHANGELOG.md` `[Unreleased]` → `### Added`: a "Load-profile harness built" entry following the house style — name the five measured operations, the snapshot cache mechanics, the smoke test, the baseline file, and any findings the plan-scan check surfaced.

- [ ] **Step 4: Commit**

```bash
git add packages/fixtures/CLAUDE.md docs/conventions/performance.md ROADMAP.md STATUS.md CHANGELOG.md
vp check && git commit -m "docs: load-profile harness built - conventions pointer, tracker flips, changelog"
```

Caution: these shared files may carry other sessions' in-flight edits — check `git diff --cached` shows ONLY this slice's changes before committing; if another session's hunks are staged, unstage and coordinate with the owner.

---

## After the build

- **Adversarial review runs during build** (the repo's 7-angle pass; STATUS "Built" means implemented-and-reviewed). Findings about generator realism, snapshot identity holes (anything that can change generated rows without changing the cache key), and runner statistics correctness are the high-value angles.
- **First measured decisions:** run `measure`, then revisit the slice 0·3 deferred efficiency candidates (read coalescing in `reverseEntry`/`createAccount`, prepared-statement caching, chart-seed batching) against the numbers — each gets applied or explicitly re-deferred with its measurement attached.
- **The Tested pass** (independent verification, per-slice — owner's standing rule) runs against the landed slice as its own session.
