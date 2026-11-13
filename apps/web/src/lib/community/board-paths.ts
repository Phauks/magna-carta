// Where the board's screens live. On `community.magnacarta.esq` the board is the whole site, and
// src/hooks.ts reroutes every path there to the routes under /community-board. Anywhere else (a
// developer's machine) those routes are reached by their own path, so every link the board draws
// goes through boardPath and works on both.

export const BOARD_ROUTE_PREFIX = "/community-board";

/** Whether a host is the board's own: `community.` at the front, whatever the domain after it. */
export function isCommunityHost(hostname: string): boolean {
  return hostname.startsWith("community.");
}

/** The address of a board page, as a link on the current host. `path` starts with "/". */
export function boardPath(path: string, hostname: string): string {
  if (isCommunityHost(hostname)) return path;
  return path === "/" ? BOARD_ROUTE_PREFIX : `${BOARD_ROUTE_PREFIX}${path}`;
}

/** The route a community-host path is served by. */
export function boardRouteFor(pathname: string): string {
  return pathname === "/" ? BOARD_ROUTE_PREFIX : `${BOARD_ROUTE_PREFIX}${pathname}`;
}
