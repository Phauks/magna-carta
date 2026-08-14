import {
  appendCursorPredicate,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyLocationId, CustodyPacketId, MatterId } from "@magna-carta/identifiers/types";
import { readCustodyLocationSubtreeIds } from "./location-statements.ts";
import { CUSTODY_MOVEMENT_TABLE } from "./movement-statements.ts";
import { CUSTODY_OWNER_TABLE, CUSTODY_PACKET_TABLE } from "./packet-statements.ts";
import type { CustodyPacketStatus } from "./types.ts";

// The register's reads. Custodian is a small, deep, and OLD corpus — the opposite shape of every
// other subsystem here: a firm holds low thousands of packets with a handful of items each, but it
// holds them for decades, so the movement ledger is the only table that grows without bound and the
// register is routinely queried across twenty years of history. Volume is not the risk; unbounded
// history on a hot read is, which is why the ledger read is keyset-paginated from the start and the
// subtree filter is expanded once per request rather than per row.

export type { Page };

const PACKET_LIST_COLUMNS =
  "id, custody_number, name, status, current_location_id, matter_id, created_at";

export interface CustodyPacketListItem {
  readonly id: CustodyPacketId;
  readonly custodyNumber: string;
  readonly name: string;
  readonly status: CustodyPacketStatus;
  readonly currentLocationId: CustodyLocationId | null;
  readonly matterId: MatterId | null;
  readonly createdAt: string;
}

interface PacketRowRaw {
  id: CustodyPacketId;
  custody_number: string;
  name: string;
  status: CustodyPacketStatus;
  current_location_id: CustodyLocationId | null;
  matter_id: MatterId | null;
  created_at: string;
}

export interface ListCustodyPacketsFilters {
  readonly status?: CustodyPacketStatus;
  readonly ownerEntityId?: string;
  readonly matterId?: MatterId;
  // The whole subtree under this node, not just the node itself: "everything in the Reno safe" has
  // to include the boxes and positions inside it, which is the point of having a tree.
  readonly locationSubtreeId?: CustodyLocationId;
  readonly search?: string;
}

export function listCustodyPacketsStatement(
  database: SqlDatabase,
  filters: Omit<ListCustodyPacketsFilters, "locationSubtreeId"> & {
    readonly locationIds?: readonly CustodyLocationId[];
  },
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (filters.status !== undefined) {
    conditions.push("status = ?");
    bindings.push(filters.status);
  }
  if (filters.matterId !== undefined) {
    conditions.push("matter_id = ?");
    bindings.push(filters.matterId);
  }
  if (filters.ownerEntityId !== undefined) {
    // The register's primary filter — everything this firm holds for one person or organization.
    // Restricted to CURRENT owner links: a former owner's holdings are history, not a holding.
    conditions.push(
      `id IN (SELECT packet_id FROM ${CUSTODY_OWNER_TABLE} WHERE entity_id = ? AND effective_to IS NULL)`,
    );
    bindings.push(filters.ownerEntityId);
  }
  if (filters.locationIds !== undefined) {
    if (filters.locationIds.length === 0) {
      // An empty subtree matches nothing. Said explicitly, because an empty IN () is a syntax error
      // in SQLite and a silently dropped filter would return the whole register instead.
      conditions.push("1 = 0");
    } else {
      const placeholders = filters.locationIds.map(() => "?").join(", ");
      conditions.push(`current_location_id IN (${placeholders})`);
      bindings.push(...filters.locationIds);
    }
  }
  if (filters.search !== undefined && filters.search.length > 0) {
    conditions.push("(name LIKE ? OR custody_number LIKE ?)");
    const term = `%${filters.search}%`;
    bindings.push(term, term);
  }
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database
    .prepare(
      `SELECT ${PACKET_LIST_COLUMNS} FROM ${CUSTODY_PACKET_TABLE} ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export interface ListCustodyPacketsParams extends ListCustodyPacketsFilters {
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listCustodyPackets(
  database: SqlDatabase,
  params: ListCustodyPacketsParams,
): Promise<Page<CustodyPacketListItem>> {
  const limit = params.pageSize ?? DEFAULT_PAGE_SIZE;
  // The subtree is expanded ONCE, here, and passed down as a value list. Recomputing the recursive
  // walk per row is the N+1 this subsystem is most likely to grow, and expanding it at the top is
  // what keeps the list read a single indexed scan.
  const locationIds =
    params.locationSubtreeId === undefined
      ? undefined
      : await readCustodyLocationSubtreeIds(database, params.locationSubtreeId);
  const { results } = await listCustodyPacketsStatement(
    database,
    { ...params, locationIds },
    decodeCursor(params.cursor),
    limit + 1,
  ).all<PacketRowRaw>();
  return assemblePage(results, limit, (row) => ({
    id: row.id,
    custodyNumber: row.custody_number,
    name: row.name,
    status: row.status,
    currentLocationId: row.current_location_id,
    matterId: row.matter_id,
    createdAt: row.created_at,
  }));
}

export interface OverdueCustodyCheckout {
  readonly packetId: CustodyPacketId;
  readonly custodyNumber: string;
  readonly dueBackOn: string;
  readonly borrowerKind: string | null;
  readonly daysOverdue: number;
}

// The overdue check-out sweep — the operational signal a custody register exists to produce.
//
// "Still out" is read off the PACKET's status, not off the ledger: the derived status and the
// movement that set it commit in one batch, so the packet row is the authoritative answer to "is it
// out", and a packet that came back is not overdue however overdue its old check-out row once was.
// The ledger then supplies the due-back date from that packet's MOST RECENT check-out — most recent
// by occurred_at, because a back-dated correction to an old check-out must not resurrect its
// deadline over a newer one.
//
// The PACKET is therefore also the driving table, and the shape of this statement is what makes it
// so. "Out" is the selective fact here — a firm has tens of packets out against a ledger that grows
// without bound for as long as it holds them — so the sweep seeks those packets and asks each one for
// its latest check-out, one indexed seek per packet. Turned around, with the ledger outer and the
// packet joined to it, the planner's only usable predicate is `item_id IS NULL`; that matches every
// packet-scoped movement ever recorded, and the correlated subquery below then runs once per matched
// row. Same answer, and a cost that grows with the firm's whole history instead of with what is out.
//
// `kind` and `item_id` appear only inside that subquery for the same reason: a row it returns
// satisfies both by construction, so repeating them in the outer WHERE adds no filtering and gives
// the planner a second way in.
export function selectOverdueCustodyCheckoutsStatement(
  database: SqlDatabase,
  asOfDate: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT packet.id AS packet_id,
              packet.custody_number AS custody_number,
              movement.due_back_on AS due_back_on,
              movement.borrower_kind AS borrower_kind
         FROM ${CUSTODY_PACKET_TABLE} AS packet
         JOIN ${CUSTODY_MOVEMENT_TABLE} AS movement ON movement.id = (
                SELECT latest.id FROM ${CUSTODY_MOVEMENT_TABLE} AS latest
                 WHERE latest.packet_id = packet.id
                   AND latest.kind = 'checked_out'
                   AND latest.item_id IS NULL
                 ORDER BY latest.occurred_at DESC, latest.id DESC LIMIT 1
              )
        WHERE packet.status = 'out'
          AND movement.due_back_on IS NOT NULL
          AND movement.due_back_on < ?1
        ORDER BY movement.due_back_on ASC, packet.id ASC
        LIMIT ?2`,
    )
    .bind(asOfDate, limit);
}

const MILLISECONDS_PER_DAY = 86_400_000;

export async function readOverdueCustodyCheckouts(
  database: SqlDatabase,
  asOfDate: string,
  limit = DEFAULT_PAGE_SIZE,
): Promise<OverdueCustodyCheckout[]> {
  const { results } = await selectOverdueCustodyCheckoutsStatement(database, asOfDate, limit).all<{
    packet_id: CustodyPacketId;
    custody_number: string;
    due_back_on: string;
    borrower_kind: string | null;
  }>();
  const asOf = Date.parse(asOfDate);
  return results.map((row) => ({
    packetId: row.packet_id,
    custodyNumber: row.custody_number,
    dueBackOn: row.due_back_on,
    borrowerKind: row.borrower_kind,
    daysOverdue: Math.max(
      0,
      Math.floor((asOf - Date.parse(row.due_back_on)) / MILLISECONDS_PER_DAY),
    ),
  }));
}

// Coarse buckets for the overdue gauge. A firm-level count of how overdue its check-outs are is
// worth having in aggregate; the packet itself is never a telemetry dimension — a custody number is
// firm-defined, high-cardinality, and printed on a physical object a person can be identified by.
export function overdueBucket(daysOverdue: number): "0-7d" | "8-30d" | "31-90d" | "over-90d" {
  if (daysOverdue <= 7) return "0-7d";
  if (daysOverdue <= 30) return "8-30d";
  if (daysOverdue <= 90) return "31-90d";
  return "over-90d";
}
