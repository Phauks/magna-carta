// Where the board's screens live. On `community.magnacarta.esq` the board is the whole site, and
// src/hooks.ts reroutes every path there to the routes under /community-board. Anywhere else (a
// developer's machine) those routes are reached by their own path, so every link the board draws
// goes through boardPath and works on both.

export const BOARD_ROUTE_PREFIX = "/community-board";

/** Whether a host is the board's own: `community.` at the front, whatever the domain after it. */
export function isCommunityHost(hostname: string): boolean {
  return hostname.startsWith("community.");
}

/**
 * Whether a host is the public changelog's own: `changelog.` at the front. It is the board's
 * Changelog page under an address of its own, served by the same worker, and the one page of the
 * board that search engines may list.
 */
export function isChangelogHost(hostname: string): boolean {
  return hostname.startsWith("changelog.");
}

/** The address of a board page, as a link on the current host. `path` starts with "/". */
export function boardPath(path: string, hostname: string): string {
  if (isCommunityHost(hostname)) return path;
  // On the changelog's own address the changelog is the whole site; every other board page is a
  // link across to the board's host.
  if (isChangelogHost(hostname)) {
    if (path === "/changelog") return "/";
    return `https://community.${hostname.slice("changelog.".length)}${path}`;
  }
  return path === "/" ? BOARD_ROUTE_PREFIX : `${BOARD_ROUTE_PREFIX}${path}`;
}

/** The route a community-host path is served by. */
export function boardRouteFor(pathname: string): string {
  return pathname === "/" ? BOARD_ROUTE_PREFIX : `${BOARD_ROUTE_PREFIX}${pathname}`;
}

/** The route a changelog-host path is served by: the changelog, whatever the path. */
export function changelogRouteFor(): string {
  return `${BOARD_ROUTE_PREFIX}/changelog`;
}
