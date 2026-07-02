import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a File Manager operation needs to write an audit row — the clock and actor arrive from
// the caller (the service reads no clock and trusts no ambient identity).
export interface AuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper. A
// thin positional adapter so a File Manager call site reads fileAuditStatement(db, ctx, event,
// subject). Pass metadata for events that carry non-privileged extra context (verdicts, reasons —
// never privileged content or file names); omit for the common case.
export function fileAuditStatement(
  database: SqlDatabase,
  context: AuditContext,
  event: string,
  subjectId: string,
  metadata?: unknown,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: context.actorUserId,
    clock: context.clock,
    randomSource: context.randomSource,
    metadata,
  });
}
