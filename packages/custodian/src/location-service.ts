import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustodyLocationId, LocationId } from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import {
  closeCustodyLocationStatement,
  insertCustodyLocationStatement,
  readCustodyLocation,
  readCustodyLocationOccupancy,
  readCustodyLocationSubtreeIds,
  updateCustodyLocationStatement,
  type CustodyLocationRow,
} from "./location-statements.ts";
import { MAX_CUSTODY_LOCATION_DEPTH, type CustodyLocationKind } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// The physical container tree. One recursive tree, rooted at a node that either binds a firm office
// or stands for an external site — a bank vault, an offsite records vendor, a co-trustee. Nesting is
// expressed here and only here: packets never contain packets, so there is one nesting mechanism
// rather than two.
//
// Cycle prevention is a write-path walk to the root plus a depth cap, not a trigger — the same shape
// the folder tree's constraints take, and it needs no new machinery. The services here return
// prepared effects the caller commits; nothing in this module holds a database binding or commits.

export type CustodyLocationServiceOptions = CustodyAuditContext;

export interface CreateCustodyLocationInput {
  readonly name: string;
  readonly kind: CustodyLocationKind;
  readonly parentLocationId?: CustodyLocationId | null;
  readonly firmLocationId?: LocationId | null;
  readonly address?: string | null;
  readonly notes?: string | null;
}

async function loadOrRefuse(
  database: SqlDatabase,
  id: CustodyLocationId,
): Promise<CustodyLocationRow> {
  const row = await readCustodyLocation(database, id);
  if (row === undefined) {
    throw new CustodyValidationError("custody-unknown-location", `no such custody location: ${id}`);
  }
  return row;
}

// How many nodes sit above this one. Walks parent_location_id to the root, refusing if it meets a
// node twice — which is how an existing cycle (introduced outside this write path) surfaces as a
// named refusal instead of an unbounded loop.
async function depthOf(database: SqlDatabase, id: CustodyLocationId): Promise<number> {
  const seen = new Set<string>([id]);
  let depth = 0;
  let cursor = (await loadOrRefuse(database, id)).parent_location_id;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new CustodyValidationError(
        "custody-location-cycle",
        "the custody location tree contains a cycle above this node",
      );
    }
    seen.add(cursor);
    depth += 1;
    cursor = (await loadOrRefuse(database, cursor)).parent_location_id;
  }
  return depth;
}

export async function createCustodyLocation(
  database: SqlDatabase,
  input: CreateCustodyLocationInput,
  options: CustodyLocationServiceOptions,
): Promise<{ locationId: CustodyLocationId; effect: EffectWrite }> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CustodyValidationError("custody-empty-name", "a custody location needs a name");
  }
  const parentLocationId = input.parentLocationId ?? null;
  if (parentLocationId !== null) {
    // A child inherits its office from the root, so only a root may name a firm office.
    if (input.firmLocationId != null) {
      throw new CustodyValidationError(
        "custody-invalid-movement",
        "only a root custody location may bind a firm office",
      );
    }
    const parentDepth = await depthOf(database, parentLocationId);
    if (parentDepth + 1 >= MAX_CUSTODY_LOCATION_DEPTH) {
      throw new CustodyValidationError(
        "custody-location-too-deep",
        `a custody location may not nest more than ${MAX_CUSTODY_LOCATION_DEPTH} levels deep`,
      );
    }
  }
  const locationId = newIdentifier("custodyLocation", options.randomSource);
  const now = options.clock.now();
  return {
    locationId,
    effect: {
      statements: [
        insertCustodyLocationStatement(database, {
          id: locationId,
          name,
          kind: input.kind,
          parentLocationId,
          firmLocationId: parentLocationId === null ? (input.firmLocationId ?? null) : null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          createdAt: now,
        }),
        custodyAuditStatement(database, options, "custodyLocation.created", locationId, {
          kind: input.kind,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateCustodyLocationInput {
  readonly name?: string;
  readonly parentLocationId?: CustodyLocationId | null;
  readonly address?: string | null;
  readonly notes?: string | null;
}

export async function updateCustodyLocation(
  database: SqlDatabase,
  locationId: CustodyLocationId,
  patch: UpdateCustodyLocationInput,
  options: CustodyLocationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadOrRefuse(database, locationId);
  const name = patch.name === undefined ? existing.name : patch.name.trim();
  if (name.length === 0) {
    throw new CustodyValidationError("custody-empty-name", "a custody location needs a name");
  }
  const parentLocationId =
    patch.parentLocationId === undefined ? existing.parent_location_id : patch.parentLocationId;

  if (parentLocationId !== existing.parent_location_id && parentLocationId !== null) {
    // A node re-parented into its own subtree would detach that whole branch from every root and
    // make the breadcrumb read walk forever. The subtree read is the cheapest way to see it: the
    // proposed parent is illegal exactly when it is already at or below the node being moved.
    const subtree = new Set<string>(await readCustodyLocationSubtreeIds(database, locationId));
    if (subtree.has(parentLocationId)) {
      throw new CustodyValidationError(
        "custody-location-cycle",
        "a custody location cannot be moved into its own subtree",
      );
    }
    const parentDepth = await depthOf(database, parentLocationId);
    if (parentDepth + 1 >= MAX_CUSTODY_LOCATION_DEPTH) {
      throw new CustodyValidationError(
        "custody-location-too-deep",
        `a custody location may not nest more than ${MAX_CUSTODY_LOCATION_DEPTH} levels deep`,
      );
    }
  }

  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateCustodyLocationStatement(
          database,
          locationId,
          {
            name,
            parentLocationId,
            address: patch.address === undefined ? existing.address : patch.address,
            notes: patch.notes === undefined ? existing.notes : patch.notes,
          },
          now,
        ),
        custodyAuditStatement(database, options, "custodyLocation.updated", locationId),
      ],
      outboxMessages: [],
    },
  };
}

// Closing is soft and refuses while the node or anything beneath it still physically holds a packet.
// The refusal is the point: a closed node with originals still in it is exactly the silent orphaning
// the register exists to prevent, and the firm has to move the contents somewhere it can name.
export async function closeCustodyLocation(
  database: SqlDatabase,
  locationId: CustodyLocationId,
  options: CustodyLocationServiceOptions,
): Promise<{ effect: EffectWrite }> {
  await loadOrRefuse(database, locationId);
  const subtreeIds = await readCustodyLocationSubtreeIds(database, locationId);
  const occupancy = await readCustodyLocationOccupancy(database, subtreeIds);
  if (occupancy > 0) {
    throw new CustodyValidationError(
      "custody-location-occupied",
      `this custody location still holds ${occupancy} packet(s) — move them before closing it`,
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        closeCustodyLocationStatement(database, locationId, now),
        custodyAuditStatement(database, options, "custodyLocation.closed", locationId),
      ],
      outboxMessages: [],
    },
  };
}

// The breadcrumb a packet detail renders: root first, the node itself last. Walks the same
// parent chain depthOf does, so a cycle surfaces as the same named refusal rather than a hang.
export async function readCustodyLocationPath(
  database: SqlDatabase,
  locationId: CustodyLocationId,
): Promise<CustodyLocationRow[]> {
  const path: CustodyLocationRow[] = [];
  const seen = new Set<string>();
  let cursor: CustodyLocationId | null = locationId;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new CustodyValidationError(
        "custody-location-cycle",
        "the custody location tree contains a cycle above this node",
      );
    }
    seen.add(cursor);
    const row: CustodyLocationRow = await loadOrRefuse(database, cursor);
    path.unshift(row);
    cursor = row.parent_location_id;
  }
  return path;
}
