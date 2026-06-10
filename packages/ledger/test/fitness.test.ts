import { DatabaseSync } from "node:sqlite";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "@magna-carta/database/node-sqlite";
import { money, USD } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/create-account.ts";
import {
  assertLedgerFitness,
  inconsistentBalancesStatement,
  parentAccountsWithPostingsStatement,
  unbalancedEntriesStatement,
} from "../src/fitness.ts";
import { postEntry } from "../src/post-entry.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };
const now = () => clock.now();

async function setupHealthyLedger() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  const database: BatchDatabase = nodeSqliteBatchDatabase(raw);
  const bank = await createAccount(
    database,
    { name: "Bank", type: "asset", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, bank.effect, { now });
  const income = await createAccount(
    database,
    { name: "Fee Income", type: "income", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(database, income.effect, { now });
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
  await commitEffectBatch(database, posted.effect, { now });
  return { raw, database };
}

describe("ledger fitness queries (ADR-0051) — prove the whole table, not one write", () => {
  it("a healthy ledger yields zero rows from every query", async () => {
    const { database } = await setupHealthyLedger();
    expect((await unbalancedEntriesStatement(database).all()).results).toEqual([]);
    expect((await inconsistentBalancesStatement(database).all()).results).toEqual([]);
    expect((await parentAccountsWithPostingsStatement(database).all()).results).toEqual([]);
    await expect(assertLedgerFitness(database)).resolves.toBeUndefined();
  });

  it("detects a parent account carrying direct postings (the creation/posting TOCTOU backstop)", async () => {
    const { raw, database } = await setupHealthyLedger();
    // Simulate the acknowledged race landing: a child appears under the posted-to Bank account
    // (createAccount would refuse with parent-has-postings — only the concurrent-batch race or
    // direct tampering can produce this state, which is exactly what fitness exists to catch).
    raw
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, parent_account_id, active, created_at) SELECT 'acct_racechild0000000000', 'Race child', type, currency, id, 1, created_at FROM ledger_account WHERE name = 'Bank'",
      )
      .run();
    const offenders = (await parentAccountsWithPostingsStatement(database).all()).results;
    expect(offenders).toHaveLength(1);
    await expect(assertLedgerFitness(database)).rejects.toThrow(/parent accounts with postings/);
  });

  it("detects a corrupted balance row (simulated drift)", async () => {
    const { raw, database } = await setupHealthyLedger();
    // Corrupt the materialized balance directly (the very thing the query exists to catch).
    raw.prepare("UPDATE account_balance SET balance_minor = 999").run();
    const drifted = (await inconsistentBalancesStatement(database).all()).results;
    expect(drifted).toHaveLength(2); // both accounts now disagree with their recomputed sums
  });

  it("detects an unbalanced entry (simulated direct tampering)", async () => {
    const { raw, database } = await setupHealthyLedger();
    // Append-only is enforced in code, not the schema — simulate a tampered line amount.
    raw.prepare("UPDATE ledger_line SET amount_minor = 30000 WHERE direction = 'debit'").run();
    const unbalanced = (await unbalancedEntriesStatement(database).all()).results;
    expect(unbalanced).toHaveLength(1);
  });
});
