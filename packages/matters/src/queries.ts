import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_TABLE, type MatterStatus } from "./matter-statements.ts";

// List queries return the uniform cursor-paginated envelope (api.md: cursor-based, never offset).
// The cursor is an opaque continuation over the (created_at, id) sort key — stable under concurrent
// inserts, where offset would double-show or skip rows.
const DEFAULT_PAGE_SIZE = 50;

export interface Page<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

interface SortCursor {
  readonly createdAt: string;
  readonly id: string;
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ c: createdAt, i: id }));
}

function decodeCursor(cursor: string | undefined): SortCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; i?: unknown };
    if (typeof parsed.c === "string" && typeof parsed.i === "string") {
      return { createdAt: parsed.c, id: parsed.i };
    }
  } catch {
    // A malformed/tampered cursor reveals nothing and is treated as the first page.
  }
  return undefined;
}

// The (created_at, id) keyset predicate: rows strictly "after" the cursor in DESC order.
function appendCursorPredicate(
  conditions: string[],
  bindings: unknown[],
  cursor: SortCursor | undefined,
): void {
  if (cursor === undefined) return;
  conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
  bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
}

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
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (filters.status !== undefined) {
    conditions.push("status = ?");
    bindings.push(filters.status);
  } else {
    // The main list is the working caseload — unnumbered prospectives live in the consultations view.
    conditions.push("status IN ('open', 'closed')");
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
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(toMatterListItem),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
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
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map((row) => ({
      id: row.id,
      title: row.title,
      matterNumber: row.matter_number,
      createdAt: row.created_at,
      isStale: row.created_at <= threshold,
    })),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}
