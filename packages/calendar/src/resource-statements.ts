import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmResourceId, LocationId } from "@magna-carta/identifiers/types";
import type { FirmResourceKind } from "./types.ts";

// The firm's bookable things: rooms, vehicles, equipment. A catalog in the soft-deactivate
// discipline — a deactivated room keeps its history and takes no new bookings — with no matter
// anywhere in sight: a resource is the firm's, which is why none of these reads composes the
// visible-matter predicate.

export const FIRM_RESOURCE_TABLE = "firm_resource";

export interface FirmResourceRow {
  readonly id: FirmResourceId;
  readonly name: string;
  readonly kind: FirmResourceKind;
  readonly location_id: LocationId | null;
  readonly capacity: number | null;
  readonly notes: string | null;
  readonly active: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const RESOURCE_COLUMNS =
  "id, name, kind, location_id, capacity, notes, active, created_at, updated_at";

export function insertFirmResourceStatement(
  database: SqlDatabase,
  input: {
    readonly id: FirmResourceId;
    readonly name: string;
    readonly kind: FirmResourceKind;
    readonly locationId: LocationId | null;
    readonly capacity: number | null;
    readonly notes: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FIRM_RESOURCE_TABLE} (${RESOURCE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)`,
    )
    .bind(
      input.id,
      input.name,
      input.kind,
      input.locationId,
      input.capacity,
      input.notes,
      input.now,
    );
}

export function updateFirmResourceStatement(
  database: SqlDatabase,
  id: FirmResourceId,
  patch: {
    readonly name: string;
    readonly kind: FirmResourceKind;
    readonly locationId: LocationId | null;
    readonly capacity: number | null;
    readonly notes: string | null;
    readonly active: boolean;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FIRM_RESOURCE_TABLE} SET name = ?2, kind = ?3, location_id = ?4, capacity = ?5, ` +
        `notes = ?6, active = ?7, updated_at = ?8 WHERE id = ?1`,
    )
    .bind(
      id,
      patch.name,
      patch.kind,
      patch.locationId,
      patch.capacity,
      patch.notes,
      patch.active ? 1 : 0,
      updatedAt,
    );
}

export function selectFirmResourceStatement(
  database: SqlDatabase,
  id: FirmResourceId,
): SqlStatement {
  return database
    .prepare(`SELECT ${RESOURCE_COLUMNS} FROM ${FIRM_RESOURCE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readFirmResource(
  database: SqlDatabase,
  id: FirmResourceId,
): Promise<FirmResourceRow | undefined> {
  const { results } = await selectFirmResourceStatement(database, id).all<FirmResourceRow>();
  return results[0];
}

export function selectFirmResourceByNameStatement(
  database: SqlDatabase,
  name: string,
): SqlStatement {
  return database
    .prepare(`SELECT ${RESOURCE_COLUMNS} FROM ${FIRM_RESOURCE_TABLE} WHERE name = ?1`)
    .bind(name);
}

// The office zone a booking's time_zone is frozen from. Read at the write and stored on the booking
// row (the rate-snapshot idiom), so an office zone change never silently reinterprets an existing
// booking; null where the office predates the zone column or the resource has no office.
export function selectLocationTimeZoneStatement(
  database: SqlDatabase,
  locationId: LocationId,
): SqlStatement {
  return database.prepare("SELECT time_zone FROM location WHERE id = ?1").bind(locationId);
}

export interface FirmResourcePage {
  readonly rows: FirmResourceRow[];
  /** True when the firm's catalog holds more than one answer can carry — filter by kind or office. */
  readonly capped: boolean;
}

/**
 * The picker's catalog, by name, capped with a signal.
 *
 * Not cursor-paged, because the read exists to be complete: a picker is how a person finds the room
 * they mean, and half a catalog answers the wrong question. `capped` is what turns an
 * implausible-but-possible overflow into something a surface can act on rather than something it
 * cannot see.
 */
export async function readFirmResources(
  database: SqlDatabase,
  options: {
    readonly kind?: FirmResourceKind;
    readonly locationId?: LocationId;
    readonly includeInactive?: boolean;
    readonly limit?: number;
  } = {},
): Promise<FirmResourcePage> {
  const limit = options.limit ?? MAX_FIRM_RESOURCES;
  const { results } = await selectFirmResourcesStatement(database, {
    ...options,
    // One over the backstop as the has-more probe; it is never returned.
    limit: limit + 1,
  }).all<FirmResourceRow>();
  const capped = results.length > limit;
  return { capped, rows: capped ? results.slice(0, limit) : results };
}

export async function readLocationTimeZone(
  database: SqlDatabase,
  locationId: LocationId,
): Promise<string | null> {
  const { results } = await selectLocationTimeZoneStatement(database, locationId).all<{
    time_zone: string | null;
  }>();
  return results[0]?.time_zone ?? null;
}

/**
 * How many resources one picker answer can carry.
 *
 * A BACKSTOP, not a page size. The bound is the catalog itself: a firm has tens of bookable things —
 * rooms, vehicles, equipment it physically owns and a person configures one at a time — not
 * thousands, and the picker wants all of them so a person can choose. What the backstop was missing
 * is a way to say it had been reached: a picker silently short of a room is a picker that says the
 * room does not exist, which is worse than a picker that says "narrow this".
 */
export const MAX_FIRM_RESOURCES = 500;

// The picker's list: the whole catalog, filtered.
export function selectFirmResourcesStatement(
  database: SqlDatabase,
  options: {
    readonly kind?: FirmResourceKind;
    readonly locationId?: LocationId;
    readonly includeInactive?: boolean;
    readonly limit: number;
  },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.kind !== undefined) {
    conditions.push("kind = ?");
    bindings.push(options.kind);
  }
  if (options.locationId !== undefined) {
    conditions.push("location_id = ?");
    bindings.push(options.locationId);
  }
  if (options.includeInactive !== true) {
    conditions.push("active = 1");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")} ` : "";
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${RESOURCE_COLUMNS} FROM ${FIRM_RESOURCE_TABLE} ${where}ORDER BY name ASC LIMIT ?`,
    )
    .bind(...bindings);
}
