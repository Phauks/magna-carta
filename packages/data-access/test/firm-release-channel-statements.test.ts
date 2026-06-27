import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  readFirmReleaseChannelStatement,
  writeFirmReleaseChannelStatement,
} from "../src/firm-release-channel-statements.ts";

// Builds an in-memory SQLite control-plane database with the minimal firm table shape needed by the
// release-channel statements: id, name, release_channel, and created_at. The DEFAULT on
// release_channel matches production so the seeded row starts at 'stable'.
function setupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE firm (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      release_channel TEXT NOT NULL DEFAULT 'stable',
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

// Wraps node:sqlite's DatabaseSync in the SqlDatabase surface the statement builders expect.
// Positional ?1/?2/... placeholders are rewritten to ? in appearance order, with bindings
// reordered to match — so ?2 appearing before ?1 in the SQL is handled correctly.
function makeSqlDatabaseAdapter(database: DatabaseSync) {
  function rewrite(sql: string, bindings: unknown[]): [string, unknown[]] {
    const indices: number[] = [];
    const rewritten = sql.replace(/\?(\d+)/g, (_match, digits: string) => {
      indices.push(parseInt(digits, 10) - 1); // ?1 → index 0, ?2 → index 1, …
      return "?";
    });
    return [rewritten, indices.map((i) => bindings[i])];
  }

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
          const [rewritten, ordered] = rewrite(sql, bindings);
          database.prepare(rewritten).run(...(ordered as never[]));
          return Promise.resolve({ meta: { changes: 1 } });
        },
        all<T>() {
          const [rewritten, ordered] = rewrite(sql, bindings);
          const rows = database.prepare(rewritten).all(...(ordered as never[]));
          return Promise.resolve({ results: rows as T[] });
        },
        first<T>() {
          const [rewritten, ordered] = rewrite(sql, bindings);
          const rows = database.prepare(rewritten).all(...(ordered as never[]));
          return Promise.resolve(rows.length > 0 ? (rows[0] as T) : null);
        },
      };
      return stmt;
    },
  };
}

describe("firm release-channel statements", () => {
  it("writes then reads back the channel", async () => {
    const firmId = newIdentifier("firm");
    const rawDatabase = setupDatabase();
    rawDatabase
      .prepare("INSERT INTO firm (id, name, release_channel, created_at) VALUES (?, ?, ?, ?)")
      .run(firmId, "Test Firm", "stable", "2026-06-25T00:00:00.000Z");

    const database = makeSqlDatabaseAdapter(rawDatabase);

    await writeFirmReleaseChannelStatement(database, firmId, "beta").run();
    const row = await readFirmReleaseChannelStatement(database, firmId).first<{
      release_channel: string;
    }>();
    expect(row?.release_channel).toBe("beta");
  });

  it("returns null when the firm does not exist", async () => {
    const absentFirmId = newIdentifier("firm");
    const database = makeSqlDatabaseAdapter(setupDatabase());

    const row = await readFirmReleaseChannelStatement(database, absentFirmId).first();
    expect(row).toBeNull();
  });
});
