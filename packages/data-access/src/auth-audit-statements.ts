import type { AuthAuditId, UserId } from "@magna-carta/identifiers/types";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import { refuseUnredactedMetadata } from "./metadata-redaction.ts";

// Guarded vs batched — the one home for the split (both callers import this seam). Hook-driven
// audit writes (login.success, two_factor.*, password.reset — apps/api-worker auth.ts) fire alone and
// are guarded/swallowed at the call site: they are observability, not gates, so their failure must
// never break the auth flow they describe. Request-path audit writes (member.invited,
// firm.provisioned — routes/session/members.ts, firm-provisioner.ts) ride the atomic effect batch and fail
// with it: an audit row the request's own commit cannot carry means the request must not succeed.
// The divergence is deliberate, not drift.

// Table name tracked against @magna-carta/database's control-plane schema by the schema-name-sync
// fitness test. auth_audit exists only in the control-plane database — the caller supplies that handle.
export const AUTH_AUDIT_TABLE = "auth_audit";

export interface AuthAuditInput {
  readonly id: AuthAuditId;
  readonly event: string; // e.g. 'sign_in.success', 'two_factor.enabled'
  readonly userId: UserId | null; // null for pre-identification events (e.g. a failed sign-in)
  readonly metadata: unknown; // ids + non-privileged fields ONLY; null/undefined = no metadata
  readonly now: string; // ISO-8601 instant
}

// The builder is dumb: it canonical-stringifies whatever it is given, so redaction discipline lives
// at the call sites. The shared password-key tripwire (metadata-redaction.ts) is a canary for the
// most obvious leak, not a guarantee.
export function insertAuthAuditStatement(
  database: SqlDatabase,
  input: AuthAuditInput,
): SqlStatement {
  let metadata: string | null = null;
  if (input.metadata !== null && input.metadata !== undefined) {
    refuseUnredactedMetadata(input.metadata, AUTH_AUDIT_TABLE);
    metadata = canonicalJsonStringify(input.metadata);
  }
  return database
    .prepare(
      `INSERT INTO ${AUTH_AUDIT_TABLE} (id, event, user_id, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.id, input.event, input.userId, metadata, input.now);
}
