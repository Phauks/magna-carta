/*
 * THE ONE SCROLL REGION UNDER SETTINGS.
 *
 * The standing ruling this gate enforces, in the owner's own words
 * (docs/conventions/design-corrections.md, Settings, 2026-09-17):
 *
 *   "A settings page is the three stories and nothing else — masthead, the one scroll region, the
 *    exit. ... `SettingsScrollRegion` is the only `overflow-y-auto` under Settings."
 *
 * and, on the same day, the reason a second one is a defect rather than a preference
 * (docs/conventions/design-corrections.md, the calendar, 2026-09-17):
 *
 *   "A region inside a region offers a reader two bars for one list and no way to tell which moves
 *    what."
 *
 * WHY A SECOND GATE, WHEN tooling/lint-scrollbar/ ALREADY READS EVERY OVERFLOW. That one asks a
 * question about ONE class expression — does this element that scrolls wear our scrollbar — and has
 * no idea what renders what. Both regions pass it: the settings scroller wears `mc-scrollbar`, and
 * so does the design-system table's wrapper. The defect only exists in the relationship between
 * them, which is to say in the component graph, and Settings > Numbering shipped with two scrollbars
 * for exactly that reason — the page put `DataTable.Root` inside SettingsScrollRegion, and
 * `.mc-table-scroll`, whose `overflow-x: auto` computes `overflow-y` to `auto` as well, became the
 * second bar on the same list.
 *
 * WHAT THE RULE IS. From every settings route file, follow what it renders. Any scroll region found
 * along the way, other than SettingsScrollRegion itself, is a second bar on the page.
 *
 * WHAT COUNTS AS A SCROLL REGION IS DERIVED, NEVER LISTED — the sibling gate's derivation, and this
 * file imports its harvester rather than restating it:
 *
 *   1. A Tailwind overflow utility that can draw a bar (`overflow-auto`, `overflow-scroll`, the two
 *      axis forms, under any variant prefix such as `max-lg:`).
 *   2. A design-system class whose own CSS declares `overflow`, `overflow-x` or `overflow-y` as
 *      `auto` or `scroll`, read out of the stylesheets at scan time. `.mc-table-scroll` is the
 *      worked example and the reason this gate exists: nothing in the markup says "scroll".
 *
 * WHAT IS NOT INSIDE THE PAGE. A dialog, a sheet, a menu and a listbox are not regions inside the
 * page's region — they are a layer over the whole product, mounted through a portal, and a reader
 * never sees their bar beside the page's. So the walk STOPS at a floating surface and never descends
 * into one. Which components float is derived too: a component family floats when a file in its own
 * directory mounts a portal, and a file is a floating surface when it mounts one itself or renders a
 * `.Content` / `.SubContent` panel of a family that does. Nothing here is a list of component names,
 * because a list is what goes stale when the design system grows its next overlay.
 *
 * THE PREMISE IS READ, NEVER ASSUMED. The whole rule rests on the ruling still saying what it says
 * and on SettingsScrollRegion still being the region. If either moves, the scan fails on the PREMISE
 * rather than going on quietly holding pages to a sentence nobody wrote any more.
 *
 * The rules are pure and the file system stays in index.mjs, so a test states a screen as a string.
 */
import { scrollingRecipeClasses } from "../lint-scrollbar/scrollbar.mjs";

/** Where the ruling lives, and the sentence the premise check reads. Named in every message. */
export const RULING_SOURCE = "docs/conventions/design-corrections.md";
export const RULING_SENTENCE =
  "`SettingsScrollRegion` is the only `overflow-y-auto` under Settings.";

/** The settings route tree — every `+page.svelte` and `+layout.svelte` under it is a root. */
export const SETTINGS_ROUTES = "apps/web/src/routes/(app)/settings";

/**
 * THE ONE EXEMPTION, and the only one this gate has.
 *
 * This file IS the region the ruling names. It is the settings page's middle story — the scroller
 * every settings page scrolls in — so finding `overflow-y-auto` here is the rule being obeyed, not
 * broken. It is exempt by PATH rather than by a marker in the markup, because a marker is something
 * a second region could copy; a path cannot be copied without somebody noticing.
 */
export const SETTINGS_SCROLL_REGION =
  "apps/web/src/lib/settings/components/settings-scroll-region.svelte";

/** The utility that file must still carry for the premise to hold. */
export const SETTINGS_SCROLL_UTILITY = "overflow-y-auto";

/**
 * A Tailwind overflow utility that can draw a scrollbar, matched against ONE class token under any
 * variant prefix — the sibling gate's shape, so the two gates cannot disagree about what scrolls.
 */
const SCROLLING_UTILITY = /^(?:[\w[\]@.,%+/-]+:)*overflow(?:-[xy])?-(?:auto|scroll)$/;

/** A portal being mounted: `<Portal`, or any namespace's `<Dialog.Portal` / `<XPrimitive.Portal`. */
const PORTAL_MOUNT = /<(?:[A-Z][\w]*\.)?Portal[\s/>]/;

/** A floating panel being rendered: `<Dialog.Content`, `<ContextMenu.SubContent`. */
const FLOATING_PANEL = /<([A-Z][\w]*)\.(?:Sub)?Content[\s/>]/g;

/**
 * An import or re-export naming a module, with the clause that says what it takes from it. `[^;]`
 * spans newlines, so a wrapped binding list still matches.
 */
const FROM_SPECIFIER = /(?:^|[\n;{}])\s*(?:import|export)\s+([^;]*?)\bfrom\s*["']([^"']+)["']/g;

/** A side-effect import — `import "./styles.css"` — which names a module with no bindings. */
const BARE_SPECIFIER = /(?:^|[\n;{}])\s*import\s*["']([^"']+)["']/g;

/** A dynamic import. A route that code-splits still renders what it loads. */
const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*["']([^"']+)["']/g;

/** The bindings an import statement introduces — `Dialog`, `* as DataTable`, `{ a, b as c }`. */
const IMPORT_BINDINGS = /(?:^|[\n;{}])\s*import\s+([^;]*?)\bfrom\s*["'][^"']+["']/g;

/** Splits a class expression into the tokens a browser would see as class names. */
function classTokens(text) {
  return text.split(/[^\w[\]@.,%:+/-]+/).filter((token) => token.length > 0);
}

/**
 * The source with everything that is not code blanked out, newlines kept so line numbers hold.
 *
 * This file's own head names `overflow-y-auto` and `mc-table-scroll` repeatedly, and so does every
 * component that explains its scroll region. A scan that read prose would report its own reasoning.
 */
function stripComments(source) {
  const blank = (block) => block.replace(/[^\n]/g, " ");
  return (
    source
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // A line comment, but never the `//` in a URL — `https://…` inside a string is not a comment.
      .replace(/(^|[^:\w])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)))
  );
}

/** Reads a balanced `{…}` from `text` at `start`, returning the index just past its close. */
function pastBalancedBraces(text, start) {
  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return text.length;
}

/** Reads a quoted string from `text` at its opening quote, returning the index just past its close. */
function pastQuoted(text, start) {
  const quote = text[start];
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") cursor += 1;
    else if (text[cursor] === quote) return cursor + 1;
  }
  return text.length;
}

/** Every `class` attribute's value, as a span. `class:foo={…}` is a directive, not one of these. */
function classAttributeSpans(source) {
  const spans = [];
  for (const match of source.matchAll(/(?<![\w:-])class\s*=\s*/g)) {
    const start = match.index + match[0].length;
    const opener = source[start];
    if (opener === "{") spans.push({ start, end: pastBalancedBraces(source, start) });
    else if (opener === '"' || opener === "'")
      spans.push({ start, end: pastQuoted(source, start) });
  }
  return spans;
}

/** Every string literal, as a span. The unit a shared class constant is written in. */
function stringLiteralSpans(source) {
  const spans = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"' || character === "'" || character === "`") {
      const end = pastQuoted(source, cursor);
      spans.push({ start: cursor, end });
      cursor = end;
    } else cursor += 1;
  }
  return spans;
}

/** The 1-based line an offset falls on. */
function lineAt(source, offset) {
  let line = 1;
  for (let cursor = 0; cursor < offset; cursor += 1) if (source[cursor] === "\n") line += 1;
  return line;
}

/**
 * Every scroll region one file introduces, as [{ line, scroller, reason }].
 *
 * A class attribute is the outer unit; a string literal outside every attribute is a unit of its
 * own, which is how a shared class constant in a `.ts` file is written.
 */
export function scrollRegionsIn({ source, scrollingClasses }) {
  const code = stripComments(source);
  const attributes = classAttributeSpans(code);
  const inAttribute = (span) =>
    attributes.some((attribute) => span.start >= attribute.start && span.end <= attribute.end);
  const units = [...attributes, ...stringLiteralSpans(code).filter((span) => !inAttribute(span))];

  const regions = [];
  for (const unit of units) {
    for (const token of classTokens(code.slice(unit.start, unit.end))) {
      const utility = SCROLLING_UTILITY.test(token);
      if (!utility && !scrollingClasses.has(token)) continue;
      regions.push({
        line: lineAt(code, unit.start),
        scroller: token,
        // Why this token scrolls, so the message can say it — a recipe class does not look like one.
        reason: utility ? "utility" : "recipe",
      });
    }
  }
  return regions;
}

/**
 * Whether an import clause takes only TYPES from the module it names.
 *
 * A type renders nothing, so following one would put a component on a page that never draws it —
 * which is how a settings page that merely borrows a column type was reported for the table it
 * does not have. `import type { … }`, `export type { … }`, and a braced list in which every entry
 * is itself `type`-prefixed all say the same thing.
 */
function takesOnlyTypes(clause) {
  const text = clause.trim();
  if (/^type[\s{*]/.test(text)) return true;
  const braced = text.match(/\{([\s\S]*)\}/);
  if (braced === null) return false;
  if (/(^|,)\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(text.slice(0, text.indexOf("{")))) return false;
  const entries = braced[1].split(",").filter((entry) => entry.trim().length > 0);
  return entries.length > 0 && entries.every((entry) => /^\s*type\s/.test(entry));
}

/** Every module specifier a file names, comments stripped so a described import is not followed. */
export function importSpecifiers(source) {
  const code = stripComments(source);
  const found = [];
  for (const match of code.matchAll(FROM_SPECIFIER)) {
    if (takesOnlyTypes(match[1])) continue;
    found.push(match[2]);
  }
  for (const pattern of [BARE_SPECIFIER, DYNAMIC_SPECIFIER]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return [...new Set(found)];
}

/**
 * The local names an import statement binds — `Dialog`, `DataTable`, `NavigationLayoutGroup`.
 *
 * Only the names matter, not which kind of binding they came from: the question they answer is
 * whether `<Dialog.Content>` in this file's markup means the design system's dialog.
 */
export function importBindings(source, specifier) {
  const code = stripComments(source);
  const names = new Set();
  for (const match of code.matchAll(IMPORT_BINDINGS)) {
    if (!match[0].includes(`"${specifier}"`) && !match[0].includes(`'${specifier}'`)) continue;
    for (const [, name] of match[1].matchAll(/(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)/g)) {
      if (name === "type" || name === "as") continue;
      names.add(name);
    }
  }
  return [...names];
}

/** Whether a file mounts a portal of its own. The design system's overlays all do. */
export function mountsPortal(source) {
  return PORTAL_MOUNT.test(stripComments(source));
}

/**
 * The directories whose component family floats — one of their own files mounts a portal.
 *
 * Read off the graph rather than listed, so the day the design system grows another overlay it is
 * already known here, and the day one stops floating this stops excusing it.
 */
function portallingDirectories(graph) {
  const directories = new Set();
  for (const file of graph) {
    if (!mountsPortal(file.source)) continue;
    directories.add(file.path.slice(0, file.path.lastIndexOf("/")));
  }
  return directories;
}

/**
 * Whether a file is a floating surface — a layer over the product rather than part of a page.
 *
 * Two ways: it mounts a portal itself (the design system's own `*-content.svelte` parts), or it
 * renders the `.Content` / `.SubContent` panel of a family that does (a modal frame composed inside
 * `<Dialog.Content>`, a facet list inside `<ContextMenu.SubContent>`). The second is what catches a
 * panel whose scroll region is written in a snippet far from the tag that floats it.
 */
export function isFloatingSurface({ source, floatingNamespaces }) {
  if (mountsPortal(source)) return true;
  const code = stripComments(source);
  for (const [, namespace] of code.matchAll(FLOATING_PANEL)) {
    if (floatingNamespaces.has(namespace)) return true;
  }
  return false;
}

/**
 * The `.svelte` files a root reaches IN THE PAGE'S OWN FLOW, each with the chain that reached it.
 *
 * The walk does not descend into a floating surface: everything below one belongs to that overlay,
 * which is why the RecordWindow's tab panels never reach a page even though a page opens the window.
 */
function reachedInFlow({ root, byPath, floating }) {
  const reached = new Map();
  const queue = [{ path: root, chain: [root] }];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const { path: current, chain } = queue.shift();
    const file = byPath.get(current);
    if (file === undefined) continue;
    if (current !== root && floating.has(current)) continue;
    if (current.endsWith(".svelte") && current !== root) reached.set(current, chain);
    for (const target of file.imports.map((entry) => entry.target)) {
      if (target === undefined || seen.has(target)) continue;
      seen.add(target);
      queue.push({ path: target, chain: [...chain, target] });
    }
  }
  return reached;
}

/** The message one finding prints. The introducer's path is what an allowance matches on. */
function findingMessage({ introducer, line, scrollers }) {
  const named = scrollers
    .map((region) =>
      region.reason === "utility"
        ? `\`${region.scroller}\` makes it scroll`
        : `\`${region.scroller}\` scrolls in its own CSS`,
    )
    .join(", ");
  return `reaches ${introducer}:${line}, where ${named} — a second region inside the page's one.`;
}

/**
 * The settings surface's scroll regions, audited.
 *
 * `graph` is [{ path, source, imports: [{ locals, target }] }] over every file the resolver reached;
 * `roots` are the settings route files; `stylesheets` derive what scrolls; `allowances` is
 * [{ rule, file, text, reason }].
 *
 * `premiseProblem` is set when the ruling or the region itself has moved out from under this scan,
 * and no finding is reported alongside it — the rule has no ground to stand on until that is
 * answered.
 */
export function auditSettingsScroll({
  graph,
  roots,
  stylesheets,
  rulingSource,
  scrollRegionSource,
  allowances = [],
  unresolvedImports = 0,
  externalImports = 0,
}) {
  const premiseProblem = premiseOf({ graph, roots, stylesheets, rulingSource, scrollRegionSource });
  if (premiseProblem !== undefined) {
    return {
      premiseProblem,
      problems: [],
      standing: [],
      rootsSeen: roots.length,
      filesReached: 0,
      regionsSeen: 0,
      floatingSurfaces: 0,
      scrollingClasses: [],
      unresolvedImports,
      externalImports,
    };
  }

  const scrollingClasses = scrollingRecipeClasses(stylesheets);
  const byPath = new Map(graph.map((file) => [file.path, file]));
  const portalling = portallingDirectories(graph);

  const floating = new Set();
  for (const file of graph) {
    const floatingNamespaces = new Set();
    for (const entry of file.imports) {
      if (entry.target === undefined) continue;
      const directory = entry.target.slice(0, entry.target.lastIndexOf("/"));
      if (!portalling.has(directory)) continue;
      for (const local of entry.locals ?? []) floatingNamespaces.add(local);
    }
    if (isFloatingSurface({ source: file.source, floatingNamespaces })) floating.add(file.path);
  }

  const problems = [];
  const reachedEverywhere = new Set();
  for (const root of roots) {
    const reached = reachedInFlow({ root, byPath, floating });
    // Findings are reported in path order, so a run reads the same way twice.
    for (const introducer of [...reached.keys()].toSorted()) {
      const chain = reached.get(introducer);
      reachedEverywhere.add(introducer);
      if (introducer === SETTINGS_SCROLL_REGION) continue;
      const regions = scrollRegionsIn({
        source: byPath.get(introducer).source,
        scrollingClasses,
      });
      if (regions.length === 0) continue;
      // One class named twice in a file is one fact about it, so the message says it once.
      const distinct = [...new Map(regions.map((region) => [region.scroller, region])).values()];
      problems.push({
        rule: "nested-scroll-region",
        file: root,
        introducer,
        line: regions[0].line,
        scrollers: distinct.map((region) => region.scroller),
        chain,
        message: findingMessage({ introducer, line: regions[0].line, scrollers: distinct }),
      });
    }
  }

  // The census counts each region once, however many pages reach the file that draws it.
  let regionsSeen = 0;
  for (const reached of reachedEverywhere) {
    regionsSeen += scrollRegionsIn({
      source: byPath.get(reached).source,
      scrollingClasses,
    }).length;
  }

  return {
    ...applyAllowances({ problems, allowances }),
    rootsSeen: roots.length,
    filesReached: reachedEverywhere.size,
    regionsSeen,
    floatingSurfaces: floating.size,
    scrollingClasses: [...scrollingClasses].sort(),
    unresolvedImports,
    externalImports,
  };
}

/** The premise: the ruling still says it, the region is still the region, the scan still sees. */
function premiseOf({ graph, roots, stylesheets, rulingSource, scrollRegionSource }) {
  // The ruling is prose, so it wraps. Whitespace is collapsed before the sentence is looked for:
  // a reflow of the paragraph is not the ruling moving, and must not read as one.
  if (!(rulingSource ?? "").replace(/\s+/g, " ").includes(RULING_SENTENCE)) {
    return `${RULING_SOURCE} no longer contains the sentence this scan enforces`;
  }
  if (!(scrollRegionSource ?? "").includes(SETTINGS_SCROLL_UTILITY)) {
    return `${SETTINGS_SCROLL_REGION} no longer carries \`${SETTINGS_SCROLL_UTILITY}\`, so it is no longer the region the ruling names`;
  }
  if (roots.length === 0) {
    return `no \`+page.svelte\` or \`+layout.svelte\` was found under ${SETTINGS_ROUTES}`;
  }
  if (graph.length === 0) return "the import graph came back empty";
  if (scrollingRecipeClasses(stylesheets).size === 0) {
    return "no design-system class scrolls in its own CSS, which cannot be true while tables scroll";
  }
  return undefined;
}

/**
 * The allowances, applied and then audited — the discipline tooling/lint-modal-headers/ and
 * tooling/lint-one-ui/ hold their lists to, for the same reason: a list nobody re-reads is a gate
 * that has gone quiet.
 *
 * An entry with no reason does not suppress anything, because an allowance is the reason; without
 * one it is a finding somebody deleted. An entry that matches nothing is debt that has been paid,
 * and it fails the run so that it gets deleted rather than accumulating.
 */
function applyAllowances({ problems, allowances }) {
  const reasoned = [];
  const remaining = [];
  for (const allowance of allowances) {
    if ((allowance.reason ?? "").trim().length > 0) {
      reasoned.push(allowance);
      continue;
    }
    remaining.push({
      rule: "allowance",
      file: allowance.file,
      introducer: allowance.text,
      line: 0,
      scrollers: [],
      chain: [],
      message:
        `is allowed for \`${allowance.rule}\` ("${allowance.text}") with no reason. An allowance IS ` +
        "its reason — name the ruling it stands against, or take the entry out.",
    });
  }

  const standing = [];
  const used = new Set();
  for (const problem of problems) {
    const match = reasoned.find(
      (allowance) =>
        allowance.rule === problem.rule &&
        allowance.file === problem.file &&
        problem.message.includes(allowance.text),
    );
    if (match === undefined) remaining.push(problem);
    else {
      standing.push({ ...problem, reason: match.reason });
      used.add(match);
    }
  }

  for (const allowance of reasoned) {
    if (used.has(allowance)) continue;
    remaining.push({
      rule: "allowance",
      file: allowance.file,
      introducer: allowance.text,
      line: 0,
      scrollers: [],
      chain: [],
      message:
        `is allowed for \`${allowance.rule}\` ("${allowance.text}") and no longer violates it. Take ` +
        "the allowance out — an entry that has outlived its violation is how a list stops being read.",
    });
  }

  return { problems: remaining, standing };
}
