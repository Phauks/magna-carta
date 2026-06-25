import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import type { UtbmsSeedCode } from "./utbms-catalog.ts";
import { utbmsSeedData } from "./utbms-catalog.ts";

export const UTBMS_CODE_TABLE = "utbms_code";

// A deterministic handle per published code so a re-seed is a no-op: the id is stable across runs and
// the UNIQUE (code_set, code) index makes a duplicate INSERT OR IGNORE a no-op rather than a conflict.
function seedHandle(codeSet: string, code: string): string {
  return `utbmsCode_${codeSet}_${code}`;
}

// The catalog seed: one INSERT OR IGNORE per published code, active by default. Composed at
// provisioning and idempotent on re-run (the UNIQUE index + OR IGNORE), so re-seeding never duplicates.
export function seedUtbmsCatalogStatements(database: SqlDatabase): SqlStatement[] {
  return utbmsSeedData.map((row) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO ${UTBMS_CODE_TABLE} (id, code_set, code, label, practice_area, active) VALUES (?1, ?2, ?3, ?4, ?5, 1)`,
      )
      .bind(seedHandle(row.codeSet, row.code), row.codeSet, row.code, row.label, row.practiceArea),
  );
}

// The active/inactive toggle. Guarded to a known id: an unknown id matches no row (meta.changes === 0),
// so the service can only flip a seeded row — a firm can never invent an ABA code through this path.
export function setUtbmsCodeActiveStatement(
  database: SqlDatabase,
  id: UtbmsCodeId,
  active: number,
): SqlStatement {
  return database
    .prepare(`UPDATE ${UTBMS_CODE_TABLE} SET active = ?2 WHERE id = ?1`)
    .bind(id, active);
}

// Existence check used by the service before composing an enable/disable effect: prevents a phantom
// audit row from being written for a subject that does not exist.
export function selectUtbmsCodeExistsStatement(
  database: SqlDatabase,
  id: UtbmsCodeId,
): SqlStatement {
  return database.prepare(`SELECT 1 AS found FROM ${UTBMS_CODE_TABLE} WHERE id = ?1`).bind(id);
}

// The read the routes and the costs/billing slices consume: every code in a set, active flag included.
// codeSet is narrowed to the three published families so callers get a type error for an invalid set.
export function listUtbmsCodesBySetStatement(
  database: SqlDatabase,
  codeSet: UtbmsSeedCode["codeSet"],
): SqlStatement {
  return database
    .prepare(
      `SELECT id, code_set, code, label, practice_area, active FROM ${UTBMS_CODE_TABLE} WHERE code_set = ?1 ORDER BY code`,
    )
    .bind(codeSet);
}
