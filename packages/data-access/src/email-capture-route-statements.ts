import type { FirmId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// The CONTROL-PLANE half of a forward/CC capture address. This module is the only writer of the
// token->firm routing index the inbound Email Worker reads; the matter half of the same address lives
// in the firm's own database (email-filing-statements.ts). Table name tracked against
// @magna-carta/database's control-plane schema.
//
// The index is deliberately thin: a token, the firm it routes to, and whether it still routes. It
// carries no matter and no minting actor, because the worker that reads it holds no per-firm handle
// and must answer "which firm?" from one indexed read — and because the control plane is shared, so
// the less firm-identifying detail it holds the better.
export const EMAIL_CAPTURE_ROUTE_TABLE = "email_capture_route";

export interface EmailCaptureRouteInsert {
  readonly token: string;
  readonly firmId: FirmId;
}

// Claim a token for a firm. The token is the table's PRIMARY KEY and its uniqueness scope is GLOBAL
// (every firm's tokens share this one index), so a claim can lose to an existing row: ON CONFLICT DO
// NOTHING makes that a zero-change result the caller branches on rather than a thrown error, which is
// what lets the mint path retry with a fresh candidate and the relay treat a redelivery as a no-op.
export function insertEmailCaptureRouteStatement(
  database: SqlDatabase,
  input: EmailCaptureRouteInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EMAIL_CAPTURE_ROUTE_TABLE} (token, firm_id, active, created_at, revoked_at)
       VALUES (?1, ?2, 1, ?3, NULL)
       ON CONFLICT (token) DO NOTHING`,
    )
    .bind(input.token, input.firmId, now);
}

// Stop a token routing. Scoped to the owning firm so one firm can never revoke another's token even
// if it learns the value, and guarded on active = 1 so a repeat revoke reports zero changes instead
// of overwriting the original revocation instant.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function revokeEmailCaptureRouteStatement(
  database: SqlDatabase,
  input: { token: string; firmId: FirmId },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EMAIL_CAPTURE_ROUTE_TABLE} SET active = 0, revoked_at = ?1
       WHERE token = ?2 AND firm_id = ?3 AND active = 1`,
    )
    .bind(now, input.token, input.firmId);
}

export interface EmailCaptureRouteRow {
  readonly token: string;
  readonly firmId: FirmId;
  readonly active: boolean;
}

// Read one route by token, whatever its firm or state. The mint path uses it to reject a candidate
// token that is already claimed, and the relay uses it to tell an idempotent redelivery (the row is
// already this firm's) from a genuine cross-firm collision (the row is another firm's, which must
// never be silently adopted). Returns null when the token has never been claimed.
export async function findEmailCaptureRouteByToken(
  database: SqlDatabase,
  token: string,
): Promise<EmailCaptureRouteRow | null> {
  const { results } = await database
    .prepare(
      `SELECT token, firm_id, active FROM ${EMAIL_CAPTURE_ROUTE_TABLE} WHERE token = ?1 LIMIT 1`,
    )
    .bind(token)
    .all<{ token: string; firm_id: string; active: number }>();
  const row = results[0];
  return row === undefined
    ? null
    : { token: row.token, firmId: row.firm_id as FirmId, active: row.active === 1 };
}
