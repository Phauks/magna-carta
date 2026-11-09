/*
 * Resolves the matter for every page under /matters/[id]. The firm's own record when the identifier
 * names one, otherwise the in-repo sample of that identifier — the two sources and the order they
 * are tried in live in matter-record.ts, so this loader is only the wiring. An identifier that is
 * neither 404s inside the app chrome (the group's +error.svelte), the same recovery as any other
 * wrong turn.
 *
 * ARRIVING USES THE CACHE; STAYING RE-READS. Every matter page waits on this read before it draws,
 * so arriving at a matter read a moment ago — back from the docket, across from another matter —
 * used to pay the whole round trip again for an answer the app had just held. The record is now
 * kept in the one query cache at the record staleness (`readMatterRecord`, matter-record.ts).
 *
 * The cache is used only when ARRIVING. A load that runs for the matter already on screen is not a
 * navigation: tab switches inside one matter never re-run this layout, so a re-run for the same
 * identifier is somebody invalidating it — a status change or a renumbering calls `invalidateAll`
 * precisely to see what the server now holds — and that read goes to the server every time. The
 * matter on screen is read off `page.params`, which still names the current page while a navigation
 * or a hover preload is resolving the next one.
 */
import { error } from "@sveltejs/kit";
import { page } from "$app/state";
import { readMatterRecord } from "$lib/matters/matter-record.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch, params }) => {
  const matter = await readMatterRecord(fetch, params.id, page.params.id === params.id);
  if (matter === undefined) {
    error(404, "Not Found");
  }
  return { matter };
};
