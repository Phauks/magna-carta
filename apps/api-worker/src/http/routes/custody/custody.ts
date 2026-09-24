import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  approveCustodyDestruction,
  executeCustodyDestruction,
  refuseCustodyDestruction,
  requestCustodyDestruction,
} from "@magna-carta/custodian/destruction-service";
import { listCustodyDestructionRequests } from "@magna-carta/custodian/destruction-statements";
import { placeCustodyHold, releaseCustodyHold } from "@magna-carta/custodian/hold-service";
import { readActiveCustodyHolds } from "@magna-carta/custodian/hold-statements";
import { addCustodyItem, updateCustodyItem } from "@magna-carta/custodian/item-service";
import { buildCustodyLabelSheet } from "@magna-carta/custodian/label-service";
import { CUSTODY_LABELS_PER_SHEET } from "@magna-carta/custodian/labels/label-sheet";
import {
  createCustodyItemType,
  deactivateCustodyItemType,
} from "@magna-carta/custodian/item-type-service";
import { readCustodyItemTypes } from "@magna-carta/custodian/item-type-statements";
import {
  closeCustodyLocation,
  createCustodyLocation,
  readCustodyLocationPath,
  updateCustodyLocation,
} from "@magna-carta/custodian/location-service";
import { selectAllCustodyLocationsStatement } from "@magna-carta/custodian/location-statements";
import { recordCustodyMovement } from "@magna-carta/custodian/movement-service";
import { readCustodyMovements } from "@magna-carta/custodian/movement-statements";
import {
  addCustodyOwner,
  createCustodyPacket,
  CustodyIdempotencyConflictError,
  updateCustodyPacket,
} from "@magna-carta/custodian/packet-service";
import {
  readCustodyItems,
  readCustodyOwners,
  readCustodyPacket,
} from "@magna-carta/custodian/packet-statements";
import {
  listCustodyPackets,
  readOverdueCustodyCheckoutsPage,
} from "@magna-carta/custodian/queries";
import { collectCustodyReminders } from "@magna-carta/custodian/reminders";
import {
  readCustodyHoldingsByOwner,
  readCustodyLocationOccupancyReport,
  readCustodyPacketsUnderHold,
} from "@magna-carta/custodian/reports";
import { completeCustodyReview } from "@magna-carta/custodian/review-service";
import { linkCustodyScan, resolveCustodyFilingMatter } from "@magna-carta/custodian/scan-service";
import { readCustodyScans } from "@magna-carta/custodian/scan-statements";
import { reconcileAgainstRegister } from "@magna-carta/custodian/stocktake-reconciliation";
import {
  closeCustodyStocktake,
  MAX_CUSTODY_SIGHTINGS_PER_BATCH,
  openCustodyStocktake,
  recordCustodyStocktakeSightings,
} from "@magna-carta/custodian/stocktake-service";
import {
  readCustodyStocktake,
  readCustodyStocktakes,
  readCustodyStocktakeSightings,
} from "@magna-carta/custodian/stocktake-statements";
import {
  ENCODED_CUSTODY_WILL_JURISDICTION_KEYS,
  CUSTODY_WILL_DEADLINE_BASES,
  resolveCustodyWillDuties,
} from "@magna-carta/custodian/will-deposit-catalog";
import {
  CUSTODY_BORROWER_KINDS,
  CUSTODY_DESTRUCTION_OUTCOMES,
  CUSTODY_HOLD_KINDS,
  CUSTODY_ITEM_STATUSES,
  CUSTODY_LOCATION_KINDS,
  CUSTODY_MOVEMENT_KINDS,
  CUSTODY_PACKET_STATUSES,
  CUSTODY_RECONCILIATION_OUTCOMES,
  CUSTODY_SCAN_KINDS,
  CUSTODY_SIGHTING_KINDS,
  CUSTODY_STOCKTAKE_STATUSES,
  MAX_CUSTODY_REVIEW_INTERVAL_MONTHS,
} from "@magna-carta/custodian/types";
import { CustodyValidationError } from "@magna-carta/custodian/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  CustodyItemId,
  CustodyLocationId,
  CustodyPacketId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  identifierField,
  identifierPathParam,
  idempotencyKeyHeader,
} from "../../contracts/common.ts";
import { capped, cursorQuery, paginated } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The Custodian HTTP surface over the @magna-carta/custodian domain package: the register of physical
// client originals a firm holds in safekeeping — the container tree, packets and the items inside
// them, the Directory owner links, the append-only movement ledger, holds, and scanned copies.
//
// TWO THINGS ABOUT THIS SURFACE ARE DELIBERATE AND WORTH NOT UNDOING.
//
// There is no check-out route, no check-in route, and no move route. Every state change is
// POST /movements with a `kind`, so one place enforces the append-only invariant, one place writes
// the derived status in the same atomic batch, and one place composes the audit row. Adding a
// second write path means adding a second place all of that has to be right.
//
// There is no upload route. Scan bytes ride the File Manager's existing presigned upload and
// quarantine chokepoint, and POST /scans links the resulting file handle — one ingest chokepoint,
// no exceptions, which is what makes a custody scan previewable, convertible, and holdable like any
// other document.

type CustodyApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const READ = "custody:read" as const;
const MANAGE = "custody:manage" as const;

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the resource is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, a hold forbids the action, a location is still occupied, or a custody number could not be allocated",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the packet has no owner, the movement is not allowed from this state, a release has not captured the authority and identity check it needs, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a Custodian refusal to its RFC 9457 problem. Codes — never messages — drive it, so a message
// can be reworded without changing the contract. An unrecognized throw propagates to the standard
// error pipeline as a 500.
function custodyErrorResponse(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof CustodyIdempotencyConflictError) {
    return caught.reason === "in-progress"
      ? problemJson(c, {
          type: "idempotency-key-conflict",
          title: "Request in progress",
          status: 409,
          detail: "A request with this Idempotency-Key is still in progress.",
        })
      : problemJson(c, {
          type: "idempotency-fingerprint-mismatch",
          title: "Idempotency-Key reused",
          status: 422,
          detail: "This Idempotency-Key was already used with a different request payload.",
        });
  }
  if (!(caught instanceof CustodyValidationError)) throw caught;
  switch (caught.code) {
    case "custody-unknown-packet":
    case "custody-unknown-item":
    case "custody-unknown-location":
    case "custody-unknown-item-type":
    case "custody-unknown-hold":
    case "custody-unknown-stocktake":
    case "custody-unknown-destruction-request":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    // Two people, and the database says so too. Its own type rather than the generic validation
    // problem because a client acts on it by finding a different person, not by fixing the request.
    case "custody-approver-must-differ":
      return problemJson(c, {
        type: "custody-approver-must-differ",
        title: "A destruction needs a second person",
        status: 422,
        detail: caught.message,
      });
    // The one refusal in this subsystem with no override anywhere behind it. Its own type so a
    // client can say plainly what happened and offer the only real next step — look again at whether
    // the property really is an irreplaceable original — rather than presenting it as a form error.
    case "custody-intrinsic-value-not-destructible":
      return problemJson(c, {
        type: "custody-intrinsic-value-not-destructible",
        title: "An irreplaceable original is not destructible",
        status: 422,
        detail: caught.message,
      });
    case "custody-destruction-request-decided":
    case "custody-destruction-not-approved":
      return problemJson(c, {
        type: "custody-destruction-not-actionable",
        title: "This destruction request cannot take that action",
        status: 409,
        detail: caught.message,
      });
    // One problem type carrying two distinct details, mirroring the trust catalog: "nobody told us
    // which law" and "nobody has verified that law" are fixed differently, and the detail says which
    // one happened. Neither ever resolves to a default.
    case "custody-jurisdiction-not-recorded":
    case "custody-jurisdiction-not-encoded":
      return problemJson(c, {
        type: "custody-jurisdiction-unavailable",
        title: "The will-deposit duties cannot be resolved",
        status: 422,
        detail: caught.message,
      });
    // Its own type rather than the generic validation problem, because it is a LIFECYCLE state and
    // not a shape complaint: the request is well formed and the caller is entitled to make it, but
    // the count it names has already produced a reconciliation somebody may have acted on. A client
    // shows that as "this count is finished — open a new one", which is a different screen.
    case "custody-stocktake-closed":
      return problemJson(c, {
        type: "custody-stocktake-closed",
        title: "This stocktake is finished",
        status: 409,
        detail: caught.message,
      });
    // Also a state and not a shape complaint: the walk is real and the close is a close the caller
    // may make, but the reconciliation behind it is a partial answer and freezing it would put a
    // number on the record that understates what is missing. A client shows the two ways out — a
    // narrower scope, or an abandoned close.
    case "custody-stocktake-truncated":
      return problemJson(c, {
        type: "custody-stocktake-truncated",
        title: "This count is too large to close with frozen numbers",
        status: 409,
        detail: caught.message,
      });
    case "custody-owner-required":
      return problemJson(c, {
        type: "custody-owner-required",
        title: "A custody packet needs an owner",
        status: 422,
        detail: caught.message,
      });
    case "custody-hold-blocks-action":
      return problemJson(c, {
        type: "custody-hold-blocks-action",
        title: "A hold forbids this action",
        status: 409,
        detail: caught.message,
      });
    case "custody-location-cycle":
    case "custody-location-too-deep":
      return problemJson(c, {
        type: "custody-location-cycle",
        title: "The custody location tree refuses this shape",
        status: 422,
        detail: caught.message,
      });
    case "custody-location-occupied":
      return problemJson(c, {
        type: "custody-location-occupied",
        title: "This custody location is still occupied",
        status: 409,
        detail: caught.message,
      });
    case "custody-number-exhausted":
    case "custody-number-taken":
      return problemJson(c, {
        type: "custody-number-exhausted",
        title: "The custody number could not be allocated",
        status: 409,
        detail: caught.message,
      });
    case "custody-invalid-movement":
    case "custody-packet-closed":
      return problemJson(c, {
        type: "custody-invalid-movement",
        title: "This movement is not allowed",
        status: 422,
        detail: caught.message,
      });
    // Its own type, and not the generic validation problem, because it is a GATE rather than a shape
    // complaint: the request is well formed and the caller is entitled to make it — what is missing
    // is the record that has to exist before an original can leave. A client shows that differently.
    case "custody-release-not-authorized":
      return problemJson(c, {
        type: "custody-release-not-authorized",
        title: "This release is not authorized yet",
        status: 422,
        detail: caught.message,
      });
    // A review with no date set, an out-of-range interval, and a label selection that will not fit a
    // sheet are all ordinary shape refusals — the caller sent something the register cannot act on,
    // not a state conflict — so they take the generic validation problem rather than minting three
    // contract-visible types that carry no extra information for a client.
    case "custody-no-review-scheduled":
    case "custody-invalid-review-interval":
    case "custody-invalid-trigger-date":
    case "custody-label-selection-invalid":
    case "custody-release-signatories-must-differ":
    case "custody-ownership-role-not-in-catalog":
    case "custody-invalid-sighting":
      return problemJson(c, {
        type: "validation",
        title: "Custody request invalid",
        status: 422,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Custody request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// ---- contracts ----

const locationIdParam = z.object({
  locationId: identifierPathParam("custodyLocation", "locationId"),
});
const packetIdParam = z.object({ packetId: identifierPathParam("custodyPacket", "packetId") });
const packetItemParams = z.object({
  packetId: identifierPathParam("custodyPacket", "packetId"),
  itemId: identifierPathParam("custodyItem", "itemId"),
});
const holdIdParam = z.object({ holdId: identifierPathParam("custodyHold", "holdId") });

// A Directory person or organization handle. Custody owners, depositors, and entity borrowers all
// point into the Directory graph by value, with no cross-domain foreign key (the matter_party
// precedent), so the API constrains the shape at the door.
const directoryEntityId = z
  .string()
  .regex(/^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]{1,64}$/);

const CustodyLocation = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(CUSTODY_LOCATION_KINDS),
    parentLocationId: z.string().nullable(),
    firmLocationId: z.string().nullable(),
    address: z.string().nullable(),
    status: z.enum(["active", "closed"]),
    notes: z.string().nullable(),
  })
  .openapi("CustodyLocation");

const CreateCustodyLocationRequest = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(CUSTODY_LOCATION_KINDS),
    parentLocationId: identifierField("custodyLocation").optional(),
    // Set only on a root node, and only for an office root: a child inherits its office from the
    // root it hangs off.
    firmLocationId: identifierField("location").optional(),
    address: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi("CreateCustodyLocationRequest");

const UpdateCustodyLocationRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    parentLocationId: identifierField("custodyLocation").nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    // The only lifecycle change a location has. Closing refuses while the node or its subtree still
    // holds packets.
    close: z.boolean().optional(),
  })
  .openapi("UpdateCustodyLocationRequest");

const CustodyOwner = z
  .object({
    id: z.string(),
    entityId: z.string(),
    ownershipRole: z.string().nullable(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .openapi("CustodyOwner");

const CustodyOwnerInput = z
  .object({
    entityId: directoryEntityId,
    // A short firm-supplied label — owner, joint owner, life tenant, trustee, executor. Not a
    // platform enum of tenancy forms: those are jurisdiction-specific, and there is no
    // release-authority engine to consume them.
    ownershipRole: z.string().max(100).nullable().optional(),
  })
  .openapi("CustodyOwnerInput");

const CustodyItem = z
  .object({
    id: z.string(),
    ordinal: z.number().int(),
    itemTypeId: z.string().nullable(),
    description: z.string(),
    instrumentDate: z.string().nullable(),
    intrinsicValue: z.boolean(),
    declaredValueAmountMinor: z.number().int().nullable(),
    declaredValueCurrency: z.string().nullable(),
    status: z.enum(CUSTODY_ITEM_STATUSES),
    reviewOn: z.string().nullable(),
    reviewIntervalMonths: z.number().int().nullable(),
  })
  .openapi("CustodyItem");

// A review schedule, as a request field. Both halves are nullable and neither has a default: the
// register never derives a review date, and nothing expires when one passes.
const reviewOnField = z.string().max(40).nullable().optional();
const reviewIntervalMonthsField = z
  .number()
  .int()
  .min(1)
  .max(MAX_CUSTODY_REVIEW_INTERVAL_MONTHS)
  .nullable()
  .optional();

const DeclaredValue = z
  .object({ amountMinor: z.number().int(), currency: z.string().length(3) })
  .openapi("CustodyDeclaredValue");

const AddCustodyItemRequest = z
  .object({
    description: z.string().min(1).max(2000),
    itemTypeId: identifierField("custodyItemType").optional(),
    instrumentDate: z.string().max(40).nullable().optional(),
    // Omitted takes the type's default. Supplied is a person's assertion about this object, which is
    // the only thing a destruction refusal should ever read.
    intrinsicValue: z.boolean().optional(),
    declaredValue: DeclaredValue.nullable().optional(),
    occurredAt: z.string().optional(),
  })
  .openapi("AddCustodyItemRequest");

const UpdateCustodyItemRequest = z
  .object({
    description: z.string().min(1).max(2000).optional(),
    itemTypeId: identifierField("custodyItemType").nullable().optional(),
    instrumentDate: z.string().max(40).nullable().optional(),
    intrinsicValue: z.boolean().optional(),
    declaredValue: DeclaredValue.nullable().optional(),
    reviewOn: reviewOnField,
    reviewIntervalMonths: reviewIntervalMonthsField,
  })
  .openapi("UpdateCustodyItemRequest");

const CustodyPacketSummary = z
  .object({
    id: z.string(),
    custodyNumber: z.string(),
    name: z.string(),
    status: z.enum(CUSTODY_PACKET_STATUSES),
    currentLocationId: z.string().nullable(),
    matterId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("CustodyPacketSummary");

const CustodyPacketPage = paginated(CustodyPacketSummary).openapi("CustodyPacketPage");

const CustodyHold = z
  .object({
    id: z.string(),
    itemId: z.string().nullable(),
    kind: z.enum(CUSTODY_HOLD_KINDS),
    placedAt: z.string(),
    reason: z.string().nullable(),
    releasedAt: z.string().nullable(),
  })
  .openapi("CustodyHold");

const CustodyScan = z
  .object({
    id: z.string(),
    itemId: z.string().nullable(),
    fileId: z.string(),
    kind: z.enum(CUSTODY_SCAN_KINDS),
    capturedAt: z.string(),
  })
  .openapi("CustodyScan");

const CustodyPacketDetail = z
  .object({
    id: z.string(),
    custodyNumber: z.string(),
    numberSource: z.enum(["drawn", "manual"]),
    name: z.string(),
    status: z.enum(CUSTODY_PACKET_STATUSES),
    matterId: z.string().nullable(),
    depositorEntityId: z.string().nullable(),
    depositedAt: z.string().nullable(),
    reviewOn: z.string().nullable(),
    reviewIntervalMonths: z.number().int().nullable(),
    notes: z.string().nullable(),
    // Root first, the packet's own node last — the breadcrumb the register renders.
    locationPath: z.array(CustodyLocation),
    // Where a scan of this packet's contents is filed: the packet's own matter when it has one, and
    // the firm's custody holding matter when it does not. A client uploads a scan to this matter
    // through the ordinary file path before linking it here.
    filingMatterId: z.string().nullable(),
    items: z.array(CustodyItem),
    owners: z.array(CustodyOwner),
    holds: z.array(CustodyHold),
    scans: z.array(CustodyScan),
  })
  .openapi("CustodyPacketDetail");

const CreateCustodyPacketRequest = z
  .object({
    name: z.string().min(1).max(300),
    // At least one, always. An original the firm holds for nobody it can name can never be released
    // and never be destroyed — the failure this register exists to prevent.
    owners: z.array(CustodyOwnerInput).min(1).max(20),
    currentLocationId: identifierField("custodyLocation"),
    matterId: identifierField("matter").optional(),
    depositorEntityId: directoryEntityId.optional(),
    depositedAt: z.string().optional(),
    notes: z.string().max(4000).nullable().optional(),
    // A number carried in from a paper deeds register or a prior system. It touches no counter, so a
    // firm migrating thirty years of physical labels does not have to re-label a safe.
    manualCustodyNumber: z.string().min(1).max(64).optional(),
  })
  .openapi("CreateCustodyPacketRequest");

const CreatedCustodyPacketResponse = z
  .object({ id: z.string(), custodyNumber: z.string(), filingMatterId: z.string() })
  .openapi("CreatedCustodyPacketResponse");

const UpdateCustodyPacketRequest = z
  .object({
    name: z.string().min(1).max(300).optional(),
    matterId: identifierField("matter").nullable().optional(),
    depositorEntityId: directoryEntityId.nullable().optional(),
    depositedAt: z.string().nullable().optional(),
    reviewOn: reviewOnField,
    reviewIntervalMonths: reviewIntervalMonthsField,
    notes: z.string().max(4000).nullable().optional(),
  })
  .openapi("UpdateCustodyPacketRequest");

const CustodyBorrower = z
  .object({
    kind: z.enum(CUSTODY_BORROWER_KINDS),
    userId: identifierField("user").optional(),
    entityId: directoryEntityId.optional(),
    // For a genuinely external individual with no Directory record. Recording a courier's driver as
    // a name rather than a Directory entity is deliberate: the Directory is the conflicts corpus.
    name: z.string().min(1).max(200).optional(),
  })
  .openapi("CustodyBorrower");

// What a release is made on, captured before the property leaves. Required on a `released` movement
// and refused on every other kind. There is deliberately no vocabulary of acceptable authorities:
// what document suffices to release an original varies by jurisdiction, so the firm writes what it
// relied on and the register's job is to make sure something was written and to freeze it.
//
// The member who checked identity is NOT a field here. It is the authenticated caller: an assertion
// about a check you made is not a claim you should be able to enter on somebody else's behalf.
const CustodyReleaseAuthorization = z
  .object({
    authorityBasis: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "The authority this release is made on, in the firm's own words. There is no list of acceptable answers: what suffices to release an original varies by jurisdiction.",
      ),
    identityEvidence: z
      .string()
      .min(1)
      .max(1000)
      .describe(
        "How the person collecting was identified. Record the check that was made, not the document's numbers — this lands on a ledger row that can never be edited or deleted.",
      ),
    witnessedByUserId: identifierField("user")
      .optional()
      .describe(
        "The second signatory, when the firm requires two. Must be an ACTIVE member of this firm other than the caller — the caller is recorded as the member who checked identity, so a release cannot be signed twice by one person.",
      ),
  })
  .openapi("CustodyReleaseAuthorization");

const RecordCustodyMovementRequest = z
  .object({
    kind: z.enum(CUSTODY_MOVEMENT_KINDS),
    itemId: identifierField("custodyItem").optional(),
    // When it happened in the physical world, if that is not now. The register reports on this;
    // the instant the assertion was made is recorded separately and never overwritten.
    occurredAt: z.string().optional(),
    toLocationId: identifierField("custodyLocation").optional(),
    borrower: CustodyBorrower.optional(),
    dueBackOn: z.string().max(40).optional(),
    reason: z.string().max(2000).optional(),
    correctsMovementId: identifierField("custodyMovement").optional(),
    shipmentId: identifierField("shipment").optional(),
    note: z.string().max(2000).optional(),
    releaseAuthorization: CustodyReleaseAuthorization.optional(),
  })
  .openapi("RecordCustodyMovementRequest");

const RecordedCustodyMovementResponse = z
  .object({ id: z.string(), packetStatus: z.enum(CUSTODY_PACKET_STATUSES) })
  .openapi("RecordedCustodyMovementResponse");

const CustodyMovement = z
  .object({
    id: z.string(),
    itemId: z.string().nullable(),
    kind: z.enum(CUSTODY_MOVEMENT_KINDS),
    occurredAt: z.string(),
    recordedAt: z.string(),
    recordedByUserId: z.string().nullable(),
    fromLocationId: z.string().nullable(),
    toLocationId: z.string().nullable(),
    borrowerKind: z.enum(CUSTODY_BORROWER_KINDS).nullable(),
    borrowerUserId: z.string().nullable(),
    borrowerEntityId: z.string().nullable(),
    borrowerName: z.string().nullable(),
    dueBackOn: z.string().nullable(),
    reason: z.string().nullable(),
    correctsMovementId: z.string().nullable(),
    shipmentId: z.string().nullable(),
    note: z.string().nullable(),
    // Populated only on a release: what it was made on, how the collector was identified, who made
    // that check, and the second signatory when the firm required one.
    releaseAuthorityBasis: z.string().nullable(),
    releaseIdentityEvidence: z.string().nullable(),
    releaseIdentityVerifiedByUserId: z.string().nullable(),
    releaseWitnessedByUserId: z.string().nullable(),
  })
  .openapi("CustodyMovement");

const CustodyMovementPage = paginated(CustodyMovement).openapi("CustodyMovementPage");

const PlaceCustodyHoldRequest = z
  .object({
    kind: z.enum(CUSTODY_HOLD_KINDS),
    itemId: identifierField("custodyItem").optional(),
    reason: z.string().max(2000).optional(),
  })
  .openapi("PlaceCustodyHoldRequest");

const LinkCustodyScanRequest = z
  .object({
    // An already-ingested File Manager file, filed where this packet's scans belong. Custodian never
    // accepts bytes — the file reaches `clean` through the ordinary upload and quarantine path.
    fileId: identifierField("file"),
    kind: z.enum(CUSTODY_SCAN_KINDS),
    itemId: identifierField("custodyItem").optional(),
    capturedAt: z.string().optional(),
  })
  .openapi("LinkCustodyScanRequest");

const CustodyItemType = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
    intrinsicValueDefault: z.boolean(),
    active: z.boolean(),
  })
  .openapi("CustodyItemType");

const CreateCustodyItemTypeRequest = z
  .object({
    name: z.string().min(1).max(120),
    code: z.string().max(40).nullable().optional(),
    intrinsicValueDefault: z.boolean().optional(),
  })
  .openapi("CreateCustodyItemTypeRequest");

const OverdueCustodyCheckout = z
  .object({
    packetId: z.string(),
    custodyNumber: z.string(),
    dueBackOn: z.string(),
    borrowerKind: z.enum(CUSTODY_BORROWER_KINDS).nullable(),
    daysOverdue: z.number().int(),
  })
  .openapi("OverdueCustodyCheckout");

const CompleteCustodyReviewRequest = z
  .object({
    // Which object was reviewed. Absent means the packet itself; an item id means one thing inside.
    itemId: identifierField("custodyItem").optional(),
    occurredAt: z.string().max(40).optional(),
    // An explicit next date, when the firm wants one the interval would not produce. Null clears the
    // schedule outright — "we have looked at this and it does not need looking at again".
    nextReviewOn: z.string().max(40).nullable().optional(),
    note: z.string().max(2000).optional(),
  })
  .openapi("CompleteCustodyReviewRequest");

const CompletedCustodyReviewResponse = z
  .object({ id: z.string(), nextReviewOn: z.string().nullable() })
  .openapi("CompletedCustodyReviewResponse");

const CustodyReminder = z
  .object({
    reason: z.enum(["review-due", "checkout-overdue"]),
    packetId: z.string(),
    itemId: z.string().nullable(),
    custodyNumber: z.string(),
    dueOn: z.string(),
    daysOverdue: z.number().int(),
    bucket: z.enum(["0-7d", "8-30d", "31-90d", "over-90d"]),
  })
  .openapi("CustodyReminder");

const CustodyHoldingsByOwner = z
  .object({
    entityId: z.string(),
    packetsHeld: z.number().int(),
    packetsOut: z.number().int(),
    itemsDescribed: z.number().int(),
    packetsUnderHold: z.number().int(),
  })
  .openapi("CustodyHoldingsByOwner");

const CustodyLocationOccupancy = z
  .object({
    locationId: z.string(),
    name: z.string(),
    kind: z.enum(CUSTODY_LOCATION_KINDS),
    parentLocationId: z.string().nullable(),
    status: z.enum(["active", "closed"]),
    depth: z.number().int(),
    directOccupancy: z.number().int(),
    subtreeOccupancy: z.number().int(),
  })
  .openapi("CustodyLocationOccupancy");

const CustodyPacketUnderHold = z
  .object({
    holdId: z.string(),
    packetId: z.string(),
    itemId: z.string().nullable(),
    custodyNumber: z.string(),
    kind: z.enum(CUSTODY_HOLD_KINDS),
    placedAt: z.string(),
    packetStatus: z.enum(CUSTODY_PACKET_STATUSES),
  })
  .openapi("CustodyPacketUnderHold");

// ---- stocktake contracts ----
//
// A stocktake OBSERVES. Nothing on this surface disposes of property, relocates it, or corrects the
// register: the reconciliation names corrective movements as proposals, and a person records each
// one through POST /packets/{packetId}/movements — the same single write path every other state
// change goes through — or does not. There is no "apply the reconciliation" route, and its absence
// is the design, because a count that wrote the register into agreement with itself would erase the
// difference the count exists to find.

const stocktakeIdParam = z.object({
  stocktakeId: identifierPathParam("custodyStocktake", "stocktakeId"),
});

const CustodyStocktakeCounts = z
  .object({
    matched: z.number().int(),
    missing: z.number().int(),
    misplaced: z.number().int(),
    unexpected: z.number().int(),
    unregistered: z.number().int(),
  })
  .openapi("CustodyStocktakeCounts");

const CustodyStocktake = z
  .object({
    id: z.string(),
    name: z.string(),
    scopeLocationId: z.string().nullable(),
    status: z.enum(CUSTODY_STOCKTAKE_STATUSES),
    openedAt: z.string(),
    openedByUserId: z.string().nullable(),
    closedAt: z.string().nullable(),
    closedByUserId: z.string().nullable(),
    // Frozen when the count closed; absent while it is open and on an abandoned count.
    counts: CustodyStocktakeCounts.nullable(),
    note: z.string().nullable(),
  })
  .openapi("CustodyStocktake");

const OpenCustodyStocktakeRequest = z
  .object({
    name: z.string().min(1).max(200),
    // The branch of the container tree this count covers, including everything beneath it. Absent
    // counts the whole register.
    scopeLocationId: identifierField("custodyLocation").optional(),
    openedAt: z.string().max(40).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("OpenCustodyStocktakeRequest");

const CustodySightingInput = z
  .object({
    kind: z.enum(CUSTODY_SIGHTING_KINDS),
    packetId: identifierField("custodyPacket").optional(),
    itemId: identifierField("custodyItem").optional(),
    locationId: identifierField("custodyLocation").optional(),
    description: z
      .string()
      .max(2000)
      .optional()
      .describe(
        "What was physically found, in the observer's words. Required on an unregistered observation: it is the only record of that object anywhere.",
      ),
    observedAt: z.string().max(40).optional(),
    note: z.string().max(2000).optional(),
  })
  .openapi("CustodySightingInput");

const RecordCustodySightingsRequest = z
  .object({
    // A batch, because a person walking a safe with a scanner produces observations in bursts and
    // one round trip per shelf beats one per envelope. Every observation in a request commits
    // atomically: a half-recorded batch would report property as missing that was in fact counted.
    sightings: z.array(CustodySightingInput).min(1).max(MAX_CUSTODY_SIGHTINGS_PER_BATCH),
  })
  .openapi("RecordCustodySightingsRequest");

const RecordedCustodySightingsResponse = z
  .object({ ids: z.array(z.string()) })
  .openapi("RecordedCustodySightingsResponse");

const CustodySighting = z
  .object({
    id: z.string(),
    kind: z.enum(CUSTODY_SIGHTING_KINDS),
    packetId: z.string().nullable(),
    itemId: z.string().nullable(),
    locationId: z.string().nullable(),
    // Where the register expected the packet at the moment this observation was recorded, frozen on
    // the row — so "sighted on the wrong shelf" stays true after somebody moves it to the right one.
    expectedLocationId: z.string().nullable(),
    description: z.string().nullable(),
    observedAt: z.string(),
    recordedAt: z.string(),
    observedByUserId: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi("CustodySighting");

const CustodyReconciliationLine = z
  .object({
    outcome: z.enum(CUSTODY_RECONCILIATION_OUTCOMES),
    packetId: z.string().nullable(),
    custodyNumber: z.string().nullable(),
    packetName: z.string().nullable(),
    packetStatus: z.enum(CUSTODY_PACKET_STATUSES).nullable(),
    expectedLocationId: z.string().nullable(),
    sightedLocationId: z.string().nullable(),
    description: z.string().nullable(),
    observedAt: z.string().nullable(),
    observedByUserId: z.string().nullable(),
    // The movement a person WOULD record to put the register right. A suggestion printed on a
    // report: nothing records it, and nothing in this subsystem records it later either. A missing
    // packet proposes nothing at all, because the honest answer to an empty shelf is an
    // investigation, not a ledger entry closing the record on it.
    proposedMovementKind: z.enum(CUSTODY_MOVEMENT_KINDS).nullable(),
    proposedToLocationId: z.string().nullable(),
  })
  .openapi("CustodyReconciliationLine");

const CustodyReconciliation = z
  .object({
    stocktakeId: z.string(),
    name: z.string(),
    status: z.enum(CUSTODY_STOCKTAKE_STATUSES),
    scopeLocationId: z.string().nullable(),
    openedAt: z.string(),
    closedAt: z.string().nullable(),
    matchedCount: z.number().int(),
    missing: z.array(CustodyReconciliationLine),
    misplaced: z.array(CustodyReconciliationLine),
    unexpected: z.array(CustodyReconciliationLine),
    unregistered: z.array(CustodyReconciliationLine),
    // What the count found, frozen when it closed. The lists above are recomputed against a register
    // that keeps moving, so they answer "what is different now"; this answers "what did the count
    // find". The two disagreeing is not a fault — it is the register having been put right since.
    frozenCounts: CustodyStocktakeCounts.nullable(),
    truncated: z
      .boolean()
      .describe(
        "TRUE when this register is larger than the reconciliation reads in one pass. A truncated report is a PARTIAL answer: packets past the cut were never expected, so they were never reported missing, and every count here is a floor rather than a finding. A count in this state cannot be closed with its numbers frozen; narrow its scope or abandon it.",
      ),
    rowLimit: z.number().int().describe("The per-read cap that produced `truncated`."),
  })
  .openapi("CustodyReconciliation");

const CloseCustodyStocktakeRequest = z
  .object({
    abandoned: z
      .boolean()
      .optional()
      .describe(
        "Ends a count that was never finished. An abandoned count freezes no findings: the reconciliation of a half-done walk reads as a safe full of missing originals, which would be alarming and wrong.",
      ),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("CloseCustodyStocktakeRequest");

const ClosedCustodyStocktakeResponse = z
  .object({
    id: z.string(),
    status: z.enum(["closed", "abandoned"]),
    counts: CustodyStocktakeCounts.nullable(),
    truncated: z
      .boolean()
      .describe(
        "TRUE when the walk was larger than the reconciliation reads in one pass. Only ever true on an abandoned close: a close that freezes counts refuses a truncated reconciliation rather than freezing a partial answer.",
      ),
  })
  .openapi("ClosedCustodyStocktakeResponse");

const IdAck = z.object({ id: z.string() }).openapi("CustodyIdAck");
const Ack = z.object({ ok: z.boolean() }).openapi("CustodyAck");

// A comma-separated identifier list in a query string. Labels are a read over a selection the person
// made in the register, and a GET with the selection in the URL is what makes "print this again"
// a bookmark rather than a re-selection.
function identifierList(prefix: string) {
  return z
    .string()
    .max(2000)
    .optional()
    .transform((value) =>
      value === undefined || value.trim().length === 0
        ? []
        : value.split(",").map((id) => id.trim()),
    )
    .refine(
      (ids) => ids.every((id) => id.startsWith(`${prefix}_`)),
      `every id must be a ${prefix} handle`,
    );
}

// ---- destruction ----
//
// Destroying a client's original is the only thing in this subsystem that takes two people, and it
// is deliberately FOUR calls rather than one with a flag: raise, approve, execute, and the refusal
// path beside them. A single endpoint that took a requester and an approver in one body would be one
// person typing two names.
//
// There is no override parameter anywhere on this surface. An item recorded as an irreplaceable
// original is refused, a hold is refused, and neither refusal has a query string that turns it off.

const destructionRequestIdParam = z.object({
  destructionRequestId: identifierPathParam("custodyDestructionRequest", "destructionRequestId"),
});

const CustodyDestructionRequest = z
  .object({
    id: z.string(),
    packetId: z.string(),
    itemId: z.string().nullable(),
    requestedBy: z.string().nullable(),
    requestedAt: z.string(),
    basis: z.string(),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    refusedBy: z.string().nullable(),
    refusedAt: z.string().nullable(),
    refusalReason: z.string().nullable(),
    executedAt: z.string().nullable(),
    executedBy: z.string().nullable(),
    executedMovementId: z.string().nullable(),
    // Absent means the request is still waiting for a second person.
    outcome: z.enum(CUSTODY_DESTRUCTION_OUTCOMES).nullable(),
  })
  .openapi("CustodyDestructionRequest");

const CustodyDestructionRequestPage = paginated(CustodyDestructionRequest).openapi(
  "CustodyDestructionRequestPage",
);

const RaiseCustodyDestructionRequest = z
  .object({
    packetId: identifierField("custodyPacket"),
    // Scoping to one item destroys that item; omitting it destroys the packet and everything in it.
    itemId: identifierField("custodyItem").optional(),
    // Required, and never defaulted. Nothing in this subsystem derives a reason to destroy a
    // client's property; a person writes down why and what authorizes it, in their own words.
    basis: z.string().min(1).max(4000),
  })
  .openapi("RaiseCustodyDestructionRequest");

const RefuseCustodyDestructionRequestBody = z
  .object({ reason: z.string().max(4000).nullable().optional() })
  .openapi("RefuseCustodyDestructionRequest");

const ExecuteCustodyDestructionRequestBody = z
  .object({
    // What was actually done to the property — shredded, incinerated, witnessed. Recorded on the
    // ledger row, because "destroyed" alone does not answer the question anyone will later ask.
    method: z.string().max(1000).nullable().optional(),
    occurredAt: z.string().max(40).optional(),
  })
  .openapi("ExecuteCustodyDestructionRequest");

const ExecutedCustodyDestructionResponse = z
  .object({
    id: z.string(),
    packetId: z.string(),
    // The append-only ledger row the destruction wrote. It is the record of what happened; the
    // request row is the record of who agreed to it.
    movementId: z.string(),
    executedAt: z.string(),
  })
  .openapi("ExecutedCustodyDestruction");

// ---- will-deposit duties ----

const CustodyWillDuty = z
  .object({
    key: z.string(),
    summary: z.string(),
    trigger: z.string(),
    dutyHolder: z.string(),
    deadlineBasis: z.enum(CUSTODY_WILL_DEADLINE_BASES),
    deadlineDays: z.number().int().nullable(),
    deliveryTargets: z.array(z.string()),
    consequenceOfNeglect: z.string().nullable(),
    sideEffects: z.array(z.string()),
    citation: z.string(),
    // The operative text of the law, quoted exactly. A firm can check a quotation against the
    // published statute; it cannot check a paraphrase against anything.
    statutoryText: z.string(),
    sourceUrl: z.string(),
    verifiedOn: z.string(),
  })
  .openapi("CustodyWillDuty");

// The question and the ANSWER, as two fields. A single description of the procedure would read as an
// offer wherever it is rendered in a list, with the negation living only in the boolean beside it —
// which is how never-enacted uniform-act deposit language gets believed to be a state's law.
const CustodyWillCapability = z
  .object({
    key: z.string(),
    question: z.string().describe("What was asked, phrased as a question."),
    answer: z
      .string()
      .describe("The verified answer, phrased to stand alone with no other field beside it."),
    available: z.boolean(),
    basis: z.string(),
    verifiedOn: z.string(),
  })
  .openapi("CustodyWillCapability");

const CustodyWillDuties = z
  .object({
    jurisdictionKey: z.string(),
    name: z.string(),
    duties: z.array(CustodyWillDuty),
    capabilities: z.array(CustodyWillCapability),
    encodedSubJurisdictionKeys: z.array(z.string()),
    compiledThrough: z.string(),
    encodedJurisdictionKeys: z.array(z.string()),
  })
  .openapi("CustodyWillDuties");

// ---- route metas ----
//
// Every custody:* route binds resource: "firm". This is a deliberate call against the files:*
// precedent (which binds "matter"): a custody packet's tenancy root is the FIRM, because a packet may
// have no matter at all by construction — a will held for a client whose last matter closed eleven
// years ago is the steady state, not an edge case. Binding to "matter" would name a resource half
// the rows do not have.

function readMeta(action: string): RouteMeta {
  return {
    operationId: `custody.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string, idempotency: "required" | "optional"): RouteMeta {
  return {
    operationId: `custody.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    idempotency,
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listLocationsRoute = defineOpenAPIRoute(readMeta("listLocations"), {
  method: "get",
  path: "/api/v1/custody/locations",
  description:
    "Returns every node of the firm's physical custody tree, flat with parent ids — the client " +
    "assembles the tree. A root node either names one of the firm's offices or stands for an " +
    "external site such as a bank vault or an offsite records vendor.",
  responses: {
    200: {
      description: "The custody location tree",
      content: { "application/json": { schema: z.object({ data: z.array(CustodyLocation) }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createLocationRoute = defineOpenAPIRoute(writeMeta("createLocation", "required"), {
  method: "post",
  path: "/api/v1/custody/locations",
  description:
    "Creates a node of the custody tree — an office, room, safe, cabinet, shelf, box, position, " +
    "offsite site, or bank vault. A node nested into its own subtree, or nested past the depth " +
    "limit, is refused.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: CreateCustodyLocationRequest } },
      required: true,
    },
  },
  responses: {
    201: { description: "The created node", content: { "application/json": { schema: IdAck } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updateLocationRoute = defineOpenAPIRoute(writeMeta("updateLocation", "optional"), {
  method: "patch",
  path: "/api/v1/custody/locations/{locationId}",
  description:
    "Renames, re-parents, or closes a custody location. Closing is refused while the node or " +
    "anything beneath it still physically holds a packet — the contents have to be moved somewhere " +
    "the register can name first.",
  request: {
    params: locationIdParam,
    body: {
      content: { "application/json": { schema: UpdateCustodyLocationRequest } },
      required: true,
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: Ack } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listPacketsRoute = defineOpenAPIRoute(readMeta("listPackets"), {
  method: "get",
  path: "/api/v1/custody/packets",
  description:
    "Lists custody packets, filtered by owner entity, matter, status, or a location subtree (which " +
    "includes every box and position beneath the node named). Cursor-paginated.",
  request: {
    query: cursorQuery.extend({
      status: z.enum(CUSTODY_PACKET_STATUSES).optional(),
      ownerEntityId: directoryEntityId.optional(),
      matterId: identifierField("matter").optional(),
      locationSubtreeId: identifierField("custodyLocation").optional(),
      search: z.string().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of packets",
      content: { "application/json": { schema: CustodyPacketPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createPacketRoute = defineOpenAPIRoute(writeMeta("createPacket", "required"), {
  method: "post",
  path: "/api/v1/custody/packets",
  description:
    "Logs a packet into the register: draws its firm-scoped custody number, records at least one " +
    "Directory owner, and opens its custody ledger, all in one commit. A packet with no owner is " +
    "refused — an original held for nobody the firm can name can never be released and never be " +
    "destroyed. The matter link is optional and usually absent.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: CreateCustodyPacketRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The logged packet",
      content: { "application/json": { schema: CreatedCustodyPacketResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const getPacketRoute = defineOpenAPIRoute(readMeta("getPacket"), {
  method: "get",
  path: "/api/v1/custody/packets/{packetId}",
  description:
    "Returns a packet with its items, owners, holds, scans, and the breadcrumb of its current " +
    "location — plus the matter its scans are filed on.",
  request: { params: packetIdParam },
  responses: {
    200: {
      description: "The packet",
      content: { "application/json": { schema: CustodyPacketDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const updatePacketRoute = defineOpenAPIRoute(writeMeta("updatePacket", "optional"), {
  method: "patch",
  path: "/api/v1/custody/packets/{packetId}",
  description:
    "Updates a packet's descriptive fields. Status and location are never set here — both change " +
    "only by recording a movement, so the register always has a ledger entry explaining them.",
  request: {
    params: packetIdParam,
    body: {
      content: { "application/json": { schema: UpdateCustodyPacketRequest } },
      required: true,
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: Ack } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const addItemRoute = defineOpenAPIRoute(writeMeta("addItem", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/items",
  description:
    "Describes one thing inside a packet — an original will, a deed, a share certificate, a key — " +
    "and records that the firm now asserts what the envelope contains.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: { content: { "application/json": { schema: AddCustodyItemRequest } }, required: true },
  },
  responses: {
    201: { description: "The added item", content: { "application/json": { schema: IdAck } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updateItemRoute = defineOpenAPIRoute(writeMeta("updateItem", "optional"), {
  method: "patch",
  path: "/api/v1/custody/packets/{packetId}/items/{itemId}",
  description:
    "Updates an item's descriptive fields. An item never changes packet by an edit — moving it is " +
    "recorded as a movement, so the register can say when it happened.",
  request: {
    params: packetItemParams,
    body: { content: { "application/json": { schema: UpdateCustodyItemRequest } }, required: true },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: Ack } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const addOwnerRoute = defineOpenAPIRoute(writeMeta("addOwner", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/owners",
  description:
    "Adds a Directory owner to a packet. Ownership is temporal: a change adds the new owner and " +
    "end-dates the old one, so who owned what and when stays answerable.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: { content: { "application/json": { schema: CustodyOwnerInput } }, required: true },
  },
  responses: {
    201: {
      description: "The added owner link",
      content: { "application/json": { schema: IdAck } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const recordMovementRoute = defineOpenAPIRoute(writeMeta("recordMovement", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/movements",
  description:
    "Records a custody event — a move, a check-out to a named borrower with a due-back date, a " +
    "return, a withdrawal, a release, a loss, or a correction. This is the only way a packet's " +
    "status or location ever changes, and the entry is appended: a mistake is fixed by recording a " +
    "correction that names the entry it corrects, never by editing history.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: {
      content: { "application/json": { schema: RecordCustodyMovementRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The recorded movement",
      content: { "application/json": { schema: RecordedCustodyMovementResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listMovementsRoute = defineOpenAPIRoute(readMeta("listMovements"), {
  method: "get",
  path: "/api/v1/custody/packets/{packetId}/movements",
  description:
    "Returns a packet's full custody history, newest first and cursor-paginated. Ordered by when " +
    "each event happened, not by when it was typed in. Narrowing by itemId answers one item's own " +
    "chain of custody, which is its own entries PLUS the packet-wide ones: an item inside a packet " +
    "goes wherever the packet goes, so a history of only the rows naming the item would leave out " +
    "every move it actually made. Each row carries itemId, so a reader can tell the two apart.",
  request: {
    params: packetIdParam,
    query: cursorQuery.extend({ itemId: identifierField("custodyItem").optional() }),
  },
  responses: {
    200: {
      description: "A page of the packet's history",
      content: { "application/json": { schema: CustodyMovementPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const placeHoldRoute = defineOpenAPIRoute(writeMeta("placeHold", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/holds",
  description:
    "Places a hold on a packet or one of its items. A hold forbids releasing or destroying the " +
    "property; it deliberately does not prevent moving it, because a held original still has to be " +
    "movable to a safer place.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: { content: { "application/json": { schema: PlaceCustodyHoldRequest } }, required: true },
  },
  responses: {
    201: { description: "The placed hold", content: { "application/json": { schema: IdAck } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const releaseHoldRoute = defineOpenAPIRoute(writeMeta("releaseHold", "required"), {
  method: "post",
  path: "/api/v1/custody/holds/{holdId}/release",
  description:
    "Releases a hold. The hold row is kept and marked released, never removed, and the release is " +
    "recorded in the packet's history.",
  request: { headers: idempotencyKeyHeader, params: holdIdParam },
  responses: {
    200: { description: "Released", content: { "application/json": { schema: Ack } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const linkScanRoute = defineOpenAPIRoute(writeMeta("linkScan", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/scans",
  description:
    "Links an already-uploaded document to a packet or one of its items as a scan, photograph, " +
    "receipt, appraisal, or correspondence. The file is uploaded through the ordinary file path " +
    "first, onto the matter this packet's scans are filed on. A scan never stands in for the " +
    "original and never permits anything the original would not.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: { content: { "application/json": { schema: LinkCustodyScanRequest } }, required: true },
  },
  responses: {
    201: { description: "The linked scan", content: { "application/json": { schema: IdAck } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listItemTypesRoute = defineOpenAPIRoute(readMeta("listItemTypes"), {
  method: "get",
  path: "/api/v1/custody/item-types",
  description: "Returns the firm's custody item-type catalog.",
  request: { query: z.object({ includeInactive: z.enum(["true", "false"]).optional() }) },
  responses: {
    200: {
      description: "The catalog",
      content: { "application/json": { schema: z.object({ data: z.array(CustodyItemType) }) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createItemTypeRoute = defineOpenAPIRoute(writeMeta("createItemType", "optional"), {
  method: "post",
  path: "/api/v1/custody/item-types",
  description:
    "Adds a custody item type. Types are deactivated rather than deleted, so every item already " +
    "classified under one keeps its meaning.",
  request: {
    body: {
      content: { "application/json": { schema: CreateCustodyItemTypeRequest } },
      required: true,
    },
  },
  responses: {
    201: { description: "The created type", content: { "application/json": { schema: IdAck } } },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const deactivateItemTypeRoute = defineOpenAPIRoute(
  {
    ...writeMeta("deactivateItemType", "optional"),
    reversal: {
      kind: "none",
      reason:
        "The type is kept so every item classified under it keeps its meaning, but no route makes a deactivated type offerable again.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/custody/item-types/{itemTypeId}",
    description:
      "Deactivates a custody item type. The type is kept; new items can no longer use it.",
    request: {
      params: z.object({ itemTypeId: identifierPathParam("custodyItemType", "itemTypeId") }),
    },
    responses: {
      200: { description: "Deactivated", content: { "application/json": { schema: Ack } } },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const listOverdueRoute = defineOpenAPIRoute(readMeta("listOverdue"), {
  method: "get",
  path: "/api/v1/custody/overdue",
  description:
    "Lists packets that are still checked out past their due-back date, most overdue first — the " +
    "day-to-day signal the register exists to produce.",
  request: { query: z.object({ asOf: z.string().max(40).optional() }).merge(cursorQuery) },
  responses: {
    200: {
      description: "One page of overdue check-outs",
      content: { "application/json": { schema: paginated(OverdueCustodyCheckout) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const completeReviewRoute = defineOpenAPIRoute(writeMeta("completeReview", "required"), {
  method: "post",
  path: "/api/v1/custody/packets/{packetId}/reviews",
  description:
    "Records that a packet, or one item inside it, has been looked at again, and rolls its review " +
    "date forward by the firm's own interval. The next date lands on the original anniversary " +
    "rather than a period after today, so a review done late does not drag the cycle with it. A " +
    "review is not a deadline and nothing expires when one passes.",
  request: {
    headers: idempotencyKeyHeader,
    params: packetIdParam,
    body: {
      content: { "application/json": { schema: CompleteCustodyReviewRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The recorded review",
      content: { "application/json": { schema: CompletedCustodyReviewResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listRemindersRoute = defineOpenAPIRoute(readMeta("listReminders"), {
  method: "get",
  path: "/api/v1/custody/reminders",
  description:
    "What the register is waiting on, in one list, oldest first: review dates that have come round " +
    "and check-outs that have not come back. This is the single place those two are decided, so a " +
    "reminder that arrives by any other route says the same thing this one does. Each reason is " +
    "capped rather than paged — the merge of the two has no single sort column a cursor could seek " +
    "on — and `capped` is true when either reason has more due than the answer names.",
  request: { query: z.object({ asOf: z.string().max(40).optional() }) },
  responses: {
    200: {
      description: "Reminders due",
      content: { "application/json": { schema: capped(CustodyReminder) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const holdingsByOwnerRoute = defineOpenAPIRoute(readMeta("reportHoldingsByOwner"), {
  method: "get",
  path: "/api/v1/custody/reports/holdings-by-owner",
  description:
    "What the firm currently holds for each person or organization: packets in the safe, packets " +
    "out, items described, and packets under hold. Owners are returned as directory handles, not " +
    "names — the caller resolves them through the directory it already reads. Biggest holders " +
    "first, capped at `limit` rather than paged; `capped` is true when the firm holds for more " +
    "owners than the answer names.",
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }) },
  responses: {
    200: {
      description: "Holdings for the biggest holders, and whether the firm has more",
      content: { "application/json": { schema: capped(CustodyHoldingsByOwner) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const holdingsByLocationRoute = defineOpenAPIRoute(readMeta("reportHoldingsByLocation"), {
  method: "get",
  path: "/api/v1/custody/reports/holdings-by-location",
  description:
    "The container tree with occupancy counts — what is at each node, and what is at that node or " +
    "anywhere beneath it. A packet that is checked out is at no location, so a shelf whose contents " +
    "are all out reads as empty, which is what a person standing in front of it would see.",
  responses: {
    200: {
      description: "Occupancy per location",
      content: {
        "application/json": { schema: z.object({ data: z.array(CustodyLocationOccupancy) }) },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const holdsReportRoute = defineOpenAPIRoute(readMeta("reportHolds"), {
  method: "get",
  path: "/api/v1/custody/reports/holds",
  description:
    "Every hold in force across the register, oldest first. A hold nobody can see is a hold nobody " +
    "will remember to release.",
  request: { query: cursorQuery },
  responses: {
    200: {
      description: "One page of packets under hold",
      content: { "application/json": { schema: paginated(CustodyPacketUnderHold) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const openStocktakeRoute = defineOpenAPIRoute(writeMeta("openStocktake", "required"), {
  method: "post",
  path: "/api/v1/custody/stocktakes",
  description:
    "Opens a physical count of the register, or of one branch of the container tree and everything " +
    "beneath it. A stocktake only observes: nothing it records disposes of property, relocates it, " +
    "or changes the register. Counting a safe leaves every packet, item, and ledger entry exactly " +
    "as it was.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: OpenCustodyStocktakeRequest } },
      required: true,
    },
  },
  responses: {
    201: { description: "The opened count", content: { "application/json": { schema: IdAck } } },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listStocktakesRoute = defineOpenAPIRoute(readMeta("listStocktakes"), {
  method: "get",
  path: "/api/v1/custody/stocktakes",
  description:
    "Lists physical counts, most recently opened first, with the findings frozen on each closed one. " +
    "Capped at `limit` rather than paged; `capped` is true when the firm has counted more than the " +
    "answer carries.",
  request: {
    query: z.object({
      status: z.enum(CUSTODY_STOCKTAKE_STATUSES).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Stocktakes",
      content: { "application/json": { schema: capped(CustodyStocktake) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getStocktakeRoute = defineOpenAPIRoute(readMeta("getStocktake"), {
  method: "get",
  path: "/api/v1/custody/stocktakes/{stocktakeId}",
  description: "Returns one physical count and, once it has closed, what it found.",
  request: { params: stocktakeIdParam },
  responses: {
    200: {
      description: "The stocktake",
      content: { "application/json": { schema: CustodyStocktake } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const recordSightingsRoute = defineOpenAPIRoute(writeMeta("recordSightings", "required"), {
  method: "post",
  path: "/api/v1/custody/stocktakes/{stocktakeId}/sightings",
  description:
    "Records what the counters saw, as a batch: a packet seen at a location, a packet looked for " +
    "and not found, or an object on the shelf the register has no row for. Each observation is " +
    "append-only — it is a named person's assertion about a physical object on a day, and the " +
    "database refuses to update or delete one. A mistake is corrected by recording the later, truer " +
    "observation; both stay on the record. Recording an observation changes nothing about the " +
    "packet it names.",
  request: {
    headers: idempotencyKeyHeader,
    params: stocktakeIdParam,
    body: {
      content: { "application/json": { schema: RecordCustodySightingsRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The recorded observations",
      content: { "application/json": { schema: RecordedCustodySightingsResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listSightingsRoute = defineOpenAPIRoute(readMeta("listSightings"), {
  method: "get",
  path: "/api/v1/custody/stocktakes/{stocktakeId}/sightings",
  description:
    "The observations recorded during a count, oldest first, each with where the register expected " +
    "the packet at the moment it was observed. Capped at `limit` rather than paged — a count's " +
    "observations are read against the reconciliation of the same count, and half a count " +
    "reconciles to a wrong answer rather than a short one. `capped` is true when the count " +
    "recorded more than the answer names.",
  request: {
    params: stocktakeIdParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }),
  },
  responses: {
    200: {
      description: "Observations",
      content: { "application/json": { schema: capped(CustodySighting) } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const reconciliationRoute = defineOpenAPIRoute(readMeta("stocktakeReconciliation"), {
  method: "get",
  path: "/api/v1/custody/stocktakes/{stocktakeId}/reconciliation",
  description:
    "What the count found, against what the register expected: packets expected and not seen " +
    "(missing), packets seen somewhere other than where the register said (misplaced), packets seen " +
    "where the register did not expect them at all (unexpected), and objects on the shelf with no " +
    "register row (unregistered). Readable while the count is still running, so a long walk shows " +
    "its progress. Each line names the movement a person would record to put the register right — " +
    "a proposal on a report, never a write. Acting on one means recording that movement yourself, " +
    "which is the only way this register ever changes.",
  request: { params: stocktakeIdParam },
  responses: {
    200: {
      description: "The reconciliation",
      content: { "application/json": { schema: CustodyReconciliation } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const closeStocktakeRoute = defineOpenAPIRoute(writeMeta("closeStocktake", "required"), {
  method: "post",
  path: "/api/v1/custody/stocktakes/{stocktakeId}/close",
  description:
    "Closes a count and freezes what it found. It writes the stocktake row and nothing else: no " +
    "movement is recorded, no packet is moved, and no status anywhere in the register changes " +
    "because a count finished. A count that was never finished closes as abandoned instead, " +
    "freezing no findings. A count whose reconciliation is truncated is REFUSED rather than frozen: " +
    "a partial answer under-reports missing originals, so narrow the count's scope or abandon it.",
  request: {
    headers: idempotencyKeyHeader,
    params: stocktakeIdParam,
    body: {
      content: { "application/json": { schema: CloseCustodyStocktakeRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The closed count and its findings",
      content: { "application/json": { schema: ClosedCustodyStocktakeResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const renderLabelsRoute = defineOpenAPIRoute(readMeta("renderLabels"), {
  method: "get",
  path: "/api/v1/custody/labels",
  description:
    "Returns a printable label sheet as SVG for the packets and locations named, at true size on " +
    "A4 label stock. Each label carries a scannable barcode of the object's own identifier, the " +
    "custody number or node name in large type, and the packet name. Start part-way down a " +
    "partly-used sheet with startPosition. One sheet per request — a label that fell onto a second " +
    "page is a label that ends up on the wrong box.",
  request: {
    query: z.object({
      packetIds: identifierList("custodyPacket"),
      locationIds: identifierList("custodyLocation"),
      startPosition: z.coerce
        .number()
        .int()
        .min(0)
        .max(CUSTODY_LABELS_PER_SHEET - 1)
        .optional(),
    }),
  },
  responses: {
    200: {
      description: "The label sheet",
      content: { "image/svg+xml": { schema: z.string() } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listDestructionRequestsRoute = defineOpenAPIRoute(readMeta("listDestructionRequests"), {
  method: "get",
  path: "/api/v1/custody/destruction-requests",
  description:
    "Lists destruction requests, newest first, optionally narrowed to one packet or to a single " +
    "state. `outcome=pending` is the queue of requests waiting for a second person to approve or " +
    "refuse them. `outcome=interrupted` is the reconciliation list: approved requests for which a " +
    "destruction was already recorded in the ledger but whose own row never reached `executed`, " +
    "which is what a failure between the two commits leaves behind. The ledger commits first on " +
    "purpose — a destruction with no ledger entry is one nobody can prove — so this list is how " +
    "the cost of that ordering gets found and put right. Cursor-paginated.",
  request: {
    query: cursorQuery.extend({
      packetId: identifierField("custodyPacket").optional(),
      outcome: z.enum(["pending", "interrupted", ...CUSTODY_DESTRUCTION_OUTCOMES]).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of destruction requests",
      content: { "application/json": { schema: CustodyDestructionRequestPage } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const raiseDestructionRequestRoute = defineOpenAPIRoute(
  writeMeta("raiseDestructionRequest", "required"),
  {
    method: "post",
    path: "/api/v1/custody/destruction-requests",
    description:
      "Raises a request to destroy a packet, or one item inside it, recording the reason and the " +
      "authority the requester asserts. Raising a request destroys nothing: a different person has " +
      "to approve it, and a third call carries it out. The request is refused outright while any " +
      "hold is in force, and refused outright where the property is recorded as an irreplaceable " +
      "original — that refusal has no override on this surface, and the only way past it is for " +
      "somebody to change that record about the object itself.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: RaiseCustodyDestructionRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The raised request",
        content: { "application/json": { schema: IdAck } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const approveDestructionRequestRoute = defineOpenAPIRoute(
  writeMeta("approveDestructionRequest", "required"),
  {
    method: "post",
    path: "/api/v1/custody/destruction-requests/{destructionRequestId}/approve",
    description:
      "Approves a destruction request. The approver must be a different person from the requester, " +
      "which is enforced at the database as well as here. Approval authorizes the destruction; it " +
      "does not carry it out.",
    request: { headers: idempotencyKeyHeader, params: destructionRequestIdParam },
    responses: {
      200: { description: "Approved", content: { "application/json": { schema: Ack } } },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const refuseDestructionRequestRoute = defineOpenAPIRoute(
  writeMeta("refuseDestructionRequest", "required"),
  {
    method: "post",
    path: "/api/v1/custody/destruction-requests/{destructionRequestId}/refuse",
    description:
      "Refuses a destruction request, optionally recording why. Anyone who can manage the register " +
      "may refuse one, including the person who raised it: ending a client's property takes two " +
      "people, and deciding not to takes nobody's agreement.",
    request: {
      headers: idempotencyKeyHeader,
      params: destructionRequestIdParam,
      body: {
        content: { "application/json": { schema: RefuseCustodyDestructionRequestBody } },
        required: false,
      },
    },
    responses: {
      200: { description: "Refused", content: { "application/json": { schema: Ack } } },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const executeDestructionRequestRoute = defineOpenAPIRoute(
  writeMeta("executeDestructionRequest", "required"),
  {
    method: "post",
    path: "/api/v1/custody/destruction-requests/{destructionRequestId}/execute",
    description:
      "Records that an approved destruction was carried out. This appends a `destroyed` movement " +
      "through the register's one movement write path, so the destruction carries a person's name " +
      "on the same append-only ledger every other event does. Both refusals are asked again here: " +
      "a hold placed since the approval, and an irreplaceable original recorded since it.",
    request: {
      headers: idempotencyKeyHeader,
      params: destructionRequestIdParam,
      body: {
        content: { "application/json": { schema: ExecuteCustodyDestructionRequestBody } },
        required: false,
      },
    },
    responses: {
      200: {
        description: "The recorded destruction",
        content: { "application/json": { schema: ExecutedCustodyDestructionResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const willDutiesRoute = defineOpenAPIRoute(readMeta("willDepositDuties"), {
  method: "get",
  path: "/api/v1/custody/will-deposit-duties",
  description:
    "Returns what the law of one jurisdiction says a holder of a will must do, quoted from the " +
    "statute or court rule with its citation. A jurisdiction with no verified entry is REFUSED " +
    "rather than answered: there is no baseline and no fallback, because a confidently wrong answer " +
    "about a statutory duty is one a firm will act on. A jurisdiction below an encoded one (a " +
    "county or judicial district) is refused on its own terms even when its state is encoded, " +
    "because a local rule nobody verified is not the same as a local rule that does not exist. " +
    "This returns the text of the law and nothing else — it is not advice, and it decides nothing " +
    "the sources leave open.",
  request: { query: z.object({ jurisdiction: z.string().min(1).max(20) }) },
  responses: {
    200: {
      description: "The encoded duties for that jurisdiction",
      content: { "application/json": { schema: CustodyWillDuties } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

// ---- registration ----

function serviceOptions(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
  };
}

export function registerCustodyRoutes(app: CustodyApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...listLocationsRoute, middleware: chokepointMiddleware(chokepoint, listLocationsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await selectAllCustodyLocationsStatement(firm.firmDatabase).all<{
        id: string;
        name: string;
        kind: string;
        parent_location_id: string | null;
        firm_location_id: string | null;
        address: string | null;
        status: string;
        notes: string | null;
      }>();
      return c.json({ data: results.map(locationView) } as never, 200);
    },
  );

  app.openapi(
    { ...createLocationRoute, middleware: chokepointMiddleware(chokepoint, createLocationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      try {
        const { locationId, effect } = await createCustodyLocation(
          firm.firmDatabase,
          {
            name: request.name,
            kind: request.kind,
            parentLocationId: request.parentLocationId,
            firmLocationId: request.firmLocationId,
            address: request.address,
            notes: request.notes,
          },
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, {
          now: () => new Date().toISOString(),
          idempotencyRecord: undefined,
        });
        return c.json({ id: locationId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...updateLocationRoute, middleware: chokepointMiddleware(chokepoint, updateLocationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { locationId } = c.req.valid("param");
      const request = c.req.valid("json");
      const options = serviceOptions(c);
      try {
        // Closing and editing are separate refusals with separate reasons, so they are separate
        // calls rather than one branchy write.
        if (request.close === true) {
          const { effect } = await closeCustodyLocation(firm.firmDatabase, locationId, options);
          await commitEffectBatch(firm.firmDatabase, effect, {
            now: () => new Date().toISOString(),
          });
        }
        const hasFieldEdits =
          request.name !== undefined ||
          request.parentLocationId !== undefined ||
          request.address !== undefined ||
          request.notes !== undefined;
        if (hasFieldEdits) {
          const { effect } = await updateCustodyLocation(
            firm.firmDatabase,
            locationId,
            {
              name: request.name,
              parentLocationId: request.parentLocationId,
              address: request.address,
              notes: request.notes,
            },
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, {
            now: () => new Date().toISOString(),
          });
        }
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listPacketsRoute, middleware: chokepointMiddleware(chokepoint, listPacketsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listCustodyPackets(firm.firmDatabase, {
        cursor: query.cursor,
        status: query.status,
        ownerEntityId: query.ownerEntityId,
        matterId: query.matterId,
        locationSubtreeId: query.locationSubtreeId,
        search: query.search,
      });
      return c.json(page as never, 200);
    },
  );

  app.openapi(
    { ...createPacketRoute, middleware: chokepointMiddleware(chokepoint, createPacketRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      try {
        const created = await createCustodyPacket(
          firm.firmDatabase,
          {
            name: request.name,
            owners: request.owners,
            currentLocationId: request.currentLocationId,
            matterId: request.matterId,
            depositorEntityId: request.depositorEntityId,
            depositedAt: request.depositedAt,
            notes: request.notes,
            manualCustodyNumber: request.manualCustodyNumber,
          },
          {
            ...serviceOptions(c),
            responsibleMemberId: requireChokepointUserId(c),
            idempotency,
          },
        );
        return c.json(
          {
            id: created.packetId,
            custodyNumber: created.custodyNumber,
            filingMatterId: created.filingMatterId,
          } as never,
          201,
        );
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...getPacketRoute, middleware: chokepointMiddleware(chokepoint, getPacketRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const packet = await readCustodyPacket(firm.firmDatabase, packetId);
      if (packet === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such custody packet in this firm.",
        });
      }
      const [items, owners, holds, scans, filingMatterId] = await Promise.all([
        readCustodyItems(firm.firmDatabase, packetId),
        readCustodyOwners(firm.firmDatabase, packetId),
        readActiveCustodyHolds(firm.firmDatabase, packetId),
        readCustodyScans(firm.firmDatabase, packetId),
        resolveCustodyFilingMatter(firm.firmDatabase, packetId),
      ]);
      const locationPath =
        packet.current_location_id === null
          ? []
          : await readCustodyLocationPath(firm.firmDatabase, packet.current_location_id);
      return c.json(
        {
          id: packet.id,
          custodyNumber: packet.custody_number,
          numberSource: packet.number_source,
          name: packet.name,
          status: packet.status,
          matterId: packet.matter_id,
          depositorEntityId: packet.depositor_entity_id,
          depositedAt: packet.deposited_at,
          reviewOn: packet.review_on,
          reviewIntervalMonths: packet.review_interval_months,
          notes: packet.notes,
          locationPath: locationPath.map(locationView),
          filingMatterId: filingMatterId ?? null,
          items: items.map((item) => ({
            id: item.id,
            ordinal: item.ordinal,
            itemTypeId: item.item_type_id,
            description: item.description,
            instrumentDate: item.instrument_date,
            intrinsicValue: item.intrinsic_value === 1,
            declaredValueAmountMinor: item.declared_value_amount_minor,
            declaredValueCurrency: item.declared_value_currency,
            status: item.status,
            reviewOn: item.review_on,
            reviewIntervalMonths: item.review_interval_months,
          })),
          owners: owners.map((owner) => ({
            id: owner.id,
            entityId: owner.entity_id,
            ownershipRole: owner.ownership_role,
            effectiveFrom: owner.effective_from,
            effectiveTo: owner.effective_to,
          })),
          holds: holds.map((hold) => ({
            id: hold.id,
            itemId: hold.item_id,
            kind: hold.kind,
            placedAt: hold.placed_at,
            reason: hold.reason,
            releasedAt: hold.released_at,
          })),
          scans: scans.map((scan) => ({
            id: scan.id,
            itemId: scan.item_id,
            fileId: scan.file_id,
            kind: scan.kind,
            capturedAt: scan.captured_at,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...updatePacketRoute, middleware: chokepointMiddleware(chokepoint, updatePacketRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { effect } = await updateCustodyPacket(
          firm.firmDatabase,
          packetId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...addItemRoute, middleware: chokepointMiddleware(chokepoint, addItemRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { itemId, effect } = await addCustodyItem(
          firm.firmDatabase,
          packetId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: itemId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...updateItemRoute, middleware: chokepointMiddleware(chokepoint, updateItemRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { itemId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { effect } = await updateCustodyItem(
          firm.firmDatabase,
          itemId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...addOwnerRoute, middleware: chokepointMiddleware(chokepoint, addOwnerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { ownerId, effect } = await addCustodyOwner(
          firm.firmDatabase,
          packetId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: ownerId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...recordMovementRoute, middleware: chokepointMiddleware(chokepoint, recordMovementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const recorded = await recordCustodyMovement(firm.firmDatabase, packetId, request, {
          ...serviceOptions(c),
          idempotency,
        });
        return c.json(
          { id: recorded.movementId, packetStatus: recorded.packetStatus } as never,
          201,
        );
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listMovementsRoute, middleware: chokepointMiddleware(chokepoint, listMovementsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const { cursor, itemId } = c.req.valid("query");
      const decoded = decodeMovementCursor(cursor);
      const limit = 50;
      const rows = await readCustodyMovements(
        firm.firmDatabase,
        packetId,
        limit + 1,
        decoded,
        itemId,
      );
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeMovementCursor(last.occurred_at, last.id)
          : null;
      return c.json(
        {
          data: page.map((movement) => ({
            id: movement.id,
            itemId: movement.item_id,
            kind: movement.kind,
            occurredAt: movement.occurred_at,
            recordedAt: movement.recorded_at,
            recordedByUserId: movement.recorded_by_user_id,
            fromLocationId: movement.from_location_id,
            toLocationId: movement.to_location_id,
            borrowerKind: movement.borrower_kind,
            borrowerUserId: movement.borrower_user_id,
            borrowerEntityId: movement.borrower_entity_id,
            borrowerName: movement.borrower_name,
            dueBackOn: movement.due_back_on,
            reason: movement.reason,
            correctsMovementId: movement.corrects_movement_id,
            shipmentId: movement.shipment_id,
            note: movement.note,
            releaseAuthorityBasis: movement.release_authority_basis,
            releaseIdentityEvidence: movement.release_identity_evidence,
            releaseIdentityVerifiedByUserId: movement.release_identity_verified_by_user_id,
            releaseWitnessedByUserId: movement.release_witnessed_by_user_id,
          })),
          nextCursor,
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...placeHoldRoute, middleware: chokepointMiddleware(chokepoint, placeHoldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { holdId, effect } = await placeCustodyHold(
          firm.firmDatabase,
          packetId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: holdId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...releaseHoldRoute, middleware: chokepointMiddleware(chokepoint, releaseHoldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { holdId } = c.req.valid("param");
      try {
        const { effect } = await releaseCustodyHold(firm.firmDatabase, holdId, serviceOptions(c));
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...linkScanRoute, middleware: chokepointMiddleware(chokepoint, linkScanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { scanId, effect } = await linkCustodyScan(
          firm.firmDatabase,
          packetId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: scanId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listItemTypesRoute, middleware: chokepointMiddleware(chokepoint, listItemTypesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { includeInactive } = c.req.valid("query");
      const rows = await readCustodyItemTypes(firm.firmDatabase, includeInactive === "true");
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            intrinsicValueDefault: row.intrinsic_value_default === 1,
            active: row.active === 1,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...createItemTypeRoute, middleware: chokepointMiddleware(chokepoint, createItemTypeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      try {
        const { itemTypeId, effect } = await createCustodyItemType(
          firm.firmDatabase,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: itemTypeId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    {
      ...deactivateItemTypeRoute,
      middleware: chokepointMiddleware(chokepoint, deactivateItemTypeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { itemTypeId } = c.req.valid("param");
      try {
        const { effect } = await deactivateCustodyItemType(
          firm.firmDatabase,
          itemTypeId,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listOverdueRoute, middleware: chokepointMiddleware(chokepoint, listOverdueRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { asOf, cursor } = c.req.valid("query");
      const page = await readOverdueCustodyCheckoutsPage(
        firm.firmDatabase,
        asOf ?? todayInUtc(),
        cursor === undefined ? {} : { cursor },
      );
      return c.json(page as never, 200);
    },
  );

  app.openapi(
    { ...completeReviewRoute, middleware: chokepointMiddleware(chokepoint, completeReviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { packetId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const completed = await completeCustodyReview(firm.firmDatabase, packetId, request, {
          ...serviceOptions(c),
          idempotency,
        });
        return c.json(
          { id: completed.movementId, nextReviewOn: completed.nextReviewOn } as never,
          201,
        );
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listRemindersRoute, middleware: chokepointMiddleware(chokepoint, listRemindersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { asOf } = c.req.valid("query");
      const due = await collectCustodyReminders(firm.firmDatabase, asOf ?? todayInUtc());
      return c.json({ data: due.reminders, capped: due.capped } as never, 200);
    },
  );

  app.openapi(
    {
      ...holdingsByOwnerRoute,
      middleware: chokepointMiddleware(chokepoint, holdingsByOwnerRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { limit } = c.req.valid("query");
      const { rows, capped: more } = await readCustodyHoldingsByOwner(firm.firmDatabase, limit);
      return c.json({ data: rows, capped: more } as never, 200);
    },
  );

  app.openapi(
    {
      ...holdingsByLocationRoute,
      middleware: chokepointMiddleware(chokepoint, holdingsByLocationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const rows = await readCustodyLocationOccupancyReport(firm.firmDatabase);
      return c.json({ data: rows } as never, 200);
    },
  );

  app.openapi(
    { ...holdsReportRoute, middleware: chokepointMiddleware(chokepoint, holdsReportRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor } = c.req.valid("query");
      const page = await readCustodyPacketsUnderHold(
        firm.firmDatabase,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(page as never, 200);
    },
  );

  app.openapi(
    { ...openStocktakeRoute, middleware: chokepointMiddleware(chokepoint, openStocktakeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      try {
        const { stocktakeId, effect } = await openCustodyStocktake(
          firm.firmDatabase,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: stocktakeId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listStocktakesRoute, middleware: chokepointMiddleware(chokepoint, listStocktakesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { status, limit } = c.req.valid("query");
      const page = await readCustodyStocktakes(firm.firmDatabase, status, limit ?? 50);
      return c.json({ data: page.rows.map(stocktakeView), capped: page.capped } as never, 200);
    },
  );

  app.openapi(
    { ...getStocktakeRoute, middleware: chokepointMiddleware(chokepoint, getStocktakeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { stocktakeId } = c.req.valid("param");
      const stocktake = await readCustodyStocktake(firm.firmDatabase, stocktakeId);
      if (stocktake === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such custody stocktake in this firm.",
        });
      }
      return c.json(stocktakeView(stocktake) as never, 200);
    },
  );

  app.openapi(
    { ...recordSightingsRoute, middleware: chokepointMiddleware(chokepoint, recordSightingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { stocktakeId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const recorded = await recordCustodyStocktakeSightings(
          firm.firmDatabase,
          stocktakeId,
          request.sightings,
          { ...serviceOptions(c), idempotency },
        );
        return c.json({ ids: recorded.sightingIds } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...listSightingsRoute, middleware: chokepointMiddleware(chokepoint, listSightingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { stocktakeId } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const sightings = await readCustodyStocktakeSightings(
        firm.firmDatabase,
        stocktakeId,
        limit ?? 500,
      );
      return c.json(
        {
          capped: sightings.capped,
          data: sightings.rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            packetId: row.packet_id,
            itemId: row.item_id,
            locationId: row.location_id,
            expectedLocationId: row.expected_location_id,
            description: row.description,
            observedAt: row.observed_at,
            recordedAt: row.recorded_at,
            observedByUserId: row.observed_by_user_id,
            note: row.note,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...reconciliationRoute, middleware: chokepointMiddleware(chokepoint, reconciliationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { stocktakeId } = c.req.valid("param");
      // The row is resolved here rather than inside the reconciliation so this read has exactly two
      // outcomes — the report, or a 404. A reconciliation is a pure read: there is no state it can
      // refuse from, and declaring the write surface's conflict responses on it would describe a
      // failure this route cannot produce.
      const stocktake = await readCustodyStocktake(firm.firmDatabase, stocktakeId);
      if (stocktake === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such custody stocktake in this firm.",
        });
      }
      return c.json((await reconcileAgainstRegister(firm.firmDatabase, stocktake)) as never, 200);
    },
  );

  app.openapi(
    { ...closeStocktakeRoute, middleware: chokepointMiddleware(chokepoint, closeStocktakeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { stocktakeId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const closed = await closeCustodyStocktake(
          firm.firmDatabase,
          stocktakeId,
          request,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, closed.effect, {
          now: () => new Date().toISOString(),
        });
        return c.json(
          {
            id: closed.stocktakeId,
            status: closed.status,
            counts: closed.counts,
            truncated: closed.truncated,
          } as never,
          200,
        );
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...renderLabelsRoute, middleware: chokepointMiddleware(chokepoint, renderLabelsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      try {
        const sheet = await buildCustodyLabelSheet(firm.firmDatabase, {
          packetIds: query.packetIds as CustodyPacketId[],
          locationIds: query.locationIds as CustodyLocationId[],
          startPosition: query.startPosition,
        });
        return new Response(sheet.svg, {
          status: 200,
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "content-disposition": 'inline; filename="custody-labels.svg"',
          },
        });
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    {
      ...listDestructionRequestsRoute,
      middleware: chokepointMiddleware(chokepoint, listDestructionRequestsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listCustodyDestructionRequests(firm.firmDatabase, {
        packetId: query.packetId as CustodyPacketId | undefined,
        outcome: query.outcome,
        cursor: query.cursor,
      });
      return c.json(
        { data: page.data.map(destructionRequestView), nextCursor: page.nextCursor } as never,
        200,
      );
    },
  );

  app.openapi(
    {
      ...raiseDestructionRequestRoute,
      middleware: chokepointMiddleware(chokepoint, raiseDestructionRequestRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      try {
        const { destructionRequestId, effect } = await requestCustodyDestruction(
          firm.firmDatabase,
          request.packetId as CustodyPacketId,
          { basis: request.basis, itemId: request.itemId as CustodyItemId | undefined },
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ id: destructionRequestId } as never, 201);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    {
      ...approveDestructionRequestRoute,
      middleware: chokepointMiddleware(chokepoint, approveDestructionRequestRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { destructionRequestId } = c.req.valid("param");
      try {
        const { effect } = await approveCustodyDestruction(
          firm.firmDatabase,
          destructionRequestId,
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    {
      ...refuseDestructionRequestRoute,
      middleware: chokepointMiddleware(chokepoint, refuseDestructionRequestRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { destructionRequestId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const { effect } = await refuseCustodyDestruction(
          firm.firmDatabase,
          destructionRequestId,
          { reason: request?.reason ?? null },
          serviceOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: () => new Date().toISOString() });
        return c.json({ ok: true } as never, 200);
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    {
      ...executeDestructionRequestRoute,
      middleware: chokepointMiddleware(chokepoint, executeDestructionRequestRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { destructionRequestId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const executed = await executeCustodyDestruction(firm.firmDatabase, destructionRequestId, {
          ...serviceOptions(c),
          // The ledger row this writes is the one row in the subsystem a retry must never duplicate,
          // so the key rides down to the movement write path that owns the replay.
          idempotency: requireChokepointIdempotency(c),
          method: request?.method ?? null,
          occurredAt: request?.occurredAt,
        });
        return c.json(
          {
            id: executed.destructionRequestId,
            packetId: executed.packetId,
            movementId: executed.movementId,
            executedAt: executed.executedAt,
          } as never,
          200,
        );
      } catch (caught) {
        return custodyErrorResponse(c, caught);
      }
    },
  );

  app.openapi(
    { ...willDutiesRoute, middleware: chokepointMiddleware(chokepoint, willDutiesRoute) },
    async (c) => {
      const { jurisdiction } = c.req.valid("query");
      try {
        const resolved = resolveCustodyWillDuties(jurisdiction);
        return c.json(
          {
            ...resolved,
            // Returned on every answer so a surface can say which jurisdictions ARE encoded without
            // a second call, and so an unencoded one reads as a gap in a known list rather than as
            // the platform having no opinion.
            encodedJurisdictionKeys: ENCODED_CUSTODY_WILL_JURISDICTION_KEYS,
          } as never,
          200,
        );
      } catch (caught) {
        // This route is a pure read over compiled reference data, so the only refusal it can produce
        // is the jurisdiction one. Mapped inline rather than through the shared mapper because the
        // shared mapper's conflict arm describes states a lookup cannot be in.
        if (
          caught instanceof CustodyValidationError &&
          (caught.code === "custody-jurisdiction-not-recorded" ||
            caught.code === "custody-jurisdiction-not-encoded")
        ) {
          return problemJson(c, {
            type: "custody-jurisdiction-unavailable",
            title: "The will-deposit duties cannot be resolved",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );
}

function destructionRequestView(row: {
  id: string;
  packet_id: string;
  item_id: string | null;
  requested_by: string | null;
  requested_at: string;
  basis: string;
  approved_by: string | null;
  approved_at: string | null;
  refused_by: string | null;
  refused_at: string | null;
  refusal_reason: string | null;
  executed_at: string | null;
  executed_by: string | null;
  executed_movement_id: string | null;
  outcome: string | null;
}) {
  return {
    id: row.id,
    packetId: row.packet_id,
    itemId: row.item_id,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    basis: row.basis,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    refusedBy: row.refused_by,
    refusedAt: row.refused_at,
    refusalReason: row.refusal_reason,
    executedAt: row.executed_at,
    executedBy: row.executed_by,
    executedMovementId: row.executed_movement_id,
    outcome: row.outcome,
  };
}

// The five findings are returned as one nested object rather than five sibling columns: they are one
// answer to one question, and a client that showed four of them and dropped the fifth would be
// reporting a cleaner count than the firm actually took.
function stocktakeView(row: {
  id: string;
  name: string;
  scope_location_id: string | null;
  status: string;
  opened_at: string;
  opened_by_user_id: string | null;
  closed_at: string | null;
  closed_by_user_id: string | null;
  matched_count: number | null;
  missing_count: number | null;
  misplaced_count: number | null;
  unexpected_count: number | null;
  unregistered_count: number | null;
  note: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    scopeLocationId: row.scope_location_id,
    status: row.status,
    openedAt: row.opened_at,
    openedByUserId: row.opened_by_user_id,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    counts:
      row.matched_count === null
        ? null
        : {
            matched: row.matched_count,
            missing: row.missing_count ?? 0,
            misplaced: row.misplaced_count ?? 0,
            unexpected: row.unexpected_count ?? 0,
            unregistered: row.unregistered_count ?? 0,
          },
    note: row.note,
  };
}

function locationView(row: {
  id: string;
  name: string;
  kind: string;
  parent_location_id: string | null;
  firm_location_id: string | null;
  address: string | null;
  status: string;
  notes: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentLocationId: row.parent_location_id,
    firmLocationId: row.firm_location_id,
    address: row.address,
    status: row.status,
    notes: row.notes,
  };
}

// The movement history's keyset cursor. The sort key is (occurred_at, id), so the cursor carries
// both — occurred_at alone is not unique when several events are recorded for the same instant.
function encodeMovementCursor(occurredAt: string, id: string): string {
  return btoa(JSON.stringify({ occurredAt, id }));
}

function decodeMovementCursor(
  cursor: string | undefined,
): { occurredAt: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { occurredAt?: unknown; id?: unknown };
    if (typeof parsed.occurredAt !== "string" || typeof parsed.id !== "string") return undefined;
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    // A malformed cursor starts the page over rather than failing the read: a truncated or stale
    // continuation is a client bug, not a reason to deny access to the register.
    return undefined;
  }
}
