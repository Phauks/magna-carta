/*
 * The Sitemap — EVERY static page route in the app, generated from the SvelteKit route tree itself
 * (import.meta.glob over +page.svelte) and shaped into a tree that mirrors the URL hierarchy. It
 * is the whole live app and cannot drift: add a route and it appears here on the next build.
 *
 * A node is clickable only if that exact path is a real page. An intermediate segment with no page
 * of its own — /settings has no landing, only /settings/* children — becomes a plain parent label
 * you cannot click, with its pages nested beneath it. Dynamic routes ([id], [...rest]) are omitted
 * (they go nowhere without a value); the Fixtures tab is where those get real URLs.
 */
const PAGE_ROUTE_FILES = import.meta.glob("/src/routes/**/+page.svelte");

export interface SitemapNode {
  /** The single path segment this node names, e.g. "settings" or "theme". */
  segment: string;
  /** The full path to here, e.g. "/settings/theme". */
  path: string;
  /** The URL to navigate to, or null when this segment has no page of its own. */
  href: string | null;
  children: SitemapNode[];
}

/** Turn a +page.svelte file path into its URL, or null if the route is dynamic (needs params). */
function routeUrlFromFile(file: string): string | null {
  const path = file
    .replace(/^\/src\/routes/, "")
    .replace(/\/\+page\.svelte$/, "")
    // Route groups — segments wrapped in parentheses, e.g. (app) — carry no URL segment.
    .replace(/\/\([^/]+\)/g, "");
  if (path.includes("[")) return null;
  return path === "" ? "/" : path;
}

function buildSitemapTree(paths: readonly string[]): SitemapNode[] {
  const realPaths = new Set(paths);
  const roots: SitemapNode[] = [];
  const nodeByPath = new Map<string, SitemapNode>();
  for (const path of paths) {
    // "/" is the only path with no segments; skip the empty split it would produce.
    const segments = path === "/" ? [] : path.slice(1).split("/");
    let siblings = roots;
    let accumulated = "";
    for (const segment of segments) {
      accumulated += `/${segment}`;
      let node = nodeByPath.get(accumulated);
      if (node === undefined) {
        node = {
          segment,
          path: accumulated,
          href: realPaths.has(accumulated) ? accumulated : null,
          children: [],
        };
        nodeByPath.set(accumulated, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  return roots;
}

export const SITEMAP_TREE: readonly SitemapNode[] = buildSitemapTree(
  Object.keys(PAGE_ROUTE_FILES)
    .map(routeUrlFromFile)
    .filter((url): url is string => url !== null)
    .sort((a, b) => a.localeCompare(b)),
);
