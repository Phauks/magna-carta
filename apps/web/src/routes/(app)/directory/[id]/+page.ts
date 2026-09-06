/*
 * A directory record's former address.
 *
 * A record no longer has a screen of its own: it opens in the entity window over whatever the
 * reader was doing, and from the directory's list that window is what the record's address names
 * (entity-presentation.ts builds it). This route survives so that a link written before that change
 * still lands on the record — it redirects to the directory with the record's window open. The
 * handle's own prefix says whether it could name a record at all; anything that is neither a
 * person nor an organization 404s inside the app chrome rather than opening a window on nothing.
 */
import { error, redirect } from "@sveltejs/kit";
import { entityKindFromIdentifier } from "$lib/directory/directory-api.ts";
import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  if (entityKindFromIdentifier(params.id) === null) error(404, "Not Found");
  redirect(307, entityRecordHref(params.id));
};
