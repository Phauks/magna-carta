/*
 * The rules the linter can hold HARD today, and why each one is not left to the shared ruleset.
 *
 * WHY THIS FILE EXISTS. The repository's Oxlint ruleset (the `lint` block of the root
 * vite.config.ts) is almost entirely ADVISORY: `suspicious` and `perf` are warnings, `correctness`
 * keeps its inherited advisory severity, and `oxc/no-barrel-file` is the single rule set to error.
 * That is a deliberate posture — promoting a category wholesale would turn hundreds of existing
 * findings into gate failures and block unrelated work — but it has a consequence nobody chose: the
 * most expensive job in the gate, a whole-repo type-aware pass measured at roughly forty-five
 * minutes, can fail on exactly one rule. A finding that is genuinely a defect prints in a list of
 * eight hundred warnings that nothing reads.
 *
 * A rule does not have to wait for that cleanup to become real. A rule the repository ALREADY
 * satisfies can be an error today at no cost, and a rule it nearly satisfies can be held by a count
 * that may only fall. Neither needs the type-aware pass: both run over the syntax tree in seconds.
 * So they live here, in their own cheap pass that genuinely fails, instead of being advisory in an
 * expensive one that does not.
 *
 * WHY NOT JUST ADD THE PLUGINS TO THE SHARED RULESET. Enabling the `import` and `vitest` plugins
 * there switches on every rule they carry at its category severity, which adds a fresh crop of
 * warnings to the forty-five-minute pass and moves nothing from advisory to enforced. The rules
 * below are selected one at a time, by name, with the count that justifies the level.
 *
 * WHAT THIS CANNOT SEE. Everything the linter itself cannot: a cycle assembled through a dynamic
 * import, a focused test written as a runtime flag rather than `.only`. And the roots are the three
 * workspace groups — a lintable file outside them is not scanned here.
 */

/**
 * A hard rule, and the exact invocation that proves it.
 *
 * `plugins` are the Oxlint plugin flags the rule needs, and `code` is how the rule names itself in
 * the linter's report. Every rule here is raised in ONE invocation (`-A all` silences everything
 * else, then one `-D` per rule) and the findings are partitioned by `code` afterwards: three
 * invocations cost three whole-repo walks for one walk's worth of answers.
 *
 * `baseline` is the number of findings the tree is allowed to carry. Zero means the rule is clean
 * and must stay clean. A positive number is a debt register: it may only fall, and when it falls the
 * scan fails with the new number so tightening the ratchet is a one-integer edit.
 *
 * `fixture` is what the rule looks like when it fires, and it is not decoration. This scan is a
 * WRAPPER: if a plugin flag is renamed, a rule is retired, or the invocation stops matching any
 * file, the linter answers "no findings" and the wrapper reports a clean tree forever. The fixture
 * is linted on every run and MUST produce a finding, so a wrapper that has quietly stopped asking
 * fails loudly instead of passing.
 */
export const HARD_RULES = [
  {
    name: "import/no-cycle",
    code: "import(no-cycle)",
    plugins: ["--import-plugin"],
    baseline: 16,
    summary: "a module that imports its way back to itself",
    why:
      "Sixty-one workspace packages and nothing looks for a cycle: the project-reference check " +
      "(tooling/tsconfig-refs) verifies that references EXIST, not that they form a directed acyclic " +
      "graph, and a bundler resolves a cycle silently by handing one side a half-initialised module. " +
      "The failure that reaches a person is a `undefined is not a function` at import time, in a file " +
      "that is correct, on whichever of the two modules happened to be evaluated first. Sixteen " +
      "findings stand today, concentrated in the web app's calendar and directory screens, so this " +
      "is a ratchet rather than a ban. It stood at thirty-six until the api-worker's share went: " +
      "every one of those ran through `authForEnv` living in app.ts, which imports every route " +
      "module — so a route-specific guard that had to resolve a session for itself closed a cycle, " +
      "and a second route in that lane added two more findings. It moved to src/auth-instance.ts, " +
      "which takes only the `Bindings` type from app.ts, and twenty findings went with it.",
    fixture: {
      "first.ts": 'import { second } from "./second.ts";\nexport const first = () => second();\n',
      "second.ts": 'import { first } from "./first.ts";\nexport const second = () => first();\n',
    },
  },
  {
    name: "vitest/no-focused-tests",
    code: "vitest(no-focused-tests)",
    plugins: ["--vitest-plugin"],
    baseline: 0,
    summary: "a focused test, which silently disables every other test in its file",
    why:
      "A stray `.only` is green, loud in no output, and it takes the rest of the file's coverage with " +
      "it. This repository is exposed to it: the test battery runs on the machine that made the change " +
      "(`pnpm gate`), never on a runner of its own, so a focused test can sit on a branch through " +
      "review and only ever run narrowed. The tree is clean today, which is what makes a hard zero free.",
    fixture: {
      "focused.test.ts": 'import { it } from "vitest";\nit.only("focused", () => {});\n',
    },
  },
  {
    name: "vitest/no-disabled-tests",
    code: "vitest(no-disabled-tests)",
    plugins: ["--vitest-plugin"],
    baseline: 0,
    summary: "a skipped test, which is a test nobody has decided to delete or fix",
    why:
      "A skipped test reads as coverage in every count that matters and asserts nothing. Deleting it " +
      "or fixing it are both decisions; leaving it is the absence of one. Clean today.",
    fixture: {
      "skipped.test.ts": 'import { it } from "vitest";\nit.skip("skipped", () => {});\n',
    },
  },
];

/** The workspace groups the scan covers. A lintable file outside them is not reached. */
export const ROOTS = ["apps", "packages", "plugins"];

/**
 * The linter's JSON report, reduced to what the ratchet compares.
 *
 * Pure over the parsed document so the reduction is testable without running a linter, which is the
 * half of this scan most likely to break silently when the reporter's shape changes.
 */
export function collectFindings(report) {
  const diagnostics = report?.diagnostics;
  if (!Array.isArray(diagnostics)) {
    throw new Error(
      "lint-hard-rules: the linter's JSON report carried no `diagnostics` array. The reporter's " +
        "shape changed, and a scan that reads no findings from it would report a clean tree.",
    );
  }
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.filename,
    line: diagnostic.labels?.[0]?.span?.line ?? 0,
    message: diagnostic.message,
    note: diagnostic.note ?? "",
  }));
}

/**
 * The verdict for one rule: whether the count passes, and what to do when it does not.
 *
 * Three outcomes, and the third is the one that keeps a ratchet honest — a count that has FALLEN is
 * a failure too, because a baseline nobody re-records is a baseline that silently re-admits the debt
 * somebody just paid off.
 */
export function verdict({ name, baseline, count }) {
  if (count > baseline) {
    return {
      ok: false,
      reason:
        baseline === 0
          ? `${name}: ${count} finding(s), and this rule is held at zero. Fix them; there is no baseline to raise.`
          : `${name}: ${count} finding(s) against a baseline of ${baseline}. The baseline is a debt register and does not rise — fix the new one(s).`,
    };
  }
  if (count < baseline) {
    return {
      ok: false,
      reason:
        `${name}: ${count} finding(s), below the recorded baseline of ${baseline}. ` +
        `Record the win: set the baseline to ${count} in tooling/lint-hard-rules/rules.mjs.`,
    };
  }
  return { ok: true, reason: `${name}: ${count} finding(s), at baseline.` };
}

/*
 * The self-test of the pure half. The wrapper half — that the invocation still makes the linter
 * fire — cannot be tested from a table and is tested against a real fixture on every run; see the
 * `fixture` field above and the runner in index.mjs.
 */
export const SELF_TEST = [
  {
    what: "a report with findings reduces to one entry per diagnostic",
    run: () =>
      collectFindings({
        diagnostics: [
          { filename: "a.ts", message: "m", labels: [{ span: { line: 7 } }] },
          { filename: "b.ts", message: "m", labels: [] },
        ],
      }).length === 2,
  },
  {
    what: "a finding keeps the rule code it must be partitioned by",
    run: () =>
      collectFindings({ diagnostics: [{ filename: "a.ts", code: "import(no-cycle)" }] })[0].code ===
      "import(no-cycle)",
  },
  {
    what: "a diagnostic with no label still carries its file",
    run: () =>
      collectFindings({ diagnostics: [{ filename: "b.ts", message: "m" }] })[0].file === "b.ts",
  },
  {
    what: "a report with no diagnostics array is refused rather than read as clean",
    run: () => {
      try {
        collectFindings({});
        return false;
      } catch {
        return true;
      }
    },
  },
  {
    what: "a count above the baseline fails",
    run: () => verdict({ name: "r", baseline: 2, count: 3 }).ok === false,
  },
  {
    what: "a count at the baseline passes",
    run: () => verdict({ name: "r", baseline: 2, count: 2 }).ok === true,
  },
  {
    what: "a count below the baseline fails, so the win gets recorded",
    run: () => verdict({ name: "r", baseline: 2, count: 1 }).ok === false,
  },
  {
    what: "a rule held at zero says there is no baseline to raise",
    run: () =>
      verdict({ name: "r", baseline: 0, count: 1 }).reason.includes("no baseline to raise"),
  },
];
