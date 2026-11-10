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
import type { MatterNarrowing } from "./matter-narrowing.ts";
import { MATTER_TABLE, type MatterStatus } from "./matter-statements.ts";
import { MATTER_TYPE_TABLE } from "./matter-type-statements.ts";

// List queries return the uniform cursor-paginated envelope (cursor-based, never offset): the cursor
// is an opaque continuation over the (created_at, id) sort key — stable under concurrent inserts,
// where offset would double-show or skip rows. The keyset toolkit lives in
// @magna-carta/data-access/cursor-pagination.
export type { Page };

const MATTER_LIST_COLUMNS =
  "id, title, status, matter_type_id, location_id, responsible_member_id, client_display_name, matter_number, consultation_number, intake_number, created_at";

export interface ListMattersFilters {
  readonly status?: MatterStatus;
  // Several statuses at once, for a reader that spans rungs (the intake desk lists intakes and
  // consultations together). Ignored when `status` names one.
  readonly statuses?: readonly MatterStatus[];
  readonly matterTypeId?: MatterTypeId;
  readonly locationId?: LocationId;
  readonly responsibleMemberId?: UserId;
  readonly search?: string;
  // Sets of matters the reader chose to look inside (a member's own, one client's), each composed
  // as one more condition. See matter-narrowing.ts.
  readonly narrowings?: readonly MatterNarrowing[];
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
  } else if (filters.statuses !== undefined && filters.statuses.length > 0) {
    conditions.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
    bindings.push(...filters.statuses);
  } else {
    // The main list is the working caseload — the numbered matters. Intakes live on the intake desk
    // and unnumbered consultations in the consultations view. Stated as exclusions rather than
    // status IN ('open','hold','closed') so the planner satisfies the (created_at, id) keyset sort
    // straight from matter_created_at_id_index: an equality/IN on status would instead drive the
    // status index and force a materialize-and-sort temporary B-tree. status is one of exactly five
    // values (the matter_status_check constraint), so this is equivalent. A matter on hold is a
    // numbered matter and stays on the docket, wearing its status.
    conditions.push("status != 'intake'", "status != 'consultation'");
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
    // Every number a matter has ever worn is searched, not only the newest: at each rung the number
    // drawn there is the ONLY one anyone has, and a file that has since moved on is still quoted by
    // the number it was filed under at the time. Leaving any of them out would make the number on
    // somebody's note the one thing that finds nothing.
    conditions.push(
      "(title LIKE ? OR matter_number LIKE ? OR consultation_number LIKE ? OR intake_number LIKE ? OR client_display_name LIKE ?)",
    );
    const term = `%${filters.search}%`;
    bindings.push(term, term, term, term, term);
  }
  for (const narrowing of filters.narrowings ?? []) {
    conditions.push(narrowing.fragmentFor(`${MATTER_TABLE}.id`));
    bindings.push(...narrowing.bindings);
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
  consultation_number: string | null;
  intake_number: string | null;
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
  // The tentative number a consultation carries. Kept beside the matter number rather than folded
  // into it: which of the two a reader is looking at changes what it means.
  readonly consultationNumber: string | null;
  // And the number the intake carried before either of them. Three columns rather than one, for the
  // same reason: a file that came the whole way answers to all three, and which one a reader is
  // looking at tells them which rung the record was on when it was written down.
  readonly intakeNumber: string | null;
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
    consultationNumber: row.consultation_number,
    intakeNumber: row.intake_number,
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
  const conditions = ["status = 'consultation'", "responsible_member_id = ?"];
  const bindings: unknown[] = [responsibleMemberId];
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT id, title, matter_number, consultation_number, created_at FROM ${MATTER_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export interface ConsultationItem {
  readonly id: MatterId;
  readonly title: string;
  readonly matterNumber: string | null;
  // Always present on a consultation created since the sequence existed — this is the number the
  // view is listed by.
  readonly consultationNumber: string | null;
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
  readonly intake: number;
  readonly consultation: number;
  readonly open: number;
  readonly hold: number;
  readonly closed: number;
}

// Per-firm matter counts, grouped by lifecycle status. An unexpected status still adds to total.
export async function readMatterCounts(database: SqlDatabase): Promise<MatterCounts> {
  const { results } = await database
    .prepare(`SELECT status, COUNT(*) AS c FROM ${MATTER_TABLE} GROUP BY status`)
    .all<{ status: string; c: number }>();
  const counts = { total: 0, intake: 0, consultation: 0, open: 0, hold: 0, closed: 0 };
  for (const row of results) {
    counts.total += row.c;
    if (isMatterStatus(row.status)) {
      counts[row.status] += row.c;
    }
  }
  return counts;
}

export interface MatterTypeCounts {
  // Null when the matter carries no type: those matters still count, as their own row, because a
  // rollup that dropped them would report fewer matters than the firm has.
  readonly matterTypeName: string | null;
  readonly intake: number;
  readonly consultation: number;
  readonly open: number;
  readonly hold: number;
  readonly closed: number;
  readonly total: number;
}

function isMatterStatus(value: string): value is MatterStatus {
  return (
    value === "intake" ||
    value === "consultation" ||
    value === "open" ||
    value === "hold" ||
    value === "closed"
  );
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
  const byName = new Map<
    string | null,
    { intake: number; consultation: number; open: number; hold: number; closed: number }
  >();
  for (const row of results) {
    const bucket = byName.get(row.type_name) ?? {
      intake: 0,
      consultation: 0,
      open: 0,
      hold: 0,
      closed: 0,
    };
    if (isMatterStatus(row.status)) bucket[row.status] += row.c;
    byName.set(row.type_name, bucket);
  }
  return [...byName.entries()]
    .map(([matterTypeName, bucket]) =>
      Object.assign({ matterTypeName }, bucket, {
        total: bucket.intake + bucket.consultation + bucket.open + bucket.hold + bucket.closed,
      }),
    )
    .sort(
      (a, b) => b.total - a.total || (a.matterTypeName ?? "").localeCompare(b.matterTypeName ?? ""),
    );
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
  ).all<{
    id: MatterId;
    title: string;
    matter_number: string | null;
    consultation_number: string | null;
    created_at: string;
  }>();
  return assemblePage(results, pageSize, (row) => ({
    id: row.id,
    title: row.title,
    matterNumber: row.matter_number,
    consultationNumber: row.consultation_number,
    createdAt: row.created_at,
    isStale: row.created_at <= threshold,
  }));
}
