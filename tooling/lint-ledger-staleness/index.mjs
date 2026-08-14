import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArea } from "../doc-fragments/roadmap.mjs";
import { SELF_TEST, findStaleness } from "./rules.mjs";

// Fitness function: the roadmap.d/* feature ledger against the REPOSITORY.
//
// Its twin, tooling/lint-roadmap.mjs, gates the other direction — docs/now.md must match a fresh
// render of the ledger — and that pair is what keeps a derived document from drifting off its source.
// Neither of them can tell whether the SOURCE is true. This one can, for the claims a node makes that
// a filesystem can answer: the paths it names, the decisions it cites, and the statuses that assert
// there is no code.
//
// It is deliberately quiet. Six rules, each exact, every one measured against the whole ledger before
// it was kept and three more thrown away for firing on correct nodes. The rules and the measurements
// are in rules.mjs; the reasoning behind the whole shape is in
// docs/specs/2026-08-14-feature-ledger-staleness-detection.md.
//
// Escape hatch: `ledger-staleness:allow — <reason>` in a node's `notes`, suppressing only the three
// rules that read the tree. A bare marker with no reason is itself a failure.
//
// Run: `pnpm run lint:ledger-staleness`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER_DIRECTORY = join(ROOT, "roadmap.d");
const RESERVED = new Set(["README.md"]);

export function readLedger(root) {
  const areas = [];
  const problems = [];
  for (const name of readdirSync(join(root, "roadmap.d"))
    .filter((entry) => entry.endsWith(".md") && !RESERVED.has(entry))
    .toSorted()) {
    try {
      areas.push(parseArea(readFileSync(join(root, "roadmap.d", name), "utf8"), name));
    } catch (error) {
      problems.push(error.message);
    }
  }
  return { areas, problems };
}

// Every accepted decision number. Pending fragments are deliberately NOT included: a pending slug in
// the ledger is one of the stale references this scan exists to find, and accepting it here would
// make the check agree with the drift.
export function readDecisionNumbers(root) {
  const numbers = new Set();
  const directory = join(root, "docs", "decisions");
  if (!existsSync(directory)) return numbers;
  for (const entry of readdirSync(directory)) {
    const match = /^(\d{4})-.*\.md$/.exec(entry);
    if (match !== null) numbers.add(match[1]);
  }
  return numbers;
}

// ---------------------------------------------------------------------------------------------
// The scan self-tests before it scans.
// ---------------------------------------------------------------------------------------------
//
// This matters more here than in most gates. The reason this scan exists is that a check which never
// fires is indistinguishable from a ledger with no drift — that is precisely how the two stale nodes
// survived. So the rules are proven to BITE on known-stale fixtures and to stay quiet on the
// permitted forms on every run, and a pattern that silently stopped matching fails loudly instead of
// reading as permanently green. Idiom borrowed from tooling/lint-conflicts-vocabulary/.
function runSelfTest() {
  const failures = [];
  for (const { name, nodes, tree, decisions, expect } of SELF_TEST) {
    const exists = (path) => tree.includes(path);
    const found = findStaleness(nodes, exists, new Set(decisions ?? []))
      .map((problem) => problem.rule)
      .toSorted();
    const wanted = [...expect].toSorted();
    if (JSON.stringify(found) !== JSON.stringify(wanted)) {
      failures.push({ name, found, wanted });
    }
  }
  return failures;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-ledger-staleness: the scan's own rules no longer do what they must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.wanted)}\n` +
          `    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const { areas, problems: parseProblems } = readLedger(ROOT);
  if (parseProblems.length > 0) {
    // A partial ledger would make rule 1 fire on everything the unparsed area accounted for, so this
    // reports the parse failure rather than a landslide of consequences of it.
    console.error("\nThe feature ledger does not parse; run `pnpm run lint:roadmap` first.\n");
    console.error(parseProblems.map((problem) => `  ${problem}`).join("\n"));
    process.exit(1);
  }

  const nodes = areas.flatMap((area) => area.nodes);
  const found = findStaleness(
    nodes,
    (path) => existsSync(join(ROOT, path)),
    readDecisionNumbers(ROOT),
  );

  if (found.length > 0) {
    console.error("\nThe feature ledger describes a repository that is not the one on disk:\n");
    for (const problem of found) {
      console.error(
        `  roadmap.d/${problem.node.area}:${problem.node.line}  \`${problem.node.id}\`` +
          `  [${problem.rule}]\n      ${problem.detail}`,
      );
    }
    console.error(
      `\n${found.length} stale claim(s) across ${new Set(found.map((problem) => problem.node.id)).size} node(s).` +
        "\nFix the node in its roadmap.d/ area file and re-run `vp run register-build`." +
        "\nA node the tree genuinely cannot match carries `ledger-staleness:allow — <reason>` in its notes.",
    );
    process.exit(1);
  }

  console.log(
    `Feature ledger matches the tree (${nodes.length} node(s) across ${areas.length} area(s)):` +
      " every path named resolves, every decision cited exists, and no node claiming there is no code" +
      " points at any.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
