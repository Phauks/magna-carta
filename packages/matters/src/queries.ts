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
import { MATTER_TYPE_TABLE } from "./matter-type-statements.ts";

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

export interface MatterFilingTarget {
  readonly id: MatterId;
  readonly status: MatterStatus;
  // A platform-owned row that exists to satisfy a structural requirement rather than to hold a client
  // engagement. Reported rather than filtered out, because a caller deciding whether it may place
  // something on a matter has to tell "this matter is not a legitimate target" apart from "this
  // matter does not exist" — the two justify different answers and only one of them is a mistake
  // worth surfacing.
  readonly systemOwned: boolean;
}

// The narrow read a caller makes before placing something on a matter it did not pick itself: is this
// matter real, is it open, and is it a client matter at all. One primary-key walk over a bounded id
// set, no display fields — a placement decision has no business reading a client's name.
export async function readMatterFilingTargets(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<MatterFilingTarget[]> {
  if (matterIds.length === 0) return [];
  const placeholders = matterIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(`SELECT id, status, system_key FROM ${MATTER_TABLE} WHERE id IN (${placeholders})`)
    .bind(...matterIds)
    .all<{ id: MatterId; status: MatterStatus; system_key: string | null }>();
  return results.map((row) => ({
    id: row.id,
    status: row.status,
    systemOwned: row.system_key !== null,
  }));
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

export interface MatterTypeCounts {
  // Null when the matter carries no type: those matters still count, as their own row, because a
  // rollup that dropped them would report fewer matters than the firm has.
  readonly matterTypeName: string | null;
  readonly prospective: number;
  readonly open: number;
  readonly closed: number;
  readonly total: number;
}

// Per-firm matter counts grouped by the firm's own matter-type catalog. System matters are
// platform-owned plumbing and are excluded, the same rule the caseload list applies. Rows arrive
// largest practice first so the reader sees where the firm's work is without re-sorting.
export async function readMatterCountsByType(
  database: SqlDatabase,
): Promise<readonly MatterTypeCounts[]> {
  const { results } = await database
    .prepare(
      `SELECT matter_type.name AS type_name, ${MATTER_TABLE}.status AS status, COUNT(*) AS c FROM ${MATTER_TABLE} LEFT JOIN ${MATTER_TYPE_TABLE} AS matter_type ON matter_type.id = ${MATTER_TABLE}.matter_type_id WHERE ${MATTER_TABLE}.system_key IS NULL GROUP BY matter_type.name, ${MATTER_TABLE}.status`,
    )
    .all<{ type_name: string | null; status: string; c: number }>();
  const byName = new Map<string | null, { prospective: number; open: number; closed: number }>();
  for (const row of results) {
    const bucket = byName.get(row.type_name) ?? { prospective: 0, open: 0, closed: 0 };
    if (row.status === "prospective" || row.status === "open" || row.status === "closed") {
      bucket[row.status] += row.c;
    }
    byName.set(row.type_name, bucket);
  }
  return [...byName.entries()]
    .map(([matterTypeName, bucket]) => ({
      matterTypeName,
      ...bucket,
      total: bucket.prospective + bucket.open + bucket.closed,
    }))
    .sort((a, b) => b.total - a.total || (a.matterTypeName ?? "").localeCompare(b.matterTypeName ?? ""));
}

export interface MatterLocationCount {
  readonly locationId: LocationId | null; // null: the matter names no location
  readonly matters: number;
}

// Per-firm matter counts grouped by location, system matters excluded as above. Locations are
// identified by id so the caller can join names from the location domain's own read.
export async function readMatterCountsByLocation(
  database: SqlDatabase,
): Promise<readonly MatterLocationCount[]> {
  const { results } = await database
    .prepare(
      `SELECT location_id, COUNT(*) AS c FROM ${MATTER_TABLE} WHERE system_key IS NULL GROUP BY location_id`,
    )
    .all<{ location_id: LocationId | null; c: number }>();
  return results.map((row) => ({ locationId: row.location_id, matters: row.c }));
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
