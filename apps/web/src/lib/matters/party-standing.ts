/*
 * A matter's own view of one of its parties, handed to the entity window as the standing it shows
 * above the record's facts. The directory knows a person; only the matter knows that this person
 * is its executor and, separately, a beneficiary, and in what capacity each — so those lines come
 * from here, one per association, and never from the record.
 */
import type { EntityStanding, StandingLine } from "$lib/directory/entity-window-model.ts";
import { roleLabel, type MatterPartyEntry } from "./party-api.ts";

/** One line per association the entity holds on the matter: the role, with the capacity beside it. */
export function partyStandingLines(
  parties: readonly MatterPartyEntry[],
  entityId: string,
): readonly StandingLine[] {
  return parties
    .filter((party) => party.entityId === entityId)
    .map((party) => ({
      label: roleLabel(party.role),
      value: party.capacity === null || party.capacity.trim() === "" ? "" : party.capacity,
    }));
}

/**
 * The standing a matter hands the window, or null when the entity is not on the matter at all —
 * in which case the window shows only what the directory holds.
 */
export function standingOnMatter(
  matterTitle: string,
  parties: readonly MatterPartyEntry[],
  entityId: string,
): EntityStanding | null {
  const lines = partyStandingLines(parties, entityId);
  if (lines.length === 0) return null;
  return { heading: `On ${matterTitle}`, lines };
}
