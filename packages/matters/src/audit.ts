import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a matters operation needs to write an audit row — the clock and actor arrive from the
// caller (the service reads no clock and trusts no ambient identity).
export interface AuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper —
// minting the audit-log id. A thin positional adapter so a matters call site reads
// matterAuditStatement(db, ctx, event, subject).
//
// Most matters events carry no metadata: the event, subject, actor, and instant are the whole
// record. Pass metadata only where the mutation destroys a value nothing else retains — a renumber
// overwrites the previous matter number in place, and a filing or invoice that quotes the old number
// is unresolvable without it. Ids and non-privileged fields only, never privileged content.
export function matterAuditStatement(
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
