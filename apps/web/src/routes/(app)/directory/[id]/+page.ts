/*
 * Which record this address names.
 *
 * The handle's own prefix says whether it is a person or an organization, and anything that is
 * neither cannot name a directory record at all — a mistyped address 404s inside the app chrome
 * rather than reaching a request that could not mean anything. The record itself is read by the
 * page, because the page re-reads it after every write and a loader that fetched it once would
 * leave the two disagreeing.
 */
import { error } from "@sveltejs/kit";
import { entityKindFromIdentifier } from "$lib/directory/directory-api.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  const kind = entityKindFromIdentifier(params.id);
  if (kind === null) error(404, "Not Found");
  return { entityId: params.id, kind };
};
