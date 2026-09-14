/*
 * The docket's reads, started where the hover preload can reach them.
 *
 * `data-sveltekit-preload-data="hover"` (app.html) runs this function when the pointer settles on a
 * link to /matters, so by the time the click lands the session, the firm's vocabularies and its
 * roster are already in the cache and the screen renders populated. Placed in the component instead,
 * these four could not begin until the route chunk had been fetched, parsed and mounted.
 *
 * Nothing is awaited and nothing is returned: `warm` fires and the component reads the same
 * questions back out of the cache, whichever of the two got there first. A read that FAILS settles
 * in the cache as a failure and the screen renders its own notice — never an error page over the
 * whole screen, which is what awaiting here would produce.
 */
import {
  locationsListOptions,
  matterTypesListOptions,
  meGetOptions,
  membersListOptions,
} from "@magna-carta/api-client";
import { warmSessionStable } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warmSessionStable(
    meGetOptions(),
    matterTypesListOptions(),
    locationsListOptions(),
    membersListOptions(),
  );
};
