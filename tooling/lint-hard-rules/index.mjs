/*
 * The hard-rule pass: the linter rules this repository can enforce TODAY, run where they can fail.
 *
 * The rules, the counts that set their levels, and why they are not simply added to the shared
 * Oxlint ruleset are on rules.mjs beside this file.
 *
 * Run: `pnpm run lint:hard-rules`. Roughly six seconds over ~3,900 files — no type-aware pass, so
 * none of the forty-five-minute whole-repo cost, and no WASM artefacts needed.
 *
 * HOW IT PROVES ITSELF. This is a wrapper around another tool, which is the shape of check that most
 * easily rots into a permanent pass: a renamed plugin flag, a retired rule, or a root that matches
 * no files all produce "no findings", and a wrapper reading that number reports a clean tree. So
 * before it trusts a count of zero, every rule is run against a synthetic fixture that MUST trip it.
 * A rule whose fixture comes back clean fails the scan and says the invocation, not the repository,
 * is what stopped working.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFindings, HARD_RULES, ROOTS, SELF_TEST, verdict } from "./rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

for (const check of SELF_TEST) {
  if (!check.run()) {
    console.error(`lint-hard-rules: SELF-TEST FAILED — ${check.what}`);
    process.exit(1);
  }
}

/** Every plugin any hard rule needs, each flag once. */
const PLUGIN_FLAGS = [...new Set(HARD_RULES.flatMap((rule) => rule.plugins))];

/**
 * Lint the given paths for every hard rule at once, and return the findings grouped by rule name.
 *
 * `-A all` silences every rule the configuration would otherwise apply, so the report carries these
 * rules' findings and nothing else; one `-D` per rule then raises them to errors, which is what
 * makes each count unambiguous. The linter exits non-zero when it finds something, so the exit code
 * is not an error signal here — an unparseable report is.
 */
function runRules(targets) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vp",
      "lint",
      ...PLUGIN_FLAGS,
      "-A",
      "all",
      ...HARD_RULES.flatMap((rule) => ["-D", rule.name]),
      "--format=json",
      ...targets,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error !== undefined) {
    throw new Error(`lint-hard-rules: could not run the linter: ${result.error}`);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "lint-hard-rules: the linter's output did not parse as JSON. First 400 characters:\n" +
        (result.stdout || result.stderr).slice(0, 400),
    );
  }
  const findings = collectFindings(report);
  return new Map(
    HARD_RULES.map((rule) => [rule.name, findings.filter((finding) => finding.code === rule.code)]),
  );
}

/**
 * Lint every rule's fixture in a directory of its own and confirm each rule still fires.
 *
 * The fixtures live outside the repository so they can never be mistaken for first-party source, and
 * are deleted whether or not the check passes. Every rule's fixture files are written into the one
 * directory: they are independent of each other, and one linter run answers for all of them.
 */
function proveTheRulesStillFire() {
  const directory = mkdtempSync(path.join(tmpdir(), "magna-carta-hard-rules-"));
  try {
    for (const rule of HARD_RULES) {
      for (const [name, contents] of Object.entries(rule.fixture)) {
        writeFileSync(path.join(directory, name), contents, "utf8");
      }
    }
    const byRule = runRules([directory]);
    for (const rule of HARD_RULES) {
      if (byRule.get(rule.name).length === 0) {
        throw new Error(
          `lint-hard-rules: ${rule.name} found nothing in a fixture written to trip it. The rule, ` +
            "the plugin flag, or the reporter changed — until that is fixed this scan cannot tell a " +
            "clean repository from a rule that stopped asking.",
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const failures = [];
const lines = [];

proveTheRulesStillFire();
const byRule = runRules(ROOTS);

for (const rule of HARD_RULES) {
  const findings = byRule.get(rule.name);
  const outcome = verdict({ name: rule.name, baseline: rule.baseline, count: findings.length });
  lines.push(outcome.reason);
  if (!outcome.ok) {
    failures.push({ rule, outcome, findings });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n--- ${failure.outcome.reason}`);
    console.error(`    ${failure.rule.summary}`);
    for (const finding of failure.findings.slice(0, 40)) {
      console.error(`      ${finding.file}:${finding.line}  ${finding.message}`);
      if (finding.note !== "") {
        console.error(
          finding.note
            .split("\n")
            .map((noteLine) => `        ${noteLine}`)
            .join("\n"),
        );
      }
    }
    if (failure.findings.length > 40) {
      console.error(`      ... and ${failure.findings.length - 40} more`);
    }
  }
  console.error(`\nlint-hard-rules: ${failures.length} of ${HARD_RULES.length} rule(s) failed.`);
  process.exit(1);
}

console.log(`lint-hard-rules: ${HARD_RULES.length} rules at baseline — ${lines.join("; ")}`);
