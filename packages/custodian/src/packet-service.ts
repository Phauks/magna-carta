import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  runIdempotentEffect,
  type IdempotentEffectResult,
} from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyLocationId,
  CustodyOwnerId,
  CustodyPacketId,
  IdempotencyRecordId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  ensureSystemMatter,
  isSystemMatterConflict,
  SYSTEM_MATTER_KEYS,
} from "@magna-carta/matters/system-matter-statements";
import { custodyAuditStatement, type CustodyAuditContext } from "./audit.ts";
import { insertCustodyMovementStatement } from "./movement-statements.ts";
import {
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  isNumberAllocationConflict,
  readCounterValue,
} from "./numbering/counter-statements.ts";
import {
  DEFAULT_CUSTODY_NUMBER_SCHEME,
  deriveScopeKey,
  renderCustodyNumber,
  type CustodyNumberContext,
  type CustodyNumberScheme,
} from "./numbering/render.ts";
import {
  endCustodyOwnerStatement,
  insertCustodyOwnerStatement,
  insertCustodyPacketStatement,
  isCustodyNumberConflict,
  readCurrentCustodyOwnerCount,
  readCustodyPacket,
  updateCustodyPacketFieldsStatement,
  type CustodyPacketRow,
} from "./packet-statements.ts";
import { assertReviewIntervalMonths, CustodyValidationError } from "./validation.ts";

// Logging a packet is the subsystem's central write, and it does four things at once that all have
// to commit together: it draws the firm-scoped custody number, it lands the packet, it lands at
// least one owner link, and it appends the `logged` movement that opens the ledger for that packet.
// Splitting any of them out would create a window in which the register holds an unattributable
// packet or a numbered row with no history — the two states the whole design exists to prevent.
//
// The number draw reuses the matters allocation-ledger idiom rather than re-deriving it: the same
// race (concurrent draws against a per-firm counter, no interactive transaction) already has a
// tested solution, and the read-render-commit here runs under the same bounded retry.

const DEFAULT_MAX_ATTEMPTS = 5;

export interface CustodyIdempotencyContext {
  readonly key: string | undefined;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId;
}

export interface CustodyPacketServiceOptions extends CustodyAuditContext {
  readonly idempotency?: CustodyIdempotencyContext;
  readonly randomSource?: RandomSource;
  readonly maxAttempts?: number;
  // The firm's custody-number shape. Configured through the scoped-settings mechanism by the caller;
  // absent means the platform default (a CUS prefix, five-digit padding, firm-wide scope).
  readonly numberScheme?: CustodyNumberScheme;
}

// An owner link as supplied on creation. entity_id is a directoryPerson_/directoryOrganization_
// handle; ownershipRole is a short firm-supplied label, not a platform enum of tenancy forms.
export interface CustodyOwnerInput {
  readonly entityId: string;
  readonly ownershipRole?: string | null;
}

export interface CreateCustodyPacketInput {
  readonly name: string;
  readonly owners: readonly CustodyOwnerInput[];
  readonly currentLocationId: CustodyLocationId;
  readonly matterId?: MatterId | null;
  readonly depositorEntityId?: string | null;
  readonly depositedAt?: string | null;
  readonly notes?: string | null;
  // A number a firm carried in from a paper deeds register or a prior system. It touches no counter
  // and takes no allocation row — a firm migrating thirty years of physical labels must not be made
  // to re-label a safe.
  readonly manualCustodyNumber?: string | null;
  readonly rootCode?: string; // only consulted when the scheme scopes per custody root
}

export interface CreatedCustodyPacket {
  readonly packetId: CustodyPacketId;
  readonly custodyNumber: string;
  // Where a scan of this packet's contents is filed: the packet's own matter when it has one, and
  // the firm's custody holding matter when it does not.
  readonly filingMatterId: MatterId;
  readonly replayed: boolean;
}

export async function createCustodyPacket(
  database: BatchDatabase,
  input: CreateCustodyPacketInput,
  options: CustodyPacketServiceOptions & { readonly responsibleMemberId: UserId },
): Promise<CreatedCustodyPacket> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CustodyValidationError("custody-empty-name", "a custody packet needs a name");
  }
  // The orphan-prevention invariant, enforced at the one place a packet can come into existence.
  // There is deliberately no "log it now, attribute it later" escape hatch: it would be used
  // constantly, and an escape hatch used constantly is not an invariant.
  if (input.owners.length === 0) {
    throw new CustodyValidationError(
      "custody-owner-required",
      "a custody packet needs at least one Directory owner — an unattributable original can never be released and never be destroyed",
    );
  }
  for (const owner of input.owners) {
    if (owner.entityId.trim().length === 0) {
      throw new CustodyValidationError(
        "custody-owner-required",
        "a custody owner link needs a Directory entity",
      );
    }
  }

  const scheme = options.numberScheme ?? DEFAULT_CUSTODY_NUMBER_SCHEME;
  const numberContext: CustodyNumberContext = { rootCode: input.rootCode };
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const packetId = newIdentifier("custodyPacket", options.randomSource);
    let scopeKey = "";
    let observed = 0;
    try {
      const result = await runIdempotentEffect({
        database,
        key: options.idempotency?.key,
        fingerprint: options.idempotency?.fingerprint ?? "",
        newRecordId: options.idempotency?.newRecordId,
        now: () => options.clock.now(),
        effect: async () => {
          const now = options.clock.now();
          // A matterless packet still needs somewhere to file its scans, and the File Manager is the
          // only storage of record. Resolving the holding matter HERE means a packet always has a
          // filing target by the time anyone uploads a scan for it, and the row rides this same
          // atomic batch — so a firm never ends up with a packet whose filing target does not exist.
          const holding =
            input.matterId != null
              ? null
              : await ensureSystemMatter(database, SYSTEM_MATTER_KEYS.custodyHolding, {
                  clock: options.clock,
                  actorUserId: options.actorUserId,
                  responsibleMemberId: options.responsibleMemberId,
                  randomSource: options.randomSource,
                });
          const filingMatterId = input.matterId ?? holding?.matterId;
          if (filingMatterId === undefined) {
            throw new Error("custody packet filing target did not resolve");
          }

          const drawStatements = [];
          let custodyNumber: string;
          if (input.manualCustodyNumber != null && input.manualCustodyNumber.trim().length > 0) {
            custodyNumber = input.manualCustodyNumber.trim();
          } else {
            scopeKey = deriveScopeKey(scheme, numberContext);
            observed = (await readCounterValue(database, scopeKey)) ?? scheme.startValue;
            custodyNumber = renderCustodyNumber(scheme, numberContext, observed);
            drawStatements.push(
              ensureCounterRowStatement(database, scopeKey, scheme.startValue),
              guardedIncrementStatement(database, scopeKey, observed),
            );
          }
          const drawn = drawStatements.length > 0;

          const ownerStatements = input.owners.map((owner) =>
            insertCustodyOwnerStatement(database, {
              id: newIdentifier("custodyOwner", options.randomSource),
              packetId,
              entityId: owner.entityId,
              ownershipRole: owner.ownershipRole ?? null,
              effectiveFrom: now,
              createdAt: now,
            }),
          );

          // The stored body IS the wire body: the chokepoint's idempotency gate replays it verbatim
          // as the HTTP response, so a stored shape that differs from what the handler returns would
          // hand a retrying client a different payload than the original request produced.
          const value: StoredPacketResponse = { id: packetId, custodyNumber, filingMatterId };
          return {
            write: {
              statements: [
                ...(holding?.effect.statements ?? []),
                ...drawStatements,
                insertCustodyPacketStatement(database, {
                  id: packetId,
                  custodyNumber,
                  numberSource: drawn ? "drawn" : "manual",
                  name,
                  currentLocationId: input.currentLocationId,
                  matterId: input.matterId ?? null,
                  depositorEntityId: input.depositorEntityId ?? null,
                  depositedAt: input.depositedAt ?? null,
                  notes: input.notes ?? null,
                  createdAt: now,
                }),
                ...ownerStatements,
                // The ledger opens with the packet: a numbered packet with no history is a record
                // that cannot say when the firm took the property in.
                insertCustodyMovementStatement(database, {
                  id: newIdentifier("custodyMovement", options.randomSource),
                  packetId,
                  itemId: null,
                  kind: "logged",
                  occurredAt: input.depositedAt ?? now,
                  recordedAt: now,
                  recordedByUserId: options.actorUserId,
                  fromLocationId: null,
                  toLocationId: input.currentLocationId,
                  borrowerKind: null,
                  borrowerUserId: null,
                  borrowerEntityId: null,
                  borrowerName: null,
                  dueBackOn: null,
                  reason: null,
                  correctsMovementId: null,
                  shipmentId: null,
                  note: null,
                }),
                ...(drawn
                  ? [
                      // Last: packet_id is a foreign key, so the packet has to exist by the time the
                      // allocation claim lands.
                      allocateCounterValueStatement(database, scopeKey, observed, packetId, now),
                    ]
                  : []),
                custodyAuditStatement(database, options, "custodyPacket.logged", packetId, {
                  numberSource: drawn ? "drawn" : "manual",
                  ownerCount: input.owners.length,
                  hasMatter: input.matterId != null,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 201,
            responseBody: canonicalJsonStringify(value),
          };
        },
      });
      return finishPacketResult(result);
    } catch (caught) {
      if (
        !isCustodyNumberConflict(caught) &&
        !isNumberAllocationConflict(caught) &&
        !isSystemMatterConflict(caught)
      ) {
        throw caught;
      }
      lastError = caught;
      if (scopeKey !== "" || observed !== 0) {
        // Advance past the taken value out of band: the in-batch increment rolled back with
        // everything else, so without this the retry would render the same number again. Guarded on
        // the observed value, so a concurrent winner that already advanced the counter no-ops here.
        await ensureCounterRowStatement(database, scopeKey, scheme.startValue).run();
        await guardedIncrementStatement(database, scopeKey, observed).run();
      }
    }
  }
  throw new CustodyValidationError(
    "custody-number-exhausted",
    `custody number allocation did not converge after ${maxAttempts} attempts: ${String(lastError)}`,
  );
}

// The body stored on the idempotency record, which the chokepoint replays verbatim to a retrying
// client. Keyed `id` because that is the platform's created-resource wire shape; the domain result
// below renames it to packetId so a caller cannot confuse it with any other handle.
interface StoredPacketResponse {
  readonly id: CustodyPacketId;
  readonly custodyNumber: string;
  readonly filingMatterId: MatterId;
}

function finishPacketResult(result: IdempotentEffectResult): CreatedCustodyPacket {
  switch (result.kind) {
    case "executed":
    case "replayed": {
      if (result.responseBody === null) {
        throw new Error("custody packet effect stored no response body");
      }
      const value = JSON.parse(result.responseBody) as StoredPacketResponse;
      return {
        packetId: value.id,
        custodyNumber: value.custodyNumber,
        filingMatterId: value.filingMatterId,
        replayed: result.kind === "replayed",
      };
    }
    case "in-progress":
      throw new CustodyIdempotencyConflictError("in-progress");
    case "fingerprint-mismatch":
      throw new CustodyIdempotencyConflictError("fingerprint-mismatch");
  }
}

// The two idempotency outcomes the HTTP boundary maps to 409 and 422. Raised as one error with a
// discriminating code so the route branches on the code, never on a message.
export class CustodyIdempotencyConflictError extends Error {
  constructor(readonly reason: "in-progress" | "fingerprint-mismatch") {
    super(`custody request idempotency conflict: ${reason}`);
    this.name = "CustodyIdempotencyConflictError";
  }
}

async function loadPacketOrRefuse(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyPacketRow> {
  const row = await readCustodyPacket(database, packetId);
  if (row === undefined) {
    throw new CustodyValidationError(
      "custody-unknown-packet",
      `no such custody packet: ${packetId}`,
    );
  }
  return row;
}

export interface UpdateCustodyPacketInput {
  readonly name?: string;
  readonly matterId?: MatterId | null;
  readonly depositorEntityId?: string | null;
  readonly depositedAt?: string | null;
  // The review schedule a firm sets. Both are nullable and neither has a default: nothing in this
  // subsystem derives a review date, and nothing expires when one passes.
  readonly reviewOn?: string | null;
  readonly reviewIntervalMonths?: number | null;
  readonly notes?: string | null;
}

// Descriptive fields only. Status is derived by the movement write path and location changes with a
// movement, so neither is reachable here — there is exactly one path that changes what the register
// asserts about where a packet is and what state it is in.
export async function updateCustodyPacket(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  patch: UpdateCustodyPacketInput,
  options: CustodyAuditContext,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadPacketOrRefuse(database, packetId);
  const name = patch.name === undefined ? existing.name : patch.name.trim();
  if (name.length === 0) {
    throw new CustodyValidationError("custody-empty-name", "a custody packet needs a name");
  }
  const reviewIntervalMonths =
    patch.reviewIntervalMonths === undefined
      ? existing.review_interval_months
      : patch.reviewIntervalMonths;
  assertReviewIntervalMonths(reviewIntervalMonths);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateCustodyPacketFieldsStatement(
          database,
          packetId,
          {
            name,
            matterId: patch.matterId === undefined ? existing.matter_id : patch.matterId,
            depositorEntityId:
              patch.depositorEntityId === undefined
                ? existing.depositor_entity_id
                : patch.depositorEntityId,
            depositedAt:
              patch.depositedAt === undefined ? existing.deposited_at : patch.depositedAt,
            reviewOn: patch.reviewOn === undefined ? existing.review_on : patch.reviewOn,
            reviewIntervalMonths,
            notes: patch.notes === undefined ? existing.notes : patch.notes,
          },
          now,
        ),
        custodyAuditStatement(database, options, "custodyPacket.updated", packetId),
      ],
      outboxMessages: [],
    },
  };
}

export interface AddCustodyOwnerResult {
  readonly ownerId: CustodyOwnerId;
  readonly effect: EffectWrite;
}

export async function addCustodyOwner(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  input: CustodyOwnerInput,
  options: CustodyAuditContext & { readonly randomSource?: RandomSource },
): Promise<AddCustodyOwnerResult> {
  await loadPacketOrRefuse(database, packetId);
  if (input.entityId.trim().length === 0) {
    throw new CustodyValidationError(
      "custody-owner-required",
      "a custody owner link needs a Directory entity",
    );
  }
  const ownerId = newIdentifier("custodyOwner", options.randomSource);
  const now = options.clock.now();
  return {
    ownerId,
    effect: {
      statements: [
        insertCustodyOwnerStatement(database, {
          id: ownerId,
          packetId,
          entityId: input.entityId,
          ownershipRole: input.ownershipRole ?? null,
          effectiveFrom: now,
          createdAt: now,
        }),
        custodyAuditStatement(database, options, "custodyOwner.added", ownerId, { packetId }),
      ],
      outboxMessages: [],
    },
  };
}

// Ending an ownership is temporal, never a delete — and it refuses to take the LAST current owner,
// because a packet with no owner is exactly the unattributable original the register exists to
// prevent. An ownership change is therefore add-then-end, in that order.
export async function endCustodyOwner(
  database: SqlDatabase,
  packetId: CustodyPacketId,
  ownerId: CustodyOwnerId,
  options: CustodyAuditContext,
): Promise<{ effect: EffectWrite }> {
  await loadPacketOrRefuse(database, packetId);
  const currentOwners = await readCurrentCustodyOwnerCount(database, packetId);
  if (currentOwners <= 1) {
    throw new CustodyValidationError(
      "custody-owner-required",
      "a custody packet must keep at least one owner — add the new owner before ending the old one",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        endCustodyOwnerStatement(database, ownerId, now),
        custodyAuditStatement(database, options, "custodyOwner.ended", ownerId, { packetId }),
      ],
      outboxMessages: [],
    },
  };
}
