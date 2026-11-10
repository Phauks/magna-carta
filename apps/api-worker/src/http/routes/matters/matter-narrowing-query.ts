import { z } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  clientMattersNarrowing,
  ownMattersNarrowing,
  type MatterNarrowing,
} from "@magna-carta/matters/matter-narrowing";

// The two ways a member narrows a read of the firm's matters to a set they chose, as the matters
// list and the search across matters both take them. One module, so the two routes spell the
// parameters alike and resolve them to the same SQL (@magna-carta/matters/matter-narrowing): a
// matter that is "mine" in the list is "mine" in the search.
//
// NEITHER IS A PERMISSION. Each only takes matters away from what the route would have answered
// with, and each route still decides for itself what the member may see.
export const matterNarrowingQuery = {
  // The member's own matters: the ones they are responsible for or currently assigned to. Whose
  // matters is never a value in the request; it is the session's member.
  mine: z.literal("true").optional(),
  // One client's matters: every matter with a live client party naming this person or organization.
  clientEntityId: z.string().min(1).max(100).optional(),
};

export function matterNarrowingsOf(
  sessionUserId: UserId,
  query: { mine?: "true"; clientEntityId?: string },
): MatterNarrowing[] {
  const narrowings: MatterNarrowing[] = [];
  if (query.mine === "true") narrowings.push(ownMattersNarrowing(sessionUserId));
  if (query.clientEntityId !== undefined) {
    narrowings.push(clientMattersNarrowing(query.clientEntityId));
  }
  return narrowings;
}

// The matters list's query, here and not in the route module because it is a shape of its own and
// that module is already past the size the route-shape ratchet holds new work to. The status
// vocabulary stays where the routes that write a status declare it, and is handed in.
export function listMattersQueryOver<Status extends z.ZodType>(matterStatus: Status) {
  return z.object({
    status: matterStatus.optional(),
    matterTypeId: identifierField("matterType").optional(),
    locationId: identifierField("location").optional(),
    responsibleMemberId: identifierField("user").optional(),
    search: z.string().optional(),
    ...matterNarrowingQuery,
    cursor: z.string().optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
  });
}
