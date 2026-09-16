/*
 * The money gate. An amount of money has one authority — @magna-carta/money — and this is what stops
 * a second one being written beside it.
 *
 * The three rules, the counts each was written against, the homes that are allowed to break them,
 * and the list of what this deliberately does NOT catch are all on rules.mjs. The ratchet that lets
 * a gate run green over a tree that already violates it is on baseline.mjs. Read those two first;
 * this file only walks the tree and prints.
 *
 * WHY IT RATCHETS RATHER THAN EXEMPTS, in one line, because it is the thing most likely to be
 * misread: baseline.json is a DEBT REGISTER THAT ONLY SHRINKS, not a list of sites that are fine. A
 * count may fall and must then be re-recorded; nothing may arrive except by a deliberate edit.
 *
 * `--update-baseline` rewrites the register from the current tree. It is for the first recording and
 * for a burn-down that moved many files at once. It is NOT the routine answer to a failure: it
 * accepts new debt as readily as it forgives paid-off debt, and the diff is the only review.
 *
 * Run: `pnpm run lint:money-arithmetic`, or `node tooling/lint-money-arithmetic/index.mjs`. Pure
 * text over first-party source; no install, no build.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareAgainstBaseline, parseBaseline, renderBaseline } from "./baseline.mjs";
import { MONEY_HOME, MONEY_NAME_PATTERN, RULES, runSelfTest } from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE_FILE = fileURLToPath(new URL("./baseline.json", import.meta.url));

/** Where a second answer to money could be written. Everything first-party that ships or is tested. */
const SEARCH_ROOTS = ["apps", "packages", "tooling"];

const SKIPPED_DIRECTORIES = new Set([
  // .claude holds parallel-session worktrees; scanning them double-counts and can report code that
  // lives on another branch. The rest is build output, not source.
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  "target",
  "coverage",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  ".tsbuild",
  "pkg",
  "generated",
]);

const READ_EXTENSIONS = [".ts", ".svelte", ".mts"];

/**
 * This tool's own directory is skipped. Every pattern it scans for is written out in rules.mjs by
 * necessity, and every example in the self-test table is a real violation — a gate that failed on
 * its own rule table would be unwritable.
 */
const SELF = "tooling/lint-money-arithmetic";

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function walk(directory, found) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(child, found);
    } else if (
      entry.isFile() &&
      READ_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
    ) {
      found.push(child);
    }
  }
}

// The scan proves itself before it scans anything. The tree is EXPECTED to carry findings, so a run
// that suddenly reported none would read as progress rather than as a rule that stopped matching —
// which makes silence the dangerous failure here, and makes this check the load-bearing one.
const selfTestFailures = runSelfTest();
if (selfTestFailures.length > 0) {
  console.error("\nlint-money-arithmetic: the scan no longer sees what it must.\n");
  for (const failure of selfTestFailures) {
    console.error(
      `  ${failure.name}\n` +
        `    expected: ${JSON.stringify(failure.expect)}\n` +
        `    got:      ${JSON.stringify(failure.found)}`,
    );
  }
  console.error("\nThe self-test table is SELF_TEST in rules.mjs, beside the rule it exercises.");
  process.exit(1);
}

const files = [];
for (const root of SEARCH_ROOTS) walk(path.join(ROOT, root), files);

// The premise: this gate only means anything while the one authority exists. A repository where the
// money package has been moved or renamed should fail loudly here rather than pass by scanning
// against a home that is not there — a silent zero is the failure mode every rule exists to prevent.
if (!files.some((file) => relative(file).startsWith(`${MONEY_HOME}/src/`))) {
  console.error(
    `lint-money-arithmetic: ${MONEY_HOME}/src holds no source. The one home of money moved or was ` +
      "renamed, so these rules no longer point anywhere — repoint them rather than deleting them.",
  );
  process.exit(1);
}

const sources = new Map();
for (const file of files) {
  const name = relative(file);
  if (name.startsWith(`${SELF}/`)) continue;
  sources.set(name, readFileSync(file, "utf8"));
}

const foundByFile = new Map();
let total = 0;
for (const [file, source] of sources) {
  // A file with no money-shaped name anywhere in its raw text cannot produce a finding: all three
  // rules require one, and blanking only ever REMOVES text, so a name absent before the blanker runs
  // is absent after it. Skipping those files here is what keeps this scan affordable in the pre-push
  // loop — the state machine that blanks comments and strings is the whole cost, and the overwhelming
  // majority of the repository never mentions money at all.
  if (!MONEY_NAME_PATTERN.test(source)) continue;
  const inFile = RULES.flatMap((rule) => rule(file, source));
  if (inFile.length === 0) continue;
  inFile.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
  foundByFile.set(file, inFile);
  total += inFile.length;
}

if (process.argv.includes("--update-baseline")) {
  const counts = new Map([...foundByFile].map(([file, inFile]) => [file, inFile.length]));
  writeFileSync(BASELINE_FILE, renderBaseline(counts), "utf8");
  console.log(
    `Money: recorded ${String(total)} finding(s) across ${String(counts.size)} file(s) in ` +
      "tooling/lint-money-arithmetic/baseline.json. Read the diff before committing it — this " +
      "command accepts new debt as readily as it forgives debt that was paid off.",
  );
  process.exit(0);
}

let baseline;
try {
  baseline = parseBaseline(readFileSync(BASELINE_FILE, "utf8"));
} catch (error) {
  console.error(
    `lint-money-arithmetic: ${String(error instanceof Error ? error.message : error)}.\n` +
      "baseline.json is the debt register this gate ratchets against, not a cache. Restore it from " +
      "git rather than regenerating it, or the debt it records is silently forgiven.",
  );
  process.exit(1);
}

const { overBudget, newlyClean } = compareAgainstBaseline(
  foundByFile,
  baseline,
  new Set(sources.keys()),
);

if (overBudget.length > 0) {
  console.error("\nMoney is answered outside @magna-carta/money:\n");
  for (const { file, allowed, findings } of overBudget) {
    console.error(
      allowed === 0
        ? `  ${file} — not in the debt register, and it holds ${String(findings.length)} finding(s):`
        : `  ${file} — the register allows ${String(allowed)}, this run found ` +
            `${String(findings.length)}:`,
    );
    for (const one of findings) {
      console.error(`    ${file}:${String(one.line)}  [${one.rule}]`);
      console.error(`      This ${one.detail}.\n`);
    }
  }
  console.error(
    "The register (tooling/lint-money-arithmetic/baseline.json) records the debt that was already " +
      "here; it does not take new entries by accident. Move the arithmetic into " +
      "@magna-carta/money, or — if this genuinely is a seam that cannot — say so in review and " +
      "record it deliberately.",
  );
}

if (newlyClean.length > 0) {
  console.error("\nThe debt register is looser than the tree, and it only ever shrinks:\n");
  for (const { file, allowed, actual, gone } of newlyClean) {
    console.error(
      actual === 0
        ? `  ${file}:1  records ${String(allowed)} and now has none` +
            `${gone ? " (the file is gone)" : ""}. Delete the line from baseline.json.`
        : `  ${file}:1  records ${String(allowed)} and now has ${String(actual)}. Change that ` +
            `number in baseline.json to ${String(actual)}.`,
    );
  }
  console.error(
    "\nSlack left behind is slack the next change spends. Re-record it in the commit that paid it " +
      "down, or run `node tooling/lint-money-arithmetic/index.mjs --update-baseline`.",
  );
}

if (overBudget.length > 0 || newlyClean.length > 0) process.exit(1);

console.log(
  `Money: ${String(sources.size)} file(s) scanned; ${String(total)} known finding(s) across ` +
    `${String(baseline.size)} file(s) in the debt register, none new and none left un-recorded. ` +
    "@magna-carta/money is the one place an amount is added, rounded and split.",
);
