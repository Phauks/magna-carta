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
 * It has no second write path. Every state change in this subsystem is one POST to a packet's
 * movements with a `kind`, because that is the one place the append-only ledger, the derived status
 * and the audit row are all written in a single commit. A check-out helper here that composed its
 * own body would be a second place all of that has to be right.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type {
  CustodyBorrowerKind,
  CustodyHoldKind,
  CustodyItemStatus,
  CustodyLocationKind,
  CustodyMovementKind,
  CustodyPacketStatus,
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
  kind: "scan" | "photograph" | "receipt" | "appraisal" | "correspondence";
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

/** A packet's history, newest first, cursor-paged. */
export function listCustodyMovements(
  fetchImpl: typeof fetch,
  packetId: string,
  cursor?: string,
): Promise<ApiOutcome<Page<CustodyMovement>>> {
  return requestJson(
    fetchImpl,
    `/api/v1/custody/packets/${encodeURIComponent(packetId)}/movements${query({ cursor })}`,
  );
}

// ---- the container tree ----------------------------------------------------------------------

/** Every node of the firm's physical tree, flat with parent ids. */
export function listCustodyLocations(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: CustodyLocationNode[] }>> {
  return requestJson(fetchImpl, "/api/v1/custody/locations");
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

/** The tree with its occupancy counts, parents before children. */
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
