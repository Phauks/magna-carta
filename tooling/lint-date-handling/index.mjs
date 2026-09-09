/*
 * The date gate. Every question a date raises has one authority, and this is what keeps it so.
 *
 * The rules, and the count of duplicates each one was written against, are on rules.mjs.
 *
 * Run: `pnpm run lint:date-handling`. Pure text over first-party source; no install, no build.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWANCES,
  ALLOWED_RAW_DATE_INPUTS,
  RULES,
  SHAPE_HOME,
  applyAllowances,
  findStaleAllowances,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where a second answer could be written. Everything first-party that ships or is tested. */
const SEARCH_ROOTS = ["apps", "packages", "tooling"];

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".svelte-kit",
  ".wrangler",
  ".tsbuild",
  "pkg",
  "generated",
]);

const READ_EXTENSIONS = [".ts", ".svelte", ".mts"];

/**
 * This tool's own source is skipped. Every pattern it scans for is written out here by necessity —
 * a gate that failed on its own rule table would be unwritable.
 */
const SELF = "tooling/lint-date-handling";

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

const files = [];
for (const root of SEARCH_ROOTS) walk(path.join(ROOT, root), files);

// The premise: this gate only means anything while the one home exists. A repository where the
// shape package has been moved or renamed should fail loudly here rather than pass by scanning
// nothing — a silent zero is the failure mode every rule below exists to prevent.
if (!files.some((file) => relative(file).startsWith(`${SHAPE_HOME}/`))) {
  console.error(
    `lint-date-handling: ${SHAPE_HOME} holds no source. The one home of the date shapes moved or ` +
      "was renamed, so these rules no longer point anywhere — repoint them rather than deleting " +
      "them, and see docs/conventions/dates.md for what they are protecting.",
  );
  process.exit(1);
}

const sources = new Map();
for (const file of files) {
  const name = relative(file);
  if (name.startsWith(`${SELF}/`)) continue;
  sources.set(name, readFileSync(file, "utf8"));
}

const found = [];
for (const [file, source] of sources) {
  for (const rule of RULES) found.push(...rule(file, source));
}
found.push(...findStaleAllowances(sources));
const { problems } = applyAllowances(found);

// The allowances are printed whether the run passes or fails. A standing exemption nobody sees is
// an exemption that stops being read as one.
for (const allowance of ALLOWANCES) {
  console.log(`  allowed [${allowance.rule}] ${allowance.file} — ${allowance.reason}.`);
}

if (problems.length > 0) {
  const byRule = new Map();
  for (const problem of problems) {
    byRule.set(problem.rule, [...(byRule.get(problem.rule) ?? []), problem]);
  }
  console.error("A date is answered in more than one place:\n");
  for (const [rule, inRule] of [...byRule].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  [${rule}]`);
    for (const one of inRule.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.error(`    ${one.file}:${one.line}`);
      console.error(`      This ${one.detail}.\n`);
    }
  }
  console.error(
    `${problems.length} problem(s) across ${byRule.size} rule(s). The two authorities are ` +
      "@magna-carta/civil-time (what a date IS) and the design system's formatters (how it READS); " +
      "the standing rules are docs/conventions/dates.md.",
  );
  process.exit(1);
}

const scanned = sources.size;
console.log(
  `Dates: ${String(scanned)} file(s) scanned; the shape of a date, a time, a stored instant and a ` +
    `zone is defined once, and every wording comes from the design system. Every date is entered ` +
    `through the DatePicker: ${String(ALLOWED_RAW_DATE_INPUTS.length)} surface(s) hold a native ` +
    "date input, and no allowance can make that a number other than zero.",
);
