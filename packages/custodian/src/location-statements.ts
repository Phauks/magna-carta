import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyLocationId, LocationId } from "@magna-carta/identifiers/types";
import { CUSTODY_ITEM_TABLE } from "./packet-statements.ts";
import type { CustodyLocationKind, CustodyLocationStatus } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_LOCATION_TABLE = "custody_location";
export const CUSTODY_PACKET_TABLE = "custody_packet";

export interface CustodyLocationRow {
  readonly id: CustodyLocationId;
  readonly name: string;
  readonly kind: CustodyLocationKind;
  readonly parent_location_id: CustodyLocationId | null;
  readonly firm_location_id: LocationId | null;
  readonly address: string | null;
  readonly status: CustodyLocationStatus;
  readonly notes: string | null;
}

const LOCATION_COLUMNS =
  "id, name, kind, parent_location_id, firm_location_id, address, status, notes";

export interface InsertCustodyLocationRow {
  readonly id: CustodyLocationId;
  readonly name: string;
  readonly kind: CustodyLocationKind;
  readonly parentLocationId: CustodyLocationId | null;
  readonly firmLocationId: LocationId | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export function insertCustodyLocationStatement(
  database: SqlDatabase,
  row: InsertCustodyLocationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_LOCATION_TABLE} (id, name, kind, parent_location_id, firm_location_id, address, status, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.name,
      row.kind,
      row.parentLocationId,
      row.firmLocationId,
      row.address,
      row.notes,
      row.createdAt,
    );
}

// Rename / re-parent / annotate. Every column is passed explicitly (the service resolves the patch
// against the loaded row first), so one statement serves all three edits.
export function updateCustodyLocationStatement(
  database: SqlDatabase,
  id: CustodyLocationId,
  fields: {
    readonly name: string;
    readonly parentLocationId: CustodyLocationId | null;
    readonly address: string | null;
    readonly notes: string | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_LOCATION_TABLE} SET name = ?2, parent_location_id = ?3, address = ?4, notes = ?5, updated_at = ?6 WHERE id = ?1`,
    )
    .bind(id, fields.name, fields.parentLocationId, fields.address, fields.notes, updatedAt);
}

export function closeCustodyLocationStatement(
  database: SqlDatabase,
  id: CustodyLocationId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_LOCATION_TABLE} SET status = 'closed', updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt);
}

export function selectCustodyLocationStatement(
  database: SqlDatabase,
  id: CustodyLocationId,
): SqlStatement {
  return database
    .prepare(`SELECT ${LOCATION_COLUMNS} FROM ${CUSTODY_LOCATION_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyLocation(
  database: SqlDatabase,
  id: CustodyLocationId,
): Promise<CustodyLocationRow | undefined> {
  const { results } = await selectCustodyLocationStatement(database, id).all<CustodyLocationRow>();
  return results[0];
}

// The whole tree, flat with parent ids. A firm's container tree is a few hundred nodes at the very
// outside — safes, shelves, and box positions — so reading it whole and letting the caller assemble
// it costs one indexed scan and avoids a per-node round trip. The subtree walk below is the read
// that has to stay bounded, not this one.
export function selectAllCustodyLocationsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT ${LOCATION_COLUMNS} FROM ${CUSTODY_LOCATION_TABLE} ORDER BY name ASC, id ASC`,
  );
}

// The walk's own bound, deeper than the write path's cap so a tree that predates a cap change is
// still fully readable. Without it a cycle introduced outside the write path (a hand-run SQL fix)
// would spin the recursion forever instead of returning a truncated, obviously-wrong answer.
const MAX_SUBTREE_WALK_DEPTH = 32;

// The transitive set of node ids at or below `rootId`, in tree order (parents before children).
// A recursive common table expression is the starting shape: it walks parent_location_id, which is
// indexed, and a real tree is shallow. The alternatives — a materialized path column or a closure
// table — are both additive to this same row and differ only in the index set, so the choice belongs
// to a measurement against the load-profile harness rather than to a guess made here.
export function selectCustodyLocationSubtreeStatement(
  database: SqlDatabase,
  rootId: CustodyLocationId,
): SqlStatement {
  return database
    .prepare(
      `WITH RECURSIVE subtree(id, depth) AS (
         SELECT id, 0 FROM ${CUSTODY_LOCATION_TABLE} WHERE id = ?1
         UNION ALL
         SELECT child.id, subtree.depth + 1
           FROM ${CUSTODY_LOCATION_TABLE} AS child
           JOIN subtree ON child.parent_location_id = subtree.id
          WHERE subtree.depth < ?2
       )
       SELECT id, depth FROM subtree ORDER BY depth ASC, id ASC`,
    )
    .bind(rootId, MAX_SUBTREE_WALK_DEPTH);
}

export async function readCustodyLocationSubtreeIds(
  database: SqlDatabase,
  rootId: CustodyLocationId,
): Promise<CustodyLocationId[]> {
  const { results } = await selectCustodyLocationSubtreeStatement(database, rootId).all<{
    id: CustodyLocationId;
  }>();
  return results.map((row) => row.id);
}

// How many packets are physically present at a node — the occupancy count the register reports and
// the close path refuses on. A checked-out packet has no current location, so it does not count:
// the shelf really is empty while the deed is at a completion meeting.
export function selectCustodyLocationOccupancyStatement(
  database: SqlDatabase,
  locationIds: readonly CustodyLocationId[],
): SqlStatement {
  const placeholders = locationIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT COUNT(*) AS occupancy FROM ${CUSTODY_PACKET_TABLE} WHERE current_location_id IN (${placeholders})`,
    )
    .bind(...locationIds);
}

export async function readCustodyLocationOccupancy(
  database: SqlDatabase,
  locationIds: readonly CustodyLocationId[],
): Promise<number> {
  if (locationIds.length === 0) return 0;
  const { results } = await selectCustodyLocationOccupancyStatement(database, locationIds).all<{
    occupancy: number;
  }>();
  return results[0]?.occupancy ?? 0;
}

// Items currently on a shelf, rolled up to the firm office the shelf's ROOT binds to — the
// firm-usage read. Only a root may carry firm_location_id (the schema check refuses a mid-tree
// claim), so a child inherits its office by walking up; the walk is bounded like the subtree read,
// and the one-row-per-node subquery keeps a hand-introduced cycle from counting an item twice.
// `held` is the only status that means "on the shelf now": an item checked out on its own leaves
// its packet's location intact, so the item's status must be asked too, while a packet that is out,
// released, destroyed, or lost carries no location and drops out of the join — the shelf really is
// empty. A NULL firm_location_id row collects everything held under an external root (a bank
// vault, an offsite vendor), which is deliberately not one of the firm's offices.
export function selectCustodyItemCountsByFirmLocationStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `WITH RECURSIVE office_tree(id, firm_location_id, depth) AS (
         SELECT id, firm_location_id, 0 FROM ${CUSTODY_LOCATION_TABLE} WHERE parent_location_id IS NULL
         UNION ALL
         SELECT child.id, office_tree.firm_location_id, office_tree.depth + 1
           FROM ${CUSTODY_LOCATION_TABLE} AS child
           JOIN office_tree ON child.parent_location_id = office_tree.id
          WHERE office_tree.depth < ?1
       )
       SELECT office_node.firm_location_id AS firm_location_id, COUNT(*) AS items
         FROM ${CUSTODY_ITEM_TABLE} AS item
         JOIN ${CUSTODY_PACKET_TABLE} AS packet ON packet.id = item.packet_id
         JOIN (SELECT id, MIN(firm_location_id) AS firm_location_id FROM office_tree GROUP BY id) AS office_node
           ON office_node.id = packet.current_location_id
        WHERE item.status = 'held' AND packet.status = 'held'
        GROUP BY office_node.firm_location_id`,
    )
    .bind(MAX_SUBTREE_WALK_DEPTH);
}
