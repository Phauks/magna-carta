import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "../src/settings.ts";

// A minimal in-memory stand-in for the firm's D1 handle, honoring the real SqlStatement return shapes
// (run -> { meta: { changes } }, all -> { results }) so the fake conforms to the SqlDatabase contract
// the production accessor consumes (no `as never` escape hatch).
function fakeDatabase() {
  const rows = new Map<string, string>();
  const database = {
    rows,
    prepare(_sql: string) {
      const binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds.push(...values);
          return this;
        },
        async all<T>() {
          // SELECT value FROM setting WHERE key = ?1
          const value = rows.get(binds[0] as string);
          return { results: (value === undefined ? [] : [{ value }]) as T[] };
        },
        async run() {
          // INSERT ... (key, value, updated_at) ...
          rows.set(binds[0] as string, binds[1] as string);
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  return database;
}

const asDatabase = (database: ReturnType<typeof fakeDatabase>): SqlDatabase =>
  database as unknown as SqlDatabase;

describe("primaryReasoningModelDefinition", () => {
  it("defaults to anthropic/claude-opus-5-5 on a missing row", async () => {
    const database = fakeDatabase();
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-opus-5-5",
    );
  });

  it("accepts an in-catalog ZDR-eligible reasoning id at the write path", async () => {
    const database = fakeDatabase();
    await writeFirmSettingStatement(
      asDatabase(database),
      primaryReasoningModelDefinition,
      "anthropic/claude-sonnet-5-5",
      "2026-06-18T00:00:00.000Z",
    ).run();
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-sonnet-5-5",
    );
  });

  it("rejects an off-catalog id at the write path (schema.parse fails loud)", () => {
    const database = fakeDatabase();
    expect(() =>
      writeFirmSettingStatement(
        asDatabase(database),
        primaryReasoningModelDefinition,
        "anthropic/not-in-catalog",
        "2026-06-18T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("read stays total on a schema-invalid stored value (returns the default)", async () => {
    const database = fakeDatabase();
    database.rows.set("inference.primaryReasoningModel", JSON.stringify("garbage/model"));
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-opus-5-5",
    );
  });

  it("a firm pinned to a model the catalog no longer offers follows the platform again", async () => {
    // The previous generation left the catalog on 2026-11-09. A row still naming one of its models
    // must neither fail the read nor keep routing to it.
    const database = fakeDatabase();
    database.rows.set(
      "inference.primaryReasoningModel",
      JSON.stringify("anthropic/claude-opus-4-8"),
    );
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-opus-5-5",
    );
  });
});

describe("aiProcessingEligibilityDefinition", () => {
  it("defaults to false — third-party-frontier egress is off until a firm opts in", async () => {
    const database = fakeDatabase();
    expect(await readFirmSetting(asDatabase(database), aiProcessingEligibilityDefinition)).toBe(
      false,
    );
  });

  it("accepts a boolean at the write path", async () => {
    const database = fakeDatabase();
    await writeFirmSettingStatement(
      asDatabase(database),
      aiProcessingEligibilityDefinition,
      true,
      "2026-06-18T00:00:00.000Z",
    ).run();
    expect(await readFirmSetting(asDatabase(database), aiProcessingEligibilityDefinition)).toBe(
      true,
    );
  });

  it("rejects a non-boolean at the write path (schema.parse fails loud)", () => {
    const database = fakeDatabase();
    expect(() =>
      writeFirmSettingStatement(
        asDatabase(database),
        aiProcessingEligibilityDefinition,
        "yes" as unknown as boolean,
        "2026-06-18T00:00:00.000Z",
      ),
    ).toThrow();
  });
});
