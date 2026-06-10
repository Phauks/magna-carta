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
import { postEntry } from "../src/post-entry.ts";
import type { ClockPort } from "../src/types.ts";

const clock: ClockPort = { now: () => "2026-06-09T15:00:00.000Z", today: () => "2026-06-09" };
const now = () => clock.now();

function freshDatabase(): BatchDatabase {
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
    await commitEffectBatch(database, effect, { now });
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
    await commitEffectBatch(database, parent.effect, { now });
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

  it("refuses a parent that already has postings (roll-up semantics protected)", async () => {
    const database = freshDatabase();
    const bank = await createAccount(
      database,
      { name: "Trust Bank", type: "asset", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, bank.effect, { now });
    const liability = await createAccount(
      database,
      { name: "Client Trust Liability", type: "liability", currency: "USD" },
      { clock },
    );
    await commitEffectBatch(database, liability.effect, { now });
    // Post directly to the liability account (it is a leaf today, so this is legal).
    const posted = await postEntry(
      database,
      {
        description: "Deposit before subledgers existed",
        effectiveDate: "2026-06-09",
        lines: [
          { accountId: bank.accountId, direction: "debit", amount: money(1000, USD) },
          { accountId: liability.accountId, direction: "credit", amount: money(1000, USD) },
        ],
      },
      { clock },
    );
    await commitEffectBatch(database, posted.effect, { now });
    // Making it a parent NOW would strand its direct postings outside any child — refused.
    await expect(
      createAccount(
        database,
        {
          name: "Dana Smith",
          type: "liability",
          currency: "USD",
          parentAccountId: liability.accountId,
        },
        { clock },
      ),
    ).rejects.toMatchObject({ code: "parent-has-postings" });
  });
});
