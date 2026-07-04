/*
 * THE RECONCILIATION MERGE — pure, no store state, so the rule is unit-testable on its own:
 * the member's stored arrangement is the base; every visible id the member has never placed
 * enters at its CANONICAL position relative to that arrangement — right AFTER the last arranged
 * item that canonically precedes it, at the front otherwise. (Seating by the nearest canonical
 * predecessor, not before the nearest follower, is deliberate: it keeps a newly starred item
 * beside its canonical neighbours and never leaps a middle item to the top of a group whose
 * order the member has rearranged.) Stored ids not currently visible are skipped (they resume
 * their slot if re-starred while still stored). The fixed leader (Home) outranks any arrangement.
 */

/** Home leads its group always — fixed position, excluded from reorder (owner-settled). */
export const FIXED_LEADING_ID = "home";

export function mergeGroupOrder(
  canonicalVisibleIds: readonly string[],
  storedIds: readonly string[],
): string[] {
  const merged = storedIds.filter((id) => canonicalVisibleIds.includes(id));
  for (const id of canonicalVisibleIds) {
    if (merged.includes(id)) continue;
    const canonicalIndex = canonicalVisibleIds.indexOf(id);
    // Insert after the LAST already-placed item that canonically precedes this one; front if
    // none does. Scanning left-to-right and keeping the last qualifying position gives that.
    let insertAt = 0;
    for (let position = 0; position < merged.length; position += 1) {
      const placedId = merged[position];
      if (placedId !== undefined && canonicalVisibleIds.indexOf(placedId) < canonicalIndex) {
        insertAt = position + 1;
      }
    }
    merged.splice(insertAt, 0, id);
  }
  const leaderIndex = merged.indexOf(FIXED_LEADING_ID);
  if (leaderIndex > 0) {
    merged.splice(leaderIndex, 1);
    merged.unshift(FIXED_LEADING_ID);
  }
  return merged;
}
