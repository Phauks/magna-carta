import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Control-plane table names. Tracked against @magna-carta/database's control-plane schema.
export const PLATFORM_STAFF_TABLE = "platform_staff";
export const SUPPORT_GRANT_TABLE = "support_grant";

export type SupportGrantTier = "diagnostic" | "privileged";
export type SupportGrantStatus = "requested" | "active" | "revoked" | "expired" | "closed";

// Read shape: snake_case as stored in D1 (callers map to camelCase at the edge).
export interface SupportGrantRow {
  readonly id: SupportGrantId;
  readonly firm_id: FirmId;
  readonly requested_by_user_id: UserId;
  readonly tier: SupportGrantTier;
  readonly scope: "self";
  readonly status: SupportGrantStatus;
  readonly reason: string | null;
  readonly principal_id: PlatformStaffId | null;
  readonly requires_cosign: number; // SQLite boolean (0/1)
  readonly cosigned_by_user_id: UserId | null;
  readonly expires_at: string;
  readonly created_at: string;
}

export interface PlatformStaffRow {
  readonly id: PlatformStaffId;
  readonly email: string;
  readonly display_name: string;
  readonly role: "support" | "support_lead";
  readonly status: "active" | "disabled";
  readonly created_at: string;
}

export interface InsertPlatformStaffInput {
  readonly id: PlatformStaffId;
  readonly email: string;
  readonly displayName: string;
  readonly role: "support" | "support_lead";
  readonly now: string;
}

export function insertPlatformStaffStatement(
  database: SqlDatabase,
  input: InsertPlatformStaffInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${PLATFORM_STAFF_TABLE} (id, email, display_name, role, status, created_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5) ON CONFLICT DO NOTHING`,
    )
    .bind(input.id, input.email, input.displayName, input.role, input.now);
}

export function selectPlatformStaffStatement(
  database: SqlDatabase,
  staffId: PlatformStaffId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, email, display_name, role, status, created_at FROM ${PLATFORM_STAFF_TABLE} WHERE id = ?1`,
    )
    .bind(staffId);
}

export interface InsertSupportGrantInput {
  readonly id: SupportGrantId;
  readonly firmId: FirmId;
  readonly requestedByUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly status: SupportGrantStatus;
  readonly reason: string | null;
  readonly requiresCosign: boolean;
  readonly expiresAt: string;
  readonly now: string;
}

export function insertSupportGrantStatement(
  database: SqlDatabase,
  input: InsertSupportGrantInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SUPPORT_GRANT_TABLE} (id, firm_id, requested_by_user_id, tier, scope, status, reason, requires_cosign, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, 'self', ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      input.id,
      input.firmId,
      input.requestedByUserId,
      input.tier,
      input.status,
      input.reason,
      input.requiresCosign ? 1 : 0,
      input.expiresAt,
      input.now,
    );
}

export function selectSupportGrantStatement(
  database: SqlDatabase,
  grantId: SupportGrantId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, firm_id, requested_by_user_id, tier, scope, status, reason, principal_id, requires_cosign, cosigned_by_user_id, expires_at, created_at FROM ${SUPPORT_GRANT_TABLE} WHERE id = ?1`,
    )
    .bind(grantId);
}

export function selectFirmSupportGrantsStatement(
  database: SqlDatabase,
  firmId: FirmId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, firm_id, requested_by_user_id, tier, scope, status, reason, principal_id, requires_cosign, cosigned_by_user_id, expires_at, created_at FROM ${SUPPORT_GRANT_TABLE} WHERE firm_id = ?1 ORDER BY created_at DESC`,
    )
    .bind(firmId);
}

// Redeem: stamp the principal, but only on an active grant belonging to the expected firm. The
// firm_id guard (defense in depth, consistent with cosign/revoke) ensures a cross-firm redeem is
// a no-op even if a pre-check is bypassed. The WHERE guard also makes a wrong-state redeem a no-op
// the caller detects via changes === 0.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function redeemSupportGrantStatement(
  database: SqlDatabase,
  input: {
    readonly id: SupportGrantId;
    readonly principalId: PlatformStaffId;
    readonly firmId: FirmId;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET principal_id = ?1 WHERE id = ?2 AND status = 'active' AND firm_id = ?3`,
    )
    .bind(input.principalId, input.id, input.firmId);
}

// Cosign: requested → active, recording the approving admin. Guarded to the requested state and
// the calling firm — firm_id = ? prevents a cross-firm co-sign even if the pre-check is bypassed.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function cosignSupportGrantStatement(
  database: SqlDatabase,
  input: {
    readonly id: SupportGrantId;
    readonly cosignedByUserId: UserId;
    readonly firmId: FirmId;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET status = 'active', cosigned_by_user_id = ?1 WHERE id = ?2 AND firm_id = ?3 AND status = 'requested' AND requires_cosign = 1`,
    )
    .bind(input.cosignedByUserId, input.id, input.firmId);
}

// Revoke: → revoked, only from a live (requested/active) state — never resurrect a terminal grant.
// firm_id = ? is defense in depth against cross-firm revoke even if the pre-check is bypassed.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function revokeSupportGrantStatement(
  database: SqlDatabase,
  input: { readonly id: SupportGrantId; readonly firmId: FirmId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SUPPORT_GRANT_TABLE} SET status = 'revoked' WHERE id = ?1 AND firm_id = ?2 AND (status = 'active' OR status = 'requested')`,
    )
    .bind(input.id, input.firmId);
}
