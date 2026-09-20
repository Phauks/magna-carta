/*
 * The Workspace-search gate. Every screen under the sidebar's Workspace heading searches itself
 * through the one control, in the one place, and searches its own list in place rather than
 * swapping a second table in over it — or says why it does not. The rules, and why each exists,
 * are on workspace-search.mjs.
 *
 * Usage: node tooling/lint-workspace-search/index.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditWorkspaceSearch,
  DECLINED,
  DESTINATIONS_SOURCE,
  SECOND_SURFACE_ALLOWED,
  workspaceDestinations,
} from "./workspace-search.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const ROUTES_ROOT = path.join(WEB_SOURCE, "routes");
const APP_GROUP = path.join(ROUTES_ROOT, "(app)");

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const absolute = (file) => path.join(ROOT, file);

/** A repository-relative path's source, or null when there is no such file. */
function read(file) {
  const target = absolute(file);
  return existsSync(target) ? readFileSync(target, "utf8") : null;
}

/**
 * The route page serving a destination path. `(app)` and friends are group segments that do not
 * appear in a URL, so `/notifications` is served by `(app)/notifications/+page.svelte`.
 */
function pageOf(href) {
  const segments = href.split("/").filter((segment) => segment !== "");
  const page = path.join(APP_GROUP, ...segments, "+page.svelte");
  return existsSync(page) ? relative(page) : null;
}

function svelteFilesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...svelteFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith(".svelte")) found.push(child);
  }
  return found;
}

const registry = read(DESTINATIONS_SOURCE);
if (registry === null) {
  console.error(`lint-workspace-search: ${DESTINATIONS_SOURCE} is not there. Fix the path.`);
  process.exit(1);
}

const destinations = workspaceDestinations(registry);
if (destinations.length === 0) {
  console.error(
    `lint-workspace-search: parsed no Workspace destinations out of ${DESTINATIONS_SOURCE}. The ` +
      "registry's shape changed and this scan can no longer read it — fix the parser rather than " +
      "the registry, because a scan that reads nothing reports nothing and looks like a pass.",
  );
  process.exit(1);
}

/*
 * What rules 3 and 4 scan: the route pages of the Workspace screens, and every `$lib` component they
 * reach. That is the surface the ruling binds — a hand-rolled search inside the design system is
 * how ScreenSearch itself is built, and a `type="search"` in a dialog's own field is a field in a
 * form rather than a screen's search.
 */
const screenFilePaths = new Set();
for (const destination of destinations) {
  if (!destination.shipped) continue;
  const page = pageOf(destination.href);
  if (page === null) continue;
  screenFilePaths.add(page);
  const directory = path.dirname(absolute(page));
  for (const file of svelteFilesUnder(directory)) screenFilePaths.add(relative(file));
}

const screenFiles = [...screenFilePaths]
  // Named order, so a run's output reads the same twice and a diff of two runs is about the code.
  .toSorted((left, right) => left.localeCompare(right))
  .map((file) => ({ path: file, source: read(file) ?? "" }));

const { problems, covered, declining, allowing } = auditWorkspaceSearch({
  destinations,
  pageOf,
  read,
  screenFiles,
});

if (problems.length > 0) {
  console.error("Workspace screens disagree about how a screen is searched:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  [${problem.rule}]`);
    console.error(`    The screen ${problem.message}\n`);
  }
  console.error(
    `${problems.length} problem(s). Every Workspace screen searches itself through the one ` +
      "control, in the header's action row — see docs/conventions/design-corrections.md, " +
      '"Screen search".',
  );
  process.exit(1);
}

const shipped = destinations.filter((destination) => destination.shipped).length;
console.log(
  `Workspace search: ${covered.length} of ${shipped} shipped Workspace screen(s) search through ` +
    `ScreenSearch, across ${screenFiles.length} screen file(s) with no second implementation of ` +
    "the control and no second surface for its answer.",
);
if (allowing.length > 0) {
  console.log(
    `\n${allowing.length} screen(s) keep a second results surface, each with its reason:\n`,
  );
  for (const { file, reason } of allowing) {
    console.log(`  ${file}`);
    console.log(`    ${reason}\n`);
  }
}
if (SECOND_SURFACE_ALLOWED.size !== allowing.length) {
  // An allowance over a file this scan never reads never runs, so it would sit in the list forever
  // saying nothing. The same hazard as an idle decline, named the same way.
  const scanned = new Set(screenFiles.map((file) => file.path));
  const idle = [...SECOND_SURFACE_ALLOWED.keys()].filter((file) => !scanned.has(file));
  if (idle.length > 0) {
    console.log(
      `Recorded second-surface allowances matching no Workspace screen file: ${idle.join(", ")}. ` +
        "Each names a file that has moved, been deleted, or left the Workspace group — delete it.",
    );
  }
}
if (declining.length > 0) {
  console.log(`\n${declining.length} screen(s) decline a search, each with its reason:\n`);
  for (const { destination, reason } of declining) {
    console.log(`  ${destination.label} (${destination.href})`);
    console.log(`    ${reason}\n`);
  }
}
if (DECLINED.size !== declining.length) {
  // A decline recorded for a destination that is not a shipped Workspace screen never runs, so it
  // would sit in the list forever saying nothing. Naming it is cheaper than auditing the list.
  const live = new Set(declining.map(({ destination }) => destination.id));
  const idle = [...DECLINED.keys()].filter((id) => !live.has(id));
  if (idle.length > 0) {
    console.log(
      `Recorded declines matching no shipped Workspace screen: ${idle.join(", ")}. Each names a ` +
        "destination that has moved group, stopped shipping, or lost its page — delete it.",
    );
  }
}
