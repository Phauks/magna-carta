/*
 * What the tab already knows about an entity a reader is about to link.
 *
 * Unlike a document, an entity is NOT left out of the picker once it is on the record: one person is
 * the administrator and a beneficiary on the same estate, and a picker that hid them after the first
 * link would make the second impossible. What the tab does instead is say what it already holds —
 * "already on this record as Administrator" — and refuse only the exact repeat, the same entity in
 * the same role, which is the one link that means nothing.
 *
 * Pure functions in a plain module rather than logic inside the component, so the rule can be tested
 * on its own and so a caller that needs the same answer elsewhere gets it from here.
 */
import type { RecordParty } from "./types.ts";

/**
 * The roles an entity already holds on this record, as readers see them, in the order the record
 * lists them. Empty when the entity is not on the record.
 */
export function rolesAlreadyHeld(
  parties: readonly RecordParty[],
  entityIdentifier: string,
): string[] {
  return parties
    .filter((party) => party.entityIdentifier === entityIdentifier)
    .map((party) => party.roleLabel ?? party.role ?? "")
    .filter((label) => label !== "");
}

/**
 * Whether linking this entity in this role would repeat a link the record already has.
 *
 * Roles are compared as stored, because that is what the record compares; a caller whose roles are
 * stored in a normalized form hands them over in that form. A record whose links carry no role at all
 * treats a second link to the same entity as the repeat, since there is no role to differ by.
 */
export function isRepeatLink(
  parties: readonly RecordParty[],
  entityIdentifier: string,
  role: string | null,
): boolean {
  return parties.some(
    (party) => party.entityIdentifier === entityIdentifier && (party.role ?? null) === role,
  );
}

/**
 * The one sentence for what the record already holds about an entity, so every tab says it the same
 * way. Null when there is nothing to say.
 */
export function alreadyHeldSentence(rolesHeld: readonly string[]): string | null {
  if (rolesHeld.length === 0) return null;
  if (rolesHeld.length === 1) return `Already on this record as ${rolesHeld[0] ?? ""}.`;
  const last = rolesHeld[rolesHeld.length - 1] ?? "";
  return `Already on this record as ${rolesHeld.slice(0, -1).join(", ")} and ${last}.`;
}
