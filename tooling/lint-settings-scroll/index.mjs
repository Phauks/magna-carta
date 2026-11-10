/*
 * The settings-scroll gate. A settings page has ONE scroll region, and this is what keeps it one.
 * The ruling, and why a component graph is needed to enforce it, are on settings-scroll.mjs.
 *
 * Usage: node tooling/lint-settings-scroll/index.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditSettingsScroll,
  importBindings,
  importSpecifiers,
  RULING_SOURCE,
  SETTINGS_ROUTES,
  SETTINGS_SCROLL_REGION,
} from "./settings-scroll.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The tree whose stylesheets say which classes scroll. The design system owns all of them. */
const STYLESHEET_TREE = "packages/design-system/src";

/** Where `$lib/…` lands, and the package whose export map resolves `@magna-carta/design-system/…`. */
const WEB_LIBRARY = "apps/web/src/lib";
const DESIGN_SYSTEM = "@magna-carta/design-system";
const DESIGN_SYSTEM_ROOT = "packages/design-system";

/*
 * ALLOWANCES. A real finding somebody has decided to leave standing, with the reason it stands on.
 * Shape: { rule, file, text, reason }, where `file` is the settings route file and `text` is a
 * distinctive fragment of the message — the path of the file that draws the second region.
 *
 * Every entry here is DEBT, printed on each run rather than hidden, and the scan fails when one
 * outlives its finding. What they all stand on is the canvas contract in
 * apps/web/src/lib/components/app-shell.svelte: the work canvas never scrolls sideways, so content
 * wider than it — the product's registers — carries its own horizontal scroller and the page body
 * stays put. That is a sanctioned second region; a second VERTICAL bar on the same list is not.
 */
const REGISTER_PAGES = [
  ["calendar-sync", "the member's calendar sync rules, one event type to a row"],
  ["calendar-sync-policy", "the firm's calendar sync limits, one event type to a row"],
  ["event-types", "the firm's event types"],
  ["notification-policy", "the firm's per-category notification policy"],
  ["notifications", "the member's per-category notification preferences"],
  ["offices", "the firm's offices"],
  ["resources", "the firm's bookable resources"],
  ["users", "the firm's members"],
];

const DATA_TABLE = "packages/design-system/src/lib/components/data-table";
const CANVAS_CONTRACT = "apps/web/src/lib/components/app-shell.svelte";

const ALLOWANCES = [
  {
    rule: "nested-scroll-region",
    file: `${SETTINGS_ROUTES}/+layout.svelte`,
    text: "packages/design-system/src/lib/components/navigation-layout/navigation-layout.svelte",
    reason:
      "The settings shell is a two-sided screen and this is its navigation column, whose own " +
      "capped scroller the two-sided-screen ruling in docs/conventions/design-corrections.md " +
      "leaves standing as one of the screen's two — it is not a second bar on the page's one list.",
  },
  ...REGISTER_PAGES.flatMap(([section, register]) => [
    {
      rule: "nested-scroll-region",
      file: `${SETTINGS_ROUTES}/${section}/+page.svelte`,
      text: `${DATA_TABLE}/data-table-grid.svelte`,
      reason:
        `This page renders ${register} as a wide register, and the canvas contract in ` +
        `${CANVAS_CONTRACT} sanctions a register wider than the canvas carrying its own ` +
        "horizontal scroller so the page body stays put.",
    },
    {
      rule: "nested-scroll-region",
      file: `${SETTINGS_ROUTES}/${section}/+page.svelte`,
      text: `${DATA_TABLE}/table.svelte`,
      reason:
        "The table root arrives with the register through the one data-table barrel rather than " +
        `being rendered here, and stands on the same canvas contract in ${CANVAS_CONTRACT}.`,
    },
  ]),
  // Numbering renders the product's table for ONE purpose: the parts of a numbering scheme, which
  // is a short list of narrow columns rather than a register. It is here because the scheme editor
  // reaches the data-table barrel at all, not because that table is wide — and what keeps that
  // true is that no cell carries a container-scale width, no picker in it claims a width of its
  // own, and Part alone takes the spare width, which apps/web/test/numbering-parts-table.test.ts
  // pins. A static scan cannot see a table's rendered width; that test says how it was checked.
  {
    rule: "nested-scroll-region",
    file: `${SETTINGS_ROUTES}/numbering/+page.svelte`,
    text: `${DATA_TABLE}/table.svelte`,
    reason:
      "The scheme editor's parts list is the product's table (owner ruling, 2026-09-11) and so " +
      "arrives with the barrel's horizontal scroller; its columns shrink to fit the settings " +
      "column, which apps/web/test/numbering-parts-table.test.ts pins, so that scroller never " +
      "draws a bar.",
  },
  {
    rule: "nested-scroll-region",
    file: `${SETTINGS_ROUTES}/numbering/+page.svelte`,
    text: `${DATA_TABLE}/data-table-grid.svelte`,
    reason:
      "The grid is reached through the one data-table barrel and is not rendered by the scheme " +
      "editor, which draws the table parts alone.",
  },
];

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "coverage",
]);

function filesUnder(directory, extensions) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...filesUnder(path.join(directory, entry.name), extensions));
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path.join(directory, entry.name));
    }
  }
  return found;
}

const read = (file) => ({ path: relative(file), source: readFileSync(file, "utf8") });

const designSystemExports = JSON.parse(
  readFileSync(path.join(ROOT, DESIGN_SYSTEM_ROOT, "package.json"), "utf8"),
).exports;

/** A module specifier resolves to at most one file; anything else is ignored and counted. */
function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.svelte`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith(".")) {
    return resolveFile(path.resolve(path.dirname(fromFile), specifier));
  }
  if (specifier.startsWith("$lib/")) {
    return resolveFile(path.join(ROOT, WEB_LIBRARY, specifier.slice("$lib/".length)));
  }
  if (specifier === DESIGN_SYSTEM || specifier.startsWith(`${DESIGN_SYSTEM}/`)) {
    const subpath = specifier === DESIGN_SYSTEM ? "." : `.${specifier.slice(DESIGN_SYSTEM.length)}`;
    const target = designSystemExports?.[subpath];
    if (target === undefined) return undefined;
    return resolveFile(path.join(ROOT, DESIGN_SYSTEM_ROOT, target));
  }
  return undefined;
}

/** Whether a specifier is OURS. An unresolved one of ours is a resolver gap; npm's is not. */
const isOurs = (specifier) =>
  specifier.startsWith(".") ||
  specifier.startsWith("$lib/") ||
  specifier === DESIGN_SYSTEM ||
  specifier.startsWith(`${DESIGN_SYSTEM}/`);

const settingsRoot = path.join(ROOT, ...SETTINGS_ROUTES.split("/"));
const roots = existsSync(settingsRoot)
  ? filesUnder(settingsRoot, ["+page.svelte", "+layout.svelte"]).map(relative).sort()
  : [];

/*
 * The graph, resolved breadth-first from the roots. `.ts` files are followed but never audited: a
 * barrel is how a page reaches a component, and the component is what draws the region.
 */
const graph = [];
const visited = new Set();
const queue = roots.map((file) => path.join(ROOT, file));
let unresolvedImports = 0;
let externalImports = 0;

while (queue.length > 0) {
  const file = queue.shift();
  const key = relative(file);
  if (visited.has(key)) continue;
  visited.add(key);

  const source = readFileSync(file, "utf8");
  const imports = [];
  for (const specifier of importSpecifiers(source)) {
    const target = resolveSpecifier(specifier, file);
    if (target === undefined) {
      if (isOurs(specifier)) unresolvedImports += 1;
      else externalImports += 1;
      continue;
    }
    imports.push({ locals: importBindings(source, specifier), target: relative(target) });
    queue.push(target);
  }
  graph.push({ path: key, source, imports });
}

const stylesheets = filesUnder(path.join(ROOT, STYLESHEET_TREE), [".css"]).map(read);

const rulingFile = path.join(ROOT, ...RULING_SOURCE.split("/"));
const regionFile = path.join(ROOT, ...SETTINGS_SCROLL_REGION.split("/"));

const {
  premiseProblem,
  problems,
  standing,
  rootsSeen,
  filesReached,
  regionsSeen,
  floatingSurfaces,
  scrollingClasses,
} = auditSettingsScroll({
  graph,
  roots,
  stylesheets,
  rulingSource: existsSync(rulingFile) ? readFileSync(rulingFile, "utf8") : "",
  scrollRegionSource: existsSync(regionFile) ? readFileSync(regionFile, "utf8") : "",
  allowances: ALLOWANCES,
  unresolvedImports,
  externalImports,
});

if (premiseProblem !== undefined) {
  console.error(
    `lint-settings-scroll: the ground under this scan moved — ${premiseProblem}.\n\n` +
      `  ${RULING_SOURCE}\n  ${SETTINGS_SCROLL_REGION}\n\n` +
      "This gate only means something while that ruling stands and that component is the region, " +
      "so re-derive it against what is there now rather than going on enforcing a sentence nobody " +
      "wrote any more.",
  );
  process.exit(1);
}

if (standing.length > 0) {
  console.error(
    `lint:settings-scroll: ${standing.length} standing allowance(s) — real findings recorded in ` +
      "this scan's ALLOWANCES with the reason each stands on. They are debt, not exemptions.",
  );
  for (const problem of standing) {
    console.error(`    ${problem.file}`);
    console.error(`      ${problem.introducer} — ${problem.reason}`);
  }
  console.error("");
}

if (problems.length > 0) {
  console.error(
    "A settings page is the three stories and nothing else — masthead, the one scroll region, the " +
      "exit:\n",
  );
  for (const problem of problems) {
    console.error(`  ${problem.file}  [${problem.rule}]`);
    console.error(`    This page ${problem.message}`);
    // The chain, so the reader sees WHICH import put it there rather than going looking for it.
    if (problem.chain.length > 2) console.error(`    through ${problem.chain[1]}`);
    console.error("");
  }
  console.error(
    `${problems.length} finding(s) across ${rootsSeen} settings route file(s). ` +
      `${SETTINGS_SCROLL_REGION} is the one region; a register that must scroll sideways belongs ` +
      "in a component that says so, and the ruling is in " +
      `${RULING_SOURCE} under "Settings".`,
  );
  process.exit(1);
}

// The census says what was LOOKED AT, not merely that nothing failed: a scan that stopped seeing
// prints the same cheerful line as a clean tree unless it reports its own reach.
const accountedFor =
  standing.length === 0
    ? "every one of them SettingsScrollRegion's"
    : `SettingsScrollRegion's, and the ${standing.length} standing allowance(s) above`;

console.log(
  `Settings scroll: ${rootsSeen} settings route file(s) reach ${filesReached} component(s) in the ` +
    `page's own flow, drawing ${regionsSeen} scroll region(s) — ${accountedFor}. ` +
    `${floatingSurfaces} floating surface(s) were not descended into, ` +
    `${scrollingClasses.length} design-system class(es) scroll in their own CSS, and ` +
    `${unresolvedImports} import(s) of ours went unresolved (${externalImports} external one(s) ` +
    "were not followed).",
);
