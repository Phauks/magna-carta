// Runs the repo-wide governance lints — the set derived in repo-wide.mjs, never a list written here.
//
// Two callers, one derivation: the inner-loop gate (tooling/check-scoped/index.mjs) and the whole-repo
// gate (tooling/gate/governance.mjs). Adding a `lint:*` script to the root package.json puts it in both,
// which is the point — a governance lint nobody remembered to wire is a governance lint that is not
// running.
//
// The lints run CONCURRENTLY. They are independent whole-repo file scans — I/O-shaped, a few tens of
// milliseconds of CPU each — so serially they cost the sum (1.7 s) and concurrently they cost the
// slowest (~0.5 s). Output is buffered per lint and printed only for the ones that fail, so a passing
// run is one line: twelve lints' worth of "everything is fine" scrolling past is how people learn to
// stop reading gate output.
//
// Usage:
//   node tooling/check-scoped/run-repo-wide-lints.mjs                    inner-loop set
//   node tooling/check-scoped/run-repo-wide-lints.mjs --dependencies     ... plus the dependency-set lints
//   node tooling/check-scoped/run-repo-wide-lints.mjs --all              every lint:* script
//   node tooling/check-scoped/run-repo-wide-lints.mjs --all --except lint:test-collection

import { spawn } from "node:child_process";
import { ROOT } from "./changed-files.mjs";
import { lintInvocation, repoWideLints } from "./repo-wide.mjs";

const argv = process.argv.slice(2);
const except = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--except") {
    const name = argv[index + 1];
    if (name === undefined) {
      console.error("run-repo-wide-lints: --except needs a script name");
      process.exit(1);
    }
    except.push(name);
    index += 1;
  }
}

const names = repoWideLints({
  all: argv.includes("--all"),
  dependenciesChanged: argv.includes("--dependencies"),
  except,
});

// Each lint is spawned as the command its package.json script names, NOT through `pnpm run`. The
// scripts themselves are 50-450 ms; a `pnpm run` wrapper adds ~600 ms of package-manager startup
// EACH, which would more than triple the step and buy nothing. lintInvocation falls back to
// `pnpm run` for any script that is not a plain command, so a future lint written as a shell
// pipeline still runs — just at the slower price, and only that one.
function runLint(name) {
  return new Promise((resolve) => {
    const { command, args } = lintInvocation(name);
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ name, ok: false, output: String(error) }));
    child.on("close", (code) => resolve({ name, ok: code === 0, output }));
  });
}

const results = await Promise.all(names.map(runLint));
const failures = results.filter((result) => !result.ok);

for (const failure of failures) {
  console.error(`\n--- ${failure.name}\n${failure.output.trimEnd()}`);
}

if (failures.length > 0) {
  console.error(
    `\nrepo-wide lints: ${failures.length} of ${results.length} failed — ` +
      failures.map((failure) => failure.name).join(", "),
  );
  process.exit(1);
}

console.log(`repo-wide lints: ${results.length} passed (${names.join(", ")})`);
