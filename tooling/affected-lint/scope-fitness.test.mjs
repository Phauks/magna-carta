import { describe, expect, it } from "vitest";
import { computeAffected, selectFanoutSinks } from "./index.mjs";
import {
  GATE_INVOCATIONS,
  trueDependentClosure,
  verifyScopeCoverage,
  verifySinkSelection,
  verifyWorkflowInvocations,
} from "./scope-fitness.mjs";

// money <- data-access <- worker <- web, with worker as the fan-out sink.
const packages = new Map([
  ["@magna-carta/money", { dir: "packages/money", deps: new Set() }],
  [
    "@magna-carta/data-access",
    { dir: "packages/data-access", deps: new Set(["@magna-carta/money"]) },
  ],
  [
    "@magna-carta/api-worker",
    { dir: "apps/api-worker", deps: new Set(["@magna-carta/data-access"]) },
  ],
  ["@magna-carta/web", { dir: "apps/web", deps: new Set(["@magna-carta/api-worker"]) }],
]);
const sinks = new Set(["@magna-carta/api-worker"]);

describe("trueDependentClosure", () => {
  it("reaches every transitive dependent", () => {
    const reached = [...trueDependentClosure({ packages, seed: "@magna-carta/money" })].toSorted(
      (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    );
    expect(reached).toEqual([
      "@magna-carta/api-worker",
      "@magna-carta/data-access",
      "@magna-carta/money",
      "@magna-carta/web",
    ]);
  });

  it("is just the package itself at the top of the graph", () => {
    expect([...trueDependentClosure({ packages, seed: "@magna-carta/web" })]).toEqual([
      "@magna-carta/web",
    ]);
  });
});

describe("verifyScopeCoverage", () => {
  it("passes on a sound graph with the sink deferred", () => {
    expect(verifyScopeCoverage({ packages, sinks })).toEqual([]);
  });

  it("passes when nothing is declared a sink at all", () => {
    expect(verifyScopeCoverage({ packages, sinks: new Set() })).toEqual([]);
  });

  it("BITES when the post-merge walk under-covers the true dependent closure", () => {
    // The failure this lint exists for: a classifier that stops short of the full closure reports a
    // fast green rather than an error, so nothing but an independent derivation catches it. One hop
    // from money reaches data-access and stops, leaving worker and web unlinted at every tier.
    const cappedAtOneHop = (arguments_) => computeAffected({ ...arguments_, maxHops: 1 });
    const problems = verifyScopeCoverage({
      packages,
      sinks: new Set(),
      computeScope: cappedAtOneHop,
    });
    expect(problems.join("\n")).toContain(
      "a change to packages/money leaves apps/api-worker out of the post-merge scope",
    );
    expect(problems.join("\n")).toContain("apps/web");
  });

  it("BITES when the two tiers together still leave a package unlinted", () => {
    // Deferral has to be a MOVE. A classifier that drops the sink from BOTH tiers is a hole, and the
    // union assertion is the one that says so.
    const dropsSinkEverywhere = (arguments_) =>
      computeAffected({ ...arguments_, sinks: new Set(["@magna-carta/api-worker"]) });
    const problems = verifyScopeCoverage({
      packages,
      sinks,
      computeScope: dropsSinkEverywhere,
    });
    expect(problems.join("\n")).toContain(
      "leaves apps/api-worker out of BOTH tiers — the deferral is a hole, not a move",
    );
  });

  it("BITES when the pull-request scope drops something that is not a declared sink", () => {
    const dropsAnExtraPackage = (arguments_) => {
      const result = computeAffected(arguments_);
      if (!arguments_.sinks || arguments_.sinks.size === 0 || result.mode !== "paths")
        return result;
      return { ...result, paths: result.paths.filter((d) => d !== "packages/data-access") };
    };
    const problems = verifyScopeCoverage({
      packages,
      sinks,
      computeScope: dropsAnExtraPackage,
    });
    expect(problems.join("\n")).toContain(
      "drops packages/data-access from the pull-request scope, and packages/data-access is not a deferred fan-out sink",
    );
  });

  it("BITES when a changed package is deferred off its own pull request", () => {
    const defersTheChangedPackage = (arguments_) => {
      const result = computeAffected(arguments_);
      if (!arguments_.sinks || arguments_.sinks.size === 0 || result.mode !== "paths")
        return result;
      return { ...result, paths: result.paths.filter((d) => d !== "apps/api-worker") };
    };
    const problems = verifyScopeCoverage({
      packages,
      sinks,
      computeScope: defersTheChangedPackage,
    });
    expect(problems.join("\n")).toContain(
      "a change to apps/api-worker does not lint apps/api-worker itself on the pull-request tier",
    );
  });
});

describe("verifySinkSelection", () => {
  it("passes on one clear outlier", () => {
    expect(verifySinkSelection({ sinks })).toEqual([]);
  });

  it("BITES when the rule stops selecting anything (the flag would be a silent no-op)", () => {
    expect(verifySinkSelection({ sinks: new Set() }).join("\n")).toContain(
      "no fan-out sink was selected",
    );
  });

  it("does not care how close the next package is", () => {
    // Deliberately NOT a rule here. Two checks that compared a sink against its neighbour, or
    // against how far past the bar it sat, were tried on 2026-09-14 and both fired on ordinary
    // growth in apps/web rather than on anything about the deferral. Selection is the outlier test;
    // this function guards the two failure modes worth failing on, which are none and too many.
    expect(verifySinkSelection({ sinks: new Set(["@magna-carta/api-worker"]) })).toEqual([]);
  });

  it("BITES when the rule selects a slice of the workspace rather than outliers", () => {
    expect(
      verifySinkSelection({
        sinks: new Set(["@magna-carta/a", "@magna-carta/b", "@magna-carta/c"]),
      }).join("\n"),
    ).toContain("fan-out sinks selected");
  });
});

describe("selectFanoutSinks", () => {
  it("never selects a package with no lintable files of its own", () => {
    // apps/web-worker is the live case: zero own files, one dependency on apps/web, therefore
    // apps/web's weight exactly and forever. Deferring it would defer no lint work — there is
    // nothing in it to lint — while spending one of the two sink slots and reporting apps/web's
    // minutes a second time.
    const sinks = selectFanoutSinks({
      weights: new Map([
        ["@magna-carta/web", 1350],
        ["@magna-carta/web-worker", 1350],
      ]),
      totalLintableFiles: 2000,
      ownFiles: new Map([
        ["@magna-carta/web", 596],
        ["@magna-carta/web-worker", 0],
      ]),
    });
    expect([...sinks]).toEqual(["@magna-carta/web"]);
  });
});

describe("verifyWorkflowInvocations", () => {
  it("passes when both invocations are present verbatim", () => {
    const workflow = `steps:\n  run: |\n    ${GATE_INVOCATIONS.pullRequest}\n    ${GATE_INVOCATIONS.postMerge}\n`;
    expect(verifyWorkflowInvocations(workflow)).toEqual([]);
  });

  it("BITES when the gate's flags are edited without editing this lint", () => {
    const drifted = `steps:\n  run: |\n    node tooling/affected-lint/index.mjs --base "$base" --max-hops 1\n`;
    expect(verifyWorkflowInvocations(drifted).join("\n")).toContain(
      "pullRequest classifier invocation is not in .github/workflows/gate.yml",
    );
  });
});
