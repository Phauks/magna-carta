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

  it("run() outside a batch autocommits independently", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const { meta } = await database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("acct_ccccccccccccccccccccc", "Trust Bank", "2026-01-05T09:00:00.000Z")
      .run();
    expect(meta.changes).toBe(1);
    // Visible immediately through the raw handle — committed, not held in an open transaction.
    const row = raw
      .prepare("SELECT name FROM ledger_account WHERE id = ?")
      .get("acct_ccccccccccccccccccccc") as { name: string };
    expect(row.name).toBe("Trust Bank");
  });
});
