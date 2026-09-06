/*
 * Every screen states what it is through ONE component, and a screen entered from another names
 * where it came from.
 *
 * A reader who opens a matter from the docket, a person from the directory or a check from the
 * conflicts register has gone one level down, and the only thing that says so — the only thing that
 * takes them back up without the browser's own button — is the return affordance at the top of the
 * screen's header. Its absence is not a visible defect: the screen looks finished, the sidebar still
 * works, and nobody reviewing the diff notices that the way out was never built. Two of the three
 * detail screens in this repository shipped without one.
 *
 * The reason it was so easy to forget is the second rule's subject. Twenty screens assembled the
 * design-system Masthead by hand, in eight different combinations of its parts, and four more
 * hand-rolled an `h1` outside the design system entirely — so there was no one place a header rule
 * could live, and no shape a reviewer could recognise as missing something.
 *
 * So this gate answers three questions, all derived from the route tree and the sidebar registry
 * rather than from a hand-kept list:
 *
 *   1. Does every route that sits under another route's page name where it came from?
 *   2. Does the destination it names resolve to that screen's own path?
 *   3. Is every header in the application the one component?
 *
 * Usage: node tooling/lint-back-navigation/index.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditBackNavigation,
  BACK_TARGETS_SOURCE,
  DESTINATIONS_SOURCE,
  destinationPaths,
  EXCLUDED_SUBTREES,
  handRolledHeaders,
  spelledOutBackTargets,
} from "./back-navigation.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const ROUTES_ROOT = path.join(WEB_SOURCE, "routes");
/*
 * The two files that are allowed to build a header out of parts, because they ARE the parts every
 * screen composes: the header itself, and the back link it places. Everything else in the
 * application composes them.
 */
const HEADER_AUTHORS = new Set([
  path.join(WEB_SOURCE, "lib", "screen", "screen-header.svelte"),
  path.join(WEB_SOURCE, "lib", "navigation", "back-link.svelte"),
]);

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

const destinations = destinationPaths(readFileSync(path.join(ROOT, DESTINATIONS_SOURCE), "utf8"));
const spelledOut = spelledOutBackTargets(
  readFileSync(path.join(ROOT, BACK_TARGETS_SOURCE), "utf8"),
);

const problems = [];

// A registry that parsed to nothing would make every destination unresolvable and every screen
// look wrong, or (worse, once the comparison is skipped) look fine. Fail on the parse, loudly.
if (destinations.size === 0) {
  problems.push(
    `  ${DESTINATIONS_SOURCE}: no destinations parsed. The scan is broken, not the registry — ` +
      `fix this gate before trusting it.`,
  );
}

const { failures, covered, excluded, exempted } = auditBackNavigation({
  routesRoot: ROUTES_ROOT,
  webSource: WEB_SOURCE,
  destinations,
  spelledOut,
});
problems.push(...failures.map((failure) => `  ${failure}`));

// A run that found no screen under a screen has a broken scan, not a flat application: this
// repository has had nested screens since the matter sections shipped. Fail loud rather than green.
if (covered.length + failures.length + excluded.length + exempted.length === 0) {
  problems.push(
    "  the route scan found no screen sitting under another screen at all — the scan is broken, " +
      "not the application. Fix this gate before trusting it.",
  );
}

for (const offender of handRolledHeaders(svelteFilesUnder(WEB_SOURCE), { allow: HEADER_AUTHORS })) {
  problems.push(
    `  ${relative(offender.file)} ${offender.reason}.\n` +
      `    Compose apps/web/src/lib/screen/screen-header.svelte instead — it owns the title, the ` +
      `eyebrow, the citation line, the actions and the way back, so a screen cannot get one of them ` +
      `wrong on its own.`,
  );
}

if (problems.length > 0) {
  console.error("Back navigation:\n");
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

const notes = [];
if (excluded.length > 0) {
  const reasons = [...new Set(EXCLUDED_SUBTREES.values())].join("; ");
  notes.push(`${excluded.length} in an excluded subtree (${reasons})`);
}
if (exempted.length > 0) notes.push(`${exempted.length} declining with a stated reason`);
console.log(
  `Back navigation: ${covered.length} screen(s) under a screen, every one of them naming where it ` +
    `came from, against ${destinations.size} registered destination(s)` +
    `${notes.length === 0 ? "" : ` — ${notes.join(", ")}`}.`,
);
