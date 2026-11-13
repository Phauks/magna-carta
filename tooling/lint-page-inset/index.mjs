/*
 * The page-inset gate. Every signed-in screen sits the same distance from the chrome, and this is
 * what keeps it so. The rules, and why each exists, are on page-inset.mjs.
 *
 * Usage: node tooling/lint-page-inset/index.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPageInset } from "./page-inset.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROUTES_ROOT = path.join(ROOT, "apps", "web", "src", "routes");

/** The layout that renders the App Shell, and the shell whose `<main>` the rules are read off. */
const SHELL_LAYOUT = "apps/web/src/routes/(app)/+layout.svelte";
const SHELL_COMPONENT = "apps/web/src/lib/components/app-shell.svelte";

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

// A page whose load answers `shell: "none"` renders alone in the viewport (the (app) layout draws no
// shell for it), so it never lands in <main> and owes its own inset. Its `+page.ts` says so.
const SHELLLESS = /\bshell:\s*"none"/;
function declinesTheShell(file) {
  if (!file.endsWith(`${path.sep}+page.svelte`)) return false;
  const load = path.join(path.dirname(file), "+page.ts");
  return existsSync(load) && SHELLLESS.test(readFileSync(load, "utf8"));
}

const files = svelteFilesUnder(ROUTES_ROOT)
  .filter((file) => !declinesTheShell(file))
  .map((file) => ({
    path: relative(file),
    source: readFileSync(file, "utf8"),
  }));

if (!files.some((file) => file.path === SHELL_LAYOUT)) {
  console.error(
    `lint-page-inset: ${SHELL_LAYOUT} is not in the route tree. The (app) group moved or was ` +
      "renamed, so this scan no longer knows which screens render into the shell — repoint it " +
      "rather than deleting it.",
  );
  process.exit(1);
}

const { premiseProblem, problems, screensSeen, inset } = auditPageInset({
  files,
  shellSource: readFileSync(path.join(ROOT, SHELL_COMPONENT), "utf8"),
  shellLayout: SHELL_LAYOUT,
});

if (premiseProblem !== undefined) {
  console.error(
    `lint-page-inset: the App Shell changed under this scan — ${premiseProblem}.\n\n` +
      `  ${SHELL_COMPONENT}\n\n` +
      "These rules only hold because of how <main> is dressed, so the honest move is to re-derive " +
      "them against the shell as it is now, not to keep enforcing them.",
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error("Screens are not sitting on the one page inset:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  [${problem.rule}]`);
    console.error(`    This screen ${problem.message}.\n`);
  }
  console.error(
    `${problems.length} problem(s) across ${screensSeen} screen(s) rendering into <main>. The ` +
      "shell draws the inset once, for everybody.",
  );
  process.exit(1);
}

console.log(
  `Page inset: ${screensSeen} screen(s) render into the App Shell's <main> and none draws a second ` +
    `inset over its \`${inset}\` or an inert grow.`,
);
