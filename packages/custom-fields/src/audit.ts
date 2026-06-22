import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldWriteOptions } from "./run-custom-field-effect.ts";

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper.
// A thin positional adapter so a custom-fields call site reads
// customFieldAuditStatement(db, options, event, subjectId).
export function customFieldAuditStatement(
  database: SqlDatabase,
  options: CustomFieldWriteOptions,
  event: string,
  subjectId: string,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}
