/*
 * Fitness function: the shared UI surfaces are ONE component each, and the record window is the
 * shape everyone agreed it is.
 *
 * A second implementation of a shared surface is the most expensive defect this product can ship
 * and the quietest: it renders correctly, it typechecks, it lints, and it reads fine in review. It
 * surfaces a round later, when a correction is applied to one copy and not the other and two
 * screens start disagreeing about something a reader was told was settled. Review does not scale
 * to catching that across dozens of surfaces; a scan does.
 *
 * Three rules run here. Their reasoning, and the pure functions that decide them, are in rules.mjs;
 * the registry of what may exist once is registry.json.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly, because a gate that claims more than it delivers is
 * worse than none:
 *
 *   - "Is this the same BEHAVIOR?" Two surfaces can both use the one component and still disagree
 *     about what it offers. Only tests against the real screens catch that.
 *   - A shell that imports a record's type under an innocuous alias, or takes a domain fact through
 *     a generically named prop, passes the domain scan. The scan reads names, not meanings.
 *   - A hand-composed panel that LOOKS like a registered component but is named something
 *     unrecognizable defeats the registry. Review and the ruling ledgers in docs/conventions/ are
 *     the answer to that one, not this scan.
 *   - The domain scan reads a file's comments for nothing: they are stripped first, deliberately,
 *     so ordinary English ("no matter which tab", "it costs nothing") cannot trip it. A leak that
 *     exists only in a comment is a wording problem, not a duplication problem.
 *
 * Run: `pnpm run lint:one-ui`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportsName,
  findDomainLeaks,
  findHeaderSetProblems,
  findRegistryProblems,
  kebabCase,
  stripReExports,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The record window's home, and the file the header set is asserted against. */
const RECORD_WINDOW_HOME = "packages/design-system/src/lib/components/record-window";
const RECORD_WINDOW_SHELL = `${RECORD_WINDOW_HOME}/record-window.svelte`;

/** Where a second implementation could be written. */
const SEARCH_ROOTS = ["apps", "packages"];

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "dist",
  "build",
  "coverage",
  "target",
  "pkg",
  "storybook-static",
  "visual-regression",
]);

const MODULE_FILE = /\.(?:ts|mts|cts|mjs|cjs|js)$/;

function repositoryPath(absolute) {
  return relative(ROOT, absolute).split(sep).join("/");
}

function walk(directory, found = [], { includeStyles = false } = {}) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found; // a root this checkout legitimately does not have
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path, found, { includeStyles });
      continue;
    }
    const wanted =
      MODULE_FILE.test(entry.name) ||
      entry.name.endsWith(".svelte") ||
      (includeStyles && entry.name.endsWith(".css"));
    if (wanted) found.push(path);
  }
  return found;
}

// --- collect --------------------------------------------------------------------------------

const registry = JSON.parse(
  readFileSync(fileURLToPath(new URL("./registry.json", import.meta.url)), "utf8"),
);
const entries = registry.components ?? [];
if (entries.length === 0) {
  console.error(
    "lint:one-ui: registry.json declares no components — the registry is the whole rule, so an " +
      "empty one means the check is broken rather than the repository being clean.",
  );
  process.exit(1);
}

const problems = [];

// Rule: the record window's header set.
let shellSource = "";
try {
  shellSource = readFileSync(join(ROOT, RECORD_WINDOW_SHELL), "utf8");
} catch {
  problems.push({
    rule: "header-set",
    file: RECORD_WINDOW_SHELL,
    detail:
      "is missing. The record window is the product's one record shell and this is the file its " +
      "header set is asserted against; if it moved, move this check with it",
  });
}
if (shellSource !== "") {
  problems.push(...findHeaderSetProblems(RECORD_WINDOW_SHELL, shellSource));
}

// Rule: no kind of record inside the shell. Every file in its home, stylesheets included — a
// recipe class can name a kind of record as easily as a prop can.
for (const absolute of walk(join(ROOT, RECORD_WINDOW_HOME), [], { includeStyles: true })) {
  const path = repositoryPath(absolute);
  problems.push(...findDomainLeaks(path, readFileSync(absolute, "utf8")));
}

// Rule: the one-implementation registry.
const homesPresent = new Set();
for (const entry of entries) {
  try {
    const stats = statSync(join(ROOT, entry.home));
    if (stats.isDirectory() && readdirSync(join(ROOT, entry.home)).length > 0) {
      homesPresent.add(entry.name);
    }
  } catch {
    // absent; findRegistryProblems decides whether that is a failure or a notice
  }
}

const foreignExports = [];
const allFiles = SEARCH_ROOTS.flatMap((root) => walk(join(ROOT, root)));
for (const absolute of allFiles) {
  const path = repositoryPath(absolute);
  let source;
  for (const entry of entries) {
    if (path.startsWith(`${entry.home}/`)) continue;
    if (path.endsWith(".svelte")) {
      if (basename(path) === `${kebabCase(entry.name)}.svelte`) {
        foreignExports.push({ name: entry.name, file: path });
      }
      continue;
    }
    source ??= stripReExports(readFileSync(absolute, "utf8"));
    if (exportsName(source, entry.name)) foreignExports.push({ name: entry.name, file: path });
  }
}

const { problems: registryProblems, notices } = findRegistryProblems(entries, {
  homesPresent,
  foreignExports,
});
problems.push(...registryProblems);

// --- report ---------------------------------------------------------------------------------

for (const notice of notices) console.log(`lint:one-ui: ${notice}`);

if (problems.length > 0) {
  console.error(
    "\nlint:one-ui: the product's shared UI surfaces are one component each, and one of them is not.\n",
  );
  for (const problem of problems) {
    const at = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    console.error(`  [${problem.rule}] ${at}\n      ${problem.detail}\n`);
  }
  console.error(
    `${problems.length} problem(s). The rulings these rules serve live in ` +
      "docs/conventions/design-corrections.md and the per-surface ledgers beside it; the rules " +
      "themselves, and what they deliberately do not catch, are documented in " +
      "tooling/lint-one-ui/index.mjs.",
  );
  process.exit(1);
}

console.log(
  `lint:one-ui: the record window's header set is exactly Edit, Print, expand, close; nothing in ` +
    `its shell names a kind of record; ${entries.length} registered component(s) each have one home.`,
);
console.log(
  "  Not caught: the same component behaving differently on two screens, a domain fact arriving " +
    "through a generically named prop, and a look-alike panel nobody named recognizably.",
);
