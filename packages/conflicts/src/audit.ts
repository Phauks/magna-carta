import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import type { ConflictsIdempotencyContext } from "./run-conflicts-effect.ts";

// What every conflicts write needs from its caller: the clock and the acting user (the service reads
// no ambient clock and trusts no ambient identity), plus an optional seeded source so fixtures mint
// byte-deterministic ids. Single home for all conflicts write modules.
//
// idempotency is the route's Idempotency-Key context; when present, the write commits its idempotency
// record in the same atomic batch through runConflictsEffect, so a retried mutation dedups instead of
// creating a duplicate. Absent (internal/fixture callers, the load profile), the write commits with no
// record exactly as before.
export interface ConflictsWriteOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
  readonly idempotency?: ConflictsIdempotencyContext;
}

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper —
// minting the audit-log id with null metadata (the event, subject, actor, and instant are the
// record). A thin positional adapter so a conflicts call site reads conflictsAuditStatement(db, ctx,
// event, subject).
export function conflictsAuditStatement(
  database: SqlDatabase,
  context: ConflictsWriteOptions,
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
