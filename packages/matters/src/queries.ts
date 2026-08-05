import {
  appendCursorPredicate,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_TABLE, type MatterStatus } from "./matter-statements.ts";

// List queries return the uniform cursor-paginated envelope (cursor-based, never offset): the cursor
// is an opaque continuation over the (created_at, id) sort key — stable under concurrent inserts,
// where offset would double-show or skip rows. The keyset toolkit lives in
// @magna-carta/data-access/cursor-pagination.
export type { Page };

const MATTER_LIST_COLUMNS =
  "id, title, status, matter_type_id, location_id, responsible_member_id, client_display_name, matter_number, created_at";

export interface ListMattersFilters {
  readonly status?: MatterStatus;
  readonly matterTypeId?: MatterTypeId;
  readonly locationId?: LocationId;
  readonly responsibleMemberId?: UserId;
  readonly search?: string;
}

export function listMattersStatement(
  database: SqlDatabase,
  filters: ListMattersFilters,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  // A system matter is platform-owned plumbing, not a client engagement: it holds the scans of
  // originals kept for people who have no matter, and it must never appear in a caseload list, a
  // report, a conflicts corpus, or a bill. Excluded here rather than filtered by every caller.
  const conditions: string[] = ["system_key IS NULL"];
  const bindings: unknown[] = [];
  if (filters.status !== undefined) {
    conditions.push("status = ?");
    bindings.push(filters.status);
  } else {
    // The main list is the working caseload — unnumbered prospectives live in the consultations view.
    // Stated as a range exclusion (not status IN ('open','closed')) so the planner satisfies the
    // (created_at, id) keyset sort straight from matter_created_at_id_index: an equality/IN on status
    // would instead drive the status index and force a materialize-and-sort temporary B-tree. status
    // is one of exactly three values (the matter_status_check constraint), so this is equivalent.
    conditions.push("status != 'prospective'");
  }
  if (filters.matterTypeId !== undefined) {
    conditions.push("matter_type_id = ?");
    bindings.push(filters.matterTypeId);
  }
  if (filters.locationId !== undefined) {
    conditions.push("location_id = ?");
    bindings.push(filters.locationId);
  }
  if (filters.responsibleMemberId !== undefined) {
    conditions.push("responsible_member_id = ?");
    bindings.push(filters.responsibleMemberId);
  }
  if (filters.search !== undefined && filters.search.length > 0) {
    conditions.push("(title LIKE ? OR matter_number LIKE ? OR client_display_name LIKE ?)");
    const term = `%${filters.search}%`;
    bindings.push(term, term, term);
  }
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${MATTER_LIST_COLUMNS} FROM ${MATTER_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

interface MatterRowRaw {
  id: MatterId;
  title: string;
  status: MatterStatus;
  matter_type_id: MatterTypeId | null;
  location_id: LocationId | null;
  responsible_member_id: UserId;
  client_display_name: string | null;
  matter_number: string | null;
  created_at: string;
}

export interface MatterListItem {
  readonly id: MatterId;
  readonly title: string;
  readonly status: MatterStatus;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly responsibleMemberId: UserId;
  readonly clientDisplayName: string | null;
  readonly matterNumber: string | null;
  readonly createdAt: string;
}

function toMatterListItem(row: MatterRowRaw): MatterListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    matterTypeId: row.matter_type_id,
    locationId: row.location_id,
    responsibleMemberId: row.responsible_member_id,
    clientDisplayName: row.client_display_name,
    matterNumber: row.matter_number,
    createdAt: row.created_at,
  };
}

export interface ListMattersParams extends ListMattersFilters {
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listMatters(
  database: SqlDatabase,
  params: ListMattersParams,
): Promise<Page<MatterListItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listMattersStatement(
    database,
    params,
    decodeCursor(params.cursor),
    pageSize + 1, // one extra row tells us another page exists
  ).all<MatterRowRaw>();
  return assemblePage(results, pageSize, toMatterListItem);
}

// Hydrate a known set of matter handles in one primary-key walk. The caller has already decided WHICH
// matters it is reporting (from a suggestion ranking, a recent-filing list, an access filter) and only
// needs their display fields — so this deliberately takes ids and applies no filter of its own beyond
// the system-matter exclusion every caseload read shares. One statement, never one per id.
export async function readMattersByIds(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<MatterListItem[]> {
  if (matterIds.length === 0) return [];
  const placeholders = matterIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${MATTER_LIST_COLUMNS} FROM ${MATTER_TABLE} WHERE id IN (${placeholders}) AND system_key IS NULL`,
    )
    .bind(...matterIds)
    .all<MatterRowRaw>();
  return results.map(toMatterListItem);
}

// Matters whose number is EXACTLY one of these strings. The caller extracts number-shaped candidates
// from free text (an email subject line, a document header) and this decides which are real: an exact
// match on the unique matter_number index, so a candidate that is not a number simply matches nothing.
// Deliberately not the LIKE search listMatters offers — a substring match on a number would propose a
// matter because the subject contained a year.
export async function findMattersByNumbers(
  database: SqlDatabase,
  matterNumbers: readonly string[],
): Promise<MatterListItem[]> {
  if (matterNumbers.length === 0) return [];
  const placeholders = matterNumbers.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${MATTER_LIST_COLUMNS} FROM ${MATTER_TABLE} WHERE matter_number IN (${placeholders}) AND system_key IS NULL`,
    )
    .bind(...matterNumbers)
    .all<MatterRowRaw>();
  return results.map(toMatterListItem);
}

export function listConsultationsStatement(
  database: SqlDatabase,
  responsibleMemberId: UserId,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = ["status = 'prospective'", "responsible_member_id = ?"];
  const bindings: unknown[] = [responsibleMemberId];
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT id, title, matter_number, created_at FROM ${MATTER_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export interface ConsultationItem {
  readonly id: MatterId;
  readonly title: string;
  readonly matterNumber: string | null;
  readonly createdAt: string;
  readonly isStale: boolean;
}

export interface ListConsultationsParams {
  readonly responsibleMemberId: UserId;
  readonly now: string; // ISO instant — the staleness reference (the service reads no clock)
  readonly staleAgeDays: number;
  readonly cursor?: string;
  readonly pageSize?: number;
}

const MS_PER_DAY = 86_400_000;

export interface MatterCounts {
  readonly total: number;
  readonly prospective: number;
  readonly open: number;
  readonly closed: number;
}

// Per-firm matter counts, grouped by lifecycle status. An unexpected status still adds to total.
export async function readMatterCounts(database: SqlDatabase): Promise<MatterCounts> {
  const { results } = await database
    .prepare(`SELECT status, COUNT(*) AS c FROM ${MATTER_TABLE} GROUP BY status`)
    .all<{ status: string; c: number }>();
  const counts = { total: 0, prospective: 0, open: 0, closed: 0 };
  for (const row of results) {
    counts.total += row.c;
    if (row.status === "prospective" || row.status === "open" || row.status === "closed") {
      counts[row.status] += row.c;
    }
  }
  return counts;
}

export async function listConsultations(
  database: SqlDatabase,
  params: ListConsultationsParams,
): Promise<Page<ConsultationItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  // A consultation is stale once it has sat for staleAgeDays — created at or before the threshold.
  const threshold = new Date(
    new Date(params.now).getTime() - params.staleAgeDays * MS_PER_DAY,
  ).toISOString();
  const { results } = await listConsultationsStatement(
    database,
    params.responsibleMemberId,
    decodeCursor(params.cursor),
    pageSize + 1,
  ).all<{ id: MatterId; title: string; matter_number: string | null; created_at: string }>();
  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    title: row.title,
    matterNumber: row.matter_number,
    createdAt: row.created_at,
    isStale: row.created_at <= threshold,
  }));
}
