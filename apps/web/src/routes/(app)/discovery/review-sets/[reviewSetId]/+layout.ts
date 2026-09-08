/*
 * Resolves the review set for every screen in its workspace.
 *
 * A review set a member is not on the access list for answers 404, and this loader turns that into
 * the app's ordinary not-found recovery WITHOUT saying anything else. The wall's rule is ABSENCE
 * rather than refusal: a corpus somebody may not see must look exactly like one that does not
 * exist, because "there is something here you may not see" is itself a disclosure about material
 * that may be under a protective order.
 */
import { error } from "@sveltejs/kit";
import { readReviewSet } from "$lib/discovery/discovery-api.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch, params }) => {
  const outcome = await readReviewSet(fetch, params.reviewSetId);
  if (outcome.kind !== "ok") {
    error(404, "Not Found");
  }
  return { reviewSet: outcome.value };
};
