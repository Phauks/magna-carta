import { describe, expect, it } from "vitest";
import { reconcile, specificationKey } from "./collection.mjs";

// This lint's whole job is to prove something about the suite, so its own reasoning has to be proved
// rather than read. Each case below constructs the failure the assertion claims to catch and checks
// it is caught, and — just as important — constructs the near-miss that is legitimately fine and
// checks it stays quiet. A guard that fires on everything is as useless as one that fires on nothing.

describe("reconcile — the whole-suite collection clears its floor", () => {
  const wholeSuite = new Set(["a [x]", "b [x]", "c [y]"]);

  it("passes a collection at or above the floor", () => {
    expect(reconcile({ wholeSuite, floor: 3 })).toEqual([]);
    expect(reconcile({ wholeSuite, floor: 1 })).toEqual([]);
  });

  it("flags a whole-suite collection that has collapsed below the floor", () => {
    const failures = reconcile({ wholeSuite, floor: 10 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("collected 3 test files, below the committed floor of 10");
  });
});

describe("specificationKey", () => {
  it("keys on the repo-relative path plus the claiming project, normalising separators", () => {
    expect(
      specificationKey(
        { file: "C:\\repo\\packages\\x\\test\\a.test.ts", projectName: "x" },
        "C:/repo/",
      ),
    ).toBe("packages/x/test/a.test.ts [x]");
  });
});
