/*
 * The screen-header gate. Every screen states its name the same way, and this is what keeps it so.
 * The rules, and why each exists, are on screen-headers.mjs.
 *
 * Usage: node tooling/lint-screen-headers/index.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditScreenHeaders,
  destinationLabels,
  DESTINATIONS_SOURCE,
  EXEMPTIONS,
} from "./screen-headers.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const ROUTES_ROOT = path.join(WEB_SOURCE, "routes");

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function svelteFilesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...svelteFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith(".svelte")) found.push(child);
  }
  return found;
}

/*
 * The destination path a route file serves, or null. A SvelteKit route directory maps to a URL by
 * dropping its group segments — `(app)` and friends — so `(app)/notifications/+page.svelte` serves
 * `/notifications`. Only a route's own page can BE a destination; a component under `lib/` is
 * reached through one and has no path of its own.
 */
function routeHrefOf(file) {
  const absolute = path.join(ROOT, file);
  if (!absolute.startsWith(ROUTES_ROOT) || path.basename(absolute) !== "+page.svelte") return null;
  const segments = path
    .relative(ROUTES_ROOT, path.dirname(absolute))
    .split(path.sep)
    .filter((segment) => segment !== "" && !segment.startsWith("("));
  if (segments.length === 0) return null;
  // A parameterized segment is a record, never a destination.
  if (segments.some((segment) => segment.startsWith("["))) return null;
  return `/${segments.join("/")}`;
}

const destinations = destinationLabels(readFileSync(path.join(ROOT, DESTINATIONS_SOURCE), "utf8"));
if (destinations.size === 0) {
  console.error(
    `lint-screen-headers: parsed no destinations out of ${DESTINATIONS_SOURCE}. The registry's ` +
      "shape changed and this scan can no longer read it — fix the parser rather than the registry.",
  );
  process.exit(1);
}

const files = svelteFilesUnder(WEB_SOURCE).map((file) => ({
  path: relative(file),
  source: readFileSync(file, "utf8"),
}));

const { problems, headersSeen } = auditScreenHeaders({
  files,
  destinations,
  routeHref: routeHrefOf,
  exemptions: EXEMPTIONS,
});

if (problems.length > 0) {
  console.error("Screen headers state more than their name:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  [${problem.rule}]`);
    console.error(`    The header ${problem.message}\n`);
  }
  console.error(
    `${problems.length} problem(s) across ${headersSeen} header(s). A screen's header is its ` +
      "NAME: no eyebrow, the name the sidebar uses, and a meta line only for facts.",
  );
  process.exit(1);
}

const exempt = EXEMPTIONS.size === 0 ? "" : `, ${EXEMPTIONS.size} exempt by name`;
console.log(
  `Screen headers: ${headersSeen} header(s) across ${files.length} file(s), each stating its own ` +
    `name against ${destinations.size} registered destination(s)${exempt}.`,
);
