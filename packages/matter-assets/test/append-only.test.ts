import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";

// The append-only guarantee is the TRIGGER'S, not the service's, so it is asserted at the database
// with raw SQL. A service-level test would only prove that the service did not try — which is worth
// nothing against a future call site, a migration, or a hand-run repair that does.

function migratedDatabase() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  return { database, raw };
}

const VALUATION_COLUMNS =
  "id, asset_id, encumbrance_id, as_of_date, amount_minor, currency, basis, source_note, " +
  "supporting_file_id, corrects_valuation_id, recorded_by, recorded_at";

const ASSET = "matterAsset_appendOnly000000000000";
const FIRST_VALUATION = "matterAssetValuation_first00000000";

// An asset the valuation can hang off. Inserted with raw SQL so this file depends on the schema and
// the triggers alone, never on the services.
function seedAssetWithValuation(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(`
    INSERT INTO member (user_id, display_name, status, created_at)
      VALUES ('user_appendOnlyTester', 'Append Tester', 'active', '2026-08-01T00:00:00.000Z');
    INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at)
      VALUES ('matter_appendOnly0000000000000000', 'Estate of Alvarez', 'open', 'user_appendOnlyTester', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO matter_asset (id, matter_id, class, description, created_at, updated_at)
      VALUES ('${ASSET}', 'matter_appendOnly0000000000000000', 'realProperty', 'The house on Elm Street', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z');
    INSERT INTO matter_asset_valuation (${VALUATION_COLUMNS})
      VALUES ('${FIRST_VALUATION}', '${ASSET}', NULL, '2026-03-14', 40000000, 'USD', 'appraisal', NULL, NULL, NULL, 'user_appendOnlyTester', '2026-07-01T00:00:00.000Z');
  `);
}

describe("matter_asset_valuation is append-only at the database", () => {
  it("refuses an UPDATE", () => {
    const { raw } = migratedDatabase();
    seedAssetWithValuation(raw);
    expect(() =>
      raw.exec(
        `UPDATE matter_asset_valuation SET amount_minor = 1 WHERE id = '${FIRST_VALUATION}'`,
      ),
    ).toThrow(/matter_asset_valuation is append-only/);
  });

  it("refuses a DELETE", () => {
    const { raw } = migratedDatabase();
    seedAssetWithValuation(raw);
    expect(() =>
      raw.exec(`DELETE FROM matter_asset_valuation WHERE id = '${FIRST_VALUATION}'`),
    ).toThrow(/matter_asset_valuation is append-only/);
  });

  // REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the delete or update
  // triggers, so without the BEFORE INSERT guard this would overwrite a recorded figure in place —
  // the one remaining path that could mutate an appended row.
  it("refuses an INSERT OR REPLACE onto an existing row", () => {
    const { raw } = migratedDatabase();
    seedAssetWithValuation(raw);
    expect(() =>
      raw.exec(
        `INSERT OR REPLACE INTO matter_asset_valuation (${VALUATION_COLUMNS})
           VALUES ('${FIRST_VALUATION}', '${ASSET}', NULL, '2026-03-14', 1, 'USD', 'clientEstimate', NULL, NULL, NULL, NULL, '2026-08-06T00:00:00.000Z')`,
      ),
    ).toThrow(/matter_asset_valuation is append-only/);
  });

  // The whole point of forbidding an edit: a fat-fingered figure is fixed by appending a row that
  // names the row it corrects, and BOTH stay on the record. A firm handing the register to a court
  // can show what was asserted, when, and what replaced it.
  it("accepts a compensating correction and keeps both rows", () => {
    const { raw } = migratedDatabase();
    seedAssetWithValuation(raw);
    raw.exec(
      `INSERT INTO matter_asset_valuation (${VALUATION_COLUMNS})
         VALUES ('matterAssetValuation_correction00', '${ASSET}', NULL, '2026-03-14', 41500000, 'USD', 'appraisal', 'transposed digits on the original entry', NULL, '${FIRST_VALUATION}', 'user_appendOnlyTester', '2026-08-06T00:00:00.000Z')`,
    );
    const rows = raw
      .prepare(
        `SELECT id, amount_minor, corrects_valuation_id FROM matter_asset_valuation ORDER BY id ASC`,
      )
      .all() as { id: string; amount_minor: number; corrects_valuation_id: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.amount_minor).sort((a, b) => a - b)).toEqual([40000000, 41500000]);
    expect(rows.some((row) => row.corrects_valuation_id === FIRST_VALUATION)).toBe(true);
  });

  // The class CHECK: a class the platform does not carry cannot reach the table at all, which is
  // what makes the class safe to branch a merge subject and an attribute table off.
  it("refuses an asset whose class is outside the platform vocabulary", () => {
    const { raw } = migratedDatabase();
    seedAssetWithValuation(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO matter_asset (id, matter_id, class, description, created_at, updated_at)
           VALUES ('matterAsset_badClass00000000000000', 'matter_appendOnly0000000000000000', 'spaceship', 'A spaceship', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')`,
      ),
    ).toThrow(/matter_asset_class_check|CHECK constraint/i);
  });

  // No current-value column exists on any table in this subsystem, and that is a schema fact rather
  // than a convention: every amount a read returns travels with the as_of_date and basis it came
  // from, which is only possible while no column can hold an undated number.
  it("has no current-value column on any asset table", () => {
    const { raw } = migratedDatabase();
    const assetTables = (
      raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'matter_asset%'`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(assetTables.length).toBeGreaterThan(0);
    for (const table of assetTables) {
      const columns = (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name,
      );
      for (const column of columns) {
        expect(
          /current_value|value_amount_minor$|latest_value/.test(column),
          `${table}.${column}`,
        ).toBe(false);
      }
    }
  });
});
