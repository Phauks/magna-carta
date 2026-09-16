/*
 * The modal-header gate. A modal says what it DOES and WHICH RECORD it does it to, and this is what
 * keeps both one shape. The rules, and why each exists, are on modal-headers.mjs.
 *
 * Usage: node tooling/lint-modal-headers/index.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditModalHeaders,
  recordNumberIdentifiers,
  NOT_A_RECORD_REFERENCE,
  SCHEMA_SOURCE,
} from "./modal-headers.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SWEPT = [
  path.join(ROOT, "apps", "web", "src"),
  path.join(ROOT, "packages", "design-system", "src"),
];

/*
 * ALLOWANCES. A real violation somebody has decided to leave standing, with the reason. Empty is the
 * honest state today — the migration that landed with this scan left none — and adding an entry
 * should feel like a decision, because the `allowance` rule fails the run when one outlives the
 * violation it records. Shape: { rule, file, text, reason }, where `text` is a distinctive fragment
 * of the message the rule produces.
 */
const ALLOWANCES = [];

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

const identifiers = recordNumberIdentifiers(readFileSync(path.join(ROOT, SCHEMA_SOURCE), "utf8"));
if (identifiers.size === 0) {
  console.error(
    `lint-modal-headers: parsed no record numbers out of ${SCHEMA_SOURCE}. The schema's shape ` +
      "changed and this scan can no longer read it — fix the parser rather than the schema. A rule " +
      "that finds nothing passes vacuously, which is the one failure a gate must never have.",
  );
  process.exit(1);
}

const files = SWEPT.flatMap((directory) => svelteFilesUnder(directory)).map((file) => ({
  path: relative(file),
  source: readFileSync(file, "utf8"),
}));

const { problems, standing, panelsSeen } = auditModalHeaders({
  files,
  identifiers,
  allowances: ALLOWANCES,
});

if (standing.length > 0) {
  console.error(
    `lint:modal-headers: ${standing.length} standing allowance(s) — real violations recorded in ` +
      "this scan's ALLOWANCES with the reason each stands on. They are debt, not exemptions.",
  );
  for (const problem of standing) console.error(`    ${problem.rule}: ${problem.file}`);
}

if (problems.length > 0) {
  console.error("A modal's two lines are the act and the record it acts on:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  [${problem.rule}]`);
    console.error(`    The panel ${problem.message}\n`);
  }
  console.error(
    `${problems.length} problem(s) across ${panelsSeen} panel(s). The heading NAMES the act; the ` +
      "subtitle names the RECORD, by the number somebody would read back down a telephone.",
  );
  process.exit(1);
}

console.log(
  `Modal headers: ${panelsSeen} panel(s) across ${files.length} file(s) — every heading names its ` +
    `act, no subtitle explains its own subject, and each of ${identifiers.size} record number(s) ` +
    `the schema declares reaches the panels that hold it (${NOT_A_RECORD_REFERENCE.size} column(s) ` +
    "recorded as numbers of something other than a record).",
);
