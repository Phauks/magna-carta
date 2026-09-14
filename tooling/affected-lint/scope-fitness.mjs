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

// The sink rule must stay a rule about outliers. At most this many packages may be selected, and each
// must weigh at least this multiple of the heaviest NON-sink package. Measured 2026-08-05: the one
// sink (@magna-carta/api-worker) weighs 1261 lintable files against the next package's 550 — a factor of
// 2.29. Re-measured 2026-09-12, with the owner's direction: the sink weighs 2023 against
// @magna-carta/web's 1351 (web-worker shares that closure), a factor of 1.50, with @magna-carta/fixtures
// third at 1025. The distribution did not flatten — its second member grew, because the web
// application is where every screen round of 2026-08 and 2026-09 landed — and the web application is
// not a sink: it is one package, under the count, and only 1.32x the third. The floor below is that
// recorded shape with room for the second member to keep growing, not a number picked to turn a red
// run green. If it fails again, the question is whether the web application has become a second sink;
// the answer is to raise the count deliberately and record the distribution here.
export const MAX_FANOUT_SINKS = 2;
export const MIN_SINK_SEPARATION = 1.3;

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

export function verifySinkSelection({ weights, sinks }) {
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
  let heaviestNonSink = 0;
  let heaviestNonSinkName = "(none)";
  for (const [name, weight] of weights) {
    if (!sinks.has(name) && weight > heaviestNonSink) {
      heaviestNonSink = weight;
      heaviestNonSinkName = name;
    }
  }
  for (const name of sinks) {
    const weight = weights.get(name) ?? 0;
    if (heaviestNonSink > 0 && weight < heaviestNonSink * MIN_SINK_SEPARATION) {
      problems.push(
        `  ${name} weighs ${weight} lintable files against ${heaviestNonSinkName}'s ${heaviestNonSink} — a factor of ${(weight / heaviestNonSink).toFixed(2)}, under the ${MIN_SINK_SEPARATION}x separation the outlier rule needs`,
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
  const { weights, sinks, totalLintableFiles } = resolveFanoutSinks({ root: ROOT, packages });

  const problems = [
    ...verifyWorkflowInvocations(readFileSync(WORKFLOW_PATH, "utf8")),
    ...verifySinkSelection({ weights, sinks }),
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
