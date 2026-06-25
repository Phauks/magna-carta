import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a timekeeping operation needs to write an audit row — the clock and actor arrive from
// the caller (the service reads no clock and trusts no ambient identity). randomSource lets fixtures
// mint byte-deterministic ids.
export interface AuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper. A thin
// positional adapter so a timekeeping call site reads timeAuditStatement(db, ctx, event, subject).
export function timeAuditStatement(
  database: SqlDatabase,
  context: AuditContext,
  event: string,
  subjectId: string,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: context.actorUserId,
    clock: context.clock,
    randomSource: context.randomSource,
  });
}
