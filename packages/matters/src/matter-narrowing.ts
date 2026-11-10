import type { UserId } from "@magna-carta/identifiers/types";
import { MATTER_PARTY_CLIENT_ROLE } from "./matter-party.ts";

// A SET OF MATTERS A READER CHOSE TO LOOK INSIDE: their own, or one client's. Written once, as SQL
// over a matter-id expression, so the matters list and the search across matters ask the same
// question and a matter cannot be "mine" on one screen and not on the other.
//
// A NARROWING IS A CHOICE, NEVER A PERMISSION. It only ever takes matters away from what a reader
// could already reach. Whether a reader may see a matter at all is the visible-matter predicate's
// to decide (packages/calendar/src/visibility.ts), and a caller composes a narrowing beside that
// predicate, not in its place.
//
// EACH IS A LIST THE DATABASE WORKS OUT ONCE, written as `<matter> IN (SELECT ...)` over a
// subquery that refers to nothing outside itself. A statement that tests many rows probes that one
// list, and a statement that wants the matters themselves walks it, where a condition written per
// row would read the staffing or the parties again for every row it was asked about. Both
// subqueries start from an index on the value they are given (the member, the entity), so the list
// costs what that member or client has and not what the firm holds.
export interface MatterNarrowing {
  // A SQL condition over the expression naming a row's matter. Each use of the fragment takes the
  // bindings below once, in order.
  readonly fragmentFor: (matterIdExpression: string) => string;
  readonly bindings: readonly unknown[];
}

// The matters a member works on: the ones they are the responsible attorney for, and the ones they
// are currently assigned to in any role. The responsible attorney is a column on the matter and
// not an assignment (matter-assignment.ts), so both are asked. An assignment that has ended is not
// current, and the calendar sync reads "a member's own matters" the same way
// (packages/calendar/src/sync-link-statements.ts).
export function ownMattersNarrowing(memberUserId: UserId): MatterNarrowing {
  return {
    fragmentFor: (matterIdExpression) =>
      `${matterIdExpression} IN (` +
      `SELECT own_matter.id FROM matter AS own_matter WHERE own_matter.responsible_member_id = ? ` +
      `UNION SELECT own_assignment.matter_id FROM matter_assignment AS own_assignment ` +
      `WHERE own_assignment.member_user_id = ? AND own_assignment.valid_to IS NULL)`,
    bindings: [memberUserId, memberUserId],
  };
}

// The matters one person or organization is a client on. A matter with co-clients is each of
// theirs, so this asks whether ANY live client party names the entity, where the read that picks
// one client to bill (matter-party.ts) takes the earliest.
export function clientMattersNarrowing(clientEntityId: string): MatterNarrowing {
  return {
    fragmentFor: (matterIdExpression) =>
      `${matterIdExpression} IN (` +
      `SELECT client_party.matter_id FROM matter_party AS client_party ` +
      `WHERE client_party.entity_id = ? AND client_party.role = '${MATTER_PARTY_CLIENT_ROLE}' ` +
      `AND client_party.deleted_at IS NULL)`,
    bindings: [clientEntityId],
  };
}
