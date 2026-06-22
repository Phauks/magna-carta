import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { nodeSqliteBatchDatabase } from "@magna-carta/database/node-sqlite";
import { assertCustomFieldsFitness } from "../src/fitness.ts";
import { migratedFirmDatabase } from "./helpers.ts";

// Table-wide fitness checks for the three custom-fields tables: no float columns (integers and text
// only — floats cannot represent fractional currency or arbitrary-scale numbers without drift), every
// primary key is a TEXT handle, and the partial-unique current-value index exists.

describe("assertCustomFieldsFitness — freshly migrated database", () => {
  it("passes when the database is at the current schema", async () => {
    const database = await migratedFirmDatabase();
    await expect(assertCustomFieldsFitness(database)).resolves.toBeUndefined();
  });
});

describe("assertCustomFieldsFitness — float column guard", () => {
  it("fails when a value column is declared REAL", async () => {
    // Build a scratch in-memory SQLite with a REAL column to prove the guard bites. This is the
    // kind of schema mistake a hasty migration could introduce — floats cannot represent fractional
    // amounts without drift, so the guard must reject them before any data lands in the table.
    const raw = new DatabaseSync(":memory:");
    raw.exec(`
      CREATE TABLE custom_field (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE picklist_option (
        id TEXT PRIMARY KEY,
        field_id TEXT NOT NULL,
        label TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE custom_field_value (
        id TEXT PRIMARY KEY,
        field_id TEXT NOT NULL,
        target_row_id TEXT NOT NULL,
        value_number REAL,
        is_current INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX custom_field_value_current_unique_index
        ON custom_field_value (target_row_id, field_id) WHERE is_current = 1;
    `);
    const database = nodeSqliteBatchDatabase(raw);
    await expect(assertCustomFieldsFitness(database)).rejects.toThrow(
      /custom_field_value\.value_number is a float column/,
    );
  });
});
