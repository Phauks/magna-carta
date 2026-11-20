import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  BatesLogId,
  BatesRangeId,
  ExhibitSetId,
  FileId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { BatesPurpose } from "./types.ts";

export const BATES_RANGE_TABLE = "bates_range";

export interface BatesRangeRow {
  readonly id: BatesRangeId;
  readonly matter_id: MatterId;
  readonly log_id: BatesLogId | null;
  readonly prefix: string;
  readonly digits: number;
  readonly first_number: number;
  readonly last_number: number;
  readonly purpose: BatesPurpose;
  readonly source_file_id: FileId | null;
  readonly exhibit_set_id: ExhibitSetId | null;
  readonly stamped_file_id: FileId | null;
  readonly stamped_file_saved_at: string | null;
  readonly created_by: UserId | null;
  readonly created_at: string;
}

export const RANGE_COLUMNS =
  "id, matter_id, log_id, prefix, digits, first_number, last_number, purpose, source_file_id, " +
  "exhibit_set_id, stamped_file_id, stamped_file_saved_at, created_by, created_at";

/**
 * Takes a range, guarded on no range in the same log overlapping it.
 *
 * THIS IS THE GUARD, not the read before it. Two members stamping at once both read the same next
 * number; the batch that commits second sees the first one's row here, inserts nothing, and is
 * refused. A hand-typed start number that reaches into a stamped range is refused the same way. A
 * counter row could not do the second, because a counter only knows where the run ends, not which
 * numbers inside it were taken.
 */
export function takeRangeStatement(
  database: SqlDatabase,
  row: {
    readonly id: BatesRangeId;
    readonly matterId: MatterId;
    readonly logId: BatesLogId;
    readonly prefix: string;
    readonly digits: number;
    readonly firstNumber: number;
    readonly lastNumber: number;
    readonly purpose: BatesPurpose;
    readonly sourceFileId: FileId | null;
    readonly exhibitSetId: ExhibitSetId | null;
    readonly createdBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${BATES_RANGE_TABLE} (id, matter_id, log_id, prefix, digits, first_number, ` +
        `last_number, purpose, source_file_id, exhibit_set_id, created_by, created_at) ` +
        `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 ` +
        `WHERE NOT EXISTS (SELECT 1 FROM ${BATES_RANGE_TABLE} WHERE log_id = ?3 ` +
        `AND first_number <= ?7 AND last_number >= ?6)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.logId,
      row.prefix,
      row.digits,
      row.firstNumber,
      row.lastNumber,
      row.purpose,
      row.sourceFileId,
      row.exhibitSetId,
      row.createdBy,
      row.now,
    );
}

/** Records the stamped copy once. Guarded on none being recorded yet. */
export function recordStampedFileStatement(
  database: SqlDatabase,
  id: BatesRangeId,
  stampedFileId: FileId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${BATES_RANGE_TABLE} SET stamped_file_id = ?2, stamped_file_saved_at = ?3 ` +
        `WHERE id = ?1 AND stamped_file_id IS NULL`,
    )
    .bind(id, stampedFileId, now);
}

export async function readRangeRow(
  database: SqlDatabase,
  id: BatesRangeId,
): Promise<BatesRangeRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${RANGE_COLUMNS} FROM ${BATES_RANGE_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<BatesRangeRow>();
  return results[0];
}

/** One past the highest number stamped in a log, or undefined when nothing has been. */
export async function readNextNumber(
  database: SqlDatabase,
  logId: BatesLogId,
): Promise<number | undefined> {
  const { results } = await database
    .prepare(`SELECT MAX(last_number) AS highest FROM ${BATES_RANGE_TABLE} WHERE log_id = ?1`)
    .bind(logId)
    .all<{ highest: number | null }>();
  const highest = results[0]?.highest ?? null;
  return highest === null ? undefined : highest + 1;
}

/** The first stamped range in a log that overlaps the asked-for numbers, if any. */
export async function readOverlappingRange(
  database: SqlDatabase,
  logId: BatesLogId,
  firstNumber: number,
  lastNumber: number,
): Promise<BatesRangeRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${RANGE_COLUMNS} FROM ${BATES_RANGE_TABLE} WHERE log_id = ?1 ` +
        `AND first_number <= ?3 AND last_number >= ?2 ORDER BY first_number LIMIT 1`,
    )
    .bind(logId, firstNumber, lastNumber)
    .all<BatesRangeRow>();
  return results[0];
}
