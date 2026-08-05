// The inner-loop fixer: format and autofix exactly the files the current change touches.
//
// A bare `vp check --fix` takes no paths and therefore rewrites the WHOLE REPO. In practice that has
// repeatedly landed dozens of files nobody in the change had touched. Passing the change set makes the
// safe invocation the short one, so nobody has to remember to type the paths.
//
// The set is exactly what `pnpm check:scoped` checks (changed-files.mjs — the diff against the resolved
// merge base, plus staged, unstaged and untracked files), so what this rewrites and what the gate then
// verifies can never drift. Markdown and the other prose/data formats are included; Rust is not (that is
// `cargo fmt`).
//
// Not every lint autofix is safe to apply unattended, so the two halves of `vp check --fix` are driven
// separately: the formatter through `vp check --fix --no-lint`, and the lint autofix through
// `vp lint --fix` with the rules listed in unsafe-autofix-rules.mjs allowed off. `vp check` rejects the
// linter's `--allow` flag outright, so a single combined invocation cannot express the exclusion. Those
// rules keep WARNING everywhere — this only stops them rewriting code while nobody is watching.
//
// Each pass gets only the paths it can parse, because both hard-error on a path they cannot: `.svelte`
// is lint-only (the formatter has no Svelte parser), markdown/JSON/CSS/HTML/YAML/TOML are format-only
// (the linter has no rules for them), scripts take both. Lint runs before the formatter within a group,
// so a rewritten line is formatted rather than left for the next `pnpm check:scoped` to reject.
//
// Usage: pnpm fix:scoped [--base <ref>] [--no-lint]
//   --no-lint  format only — skip the lint autofixes entirely, for when a rule's fix is wrong for the
//              package being edited and the formatting is all that is wanted.

import { spawnSync } from "node:child_process";
import {
  collectChangedFiles,
  parseBaseFlag,
  partitionByTool,
  resolveBase,
  ROOT,
} from "./changed-files.mjs";
import { allowFlagsForFixPass, UNSAFE_AUTOFIX_RULES } from "./unsafe-autofix-rules.mjs";

const argv = process.argv.slice(2);
const lintDisabled = argv.includes("--no-lint");

const base = resolveBase({ explicitBase: parseBaseFlag(argv) });
let files = [];
try {
  files = collectChangedFiles({ base });
} catch (error) {
  console.error("fix:scoped: could not read the git diff —", error.message);
  process.exit(1);
}

if (files.length === 0) {
  console.log("fix:scoped: no changes against " + base.slice(0, 12) + " — nothing to fix");
  process.exit(0);
}

const { scripts, lintOnly, formatOnly } = partitionByTool(files);

// `--no-error-on-unmatched-pattern`: a change whose script files are all covered by the linter's
// ignorePatterns (the generated API client, for one) leaves the linter with nothing to do, and its
// default is to call that an error. Nothing to lint is not a failure of the fixer.
const lintFix = (paths) => [
  "lint",
  "--fix",
  "--no-error-on-unmatched-pattern",
  ...allowFlagsForFixPass(),
  ...paths,
];
const formatFix = (paths) => ["check", "--fix", "--no-lint", ...paths];

const passes = [];
if (scripts.length > 0 && !lintDisabled) {
  passes.push({
    name: `lint (${scripts.length} script file(s))`,
    paths: scripts,
    args: lintFix(scripts),
  });
}
if (lintOnly.length > 0 && !lintDisabled) {
  passes.push({
    name: `lint (${lintOnly.length} svelte file(s))`,
    paths: lintOnly,
    args: lintFix(lintOnly),
  });
}
if (scripts.length > 0) {
  passes.push({
    name: `format (${scripts.length} script file(s))`,
    paths: scripts,
    args: formatFix(scripts),
  });
}
if (formatOnly.length > 0) {
  passes.push({
    name: `format (${formatOnly.length} markdown/data file(s))`,
    paths: formatOnly,
    args: formatFix(formatOnly),
  });
}

const fixable = scripts.length + lintOnly.length + formatOnly.length;
console.log(
  `fix:scoped: ${fixable} of ${files.length} changed file(s) since ${base.slice(0, 12)} are fixable\n`,
);
if (passes.length === 0) {
  console.log("fix:scoped: nothing the formatter or linter handles — done");
  process.exit(0);
}

// Every pass runs even after one fails. The passes are independent rewrites of disjoint concerns, and
// stopping at the first would leave a change half-fixed — formatting skipped because a lint finding the
// fixer cannot repair is still open — which reads as the fixer being broken rather than as work left.
const failures = [];
for (const pass of passes) {
  process.stdout.write(`--- ${pass.name}\n`);
  for (const file of pass.paths) console.log(`    ${file}`);
  const run = spawnSync("vp", pass.args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) {
    console.error(`\nfix:scoped: FAILED at "${pass.name}"`);
    failures.push(pass.name);
  }
}

if (!lintDisabled) {
  console.log(
    "\nfix:scoped: not auto-applied (reported by `pnpm check:scoped`, fix by hand if right here) — " +
      UNSAFE_AUTOFIX_RULES.map((entry) => entry.rule).join(", "),
  );
}

if (failures.length > 0) {
  console.error(`fix:scoped: ${failures.length} pass(es) failed — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(
  "\nfix:scoped: done — only the changed files were touched. Re-run `pnpm check:scoped` to verify.",
);
