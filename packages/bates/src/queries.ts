import {
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  keysetClause,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  BatesRangeId,
  ExhibitSetId,
  FileId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { BATES_RANGE_TABLE } from "./range-statements.ts";
import type { BatesPurpose } from "./types.ts";

// The two reads of a matter's register: each prefix with its next number, and the ranges newest
// first. One statement each.

/** The most prefixes one matter's summary answers. A matter uses a handful; this is a ceiling. */
export const MAX_PREFIXES_PER_MATTER = 200;

export interface BatesPrefixSummary {
  readonly prefix: string;
  /** The padding the highest range under the prefix used, so the next stamp matches it. */
  readonly digits: number;
  readonly nextNumber: number;
  readonly rangeCount: number;
  readonly pagesStamped: number;
  readonly lastStampedAt: string;
}

export async function listBatesPrefixes(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<{ data: readonly BatesPrefixSummary[]; capped: boolean }> {
  const { results } = await database
    .prepare(
      `SELECT r.prefix AS prefix, MAX(r.last_number) + 1 AS next_number, COUNT(*) AS range_count, ` +
        `SUM(r.last_number - r.first_number + 1) AS pages_stamped, MAX(r.created_at) AS last_stamped_at, ` +
        `(SELECT l.digits FROM ${BATES_RANGE_TABLE} l WHERE l.matter_id = r.matter_id AND l.prefix = r.prefix ` +
        `ORDER BY l.last_number DESC LIMIT 1) AS digits ` +
        `FROM ${BATES_RANGE_TABLE} r WHERE r.matter_id = ?1 GROUP BY r.prefix ` +
        `ORDER BY last_stamped_at DESC LIMIT ?2`,
    )
    .bind(matterId, MAX_PREFIXES_PER_MATTER + 1)
    .all<{
      prefix: string;
      next_number: number;
      range_count: number;
      pages_stamped: number;
      last_stamped_at: string;
      digits: number;
    }>();
  const capped = results.length > MAX_PREFIXES_PER_MATTER;
  return {
    data: results.slice(0, MAX_PREFIXES_PER_MATTER).map((row) => ({
      prefix: row.prefix,
      digits: row.digits,
      nextNumber: row.next_number,
      rangeCount: row.range_count,
      pagesStamped: row.pages_stamped,
      lastStampedAt: row.last_stamped_at,
    })),
    capped,
  };
}

export interface BatesRangeView {
  readonly id: BatesRangeId;
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
  readonly prefix?: string;
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
  let prefixClause = "";
  if (options.prefix !== undefined) {
    bindings.push(options.prefix);
    prefixClause = "AND r.prefix = ? ";
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
      `SELECT r.id AS id, r.prefix AS prefix, r.digits AS digits, r.first_number AS first_number, ` +
        `r.last_number AS last_number, r.purpose AS purpose, r.source_file_id AS source_file_id, ` +
        `s.name AS source_file_name, r.exhibit_set_id AS exhibit_set_id, ` +
        `r.stamped_file_id AS stamped_file_id, t.name AS stamped_file_name, ` +
        `r.stamped_file_saved_at AS stamped_file_saved_at, r.created_by AS created_by, ` +
        `r.created_at AS created_at ` +
        `FROM ${BATES_RANGE_TABLE} r ` +
        `LEFT JOIN file s ON s.id = r.source_file_id ` +
        `LEFT JOIN file t ON t.id = r.stamped_file_id ` +
        `WHERE r.matter_id = ? ` +
        prefixClause +
        keyset +
        `ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<{
      id: BatesRangeId;
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
