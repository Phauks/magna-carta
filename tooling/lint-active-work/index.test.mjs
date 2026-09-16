import { describe, expect, it } from "vitest";
import { collectNotes, namespacesOf, runSelfTest } from "./index.mjs";
import {
  SELF_TEST,
  STATUSES,
  branchShapeProblem,
  checkNote,
  flattenedNamespace,
} from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about collecting the notes rather than about judging one.

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      expect(
        checkNote(scenario)
          .map((problem) => problem.rule)
          .toSorted(),
      ).toEqual([...scenario.expect].toSorted());
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it reads a note", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("the documented status set", () => {
  it("is the set docs/active-work/README.md writes, and nothing else", () => {
    expect(STATUSES).toEqual(["designing", "building", "review", "blocked"]);
  });

  it("names the value it rejected, so the author can see what they wrote", () => {
    const [problem] = checkNote({
      path: "docs/active-work/claude/x.md",
      markdown: "---\nworktree: w\narea: a\nstatus: in-progress\ntouches: packages/x\n---\n",
      namespaces: ["claude"],
    });
    expect(problem.rule).toBe("unknown-status");
    expect(problem.detail).toContain("in-progress");
  });
});

describe("a path that has to mirror a branch", () => {
  it("accepts the shapes git accepts", () => {
    expect(branchShapeProblem("claude/loving-euler-0frk0e")).toBeNull();
    expect(branchShapeProblem("hotfix")).toBeNull();
    expect(branchShapeProblem("team/area/thing")).toBeNull();
  });

  it("refuses what git would refuse", () => {
    expect(branchShapeProblem("")).not.toBeNull();
    expect(branchShapeProblem("claude/fix thing")).not.toBeNull();
    expect(branchShapeProblem("claude//fix")).not.toBeNull();
    expect(branchShapeProblem("claude/.hidden")).not.toBeNull();
    expect(branchShapeProblem("claude/fix.lock")).not.toBeNull();
    expect(branchShapeProblem("claude/fix~1")).not.toBeNull();
    expect(branchShapeProblem("claude/fix..thing")).not.toBeNull();
  });
});

describe("the flattened path, which is the failure a path alone cannot see", () => {
  it("reads a top-level note opening with a live namespace as a flattened one", () => {
    expect(flattenedNamespace("claude-fix-thing", ["claude"])).toBe("claude");
  });

  it("leaves a genuine top-level branch alone", () => {
    expect(flattenedNamespace("hotfix", ["claude"])).toBeNull();
    expect(flattenedNamespace("claude/fix-thing", ["claude"])).toBeNull();
  });

  it("stays silent rather than guessing when the registry has no namespaces yet", () => {
    expect(flattenedNamespace("claude-fix-thing", [])).toBeNull();
  });

  it("names the path the note should move to, not just the fault", () => {
    const problems = checkNote({
      path: "docs/active-work/claude-fix-thing.md",
      markdown: "---\nworktree: w\narea: a\nstatus: building\ntouches: packages/x\n---\n",
      namespaces: ["claude"],
    });
    expect(problems[0].detail).toContain("docs/active-work/claude/fix-thing.md");
  });
});

describe("collecting the notes", () => {
  const entry = (name, directory = false) => ({
    name,
    isDirectory: () => directory,
  });
  const tree = {
    "docs/active-work/": [entry("README.md"), entry("claude", true), entry("hotfix.md")],
    "docs/active-work/claude/": [entry("fix-thing.md"), entry("other-thing.md")],
  };
  const readDirectory = (directory) => tree[directory] ?? [];

  it("walks into namespaces and leaves the README alone", () => {
    expect(collectNotes(readDirectory)).toEqual([
      "docs/active-work/claude/fix-thing.md",
      "docs/active-work/claude/other-thing.md",
      "docs/active-work/hotfix.md",
    ]);
  });

  it("reads the namespaces in use out of the notes themselves", () => {
    expect(namespacesOf(collectNotes(readDirectory))).toEqual(["claude"]);
  });
});
