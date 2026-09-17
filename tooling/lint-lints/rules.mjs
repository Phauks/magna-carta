// The four rules of the gate over the gates, as pure functions over text. Kept apart from the runner
// (index.mjs) so the fixture test and the startup self-test drive them with strings of their own
// rather than through the filesystem.
//
// Nothing here reads a file or exits a process. index.mjs does the reading; these decide.

/** Where the governance rules a reader can be sent to are allowed to live. */
export const DOCUMENTATION_ROOTS = ["docs", "CLAUDE.md"];

/** The subset of those that may cite a runnable `pnpm run lint:…` command (the reverse direction). */
export const CITATION_ROOTS = ["docs/conventions", "CLAUDE.md"];

/** The gate module that runs the repository-wide fitness sweep, and the configuration file it runs. */
export const GATE_GOVERNANCE = "tooling/gate/governance.mjs";
export const FITNESS_SWEEP_CONFIGURATION =
  "tooling/check-scoped/vitest.repo-wide-fitness.config.ts";

/**
 * ============================================================================================
 * THE DEBT REGISTER — a ratchet, not an allowance.
 * ============================================================================================
 * Every name below is a governance lint that CANNOT FAIL ON PURPOSE: it has neither a fixture test
 * beside it nor a self-test that runs on every invocation, so if its patterns stopped matching
 * tomorrow it would keep printing its cheerful summary line and nothing would say otherwise. A check
 * that never fires is indistinguishable from a clean tree.
 *
 * This list may only SHRINK. Give a lint a `*.test.mjs` beside it, or a self-test in its own source,
 * then delete its name here — that is the whole procedure, and this gate fails on a name that has
 * become provable, so a stale entry cannot sit here quietly pretending the debt is still owed.
 * Adding a name is not a normal act: a new lint should ship with the thing that proves it works.
 */
export const LINTS_THAT_CANNOT_FAIL = [
  "lint:changelog-fragments",
  "lint:decisions",
  "lint:failure-surface",
  "lint:firm-bucket-seam",
  "lint:icon-sizes",
  "lint:matter-create-control",
  "lint:matter-search-coverage",
  "lint:matter-timeline-coverage",
  "lint:process-refs",
  "lint:roadmap",
  "lint:screen-data",
  "lint:status",
  "lint:test-registration",
];

/**
 * The file a `lint:*` script actually runs, as a repository-relative forward-slash path.
 *
 * The scripts are all `node <path> [flags]` today, but rather than assume the runner, take the first
 * token that looks like a script file. Returns null when the command names no such token, which is a
 * finding rather than a crash — a lint whose script cannot be located is a lint nobody can prove.
 */
export function scriptFileOf(command) {
  if (typeof command !== "string") return null;
  for (const token of command.trim().split(/\s+/)) {
    if (/\.(mjs|cjs|js|mts|cts|ts)$/.test(token) && !token.startsWith("-")) return token;
  }
  return null;
}

/** An identifier reads as a self-test when its name says so, whatever the casing convention. */
const readsAsSelfTest = (identifier) =>
  identifier.toLowerCase().replaceAll("_", "").includes("selftest");

/** Every identifier in a source file whose name says it is a self-test. */
export function selfTestIdentifiers(source) {
  const found = new Set();
  for (const match of source.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (readsAsSelfTest(match[0])) found.add(match[0]);
  }
  return [...found];
}

/**
 * Does this source prove itself on every run?
 *
 * WHAT THIS DETECTS, honestly: a self-test must both EXIST and BE CALLED, so both halves are looked
 * for. Existence is an identifier that says what it is — `SELF_TEST`, `runSelfTest`,
 * `runLicensePolicySelfTest` — declared here or imported from a module this one shares with a
 * sibling gate. Invocation is that identifier being called, or the table being walked. The
 * declaration site of a function is stripped before the invocation is looked for, so
 * `function runSelfTest()` alone never counts as its own call.
 *
 * WHAT THIS DOES NOT DETECT: whether the self-test is any good. An empty table walked by a loop
 * satisfies this scan and proves nothing. That is a review question, not a mechanical one — this
 * gate can only insist that the machinery is present and wired, which is the failure it was written
 * against (thirteen lints with no machinery at all). Nor does it check that the call is unconditional:
 * a self-test behind a flag reads the same from here.
 */
export function hasSelfTest(source) {
  const identifiers = selfTestIdentifiers(source);
  if (identifiers.length === 0) return false;
  const withoutDeclarations = source.replaceAll(/\bfunction\s+[A-Za-z_$][\w$]*/g, "function ");
  return identifiers.some((identifier) => {
    const name = identifier.replaceAll("$", "\\$");
    const called = new RegExp(`\\b${name}\\s*\\(`).test(withoutDeclarations);
    const walked = new RegExp(
      `\\b${name}\\s*\\.\\s*(?:filter|map|forEach|some|every|flatMap|reduce)\\s*\\(|\\bof\\s+${name}\\b`,
    ).test(source);
    return called || walked;
  });
}

/**
 * Is this file a fixture test that stands beside the given script?
 *
 * Two shapes, because the repository has two layouts and only one of them has a meaningful notion of
 * "beside":
 *   * a lint in its OWN directory (`tooling/lint-something/index.mjs`) — any `*.test.*` in that
 *     directory counts, because the directory belongs to the lint and its parts are tested by name.
 *   * a lint in the SHARED `tooling/` directory (`tooling/lint-something.mjs`) — it shares that
 *     directory with fifty unrelated tools, so only a test of its own basename counts.
 */
export function testFileMatches({ scriptFile, testFile }) {
  const scriptDirectory = scriptFile.slice(0, scriptFile.lastIndexOf("/"));
  const testDirectory = testFile.slice(0, testFile.lastIndexOf("/"));
  if (testDirectory !== scriptDirectory) return false;
  if (!/\.test\.(mjs|mts|ts|js)$/.test(testFile)) return false;
  if (scriptDirectory !== "tooling") return true;
  const base = scriptFile.slice(scriptDirectory.length + 1).replace(/\.[^.]+$/, "");
  const testBase = testFile.slice(testDirectory.length + 1).replace(/\.test\.[^.]+$/, "");
  return base === testBase;
}

/**
 * Rule one: every `lint:*` script can fail, proven by a fixture test beside it or a self-test in it.
 *
 * @param {object} options
 * @param {{name: string, scriptFile: string|null, source: string|null, testFiles: string[]}[]}
 *   options.lints one entry per script, already read off disk by the caller.
 * @param {readonly string[]} [options.register] the debt register (names allowed to fail this rule).
 * @returns {{findings: string[], unprovable: string[], provable: string[]}}
 */
export function checkEveryLintCanFail({ lints, register = LINTS_THAT_CANNOT_FAIL }) {
  const registered = new Set(register);
  const findings = [];
  const unprovable = [];
  const provable = [];

  for (const lint of lints) {
    if (lint.scriptFile === null) {
      findings.push(
        `${lint.name}: its package.json command names no script file — ` +
          `point the script at a file under tooling/, or delete the entry.`,
      );
      continue;
    }
    if (lint.source === null) {
      findings.push(
        `${lint.name}: its script ${lint.scriptFile} does not exist on disk — ` +
          `restore the file, or remove "${lint.name}" from the root package.json.`,
      );
      continue;
    }
    const beside = lint.testFiles.filter((testFile) =>
      testFileMatches({ scriptFile: lint.scriptFile, testFile }),
    );
    const proven = beside.length > 0 || hasSelfTest(lint.source);
    if (proven) {
      provable.push(lint.name);
      if (registered.has(lint.name)) {
        findings.push(
          `${lint.name}: it can now fail but is still on the debt register — ` +
            `delete "${lint.name}" from LINTS_THAT_CANNOT_FAIL in tooling/lint-lints/rules.mjs.`,
        );
      }
      continue;
    }
    unprovable.push(lint.name);
    if (!registered.has(lint.name)) {
      const directory = lint.scriptFile.slice(0, lint.scriptFile.lastIndexOf("/"));
      const suggestion =
        directory === "tooling"
          ? `${lint.scriptFile.replace(/\.[^.]+$/, "")}.test.mjs`
          : `${directory}/<its-rules>.test.mjs`;
      findings.push(
        `${lint.name}: nothing proves it can fail — no *.test.mjs beside ${lint.scriptFile} and ` +
          `no self-test that runs on every invocation — ` +
          `add ${suggestion} (with a vitest.config.ts beside it, registered in vite.config.ts), ` +
          `or a SELF_TEST table in ${lint.scriptFile} called before the scan, ` +
          `the way tooling/lint-control-characters.mjs does.`,
      );
    }
  }

  for (const name of register) {
    if (!lints.some((lint) => lint.name === name)) {
      findings.push(
        `${name}: on the debt register but no such script in the root package.json — ` +
          `delete "${name}" from LINTS_THAT_CANNOT_FAIL in tooling/lint-lints/rules.mjs.`,
      );
    }
  }

  return { findings, unprovable, provable };
}

/**
 * Rule two: every `lint:*` script is findable in the documentation.
 *
 * A lint is documented when the prose names either the command (`lint:something`) or the script path
 * it runs — naming the tool's own directory counts, because that is how a reader gets from a failing
 * gate to the rule behind it. A governance rule nobody can find is a governance rule people trip
 * over.
 *
 * @param {{name: string, scriptFile: string|null}[]} lints
 * @param {string} documentation every documentation file's text, concatenated by the caller.
 */
export function checkEveryLintIsDocumented({ lints, documentation }) {
  const findings = [];
  const undocumented = [];
  for (const lint of lints) {
    const directory =
      lint.scriptFile === null ? null : lint.scriptFile.slice(0, lint.scriptFile.lastIndexOf("/"));
    const mentions = [
      lint.name,
      lint.scriptFile,
      directory === "tooling" ? null : directory,
    ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
    if (mentions.some((mention) => documentation.includes(mention))) continue;
    undocumented.push(lint.name);
    findings.push(
      `${lint.name}: named nowhere under ${DOCUMENTATION_ROOTS.join(" or ")} — ` +
        `say what it enforces in the convention file that owns the rule ` +
        `(docs/conventions/), naming "${lint.name}", so a failing run leads somewhere.`,
    );
  }
  return { findings, undocumented };
}

/**
 * Every `pnpm run lint:…` command cited in one documentation file, with the line it sits on.
 * The runner is matched loosely (pnpm, npm, yarn, vp) so a citation written either way is caught.
 */
export function citedLintCommands(text) {
  const cited = [];
  const pattern = /\b(?:pnpm|npm|yarn|vp)(?:\s+(?:run|exec))?\s+(lint:[A-Za-z0-9][\w:.-]*)/g;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      cited.push({ command: match[1], line: index + 1 });
    }
  });
  return cited;
}

/**
 * Rule three: every lint command the documentation tells a reader to run actually exists.
 *
 * The reverse of rule two, and the direction a rename breaks: renaming a script leaves the prose
 * pointing at a command that exits with "command not found", which reads to a reader as their own
 * mistake.
 *
 * @param {{file: string, command: string, line: number}[]} citations
 * @param {readonly string[]} lintNames every `lint:*` script in the root package.json.
 */
export function checkEveryCitedCommandExists({ citations, lintNames }) {
  const known = new Set(lintNames);
  const findings = [];
  const broken = [];
  const seen = new Set();
  for (const citation of citations) {
    if (known.has(citation.command)) continue;
    const key = `${citation.command} ${citation.file}:${citation.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    broken.push(citation);
    findings.push(
      `${citation.command}: cited at ${citation.file}:${citation.line} but the root package.json ` +
        `declares no such script — repoint the prose at the script's current name, ` +
        `or restore "${citation.command}" in the root package.json.`,
    );
  }
  return { findings, broken };
}

/**
 * The environment of the gate step that runs the repository-wide fitness sweep, read off the gate's
 * own step list (tooling/gate/governance.mjs exports its steps as data). The step is found by the
 * configuration file it runs, so renaming the step changes nothing here; a step list that runs the
 * configuration nowhere reports `found: false`.
 *
 * @param {readonly {arguments?: readonly string[], env?: Record<string, string>}[]} steps
 * @returns {{found: boolean, variables: [string, string][]}}
 */
export function fitnessSweepEnvironment(steps, configuration = FITNESS_SWEEP_CONFIGURATION) {
  const step = steps.find((candidate) => (candidate.arguments ?? []).includes(configuration));
  if (step === undefined) return { found: false, variables: [] };
  return { found: true, variables: Object.entries(step.env ?? {}) };
}

/**
 * Rule four: the name of the scope variable the sweep reads is the same string in both places.
 *
 * The sweep configuration reads one environment variable to learn which scopes this run covers. The
 * gate's governance step sets it, as a literal (governance.mjs says why it is not imported). Rename
 * either side and nothing breaks loudly — the sweep silently falls back to its default scope and
 * covers half of what the step's own title claims, on a green run.
 *
 * The values are held to the known scope set for the same reason: a typo in `source,schema` is the
 * same silent narrowing, arrived at from the other direction.
 */
export function compareFitnessScopeVariable({
  environment,
  expectedName,
  knownScopes,
  workflow = GATE_GOVERNANCE,
}) {
  const findings = [];
  if (!environment.found) {
    findings.push(
      `${workflow}: no step runs ${FITNESS_SWEEP_CONFIGURATION} — the repository-wide fitness sweep ` +
        `is not in the gate at all — restore the step, with ` +
        `${expectedName} set to the scopes it must cover.`,
    );
    return findings;
  }

  const names = environment.variables.map(([name]) => name);
  if (!names.includes(expectedName)) {
    findings.push(
      `${workflow}: the fitness-sweep step sets ${names.length === 0 ? "no environment variable" : names.join(", ")} ` +
        `but the sweep reads ${expectedName} (FITNESS_SCOPES_ENV in tooling/check-scoped/repo-wide.mjs) — ` +
        `an unread variable leaves the sweep on its default scope and covers less than the step claims — ` +
        `hold the two identical: set ${expectedName} in the step, or rename FITNESS_SCOPES_ENV to match.`,
    );
    return findings;
  }

  const value = environment.variables.find(([name]) => name === expectedName)[1];
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const unknown = scopes.filter((scope) => !knownScopes.has(scope));
  if (scopes.length === 0 || unknown.length > 0) {
    findings.push(
      `${workflow}: the fitness-sweep step sets ${expectedName} to "${value}", which names ` +
        `${scopes.length === 0 ? "no scope" : `the unknown scope(s) ${unknown.join(", ")}`} — ` +
        `an unrecognised scope selects nothing and the sweep passes having run less than it claims — ` +
        `use the scopes FITNESS_SCOPES declares in tooling/check-scoped/repo-wide.mjs: ` +
        `${[...knownScopes].join(", ")}.`,
    );
  }
  return findings;
}
