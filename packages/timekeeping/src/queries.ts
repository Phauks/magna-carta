import {
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

// ---------------------------------------------------------------------------------------------
// The RECORD read: the listing/get shape the API serves, with every stored fact on the row plus
// the resolved display facts — the timekeeper's and the enterer's names through the member mirror
// (null where the member row is gone: an honest gap, never a user_ handle standing in for a
// person), the UTBMS task/activity code and label, and the attachment count. One column set and
// one join fragment shared by the My-Day read, the per-matter read and the single-entry detail,
// so the three surfaces can never disagree about what an entry is.
// ---------------------------------------------------------------------------------------------

const TIME_ENTRY_RECORD_COLUMNS = [
  "time_entry.id",
  "time_entry.matter_id",
  "time_entry.timekeeper_user_id",
  "time_entry.work_date",
  "time_entry.duration_minutes",
  "time_entry.raw_duration_minutes",
  "time_entry.narrative",
  "time_entry.billable",
  "time_entry.currency",
  "time_entry.rate_e4",
  "time_entry.rate_card_id",
  "time_entry.rate_source",
  "time_entry.amount_minor",
  "time_entry.utbms_task_code_id",
  "time_entry.utbms_activity_code_id",
  "time_entry.status",
  "time_entry.source",
  "time_entry.invoice_id",
  "time_entry.task_id",
  "time_entry.memo",
  "time_entry.entry_number",
  "time_entry.created_at",
  "time_entry.created_by",
  "timekeeper.display_name AS timekeeper_name",
  "enterer.display_name AS created_by_name",
  "task_code.code AS utbms_task_code",
  "task_code.label AS utbms_task_label",
  "activity_code.code AS utbms_activity_code",
  "activity_code.label AS utbms_activity_label",
  `(SELECT COUNT(*) FROM time_entry_attachment attachment WHERE attachment.time_entry_id = time_entry.id) AS attachment_count`,
].join(", ");

const TIME_ENTRY_RECORD_JOINS =
  `LEFT JOIN member timekeeper ON timekeeper.user_id = time_entry.timekeeper_user_id ` +
  `LEFT JOIN member enterer ON enterer.user_id = time_entry.created_by ` +
  `LEFT JOIN utbms_code task_code ON task_code.id = time_entry.utbms_task_code_id ` +
  `LEFT JOIN utbms_code activity_code ON activity_code.id = time_entry.utbms_activity_code_id`;

interface TimeEntryRecordRowRaw extends TimeEntryRowRaw {
  rate_card_id: string | null;
  utbms_task_code_id: string | null;
  utbms_activity_code_id: string | null;
  invoice_id: string | null;
  task_id: string | null;
  memo: string | null;
  entry_number: string | null;
  created_by: UserId | null;
  timekeeper_name: string | null;
  created_by_name: string | null;
  utbms_task_code: string | null;
  utbms_task_label: string | null;
  utbms_activity_code: string | null;
  utbms_activity_label: string | null;
  attachment_count: number;
}

export interface TimeEntryRecordItem extends TimeEntryListItem {
  readonly rateCardId: string | null;
  readonly utbmsTaskCodeId: string | null;
  readonly utbmsTaskCode: string | null;
  readonly utbmsTaskLabel: string | null;
  readonly utbmsActivityCodeId: string | null;
  readonly utbmsActivityCode: string | null;
  readonly utbmsActivityLabel: string | null;
  readonly invoiceId: string | null;
  // The task this time was worked on, when the timekeeper named one. Null on most entries.
  readonly taskId: string | null;
  readonly memo: string | null;
  readonly entryNumber: string | null;
  readonly createdByUserId: UserId | null;
  readonly createdByName: string | null;
  readonly timekeeperName: string | null;
  readonly attachmentCount: number;
}

function toTimeEntryRecordItem(row: TimeEntryRecordRowRaw): TimeEntryRecordItem {
  return {
    ...toTimeEntryListItem(row),
    rateCardId: row.rate_card_id,
    utbmsTaskCodeId: row.utbms_task_code_id,
    utbmsTaskCode: row.utbms_task_code,
    utbmsTaskLabel: row.utbms_task_label,
    utbmsActivityCodeId: row.utbms_activity_code_id,
    utbmsActivityCode: row.utbms_activity_code,
    utbmsActivityLabel: row.utbms_activity_label,
    invoiceId: row.invoice_id,
    taskId: row.task_id,
    memo: row.memo,
    entryNumber: row.entry_number,
    createdByUserId: row.created_by,
    createdByName: row.created_by_name,
    timekeeperName: row.timekeeper_name,
    attachmentCount: row.attachment_count,
  };
}

export interface ListTimekeeperDayParams {
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

// My Day's entry list: one timekeeper, one work date, newest first. Driven by the
// (timekeeper_user_id, work_date) index so the keyset sort needs no temporary B-tree; the record
// joins land on primary keys.
export function listTimeEntriesForTimekeeperDayStatement(
  database: SqlDatabase,
  timekeeperUserId: UserId,
  workDate: string,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = [
    "time_entry.timekeeper_user_id = ?",
    "time_entry.work_date = ?",
    "time_entry.status != 'void'",
  ];
  const bindings: unknown[] = [timekeeperUserId, workDate];
  appendCursorPredicateOnColumn(conditions, bindings, cursor, {
    sortColumn: "time_entry.created_at",
    idColumn: "time_entry.id",
    ascending: false,
  });
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${TIME_ENTRY_RECORD_COLUMNS} FROM ${TIME_ENTRY_TABLE} AS time_entry ${TIME_ENTRY_RECORD_JOINS} WHERE ${conditions.join(" AND ")} ORDER BY time_entry.created_at DESC, time_entry.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listTimeEntriesForTimekeeperDay(
  database: SqlDatabase,
  params: ListTimekeeperDayParams,
): Promise<Page<TimeEntryRecordItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listTimeEntriesForTimekeeperDayStatement(
    database,
    params.timekeeperUserId,
    params.workDate,
    decodeCursor(params.cursor),
    pageSize + 1,
  ).all<TimeEntryRecordRowRaw>();
  return assemblePage(results, pageSize, toTimeEntryRecordItem);
}

// One entry, whole — the GET detail. Same columns and joins as the listings, so the detail can
// never know less than the row a listing showed. Undefined when no such entry exists.
export async function readTimeEntryRecord(
  database: SqlDatabase,
  timeEntryId: string,
): Promise<TimeEntryRecordItem | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${TIME_ENTRY_RECORD_COLUMNS} FROM ${TIME_ENTRY_TABLE} AS time_entry ${TIME_ENTRY_RECORD_JOINS} WHERE time_entry.id = ?1`,
    )
    .bind(timeEntryId)
    .all<TimeEntryRecordRowRaw>();
  const row = results[0];
  return row === undefined ? undefined : toTimeEntryRecordItem(row);
}

// An entry's recorded audit events, OLDEST first — the order a history rail reads in. The metadata
// is the stored redacted JSON, verbatim; actor names resolve through the member mirror and stay
// null for system events and departed members (honest blanks, like the file history).
//
// CURSOR-PAGED, ascending. An entry's history is not bounded by its lifecycle: a draft worked over
// a week records an event per edit, and an entry that collects attachments records one per act. The
// keyset is (created_at, id) — the same total order the subject-led audit index walks.
export interface TimeEntryEventItem {
  readonly at: string;
  readonly event: string;
  readonly actorUserId: UserId | null;
  readonly actorName: string | null;
  readonly metadataJson: string | null;
}

export interface ListTimeEntryEventsParams {
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listTimeEntryEvents(
  database: SqlDatabase,
  timeEntryId: string,
  params: ListTimeEntryEventsParams = {},
): Promise<Page<TimeEntryEventItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions = ["a.subject_id = ?", "a.event LIKE 'time_entry.%'"];
  const bindings: unknown[] = [timeEntryId];
  appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(params.cursor), {
    sortColumn: "a.created_at",
    idColumn: "a.id",
    ascending: true,
  });
  // One more than the page, as the has-more probe.
  bindings.push(pageSize + 1);

  const { results } = await database
    .prepare(
      `SELECT a.id, a.created_at, a.event, a.actor_user_id, a.metadata, m.display_name AS actor_name ` +
        `FROM audit_log a LEFT JOIN member m ON m.user_id = a.actor_user_id ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY a.created_at ASC, a.id ASC LIMIT ?`,
    )
    .bind(...bindings)
    .all<{
      id: string;
      created_at: string;
      event: string;
      actor_user_id: UserId | null;
      metadata: string | null;
      actor_name: string | null;
    }>();

  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
    data: rows.map((row) => ({
      at: row.created_at,
      event: row.event,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      metadataJson: row.metadata,
    })),
  };
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

/**
 * The period read: every entry in a span of work dates, across every matter.
 *
 * THE THIRD QUESTION TIME IS ASKED. The day read answers "what did this person do today"; the
 * matter read answers "what time is on this file". Neither answers "what time was recorded this
 * week", which is the question a timekeeper asks of their own record and a supervisor asks of the
 * firm's — and it is the question the firm-wide time surface is built on. Answering it by walking
 * the matters one at a time is not an answer: the caller would need every matter first, and the
 * page boundaries would fall inside matters rather than inside the period.
 *
 * THE SPAN IS REQUIRED AND THE NARROWING IS NOT. A range with no timekeeper is the firm's whole
 * record for those days, which is exactly what a supervisor asks for; the route decides who may ask
 * it. What is never optional is the span itself, because a listing over all time with no bound is a
 * full-table scan wearing a cursor.
 *
 * VOIDS ARE INCLUDED, on the per-matter read's rule: a void stays on the record with its chip and
 * counts toward nothing, and a listing that dropped it would make a record look smaller than it is.
 * The day read excludes them because My Day is a working surface rather than a record.
 *
 * The sort key is (work_date, id) descending — the same total order the per-matter read walks, so a
 * cursor means the same thing on both and the two surfaces page identically.
 */
export interface ListTimeEntriesInRangeParams {
  /** The first work date in the span, inclusive. */
  readonly from: string;
  /** The last work date in the span, inclusive. */
  readonly to: string;
  /** One timekeeper's own record; omitted, the span covers every timekeeper in the firm. */
  readonly timekeeperUserId?: UserId;
  /** One matter inside the span, for a caller narrowing a period read to a file. */
  readonly matterId?: MatterId;
  /** One status inside the span. Omitted means every status, as the per-matter read means it. */
  readonly status?: TimeEntryStatus;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listTimeEntriesInRange(
  database: SqlDatabase,
  params: ListTimeEntriesInRangeParams,
): Promise<Page<TimeEntryRecordItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const conditions = ["time_entry.work_date >= ?", "time_entry.work_date <= ?"];
  const bindings: unknown[] = [params.from, params.to];
  if (params.timekeeperUserId !== undefined) {
    conditions.push("time_entry.timekeeper_user_id = ?");
    bindings.push(params.timekeeperUserId);
  }
  if (params.matterId !== undefined) {
    conditions.push("time_entry.matter_id = ?");
    bindings.push(params.matterId);
  }
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
      `SELECT ${TIME_ENTRY_RECORD_COLUMNS}
         FROM ${TIME_ENTRY_TABLE} AS time_entry
         ${TIME_ENTRY_RECORD_JOINS}
        WHERE ${conditions.join(" AND ")}
        ORDER BY time_entry.work_date DESC, time_entry.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<TimeEntryRecordRowRaw>();

  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    // Minted over the SORT key, as the per-matter read mints it: assemblePage mints over created_at,
    // which is the right key only for a read ordered by it.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.work_date, last.id) : null,
    data: rows.map(toTimeEntryRecordItem),
  };
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

// The per-matter row keeps its historical name; it is the same record shape every listing serves.
export type MatterTimeEntry = TimeEntryRecordItem;

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
      `SELECT ${TIME_ENTRY_RECORD_COLUMNS}
         FROM ${TIME_ENTRY_TABLE} AS time_entry
         ${TIME_ENTRY_RECORD_JOINS}
        WHERE ${conditions.join(" AND ")}
        ORDER BY time_entry.work_date DESC, time_entry.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<TimeEntryRecordRowRaw>();

  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    // The cursor is minted over the SORT key, not created_at — assemblePage mints over created_at,
    // which is the right key only for a read ordered by it.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.work_date, last.id) : null,
    data: rows.map(toTimeEntryRecordItem),
  };
}
