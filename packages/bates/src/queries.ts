import {
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  keysetClause,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  BatesLogId,
  BatesRangeId,
  ExhibitSetId,
  FileId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { BATES_LOG_TABLE } from "./log-statements.ts";
import { BATES_RANGE_TABLE } from "./range-statements.ts";
import { DEFAULT_FIRST_NUMBER, type BatesPurpose } from "./types.ts";

// The two reads of a matter's Bates numbers: its logs, each with its next number, and the ranges
// newest first. One statement each.

/** The most logs one matter's list answers. A matter keeps a handful; this is a ceiling. */
export const MAX_LOGS_PER_MATTER = 200;

export interface BatesLogSummary {
  readonly id: BatesLogId;
  readonly name: string;
  readonly prefix: string;
  readonly digits: number;
  /** One past the highest number stamped, or 1 when nothing has been. */
  readonly nextNumber: number;
  readonly rangeCount: number;
  readonly pagesStamped: number;
  readonly lastStampedAt: string | null;
  readonly createdAt: string;
}

/** A matter's logs, the one used most recently first. */
export async function listBatesLogs(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<{ data: readonly BatesLogSummary[]; capped: boolean }> {
  const { results } = await database
    .prepare(
      `SELECT l.id AS id, l.name AS name, l.prefix AS prefix, l.digits AS digits, ` +
        `COALESCE(MAX(r.last_number) + 1, ${String(DEFAULT_FIRST_NUMBER)}) AS next_number, ` +
        `COUNT(r.id) AS range_count, COALESCE(SUM(r.last_number - r.first_number + 1), 0) AS pages_stamped, ` +
        `MAX(r.created_at) AS last_stamped_at, l.created_at AS created_at ` +
        `FROM ${BATES_LOG_TABLE} l LEFT JOIN ${BATES_RANGE_TABLE} r ON r.log_id = l.id ` +
        `WHERE l.matter_id = ?1 GROUP BY l.id ` +
        `ORDER BY COALESCE(MAX(r.created_at), l.created_at) DESC, l.id DESC LIMIT ?2`,
    )
    .bind(matterId, MAX_LOGS_PER_MATTER + 1)
    .all<{
      id: BatesLogId;
      name: string;
      prefix: string;
      digits: number;
      next_number: number;
      range_count: number;
      pages_stamped: number;
      last_stamped_at: string | null;
      created_at: string;
    }>();
  const capped = results.length > MAX_LOGS_PER_MATTER;
  return {
    data: results.slice(0, MAX_LOGS_PER_MATTER).map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      digits: row.digits,
      nextNumber: row.next_number,
      rangeCount: row.range_count,
      pagesStamped: row.pages_stamped,
      lastStampedAt: row.last_stamped_at,
      createdAt: row.created_at,
    })),
    capped,
  };
}

export interface BatesRangeView {
  readonly id: BatesRangeId;
  readonly logId: BatesLogId | null;
  readonly logName: string | null;
  readonly prefix: string;
  readonly digits: number;
  readonly firstNumber: number;
  readonly lastNumber: number;
  readonly pageCount: number;
  readonly purpose: BatesPurpose;
  readonly sourceFileId: FileId | null;
  readonly sourceFileName: string | null;
  readonly exhibitSetId: ExhibitSetId | null;
  readonly stampedFileId: FileId | null;
  readonly stampedFileName: string | null;
  readonly stampedFileSavedAt: string | null;
  readonly createdBy: UserId | null;
  readonly createdAt: string;
}

export interface BatesRangeListOptions {
  readonly logId?: BatesLogId;
  readonly cursor?: string;
  readonly pageSize?: number;
}

/** A matter's ranges, newest first, with the names of the files each one stamped. */
export async function listBatesRanges(
  database: SqlDatabase,
  matterId: MatterId,
  options: BatesRangeListOptions = {},
): Promise<Page<BatesRangeView>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const bindings: unknown[] = [matterId];
  let logClause = "";
  if (options.logId !== undefined) {
    bindings.push(options.logId);
    logClause = "AND r.log_id = ? ";
  }
  const keyset = keysetClause(
    bindings,
    decodeCursor(options.cursor),
    "r.created_at",
    "r.id",
    false,
  );
  bindings.push(pageSize + 1);
  const { results } = await database
    .prepare(
      `SELECT r.id AS id, r.log_id AS log_id, g.name AS log_name, r.prefix AS prefix, r.digits AS digits, r.first_number AS first_number, ` +
        `r.last_number AS last_number, r.purpose AS purpose, r.source_file_id AS source_file_id, ` +
        `s.name AS source_file_name, r.exhibit_set_id AS exhibit_set_id, ` +
        `r.stamped_file_id AS stamped_file_id, t.name AS stamped_file_name, ` +
        `r.stamped_file_saved_at AS stamped_file_saved_at, r.created_by AS created_by, ` +
        `r.created_at AS created_at ` +
        `FROM ${BATES_RANGE_TABLE} r ` +
        `LEFT JOIN ${BATES_LOG_TABLE} g ON g.id = r.log_id ` +
        `LEFT JOIN file s ON s.id = r.source_file_id ` +
        `LEFT JOIN file t ON t.id = r.stamped_file_id ` +
        `WHERE r.matter_id = ? ` +
        logClause +
        keyset +
        `ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<{
      id: BatesRangeId;
      log_id: BatesLogId | null;
      log_name: string | null;
      prefix: string;
      digits: number;
      first_number: number;
      last_number: number;
      purpose: BatesPurpose;
      source_file_id: FileId | null;
      source_file_name: string | null;
      exhibit_set_id: ExhibitSetId | null;
      stamped_file_id: FileId | null;
      stamped_file_name: string | null;
      stamped_file_saved_at: string | null;
      created_by: UserId | null;
      created_at: string;
    }>();
  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    logId: row.log_id,
    logName: row.log_name,
    prefix: row.prefix,
    digits: row.digits,
    firstNumber: row.first_number,
    lastNumber: row.last_number,
    pageCount: row.last_number - row.first_number + 1,
    purpose: row.purpose,
    sourceFileId: row.source_file_id,
    sourceFileName: row.source_file_name,
    exhibitSetId: row.exhibit_set_id,
    stampedFileId: row.stamped_file_id,
    stampedFileName: row.stamped_file_name,
    stampedFileSavedAt: row.stamped_file_saved_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}
