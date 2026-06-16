import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type FirmSettingDefinition,
  readFirmSetting,
  writeFirmSettingStatement,
} from "../src/setting-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

const uploadPolicy: FirmSettingDefinition<{ maxSizeBytes: number; blockExecutables: boolean }> = {
  key: "file_manager.upload_policy",
  schema: z.object({ maxSizeBytes: z.number().int().positive(), blockExecutables: z.boolean() }),
  defaultValue: { maxSizeBytes: 50 * 1024 * 1024 * 1024, blockExecutables: true },
};

describe("readFirmSetting", () => {
  it("returns the default when the row is absent", async () => {
    const stub = stubD1();
    stub.onAll(`FROM setting`, []);
    expect(await readFirmSetting(stub.database, uploadPolicy)).toEqual(uploadPolicy.defaultValue);
  });

  it("parses a stored value through the schema", async () => {
    const stub = stubD1();
    stub.onAll(`FROM setting`, [
      { value: JSON.stringify({ maxSizeBytes: 100, blockExecutables: false }) },
    ]);
    expect(await readFirmSetting(stub.database, uploadPolicy)).toEqual({
      maxSizeBytes: 100,
      blockExecutables: false,
    });
  });

  it("falls back to the default on unparseable JSON", async () => {
    const stub = stubD1();
    stub.onAll(`FROM setting`, [{ value: "{not json" }]);
    expect(await readFirmSetting(stub.database, uploadPolicy)).toEqual(uploadPolicy.defaultValue);
  });

  it("falls back to the default on a schema-invalid stored value (a bad write never bricks reads)", async () => {
    const stub = stubD1();
    stub.onAll(`FROM setting`, [{ value: JSON.stringify({ maxSizeBytes: -5 }) }]);
    expect(await readFirmSetting(stub.database, uploadPolicy)).toEqual(uploadPolicy.defaultValue);
  });
});

describe("writeFirmSettingStatement", () => {
  it("composes an upsert with canonical-JSON value and binds key/value/updated_at", () => {
    const stub = stubD1();
    const statement = captured(
      writeFirmSettingStatement(
        stub.database,
        uploadPolicy,
        { maxSizeBytes: 10, blockExecutables: true },
        "2026-06-13T00:00:00.000Z",
      ),
    );
    expect(statement.sql).toContain("INSERT INTO setting");
    expect(statement.sql).toContain("ON CONFLICT(key) DO UPDATE");
    // Canonical JSON sorts keys, so the stored form is stable regardless of input key order.
    expect(statement.bindings).toEqual([
      "file_manager.upload_policy",
      '{"blockExecutables":true,"maxSizeBytes":10}',
      "2026-06-13T00:00:00.000Z",
    ]);
  });

  it("fails loud on a schema-invalid write rather than storing garbage", () => {
    const stub = stubD1();
    expect(() =>
      writeFirmSettingStatement(
        stub.database,
        uploadPolicy,
        { maxSizeBytes: -1, blockExecutables: true },
        "2026-06-13T00:00:00.000Z",
      ),
    ).toThrow();
  });
});

describe("setting round-trip against real SQLite", () => {
  it("a written value reads back through the accessor", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(
      `CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    );
    // Adapt node:sqlite to the SqlDatabase surface (positional ?1 binds, all()/run()).
    const adapter = {
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
    const write = writeFirmSettingStatement(
      adapter,
      uploadPolicy,
      { maxSizeBytes: 7, blockExecutables: false },
      "2026-06-13T00:00:00.000Z",
    );
    await write.run();
    expect(await readFirmSetting(adapter, uploadPolicy)).toEqual({
      maxSizeBytes: 7,
      blockExecutables: false,
    });
  });
});
