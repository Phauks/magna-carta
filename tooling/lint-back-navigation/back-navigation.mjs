/*
 * The scan behind `pnpm run lint:back-navigation` — pure functions over a route tree, so the gate's
 * own tests can feed it a tree that is deliberately wrong and prove the assertions bite.
 *
 * THE RULE. A screen the reader entered FROM another screen carries a way back to it, at the top of
 * its own header. A matter opened from the docket, a person opened from the directory, a check
 * opened from the conflicts register: each is a screen ABOVE which exactly one other screen sits,
 * and each must say so. The rule and its two visual forms are in docs/conventions/ui-design.md; the
 * one component that renders them is apps/web/src/lib/navigation/back-link.svelte.
 *
 * WHAT "ABOVE" MEANS, DERIVED RATHER THAN LISTED. A route's parent screen is the nearest ancestor
 * route that renders a page of its own. Nothing is hand-registered: adding `+page.svelte` under an
 * existing screen puts the new route under this gate, and adding a screen at the top level does not.
 * A route whose ancestors render no page (its parents only redirect, or only draw a shell) has
 * nowhere to go back TO, so nothing is demanded of it — /settings/theme is that case, and its way
 * around is the settings nav the shell draws beside it.
 *
 * WHERE THE AFFORDANCE MAY LIVE. In the page, or in any layout between it and the parent screen —
 * a subtree with one shape pays for the link once (the tools layout does this for every tool page)
 * — and, either way, through however many components that file composes to build its header (the
 * matter's way back lives in matter-header.svelte, three files from the route). So the search
 * follows imports rather than reading one file, which is what lets a header stay a component.
 *
 * WHAT IS CHECKED, BEYOND PRESENCE. The destination: a back link whose href is not the parent
 * screen's own path sends the reader somewhere they did not come from, which is worse than no link
 * at all. Static hrefs are compared literally (a `const SOMETHING_HREF = "/matters"` beside the
 * markup resolves); a parent route carrying a parameter cannot be compared statically, so an
 * expression is accepted there and refused everywhere else.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** SvelteKit route-group segments — `(app)` — which name no path segment. */
const GROUP_SEGMENT = /^\(.+\)$/u;

/** A route segment that is a parameter, so any path built from it is dynamic. */
const PARAMETER_SEGMENT = /\[.+\]/u;

/** The one component that renders the affordance, as its import specifier. */
export const BACK_LINK_MODULE = "$lib/navigation/back-link.svelte";

/**
 * Route subtrees the rule does not reach, each naming what carries the return instead. These are not
 * screens sitting under a main screen; they are the steps of one linear act, and a step goes back to
 * the step before it rather than up to a screen. Their affordance is the sign-in card's own `back`
 * (apps/web/src/lib/auth/auth-panel.svelte), which is a different control with a different meaning.
 */
export const EXCLUDED_SUBTREES = new Map([
  ["login", "the signed-out card carries its own step-back (auth-panel.svelte)"],
  ["register", "the signed-out card carries its own step-back (auth-panel.svelte)"],
]);

/**
 * Routes that decline the affordance, each with the reason a reader still has a way back. Declining
 * is allowed; what is refused is declining silently. Empty is the healthy state.
 */
export const STANDING_EXEMPTIONS = new Map([]);

/** How many component hops the search will follow out of a route file before giving up. */
const MAX_COMPONENT_DEPTH = 4;

/** Every directory under `root` that holds a route file, with what it holds. */
export function discoverRoutes(root, { readDirectory = readdirSync } = {}) {
  const routes = [];
  const walk = (directory, segments) => {
    let entries;
    try {
      entries = readDirectory(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    if (files.has("+page.svelte") || files.has("+layout.svelte")) {
      routes.push({
        directory,
        segments,
        page: files.has("+page.svelte"),
        layout: files.has("+layout.svelte"),
      });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const next = GROUP_SEGMENT.test(entry.name) ? segments : [...segments, entry.name];
      walk(path.join(directory, entry.name), next);
    }
  };
  walk(root, []);
  return routes;
}

/** The URL path a route's segments spell — `/` for the root. */
export function routePath(segments) {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Every page route paired with the screen above it: the nearest ancestor route that renders a page,
 * or null where no ancestor does (a main screen, or a subtree whose parents only redirect).
 */
export function screensUnderAScreen(routes) {
  const pageBySegments = new Map(
    routes.filter((route) => route.page).map((route) => [routePath(route.segments), route]),
  );
  const pairs = [];
  for (const route of routes) {
    if (!route.page) continue;
    let parent = null;
    for (let depth = route.segments.length - 1; depth > 0; depth -= 1) {
      const candidate = pageBySegments.get(routePath(route.segments.slice(0, depth)));
      if (candidate !== undefined) {
        parent = candidate;
        break;
      }
    }
    if (parent !== null) pairs.push({ route, parent });
  }
  return pairs;
}

/** The route files that may carry the affordance: the page, then every layout up to the parent. */
export function candidateFiles({ route, parent }) {
  const files = [path.join(route.directory, "+page.svelte")];
  let directory = route.directory;
  while (directory.length >= parent.directory.length) {
    if (directory !== route.directory) files.push(path.join(directory, "+layout.svelte"));
    if (directory === parent.directory) break;
    const next = path.dirname(directory);
    if (next === directory) break;
    directory = next;
  }
  return files;
}

/** `const NAME = "literal";` bindings, which is how a route file names its destination. */
export function stringConstants(source) {
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"\s*;/gu)) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

/** The default-imported `.svelte` components a file composes, as { localName, specifier }. */
export function componentImports(source) {
  const imports = [];
  for (const match of source.matchAll(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+"([^"]+\.svelte)"\s*;/gmu,
  )) {
    imports.push({ localName: match[1], specifier: match[2] });
  }
  return imports;
}

/** True when a file imports the one back-link component; its local name when it does. */
export function backLinkLocalName(source) {
  const match = new RegExp(
    `^\\s*import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+"${BACK_LINK_MODULE.replace("$", "\\$")}"`,
    "mu",
  ).exec(source);
  return match === null ? null : match[1];
}

/**
 * The destinations a file's own back links name: a resolved path, or null where the href is an
 * expression this scan cannot read.
 */
export function backLinkDestinations(source) {
  const localName = backLinkLocalName(source);
  if (localName === null) return [];
  const constants = stringConstants(source);
  const destinations = [];
  for (const element of source.matchAll(new RegExp(`<${localName}\\b([^>]*)>`, "gu"))) {
    const attributes = element[1];
    const literal = /\bhref\s*=\s*"([^"]*)"/u.exec(attributes);
    if (literal !== null) {
      destinations.push(literal[1]);
      continue;
    }
    const expression = /\bhref\s*=\s*\{([^}]*)\}/u.exec(attributes);
    const named = expression === null ? null : constants.get(expression[1].trim());
    destinations.push(named ?? null);
  }
  return destinations;
}

/** Resolve an import specifier written in a Svelte file to a path on disk. */
export function resolveComponent(specifier, fromFile, { webSource }) {
  if (specifier.startsWith("$lib/")) {
    return path.join(webSource, "lib", specifier.slice("$lib/".length));
  }
  if (specifier.startsWith(".")) return path.resolve(path.dirname(fromFile), specifier);
  return null;
}

/**
 * Every destination reachable from `file`, following the components it composes. A header that lives
 * three components away from its route still answers for the route.
 */
export function destinationsReachableFrom(
  file,
  { webSource, readFile = readFileSync, depth = MAX_COMPONENT_DEPTH, seen = new Set() },
) {
  if (depth < 0 || seen.has(file)) return [];
  seen.add(file);
  let source;
  try {
    source = readFile(file, "utf8");
  } catch {
    return [];
  }
  const destinations = [...backLinkDestinations(source)];
  for (const composed of componentImports(source)) {
    const resolved = resolveComponent(composed.specifier, file, { webSource });
    if (resolved === null) continue;
    destinations.push(
      ...destinationsReachableFrom(resolved, { webSource, readFile, depth: depth - 1, seen }),
    );
  }
  return destinations;
}

/** True when the route lies inside a subtree the rule does not reach. */
export function excludedSubtree(route) {
  return EXCLUDED_SUBTREES.has(route.segments[0]);
}

/**
 * The whole verdict: one failure line per screen that owes a way back and does not have one, or
 * names the wrong destination.
 */
export function auditBackNavigation({
  routesRoot,
  webSource,
  readDirectory = readdirSync,
  readFile = readFileSync,
  exists = (file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  },
}) {
  const routes = discoverRoutes(routesRoot, { readDirectory });
  const failures = [];
  const covered = [];
  const excluded = [];
  const exempted = [];

  for (const pair of screensUnderAScreen(routes)) {
    const here = routePath(pair.route.segments);
    const parentPath = routePath(pair.parent.segments);
    if (excludedSubtree(pair.route)) {
      excluded.push(here);
      continue;
    }
    const exemption = STANDING_EXEMPTIONS.get(here);
    if (exemption !== undefined) {
      exempted.push(`${here} — ${exemption}`);
      continue;
    }

    const destinations = [];
    for (const file of candidateFiles(pair)) {
      if (!exists(file)) continue;
      destinations.push(
        ...destinationsReachableFrom(file, { webSource, readFile, seen: new Set() }),
      );
    }

    if (destinations.length === 0) {
      failures.push(
        `${here} is entered from ${parentPath} and offers no way back to it.\n` +
          `    Put a BackLink at the top of its header — import it from ${BACK_LINK_MODULE} and ` +
          `give it href="${parentPath}" — in ${path.relative(routesRoot, pair.route.directory)}/+page.svelte ` +
          `or in a layout between it and ${parentPath}. The two forms are in docs/conventions/ui-design.md.`,
      );
      continue;
    }

    const parentIsDynamic = PARAMETER_SEGMENT.test(parentPath);
    const matches = destinations.some(
      (destination) => destination === parentPath || (destination === null && parentIsDynamic),
    );
    if (!matches) {
      const named = destinations
        .map((destination) =>
          destination === null ? "an expression this scan cannot read" : destination,
        )
        .join(", ");
      failures.push(
        `${here} has a way back, but it does not lead to ${parentPath} — it names ${named}.\n` +
          `    A link back to a screen the reader did not come from is worse than none. Point it at ` +
          `${parentPath}${parentIsDynamic ? "" : ', as a string literal or a `const NAME = "…"` beside the markup'}.`,
      );
      continue;
    }
    covered.push(here);
  }

  return { failures, covered, excluded, exempted };
}

/**
 * The second drift this gate refuses: a header building its own back arrow out of EyebrowLink and an
 * arrow icon instead of composing BackLink. That is how the two forms diverge — the matter header was
 * exactly this, and its accessible name, its icon size and its register were then its own to keep
 * right. The scan is textual and deliberately narrow: a file that renders EyebrowLink with an
 * ArrowLeft inside it is rendering a back link.
 */
export function handRolledBackLinks(files, { readFile = readFileSync } = {}) {
  const offenders = [];
  for (const file of files) {
    let source;
    try {
      source = readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!/\bEyebrowLink\b/u.test(source)) continue;
    if (!/icons\/arrow-left"/u.test(source)) continue;
    offenders.push(file);
  }
  return offenders;
}
