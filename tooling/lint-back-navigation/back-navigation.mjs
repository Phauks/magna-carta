/*
 * The scan behind `pnpm run lint:back-navigation` — pure functions over a route tree, so the gate's
 * own tests can feed it a tree that is deliberately wrong and prove the assertions bite.
 *
 * TWO RULES, AND THE SECOND IS WHAT KEEPS THE FIRST TRUE.
 *
 * 1. A screen the reader entered FROM another screen names where it came from. A matter opened from
 *    the docket, a person opened from the directory, a check opened from the conflicts register:
 *    each is a screen with exactly one screen above it, and each says so by passing `back` to its
 *    header.
 *
 * 2. Every screen's header IS that one component. Twenty screens assembled the design-system
 *    Masthead by hand in eight different combinations, and four more hand-rolled an `h1` outside the
 *    design system entirely; that variety is what made the first rule impossible to see and easy to
 *    forget. So `Masthead.Root` is spoken for: screen-header.svelte composes it, and nothing else in
 *    the application may. A screen that assembles its own header is a screen that can quietly grow
 *    its own idea of where the way back goes, or grow none at all.
 *
 * WHAT "ABOVE" MEANS, DERIVED RATHER THAN LISTED. A route's parent screen is the nearest ancestor
 * route that renders a page of its own. Nothing is hand-registered: adding `+page.svelte` under an
 * existing screen puts the new route under this gate, and adding a screen at the top level does not.
 * A route whose ancestors render no page (its parents only redirect, or only draw a shell) has
 * nowhere to go back TO, so nothing is demanded of it — /settings/theme is that case, and its way
 * around is the settings nav the shell draws beside it.
 *
 * WHERE THE ANSWER MAY LIVE. In the page, in any layout between it and the parent screen, or in
 * however many components that file composes to build its header (the matter's header is three
 * files from its route). So the search follows imports rather than reading one file.
 *
 * WHAT IS CHECKED, BEYOND PRESENCE. The destination. A screen passes a DESTINATION ID, which this
 * scan resolves through the sidebar registry exactly as the application does, and the resulting path
 * must be the parent screen's own. A back link that leads somewhere the reader did not come from is
 * worse than none at all. An id the registry does not hold is refused here as well as by the type
 * checker.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** SvelteKit route-group segments — `(app)` — which name no path segment. */
const GROUP_SEGMENT = /^\(.+\)$/u;

/** A route segment that is a parameter, so any path built from it is dynamic. */
const PARAMETER_SEGMENT = /\[.+\]/u;

/** The one component every screen's header comes from, as its import specifier. */
export const SCREEN_HEADER_MODULE = "$lib/screen/screen-header.svelte";

/** Where the sidebar destinations and the spelled-out back targets are declared. */
export const DESTINATIONS_SOURCE = "apps/web/src/lib/navigation/destinations.ts";
export const BACK_TARGETS_SOURCE = "apps/web/src/lib/screen/screen-header.ts";

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
export const STANDING_EXEMPTIONS = new Map([
  [
    "/directory/[id]",
    "a directory record has no screen: this is its former address, whose loader redirects to the directory with that record's window open, so nothing renders here",
  ],
  [
    "/shipping/[id]",
    "a shipment has no screen: this is its former address, whose loader redirects to the register with that shipment's window open, so nothing renders here",
  ],
  [
    "/documents/[id]/edit",
    "a document is the matter's, and the editor's header already carries the way back to that matter's Files page (matterFilesBack); the library at /documents above this path holds TEMPLATES, which a document never is, so a Back to Documents would land a reader on a catalogue the document is not in",
  ],
  [
    "/documents/[id]/view",
    "the same as the editor: the viewer's way back is the matter's Files page, and the template library above it is not where a document lives",
  ],
  [
    "/documents/[id]/pdf",
    "the same as the viewer: the PDF Editor's way back is the matter's Files page, and the template library above it is not where a document lives",
  ],
  [
    "/documents/[id]/watch",
    "the same as the viewer: the player's way back is the matter's Files page, and the template library above it is not where a recording lives",
  ],
  [
    "/discovery/review-sets/[reviewSetId]/documents/[reviewDocumentId]",
    "the reviewer's way back has to carry the narrowing it was opened from, and a registry back target cannot: its href is a literal, so it would land a reader on the whole corpus after they opened one document out of forty. The reviewer carries its own Back to the list link, built from the criteria set in the address; the workspace layout above it holds the header, and its way back is the Discovery register",
  ],
]);

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

/** The route files that may carry the answer: the page, then every layout up to the parent. */
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

/**
 * The path each destination id leads to, read from the registry's own source. Reading the source
 * rather than importing it keeps this gate dependency-free and runnable before a build.
 */
export function destinationPaths(source) {
  const paths = new Map();
  for (const match of source.matchAll(/\bid:\s*"([^"]+)",[\s\S]{0,400}?\bhref:\s*"([^"]+)",/gu)) {
    if (!paths.has(match[1])) paths.set(match[1], match[2]);
  }
  return paths;
}

/** The path each spelled-out back target leads to (`DEVELOPER_CONSOLE_BACK` and any successor). */
export function spelledOutBackTargets(source) {
  const targets = new Map();
  for (const match of source.matchAll(
    /export const ([A-Z][A-Z0-9_]*)\s*:\s*BackDestination\s*=\s*\{[\s\S]*?href:\s*"([^"]+)"/gu,
  )) {
    targets.set(match[1], match[2]);
  }
  return targets;
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

/**
 * Where a file says it was entered from: one entry per `back` it names.
 *
 * The attribute is what the scan reads, not the element it sits on. A screen usually hands `back`
 * to the header directly, but a shared screen body takes it as a prop and forwards it — the
 * calendar's two routes are one component, and only the route knows whether it is the calendar or a
 * screen under it. Reading the attribute rather than the element covers both, and the second rule
 * (nothing but the header assembles a masthead) is what guarantees it reaches a real header.
 *
 * A STRING is a destination id and must resolve; an unknown one is a typo, reported. An IDENTIFIER
 * is either a declared back target (resolved) or a forwarded prop — `{back}` inside the component
 * that received it — which says nothing about any one screen and is passed over rather than
 * counted against it.
 */
export function backDestinations(source, { destinations, spelledOut }) {
  const found = [];
  for (const match of source.matchAll(/\bback\s*=\s*"([^"]*)"/gu)) {
    found.push({ named: match[1], to: destinations.get(match[1]) ?? null });
  }
  for (const match of source.matchAll(/\bback\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/gu)) {
    const target = spelledOut.get(match[1]);
    if (target !== undefined) found.push({ named: match[1], to: target });
  }
  return found;
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
 * three components away from its route still answers for the route. The screen header itself is
 * never followed: it holds the back link every screen's answer flows through, so walking into it
 * would report a way back for every screen that has a title.
 */
export function destinationsReachableFrom(
  file,
  { webSource, tables, readFile = readFileSync, depth = MAX_COMPONENT_DEPTH, seen = new Set() },
) {
  if (depth < 0 || seen.has(file)) return [];
  seen.add(file);
  let source;
  try {
    source = readFile(file, "utf8");
  } catch {
    return [];
  }
  const found = [...backDestinations(source, tables)];
  for (const composed of componentImports(source)) {
    if (composed.specifier === SCREEN_HEADER_MODULE) continue;
    const resolved = resolveComponent(composed.specifier, file, { webSource });
    if (resolved === null) continue;
    found.push(
      ...destinationsReachableFrom(resolved, {
        webSource,
        tables,
        readFile,
        depth: depth - 1,
        seen,
      }),
    );
  }
  return found;
}

/** True when the route lies inside a subtree the rule does not reach. */
export function excludedSubtree(route) {
  return EXCLUDED_SUBTREES.has(route.segments[0]);
}

/**
 * The whole verdict: one failure line per screen that owes a way back and does not name one, or
 * names the wrong screen.
 */
export function auditBackNavigation({
  routesRoot,
  webSource,
  destinations = new Map(),
  spelledOut = new Map(),
  /* The standing register by default; the gate's own tests hand in their own so a fixture route
     that happens to share a real route's path is still judged. */
  exemptions = STANDING_EXEMPTIONS,
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
  const tables = { destinations, spelledOut };
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
    const exemption = exemptions.get(here);
    if (exemption !== undefined) {
      exempted.push(`${here} — ${exemption}`);
      continue;
    }

    const found = [];
    for (const file of candidateFiles(pair)) {
      if (!exists(file)) continue;
      found.push(
        ...destinationsReachableFrom(file, { webSource, tables, readFile, seen: new Set() }),
      );
    }

    if (found.length === 0) {
      failures.push(
        `${here} is entered from ${parentPath} and its header does not say so.\n` +
          `    Pass \`back\` to its ScreenHeader — the destination whose path is ${parentPath} — in ` +
          `${path.relative(routesRoot, pair.route.directory)}/+page.svelte or in a layout between it ` +
          `and ${parentPath}. The rule and the two forms are in docs/conventions/ui-design.md.`,
      );
      continue;
    }

    const unresolved = found.filter((entry) => entry.to === null);
    if (unresolved.length > 0 && !found.some((entry) => entry.to === parentPath)) {
      failures.push(
        `${here} names \`back={${unresolved[0].named}}\`, which resolves to no destination.\n` +
          `    Name a destination from ${DESTINATIONS_SOURCE} by its id, or a back target declared ` +
          `in ${BACK_TARGETS_SOURCE}.`,
      );
      continue;
    }

    const parentIsDynamic = PARAMETER_SEGMENT.test(parentPath);
    const matches = found.some((entry) => entry.to === parentPath || parentIsDynamic);
    if (!matches) {
      failures.push(
        `${here} has a way back, but it does not lead to ${parentPath} — it names ` +
          `${found.map((entry) => `${entry.named} (${entry.to})`).join(", ")}.\n` +
          `    A link back to a screen the reader did not come from is worse than none.`,
      );
      continue;
    }
    covered.push(here);
  }

  return { failures, covered, excluded, exempted };
}

/**
 * The second rule: every screen's header is the one component. `Masthead.Root` is the design
 * system's page-header primitive, and screen-header.svelte is the only thing in the application
 * allowed to compose it — otherwise the variety this gate exists to end simply grows back, one
 * screen at a time, and each new arrangement is free to forget the way back.
 */
export function handRolledHeaders(files, { readFile = readFileSync, allow = new Set() } = {}) {
  const offenders = [];
  for (const file of files) {
    if (allow.has(file)) continue;
    let source;
    try {
      source = readFile(file, "utf8");
    } catch {
      continue;
    }
    if (/<Masthead\.Root\b/u.test(source)) {
      offenders.push({ file, reason: "assembles Masthead.Root itself" });
      continue;
    }
    // A header hand-rolled out of the eyebrow link and an arrow icon is the same drift wearing
    // different parts: it is how the back affordance's accessible name and register diverged before.
    if (/\bEyebrowLink\b/u.test(source) && /icons\/arrow-left"/u.test(source)) {
      offenders.push({
        file,
        reason: "builds its own back link from EyebrowLink and an arrow icon",
      });
    }
  }
  return offenders;
}
