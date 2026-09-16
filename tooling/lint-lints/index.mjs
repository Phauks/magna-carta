// The gate over the gates.
//
// WHY THIS EXISTS. This repository governs itself with three dozen `lint:*` scripts, and every one of
// them is a scan that prints a cheerful summary line when it finds nothing. That line is the problem:
// a scan whose patterns quietly stopped matching prints exactly the same line as a clean tree, so a
// governance rule can die without a single red run. The lints say this about the code they watch —
// tooling/lint-control-characters.mjs proves its own patterns bite before it scans, for precisely
// that reason — and the same hazard applies one level up, where nothing has been watching at all.
// Thirteen of the lints here can print success and cannot print failure, because nothing exercises
// them. This is the check that says so, and holds the number from growing.
//
// WHAT IT CHECKS. Four rules, all derived, none hand-listed:
//
//   1. EVERY `lint:*` SCRIPT CAN FAIL. Each must have either a fixture test beside it or a self-test
//      that runs on every invocation. The set of scripts comes from allRepoWideLints() in
//      tooling/check-scoped/repo-wide.mjs — the one derivation, never a second roster, because a
//      hand-kept list is the same bug this file exists to prevent. The lints that cannot yet prove
//      themselves are named in the debt register in rules.mjs, which may only shrink.
//
//   2. EVERY `lint:*` SCRIPT IS DOCUMENTED. Each must be named somewhere under docs/ or in the root
//      CLAUDE.md — by command name, by script path, or by the tool directory it lives in. A rule a
//      reader cannot find is a rule people trip over and then work around.
//
//   3. EVERY LINT COMMAND THE DOCUMENTATION CITES EXISTS. The reverse direction, and the one a rename
//      breaks: prose that tells a reader to run `pnpm run lint:something` must name a real script.
//
//   4. THE FITNESS-SWEEP SCOPE VARIABLE IS PINNED. The gate workflow sets one environment variable to
//      tell the repository-wide fitness sweep which scopes the run covers, and the sweep reads that
//      name out of FITNESS_SCOPES_ENV. Rename one side and the sweep silently drops to its default
//      scope while the step still reports green — so the two strings are held identical here, the way
//      tooling/lint-cache-keys/ holds the gate's and the seed's cache keys identical.
//
// WHAT IT DOES NOT CATCH. It cannot tell a good self-test from an empty one: it proves the machinery
// is present and called, not that the fixtures are meaningful. It does not run any lint, so a lint
// that is merely wrong — rather than unprovable — passes here. It does not read the documentation for
// accuracy: a lint named once in a stale sentence counts as documented. And it says nothing about the
// checks that are not `lint:*` scripts at all (the self-registering fitness tests are covered by
// their own sweep, whose wiring is rule four's subject rather than its content).
//
// It proves itself on every run before it judges anything, which would be absurd to omit here.
//
// Run: `pnpm run lint:lints`. Pure text over the manifest, the tooling tree, the documentation and one
// workflow file; no install, no build, no child process.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FITNESS_SCOPES,
  FITNESS_SCOPES_ENV,
  allRepoWideLints,
} from "../check-scoped/repo-wide.mjs";
import { GOVERNANCE_STEPS } from "../gate/governance.mjs";
import {
  CITATION_ROOTS,
  DOCUMENTATION_ROOTS,
  LINTS_THAT_CANNOT_FAIL,
  checkEveryCitedCommandExists,
  checkEveryLintCanFail,
  checkEveryLintIsDocumented,
  citedLintCommands,
  compareFitnessScopeVariable,
  fitnessSweepEnvironment,
  hasSelfTest,
  scriptFileOf,
  testFileMatches,
} from "./rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = fileURLToPath(import.meta.url);

/**
 * The scan proves itself before it scans, the way tooling/lint-control-characters.mjs does. Each case
 * is a string the rules are run over directly, so a logic regression fails loudly here rather than
 * turning this gate into a permanently green check over three dozen other permanently green checks.
 */
export const SELF_TEST = [
  {
    name: "a self-test table walked by a loop counts",
    run: () => hasSelfTest("const SELF_TEST = [];\nfor (const one of SELF_TEST) check(one);"),
    expect: true,
  },
  {
    name: "a self-test table filtered in place counts",
    run: () => hasSelfTest("const SELF_TEST = [];\nconst bad = SELF_TEST.filter(fails);"),
    expect: true,
  },
  {
    name: "a named self-test function that is called counts",
    run: () => hasSelfTest("function selfTest() {}\nfunction main() { selfTest(); }\nmain();"),
    expect: true,
  },
  {
    name: "a self-test imported from a shared policy module and called counts",
    run: () =>
      hasSelfTest(
        'import { runLicensePolicySelfTest } from "./license-policy/index.mjs";\n' +
          "function main() { runLicensePolicySelfTest(); }\nmain();",
      ),
    expect: true,
  },
  {
    name: "a self-test that is declared but never called does not count",
    run: () => hasSelfTest("const SELF_TEST = [];\nfunction runSelfTest() { return []; }"),
    expect: false,
  },
  {
    name: "an ordinary scan with no self-test does not count",
    run: () => hasSelfTest("const files = walk(ROOT);\nfor (const file of files) scan(file);"),
    expect: false,
  },
  {
    name: "a test in the lint's own directory stands beside it",
    run: () =>
      testFileMatches({
        scriptFile: "tooling/lint-something/index.mjs",
        testFile: "tooling/lint-something/rules.test.mjs",
      }),
    expect: true,
  },
  {
    name: "in the shared tooling directory only a test of the same basename counts",
    run: () =>
      testFileMatches({
        scriptFile: "tooling/lint-something.mjs",
        testFile: "tooling/lint-other.test.mjs",
      }),
    expect: false,
  },
  {
    name: "in the shared tooling directory the matching basename does count",
    run: () =>
      testFileMatches({
        scriptFile: "tooling/lint-something.mjs",
        testFile: "tooling/lint-something.test.mjs",
      }),
    expect: true,
  },
  {
    name: "a test in another directory never stands beside it",
    run: () =>
      testFileMatches({
        scriptFile: "tooling/lint-something/index.mjs",
        testFile: "tooling/lint-other/rules.test.mjs",
      }),
    expect: false,
  },
  {
    name: "the script file is read out of the command, past the runner and the flags",
    run: () => scriptFileOf("node tooling/migration-bundles/index.mjs --check"),
    expect: "tooling/migration-bundles/index.mjs",
  },
  {
    name: "a command naming no script file reports none rather than guessing",
    run: () => scriptFileOf("echo nothing to run"),
    expect: null,
  },
  {
    name: "a cited command is read out of prose with its line",
    run: () =>
      JSON.stringify(citedLintCommands("intro\nrun `pnpm run lint:frobnicate` before pushing.")),
    expect: JSON.stringify([{ command: "lint:frobnicate", line: 2 }]),
  },
  {
    name: "a bare mention of a lint name is not read as a command citation",
    run: () => JSON.stringify(citedLintCommands("the lint:frobnicate rule bans frobbing.")),
    expect: JSON.stringify([]),
  },
  {
    name: "a cited command with no script behind it is a finding",
    run: () =>
      checkEveryCitedCommandExists({
        citations: [{ file: "docs/conventions/style.md", command: "lint:gone", line: 4 }],
        lintNames: ["lint:here"],
      }).findings.length,
    expect: 1,
  },
  {
    name: "a lint with neither a test nor a self-test, and not on the register, is a finding",
    run: () =>
      checkEveryLintCanFail({
        lints: [
          {
            name: "lint:bare",
            scriptFile: "tooling/lint-bare.mjs",
            source: "walk(ROOT);",
            testFiles: [],
          },
        ],
        register: [],
      }).findings.length,
    expect: 1,
  },
  {
    name: "the same lint on the debt register is carried rather than reported",
    run: () =>
      checkEveryLintCanFail({
        lints: [
          {
            name: "lint:bare",
            scriptFile: "tooling/lint-bare.mjs",
            source: "walk(ROOT);",
            testFiles: [],
          },
        ],
        register: ["lint:bare"],
      }).findings.length,
    expect: 0,
  },
  {
    name: "a registered lint that has since gained a test is reported, so the register only shrinks",
    run: () =>
      checkEveryLintCanFail({
        lints: [
          {
            name: "lint:bare",
            scriptFile: "tooling/lint-bare/index.mjs",
            source: "walk(ROOT);",
            testFiles: ["tooling/lint-bare/rules.test.mjs"],
          },
        ],
        register: ["lint:bare"],
      }).findings.length,
    expect: 1,
  },
  {
    name: "a lint named nowhere in the documentation is a finding",
    run: () =>
      checkEveryLintIsDocumented({
        lints: [{ name: "lint:unseen", scriptFile: "tooling/lint-unseen.mjs" }],
        documentation: "the conventions say nothing about it.",
      }).findings.length,
    expect: 1,
  },
  {
    name: "naming the tool directory counts as documentation",
    run: () =>
      checkEveryLintIsDocumented({
        lints: [{ name: "lint:seen", scriptFile: "tooling/lint-seen/index.mjs" }],
        documentation: "the bundle is generated (`tooling/lint-seen`).",
      }).findings.length,
    expect: 0,
  },
  {
    name: "the sweep step's environment is read, keyed off the configuration it runs",
    run: () =>
      JSON.stringify(
        fitnessSweepEnvironment(
          [
            { name: "Other", command: "pnpm", arguments: ["run", "check"] },
            {
              name: "Sweep",
              command: "vp",
              arguments: ["test", "run", "-c", "tooling/sweep.config.ts"],
              env: { SOME_SCOPES: "source,schema" },
            },
          ],
          "tooling/sweep.config.ts",
        ),
      ),
    expect: JSON.stringify({ found: true, variables: [["SOME_SCOPES", "source,schema"]] }),
  },
  {
    name: "a renamed variable on the gate side is a finding",
    run: () =>
      compareFitnessScopeVariable({
        environment: { found: true, variables: [["RENAMED_SCOPES", "source,schema"]] },
        expectedName: "ORIGINAL_SCOPES",
        knownScopes: new Set(["source", "schema"]),
      }).length,
    expect: 1,
  },
  {
    name: "an unknown scope value is a finding",
    run: () =>
      compareFitnessScopeVariable({
        environment: { found: true, variables: [["SCOPES", "source,scheme"]] },
        expectedName: "SCOPES",
        knownScopes: new Set(["source", "schema"]),
      }).length,
    expect: 1,
  },
  {
    name: "matching name and known scopes pass",
    run: () =>
      compareFitnessScopeVariable({
        environment: { found: true, variables: [["SCOPES", "source,schema"]] },
        expectedName: "SCOPES",
        knownScopes: new Set(["source", "schema"]),
      }).length,
    expect: 0,
  },
];

export function runSelfTest() {
  const failures = [];
  for (const { name, run, expect } of SELF_TEST) {
    let got;
    try {
      got = run();
    } catch (error) {
      got = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (got !== expect) failures.push({ name, got, expect });
  }
  return failures;
}

/** Every `*.test.*` file sitting directly in a directory, as repository-relative paths. */
function testFilesIn(directory) {
  let entries;
  try {
    entries = readdirSync(path.join(ROOT, directory));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /\.test\.(mjs|mts|ts|js)$/.test(entry))
    .map((entry) => `${directory}/${entry}`);
}

/** Every Markdown file under a repository-relative root, plus the root itself when it is a file. */
function markdownUnder(relativePath, found) {
  const absolute = path.join(ROOT, relativePath);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return found;
  }
  if (stats.isFile()) {
    if (relativePath.endsWith(".md")) found.push(relativePath);
    return found;
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      markdownUnder(`${relativePath}/${entry.name}`, found);
    } else if (entry.name.endsWith(".md")) {
      found.push(`${relativePath}/${entry.name}`);
    }
  }
  return found;
}

function readLints() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const testFilesByDirectory = new Map();
  return allRepoWideLints({ root: ROOT }).map((name) => {
    const scriptFile = scriptFileOf(manifest.scripts?.[name]);
    if (scriptFile === null) return { name, scriptFile: null, source: null, testFiles: [] };
    let source = null;
    try {
      source = readFileSync(path.join(ROOT, scriptFile), "utf8");
    } catch {
      source = null;
    }
    const directory = scriptFile.slice(0, scriptFile.lastIndexOf("/"));
    if (!testFilesByDirectory.has(directory)) {
      testFilesByDirectory.set(directory, testFilesIn(directory));
    }
    return { name, scriptFile, source, testFiles: testFilesByDirectory.get(directory) };
  });
}

function report(title, findings) {
  if (findings.length === 0) return;
  console.error(`\n${title}\n`);
  for (const finding of findings) console.error(`  ${finding}`);
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-lints: the gate over the gates no longer sees what it must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.expect)}\n` +
          `    got:      ${JSON.stringify(failure.got)}`,
      );
    }
    process.exit(1);
  }

  const lints = readLints();
  const lintNames = lints.map((lint) => lint.name);

  const canFail = checkEveryLintCanFail({ lints, register: LINTS_THAT_CANNOT_FAIL });

  const documentationFiles = [];
  for (const root of DOCUMENTATION_ROOTS) markdownUnder(root, documentationFiles);
  const documentation = documentationFiles
    .map((file) => readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");
  const documented = checkEveryLintIsDocumented({ lints, documentation });

  const citationFiles = [];
  for (const root of CITATION_ROOTS) markdownUnder(root, citationFiles);
  const citations = [];
  for (const file of citationFiles) {
    for (const cited of citedLintCommands(readFileSync(path.join(ROOT, file), "utf8"))) {
      citations.push({ file, ...cited });
    }
  }
  const cited = checkEveryCitedCommandExists({ citations, lintNames });

  const scopePinned = compareFitnessScopeVariable({
    environment: fitnessSweepEnvironment(GOVERNANCE_STEPS),
    expectedName: FITNESS_SCOPES_ENV,
    knownScopes: FITNESS_SCOPES,
  });

  report("Governance lints that cannot fail, and are not on the debt register:", canFail.findings);
  report("Governance lints a reader cannot find:", documented.findings);
  report("Lint commands the documentation cites that do not exist:", cited.findings);
  report("The fitness sweep and the gate no longer agree on the scope variable:", scopePinned);

  const total =
    canFail.findings.length +
    documented.findings.length +
    cited.findings.length +
    scopePinned.length;
  if (total > 0) {
    console.error(`\n${total} problem(s) across the governance lints themselves.\n`);
    process.exit(1);
  }

  console.log(
    `Governance lints: ${lintNames.length} script(s); ` +
      `${canFail.provable.length} can fail, ${canFail.unprovable.length} carried on the debt ` +
      `register in tooling/lint-lints/rules.mjs; all ${lintNames.length} are named in the ` +
      `documentation; ${citations.length} cited command(s) resolve; the fitness sweep and the gate ` +
      `agree on ${FITNESS_SCOPES_ENV}.`,
  );
}

if (process.argv[1] && SELF === path.resolve(process.argv[1])) main();
