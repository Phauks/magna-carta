import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NonBillableCategoryId } from "@magna-carta/identifiers/types";

export const NON_BILLABLE_CATEGORY_TABLE = "non_billable_category";

// Seed-and-fork defaults: provisioning lays these down and a firm renames, archives, or extends them —
// defaults, not locks. The same pattern the custom-fields templates use.
export const NON_BILLABLE_CATEGORY_DEFAULTS = [
  "Administrative",
  "Business Development",
  "Pro Bono",
  "Training/CLE",
] as const;

export interface InsertNonBillableCategoryRow {
  readonly id: NonBillableCategoryId;
  readonly name: string;
  readonly createdAt: string;
}

export function insertNonBillableCategoryStatement(
  database: SqlDatabase,
  row: InsertNonBillableCategoryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NON_BILLABLE_CATEGORY_TABLE} (id, name, archived_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?3)`,
    )
    .bind(row.id, row.name, row.createdAt);
}

// The provisioning seed. Handles are minted (not deterministic) — a firm forks freely and a re-seed is
// not expected (provisioning runs once), matching the custom-fields seed-and-fork precedent.
export function seedNonBillableCategoryStatements(
  database: SqlDatabase,
  now: string,
): SqlStatement[] {
  return NON_BILLABLE_CATEGORY_DEFAULTS.map((name) =>
    insertNonBillableCategoryStatement(database, {
      id: newIdentifier("nonBillableCategory"),
      name,
      createdAt: now,
    }),
  );
}

// Existence check used by the service before composing an update or archive effect: prevents a
// phantom audit row from being written for a subject that does not exist.
export function selectNonBillableCategoryExistsStatement(
  database: SqlDatabase,
  id: NonBillableCategoryId,
): SqlStatement {
  return database
    .prepare(`SELECT 1 AS found FROM ${NON_BILLABLE_CATEGORY_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function renameNonBillableCategoryStatement(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  name: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${NON_BILLABLE_CATEGORY_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, updatedAt);
}

// Soft-archive: stamp archived_at, never delete. The row survives so historical entries that reference
// it stay readable.
export function archiveNonBillableCategoryStatement(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  archivedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NON_BILLABLE_CATEGORY_TABLE} SET archived_at = ?2, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, archivedAt);
}
