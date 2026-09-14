import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAffected, discoverPackages, resolveFanoutSinks } from "./index.mjs";

// Fitness function for the lint scope the gate trusts (sibling of lint-test-collection.mjs, which
// guards what the gate's TEST jobs collect).
//
// The gate does not lint the whole repository on a pull request. It lints a computed scope, and a
// scope that is too NARROW does not fail — it reports a fast green, exactly the way a test filter that
// still matches SOME files narrows a test job without failing it (lint-test-collection.mjs has the
// measurements; a filter matching NOTHING is the case the runner does catch, exiting 1). So the scope
// needs a proof rather than a reading, and that is what this is.
//
// What it asserts:
//   1. COVERAGE. For a change to every workspace package in turn, the unscoped pass (the one every
//      trigger except `pull_request` runs) covers that package's true transitive dependent closure —
//      derived here by an independent fixpoint over the dependency edges, NOT by the breadth-first
//      walk over inverted edges that the classifier uses, so an error in either algorithm shows up as
//      a disagreement rather than as two copies of the same mistake. Both read the one package graph
//      (`discoverPackages`), so the two answers cannot drift apart on a stale copy of it.
//   2. UNION. For the same changes, the pull-request scope plus the post-merge scope still covers that
//      closure. This is what makes deferring a fan-out sink a MOVE rather than a hole.
//   3. NO SELF-DEFERRAL. A changed package is always in its own pull-request scope, sink or not — an
//      author's own code is never deferred off their own pull request.
//   4. DEFERRAL IS EXACTLY THE SINKS. Nothing else is ever dropped from the pull-request scope.
//   5. THE SINK RULE STAYS AN OUTLIER RULE. The selected sinks are few, and each is far above the rest
//      of the distribution — so a dependency-shape change that quietly made half the workspace
//      "expensive" fails here instead of silently gutting the pull-request pass.
//   6. NO DRIFT WITH THE GATE. The classifier invocations are held verbatim below and checked against
//      .github/workflows/gate.yml, so editing the workflow's flags without editing this lint fails.
//
// Run: `pnpm run lint:affected-scope`. Pure graph work over package manifests — well under a second,
// no install and no build beyond the workspace checkout.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "gate.yml");

// The two classifier invocations in .github/workflows/gate.yml, verbatim. The pull-request tier defers
// the fan-out sinks; every other trigger walks the same unbounded closure with nothing deferred.
export const GATE_INVOCATIONS = {
  pullRequest:
    'node tooling/affected-lint/index.mjs --base "$base" --max-hops all --defer-fanout-sinks',
  postMerge: 'node tooling/affected-lint/index.mjs --base "$base" --max-hops all',
};

// The sink rule must stay a rule about outliers: at most this many packages may be selected, and each
// must be clearly over the bar rather than sitting on it.
//
// "Clearly over the bar" is measured against the SELECTION THRESHOLD (`FANOUT_SINK_SHARE` of every
// lintable file in the workspace), not against the heaviest non-sink package. It used to be the
// latter, and that was the wrong quantity — recalibrated 2026-09-14 with the distribution below.
//
// WHY THE NEIGHBOUR COMPARISON WAS WRONG. Second place moving is not evidence about first place. The
// ratio decayed monotonically as apps/web grew, which is the product being built rather than the
// dependency shape degrading: simulated against this graph, adding 50 / 200 / 400 files to apps/web
// drives it to 1.44 / 1.30 / 1.16 with nothing about api-worker's deferral having changed. Past about
// +600 it stops failing that way and starts failing a different way — apps/web and apps/web-worker
// cross the threshold together and three sinks are selected — so no value of a neighbour ratio
// survives ordinary growth. Measured 2026-08-05 it was 1261 against 550 (2.29x) and the floor was set
// at 1.5; by 2026-09-14 it was 2022 against 1350 (1.50x), failing on any branch that added four
// TypeScript files to apps/web. A tripwire that ordinary work trips is a tripwire somebody removes.
//
// Against the threshold the check is self-consistent with the rule it guards: a package is selected
// because it crosses the bar, and it is held to being meaningfully past it. When api-worker's closure
// genuinely stops being whole-repo-scale, its margin falls to 1.0 and then it stops being selected at
// all — which the `sinks.size === 0` branch already reports as the deferral having become a no-op,
// the correct and informative outcome rather than a mystery.
//
// MEASURED 2026-09-14 (85 packages, 3088 lintable files, threshold 1544):
//   @magna-carta/api-worker    2022  65.5%  — selected, 1.31x the threshold
//   @magna-carta/web           1350  43.7%  — not selected
//   @magna-carta/web-worker    1350  43.7%  — never selectable: no lintable files of its own
//   @magna-carta/fixtures      1024  33.2%
//   @magna-carta/notifications  759  24.6%
//
// RUNWAY. Simulated over this graph by growing apps/web (the package that moves): the rule holds
// through roughly +400 own files, about 67% growth on today's 596, and then reports that apps/web has
// crossed the bar with a margin of 1.00x. That is a real question arriving — should the web app be
// deferred too, and is a 50% share still the right bar for a workspace with two programs that size —
// rather than a tripwire, which is what the old neighbour ratio had become. Whoever meets it should
// re-measure and decide, not retune.
//
// The floor is set below today's 1.31 with room to breathe. Raise it only with a fresh distribution in
// hand; never lower it to make a red run green.
export const MAX_FANOUT_SINKS = 2;
export const MIN_SINK_THRESHOLD_MARGIN = 1.15;

// The true transitive dependent closure of `seed`, by repeated relaxation over the FORWARD dependency
// edges: keep adding any package that depends on something already in the set until nothing changes.
// Deliberately a different algorithm from the classifier's breadth-first walk over inverted edges.
export function trueDependentClosure({ packages, seed }) {
  const closure = new Set([seed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, member] of packages) {
      if (closure.has(name)) continue;
      for (const dependency of member.deps) {
        if (closure.has(dependency)) {
          closure.add(name);
          grew = true;
          break;
        }
      }
    }
  }
  return closure;
}

export function verifyWorkflowInvocations(workflowText) {
  const problems = [];
  for (const [tier, invocation] of Object.entries(GATE_INVOCATIONS)) {
    if (!workflowText.includes(invocation)) {
      problems.push(
        `  the ${tier} classifier invocation is not in .github/workflows/gate.yml verbatim:\n    ${invocation}`,
      );
    }
  }
  return problems;
}

// `computeScope` is the classifier under test, injectable so the lint's own tests can feed it a
// deliberately broken scope and prove these assertions bite. Production always passes the real one.
export function verifyScopeCoverage({ packages, sinks, computeScope = computeAffected }) {
  const problems = [];
  const directoryOf = (name) => packages.get(name).dir;
  const everyDirectory = [...packages.values()].map((member) => member.dir);
  // `ALL` means "lint the whole repository", so it covers every directory — the shared tsconfig
  // package and the affected-lint logic itself are global triggers and land here.
  const scopeOf = (result) =>
    new Set(result.mode === "all" ? everyDirectory : result.mode === "paths" ? result.paths : []);
  for (const [seed, member] of packages) {
    const changedFiles = [`${member.dir}/src/probe.ts`];
    const expected = new Set([...trueDependentClosure({ packages, seed })].map(directoryOf));

    const postMerge = computeScope({ changedFiles, packages });
    const postMergePaths = scopeOf(postMerge);
    for (const directory of expected) {
      if (!postMergePaths.has(directory)) {
        problems.push(
          `  a change to ${member.dir} leaves ${directory} out of the post-merge scope, but ${directory} transitively depends on it`,
        );
      }
    }

    const pullRequest = computeScope({ changedFiles, packages, sinks });
    const pullRequestPaths = scopeOf(pullRequest);
    const union = new Set([...pullRequestPaths, ...postMergePaths]);
    for (const directory of expected) {
      if (!union.has(directory)) {
        problems.push(
          `  a change to ${member.dir} leaves ${directory} out of BOTH tiers — the deferral is a hole, not a move`,
        );
      }
    }

    if (!pullRequestPaths.has(member.dir)) {
      problems.push(
        `  a change to ${member.dir} does not lint ${member.dir} itself on the pull-request tier`,
      );
    }

    const droppedFromPullRequest = [...postMergePaths].filter((d) => !pullRequestPaths.has(d));
    const allowedToDrop = new Set(
      [...sinks].filter((name) => name !== seed).map((name) => directoryOf(name)),
    );
    for (const directory of droppedFromPullRequest) {
      if (!allowedToDrop.has(directory)) {
        problems.push(
          `  a change to ${member.dir} drops ${directory} from the pull-request scope, and ${directory} is not a deferred fan-out sink`,
        );
      }
    }
  }
  return problems;
}

export function verifySinkSelection({ weights, sinks, threshold = 0 }) {
  const problems = [];
  if (sinks.size === 0) {
    problems.push(
      `  no fan-out sink was selected, so --defer-fanout-sinks is a no-op — either the dependency shape improved (delete the flag and this rule) or the weighting broke`,
    );
    return problems;
  }
  if (sinks.size > MAX_FANOUT_SINKS) {
    problems.push(
      `  ${sinks.size} fan-out sinks selected (cap ${MAX_FANOUT_SINKS}): ${[...sinks].join(", ")} — the rule is meant to catch outliers, not a slice of the workspace`,
    );
  }
  for (const name of sinks) {
    const weight = weights.get(name) ?? 0;
    if (threshold > 0 && weight < threshold * MIN_SINK_THRESHOLD_MARGIN) {
      problems.push(
        `  ${name} weighs ${weight} lintable files against a selection threshold of ${Math.round(threshold)} — a margin of ${(weight / threshold).toFixed(2)}x, under the ${MIN_SINK_THRESHOLD_MARGIN}x the outlier rule needs. A package sitting ON the bar is not a whole-repo lint, and deferring it costs the pull-request pass more than it saves`,
      );
    }
  }
  return problems;
}

function main() {
  const packages = discoverPackages(ROOT);
  if (packages.size === 0) {
    console.error("lint-affected-scope: discovered no workspace packages — refusing to pass");
    process.exit(1);
  }
  const { weights, sinks, totalLintableFiles, threshold } = resolveFanoutSinks({
    root: ROOT,
    packages,
  });

  const problems = [
    ...verifyWorkflowInvocations(readFileSync(WORKFLOW_PATH, "utf8")),
    ...verifySinkSelection({ weights, sinks, threshold }),
    ...verifyScopeCoverage({ packages, sinks }),
  ];

  const ranked = [...weights].toSorted((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(
    `lint-affected-scope: ${packages.size} workspace packages, ${totalLintableFiles} lintable files.`,
  );
  console.log("  heaviest type programs (lintable files in the dependency closure):");
  for (const [name, weight] of ranked) {
    const share = ((100 * weight) / totalLintableFiles).toFixed(1);
    console.log(
      `    ${String(weight).padStart(5)}  ${share.padStart(5)}%  ${name}${sinks.has(name) ? "  <- deferred fan-out sink" : ""}`,
    );
  }

  if (problems.length > 0) {
    console.error("\nlint-affected-scope: the computed lint scope is not sound:\n");
    for (const problem of problems) console.error(problem);
    console.error("");
    process.exit(1);
  }
  console.log(
    "  scope is sound: the post-merge pass covers every dependent closure, and the pull-request pass differs only by the deferred sinks.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
