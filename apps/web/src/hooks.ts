import type { Reroute } from "@sveltejs/kit";
import {
  boardRouteFor,
  changelogRouteFor,
  isChangelogHost,
  isCommunityHost,
} from "$lib/community/board-paths.ts";

// The community board is served from its own host by its own worker (apps/community-worker), which
// hands back this same build. On that host every path is the board's, so it is rerouted to the
// board's routes; the address bar keeps the short path. The public changelog's own address, served
// by the same worker, shows the board's Changelog page at every path. Every other host is the app.
export const reroute: Reroute = ({ url }) => {
  if (isChangelogHost(url.hostname)) return changelogRouteFor();
  if (!isCommunityHost(url.hostname)) return undefined;
  return boardRouteFor(url.pathname);
};
