import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a Custodian operation needs to write an audit row — the clock and the actor arrive
// from the caller (the service reads no clock and trusts no ambient identity); randomSource lets
// fixtures mint byte-deterministic ids.
export interface CustodyAuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for a Custodian effect batch through the shared domain audit
// wrapper. metadata carries IDENTIFIERS AND LOW-CARDINALITY LABELS ONLY — never an item description,
// an owner or borrower name, a custody number, or a location name. The register is a list of the
// most sensitive things a firm holds, and its metadata alone is a disclosure: "this firm holds an
// original will for Jane Smith" needs no document attached to be one.
export function custodyAuditStatement(
  database: SqlDatabase,
  context: CustodyAuditContext,
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
