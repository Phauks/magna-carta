import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const DOCUMENT_TYPE_TABLE = "document_type";

export interface InsertDocumentTypeRow {
  readonly id: DocumentTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly createdAt: string;
}

export function insertDocumentTypeStatement(
  database: SqlDatabase,
  row: InsertDocumentTypeRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOCUMENT_TYPE_TABLE} (id, name, code, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
    )
    .bind(row.id, row.name, row.code, row.createdAt);
}

export function updateDocumentTypeStatement(
  database: SqlDatabase,
  id: DocumentTypeId,
  name: string,
  code: string | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_TYPE_TABLE} SET name = ?2, code = ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, name, code, updatedAt);
}

export function deactivateDocumentTypeStatement(
  database: SqlDatabase,
  id: DocumentTypeId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${DOCUMENT_TYPE_TABLE} SET active = 0, updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

export function selectDocumentTypeStatement(
  database: SqlDatabase,
  id: DocumentTypeId,
): SqlStatement {
  return database
    .prepare(`SELECT id, name, code, active FROM ${DOCUMENT_TYPE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function selectDocumentTypeIdByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${DOCUMENT_TYPE_TABLE} WHERE name = ?1`).bind(name);
}

export function selectDocumentTypeIdByCodeStatement(
  database: SqlDatabase,
  code: string,
): SqlStatement {
  return database.prepare(`SELECT id FROM ${DOCUMENT_TYPE_TABLE} WHERE code = ?1`).bind(code);
}
