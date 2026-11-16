/*
 * The Custodian register's reads — what a firm holds, where, for whom, and what has happened to it.
 *
 * Mirrors the `custody.*` operations in apps/api-worker/openapi/openapi.json. `apps/web` hand-writes
 * the response shapes it reads (the transport seam in $lib/api/request.ts says why), so each type
 * here is the wire shape and nothing more — the surfaces do the presenting.
 *
 * TWO THINGS THIS MODULE DELIBERATELY DOES NOT DO.
 *
 * It never resolves a name. An owner, a depositor and an entity borrower are directory handles, and
 * the register has no business duplicating the directory's display rules — the same reasoning the
 * reports themselves carry. Resolution is `directory-names.svelte.ts`, and it is bounded to the
 * handles ONE record carries.
 *
 * It composes no MOVEMENT of its own. The three writes below each bring something into existence —
 * a packet, an item inside it, a scanned copy linked to it — and the server appends the ledger row
 * that records the act. Every subsequent state change (moved, checked out, returned, released,
 * destroyed) is one POST to a packet's movements with a `kind`, because that is the one place the
 * append-only ledger, the derived status and the audit row are written in a single commit. A
 * check-out helper here that composed its own body would be a second place all of that has to be
 * right.
 *
 * EVERY WRITE CARRIES AN IDEMPOTENCY KEY, and the contract refuses it without one. A person who
 * presses a submit twice, or whose first attempt died on a dropped connection, must not draw two
 * custody numbers for one envelope — so each attempt names itself and the server answers a repeat
 * with the first result.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type {
  CustodyBorrowerKind,
  CustodyHoldKind,
  CustodyItemStatus,
  CustodyLocationKind,
  CustodyMovementKind,
  CustodyPacketStatus,
  CustodyScanKind,
} from "./custody-vocabulary.ts";

/** The permission a reader needs. A member without it is refused server-side. */
export const READ_CUSTODY_PERMISSION = "custody:read";

/** The permission that records a movement, places a hold, or raises a destruction request. */
export const MANAGE_CUSTODY_PERMISSION = "custody:manage";

/** A capped listing: the best N, and whether the firm holds more than were returned. */
export interface Capped<T> {
  data: T[];
  capped: boolean;
}

// ---- the register listing --------------------------------------------------------------------

/** One packet as the register's listing answers it. */
export interface CustodyPacketSummary {
  id: string;
  custodyNumber: string;
  name: string;
  status: CustodyPacketStatus;
  currentLocationId: string | null;
  matterId: string | null;
  createdAt: string;
}

/** What the register listing may be narrowed by. Every one of these is the server's own filter. */
export interface CustodyPacketQuery {
  status?: CustodyPacketStatus;
  ownerEntityId?: string;
  matterId?: string;
  /** The whole branch under this node, not just the node — boxes and positions inside it included. */
  locationSubtreeId?: string;
  search?: string;
  cursor?: string;
}

function query(parameters: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

/** One page of the register, newest first. */
export function listCustodyPackets(
  fetchImpl: typeof fetch,
  parameters: CustodyPacketQuery = {},
): Promise<ApiOutcome<Page<CustodyPacketSummary>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/custody/packets${query({
      status: parameters.status,
      ownerEntityId: parameters.ownerEntityId,
      matterId: parameters.matterId,
      locationSubtreeId: parameters.locationSubtreeId,
      search: parameters.search,
      cursor: parameters.cursor,
    })}`,
  );
}

// ---- one packet ------------------------------------------------------------------------------

export interface CustodyLocationNode {
  id: string;
  name: string;
  kind: CustodyLocationKind;
  parentLocationId: string | null;
  firmLocationId: string | null;
  address: string | null;
  status: "active" | "closed";
  notes: string | null;
}

export interface CustodyItem {
  id: string;
  ordinal: number;
  itemTypeId: string | null;
  description: string;
  instrumentDate: string | null;
  /** A person's assertion that this original is irreplaceable. The destruction refusal reads it. */
  intrinsicValue: boolean;
  declaredValueAmountMinor: number | null;
  declaredValueCurrency: string | null;
  status: CustodyItemStatus;
  reviewOn: string | null;
  reviewIntervalMonths: number | null;
}

export interface CustodyOwnerLink {
  id: string;
  entityId: string;
  ownershipRole: string | null;
  effectiveFrom: string;
  /** Null while the link is current. Ownership ends by a new row, never by a delete. */
  effectiveTo: string | null;
}

export interface CustodyHold {
  id: string;
  itemId: string | null;
  kind: CustodyHoldKind;
  placedAt: string;
  reason: string | null;
  releasedAt: string | null;
}

export interface CustodyScan {
  id: string;
  itemId: string | null;
  fileId: string;
  kind: CustodyScanKind;
  capturedAt: string;
}

export interface CustodyPacketDetail {
  id: string;
  custodyNumber: string;
  numberSource: "drawn" | "manual";
  name: string;
  status: CustodyPacketStatus;
  matterId: string | null;
  depositorEntityId: string | null;
  depositedAt: string | null;
  reviewOn: string | null;
  reviewIntervalMonths: number | null;
  notes: string | null;
  /** Root first, the packet's own node last — the breadcrumb the register renders. */
  locationPath: CustodyLocationNode[];
  filingMatterId: string | null;
  items: CustodyItem[];
  owners: CustodyOwnerLink[];
  holds: CustodyHold[];
  scans: CustodyScan[];
}

/** One packet with everything hanging off it. */
export function readCustodyPacket(
  fetchImpl: typeof fetch,
  packetId: string,
): Promise<ApiOutcome<CustodyPacketDetail>> {
  return requestJson(fetchImpl, `/api/v1/custody/packets/${encodeURIComponent(packetId)}`);
}

// ---- the ledger ------------------------------------------------------------------------------

/**
 * One appended movement. Every field a chain of custody is read from is on this row: what happened,
 * when it happened in the physical world, when it was typed in, who typed it, and — on a release —
 * the authority it left on and the identity check made before it did.
 */
export interface CustodyMovement {
  id: string;
  itemId: string | null;
  kind: CustodyMovementKind;
  occurredAt: string;
  recordedAt: string;
  recordedByUserId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  borrowerKind: CustodyBorrowerKind | null;
  borrowerUserId: string | null;
  borrowerEntityId: string | null;
  borrowerName: string | null;
  dueBackOn: string | null;
  reason: string | null;
  correctsMovementId: string | null;
  shipmentId: string | null;
  note: string | null;
  releaseAuthorityBasis: string | null;
  releaseIdentityEvidence: string | null;
  releaseIdentityVerifiedByUserId: string | null;
  releaseWitnessedByUserId: string | null;
}

/** What a history read is being asked for. */
export interface CustodyMovementQuery {
  /**
   * One item's own chain of custody.
   *
   * The server answers the item's OWN entries plus the packet-wide ones, because an item inside a
   * packet goes wherever the packet goes: the will was in the box when the box moved to the Reno
   * safe. A read that returned only the rows naming the item would show "Contents described" over a
   * decade and call that a chain of custody. Every row carries `itemId`, so a surface can say which
   * of the two each entry is rather than presenting them as one undifferentiated list.
   */
  itemId?: string;
  cursor?: string;
}

/** A packet's history, newest first, cursor-paged. */
export function listCustodyMovements(
  fetchImpl: typeof fetch,
  packetId: string,
  parameters: CustodyMovementQuery = {},
): Promise<ApiOutcome<Page<CustodyMovement>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/custody/packets/${encodeURIComponent(packetId)}/movements${query({
      itemId: parameters.itemId,
      cursor: parameters.cursor,
    })}`,
  );
}

// ---- bringing something into the register ----------------------------------------------------

/** One owner as the packet form records it. At least one is required; the server refuses none. */
export interface CustodyOwnerInput {
  entityId: string;
  /** What this owner is to the property, in the firm's own words. Null where it names nothing. */
  ownershipRole?: string | null;
}

/**
 * A new packet.
 *
 * `currentLocationId` is required by the contract and not by an oversight: a packet is a physical
 * thing, and a register that accepts one without saying where it is has recorded that the firm has
 * lost it. `manualCustodyNumber` is the carried-in case — property that arrived with a number from
 * an earlier register keeps it, and draws none.
 */
export interface CreateCustodyPacketRequest {
  name: string;
  owners: readonly CustodyOwnerInput[];
  currentLocationId: string;
  matterId?: string;
  depositorEntityId?: string;
  depositedAt?: string;
  notes?: string | null;
  manualCustodyNumber?: string;
  /** The draft number the panel holds, so the packet is logged under exactly that number. */
  numberReservation?: string;
}

/** What the register answers with once the packet exists, including the number it drew. */
export interface CreatedCustodyPacket {
  id: string;
  custodyNumber: string;
  /** The system holding matter a packet's scans are filed into, whatever matter it is linked to. */
  filingMatterId: string;
}

/** Log a packet into the register. The server appends its `logged` movement. */
export function createCustodyPacket(
  fetchImpl: typeof fetch,
  request: CreateCustodyPacketRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreatedCustodyPacket>> {
  return requestJson(fetchImpl, "/api/v1/custody/packets", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/**
 * One item described inside a packet.
 *
 * `intrinsicValue` is a person's assertion that this original is irreplaceable, and it is the one
 * field on this form that can never be walked back by a later screen: it makes the item permanently
 * undestructible, a refusal with no override anywhere in the subsystem.
 */
export interface AddCustodyItemRequest {
  description: string;
  itemTypeId?: string;
  instrumentDate?: string | null;
  intrinsicValue?: boolean;
  declaredValue?: { amountMinor: number; currency: string } | null;
  occurredAt?: string;
}

/** Describe what is inside a packet. The server appends its `itemized` movement. */
export function addCustodyItem(
  fetchImpl: typeof fetch,
  packetId: string,
  request: AddCustodyItemRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/custody/packets/${encodeURIComponent(packetId)}/items`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/**
 * A copy filed against a packet.
 *
 * It takes a FILE THE FIRM ALREADY HOLDS rather than an upload, because a scan of an original is an
 * ordinary document in a matter's file store and gains nothing by being a second kind of object
 * with its own storage, its own scanning and its own permissions. The packet's `filingMatterId` is
 * the matter those files live in.
 */
export interface LinkCustodyScanRequest {
  fileId: string;
  kind: CustodyScanKind;
  itemId?: string;
  capturedAt?: string;
}

/** Link a filed document to a packet as a copy of what the firm holds. */
export function linkCustodyScan(
  fetchImpl: typeof fetch,
  packetId: string,
  request: LinkCustodyScanRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/custody/packets/${encodeURIComponent(packetId)}/scans`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

// ---- the container tree ----------------------------------------------------------------------

/** Every node of the firm's physical tree, flat with parent ids. */
export function listCustodyLocations(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: CustodyLocationNode[] }>> {
  return requestJson(fetchImpl, "/api/v1/custody/locations");
}

/**
 * A new node of the tree. Only a root may name one of the firm's offices; a child inherits its
 * office from the root it hangs off, and the server refuses the two together.
 */
export interface CreateCustodyLocationRequest {
  name: string;
  kind: CustodyLocationKind;
  parentLocationId?: string;
  firmLocationId?: string;
}

/** Add a container to the firm's tree. */
export function createCustodyLocation(
  fetchImpl: typeof fetch,
  request: CreateCustodyLocationRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/custody/locations", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface CustodyLocationOccupancy {
  locationId: string;
  name: string;
  kind: CustodyLocationKind;
  parentLocationId: string | null;
  status: "active" | "closed";
  depth: number;
  /** Packets physically at THIS node. A checked-out packet is at no location. */
  directOccupancy: number;
  /** Packets at this node or anywhere beneath it. */
  subtreeOccupancy: number;
}

/*
 * The tree with its occupancy counts, parents before children.
 *
 * NOTHING ON A SCREEN CALLS THIS TODAY. The custody register's location rail read it until the
 * owner's 2026-09-06 ruling took the rail out — Location is a column of the one table now — and
 * this stays because the endpoint is real and "how much is in each container" is a report, which
 * is where it belongs when the custody reports are built.
 */
export function readCustodyLocationOccupancy(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: CustodyLocationOccupancy[] }>> {
  return requestJson(fetchImpl, "/api/v1/custody/reports/holdings-by-location");
}

// ---- the reports -----------------------------------------------------------------------------

export interface CustodyHoldingsByOwner {
  entityId: string;
  packetsHeld: number;
  packetsOut: number;
  itemsDescribed: number;
  packetsUnderHold: number;
}

/** What the firm holds for each owner, biggest holders first. Capped, never silently cut. */
export function readCustodyHoldingsByOwner(
  fetchImpl: typeof fetch,
  limit?: number,
): Promise<ApiOutcome<Capped<CustodyHoldingsByOwner>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/custody/reports/holdings-by-owner${query({ limit: limit?.toString() })}`,
  );
}

export interface CustodyPacketUnderHold {
  holdId: string;
  packetId: string;
  itemId: string | null;
  custodyNumber: string;
  kind: CustodyHoldKind;
  placedAt: string;
  packetStatus: CustodyPacketStatus;
}

/** Every hold in force, oldest first. A hold nobody can see is a hold nobody will release. */
export function listCustodyHoldsInForce(
  fetchImpl: typeof fetch,
  cursor?: string,
): Promise<ApiOutcome<Page<CustodyPacketUnderHold>>> {
  return requestJson(fetchImpl, `/api/v1/custody/reports/holds${query({ cursor })}`);
}

export interface OverdueCustodyCheckout {
  packetId: string;
  custodyNumber: string;
  dueBackOn: string;
  borrowerKind: CustodyBorrowerKind | null;
  daysOverdue: number;
}

/** Check-outs still out past their due-back date, most overdue first. */
export function listOverdueCustodyCheckouts(
  fetchImpl: typeof fetch,
  cursor?: string,
): Promise<ApiOutcome<Page<OverdueCustodyCheckout>>> {
  return requestJson(fetchImpl, `/api/v1/custody/overdue${query({ cursor })}`);
}

export interface CustodyReminder {
  reason: "review-due" | "checkout-overdue";
  packetId: string;
  itemId: string | null;
  custodyNumber: string;
  dueOn: string;
  daysOverdue: number;
  bucket: string;
}

/** What is due: a review whose date has passed, and a check-out past its due-back date. */
export function listCustodyReminders(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: CustodyReminder[] }>> {
  return requestJson(fetchImpl, "/api/v1/custody/reminders");
}

// ---- the item-type catalog -------------------------------------------------------------------

export interface CustodyItemType {
  id: string;
  name: string;
  code: string | null;
  intrinsicValueDefault: boolean;
  active: boolean;
}

/** The firm's own catalog of what a packet may contain. */
export function listCustodyItemTypes(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: CustodyItemType[] }>> {
  return requestJson(fetchImpl, "/api/v1/custody/item-types");
}
