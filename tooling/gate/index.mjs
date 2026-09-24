// `pnpm gate` — the whole-repo quality gate, run on the machine that made the change.
//
// This is the gate of record. It used to be a GitHub Actions workflow with the same shape, and it
// stopped being one because the workflow was a gate somebody else had to be paying for: when the
// account's Actions minutes ran out the required status never reported, every pull request wedged
// behind a check that had not run, and each merge went through on an override instead. A gate that
// depends on a runner budget is a gate that fails closed on the budget and open on the code. So the
// same checks run here, from one command, with no account between the change and its verification;
// what the workflow gave up in parallel runners it gives back in never being unavailable.
//
// SHAPE. One classification of the change, then the dimensions in order — cheap and certain first,
// the test battery last. Each dimension runs only when the change can reach it (a docs-only change
// runs format and governance and nothing else), and says so when it does not: a gate that quietly
// checks nothing is worse than a slow one. A failed dimension does not stop the others, because the
// summary is more useful complete; the one dependency is the WASM artefacts, whose consumers cannot
// run without them and are reported as skipped for that reason rather than failing on twelve
// missing-module errors.
//
//   format           `vp check --no-lint` over the whole repository (markdown included) — always
//   governance       every lint:* script, the repo-wide fitness sweep, migration integrity, the
//                    drizzle snapshot check — always (governance.mjs)
//   audit            osv-scanner over the pnpm lockfile and every first-party Cargo.lock, HIGH and
//                    above failing (audit.mjs) — always; NOT RUN, visibly, when the pinned scanner
//                    cannot be fetched
//   wasm             the git-ignored Rust->WASM artefacts, rebuilt only when stale — when code changed
//   typecheck        tsc -b over both root solutions, the reference-graph guard, the api-client
//                    type-check, svelte-check for the SPA and the design system — when code changed
//   contracts        OpenAPI snapshot, generated client, Spectral, design tokens: each regenerated and
//                    diffed against what is committed — when code changed
//   lint             `vp check --no-fmt` over the affected packages plus their full transitive
//                    dependent closure (tooling/affected-lint), the whole repository when a global
//                    input moved — when code changed
//   rust             cargo fmt + clippy + test over the crates workspace — when a crate or the
//                    toolchain pin changed
//   containers       cargo fmt + clippy + test per changed container workspace, then that container's
//                    acceptance suite under Docker — when a container changed
//   test-collection  the whole-suite collection clears its committed floor — when code changed
//   tests            the full `pnpm test` (node, Miniflare and Chromium suites, under the
//                    single-flight lock) — when code changed
//
// THE CHANGE is everything since the merge-base with the trunk plus the working tree, the same set
// `pnpm check:scoped` verifies (tooling/check-scoped/changed-files.mjs). An empty change — the gate
// run on `main` itself — runs everything at the widest scope: that is the sweep, and it is what to
// run after a batch of merges.
//
// Usage:
//   pnpm gate                          the gate for the current change
//   pnpm gate --plan                   print what would run, and why, without running anything
//   pnpm gate --all                    everything, whole-repo lint, every container — the sweep
//   pnpm gate --checks-only            everything except the test battery
//   pnpm gate --only lint,typecheck    named dimensions only
//   pnpm gate --skip containers,audit  everything except the named dimensions
//   pnpm gate --base <ref>             measure the change from <ref> instead of the trunk merge-base
//
// EVERY STEP RUNS UNDER A TIME BUDGET. A check that never returns used to be indistinguishable from a
// slow machine — no error, no exit code, no file named — and the gate of record was unrunnable end to
// end for six days on one such step before anybody could say which one it was. A step that exceeds its
// budget is now killed (with its whole process tree, never just the process this holds a handle on) and
// reported as NO END: its own outcome, never folded into FAILED, because "found problems" and "never
// finished" call for different next moves. budget.mjs holds the numbers; run-step.mjs holds the
// teardown. MAGNA_CARTA_GATE_TIMEOUT_SCALE=2 doubles every budget and =off removes them.
//
// The pre-push hook runs the diff-scoped `pnpm check:scoped`, not this: this is what runs before a
// merge, and its result is what a pull request states. Home: docs/conventions/build-performance.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { computeAffected, discoverPackages } from "../affected-lint/index.mjs";
import {
  collectChangedFiles,
  parseBaseFlag,
  resolveBase,
  ROOT,
} from "../check-scoped/changed-files.mjs";
import { runAudit } from "./audit.mjs";
import { budgetFor, resolveScale, SCALE_VARIABLE } from "./budget.mjs";
import { acceptanceFor, changedContainers, classify } from "./classify.mjs";
import { GOVERNANCE_STEPS } from "./governance.mjs";
import { NEEDS_WASM, parseList, selectDimensions } from "./plan.mjs";
import { runStep } from "./run-step.mjs";

const argv = process.argv.slice(2);
const CACHE = path.join(ROOT, "node_modules", ".cache", "magna-carta", "gate");
const onWindows = process.platform === "win32";

// ---------------------------------------------------------------------------------------------------
// The change, and what it reaches
// ---------------------------------------------------------------------------------------------------

let flags;
try {
  flags = {
    all: argv.includes("--all"),
    plan: argv.includes("--plan"),
    checksOnly: argv.includes("--checks-only"),
    only: parseList(argv, "--only"),
    skip: parseList(argv, "--skip"),
  };
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

// Every step runs under a time budget, so a check that never returns is reported as not having
// finished instead of reading as a slow machine. budget.mjs holds the numbers and why they are what
// they are. Resolved here, beside the other flags, so a mistyped scale fails before anything runs.
let scale;
try {
  scale = resolveScale(process.env[SCALE_VARIABLE]);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const base = resolveBase({ explicitBase: parseBaseFlag(argv) });
let files;
try {
  files = collectChangedFiles({ base });
} catch (error) {
  console.error("gate: could not read the git diff —", error.message);
  process.exit(1);
}

const sweep = flags.all || files.length === 0;
const change = sweep
  ? { code: true, rust: true, containers: true, codeFiles: files }
  : classify(files);

// The type-aware lint scope: the changed packages plus their FULL transitive dependent closure, fan-out
// sinks included. The workflow deferred the sinks on a pull request to save runner minutes and linted
// them post-merge; there is no bill here and no post-merge pass, so the closure is linted whole.
function lintScope() {
  if (sweep) return { mode: "all", reason: flags.all ? "--all" : "empty change (the sweep)" };
  return computeAffected({ changedFiles: change.codeFiles, packages: discoverPackages(ROOT) });
}
const scope = change.code ? lintScope() : { mode: "none", reason: "no code changed" };

// Every tracked container, for the sweep; otherwise only the ones the change touched.
function everyContainer() {
  const tracked = spawnSync("git", ["ls-files", "--", "containers"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: onWindows,
  });
  return changedContainers(tracked.stdout.split("\n"));
}
const containers = sweep ? everyContainer() : changedContainers(change.codeFiles);

let selection;
try {
  selection = selectDimensions(flags);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

// Why a dimension has no input for this change, or null when it runs.
function noInputReason(name) {
  switch (name) {
    case "format":
    case "governance":
    case "audit":
      return null;
    case "rust":
      return change.rust ? null : "no crate or toolchain pin changed";
    case "containers":
      return change.containers && containers.length > 0 ? null : "no container changed";
    case "lint":
      if (!change.code) return "no code changed";
      return scope.mode === "none" ? `nothing to lint — ${scope.reason}` : null;
    default:
      return change.code ? null : "no code changed";
  }
}

const skipped = new Map(selection.skippedByFlag);
const toRun = [];
for (const name of selection.selected) {
  const reason = noInputReason(name);
  if (reason === null) toRun.push(name);
  else skipped.set(name, reason);
}

const describeScope = () =>
  scope.mode === "all"
    ? `whole repository (${scope.reason})`
    : scope.mode === "none"
      ? `none (${scope.reason})`
      : `${scope.paths.length} package(s): ${scope.paths.join(" ")}`;

console.log(
  `gate: ${files.length} changed file(s) since ${base.slice(0, 12)}` +
    (sweep ? " — running everything (the sweep)" : ""),
);
console.log(
  `gate: code=${change.code} rust=${change.rust} containers=${containers.join(",") || "none"} lint=${describeScope()}`,
);
console.log(`gate: running ${toRun.join(", ")}`);
if (scale === null) {
  console.log(
    `gate: step time budgets are OFF (${SCALE_VARIABLE}) — a step that hangs will hang here`,
  );
} else if (scale !== 1) {
  console.log(`gate: step time budgets scaled x${String(scale)} (${SCALE_VARIABLE})`);
}
for (const [name, reason] of skipped) console.log(`gate: skipping ${name} — ${reason}`);
console.log("");

if (flags.plan) process.exit(0);

// ---------------------------------------------------------------------------------------------------
// Running a step
// ---------------------------------------------------------------------------------------------------

// Every spawned tool resolves through the workspace's own bin directory, so the gate behaves the same
// under `pnpm gate` (which puts it on PATH) and under a bare `node tooling/gate/index.mjs`.
const binDirectory = path.join(ROOT, "node_modules", ".bin");
const environment = (extra = {}) => ({
  ...process.env,
  PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  ...extra,
});

/**
 * Run a dimension's steps in order, stopping at the first that fails or exceeds its budget.
 *
 * A step that did not finish is reported as its own status, never folded into "failed": the two call
 * for different next moves, and reporting them as one word is what let a non-terminating check read as
 * a slow machine for six days. budget.mjs holds that history and the numbers.
 */
async function runSteps(dimension, steps) {
  for (const step of steps) {
    const result = await runStep(dimension, step, {
      root: ROOT,
      environment: environment(step.env),
      budgetMilliseconds: budgetFor(dimension, { scale }),
      onWindows,
    });
    if (result.status === "timed-out") {
      return { status: "timed-out", detail: `"${step.name}" did not finish` };
    }
    if (result.status === "failed") return { status: "failed", detail: `at "${step.name}"` };
  }
  return { status: "passed" };
}

const gitDiffStep = (name, pathspec) => ({
  name,
  command: "git",
  arguments: ["diff", "--exit-code", "--", pathspec],
  onFailure: `the regenerated ${pathspec} differs from what is committed — review the diff above and commit it`,
});

const toolAvailable = (command, probeArguments = ["--version"]) => {
  const probe = spawnSync(command, probeArguments, { stdio: "ignore", shell: onWindows });
  return probe.error === undefined && probe.status === 0;
};

// ---------------------------------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------------------------------

const dimensions = {
  format: () =>
    runSteps("format", [
      {
        name: "vp check --no-lint (whole repository)",
        command: "vp",
        arguments: ["check", "--no-lint"],
      },
    ]),

  governance: () => runSteps("governance", GOVERNANCE_STEPS),

  audit: () => {
    const started = Date.now();
    process.stdout.write("--- audit: dependency audit (osv-scanner, HIGH and above)\n");
    const result = runAudit({
      root: ROOT,
      reportPath: path.join(CACHE, "osv-report.json"),
      log: (line) => console.log(`    ${line}`),
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    if (result.status === "passed") console.log(`    ${result.detail}\n    ok (${seconds}s)\n`);
    else if (result.status === "not-run") console.log(`    NOT RUN — ${result.detail}\n`);
    else console.error(`    ${result.detail}\n    FAILED (${seconds}s)\n`);
    return result;
  },

  wasm: () =>
    runSteps("wasm", [
      {
        // Rebuilds only what is stale; a sub-second no-op when the artefacts are current.
        name: "Rust->WASM artefacts present and current (vp run bootstrap)",
        command: "node",
        arguments: ["tooling/bootstrap/index.mjs"],
      },
    ]),

  typecheck: () =>
    runSteps("typecheck", [
      { name: "tsc -b (both root solutions)", command: "vp", arguments: ["run", "typecheck"] },
      {
        name: "project-reference graph in sync",
        command: "node",
        arguments: ["tooling/tsconfig-refs/index.mjs", "--check"],
      },
      {
        name: "api-client type-check",
        command: "pnpm",
        arguments: ["--filter", "@magna-carta/api-client", "run", "typecheck"],
      },
      {
        name: "svelte-check (web)",
        command: "pnpm",
        arguments: ["--filter", "@magna-carta/web", "check"],
      },
      {
        name: "svelte-check (design-system)",
        command: "pnpm",
        arguments: ["--filter", "@magna-carta/design-system", "check"],
      },
    ]),

  contracts: () =>
    runSteps("contracts", [
      {
        name: "emit the OpenAPI snapshot",
        command: "pnpm",
        arguments: ["--filter", "@magna-carta/api-worker", "run", "emit-openapi"],
      },
      gitDiffStep("OpenAPI snapshot drift", "apps/api-worker/openapi/openapi.json"),
      { name: "regenerate the client", command: "pnpm", arguments: ["run", "generate-client"] },
      gitDiffStep("generated client drift", "packages/api-client/src"),
      {
        name: "Spectral hygiene lint",
        command: "pnpm",
        arguments: [
          "--filter",
          "@magna-carta/api-worker",
          "exec",
          "spectral",
          "lint",
          "openapi/openapi.json",
          "--fail-severity",
          "warn",
        ],
      },
      {
        name: "build the design tokens",
        command: "pnpm",
        arguments: ["--filter", "@magna-carta/design-tokens", "run", "build"],
      },
      gitDiffStep("design-token drift", "packages/design-tokens/generated"),
    ]),

  lint: () => {
    const targets = scope.mode === "all" ? [] : scope.paths;
    return runSteps("lint", [
      {
        name:
          scope.mode === "all"
            ? "vp check --no-fmt (whole repository)"
            : `vp check --no-fmt ${targets.join(" ")}`,
        command: "vp",
        arguments: ["check", "--no-fmt", ...targets],
        outputFile: path.join(CACHE, "lint-output.txt"),
      },
    ]);
  },

  rust: () =>
    runSteps("rust", [
      {
        name: "cargo fmt + clippy + test (crates workspace)",
        command: "vp",
        arguments: ["run", "rust-check"],
      },
    ]),

  containers: () => {
    const steps = [];
    for (const name of containers) {
      const manifest = `containers/${name}/Cargo.toml`;
      if (existsSync(path.join(ROOT, manifest))) {
        steps.push(
          {
            name: `${name}: cargo fmt --check`,
            command: "cargo",
            arguments: ["fmt", "--manifest-path", manifest, "--all", "--check"],
          },
          {
            name: `${name}: cargo clippy -D warnings`,
            command: "cargo",
            arguments: [
              "clippy",
              "--manifest-path",
              manifest,
              "--all-targets",
              "--",
              "-D",
              "warnings",
            ],
          },
          {
            name: `${name}: cargo test`,
            command: "cargo",
            arguments: ["test", "--manifest-path", manifest],
          },
        );
      }
      let suite;
      try {
        suite = acceptanceFor(name);
      } catch (error) {
        console.error(`--- containers: ${error.message}\n`);
        return { status: "failed", detail: `containers/${name} has no acceptance mapping` };
      }
      if (suite === null) {
        console.log(
          `--- containers: ${name} changed but has no acceptance suite yet — unit-tested only\n`,
        );
        continue;
      }
      if (!toolAvailable("docker", ["version"])) {
        console.error(
          `--- containers: ${name} changed and its acceptance suite needs Docker, which is not running here\n`,
        );
        return {
          status: "failed",
          detail: `containers/${name} changed; start Docker and re-run, or \`--skip containers\` and say so in the pull request`,
        };
      }
      steps.push({ name: `${name}: acceptance (${suite})`, command: "bash", arguments: [suite] });
    }
    return runSteps("containers", steps);
  },

  "test-collection": () =>
    runSteps("test-collection", [
      {
        name: "whole-suite collection clears its floor",
        command: "node",
        arguments: ["tooling/lint-test-collection/index.mjs"],
      },
    ]),

  tests: () =>
    runSteps("tests", [
      {
        // Through the single-flight guard, never a bare `vp test`: two runs in one worktree wedge.
        name: "pnpm test (the whole suite: node, Miniflare, Chromium)",
        command: "node",
        arguments: ["tooling/test-single-flight/index.mjs", "run"],
      },
    ]),
};

// ---------------------------------------------------------------------------------------------------
// Run, then report
// ---------------------------------------------------------------------------------------------------

const started = Date.now();
const results = new Map();
let wasmFailed = false;
for (const name of toRun) {
  if (wasmFailed && NEEDS_WASM.has(name)) {
    results.set(name, { status: "skipped", detail: "the WASM artefacts could not be built" });
    continue;
  }
  const at = Date.now();
  const result = await dimensions[name]();
  result.seconds = ((Date.now() - at) / 1000).toFixed(0);
  results.set(name, result);
  if (name === "wasm" && result.status === "failed") wasmFailed = true;
}

const label = {
  passed: "passed ",
  failed: "FAILED ",
  "timed-out": "NO END ",
  skipped: "skipped",
  "not-run": "NOT RUN",
};
console.log("gate: summary");
for (const [name, result] of results) {
  const detail = result.detail === undefined ? "" : ` — ${result.detail.split("\n")[0]}`;
  const time = result.seconds === undefined ? "" : ` (${result.seconds}s)`;
  console.log(`  ${label[result.status]}  ${name}${time}${detail}`);
}
for (const [name, reason] of skipped) console.log(`  ${label.skipped}  ${name} — ${reason}`);

const failed = [...results]
  .filter(([, result]) => result.status === "failed")
  .map(([name]) => name);
const timedOut = [...results]
  .filter(([, result]) => result.status === "timed-out")
  .map(([name]) => name);
const notRun = [...results]
  .filter(([, result]) => result.status === "not-run")
  .map(([name]) => name);
const minutes = ((Date.now() - started) / 60000).toFixed(1);
// Said before the failures, because it is the more surprising fact and the one with a different
// remedy: a dimension that never finished has not judged the change at all, so neither a pass nor a
// failure has been established for it.
if (timedOut.length > 0) {
  console.error(
    `\ngate: DID NOT FINISH — ${timedOut.join(", ")} exceeded its budget (${minutes} min). ` +
      "That dimension reached no verdict, so this change is unverified rather than bad; the timeout " +
      "above says how to find what does not terminate.",
  );
  process.exit(1);
}
if (failed.length > 0) {
  console.error(`\ngate: FAILED — ${failed.join(", ")} (${minutes} min)`);
  process.exit(1);
}
if (notRun.length > 0) {
  console.log(
    `\ngate: passed with ${notRun.join(", ")} NOT RUN (${minutes} min) — say so in the pull request; a check that did not run is not a check that passed`,
  );
  process.exit(0);
}
console.log(
  `\ngate: passed (${minutes} min) — this is the merge bar; state the result in the pull request`,
);
