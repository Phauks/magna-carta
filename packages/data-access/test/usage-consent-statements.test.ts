import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  readUsageAnalyticsEnabled,
  readMemberOptedOut,
  usageAnalyticsEnabledDefinition,
} from "../src/usage-consent-statements.ts";
import { writeFirmSettingStatement } from "../src/setting-statements.ts";

// Builds an in-memory SQLite database with the tables and columns needed by the usage-consent
// reads: the setting table (per-firm config) and the member table including the
// opted_out_of_usage_analytics column.
function setupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE member (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      opted_out_of_usage_analytics INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

// Wraps node:sqlite's DatabaseSync in the SqlDatabase surface the statement builders expect:
// positional ?1/?2/... placeholders are normalised to ?, and bind()/all()/run() are wired up.
function makeSqlDatabaseAdapter(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const stmt = {
        sql,
        bind(...values: unknown[]) {
          bindings.push(...values);
          return stmt;
        },
        run() {
          database.prepare(sql.replace(/\?\d+/g, "?")).run(...(bindings as never[]));
          return Promise.resolve({ meta: { changes: 1 } });
        },
        all<T>() {
          const rows = database.prepare(sql.replace(/\?\d+/g, "?")).all(...(bindings as never[]));
          return Promise.resolve({ results: rows as T[] });
        },
      };
      return stmt;
    },
  };
}

describe("readUsageAnalyticsEnabled", () => {
  it("returns true when the firm setting is absent (default: analytics always-on)", async () => {
    const database = makeSqlDatabaseAdapter(setupDatabase());
    expect(await readUsageAnalyticsEnabled(database)).toBe(true);
  });

  it("returns false after the firm setting is explicitly written as false", async () => {
    const rawDatabase = setupDatabase();
    const database = makeSqlDatabaseAdapter(rawDatabase);
    // Write the setting using the canonical writer so the stored form is identical to production.
    const writeStatement = writeFirmSettingStatement(
      database,
      usageAnalyticsEnabledDefinition,
      false,
      "2026-06-18T00:00:00.000Z",
    );
    await writeStatement.run();
    expect(await readUsageAnalyticsEnabled(database)).toBe(false);
  });
});

describe("readMemberOptedOut", () => {
  it("returns false for an absent user (no member row)", async () => {
    const database = makeSqlDatabaseAdapter(setupDatabase());
    expect(await readMemberOptedOut(database, "usr_absent")).toBe(false);
  });

  it("returns false for a member with opted_out_of_usage_analytics = 0", async () => {
    const rawDatabase = setupDatabase();
    const database = makeSqlDatabaseAdapter(rawDatabase);
    rawDatabase
      .prepare(
        "INSERT INTO member (user_id, display_name, opted_out_of_usage_analytics, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("usr_not_opted_out", "Jane Doe", 0, "2026-06-18T00:00:00.000Z");
    expect(await readMemberOptedOut(database, "usr_not_opted_out")).toBe(false);
  });

  it("returns true for a member with opted_out_of_usage_analytics = 1", async () => {
    const rawDatabase = setupDatabase();
    const database = makeSqlDatabaseAdapter(rawDatabase);
    rawDatabase
      .prepare(
        "INSERT INTO member (user_id, display_name, opted_out_of_usage_analytics, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("usr_opted_out", "John Doe", 1, "2026-06-18T00:00:00.000Z");
    expect(await readMemberOptedOut(database, "usr_opted_out")).toBe(true);
  });
});
