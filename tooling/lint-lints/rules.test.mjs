import { describe, expect, it } from "vitest";
import { SELF_TEST, runSelfTest } from "./index.mjs";
import {
  checkEveryCitedCommandExists,
  checkEveryLintCanFail,
  checkEveryLintIsDocumented,
  citedLintCommands,
  compareFitnessScopeVariable,
  fitnessSweepEnvironment,
  hasSelfTest,
  scriptFileOf,
  testFileMatches,
} from "./rules.mjs";

const bare = (name, scriptFile) => ({ name, scriptFile, source: "walk(ROOT);", testFiles: [] });

/** A gate step list whose fitness-sweep step carries the given environment, and nothing else. */
const stepsWithSweepEnvironment = (env) => [
  { name: "Something else", command: "pnpm", arguments: ["run", "check"] },
  {
    name: "Repo-wide fitness sweep",
    command: "vp",
    arguments: ["test", "run", "-c", "tooling/sweep.config.ts"],
    ...(env === undefined ? {} : { env }),
  },
  { name: "After", command: "echo", arguments: ["done"], env: { UNRELATED: "yes" } },
];

describe("the startup self-test", () => {
  it("passes, so the gate proves itself on every invocation", () => {
    expect(runSelfTest()).toEqual([]);
  });

  it("covers every rule rather than one of them", () => {
    expect(SELF_TEST.length).toBeGreaterThanOrEqual(20);
  });

  it("names every case it runs, so a failure says which one", () => {
    expect(SELF_TEST.every(({ name }) => typeof name === "string" && name.length > 0)).toBe(true);
  });
});

describe("finding the script a lint command runs", () => {
  it("reads the path past the runner and the flags", () => {
    expect(scriptFileOf("node tooling/migration-bundles/index.mjs --check")).toBe(
      "tooling/migration-bundles/index.mjs",
    );
  });

  it("accepts a TypeScript entry as readily as a JavaScript one", () => {
    expect(scriptFileOf("node tooling/migration-immutability/index.mts")).toBe(
      "tooling/migration-immutability/index.mts",
    );
  });

  it("reports none rather than guessing when the command names no script", () => {
    expect(scriptFileOf("echo nothing")).toBeNull();
    expect(scriptFileOf(undefined)).toBeNull();
  });
});

describe("detecting a self-test that runs on every invocation", () => {
  it("accepts a table walked by a loop", () => {
    expect(hasSelfTest("const SELF_TEST = [];\nfor (const one of SELF_TEST) check(one);")).toBe(
      true,
    );
  });

  it("accepts a table filtered in place", () => {
    expect(hasSelfTest("const SELF_TEST = [];\nconst bad = SELF_TEST.filter(fails);")).toBe(true);
  });

  it("accepts a named function that is called", () => {
    expect(hasSelfTest("function selfTest() {}\nfunction main() { selfTest(); }")).toBe(true);
  });

  it("accepts a self-test imported from a shared policy module and called", () => {
    expect(
      hasSelfTest(
        'import { runLicensePolicySelfTest } from "./license-policy/index.mjs";\n' +
          "function main() { runLicensePolicySelfTest(); }",
      ),
    ).toBe(true);
  });

  it("rejects a self-test that is declared and never called", () => {
    expect(hasSelfTest("const SELF_TEST = [];\nfunction runSelfTest() { return []; }")).toBe(false);
  });

  it("rejects an ordinary scan with no self-test at all", () => {
    expect(hasSelfTest("const files = walk(ROOT);\nfor (const file of files) scan(file);")).toBe(
      false,
    );
  });
});

describe("what counts as a test standing beside a lint", () => {
  it("accepts any test in a lint's own directory", () => {
    expect(
      testFileMatches({
        scriptFile: "tooling/lint-something/index.mjs",
        testFile: "tooling/lint-something/rules.test.mjs",
      }),
    ).toBe(true);
  });

  it("requires the matching basename in the shared tooling directory", () => {
    expect(
      testFileMatches({
        scriptFile: "tooling/lint-something.mjs",
        testFile: "tooling/lint-other.test.mjs",
      }),
    ).toBe(false);
    expect(
      testFileMatches({
        scriptFile: "tooling/lint-something.mjs",
        testFile: "tooling/lint-something.test.mjs",
      }),
    ).toBe(true);
  });

  it("never accepts a test from another directory", () => {
    expect(
      testFileMatches({
        scriptFile: "tooling/lint-something/index.mjs",
        testFile: "tooling/lint-other/rules.test.mjs",
      }),
    ).toBe(false);
  });

  it("never accepts a file that is not a test", () => {
    expect(
      testFileMatches({
        scriptFile: "tooling/lint-something/index.mjs",
        testFile: "tooling/lint-something/rules.mjs",
      }),
    ).toBe(false);
  });
});

describe("rule one: every lint can fail", () => {
  it("reports a lint with neither a test nor a self-test", () => {
    const { findings, unprovable } = checkEveryLintCanFail({
      lints: [bare("lint:bare", "tooling/lint-bare.mjs")],
      register: [],
    });
    expect(unprovable).toEqual(["lint:bare"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("lint:bare: nothing proves it can fail");
    expect(findings[0]).toContain("tooling/lint-bare.test.mjs");
  });

  it("carries a lint that is on the debt register", () => {
    const { findings, unprovable } = checkEveryLintCanFail({
      lints: [bare("lint:bare", "tooling/lint-bare.mjs")],
      register: ["lint:bare"],
    });
    expect(findings).toEqual([]);
    expect(unprovable).toEqual(["lint:bare"]);
  });

  it("makes the register a ratchet: a registered lint that gained a test must be removed", () => {
    const { findings } = checkEveryLintCanFail({
      lints: [
        {
          name: "lint:bare",
          scriptFile: "tooling/lint-bare/index.mjs",
          source: "walk(ROOT);",
          testFiles: ["tooling/lint-bare/rules.test.mjs"],
        },
      ],
      register: ["lint:bare"],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("delete");
    expect(findings[0]).toContain("LINTS_THAT_CANNOT_FAIL");
  });

  it("reports a register entry for a script that no longer exists", () => {
    const { findings } = checkEveryLintCanFail({ lints: [], register: ["lint:gone"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("no such script in the root package.json");
  });

  it("reports a command that names no script file, and a script file that is missing", () => {
    const { findings } = checkEveryLintCanFail({
      lints: [
        { name: "lint:shell", scriptFile: null, source: null, testFiles: [] },
        {
          name: "lint:missing",
          scriptFile: "tooling/lint-missing.mjs",
          source: null,
          testFiles: [],
        },
      ],
      register: [],
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("names no script file");
    expect(findings[1]).toContain("does not exist on disk");
  });
});

describe("rule two: every lint is documented", () => {
  it("reports a lint named nowhere", () => {
    const { findings, undocumented } = checkEveryLintIsDocumented({
      lints: [{ name: "lint:unseen", scriptFile: "tooling/lint-unseen.mjs" }],
      documentation: "nothing here.",
    });
    expect(undocumented).toEqual(["lint:unseen"]);
    expect(findings[0]).toContain("named nowhere under docs");
  });

  it("accepts the command name, the script path, or the tool directory", () => {
    const lints = [{ name: "lint:seen", scriptFile: "tooling/lint-seen/index.mjs" }];
    for (const documentation of [
      "run `pnpm run lint:seen` before pushing.",
      "the scan lives at tooling/lint-seen/index.mjs.",
      "the rule is enforced by `tooling/lint-seen`.",
    ]) {
      expect(checkEveryLintIsDocumented({ lints, documentation }).findings).toEqual([]);
    }
  });

  it("does not credit the shared tooling directory as a mention", () => {
    const { findings } = checkEveryLintIsDocumented({
      lints: [{ name: "lint:flat", scriptFile: "tooling/lint-flat.mjs" }],
      documentation: "everything lives under tooling.",
    });
    expect(findings).toHaveLength(1);
  });
});

describe("reading lint commands out of prose", () => {
  it("finds the command and the line it sits on", () => {
    expect(citedLintCommands("intro\nrun `pnpm run lint:frobnicate` first.")).toEqual([
      { command: "lint:frobnicate", line: 2 },
    ]);
  });

  it("accepts the other runners a reader might be told to use", () => {
    expect(citedLintCommands("pnpm lint:one\nvp run lint:two\nnpm run lint:three")).toHaveLength(3);
  });

  it("ignores a bare mention that is not a command", () => {
    expect(citedLintCommands("the lint:frobnicate rule bans frobbing.")).toEqual([]);
  });
});

describe("rule three: every cited command exists", () => {
  it("reports a citation with no script behind it, naming the file and line", () => {
    const { findings, broken } = checkEveryCitedCommandExists({
      citations: [{ file: "docs/conventions/style.md", command: "lint:gone", line: 4 }],
      lintNames: ["lint:here"],
    });
    expect(broken).toHaveLength(1);
    expect(findings[0]).toContain("docs/conventions/style.md:4");
  });

  it("passes a citation that resolves", () => {
    expect(
      checkEveryCitedCommandExists({
        citations: [{ file: "CLAUDE.md", command: "lint:here", line: 1 }],
        lintNames: ["lint:here"],
      }).findings,
    ).toEqual([]);
  });
});

describe("reading the fitness sweep's environment out of the gate's steps", () => {
  const steps = stepsWithSweepEnvironment;

  it("reads the step's own environment and nothing else", () => {
    expect(
      fitnessSweepEnvironment(steps({ SOME_SCOPES: "source,schema" }), "tooling/sweep.config.ts"),
    ).toEqual({ found: true, variables: [["SOME_SCOPES", "source,schema"]] });
  });

  it("reports a step with no environment at all", () => {
    expect(fitnessSweepEnvironment(steps(), "tooling/sweep.config.ts")).toEqual({
      found: true,
      variables: [],
    });
  });

  it("reports the sweep being absent from the gate entirely", () => {
    expect(fitnessSweepEnvironment(steps(), "tooling/elsewhere.config.ts")).toEqual({
      found: false,
      variables: [],
    });
  });
});

describe("rule four: the scope variable is pinned on both sides", () => {
  const knownScopes = new Set(["source", "schema"]);

  it("passes when the names match and every scope is known", () => {
    expect(
      compareFitnessScopeVariable({
        environment: { found: true, variables: [["SCOPES", "source,schema"]] },
        expectedName: "SCOPES",
        knownScopes,
      }),
    ).toEqual([]);
  });

  it("fails when the gate was renamed out from under the sweep", () => {
    const findings = compareFitnessScopeVariable({
      environment: { found: true, variables: [["RENAMED", "source,schema"]] },
      expectedName: "ORIGINAL",
      knownScopes,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("default scope");
    expect(findings[0]).toContain("ORIGINAL");
    expect(findings[0]).toContain("RENAMED");
  });

  it("fails on a typo in the scope value, which narrows the sweep just as quietly", () => {
    const findings = compareFitnessScopeVariable({
      environment: { found: true, variables: [["SCOPES", "source,scheme"]] },
      expectedName: "SCOPES",
      knownScopes,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("scheme");
  });

  it("fails when the sweep step has gone from the gate", () => {
    const findings = compareFitnessScopeVariable({
      environment: { found: false, variables: [] },
      expectedName: "SCOPES",
      knownScopes,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("not in the gate at all");
  });
});
