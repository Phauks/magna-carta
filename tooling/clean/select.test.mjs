import { describe, expect, it } from "vitest";
import { eligibleWorktrees, isArtifactDir, landedBranches, normalizePath } from "./select.mjs";

const WORKTREES = [
  { path: "C:/dev/magna-carta-worktrees/main-merge", branch: "main", detached: false },
  {
    path: "C:/dev/magna-carta-worktrees/feature-merged",
    branch: "feature-merged",
    detached: false,
  },
  { path: "C:/dev/magna-carta-worktrees/feature-open", branch: "feature-open", detached: false },
  { path: "C:/dev/magna-carta-worktrees/detached", branch: null, detached: true },
  { path: "C:/dev/magna-carta", branch: "current-branch", detached: false },
];

const base = {
  worktrees: WORKTREES,
  currentPath: "C:/dev/magna-carta",
  mergedBranches: new Set(["feature-merged"]),
};

describe("eligibleWorktrees", () => {
  it("sweeps merged, non-current, non-main worktrees only", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: false }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged"]);
  });

  it("with allWorktrees includes open branches but never main, current, or detached", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: true }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged", "feature-open"]);
  });

  it("matches the current worktree regardless of slash or drive-letter case", () => {
    const got = eligibleWorktrees({
      ...base,
      currentPath: "c:\\dev\\magna-carta",
      allWorktrees: true,
    }).map((w) => w.branch);
    expect(got).not.toContain("current-branch");
    expect(got).toEqual(["feature-merged", "feature-open"]);
  });
});

describe("normalizePath", () => {
  it("uses forward slashes, a lowercase drive letter, and no trailing slash", () => {
    expect(normalizePath("C:\\dev\\Foo\\")).toBe("c:/dev/Foo");
  });
});

describe("landedBranches", () => {
  const BASELINE_COMMIT = "c0ffee";
  const BASELINE_TREE = "aaaa";

  // "squash-landed" reproduces how pull requests land here: own commits, no content of its own left
  // to contribute. "fresh-workspace" is a worktree just created off the baseline — indistinguishable
  // from landed by content alone, which is why the tip check comes first.
  const tips = {
    "squash-landed": "1111",
    "still-open": "2222",
    conflicting: "3333",
    "ancestry-merged": "4444",
    "fresh-workspace": BASELINE_COMMIT,
  };
  const mergeResults = {
    "squash-landed": BASELINE_TREE,
    "still-open": "bbbb",
    conflicting: null,
    "ancestry-merged": "cccc",
    "fresh-workspace": BASELINE_TREE,
  };
  const call = (candidateBranches, ancestryMerged = new Set()) =>
    landedBranches({
      candidateBranches,
      baselineCommit: BASELINE_COMMIT,
      baselineTree: BASELINE_TREE,
      tipOf: (branch) => tips[branch],
      ancestryMerged,
      mergeResultTree: (branch) => mergeResults[branch],
    });

  it("counts a squash-merged branch as landed, which ancestry alone never sees", () => {
    expect([...call(["squash-landed", "still-open"])]).toEqual(["squash-landed"]);
  });

  it("still counts an ancestry-merged branch as landed", () => {
    expect([...call(["ancestry-merged"], new Set(["ancestry-merged"]))]).toEqual([
      "ancestry-merged",
    ]);
  });

  it("never counts a worktree sitting on the baseline — that is live, not finished", () => {
    expect(call(["fresh-workspace"], new Set(["fresh-workspace"])).size).toBe(0);
  });

  it("treats a conflicting merge as not landed", () => {
    expect(call(["conflicting"]).size).toBe(0);
  });
});

describe("isArtifactDir", () => {
  it("accepts regenerable build dirs and rejects source dirs", () => {
    expect(isArtifactDir("target")).toBe(true);
    expect(isArtifactDir(".svelte-kit")).toBe(true);
    expect(isArtifactDir("src")).toBe(false);
  });
});
