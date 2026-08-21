import {
  appendCursorPredicate,
  appendCursorPredicateOnColumn,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import type { TimeEntryStatus } from "./lifecycle.ts";
import { TIME_ENTRY_TABLE } from "./time-entry-statements.ts";

export type { Page };

const TIME_ENTRY_LIST_COLUMNS =
  "id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, rate_source, amount_minor, status, source, created_at";

interface TimeEntryRowRaw {
  id: string;
  matter_id: MatterId;
  timekeeper_user_id: UserId;
  work_date: string;
  duration_minutes: number;
  raw_duration_minutes: number;
  narrative: string;
  billable: number;
  currency: string;
  rate_e4: number | null;
  rate_source: string | null;
  amount_minor: number | null;
  status: TimeEntryStatus;
  source: string;
  created_at: string;
}

export interface TimeEntryListItem {
  readonly id: string;
  readonly matterId: MatterId;
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly durationMinutes: number;
  readonly rawDurationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly currency: string;
  readonly rateE4: number | null;
  readonly rateSource: string | null;
  readonly amountMinor: number | null;
  readonly status: TimeEntryStatus;
  readonly source: string;
  readonly createdAt: string;
}

function toTimeEntryListItem(row: TimeEntryRowRaw): TimeEntryListItem {
  return {
    id: row.id,
    matterId: row.matter_id,
    timekeeperUserId: row.timekeeper_user_id,
    workDate: row.work_date,
    durationMinutes: row.duration_minutes,
    rawDurationMinutes: row.raw_duration_minutes,
    narrative: row.narrative,
    billable: row.billable === 1,
    currency: row.currency,
    rateE4: row.rate_e4,
    rateSource: row.rate_source,
    amountMinor: row.amount_minor,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  };
}

export interface ListTimekeeperDayParams {
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

// My Day's entry list: one timekeeper, one work date, newest first. Driven by the
// (timekeeper_user_id, work_date) index so the keyset sort needs no temporary B-tree.
export function listTimeEntriesForTimekeeperDayStatement(
  database: SqlDatabase,
  timekeeperUserId: UserId,
  workDate: string,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = ["timekeeper_user_id = ?", "work_date = ?", "status != 'void'"];
  const bindings: unknown[] = [timekeeperUserId, workDate];
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${TIME_ENTRY_LIST_COLUMNS} FROM ${TIME_ENTRY_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listTimeEntriesForTimekeeperDay(
  database: SqlDatabase,
  params: ListTimekeeperDayParams,
): Promise<Page<TimeEntryListItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listTimeEntriesForTimekeeperDayStatement(
    database,
    params.timekeeperUserId,
    params.workDate,
    decodeCursor(params.cursor),
    pageSize + 1,
  ).all<TimeEntryRowRaw>();
  return assemblePage(results, pageSize, toTimeEntryListItem);
}

export interface WeeklyGridParams {
  readonly timekeeperUserId: UserId;
  readonly fromDate: string;
  readonly toDate: string;
}

// The weekly matters x days grid fan: every non-void entry for the timekeeper inside [fromDate, toDate],
// ordered by day then matter. A bounded week window, so the whole grid is one read (no pagination).
export function listWeeklyGridStatement(
  database: SqlDatabase,
  params: WeeklyGridParams,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TIME_ENTRY_LIST_COLUMNS} FROM ${TIME_ENTRY_TABLE} WHERE timekeeper_user_id = ?1 AND work_date >= ?2 AND work_date <= ?3 AND status != 'void' ORDER BY work_date ASC, matter_id ASC, id ASC`,
    )
    .bind(params.timekeeperUserId, params.fromDate, params.toDate);
}

export async function listWeeklyGrid(
  database: SqlDatabase,
  params: WeeklyGridParams,
): Promise<TimeEntryListItem[]> {
  const { results } = await listWeeklyGridStatement(database, params).all<TimeEntryRowRaw>();
  return results.map(toTimeEntryListItem);
}

export interface UnbilledByMatterRow {
  readonly matterId: MatterId;
  readonly unbilledMinutes: number;
  readonly unbilledAmountMinor: number;
  readonly entryCount: number;
}

interface UnbilledByMatterRowRaw {
  matter_id: MatterId;
  unbilled_minutes: number;
  unbilled_amount_minor: number;
  entry_count: number;
}

// Per-matter unbilled WIP — the billing read. Sums minutes + amount over draft/submitted/approved
// (anything not yet billed and not void) for one matter, driven by the (matter_id, status) index.
// amount_minor is nullable (non-billable internal time) — COALESCE folds those to 0 in the sum.
export function listUnbilledByMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT matter_id,
         COALESCE(SUM(duration_minutes), 0) AS unbilled_minutes,
         COALESCE(SUM(amount_minor), 0) AS unbilled_amount_minor,
         COUNT(*) AS entry_count
       FROM ${TIME_ENTRY_TABLE}
       WHERE matter_id = ?1 AND status NOT IN ('billed', 'void')
       GROUP BY matter_id`,
    )
    .bind(matterId);
}

export async function listUnbilledByMatter(
  database: SqlDatabase,
  params: { matterId: MatterId },
): Promise<UnbilledByMatterRow[]> {
  const { results } = await listUnbilledByMatterStatement(
    database,
    params.matterId,
  ).all<UnbilledByMatterRowRaw>();
  return results.map((row) => ({
    matterId: row.matter_id,
    unbilledMinutes: row.unbilled_minutes,
    unbilledAmountMinor: row.unbilled_amount_minor,
    entryCount: row.entry_count,
  }));
}

export interface ListTimeEntriesByMatterParams {
  readonly matterId: MatterId;
  // Omitted means EVERY status. A matter's time tab asks "what time is on this matter", and the
  // answer includes the approved, the billed and the voided — narrowing to one status is the
  // work-in-progress question, which is a different question with a different caller.
  readonly status?: TimeEntryStatus;
  readonly cursor?: string;
  readonly pageSize?: number;
}

// One entry on a matter, with the timekeeper's name resolved. The name is joined here rather than
// looked up per row by the caller: a matter with forty entries would otherwise be forty reads to
// print a column, and the join is on member's primary key. An outer join, because a member row can
// be archived while the time they recorded stays on the matter forever — that reads as a null name
// and the screen says so, rather than showing a user_ handle where a person's name belongs.
export interface MatterTimeEntry extends TimeEntryListItem {
  readonly timekeeperName: string | null;
}

// Per-matter individual entry list, newest-first, every status unless one is named. Distinct from
// listUnbilledByMatter, which aggregates into a single work-in-progress summary row; this returns
// individual entries. With a status it rides the (matter_id, status) index; without one it walks
// matter_id, which is the same index prefix.
//
// PAGED, over the platform's own cursor. This read carried no LIMIT at all: a matter that had been
// billing for years answered with every entry on it in one response, and the size of that answer was
// bounded by nothing but the firm's own history. The sort key is (work_date, id) rather than
// (created_at, id) because work_date is the order a person reads time in, and the identifier is the
// tiebreak because a keyset cursor needs a TOTAL order — two entries can share a work date, and
// created_at is not unique either.
export async function listTimeEntriesByMatter(
  database: SqlDatabase,
  params: ListTimeEntriesByMatterParams,
): Promise<Page<MatterTimeEntry>> {
  const columns = TIME_ENTRY_LIST_COLUMNS.split(", ")
    .map((column) => `time_entry.${column}`)
    .join(", ");
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const conditions = ["time_entry.matter_id = ?"];
  const bindings: unknown[] = [params.matterId];
  if (params.status !== undefined) {
    conditions.push("time_entry.status = ?");
    bindings.push(params.status);
  }
  appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(params.cursor), {
    sortColumn: "time_entry.work_date",
    idColumn: "time_entry.id",
    ascending: false,
  });
  // One more than the page, as the has-more probe.
  bindings.push(pageSize + 1);

  const { results } = await database
    .prepare(
      `SELECT ${columns}, member.display_name AS timekeeper_name
         FROM ${TIME_ENTRY_TABLE} AS time_entry
         LEFT JOIN member ON member.user_id = time_entry.timekeeper_user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY time_entry.work_date DESC, time_entry.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<TimeEntryRowRaw & { timekeeper_name: string | null }>();

  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    // The cursor is minted over the SORT key, not created_at — assemblePage mints over created_at,
    // which is the right key only for a read ordered by it.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.work_date, last.id) : null,
    data: rows.map((row) => ({
      ...toTimeEntryListItem(row),
      timekeeperName: row.timekeeper_name,
    })),
  };
}
