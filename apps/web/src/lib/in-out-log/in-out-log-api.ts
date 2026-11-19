/*
 * The In/Out Log's reads and writes: what crosses the front desk that is not held in custody.
 *
 * Mirrors the `inOutLog.*` operations in apps/api-worker/openapi/openapi.json. Each type is the wire
 * shape and nothing more; the screen does the presenting. Every write carries an idempotency key, so
 * a Save pressed twice logs one envelope under one number.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** The permission that reads the log. */
export const READ_IN_OUT_LOG_PERMISSION = "inOutLog:read";
/** The permission that drops off, picks up, moves to Custodian and deletes. */
export const MANAGE_IN_OUT_LOG_PERMISSION = "inOutLog:manage";

export type InOutPartyKind = "member" | "entity" | "external";
export type InOutEntryStatus = "waiting" | "picked_up" | "moved_to_custodian";

/** One person on an entry: a member, a Directory person or organization, or a typed name. */
export interface InOutParty {
  kind: InOutPartyKind;
  userId: string | null;
  entityId: string | null;
  name: string;
}

export interface InOutRecipient extends InOutParty {
  /** The id of their place on the entry, which a Pick Up names. */
  id: string;
}

export interface InOutEntry {
  id: string;
  number: string;
  description: string;
  from: InOutParty;
  to: InOutRecipient[];
  matter: { id: string; title: string; number: string | null } | null;
  keptAt: string | null;
  notes: string | null;
  status: InOutEntryStatus;
  droppedOffAt: string;
  recordedByUserId: string;
  pickedUp: {
    at: string;
    by: InOutParty;
    identityChecked: boolean;
    handedOverByUserId: string | null;
  } | null;
  movedToCustodian: {
    at: string;
    packetId: string;
    custodyNumber: string | null;
    movedByUserId: string | null;
  } | null;
}

export interface InOutEntryQuery {
  /** `waiting` is Waiting for Pickup, oldest first; `all` is the whole Log, newest first. */
  status: "waiting" | "all";
  search?: string;
  cursor?: string;
}

export function listInOutEntries(
  fetchImpl: typeof fetch,
  query: InOutEntryQuery,
): Promise<ApiOutcome<Page<InOutEntry>>> {
  const parameters = new URLSearchParams({ status: query.status });
  if (query.search !== undefined && query.search.trim() !== "") {
    parameters.set("search", query.search.trim());
  }
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  return requestJson(fetchImpl, `/api/v1/in-out-entries?${parameters.toString()}`);
}

export interface DropOffRequest {
  description: string;
  from: Omit<InOutParty, "userId" | "entityId"> & {
    userId?: string | null;
    entityId?: string | null;
  };
  to: DropOffRequest["from"][];
  matterId?: string | null;
  keptAt?: string | null;
  notes?: string | null;
  numberReservation?: string;
}

export function dropOff(
  fetchImpl: typeof fetch,
  request: DropOffRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string; number: string }>> {
  return requestJson(fetchImpl, "/api/v1/in-out-entries", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export interface PickUpRequest {
  /** One of the people it is To. */
  recipientId?: string;
  /** Or somebody else, by name. Exactly one of the two. */
  collector?: DropOffRequest["from"];
  identityChecked: boolean;
}

export function pickUp(
  fetchImpl: typeof fetch,
  entryId: string,
  request: PickUpRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/in-out-entries/${encodeURIComponent(entryId)}/pick-up`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** Links a waiting entry to the custody packet it became, once Custodian has logged the packet. */
export function linkToCustodyPacket(
  fetchImpl: typeof fetch,
  entryId: string,
  packetId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/in-out-entries/${encodeURIComponent(entryId)}/custody-packet`,
    { method: "POST", body: { packetId }, idempotencyKey },
  );
}

export function deleteInOutEntry(
  fetchImpl: typeof fetch,
  entryId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/in-out-entries/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** How a chosen person is told apart from the others: `member:<id>`, `entity:<id>`, or the name. */
export function partyKey(party: Pick<InOutParty, "kind" | "userId" | "entityId" | "name">): string {
  if (party.kind === "member") return `member:${party.userId ?? ""}`;
  if (party.kind === "entity") return `entity:${party.entityId ?? ""}`;
  return `external:${party.name.trim().toLowerCase()}`;
}
