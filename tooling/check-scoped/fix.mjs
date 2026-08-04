// The inner-loop fixer: format and autofix exactly the files the current change touches.
//
// A bare `vp check --fix` takes no paths and therefore rewrites the WHOLE REPO. In practice that has
// repeatedly landed dozens of files nobody in the change had touched, and not all of its rewrites are
// safe everywhere: the lint autofix that turns `sort()` into `toSorted()` breaks packages whose compile
// target predates it. Passing the change set makes the safe invocation the short one, so nobody has to
// remember to type the paths.
//
// The set is exactly what `pnpm check:scoped` checks (changed-files.mjs — the diff against the resolved
// merge base, plus staged, unstaged and untracked files), so what this rewrites and what the gate then
// verifies can never drift. Markdown and the other prose/data formats are included; Rust is not (that is
// `cargo fmt`).
//
// Each pass gets only the paths it can parse, because both hard-error on a path they cannot: `.svelte`
// goes through `--no-fmt` (the formatter has no Svelte parser), markdown/JSON/CSS/HTML/YAML/TOML through
// `--no-lint` (the linter has no rules for them), scripts through both.
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
const passes = [];
if (scripts.length > 0) {
  passes.push({
    name: `${lintDisabled ? "format" : "format + lint"} (${scripts.length} script file(s))`,
    paths: scripts,
    flags: lintDisabled ? ["--no-lint"] : [],
  });
}
// Linting is the whole of this pass, so `--no-lint` drops it rather than running an empty one.
if (lintOnly.length > 0 && !lintDisabled) {
  passes.push({
    name: `lint (${lintOnly.length} svelte file(s))`,
    paths: lintOnly,
    flags: ["--no-fmt"],
  });
}
if (formatOnly.length > 0) {
  passes.push({
    name: `format (${formatOnly.length} markdown/data file(s))`,
    paths: formatOnly,
    flags: ["--no-lint"],
  });
}

const fixable = passes.reduce((total, pass) => total + pass.paths.length, 0);
console.log(
  `fix:scoped: ${fixable} of ${files.length} changed file(s) since ${base.slice(0, 12)} are fixable\n`,
);
if (passes.length === 0) {
  console.log("fix:scoped: nothing the formatter or linter handles — done");
  process.exit(0);
}

let failed = null;
for (const pass of passes) {
  process.stdout.write(`--- ${pass.name}\n`);
  for (const file of pass.paths) console.log(`    ${file}`);
  const run = spawnSync("vp", ["check", "--fix", ...pass.flags, ...pass.paths], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) {
    console.error(`\nfix:scoped: FAILED at "${pass.name}"`);
    failed = pass.name;
    break;
  }
}

if (failed) process.exit(1);
console.log(
  "\nfix:scoped: done — only the files above were touched. Re-run `pnpm check:scoped` to verify.",
);
