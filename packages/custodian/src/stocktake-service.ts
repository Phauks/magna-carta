import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyLocationId,
  CustodyPacketId,
  CustodyStocktakeId,
  CustodyStocktakeSightingId,
} from "@magna-carta/identifiers/types";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { readCustodyLocation } from "./location-statements.ts";
import { readCustodyItem, readCustodyPacket } from "./packet-statements.ts";
import {
  CustodyIdempotencyConflictError,
  type CustodyIdempotencyContext,
} from "./packet-service.ts";
import {
  countsOf,
  reconcileAgainstRegister,
  type CustodyReconciliationCounts,
} from "./stocktake-reconciliation.ts";
import {
  closeCustodyStocktakeStatement,
  insertCustodyStocktakeSightingStatement,
  insertCustodyStocktakeStatement,
  readCustodyStocktake,
  type CustodyStocktakeRow,
} from "./stocktake-statements.ts";
import type { CustodySightingKind } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// Stocktake: the periodic walk of the shelves that answers whether the register is still true.
//
// THIS WHOLE MODULE IS OBSERVE-ONLY, AND THAT IS ITS DESIGN RATHER THAN ITS CURRENT SCOPE. It writes
// exactly two tables — the stocktake and its sightings — and never custody_packet, custody_item, or
// custody_movement. A count that corrected the register on the strength of its own findings would
// erase the difference it exists to surface, and would put a movement in an append-only ledger that
// no person asserted. The reconciliation names corrective movements as proposals; a person records
// each one through the one movement write path in movement-service.ts, or does not.
//
// Nothing here disposes of anything. Destruction and retention are not this module's business at any
// distance: a shelf coming up empty is an investigation, and a shelf holding something nobody
// expected is a question, and neither is a reason to end the firm's custody of a client's original.
//
// `test/purity.test.ts` scans these sources for a register write, so the boundary fails at review
// rather than at a firm's safe.

export interface CustodyStocktakeServiceOptions extends CustodyAuditContext {
  readonly randomSource?: RandomSource;
}

export interface OpenCustodyStocktakeInput {
  readonly name: string;
  // The branch of the container tree this count covers, including everything beneath it. Absent
  // means the whole register.
  readonly scopeLocationId?: CustodyLocationId | null;
  // When the count began in the physical world, if that is not now — the same back-dating a movement
  // supports, for the same reason: the walk and the typing are different events.
  readonly openedAt?: string;
  readonly note?: string | null;
}

export async function openCustodyStocktake(
  database: SqlDatabase,
  input: OpenCustodyStocktakeInput,
  options: CustodyStocktakeServiceOptions,
): Promise<{ stocktakeId: CustodyStocktakeId; effect: EffectWrite }> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CustodyValidationError("custody-empty-name", "a stocktake needs a name");
  }
  if (input.scopeLocationId != null) {
    const scope = await readCustodyLocation(database, input.scopeLocationId);
    if (scope === undefined) {
      throw new CustodyValidationError(
        "custody-unknown-location",
        `no such custody location: ${input.scopeLocationId}`,
      );
    }
  }
  const stocktakeId = newIdentifier("custodyStocktake", options.randomSource);
  const now = options.clock.now();
  return {
    stocktakeId,
    effect: {
      statements: [
        insertCustodyStocktakeStatement(database, {
          id: stocktakeId,
          name,
          scopeLocationId: input.scopeLocationId ?? null,
          openedAt: input.openedAt ?? now,
          openedByUserId: options.actorUserId,
          note: input.note ?? null,
          createdAt: now,
        }),
        custodyAuditStatement(database, options, "custodyStocktake.opened", stocktakeId, {
          scoped: input.scopeLocationId != null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface RecordCustodySightingInput {
  readonly kind: CustodySightingKind;
  readonly packetId?: CustodyPacketId | null;
  readonly itemId?: CustodyItemId | null;
  readonly locationId?: CustodyLocationId | null;
  // What the observer physically found, in their words. Required on an `unregistered` observation:
  // it is the only description of that object anywhere.
  readonly description?: string | null;
  readonly observedAt?: string;
  readonly note?: string | null;
}

export interface RecordCustodySightingsOptions extends CustodyStocktakeServiceOptions {
  readonly idempotency?: CustodyIdempotencyContext;
}

export interface RecordedCustodySightings {
  readonly sightingIds: readonly CustodyStocktakeSightingId[];
  readonly replayed: boolean;
}

// The body stored on the idempotency record, which the chokepoint replays verbatim to a retrying
// client. Keyed `ids` because a batch creates several rows; a retried scanner batch must not append
// the same forty observations twice.
interface StoredSightingsResponse {
  readonly ids: readonly CustodyStocktakeSightingId[];
}

// The most observations one request may carry. A person walking a safe with a scanner produces them
// in bursts, and one round trip per shelf beats one per envelope; the cap keeps a single batch inside
// what a request handler should be composing at all.
export const MAX_CUSTODY_SIGHTINGS_PER_BATCH = 200;

// Records what the counters saw, as a batch. Every observation in one request lands in one atomic
// commit, so a scanner burst is all-or-nothing rather than half-recorded — a partially applied batch
// would leave the reconciliation reporting missing property that was in fact counted.
//
// The expected location is resolved and FROZEN onto each row here, at the moment of the observation,
// rather than joined at read time. "Sighted on the wrong shelf" then stays a fact about the count
// even after somebody moves the packet to the right one.
export async function recordCustodyStocktakeSightings(
  database: BatchDatabase,
  stocktakeId: CustodyStocktakeId,
  inputs: readonly RecordCustodySightingInput[],
  options: RecordCustodySightingsOptions,
): Promise<RecordedCustodySightings> {
  const stocktake = await loadOpenStocktakeOrRefuse(database, stocktakeId);
  if (inputs.length === 0) {
    throw new CustodyValidationError(
      "custody-invalid-sighting",
      "a stocktake batch records at least one observation",
    );
  }
  if (inputs.length > MAX_CUSTODY_SIGHTINGS_PER_BATCH) {
    throw new CustodyValidationError(
      "custody-invalid-sighting",
      `a stocktake batch records at most ${MAX_CUSTODY_SIGHTINGS_PER_BATCH} observations`,
    );
  }

  // Every referenced handle is resolved BEFORE any identifier is minted and before the batch is
  // composed, so a batch naming something the register does not know writes nothing at all.
  const expectedByPacket = new Map<CustodyPacketId, CustodyLocationId | null>();
  for (const input of inputs) {
    assertSightingShape(input);
    if (input.packetId != null && !expectedByPacket.has(input.packetId)) {
      const packet = await readCustodyPacket(database, input.packetId);
      if (packet === undefined) {
        throw new CustodyValidationError(
          "custody-unknown-packet",
          `no such custody packet: ${input.packetId}`,
        );
      }
      expectedByPacket.set(input.packetId, packet.current_location_id);
    }
    if (input.itemId != null) {
      const item = await readCustodyItem(database, input.itemId);
      if (item === undefined) {
        throw new CustodyValidationError(
          "custody-unknown-item",
          `no such custody item: ${input.itemId}`,
        );
      }
      if (input.packetId != null && item.packet_id !== input.packetId) {
        throw new CustodyValidationError(
          "custody-invalid-sighting",
          "the item named by this observation belongs to a different packet",
        );
      }
    }
    if (input.locationId != null) {
      const location = await readCustodyLocation(database, input.locationId);
      if (location === undefined) {
        throw new CustodyValidationError(
          "custody-unknown-location",
          `no such custody location: ${input.locationId}`,
        );
      }
    }
  }

  const sightingIds = inputs.map(() =>
    newIdentifier("custodyStocktakeSighting", options.randomSource),
  );

  const result = await runIdempotentEffect({
    database,
    key: options.idempotency?.key,
    fingerprint: options.idempotency?.fingerprint ?? "",
    newRecordId: options.idempotency?.newRecordId,
    now: () => options.clock.now(),
    effect: () => {
      const now = options.clock.now();
      const statements: SqlStatement[] = inputs.map((input, index) =>
        insertCustodyStocktakeSightingStatement(database, {
          id: sightingIds[index] as CustodyStocktakeSightingId,
          stocktakeId: stocktake.id,
          kind: input.kind,
          packetId: input.packetId ?? null,
          itemId: input.itemId ?? null,
          locationId: input.locationId ?? null,
          expectedLocationId:
            input.packetId == null ? null : (expectedByPacket.get(input.packetId) ?? null),
          description: input.description?.trim() ?? null,
          observedAt: input.observedAt ?? now,
          recordedAt: now,
          observedByUserId: options.actorUserId,
          note: input.note ?? null,
        }),
      );
      // One audit row for the batch, not one per observation. The batch is the human act — a person
      // walked a shelf and recorded what was on it — and metadata carries counts and low-cardinality
      // labels only: never a custody number, a location name, or a description of what a firm holds.
      statements.push(
        custodyAuditStatement(database, options, "custodyStocktake.sighted", stocktake.id, {
          observations: inputs.length,
          sighted: inputs.filter((input) => input.kind === "sighted").length,
          notFound: inputs.filter((input) => input.kind === "not_found").length,
          unregistered: inputs.filter((input) => input.kind === "unregistered").length,
        }),
      );
      const value: StoredSightingsResponse = { ids: sightingIds };
      return Promise.resolve({
        write: { statements, outboxMessages: [] },
        responseCode: 201,
        responseBody: canonicalJsonStringify(value),
      });
    },
  });

  switch (result.kind) {
    case "executed":
    case "replayed": {
      if (result.responseBody === null) {
        throw new Error("custody stocktake sighting effect stored no response body");
      }
      const value = JSON.parse(result.responseBody) as StoredSightingsResponse;
      return { sightingIds: value.ids, replayed: result.kind === "replayed" };
    }
    case "in-progress":
      throw new CustodyIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new CustodyIdempotencyConflictError("fingerprint-mismatch");
  }
}

export interface CloseCustodyStocktakeInput {
  // An abandoned count freezes no findings. A walk begun and not finished must not close as though
  // it had counted everything: the reconciliation of a half-done count reads as a safe full of
  // missing originals, which is the most alarming and most wrong thing this subsystem could report.
  readonly abandoned?: boolean;
  readonly note?: string | null;
}

export interface ClosedCustodyStocktake {
  readonly stocktakeId: CustodyStocktakeId;
  readonly status: "closed" | "abandoned";
  readonly counts: CustodyReconciliationCounts | null;
  readonly effect: EffectWrite;
}

// Closes a count and freezes what it found. It writes the stocktake row and an audit row, and that is
// the complete list: no movement, no packet, no item, no status anywhere in the register changes
// because a count finished. What the close produces is a report.
//
// The frozen counts are drawn from the same reconciliation the report renders, so the number a firm
// files and the report it read can never come from two different definitions of what the walk found.
export async function closeCustodyStocktake(
  database: SqlDatabase,
  stocktakeId: CustodyStocktakeId,
  input: CloseCustodyStocktakeInput,
  options: CustodyStocktakeServiceOptions,
): Promise<ClosedCustodyStocktake> {
  const stocktake = await loadOpenStocktakeOrRefuse(database, stocktakeId);
  const abandoned = input.abandoned === true;
  const counts = abandoned ? null : countsOf(await reconcileAgainstRegister(database, stocktake));
  const now = options.clock.now();
  return {
    stocktakeId,
    status: abandoned ? "abandoned" : "closed",
    counts,
    effect: {
      statements: [
        // The status guard rides the write: D1 has no interactive transaction, so a second close
        // arriving concurrently matches zero rows and changes nothing rather than overwriting the
        // findings the first one froze.
        closeCustodyStocktakeStatement(
          database,
          stocktakeId,
          abandoned ? "abandoned" : "closed",
          counts,
          options.actorUserId,
          now,
        ),
        custodyAuditStatement(database, options, "custodyStocktake.closed", stocktakeId, {
          abandoned,
          ...(counts === null ? {} : counts),
        }),
      ],
      outboxMessages: [],
    },
  };
}

async function loadOpenStocktakeOrRefuse(
  database: SqlDatabase,
  stocktakeId: CustodyStocktakeId,
): Promise<CustodyStocktakeRow> {
  const stocktake = await readCustodyStocktake(database, stocktakeId);
  if (stocktake === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-stocktake",
      `no such custody stocktake: ${stocktakeId}`,
    );
  }
  if (stocktake.status !== "open") {
    throw new CustodyValidationError(
      "custody-stocktake-closed",
      `this stocktake is ${stocktake.status}; open a new count rather than adding to a finished one`,
    );
  }
  return stocktake;
}

// The shape each observation kind has to carry, refused here as a named error rather than left to the
// database's CHECK — a caller can act on "an unregistered object needs a description of what was
// found" and cannot act on a constraint name.
function assertSightingShape(input: RecordCustodySightingInput): void {
  switch (input.kind) {
    case "sighted":
      if (input.packetId == null || input.locationId == null) {
        throw new CustodyValidationError(
          "custody-invalid-sighting",
          "a sighting names the packet that was seen and the location it was seen at",
        );
      }
      return;
    case "not_found":
      if (input.packetId == null) {
        throw new CustodyValidationError(
          "custody-invalid-sighting",
          "a not-found observation names the packet that was looked for",
        );
      }
      return;
    case "unregistered":
      if (input.packetId != null || input.itemId != null) {
        throw new CustodyValidationError(
          "custody-invalid-sighting",
          "an unregistered observation is something the register has no row for, so it names no packet",
        );
      }
      if (input.locationId == null || (input.description ?? "").trim().length === 0) {
        throw new CustodyValidationError(
          "custody-invalid-sighting",
          "an unregistered observation names where it was found and describes what was found — that description is the only record of the object anywhere",
        );
      }
      return;
  }
}
