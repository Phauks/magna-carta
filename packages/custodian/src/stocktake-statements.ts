import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyItemId,
  CustodyLocationId,
  CustodyPacketId,
  CustodyStocktakeId,
  CustodyStocktakeSightingId,
  UserId,
} from "@magna-carta/identifiers/types";
import { CUSTODY_PACKET_TABLE } from "./packet-statements.ts";
import type { CustodyPacketStatus, CustodySightingKind, CustodyStocktakeStatus } from "./types.ts";

// The stocktake's own statements. Two tables and no others: a stocktake writes NOTHING to
// custody_packet, custody_item, or custody_movement, which is what makes it observe-only rather than
// merely well-behaved. `test/purity.test.ts` scans this file for exactly that, so a future call site
// that reaches for a register write fails at review rather than at a firm's shelf.
//
// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_STOCKTAKE_TABLE = "custody_stocktake";
export const CUSTODY_STOCKTAKE_SIGHTING_TABLE = "custody_stocktake_sighting";

export interface CustodyStocktakeRow {
  readonly id: CustodyStocktakeId;
  readonly name: string;
  readonly scope_location_id: CustodyLocationId | null;
  readonly status: CustodyStocktakeStatus;
  readonly opened_at: string;
  readonly opened_by_user_id: UserId | null;
  readonly closed_at: string | null;
  readonly closed_by_user_id: UserId | null;
  readonly matched_count: number | null;
  readonly missing_count: number | null;
  readonly misplaced_count: number | null;
  readonly unexpected_count: number | null;
  readonly unregistered_count: number | null;
  readonly note: string | null;
}

const STOCKTAKE_COLUMNS =
  "id, name, scope_location_id, status, opened_at, opened_by_user_id, closed_at, closed_by_user_id, matched_count, missing_count, misplaced_count, unexpected_count, unregistered_count, note";

export interface InsertCustodyStocktakeRow {
  readonly id: CustodyStocktakeId;
  readonly name: string;
  readonly scopeLocationId: CustodyLocationId | null;
  readonly openedAt: string;
  readonly openedByUserId: UserId | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export function insertCustodyStocktakeStatement(
  database: SqlDatabase,
  row: InsertCustodyStocktakeRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_STOCKTAKE_TABLE} (id, name, scope_location_id, status, opened_at, opened_by_user_id, note, created_at, updated_at) VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.name,
      row.scopeLocationId,
      row.openedAt,
      row.openedByUserId,
      row.note,
      row.createdAt,
    );
}

export interface CloseCustodyStocktakeCounts {
  readonly matched: number;
  readonly missing: number;
  readonly misplaced: number;
  readonly unexpected: number;
  readonly unregistered: number;
}

// Closes a count and freezes what it found, guarded on the status the caller observed. D1 has no
// interactive transaction, so the guard rides the write: a second close that arrives after the first
// matches zero rows, and the service reads the row back to tell the caller which one won rather than
// reporting a close that never happened.
//
// An abandoned count freezes no counts, so `counts` is null for one: the reconciliation of a
// half-finished walk is a safe full of originals nobody reached, and recording that as a finding
// would be the most alarming and most wrong thing this subsystem could tell a firm.
// fitness:unguarded-write — the service reads the row back and tells the caller which close won, so the refusal is already surfaced
export function closeCustodyStocktakeStatement(
  database: SqlDatabase,
  id: CustodyStocktakeId,
  status: Exclude<CustodyStocktakeStatus, "open">,
  counts: CloseCustodyStocktakeCounts | null,
  closedByUserId: UserId | null,
  closedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_STOCKTAKE_TABLE}
          SET status = ?2,
              closed_at = ?3,
              closed_by_user_id = ?4,
              matched_count = ?5,
              missing_count = ?6,
              misplaced_count = ?7,
              unexpected_count = ?8,
              unregistered_count = ?9,
              updated_at = ?3
        WHERE id = ?1 AND status = 'open'`,
    )
    .bind(
      id,
      status,
      closedAt,
      closedByUserId,
      counts?.matched ?? null,
      counts?.missing ?? null,
      counts?.misplaced ?? null,
      counts?.unexpected ?? null,
      counts?.unregistered ?? null,
    );
}

export function selectCustodyStocktakeStatement(
  database: SqlDatabase,
  id: CustodyStocktakeId,
): SqlStatement {
  return database
    .prepare(`SELECT ${STOCKTAKE_COLUMNS} FROM ${CUSTODY_STOCKTAKE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyStocktake(
  database: SqlDatabase,
  id: CustodyStocktakeId,
): Promise<CustodyStocktakeRow | undefined> {
  const { results } = await selectCustodyStocktakeStatement(
    database,
    id,
  ).all<CustodyStocktakeRow>();
  return results[0];
}

// Counts newest first — a stocktake list is read to find the one being taken now, or the last one
// finished, never to page through a decade of them.
export function selectCustodyStocktakesStatement(
  database: SqlDatabase,
  status: CustodyStocktakeStatus | undefined,
  limit: number,
): SqlStatement {
  const where = status === undefined ? "" : "WHERE status = ?2";
  const statement = database.prepare(
    `SELECT ${STOCKTAKE_COLUMNS} FROM ${CUSTODY_STOCKTAKE_TABLE} ${where} ORDER BY opened_at DESC, id DESC LIMIT ?1`,
  );
  return status === undefined ? statement.bind(limit) : statement.bind(limit, status);
}

export interface CustodyStocktakePage {
  readonly rows: CustodyStocktakeRow[];
  /** True when the firm has counted more than the requested limit and the tail was not returned. */
  readonly capped: boolean;
}

/**
 * The counts, newest first, capped rather than cursor-paged.
 *
 * The cap is the honest shape here for the reason the ORDER BY comment gives: this list answers
 * "what is being counted now, and what did the last one find", and a caller walking a decade of
 * counts backwards is not a use this read has. What it was missing is the SIGNAL — a short answer
 * that looks identical to a complete one is the defect, not the shortness. One row past the limit is
 * fetched purely to tell the two apart.
 */
export async function readCustodyStocktakes(
  database: SqlDatabase,
  status: CustodyStocktakeStatus | undefined,
  limit: number,
): Promise<CustodyStocktakePage> {
  const { results } = await selectCustodyStocktakesStatement(
    database,
    status,
    limit + 1,
  ).all<CustodyStocktakeRow>();
  const capped = results.length > limit;
  return { rows: capped ? results.slice(0, limit) : results, capped };
}

export interface CustodyStocktakeSightingRow {
  readonly id: CustodyStocktakeSightingId;
  readonly stocktake_id: CustodyStocktakeId;
  readonly kind: CustodySightingKind;
  readonly packet_id: CustodyPacketId | null;
  readonly item_id: CustodyItemId | null;
  readonly location_id: CustodyLocationId | null;
  readonly expected_location_id: CustodyLocationId | null;
  readonly description: string | null;
  readonly observed_at: string;
  readonly recorded_at: string;
  readonly observed_by_user_id: UserId | null;
  readonly note: string | null;
}

const SIGHTING_COLUMNS =
  "id, stocktake_id, kind, packet_id, item_id, location_id, expected_location_id, description, observed_at, recorded_at, observed_by_user_id, note";

export interface InsertCustodyStocktakeSightingRow {
  readonly id: CustodyStocktakeSightingId;
  readonly stocktakeId: CustodyStocktakeId;
  readonly kind: CustodySightingKind;
  readonly packetId: CustodyPacketId | null;
  readonly itemId: CustodyItemId | null;
  readonly locationId: CustodyLocationId | null;
  readonly expectedLocationId: CustodyLocationId | null;
  readonly description: string | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly observedByUserId: UserId | null;
  readonly note: string | null;
}

// INSERT and nothing else. There is no update statement and no delete statement in this file for
// this table, and the database refuses both anyway: a sighting is a named person's assertion that
// they saw a specific original on a specific shelf on a specific day, and an assertion that can be
// edited afterwards is worth nothing in the dispute a custody register exists for.
export function insertCustodyStocktakeSightingStatement(
  database: SqlDatabase,
  row: InsertCustodyStocktakeSightingRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_STOCKTAKE_SIGHTING_TABLE} (${SIGHTING_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      row.id,
      row.stocktakeId,
      row.kind,
      row.packetId,
      row.itemId,
      row.locationId,
      row.expectedLocationId,
      row.description,
      row.observedAt,
      row.recordedAt,
      row.observedByUserId,
      row.note,
    );
}

// Which end of the walk a bounded read keeps.
//
// The order is a TOTAL one either way, and that is load-bearing: the reconciliation takes the LAST
// observation of each packet, so a tie decided at random would decide which of two contradictory
// sightings the report believes. `recorded_at` breaks a tie on the physical instant — two people
// counting the same shelf at "nine o'clock" are separated by when they actually typed it in — and the
// id breaks the remaining tie stably.
//
// Which end matters as soon as the LIMIT bites. `oldest-first` truncates away the newest rows, and
// the newest row is precisely the correction somebody recorded to supersede an earlier sighting — so
// the reconciliation reads `newest-first` and keeps the FIRST observation it sees of each packet,
// which makes the last-observation rule survive the cap instead of being defeated by it. The
// sighting list route reads `oldest-first`, because a person reading a count's log reads it forwards.
export type CustodyStocktakeSightingOrder = "oldest-first" | "newest-first";

export function selectCustodyStocktakeSightingsStatement(
  database: SqlDatabase,
  stocktakeId: CustodyStocktakeId,
  limit: number,
  order: CustodyStocktakeSightingOrder = "oldest-first",
): SqlStatement {
  const direction = order === "newest-first" ? "DESC" : "ASC";
  return database
    .prepare(
      `SELECT ${SIGHTING_COLUMNS} FROM ${CUSTODY_STOCKTAKE_SIGHTING_TABLE} WHERE stocktake_id = ?1 ` +
        `ORDER BY observed_at ${direction}, recorded_at ${direction}, id ${direction} LIMIT ?2`,
    )
    .bind(stocktakeId, limit);
}

export interface CustodyStocktakeSightingPage {
  readonly rows: CustodyStocktakeSightingRow[];
  /** True when the count recorded more observations than the requested limit and the tail is absent. */
  readonly capped: boolean;
}

// Reads one row past the limit purely to learn whether there was one. The extra row is discarded;
// what it buys is the difference between "the count observed exactly this much" and "the count
// observed more and the rest of the answer is missing" — which a caller cannot otherwise tell, and
// which matters here because a truncated count reads as a complete count that found fewer things.
export async function readCustodyStocktakeSightings(
  database: SqlDatabase,
  stocktakeId: CustodyStocktakeId,
  limit: number,
  order: CustodyStocktakeSightingOrder = "oldest-first",
): Promise<CustodyStocktakeSightingPage> {
  const { results } = await selectCustodyStocktakeSightingsStatement(
    database,
    stocktakeId,
    limit + 1,
    order,
  ).all<CustodyStocktakeSightingRow>();
  const capped = results.length > limit;
  return { rows: capped ? results.slice(0, limit) : results, capped };
}

export interface CustodyExpectedPacketRow {
  readonly id: CustodyPacketId;
  readonly custody_number: string;
  readonly name: string;
  readonly status: CustodyPacketStatus;
  readonly current_location_id: CustodyLocationId | null;
}

// What the register says should be on the shelves in scope. Read ONCE per reconciliation and joined
// against the sightings in memory — the alternative, a per-packet lookup, is the N+1 this subsystem
// is most likely to grow, and the whole register is the widest a stocktake ever gets.
//
// Only `held` packets are expected: a checked-out original is at a completion meeting, and a released
// or destroyed one left the firm. Counting either as expected would report a safe full of missing
// property every time somebody took a deed out for the afternoon.
export function selectCustodyExpectedPacketsStatement(
  database: SqlDatabase,
  locationIds: readonly CustodyLocationId[] | undefined,
  limit: number,
): SqlStatement {
  if (locationIds === undefined) {
    return database
      .prepare(
        `SELECT id, custody_number, name, status, current_location_id FROM ${CUSTODY_PACKET_TABLE}
          WHERE status = 'held' AND current_location_id IS NOT NULL
          ORDER BY custody_number ASC, id ASC LIMIT ?1`,
      )
      .bind(limit);
  }
  if (locationIds.length === 0) {
    // An empty scope expects nothing. Said explicitly, because an empty IN () is a syntax error in
    // SQLite and a silently dropped filter would expect the whole register instead — which would
    // report every packet the firm holds as missing from a count of one empty shelf.
    return database
      .prepare(
        `SELECT id, custody_number, name, status, current_location_id FROM ${CUSTODY_PACKET_TABLE} WHERE 1 = 0 LIMIT ?1`,
      )
      .bind(limit);
  }
  const placeholders = locationIds.map((_, index) => `?${index + 2}`).join(", ");
  return database
    .prepare(
      `SELECT id, custody_number, name, status, current_location_id FROM ${CUSTODY_PACKET_TABLE}
        WHERE status = 'held' AND current_location_id IN (${placeholders})
        ORDER BY custody_number ASC, id ASC LIMIT ?1`,
    )
    .bind(limit, ...locationIds);
}

export async function readCustodyExpectedPackets(
  database: SqlDatabase,
  locationIds: readonly CustodyLocationId[] | undefined,
  limit: number,
): Promise<CustodyExpectedPacketRow[]> {
  const { results } = await selectCustodyExpectedPacketsStatement(
    database,
    locationIds,
    limit,
  ).all<CustodyExpectedPacketRow>();
  return results;
}

// The register's current word on the packets a count actually sighted — read in one pass keyed by
// the handles the sightings named, so a sighting of something outside the counted scope still
// resolves without a second query per row.
export function selectCustodyPacketsByIdStatement(
  database: SqlDatabase,
  packetIds: readonly CustodyPacketId[],
): SqlStatement {
  const placeholders = packetIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT id, custody_number, name, status, current_location_id FROM ${CUSTODY_PACKET_TABLE} WHERE id IN (${placeholders})`,
    )
    .bind(...packetIds);
}

// How many handles one `IN (...)` may carry. SQLite caps bound parameters per statement, and a count
// of the whole register can name thousands of packets, so the read is chunked rather than composed
// into one statement that would fail at exactly the size that matters. Well under any dialect's cap,
// and a handful of indexed lookups is still nothing beside the per-packet query this replaces.
const MAX_PACKET_HANDLES_PER_READ = 200;

export async function readCustodyPacketsById(
  database: SqlDatabase,
  packetIds: readonly CustodyPacketId[],
): Promise<CustodyExpectedPacketRow[]> {
  const rows: CustodyExpectedPacketRow[] = [];
  for (let start = 0; start < packetIds.length; start += MAX_PACKET_HANDLES_PER_READ) {
    const chunk = packetIds.slice(start, start + MAX_PACKET_HANDLES_PER_READ);
    const { results } = await selectCustodyPacketsByIdStatement(
      database,
      chunk,
    ).all<CustodyExpectedPacketRow>();
    rows.push(...results);
  }
  return rows;
}
