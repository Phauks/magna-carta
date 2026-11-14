import type { Reroute } from "@sveltejs/kit";
import { boardRouteFor, isCommunityHost } from "$lib/community/board-paths.ts";

// The community board is served from its own host by its own worker (apps/community-worker), which
// hands back this same build. On that host every path is the board's, so it is rerouted to the
// board's routes; the address bar keeps the short path. Every other host is the app.
export const reroute: Reroute = ({ url }) => {
  if (!isCommunityHost(url.hostname)) return undefined;
  return boardRouteFor(url.pathname);
};
