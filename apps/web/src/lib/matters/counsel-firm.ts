/*
 * Counsel and the firm they practice with.
 *
 * Nearly every matter has counsel on it, and a conflict with counsel's firm is a conflict whichever
 * of its lawyers appears (owner's ask, 2026-11-14: "we also will need to account for counsel, which
 * every case will likely have, or additionally, the firm the counsel is with"). The Directory
 * already records where a person works, as a relationship to an organization, so the Parties table
 * reads it from there: it names each counsel's firm, and offers to put the firm on the matter in the
 * matching role so the next conflicts check searches it as a party.
 */
import type { DirectoryEdgeEntry } from "$lib/directory/directory-api.ts";

/** Each counsel role, and the role their firm takes on the same matter. */
export const COUNSEL_FIRM_ROLES: ReadonlyMap<string, string> = new Map([
  ["opposingcounsel", "opposingcounselfirm"],
  ["cocounsel", "cocounselfirm"],
]);

/** The roles that put a firm on the matter as counsel's firm. */
export const FIRM_ROLES: ReadonlySet<string> = new Set(COUNSEL_FIRM_ROLES.values());

/** Whether a role is a counsel role, so the row looks for the firm the person practices with. */
export function isCounselRole(role: string): boolean {
  return COUNSEL_FIRM_ROLES.has(role);
}

/**
 * The relationships that say a person practices with an organization. A person may hold several
 * (a partner who is also a member); any of them names the firm.
 */
const PRACTICE_EDGES: ReadonlySet<string> = new Set([
  "employment",
  "partner_of",
  "member_of",
  "officer_of",
  "director_of",
  "affiliation",
]);

export interface CounselFirm {
  readonly entityId: string;
  readonly name: string | null;
}

/**
 * The organization a person practices with today, from the relationships touching them: an
 * organization at the far end of a practice relationship the person is the subject of, that has
 * not ended. The first such, in the order the Directory lists them; null when none is recorded.
 * `today` is a civil date (YYYY-MM-DD), compared as text, which orders correctly for that shape.
 */
export function currentFirmOf(
  edges: readonly DirectoryEdgeEntry[],
  today: string,
): CounselFirm | null {
  const edge = edges.find(
    (entry) =>
      entry.direction === "outbound" &&
      entry.farEntityKind === "organization" &&
      PRACTICE_EDGES.has(entry.edgeType) &&
      (entry.validTo === null || entry.validTo >= today),
  );
  return edge === undefined ? null : { entityId: edge.farEntityId, name: edge.farDisplayName };
}
