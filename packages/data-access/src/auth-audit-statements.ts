import type { AuthAuditId, UserId } from "@magna-carta/identifiers/types";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's control-plane schema by the schema-name-sync
// fitness test. auth_audit exists only in the control-plane database — the caller supplies that handle.
export const AUTH_AUDIT_TABLE = "auth_audit";

export interface AuthAuditInput {
  readonly id: AuthAuditId;
  readonly event: string; // e.g. 'sign_in.success', 'two_factor.enabled'
  readonly userId: UserId | null; // null for pre-identification events (e.g. a failed sign-in)
  readonly metadata: unknown; // ids + non-privileged fields ONLY (ADR-0038); null = no metadata
  readonly now: string; // ISO-8601 instant (ADR-0055)
}

// The builder is dumb: it canonical-stringifies whatever it is given, so redaction discipline lives
// at the call sites (ADR-0038). The password-key tripwire below is a canary for the most obvious
// leak, not a guarantee.
export function insertAuthAuditStatement(
  database: SqlDatabase,
  input: AuthAuditInput,
): SqlStatement {
  let metadata: string | null = null;
  if (input.metadata !== null && input.metadata !== undefined) {
    refuseUnredactedMetadata(input.metadata);
    metadata = canonicalJsonStringify(input.metadata);
  }
  return database
    .prepare(
      `INSERT INTO ${AUTH_AUDIT_TABLE} (id, event, user_id, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.id, input.event, input.userId, metadata, input.now);
}

// Canary: refuse a literal `password` key anywhere in the metadata (case-insensitive, nested).
// Values mentioning the word are fine — only a key trips it.
function refuseUnredactedMetadata(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) refuseUnredactedMetadata(entry);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === "password") {
        throw new Error(
          "auth_audit metadata contains a 'password' key — redact at the call site before logging (ADR-0038)",
        );
      }
      refuseUnredactedMetadata(entry);
    }
  }
}
