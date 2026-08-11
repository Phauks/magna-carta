import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyItemId } from "@magna-carta/identifiers/types";

// The custody link — one nullable column on the asset row, and the two narrow reads behind it.
//
// WHO OWNS WHICH FACT, stated here because this is the only file in the register that touches
// Custodian's tables at all:
//
//   Where the object is, who has it, every movement it made ......... Custodian
//   Whether it may be destroyed or released; holds .................. Custodian
//   What it is worth, as of a date, on what basis ................... this register
//   Who holds an interest in it; the estate treatment ............... this register
//   What it IS ...................................................... both, independently
//
// The asset row copies NO location, NO status, and NO movement history — a detail view that wants
// them calls `readCustodyPlacementForAsset` and renders what Custodian says right now. Custodian
// copies no valuation back. The one fact that looks duplicated is not:
// `custody_item.declared_value_amount_minor` is what the object is worth as a thing in a safe (an
// insurance and risk number for the firm's own exposure) and a valuation is what the property is worth
// to the estate as of a date on a stated basis. A signed first edition has both and they are not the
// same number. Nothing syncs them and nothing derives one from the other — asserted by
// test/custody-link.test.ts, which scans this package's source in both directions.
//
// DIRECTION: the column is on the asset, so Custodian never grows a matter-scoped column and never
// learns what an estate is. The newer, narrower subsystem points at the older, broader one.

const CUSTODY_ITEM_TABLE = "custody_item";
const CUSTODY_PACKET_TABLE = "custody_packet";
const CUSTODY_LOCATION_TABLE = "custody_location";
const CUSTODY_HOLD_TABLE = "custody_hold";

// Does this custody item exist in this firm? The write path's whole check — the link asserts that the
// firm holds the physical original of a scheduled thing, and a handle naming nothing asserts that
// falsely. No firm predicate is needed or possible: the database IS the firm.
export async function custodyItemExists(
  database: SqlDatabase,
  custodyItemId: CustodyItemId,
): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM ${CUSTODY_ITEM_TABLE} WHERE id = ?1`)
    .bind(custodyItemId)
    .all<{ present: number }>();
  return results.length > 0;
}

// What Custodian says about the linked object RIGHT NOW. Every field here is Custodian's own and none
// of it is stored on the asset — which is what makes a stale answer impossible rather than unlikely.
export interface CustodyPlacement {
  readonly custodyItemId: CustodyItemId;
  readonly description: string;
  // Custodian's own status vocabulary, passed through unchanged. This register does not narrow it,
  // rename it, or decide what any value implies about the asset.
  readonly status: string;
  readonly custodyNumber: string;
  readonly packetStatus: string;
  readonly locationName: string | null;
  // Whether an unreleased hold applies to the item or to the packet holding it. A boolean and not the
  // hold's kind or reason: whether the thing may be released is Custodian's decision to make on
  // Custodian's own surface, and reproducing its reasoning here would be a second copy of a rule that
  // governs whether an original will can leave the building.
  readonly held: boolean;
}

// One read, one row. Joined rather than issued as three reads, because a detail view asking "where is
// the ring" should not cost a round trip per fact.
export async function readCustodyPlacementForAsset(
  database: SqlDatabase,
  custodyItemId: CustodyItemId,
): Promise<CustodyPlacement | undefined> {
  const { results } = await database
    .prepare(
      `SELECT item.id AS custody_item_id, item.description AS description, item.status AS status, ` +
        `packet.custody_number AS custody_number, packet.status AS packet_status, ` +
        `location.name AS location_name, ` +
        `EXISTS (SELECT 1 FROM ${CUSTODY_HOLD_TABLE} AS hold WHERE hold.released_at IS NULL ` +
        `AND (hold.item_id = item.id OR (hold.item_id IS NULL AND hold.packet_id = packet.id))) AS held ` +
        `FROM ${CUSTODY_ITEM_TABLE} AS item ` +
        `JOIN ${CUSTODY_PACKET_TABLE} AS packet ON packet.id = item.packet_id ` +
        `LEFT JOIN ${CUSTODY_LOCATION_TABLE} AS location ON location.id = packet.current_location_id ` +
        `WHERE item.id = ?1`,
    )
    .bind(custodyItemId)
    .all<{
      custody_item_id: CustodyItemId;
      description: string;
      status: string;
      custody_number: string;
      packet_status: string;
      location_name: string | null;
      held: number;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    custodyItemId: row.custody_item_id,
    description: row.description,
    status: row.status,
    custodyNumber: row.custody_number,
    packetStatus: row.packet_status,
    locationName: row.location_name,
    held: row.held !== 0,
  };
}

// The reverse question — "is this scheduled anywhere" — deliberately does not live here. A custody
// item does not know it is on an estate inventory, and whether that deserves a Custodian-side surface
// belongs to that area rather than to this one reaching across the boundary to build it.
