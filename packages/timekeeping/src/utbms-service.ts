import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import { selectUtbmsCodeExistsStatement, setUtbmsCodeActiveStatement } from "./utbms-statements.ts";

// Pre-read the code's existence so the service refuses an unknown id without writing a misleading
// audit row for a subject that never existed. Mirrors loadStatus in time-entry-service.ts.
async function assertUtbmsCodeExists(database: SqlDatabase, id: UtbmsCodeId): Promise<void> {
  const { results } = await selectUtbmsCodeExistsStatement(database, id).all<{ found: number }>();
  if (results.length === 0) {
    throw new TimeEntryValidationError("not-found", `no such UTBMS code: ${id}`);
  }
}

// Enable/disable a seeded UTBMS code. The firm toggles the published ABA set; only an existing row's
// active flag moves. We pre-read existence so that an unknown id surfaces a clear not-found refusal
// and produces no audit row — an audit event for a non-existent subject would be misleading on a
// legal/audit-sensitive platform.
async function toggle(
  database: SqlDatabase,
  id: UtbmsCodeId,
  active: number,
  event: string,
  options: TimekeepingServiceOptions,
): Promise<{ utbmsCodeId: UtbmsCodeId; effect: EffectWrite }> {
  await assertUtbmsCodeExists(database, id);
  return {
    utbmsCodeId: id,
    effect: {
      statements: [
        setUtbmsCodeActiveStatement(database, id, active),
        domainAuditStatement(database, {
          event,
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export function enableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): Promise<{ utbmsCodeId: UtbmsCodeId; effect: EffectWrite }> {
  return toggle(database, id, 1, "utbms_code.enabled", options);
}

export function disableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): Promise<{ utbmsCodeId: UtbmsCodeId; effect: EffectWrite }> {
  return toggle(database, id, 0, "utbms_code.disabled", options);
}
