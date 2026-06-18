import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test. This table exists only in the per-firm database — the caller supplies that handle.
export const INTEGRATION_CONNECTION_TABLE = "integration_connection";

export interface InsertConnectionRow {
  readonly id: IntegrationConnectionId;
  readonly category: string;
  readonly adapterId: string;
  readonly scope: "firm" | "user";
  readonly principalRef: string;
  readonly credentialRef: string;
  readonly capabilitySnapshot: string; // JSON
  readonly createdAt: string;
}

export function insertConnectionStatement(
  database: SqlDatabase,
  row: InsertConnectionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTEGRATION_CONNECTION_TABLE} (id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connected', ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.category,
      row.adapterId,
      row.scope,
      row.principalRef,
      row.credentialRef,
      row.capabilitySnapshot,
      row.createdAt,
    );
}

export function selectConnectionStatement(
  database: SqlDatabase,
  category: string,
  principalRef: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot FROM ${INTEGRATION_CONNECTION_TABLE} WHERE category = ?1 AND principal_ref = ?2`,
    )
    .bind(category, principalRef);
}

export function updateConnectionStatusStatement(
  database: SqlDatabase,
  id: IntegrationConnectionId,
  status: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTEGRATION_CONNECTION_TABLE} SET status = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, status, updatedAt);
}

export function deleteConnectionStatement(
  database: SqlDatabase,
  id: IntegrationConnectionId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${INTEGRATION_CONNECTION_TABLE} WHERE id = ?1`).bind(id);
}
