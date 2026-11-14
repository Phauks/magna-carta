/*
 * The matter Parties section's response shapes and calls. Mirrors the matter-party operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope itself lives in $lib/api/request.ts.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** One party on a matter: the link, the directory entity it points at, and the hat it wears. */
export interface MatterPartyEntry {
  id: string;
  matterId: string;
  entityId: string;
  role: string;
  /**
   * The capacity recorded on this link, or null where the firm recorded none. A null is an honest
   * absence and never a default — nothing infers a capacity from the role, and the screen must not
   * either.
   */
  capacity: string | null;
  /** Which side of the directory the entity resolves to; "unknown" means it is no longer there. */
  entityKind: "person" | "organization" | "unknown";
  /** What to call this party, or null when the directory holds no name for the entity. */
  displayName: string | null;
}

export function listMatterParties(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ parties: MatterPartyEntry[] }>> {
  const query = new URLSearchParams({ matterId });
  return requestJson(fetchImpl, `/api/v1/directory/matter-parties?${query.toString()}`);
}

/** What a link asks for: who, on which matter, in what role, and in what capacity if any. */
export interface LinkMatterPartyRequest {
  matterId: string;
  entityId: string;
  /** The role as stored — a catalog value from `PARTY_ROLE_OPTIONS`, or a role the firm typed. */
  role: string;
  /** Free text the firm recorded, or null for none. Never inferred from the role. */
  capacity: string | null;
}

/**
 * Links a directory entity to a matter in a role.
 *
 * One entity may wear several roles on the same matter, so nothing here refuses a second link to the
 * same person; only the same person in the same role is a repeat, and the tab refuses that before it
 * asks. The idempotency key is the caller's, so a retried press links once.
 */
export function linkMatterParty(
  fetchImpl: typeof fetch,
  request: LinkMatterPartyRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  const body: Record<string, string> = {
    matterId: request.matterId,
    entityId: request.entityId,
    role: request.role,
  };
  if (request.capacity !== null && request.capacity.trim() !== "") {
    body["capacity"] = request.capacity.trim();
  }
  return requestJson(fetchImpl, "/api/v1/directory/matter-parties", {
    method: "POST",
    body,
    idempotencyKey,
  });
}

export function unlinkMatterParty(
  fetchImpl: typeof fetch,
  matterPartyId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ unlinked: boolean }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/directory/matter-parties/${encodeURIComponent(matterPartyId)}`,
    { method: "DELETE", idempotencyKey },
  );
}

/*
 * A role arrives as the firm stored it — free text, lowercased with separators stripped by the merge
 * key ("opposingparty"), or entered ad hoc. Presenting it means restoring word boundaries the
 * storage form removed, and the catalog of known roles is the only place those boundaries are
 * knowable. Anything not in the catalog is shown as the firm typed it rather than guessed at.
 */
const KNOWN_ROLE_LABELS: ReadonlyMap<string, string> = new Map([
  ["client", "Client"],
  ["opposingparty", "Opposing party"],
  ["opposingcounsel", "Opposing counsel"],
  ["guardian", "Guardian"],
  ["executor", "Executor"],
  ["administrator", "Administrator"],
  ["trustee", "Trustee"],
  ["beneficiary", "Beneficiary"],
  ["witness", "Witness"],
  ["expert", "Expert"],
  ["cocounsel", "Co-counsel"],
  // The firm a counsel practices with is a party in its own right: a conflict with the firm is a
  // conflict whichever of its lawyers appears, so it is linked and checked like anybody else.
  ["opposingcounselfirm", "Opposing counsel's firm"],
  ["cocounselfirm", "Co-counsel's firm"],
]);

export function roleLabel(role: string): string {
  return KNOWN_ROLE_LABELS.get(role.toLowerCase()) ?? role;
}

/**
 * The roles offered when a party is added, in the order a firm reaches for them. The stored value is
 * the catalog key, which is the form every reader of `matter_party.role` already normalizes to; a role
 * the firm names itself is stored as typed, and reads back as typed.
 */
export const PARTY_ROLE_OPTIONS: readonly { value: string; label: string }[] = [
  ...KNOWN_ROLE_LABELS,
].map(([value, label]) => ({ value, label }));

/** What the storage form of a typed role is: the same key the catalog uses, so "Opposing party" and
 * "opposing_party" are one role rather than two. */
export function storedRoleFor(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}
