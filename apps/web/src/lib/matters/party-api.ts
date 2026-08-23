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
]);

export function roleLabel(role: string): string {
  return KNOWN_ROLE_LABELS.get(role.toLowerCase()) ?? role;
}
