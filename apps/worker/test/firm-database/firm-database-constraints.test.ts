import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";

// Constraint-enforcement parity through the proxy + FirmDatabase Durable Object. The DO executes
// already-composed SQL against its own SQLite storage, so SQLite's constraint guarantees must reach
// the worker unchanged: a UNIQUE conflict comes back as the reconstructed "UNIQUE constraint failed"
// message (for the data-access conflict detectors), while every other constraint violation (CHECK,
// NOT NULL, FOREIGN KEY, duplicate PK) surfaces as a real thrown fault — never silently swallowed or
// mistranslated into a typed conflict.
function proxyFor(name: string) {
  return firmDatabaseFor(env.FIRM_DATABASE, name);
}

async function captureBatchError(
  database: ReturnType<typeof proxyFor>,
  sql: string,
): Promise<unknown> {
  try {
    await database.batch([database.prepare(sql)]);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("FirmDatabase constraint parity", () => {
  // H1: a 2-column UNIQUE(a, b) violation committed through the proxy reconstructs the full SQLite
  // message — BOTH columns present — so a composite-unique detector can match it.
  it("reconstructs a composite UNIQUE message with every column (UNIQUE constraint failed: t.a, t.b)", async () => {
    const database = proxyFor("constraints_composite_unique");
    await database
      .prepare(
        "CREATE TABLE composite_unique_probe (a TEXT NOT NULL, b TEXT NOT NULL, payload TEXT, UNIQUE(a, b))",
      )
      .run();
    await database.prepare("INSERT INTO composite_unique_probe (a, b) VALUES ('x', 'y')").run();

    const error = await captureBatchError(
      database,
      "INSERT INTO composite_unique_probe (a, b) VALUES ('x', 'y')",
    );
    expect(error).toBeInstanceOf(Error);
    // The proxy reconstructs the SQLite message from the column list the DO parsed; BOTH columns of
    // the composite key are present and qualified (the DO's raw message carries a trailing
    // ": SQLITE_CONSTRAINT (...)" detail, faithfully preserved — the column list is what detectors match).
    expect((error as Error).message).toContain(
      "UNIQUE constraint failed: composite_unique_probe.a, composite_unique_probe.b",
    );

    // The conflicting row never landed — the whole batch rolled back.
    const count = await database
      .prepare("SELECT count(*) AS c FROM composite_unique_probe")
      .all<{ c: number }>();
    expect(Number(count.results[0]?.c)).toBe(1);
  });

  // H2: a NON-unique constraint violation inside a commitBatch RE-THROWS as a real fault — it must
  // NOT be translated into the typed UNIQUE-conflict outcome (and must not be swallowed).
  it("re-throws a CHECK violation inside a batch as a real fault, never a UNIQUE conflict", async () => {
    const database = proxyFor("constraints_check");
    await database.prepare("CREATE TABLE check_probe (n INTEGER, CHECK (n > 0))").run();

    const error = await captureBatchError(database, "INSERT INTO check_probe (n) VALUES (-1)");
    expect(error).toBeInstanceOf(Error);
    // The fault surfaced — it was not swallowed (the batch did not silently succeed).
    expect(error).not.toBeUndefined();
    // Crucially it is NOT mistranslated into the UNIQUE-conflict message the proxy reconstructs only
    // for a true unique violation.
    expect((error as Error).message).not.toContain("UNIQUE constraint failed");

    // Nothing was written — the batch rolled back.
    const count = await database
      .prepare("SELECT count(*) AS c FROM check_probe")
      .all<{ c: number }>();
    expect(Number(count.results[0]?.c)).toBe(0);
  });

  // H2 (second non-unique kind): a NOT NULL violation likewise re-throws and is not a UNIQUE conflict.
  it("re-throws a NOT NULL violation inside a batch as a real fault, never a UNIQUE conflict", async () => {
    const database = proxyFor("constraints_not_null");
    await database.prepare("CREATE TABLE not_null_probe (id TEXT, label TEXT NOT NULL)").run();

    const error = await captureBatchError(database, "INSERT INTO not_null_probe (id) VALUES ('a')");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("UNIQUE constraint failed");

    const count = await database
      .prepare("SELECT count(*) AS c FROM not_null_probe")
      .all<{ c: number }>();
    expect(Number(count.results[0]?.c)).toBe(0);
  });

  // H3: constraint-enforcement parity on a REAL per-firm table (the ledger tables in 0001_ledger-core)
  // reached through the proxy/DO — FK, CHECK, and duplicate-PK all rejected. A fresh firmId addresses a
  // fresh DO already migrated to head, so these tables exist with their constraints.
  describe("real per-firm ledger tables enforce FK / CHECK / PK", () => {
    it("rejects a FOREIGN KEY violation", async () => {
      const database = proxyFor("constraints_ledger_fk");
      // account_balance.account_id is a FK to ledger_account(id); a non-existent account is rejected.
      let error: unknown;
      try {
        await database
          .prepare(
            "INSERT INTO account_balance (account_id, balance_minor, updated_at) VALUES ('acct_ghost', 0, ?1)",
          )
          .bind(new Date().toISOString())
          .run();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("FOREIGN KEY constraint failed");
    });

    it("rejects a CHECK violation (invalid ledger_account.type)", async () => {
      const database = proxyFor("constraints_ledger_check");
      let error: unknown;
      try {
        await database
          .prepare(
            "INSERT INTO ledger_account (id, name, type, currency, created_at) VALUES ('acct_chk', 'Operating', 'not-a-type', 'USD', ?1)",
          )
          .bind(new Date().toISOString())
          .run();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("CHECK constraint failed");
    });

    it("rejects a duplicate PRIMARY KEY", async () => {
      const database = proxyFor("constraints_ledger_pk");
      const now = new Date().toISOString();
      await database
        .prepare(
          "INSERT INTO ledger_account (id, name, type, currency, created_at) VALUES ('acct_dup', 'Trust', 'asset', 'USD', ?1)",
        )
        .bind(now)
        .run();
      let error: unknown;
      try {
        await database
          .prepare(
            "INSERT INTO ledger_account (id, name, type, currency, created_at) VALUES ('acct_dup', 'Trust Two', 'asset', 'USD', ?1)",
          )
          .bind(now)
          .run();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("UNIQUE constraint failed");
    });
  });
});
