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
  // The account as the provider names it, where it has such a name. A reconnect replaces it,
  // because signing in again is how a member moves the connection to a different account.
  readonly accountLabel?: string;
  readonly createdAt: string;
}

// Connect, or RE-connect. A principal has at most one connection per category (the unique index
// says so), and re-connecting is the normal way a firm rotates a credential or recovers a
// connection the health model parked in `needs_reauth` — so a second connect must land on the
// existing row rather than collide with it. Re-arming the status to `connected` is the whole point:
// `needs_reauth` means "supply credentials again", and this IS that supply. The row id is stable
// across a reconnect (ON CONFLICT updates, never replaces), so anything referencing the connection
// keeps referencing it.
export function upsertConnectionStatement(
  database: SqlDatabase,
  row: InsertConnectionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTEGRATION_CONNECTION_TABLE} (id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, created_at, updated_at, account_label) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connected', ?7, ?8, ?8, ?9) ON CONFLICT (category, principal_ref) DO UPDATE SET adapter_id = excluded.adapter_id, scope = excluded.scope, credential_ref = excluded.credential_ref, status = 'connected', capability_snapshot = excluded.capability_snapshot, updated_at = excluded.updated_at, account_label = excluded.account_label`,
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
      row.accountLabel ?? null,
    );
}

export function selectConnectionStatement(
  database: SqlDatabase,
  category: string,
  principalRef: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, account_label, created_at, updated_at FROM ${INTEGRATION_CONNECTION_TABLE} WHERE category = ?1 AND principal_ref = ?2`,
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
