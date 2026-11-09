import {
  addCalendarDays,
  civilDateFromParts,
  civilDateOf,
  civilDateParts,
  endOfCivilMonth,
  isCivilDate,
  type CivilDate,
} from "@magna-carta/civil-time/civil-date";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { matterAuditStatement } from "./audit.ts";
import { fileRetentionMinimumYearsDefinition } from "./settings.ts";
import { MatterValidationError } from "./validation.ts";

// The date on or after which the firm may destroy its own PAPER file for a matter.
//
// A date a person at the firm states, and nothing else. The platform derives none: a retention
// period is set by the jurisdiction the firm practises in and by the firm's own policy, and a
// default chosen here would be a date somebody destroys a client's file on without anybody having
// decided it. Nothing in the platform reads this date to delete anything either — it is a reminder
// on the matter's status window and on the firm calendar, and destroying the file stays a person's
// act, recorded wherever the firm records it.
//
// One row per matter, keyed by the matter (`matter_file_retention`). Clearing the date deletes the
// row; the audit log keeps every date the matter carried, which is why each write names the date it
// replaced — the row itself holds only the current one.

export const MATTER_FILE_RETENTION_TABLE = "matter_file_retention";

export const MATTER_FILE_DESTRUCTION_DATE_SET_EVENT = "matter.file_destruction_date.set";
export const MATTER_FILE_DESTRUCTION_DATE_CLEARED_EVENT = "matter.file_destruction_date.cleared";

export interface MatterFileDestructionDate {
  readonly matterId: MatterId;
  /** The civil date the file may be destroyed on or after, or null where none is recorded. */
  readonly destroyOn: string | null;
  /** Who recorded the date in force; null where none is recorded. */
  readonly recordedByUserId: UserId | null;
  /** When it was recorded; null where none is recorded. */
  readonly recordedAt: string | null;
}

interface RetentionColumns {
  destroy_on: string;
  recorded_by_user_id: string;
  recorded_at: string;
}

export function selectMatterFileRetentionStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT destroy_on, recorded_by_user_id, recorded_at FROM ${MATTER_FILE_RETENTION_TABLE} WHERE matter_id = ?1`,
    )
    .bind(matterId);
}

export async function readMatterFileDestructionDate(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterFileDestructionDate> {
  const { results } = await selectMatterFileRetentionStatement(
    database,
    matterId,
  ).all<RetentionColumns>();
  const row = results[0];
  return {
    matterId,
    destroyOn: row?.destroy_on ?? null,
    recordedByUserId: (row?.recorded_by_user_id as UserId | undefined) ?? null,
    recordedAt: row?.recorded_at ?? null,
  };
}

export function upsertMatterFileRetentionStatement(
  database: SqlDatabase,
  row: {
    readonly matterId: MatterId;
    readonly destroyOn: string;
    readonly recordedByUserId: UserId;
    readonly recordedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_FILE_RETENTION_TABLE} (matter_id, destroy_on, recorded_by_user_id, recorded_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (matter_id) DO UPDATE
         SET destroy_on = excluded.destroy_on,
             recorded_by_user_id = excluded.recorded_by_user_id,
             recorded_at = excluded.recorded_at`,
    )
    .bind(row.matterId, row.destroyOn, row.recordedByUserId, row.recordedAt);
}

export function deleteMatterFileRetentionStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MATTER_FILE_RETENTION_TABLE} WHERE matter_id = ?1`)
    .bind(matterId);
}

/**
 * The earliest date a CLOSED matter's paper file may be destroyed after, under the firm's minimum:
 * the day of the close plus that many whole years. Null where the firm states no minimum (0).
 *
 * A close on 29 February rolls forward to 1 March rather than back to the 28th, so the floor is
 * never a day short of the period the firm set.
 */
export function earliestFileDestructionDate(
  closedAt: string,
  minimumYears: number,
): CivilDate | null {
  if (minimumYears <= 0) return null;
  const closedOn = civilDateOf(closedAt);
  const { year, month, day } = civilDateParts(closedOn);
  const targetYear = year + minimumYears;
  const lastDay = Number(endOfCivilMonth(targetYear, month).slice(8, 10));
  return day <= lastDay
    ? civilDateFromParts({ year: targetYear, month, day })
    : addCalendarDays(endOfCivilMonth(targetYear, month), 1);
}

function requireRealDay(destroyOn: string | null): void {
  if (destroyOn !== null && !isCivilDate(destroyOn)) {
    throw new MatterValidationError(
      "invalid-file-destruction-date",
      `the file destruction date must be a real calendar day written YYYY-MM-DD: ${String(destroyOn)}`,
    );
  }
}

// The firm's floor, applied to a date somebody states for a closed matter. Clearing is never
// refused: "none" is an answer the owner asked for in as many words.
function requireAtLeastMinimum(
  destroyOn: string | null,
  closedAt: string,
  minimumYears: number,
): void {
  if (destroyOn === null) return;
  const earliest = earliestFileDestructionDate(closedAt, minimumYears);
  if (earliest !== null && destroyOn < earliest) {
    throw new MatterValidationError(
      "file-destruction-date-before-minimum",
      `the firm keeps a closed matter's paper file at least ${String(minimumYears)} year${minimumYears === 1 ? "" : "s"}; the earliest destruction date for this matter is ${earliest}`,
    );
  }
}

type WriteContext = {
  readonly clock: { now(): string };
  // Nullable because the matter service's own options are (a fixture closes with no actor); a date
  // still needs one, since the row names who stated it, and is refused below without.
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
};

// The row write (or delete) and its audit, given the date it replaces. Pure: every rule has been
// applied by the caller.
function destructionDateStatements(
  database: SqlDatabase,
  matterId: MatterId,
  previousDestroyOn: string | null,
  destroyOn: string | null,
  context: WriteContext,
): { statements: SqlStatement[]; value: MatterFileDestructionDate } {
  const now = context.clock.now();
  const metadata = { previousDestroyOn, destroyOn };
  if (destroyOn === null) {
    return {
      statements: [
        deleteMatterFileRetentionStatement(database, matterId),
        matterAuditStatement(
          database,
          context,
          MATTER_FILE_DESTRUCTION_DATE_CLEARED_EVENT,
          matterId,
          metadata,
        ),
      ],
      value: { matterId, destroyOn: null, recordedByUserId: null, recordedAt: null },
    };
  }
  const recordedByUserId = context.actorUserId;
  if (recordedByUserId === null) {
    throw new Error("a file destruction date is stated by a member; this write names no actor");
  }
  return {
    statements: [
      upsertMatterFileRetentionStatement(database, {
        matterId,
        destroyOn,
        recordedByUserId,
        recordedAt: now,
      }),
      matterAuditStatement(
        database,
        context,
        MATTER_FILE_DESTRUCTION_DATE_SET_EVENT,
        matterId,
        metadata,
      ),
    ],
    value: { matterId, destroyOn, recordedByUserId, recordedAt: now },
  };
}

/**
 * The statements one later write of a matter's file destruction date makes, for the caller's
 * atomic batch — a change after the close, from the status window. `destroyOn` null clears it.
 *
 * Refused: a day that does not exist (the route's pattern accepts 2026-02-30, this does not); a
 * matter that does not exist, or the platform's own holding matter, which holds no paper file of
 * the firm's; a date on a matter that is not closed, because the date is set when the matter
 * closes and the floor runs from that close; and a date earlier than the firm's minimum after the
 * close. Clearing is refused only for a matter that does not exist.
 */
export async function composeSetMatterFileDestructionDate(
  database: SqlDatabase,
  matterId: MatterId,
  destroyOn: string | null,
  context: WriteContext,
): Promise<{ statements: SqlStatement[]; value: MatterFileDestructionDate }> {
  requireRealDay(destroyOn);
  const { results: matterRows } = await database
    .prepare("SELECT system_key, status, closed_at FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ system_key: string | null; status: string; closed_at: string | null }>();
  const matterRow = matterRows[0];
  if (matterRow === undefined || matterRow.system_key !== null) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (destroyOn !== null) {
    if (matterRow.status !== "closed" || matterRow.closed_at === null) {
      throw new MatterValidationError(
        "matter-not-closed",
        `matter ${matterId} is ${matterRow.status}; a file destruction date is set when the matter closes`,
      );
    }
    requireAtLeastMinimum(
      destroyOn,
      matterRow.closed_at,
      await readFirmSetting(database, fileRetentionMinimumYearsDefinition),
    );
  }
  const previous = await readMatterFileDestructionDate(database, matterId);
  return destructionDateStatements(database, matterId, previous.destroyOn, destroyOn, context);
}

/**
 * The date stated as a matter closes, for the close's own batch: validated against the firm's
 * minimum measured from `closedAt`, the instant the close is about to stamp. Null states that the
 * file has no destruction date; a date left over from an earlier close is then cleared, so the
 * close a person just made is the one the record answers to.
 */
export async function composeFileDestructionDateAtClose(
  database: SqlDatabase,
  matterId: MatterId,
  destroyOn: string | null,
  closedAt: string,
  context: WriteContext,
): Promise<SqlStatement[]> {
  requireRealDay(destroyOn);
  requireAtLeastMinimum(
    destroyOn,
    closedAt,
    await readFirmSetting(database, fileRetentionMinimumYearsDefinition),
  );
  const previous = await readMatterFileDestructionDate(database, matterId);
  if (destroyOn === null && previous.destroyOn === null) return [];
  return destructionDateStatements(database, matterId, previous.destroyOn, destroyOn, context)
    .statements;
}

/**
 * A reopened matter's file is a working file again, so the date it could have been destroyed
 * after no longer stands: cleared in the reopen's own batch, audited with the date it held. The
 * next close asks for a date again.
 */
export async function composeClearFileDestructionDateOnReopen(
  database: SqlDatabase,
  matterId: MatterId,
  context: WriteContext,
): Promise<SqlStatement[]> {
  const previous = await readMatterFileDestructionDate(database, matterId);
  if (previous.destroyOn === null) return [];
  return destructionDateStatements(database, matterId, previous.destroyOn, null, context)
    .statements;
}
