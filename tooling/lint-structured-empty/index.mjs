/*
 * The structured-empty gate: where data will arrive, the structure that will hold it renders first,
 * empty, and the words about the emptiness live inside it. The rules, and why each exists, are on
 * structured-empty.mjs.
 *
 * Usage: node tooling/lint-structured-empty/index.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFile } from "./structured-empty.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The app's own screens, and the design system's components — the two halves that draw markup. */
const SEARCH_ROOTS = ["apps/web/src", "packages/design-system/src"];

/** Stories demonstrate; the demonstration is the point. */
const STORIES = /(?:^|\/)stories\//;

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function svelteFilesUnder(directory) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found; // a root this checkout legitimately does not have
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...svelteFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith(".svelte")) found.push(child);
  }
  return found;
}

const files = SEARCH_ROOTS.flatMap((root) => svelteFilesUnder(path.join(ROOT, root)))
  .map(relative)
  .filter((file) => !STORIES.test(file));

if (files.length === 0) {
  console.error(
    `lint-structured-empty: read no Svelte files under ${SEARCH_ROOTS.join(", ")}. That is a ` +
      "broken check rather than a clean repository — the roots moved, and this scan would pass " +
      "vacuously from here on. Point it at where the source lives now.",
  );
  process.exit(1);
}

const problems = [];
const excused = [];
for (const file of files) {
  const audit = auditFile(file, readFileSync(path.join(ROOT, file), "utf8"));
  problems.push(...audit.problems);
  excused.push(...audit.excused);
}

/*
 * The standing allowances, printed on every run so nobody can believe the repository is clean when
 * it is only excused. Each one's reason is in the comment beside the code it excuses.
 */
if (excused.length > 0) {
  console.log(`lint-structured-empty: ${excused.length} allowance(s) standing:`);
  for (const { problem, allowance } of excused) {
    console.log(`  ${problem.file}:${problem.line}  [${problem.rule}]  ${allowance.reason}`);
  }
}

if (problems.length > 0) {
  console.error("Where data will arrive, its structure renders first — and these render prose:\n");
  const byFile = new Map();
  for (const problem of problems) {
    if (!byFile.has(problem.file)) byFile.set(problem.file, []);
    byFile.get(problem.file).push(problem);
  }
  for (const [file, found] of byFile) {
    console.error(`  ${file}`);
    for (const problem of found) {
      console.error(`    :${problem.line}  [${problem.rule}]  ${problem.detail}`);
    }
    console.error("");
  }
  console.error(
    `${problems.length} finding(s) across ${byFile.size} file(s) of ${files.length} read. A ` +
      "structure renders its frame before its data arrives, and the words about the emptiness go " +
      "inside it — DataTable.Grid's `empty` snippet, EventRail's `emptyMessage`, the list's own " +
      "empty row. A genuinely prose-only case carries `<!-- structured-empty-allow: <why> -->` " +
      "immediately before the element.",
  );
  process.exit(1);
}

console.log(
  `Structured empties: ${files.length} file(s) read, every structure renders its own frame` +
    `${excused.length === 0 ? "" : ` (${excused.length} allowance(s) standing)`}.`,
);
