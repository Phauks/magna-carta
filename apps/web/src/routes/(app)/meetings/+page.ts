/*
 * The Meetings screen's reads, started where the hover preload can reach them.
 *
 * ONLY THE LIVE SCOPE IS WARMED. A member opening this screen is nearly always asking the first of
 * its three questions — what can I walk into now — and that is the one worth having in hand before
 * the screen mounts. The other two are read by the screen through the same cache a moment later;
 * warming all three would spend three requests on a hover over a sidebar row.
 *
 * ONLY THE FIRST PAGE, which is what `warmPaged` does: the pages after it are what a reader asks for
 * by pressing Show More, and reading ahead on a hover buys rows nobody has looked at.
 *
 * THE UPCOMING SCOPE IS NOT WARMED FOR A SECOND REASON: it needs the reader's own civil day, and a
 * day is a day in a place. The screen resolves that from the browser's zone; a load function that
 * guessed one would file the answer in the cache under a day that is not the reader's.
 */
import { meetingsListInfiniteOptions } from "@magna-carta/api-client";
import { paged, warmPaged } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warmPaged(paged(meetingsListInfiniteOptions({ query: { scope: "live" } })));
};
