import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BatesLogId, MatterId } from "@magna-carta/identifiers/types";
import {
  insertLogStatement,
  readLogByName,
  readLogRow,
  renameLogStatement,
  type BatesLogRow,
} from "./log-statements.ts";
import type { BatesServiceOptions } from "./types.ts";
import { BatesValidationError, assertDigits, assertLogName, assertPrefix } from "./validation.ts";

// Starting and renaming a matter's Bates logs. A matter keeps one log per filing or production that
// wants numbers of its own; each log counts from its own start under its own prefix. Two logs may
// share a prefix: the name is what tells them apart.

/** The guard a second log with a name already used on the matter is refused under. */
export const LOG_NAME_GUARD = "bates-log-name";

export interface BatesLog {
  readonly id: BatesLogId;
  readonly name: string;
  readonly prefix: string;
  readonly digits: number;
}

function nameTaken(name: string): BatesValidationError {
  return new BatesValidationError(
    "bates-log-name-taken",
    `This matter already has a Bates log named "${name}". Pick it, or give the new one another name.`,
  );
}

export async function createBatesLog(
  database: SqlDatabase,
  input: {
    readonly matterId: MatterId;
    readonly name: unknown;
    readonly prefix: unknown;
    readonly digits: unknown;
  },
  options: BatesServiceOptions,
): Promise<{ log: BatesLog; effect: EffectWrite }> {
  const name = assertLogName(input.name);
  const prefix = assertPrefix(input.prefix);
  const digits = assertDigits(input.digits);
  // Advisory: names the clash. The guard on the insert is what holds.
  if ((await readLogByName(database, input.matterId, name)) !== undefined) throw nameTaken(name);
  const id = newIdentifier("batesLog", options.randomSource);
  return {
    log: { id, name, prefix, digits },
    effect: {
      statements: [
        guarded(
          insertLogStatement(database, {
            id,
            matterId: input.matterId,
            name,
            prefix,
            digits,
            createdBy: options.actorUserId,
            now: options.clock.now(),
          }),
          LOG_NAME_GUARD,
        ),
        domainAuditStatement(database, {
          event: "batesLog.created",
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: input.matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

/** The log, refused as unknown when it is on another matter. */
export async function requireLog(
  database: SqlDatabase,
  matterId: MatterId,
  logId: BatesLogId,
): Promise<BatesLogRow> {
  const log = await readLogRow(database, logId);
  if (log === undefined || log.matter_id !== matterId) {
    throw new BatesValidationError("bates-unknown-log", "no such Bates log on this matter");
  }
  return log;
}

/** Renames a log. Its prefix and padding never change, because they are what its stamps printed. */
export async function renameBatesLog(
  database: SqlDatabase,
  matterId: MatterId,
  logId: BatesLogId,
  newName: unknown,
  options: BatesServiceOptions,
): Promise<{ log: BatesLog; effect: EffectWrite }> {
  const log = await requireLog(database, matterId, logId);
  const name = assertLogName(newName);
  const clash = await readLogByName(database, matterId, name);
  if (clash !== undefined && clash.id !== logId) throw nameTaken(name);
  return {
    log: { id: logId, name, prefix: log.prefix, digits: log.digits },
    effect: {
      statements: [
        guarded(renameLogStatement(database, logId, matterId, name), LOG_NAME_GUARD),
        domainAuditStatement(database, {
          event: "batesLog.renamed",
          subjectId: logId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId },
        }),
      ],
      outboxMessages: [],
    },
  };
}
