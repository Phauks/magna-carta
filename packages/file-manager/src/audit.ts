import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a File Manager operation needs to write an audit row — the clock and actor arrive from
// the caller (the service reads no clock and trusts no ambient identity).
export interface AuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch. Metadata is null at this layer — the
// event, subject, actor, and instant are the record; a future audit subsystem enriches it.
export function fileAuditStatement(
  database: SqlDatabase,
  context: AuditContext,
  event: string,
  subjectId: string,
): SqlStatement {
  return insertAuditLogStatement(database, {
    id: newIdentifier("auditLog", context.randomSource),
    event,
    actorUserId: context.actorUserId,
    subjectId,
    metadata: null,
    now: context.clock.now(),
  });
}
