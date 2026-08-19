import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArea } from "../doc-fragments/roadmap.mjs";
import { parseFragment } from "../doc-fragments/status.mjs";
import { SELF_TEST, findStaleness } from "./rules.mjs";

// Fitness function: the roadmap.d/* feature ledger against the REPOSITORY.
//
// Its twin, tooling/lint-roadmap.mjs, gates the other direction — docs/now.md must match a fresh
// render of the ledger — and that pair is what keeps a derived document from drifting off its source.
// Neither of them can tell whether the SOURCE is true. This one can, for the claims a node makes that
// a filesystem can answer: the paths it names, the decisions it cites, and the statuses that assert
// there is no code — plus the one claim that needs no filesystem at all, where a node's status
// contradicts the `built:` stage of the status.d fragment the node itself names.
//
// It is deliberately quiet. Eight rules, each exact, every one measured against the whole ledger
// before it was kept and three more thrown away for firing on correct nodes. The rules and the
// measurements are in rules.mjs; the reasoning behind the whole shape is in
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

// Every slice slug the status.d fragment set defines, mapped to that fragment's `built:` state. Only
// the one stage is read: rule 7 asks whether the stream tracking a capability has produced code, and
// `built` is the stage that answers it — `ui`, `tested` and the rest describe work around the code
// rather than its existence. A fragment that does not parse is skipped rather than fatal, because
// lint:status is the gate that owns fragment validity and reporting it twice helps nobody; the
// consequence here is only that rule 7 stays silent for the nodes naming it.
export function readSliceBuildStates(root) {
  const states = new Map();
  const directory = join(root, "status.d");
  if (!existsSync(directory)) return states;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".md") || RESERVED.has(name) || name.startsWith("_")) continue;
    try {
      const fragment = parseFragment(readFileSync(join(directory, name), "utf8"), name);
      states.set(name.replace(/\.md$/, ""), fragment.stages.built.state);
    } catch {
      continue;
    }
  }
  return states;
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
// The owner-flag register a document under docs/specs/ carries, for rule 10. Two shapes, both
// already idiomatic there: a table row whose first cell is a bolded token (`| **G1** | ...`), and the inline
// `Flagged (**G12**)` a section body uses when the register lives further down. Only specs a node
// actually cites are read, so this is a handful of files rather than the whole directory.
function readSpecFlagRegisters(root, nodes) {
  const registers = new Map();
  for (const specPath of new Set(nodes.map((node) => node.spec).filter((spec) => spec !== null))) {
    const absolute = join(root, specPath);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    const flags = new Set();
    for (const match of text.matchAll(/^\|\s*\*\*([A-Z]{1,3}-?[A-Z]?\d{1,2})\*\*\s*\|/gm)) {
      flags.add(match[1]);
    }
    for (const match of text.matchAll(/[Ff]lagged\s*\(\*\*([A-Z]{1,3}-?[A-Z]?\d{1,2})\*\*/g)) {
      flags.add(match[1]);
    }
    // Sorted by letter prefix then NUMBER, so a sixteen-flag register reads G1..G16 rather than
    // G1, G10, G11, G2 — the lexical order makes a complete register look like a ransacked one.
    const ordered = [...flags].toSorted((left, right) => {
      const [, leftLetters, leftDigits] = /^([A-Z-]+)(\d+)$/.exec(left) ?? [null, left, "0"];
      const [, rightLetters, rightDigits] = /^([A-Z-]+)(\d+)$/.exec(right) ?? [null, right, "0"];
      return leftLetters === rightLetters
        ? Number(leftDigits) - Number(rightDigits)
        : leftLetters.localeCompare(rightLetters);
    });
    if (ordered.length > 0) registers.set(specPath, ordered);
  }
  return registers;
}

function runSelfTest() {
  const failures = [];
  for (const { name, nodes, tree, decisions, slices, specFlags, expect } of SELF_TEST) {
    const exists = (path) => tree.includes(path);
    const found = findStaleness(
      nodes,
      exists,
      new Set(decisions ?? []),
      new Map(Object.entries(slices ?? {})),
      new Map(Object.entries(specFlags ?? {})),
    )
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
  const sliceBuildStates = readSliceBuildStates(ROOT);
  const found = findStaleness(
    nodes,
    (path) => existsSync(join(ROOT, path)),
    readDecisionNumbers(ROOT),
    sliceBuildStates,
    readSpecFlagRegisters(ROOT, nodes),
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
    `Feature ledger matches the tree (${nodes.length} node(s) across ${areas.length} area(s),` +
      ` ${sliceBuildStates.size} slice fragment(s)): every path named resolves, every decision cited` +
      " exists, no node claiming there is no code points at any, no node sits `not-started` in a" +
      " subtree its own build stream has already delivered into, and no design whose flags are all" +
      " still open is missing from the decision desk.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
