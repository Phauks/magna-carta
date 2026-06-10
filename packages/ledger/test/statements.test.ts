import { DatabaseSync } from "node:sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
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

// Typed as the data-access BatchDatabase (the shape the builders compose into) — the node:sqlite
// adapter satisfies it structurally, so these tests exercise the REAL D1-shaped surface.
function freshDatabase(): BatchDatabase {
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

  it("builder guards: empty snapshot read and non-integer minor units are refused before SQL", () => {
    const database = freshDatabase();
    const accountId = newIdentifier("ledgerAccount");
    expect(() => selectAccountSnapshotsStatement(database, [])).toThrow(/non-empty/);
    expect(() => applyBalanceDeltaStatement(database, accountId, 0.5, NOW)).toThrow(/safe integer/);
    expect(() => applyBalanceDeltaStatement(database, accountId, Number.NaN, NOW)).toThrow(
      /safe integer/,
    );
    expect(() => setAccountBoundsStatement(database, accountId, 0.5, null, NOW)).toThrow(
      /safe integer/,
    );
  });
});
