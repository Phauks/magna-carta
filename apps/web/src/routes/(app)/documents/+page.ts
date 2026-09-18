/*
 * The template library's reads, started where the hover preload can reach them.
 *
 * `data-sveltekit-preload-data="hover"` (app.html) runs this function when the pointer settles on
 * the sidebar's Documents row, so by the time the click lands the session, the firm's practice
 * areas and its Locations are in the cache and the catalogue's first page is on its way. Placed in
 * the component instead, none of these could begin until the route chunk had been fetched, parsed
 * and mounted.
 *
 * Nothing is awaited and nothing is returned: the component reads the same questions back out of
 * the cache, whichever of the two got there first. A read that FAILS settles in the cache as a
 * failure and the screen renders its own notice — never an error page over the whole screen.
 *
 * Only the ACTIVE catalogue is warmed. The archived listing is a second read the reader asks for
 * from the foot of the list, and reading it on a hover would spend a request on rows most visits
 * never look at.
 */
import {
  locationsListOptions,
  matterTypesListOptions,
  meGetOptions,
  templatesListInfiniteOptions,
} from "@magna-carta/api-client";
import { paged, warmPaged, warmSessionStable } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warmSessionStable(meGetOptions(), matterTypesListOptions(), locationsListOptions());
  warmPaged(paged(templatesListInfiniteOptions({ query: { status: "active" } })));
};
