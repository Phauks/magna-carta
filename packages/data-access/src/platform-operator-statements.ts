import type { UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's control-plane schema.
export const PLATFORM_OPERATOR_TABLE = "platform_operator";

// Read shape: snake_case as stored in D1 (callers map to camelCase at the edge).
export interface PlatformOperatorAccessRow {
  readonly user_id: string;
  readonly two_factor_enabled: number;
}

// "user" is a SQL keyword, so it is quoted. The join surfaces the acting user's 2FA state so the
// guard can require it (a platform-trust identity should not rest on a password alone).
export function selectActivePlatformOperatorStatement(
  database: SqlDatabase,
  userId: UserId,
  nowIso: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT po.user_id AS user_id, u.two_factor_enabled AS two_factor_enabled ` +
        `FROM ${PLATFORM_OPERATOR_TABLE} po JOIN "user" u ON u.id = po.user_id ` +
        `WHERE po.user_id = ?1 AND (po.expires_at IS NULL OR po.expires_at > ?2) LIMIT 1`,
    )
    .bind(userId, nowIso);
}

export interface InsertPlatformOperatorInput {
  readonly userId: UserId;
  readonly grantedByUserId: UserId;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly note: string | null;
}

// Idempotent seed: a re-run of the bootstrap grant is a no-op rather than a constraint error.
export function insertPlatformOperatorStatement(
  database: SqlDatabase,
  values: InsertPlatformOperatorInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${PLATFORM_OPERATOR_TABLE} (user_id, granted_at, granted_by, expires_at, note) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING`,
    )
    .bind(values.userId, values.grantedAt, values.grantedByUserId, values.expiresAt, values.note);
}
