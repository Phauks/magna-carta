import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  resolveScopedSetting,
  type ScopedSettingDefinition,
  writeScopedSettingStatement,
} from "../src/scoped-setting-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

const incrementMinutes: ScopedSettingDefinition<number> = {
  key: "time.increment_minutes",
  schema: z.number().int().positive(),
  defaultValue: 6,
};

// Adapt node:sqlite to the SqlDatabase surface (positional ?1 binds, all()/run()) — the same shim
// the flat-setting round-trip test uses.
function memoryDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    `CREATE TABLE scoped_setting (
       key TEXT NOT NULL,
       scope_tier TEXT NOT NULL,
       scoped_id TEXT,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (key, scope_tier, scoped_id)
     );`,
  );
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
        first<T>() {
          const rows = database.prepare(sql.replace(/\?\d+/g, "?")).all(...(bindings as never[]));
          return Promise.resolve(rows.length > 0 ? (rows[0] as T) : null);
        },
      };
      return stmt;
    },
  };
}

async function put(
  database: ReturnType<typeof memoryDatabase>,
  tier: "matter" | "client" | "user" | "location" | "firm",
  scopedId: string | null,
  value: number,
): Promise<void> {
  await writeScopedSettingStatement(
    database,
    incrementMinutes,
    tier,
    scopedId,
    value,
    "2026-06-22T00:00:00.000Z",
  ).run();
}

describe("resolveScopedSetting", () => {
  it("returns the in-code default when no row exists at any tier", async () => {
    const database = memoryDatabase();
    expect(
      await resolveScopedSetting(database, incrementMinutes, {
        matterId: "matter_a",
        userId: "user_a",
      }),
    ).toBe(6);
  });

  it("a firm-only value reads at every scope (behaves exactly like the flat seam)", async () => {
    const database = memoryDatabase();
    await put(database, "firm", null, 15);
    expect(await resolveScopedSetting(database, incrementMinutes, {})).toBe(15);
    expect(
      await resolveScopedSetting(database, incrementMinutes, {
        matterId: "matter_a",
        clientId: "client_a",
        userId: "user_a",
        locationId: "location_a",
      }),
    ).toBe(15);
  });

  it("the most specific matching tier wins (matter over client over user over location over firm)", async () => {
    const database = memoryDatabase();
    await put(database, "firm", null, 6);
    await put(database, "location", "location_a", 10);
    await put(database, "user", "user_a", 12);
    await put(database, "client", "client_a", 15);
    await put(database, "matter", "matter_a", 30);
    const context = {
      matterId: "matter_a",
      clientId: "client_a",
      userId: "user_a",
      locationId: "location_a",
    };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(30);
  });

  it("falls through to the next tier when the more-specific scope has no row", async () => {
    const database = memoryDatabase();
    await put(database, "client", "client_a", 15);
    await put(database, "firm", null, 6);
    // No matter-tier row for matter_a → client wins over firm.
    const context = { matterId: "matter_a", clientId: "client_a", userId: "user_a" };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(15);
  });

  it("ignores a row scoped to a different id at the same tier", async () => {
    const database = memoryDatabase();
    await put(database, "matter", "matter_OTHER", 30);
    await put(database, "firm", null, 6);
    const context = { matterId: "matter_a" };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(6);
  });

  it("returns the default on an unparseable / schema-invalid stored value (read stays total)", async () => {
    const database = memoryDatabase();
    // Write garbage directly, bypassing the validating builder, to prove the read never bricks.
    await database
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind("time.increment_minutes", "matter", "matter_a", "{not json", "2026-06-22T00:00:00.000Z")
      .run();
    expect(await resolveScopedSetting(database, incrementMinutes, { matterId: "matter_a" })).toBe(
      6,
    );
  });

  it("falls through a schema-invalid (parseable) stored value to the next tier", async () => {
    const database = memoryDatabase();
    // Valid JSON but wrong type — a string where a positive int is required. Insert raw so the
    // validating builder does not block it. The resolver must fall through to the firm tier.
    await database
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(
        "time.increment_minutes",
        "matter",
        "matter_a",
        '"not-a-number"',
        "2026-06-22T00:00:00.000Z",
      )
      .run();
    await put(database, "firm", null, 6);
    expect(await resolveScopedSetting(database, incrementMinutes, { matterId: "matter_a" })).toBe(
      6,
    );
  });
});

describe("writeScopedSettingStatement", () => {
  it("composes a validate-then-upsert binding key/scope_tier/scoped_id/canonical-value/updated_at", () => {
    const stub = stubD1();
    const statement = captured(
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "matter",
        "matter_a",
        15,
        "2026-06-22T00:00:00.000Z",
      ),
    );
    expect(statement.sql).toContain("INSERT INTO scoped_setting");
    expect(statement.sql).toContain("ON CONFLICT(key, scope_tier, scoped_id) DO UPDATE");
    expect(statement.bindings).toEqual([
      "time.increment_minutes",
      "matter",
      "matter_a",
      "15",
      "2026-06-22T00:00:00.000Z",
    ]);
  });

  it("binds a null scoped_id for a firm-tier write", () => {
    const stub = stubD1();
    const statement = captured(
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "firm",
        null,
        6,
        "2026-06-22T00:00:00.000Z",
      ),
    );
    expect(statement.bindings).toEqual([
      "time.increment_minutes",
      "firm",
      null,
      "6",
      "2026-06-22T00:00:00.000Z",
    ]);
  });

  it("fails loud on a schema-invalid write rather than storing garbage", () => {
    const stub = stubD1();
    expect(() =>
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "firm",
        null,
        -1,
        "2026-06-22T00:00:00.000Z",
      ),
    ).toThrow();
  });
});
