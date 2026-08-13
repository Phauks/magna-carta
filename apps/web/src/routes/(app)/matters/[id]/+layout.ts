/*
 * Resolves the matter for every page under /matters/[id]. The firm's own record when the identifier
 * names one, otherwise the in-repo sample of that identifier — the two sources and the order they
 * are tried in live in matter-record.ts, so this loader is only the wiring. An identifier that is
 * neither 404s inside the app chrome (the group's +error.svelte), the same recovery as any other
 * wrong turn.
 */
import { error } from "@sveltejs/kit";
import { resolveMatterRecord } from "$lib/matters/matter-record.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch, params }) => {
  const matter = await resolveMatterRecord(fetch, params.id);
  if (matter === undefined) {
    error(404, "Not Found");
  }
  return { matter };
};
