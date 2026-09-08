/*
 * The scrollbar gate. Every scroll region we draw wears the design system's own scrollbar, and this
 * is what keeps it so. The rule, and why it exists, are on scrollbar.mjs.
 *
 * Usage: node tooling/lint-scrollbar/index.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditScrollbars, SCROLLBAR_RECIPES, SCROLLBAR_RECIPE_FILE } from "./scrollbar.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where our own markup lives. Anything outside these two trees draws no scroll region of ours. */
const SCANNED_TREES = ["apps/web/src", "packages/design-system/src"];

/** The tree whose stylesheets say which classes scroll. The design system owns all of them. */
const STYLESHEET_TREE = "packages/design-system/src";

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

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

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

const files = SCANNED_TREES.flatMap((tree) =>
  filesUnder(path.join(ROOT, tree), [".svelte", ".ts"]),
).map(read);

const stylesheets = filesUnder(path.join(ROOT, STYLESHEET_TREE), [".css"]).map(read);

const { premiseProblem, problems, scrollingClasses, regionsSeen } = auditScrollbars({
  files,
  stylesheets,
  recipeSource: readFileSync(path.join(ROOT, SCROLLBAR_RECIPE_FILE), "utf8"),
});

if (premiseProblem !== undefined) {
  console.error(
    `lint-scrollbar: the scrollbar recipe changed under this scan — ${premiseProblem}.\n\n` +
      `  ${SCROLLBAR_RECIPE_FILE}\n\n` +
      "This rule only means something while those classes dress a scrollbar, so re-derive it " +
      "against the recipe as it is now rather than going on enforcing a name that dresses nothing.",
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error("Scroll regions wearing the operating system's scrollbar instead of ours:\n");
  for (const problem of problems) {
    const because =
      problem.reason === "utility"
        ? `\`${problem.scroller}\` makes this element scroll`
        : `\`${problem.scroller}\` scrolls in its own CSS`;
    console.error(`  ${problem.file}:${problem.line}`);
    console.error(
      `    ${because}, and nothing here names \`${SCROLLBAR_RECIPES[0]}\`. Add it — or ` +
        `\`${SCROLLBAR_RECIPES[1]}\` with a ScrollEdgeHint where a scrollbar appearing would ` +
        "reflow the strip it sits in.\n",
    );
  }
  console.error(
    `${problems.length} region(s) of ${regionsSeen}. The recipe is in ${SCROLLBAR_RECIPE_FILE}.`,
  );
  process.exit(1);
}

console.log(
  `Scrollbar: ${regionsSeen} scroll region(s) across ${files.length} file(s) all wear the design ` +
    `system's scrollbar. ${scrollingClasses.length} design-system class(es) scroll in their own CSS.`,
);
