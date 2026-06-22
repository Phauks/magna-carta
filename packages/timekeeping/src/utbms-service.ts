import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { setUtbmsCodeActiveStatement } from "./utbms-statements.ts";

function toggle(
  database: SqlDatabase,
  id: UtbmsCodeId,
  active: number,
  event: string,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
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

// Enable/disable a seeded UTBMS code. The firm toggles the published ABA set; the UPDATE is guarded to a
// known id, so an invented code never lands — only an existing row's active flag moves.
export function enableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
  return toggle(database, id, 1, "utbms_code.enabled", options);
}

export function disableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
  return toggle(database, id, 0, "utbms_code.disabled", options);
}
