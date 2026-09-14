/*
 * Which of a matter's parties is the client a bill is raised against.
 *
 * An invoice belongs to one client and may bill several of that client's matters, and the client is
 * never chosen on a bill: it is resolved from the matter's own party record, the party wearing the
 * client role. Two surfaces need that answer — the matter's Billing section and the firm's Billing
 * screen, when it opens a draft on a matter picked there — so the rule lives once. A matter with no
 * client party can be read and cannot be billed, and both surfaces say so rather than offering a
 * control that fails.
 */
import type { MatterPartyEntry } from "$lib/matters/party-api.ts";

/** The client on a matter, or null where no party wears that role. */
export interface ClientParty {
  readonly entityId: string;
  /** What to call them, or null where the directory holds no name for the entity. */
  readonly displayName: string | null;
}

/**
 * The role is matched on its letters alone, so "Client", "client" and a firm's own "Client (Primary)"
 * all answer — the role is a catalog value a firm may have typed, and the party record is the one
 * place the fact is held.
 */
export function clientPartyOf(parties: readonly MatterPartyEntry[]): ClientParty | null {
  const client = parties.find(
    (party) => party.role.toLowerCase().replace(/[^a-z]/g, "") === "client",
  );
  return client === undefined
    ? null
    : { entityId: client.entityId, displayName: client.displayName };
}
