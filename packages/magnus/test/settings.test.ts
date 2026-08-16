import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import { describe, expect, it } from "vitest";
import { MAGNUS_DISCLOSURE_VERSION } from "../src/disclosure.ts";
import { magnusDailyTurnCeilingDefinition, magnusEnabledDefinition } from "../src/settings.ts";

// A minimal SqlDatabase stub: a settings table that can be empty, hold a row, or hold junk.
function settingsDatabase(rows: Record<string, string>) {
  return {
    prepare(_sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        // The type parameter mirrors SqlDatabase's own `all<T>()`, which is what the accessor under
        // test calls; the stub answers with whatever row shape the caller asked for.
        async all<T>(): Promise<{ results: T[] }> {
          const key = String(bound[0]);
          const value = rows[key];
          return { results: (value === undefined ? [] : [{ value }]) as T[] };
        },
        // The same row `all()` would return, or null — the SqlStatement contract in full, so this
        // stub stays substitutable for the real database as the accessors under test evolve.
        async first<T>(): Promise<T | null> {
          const value = rows[String(bound[0])];
          return value === undefined ? null : ({ value } as T);
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
}

describe("the firm consent gate", () => {
  it("reads FALSE when the firm has never touched it — the whole feature is closed by default", async () => {
    const database = settingsDatabase({});
    expect(await readFirmSetting(database, magnusEnabledDefinition)).toBe(false);
  });

  it("reads false when the stored value is unparseable, rather than failing open", async () => {
    const database = settingsDatabase({ "magnus.enabled": "not json" });
    expect(await readFirmSetting(database, magnusEnabledDefinition)).toBe(false);
  });

  it("reads true only when the firm explicitly stored true", async () => {
    const database = settingsDatabase({ "magnus.enabled": "true" });
    expect(await readFirmSetting(database, magnusEnabledDefinition)).toBe(true);
  });
});

describe("the daily turn ceiling", () => {
  it("defaults to a real, finite number", async () => {
    const database = settingsDatabase({});
    const ceiling = await readFirmSetting(database, magnusDailyTurnCeilingDefinition);
    expect(ceiling).toBe(500);
    expect(Number.isFinite(ceiling)).toBe(true);
  });

  it("rejects an out-of-range ceiling at the WRITE path", () => {
    const database = settingsDatabase({});
    expect(() =>
      writeFirmSettingStatement(
        database,
        magnusDailyTurnCeilingDefinition,
        -1,
        "2026-08-06T00:00:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      writeFirmSettingStatement(
        database,
        magnusDailyTurnCeilingDefinition,
        1_000_000,
        "2026-08-06T00:00:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      writeFirmSettingStatement(
        database,
        magnusDailyTurnCeilingDefinition,
        1.5,
        "2026-08-06T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("accepts zero — a firm may switch spend off without switching the feature off", () => {
    const database = settingsDatabase({});
    expect(() =>
      writeFirmSettingStatement(
        database,
        magnusDailyTurnCeilingDefinition,
        0,
        "2026-08-06T00:00:00.000Z",
      ),
    ).not.toThrow();
  });
});

describe("the disclosure version", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(MAGNUS_DISCLOSURE_VERSION)).toBe(true);
    expect(MAGNUS_DISCLOSURE_VERSION).toBeGreaterThan(0);
  });
});
