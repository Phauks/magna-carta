// Fitness function: an icon size class must be one this project actually defines.
//
// WHY THIS EXISTS. The Tailwind config here sizes icons in PIXELS — `size-16` is 16px, `size-12` is
// 12px. Tailwind's own default numeric scale is in REM, where the same numbers mean four times as
// much. Any number the project has not defined therefore falls through to that default: `size-14`
// compiles happily and renders a 14px icon at 56px.
//
// It is invisible in every gate. It typechecks, it lints, svelte-check passes, the bundle builds,
// and the class name reads exactly like the correct one beside it. The only way to see it is to
// render the page — which is how it was found, after shipping to main: the folder rail's Home and
// New folder glyphs came out at 56px inside 32px buttons.
//
// THE FIX IS ALWAYS THE SAME: use a size the theme defines, or define the new one in
// packages/design-tokens. The sanctioned set is read from the generated theme, so it cannot drift.
//
// Run: `pnpm run lint:icon-sizes`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["apps", "packages"];
const SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  ".svelte-kit",
  "target",
  "coverage",
  ".wrangler",
]);
/*
 * Storybook stories are demonstration code, and they use vanilla Tailwind utilities on purpose —
 * an avatar-sized `size-10 rounded-full` placeholder beside `h-4 w-48` is the shadcn idiom the
 * story is showing. This rule is about PRODUCT UI, where the px scale is the contract.
 */
const SKIP_STORIES = /[/\\]stories[/\\]/;

/*
 * The sanctioned sizes are READ from the generated theme rather than listed here. A hand-written
 * copy is a second home for the same fact, and the two drift: the first draft of this check carried
 * a guessed list that both invented a size the theme does not define and omitted three it does.
 */
const THEME = join(ROOT, "packages/design-tokens/generated/tailwind-theme.css");
const DEFINED = new Set(
  [...readFileSync(THEME, "utf8").matchAll(/^\s*--spacing-(\d+):/gm)].map((match) =>
    Number(match[1]),
  ),
);
if (DEFINED.size === 0) {
  console.error(`No --spacing-* tokens found in ${relative(ROOT, THEME)}; this check cannot run.`);
  process.exit(1);
}
// Only `size-*`, which is this codebase's icon idiom. Bare `w-`/`h-` are used deliberately on
// BOXES, where Tailwind's rem scale is the right one — flagging those would be noise, and noise
// is how a fitness function gets switched off.
const CLASS = /\bsize-(\d+)\b/g;

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".svelte") && !SKIP_STORIES.test(path)) out.push(path);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    // Comments name these classes to explain them — the Skeleton component's own doc block lists
    // `size-10 rounded-full` as an example. Flagging prose would teach people to stop writing it.
    const source = readFileSync(file, "utf8")
      .replaceAll(/\/\*[\s\S]*?\*\//g, (block) => block.replaceAll(/[^\n]/g, " "))
      .replaceAll(/^\s*\/\/.*$/gm, "");
    source.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(CLASS)) {
        const value = Number(match[1]);
        if (DEFINED.has(value)) continue;
        problems.push(`${relative(ROOT, file)}:${index + 1}  ${match[0]}`);
      }
    });
  }
}

if (problems.length > 0) {
  console.error(
    "Icon size classes this project does not define — they resolve against Tailwind's rem scale\n" +
      "and render about four times too large:\n",
  );
  for (const problem of problems) console.error("  " + problem);
  console.error(
    `\n${problems.length} problem(s). The theme defines: ${[...DEFINED].toSorted((a, b) => a - b).join(", ")}.\n` +
      "Use one of those, or add the new size to packages/design-tokens — this check reads the scale\n" +
      "from there, so nothing needs changing here.",
  );
  process.exit(1);
}
console.log("lint:icon-sizes: every size class is one the theme defines.");
