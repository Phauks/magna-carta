import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyLocationId,
  CustodyPacketId,
  CustodyStocktakeId,
} from "@magna-carta/identifiers/types";
import { readCustodyLocationSubtreeIds } from "./location-statements.ts";
import {
  readCustodyExpectedPackets,
  readCustodyPacketsById,
  readCustodyStocktake,
  readCustodyStocktakeSightings,
  type CustodyExpectedPacketRow,
  type CustodyStocktakeRow,
  type CustodyStocktakeSightingRow,
} from "./stocktake-statements.ts";
import {
  proposedCustodyMovement,
  type CustodyMovementKind,
  type CustodyPacketStatus,
  type CustodyReconciliationOutcome,
  type CustodyStocktakeStatus,
} from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// THE RECONCILIATION IS A REPORT. It reads; it writes nothing at all — not a movement, not a packet
// row, not a status. Every corrective action it identifies is printed as a PROPOSAL a person may act
// on through the one movement write path in movement-service.ts, and the register stays exactly as it
// was until they do.
//
// That is not caution about an unbuilt feature. A count's whole value is the difference between what
// the register claims and what is physically on the shelf, and a count that wrote the register into
// agreement with itself would erase that difference at the moment of discovering it — leaving a
// ledger row asserting a move that nobody made, in a table whose only claim is that nobody can. The
// answer to a discrepancy is a person looking, deciding, and recording what they decided.
//
// Three joins, in memory, over two reads: what the register expected in scope, and what the counters
// actually recorded. Neither is re-read per row — the per-packet lookup is the N+1 this subsystem is
// most likely to grow, and the whole register is the widest a stocktake ever gets.

// A bound on both reads. A firm holds low thousands of packets; ten thousand is far past any real
// register and exists so a runaway scope truncates to an obviously-short answer rather than pulling
// an unbounded result set into a request handler.
const MAX_RECONCILIATION_ROWS = 10_000;

export interface CustodyReconciliationLine {
  readonly outcome: CustodyReconciliationOutcome;
  readonly packetId: CustodyPacketId | null;
  readonly custodyNumber: string | null;
  readonly packetName: string | null;
  readonly packetStatus: CustodyPacketStatus | null;
  // Where the register says it is. Null when the register expects it nowhere, or has never heard of
  // it at all.
  readonly expectedLocationId: CustodyLocationId | null;
  // Where a person says they saw it. Null on a `missing` line, which is precisely the line nobody
  // saw anything for.
  readonly sightedLocationId: CustodyLocationId | null;
  // What the observer wrote down. The only description an `unregistered` object has anywhere.
  readonly description: string | null;
  readonly observedAt: string | null;
  readonly observedByUserId: string | null;
  // The movement a person WOULD record to bring the register back into agreement with the shelf.
  // A suggestion printed on a report; nothing here records it, and `missing` deliberately proposes
  // nothing at all.
  readonly proposedMovementKind: CustodyMovementKind | null;
  readonly proposedToLocationId: CustodyLocationId | null;
}

export interface CustodyReconciliation {
  readonly stocktakeId: CustodyStocktakeId;
  readonly name: string;
  readonly status: CustodyStocktakeStatus;
  readonly scopeLocationId: CustodyLocationId | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  // Expected in scope, sighted where the register said. The count nobody has to act on.
  readonly matchedCount: number;
  readonly missing: readonly CustodyReconciliationLine[];
  readonly misplaced: readonly CustodyReconciliationLine[];
  readonly unexpected: readonly CustodyReconciliationLine[];
  readonly unregistered: readonly CustodyReconciliationLine[];
  // Frozen on the stocktake row when the count closed, and absent while it is open or if it was
  // abandoned. The lines above are recomputed against a register that keeps moving, so they answer
  // "what is different now"; these answer "what did the count find", which is the number a firm
  // reports and must not have drift under it afterwards. The two disagreeing is not a fault: it is
  // the register having been put right since.
  readonly frozenCounts: CustodyReconciliationCounts | null;
}

export interface CustodyReconciliationCounts {
  readonly matched: number;
  readonly missing: number;
  readonly misplaced: number;
  readonly unexpected: number;
  readonly unregistered: number;
}

export async function reconcileCustodyStocktake(
  database: SqlDatabase,
  stocktakeId: CustodyStocktakeId,
): Promise<CustodyReconciliation> {
  const stocktake = await readCustodyStocktake(database, stocktakeId);
  if (stocktake === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-stocktake",
      `no such custody stocktake: ${stocktakeId}`,
    );
  }
  return reconcileAgainstRegister(database, stocktake);
}

// The reconciliation over an already-loaded stocktake row. Split out so the close path can draw the
// counts it freezes from exactly the same computation the report shows, rather than from a second
// definition that would eventually disagree with it.
export async function reconcileAgainstRegister(
  database: SqlDatabase,
  stocktake: CustodyStocktakeRow,
): Promise<CustodyReconciliation> {
  // The scope is expanded ONCE, here, and passed down as a value list — the same discipline the
  // packet list read follows. A null scope is the whole register.
  const scopeLocationIds =
    stocktake.scope_location_id === null
      ? undefined
      : await readCustodyLocationSubtreeIds(database, stocktake.scope_location_id);

  const [expected, sightings] = await Promise.all([
    readCustodyExpectedPackets(database, scopeLocationIds, MAX_RECONCILIATION_ROWS),
    readCustodyStocktakeSightings(database, stocktake.id, MAX_RECONCILIATION_ROWS),
  ]);

  const inScope = scopeLocationIds === undefined ? undefined : new Set(scopeLocationIds);

  // A packet may be recorded more than once during a count — two people walk the same shelf, or one
  // corrects themselves by recording the later, truer observation. The LAST observation wins, by
  // observed_at then id, because the sighting read returns them in exactly that order and a later
  // look at the same object is the better evidence of where it is.
  const lastSightingByPacket = new Map<CustodyPacketId, CustodyStocktakeSightingRow>();
  const unregisteredSightings: CustodyStocktakeSightingRow[] = [];
  for (const sighting of sightings) {
    if (sighting.kind === "unregistered") {
      unregisteredSightings.push(sighting);
      continue;
    }
    if (sighting.packet_id === null) continue;
    lastSightingByPacket.set(sighting.packet_id, sighting);
  }

  const expectedById = new Map<CustodyPacketId, CustodyExpectedPacketRow>();
  for (const packet of expected) expectedById.set(packet.id, packet);

  // The register's current word on anything sighted that the expected set does not already cover —
  // a packet counted on a shelf the register believes is somewhere else entirely, or one it has
  // checked out. One read for all of them.
  const unresolvedPacketIds = [...lastSightingByPacket.keys()].filter(
    (packetId) => !expectedById.has(packetId),
  );
  const sightedOutsideScope = await readCustodyPacketsById(database, unresolvedPacketIds);
  const packetById = new Map(expectedById);
  for (const packet of sightedOutsideScope) packetById.set(packet.id, packet);

  const missing: CustodyReconciliationLine[] = [];
  const misplaced: CustodyReconciliationLine[] = [];
  const unexpected: CustodyReconciliationLine[] = [];
  let matchedCount = 0;

  // Pass one: everything the register expected on the shelves in scope.
  for (const packet of expected) {
    const sighting = lastSightingByPacket.get(packet.id);
    // Never counted, or explicitly looked for and not found — both are missing, and `not_found` is
    // recorded rather than inferred so an unfinished count stays distinguishable from a loss.
    if (sighting === undefined || sighting.kind === "not_found") {
      missing.push(lineFor("missing", packet, sighting));
      continue;
    }
    if (sighting.location_id === packet.current_location_id) {
      matchedCount += 1;
      continue;
    }
    misplaced.push(lineFor("misplaced", packet, sighting));
  }

  // Pass two: everything a person sighted that pass one did not already account for — either the
  // register expects it nowhere (checked out, released, destroyed, lost) or it expects it outside
  // the scope that was counted. Both are "this should not have been on this shelf".
  for (const [packetId, sighting] of lastSightingByPacket) {
    if (sighting.kind !== "sighted") continue;
    if (expectedById.has(packetId)) continue;
    const packet = packetById.get(packetId);
    if (
      packet !== undefined &&
      packet.status === "held" &&
      packet.current_location_id === sighting.location_id &&
      inScope !== undefined &&
      packet.current_location_id !== null &&
      !inScope.has(packet.current_location_id)
    ) {
      // Sighted exactly where the register says it is, on a shelf outside the counted scope. The
      // register and the shelf agree, so this is not a discrepancy — it is a counter who walked one
      // cabinet further than the scope named.
      matchedCount += 1;
      continue;
    }
    unexpected.push(lineFor("unexpected", packet, sighting));
  }

  const unregistered = unregisteredSightings.map((sighting) =>
    lineFor("unregistered", undefined, sighting),
  );

  return {
    stocktakeId: stocktake.id,
    name: stocktake.name,
    status: stocktake.status,
    scopeLocationId: stocktake.scope_location_id,
    openedAt: stocktake.opened_at,
    closedAt: stocktake.closed_at,
    matchedCount,
    missing,
    misplaced,
    unexpected,
    unregistered,
    frozenCounts: frozenCountsOf(stocktake),
  };
}

// The counts a close would freeze, drawn from a reconciliation rather than from a second count of
// the same rows — one definition, so the report and the frozen number can never disagree about what
// the same walk found.
export function countsOf(reconciliation: CustodyReconciliation): CustodyReconciliationCounts {
  return {
    matched: reconciliation.matchedCount,
    missing: reconciliation.missing.length,
    misplaced: reconciliation.misplaced.length,
    unexpected: reconciliation.unexpected.length,
    unregistered: reconciliation.unregistered.length,
  };
}

function frozenCountsOf(stocktake: CustodyStocktakeRow): CustodyReconciliationCounts | null {
  if (stocktake.matched_count === null) return null;
  return {
    matched: stocktake.matched_count,
    missing: stocktake.missing_count ?? 0,
    misplaced: stocktake.misplaced_count ?? 0,
    unexpected: stocktake.unexpected_count ?? 0,
    unregistered: stocktake.unregistered_count ?? 0,
  };
}

function lineFor(
  outcome: CustodyReconciliationOutcome,
  packet: CustodyExpectedPacketRow | undefined,
  sighting: CustodyStocktakeSightingRow | undefined,
): CustodyReconciliationLine {
  const proposedMovementKind = proposedCustodyMovement(outcome, packet?.status ?? null);
  return {
    outcome,
    packetId: packet?.id ?? sighting?.packet_id ?? null,
    custodyNumber: packet?.custody_number ?? null,
    packetName: packet?.name ?? null,
    packetStatus: packet?.status ?? null,
    // The location frozen on the sighting is preferred over the packet's current one: it is where
    // the register stood when a person looked, which is the fact the count established. The packet's
    // own column is the fallback for a line no sighting exists for.
    expectedLocationId: sighting?.expected_location_id ?? packet?.current_location_id ?? null,
    sightedLocationId: sighting?.kind === "sighted" ? sighting.location_id : null,
    description: sighting?.description ?? null,
    observedAt: sighting?.observed_at ?? null,
    observedByUserId: sighting?.observed_by_user_id ?? null,
    proposedMovementKind,
    // A proposal only moves property to where somebody says they actually saw it. There is no other
    // defensible destination: the register's own answer is the one the count just contradicted.
    proposedToLocationId: proposedMovementKind === null ? null : (sighting?.location_id ?? null),
  };
}
