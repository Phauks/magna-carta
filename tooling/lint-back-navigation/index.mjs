/*
 * Every screen entered from another screen carries a way back to it.
 *
 * A reader who opens a matter from the docket, a person from the directory or a check from the
 * conflicts register has gone one level down, and the only thing that says so — the only thing that
 * takes them back up without the browser's own button — is the return affordance at the top of the
 * screen's header. Its absence is not a visible defect: the screen looks finished, the sidebar still
 * works, and nobody reviewing the diff notices that the way out was never built. Two of the three
 * detail screens in this repository shipped without one, and the third grew its own copy of the
 * component rather than the shared one. That is the failure this gate exists to make impossible
 * rather than merely unlikely.
 *
 * It answers two questions, both derived from the route tree rather than a hand-kept list:
 *
 *   1. Does every route that sits under another route's page offer a way back to it, in the page or
 *      in a layout between them, through however many components its header is built from?
 *   2. Does that way back lead to the screen the reader actually came from?
 *
 * And it refuses one drift: a header hand-rolling the affordance out of EyebrowLink and an arrow
 * icon instead of composing apps/web/src/lib/navigation/back-link.svelte, which is how the two forms
 * — labelled above a masthead, arrow-only leading a line already in the eyebrow register — would
 * drift apart. The rule and the forms are in docs/conventions/ui-design.md.
 *
 * Usage: node tooling/lint-back-navigation/index.mjs
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditBackNavigation,
  BACK_LINK_MODULE,
  EXCLUDED_SUBTREES,
  handRolledBackLinks,
} from "./back-navigation.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const ROUTES_ROOT = path.join(WEB_SOURCE, "routes");
const BACK_LINK_FILE = path.join(WEB_SOURCE, "lib", "navigation", "back-link.svelte");

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

const { failures, covered, excluded, exempted } = auditBackNavigation({
  routesRoot: ROUTES_ROOT,
  webSource: WEB_SOURCE,
});

const problems = failures.map((failure) => `  ${failure}`);

// A run that found no screen under a screen has a broken scan, not a flat application: this
// repository has had nested screens since the matter sections shipped. Fail loud rather than green.
if (covered.length + failures.length + excluded.length + exempted.length === 0) {
  problems.push(
    "  the route scan found no screen sitting under another screen at all — the scan is broken, " +
      "not the application. Fix this gate before trusting it.",
  );
}

for (const offender of handRolledBackLinks(
  svelteFilesUnder(WEB_SOURCE).filter((file) => file !== BACK_LINK_FILE),
)) {
  problems.push(
    `  ${relative(offender)} builds its own back link out of EyebrowLink and an arrow icon.\n` +
      `    Compose ${BACK_LINK_MODULE} instead — it owns the accessible name ("Back to <destination>"), ` +
      `the icon size and both forms, so a header cannot get one of them wrong on its own.`,
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
  `Back navigation: ${covered.length} screen(s) under a screen, every one of them with a way back` +
    `${notes.length === 0 ? "" : ` — ${notes.join(", ")}`}.`,
);
