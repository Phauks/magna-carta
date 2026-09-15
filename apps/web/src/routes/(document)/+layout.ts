/*
 * A document tab is a signed-in surface, so it takes the same gate every other signed-in surface
 * takes — the one in $lib/navigation/session-guard.ts, shared with the (app) group rather than
 * copied. Deep-linking to a document without a session lands on /login like anywhere else.
 */
import { guardSignedInSurface } from "$lib/navigation/session-guard.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = ({ url }) => guardSignedInSurface(url);
